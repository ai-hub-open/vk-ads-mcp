// Тесты HTTP-транспорта: авторизация шлюза, разбор кред из заголовков,
// эндпоинты и поведение при отсутствии клиента по умолчанию.

import { afterEach, beforeEach, expect, test } from "bun:test";

import { VKAdsClient } from "../src/client.ts";
import { McpServer } from "../src/server.ts";
import { buildClientFromHeaders, checkAuth, runHttp } from "../src/transports/http.ts";
import { json, mockFetch, setupTestEnv, teardownTestEnv, testStore } from "./helpers.ts";

beforeEach(setupTestEnv);
afterEach(teardownTestEnv);

function request(headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/mcp", { method: "POST", headers });
}

// --- checkAuth ----------------------------------------------------------------

test("checkAuth без заданного токена пропускает всех", () => {
  expect(checkAuth(request(), undefined)).toBe(true);
  expect(checkAuth(request({ Authorization: "Bearer whatever" }), undefined)).toBe(true);
});

test("checkAuth принимает точный токен и отвергает остальные", () => {
  const secret = "pravilnyi-token";
  expect(checkAuth(request({ Authorization: `Bearer ${secret}` }), secret)).toBe(true);
  expect(checkAuth(request({ Authorization: "Bearer nepravilnyi" }), secret)).toBe(false);
  expect(checkAuth(request(), secret)).toBe(false);
});

test("checkAuth отвергает токен-префикс и токен с лишним хвостом", () => {
  const secret = "secret-1234";
  expect(checkAuth(request({ Authorization: "Bearer secret-123" }), secret)).toBe(false);
  expect(checkAuth(request({ Authorization: "Bearer secret-12345" }), secret)).toBe(false);
});

test("checkAuth: схема Bearer обязательна, регистр не важен", () => {
  const secret = "s3cret";
  expect(checkAuth(request({ Authorization: `bearer ${secret}` }), secret)).toBe(true);
  expect(checkAuth(request({ Authorization: secret }), secret)).toBe(false);
  expect(checkAuth(request({ Authorization: `Basic ${secret}` }), secret)).toBe(false);
});

// --- buildClientFromHeaders ---------------------------------------------------

test("без cred-заголовков клиент не создаётся (используется default из .env)", () => {
  expect(buildClientFromHeaders(request())).toBeUndefined();
  expect(buildClientFromHeaders(request({ "Content-Type": "application/json" }))).toBeUndefined();
});

test("готовый токен из заголовка даёт клиент", () => {
  const c = buildClientFromHeaders(request({ "X-VK-Ads-Token": "eyJ0" }));
  expect(c).toBeInstanceOf(VKAdsClient);
});

test("клиент из заголовков не читает файлы и не ходит во внутреннюю сеть", () => {
  const c = buildClientFromHeaders(request({ "X-VK-Ads-Token": "eyJ0" }))!;
  expect(c.allowLocalFiles).toBe(false);
  expect(c.allowPrivateNetwork).toBe(false);
});

test("Click.ru-заголовки собирают клиент, частичные — бросают ошибку", () => {
  const ok = buildClientFromHeaders(
    request({ "X-Click-Ru-Token": "t", "X-Click-Ru-Account-Id": "652819" })
  );
  expect(ok?.hasClickRu).toBe(true);

  expect(() => buildClientFromHeaders(request({ "X-Click-Ru-Token": "t" }))).toThrow(/вместе/);
  expect(() => buildClientFromHeaders(request({ "X-Click-Ru-Account-Id": "1" }))).toThrow(
    /вместе/
  );
});

test("OAuth-заголовки собирают клиент, частичные — бросают ошибку", () => {
  const ok = buildClientFromHeaders(
    request({ "X-VK-Ads-Client-Id": "cid", "X-VK-Ads-Client-Secret": "sec" })
  );
  expect(ok?.hasClientCredentials).toBe(true);

  expect(() => buildClientFromHeaders(request({ "X-VK-Ads-Client-Id": "cid" }))).toThrow(
    /вместе/
  );
});

test("X-VK-Ads-Base-Url переопределяет базу API", () => {
  const c = buildClientFromHeaders(
    request({ "X-VK-Ads-Token": "t", "X-VK-Ads-Base-Url": "https://staging.example.com" })
  )!;
  expect(c.baseUrl).toBe("https://staging.example.com");
});

// --- Сквозные проверки через реальный сервер ----------------------------------

