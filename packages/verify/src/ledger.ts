import { createHash } from 'node:crypto';
import type {
  EvidenceLedger,
  LedgerSignature,
  PostconditionCheck,
  ToolInvocationEvidence,
} from '@reflex-ai/core';

export type LedgerPayload = Omit<EvidenceLedger, 'checksum' | 'signature'>;

/**
 * Deterministically calculates a canonical SHA-256 checksum for an EvidenceLedger payload.
 */
export function calculateLedgerChecksum(payload: LedgerPayload): string {
  const sortedPayload: Record<string, unknown> = {};
  for (const key of Object.keys(payload).sort()) {
    sortedPayload[key] = (payload as Record<string, unknown>)[key];
  }
  const canonicalString = JSON.stringify(sortedPayload);
  return createHash('sha256').update(canonicalString).digest('hex');
}

/**
 * Validates the cryptographic integrity of an EvidenceLedger.
 * Returns true if and only if the recalculated checksum exactly matches the ledger's checksum.
 */
export function verifyLedgerIntegrity(ledger: EvidenceLedger): boolean {
  const { checksum, signature: _signature, ...payload } = ledger;
  const recalculated = calculateLedgerChecksum(payload);
  return recalculated === checksum;
}

export class EvidenceLedgerBuilder {
  private readonly taskId: string;
  private readonly timestamp: string;
  private readonly preconditionSnapshots: Record<string, unknown> = {};
  private readonly toolCalls: ToolInvocationEvidence[] = [];
  private readonly sandboxLogs: string[] = [];
  private readonly postconditionChecks: PostconditionCheck[] = [];
  private signature?: LedgerSignature;

  constructor(taskId: string) {
    this.taskId = taskId;
    this.timestamp = new Date().toISOString();
  }

  public recordPreconditionSnapshot(key: string, value: unknown): this {
    this.preconditionSnapshots[key] = value;
    return this;
  }

  public addToolCalls(calls: readonly ToolInvocationEvidence[]): this {
    this.toolCalls.push(...calls);
    return this;
  }

  public addSandboxLogs(logs: readonly string[]): this {
    this.sandboxLogs.push(...logs);
    return this;
  }

  public addPostconditionCheck(check: PostconditionCheck): this {
    this.postconditionChecks.push(check);
    return this;
  }

  public setSignature(signature: LedgerSignature): this {
    this.signature = signature;
    return this;
  }

  public build(): EvidenceLedger {
    const rawPayload: LedgerPayload = {
      taskId: this.taskId,
      timestamp: this.timestamp,
      preconditionSnapshots: this.preconditionSnapshots,
      toolCalls: this.toolCalls,
      sandboxLogs: this.sandboxLogs,
      postconditionChecks: this.postconditionChecks,
    };

    const checksum = calculateLedgerChecksum(rawPayload);

    return {
      ...rawPayload,
      checksum,
      ...(this.signature ? { signature: this.signature } : {}),
    };
  }
}
