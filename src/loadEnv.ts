// Загрузка переменных окружения из .env файла.
// Bun автоматически подхватывает .env из cwd, но при запуске MCP-сервера
// из другой директории (например, из конфига Claude Desktop) cwd может
// отличаться от каталога проекта. Поэтому явно читаем .env рядом с этим файлом.

import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export function loadEnv(): string | null {
  const here = dirname(fileURLToPath(import.meta.url));
  // Ищем .env в каталоге проекта (на уровень выше src/) и в cwd
  const candidates = [
    join(here, "..", ".env"),
    join(process.cwd(), ".env"),
  ];

  for (const path of candidates) {
    if (!existsSync(path)) continue;
    try {
      parseEnv(readFileSync(path, "utf8"));
      return path;
    } catch (e) {
      process.stderr.write(`Warning: не удалось прочитать ${path}: ${(e as Error).message}\n`);
    }
  }
  return null;
}

function parseEnv(content: string): void {
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const eq = line.indexOf("=");
    if (eq < 0) continue;

    const key = line.slice(0, eq).trim();
    if (!key) continue;

    let value = line.slice(eq + 1).trim();
    // Снимаем кавычки
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    // Не перезаписываем уже заданные переменные
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}
