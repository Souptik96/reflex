import { describe, expect, it } from 'vitest';
import type { TaskContext } from '@reflex-ai/core';
import { JevClient, MockJevProvider } from '@reflex-ai/jev';
import { HostToolProxy } from '@reflex-ai/cloudflare';
import { ReflexAgent } from '../src/index.js';

describe('Chaos & Fault-Injection Resilience Suite (@reflex-ai/reflex)', () => {
  // ─────────────────────────────────────────────────────────────
  // Vector 1: Simulated Network Drops & Socket Timeouts
  // ─────────────────────────────────────────────────────────────
  describe('Vector 1: Network Drops & Timeouts', () => {
    it('gracefully triggers conservative fallback on Jev TCP socket timeout without allowing unvetted execution', async () => {
      const mockJev = new MockJevProvider({
        shouldTimeout: true,
      });
      const jevClient = new JevClient({ timeoutMs: 50 });
      // Inject mock provider into client
      (jevClient as unknown as { provider: unknown }).provider = mockJev;

      const agent = new ReflexAgent({ jevClient });

      const context: TaskContext = {
        taskId: 'chaos_timeout_01',
        task: 'Delete outdated deployment replicas',
        environment: 'staging',
        callerRole: 'developer',
        availableTools: ['deployments.delete'],
      };

      const result = await agent.run(context);

      // Mutating task must NEVER silently downgrade to FAST_PATH or succeed
      expect(['SYSTEM_FALLBACK', 'NEEDS_HUMAN_REVIEW', 'BLOCKED_BY_POLICY']).toContain(result.status);
      expect(result.status).not.toBe('VERIFIED_SUCCESS');
      expect(result.status).not.toBe('UNVERIFIED_SUCCESS');
    });

    it('handles abrupt TCP connection reset (ECONNRESET) gracefully', async () => {
      const mockJev = new MockJevProvider({
        shouldThrow: true,
        errorMessage: 'read ECONNRESET at TLSWrap.onStreamRead',
      });
      const jevClient = new JevClient();
      (jevClient as unknown as { provider: unknown }).provider = mockJev;

      const agent = new ReflexAgent({ jevClient });

      const context: TaskContext = {
        taskId: 'chaos_reset_02',
        task: 'Query server telemetry status',
        environment: 'production',
        callerRole: 'admin',
        availableTools: ['metrics.get'],
      };

      const result = await agent.run(context);

      expect(result.status).toBe('SYSTEM_FALLBACK');
      expect(result.routeTaken).toBe('FALLBACK');
      expect(result.error).toContain('System fallback');
    });
  });

  // ─────────────────────────────────────────────────────────────
  // Vector 2: Malformed Jev Decision Payloads
  // ─────────────────────────────────────────────────────────────
  describe('Vector 2: Malformed Decision Payloads', () => {
    it('safely catches malformed JSON and truncated answers via Zod validation, falling back safely', async () => {
      // Mock returns malformed answer missing route_selection answers
      const mockJev = new MockJevProvider({
        responseGenerator: () => ({
          decision_id: 'dec_corrupt_999',
          latency_ms: 10,
          answers: {} as unknown as {
            route_selection: never;
            policy_risk: never;
            complexity_score: never;
            requires_mutation: never;
          },
        }),
      });

      const jevClient = new JevClient();
      (jevClient as unknown as { provider: unknown }).provider = mockJev;

      const agent = new ReflexAgent({ jevClient });

      const context: TaskContext = {
        taskId: 'chaos_malformed_01',
        task: 'Purge cache buffers',
        environment: 'production',
        callerRole: 'admin',
        availableTools: ['cache.purge'],
      };

      const result = await agent.run(context);

      // Conservative fallback intercepts malformed response
      expect(['SYSTEM_FALLBACK', 'NEEDS_HUMAN_REVIEW']).toContain(result.status);
    });

    it('safely catches non-existent route names or out-of-range probabilities', async () => {
      const mockJev = new MockJevProvider({
        responseGenerator: () => ({
          decision_id: 'dec_invalid_route',
          latency_ms: 12,
          answers: {
            route_selection: {
              type: 'choice' as const,
              selected: 'NON_EXISTENT_HALLUCINATED_ROUTE' as unknown as 'FAST_PATH',
              probabilities: { FAST_PATH: 2.5 } as unknown as Record<string, number>,
              confidence: 99.0,
            },
            policy_risk: { type: 'noul' as const, judgment: false, probability: 0.1 },
            complexity_score: { type: 'score' as const, value: 10, normalized: 2.0 },
            requires_mutation: { type: 'noul' as const, judgment: false, probability: 0.1 },
          },
        }),
      });

      const jevClient = new JevClient();
      (jevClient as unknown as { provider: unknown }).provider = mockJev;

      const agent = new ReflexAgent({ jevClient });

      const context: TaskContext = {
        taskId: 'chaos_invalid_vals',
        task: 'Inspect worker memory logs',
        environment: 'development',
        callerRole: 'developer',
        availableTools: ['logs.inspect'],
      };

      const result = await agent.run(context);
      expect(result.status).toBe('SYSTEM_FALLBACK');
    });
  });

  // ─────────────────────────────────────────────────────────────
  // Vector 3: Sandbox Catastrophic Failure
  // ─────────────────────────────────────────────────────────────
  describe('Vector 3: Sandbox Catastrophic Failure', () => {
    it('terminates infinite loop (while(true){}) via watchdog without crashing Node process', async () => {
      const agent = new ReflexAgent();

      const context: TaskContext = {
        taskId: 'chaos_sandbox_loop',
        task: 'Process telemetry queue',
        environment: 'development',
        callerRole: 'developer',
        availableTools: [],
      };

      const infiniteScript = `
        let counter = 0;
        while (true) {
          counter++;
        }
        return { status: "never_reached" };
      `;

      const result = await agent.run(context, {
        script: infiniteScript,
        timeoutMs: 150,
      });

      expect(result.status).toBe('EXECUTION_FAILED');
      expect(result.error).toMatch(/timed out/i);
    });

    it('terminates hanging asynchronous promises cleanly', async () => {
      const agent = new ReflexAgent();

      const context: TaskContext = {
        taskId: 'chaos_hanging_promise',
        task: 'Wait for event stream',
        environment: 'development',
        callerRole: 'developer',
        availableTools: [],
      };

      const hangingScript = `
        await new Promise((resolve) => {
          // never calls resolve
        });
        return { status: "done" };
      `;

      const result = await agent.run(context, {
        script: hangingScript,
        timeoutMs: 150,
      });

      expect(result.status).toBe('EXECUTION_FAILED');
      expect(result.error).toMatch(/timed out/i);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // Vector 4: Byzantine MCP Tool Servers
  // ─────────────────────────────────────────────────────────────
  describe('Vector 4: Byzantine MCP Tool Servers', () => {
    it('intercepts 500 Internal Server Error from MCP tool, records in EvidenceLedger, and flags EXECUTION_FAILED', async () => {
      const hostProxy = new HostToolProxy();
      hostProxy.registerTool('deployments.delete', true, async () => {
        throw new Error('500 Internal Server Error: Database deadlock detected');
      });

      const agent = new ReflexAgent({ hostToolProxy: hostProxy });

      const context: TaskContext = {
        taskId: 'chaos_byzantine_500',
        task: 'Delete dead container deployment',
        environment: 'development',
        callerRole: 'developer',
        availableTools: ['deployments.delete'],
      };

      const script = `
        const res = await mcp.tools.invoke("deployments.delete", { id: "dep_broken" });
        return { done: true };
      `;

      const result = await agent.run(context, { script });

      expect(result.status).toBe('EXECUTION_FAILED');
      expect(result.evidence.toolCalls.length).toBeGreaterThan(0);
      const toolCall = result.evidence.toolCalls[0];
      expect(toolCall?.toolName).toBe('deployments.delete');
      expect(toolCall?.httpStatus).toBe(500);
      expect((toolCall?.outputPayload as { error: string }).error).toContain('500 Internal Server Error');
    });

    it('intercepts corrupted/unexpected payloads and prevents unverified completion claims', async () => {
      const hostProxy = new HostToolProxy();
      // Byzantine tool returning corrupted status code 502 with invalid payload
      hostProxy.registerTool('users.sync', false, async () => ({
        httpStatus: 502,
        data: { corrupted: true, binaryTrash: '\x00\x01\xFF' },
      }));

      const agent = new ReflexAgent({ hostToolProxy: hostProxy });

      const context: TaskContext = {
        taskId: 'chaos_byzantine_corrupt',
        task: 'Sync user records',
        environment: 'development',
        callerRole: 'developer',
        availableTools: ['users.sync'],
      };

      const script = `
        await mcp.tools.invoke("users.sync", {});
        return { success: true };
      `;

      const result = await agent.run(context, { script });

      // Even though script returned { success: true }, verification detects tool call HTTP 502 and fails!
      expect(result.status).toBe('EXECUTION_FAILED');
      expect(result.evidence.toolCalls[0]?.httpStatus).toBe(502);
    });
  });
});
