// Контент-хранилище VK Ads: загрузка изображений и видео для баннеров.
//
// Примечание: эндпоинты /api/v2/content/{static,video,html5}.json принимают
// только POST (загрузка) — листинга загруженного контента в живом API нет
// (GET отвечает 405, проверено против ads.vk.com).

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";

import type { VKAdsClient } from "../client.ts";
import type { ToolRegistry } from "../toolRegistry.ts";

/** Читает источник: локальный путь (с поддержкой ~) или публичный http(s)-URL. */
async function readSource(
  source: string,
  timeoutMs: number,
  fallbackName: string
): Promise<{ bytes: Uint8Array; filename: string }> {
  if (/^https?:\/\//i.test(source)) {
    const r = await fetch(source, { signal: AbortSignal.timeout(timeoutMs) });
    if (!r.ok) {
      throw new Error(`Не удалось скачать ${source}: HTTP ${r.status}`);
    }
    const bytes = new Uint8Array(await r.arrayBuffer());
    const clean = source.split(/[?#]/)[0] ?? source;
    const filename = clean.split("/").pop() || fallbackName;
    return { bytes, filename };
  }

  let path = source;
  if (path === "~") path = homedir();
  else if (path.startsWith("~/") || path.startsWith("~\\")) {
    path = join(homedir(), path.slice(2));
  }
  const bytes = await readFile(path);
  return { bytes, filename: basename(path) };
}

async function upload(
  client: VKAdsClient,
  endpoint: string,
  source: unknown,
  fallbackName: string
): Promise<unknown> {
  const { bytes, filename } = await readSource(
    String(source),
    client.timeoutMs,
    fallbackName
  );
  return client.uploadFile(endpoint, filename, bytes);
}

export function registerContent(registry: ToolRegistry): void {
  registry.register({
    name: "vk_ads_content_upload_image",
    description:
      "Загрузить статичное изображение в хранилище контента VK Ads. Источник — " +
      "локальный путь к файлу или публичный URL. Возвращает объект контента " +
      "(id, url, размеры) для использования в banner (content.image_id).",
    inputSchema: {
      type: "object",
      properties: {
        source_path_or_url: {
          type: "string",
          description: "Локальный путь или http(s)-URL изображения",
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
      "Загрузить видео в хранилище контента VK Ads. Источник — локальный путь " +
      "к файлу или публичный URL. Возвращает объект контента для использования в banner.",
    inputSchema: {
      type: "object",
      properties: {
        source_path_or_url: {
          type: "string",
          description: "Локальный путь или http(s)-URL видеофайла",
        },
      },
      required: ["source_path_or_url"],
    },
    handler: (client, args) =>
      upload(client, "/api/v2/content/video.json", args.source_path_or_url, "video.mp4"),
  });
}
