import { describe, expect, it } from 'vitest';
import { MutationApprovalGate, type TaskContext } from '@reflex-ai/core';
import { SlackApprovalBridge } from '../src/index.js';

describe('Slack & Webhook Approval Gate Bridge (@reflex-ai/reflex)', () => {
  const secret = 'super-secret-hmac-key-for-slack-webhooks-12345';
  const bridge = new SlackApprovalBridge({ secret, ttlMs: 60_000 });

  const context: TaskContext = {
    taskId: 'task_appr_001',
    task: 'Delete all idle staging containers',
    environment: 'staging',
    callerRole: 'developer',
    availableTools: ['containers.delete'],
  };

  it('creates an HMAC-signed approval token and Slack Block Kit payload', () => {
    const gate = new MutationApprovalGate();
    const req = gate.createRequest(context, 'ASK_USER', true, 'Bulk container deletion');

    const result = bridge.createApprovalPayload(req);
    expect(result.token).toBeDefined();
    expect(result.signature).toBeDefined();
    expect(result.payload.approvalId).toBe(req.approvalId);
    expect(result.payload.taskId).toBe(req.taskId);
    expect(result.slackBlocks?.blocks.length).toBeGreaterThan(2);
  });

  it('verifies valid HMAC callbacks and rejects tampered or expired tokens', () => {
    const gate = new MutationApprovalGate();
    const req = gate.createRequest(context, 'ASK_USER', true, 'Bulk container deletion');
    const { token, signature } = bridge.createApprovalPayload(req);

    // 1. Valid signature
    const validRes = bridge.verifyApprovalCallback(token, signature);
    expect(validRes.valid).toBe(true);
    expect(validRes.payload?.approvalId).toBe(req.approvalId);

    // 2. Tampered signature
    const badSig = bridge.verifyApprovalCallback(token, '0000000000000000000000000000000000000000000000000000000000000000');
    expect(badSig.valid).toBe(false);
    expect(badSig.error).toContain('Invalid HMAC');

    // 3. Expired token
    const expiredResult = bridge.createApprovalPayload(req, secret, -5000);
    const expiredRes = bridge.verifyApprovalCallback(expiredResult.token, expiredResult.signature);
    expect(expiredRes.valid).toBe(false);
    expect(expiredRes.error).toContain('expired');
  });

  it('dispatches approved callback into MutationApprovalGate', () => {
    const gate = new MutationApprovalGate();
    const req = gate.createRequest(context, 'ASK_USER', true, 'Bulk container deletion');
    const { token, signature } = bridge.createApprovalPayload(req);

    expect(gate.isApproved(req.approvalId)).toBe(false);

    const approvedReq = bridge.dispatchApprovalCallback(
      {
        token,
        signature,
        action: 'approve',
        reviewer: 'security_lead_alice',
      },
      gate
    );

    expect(approvedReq.status).toBe('APPROVED');
    expect(approvedReq.reviewer).toBe('security_lead_alice');
    expect(gate.isApproved(req.approvalId)).toBe(true);
  });

  it('dispatches rejected callback into MutationApprovalGate', () => {
    const gate = new MutationApprovalGate();
    const req = gate.createRequest(context, 'ASK_USER', true, 'Bulk container deletion');
    const { token, signature } = bridge.createApprovalPayload(req);

    const rejectedReq = bridge.dispatchApprovalCallback(
      {
        token,
        signature,
        action: 'reject',
        reviewer: 'security_lead_bob',
      },
      gate
    );

    expect(rejectedReq.status).toBe('REJECTED');
    expect(rejectedReq.reviewer).toBe('security_lead_bob');
    expect(gate.isApproved(req.approvalId)).toBe(false);
  });
});
