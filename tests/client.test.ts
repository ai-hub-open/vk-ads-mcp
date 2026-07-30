// Тесты VKAdsClient: авторизация, получение/обновление токена, обработка ошибок,
// изоляция кэша между арендаторами.

import { afterEach, beforeEach, expect, test } from "bun:test";

import { VKAdsClient, VKAdsError, type ClientOptions } from "../src/client.ts";
import { TokenStore } from "../src/tokenStore.ts";
import { VERSION } from "../src/version.ts";
import { calls, json, mockFetch, setupTestEnv, teardownTestEnv, testStore } from "./helpers.ts";

beforeEach(setupTestEnv);
afterEach(teardownTestEnv);

/** Клиент с изолированным на тест хранилищем токенов. */
function client(opts: ClientOptions): VKAdsClient {
  return new VKAdsClient({ tokenStore: testStore, ...opts });
}

test("GET отправляет Bearer-токен и User-Agent с версией пакета", async () => {
  mockFetch(() => json({ id: 42 }));
  const data = await client({ accessToken: "t0" }).get("/api/v2/user.json");

  expect(data).toEqual({ id: 42 });
  expect(calls[0]!.url).toBe("https://ads.vk.com/api/v2/user.json");
  expect(calls[0]!.init.headers!["Authorization"]).toBe("Bearer t0");
  expect(calls[0]!.init.headers!["User-Agent"]).toBe(`vk-ads-mcp/${VERSION}`);
});

test("4xx бросает VKAdsError со статусом и телом", async () => {
  mockFetch(() => json({ error: "forbidden" }, 403));

  try {
    await client({ accessToken: "t0" }).get("/api/v2/campaigns.json");
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
  mockFetch((url) =>
    url.includes("/oauth2/token.json")
      ? json({ access_token: "fetched", expires_in: 3600 })
      : json({ ok: true })
  );

  await client({ clientId: "cid", clientSecret: "sec" }).get("/api/v2/user.json");

  const tokenCall = calls.find((x) => x.url.includes("token.json"))!;
  const form = new URLSearchParams(String(tokenCall.init.body));
  expect(form.get("grant_type")).toBe("client_credentials");
  expect(form.get("client_id")).toBe("cid");
  expect(form.get("client_secret")).toBe("sec");

  const apiCall = calls.find((x) => x.url.includes("user.json"))!;
  expect(apiCall.init.headers!["Authorization"]).toBe("Bearer fetched");
});

test("агентский режим: grant_type=agency_client_credentials", async () => {
  mockFetch((url) =>
    url.includes("/oauth2/token.json") ? json({ access_token: "fetched" }) : json({})
  );

  await client({
    clientId: "cid",
    clientSecret: "sec",
    agencyClientName: "client_login",
  }).get("/api/v2/user.json");

  const form = new URLSearchParams(
    String(calls.find((x) => x.url.includes("token.json"))!.init.body)
  );
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
    return userCalls === 1 ? json({ error: "expired" }, 401) : json({ id: 1 });
  });

  const data = await client({
    accessToken: "old",
    clientId: "cid",
    clientSecret: "sec",
  }).get("/api/v2/user.json");

  expect(data).toEqual({ id: 1 });
  expect(userCalls).toBe(2);
  expect(
    calls.filter((x) => x.url.includes("user.json")).at(-1)!.init.headers!["Authorization"]
  ).toBe("Bearer new");
});

test("401 со статическим токеном (без кред): ошибка без повторов", async () => {
  let userCalls = 0;
  mockFetch(() => {
    userCalls++;
    return json({ error: "bad token" }, 401);
  });

  await expect(client({ accessToken: "t0" }).get("/api/v2/user.json")).rejects.toBeInstanceOf(
    VKAdsError
  );
  expect(userCalls).toBe(1);
});

