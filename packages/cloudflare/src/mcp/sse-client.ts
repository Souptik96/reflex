import type { HostToolProxy } from '../tool-proxy.js';
import type { McpDiscoveryService } from '../mcp-discovery.js';
import type { ToolDefinition } from '../types.js';
import type {
  JsonRpcRequest,
  JsonRpcResponse,
  McpCallToolResult,
} from './types.js';

export interface McpHttpClientOptions {
  url: string;
  headers?: Record<string, string>;
  fetchFn?: typeof fetch;
}

export class McpHttpClient {
  private readonly url: string;
  private readonly headers: Record<string, string>;
  private readonly fetchFn: typeof fetch;
  private nextId = 1;
  private isConnected = false;

  constructor(options: McpHttpClientOptions) {
    this.url = options.url;
    this.headers = options.headers ?? {};
    this.fetchFn = options.fetchFn ?? fetch;
  }

  public async connect(): Promise<void> {
    if (this.isConnected) return;

    // 1. Send MCP initialize handshake
    const initResponse = await this.sendRequest('initialize', {
      protocolVersion: '2024-11-05',
      clientInfo: {
        name: 'reflex-mcp-http-client',
        version: '0.1.0',
      },
      capabilities: {},
    });

    if (initResponse.error) {
      throw new Error(`MCP initialize failed: ${initResponse.error.message}`);
    }

    // 2. Send initialized notification
    await this.sendNotification('notifications/initialized', {});
    this.isConnected = true;
  }

  public async discoverAndRegister(
    discoveryService: McpDiscoveryService,
    hostProxy?: HostToolProxy
  ): Promise<ToolDefinition[]> {
    if (!this.isConnected) {
      await this.connect();
    }

    const listResponse = await this.sendRequest('tools/list', {});
    if (listResponse.error) {
      throw new Error(`MCP tools/list failed: ${listResponse.error.message}`);
    }

    const result = listResponse.result as {
      tools?: Array<{
        name: string;
        description?: string;
        inputSchema?: Record<string, unknown>;
        isMutation?: boolean;
      }>;
    };

    const tools: ToolDefinition[] = [];

    for (const tool of result.tools ?? []) {
      const isMutation = Boolean(
        tool.isMutation ||
        tool.name.toLowerCase().includes('delete') ||
        tool.name.toLowerCase().includes('create') ||
        tool.name.toLowerCase().includes('update') ||
        tool.name.toLowerCase().includes('write')
      );

      const def: ToolDefinition = {
        name: tool.name,
        description: tool.description ?? '',
        isMutation,
        parametersSchema: tool.inputSchema,
      };

      discoveryService.registerTool(def);
      tools.push(def);

      if (hostProxy) {
        hostProxy.registerTool(
          def.name,
          def.isMutation,
          async (params) => {
            const toolCallResult = await this.callTool(def.name, params);
            return {
              httpStatus: 200,
              data: toolCallResult,
            };
          },
          def.description
        );
      }
    }

    return tools;
  }

  public async callTool(
    name: string,
    args: Record<string, unknown>
  ): Promise<unknown> {
    if (!this.isConnected) {
      await this.connect();
    }

    const response = await this.sendRequest('tools/call', {
      name,
      arguments: args,
    });

    if (response.error) {
      throw new Error(`MCP tool call '${name}' failed: ${response.error.message}`);
    }

    const result = response.result as McpCallToolResult;
    if (result.isError) {
      const firstText = result.content[0]?.text ?? 'Tool execution error';
      throw new Error(firstText);
    }

    const textContent = result.content[0]?.text;
    if (textContent !== undefined) {
      try {
        return JSON.parse(textContent);
      } catch {
        return textContent;
      }
    }

    return result.content[0]?.data ?? null;
  }

  private async sendRequest(
    method: string,
    params: Record<string, unknown>
  ): Promise<JsonRpcResponse> {
    const id = this.nextId++;
    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    };

    const response = await this.fetchFn(this.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...this.headers,
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`MCP HTTP request failed [HTTP ${response.status}]: ${errText}`);
    }

    return (await response.json()) as JsonRpcResponse;
  }

  private async sendNotification(
    method: string,
    params: Record<string, unknown>
  ): Promise<void> {
    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      method,
      params,
    };

    await this.fetchFn(this.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...this.headers,
      },
      body: JSON.stringify(request),
    });
  }
}
