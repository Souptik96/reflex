import { describe, it, expect } from 'vitest';
import { evaluateSemanticPostcondition } from '../src/semantic.js';
import type { ToolInvocationEvidence } from '@reflex-ai/core';

describe('Layer 3 Bounded Semantic Verification (Jev Noul)', () => {
  const sampleEvidence: ToolInvocationEvidence[] = [
    {
      callId: 'call_logs_1',
      toolName: 'logs.query',
      inputPayload: { service: 'redis' },
      outputPayload: { error: 'OOMKilled: container exceeded memory limit 512Mi' },
      isMutation: false,
      httpStatus: 200,
      timestamp: new Date().toISOString(),
      latencyMs: 30,
    },
  ];

  it('passes when Jev judges true with high confidence', async () => {
    const mockEvaluator = async () => ({
      judgment: true,
      probability: 0.94,
    });

    const result = await evaluateSemanticPostcondition(
      {
        description: 'Verify OOM root cause explained',
        prompt: 'Does the incident summary accurately identify Redis OOM as the root cause?',
        minimumConfidence: 0.8,
      },
      'Incident inc_404 was caused by Redis container running out of memory (OOMKilled).',
      sampleEvidence,
      mockEvaluator
    );

    expect(result.passed).toBe(true);
    expect(result.judgment).toBe(true);
    expect(result.probability).toBe(0.94);
    expect(result.reason).toBeUndefined();
  });

  it('fails when Jev judges false', async () => {
    const mockEvaluator = async () => ({
      judgment: false,
      probability: 0.88,
    });

    const result = await evaluateSemanticPostcondition(
      {
        description: 'Verify OOM root cause explained',
        prompt: 'Does the incident summary accurately identify Redis OOM as the root cause?',
        minimumConfidence: 0.8,
      },
      'The incident was resolved by restarting the server due to high network traffic.',
      sampleEvidence,
      mockEvaluator
    );

    expect(result.passed).toBe(false);
    expect(result.judgment).toBe(false);
    expect(result.reason).toContain('Semantic verification failed: Jev judged false');
  });

  it('fails when Jev probability is below minimumConfidence threshold', async () => {
    const mockEvaluator = async () => ({
      judgment: true,
      probability: 0.65, // below 0.85
    });

    const result = await evaluateSemanticPostcondition(
      {
        description: 'High confidence confirmation',
        prompt: 'Is the explanation complete?',
        minimumConfidence: 0.85,
      },
      'Brief explanation.',
      sampleEvidence,
      mockEvaluator
    );

    expect(result.passed).toBe(false);
    expect(result.reason).toContain('probability: 65.0%, min required: 85.0%');
  });

  it('handles evaluator exceptions gracefully without crashing', async () => {
    const failingEvaluator = async () => {
      throw new Error('Jev API timeout');
    };

    const result = await evaluateSemanticPostcondition(
      {
        description: 'Check error handling',
        prompt: 'Did it pass?',
      },
      'Some output text',
      sampleEvidence,
      failingEvaluator
    );

    expect(result.passed).toBe(false);
    expect(result.reason).toContain('Semantic evaluation threw an exception: Jev API timeout');
  });
});
