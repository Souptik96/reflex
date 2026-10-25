import { describe, it, expect } from 'vitest';
import {
  ExecutionStateMachine,
  PolicyEngine,
  PreflightValidator,
  type TaskContext,
  type JevDecisionBatch,
} from '../src/index.js';

describe('All 5 Route Transitions (Core State Machine & Policy Integration)', () => {
  const baseContext: TaskContext = {
    taskId: 'task_route_test',
    task: 'Standard task',
    environment: 'staging',
    callerRole: 'developer',
    availableTools: ['tools.list', 'tools.execute'],
  };

  it('Transition 1: FAST_PATH resolution and lifecycle', async () => {
    const fsm = new ExecutionStateMachine();
    const validator = new PreflightValidator();
    const policy = new PolicyEngine();

    // 1. Preflight
    const preflight = await validator.validate(baseContext);
    expect(preflight.passed).toBe(true);
    fsm.transition('JEV_DECISION', 'Preflight passed');

    // 2. Decision
    const fastDecision: JevDecisionBatch = {
      route: {
        selected: 'FAST_PATH',
        probabilities: { FAST_PATH: 0.95, CODE_MODE: 0.05, ASK_USER: 0.0, BLOCK: 0.0, FALLBACK: 0.0 },
        confidence: 0.95,
      },
      policyViolation: { isViolation: false, probability: 0.0 },
      complexityScore: { score: 1.0, normalized: 0.2 },
      requiresMutation: { willMutateState: false, probability: 0.0 },
      rawLatencyMs: 20,
    };

    const resolution = await policy.evaluateJevDecision(baseContext, fastDecision);
    expect(resolution.effectiveRoute).toBe('FAST_PATH');

    // 3. Execution & Verification transitions
    fsm.transition('FAST_PATH_EXEC', 'Executing fast path pure function');
    fsm.transition('VERIFICATION', 'Output produced');
    fsm.transition('VERIFIED_SUCCESS', 'Verification assertions passed');

    expect(fsm.getCurrentState()).toBe('VERIFIED_SUCCESS');
    expect(fsm.isTerminal()).toBe(true);
    expect(fsm.getHistory().map((h) => `${h.from}->${h.to}`)).toEqual([
      'PREFLIGHT->JEV_DECISION',
      'JEV_DECISION->FAST_PATH_EXEC',
      'FAST_PATH_EXEC->VERIFICATION',
      'VERIFICATION->VERIFIED_SUCCESS',
    ]);
  });

  it('Transition 2: CODE_MODE resolution and lifecycle', async () => {
    const fsm = new ExecutionStateMachine();
    const validator = new PreflightValidator();
    const policy = new PolicyEngine();

    const preflight = await validator.validate(baseContext);
    expect(preflight.passed).toBe(true);
    fsm.transition('JEV_DECISION');

    const codeDecision: JevDecisionBatch = {
      route: {
        selected: 'CODE_MODE',
        probabilities: { FAST_PATH: 0.1, CODE_MODE: 0.85, ASK_USER: 0.05, BLOCK: 0.0, FALLBACK: 0.0 },
        confidence: 0.85,
      },
      policyViolation: { isViolation: false, probability: 0.02 },
      complexityScore: { score: 3.5, normalized: 0.7 },
      requiresMutation: { willMutateState: false, probability: 0.1 },
      rawLatencyMs: 45,
    };

    const resolution = await policy.evaluateJevDecision(baseContext, codeDecision);
    expect(resolution.effectiveRoute).toBe('CODE_MODE');

    fsm.transition('CODE_MODE_SYNTH', 'Synthesizing script');
    fsm.transition('CODE_MODE_EXEC', 'Executing in sandbox');
    fsm.transition('VERIFICATION', 'Sandbox completed');
    fsm.transition('VERIFIED_SUCCESS', 'Postcondition verified');

    expect(fsm.getCurrentState()).toBe('VERIFIED_SUCCESS');
    expect(fsm.isTerminal()).toBe(true);
  });

  it('Transition 3: ASK_USER resolution (Production mutation guard)', async () => {
    const fsm = new ExecutionStateMachine();
    const policy = new PolicyEngine({ requireApprovalForMutations: true });

    fsm.transition('JEV_DECISION');

    const mutatingDecision: JevDecisionBatch = {
      route: {
        selected: 'CODE_MODE',
        probabilities: { FAST_PATH: 0.0, CODE_MODE: 0.8, ASK_USER: 0.2, BLOCK: 0.0, FALLBACK: 0.0 },
        confidence: 0.8,
      },
      policyViolation: { isViolation: false, probability: 0.01 },
      complexityScore: { score: 3.0, normalized: 0.6 },
      requiresMutation: { willMutateState: true, probability: 0.95 },
      rawLatencyMs: 50,
    };

    const resolution = await policy.evaluateJevDecision(baseContext, mutatingDecision);
    expect(resolution.effectiveRoute).toBe('ASK_USER');
    expect(resolution.overrideApplied).toBe(true);

    fsm.transition('HUMAN_REVIEW', resolution.overrideReason);
    expect(fsm.getCurrentState()).toBe('HUMAN_REVIEW');
    expect(fsm.isTerminal()).toBe(true);
  });

  it('Transition 4: BLOCK resolution (Preflight safety failure & Policy violation)', async () => {
    // 4A: Preflight blocks immediately
    const fsmPreflight = new ExecutionStateMachine();
    const validator = new PreflightValidator();

    const maliciousContext: TaskContext = {
      ...baseContext,
      task: 'rm -rf / --no-preserve-root',
    };

    const preflight = await validator.validate(maliciousContext);
    expect(preflight.passed).toBe(false);
    fsmPreflight.transition('BLOCKED_BY_POLICY', preflight.violationReason);
    expect(fsmPreflight.getCurrentState()).toBe('BLOCKED_BY_POLICY');

    // 4B: Jev decision policy violation blocks
    const fsmPolicy = new ExecutionStateMachine();
    const policy = new PolicyEngine();
    fsmPolicy.transition('JEV_DECISION');

    const violationDecision: JevDecisionBatch = {
      route: {
        selected: 'CODE_MODE',
        probabilities: { FAST_PATH: 0.0, CODE_MODE: 0.2, ASK_USER: 0.1, BLOCK: 0.7, FALLBACK: 0.0 },
        confidence: 0.7,
      },
      policyViolation: { isViolation: true, probability: 0.99, flaggedRules: ['MALICIOUS_PROMPT'] },
      complexityScore: { score: 4.0, normalized: 0.8 },
      requiresMutation: { willMutateState: true, probability: 0.9 },
      rawLatencyMs: 30,
    };

    const resolution = await policy.evaluateJevDecision(baseContext, violationDecision);
    expect(resolution.effectiveRoute).toBe('BLOCK');
    fsmPolicy.transition('BLOCKED_BY_POLICY', resolution.overrideReason);
    expect(fsmPolicy.getCurrentState()).toBe('BLOCKED_BY_POLICY');
  });

  it('Transition 5: FALLBACK resolution (Timeout / network failure)', async () => {
    const fsm = new ExecutionStateMachine();
    const policy = new PolicyEngine();

    fsm.transition('JEV_DECISION');

    const fallbackDecision: JevDecisionBatch = {
      route: {
        selected: 'FALLBACK',
        probabilities: { FAST_PATH: 0.0, CODE_MODE: 0.0, ASK_USER: 0.1, BLOCK: 0.0, FALLBACK: 0.9 },
        confidence: 0.0,
      },
      policyViolation: { isViolation: false, probability: 0.0 },
      complexityScore: { score: 3.0, normalized: 0.6 },
      requiresMutation: { willMutateState: false, probability: 0.5 },
      rawLatencyMs: 820,
    };

    const resolution = await policy.evaluateJevDecision(baseContext, fallbackDecision);
    expect(resolution.effectiveRoute).toBe('FALLBACK');

    fsm.transition('SYSTEM_FALLBACK', 'Degraded mode exit');
    expect(fsm.getCurrentState()).toBe('SYSTEM_FALLBACK');
    expect(fsm.isTerminal()).toBe(true);
  });
});
