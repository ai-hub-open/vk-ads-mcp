// Тесты VKAdsClient: авторизация, получение/обновление токена, обработка ошибок.
// Портированы с tests/test_client.py python-версии.

import { afterEach, beforeEach, expect, test } from "bun:test";

import { VKAdsClient, VKAdsError, clearTokenMemoryCache } from "../src/client.ts";
import { calls, json, mockFetch, setupTestEnv, teardownTestEnv } from "./helpers.ts";

beforeEach(setupTestEnv);
afterEach(teardownTestEnv);

test("GET отправляет Bearer-токен", async () => {
  mockFetch(() => json({ id: 42 }));
  const c = new VKAdsClient({ accessToken: "t0" });
  const data = await c.get("/api/v2/user.json");

  expect(data).toEqual({ id: 42 });
  expect(calls[0]!.url).toBe("https://ads.vk.com/api/v2/user.json");
  expect(calls[0]!.init.headers!["Authorization"]).toBe("Bearer t0");
});

test("4xx бросает VKAdsError со статусом и телом", async () => {
  mockFetch(() => json({ error: "forbidden" }, 403));
  const c = new VKAdsClient({ accessToken: "t0" });

  try {
    await c.get("/api/v2/campaigns.json");
    expect.unreachable("должен был бросить VKAdsError");
  } catch (e) {
    expect(e).toBeInstanceOf(VKAdsError);
    const err = e as VKAdsError;
    expect(err.status).toBe(403);
    expect(err.payload).toEqual({ error: "forbidden" });
    expect(err.url).toBe("/api/v2/campaigns.json");
  }
});

test("client_credentials: получает токен и использует его", async () => {
  mockFetch((url) => {
    if (url.includes("/oauth2/token.json")) {
      return json({ access_token: "fetched", expires_in: 3600 });
    }
    return json({ ok: true });
  });

  const c = new VKAdsClient({ clientId: "cid", clientSecret: "sec" });
  await c.get("/api/v2/user.json");

  const tokenCall = calls.find((x) => x.url.includes("token.json"))!;
  expect(tokenCall).toBeDefined();
  const form = new URLSearchParams(String(tokenCall.init.body));
  expect(form.get("grant_type")).toBe("client_credentials");
  expect(form.get("client_id")).toBe("cid");
  expect(form.get("client_secret")).toBe("sec");

  const apiCall = calls.find((x) => x.url.includes("user.json"))!;
  expect(apiCall.init.headers!["Authorization"]).toBe("Bearer fetched");
});

test("агентский режим: grant_type=agency_client_credentials", async () => {
  mockFetch((url) => {
    if (url.includes("/oauth2/token.json")) {
      return json({ access_token: "fetched" });
    }
    return json({});
  });

  const c = new VKAdsClient({
    clientId: "cid",
    clientSecret: "sec",
    agencyClientName: "client_login",
  });
  await c.get("/api/v2/user.json");

  const tokenCall = calls.find((x) => x.url.includes("token.json"))!;
  const form = new URLSearchParams(String(tokenCall.init.body));
  expect(form.get("grant_type")).toBe("agency_client_credentials");
  expect(form.get("agency_client_name")).toBe("client_login");
});

test("401 с client credentials: токен сбрасывается, запрос повторяется", async () => {
  let userCalls = 0;
  mockFetch((url) => {
    if (url.includes("/oauth2/token.json")) {
      return json({ access_token: "new", expires_in: 86400 });
    }
    userCalls++;
    if (userCalls === 1) return json({ error: "expired" }, 401);
    return json({ id: 1 });
  });

  const c = new VKAdsClient({ accessToken: "old", clientId: "cid", clientSecret: "sec" });
  const data = await c.get("/api/v2/user.json");

  expect(data).toEqual({ id: 1 });
  expect(userCalls).toBe(2);
  const lastUserCall = calls.filter((x) => x.url.includes("user.json")).at(-1)!;
  expect(lastUserCall.init.headers!["Authorization"]).toBe("Bearer new");
});

test("401 со статическим токеном (без кред): ошибка без повторов", async () => {
  let userCalls = 0;
  mockFetch(() => {
    userCalls++;
    return json({ error: "bad token" }, 401);
  });

  const c = new VKAdsClient({ accessToken: "t0" });
  await expect(c.get("/api/v2/user.json")).rejects.toBeInstanceOf(VKAdsError);
  expect(userCalls).toBe(1);
});

test("Click.ru: токен VK Ads запрашивается у Click.ru с нужными заголовками", async () => {
  mockFetch((url) => {
    if (url.includes("api.click.ru")) {
      return json({ response: { access_token: "vk-token-via-clickru" } });
    }
    return json({ ok: true });
  });

  const c = new VKAdsClient({
    clickRuToken: "cr-token",
    clickRuAccountId: "12345",
    clickRuUserId: "777",
  });
  await c.get("/api/v2/user.json");

  const crCall = calls[0]!;
  expect(crCall.url).toBe("https://api.click.ru/V0/accounts/12345/access_token/vk_ads/");
  expect(crCall.init.headers!["X-Auth-Token"]).toBe("cr-token");
  expect(crCall.init.headers!["X-Auth-UserId"]).toBe("777");

  const apiCall = calls[1]!;
  expect(apiCall.url).toBe("https://ads.vk.com/api/v2/user.json");
  expect(apiCall.init.headers!["Authorization"]).toBe("Bearer vk-token-via-clickru");
});

