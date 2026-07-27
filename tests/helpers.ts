// Общие помощники тестов: мок fetch и изоляция кэша токенов.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { clearTokenMemoryCache } from "../src/client.ts";
import { clearRegionsCache } from "../src/tools/dictionaries.ts";

export interface FetchCall {
  url: string;
  init: RequestInit & { headers?: Record<string, string> };
}

export const calls: FetchCall[] = [];

const originalFetch = globalThis.fetch;
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

/** Вызывать в beforeEach: чистые счётчики, чистые кэши, изолированный XDG_CACHE_HOME. */
export function setupTestEnv(): void {
  calls.length = 0;
  clearTokenMemoryCache();
  clearRegionsCache();
  savedXdg = process.env.XDG_CACHE_HOME;
  cacheDir = mkdtempSync(join(tmpdir(), "vk-ads-mcp-test-"));
  process.env.XDG_CACHE_HOME = cacheDir;
}

/** Вызывать в afterEach. */
export function teardownTestEnv(): void {
  globalThis.fetch = originalFetch;
  if (savedXdg === undefined) delete process.env.XDG_CACHE_HOME;
  else process.env.XDG_CACHE_HOME = savedXdg;
  if (cacheDir) {
    try {
      rmSync(cacheDir, { recursive: true, force: true });
    } catch {
      // Windows иногда держит файлы — не критично для тестов
    }
    cacheDir = null;
  }
}
