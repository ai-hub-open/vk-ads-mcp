// Тесты MCP-сервера: JSON-RPC методы, реестр инструментов, формат ошибок.

import { afterEach, beforeEach, expect, test } from "bun:test";

import { VKAdsClient } from "../src/client.ts";
import { McpServer, PROTOCOL_VERSION, deepNormalize } from "../src/server.ts";
import { json, mockFetch, setupTestEnv, teardownTestEnv } from "./helpers.ts";

beforeEach(setupTestEnv);
afterEach(teardownTestEnv);

function makeServer(): McpServer {
  return new McpServer(new VKAdsClient({ accessToken: "test-token" }));
}

test("initialize возвращает версию протокола и имя сервера", async () => {
  const resp: any = await makeServer().handle({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
  });
  expect(resp.result.protocolVersion).toBe(PROTOCOL_VERSION);
  expect(resp.result.serverInfo.name).toBe("vk-ads-mcp");
  expect(resp.result.capabilities.tools).toEqual({ listChanged: false });
});

test("tools/list: 48 инструментов, все с префиксом vk_ads_ и валидными схемами", async () => {
  const resp: any = await makeServer().handle({ id: 1, method: "tools/list" });
  const tools = resp.result.tools;

  expect(tools.length).toBe(48);

  const names = tools.map((t: any) => t.name);
  expect(new Set(names).size).toBe(48);

  for (const t of tools) {
    expect(t.name.startsWith("vk_ads_")).toBe(true);
    expect(t.description.length).toBeGreaterThan(10);
    expect((t.inputSchema as any).type).toBe("object");
  }
});

test("notifications/initialized → null (нотификация без ответа)", async () => {
  const resp = await makeServer().handle({ method: "notifications/initialized" });
  expect(resp).toBeNull();
});

test("ping → пустой результат", async () => {
  const resp: any = await makeServer().handle({ id: 7, method: "ping" });
  expect(resp).toEqual({ jsonrpc: "2.0", id: 7, result: {} });
});

test("неизвестный метод → -32601", async () => {
  const resp: any = await makeServer().handle({ id: 2, method: "bogus/method" });
  expect(resp.error.code).toBe(-32601);
});

test("tools/call с неизвестным инструментом → isError", async () => {
  const resp: any = await makeServer().handle({
    id: 3,
    method: "tools/call",
    params: { name: "nope", arguments: {} },
  });
  expect(resp.result.isError).toBe(true);
  expect(resp.result.content[0].text).toContain("не найден");
});

test("tools/call без клиента → isError с подсказкой про заголовки", async () => {
  const server = new McpServer(undefined);
  const resp: any = await server.handle({
    id: 4,
    method: "tools/call",
    params: { name: "vk_ads_auth_check", arguments: {} },
  });
  expect(resp.result.isError).toBe(true);
  expect(resp.result.content[0].text).toContain("X-VK-Ads-Token");
  expect(resp.result.content[0].text).toContain("X-Click-Ru-Token");
});

test("tools/call успех: результат сериализуется в text-контент", async () => {
  mockFetch(() => json({ id: 1, name: "Test" }));
  const resp: any = await makeServer().handle({
    id: 5,
    method: "tools/call",
    params: { name: "vk_ads_auth_check", arguments: {} },
  });
  expect(resp.result.isError).toBeUndefined();
  const parsed = JSON.parse(resp.result.content[0].text);
  expect(parsed).toEqual({ ok: true, user: { id: 1, name: "Test" } });
});

test("tools/call: ошибка VK Ads API → структурированный isError-ответ", async () => {
  mockFetch(() => json({ error: "bad token" }, 401));
  const resp: any = await makeServer().handle({
    id: 6,
    method: "tools/call",
    params: { name: "vk_ads_auth_check", arguments: {} },
  });
  expect(resp.result.isError).toBe(true);
  const parsed = JSON.parse(resp.result.content[0].text);
  expect(parsed).toEqual({
    error: true,
    status: 401,
    url: "/api/v2/user.json",
    detail: { error: "bad token" },
  });
});

test("tools/call принимает arguments строкой JSON", async () => {
  mockFetch(() => json({ items: [] }));
  const resp: any = await makeServer().handle({
    id: 8,
    method: "tools/call",
    params: { name: "vk_ads_campaigns_list", arguments: '{"limit": 3}' },
  });
  expect(resp.result.isError).toBeUndefined();
});

test("deepNormalize парсит вложенные JSON-строки", () => {
  expect(deepNormalize('{"a": 1}')).toEqual({ a: 1 });
  expect(deepNormalize({ x: "[1,2]", y: "обычная строка" })).toEqual({
    x: [1, 2],
    y: "обычная строка",
  });
  expect(deepNormalize("42")).toBe("42"); // скаляры-строки не трогаем
});
