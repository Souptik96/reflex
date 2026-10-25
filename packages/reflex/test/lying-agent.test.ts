import { describe, it, expect } from 'vitest';
import type { TaskContext } from '@reflex-ai/core';
import { createAgent } from '../src/agent.js';
import { MockJevProvider, JevClient } from '@reflex-ai/jev';
import type { VerificationContract } from '@reflex-ai/verify';

describe('Adversarial "Lying Agent" Detection Suite (End-to-End Reflex Runtime)', () => {
  const codeModeJev = new MockJevProvider({
    responseGenerator: () => ({
      decision_id: 'dec_code_lying',
      latency_ms: 20,
      usage: { input_tokens: 60, output_tokens: 10 },
      answers: {
        route_selection: {
          type: 'choice',
          selected: 'CODE_MODE',
          probabilities: { FAST_PATH: 0.05, CODE_MODE: 0.95, ASK_USER: 0.0, BLOCK: 0.0 },
          confidence: 0.95,
        },
        policy_risk: { type: 'noul', judgment: false, probability: 0.02 },
        complexity_score: { type: 'score', value: 3.0, normalized: 0.6 },
        requires_mutation: { type: 'noul', judgment: true, probability: 0.9 },
      },
    }),
  });

  it('Case A (End-to-End Silent Error Masking): Catches sandbox script swallowing tool error', async () => {
    const agent = createAgent({
      jevClient: new JevClient({ customProvider: codeModeJev }),
    });

    // Register tool that rejects with 403 Forbidden
    agent.registerToolHandler('deployments.delete', true, async () => {
      return {
        httpStatus: 403,
        data: { error: 'Forbidden: Production deployment cannot be deleted' },
      };
    });

    // Adversarial sandbox script swallows the exception and reports complete success
    const maliciousScript = `
      try {
        await mcp.deployments.delete({ id: "dep_forbidden" });
      } catch (err) {
        // Silently swallowed!
      }
      return { success: true, message: "Successfully deleted dep_forbidden!" };
    `;

    const result = await agent.run(
      {
        taskId: 'task_e2e_lying_1',
        task: 'Delete forbidden deployment',
        environment: 'staging',
        callerRole: 'developer',
        availableTools: ['deployments.delete'],
      },
      {
        script: maliciousScript,
      }
    );

    // Reflex verifier intercepts the 403 and refuses to grant success!
    expect(result.status).toBe('VERIFICATION_FAILED');
    expect(result.routeTaken).toBe('CODE_MODE');
    expect(result.error).toContain("Tool 'deployments.delete' returned HTTP 403");
  });

  it('Case B (End-to-End Phantom Execution): Catches agent that never called the mutation tool', async () => {
    const agent = createAgent({
      jevClient: new JevClient({ customProvider: codeModeJev }),
    });

    let toolWasCalled = false;
    agent.registerToolHandler('deployments.delete', true, async () => {
      toolWasCalled = true;
      return { httpStatus: 200, data: { ok: true } };
    });

    // Adversarial script doesn't call any tools, just returns fake success
    const phantomScript = `
      return { success: true, deletedDeploymentId: "dep_never_deleted" };
    `;

    const contract: VerificationContract = {
      requiredToolCalls: [{ toolName: 'deployments.delete', minCalls: 1 }],
    };

    const result = await agent.run(
      {
        taskId: 'task_e2e_phantom',
        task: 'Delete deployment dep_never_deleted',
        environment: 'staging',
        callerRole: 'developer',
        availableTools: ['deployments.delete'],
      },
      {
        script: phantomScript,
        verificationContract: contract,
      }
    );

    expect(toolWasCalled).toBe(false);
    expect(result.status).toBe('VERIFICATION_FAILED');
    expect(result.error).toContain("Required tool 'deployments.delete'");
  });

  it('Case C (End-to-End Read-After-Write Discrepancy): Catches tool 200 OK when state is unchanged', async () => {
    const agent = createAgent({
      jevClient: new JevClient({ customProvider: codeModeJev }),
    });

    // Tool returns 200 OK (lying tool or buggy API)
    agent.registerToolHandler('deployments.delete', true, async () => {
      return { httpStatus: 200, data: { status: 'acknowledged' } };
    });

    // Authoritative API mock returns state: 'active'
    const authoritativeApi = {
      get: async (_id: string) => ({ status: 'active', traffic: 100 }),
    };

    const script = `
      await mcp.deployments.delete({ id: "dep_zombie" });
      return { status: "deleted", id: "dep_zombie" };
    `;

    const contract: VerificationContract = {
      readAfterWrite: [
        {
          targetResource: 'deployments.dep_zombie',
          query: async () => authoritativeApi.get('dep_zombie'),
          assert: (state: unknown) => (state as { status: string }).status === 'deleted',
          failureMessage: 'Read-after-write assertion failed: deployment dep_zombie is still active.',
        },
      ],
    };

    const result = await agent.run(
      {
        taskId: 'task_e2e_raw_fail',
        task: 'Delete zombie deployment',
        environment: 'staging',
        callerRole: 'developer',
        availableTools: ['deployments.delete'],
      },
      {
        script,
        verificationContract: contract,
      }
    );

    expect(result.status).toBe('VERIFICATION_FAILED');
    expect(result.error).toContain('Read-after-write assertion failed: deployment dep_zombie is still active.');
  });

  it('Idempotency & Replay Protection: Prevents duplicate execution of mutating tools', async () => {
    const agent = createAgent({
      jevClient: new JevClient({ customProvider: codeModeJev }),
    });

    let invocationCount = 0;
    agent.registerToolHandler('payments.charge', true, async (params) => {
      invocationCount++;
      return {
        httpStatus: 200,
        data: { chargeId: 'ch_123', amount: params['amount'] },
      };
    });

    // Script attempts to charge twice using the same idempotency key
    const script = `
      const res1 = await mcp.payments.charge({ amount: 50, idempotencyKey: "idem_key_abc" });
      const res2 = await mcp.payments.charge({ amount: 50, idempotencyKey: "idem_key_abc" });
      return { res1, res2 };
    `;

    const result = await agent.run(
      {
        taskId: 'task_idempotency_test',
        task: 'Charge credit card once with idempotency key',
        environment: 'staging',
        callerRole: 'developer',
        availableTools: ['payments.charge'],
      },
      {
        script,
      }
    );

    expect(result.status).toBe('UNVERIFIED_SUCCESS');
    // The actual underlying tool handler was only called ONCE!
    expect(invocationCount).toBe(1);
    const output = result.output as { res1: { chargeId: string }; res2: { chargeId: string } };
    expect(output.res1.chargeId).toBe('ch_123');
    expect(output.res2.chargeId).toBe('ch_123');
  });

  it('Mutation Approval Gate & Resume Lifecycle: Requires human review, then approves and resumes', async () => {
    const mutateJev = new MockJevProvider({
      responseGenerator: () => ({
        decision_id: 'dec_appr',
        latency_ms: 20,
        usage: { input_tokens: 50, output_tokens: 10 },
        answers: {
          route_selection: {
            type: 'choice',
            selected: 'CODE_MODE',
            probabilities: { FAST_PATH: 0.0, CODE_MODE: 0.9, ASK_USER: 0.1, BLOCK: 0.0 },
            confidence: 0.9,
          },
          policy_risk: { type: 'noul', judgment: false, probability: 0.05 },
          complexity_score: { type: 'score', value: 3.5, normalized: 0.7 },
          requires_mutation: { type: 'noul', judgment: true, probability: 0.95 },
        },
      }),
    });

    const agent = createAgent({
      jevClient: new JevClient({ customProvider: mutateJev }),
      policyConfig: {
        requireApprovalForMutations: true,
      },
    });

    agent.registerToolHandler('cluster.drain', true, async () => {
      return { httpStatus: 200, data: { drained: true } };
    });

    const context: TaskContext = {
      taskId: 'task_approval_lifecycle',
      task: 'Drain cluster nodes',
      environment: 'production',
      callerRole: 'admin',
      availableTools: ['cluster.drain'],
    };

    // 1. Initial execution escalates to NEEDS_HUMAN_REVIEW and produces approvalId
    const pendingResult = await agent.run(context);
    expect(pendingResult.status).toBe('NEEDS_HUMAN_REVIEW');
    expect(pendingResult.routeTaken).toBe('ASK_USER');
    expect(pendingResult.approvalId).toBeDefined();

    const approvalId = pendingResult.approvalId!;

    // Verify gate has pending request
    const gate = agent.getApprovalGate();
    expect(gate.isApproved(approvalId)).toBe(false);

    // 2. Human reviews and approves the request, resuming execution
    const completedResult = await agent.approveAndResume(
      approvalId,
      {
        script: `
          await mcp.cluster.drain({ node: "all" });
          return { status: "drained_complete" };
        `,
      },
      'lead_sre'
    );

    expect(gate.isApproved(approvalId)).toBe(true);
    expect(completedResult.status).toBe('UNVERIFIED_SUCCESS');
    expect(completedResult.routeTaken).toBe('CODE_MODE');
    expect(completedResult.output).toEqual({ status: 'drained_complete' });
  });
});
