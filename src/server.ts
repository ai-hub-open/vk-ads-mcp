// MCP сервер — чистая логика JSON-RPC, без транспорта.
// Транспорты (stdio, HTTP) находятся в src/transports/*.ts
import { VKAdsError, type VKAdsClient } from "./client.ts";
import { ToolRegistry } from "./toolRegistry.ts";
import { registerAuth } from "./tools/auth.ts";
import { registerAdPlans } from "./tools/adPlans.ts";
import { registerCampaigns } from "./tools/campaigns.ts";
import { registerAdGroups } from "./tools/adGroups.ts";
import { registerBanners } from "./tools/banners.ts";
import { registerContent } from "./tools/content.ts";
import { registerStatistics } from "./tools/statistics.ts";
import { registerRemarketing } from "./tools/remarketing.ts";
import { registerAgency } from "./tools/agency.ts";
import { registerDictionaries } from "./tools/dictionaries.ts";
import { SERVER_NAME, VERSION } from "./version.ts";

export const PROTOCOL_VERSION = "2024-11-05";

export interface JsonRpcRequest {
  jsonrpc?: string;
  id?: number | string | null;
  method?: string;
  params?: any;
}

export class McpServer {
  private registry = new ToolRegistry();
  private readonly defaultClient?: VKAdsClient;

  /**
   * `defaultClient` может отсутствовать — тогда каждый tools/call ДОЛЖЕН
   * приходить с per-request клиентом (multi-tenant HTTP режим).
   */
  constructor(defaultClient?: VKAdsClient) {
    this.defaultClient = defaultClient;
    this.registerAll();
  }

  private registerAll(): void {
    registerAuth(this.registry);
    registerAdPlans(this.registry);
    registerCampaigns(this.registry);
    registerAdGroups(this.registry);
    registerBanners(this.registry);
    registerContent(this.registry);
    registerStatistics(this.registry);
    registerRemarketing(this.registry);
    registerAgency(this.registry);
    registerDictionaries(this.registry);
  }

  /**
   * Обрабатывает один JSON-RPC запрос. Возвращает объект-ответ или null
   * для нотификаций (JSON-RPC сообщения без `id`).
   *
   * `clientOverride` позволяет подменить клиент на per-request (multi-tenant).
   */
  async handle(
    request: JsonRpcRequest,
    clientOverride?: VKAdsClient
  ): Promise<object | null> {
    const id = request.id ?? null;
    const method = request.method;
    const params = request.params ?? {};

    try {
      switch (method) {
        case "initialize":
          return jsonrpcResponse(id, {
            protocolVersion: PROTOCOL_VERSION,
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: SERVER_NAME, version: VERSION },
          });
        case "notifications/initialized":
          return null;
        case "tools/list":
          return jsonrpcResponse(id, { tools: this.registry.toolDefinitions() });
        case "tools/call":
          return await this.handleToolCall(id, params, clientOverride);
        case "ping":
          return jsonrpcResponse(id, {});
        default:
          return errorResponse(id, -32601, `Method not found: ${method}`);
      }
    } catch (e) {
      const err = e as Error;
      process.stderr.write(
        `Error: ${err.message}\n${err.stack?.split("\n").slice(0, 5).join("\n")}\n`
      );
      return errorResponse(id, -32603, `Internal error: ${err.message}`);
    }
  }

  private async handleToolCall(
    id: any,
    params: any,
    clientOverride?: VKAdsClient
  ): Promise<object> {
    const toolName = params?.name;
    let argumentsRaw = params?.arguments ?? {};
    if (typeof argumentsRaw === "string") {
      try {
        argumentsRaw = JSON.parse(argumentsRaw);
      } catch {
        // leave as-is
      }
    }
    const args = deepNormalize(argumentsRaw);

    const tool = this.registry.find(toolName);
    if (!tool) {
      return jsonrpcResponse(id, {
        content: [{ type: "text", text: `Инструмент '${toolName}' не найден` }],
        isError: true,
      });
    }

    const client = clientOverride ?? this.defaultClient;
    if (!client) {
      return jsonrpcResponse(id, {
        content: [
          {
            type: "text",
            text:
              "Не заданы креды VK Ads. Передайте в заголовках HTTP: " +
              "X-VK-Ads-Token (готовый токен), " +
              "X-VK-Ads-Client-Id + X-VK-Ads-Client-Secret (OAuth client credentials) " +
              "или X-Click-Ru-Token + X-Click-Ru-Account-Id (токен через Click.ru).",
          },
        ],
        isError: true,
      });
    }

    try {
      const result = await tool.handler(client, args as Record<string, any>);
      const text = typeof result === "string" ? result : JSON.stringify(result, null, 2);
      return jsonrpcResponse(id, { content: [{ type: "text", text }] });
    } catch (e) {
      // Ошибки VK Ads API отдаём структурированно — тем же форматом,
      // что python-версия ({error, status, url, detail}).
      if (e instanceof VKAdsError) {
        const errObj = { error: true, status: e.status, url: e.url, detail: e.payload };
        return jsonrpcResponse(id, {
          content: [{ type: "text", text: JSON.stringify(errObj, null, 2) }],
          isError: true,
        });
      }
      return jsonrpcResponse(id, {
        content: [{ type: "text", text: `Ошибка: ${(e as Error).message}` }],
        isError: true,
      });
    }
  }
}

export function jsonrpcResponse(id: any, result: any): object {
  return { jsonrpc: "2.0", id, result };
}

export function errorResponse(id: any, code: number, message: string): object {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

// Рекурсивно парсит строки-JSON в массивы/объекты: некоторые MCP-клиенты
// передают вложенные аргументы сериализованными.
export function deepNormalize(obj: unknown): unknown {
  if (typeof obj === "string") {
    try {
      const parsed = JSON.parse(obj);
      if (Array.isArray(parsed) || (parsed && typeof parsed === "object")) {
        return deepNormalize(parsed);
      }
    } catch {
      // не JSON — оставляем как есть
    }
    return obj;
  }
  if (Array.isArray(obj)) return obj.map(deepNormalize);
  if (obj && typeof obj === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      out[k] = deepNormalize(v);
    }
    return out;
  }
  return obj;
}
