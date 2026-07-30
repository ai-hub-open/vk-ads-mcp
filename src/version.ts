// Единственный источник версии — package.json. Раньше версия дублировалась
// строками в serverInfo и User-Agent и разъезжалась с реальной при релизах.

import pkg from "../package.json";

export const SERVER_NAME = "vk-ads-mcp";
export const VERSION: string = pkg.version;
export const USER_AGENT = `${SERVER_NAME}/${VERSION}`;
