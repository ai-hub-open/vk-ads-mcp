// HTTP транспорт для MCP (Streamable HTTP-совместимый, упрощённый).
//
// Эндпоинты:
//   POST /mcp            — JSON-RPC запрос, ответ в теле (application/json).
//                          Можно отправлять батч — массив запросов; вернётся массив ответов.
//   GET  /healthz        — health check, возвращает 200 OK.
//   GET  /mcp/tools      — вспомогательный human-friendly список инструментов (JSON).
//
// Авторизация (опционально): если задана переменная MCP_AUTH_TOKEN,
// каждый запрос к /mcp должен содержать заголовок `Authorization: Bearer <token>`.
//
// CORS: разрешён для всех источников (*). При необходимости ограничьте в MCP_ALLOWED_ORIGIN.

import { timingSafeEqual } from "node:crypto";

import type { McpServer, JsonRpcRequest } from "../server.ts";
import { errorResponse } from "../server.ts";
import { VKAdsClient } from "../client.ts";

export interface HttpOptions {
  port: number;
  host?: string;
  authToken?: string;
  allowedOrigin?: string;
  /**
   * Разрешить эндпоинт `/t/<токен>`, который берёт access_token VK Ads прямо из
   * пути URL. Нужен клиентам, не умеющим задавать заголовки (Claude Desktop),
   * но кладёт токен в логи прокси — включается осознанно.
   */
  allowUrlCredentials?: boolean;
}

/** Разбирает `/t/<токен>[/остаток]`. */
export function extractPathToken(
  pathname: string
): { token: string; rest: string } | null {
  const m = pathname.match(/^\/t\/([^/]+)(\/.*)?$/);
  if (!m?.[1]) return null;
  return { token: decodeURIComponent(m[1]), rest: m[2] || "/" };
}

export function runHttp(server: McpServer, opts: HttpOptions) {
  const {
    port,
    host = "0.0.0.0",
    authToken,
    allowedOrigin = "*",
    allowUrlCredentials = false,
  } = opts;

  const baseHeaders: Record<string, string> = {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers":
      "Content-Type, Authorization, Mcp-Session-Id, " +
      "X-VK-Ads-Token, X-VK-Ads-Base-Url, " +
      "X-VK-Ads-Client-Id, X-VK-Ads-Client-Secret, X-VK-Ads-Agency-Client-Name, " +
      "X-Click-Ru-Token, X-Click-Ru-Account-Id, X-Click-Ru-User-Id, X-Click-Ru-Base-Url",
    "Access-Control-Expose-Headers": "Mcp-Session-Id",
  };

  const httpServer = Bun.serve({
    port,
    hostname: host,
    async fetch(req: Request): Promise<Response> {
      const url = new URL(req.url);

      // CORS preflight
      if (req.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: baseHeaders });
      }

      // Health check
      if (req.method === "GET" && url.pathname === "/healthz") {
        return new Response("OK", { status: 200, headers: baseHeaders });
      }

      // Токен VK Ads прямо в пути: /t/<токен> — эндпоинт MCP для клиентов,
      // которые не умеют слать заголовки. Сам токен и есть аутентификация,
      // поэтому токен шлюза для таких запросов не требуется.
      let pathname = url.pathname;
      let urlToken: string | undefined;
      if (allowUrlCredentials) {
        const parsed = extractPathToken(pathname);
        if (parsed) {
          urlToken = parsed.token;
          pathname = parsed.rest === "/" ? "/mcp" : parsed.rest;
        }
      }

      // Human-friendly список инструментов (без MCP, для отладки)
      if (req.method === "GET" && pathname === "/mcp/tools") {
        if (!urlToken && !checkAuth(req, authToken)) return unauthorized(baseHeaders);
        const resp = await server.handle({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/list",
        });
        return jsonResponse(resp ?? {}, baseHeaders);
      }

      // Основной MCP endpoint
      if (pathname === "/mcp") {
        if (!urlToken && !checkAuth(req, authToken)) return unauthorized(baseHeaders);

        if (req.method === "GET") {
          // Server-initiated SSE стрим не реализован (notifications/listChanged = false).
          return new Response("Method Not Allowed", { status: 405, headers: baseHeaders });
        }

        if (req.method !== "POST") {
          return new Response("Method Not Allowed", { status: 405, headers: baseHeaders });
        }

        let body: JsonRpcRequest | JsonRpcRequest[];
        try {
          body = (await req.json()) as JsonRpcRequest | JsonRpcRequest[];
        } catch (e) {
          return jsonResponse(
            errorResponse(null, -32700, `Parse error: ${(e as Error).message}`),
            baseHeaders
          );
        }

        // Per-request клиент: сначала заголовки (они конкретнее), затем токен
        // из пути. Если нет ни того ни другого — сервер возьмёт default из .env.
        let clientOverride: VKAdsClient | undefined;
        try {
          clientOverride = buildClientFromHeaders(req) ?? buildClientFromUrlToken(urlToken);
        } catch (e) {
          return jsonResponse(
            errorResponse(null, -32602, `Invalid credentials headers: ${(e as Error).message}`),
            baseHeaders
          );
        }

        // Поддержка батча
        if (Array.isArray(body)) {
          const results = await Promise.all(body.map((r) => server.handle(r, clientOverride)));
          const filtered = results.filter((r): r is object => r !== null);
          return jsonResponse(filtered, baseHeaders);
        }

        const response = await server.handle(body, clientOverride);
        if (!response) {
          // нотификация — пустой 204
          return new Response(null, { status: 204, headers: baseHeaders });
        }
        return jsonResponse(response, baseHeaders);
      }

      return new Response("Not Found", { status: 404, headers: baseHeaders });
    },
    error(e: Error): Response {
      process.stderr.write(`HTTP error: ${e.message}\n`);
      return new Response("Internal Server Error", { status: 500, headers: baseHeaders });
    },
  });

  const authInfo = authToken ? " (с авторизацией)" : " (без авторизации!)";
  process.stderr.write(
    `VK Ads MCP Server запущен на http://${host}:${httpServer.port}/mcp${authInfo}\n`
  );
  if (allowUrlCredentials) {
    process.stderr.write(
      `Токен в URL включён: http://${host}:${httpServer.port}/t/<токен VK Ads> ` +
        "(токен шлюза для таких запросов не требуется)\n"
    );
  }
  return httpServer;
}

