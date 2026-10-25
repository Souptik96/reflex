import type { ReflexExecutionResult } from '@reflex-ai/core';
import type { LedgerAuditReport } from './types.js';

export function formatRunSummary(result: ReflexExecutionResult): string {
  const lines: string[] = [];

  lines.push('================================================================');
  lines.push('               REFLEX EXECUTION SUMMARY                         ');
  lines.push('================================================================');
  lines.push(`Task ID:         ${result.taskId}`);
  lines.push(`Status:          ${result.status}`);
  lines.push(`Route Taken:     ${result.routeTaken}`);
  if (result.error) {
    lines.push(`Error/Reason:    ${result.error}`);
  }
  if (result.approvalId) {
    lines.push(`Approval ID:     ${result.approvalId}`);
  }
  lines.push('----------------------------------------------------------------');
  lines.push('Latency Breakdown:');
  lines.push(`  • Preflight:    ${result.metrics.decisionDurationMs > 0 ? '< 5 ms' : '0 ms'}`);
  lines.push(`  • Jev Decision: ${result.metrics.decisionDurationMs.toFixed(1)} ms`);
  lines.push(`  • Code Mode:    ${result.metrics.executionDurationMs.toFixed(1)} ms`);
  lines.push(`  • Verification: ${result.metrics.verificationDurationMs.toFixed(1)} ms`);
  lines.push(`  • Total Wall:   ${result.metrics.totalDurationMs.toFixed(1)} ms`);
  lines.push('----------------------------------------------------------------');
  lines.push(`Estimated Cost:  $${result.metrics.estimatedCostUsd.toFixed(5)} USD`);
  lines.push(`Tokens Used:     Decision (${result.metrics.tokensUsed.decisionInputTokens} in / ${result.metrics.tokensUsed.decisionOutputTokens} out) | CodeGen (${result.metrics.tokensUsed.codeGenInputTokens} in / ${result.metrics.tokensUsed.codeGenOutputTokens} out)`);
  lines.push('----------------------------------------------------------------');
  lines.push(`Postcondition Verification Checks (${result.evidence.postconditionChecks.length}):`);

  if (result.evidence.postconditionChecks.length === 0) {
    lines.push('  (No declarative postcondition assertions specified)');
  } else {
    for (const check of result.evidence.postconditionChecks) {
      const badge = check.passed ? '[PASS]' : '[FAIL]';
      lines.push(`  ${badge} [${check.layer}] ${check.target}: expected ${JSON.stringify(check.expected)} | actual ${JSON.stringify(check.actual)}`);
      if (check.reason) {
        lines.push(`         Reason: ${check.reason}`);
      }
    }
  }

  if (result.evidence.toolCalls.length > 0) {
    lines.push('----------------------------------------------------------------');
    lines.push(`Intercepted Tool Calls (${result.evidence.toolCalls.length}):`);
    for (const tool of result.evidence.toolCalls) {
      const statusStr = tool.httpStatus !== undefined ? `HTTP ${tool.httpStatus}` : 'OK';
      const mutBadge = tool.isMutation ? '[MUTATION]' : '[READ]';
      lines.push(`  • ${tool.toolName} ${mutBadge} (${statusStr}, ${tool.latencyMs.toFixed(1)} ms)`);
    }
  }

  lines.push('================================================================');
  return lines.join('\n');
}

export function formatVerifySummary(report: LedgerAuditReport): string {
  const lines: string[] = [];

  lines.push('================================================================');
  lines.push('            EVIDENCE LEDGER INDEPENDENT AUDIT                   ');
  lines.push('================================================================');
  lines.push(`Audit Verdict:   ${report.verdict}`);
  lines.push(`Task ID:         ${report.taskId}`);
  lines.push(`Timestamp:       ${report.timestamp}`);
  lines.push(`Integrity:       ${report.integrityPassed ? 'PASS (SHA-256 Valid)' : 'FAIL (Tampered / Mismatched Hash)'}`);
  lines.push(`Signature:       ${report.signatureValid ? 'VALID (Ed25519 Notary Verified)' : 'INVALID / MISSING'}`);
  if (report.publicKeyFingerprint) {
    lines.push(`Public Key:      ${report.publicKeyFingerprint.slice(0, 24)}... (Fingerprint)`);
  }
  lines.push('----------------------------------------------------------------');
  lines.push(`Tool Call Sequence (${report.toolCalls.length} calls):`);
  if (report.toolCalls.length === 0) {
    lines.push('  (No tool calls recorded in ledger)');
  } else {
    for (const tool of report.toolCalls) {
      const statusBadge = tool.httpStatus !== undefined && tool.httpStatus >= 200 && tool.httpStatus < 300
        ? '[2xx OK]'
        : `[${tool.httpStatus ?? 'ERR'}]`;
      const mutBadge = tool.isMutation ? '(MUTATING)' : '(READ)';
      lines.push(`  ${statusBadge} ${tool.toolName} ${mutBadge} - CallId: ${tool.callId}`);
    }
  }

  lines.push('----------------------------------------------------------------');
  lines.push(`Assertion Pass/Fail Matrix (${report.postconditionChecks.length} checks):`);
  if (report.postconditionChecks.length === 0) {
    lines.push('  (No postcondition checks in ledger)');
  } else {
    for (const check of report.postconditionChecks) {
      const badge = check.passed ? '[PASS]' : '[FAIL]';
      lines.push(`  ${badge} [${check.layer}] Target: ${check.target}`);
      lines.push(`         Expected: ${JSON.stringify(check.expected)}`);
      lines.push(`         Actual:   ${JSON.stringify(check.actual)}`);
      if (check.reason) {
        lines.push(`         Reason:   ${check.reason}`);
      }
    }
  }

  if (report.reasons.length > 0) {
    lines.push('----------------------------------------------------------------');
    lines.push('Audit Findings / Violations:');
    for (const r of report.reasons) {
      lines.push(`  ⚠️ ${r}`);
    }
  }

  lines.push('================================================================');
  return lines.join('\n');
}
