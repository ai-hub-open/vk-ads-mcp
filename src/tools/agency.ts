// Агентские сценарии: клиенты под агентским аккаунтом.

import type { ToolRegistry } from "../toolRegistry.ts";
import { paginationProps } from "./util.ts";

export function registerAgency(registry: ToolRegistry): void {
  registry.register({
    name: "vk_ads_agency_clients_list",
    description: "Список клиентов, управляемых агентским аккаунтом.",
    inputSchema: { type: "object", properties: { ...paginationProps } },
    handler: (client, args) =>
      client.get("/api/v2/agency/clients.json", {
        limit: args.limit ?? 50,
        offset: args.offset ?? 0,
      }),
  });

  registry.register({
    name: "vk_ads_agency_clients_create",
    description: "Создать нового клиента под агентством.",
    inputSchema: {
      type: "object",
      properties: {
        payload: { type: "object", description: "Объект AgencyClient по схеме VK Ads" },
      },
      required: ["payload"],
    },
    handler: (client, args) => client.post("/api/v2/agency/clients.json", args.payload),
  });
}
