// Stdio транспорт — построчный JSON-RPC 2.0 поверх stdin/stdout.
import type { JsonRpcRequest, McpServer } from "../server.ts";
import { errorResponse } from "../server.ts";

export async function runStdio(server: McpServer): Promise<void> {
  process.stderr.write("VK Ads MCP Server запущен (stdio)\n");

  const decoder = new TextDecoder();
  let buffer = "";

  for await (const chunk of process.stdin as any) {
    buffer += decoder.decode(chunk instanceof Uint8Array ? chunk : Buffer.from(chunk));
    let nlIdx: number;
    while ((nlIdx = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nlIdx).trim();
      buffer = buffer.slice(nlIdx + 1);
      if (!line) continue;
      await processLine(server, line);
    }
  }
}

async function processLine(server: McpServer, line: string): Promise<void> {
  let request: JsonRpcRequest;
  try {
    request = JSON.parse(line);
  } catch (e) {
    write(errorResponse(null, -32700, `Parse error: ${(e as Error).message}`));
    return;
  }

  const response = await server.handle(request);
  if (response) write(response);
}

function write(response: object): void {
  process.stdout.write(JSON.stringify(response) + "\n");
}
