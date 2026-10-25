import { describe, expect, it } from 'vitest';
import {
  HostToolProxy,
  createCloudflareWorkerHandler,
} from '../src/index.js';

describe('Phase 4: Cloudflare Worker Runtime Adapter', () => {
  it('responds with 200 OK on health endpoints', async () => {
    const hostProxy = new HostToolProxy();
    const handler = createCloudflareWorkerHandler(hostProxy);

    const req = new Request('https://worker.internal/health');
    const res = await handler.fetch(req, {});
    expect(res.status).toBe(200);

    const body = (await res.json()) as { status: string; runtime: string };
    expect(body.status).toBe('ok');
    expect(body.runtime).toBe('workerd');
  });

  it('enforces shared secret authentication when configured', async () => {
    const hostProxy = new HostToolProxy();
    const handler = createCloudflareWorkerHandler(hostProxy, { sharedSecret: 'secret_123' });

    // Request without auth header
    const reqNoAuth = new Request('https://worker.internal/execute', {
      method: 'POST',
      body: JSON.stringify({ script: 'return { status: "success" };' }),
      headers: { 'content-type': 'application/json' },
    });
    const resNoAuth = await handler.fetch(reqNoAuth, {});
    expect(resNoAuth.status).toBe(401);

    // Request with valid auth header
    const reqAuth = new Request('https://worker.internal/execute', {
      method: 'POST',
      body: JSON.stringify({ script: 'return { status: "success", validated: true };' }),
      headers: {
        'content-type': 'application/json',
        Authorization: 'Bearer secret_123',
      },
    });
    const resAuth = await handler.fetch(reqAuth, {});
    expect(resAuth.status).toBe(200);

    const data = (await resAuth.json()) as { success: boolean; returnValue: { validated: boolean } };
    expect(data.success).toBe(true);
    expect(data.returnValue.validated).toBe(true);
  });

  it('rejects unsupported HTTP methods', async () => {
    const hostProxy = new HostToolProxy();
    const handler = createCloudflareWorkerHandler(hostProxy);

    const req = new Request('https://worker.internal/execute', { method: 'GET' });
    const res = await handler.fetch(req, {});
    expect(res.status).toBe(405);
  });

  it('rejects invalid or missing script payload', async () => {
    const hostProxy = new HostToolProxy();
    const handler = createCloudflareWorkerHandler(hostProxy);

    const req = new Request('https://worker.internal/execute', {
      method: 'POST',
      body: JSON.stringify({ notScript: 123 }),
      headers: { 'content-type': 'application/json' },
    });
    const res = await handler.fetch(req, {});
    expect(res.status).toBe(400);
  });
});
