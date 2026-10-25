import { PassThrough } from 'node:stream';
import type { ToolDefinition, ToolHandler } from '../types.js';
import type {
  JsonRpcRequest,
  JsonRpcResponse,
  McpCallToolResult,
} from './types.js';

export interface SimulatedToolEntry {
  definition: ToolDefinition;
  handler: ToolHandler;
}

export class SimulatedMcpServer {
  private readonly name: string;
  private readonly version: string;
  private readonly tools = new Map<string, SimulatedToolEntry>();
  private isInitialized = false;

  constructor(options: { name?: string; version?: string } = {}) {
    this.name = options.name ?? 'simulated-mcp-server';
    this.version = options.version ?? '1.0.0';
  }

  public registerTool(definition: ToolDefinition, handler: ToolHandler): void {
    this.tools.set(definition.name, { definition, handler });
  }

  public async handleJsonRpcMessage(
    request: JsonRpcRequest
  ): Promise<JsonRpcResponse | null> {
    const id = request.id ?? null;

    switch (request.method) {
      case 'initialize': {
        this.isInitialized = true;
        return {
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: {
              tools: {},
            },
            serverInfo: {
              name: this.name,
              version: this.version,
            },
          },
        };
      }

      case 'notifications/initialized': {
        // Notifications have no JSON-RPC reply
        return null;
      }

      case 'tools/list': {
        const toolsList = Array.from(this.tools.values()).map((t) => ({
          name: t.definition.name,
          description: t.definition.description,
          inputSchema: t.definition.parametersSchema ?? { type: 'object' },
          isMutation: t.definition.isMutation,
        }));

        return {
          jsonrpc: '2.0',
          id,
          result: {
            tools: toolsList,
          },
        };
      }

      case 'tools/call': {
        const toolName = typeof request.params?.['name'] === 'string'
          ? (request.params['name'] as string)
          : '';
        const rawArgs = request.params?.['arguments'];
        const toolArgs = typeof rawArgs === 'object' && rawArgs !== null
          ? (rawArgs as Record<string, unknown>)
          : {};

        const entry = this.tools.get(toolName);
        if (!entry) {
          return {
            jsonrpc: '2.0',
            id,
            error: {
              code: -32601,
              message: `Tool '${toolName}' not found on simulated server`,
            },
          };
        }

        try {
          const handlerResult = await entry.handler(toolArgs, {
            taskId: `sim_${Date.now()}`,
            task: `Execute ${toolName}`,
            environment: 'development',
            callerRole: 'simulated_client',
            availableTools: Array.from(this.tools.keys()),
          });

          const resultPayload: McpCallToolResult = {
            content: [
              {
                type: 'text',
                text: JSON.stringify(handlerResult.data),
              },
            ],
            isError: false,
          };

          return {
            jsonrpc: '2.0',
            id,
            result: resultPayload,
          };
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          const errorPayload: McpCallToolResult = {
            content: [
              {
                type: 'text',
                text: `Execution failed: ${msg}`,
              },
            ],
            isError: true,
          };

          return {
            jsonrpc: '2.0',
            id,
            result: errorPayload,
          };
        }
      }

      default: {
        return {
          jsonrpc: '2.0',
          id,
          error: {
            code: -32601,
            message: `Method '${request.method}' not implemented`,
          },
        };
      }
    }
  }

  /**
   * Creates a stream harness connecting a client to this simulated MCP server.
   * Emulates stdin/stdout communication without launching external OS subprocesses.
   */
  public createStreamHarness(): {
    stdin: PassThrough;
    stdout: PassThrough;
  } {
    const clientToServer = new PassThrough(); // acts as client's stdin to server
    const serverToClient = new PassThrough(); // acts as server's stdout to client

    let buffer = '';

    clientToServer.on('data', async (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        try {
          const parsed = JSON.parse(trimmed) as JsonRpcRequest;
          const reply = await this.handleJsonRpcMessage(parsed);
          if (reply) {
            serverToClient.write(`${JSON.stringify(reply)}\n`);
          }
        } catch (err: unknown) {
          const errorReply: JsonRpcResponse = {
            jsonrpc: '2.0',
            id: null,
            error: {
              code: -32700,
              message: `Parse error: ${err instanceof Error ? err.message : String(err)}`,
            },
          };
          serverToClient.write(`${JSON.stringify(errorReply)}\n`);
        }
      }
    });

    return {
      stdin: clientToServer,
      stdout: serverToClient,
    };
  }

  /**
   * Handles an HTTP JSON-RPC POST request.
   */
  public async handleHttpRequest(request: Request): Promise<Response> {
    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: { 'content-type': 'application/json' },
      });
    }

    try {
      const parsed = (await request.json()) as JsonRpcRequest;
      const reply = await this.handleJsonRpcMessage(parsed);
      if (!reply) {
        return new Response(null, { status: 204 });
      }
      return new Response(JSON.stringify(reply), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    } catch (err: unknown) {
      return new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: null,
          error: {
            code: -32700,
            message: `Parse error: ${err instanceof Error ? err.message : String(err)}`,
          },
        }),
        {
          status: 400,
          headers: { 'content-type': 'application/json' },
        }
      );
    }
  }

  public getInitialized(): boolean {
    return this.isInitialized;
  }
}
