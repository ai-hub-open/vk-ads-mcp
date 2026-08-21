// Banners в терминах VK Ads API = «Объявления» в новом UI ads.vk.com.
//
// Отдельного создания объявления в API нет: `POST /api/v2/banners.json`
// отвечает 405 `unsupported_http_method` с `supported_methods: ["GET"]`.
// Объявления заводятся вложенным массивом `banners` внутри campaign — см.
// vk_ads_campaigns_create. Маршрута `/banners/{id}/moderate.json` тоже нет
// (проверено против ads.vk.com: отвечает как несуществующий путь).

import type { ToolRegistry } from "../toolRegistry.ts";
import {
  SOFT_DELETE_BODY,
  fieldsProp,
  idPayloadSchema,
  idSchema,
  paginationParams,
  paginationProps,
  requireId,
} from "./util.ts";

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
        ...paginationParams(args),
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
    name: "vk_ads_banners_update",
    description:
      "Обновить banner (UI «Объявление»): статус, ссылки, тексты, ссылки на креативы.",
    inputSchema: idPayloadSchema("banner_id", "ID banner", "Изменяемые поля Banner"),
    handler: (client, args) =>
      client.post(
        `/api/v2/banners/${requireId(args.banner_id, "banner_id")}.json`,
        args.payload
      ),
  });

  registry.register({
    name: "vk_ads_banners_delete",
    description: "Мягко удалить banner (UI «Объявление») — выставляет status=deleted.",
    inputSchema: idSchema("banner_id", "ID banner"),
    handler: (client, args) =>
      client.post(
        `/api/v2/banners/${requireId(args.banner_id, "banner_id")}.json`,
        SOFT_DELETE_BODY
      ),
  });
}
