// Тесты инструментов: правильные URL, методы, query-параметры и тела запросов.
// Портированы с tests/test_tools.py python-версии.

import { afterEach, beforeEach, expect, test } from "bun:test";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { VKAdsClient, type ClientOptions } from "../src/client.ts";
import { McpServer } from "../src/server.ts";
import { calls, json, mockFetch, setupTestEnv, teardownTestEnv, testStore } from "./helpers.ts";

beforeEach(setupTestEnv);
afterEach(teardownTestEnv);

async function callTool(
  name: string,
  args: Record<string, unknown> = {},
  clientOpts: Partial<ClientOptions> = {}
): Promise<any> {
  const server = new McpServer(
    new VKAdsClient({ accessToken: "t", tokenStore: testStore, ...clientOpts })
  );
  return server.handle({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name, arguments: args },
  });
}

function resultText(resp: any): string {
  return resp.result.content[0].text;
}

test("campaigns_list передаёт limit/offset/_status__in", async () => {
  mockFetch(() => json({ items: [], count: 0 }));
  await callTool("vk_ads_campaigns_list", { limit: 10, offset: 5, status: "active" });

  const url = calls[0]!.url;
  expect(url).toContain("/api/v2/campaigns.json");
  expect(url).toContain("limit=10");
  expect(url).toContain("offset=5");
  expect(url).toContain("_status__in=active");
});

test("campaigns_get строит путь по ID", async () => {
  mockFetch(() => json({ id: 42 }));
  const resp = await callTool("vk_ads_campaigns_get", { campaign_id: 42 });

  expect(calls[0]!.url).toContain("/api/v2/campaigns/42.json");
  expect(JSON.parse(resultText(resp))).toEqual({ id: 42 });
});

test("campaigns_create постит payload как есть", async () => {
  mockFetch(() => json({ id: 1 }));
  const payload = { name: "Test", objective: "reach", ad_plan_id: 9 };
  await callTool("vk_ads_campaigns_create", { payload });

  const call = calls[0]!;
  expect(call.init.method).toBe("POST");
  expect(JSON.parse(String(call.init.body))).toEqual(payload);
});

test("campaigns_set_status: валидный статус уходит в API", async () => {
  mockFetch(() => json({ id: 5 }));
  await callTool("vk_ads_campaigns_set_status", { campaign_id: 5, status: "blocked" });

  expect(calls[0]!.url).toContain("/api/v2/campaigns/5.json");
  expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ status: "blocked" });
});

test("campaigns_set_status: невалидный статус не делает HTTP-вызов", async () => {
  mockFetch(() => json({}));
  const resp = await callTool("vk_ads_campaigns_set_status", {
    campaign_id: 5,
    status: "garbage",
  });

  expect(calls.length).toBe(0);
  expect(resultText(resp)).toContain("Недопустимый статус");
});

test("campaigns_delete постит status=deleted", async () => {
  mockFetch(() => json({}));
  await callTool("vk_ads_campaigns_delete", { campaign_id: 3 });
  expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ status: "deleted" });
});

test("некорректный ID в пути → ошибка без HTTP-вызова", async () => {
  mockFetch(() => json({}));
  const resp = await callTool("vk_ads_campaigns_get", { campaign_id: "1/evil" });
  expect(calls.length).toBe(0);
  expect(resp.result.isError).toBe(true);
  expect(resultText(resp)).toContain("целым числом");
});

test("ad_plans_list и ad_plans_delete", async () => {
  mockFetch(() => json({ items: [] }));
  await callTool("vk_ads_ad_plans_list", {});
  expect(calls[0]!.url).toContain("/api/v2/ad_plans.json");
  expect(calls[0]!.url).toContain("limit=50");

  await callTool("vk_ads_ad_plans_delete", { ad_plan_id: 11 });
  expect(calls[1]!.url).toContain("/api/v2/ad_plans/11.json");
  expect(JSON.parse(String(calls[1]!.init.body))).toEqual({ status: "deleted" });
});

test("ad_groups_list фильтрует по _campaign_id", async () => {
  mockFetch(() => json({ items: [] }));
  await callTool("vk_ads_ad_groups_list", { campaign_id: 7 });
  expect(calls[0]!.url).toContain("_campaign_id=7");
});

