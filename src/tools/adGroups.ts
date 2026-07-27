// Ad groups VK Ads API — группировка баннеров по таргетингу.

import type { ToolRegistry } from "../toolRegistry.ts";
import { fieldsProp, paginationProps, requireId } from "./util.ts";

export function registerAdGroups(registry: ToolRegistry): void {
  registry.register({
    name: "vk_ads_ad_groups_list",
    description:
      "Список ad groups, опционально с фильтром по campaign_id.",
    inputSchema: {
      type: "object",
      properties: {
        campaign_id: {
          type: "integer",
          description: "Фильтр по ID campaign (опционально)",
        },
        ...paginationProps,
        fields: fieldsProp,
      },
    },
    handler: (client, args) =>
      client.get("/api/v2/ad_groups.json", {
        _campaign_id: args.campaign_id,
        limit: args.limit ?? 50,
        offset: args.offset ?? 0,
        fields: args.fields,
      }),
  });

  registry.register({
    name: "vk_ads_ad_groups_get",
    description: "Получить одну ad group по ID.",
    inputSchema: {
      type: "object",
      properties: {
        ad_group_id: { type: "integer", description: "ID ad group" },
        fields: fieldsProp,
      },
      required: ["ad_group_id"],
    },
    handler: (client, args) =>
      client.get(
        `/api/v2/ad_groups/${requireId(args.ad_group_id, "ad_group_id")}.json`,
        { fields: args.fields }
      ),
  });

  registry.register({
    name: "vk_ads_ad_groups_create",
    description:
      "Создать ad group. payload должен включать campaign_id, name, targetings и настройки ставок.",
    inputSchema: {
      type: "object",
      properties: {
        payload: {
          type: "object",
          description: "Объект AdGroup по схеме VK Ads (campaign_id, name, targetings…)",
        },
      },
      required: ["payload"],
    },
    handler: (client, args) => client.post("/api/v2/ad_groups.json", args.payload),
  });

  registry.register({
    name: "vk_ads_ad_groups_update",
    description: "Обновить ad group. PATCH-семантика: только изменяемые поля.",
    inputSchema: {
      type: "object",
      properties: {
        ad_group_id: { type: "integer", description: "ID ad group" },
        payload: { type: "object", description: "Изменяемые поля AdGroup" },
      },
      required: ["ad_group_id", "payload"],
    },
    handler: (client, args) =>
      client.post(
        `/api/v2/ad_groups/${requireId(args.ad_group_id, "ad_group_id")}.json`,
        args.payload
      ),
  });

  registry.register({
    name: "vk_ads_ad_groups_delete",
    description: "Мягко удалить ad group — выставляет status=deleted.",
    inputSchema: {
      type: "object",
      properties: {
        ad_group_id: { type: "integer", description: "ID ad group" },
      },
      required: ["ad_group_id"],
    },
    handler: (client, args) =>
      client.post(
        `/api/v2/ad_groups/${requireId(args.ad_group_id, "ad_group_id")}.json`,
        { status: "deleted" }
      ),
  });
}
