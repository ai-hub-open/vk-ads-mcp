// Тесты HTTP-транспорта: авторизация шлюза, разбор кред из заголовков,
// эндпоинты и поведение при отсутствии клиента по умолчанию.

import { afterEach, beforeEach, expect, test } from "bun:test";

import { VKAdsClient } from "../src/client.ts";
import { McpServer } from "../src/server.ts";
import {
  buildClientFromHeaders,
  checkAuth,
  extractPathCredentials,
  runHttp,
} from "../src/transports/http.ts";
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
  opts: { authToken?: string; defaultClient?: VKAdsClient; allowUrlCredentials?: boolean },
  fn: (base: string) => Promise<void>
): Promise<void> {
  const server = runHttp(new McpServer(opts.defaultClient), {
    port: 0,
    host: "127.0.0.1",
    authToken: opts.authToken,
    allowUrlCredentials: opts.allowUrlCredentials,
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

// --- Токен VK Ads в пути URL (для клиентов без поддержки заголовков) ----------

test("extractPathCredentials разбирает все три формы и остаток пути", () => {
  expect(extractPathCredentials("/t/abc123")).toEqual({
    kind: "token",
    values: ["abc123"],
    rest: "/",
  });
  expect(extractPathCredentials("/t/abc123/")).toEqual({
    kind: "token",
    values: ["abc123"],
    rest: "/",
  });
  expect(extractPathCredentials("/t/abc123/mcp/tools")).toEqual({
    kind: "token",
    values: ["abc123"],
    rest: "/mcp/tools",
  });
  expect(extractPathCredentials("/o/cid/sec")).toEqual({
    kind: "oauth",
    values: ["cid", "sec"],
    rest: "/",
  });
  expect(extractPathCredentials("/o/cid/sec/mcp")).toEqual({
    kind: "oauth",
    values: ["cid", "sec"],
    rest: "/mcp",
  });
  expect(extractPathCredentials("/c/cr-token/652819")).toEqual({
    kind: "clickru",
    values: ["cr-token", "652819"],
    rest: "/",
  });
  expect(extractPathCredentials("/t/a%2Bb%3Dc")).toEqual({
    kind: "token",
    values: ["a+b=c"],
    rest: "/",
  });

  // Недостаточно сегментов или неизвестная форма
  expect(extractPathCredentials("/mcp")).toBeNull();
  expect(extractPathCredentials("/t/")).toBeNull();
  expect(extractPathCredentials("/o/only-id")).toBeNull();
  expect(extractPathCredentials("/c/only-token")).toBeNull();
  expect(extractPathCredentials("/healthz")).toBeNull();
});

test("выключенный по умолчанию /t/<токен> отвечает 404", async () => {
  await withServer({}, async (base) => {
    const r = await rpc(`${base}/t/some-token`, { jsonrpc: "2.0", id: 1, method: "ping" });
    expect(r.status).toBe(404);
  });
});

test("включённый /t/<токен> работает как MCP-эндпоинт без токена шлюза", async () => {
  await withServer({ allowUrlCredentials: true, authToken: "gateway-secret" }, async (base) => {
    const r = await rpc(`${base}/t/vk-token-123`, {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
    });
    const body: any = await r.json();
    expect(body.result.tools.length).toBeGreaterThan(40);
  });
});

test("токен из пути уходит в VK Ads как Bearer", async () => {
  mockFetch(() => json({ id: 555 }));

  await withServer({ allowUrlCredentials: true }, async (base) => {
    const r = await rpc(`${base}/t/token-iz-puti`, {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "vk_ads_auth_check", arguments: {} },
    });
    const body: any = await r.json();
    expect(JSON.parse(body.result.content[0].text).user).toEqual({ id: 555 });
  });

  const { calls } = await import("./helpers.ts");
  expect(calls.at(-1)!.init.headers!["Authorization"]).toBe("Bearer token-iz-puti");
});

test("клиент из пути не читает файлы и не ходит во внутреннюю сеть", async () => {
  await withServer({ allowUrlCredentials: true }, async (base) => {
    const r = await rpc(`${base}/t/vk-token`, {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "vk_ads_content_upload_image",
        arguments: { source_path_or_url: "/app/.env" },
      },
    });
    const body: any = await r.json();
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0].text).toContain("Чтение локальных файлов отключено");
  });
});