test("Click.ru: токен VK Ads запрашивается у Click.ru с нужными заголовками", async () => {
  mockFetch((url) =>
    url.includes("api.click.ru")
      ? json({ response: { access_token: "vk-token-via-clickru" } })
      : json({ ok: true })
  );

  await client({
    clickRuToken: "cr-token",
    clickRuAccountId: "12345",
    clickRuUserId: "777",
  }).get("/api/v2/user.json");

  const crCall = calls[0]!;
  expect(crCall.url).toBe("https://api.click.ru/V0/accounts/12345/access_token/vk_ads/");
  expect(crCall.init.headers!["X-Auth-Token"]).toBe("cr-token");
  expect(crCall.init.headers!["X-Auth-UserId"]).toBe("777");

  expect(calls[1]!.url).toBe("https://ads.vk.com/api/v2/user.json");
  expect(calls[1]!.init.headers!["Authorization"]).toBe("Bearer vk-token-via-clickru");
});

test("Click.ru: поддерживается и плоский формат ответа {access_token}", async () => {
  mockFetch((url) =>
    url.includes("api.click.ru") ? json({ access_token: "flat-token" }) : json({})
  );

  await client({ clickRuToken: "cr", clickRuAccountId: "1" }).get("/api/v2/user.json");
  expect(
    calls.find((x) => x.url.includes("ads.vk.com"))!.init.headers!["Authorization"]
  ).toBe("Bearer flat-token");
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
  await client({ accessToken: "t" }).get("/api/v2/campaigns.json", {
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
  expect(await client({ accessToken: "t" }).get("/x")).toEqual({});
});

test("не-JSON тело ответа → {raw: text}", async () => {
  mockFetch(() => new Response("plain text", { status: 200 }));
  expect(await client({ accessToken: "t" }).get("/x")).toEqual({ raw: "plain text" });
});

test("POST сериализует тело в JSON", async () => {
  mockFetch(() => json({ id: 1 }));
  await client({ accessToken: "t" }).post("/api/v2/campaigns.json", {
    name: "Test",
    objective: "reach",
  });

  const call = calls[0]!;
  expect(call.init.method).toBe("POST");
  expect(call.init.headers!["Content-Type"]).toBe("application/json");
  expect(JSON.parse(String(call.init.body))).toEqual({ name: "Test", objective: "reach" });
});

test("токен переиспользуется из общего хранилища при тех же кредах", async () => {
  mockFetch((url) =>
    url.includes("token.json") ? json({ access_token: "shared", expires_in: 3600 }) : json({})
  );

  await client({ clientId: "cid", clientSecret: "sec" }).get("/api/v2/user.json");
  const tokenRequests = calls.filter((x) => x.url.includes("token.json")).length;

  // Второй клиент с ТЕМИ ЖЕ кредами — токен берётся из кэша.
  await client({ clientId: "cid", clientSecret: "sec" }).get("/api/v2/user.json");
  expect(calls.filter((x) => x.url.includes("token.json")).length).toBe(tokenRequests);
  expect(calls.at(-1)!.init.headers!["Authorization"]).toBe("Bearer shared");
});

// --- Изоляция арендаторов (регрессия на утечку токенов) ------------------------

test("чужой секрет не даёт доступа к закэшированному токену", async () => {
  let issued = 0;
  mockFetch((url) => {
    if (url.includes("token.json")) {
      issued++;
      return json({ access_token: `token-${issued}`, expires_in: 3600 });
    }
    return json({});
  });

  // Арендатор A с валидным секретом кладёт токен в общий кэш.
  await client({ clientId: "общий-id", clientSecret: "секрет-A" }).get("/api/v2/user.json");
  expect(calls.at(-1)!.init.headers!["Authorization"]).toBe("Bearer token-1");

  // Арендатор B знает публичный client_id, но секрет у него другой:
  // кэш не должен сработать — VK выдаёт (или отклоняет) токен заново.
  await client({ clientId: "общий-id", clientSecret: "секрет-B" }).get("/api/v2/user.json");
  expect(issued).toBe(2);
  expect(calls.at(-1)!.init.headers!["Authorization"]).toBe("Bearer token-2");
});

test("чужой Click.ru-токен не даёт доступа к токену по тому же accountId", async () => {
  let issued = 0;
  mockFetch((url) => {
    if (url.includes("api.click.ru")) {
      issued++;
      return json({ access_token: `vk-${issued}` });
    }
    return json({});
  });

  await client({ clickRuToken: "токен-A", clickRuAccountId: "652819" }).get("/api/v2/user.json");
  await client({ clickRuToken: "токен-B", clickRuAccountId: "652819" }).get("/api/v2/user.json");

  expect(issued).toBe(2);
  expect(calls.at(-1)!.init.headers!["Authorization"]).toBe("Bearer vk-2");
});

test("ротация секрета не переиспользует старый токен", async () => {
  let issued = 0;
  mockFetch((url) => {
    if (url.includes("token.json")) {
      issued++;
      return json({ access_token: `token-${issued}`, expires_in: 3600 });
    }
    return json({});
  });

  await client({ clientId: "cid", clientSecret: "старый" }).get("/api/v2/user.json");
  await client({ clientId: "cid", clientSecret: "новый" }).get("/api/v2/user.json");
  expect(issued).toBe(2);
});

test("разные агентские клиенты не делят токен", async () => {
  let issued = 0;
  mockFetch((url) => {
    if (url.includes("token.json")) {
      issued++;
      return json({ access_token: `token-${issued}`, expires_in: 3600 });
    }
    return json({});
  });

  const base = { clientId: "cid", clientSecret: "sec" };
  await client({ ...base, agencyClientName: "клиент-1" }).get("/api/v2/user.json");
  await client({ ...base, agencyClientName: "клиент-2" }).get("/api/v2/user.json");
  expect(issued).toBe(2);
});

test("revokeToken: постит client credentials и сбрасывает кэш", async () => {
  mockFetch((url) => {
    if (url.includes("token/delete.json")) return new Response("", { status: 204 });
    if (url.includes("token.json")) return json({ access_token: "tok", expires_in: 3600 });
    return json({});
  });

  const c = client({ clientId: "cid", clientSecret: "sec" });
  await c.get("/api/v2/user.json");
  expect(await c.revokeToken()).toEqual({ ok: true, status: 204 });

  const form = new URLSearchParams(
    String(calls.find((x) => x.url.includes("token/delete.json"))!.init.body)
  );
  expect(form.get("client_id")).toBe("cid");

  // Кэш сброшен — следующий запрос заново получает токен.
  const before = calls.length;
  await c.get("/api/v2/user.json");
  expect(
    calls.slice(before).filter((x) => x.url.endsWith("/api/v2/oauth2/token.json")).length
  ).toBe(1);
});

test("revokeToken без client credentials бросает ошибку", async () => {
  await expect(client({ accessToken: "t" }).revokeToken()).rejects.toThrow(/VK_ADS_CLIENT_ID/);
});

test("кастомный base_url без хвостового слэша", async () => {
  mockFetch(() => json({}));
  await client({ accessToken: "t", baseUrl: "https://example.com/" }).get("/api/v2/user.json");
  expect(calls[0]!.url).toBe("https://example.com/api/v2/user.json");
});

test("политика доступа по умолчанию разрешена, но настраивается", () => {
  const permissive = new VKAdsClient({ accessToken: "t", tokenStore: testStore });
  expect(permissive.allowLocalFiles).toBe(true);
  expect(permissive.allowPrivateNetwork).toBe(true);

  const locked = new VKAdsClient({
    accessToken: "t",
    tokenStore: testStore,
    allowLocalFiles: false,
    allowPrivateNetwork: false,
  });
  expect(locked.allowLocalFiles).toBe(false);
  expect(locked.allowPrivateNetwork).toBe(false);
});

test("хранилище по умолчанию не используется, если передано своё", async () => {
  const isolated = new TokenStore({ dir: null });
  mockFetch((url) =>
    url.includes("token.json") ? json({ access_token: "x", expires_in: 3600 }) : json({})
  );

  await new VKAdsClient({ clientId: "c", clientSecret: "s", tokenStore: isolated }).get("/u");
  expect(isolated.size).toBe(1);
  expect(testStore.size).toBe(0);
});
