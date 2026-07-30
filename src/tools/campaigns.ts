// Campaigns в терминах VK Ads API = «Группы объявлений» в новом UI ads.vk.com.
// UI «Кампания» — это ad_plan (tools/adPlans.ts).

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

const CAMPAIGN_STATUSES = ["active", "blocked", "deleted"] as const;

export function registerCampaigns(registry: ToolRegistry): void {
  registry.register({
    name: "vk_ads_campaigns_list",
    description:
      "Список campaign-сущностей VK Ads API — в интерфейсе ads.vk.com это «Группы " +
      "объявлений». Не путать: UI «Кампания» = ad_plan (см. vk_ads_ad_plans_list).",
    inputSchema: {
      type: "object",
      properties: {
        ...paginationProps,
        status: {
          type: "string",
          description: "Фильтр по статусу: active, blocked, deleted",
        },
        fields: fieldsProp,
      },
    },
    handler: (client, args) =>
      client.get("/api/v2/campaigns.json", {
        ...paginationParams(args),
        _status__in: args.status,
        fields: args.fields,
      }),
  });

  registry.register({
    name: "vk_ads_campaigns_get",
    description: "Получить одну campaign (UI «Группа объявлений») по ID.",
    inputSchema: {
      type: "object",
      properties: {
        campaign_id: { type: "integer", description: "ID campaign" },
        fields: fieldsProp,
      },
      required: ["campaign_id"],
    },
    handler: (client, args) =>
      client.get(
        `/api/v2/campaigns/${requireId(args.campaign_id, "campaign_id")}.json`,
        { fields: args.fields }
      ),
  });

  registry.register({
    name: "vk_ads_campaigns_create",
    description:
      "Создать campaign (UI «Группа объявлений»). payload по схеме Campaign VK Ads: " +
      "name, objective, budget_limit, budget_limit_day, package_id, targetings и т.д. " +
      "⚠ Обязательно указывайте ad_plan_id — campaign без него не будет видна " +
      "в новом интерфейсе ads.vk.com (сущность-«сирота»).",
    inputSchema: payloadSchema(
      "Объект Campaign по схеме VK Ads (name, ad_plan_id, package_id, targetings…)"
    ),
    handler: (client, args) => client.post("/api/v2/campaigns.json", args.payload),
  });

  registry.register({
    name: "vk_ads_campaigns_update",
    description:
      "Обновить campaign (UI «Группа объявлений»). PATCH-семантика: только изменяемые поля.",
    inputSchema: idPayloadSchema("campaign_id", "ID campaign", "Изменяемые поля Campaign"),
    handler: (client, args) =>
      client.post(
        `/api/v2/campaigns/${requireId(args.campaign_id, "campaign_id")}.json`,
        args.payload
      ),
  });

  registry.register({
    name: "vk_ads_campaigns_set_status",
    description:
      "Сменить статус campaign (UI «Группа объявлений»). Допустимо: active (запустить), " +
      "blocked (остановить), deleted (удалить).",
    inputSchema: {
      type: "object",
      properties: {
        campaign_id: { type: "integer", description: "ID campaign" },
        status: {
          type: "string",
          enum: [...CAMPAIGN_STATUSES],
          description: "Новый статус",
        },
      },
      required: ["campaign_id", "status"],
    },
    handler: (client, args) => {
      const status = String(args.status);
      if (!CAMPAIGN_STATUSES.includes(status as any)) {
        return {
          error: true,
          detail: `Недопустимый статус: ${status}. Разрешены: ${CAMPAIGN_STATUSES.join(", ")}`,
        };
      }
      return client.post(
        `/api/v2/campaigns/${requireId(args.campaign_id, "campaign_id")}.json`,
        { status }
      );
    },
  });

  registry.register({
    name: "vk_ads_campaigns_delete",
    description:
      "Мягко удалить campaign (UI «Группа объявлений») — выставляет status=deleted.",
    inputSchema: idSchema("campaign_id", "ID campaign"),
    handler: (client, args) =>
      client.post(
        `/api/v2/campaigns/${requireId(args.campaign_id, "campaign_id")}.json`,
        SOFT_DELETE_BODY
      ),
  });
}
