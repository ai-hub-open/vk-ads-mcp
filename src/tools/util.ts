// Утилиты инструментов: валидация аргументов и общие куски схем/запросов.
// Значения приходят от LLM и подставляются в пути URL — проверяем строго.

/** Целочисленный ID для подстановки в путь URL. */
export function requireId(value: unknown, name: string): number {
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
    throw new Error(
      `Параметр ${name} должен быть целым числом, получено: ${JSON.stringify(value)}`
    );
  }
  return n;
}

/**
 * Строка-сегмент пути URL. Допускает только [a-z0-9_]; при заданном
 * списке `allowed` дополнительно проверяет вхождение.
 */
export function pathSegment(
  value: unknown,
  name: string,
  allowed?: readonly string[]
): string {
  const s = String(value ?? "");
  if (allowed && !allowed.includes(s)) {
    throw new Error(
      `Параметр ${name} должен быть одним из: ${allowed.join(", ")}; получено: ${s}`
    );
  }
  if (!/^[a-z0-9_]+$/i.test(s)) {
    throw new Error(`Недопустимое значение параметра ${name}: ${s}`);
  }
  return s;
}

export const DEFAULT_LIMIT = 50;

/** Стандартные свойства пагинации для inputSchema. */
export const paginationProps = {
  limit: {
    type: "integer",
    description: `Макс. количество результатов (по умолч. ${DEFAULT_LIMIT}, максимум 250)`,
    default: DEFAULT_LIMIT,
  },
  offset: {
    type: "integer",
    description: "Смещение пагинации",
    default: 0,
  },
} as const;

/** Свойство fields для inputSchema. */
export const fieldsProp = {
  type: "string",
  description: "Список возвращаемых полей через запятую (опционально)",
} as const;

/** Параметры пагинации запроса — парные к `paginationProps` в схеме. */
export function paginationParams(args: Record<string, any>): {
  limit: number;
  offset: number;
} {
  return {
    limit: args.limit ?? DEFAULT_LIMIT,
    offset: args.offset ?? 0,
  };
}

/**
 * Тело мягкого удаления. VK Ads не удаляет кампании, группы и объявления
 * физически — сущность переводится в статус `deleted`.
 */
export const SOFT_DELETE_BODY = Object.freeze({ status: "deleted" });

/** Схема инструмента, единственный аргумент которого — объект payload. */
export function payloadSchema(description: string): Record<string, unknown> {
  return {
    type: "object",
    properties: { payload: { type: "object", description } },
    required: ["payload"],
  };
}

/** Схема инструмента вида «ID сущности + payload с изменениями». */
export function idPayloadSchema(
  idName: string,
  idDescription: string,
  payloadDescription: string
): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      [idName]: { type: "integer", description: idDescription },
      payload: { type: "object", description: payloadDescription },
    },
    required: [idName, "payload"],
  };
}

/** Схема инструмента, единственный аргумент которого — ID сущности. */
export function idSchema(idName: string, idDescription: string): Record<string, unknown> {
  return {
    type: "object",
    properties: { [idName]: { type: "integer", description: idDescription } },
    required: [idName],
  };
}
