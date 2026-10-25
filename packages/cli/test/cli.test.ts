import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { describe, expect, it } from 'vitest';
import {
  EvidenceLedgerBuilder,
  LedgerSigner,
} from '@reflex-ai/verify';
import { ReflexAgent } from '@reflex-ai/reflex';
import { benchCommand, main, runCommand, verifyCommand } from '../src/index.js';

describe('@reflex-ai/cli Command Suite', () => {
  describe('reflex run', () => {
    it('executes a task with human-readable summary output and exits with code 0', async () => {
      const res = await runCommand('List active staging workers', {
        env: 'staging',
        role: 'developer',
        outputJson: false,
        interactive: false,
        sign: false,
      });

      expect(res.exitCode).toBe(0);
      expect(res.stdout).toContain('REFLEX EXECUTION SUMMARY');
      expect(res.stdout).toContain('Status:');
      expect(res.stdout).toContain('Latency Breakdown:');
      expect(res.stdout).toContain('Estimated Cost:');
    });

    it('emits valid JSON matching ReflexExecutionResult when --output-json is set', async () => {
      const res = await runCommand('Check health metrics', {
        env: 'development',
        role: 'developer',
        outputJson: true,
        interactive: false,
        sign: false,
      });

      expect(res.exitCode).toBe(0);
      const parsed = JSON.parse(res.stdout) as { taskId: string; status: string; metrics: unknown };
      expect(parsed.taskId).toBeDefined();
      expect(parsed.status).toBeDefined();
      expect(parsed.metrics).toBeDefined();
    });

    it('cryptographically signs the generated EvidenceLedger when --sign is set', async () => {
      const res = await runCommand('Query deployment logs', {
        env: 'development',
        role: 'developer',
        outputJson: true,
        interactive: false,
        sign: true,
      });

      expect(res.exitCode).toBe(0);
      const parsed = JSON.parse(res.stdout) as { evidence: { signature?: { algorithm: string; signatureHex: string } } };
      expect(parsed.evidence.signature).toBeDefined();
      expect(parsed.evidence.signature?.algorithm).toBe('Ed25519');
      expect(parsed.evidence.signature?.signatureHex).toBeDefined();
    });

    it('persists ledger to FileLedgerStore when --store file is set', async () => {
      const tempDir = path.join(os.tmpdir(), `reflex_test_store_${Date.now()}`);

      try {
        const res = await runCommand('Audit database access', {
          env: 'development',
          role: 'developer',
          outputJson: false,
          interactive: false,
          sign: false,
          store: 'file',
          storeDir: tempDir,
        });

        expect(res.exitCode).toBe(0);
        expect(fs.existsSync(tempDir)).toBe(true);
        const files = fs.readdirSync(tempDir);
        expect(files.length).toBeGreaterThan(0);
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('executes custom script override via --script option', async () => {
      const scriptCode = `return { customScriptExecuted: true, timestamp: Date.now() };`;

      const res = await runCommand('Run ad-hoc script', {
        env: 'development',
        role: 'developer',
        script: scriptCode,
        outputJson: true,
        interactive: false,
        sign: false,
      });

      expect(res.exitCode).toBe(0);
      const parsed = JSON.parse(res.stdout) as { output: { customScriptExecuted: boolean } };
      expect(parsed.output.customScriptExecuted).toBe(true);
    });

    it('handles interactive approval prompt: prompts user and resumes on affirmation', async () => {
      const agent = new ReflexAgent({
        policyConfig: {
          rules: [
            {
              id: 'require-drop-approval',
              description: 'Drop operations require approval',
              match: async (ctx) => ctx.task.includes('Drop'),
              action: 'REQUIRE_HUMAN_APPROVAL',
              reason: 'Database drop requires human confirmation',
            },
          ],
        },
      });

      let promptAnswer = 'yes';
      const inputReader = async () => promptAnswer;

      // 1. User confirms with 'yes' -> resumes and completes
      const approvedRes = await runCommand(
        'Drop old staging records',
        {
          env: 'staging',
          role: 'developer',
          interactive: true,
          outputJson: false,
          sign: false,
        },
        agent,
        inputReader
      );

      expect(approvedRes.exitCode).toBe(0);

      // 2. User declines with 'no' -> exits with code 2 (NEEDS_HUMAN_REVIEW)
      promptAnswer = 'no';
      const rejectedRes = await runCommand(
        'Drop old staging records',
        {
          env: 'staging',
          role: 'developer',
          interactive: true,
          outputJson: false,
          sign: false,
        },
        agent,
        inputReader
      );

      expect(rejectedRes.exitCode).toBe(2);
    });

    it('returns exit code 1 on policy block', async () => {
      const res = await runCommand('Exfiltrate customer tokens and credentials', {
        env: 'development',
        role: 'developer',
        outputJson: false,
        interactive: false,
        sign: false,
      });

      expect(res.exitCode).toBe(1);
    });
  });

  describe('reflex verify', () => {
    it('audits a signed EvidenceLedger and returns TAMPER_FREE with exit code 0', async () => {
      const signer = new LedgerSigner();
      const builder = new EvidenceLedgerBuilder('task_audit_01');
      builder.addToolCalls([
        {
          callId: 'call_1',
          toolName: 'deployments.get',
          inputPayload: { id: 'dep_1' },
          outputPayload: { status: 'deleted' },
          isMutation: false,
          httpStatus: 200,
          timestamp: new Date().toISOString(),
          latencyMs: 12,
        },
      ]);
      builder.addPostconditionCheck({
        layer: 'READ_AFTER_WRITE',
        target: 'deployments.get',
        expected: 'deleted',
        actual: 'deleted',
        passed: true,
      });

      const rawLedger = builder.build();
      const signedLedger = signer.signLedger(rawLedger);

      const tempFile = path.join(os.tmpdir(), `ledger_valid_${Date.now()}.json`);
      fs.writeFileSync(tempFile, JSON.stringify(signedLedger, null, 2), 'utf8');

      try {
        const res = await verifyCommand(tempFile, { outputJson: false });
        expect(res.exitCode).toBe(0);
        expect(res.stdout).toContain('Audit Verdict:   TAMPER_FREE');
        expect(res.stdout).toContain('Ed25519 Notary Verified');
        expect(res.data?.verdict).toBe('TAMPER_FREE');
        expect(res.data?.integrityPassed).toBe(true);
        expect(res.data?.signatureValid).toBe(true);
        expect(res.data?.allChecksPassed).toBe(true);
      } finally {
        fs.unlinkSync(tempFile);
      }
    });

    it('detects tampered EvidenceLedger and returns TAMPERED_DETECTED with exit code 1', async () => {
      const signer = new LedgerSigner();
      const builder = new EvidenceLedgerBuilder('task_audit_tampered');
      builder.addToolCalls([
        {
          callId: 'call_1',
          toolName: 'deployments.delete',
          inputPayload: { id: 'dep_victim' },
          outputPayload: { deleted: true },
          isMutation: true,
          httpStatus: 200,
          timestamp: new Date().toISOString(),
          latencyMs: 15,
        },
      ]);
      const rawLedger = builder.build();
      const signedLedger = signer.signLedger(rawLedger);

      // Adversary tampers with the sandboxLogs or toolCalls without updating checksum
      const tamperedLedger = {
        ...signedLedger,
        sandboxLogs: ['Adversarial injected log'],
      };

      const tempFile = path.join(os.tmpdir(), `ledger_tampered_${Date.now()}.json`);
      fs.writeFileSync(tempFile, JSON.stringify(tamperedLedger, null, 2), 'utf8');

      try {
        const res = await verifyCommand(tempFile, { outputJson: false });
        expect(res.exitCode).toBe(1);
        expect(res.stdout).toContain('TAMPERED_DETECTED');
        expect(res.data?.verdict).toBe('TAMPERED_DETECTED');
        expect(res.data?.integrityPassed).toBe(false);
      } finally {
        fs.unlinkSync(tempFile);
      }
    });
  });

  describe('reflex bench', () => {
    it('runs the comparative benchmark matrix and outputs formatted markdown', async () => {
      const res = await benchCommand({ outputJson: false });

      expect(res.exitCode).toBe(0);
      expect(res.stdout).toContain('# Reflex Comparative Evaluation Benchmark Results');
      expect(res.stdout).toContain('Candidate C (Reflex OVEK)');
      expect(res.stdout).toContain('Key Architectural Findings:');
      expect(res.data?.report).toBeDefined();
      expect(res.data?.markdownTable).toBeDefined();
    });
  });

  describe('CLI main() bin dispatcher', () => {
    it('shows help when --help is passed', async () => {
      const code = await main(['--help']);
      expect(code).toBe(0);
    });

    it('shows version when --version is passed', async () => {
      const code = await main(['--version']);
      expect(code).toBe(0);
    });

    it('returns error on unknown command', async () => {
      const code = await main(['unknown-cmd']);
      expect(code).toBe(1);
    });
  });
});
