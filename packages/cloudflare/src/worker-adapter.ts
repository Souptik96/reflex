import type { IHostToolProxy, SandboxExecutionResult } from './types.js';
import { SandboxExecutor } from './executor.js';

export interface CloudflareWorkerEnv {
  REFLEX_SHARED_SECRET?: string;
  [key: string]: unknown;
}

export interface WorkerExecutionPayload {
  script: string;
  taskId?: string;
  timeoutMs?: number;
  context?: Record<string, unknown>;
}

export interface CloudflareWorkerHandler {
  fetch(
    request: Request,
    env: CloudflareWorkerEnv,
    ctx?: unknown
  ): Promise<Response>;
}

/**
 * Creates a standard Cloudflare Worker `fetch` handler compatible with `workerd`
 * and `@cloudflare/workers-types`.
 */
export function createCloudflareWorkerHandler(
  hostProxy: IHostToolProxy,
  options: { sharedSecret?: string } = {}
): CloudflareWorkerHandler {
  const executor = new SandboxExecutor(hostProxy);

  return {
    async fetch(request: Request, env: CloudflareWorkerEnv, _ctx?: unknown): Promise<Response> {
      // 1. Verify Authorization Header if shared secret is configured
      const secret = options.sharedSecret ?? env.REFLEX_SHARED_SECRET;
      if (secret) {
        const authHeader = request.headers.get('Authorization');
        const expected = `Bearer ${secret}`;
        if (!authHeader || authHeader !== expected) {
          return new Response(JSON.stringify({ error: 'Unauthorized: invalid shared secret' }), {
            status: 401,
            headers: { 'content-type': 'application/json' },
          });
        }
      }

      // 2. Health check endpoint
      const url = new URL(request.url);
      if (url.pathname === '/health' || url.pathname === '/livez') {
        return new Response(JSON.stringify({ status: 'ok', runtime: 'workerd' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }

      // 3. Execution dispatch endpoint
      if (request.method !== 'POST') {
        return new Response(JSON.stringify({ error: 'Method not allowed. Use POST.' }), {
          status: 405,
          headers: { 'content-type': 'application/json' },
        });
      }

      try {
        const body = (await request.json()) as WorkerExecutionPayload;
        if (!body.script || typeof body.script !== 'string') {
          return new Response(JSON.stringify({ error: 'Missing or invalid "script" parameter' }), {
            status: 400,
            headers: { 'content-type': 'application/json' },
          });
        }

        const taskId = body.taskId ?? `worker_task_${Date.now()}`;
        const result: SandboxExecutionResult = await executor.executeScript(body.script, {
          timeoutMs: body.timeoutMs ?? 5000,
          context: {
            taskId,
            task: 'Cloudflare Worker remote execution',
            environment: 'production',
            callerRole: 'worker',
            availableTools: [],
          },
        });

        return new Response(JSON.stringify(result), {
          status: result.success ? 200 : 500,
          headers: { 'content-type': 'application/json' },
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return new Response(JSON.stringify({ error: `Worker execution failed: ${msg}` }), {
          status: 500,
          headers: { 'content-type': 'application/json' },
        });
      }
    },
  };
}
