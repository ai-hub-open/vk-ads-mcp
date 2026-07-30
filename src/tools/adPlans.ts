// Ad plans — ВЕРХНЕУРОВНЕВАЯ сущность («Кампания» в новом интерфейсе ads.vk.com).
//
// Терминология VK Ads API (наследие myTarget) отличается от UI:
//   UI «Кампания»            = API ad_plan   (этот файл)
//   UI «Группа объявлений»   = API campaign  (tools/campaigns.ts)
//   UI «Объявление»          = API banner    (tools/banners.ts)
//
// campaign без ad_plan_id создаётся успешно, но становится «сиротой» —
// не отображается в новом кабинете ads.vk.com.

import type { ToolRegistry } from "../toolRegistry.ts";
import {
  SOFT_DELETE_BODY,
  fieldsProp,
  idPayloadSchema,
  idSchema,
  paginationParams,
  paginationProps,
  payloadSchema,
  requireId,
} from "./util.ts";

export function registerAdPlans(registry: ToolRegistry): void {
  registry.register({
    name: "vk_ads_ad_plans_list",
    description:
      "Список ad plans — верхнеуровневых сущностей, которые в интерфейсе ads.vk.com " +
      "называются «Кампания». Иерархия VK Ads API: ad_plan (UI «Кампания») → " +
      "campaign (UI «Группа объявлений») → banner (UI «Объявление»).",
    inputSchema: {
      type: "object",
      properties: { ...paginationProps, fields: fieldsProp },
    },
    handler: (client, args) =>
      client.get("/api/v2/ad_plans.json", {
        ...paginationParams(args),
        fields: args.fields,
      }),
  });

  registry.register({
    name: "vk_ads_ad_plans_get",
    description: "Получить один ad plan (UI «Кампания») по ID.",
    inputSchema: {
      type: "object",
      properties: {
        ad_plan_id: { type: "integer", description: "ID ad plan" },
        fields: fieldsProp,
      },
      required: ["ad_plan_id"],
    },
    handler: (client, args) =>
      client.get(`/api/v2/ad_plans/${requireId(args.ad_plan_id, "ad_plan_id")}.json`, {
        fields: args.fields,
      }),
  });

  registry.register({
    name: "vk_ads_ad_plans_create",
    description:
      "Создать ad plan (UI «Кампания»). Обязательно: name. Опционально: event_limit, " +
      "uniq_shows_limit, uniq_shows_period, date_start, date_end. Вложенные campaign " +
      "(UI «Группы объявлений») можно создать сразу массивом `campaigns: [...]` — " +
      "API принимает их атомарно — или привязать позже через ad_plan_id.",
    inputSchema: payloadSchema(
      "Объект AdPlan по схеме VK Ads (name, date_start, campaigns и т.д.)"
    ),
    handler: (client, args) => client.post("/api/v2/ad_plans.json", args.payload),
  });

  registry.register({
    name: "vk_ads_ad_plans_update",
    description:
      "Обновить ad plan (UI «Кампания»). PATCH-семантика: передавайте только изменяемые поля.",
    inputSchema: idPayloadSchema("ad_plan_id", "ID ad plan", "Изменяемые поля AdPlan"),
    handler: (client, args) =>
      client.post(
        `/api/v2/ad_plans/${requireId(args.ad_plan_id, "ad_plan_id")}.json`,
        args.payload
      ),
  });

  registry.register({
    name: "vk_ads_ad_plans_delete",
    description: "Мягко удалить ad plan (UI «Кампания») — выставляет status=deleted.",
    inputSchema: idSchema("ad_plan_id", "ID ad plan"),
    handler: (client, args) =>
      client.post(
        `/api/v2/ad_plans/${requireId(args.ad_plan_id, "ad_plan_id")}.json`,
        SOFT_DELETE_BODY
      ),
  });
}
