// Banners в терминах VK Ads API = «Объявления» в новом UI ads.vk.com.

import type { ToolRegistry } from "../toolRegistry.ts";
import { fieldsProp, paginationProps, requireId } from "./util.ts";

export function registerBanners(registry: ToolRegistry): void {
  registry.register({
    name: "vk_ads_banners_list",
    description:
      "Список banner-сущностей VK Ads API — в интерфейсе ads.vk.com это «Объявления». " +
      "Можно фильтровать по campaign_id и/или ad_group_id.",
    inputSchema: {
      type: "object",
      properties: {
        campaign_id: {
          type: "integer",
          description: "Фильтр по ID campaign (опционально)",
        },
        ad_group_id: {
          type: "integer",
          description: "Фильтр по ID ad group (опционально)",
        },
        ...paginationProps,
        fields: fieldsProp,
      },
    },
    handler: (client, args) =>
      client.get("/api/v2/banners.json", {
        _campaign_id: args.campaign_id,
        _ad_group_id: args.ad_group_id,
        limit: args.limit ?? 50,
        offset: args.offset ?? 0,
        fields: args.fields,
      }),
  });

  registry.register({
    name: "vk_ads_banners_get",
    description: "Получить один banner (UI «Объявление») по ID.",
    inputSchema: {
      type: "object",
      properties: {
        banner_id: { type: "integer", description: "ID banner" },
        fields: fieldsProp,
      },
      required: ["banner_id"],
    },
    handler: (client, args) =>
      client.get(`/api/v2/banners/${requireId(args.banner_id, "banner_id")}.json`, {
        fields: args.fields,
      }),
  });

  registry.register({
    name: "vk_ads_banners_create",
    description:
      "Создать banner (UI «Объявление»). payload должен включать ad_group_id, urls, " +
      "textblocks и ссылки на контент (например content.image_id из " +
      "vk_ads_content_upload_image). См. схему Banner VK Ads.",
    inputSchema: {
      type: "object",
      properties: {
        payload: {
          type: "object",
          description:
            "Объект Banner по схеме VK Ads (ad_group_id, urls, textblocks, content…)",
        },
      },
      required: ["payload"],
    },
    handler: (client, args) => client.post("/api/v2/banners.json", args.payload),
  });

  registry.register({
    name: "vk_ads_banners_update",
    description:
      "Обновить banner (UI «Объявление»): статус, ссылки, тексты, ссылки на креативы.",
    inputSchema: {
      type: "object",
      properties: {
        banner_id: { type: "integer", description: "ID banner" },
        payload: { type: "object", description: "Изменяемые поля Banner" },
      },
      required: ["banner_id", "payload"],
    },
    handler: (client, args) =>
      client.post(
        `/api/v2/banners/${requireId(args.banner_id, "banner_id")}.json`,
        args.payload
      ),
  });

  registry.register({
    name: "vk_ads_banners_moderate",
    description: "Отправить banner (UI «Объявление») на модерацию.",
    inputSchema: {
      type: "object",
      properties: {
        banner_id: { type: "integer", description: "ID banner" },
      },
      required: ["banner_id"],
    },
    handler: (client, args) =>
      client.post(
        `/api/v2/banners/${requireId(args.banner_id, "banner_id")}/moderate.json`
      ),
  });

  registry.register({
    name: "vk_ads_banners_delete",
    description: "Мягко удалить banner (UI «Объявление») — выставляет status=deleted.",
    inputSchema: {
      type: "object",
      properties: {
        banner_id: { type: "integer", description: "ID banner" },
      },
      required: ["banner_id"],
    },
    handler: (client, args) =>
      client.post(`/api/v2/banners/${requireId(args.banner_id, "banner_id")}.json`, {
        status: "deleted",
      }),
  });
}
