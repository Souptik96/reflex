import fs from 'node:fs';
import type {
  EvidenceLedger,
  PostconditionCheck,
  ToolInvocationEvidence,
} from '@reflex-ai/core';
import { verifyLedgerIntegrity, verifyLedgerSignature } from '@reflex-ai/verify';
import { formatVerifySummary } from '../formatters.js';
import type {
  AuditVerdict,
  CliExecutionOutput,
  LedgerAuditReport,
  VerifyCommandOptions,
} from '../types.js';

export async function verifyCommand(
  ledgerFilePath: string,
  options: VerifyCommandOptions = { outputJson: false }
): Promise<CliExecutionOutput<LedgerAuditReport>> {
  if (!fs.existsSync(ledgerFilePath)) {
    const error = `Ledger file not found at path: ${ledgerFilePath}`;
    return {
      exitCode: 1,
      stdout: '',
      stderr: error,
    };
  }

  let ledger: EvidenceLedger;
  try {
    const rawContent = fs.readFileSync(ledgerFilePath, 'utf8');
    ledger = JSON.parse(rawContent) as EvidenceLedger;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const error = `Failed to parse ledger JSON: ${message}`;
    return {
      exitCode: 1,
      stdout: '',
      stderr: error,
    };
  }

  const reasons: string[] = [];

  // 1. SHA-256 Checksum Integrity Check
  const integrityPassed = verifyLedgerIntegrity(ledger);
  if (!integrityPassed) {
    reasons.push('Cryptographic SHA-256 root checksum mismatch: ledger payload has been modified');
  }

  // 2. Ed25519 Signature Verification
  let signatureValid = false;
  let publicKeyFingerprint: string | undefined;
  let signatureAlgorithm: string | undefined;

  if (ledger.signature) {
    signatureAlgorithm = ledger.signature.algorithm;
    publicKeyFingerprint = ledger.signature.publicKey;
    signatureValid = verifyLedgerSignature(ledger, options.expectedPublicKey);
    if (!signatureValid) {
      reasons.push('Ed25519 digital notary signature is invalid or does not match expected public key');
    }
  } else {
    reasons.push('Ledger is unsigned: no cryptographic Ed25519 notary block present');
  }

  // 3. Tool Invocation Status & Postcondition Check Validations
  const toolCalls = ledger.toolCalls ?? [];
  const allToolsSucceeded = toolCalls.every(
    (t: ToolInvocationEvidence) => t.httpStatus === undefined || (t.httpStatus >= 200 && t.httpStatus < 300)
  );
  if (!allToolsSucceeded) {
    reasons.push('One or more intercepted tool calls resulted in non-2xx HTTP status codes');
  }

  const postconditionChecks = ledger.postconditionChecks ?? [];
  const allChecksPassed = postconditionChecks.every((c: PostconditionCheck) => c.passed);
  if (!allChecksPassed) {
    reasons.push('One or more postcondition verification assertions failed');
  }

  // Verdict computation
  let verdict: AuditVerdict = 'TAMPER_FREE';
  if (!integrityPassed || (ledger.signature && !signatureValid)) {
    verdict = 'TAMPERED_DETECTED';
  }

  const report: LedgerAuditReport = {
    verdict,
    taskId: ledger.taskId,
    timestamp: ledger.timestamp,
    integrityPassed,
    signatureValid,
    publicKeyFingerprint,
    signatureAlgorithm,
    toolCalls,
    postconditionChecks,
    allToolsSucceeded,
    allChecksPassed,
    reasons,
  };

  const isAuditSuccessful =
    verdict === 'TAMPER_FREE' &&
    integrityPassed &&
    allChecksPassed &&
    allToolsSucceeded;

  const exitCode = isAuditSuccessful ? 0 : 1;

  const stdout = options.outputJson
    ? JSON.stringify(report, null, 2)
    : formatVerifySummary(report);

  return {
    exitCode,
    stdout,
    stderr: !isAuditSuccessful ? reasons.join('; ') : '',
    data: report,
  };
}
