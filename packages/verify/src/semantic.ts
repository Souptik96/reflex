import type { ToolInvocationEvidence } from '@reflex-ai/core';
import type { SemanticVerificationContract } from './types.js';

export interface SemanticEvaluationResult {
  passed: boolean;
  judgment: boolean;
  probability: number;
  reason?: string;
}

export type SemanticEvaluator = (
  prompt: string,
  targetContent: string,
  evidence: readonly ToolInvocationEvidence[]
) => Promise<{ judgment: boolean; probability: number }>;

export async function evaluateSemanticPostcondition(
  contract: SemanticVerificationContract,
  targetContent: string,
  evidence: readonly ToolInvocationEvidence[],
  evaluator?: SemanticEvaluator
): Promise<SemanticEvaluationResult> {
  const minConfidence = contract.minimumConfidence ?? 0.7;

  if (!evaluator) {
    // If no semantic evaluator is configured, pass with note
    return {
      passed: true,
      judgment: true,
      probability: 1.0,
      reason: 'No semantic evaluator configured, skipped Layer 3 check',
    };
  }

  try {
    const result = await evaluator(contract.prompt, targetContent, evidence);
    const passed = result.judgment === true && result.probability >= minConfidence;

    return {
      passed,
      judgment: result.judgment,
      probability: result.probability,
      reason: passed
        ? undefined
        : `Semantic verification failed: Jev judged false (probability: ${(result.probability * 100).toFixed(1)}%, min required: ${(minConfidence * 100).toFixed(1)}%) for "${contract.prompt}"`,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      passed: false,
      judgment: false,
      probability: 0,
      reason: `Semantic evaluation threw an exception: ${msg}`,
    };
  }
}
