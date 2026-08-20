// Общие помощники тестов: мок fetch и изоляция кэшей.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { TokenStore, defaultTokenStore } from "../src/tokenStore.ts";
import { clearRegionsCache } from "../src/tools/dictionaries.ts";

export interface FetchCall {
  url: string;
  init: RequestInit & { headers?: Record<string, string> };
}

export const calls: FetchCall[] = [];

const originalFetch = globalThis.fetch;

/**
 * Хранилище токенов для тестов: только память, без диска. Пересоздаётся в
 * setupTestEnv, поэтому тесты не делят состояние друг с другом.
 */
export let testStore = new TokenStore({ dir: null });

let cacheDir: string | null = null;
let savedXdg: string | undefined;

/** Подменяет globalThis.fetch; все вызовы записываются в `calls`. */
export function mockFetch(
  handler: (url: string, init?: RequestInit) => Response | Promise<Response>
): void {
  globalThis.fetch = (async (input: any, init?: any) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    calls.push({ url, init: init ?? {} });
    return handler(url, init);
  }) as any;
}

export function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Вызывать в beforeEach: чистые счётчики и кэши. */
export function setupTestEnv(): void {
  calls.length = 0;
  testStore = new TokenStore({ dir: null });
  clearRegionsCache();

  // HTTP-транспорт создаёт клиенты сам и пользуется общим хранилищем с диском.
  // Уводим его кэш во временный каталог, иначе тесты писали бы в настоящий
  // ~/.cache пользователя и подхватывали токены из прошлых прогонов.
  savedXdg = process.env.XDG_CACHE_HOME;
  cacheDir = mkdtempSync(join(tmpdir(), "vk-ads-mcp-test-"));
  process.env.XDG_CACHE_HOME = cacheDir;
  defaultTokenStore.clearMemory();
}

/** Вызывать в afterEach. */
export function teardownTestEnv(): void {
  globalThis.fetch = originalFetch;
  defaultTokenStore.clearMemory();

  if (savedXdg === undefined) delete process.env.XDG_CACHE_HOME;
  else process.env.XDG_CACHE_HOME = savedXdg;

  if (cacheDir) {
    try {
      rmSync(cacheDir, { recursive: true, force: true });
    } catch {
      // Windows иногда держит файлы — для теста не критично
    }
    cacheDir = null;
  }
}
