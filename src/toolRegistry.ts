import type { VKAdsClient } from "./client.ts";

export type ToolHandler = (
  client: VKAdsClient,
  args: Record<string, any>
) => Promise<unknown> | unknown;

export interface Tool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: ToolHandler;
}

export class ToolRegistry {
  private tools = new Map<string, Tool>();

  register(tool: Tool): void {
    this.tools.set(tool.name, tool);
  }

  find(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  list(): Tool[] {
    return [...this.tools.values()];
  }

  toolDefinitions(): Array<{ name: string; description: string; inputSchema: unknown }> {
    return this.list().map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    }));
  }
}
