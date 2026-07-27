#!/usr/bin/env bun
// Живой smoke-тест против реального VK Ads API — ТОЛЬКО read-only вызовы,
// ничего не создаёт и не изменяет.
//
// Запуск: заполните .env (см. .env.example) или переменные окружения и выполните
//   bun run scripts/live-check.ts
//
// Вызовы идут через полный MCP-стек (tools/call), так что проверяется всё:
// получение токена, HTTP-клиент, регистрация и обработчики инструментов.
//
// Обязательные проверки должны проходить на любом аккаунте; опциональные
// зависят от типа аккаунта и прав токена (провал помечается `warn`, но не
// валит итог). Код выхода: 0 — все обязательные прошли, 1 — есть провалы,
// 2 — не заданы креды.

import { VKAdsClient } from "../src/client.ts";
import { readEnvCreds } from "../src/envConfig.ts";
import { loadEnv } from "../src/loadEnv.ts";
import { McpServer } from "../src/server.ts";

const envPath = loadEnv();
if (envPath) console.error(`Загружен .env: ${envPath}`);

const creds = readEnvCreds();
for (const w of creds.warnings) console.error(`Warning: ${w}`);
if (!creds.hasAny) {
  console.error(
    "Нет кред: заполните VK_ADS_ACCESS_TOKEN, VK_ADS_CLIENT_ID + VK_ADS_CLIENT_SECRET " +
      "или CLICK_RU_TOKEN + CLICK_RU_ACCOUNT_ID (в .env или окружении)."
  );
  process.exit(2);
}
console.error(`Режим: ${creds.mode}\n`);

const server = new McpServer(new VKAdsClient(creds.options));

let requiredFailures = 0;

async function call(
  toolName: string,
  args: Record<string, unknown>
): Promise<{ ok: boolean; text: string }> {
  const resp: any = await server.handle({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: toolName, arguments: args },
  });
  const text: string = resp?.result?.content?.[0]?.text ?? "";
  return { ok: !resp?.result?.isError, text };
}

function shorten(text: string, max = 160): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > max ? oneLine.slice(0, max) + "…" : oneLine;
}

async function check(
  required: boolean,
  toolName: string,
  args: Record<string, unknown> = {},
  note = ""
): Promise<any | null> {
  const { ok, text } = await call(toolName, args);
  const mark = ok ? "PASS" : required ? "FAIL" : "warn";
  if (!ok && required) requiredFailures++;
  console.log(
    `${mark}  ${toolName}${note ? ` (${note})` : ""}${ok ? "" : ` — ${shorten(text)}`}`
  );
  if (!ok) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// --- Обязательные (должны работать на любом аккаунте) --------------------------
const auth = await check(true, "vk_ads_auth_check");
await check(true, "vk_ads_ad_plans_list", { limit: 5 });
const campaigns = await check(true, "vk_ads_campaigns_list", { limit: 5 });
await check(true, "vk_ads_banners_list", { limit: 5 });
await check(true, "vk_ads_packages_list");
await check(true, "vk_ads_regions_search", { query: "Москва", limit: 3 });

// --- Опциональные (зависят от типа аккаунта и прав токена) ---------------------
await check(false, "vk_ads_remarketing_segments_list", { limit: 5 });
await check(false, "vk_ads_remarketing_pixels_list", { limit: 5 });
await check(false, "vk_ads_users_lists_list", { limit: 5 }, "может упираться в квоту приложения");
await check(false, "vk_ads_agency_clients_list", { limit: 5 }, "только для агентств");
await check(false, "vk_ads_dictionary_get", { name: "currencies" });

// Статистика: по первой campaign, а если их нет — по самому пользователю
const firstCampaignId = campaigns?.items?.[0]?.id;
if (firstCampaignId) {
  await check(
    false,
    "vk_ads_statistics_summary",
    { entity: "campaigns", ids: String(firstCampaignId) },
    `campaign ${firstCampaignId}`
  );
} else if (auth?.user?.id) {
  await check(
    true,
    "vk_ads_statistics_summary",
    { entity: "users", ids: String(auth.user.id) },
    "entity=users — в аккаунте нет campaigns"
  );
} else {
  console.log("skip  vk_ads_statistics_summary — нет ни campaigns, ни user id");
}

if (auth?.user) {
  const u = auth.user;
  console.log(`\nАккаунт: id=${u.id ?? "?"} username=${u.username ?? "?"}`);
}
console.log(
  requiredFailures === 0
    ? "\nИтог: все обязательные проверки прошли ✓"
    : `\nИтог: обязательных провалов: ${requiredFailures} ✗`
);
process.exit(requiredFailures === 0 ? 0 : 1);
