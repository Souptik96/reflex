import { describe, expect, it } from 'vitest';
import {
  HostToolProxy,
  SandboxExecutor,
} from '../src/index.js';

describe('Phase 4: Sandbox Executor & Isolate Isolation', () => {
  it('strictly blocks hazardous globals (process, require, fs, fetch)', async () => {
    const hostProxy = new HostToolProxy();
    const executor = new SandboxExecutor(hostProxy);

    const script = `
      const results = {
        processType: typeof process,
        requireType: typeof require,
        fetchType: typeof fetch,
        hasFs: typeof fs,
      };
      return results;
    `;

    const res = await executor.executeScript(script);
    expect(res.success).toBe(true);
    expect(res.returnValue).toEqual({
      processType: 'undefined',
      requireType: 'undefined',
      fetchType: 'undefined',
      hasFs: 'undefined',
    });
  });

  it('terminates execution when runtime timeout budget is exceeded', async () => {
    const hostProxy = new HostToolProxy();
    const executor = new SandboxExecutor(hostProxy);

    // Infinite loop that should hit timeout
    const script = `
      while (true) {}
      return { status: "success" };
    `;

    const res = await executor.executeScript(script, { timeoutMs: 150 });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/timed out/i);
    expect(res.wallTimeMs).toBeGreaterThanOrEqual(100);
  });

  it('terminates execution when async promise hangs past watchdog threshold', async () => {
    const hostProxy = new HostToolProxy();
    const executor = new SandboxExecutor(hostProxy);

    const script = `
      await new Promise(resolve => {}); // never resolves
      return { status: "done" };
    `;

    const res = await executor.executeScript(script, { timeoutMs: 150 });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/timed out/i);
  });

  it('routes mcp tool calls bidirectionally across the isolate boundary', async () => {
    const hostProxy = new HostToolProxy();
    hostProxy.registerTool('deployments.list', false, async (params) => {
      return {
        httpStatus: 200,
        data: [{ id: 'dep_1', env: params['env'] }],
      };
    });

    const executor = new SandboxExecutor(hostProxy);

    const script = `
      const list = await mcp.deployments.list({ env: "production" });
      console.log("Found deployments:", list.length);
      return { status: "success", count: list.length, firstId: list[0].id };
    `;

    const res = await executor.executeScript(script);
    expect(res.success).toBe(true);
    expect(res.returnValue).toEqual({
      status: 'success',
      count: 1,
      firstId: 'dep_1',
    });
    expect(res.logs.some((l) => l.includes('Found deployments: 1'))).toBe(true);

    const evidence = hostProxy.getEvidenceLog();
    expect(evidence.length).toBe(1);
    expect(evidence[0]?.toolName).toBe('deployments.list');
    expect(evidence[0]?.inputPayload).toEqual({ env: 'production' });
  });

  it('supports alternative mcp.tools.invoke RPC style', async () => {
    const hostProxy = new HostToolProxy();
    hostProxy.registerTool('metrics.query', false, async (params) => {
      return {
        httpStatus: 200,
        data: { cpu: 42, host: params['host'] },
      };
    });

    const executor = new SandboxExecutor(hostProxy);

    const script = `
      const res = await mcp.tools.invoke("metrics.query", { host: "worker-1" });
      return { status: "success", cpu: res.cpu };
    `;

    const result = await executor.executeScript(script);
    expect(result.success).toBe(true);
    expect(result.returnValue).toEqual({ status: 'success', cpu: 42 });
  });

  it('captures runtime exceptions inside the sandbox cleanly', async () => {
    const hostProxy = new HostToolProxy();
    const executor = new SandboxExecutor(hostProxy);

    const script = `
      throw new Error("Explicit isolate fault");
    `;

    const res = await executor.executeScript(script);
    expect(res.success).toBe(false);
    expect(res.error).toBe('Explicit isolate fault');
    expect(res.logs.some((l) => l.includes('[RUNTIME EXCEPTION] Explicit isolate fault'))).toBe(true);
  });
});
