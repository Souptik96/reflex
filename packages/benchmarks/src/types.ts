import { z } from 'zod';
import type { TaskContext } from '@reflex-ai/core';
import type { VerificationContract } from '@reflex-ai/verify';

export const BenchmarkCategorySchema = z.enum([
  'DETERMINISTIC_LOOKUP',
  'MULTI_STEP_ORCHESTRATION',
  'UNAUTHORIZED_MUTATION',
  'ADVERSARIAL_LYING',
  'SEMANTIC_ANALYSIS',
]);
export type BenchmarkCategory = z.infer<typeof BenchmarkCategorySchema>;

export const ExpectedOutcomeSchema = z.enum([
  'SUCCESS',
  'BLOCKED',
  'NEEDS_REVIEW',
  'VERIFICATION_FAILED',
]);
export type ExpectedOutcome = z.infer<typeof ExpectedOutcomeSchema>;

export interface ReActStep {
  thought: string;
  toolName: string;
  params: Record<string, unknown>;
  simulatedResponse: { httpStatus: number; data: unknown };
}

export interface BenchmarkTask {
  id: string;
  name: string;
  category: BenchmarkCategory;
  context: TaskContext;
  script?: string; // For Code Mode & Reflex
  reactSteps?: ReActStep[]; // For ReAct sequential simulation
  verificationContract?: VerificationContract;
  isAdversarial?: boolean; // Simulates lying tool/agent
  isSimpleLookup?: boolean; // Ideal for FAST_PATH
  expectedOutcome: ExpectedOutcome;
}

export const HarnessExecutionResultSchema = z.object({
  harnessName: z.enum([
    'BASELINE_A_REACT',
    'BASELINE_B_CODEMODE',
    'CANDIDATE_C_REFLEX',
  ]),
  taskId: z.string(),
  reportedSuccess: z.boolean(),
  realStateSuccess: z.boolean(),
  latencyMs: z.number().nonnegative(),
  costUsd: z.number().nonnegative(),
  usedSlowPath: z.boolean(),
  isFalseSafe: z.boolean(),
  detectedFailure: z.boolean(),
  tokensUsed: z.object({
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
  }),
  output: z.unknown().optional(),
  error: z.string().optional(),
});
export type HarnessExecutionResult = z.infer<typeof HarnessExecutionResultSchema>;

export const HarnessMetricsSchema = z.object({
  harnessName: z.string(),
  totalTasks: z.number().int().nonnegative(),
  completedTasks: z.number().int().nonnegative(),
  taskCompletionRate: z.number().min(0).max(100),
  p50LatencyMs: z.number().nonnegative(),
  p90LatencyMs: z.number().nonnegative(),
  p95LatencyMs: z.number().nonnegative(),
  meanLatencyMs: z.number().nonnegative(),
  totalCostUsd: z.number().nonnegative(),
  costPerSuccessfulTask: z.number().nonnegative(),
  unnecessarySlowPathRate: z.number().min(0).max(100),
  falseSafeRate: z.number().min(0).max(100),
  verificationDetectionRate: z.number().min(0).max(100),
});
export type HarnessMetrics = z.infer<typeof HarnessMetricsSchema>;

export const BenchmarkComparisonReportSchema = z.object({
  timestamp: z.string(),
  harnesses: z.record(z.string(), HarnessMetricsSchema),
  reflexImprovements: z.object({
    latencyReductionP50Percent: z.number(),
    costReductionPercent: z.number(),
    falseSafeReductionPercent: z.number(),
    unnecessarySlowPathRate: z.number(),
  }),
});
export type BenchmarkComparisonReport = z.infer<typeof BenchmarkComparisonReportSchema>;
