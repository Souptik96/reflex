import { randomUUID } from 'node:crypto';
import type { IHostToolProxy, ToolInvocationResponse } from '../types.js';

export interface RpcToolRequest {
  id: string;
  taskId: string;
  toolName: string;
  params: Record<string, unknown>;
}

export interface RpcToolResponse {
  id: string;
  success: boolean;
  httpStatus: number;
  data?: unknown;
  error?: string;
  durationMs: number;
}

export interface IIsolateRpcChannel {
  sendRequest(toolName: string, params: Record<string, unknown>): Promise<unknown>;
}

export class IsolateRpcBridge implements IIsolateRpcChannel {
  private readonly hostProxy: IHostToolProxy;
  private readonly taskId: string;

  constructor(hostProxy: IHostToolProxy, taskId: string) {
    this.hostProxy = hostProxy;
    this.taskId = taskId;
  }

  public async sendRequest(
    toolName: string,
    params: Record<string, unknown>
  ): Promise<unknown> {
    const rpcRequest: RpcToolRequest = {
      id: `rpc_${randomUUID().replace(/-/g, '').slice(0, 8)}`,
      taskId: this.taskId,
      toolName,
      params,
    };

    const hostResponse: ToolInvocationResponse = await this.hostProxy.invokeTool(
      rpcRequest.taskId,
      rpcRequest.toolName,
      rpcRequest.params
    );

    const rpcResponse: RpcToolResponse = {
      id: rpcRequest.id,
      success: hostResponse.success,
      httpStatus: hostResponse.httpStatus,
      data: hostResponse.data,
      error: hostResponse.error,
      durationMs: hostResponse.durationMs,
    };

    if (!rpcResponse.success) {
      throw new Error(
        `Tool '${toolName}' failed [HTTP ${rpcResponse.httpStatus}]: ${rpcResponse.error ?? 'Unknown error'}`
      );
    }

    return rpcResponse.data;
  }
}

export function createSandboxedMcpProxy(channel: IIsolateRpcChannel): unknown {
  return new Proxy(
    {},
    {
      get: (_target, service: string) => {
        // Special case: mcp.tools.invoke('service.action', params)
        if (service === 'tools') {
          return {
            invoke: (name: string, params: Record<string, unknown> = {}) =>
              channel.sendRequest(name, params),
          };
        }

        return new Proxy(
          {},
          {
            get: (_serviceTarget, action: string) => {
              const toolName = `${service}.${action}`;
              return (params: Record<string, unknown> = {}) =>
                channel.sendRequest(toolName, params);
            },
          }
        );
      },
    }
  );
}
