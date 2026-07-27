import type { ToolRegistry } from "../toolRegistry.ts";

export function registerAuth(registry: ToolRegistry): void {
  registry.register({
    name: "vk_ads_auth_check",
    description:
      "Проверить креды и доступность VK Ads API. Возвращает данные текущего " +
      "пользователя, если токен валиден, иначе — ошибку с деталями.",
    inputSchema: { type: "object", properties: {} },
    handler: async (client) => {
      const user = await client.get("/api/v2/user.json");
      return { ok: true, user };
    },
  });

  registry.register({
    name: "vk_ads_account_info",
    description:
      "Информация о текущем аккаунте VK Ads (пользователь, баланс, валюта, настройки).",
    inputSchema: { type: "object", properties: {} },
    handler: (client) => client.get("/api/v2/user.json"),
  });

  registry.register({
    name: "vk_ads_token_revoke",
    description:
      "Отозвать активные OAuth-токены для клиентского приложения (client_id). " +
      "Полезно при ошибке token_limit_exceeded — VK разрешает не более 5 активных " +
      "токенов на client_id + пользователя. Требует VK_ADS_CLIENT_ID + " +
      "VK_ADS_CLIENT_SECRET. Локальный кэш токена также сбрасывается.",
    inputSchema: { type: "object", properties: {} },
    handler: (client) => client.revokeToken(),
  });
}