test("banners_list фильтрует по _campaign_id и _ad_group_id", async () => {
  mockFetch(() => json({ items: [] }));
  await callTool("vk_ads_banners_list", { campaign_id: 1, ad_group_id: 2 });

  const url = calls[0]!.url;
  expect(url).toContain("/api/v2/banners.json");
  expect(url).toContain("_campaign_id=1");
  expect(url).toContain("_ad_group_id=2");
});

test("statistics_day строит URL по entity", async () => {
  mockFetch(() => json({ items: [{ id: 1 }] }));
  await callTool("vk_ads_statistics_day", {
    entity: "campaigns",
    ids: "1,2",
    date_from: "2026-04-01",
    date_to: "2026-04-10",
    metrics: "base",
  });

  const url = calls[0]!.url;
  expect(url).toContain("/api/v2/statistics/campaigns/day.json");
  expect(url).toContain("id=1%2C2");
  expect(url).toContain("date_from=2026-04-01");
  expect(url).toContain("metrics=base");
});

test("statistics_summary работает без дат", async () => {
  mockFetch(() => json({ items: [] }));
  await callTool("vk_ads_statistics_summary", { entity: "banners", ids: "42" });

  const url = calls[0]!.url;
  expect(url).toContain("/api/v2/statistics/banners/summary.json");
  expect(url).not.toContain("date_from");
});

test("statistics_breakdown строит URL по entity и group_by", async () => {
  mockFetch(() => json({ items: [] }));
  await callTool("vk_ads_statistics_breakdown", {
    entity: "banners",
    ids: "1",
    date_from: "2026-01-01",
    date_to: "2026-01-31",
    group_by: "gender",
  });
  expect(calls[0]!.url).toContain("/api/v2/statistics/banners/gender.json");
});

test("statistics: невалидный entity → ошибка без HTTP-вызова", async () => {
  mockFetch(() => json({}));
  const resp = await callTool("vk_ads_statistics_day", {
    entity: "hackers",
    ids: "1",
    date_from: "2026-01-01",
    date_to: "2026-01-02",
  });
  expect(calls.length).toBe(0);
  expect(resp.result.isError).toBe(true);
  expect(resultText(resp)).toContain("должен быть одним из");
});

test("remarketing_segments: list и delete", async () => {
  mockFetch(() => json({ items: [], count: 0 }));
  await callTool("vk_ads_remarketing_segments_list", { limit: 5 });
  expect(calls[0]!.url).toContain("/api/v2/remarketing/segments.json");
  expect(calls[0]!.url).toContain("limit=5");

  await callTool("vk_ads_remarketing_segments_delete", { segment_id: 4 });
  const call = calls[1]!;
  expect(call.url).toContain("/api/v2/remarketing/segments/4.json");
  expect(call.init.method).toBe("DELETE");
});

test("users_lists_upload_items постит {items}", async () => {
  mockFetch(() => json({}));
  await callTool("vk_ads_users_lists_upload_items", {
    users_list_id: 8,
    items: ["hash1", "hash2"],
  });

  expect(calls[0]!.url).toContain("/api/v2/remarketing/users_lists/8/items.json");
  expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ items: ["hash1", "hash2"] });
});

test("agency_clients_list", async () => {
  mockFetch(() => json({ items: [] }));
  await callTool("vk_ads_agency_clients_list", {});
  expect(calls[0]!.url).toContain("/api/v2/agency/clients.json");
});

test("packages_list по умолчанию отдаёт компактный список и цели", async () => {
  mockFetch(() =>
    json({
      items: [
        { id: 1, name: "lead_ads_paket", objective: ["leadads"], status: "active", description: "x".repeat(500), pads_tree_id: 7 },
        { id: 2, name: "install_paket", objective: ["appinstalls"], status: "active", description: "y".repeat(500) },
      ],
    })
  );

  const r = JSON.parse(resultText(await callTool("vk_ads_packages_list", {})));
  expect(calls[0]!.url).toContain("/api/v2/packages.json");
  expect(r.total_packages).toBe(2);
  expect(r.available_objectives).toEqual(["appinstalls", "leadads"]);
  // Тяжёлые поля вырезаны — иначе ответ не помещается в контекст модели.
  expect(r.items[0].description).toBeUndefined();
  expect(r.items[0].pads_tree_id).toBeUndefined();
  expect(r.items[0].id).toBe(1);
});

