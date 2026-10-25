import { type ChildProcess, spawn } from 'node:child_process';
import type { Readable, Writable } from 'node:stream';
import type { HostToolProxy } from '../tool-proxy.js';
import type { McpDiscoveryService } from '../mcp-discovery.js';
import type { ToolDefinition } from '../types.js';
import type {
  JsonRpcRequest,
  JsonRpcResponse,
  McpCallToolResult,
} from './types.js';

export interface McpStdioClientOptions {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  // For offline testing or custom piped streams
  streams?: {
    stdin: Writable;
    stdout: Readable;
  };
}

export class McpStdioClient {
  private readonly command?: string;
  private readonly args: string[];
  private readonly env?: Record<string, string>;
  private process?: ChildProcess;
  private stdin?: Writable;
  private stdout?: Readable;
  private nextId = 1;
  private readonly pendingRequests = new Map<
    string | number,
    {
      resolve: (res: JsonRpcResponse) => void;
      reject: (err: Error) => void;
    }
  >();
  private stdoutBuffer = '';
  private isConnected = false;

  constructor(options: McpStdioClientOptions) {
    this.command = options.command;
    this.args = options.args ?? [];
    this.env = options.env;

    if (options.streams) {
      this.stdin = options.streams.stdin;
      this.stdout = options.streams.stdout;
      this.setupStreamListener();
    }
  }

  public async connect(): Promise<void> {
    if (this.isConnected) return;

    if (!this.stdin || !this.stdout) {
      if (!this.command) {
        throw new Error('McpStdioClient requires either a command or streams');
      }

      this.process = spawn(this.command, this.args, {
        env: { ...process.env, ...this.env },
        stdio: ['pipe', 'pipe', 'inherit'],
      });

      if (!this.process.stdin || !this.process.stdout) {
        throw new Error('Failed to acquire stdin/stdout from spawned MCP process');
      }

      this.stdin = this.process.stdin;
      this.stdout = this.process.stdout;
      this.setupStreamListener();
    }

    // 1. Send MCP initialize handshake
    const initResponse = await this.sendRequest('initialize', {
      protocolVersion: '2024-11-05',
      clientInfo: {
        name: 'reflex-mcp-client',
        version: '0.1.0',
      },
      capabilities: {},
    });

    if (initResponse.error) {
      throw new Error(`MCP initialize failed: ${initResponse.error.message}`);
    }

    // 2. Send initialized notification
    this.sendNotification('notifications/initialized', {});
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

  public async close(): Promise<void> {
    if (this.process) {
      this.process.kill('SIGTERM');
      this.process = undefined;
    }
    this.stdin = undefined;
    this.stdout = undefined;
    this.isConnected = false;
  }

  private setupStreamListener(): void {
    if (!this.stdout) return;

    this.stdout.on('data', (chunk: Buffer) => {
      this.stdoutBuffer += chunk.toString('utf8');
      const lines = this.stdoutBuffer.split('\n');
      this.stdoutBuffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        try {
          const response = JSON.parse(trimmed) as JsonRpcResponse;
          if (response.id !== null && response.id !== undefined) {
            const pending = this.pendingRequests.get(response.id);
            if (pending) {
              this.pendingRequests.delete(response.id);
              pending.resolve(response);
            }
          }
        } catch {
          // Ignore unparseable or logging output
        }
      }
    });
  }

  private sendRequest(
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

    return new Promise<JsonRpcResponse>((resolve, reject) => {
      if (!this.stdin) {
        return reject(new Error('McpStdioClient: Stdin stream not open'));
      }

      this.pendingRequests.set(id, { resolve, reject });
      this.stdin.write(`${JSON.stringify(request)}\n`);
    });
  }

  private sendNotification(
    method: string,
    params: Record<string, unknown>
  ): void {
    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      method,
      params,
    };

    if (this.stdin) {
      this.stdin.write(`${JSON.stringify(request)}\n`);
    }
  }
}