function jsonResponse(body: unknown, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...headers, "Content-Type": "application/json; charset=utf-8" },
  });
}

/**
 * Проверяет Bearer-токен шлюза. Сравнение постоянное по времени: обычный `===`
 * выходит на первом несовпавшем байте, и по задержке ответа токен можно
 * восстановить посимвольно.
 */
export function checkAuth(req: Request, expectedToken?: string): boolean {
  if (!expectedToken) return true;
  const header = req.headers.get("Authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match?.[1]) return false;
  return constantTimeEquals(match[1], expectedToken);
}

function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  // timingSafeEqual требует равной длины, а сама длина секретом не является:
  // сравниваем её отдельно, после проверки содержимого равных по длине буферов.
  if (bufA.length !== bufB.length) {
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

function unauthorized(headers: Record<string, string>): Response {
  return new Response(JSON.stringify({ error: "Unauthorized" }), {
    status: 401,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

/**
 * Читает креды VK Ads из HTTP-заголовков запроса и возвращает одноразовый
 * клиент. Если ни один из cred-заголовков не задан — возвращает undefined
 * (сервер использует клиент из .env).
 *
 * Поддерживаемые заголовки:
 *   Готовый токен:
 *     X-VK-Ads-Token: <access_token>
 *   OAuth client credentials:
 *     X-VK-Ads-Client-Id: <client_id>
 *     X-VK-Ads-Client-Secret: <client_secret>
 *     X-VK-Ads-Agency-Client-Name: <username клиента агентства>  (опционально)
 *   Токен через Click.ru:
 *     X-Click-Ru-Token: <X-Auth-Token>
 *     X-Click-Ru-Account-Id: <ID рекламного аккаунта VK Рекламы в Click.ru>
 *     X-Click-Ru-User-Id: <X-Auth-UserId>  (для мастер-аккаунта, опционально)
 *     X-Click-Ru-Base-Url: https://api.click.ru/V0  (опционально)
 *   Общее (опционально):
 *     X-VK-Ads-Base-Url: https://ads.vk.com
 */
/**
 * Клиент по токену VK Ads из пути URL. Ограничения размещённого режима те же,
 * что и для кред из заголовков: ни файлов сервера, ни внутренней сети.
 */
export function buildClientFromUrlToken(token?: string): VKAdsClient | undefined {
  if (!token) return undefined;
  return new VKAdsClient({
    accessToken: token,
    allowLocalFiles: false,
    allowPrivateNetwork: false,
  });
}

export function buildClientFromHeaders(req: Request): VKAdsClient | undefined {
  const h = req.headers;
  const token = h.get("X-VK-Ads-Token");
  const clientId = h.get("X-VK-Ads-Client-Id");
  const clientSecret = h.get("X-VK-Ads-Client-Secret");
  const crToken = h.get("X-Click-Ru-Token");
  const crAccountId = h.get("X-Click-Ru-Account-Id");

  // Ничего не передано — используем default из env
  if (!token && !clientId && !clientSecret && !crToken && !crAccountId) return undefined;

  // Валидация парных кред — внутри конструктора VKAdsClient.
  return new VKAdsClient({
    // Запрос пришёл по сети: чтение файлов сервера и обращения во внутреннюю
    // сеть запрещены независимо от настроек окружения.
    allowLocalFiles: false,
    allowPrivateNetwork: false,
    baseUrl: h.get("X-VK-Ads-Base-Url") || undefined,
    accessToken: token || undefined,
    clientId: clientId || undefined,
    clientSecret: clientSecret || undefined,
    agencyClientName: h.get("X-VK-Ads-Agency-Client-Name") || undefined,
    clickRuToken: crToken || undefined,
    clickRuAccountId: crAccountId || undefined,
    clickRuUserId: h.get("X-Click-Ru-User-Id") || undefined,
    clickRuBaseUrl: h.get("X-Click-Ru-Base-Url") || undefined,
  });
}