async function withServer(
  opts: { authToken?: string; defaultClient?: VKAdsClient },
  fn: (base: string) => Promise<void>
): Promise<void> {
  const server = runHttp(new McpServer(opts.defaultClient), {
    port: 0,
    host: "127.0.0.1",
    authToken: opts.authToken,
  });
  try {
    await fn(`http://127.0.0.1:${server.port}`);
  } finally {
    server.stop(true);
  }
}

/** Настоящий fetch — мок подменяет глобальный, а он нужен для запросов к серверу. */
const realFetch = globalThis.fetch;

function rpc(base: string, body: unknown, headers: Record<string, string> = {}) {
  return realFetch(`${base}/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

test("healthz отвечает 200 без авторизации", async () => {
  await withServer({ authToken: "gateway-secret" }, async (base) => {
    const r = await realFetch(`${base}/healthz`);
    expect(r.status).toBe(200);
    expect(await r.text()).toBe("OK");
  });
});

test("/mcp без Bearer при заданном MCP_AUTH_TOKEN → 401", async () => {
  await withServer({ authToken: "gateway-secret" }, async (base) => {
    const r = await rpc(base, { jsonrpc: "2.0", id: 1, method: "tools/list" });
    expect(r.status).toBe(401);
  });
});

test("/mcp с верным Bearer отдаёт список инструментов", async () => {
  await withServer({ authToken: "gateway-secret" }, async (base) => {
    const r = await rpc(
      base,
      { jsonrpc: "2.0", id: 1, method: "tools/list" },
      { Authorization: "Bearer gateway-secret" }
    );
    const body: any = await r.json();
    expect(body.result.tools.length).toBeGreaterThan(40);
  });
});

test("tools/call без кред подсказывает про заголовки", async () => {
  await withServer({}, async (base) => {
    const r = await rpc(base, {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "vk_ads_auth_check", arguments: {} },
    });
    const body: any = await r.json();
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0].text).toContain("X-VK-Ads-Token");
  });
});

test("частичные cred-заголовки → JSON-RPC ошибка -32602", async () => {
  await withServer({}, async (base) => {
    const r = await rpc(
      base,
      { jsonrpc: "2.0", id: 1, method: "tools/list" },
      { "X-Click-Ru-Token": "only-token" }
    );
    const body: any = await r.json();
    expect(body.error.code).toBe(-32602);
    expect(body.error.message).toContain("вместе");
  });
});

test("клиент из заголовков перекрывает default сервера", async () => {
  mockFetch(() => json({ id: 777 }));
  const fallback = new VKAdsClient({ accessToken: "default", tokenStore: testStore });

  await withServer({ defaultClient: fallback }, async (base) => {
    const r = await rpc(
      base,
      {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "vk_ads_auth_check", arguments: {} },
      },
      { "X-VK-Ads-Token": "tenant-token" }
    );
    const body: any = await r.json();
    expect(JSON.parse(body.result.content[0].text).ok).toBe(true);
  });

  // Проверяем, что к VK ушёл именно токен из заголовка, а не дефолтный.
  const { calls } = await import("./helpers.ts");
  expect(calls.at(-1)!.init.headers!["Authorization"]).toBe("Bearer tenant-token");
});

test("батч-запрос возвращает массив ответов", async () => {
  await withServer({}, async (base) => {
    const r = await rpc(base, [
      { jsonrpc: "2.0", id: 1, method: "ping" },
      { jsonrpc: "2.0", id: 2, method: "ping" },
    ]);
    const body: any = await r.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(2);
  });
});

test("нотификация без id → 204 без тела", async () => {
  await withServer({}, async (base) => {
    const r = await rpc(base, { jsonrpc: "2.0", method: "notifications/initialized" });
    expect(r.status).toBe(204);
  });
});

test("битый JSON → -32700", async () => {
  await withServer({}, async (base) => {
    const r = await realFetch(`${base}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{не json",
    });
    const body: any = await r.json();
    expect(body.error.code).toBe(-32700);
  });
});

test("неизвестный путь → 404, GET /mcp → 405", async () => {
  await withServer({}, async (base) => {
    expect((await realFetch(`${base}/nope`)).status).toBe(404);
    expect((await realFetch(`${base}/mcp`)).status).toBe(405);
  });
});

test("CORS preflight отвечает 204 с разрешёнными заголовками", async () => {
  await withServer({}, async (base) => {
    const r = await realFetch(`${base}/mcp`, { method: "OPTIONS" });
    expect(r.status).toBe(204);
    const allowed = r.headers.get("Access-Control-Allow-Headers") ?? "";
    expect(allowed).toContain("X-VK-Ads-Token");
    expect(allowed).toContain("X-Click-Ru-Account-Id");
  });
});
