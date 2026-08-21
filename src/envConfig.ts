// Чтение кред VK Ads из переменных окружения (loadEnv() уже должен быть вызван).
// Используется точкой входа (src/index.ts) и живым smoke-тестом (scripts/live-check.ts).

import type { ClientOptions } from "./client.ts";

export interface EnvCreds {
  hasStatic: boolean;
  hasCreds: boolean;
  hasClickRu: boolean;
  hasAny: boolean;
  /** Предупреждения о частично заданных парах переменных. */
  warnings: string[];
  options: ClientOptions;
  /** Человекочитаемое описание режима (для stderr) или null, если кред нет. */
  mode: string | null;
}

/** Разбор булевой переменной окружения; undefined, если не задана. */
function envFlag(raw: string | undefined): boolean | undefined {
  if (raw === undefined || raw === "") return undefined;
  return raw.toLowerCase() === "true" || raw === "1";
}

export function readEnvCreds(
  env: Record<string, string | undefined> = process.env
): EnvCreds {
  const accessToken = env.VK_ADS_ACCESS_TOKEN;
  const clientId = env.VK_ADS_CLIENT_ID;
  const clientSecret = env.VK_ADS_CLIENT_SECRET;
  const agencyClientName = env.VK_ADS_AGENCY_CLIENT_NAME;
  const clickRuToken = env.CLICK_RU_TOKEN;
  const clickRuAccountId = env.CLICK_RU_ACCOUNT_ID;

  const hasStatic = !!accessToken;
  const hasCreds = !!(clientId && clientSecret);
  const hasClickRu = !!(clickRuToken && clickRuAccountId);

  const warnings: string[] = [];
  if (!hasCreds && (clientId || clientSecret)) {
    warnings.push(
      "VK_ADS_CLIENT_ID и VK_ADS_CLIENT_SECRET работают только вместе — игнорируются."
    );
  }
  if (!hasClickRu && (clickRuToken || clickRuAccountId)) {
    warnings.push(
      "CLICK_RU_TOKEN и CLICK_RU_ACCOUNT_ID работают только вместе — игнорируются."
    );
  }

  const options: ClientOptions = {
    baseUrl: env.VK_ADS_BASE_URL,
    accessToken,
    clientId: hasCreds ? clientId : undefined,
    clientSecret: hasCreds ? clientSecret : undefined,
    agencyClientName,
    clickRuToken: hasClickRu ? clickRuToken : undefined,
    clickRuAccountId: hasClickRu ? clickRuAccountId : undefined,
    clickRuUserId: env.CLICK_RU_USER_ID,
    clickRuBaseUrl: env.CLICK_RU_BASE_URL,
    timeout: parseFloat(env.VK_ADS_TIMEOUT ?? "30"),
    language: env.VK_ADS_LANG,
    // Значения по умолчанию — для локального (stdio) запуска, где файлы и
    // внутренняя сеть принадлежат самому пользователю. Точка входа ужесточает
    // их для HTTP-режима, см. src/index.ts.
    allowLocalFiles: envFlag(env.VK_ADS_ALLOW_LOCAL_FILES) ?? true,
    allowPrivateNetwork: envFlag(env.VK_ADS_ALLOW_PRIVATE_NETWORK) ?? true,
  };

  const mode = hasStatic
    ? "готовый токен (VK_ADS_ACCESS_TOKEN)"
    : hasCreds
      ? `OAuth ${agencyClientName ? "agency_client_credentials" : "client_credentials"} (client_id: ${clientId})`
      : hasClickRu
        ? `токен через Click.ru (аккаунт ${clickRuAccountId})`
        : null;

  return {
    hasStatic,
    hasCreds,
    hasClickRu,
    hasAny: hasStatic || hasCreds || hasClickRu,
    warnings,
    options,
    mode,
  };
}
