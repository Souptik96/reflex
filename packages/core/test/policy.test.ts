import { describe, it, expect } from 'vitest';
import { PolicyEngine } from '../src/policy/engine.js';
import type { TaskContext } from '../src/types/result.js';
import type { JevDecisionBatch } from '../src/types/decision.js';

describe('PolicyEngine', () => {
  const context: TaskContext = {
    taskId: 'task_pol_1',
    task: 'List deployments',
    environment: 'staging',
    callerRole: 'developer',
    availableTools: ['deployments.list', 'deployments.delete'],
  };

  const baseDecision: JevDecisionBatch = {
    route: {
      selected: 'FAST_PATH',
      probabilities: { FAST_PATH: 0.9, CODE_MODE: 0.1, ASK_USER: 0.0, BLOCK: 0.0, FALLBACK: 0.0 },
      confidence: 0.9,
    },
    policyViolation: {
      isViolation: false,
      probability: 0.05,
    },
    complexityScore: {
      score: 1.5,
      normalized: 0.3,
    },
    requiresMutation: {
      willMutateState: false,
      probability: 0.05,
    },
    rawLatencyMs: 35,
  };

  it('accepts valid FAST_PATH decision with high confidence and no mutations', async () => {
    const engine = new PolicyEngine();
    const resolution = await engine.evaluateJevDecision(context, baseDecision);

    expect(resolution.effectiveRoute).toBe('FAST_PATH');
    expect(resolution.overrideApplied).toBe(false);
  });

  it('overrides to BLOCK if Jev flags a policy violation', async () => {
    const engine = new PolicyEngine();
    const violationDecision: JevDecisionBatch = {
      ...baseDecision,
      policyViolation: {
        isViolation: true,
        probability: 0.95,
        flaggedRules: ['UNAUTHORIZED_DATA_ACCESS'],
      },
    };

    const resolution = await engine.evaluateJevDecision(context, violationDecision);
    expect(resolution.effectiveRoute).toBe('BLOCK');
    expect(resolution.overrideApplied).toBe(true);
    expect(resolution.flaggedRules).toContain('UNAUTHORIZED_DATA_ACCESS');
  });

  it('prevents FAST_PATH from mutating state (escalates to CODE_MODE)', async () => {
    const engine = new PolicyEngine();
    const mutatingFastPath: JevDecisionBatch = {
      ...baseDecision,
      requiresMutation: {
        willMutateState: true,
        probability: 0.9,
      },
    };

    const resolution = await engine.evaluateJevDecision(context, mutatingFastPath);
    expect(resolution.effectiveRoute).toBe('CODE_MODE');
    expect(resolution.overrideApplied).toBe(true);
    expect(resolution.overrideReason).toContain('Fast path cannot execute unverified mutations');
  });

  it('escalates to ASK_USER when mutations are required in production', async () => {
    const engine = new PolicyEngine();
    const prodContext: TaskContext = {
      ...context,
      environment: 'production',
      callerRole: 'admin',
    };
    const mutatingDecision: JevDecisionBatch = {
      ...baseDecision,
      route: {
        selected: 'CODE_MODE',
        probabilities: { FAST_PATH: 0.0, CODE_MODE: 0.9, ASK_USER: 0.1, BLOCK: 0.0, FALLBACK: 0.0 },
        confidence: 0.9,
      },
      requiresMutation: {
        willMutateState: true,
        probability: 0.92,
      },
    };

    const resolution = await engine.evaluateJevDecision(prodContext, mutatingDecision);
    expect(resolution.effectiveRoute).toBe('ASK_USER');
    expect(resolution.overrideApplied).toBe(true);
    expect(resolution.overrideReason).toContain('State mutation in production requires human confirmation');
  });

  it('escalates low confidence decisions to CODE_MODE or ASK_USER', async () => {
    const engine = new PolicyEngine({ confidenceThreshold: 0.8 });
    const lowConfDecision: JevDecisionBatch = {
      ...baseDecision,
      route: {
        selected: 'FAST_PATH',
        probabilities: { FAST_PATH: 0.65, CODE_MODE: 0.25, ASK_USER: 0.1, BLOCK: 0.0, FALLBACK: 0.0 },
        confidence: 0.65, // below 0.8
      },
    };

    const resolution = await engine.evaluateJevDecision(context, lowConfDecision);
    expect(resolution.effectiveRoute).toBe('CODE_MODE');
    expect(resolution.overrideApplied).toBe(true);
  });

  it('escalates to ASK_USER when complexity exceeds budget', async () => {
    const engine = new PolicyEngine({ maxComplexityBudget: 3 });
    const complexDecision: JevDecisionBatch = {
      ...baseDecision,
      complexityScore: {
        score: 4.8,
        normalized: 0.96,
      },
    };

    const resolution = await engine.evaluateJevDecision(context, complexDecision);
    expect(resolution.effectiveRoute).toBe('ASK_USER');
    expect(resolution.overrideApplied).toBe(true);
    expect(resolution.overrideReason).toContain('exceeds budget');
  });

  it('evaluates tool invocations through programmatic policy rules', async () => {
    const engine = new PolicyEngine({
      rules: [
        {
          id: 'NO_PROD_DATABASE_DROP',
          description: 'Cannot delete production databases',
          action: 'BLOCK',
          reason: 'Protected production resource',
          match: (ctx, tool) => ctx.environment === 'production' && tool === 'database.drop',
        },
      ],
    });

    const prodCtx: TaskContext = { ...context, environment: 'production' };
    const result = await engine.evaluateToolInvocation(
      prodCtx,
      'database.drop',
      { db: 'users_prod' },
      true
    );

    expect(result.allowed).toBe(false);
    expect(result.action).toBe('BLOCK');
    expect(result.flaggedRules).toContain('NO_PROD_DATABASE_DROP');
  });
});
