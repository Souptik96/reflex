import { z } from 'zod';

export const VerificationStatusSchema = z.enum([
  'VERIFIED_SUCCESS',
  'UNVERIFIED_SUCCESS',
  'EXECUTION_FAILED',
  'VERIFICATION_FAILED',
  'BLOCKED_BY_POLICY',
  'NEEDS_HUMAN_REVIEW',
  'SYSTEM_FALLBACK',
]);
export type VerificationStatus = z.infer<typeof VerificationStatusSchema>;

export const ToolInvocationEvidenceSchema = z.object({
  callId: z.string(),
  toolName: z.string(),
  inputPayload: z.record(z.string(), z.unknown()),
  outputPayload: z.record(z.string(), z.unknown()),
  isMutation: z.boolean(),
  httpStatus: z.number().int().optional(),
  timestamp: z.string(),
  latencyMs: z.number().nonnegative(),
});
export type ToolInvocationEvidence = z.infer<typeof ToolInvocationEvidenceSchema>;

export const PostconditionCheckSchema = z.object({
  layer: z.enum(['DETERMINISTIC', 'READ_AFTER_WRITE', 'SEMANTIC']),
  target: z.string(),
  expected: z.unknown(),
  actual: z.unknown(),
  passed: z.boolean(),
  reason: z.string().optional(),
});
export type PostconditionCheck = z.infer<typeof PostconditionCheckSchema>;

export const LedgerSignatureSchema = z.object({
  algorithm: z.literal('Ed25519'),
  publicKey: z.string(),
  signatureHex: z.string(),
});
export type LedgerSignature = z.infer<typeof LedgerSignatureSchema>;

export const EvidenceLedgerSchema = z.object({
  taskId: z.string(),
  timestamp: z.string(),
  preconditionSnapshots: z.record(z.string(), z.unknown()),
  toolCalls: z.array(ToolInvocationEvidenceSchema),
  sandboxLogs: z.array(z.string()),
  postconditionChecks: z.array(PostconditionCheckSchema),
  checksum: z.string(),
  signature: LedgerSignatureSchema.optional(),
});
export type EvidenceLedger = z.infer<typeof EvidenceLedgerSchema>;

export interface LedgerStoreFilter {
  status?: VerificationStatus;
  limit?: number;
}

export interface ILedgerStore {
  saveLedger(ledger: EvidenceLedger, status?: VerificationStatus): Promise<void>;
  getLedger(taskId: string): Promise<EvidenceLedger | null>;
  listLedgers(filter?: LedgerStoreFilter): Promise<EvidenceLedger[]>;
}
