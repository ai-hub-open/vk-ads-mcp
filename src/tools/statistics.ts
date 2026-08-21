// Статистика VK Ads: дневная, суммарная и срезы по измерениям.
//
// Асинхронных отчётов в API нет: /api/v2/statistics/reports.json отвечает
// 404 WRONG_RESOURCE и на GET, и на POST (проверено против ads.vk.com).

import type { ToolRegistry } from "../toolRegistry.ts";
import { pathSegment } from "./util.ts";

const STAT_ENTITIES = ["campaigns", "ad_groups", "banners", "users"] as const;
const BREAKDOWN_ENTITIES = ["campaigns", "ad_groups", "banners"] as const;
const BREAKDOWNS = ["age", "gender", "region", "placement", "os", "device_type"] as const;

const entityProp = {
  type: "string",
  enum: [...STAT_ENTITIES],
  description: "Тип сущности: campaigns, ad_groups, banners или users",
} as const;

const idsProp = {
  type: "string",
  description: "ID сущностей через запятую, например \"123,456\"",
} as const;

const metricsProp = {
  type: "string",
  description: "Группа метрик: base, events, video, uniques, all и др. (опционально)",
} as const;

export function registerStatistics(registry: ToolRegistry): void {
  registry.register({
    name: "vk_ads_statistics_day",
    description:
      "Дневная статистика по campaigns / ad_groups / banners / users за период. " +
      "Возвращает показатели по дням (показы, клики, расход и др.).",
    inputSchema: {
      type: "object",
      properties: {
        entity: entityProp,
        ids: idsProp,
        date_from: { type: "string", description: "Начало периода (YYYY-MM-DD)" },
        date_to: { type: "string", description: "Конец периода (YYYY-MM-DD)" },
        metrics: metricsProp,
      },
      required: ["entity", "ids", "date_from", "date_to"],
    },
    handler: (client, args) => {
      const entity = pathSegment(args.entity, "entity", STAT_ENTITIES);
      return client.get(`/api/v2/statistics/${entity}/day.json`, {
        id: args.ids,
        date_from: args.date_from,
        date_to: args.date_to,
        metrics: args.metrics,
      });
    },
  });

  registry.register({
    name: "vk_ads_statistics_summary",
    description:
      "Суммарная (агрегированная) статистика за период по campaigns / ad_groups / " +
      "banners / users. Без date_from/date_to — за всё время.",
    inputSchema: {
      type: "object",
      properties: {
        entity: entityProp,
        ids: idsProp,
        date_from: { type: "string", description: "Начало периода (YYYY-MM-DD, опционально)" },
        date_to: { type: "string", description: "Конец периода (YYYY-MM-DD, опционально)" },
        metrics: metricsProp,
      },
      required: ["entity", "ids"],
    },
    handler: (client, args) => {
      const entity = pathSegment(args.entity, "entity", STAT_ENTITIES);
      return client.get(`/api/v2/statistics/${entity}/summary.json`, {
        id: args.ids,
        date_from: args.date_from,
        date_to: args.date_to,
        metrics: args.metrics,
      });
    },
  });

  registry.register({
    name: "vk_ads_statistics_breakdown",
    description:
      "Статистика в разрезе измерения: age, gender, region, placement, os, device_type. " +
      "По campaigns / ad_groups / banners за период.",
    inputSchema: {
      type: "object",
      properties: {
        entity: {
          type: "string",
          enum: [...BREAKDOWN_ENTITIES],
          description: "Тип сущности: campaigns, ad_groups или banners",
        },
        ids: idsProp,
        date_from: { type: "string", description: "Начало периода (YYYY-MM-DD)" },
        date_to: { type: "string", description: "Конец периода (YYYY-MM-DD)" },
        group_by: {
          type: "string",
          enum: [...BREAKDOWNS],
          description: "Измерение среза",
        },
        metrics: metricsProp,
      },
      required: ["entity", "ids", "date_from", "date_to", "group_by"],
    },
    handler: (client, args) => {
      const entity = pathSegment(args.entity, "entity", BREAKDOWN_ENTITIES);
      const groupBy = pathSegment(args.group_by, "group_by", BREAKDOWNS);
      return client.get(`/api/v2/statistics/${entity}/${groupBy}.json`, {
        id: args.ids,
        date_from: args.date_from,
        date_to: args.date_to,
        metrics: args.metrics,
      });
    },
  });

}
