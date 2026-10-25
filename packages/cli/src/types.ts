import { z } from 'zod';
import type {
  PostconditionCheck,
  ToolInvocationEvidence,
} from '@reflex-ai/core';

export const RunCommandOptionsSchema = z.object({
  env: z.string().default('development'),
  role: z.string().default('developer'),
  script: z.string().optional(),
  approvalId: z.string().optional(),
  outputJson: z.boolean().default(false),
  store: z.enum(['file', 'memory']).optional(),
  sign: z.boolean().default(false),
  interactive: z.boolean().default(false),
  storeDir: z.string().optional(),
});
export type RunCommandOptions = z.infer<typeof RunCommandOptionsSchema>;

export const VerifyCommandOptionsSchema = z.object({
  expectedPublicKey: z.string().optional(),
  outputJson: z.boolean().default(false),
});
export type VerifyCommandOptions = z.infer<typeof VerifyCommandOptionsSchema>;

export const BenchCommandOptionsSchema = z.object({
  outputJson: z.boolean().default(false),
});
export type BenchCommandOptions = z.infer<typeof BenchCommandOptionsSchema>;

export type AuditVerdict = 'TAMPER_FREE' | 'TAMPERED_DETECTED';

export interface LedgerAuditReport {
  verdict: AuditVerdict;
  taskId: string;
  timestamp: string;
  integrityPassed: boolean;
  signatureValid: boolean;
  publicKeyFingerprint?: string;
  signatureAlgorithm?: string;
  toolCalls: readonly ToolInvocationEvidence[];
  postconditionChecks: readonly PostconditionCheck[];
  allToolsSucceeded: boolean;
  allChecksPassed: boolean;
  reasons: string[];
}

export interface CliExecutionOutput<T = unknown> {
  exitCode: number;
  stdout: string;
  stderr: string;
  data?: T;
}