test("packages_list фильтрует по objective и подстроке названия", async () => {
  const packages = {
    items: [
      { id: 1, name: "lead_ads_paket", objective: ["leadads"] },
      { id: 2, name: "install_paket", objective: ["appinstalls"] },
      { id: 3, name: "install_paket_ios", objective: ["appinstalls"] },
    ],
  };
  mockFetch(() => json(packages));

  const byObjective = JSON.parse(
    resultText(await callTool("vk_ads_packages_list", { objective: "appinstalls" }))
  );
  expect(byObjective.count).toBe(2);
  expect(byObjective.total_packages).toBe(3);

  const byQuery = JSON.parse(
    resultText(await callTool("vk_ads_packages_list", { objective: "appinstalls", query: "ios" }))
  );
  expect(byQuery.count).toBe(1);
  expect(byQuery.items[0].id).toBe(3);
});

test("packages_list с full=true отдаёт все поля", async () => {
  mockFetch(() => json({ items: [{ id: 1, name: "p", objective: ["leadads"], description: "полное" }] }));
  const r = JSON.parse(resultText(await callTool("vk_ads_packages_list", { full: true })));
  expect(r.items[0].description).toBe("полное");
});

test("regions_search: тянет полное дерево и фильтрует на клиенте", async () => {
  const tree = {
    count: 4,
    items: [
      { id: 188, name: "Russia", parent_id: 100001 },
      { id: 1, name: "Москва", parent_id: 188 },
      { id: 2, name: "Московская область", parent_id: 188 },
      { id: 3, name: "Санкт-Петербург", parent_id: 188 },
    ],
  };
  mockFetch(() => json(tree));

  const resp = await callTool("vk_ads_regions_search", { query: "моск", limit: 1 });
  expect(calls[0]!.url).toContain("/api/v2/regions.json");
  expect(calls[0]!.url).not.toContain("q=");

  const result = JSON.parse(resultText(resp));
  expect(result.count).toBe(2); // Москва + Московская область
  expect(result.items.length).toBe(1); // limit=1
  expect(result.items[0].name).toBe("Москва");
  expect(result.total_regions).toBe(4);

  // Повторный поиск использует кэш — нового HTTP-вызова нет.
  await callTool("vk_ads_regions_search", { query: "петербург" });
  expect(calls.length).toBe(1);
});

test("dictionary_get строит URL по имени справочника", async () => {
  mockFetch(() => json({ items: [] }));
  await callTool("vk_ads_dictionary_get", { name: "interests", params: { limit: 5 } });

  const url = calls[0]!.url;
  expect(url).toContain("/api/v2/interests.json");
  expect(url).toContain("limit=5");
});

test("dictionary_get отклоняет опасные имена", async () => {
  mockFetch(() => json({}));
  const resp = await callTool("vk_ads_dictionary_get", { name: "../secrets" });
  expect(calls.length).toBe(0);
  expect(resp.result.isError).toBe(true);
});

test("content_upload_image загружает локальный файл как multipart", async () => {
  const dir = mkdtempSync(join(tmpdir(), "vk-ads-upload-"));
  const filePath = join(dir, "test.png");
  writeFileSync(filePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));

  mockFetch(() => json({ id: 100, url: "https://cdn/img.png" }));
  const resp = await callTool("vk_ads_content_upload_image", {
    source_path_or_url: filePath,
  });

  const call = calls[0]!;
  expect(call.url).toContain("/api/v2/content/static.json");
  expect(call.init.method).toBe("POST");
  expect(call.init.body).toBeInstanceOf(FormData);
  const file = (call.init.body as FormData).get("file") as File;
  expect(file.name).toBe("test.png");
  expect(file.size).toBe(4);
  expect(JSON.parse(resultText(resp))).toEqual({ id: 100, url: "https://cdn/img.png" });
});

