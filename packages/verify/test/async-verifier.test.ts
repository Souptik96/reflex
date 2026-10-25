import { describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import type { ToolInvocationEvidence } from '@reflex-ai/core';
import {
  AsyncReadAfterWriteVerifier,
  VerificationEngine,
} from '../src/index.js';

describe('Phase 5: Asynchronous & Eventual-Consistency Read-After-Write Verifier', () => {
  const dummyEvidence: ToolInvocationEvidence[] = [
    {
      callId: 'call_provision_1',
      toolName: 'cloudflare.provisionWorker',
      inputPayload: { workerName: 'auth-service', memoryMb: 128 },
      outputPayload: { deploymentId: 'dep_xyz789', status: 'PROVISIONING' },
      isMutation: true,
      httpStatus: 202,
      timestamp: '2026-10-25T10:00:00.000Z',
      latencyMs: 120,
    },
  ];

  describe('AsyncReadAfterWriteVerifier Core Engine', () => {
    it('settles successfully when state transitions on the 3rd polling attempt', async () => {
      let pollCount = 0;
      const states = ['PROVISIONING', 'INITIALIZING', 'ACTIVE'];

      const verifier = new AsyncReadAfterWriteVerifier({
        // Instant simulated sleep for fast tests
        sleepFn: async () => {},
      });

      const result = await verifier.verify(
        {
          targetResource: 'cloudflare.deployments.dep_xyz789',
          query: async (_evidence, _attempt) => {
            const currentState = states[pollCount] ?? 'ACTIVE';
            pollCount++;
            return { deploymentId: 'dep_xyz789', status: currentState };
          },
          assert: (readState) => {
            return (readState as { status?: string }).status === 'ACTIVE';
          },
          failureMessage: 'Worker deployment failed to reach ACTIVE state',
          pollingStrategy: {
            maxAttempts: 5,
            intervalMs: 10,
            backoffMultiplier: 1.0,
            timeoutMs: 1000,
          },
        },
        dummyEvidence
      );

      expect(result.passed).toBe(true);
      expect(result.settledVia).toBe('ASSERTION');
      expect(result.attempts.length).toBe(3);
      expect(result.attempts[0]?.passed).toBe(false);
      expect((result.attempts[0]?.state as { status: string }).status).toBe('PROVISIONING');
      expect(result.attempts[1]?.passed).toBe(false);
      expect((result.attempts[1]?.state as { status: string }).status).toBe('INITIALIZING');
      expect(result.attempts[2]?.passed).toBe(true);
      expect((result.attempts[2]?.state as { status: string }).status).toBe('ACTIVE');
    });

    it('fails gracefully with VERIFICATION_FAILED details when max attempts or timeout expires', async () => {
      const verifier = new AsyncReadAfterWriteVerifier({
        sleepFn: async () => {},
      });

      const result = await verifier.verify(
        {
          targetResource: 'aws.rds.instance_prod',
          query: async () => {
            // Resource is stuck in creation error
            return { status: 'FAILED_INSUFFICIENT_CAPACITY' };
          },
          assert: (readState) => {
            return (readState as { status?: string }).status === 'AVAILABLE';
          },
          failureMessage: 'RDS database never reached AVAILABLE state',
          pollingStrategy: {
            maxAttempts: 4,
            intervalMs: 5,
            timeoutMs: 500,
          },
        },
        dummyEvidence
      );

      expect(result.passed).toBe(false);
      expect(result.settledVia).toBe('TIMEOUT');
      expect(result.attempts.length).toBe(4);
      expect(result.failureReason).toContain('RDS database never reached AVAILABLE state');
      expect(result.failureReason).toContain('Assertion failed after 4 polling attempts');
    });

    it('settles immediately upon receiving valid HMAC-SHA256 signed webhook event', async () => {
      const secret = 'prod_webhook_hmac_secret_99';
      const verifier = new AsyncReadAfterWriteVerifier({
        sleepFn: async () => {},
      });

      const webhookBody = JSON.stringify({
        eventType: 'provisioning.completed',
        deploymentId: 'dep_xyz789',
        status: 'READY',
      });

      const hmacSignature = crypto
        .createHmac('sha256', secret)
        .update(webhookBody)
        .digest('hex');

      // 1. Ingest valid webhook
      const accepted = verifier.receiveWebhook(
        webhookBody,
        `sha256=${hmacSignature}`,
        secret
      );
      expect(accepted).toBe(true);

      // 2. Verify contract with webhook gate enabled
      const result = await verifier.verify(
        {
          targetResource: 'cloudflare.deployments.dep_xyz789',
          query: async () => ({ status: 'UNKNOWN' }),
          assert: () => false, // fallback assertion would fail
          failureMessage: 'Never settled',
          webhookGate: {
            enabled: true,
            secretKey: secret,
            expectedEventType: 'provisioning.completed',
          },
        },
        dummyEvidence
      );

      expect(result.passed).toBe(true);
      expect(result.settledVia).toBe('WEBHOOK');
      expect((result.finalState as { status: string }).status).toBe('READY');
    });

    it('rejects webhooks with invalid HMAC signatures', () => {
      const secret = 'valid_secret';
      const verifier = new AsyncReadAfterWriteVerifier();

      const webhookBody = JSON.stringify({ eventType: 'forged.event' });
      const badSignature = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

      const accepted = verifier.receiveWebhook(webhookBody, badSignature, secret);
      expect(accepted).toBe(false);
    });
  });

  describe('Integration with VerificationEngine', () => {
    it('promotes execution to VERIFIED_SUCCESS when asyncReadAfterWrite passes', async () => {
      let attempts = 0;
      const asyncVerifier = new AsyncReadAfterWriteVerifier({
        sleepFn: async () => {},
      });
      const engine = new VerificationEngine({ asyncVerifier });

      const res = await engine.verify(
        {
          taskId: 'task_eventual_1',
          task: 'Provision KV namespace',
          environment: 'production',
          callerRole: 'admin',
          availableTools: ['cloudflare.provisionKV'],
        },
        { status: 'success' },
        dummyEvidence,
        {
          asyncReadAfterWrite: [
            {
              targetResource: 'kv.namespace.prod',
              query: async () => {
                attempts++;
                return { ready: attempts >= 2 };
              },
              assert: (state) => (state as { ready: boolean }).ready,
              failureMessage: 'KV namespace not ready',
              pollingStrategy: { maxAttempts: 3 },
            },
          ],
        }
      );

      expect(res.status).toBe('VERIFIED_SUCCESS');
      expect(res.passed).toBe(true);
      expect(res.checks.some((c) => c.layer === 'READ_AFTER_WRITE' && c.passed)).toBe(true);
    });

    it('returns VERIFICATION_FAILED when asyncReadAfterWrite times out', async () => {
      const asyncVerifier = new AsyncReadAfterWriteVerifier({
        sleepFn: async () => {},
      });
      const engine = new VerificationEngine({ asyncVerifier });

      const res = await engine.verify(
        {
          taskId: 'task_eventual_fail',
          task: 'Provision service',
          environment: 'production',
          callerRole: 'admin',
          availableTools: ['cloudflare.provisionKV'],
        },
        { status: 'success' },
        dummyEvidence,
        {
          asyncReadAfterWrite: [
            {
              targetResource: 'kv.namespace.prod',
              query: async () => ({ ready: false }),
              assert: () => false,
              failureMessage: 'Provisioning timed out after 3 attempts',
              pollingStrategy: { maxAttempts: 3 },
            },
          ],
        }
      );

      expect(res.status).toBe('VERIFICATION_FAILED');
      expect(res.passed).toBe(false);
      expect(res.reason).toContain('Provisioning timed out after 3 attempts');
    });
  });
});
