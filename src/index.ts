#!/usr/bin/env bun
import { VKAdsClient } from "./client.ts";
import { McpServer } from "./server.ts";
import { loadEnv } from "./loadEnv.ts";
import { readEnvCreds } from "./envConfig.ts";
import { runStdio } from "./transports/stdio.ts";
import { runHttp } from "./transports/http.ts";

const envPath = loadEnv();
if (envPath) {
  process.stderr.write(`Загружен .env: ${envPath}\n`);
}

const creds = readEnvCreds();
for (const w of creds.warnings) {
  process.stderr.write(`Warning: ${w}\n`);
}

// Креды из .env — используются как default для запросов без per-request заголовков.
// В multi-tenant HTTP-режиме default может отсутствовать; тогда каждый клиент должен
// передавать свои X-VK-Ads-* / X-Click-Ru-* заголовки.
let defaultClient: VKAdsClient | undefined;

if (creds.hasAny) {
  try {
    defaultClient = new VKAdsClient(creds.options);
    process.stderr.write(`Режим по умолчанию: ${creds.mode}\n`);
  } catch (e) {
    process.stderr.write(`Ошибка инициализации клиента: ${(e as Error).message}\n`);
    process.exit(1);
  }
} else {
  process.stderr.write(
    "Клиент по умолчанию не сконфигурирован. HTTP-запросы должны передавать креды " +
      "в заголовках (X-VK-Ads-Token, X-VK-Ads-Client-Id + X-VK-Ads-Client-Secret " +
      "или X-Click-Ru-Token + X-Click-Ru-Account-Id).\n"
  );
}

const server = new McpServer(defaultClient);

const transport =
  process.argv.includes("--http")
    ? "http"
    : (process.env.MCP_TRANSPORT ?? "stdio").toLowerCase();

if (transport === "http") {
  const port = parseInt(process.env.MCP_PORT ?? "3000", 10);
  const host = process.env.MCP_HOST ?? "0.0.0.0";
  const authToken = process.env.MCP_AUTH_TOKEN || undefined;
  const allowedOrigin = process.env.MCP_ALLOWED_ORIGIN || undefined;
  runHttp(server, { port, host, authToken, allowedOrigin });
} else {
  await runStdio(server);
}
