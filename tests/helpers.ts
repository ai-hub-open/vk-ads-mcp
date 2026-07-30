// Общие помощники тестов: мок fetch и изоляция кэшей.

import { TokenStore } from "../src/tokenStore.ts";
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
}

/** Вызывать в afterEach. */
export function teardownTestEnv(): void {
  globalThis.fetch = originalFetch;
}
