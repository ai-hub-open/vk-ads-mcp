// Ремаркетинг VK Ads: сегменты аудиторий, пиксели (счётчики) и
// пользовательские списки (хэши email/телефонов).
//
// Примечание: в VK Ads API аудитории — это «сегменты» (/api/v2/remarketing/segments);
// эндпоинтов remarketing/groups и remarketing/lookalike в живом API нет
// (проверено против ads.vk.com).

import type { ToolRegistry } from "../toolRegistry.ts";
import {
  idPayloadSchema,
  idSchema,
  paginationParams,
  paginationProps,
  payloadSchema,
  requireId,
} from "./util.ts";

export function registerRemarketing(registry: ToolRegistry): void {
  // --- Сегменты аудиторий -----------------------------------------------------

  registry.register({
    name: "vk_ads_remarketing_segments_list",
    description:
      "Список сегментов аудиторий (ремаркетинг). Сегменты используются в " +
      "таргетингах campaign/ad group.",
    inputSchema: { type: "object", properties: { ...paginationProps } },
    handler: (client, args) =>
      client.get("/api/v2/remarketing/segments.json", paginationParams(args)),
  });

  registry.register({
    name: "vk_ads_remarketing_segments_create",
    description:
      "Создать сегмент аудитории. payload: name, pass_condition (сколько условий " +
      "должно сработать), relations — массив источников вида " +
      "{object_type: \"remarketing_users_list\"|\"remarketing_counter\"|…, params: {...}}.",
    inputSchema: payloadSchema("Объект Segment по схеме VK Ads"),
    handler: (client, args) =>
      client.post("/api/v2/remarketing/segments.json", args.payload),
  });

  registry.register({
    name: "vk_ads_remarketing_segments_update",
    description: "Обновить сегмент аудитории.",
    inputSchema: idPayloadSchema("segment_id", "ID сегмента", "Изменяемые поля"),
    handler: (client, args) =>
      client.post(
        `/api/v2/remarketing/segments/${requireId(args.segment_id, "segment_id")}.json`,
        args.payload
      ),
  });

  registry.register({
    name: "vk_ads_remarketing_segments_delete",
    description: "Удалить сегмент аудитории.",
    inputSchema: idSchema("segment_id", "ID сегмента"),
    handler: (client, args) =>
      client.delete(
        `/api/v2/remarketing/segments/${requireId(args.segment_id, "segment_id")}.json`
      ),
  });

  // --- Пиксели (счётчики) -----------------------------------------------------

  registry.register({
    name: "vk_ads_remarketing_pixels_list",
    description: "Список пикселей ремаркетинга (счётчиков отслеживания).",
    inputSchema: { type: "object", properties: { ...paginationProps } },
    handler: (client, args) =>
      client.get("/api/v2/remarketing/counters.json", paginationParams(args)),
  });

  registry.register({
    name: "vk_ads_remarketing_pixels_create",
    description: "Создать пиксель ремаркетинга (счётчик отслеживания).",
    inputSchema: payloadSchema("Объект Counter по схеме VK Ads"),
    handler: (client, args) =>
      client.post("/api/v2/remarketing/counters.json", args.payload),
  });

  registry.register({
    name: "vk_ads_remarketing_pixels_delete",
    description: "Удалить пиксель ремаркетинга.",
    inputSchema: idSchema("pixel_id", "ID пикселя"),
    handler: (client, args) =>
      client.delete(
        `/api/v2/remarketing/counters/${requireId(args.pixel_id, "pixel_id")}.json`
      ),
  });

  // --- Пользовательские списки (хэши email/телефонов) -------------------------

  registry.register({
    name: "vk_ads_users_lists_list",
    description:
      "Список пользовательских аудиторий-списков (загруженные сегменты хэшей email/телефонов).",
    inputSchema: { type: "object", properties: { ...paginationProps } },
    handler: (client, args) =>
      client.get("/api/v2/remarketing/users_lists.json", paginationParams(args)),
  });

  registry.register({
    name: "vk_ads_users_lists_create",
    description:
      "Создать аудиторию-список. payload обычно: {\"name\": \"...\", \"type\": " +
      "\"email\"|\"phone\"|\"idfa\"|\"gaid\"}. Далее элементы загружаются через " +
      "vk_ads_users_lists_upload_items.",
    inputSchema: payloadSchema("Объект UsersList по схеме VK Ads"),
    handler: (client, args) =>
      client.post("/api/v2/remarketing/users_lists.json", args.payload),
  });

  registry.register({
    name: "vk_ads_users_lists_upload_items",
    description:
      "Добавить хэшированные идентификаторы (email/телефоны) в аудиторию-список.",
    inputSchema: {
      type: "object",
      properties: {
        users_list_id: { type: "integer", description: "ID списка" },
        items: {
          type: "array",
          items: { type: "string" },
          description: "Хэшированные идентификаторы",
        },
      },
      required: ["users_list_id", "items"],
    },
    handler: (client, args) =>
      client.post(
        `/api/v2/remarketing/users_lists/${requireId(args.users_list_id, "users_list_id")}/items.json`,
        { items: args.items }
      ),
  });

  registry.register({
    name: "vk_ads_users_lists_delete",
    description: "Удалить аудиторию-список.",
    inputSchema: idSchema("users_list_id", "ID списка"),
    handler: (client, args) =>
      client.delete(
        `/api/v2/remarketing/users_lists/${requireId(args.users_list_id, "users_list_id")}.json`
      ),
  });
}
