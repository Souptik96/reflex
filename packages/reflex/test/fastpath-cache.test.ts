import { describe, expect, it } from 'vitest';
import {
  DecisionCache,
  FastPathCompiler,
  type TaskContext,
} from '@reflex-ai/core';
import { ReflexAgent } from '../src/index.js';

describe('Fast-Path Compiler & Decision Caching Pipeline (@reflex-ai/reflex)', () => {
  it('bypasses Jev and Code Mode when task matches pre-approved fast-path rule (< 5ms, $0.00 cost)', async () => {
    const compiler = new FastPathCompiler([
      {
        id: 'fast-health-check',
        pattern: /ping|health/i,
        handler: () => ({ status: 'healthy', activeNodes: 42 }),
      },
    ]);

    const agent = new ReflexAgent({
      fastPathCompiler: compiler,
    });

    const context: TaskContext = {
      taskId: 'task_fast_01',
      task: 'Run cluster health check',
      environment: 'production',
      callerRole: 'admin',
      availableTools: ['metrics.get'],
    };

    const result = await agent.run(context);

    expect(result.status).toBe('VERIFIED_SUCCESS');
    expect(result.routeTaken).toBe('FAST_PATH');
    expect(result.output).toEqual({ status: 'healthy', activeNodes: 42 });
    expect(result.metrics.estimatedCostUsd).toBe(0);
    expect(result.metrics.tokensUsed.decisionInputTokens).toBe(0);
    expect(result.metrics.tokensUsed.decisionOutputTokens).toBe(0);
    expect(result.metrics.tokensUsed.codeGenInputTokens).toBe(0);
    expect(result.metrics.tokensUsed.codeGenOutputTokens).toBe(0);
    expect(result.metrics.decisionDurationMs).toBe(0);
  });

  it('serves repeat tasks from DecisionCache in sub-1ms with zero token cost', async () => {
    const cache = new DecisionCache();
    const agent = new ReflexAgent({
      decisionCache: cache,
    });

    const context: TaskContext = {
      taskId: 'task_cache_eval_01',
      task: 'Retrieve telemetry report for staging gateway',
      environment: 'staging',
      callerRole: 'developer',
      availableTools: ['telemetry.get'],
    };

    // First execution: evaluates via Jev and populates cache
    const run1 = await agent.run(context);
    expect(cache.size()).toBe(1);
    expect(cache.has(context)).toBe(true);

    // Second execution with identical context: served from DecisionCache
    const contextRepeat: TaskContext = {
      ...context,
      taskId: 'task_cache_eval_02', // different run ID, same task context
    };

    const run2 = await agent.run(contextRepeat);

    expect(run2.metrics.decisionDurationMs).toBeLessThan(1);
    expect(run2.metrics.tokensUsed.decisionInputTokens).toBe(0);
    expect(run2.metrics.tokensUsed.decisionOutputTokens).toBe(0);
  });
});
