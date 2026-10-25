import { describe, it, expect } from 'vitest';
import type { TaskContext } from '@reflex-ai/core';
import { JevDecisionBatchSchema } from '@reflex-ai/core';
import { buildConservativeFallback } from '../src/fallback.js';

describe('Jev Conservative Fallback Builder', () => {
  it('routes to ASK_USER when task contains mutation keywords', () => {
    const context: TaskContext = {
      taskId: 'task_fall_1',
      task: 'Delete all staging containers',
      environment: 'staging',
      callerRole: 'developer',
      availableTools: ['containers.delete'],
    };

    const fallback = buildConservativeFallback(context, 850, 'Timeout after 800ms');
    expect(fallback.route.selected).toBe('ASK_USER');
    expect(fallback.requiresMutation.willMutateState).toBe(true);
    expect(fallback.route.confidence).toBe(0.0);
    expect(fallback.policyViolation.isViolation).toBe(false);

    // Schema validation
    expect(JevDecisionBatchSchema.parse(fallback)).toBeDefined();
  });

  it('routes to FALLBACK when task has no mutation keywords and times out', () => {
    const context: TaskContext = {
      taskId: 'task_fall_2',
      task: 'Read status metrics for cluster',
      environment: 'staging',
      callerRole: 'developer',
      availableTools: ['metrics.read'],
    };

    const fallback = buildConservativeFallback(context, 820, 'Gateway Timeout 504');
    expect(fallback.route.selected).toBe('FALLBACK');
    expect(fallback.requiresMutation.willMutateState).toBe(false);
    expect(fallback.route.confidence).toBe(0.0);

    // Schema validation
    expect(JevDecisionBatchSchema.parse(fallback)).toBeDefined();
  });

  it('never silently downgrades to FAST_PATH on failure', () => {
    const context: TaskContext = {
      taskId: 'task_fall_3',
      task: 'Lookup deployment info and delete if dead',
      environment: 'staging',
      callerRole: 'developer',
      availableTools: ['deployments.get', 'deployments.delete'],
    };

    const fallback = buildConservativeFallback(context, 900, 'Connection reset');
    expect(fallback.route.selected).not.toBe('FAST_PATH');
  });
});
