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

interface PackageItem {
  id: number;
  name?: string;
  objective?: string[];
  status?: string;
  price?: string;
  priced_event_type?: string;
  banner_format_id?: number;
  max_banners_in_one_campaign?: number;
}

/** Пакет без описаний и служебных деревьев — иначе ответ на сотни килобайт. */
function compactPackage(p: PackageItem): PackageItem {
  return {
    id: p.id,
    name: p.name,
    objective: p.objective,
    status: p.status,
    price: p.price,
    priced_event_type: p.priced_event_type,
    banner_format_id: p.banner_format_id,
    max_banners_in_one_campaign: p.max_banners_in_one_campaign,
  };
}

// /api/v2/regions.json отдаёт всё дерево (~5,5 тыс. записей) одним ответом и
// не поддерживает ни серверный поиск, ни пагинацию (проверено против живого
// API). Кэшируем дерево в памяти процесса и ищем по подстроке на клиенте.
// Справочник публичный и одинаков для всех арендаторов, поэтому ключ — только
// базовый URL; секретов в кэше нет.
const REGIONS_TTL_MS = 60 * 60 * 1000;
/** Потолок на число баз API — чтобы кэш не рос от произвольных X-VK-Ads-Base-Url. */
const REGIONS_MAX_BASES = 8;
const regionsCache = new Map<string, { fetchedAt: number; items: RegionItem[] }>();

/** Сбрасывает кэш дерева регионов (для тестов). */
export function clearRegionsCache(): void {
  regionsCache.clear();
}

async function loadRegions(client: VKAdsClient): Promise<RegionItem[]> {
  // Язык — часть ключа: названия локализуются, и дерево на разных языках разное.
  const key = `${client.baseUrl}|${client.language}`;
  const cached = regionsCache.get(key);
  if (cached && Date.now() - cached.fetchedAt < REGIONS_TTL_MS) return cached.items;

  const data = await client.get("/api/v2/regions.json");
  const items: RegionItem[] = Array.isArray(data?.items) ? data.items : [];
  regionsCache.set(key, { fetchedAt: Date.now(), items });

  if (regionsCache.size > REGIONS_MAX_BASES) {
    const oldest = [...regionsCache.entries()].sort(
      (a, b) => a[1].fetchedAt - b[1].fetchedAt
    )[0];
    if (oldest) regionsCache.delete(oldest[0]);
  }
  return items;
}

export function registerDictionaries(registry: ToolRegistry): void {
  registry.register({
    name: "vk_ads_packages_list",
    description:
      "Список рекламных пакетов (форматы объявлений и места размещения). " +
      "package_id обязателен при создании campaign. Полный список — около 170 " +
      "пакетов и сотни килобайт, поэтому по умолчанию возвращаются только " +
      "ключевые поля; фильтруйте по objective (цели кампании). Доступные " +
      "значения objective приходят в поле available_objectives.",
    inputSchema: {
      type: "object",
      properties: {
        objective: {
          type: "string",
          description:
            "Фильтр по цели: appinstalls, site_conversions, leadads, socialengagement и др.",
        },
        query: {
          type: "string",
          description: "Фильтр по подстроке в названии пакета (опционально)",
        },
        full: {
          type: "boolean",
          description: "Вернуть все поля пакета — ответ очень большой",
          default: false,
        },
      },
    },
    handler: async (client, args) => {
      const data = await client.get("/api/v2/packages.json");
      const all: PackageItem[] = Array.isArray(data?.items) ? data.items : [];

      const availableObjectives = [
        ...new Set(all.flatMap((p) => p.objective ?? [])),
      ].sort();

      let items = all;
      if (args.objective) {
        const want = String(args.objective).toLowerCase();
        items = items.filter((p) =>
          (p.objective ?? []).some((o) => String(o).toLowerCase() === want)
        );
      }
      if (args.query) {
        const q = String(args.query).toLowerCase();
        items = items.filter((p) => p.name?.toLowerCase().includes(q));
      }

      return {
        count: items.length,
        total_packages: all.length,
        available_objectives: availableObjectives,
        items: args.full ? items : items.map(compactPackage),
      };
    },
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
      "Получить справочник VK Ads по имени: запрашивает /api/v2/<имя>.json. " +
      "Проверены и работают: currencies (валюты и минимальные бюджеты), " +
      "countries (страны), regions (полное дерево регионов — большое, для поиска " +
      "лучше vk_ads_regions_search). Многие ожидаемые имена в API отсутствуют и " +
      "отвечают 404 — в частности interests, sectors, browsers, languages, os.",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Имя справочника: currencies, countries, regions",
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
