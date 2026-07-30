// Защита от SSRF при загрузке контента по URL, полученному от модели.
//
// Проверяются: схема (только http/https), результат резолва DNS (адрес не
// должен быть внутренним) и каждый шаг редиректа — иначе публичный URL мог бы
// увести на 169.254.169.254 или внутрь VPC. Плюс потолок размера тела, чтобы
// ответ не выел память процесса.

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export class BlockedUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BlockedUrlError";
  }
}

const MAX_REDIRECTS = 3;
/** 256 МиБ — с запасом на видеокреативы, но без риска выесть память. */
export const DEFAULT_MAX_BYTES = 256 * 1024 * 1024;

function ipv4IsInternal(ip: string): boolean {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return true; // не разобрали — считаем небезопасным
  }
  const [a, b] = p as [number, number, number, number];
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 10) return true; // частная сеть
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local, облачные метаданные
  if (a === 172 && b >= 16 && b <= 31) return true; // частная сеть
  if (a === 192 && b === 168) return true; // частная сеть
  if (a === 192 && b === 0) return true; // 192.0.0/24 — служебные
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a === 198 && (b === 18 || b === 19)) return true; // бенчмарк-сети
  if (a >= 224) return true; // multicast и зарезервированные, вкл. 255.255.255.255
  return false;
}

function ipv6IsInternal(ip: string): boolean {
  const addr = ip.toLowerCase().split("%")[0] ?? ip.toLowerCase();

  // IPv4-mapped (::ffff:1.2.3.4) и NAT64 (64:ff9b::1.2.3.4) — проверяем как IPv4.
  const v4 = addr.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (v4?.[1]) return ipv4IsInternal(v4[1]);

  if (addr === "::" || addr === "::1") return true; // unspecified, loopback
  if (/^f[cd]/.test(addr)) return true; // fc00::/7 — unique local
  if (/^fe[89ab]/.test(addr)) return true; // fe80::/10 — link-local
  if (addr.startsWith("ff")) return true; // ff00::/8 — multicast
  return false;
}

export function addressIsInternal(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) return ipv4IsInternal(ip);
  if (kind === 6) return ipv6IsInternal(ip);
  return true; // не IP — не пропускаем
}

/**
 * Проверяет URL: схема http(s) и все адреса хоста — внешние.
 * `allowPrivateNetwork` отключает проверку адресов (локальный запуск, где
 * обращение во внутреннюю сеть — законный сценарий).
 */
export async function assertAllowedUrl(
  raw: string,
  allowPrivateNetwork: boolean
): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new BlockedUrlError(`Некорректный URL: ${raw}`);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new BlockedUrlError(
      `Схема ${url.protocol} запрещена, допустимы только http и https`
    );
  }
  if (allowPrivateNetwork) return url;

  const host = url.hostname.replace(/^\[|\]$/g, "");
  let addresses: Array<{ address: string }>;
  if (isIP(host)) {
    addresses = [{ address: host }];
  } else {
    try {
      addresses = await lookup(host, { all: true });
    } catch (e) {
      throw new BlockedUrlError(`Не удалось разрешить хост ${host}: ${(e as Error).message}`);
    }
  }

  // Достаточно одного внутреннего адреса: какой из них выберет системный
  // резолвер при реальном запросе — не наше решение.
  for (const { address } of addresses) {
    if (addressIsInternal(address)) {
      throw new BlockedUrlError(
        `Хост ${host} указывает на внутренний адрес ${address} — запрос заблокирован`
      );
    }
  }
  return url;
}

export interface FetchGuardedOptions {
  timeoutMs: number;
  allowPrivateNetwork: boolean;
  maxBytes?: number;
}

/** Скачивает URL с проверкой каждого редиректа и потолком размера тела. */
export async function fetchGuarded(
  raw: string,
  opts: FetchGuardedOptions
): Promise<{ bytes: Uint8Array; filename: string }> {
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  let url = await assertAllowedUrl(raw, opts.allowPrivateNetwork);

  let response: Response | undefined;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const r = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(opts.timeoutMs),
    });

    if (r.status >= 300 && r.status < 400) {
      const location = r.headers.get("location");
      if (!location) {
        throw new BlockedUrlError(`Редирект ${r.status} без заголовка Location`);
      }
      // Каждый переход проверяем заново: цепочка может увести внутрь сети.
      url = await assertAllowedUrl(new URL(location, url).toString(), opts.allowPrivateNetwork);
      continue;
    }

    response = r;
    break;
  }

  if (!response) {
    throw new BlockedUrlError(`Слишком много редиректов (> ${MAX_REDIRECTS}) для ${raw}`);
  }
  if (!response.ok) {
    throw new Error(`Не удалось скачать ${url.toString()}: HTTP ${response.status}`);
  }

  const declared = Number(response.headers.get("content-length") ?? NaN);
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new Error(`Файл больше допустимых ${maxBytes} байт (заявлено ${declared})`);
  }

  const bytes = await readCapped(response, maxBytes);
  const cleanPath = url.pathname.split("/").pop() || "";
  return { bytes, filename: decodeURIComponent(cleanPath) || "upload" };
}

async function readCapped(response: Response, maxBytes: number): Promise<Uint8Array> {
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array(await response.arrayBuffer());

  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error(`Файл больше допустимых ${maxBytes} байт`);
    }
    chunks.push(value);
  }

  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}
