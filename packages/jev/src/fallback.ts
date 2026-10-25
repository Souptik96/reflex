import type { JevDecisionBatch, ReflexRoute, TaskContext } from '@reflex-ai/core';

const MUTATION_KEYWORDS = /\b(delete|drop|update|create|modify|patch|remove|kill|terminate|write|insert|alter|truncate)\b/i;

export function buildConservativeFallback(
  context: TaskContext,
  elapsedMs: number,
  errorMessage: string
): JevDecisionBatch {
  const hasMutationPotential = MUTATION_KEYWORDS.test(context.task);

  // Axiom 1 & Section 5.1:
  // If timeout/error occurs and mutation is suspected, route to ASK_USER or BLOCK; never FAST_PATH.
  // Otherwise route to FALLBACK.
  const selectedRoute: ReflexRoute = hasMutationPotential ? 'ASK_USER' : 'FALLBACK';

  const probabilities: Record<ReflexRoute, number> = {
    FAST_PATH: 0.0,
    CODE_MODE: 0.0,
    ASK_USER: hasMutationPotential ? 0.9 : 0.1,
    BLOCK: 0.0,
    FALLBACK: hasMutationPotential ? 0.1 : 0.9,
  };

  return {
    route: {
      selected: selectedRoute,
      probabilities,
      confidence: 0.0,
    },
    policyViolation: {
      isViolation: false,
      probability: 0.0,
      flaggedRules: [`Conservative fallback triggered: ${errorMessage}`],
    },
    complexityScore: {
      score: 3,
      normalized: 0.6,
    },
    requiresMutation: {
      willMutateState: hasMutationPotential,
      probability: hasMutationPotential ? 0.95 : 0.5,
    },
    rawLatencyMs: elapsedMs,
    tokenUsage: {
      inputTokens: 0,
      outputTokens: 0,
    },
  };
}
