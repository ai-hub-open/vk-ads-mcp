// HTTP-клиент для VK Ads API (ads.vk.com, бывший myTarget API v2).
//
// Поддерживает три источника access_token:
//   A. Готовый токен (VK_ADS_ACCESS_TOKEN) — используется как есть.
//   B. OAuth 2.0 Client Credentials — сервер сам получает и обновляет токен:
//      POST /api/v2/oauth2/token.json, grant_type=client_credentials
//      (или agency_client_credentials, если задан agencyClientName).
//   C. Click.ru — токен VK Ads выдаёт Click.ru по своему API-токену:
//      GET {CLICK_RU_BASE_URL}/accounts/{accountId}/access_token/vk_ads/
//
// Полученные (не статические) токены кэшируются в памяти процесса и на диске
// (~/.cache/vk-ads-mcp, формат совместим с python-версией vk-ads-mcp).
// При 401 токен сбрасывается и запрашивается заново, запрос повторяется один раз.

import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const DEFAULT_BASE_URL = "https://ads.vk.com";
export const CLICK_RU_DEFAULT_BASE = "https://api.click.ru/V0";

// --- Ошибка API ---------------------------------------------------------------

export class VKAdsError extends Error {
  readonly status: number;
  readonly payload: unknown;
  readonly url: string;

  constructor(status: number, payload: unknown, url: string) {
    const detail = typeof payload === "string" ? payload : JSON.stringify(payload);
    super(`VK Ads API ${status} at ${url}: ${detail}`);
    this.name = "VKAdsError";
    this.status = status;
    this.payload = payload;
    this.url = url;
  }
}

// --- Кэш токенов ----------------------------------------------------------------
// Память процесса + диск. Дисковый формат и путь совместимы с python-версией:
// $XDG_CACHE_HOME/vk-ads-mcp/token-<sha256(key)[:16]>.json → {access_token, expires_at}.

interface CachedToken {
  access_token: string;
  expires_at: number; // unix-секунды
}

const memoryTokenCache = new Map<string, CachedToken>();

/** Сбрасывает in-memory кэш токенов (для тестов). */
export function clearTokenMemoryCache(): void {
  memoryTokenCache.clear();
}

function cacheDir(): string {
  const root = process.env.XDG_CACHE_HOME || join(homedir(), ".cache");
  return join(root, "vk-ads-mcp");
}

function tokenCachePath(cacheKey: string): string {
  const hash = createHash("sha256").update(cacheKey).digest("hex").slice(0, 16);
  return join(cacheDir(), `token-${hash}.json`);
}

/** Токен ещё живой (с запасом 60 секунд до истечения). */
function isFresh(t: CachedToken): boolean {
  return t.expires_at - 60 > Date.now() / 1000;
}

function loadCachedToken(cacheKey: string): CachedToken | null {
  const mem = memoryTokenCache.get(cacheKey);
  if (mem && isFresh(mem)) return mem;

  const path = tokenCachePath(cacheKey);
  if (!existsSync(path)) return null;
  try {
    const data = JSON.parse(readFileSync(path, "utf8")) as CachedToken;
    if (data.access_token && isFresh(data)) {
      memoryTokenCache.set(cacheKey, data);
      return data;
    }
  } catch {
    // повреждённый кэш — игнорируем
  }
  return null;
}

function saveCachedToken(cacheKey: string, token: string, expiresIn: number): void {
  const entry: CachedToken = {
    access_token: token,
    expires_at: Date.now() / 1000 + expiresIn,
  };
  memoryTokenCache.set(cacheKey, entry);
  try {
    mkdirSync(cacheDir(), { recursive: true });
    const path = tokenCachePath(cacheKey);
    writeFileSync(path, JSON.stringify(entry));
    try {
      chmodSync(path, 0o600);
    } catch {
      // Windows — chmod не поддерживается, не критично
    }
  } catch (e) {
    process.stderr.write(
      `Warning: не удалось сохранить кэш токена: ${(e as Error).message}\n`
    );
  }
}

function clearCachedToken(cacheKey: string): void {
  memoryTokenCache.delete(cacheKey);
  try {
    const path = tokenCachePath(cacheKey);
    if (existsSync(path)) unlinkSync(path);
  } catch {
    // не критично
  }
}

// --- Клиент ---------------------------------------------------------------------

export interface ClientOptions {
  /** База VK Ads API (по умолчанию https://ads.vk.com) */
  baseUrl?: string;
  /** Вариант A: готовый access_token */
  accessToken?: string;
  /** Вариант B: OAuth 2.0 client credentials */
  clientId?: string;
  clientSecret?: string;
  /** Вариант C (дополняет B): агентство от имени клиента — grant_type=agency_client_credentials */
  agencyClientName?: string;
  /** Вариант D: Click.ru как источник токена VK Ads */
  clickRuToken?: string;
  clickRuAccountId?: string;
  clickRuUserId?: string;
  clickRuBaseUrl?: string;
  /** Таймаут HTTP-запросов в секундах (по умолчанию 30) */
  timeout?: number;
}

