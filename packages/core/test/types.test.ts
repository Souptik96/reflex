import { describe, it, expect } from 'vitest';
import {
  ReflexRouteSchema,
  JevDecisionBatchSchema,
  EvidenceLedgerSchema,
  TaskContextSchema,
  ReflexExecutionResultSchema,
  VerificationStatusSchema,
} from '../src/types/index.js';

describe('Domain Schemas & Types (Strict Zero any)', () => {
  it('validates ReflexRouteSchema values', () => {
    expect(ReflexRouteSchema.parse('FAST_PATH')).toBe('FAST_PATH');
    expect(ReflexRouteSchema.parse('CODE_MODE')).toBe('CODE_MODE');
    expect(ReflexRouteSchema.parse('ASK_USER')).toBe('ASK_USER');
    expect(ReflexRouteSchema.parse('BLOCK')).toBe('BLOCK');
    expect(ReflexRouteSchema.parse('FALLBACK')).toBe('FALLBACK');
    expect(() => ReflexRouteSchema.parse('INVALID_ROUTE')).toThrow();
  });

  it('validates VerificationStatusSchema values', () => {
    expect(VerificationStatusSchema.parse('VERIFIED_SUCCESS')).toBe('VERIFIED_SUCCESS');
    expect(VerificationStatusSchema.parse('UNVERIFIED_SUCCESS')).toBe('UNVERIFIED_SUCCESS');
    expect(VerificationStatusSchema.parse('EXECUTION_FAILED')).toBe('EXECUTION_FAILED');
    expect(VerificationStatusSchema.parse('VERIFICATION_FAILED')).toBe('VERIFICATION_FAILED');
    expect(VerificationStatusSchema.parse('BLOCKED_BY_POLICY')).toBe('BLOCKED_BY_POLICY');
    expect(VerificationStatusSchema.parse('NEEDS_HUMAN_REVIEW')).toBe('NEEDS_HUMAN_REVIEW');
    expect(VerificationStatusSchema.parse('SYSTEM_FALLBACK')).toBe('SYSTEM_FALLBACK');
  });

  it('validates TaskContextSchema', () => {
    const valid = {
      taskId: 'task_100',
      task: 'Check cluster health',
      environment: 'staging',
      callerRole: 'developer',
      availableTools: ['cluster.status'],
    };
    expect(TaskContextSchema.parse(valid)).toEqual(valid);
  });

  it('validates JevDecisionBatchSchema', () => {
    const valid = {
      route: {
        selected: 'CODE_MODE',
        probabilities: {
          FAST_PATH: 0.1,
          CODE_MODE: 0.8,
          ASK_USER: 0.1,
          BLOCK: 0.0,
          FALLBACK: 0.0,
        },
        confidence: 0.8,
      },
      policyViolation: {
        isViolation: false,
        probability: 0.02,
      },
      complexityScore: {
        score: 3,
        normalized: 0.6,
      },
      requiresMutation: {
        willMutateState: true,
        probability: 0.85,
      },
      rawLatencyMs: 42,
    };
    expect(JevDecisionBatchSchema.parse(valid)).toBeDefined();
  });

  it('validates EvidenceLedgerSchema and ReflexExecutionResultSchema', () => {
    const ledger = {
      taskId: 't1',
      timestamp: new Date().toISOString(),
      preconditionSnapshots: {},
      toolCalls: [],
      sandboxLogs: ['Sandbox initialized'],
      postconditionChecks: [],
      checksum: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    };
    expect(EvidenceLedgerSchema.parse(ledger)).toBeDefined();

    const result = {
      taskId: 't1',
      status: 'VERIFIED_SUCCESS',
      routeTaken: 'FAST_PATH',
      output: { ok: true },
      evidence: ledger,
      metrics: {
        totalDurationMs: 15,
        decisionDurationMs: 5,
        executionDurationMs: 8,
        verificationDurationMs: 2,
        estimatedCostUsd: 0.0001,
        tokensUsed: {
          decisionInputTokens: 10,
          decisionOutputTokens: 5,
          codeGenInputTokens: 0,
          codeGenOutputTokens: 0,
        },
      },
    };
    expect(ReflexExecutionResultSchema.parse(result)).toBeDefined();
  });
});
