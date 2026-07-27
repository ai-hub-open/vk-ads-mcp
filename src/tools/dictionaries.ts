// Справочники VK Ads: пакеты форматов, регионы и произвольные словари.

import type { VKAdsClient } from "../client.ts";
import type { ToolRegistry } from "../toolRegistry.ts";
import { pathSegment } from "./util.ts";

interface RegionItem {
  id: number;
  name: string;
  parent_id?: number;
  flags?: string[];
}

// /api/v2/regions.json отдаёт всё дерево (~5,5 тыс. записей) одним ответом и
// не поддерживает ни серверный поиск, ни пагинацию (проверено против живого
// API). Кэшируем дерево в памяти процесса и ищем по подстроке на клиенте.
const REGIONS_TTL_MS = 60 * 60 * 1000;
const regionsCache = new Map<string, { fetchedAt: number; items: RegionItem[] }>();

/** Сбрасывает кэш дерева регионов (для тестов). */
export function clearRegionsCache(): void {
  regionsCache.clear();
}

async function loadRegions(client: VKAdsClient): Promise<RegionItem[]> {
  const key = client.baseUrl;
  const cached = regionsCache.get(key);
  if (cached && Date.now() - cached.fetchedAt < REGIONS_TTL_MS) return cached.items;

  const data = await client.get("/api/v2/regions.json");
  const items: RegionItem[] = Array.isArray(data?.items) ? data.items : [];
  regionsCache.set(key, { fetchedAt: Date.now(), items });
  return items;
}

export function registerDictionaries(registry: ToolRegistry): void {
  registry.register({
    name: "vk_ads_packages_list",
    description:
      "Список доступных рекламных пакетов (форматы объявлений / места размещения). " +
      "package_id нужен при создании campaign.",
    inputSchema: { type: "object", properties: {} },
    handler: (client) => client.get("/api/v2/packages.json"),
  });

  registry.register({
    name: "vk_ads_regions_search",
    description:
      "Поиск гео-регионов для таргетинга (города, области, страны) по названию. " +
      "Ищет по полному дереву регионов VK Ads (кэшируется на 1 час). " +
      "Возвращает id, name, parent_id найденных регионов.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Поисковый запрос (часть названия региона)" },
        limit: {
          type: "integer",
          description: "Макс. количество результатов (по умолч. 20)",
          default: 20,
        },
      },
      required: ["query"],
    },
    handler: async (client, args) => {
      const query = String(args.query ?? "").trim().toLowerCase();
      if (!query) {
        return { error: true, detail: "Пустой поисковый запрос" };
      }
      const limit = Number(args.limit ?? 20);
      const items = await loadRegions(client);
      const matches = items.filter((r) => r.name?.toLowerCase().includes(query));
      return {
        count: matches.length,
        items: matches.slice(0, limit),
        total_regions: items.length,
      };
    },
  });

  registry.register({
    name: "vk_ads_dictionary_get",
    description:
      "Получить произвольный справочник VK Ads по имени. Примеры: " +
      "interests → /api/v2/interests.json, browsers → /api/v2/browsers.json, " +
      "currencies → /api/v2/currencies.json, sectors → /api/v2/sectors.json.",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Имя справочника (interests, browsers, currencies, sectors…)",
        },
        params: {
          type: "object",
          description: "Дополнительные query-параметры (опционально)",
        },
      },
      required: ["name"],
    },
    handler: (client, args) => {
      const name = pathSegment(args.name, "name");
      const params =
        args.params && typeof args.params === "object"
          ? (args.params as Record<string, unknown>)
          : undefined;
      return client.get(`/api/v2/${name}.json`, params);
    },
  });
}