test("content_upload_image скачивает по URL и переотправляет", async () => {
  mockFetch((url) => {
    if (url.startsWith("https://8.8.8.8/")) {
      return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
    }
    return json({ id: 5 });
  });

  await callTool("vk_ads_content_upload_image", {
    source_path_or_url: "https://8.8.8.8/pic/banner.jpg?v=2",
  });

  expect(calls[0]!.url).toBe("https://8.8.8.8/pic/banner.jpg?v=2");
  const uploadCall = calls[1]!;
  expect(uploadCall.url).toContain("/api/v2/content/static.json");
  const file = (uploadCall.init.body as FormData).get("file") as File;
  expect(file.name).toBe("banner.jpg");
});

test("при allowLocalFiles=false чтение с диска запрещено", async () => {
  const dir = mkdtempSync(join(tmpdir(), "vk-ads-upload-"));
  const filePath = join(dir, "secret.env");
  writeFileSync(filePath, "VK_ADS_ACCESS_TOKEN=утекший");

  mockFetch(() => json({ id: 1 }));
  const resp = await callTool(
    "vk_ads_content_upload_image",
    { source_path_or_url: filePath },
    { allowLocalFiles: false }
  );

  expect(calls.length).toBe(0);
  expect(resp.result.isError).toBe(true);
  expect(resultText(resp)).toContain("Чтение локальных файлов отключено");
});

test("при allowPrivateNetwork=false загрузка с внутреннего адреса блокируется", async () => {
  mockFetch(() => new Response("СЕКРЕТ", { status: 200 }));
  const resp = await callTool(
    "vk_ads_content_upload_image",
    { source_path_or_url: "http://169.254.169.254/latest/meta-data/" },
    { allowPrivateNetwork: false }
  );

  expect(calls.length).toBe(0);
  expect(resp.result.isError).toBe(true);
  expect(resultText(resp)).toContain("внутренний адрес");
});

test("file:// отвергается даже при разрешённой внутренней сети", async () => {
  mockFetch(() => json({}));
  const resp = await callTool("vk_ads_content_upload_video", {
    source_path_or_url: "file:///etc/passwd",
  });

  expect(calls.length).toBe(0);
  expect(resp.result.isError).toBe(true);
  expect(resultText(resp)).toContain("Схема file: запрещена");
});

test("regions_search находит по русскому названию", async () => {
  mockFetch(() =>
    json({
      count: 3,
      items: [
        { id: 188, name: "Россия", parent_id: 100001 },
        { id: 70, name: "Московская область", parent_id: 188 },
        { id: 5506, name: "Москва", parent_id: 70 },
      ],
    })
  );

  // «моск» — общая подстрока обоих названий: в «московская» после «моск» идёт «о».
  const resp = await callTool("vk_ads_regions_search", { query: "моск" });
  const r = JSON.parse(resultText(resp));
  expect(r.count).toBe(2);
  expect(r.items.map((x: any) => x.name)).toEqual(["Московская область", "Москва"]);
  expect(calls[0]!.init.headers!["Accept-Language"]).toBe("ru");

  // Регистр не важен, «Россия» под запрос не подходит.
  const upper = JSON.parse(resultText(await callTool("vk_ads_regions_search", { query: "МОСКВА" })));
  expect(upper.items.map((x: any) => x.name)).toEqual(["Москва"]);
});

test("кэш дерева регионов учитывает язык", async () => {
  mockFetch((url, init) => {
    const lang = (init as any)?.headers?.["Accept-Language"];
    return json({ items: [{ id: 5506, name: lang === "en" ? "Moscow" : "Москва" }] });
  });

  const ru = JSON.parse(resultText(await callTool("vk_ads_regions_search", { query: "Москва" })));
  expect(ru.count).toBe(1);

  // Другой язык — отдельная запись кэша, а не переиспользование русской.
  const en = JSON.parse(
    resultText(await callTool("vk_ads_regions_search", { query: "Moscow" }, { language: "en" }))
  );
  expect(en.count).toBe(1);
  expect(calls.length).toBe(2);
});