interface RequestOptions {
  params?: Record<string, unknown>;
  body?: unknown;
  formData?: FormData;
}

export class VKAdsClient {
  readonly baseUrl: string;
  readonly timeoutMs: number;

  private readonly staticToken?: string;
  private readonly clientId?: string;
  private readonly clientSecret?: string;
  private readonly agencyClientName?: string;
  private readonly clickRuToken?: string;
  private readonly clickRuAccountId?: string;
  private readonly clickRuUserId?: string;
  private readonly clickRuBaseUrl: string;

  private token?: string;

  constructor(opts: ClientOptions) {
    this.baseUrl = (opts.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.timeoutMs = Math.round((opts.timeout ?? 30) * 1000);
    this.staticToken = opts.accessToken || undefined;
    this.clientId = opts.clientId || undefined;
    this.clientSecret = opts.clientSecret || undefined;
    this.agencyClientName = opts.agencyClientName || undefined;
    this.clickRuToken = opts.clickRuToken || undefined;
    this.clickRuAccountId = opts.clickRuAccountId || undefined;
    this.clickRuUserId = opts.clickRuUserId || undefined;
    this.clickRuBaseUrl = (opts.clickRuBaseUrl || CLICK_RU_DEFAULT_BASE).replace(/\/+$/, "");

    if ((this.clientId && !this.clientSecret) || (!this.clientId && this.clientSecret)) {
      throw new Error("VK_ADS_CLIENT_ID и VK_ADS_CLIENT_SECRET задаются только вместе");
    }
    if ((this.clickRuToken && !this.clickRuAccountId) || (!this.clickRuToken && this.clickRuAccountId)) {
      throw new Error("CLICK_RU_TOKEN и CLICK_RU_ACCOUNT_ID задаются только вместе");
    }
    if (!this.staticToken && !this.hasClientCredentials && !this.hasClickRu) {
      throw new Error(
        "Нужен источник токена VK Ads: VK_ADS_ACCESS_TOKEN, " +
          "VK_ADS_CLIENT_ID + VK_ADS_CLIENT_SECRET или CLICK_RU_TOKEN + CLICK_RU_ACCOUNT_ID"
      );
    }

    this.token = this.staticToken;

    // Дисковый кэш — только для получаемых токенов; статический используем как есть.
    if (!this.token) {
      const key = this.cacheKey();
      if (key) {
        const cached = loadCachedToken(key);
        if (cached) this.token = cached.access_token;
      }
    }
  }

  get hasClientCredentials(): boolean {
    return !!(this.clientId && this.clientSecret);
  }

  get hasClickRu(): boolean {
    return !!(this.clickRuToken && this.clickRuAccountId);
  }

  /** Токен можно перезапросить (есть OAuth-креды или Click.ru). */
  private get canRefreshToken(): boolean {
    return this.hasClientCredentials || this.hasClickRu;
  }

  /** Ключ дискового/in-memory кэша токенов для текущего источника. */
  private cacheKey(): string | undefined {
    if (this.hasClientCredentials) {
      // Базовая часть побайтово совместима с python-версией.
      const base = `${this.clientId}|${this.baseUrl}`;
      return this.agencyClientName ? `${base}|${this.agencyClientName}` : base;
    }
    if (this.hasClickRu) {
      return `clickru|${this.clickRuAccountId}|${this.clickRuBaseUrl}`;
    }
    return undefined;
  }

  /** Возвращает действующий токен, при необходимости получая его. */
  async ensureToken(): Promise<string> {
    if (this.token) return this.token;

    const key = this.cacheKey();
    if (key) {
      const cached = loadCachedToken(key);
      if (cached) {
        this.token = cached.access_token;
        return this.token;
      }
    }

    if (this.hasClientCredentials) return this.fetchOAuthToken();
    if (this.hasClickRu) return this.fetchClickRuToken();

    throw new VKAdsError(
      401,
      "Нет VK_ADS_ACCESS_TOKEN и нет кред для его получения " +
        "(VK_ADS_CLIENT_ID/SECRET или CLICK_RU_TOKEN/ACCOUNT_ID).",
      "/api/v2/oauth2/token.json"
    );
  }

  /** Сбрасывает текущий токен и его кэш (память + диск). */
  invalidateToken(): void {
    this.token = undefined;
    const key = this.cacheKey();
    if (key) clearCachedToken(key);
  }

  private async fetchOAuthToken(): Promise<string> {
    const path = "/api/v2/oauth2/token.json";
    const form = new URLSearchParams({
      grant_type: this.agencyClientName ? "agency_client_credentials" : "client_credentials",
      client_id: this.clientId!,
      client_secret: this.clientSecret!,
    });
    if (this.agencyClientName) form.set("agency_client_name", this.agencyClientName);

    const r = await this.fetchWithTimeout(this.baseUrl + path, {
      method: "POST",
      body: form,
    });
    const payload = await parseBody(r);
    if (r.status >= 400) throw new VKAdsError(r.status, payload, path);

    const token = (payload as any)?.access_token;
    if (!token) throw new VKAdsError(500, payload, path);

    const expiresIn = Number((payload as any)?.expires_in ?? 86400);
    this.token = token;
    saveCachedToken(this.cacheKey()!, token, expiresIn);
    return token;
  }

  private async fetchClickRuToken(): Promise<string> {
    const path = `/accounts/${encodeURIComponent(this.clickRuAccountId!)}/access_token/vk_ads/`;
    const headers: Record<string, string> = { "X-Auth-Token": this.clickRuToken! };
    if (this.clickRuUserId) headers["X-Auth-UserId"] = this.clickRuUserId;

    const r = await this.fetchWithTimeout(this.clickRuBaseUrl + path, {
      method: "GET",
      headers,
    });
    const payload = await parseBody(r);
    if (r.status >= 400) throw new VKAdsError(r.status, payload, path);

    // Click.ru обычно оборачивает данные в { response: {...} }
    const data = (payload as any)?.response ?? payload;
    const token = data?.access_token;
    if (!token) throw new VKAdsError(500, payload, path);

    const expiresIn = Number(data?.expires_in ?? 86400);
    this.token = token;
    saveCachedToken(this.cacheKey()!, token, expiresIn);
    return token;
  }

  // --- HTTP -----------------------------------------------------------------

  async request(method: string, path: string, opts: RequestOptions = {}): Promise<any> {
    let token = await this.ensureToken();
    let r = await this.doFetch(method, path, token, opts);

    // Токен истёк/отозван — сбрасываем кэш, получаем новый и повторяем один раз.
    if (r.status === 401 && this.canRefreshToken) {
      this.invalidateToken();
      token = await this.ensureToken();
      r = await this.doFetch(method, path, token, opts);
    }

    const payload = await parseBody(r);
    if (r.status >= 400) throw new VKAdsError(r.status, payload, path);
    return payload;
  }

  get(path: string, params?: Record<string, unknown>): Promise<any> {
    return this.request("GET", path, { params });
  }

  post(path: string, body?: unknown, params?: Record<string, unknown>): Promise<any> {
    return this.request("POST", path, { body, params });
  }

  delete(path: string, params?: Record<string, unknown>): Promise<any> {
    return this.request("DELETE", path, { params });
  }

  /** Загрузка файла multipart/form-data (контент: изображения, видео). */
  uploadFile(path: string, filename: string, bytes: Uint8Array): Promise<any> {
    const formData = new FormData();
    formData.append("file", new File([bytes], filename));
    return this.request("POST", path, { formData });
  }

  /**
   * Отзывает активные OAuth-токены для client_id (POST /api/v2/oauth2/token/delete.json).
   * Полезно при token_limit_exceeded (VK разрешает ≤5 активных токенов).
   * Локальные кэши сбрасываются в любом случае.
   */
  async revokeToken(): Promise<{ ok: boolean; status: number }> {
    if (!this.hasClientCredentials) {
      throw new Error(
        "Для отзыва токена нужны VK_ADS_CLIENT_ID + VK_ADS_CLIENT_SECRET"
      );
    }
    const form = new URLSearchParams({
      client_id: this.clientId!,
      client_secret: this.clientSecret!,
      grant_type: "client_credentials",
    });
    try {
      const r = await this.fetchWithTimeout(`${this.baseUrl}/api/v2/oauth2/token/delete.json`, {
        method: "POST",
        body: form,
      });
      return { ok: r.status === 200 || r.status === 204, status: r.status };
    } finally {
      this.invalidateToken();
    }
  }

  private async doFetch(
    method: string,
    path: string,
    token: string,
    opts: RequestOptions
  ): Promise<Response> {
    const url = new URL(this.baseUrl + path);
    for (const [k, v] of Object.entries(opts.params ?? {})) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      "User-Agent": "vk-ads-mcp/1.0",
    };

    let body: FormData | string | undefined;
    if (opts.formData) {
      // Content-Type с boundary выставит fetch
      body = opts.formData;
    } else if (opts.body !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(opts.body);
    }

    return this.fetchWithTimeout(url.toString(), { method, headers, body });
  }

  private fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    return fetch(url, { ...init, signal: AbortSignal.timeout(this.timeoutMs) });
  }
}

/** Тело ответа: JSON, {raw: text} для не-JSON, {} для пустого. */
async function parseBody(r: Response): Promise<any> {
  const text = await r.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}
