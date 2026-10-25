import type { ToolDefinition } from './types.js';

export class McpDiscoveryService {
  private readonly tools = new Map<string, ToolDefinition>();

  public registerTool(tool: ToolDefinition): void {
    this.tools.set(tool.name, tool);
  }

  public registerTools(tools: ToolDefinition[]): void {
    for (const tool of tools) {
      this.registerTool(tool);
    }
  }

  public getTool(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  public hasTool(name: string): boolean {
    return this.tools.has(name);
  }

  public listTools(): readonly ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  public listToolNames(): string[] {
    return Array.from(this.tools.keys());
  }

  public isMutation(name: string): boolean {
    const tool = this.tools.get(name);
    return tool ? tool.isMutation : false;
  }
}
