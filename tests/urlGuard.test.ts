// Тесты защиты от SSRF: классификация адресов, проверка URL и редиректов.

import { afterEach, beforeEach, expect, test } from "bun:test";

import { BlockedUrlError, addressIsInternal, assertAllowedUrl, fetchGuarded } from "../src/urlGuard.ts";
import { mockFetch, setupTestEnv, teardownTestEnv } from "./helpers.ts";

beforeEach(setupTestEnv);
afterEach(teardownTestEnv);

test("внутренние IPv4 распознаются", () => {
  for (const ip of [
    "127.0.0.1",
    "10.0.0.5",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254", // облачные метаданные
    "0.0.0.0",
    "100.64.0.1", // CGNAT
    "224.0.0.1", // multicast
    "255.255.255.255",
  ]) {
    expect(addressIsInternal(ip)).toBe(true);
  }
});

test("публичные IPv4 пропускаются", () => {
  for (const ip of ["8.8.8.8", "93.184.216.34", "172.32.0.1", "192.169.0.1", "1.1.1.1"]) {
    expect(addressIsInternal(ip)).toBe(false);
  }
});

test("внутренние IPv6 распознаются, включая IPv4-mapped", () => {
  for (const ip of ["::1", "::", "fe80::1", "fc00::1", "fd12:3456::1", "ff02::1", "::ffff:127.0.0.1", "::ffff:169.254.169.254"]) {
    expect(addressIsInternal(ip)).toBe(true);
  }
  expect(addressIsInternal("2606:4700:4700::1111")).toBe(false);
});

test("не-IP строка считается небезопасной", () => {
  expect(addressIsInternal("не-адрес")).toBe(true);
  expect(addressIsInternal("")).toBe(true);
});

test("схемы кроме http/https запрещены", async () => {
  for (const url of ["file:///etc/passwd", "ftp://example.com/x", "gopher://a/b"]) {
    await expect(assertAllowedUrl(url, false)).rejects.toBeInstanceOf(BlockedUrlError);
  }
});

test("некорректный URL отвергается", async () => {
  await expect(assertAllowedUrl("не-url", false)).rejects.toBeInstanceOf(BlockedUrlError);
});

test("IP-литерал внутренней сети блокируется, публичный проходит", async () => {
  await expect(assertAllowedUrl("http://169.254.169.254/latest/meta-data/", false)).rejects.toThrow(
    /внутренний адрес/
  );
  await expect(assertAllowedUrl("http://127.0.0.1:8080/admin", false)).rejects.toThrow(
    /внутренний адрес/
  );
  await expect(assertAllowedUrl("http://[::1]/x", false)).rejects.toThrow(/внутренний адрес/);

  const ok = await assertAllowedUrl("https://8.8.8.8/img.png", false);
  expect(ok.hostname).toBe("8.8.8.8");
});

test("allowPrivateNetwork снимает проверку адресов, но не схем", async () => {
  const ok = await assertAllowedUrl("http://127.0.0.1:3000/creative.png", true);
  expect(ok.hostname).toBe("127.0.0.1");

  await expect(assertAllowedUrl("file:///etc/passwd", true)).rejects.toBeInstanceOf(
    BlockedUrlError
  );
});

test("localhost по имени резолвится и блокируется", async () => {
  await expect(assertAllowedUrl("http://localhost/x", false)).rejects.toThrow(/внутренний адрес/);
});

test("fetchGuarded скачивает публичный URL и берёт имя файла из пути", async () => {
  mockFetch(() => new Response(new Uint8Array([1, 2, 3]), { status: 200 }));

  const { bytes, filename } = await fetchGuarded("https://8.8.8.8/pics/banner.jpg?v=2", {
    timeoutMs: 5000,
    allowPrivateNetwork: false,
  });
  expect(bytes.length).toBe(3);
  expect(filename).toBe("banner.jpg");
});

test("редирект во внутреннюю сеть блокируется", async () => {
  mockFetch((url) => {
    if (url.includes("8.8.8.8")) {
      return new Response(null, {
        status: 302,
        headers: { location: "http://169.254.169.254/latest/meta-data/" },
      });
    }
    return new Response("СЕКРЕТ", { status: 200 });
  });

  await expect(
    fetchGuarded("https://8.8.8.8/redirect", { timeoutMs: 5000, allowPrivateNetwork: false })
  ).rejects.toThrow(/внутренний адрес/);
});

test("редирект на публичный адрес разрешён", async () => {
  mockFetch((url) => {
    if (url.includes("/redirect")) {
      return new Response(null, { status: 301, headers: { location: "https://1.1.1.1/final.png" } });
    }
    return new Response(new Uint8Array([9]), { status: 200 });
  });

  const { filename } = await fetchGuarded("https://8.8.8.8/redirect", {
    timeoutMs: 5000,
    allowPrivateNetwork: false,
  });
  expect(filename).toBe("final.png");
});

test("бесконечная цепочка редиректов обрывается", async () => {
  mockFetch(() => new Response(null, { status: 302, headers: { location: "https://8.8.8.8/loop" } }));

  await expect(
    fetchGuarded("https://8.8.8.8/loop", { timeoutMs: 5000, allowPrivateNetwork: false })
  ).rejects.toThrow(/редиректов/);
});

test("превышение размера по Content-Length отклоняется", async () => {
  mockFetch(
    () => new Response(new Uint8Array([1]), { status: 200, headers: { "content-length": "999999" } })
  );

  await expect(
    fetchGuarded("https://8.8.8.8/big.mp4", {
      timeoutMs: 5000,
      allowPrivateNetwork: false,
      maxBytes: 1000,
    })
  ).rejects.toThrow(/больше допустимых/);
});

test("превышение размера при чтении тела отклоняется", async () => {
  mockFetch(() => new Response(new Uint8Array(5000), { status: 200 }));

  await expect(
    fetchGuarded("https://8.8.8.8/big.mp4", {
      timeoutMs: 5000,
      allowPrivateNetwork: false,
      maxBytes: 100,
    })
  ).rejects.toThrow(/больше допустимых/);
});

test("HTTP-ошибка источника пробрасывается", async () => {
  mockFetch(() => new Response("nope", { status: 404 }));

  await expect(
    fetchGuarded("https://8.8.8.8/missing.png", { timeoutMs: 5000, allowPrivateNetwork: false })
  ).rejects.toThrow(/HTTP 404/);
});
