import vm from 'node:vm';
import type {
  IHostToolProxy,
  SandboxExecutionOptions,
  SandboxExecutionResult,
} from './types.js';
import { IsolateRpcBridge, createSandboxedMcpProxy } from './rpc/channel.js';

export class SandboxExecutor {
  private readonly hostProxy: IHostToolProxy;

  constructor(hostProxy: IHostToolProxy) {
    this.hostProxy = hostProxy;
  }

  public async executeScript(
    script: string,
    options: SandboxExecutionOptions = {}
  ): Promise<SandboxExecutionResult> {
    const startTime = performance.now();
    const logs: string[] = [];
    const timeoutMs = options.timeoutMs ?? 5000;
    const taskId = options.context?.taskId ?? `task_${Date.now()}`;

    // Establish bi-directional RPC channel across isolate boundary
    const rpcChannel = new IsolateRpcBridge(this.hostProxy, taskId);
    const mcp = createSandboxedMcpProxy(rpcChannel);

    const tools = {
      invoke: (name: string, params: Record<string, unknown> = {}) =>
        rpcChannel.sendRequest(name, params),
    };

    // Isolated sandbox context with restricted global scope
    // Strictly NO access to process, require, fetch, fs, child_process, net, WebSocket
    const sandboxContext: Record<string, unknown> = {
      mcp,
      tools,
      console: {
        log: (...args: unknown[]) => {
          logs.push(args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' '));
        },
        error: (...args: unknown[]) => {
          logs.push(`[ERROR] ${args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ')}`);
        },
        warn: (...args: unknown[]) => {
          logs.push(`[WARN] ${args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ')}`);
        },
      },
      // Safe language intrinsics
      Promise,
      Array,
      Object,
      String,
      Number,
      Boolean,
      Date,
      Math,
      JSON,
      RegExp,
      Map,
      Set,
      Error,
      TypeError,
      RangeError,
      parseInt,
      parseFloat,
      isNaN,
      isFinite,
      // Explicitly undefined or blocked hazardous primitives
      process: undefined,
      require: undefined,
      fetch: undefined,
      global: undefined,
      globalThis: undefined,
    };

    const context = vm.createContext(sandboxContext);

    // Wrap script in async IIFE
    const wrappedScript = `
      (async () => {
        ${script}
      })()
    `;

    try {
      // Execute with VM timeout
      const vmPromise = vm.runInContext(wrappedScript, context, {
        timeout: timeoutMs,
      }) as Promise<unknown>;

      // Wall-clock watchdog timeout guard
      const timeoutPromise = new Promise<never>((_, reject) => {
        const timer = setTimeout(() => {
          reject(new Error(`Sandbox execution timed out after ${timeoutMs}ms`));
        }, timeoutMs + 100);

        if (typeof timer.unref === 'function') {
          timer.unref();
        }
      });

      const returnValue = await Promise.race([vmPromise, timeoutPromise]);
      const wallTimeMs = performance.now() - startTime;

      return {
        success: true,
        returnValue,
        logs,
        wallTimeMs,
      };
    } catch (err: unknown) {
      const wallTimeMs = performance.now() - startTime;
      const error = err instanceof Error ? err.message : String(err);
      logs.push(`[RUNTIME EXCEPTION] ${error}`);

      return {
        success: false,
        error,
        logs,
        wallTimeMs,
      };
    }
  }
}
