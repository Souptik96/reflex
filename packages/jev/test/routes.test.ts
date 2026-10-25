import { describe, it, expect } from 'vitest';
import type { TaskContext } from '@reflex-ai/core';
import { JevClient } from '../src/client.js';
import { MockJevProvider } from '../src/providers/mock.js';

describe('All 5 Route Decisions (Jev Client & Provider Coverage)', () => {
  const baseContext: TaskContext = {
    taskId: 'task_jev_routes',
    task: 'Base task',
    environment: 'staging',
    callerRole: 'developer',
    availableTools: ['tools.list', 'tools.update'],
  };

  it('covers Route 1: FAST_PATH', async () => {
    const mock = new MockJevProvider({
      responseGenerator: () => ({
        decision_id: 'dec_fast_path',
        latency_ms: 25,
        usage: { input_tokens: 40, output_tokens: 10 },
        answers: {
          route_selection: {
            type: 'choice',
            selected: 'FAST_PATH',
            probabilities: { FAST_PATH: 0.95, CODE_MODE: 0.05, ASK_USER: 0.0, BLOCK: 0.0 },
            confidence: 0.95,
          },
          policy_risk: { type: 'noul', judgment: false, probability: 0.01 },
          complexity_score: { type: 'score', value: 1.0, normalized: 0.2 },
          requires_mutation: { type: 'noul', judgment: false, probability: 0.0 },
        },
      }),
    });

    const client = new JevClient({ customProvider: mock });
    const decision = await client.evaluate(baseContext);

    expect(decision.route.selected).toBe('FAST_PATH');
    expect(decision.route.confidence).toBe(0.95);
    expect(decision.requiresMutation.willMutateState).toBe(false);
  });

  it('covers Route 2: CODE_MODE', async () => {
    const mock = new MockJevProvider({
      responseGenerator: () => ({
        decision_id: 'dec_code_mode',
        latency_ms: 55,
        usage: { input_tokens: 80, output_tokens: 15 },
        answers: {
          route_selection: {
            type: 'choice',
            selected: 'CODE_MODE',
            probabilities: { FAST_PATH: 0.05, CODE_MODE: 0.9, ASK_USER: 0.05, BLOCK: 0.0 },
            confidence: 0.9,
          },
          policy_risk: { type: 'noul', judgment: false, probability: 0.03 },
          complexity_score: { type: 'score', value: 3.8, normalized: 0.76 },
          requires_mutation: { type: 'noul', judgment: true, probability: 0.8 },
        },
      }),
    });

    const client = new JevClient({ customProvider: mock });
    const decision = await client.evaluate(baseContext);

    expect(decision.route.selected).toBe('CODE_MODE');
    expect(decision.route.confidence).toBe(0.9);
    expect(decision.requiresMutation.willMutateState).toBe(true);
  });

  it('covers Route 3: ASK_USER', async () => {
    const mock = new MockJevProvider({
      responseGenerator: () => ({
        decision_id: 'dec_ask_user',
        latency_ms: 40,
        usage: { input_tokens: 60, output_tokens: 10 },
        answers: {
          route_selection: {
            type: 'choice',
            selected: 'ASK_USER',
            probabilities: { FAST_PATH: 0.0, CODE_MODE: 0.1, ASK_USER: 0.9, BLOCK: 0.0 },
            confidence: 0.9,
          },
          policy_risk: { type: 'noul', judgment: false, probability: 0.1 },
          complexity_score: { type: 'score', value: 2.5, normalized: 0.5 },
          requires_mutation: { type: 'noul', judgment: true, probability: 0.9 },
        },
      }),
    });

    const client = new JevClient({ customProvider: mock });
    const decision = await client.evaluate(baseContext);

    expect(decision.route.selected).toBe('ASK_USER');
    expect(decision.route.confidence).toBe(0.9);
  });

  it('covers Route 4: BLOCK', async () => {
    const mock = new MockJevProvider({
      responseGenerator: () => ({
        decision_id: 'dec_block',
        latency_ms: 30,
        usage: { input_tokens: 50, output_tokens: 10 },
        answers: {
          route_selection: {
            type: 'choice',
            selected: 'BLOCK',
            probabilities: { FAST_PATH: 0.0, CODE_MODE: 0.0, ASK_USER: 0.05, BLOCK: 0.95 },
            confidence: 0.95,
          },
          policy_risk: { type: 'noul', judgment: true, probability: 0.99 },
          complexity_score: { type: 'score', value: 4.5, normalized: 0.9 },
          requires_mutation: { type: 'noul', judgment: true, probability: 0.95 },
        },
      }),
    });

    const client = new JevClient({ customProvider: mock });
    const decision = await client.evaluate(baseContext);

    expect(decision.route.selected).toBe('BLOCK');
    expect(decision.policyViolation.isViolation).toBe(true);
  });

  it('covers Route 5: FALLBACK (conservative fallback on timeout or network error)', async () => {
    const mock = new MockJevProvider({ shouldThrow: true, errorMessage: 'Connection timed out' });
    const client = new JevClient({ customProvider: mock });

    const decision = await client.evaluate({
      ...baseContext,
      task: 'Check cluster status', // non-mutating
    });

    expect(decision.route.selected).toBe('FALLBACK');
    expect(decision.route.confidence).toBe(0.0);
    expect(decision.policyViolation.flaggedRules?.[0]).toContain('Conservative fallback triggered');
  });
});
