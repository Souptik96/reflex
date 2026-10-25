import { z } from 'zod';
import { ReflexRouteSchema, type ReflexRoute } from './route.js';
import {
  VerificationStatusSchema,
  EvidenceLedgerSchema,
  type VerificationStatus,
  type EvidenceLedger,
} from './evidence.js';

export const TaskContextSchema = z.object({
  taskId: z.string().min(1),
  task: z.string().min(1),
  environment: z.string().min(1),
  callerRole: z.string().min(1),
  availableTools: z.array(z.string()),
  tenantId: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type TaskContext = z.infer<typeof TaskContextSchema>;

export const ExecutionMetricsTokensSchema = z.object({
  decisionInputTokens: z.number().int().nonnegative(),
  decisionOutputTokens: z.number().int().nonnegative(),
  codeGenInputTokens: z.number().int().nonnegative(),
  codeGenOutputTokens: z.number().int().nonnegative(),
});
export type ExecutionMetricsTokens = z.infer<typeof ExecutionMetricsTokensSchema>;

export const ExecutionMetricsSchema = z.object({
  totalDurationMs: z.number().nonnegative(),
  decisionDurationMs: z.number().nonnegative(),
  executionDurationMs: z.number().nonnegative(),
  verificationDurationMs: z.number().nonnegative(),
  estimatedCostUsd: z.number().nonnegative(),
  tokensUsed: ExecutionMetricsTokensSchema,
});
export type ExecutionMetrics = z.infer<typeof ExecutionMetricsSchema>;

export interface ReflexExecutionResult<TOutput = unknown> {
  taskId: string;
  status: VerificationStatus;
  routeTaken: ReflexRoute;
  output?: TOutput;
  error?: string;
  approvalId?: string;
  evidence: EvidenceLedger;
  metrics: ExecutionMetrics;
}

export const ReflexExecutionResultSchema = z.object({
  taskId: z.string(),
  status: VerificationStatusSchema,
  routeTaken: ReflexRouteSchema,
  output: z.unknown().optional(),
  error: z.string().optional(),
  approvalId: z.string().optional(),
  evidence: EvidenceLedgerSchema,
  metrics: ExecutionMetricsSchema,
});