test("заголовки имеют приоритет над токеном из пути", async () => {
  mockFetch(() => json({ id: 1 }));

  await withServer({ allowUrlCredentials: true }, async (base) => {
    await rpc(
      `${base}/t/token-iz-puti`,
      {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "vk_ads_auth_check", arguments: {} },
      },
      { "X-VK-Ads-Token": "token-iz-zagolovka" }
    );
  });

  const { calls } = await import("./helpers.ts");
  expect(calls.at(-1)!.init.headers!["Authorization"]).toBe("Bearer token-iz-zagolovka");
});

test("обычный /mcp продолжает требовать токен шлюза", async () => {
  await withServer({ allowUrlCredentials: true, authToken: "gateway-secret" }, async (base) => {
    const r = await rpc(base, { jsonrpc: "2.0", id: 1, method: "tools/list" });
    expect(r.status).toBe(401);
  });
});

test("/o/<client_id>/<client_secret>: сервер сам выпускает токен VK", async () => {
  let issued = 0;
  mockFetch((url) => {
    if (url.includes("oauth2/token.json")) {
      issued++;
      return json({ access_token: "vypushchennyi", expires_in: 3600 });
    }
    return json({ id: 42 });
  });

  await withServer({ allowUrlCredentials: true }, async (base) => {
    const r = await rpc(`${base}/o/moi-client-id/moi-secret`, {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "vk_ads_auth_check", arguments: {} },
    });
    const body: any = await r.json();
    expect(JSON.parse(body.result.content[0].text).user).toEqual({ id: 42 });
  });

  const { calls } = await import("./helpers.ts");
  expect(issued).toBe(1);
  const tokenCall = calls.find((c) => c.url.includes("oauth2/token.json"))!;
  const form = new URLSearchParams(String(tokenCall.init.body));
  expect(form.get("grant_type")).toBe("client_credentials");
  expect(form.get("client_id")).toBe("moi-client-id");
  expect(form.get("client_secret")).toBe("moi-secret");
  expect(calls.at(-1)!.init.headers!["Authorization"]).toBe("Bearer vypushchennyi");
});

test("/c/<токен>/<аккаунт>: токен VK берётся у click.ru", async () => {
  mockFetch((url) =>
    url.includes("api.click.ru")
      ? json({ response: { access_token: "vk-cherez-clickru" } })
      : json({ id: 7 })
  );

  await withServer({ allowUrlCredentials: true }, async (base) => {
    const r = await rpc(`${base}/c/cr-token/652819`, {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "vk_ads_auth_check", arguments: {} },
    });
    const body: any = await r.json();
    expect(JSON.parse(body.result.content[0].text).user).toEqual({ id: 7 });
  });

  const { calls } = await import("./helpers.ts");
  const crCall = calls.find((c) => c.url.includes("api.click.ru"))!;
  expect(crCall.url).toContain("/accounts/652819/access_token/vk_ads/");
  expect(crCall.init.headers!["X-Auth-Token"]).toBe("cr-token");
  expect(calls.at(-1)!.init.headers!["Authorization"]).toBe("Bearer vk-cherez-clickru");
});

test("неполные данные доступа в URL не считаются формой → 404", async () => {
  await withServer({ allowUrlCredentials: true }, async (base) => {
    // Обращаемся напрямую, без добавления /mcp: иначе недостающий сегмент
    // занял бы его место и путь стал бы валидной формой.
    for (const path of ["/o/tolko-id", "/c/tolko-token", "/t/"]) {
      const r = await realFetch(`${base}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
      });
      expect(r.status).toBe(404);
    }
  });
});

test("все формы в URL ограничены как размещённый режим", async () => {
  for (const path of ["/t/tok", "/o/cid/sec", "/c/cr/1"]) {
    await withServer({ allowUrlCredentials: true }, async (base) => {
      const r = await rpc(`${base}${path}`, {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "vk_ads_content_upload_image",
          arguments: { source_path_or_url: "/app/.env" },
        },
      });
      const body: any = await r.json();
      expect(body.result.isError).toBe(true);
      expect(body.result.content[0].text).toContain("Чтение локальных файлов отключено");
    });
  }
});
