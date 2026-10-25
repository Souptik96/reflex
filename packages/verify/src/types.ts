import { z } from 'zod';
import type {
  PostconditionCheck,
  TaskContext,
  ToolInvocationEvidence,
  VerificationStatus,
} from '@reflex-ai/core';
import type { AsyncReadAfterWriteContract } from './async-verifier.js';

export interface PreconditionContract {
  description: string;
  check: (ctx: TaskContext) => Promise<boolean> | boolean;
}

export const RequiredToolCallSchema = z.object({
  toolName: z.string().min(1),
  minCalls: z.number().int().nonnegative().default(1),
  maxCalls: z.number().int().positive().optional(),
});
export type RequiredToolCall = z.infer<typeof RequiredToolCallSchema>;

export const DeterministicAssertionSchema = z.object({
  field: z.string(),
  operator: z.enum([
    'equals',
    'contains',
    'matches',
    'schema',
    'non_empty',
    'gt',
    'gte',
    'lt',
    'lte',
  ]),
  expected: z.unknown().optional(),
});
export type DeterministicAssertion = z.infer<typeof DeterministicAssertionSchema>;

export interface ReadAfterWriteContract {
  targetResource: string;
  description?: string;
  query: (evidence: readonly ToolInvocationEvidence[]) => Promise<unknown>;
  assert: (
    readState: unknown,
    evidence: readonly ToolInvocationEvidence[]
  ) => boolean | Promise<boolean>;
  failureMessage: string;
}

export interface SemanticVerificationContract {
  description: string;
  prompt: string;
  targetField?: string;
  minimumConfidence?: number;
}

export interface VerificationContract {
  preconditions?: PreconditionContract[];
  requiredToolCalls?: RequiredToolCall[];
  deterministicAssertions?: DeterministicAssertion[];
  readAfterWrite?: ReadAfterWriteContract[];
  asyncReadAfterWrite?: AsyncReadAfterWriteContract[];
  semanticVerifications?: SemanticVerificationContract[];
}

export interface VerificationResult {
  status: VerificationStatus;
  passed: boolean;
  reason?: string;
  checks: PostconditionCheck[];
}
