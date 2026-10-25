import { z } from 'zod';
import { ReflexRouteSchema } from './route.js';

export const RouteDecisionSchema = z.object({
  selected: ReflexRouteSchema,
  probabilities: z.record(ReflexRouteSchema, z.number().min(0).max(1)),
  confidence: z.number().min(0).max(1),
});
export type RouteDecision = z.infer<typeof RouteDecisionSchema>;

export const PolicyViolationDecisionSchema = z.object({
  isViolation: z.boolean(),
  probability: z.number().min(0).max(1),
  flaggedRules: z.array(z.string()).optional(),
});
export type PolicyViolationDecision = z.infer<typeof PolicyViolationDecisionSchema>;

export const ComplexityScoreDecisionSchema = z.object({
  score: z.number().min(1).max(5),
  normalized: z.number().min(0).max(1),
});
export type ComplexityScoreDecision = z.infer<typeof ComplexityScoreDecisionSchema>;

export const RequiresMutationDecisionSchema = z.object({
  willMutateState: z.boolean(),
  probability: z.number().min(0).max(1),
});
export type RequiresMutationDecision = z.infer<typeof RequiresMutationDecisionSchema>;

export const TokenUsageSchema = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
});
export type TokenUsage = z.infer<typeof TokenUsageSchema>;

export const JevDecisionBatchSchema = z.object({
  route: RouteDecisionSchema,
  policyViolation: PolicyViolationDecisionSchema,
  complexityScore: ComplexityScoreDecisionSchema,
  requiresMutation: RequiresMutationDecisionSchema,
  rawLatencyMs: z.number().nonnegative(),
  tokenUsage: TokenUsageSchema.optional(),
  fromCache: z.boolean().optional(),
});
export type JevDecisionBatch = z.infer<typeof JevDecisionBatchSchema>;
