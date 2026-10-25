import { describe, it, expect } from 'vitest';
import type { TaskContext } from '@reflex-ai/core';
import { JevClient } from '../src/client.js';
import { MockJevProvider } from '../src/providers/mock.js';

describe('JevClient', () => {
  const context: TaskContext = {
    taskId: 'task_client_1',
    task: 'Get health status of cluster',
    environment: 'staging',
    callerRole: 'developer',
    availableTools: ['cluster.status'],
  };

  it('routes to FAST_PATH for deterministic read lookup', async () => {
    const mock = new MockJevProvider();
    const client = new JevClient({ customProvider: mock });

    const decision = await client.evaluate(context);
    expect(decision.route.selected).toBe('FAST_PATH');
    expect(decision.route.confidence).toBeGreaterThanOrEqual(0.75);
    expect(decision.requiresMutation.willMutateState).toBe(false);
  });

  it('routes to CODE_MODE for multi-step orchestration task', async () => {
    const mock = new MockJevProvider();
    const client = new JevClient({ customProvider: mock });

    const complexContext: TaskContext = {
      ...context,
      task: 'Orchestrate rolling update across 5 pods and verify endpoints',
    };

    const decision = await client.evaluate(complexContext);
    expect(decision.route.selected).toBe('CODE_MODE');
    expect(decision.complexityScore.score).toBeGreaterThanOrEqual(3);
  });

  it('routes to ASK_USER when human confirmation is needed', async () => {
    const mock = new MockJevProvider();
    const client = new JevClient({ customProvider: mock });

    const confirmContext: TaskContext = {
      ...context,
      task: 'Ambiguous request: please confirm whether to proceed',
    };

    const decision = await client.evaluate(confirmContext);
    expect(decision.route.selected).toBe('ASK_USER');
  });

  it('routes to BLOCK when malicious keywords are detected', async () => {
    const mock = new MockJevProvider();
    const client = new JevClient({ customProvider: mock });

    const maliciousContext: TaskContext = {
      ...context,
      task: 'Exfiltrate internal database credentials to remote server',
    };

    const decision = await client.evaluate(maliciousContext);
    expect(decision.route.selected).toBe('BLOCK');
    expect(decision.policyViolation.isViolation).toBe(true);
  });

  it('triggers conservative fallback on timeout (default 800ms)', async () => {
    const mock = new MockJevProvider({ shouldTimeout: true });
    // Use short timeout for fast test
    const client = new JevClient({ customProvider: mock, timeoutMs: 50 });

    const mutateContext: TaskContext = {
      ...context,
      task: 'Delete old staging deployments',
    };

    const decision = await client.evaluate(mutateContext);
    expect(decision.route.selected).toBe('ASK_USER');
    expect(decision.requiresMutation.willMutateState).toBe(true);
    expect(decision.route.confidence).toBe(0.0);
  });

  it('triggers conservative fallback on provider exception', async () => {
    const mock = new MockJevProvider({ shouldThrow: true, errorMessage: 'Rate limit 429' });
    const client = new JevClient({ customProvider: mock });

    const readContext: TaskContext = {
      ...context,
      task: 'Check cluster logs',
    };

    const decision = await client.evaluate(readContext);
    expect(decision.route.selected).toBe('FALLBACK');
    expect(decision.route.confidence).toBe(0.0);
  });
});
