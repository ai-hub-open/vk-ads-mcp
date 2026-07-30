// Тесты TokenStore: срок жизни, дисковый слой, вытеснение.

import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { TokenStore } from "../src/tokenStore.ts";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "vk-ads-store-"));
});

afterEach(() => {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // Windows может держать файл — для теста не критично
  }
});

test("отдаёт сохранённый токен и не отдаёт чужой ключ", () => {
  const store = new TokenStore({ dir: null });
  store.set("ключ-A", "токен-A", 3600);

  expect(store.get("ключ-A")).toBe("токен-A");
  expect(store.get("ключ-B")).toBeNull();
});

test("протухший токен не отдаётся (учитывается запас 60 с)", () => {
  const store = new TokenStore({ dir: null });
  store.set("k", "истекает-скоро", 30); // меньше запаса EXPIRY_MARGIN_SEC
  expect(store.get("k")).toBeNull();
});

test("delete убирает запись", () => {
  const store = new TokenStore({ dir: null });
  store.set("k", "t", 3600);
  store.delete("k");
  expect(store.get("k")).toBeNull();
});

test("дисковый слой: новый экземпляр видит сохранённый токен", () => {
  new TokenStore({ dir }).set("k", "с-диска", 3600);
  expect(new TokenStore({ dir }).get("k")).toBe("с-диска");
});

test("протухшая запись удаляется с диска при чтении", () => {
  const store = new TokenStore({ dir });
  store.set("k", "t", 30);
  const files = () => require("node:fs").readdirSync(dir);
  expect(files().length).toBe(1);

  expect(store.get("k")).toBeNull();
  expect(files().length).toBe(0);
});

test("повреждённый файл кэша не ломает работу и удаляется", () => {
  const store = new TokenStore({ dir });
  store.set("k", "t", 3600);
  const file = join(dir, require("node:fs").readdirSync(dir)[0]);
  writeFileSync(file, "{это не JSON");

  const fresh = new TokenStore({ dir });
  expect(fresh.get("k")).toBeNull();
  expect(existsSync(file)).toBe(false);
});

test("на диск пишется только токен и срок, без ключа кэша", () => {
  new TokenStore({ dir }).set("секретный-ключ|отпечаток", "t", 3600);
  const file = join(dir, require("node:fs").readdirSync(dir)[0]);
  const raw = readFileSync(file, "utf8");

  expect(raw).not.toContain("секретный-ключ");
  expect(JSON.parse(raw).access_token).toBe("t");
});

test("вытеснение: размер не превышает maxEntries", () => {
  const store = new TokenStore({ dir: null, maxEntries: 3 });
  for (let i = 0; i < 10; i++) store.set(`k${i}`, `t${i}`, 3600 + i);

  expect(store.size).toBe(3);
  // Вытесняются записи с ближайшим истечением — самые свежие остаются.
  expect(store.get("k9")).toBe("t9");
  expect(store.get("k0")).toBeNull();
});

test("протухшие записи не накапливаются в памяти", () => {
  const store = new TokenStore({ dir: null, maxEntries: 100 });

  // Каждая запись протухает сразу (TTL меньше запаса), поэтому очистка при
  // следующем set не даёт кэшу расти — раньше такие записи оставались навсегда.
  for (let i = 0; i < 20; i++) store.set(`истекший-${i}`, "t", 10);
  expect(store.size).toBe(0);

  store.set("живой", "t2", 3600);
  expect(store.size).toBe(1);
  expect(store.get("живой")).toBe("t2");
});
