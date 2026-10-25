import { describe, it, expect } from 'vitest';
import {
  EvidenceLedgerBuilder,
  calculateLedgerChecksum,
  verifyLedgerIntegrity,
} from '../src/ledger.js';
import type { ToolInvocationEvidence, PostconditionCheck } from '@reflex-ai/core';

describe('EvidenceLedger Cryptographic Integrity & Tamper Detection', () => {
  it('builds an EvidenceLedger with a valid SHA-256 checksum', () => {
    const builder = new EvidenceLedgerBuilder('task_ledger_1');
    builder.recordPreconditionSnapshot('initial_db_rows', 10);
    builder.addSandboxLogs(['Worker started', 'Querying database']);

    const toolCall: ToolInvocationEvidence = {
      callId: 'call_123',
      toolName: 'database.query',
      inputPayload: { query: 'SELECT COUNT(*) FROM users' },
      outputPayload: { count: 10 },
      isMutation: false,
      httpStatus: 200,
      timestamp: new Date().toISOString(),
      latencyMs: 12,
    };
    builder.addToolCalls([toolCall]);

    const check: PostconditionCheck = {
      layer: 'DETERMINISTIC',
      target: 'row_count',
      expected: 10,
      actual: 10,
      passed: true,
    };
    builder.addPostconditionCheck(check);

    const ledger = builder.build();
    expect(ledger.taskId).toBe('task_ledger_1');
    expect(ledger.checksum).toMatch(/^[a-f0-9]{64}$/); // Valid 64-char SHA-256 hex string
    expect(verifyLedgerIntegrity(ledger)).toBe(true);
  });

  it('detects tampering in toolCalls', () => {
    const builder = new EvidenceLedgerBuilder('task_ledger_tamper');
    builder.addToolCalls([
      {
        callId: 'call_orig',
        toolName: 'deployments.delete',
        inputPayload: { id: 'dep_1' },
        outputPayload: { error: 'Forbidden' },
        isMutation: true,
        httpStatus: 403,
        timestamp: new Date().toISOString(),
        latencyMs: 15,
      },
    ]);

    const ledger = builder.build();
    expect(verifyLedgerIntegrity(ledger)).toBe(true);

    // Adversary attempts to alter tool call status to 200 OK
    const tamperedLedger = {
      ...ledger,
      toolCalls: [
        {
          ...ledger.toolCalls[0]!,
          httpStatus: 200,
          outputPayload: { status: 'deleted' },
        },
      ],
    };

    expect(verifyLedgerIntegrity(tamperedLedger)).toBe(false);
  });

  it('detects tampering in sandboxLogs', () => {
    const builder = new EvidenceLedgerBuilder('task_ledger_logs');
    builder.addSandboxLogs(['Log entry 1', 'Log entry 2']);
    const ledger = builder.build();

    expect(verifyLedgerIntegrity(ledger)).toBe(true);

    // Adversary strips an error log
    const tampered = {
      ...ledger,
      sandboxLogs: ['Log entry 1'],
    };
    expect(verifyLedgerIntegrity(tampered)).toBe(false);
  });

  it('detects tampering in postconditionChecks', () => {
    const builder = new EvidenceLedgerBuilder('task_ledger_checks');
    builder.addPostconditionCheck({
      layer: 'READ_AFTER_WRITE',
      target: 'deployment_status',
      expected: 404,
      actual: 200,
      passed: false,
      reason: 'Resource still exists',
    });
    const ledger = builder.build();

    expect(verifyLedgerIntegrity(ledger)).toBe(true);

    // Adversary flips passed from false to true
    const tampered = {
      ...ledger,
      postconditionChecks: [
        {
          ...ledger.postconditionChecks[0]!,
          passed: true,
        },
      ],
    };
    expect(verifyLedgerIntegrity(tampered)).toBe(false);
  });

  it('detects tampering in preconditionSnapshots', () => {
    const builder = new EvidenceLedgerBuilder('task_ledger_pre');
    builder.recordPreconditionSnapshot('account_balance', 1000);
    const ledger = builder.build();

    expect(verifyLedgerIntegrity(ledger)).toBe(true);

    const tampered = {
      ...ledger,
      preconditionSnapshots: { account_balance: 5000 },
    };
    expect(verifyLedgerIntegrity(tampered)).toBe(false);
  });
});
