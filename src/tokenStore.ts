// Хранилище access-токенов VK Ads: память + опционально диск.
//
// Ключ кэша формирует вызывающий (см. VKAdsClient.cacheKey) и обязан включать
// отпечаток секрета — иначе в multi-tenant режиме клиент, знающий только
// публичный идентификатор (client_id, Click.ru accountId), получил бы чужой
// токен. Хранилище само по себе ключи не проверяет.

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

/** Запас до истечения: токен, которому осталось меньше, считаем протухшим. */
const EXPIRY_MARGIN_SEC = 60;

/** Потолок записей в памяти — чтобы поток арендаторов не выедал память. */
const DEFAULT_MAX_ENTRIES = 500;

interface CachedToken {
  access_token: string;
  expires_at: number; // unix-секунды
}

export interface TokenStoreOptions {
  /** Каталог дискового кэша. `null` — только память (тесты, эфемерные среды). */
  dir?: string | null;
  maxEntries?: number;
}

function nowSec(): number {
  return Date.now() / 1000;
}

function isFresh(t: CachedToken): boolean {
  return t.expires_at - EXPIRY_MARGIN_SEC > nowSec();
}

/** Каталог кэша по умолчанию: $XDG_CACHE_HOME/vk-ads-mcp или ~/.cache/vk-ads-mcp. */
export function defaultCacheDir(): string {
  const root = process.env.XDG_CACHE_HOME || join(homedir(), ".cache");
  return join(root, "vk-ads-mcp");
}

export class TokenStore {
  private readonly memory = new Map<string, CachedToken>();
  private readonly maxEntries: number;
  /** `undefined` — каталог берётся из окружения при каждом обращении. */
  private readonly dirOverride: string | null | undefined;

  constructor(opts: TokenStoreOptions = {}) {
    this.dirOverride = opts.dir;
    this.maxEntries = opts.maxEntries ?? DEFAULT_MAX_ENTRIES;
  }

  /** Каталог диска или null, если дисковый кэш отключён. */
  private get dir(): string | null {
    if (this.dirOverride !== undefined) return this.dirOverride;
    return defaultCacheDir();
  }

  private filePath(key: string): string | null {
    const dir = this.dir;
    if (!dir) return null;
    const hash = createHash("sha256").update(key).digest("hex").slice(0, 32);
    return join(dir, `token-${hash}.json`);
  }

  /** Живой токен для ключа или null. */
  get(key: string): string | null {
    const mem = this.memory.get(key);
    if (mem) {
      if (isFresh(mem)) return mem.access_token;
      this.memory.delete(key);
    }

    const path = this.filePath(key);
    if (!path || !existsSync(path)) return null;
    try {
      const data = JSON.parse(readFileSync(path, "utf8")) as CachedToken;
      if (data?.access_token && isFresh(data)) {
        this.memory.set(key, data);
        return data.access_token;
      }
      // Протухшую запись сразу убираем с диска, чтобы каталог не рос.
      this.removeFile(path);
    } catch {
      // Повреждённый файл кэша — не мешает работе, просто удаляем.
      this.removeFile(path);
    }
    return null;
  }

  set(key: string, token: string, expiresInSec: number): void {
    const entry: CachedToken = {
      access_token: token,
      expires_at: nowSec() + expiresInSec,
    };
    this.memory.set(key, entry);
    this.evict();

    const path = this.filePath(key);
    if (!path) return;
    try {
      mkdirSync(this.dir!, { recursive: true });
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

  delete(key: string): void {
    this.memory.delete(key);
    const path = this.filePath(key);
    if (path) this.removeFile(path);
  }

  /** Полная очистка памяти (диск не трогаем) — используется в тестах. */
  clearMemory(): void {
    this.memory.clear();
  }

  /** Число записей в памяти — для тестов и диагностики. */
  get size(): number {
    return this.memory.size;
  }

  /** Убирает протухшее, а при переполнении — записи с ближайшим истечением. */
  private evict(): void {
    for (const [k, v] of this.memory) {
      if (!isFresh(v)) this.memory.delete(k);
    }
    if (this.memory.size <= this.maxEntries) return;

    const byExpiry = [...this.memory.entries()].sort(
      (a, b) => a[1].expires_at - b[1].expires_at
    );
    for (const [k] of byExpiry.slice(0, this.memory.size - this.maxEntries)) {
      this.memory.delete(k);
    }
  }

  private removeFile(path: string): void {
    try {
      if (existsSync(path)) unlinkSync(path);
    } catch {
      // не критично
    }
  }
}

/** Хранилище по умолчанию для клиентов, которым его не передали явно. */
export const defaultTokenStore = new TokenStore();
