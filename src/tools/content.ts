// Контент-хранилище VK Ads: загрузка изображений и видео для баннеров.
//
// Источник задаёт модель, поэтому доступ ограничен политикой клиента:
//   — allowLocalFiles: чтение с диска (для stdio это файлы самого пользователя;
//     размещённый HTTP-сервер обязан запрещать — иначе вызывающий прочитает
//     файлы сервера);
//   — allowPrivateNetwork: обращения во внутреннюю сеть при загрузке по URL
//     (защита от SSRF, см. src/urlGuard.ts).
//
// Примечание: эндпоинты /api/v2/content/{static,video,html5}.json принимают
// только POST (загрузка) — листинга загруженного контента в живом API нет
// (GET отвечает 405, проверено против ads.vk.com).

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";

import type { VKAdsClient } from "../client.ts";
import type { ToolRegistry } from "../toolRegistry.ts";
import { fetchGuarded } from "../urlGuard.ts";

/** Читает источник: локальный путь (с поддержкой ~) или публичный http(s)-URL. */
async function readSource(
  client: VKAdsClient,
  source: string,
  fallbackName: string
): Promise<{ bytes: Uint8Array; filename: string }> {
  // Схема из двух и более букв: односимвольная — это диск Windows (C:\...),
  // а не URL. Всё, что похоже на схему, уходит в fetchGuarded — он отсеет
  // file:, gopher: и прочее, что до сети доходить не должно.
  if (/^[a-z][a-z0-9+.-]+:/i.test(source)) {
    const { bytes, filename } = await fetchGuarded(source, {
      timeoutMs: client.timeoutMs,
      allowPrivateNetwork: client.allowPrivateNetwork,
    });
    return { bytes, filename: filename || fallbackName };
  }

  if (!client.allowLocalFiles) {
    throw new Error(
      "Чтение локальных файлов отключено на этом сервере. Передайте публичный " +
        "http(s)-URL креатива."
    );
  }

  let path = source;
  if (path === "~") path = homedir();
  else if (path.startsWith("~/") || path.startsWith("~\\")) {
    path = join(homedir(), path.slice(2));
  }
  const bytes = await readFile(path);
  return { bytes, filename: basename(path) || fallbackName };
}

async function upload(
  client: VKAdsClient,
  endpoint: string,
  source: unknown,
  fallbackName: string
): Promise<unknown> {
  const { bytes, filename } = await readSource(client, String(source), fallbackName);
  return client.uploadFile(endpoint, filename, bytes);
}

export function registerContent(registry: ToolRegistry): void {
  registry.register({
    name: "vk_ads_content_upload_image",
    description:
      "Загрузить статичное изображение в хранилище контента VK Ads. Источник — " +
      "публичный http(s)-URL или локальный путь (если сервер разрешает чтение " +
      "файлов). Возвращает объект контента (id, url, размеры) для использования " +
      "в banner (content.image_id).",
    inputSchema: {
      type: "object",
      properties: {
        source_path_or_url: {
          type: "string",
          description: "http(s)-URL изображения или локальный путь к файлу",
        },
      },
      required: ["source_path_or_url"],
    },
    handler: (client, args) =>
      upload(client, "/api/v2/content/static.json", args.source_path_or_url, "image"),
  });

  registry.register({
    name: "vk_ads_content_upload_video",
    description:
      "Загрузить видео в хранилище контента VK Ads. Источник — публичный " +
      "http(s)-URL или локальный путь (если сервер разрешает чтение файлов). " +
      "Возвращает объект контента для использования в banner.",
    inputSchema: {
      type: "object",
      properties: {
        source_path_or_url: {
          type: "string",
          description: "http(s)-URL видеофайла или локальный путь к файлу",
        },
      },
      required: ["source_path_or_url"],
    },
    handler: (client, args) =>
      upload(client, "/api/v2/content/video.json", args.source_path_or_url, "video.mp4"),
  });
}
