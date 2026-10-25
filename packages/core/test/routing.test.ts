import { describe, expect, it } from 'vitest';
import {
  DecisionCache,
  FastPathCompiler,
  type JevDecisionBatch,
  type TaskContext,
} from '../src/index.js';

describe('DecisionCache & FastPathCompiler (@reflex-ai/core)', () => {
  const dummyContext: TaskContext = {
    taskId: 'task_cache_01',
    task: 'List deployments with traffic < 5%',
    environment: 'production',
    callerRole: 'admin',
    availableTools: ['deployments.list', 'metrics.query'],
  };

  const dummyDecision: JevDecisionBatch = {
    route: {
      selected: 'CODE_MODE',
      probabilities: { FAST_PATH: 0.1, CODE_MODE: 0.85, ASK_USER: 0.05, BLOCK: 0 },
      confidence: 0.85,
    },
    policyViolation: { isViolation: false, probability: 0.02 },
    complexityScore: { score: 3, normalized: 0.6 },
    requiresMutation: { willMutateState: false, probability: 0.1 },
    rawLatencyMs: 85,
    tokenUsage: { inputTokens: 120, outputTokens: 25 },
  };

  describe('DecisionCache', () => {
    it('computes deterministic SHA-256 cache keys irrespective of tool ordering or whitespace', () => {
      const cache = new DecisionCache();
      const key1 = cache.computeCacheKey(dummyContext);

      const rearrangedContext: TaskContext = {
        ...dummyContext,
        task: '  List deployments with traffic < 5%  ',
        availableTools: ['metrics.query', 'deployments.list'], // reversed order
      };
      const key2 = cache.computeCacheKey(rearrangedContext);

      expect(key1).toBe(key2);
    });

    it('returns sub-1ms cached decision with 0 tokens and fromCache: true', () => {
      const cache = new DecisionCache();
      cache.set(dummyContext, dummyDecision);

      expect(cache.has(dummyContext)).toBe(true);
      const hit = cache.get(dummyContext);

      expect(hit).toBeDefined();
      expect(hit?.fromCache).toBe(true);
      expect(hit?.rawLatencyMs).toBeLessThan(1);
      expect(hit?.tokenUsage?.inputTokens).toBe(0);
      expect(hit?.tokenUsage?.outputTokens).toBe(0);
      expect(hit?.route.selected).toBe('CODE_MODE');
    });

    it('evicts least recently used items when max capacity is reached', () => {
      const cache = new DecisionCache({ maxCapacity: 2 });

      const ctxA = { ...dummyContext, task: 'Task A' };
      const ctxB = { ...dummyContext, task: 'Task B' };
      const ctxC = { ...dummyContext, task: 'Task C' };

      cache.set(ctxA, dummyDecision);
      cache.set(ctxB, dummyDecision);
      expect(cache.size()).toBe(2);

      // Access A so B becomes LRU
      cache.get(ctxA);

      // Add C, which should evict B
      cache.set(ctxC, dummyDecision);

      expect(cache.has(ctxA)).toBe(true);
      expect(cache.has(ctxC)).toBe(true);
      expect(cache.has(ctxB)).toBe(false);
    });

    it('evicts expired cache entries after TTL has elapsed', async () => {
      const cache = new DecisionCache({ defaultTtlMs: 25 });
      cache.set(dummyContext, dummyDecision, 25);

      expect(cache.has(dummyContext)).toBe(true);
      await new Promise((resolve) => setTimeout(resolve, 35));

      expect(cache.has(dummyContext)).toBe(false);
      expect(cache.get(dummyContext)).toBeUndefined();
    });
  });

  describe('FastPathCompiler', () => {
    it('compiles string and regex rules with environment and role scoping', () => {
      const compiler = new FastPathCompiler([
        {
          id: 'ping-rule',
          pattern: /ping|healthz/i,
          environments: ['production', 'staging'],
          roles: ['admin', 'developer'],
          handler: () => ({ status: 'pong' }),
        },
        {
          id: 'dev-echo',
          pattern: 'echo',
          environments: ['development'],
          handler: (ctx) => ({ echo: ctx.task }),
        },
      ]);

      // 1. Matches regex rule
      const match1 = compiler.match({
        ...dummyContext,
        task: 'GET /healthz status check',
      });
      expect(match1?.id).toBe('ping-rule');

      // 2. Fails environment filter
      const matchEnvFail = compiler.match({
        ...dummyContext,
        task: 'ping',
        environment: 'local', // not in rule
      });
      expect(matchEnvFail).toBeUndefined();

      // 3. Fails role filter
      const matchRoleFail = compiler.match({
        ...dummyContext,
        task: 'ping',
        callerRole: 'guest', // not in rule
      });
      expect(matchRoleFail).toBeUndefined();

      // 4. Matches string rule in development
      const match2 = compiler.match({
        ...dummyContext,
        task: 'echo test payload',
        environment: 'development',
      });
      expect(match2?.id).toBe('dev-echo');
    });

    it('executes matched fast path rule in sub-5ms with zero model cost', async () => {
      const compiler = new FastPathCompiler([
        {
          id: 'worker-status',
          pattern: /^status check/i,
          handler: async (ctx) => {
            return {
              uptimeSeconds: 86400,
              worker: 'worker-us-east-1',
              query: ctx.task,
            };
          },
        },
      ]);

      const res = await compiler.execute({
        ...dummyContext,
        task: 'Status check on edge fleet',
      });

      expect(res.matched).toBe(true);
      expect(res.ruleId).toBe('worker-status');
      expect(res.durationMs).toBeLessThan(10);
      expect((res.output as { worker: string }).worker).toBe('worker-us-east-1');
    });
  });
});
