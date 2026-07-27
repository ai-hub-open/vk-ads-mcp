// Утилиты валидации аргументов инструментов.
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

/** Стандартные свойства пагинации для inputSchema. */
export const paginationProps = {
  limit: {
    type: "integer",
    description: "Макс. количество результатов (по умолч. 50, максимум 250)",
    default: 50,
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