test("Click.ru: поддерживается и плоский формат ответа {access_token}", async () => {
  mockFetch((url) => {
    if (url.includes("api.click.ru")) {
      return json({ access_token: "flat-token" });
    }
    return json({});
  });

  const c = new VKAdsClient({ clickRuToken: "cr", clickRuAccountId: "1" });
  await c.get("/api/v2/user.json");
  const apiCall = calls.find((x) => x.url.includes("ads.vk.com"))!;
  expect(apiCall.init.headers!["Authorization"]).toBe("Bearer flat-token");
});

test("без источника токена конструктор бросает ошибку", () => {
  expect(() => new VKAdsClient({})).toThrow(/источник токена/i);
});

test("частичные креды бросают ошибку", () => {
  expect(() => new VKAdsClient({ clientId: "cid" })).toThrow(/вместе/);
  expect(() => new VKAdsClient({ clickRuToken: "t" })).toThrow(/вместе/);
});

test("null/undefined параметры не попадают в query string", async () => {
  mockFetch(() => json({ items: [] }));
  const c = new VKAdsClient({ accessToken: "t" });
  await c.get("/api/v2/campaigns.json", {
    limit: 10,
    offset: undefined,
    fields: null,
  });

  const url = calls[0]!.url;
  expect(url).toContain("limit=10");
  expect(url).not.toContain("offset");
  expect(url).not.toContain("fields");
});

test("пустое тело ответа → {}", async () => {
  mockFetch(() => new Response("", { status: 200 }));
  const c = new VKAdsClient({ accessToken: "t" });
  expect(await c.get("/x")).toEqual({});
});

test("не-JSON тело ответа → {raw: text}", async () => {
  mockFetch(() => new Response("plain text", { status: 200 }));
  const c = new VKAdsClient({ accessToken: "t" });
  expect(await c.get("/x")).toEqual({ raw: "plain text" });
});

test("POST сериализует тело в JSON", async () => {
  mockFetch(() => json({ id: 1 }));
  const c = new VKAdsClient({ accessToken: "t" });
  await c.post("/api/v2/campaigns.json", { name: "Test", objective: "reach" });

  const call = calls[0]!;
  expect(call.init.method).toBe("POST");
  expect(call.init.headers!["Content-Type"]).toBe("application/json");
  expect(JSON.parse(String(call.init.body))).toEqual({ name: "Test", objective: "reach" });
});

test("дисковый кэш: новый процесс переиспользует полученный токен", async () => {
  mockFetch((url) => {
    if (url.includes("token.json")) {
      return json({ access_token: "cached-one", expires_in: 3600 });
    }
    return json({});
  });
  const c1 = new VKAdsClient({ clientId: "cid", clientSecret: "sec" });
  await c1.get("/api/v2/user.json");
  expect(calls.some((x) => x.url.includes("token.json"))).toBe(true);

  // Имитируем новый процесс: memory-кэш пуст, остаётся только диск.
  clearTokenMemoryCache();
  calls.length = 0;
  mockFetch((url) => {
    if (url.includes("token.json")) {
      throw new Error("токен не должен запрашиваться повторно");
    }
    return json({});
  });

  const c2 = new VKAdsClient({ clientId: "cid", clientSecret: "sec" });
  await c2.get("/api/v2/user.json");
  expect(calls.some((x) => x.url.includes("token.json"))).toBe(false);
  expect(calls[0]!.init.headers!["Authorization"]).toBe("Bearer cached-one");
});

test("revokeToken: постит client credentials и сбрасывает кэш", async () => {
  mockFetch((url) => {
    if (url.includes("token/delete.json")) return new Response("", { status: 204 });
    if (url.includes("token.json")) return json({ access_token: "tok", expires_in: 3600 });
    return json({});
  });

  const c = new VKAdsClient({ clientId: "cid", clientSecret: "sec" });
  await c.get("/api/v2/user.json"); // получаем и кэшируем токен
  const result = await c.revokeToken();
  expect(result).toEqual({ ok: true, status: 204 });

  const revokeCall = calls.find((x) => x.url.includes("token/delete.json"))!;
  const form = new URLSearchParams(String(revokeCall.init.body));
  expect(form.get("client_id")).toBe("cid");

  // Кэш сброшен — следующий запрос заново получает токен.
  const before = calls.length;
  await c.get("/api/v2/user.json");
  const newTokenCalls = calls.slice(before).filter((x) => x.url.endsWith("/api/v2/oauth2/token.json"));
  expect(newTokenCalls.length).toBe(1);
});

test("revokeToken без client credentials бросает ошибку", async () => {
  const c = new VKAdsClient({ accessToken: "t" });
  await expect(c.revokeToken()).rejects.toThrow(/VK_ADS_CLIENT_ID/);
});

test("кастомный base_url без хвостового слэша", async () => {
  mockFetch(() => json({}));
  const c = new VKAdsClient({ accessToken: "t", baseUrl: "https://example.com/" });
  await c.get("/api/v2/user.json");
  expect(calls[0]!.url).toBe("https://example.com/api/v2/user.json");
});
