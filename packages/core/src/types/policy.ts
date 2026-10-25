import { z } from 'zod';
import type { TaskContext } from './result.js';

export const PolicyActionSchema = z.enum([
  'ALLOW',
  'BLOCK',
  'REQUIRE_HUMAN_APPROVAL',
]);
export type PolicyAction = z.infer<typeof PolicyActionSchema>;

export interface PolicyRule {
  id: string;
  description: string;
  match: (context: TaskContext, toolName?: string, params?: Record<string, unknown>) => boolean | Promise<boolean>;
  action: PolicyAction;
  reason: string;
}

export const PolicyEvaluationResultSchema = z.object({
  allowed: z.boolean(),
  action: PolicyActionSchema,
  violationReason: z.string().optional(),
  flaggedRules: z.array(z.string()).default([]),
  requiresHumanReview: z.boolean().default(false),
});
export type PolicyEvaluationResult = z.infer<typeof PolicyEvaluationResultSchema>;

export const PolicyConfigSchema = z.object({
  blockedPatterns: z.array(z.instanceof(RegExp)).optional(),
  forbiddenKeywords: z.array(z.string()).optional(),
  allowedEnvironments: z.array(z.string()).optional(),
  environmentRolePermissions: z.record(z.string(), z.array(z.string())).optional(),
  requireApprovalForMutations: z.boolean().optional(),
  maxComplexityBudget: z.number().min(1).max(5).optional(),
  confidenceThreshold: z.number().min(0).max(1).optional(),
});
export type PolicyConfig = z.infer<typeof PolicyConfigSchema> & {
  rules?: PolicyRule[];
};
