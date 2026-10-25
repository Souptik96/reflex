import { describe, it, expect, beforeEach } from 'vitest';
import {
  ReflexAgent,
  TenantPolicyManager,
  type TenantConfig,
  type TaskContext,
} from '../src/index.js';
import { MockJevProvider, JevClient } from '@reflex-ai/jev';

function createMockJev(options: {
  route: 'FAST_PATH' | 'CODE_MODE' | 'ASK_USER' | 'BLOCK';
  confidence?: number;
  requiresMutation?: boolean;
}) {
  return new MockJevProvider({
    responseGenerator: () => ({
      decision_id: `dec_${Math.random()}`,
      latency_ms: 20,
      usage: { input_tokens: 50, output_tokens: 10 },
      answers: {
        route_selection: {
          type: 'choice',
          selected: options.route,
          probabilities: {
            FAST_PATH: options.route === 'FAST_PATH' ? 0.95 : 0.05,
            CODE_MODE: options.route === 'CODE_MODE' ? 0.95 : 0.05,
            ASK_USER: options.route === 'ASK_USER' ? 0.95 : 0.05,
            BLOCK: options.route === 'BLOCK' ? 0.95 : 0.05,
          },
          confidence: options.confidence ?? 0.95,
        },
        policy_risk: { type: 'noul', judgment: false, probability: 0.01 },
        complexity_score: { type: 'score', value: 2.0, normalized: 0.4 },
        requires_mutation: {
          type: 'noul',
          judgment: options.requiresMutation ?? false,
          probability: options.requiresMutation ? 0.95 : 0.05,
        },
      },
    }),
  });
}

describe('Phase 8: Multi-Tenant Runner Integration (@reflex-ai/reflex)', () => {
  let tenantManager: TenantPolicyManager;

  const tenantAcme: TenantConfig = {
    tenantId: 'tenant-acme',
    tier: 'enterprise',
    quotas: {
      maxTasksPerMinute: 60,
      maxConcurrentExecutions: 10,
      maxMonthlyBudgetUsd: 1000,
    },
    allowedEnvironments: ['development', 'staging'],
    freezeWindows: [
      {
        id: 'fw-black-friday',
        name: 'Black Friday Deploy Freeze',
        startDate: '2026-11-25T00:00:00.000Z',
        endDate: '2026-11-30T23:59:59.000Z',
        active: true,
      },
    ],
    toolPermissions: {
      developer: {
        allow: ['staging.db_migrate', 'staging.verify_table', 'metrics.read'],
        deny: ['production.purge_all'],
      },
      viewer: {
        allow: ['metrics.read'],
        deny: ['*'],
      },
    },
    maxBlastRadius: 2, // At most 2 mutating calls per task
  };

  beforeEach(() => {
    tenantManager = new TenantPolicyManager([tenantAcme]);
  });

  it('blocks task targeting an unauthorized environment at preflight boundary', async () => {
    const mockJev = createMockJev({ route: 'FAST_PATH' });
    const agent = new ReflexAgent({
      tenantPolicyManager: tenantManager,
      jevClient: new JevClient({ customProvider: mockJev }),
    });

    const context: TaskContext = {
      taskId: 'task-e2e-env-block',
      task: 'Deploy schema change to production',
      environment: 'production', // Acme is only allowed in development & staging
      callerRole: 'admin',
      availableTools: ['staging.db_migrate'],
      tenantId: 'tenant-acme',
    };

    const result = await agent.run(context);

    expect(result.status).toBe('BLOCKED_BY_POLICY');
    expect(result.routeTaken).toBe('BLOCK');
    expect(result.error).toContain('is not whitelisted for tenant');
  });

  it('blocks mutating tool execution during an active freeze window', async () => {
    const tenantWithActiveFreeze: TenantConfig = {
      ...tenantAcme,
      tenantId: 'tenant-frozen',
      freezeWindows: [
        {
          id: 'fw-emergency',
          name: 'Emergency Production Incident Freeze',
          startDate: '2020-01-01T00:00:00.000Z',
          endDate: '2030-01-01T00:00:00.000Z',
          active: true,
        },
      ],
    };
    tenantManager.registerTenant(tenantWithActiveFreeze);

    const mockJev = createMockJev({ route: 'CODE_MODE', requiresMutation: true });
    const agent = new ReflexAgent({
      tenantPolicyManager: tenantManager,
      jevClient: new JevClient({ customProvider: mockJev }),
    });

    agent.registerTool({
      name: 'staging.db_migrate',
      isMutation: true,
      handler: async () => ({ success: true, data: { status: 'migrated' } }),
    });

    const context: TaskContext = {
      taskId: 'task-e2e-freeze-block',
      task: 'Migrate users table in staging',
      environment: 'staging',
      callerRole: 'developer',
      availableTools: ['staging.db_migrate'],
      tenantId: 'tenant-frozen',
    };

    const result = await agent.run(context, {
      script: `
        const res = await tools.invoke("staging.db_migrate", { table: "users" });
        return { migrated: res.success };
      `,
    });

    // The tool proxy blocked the mutation due to the freeze window
    const toolEvidence = result.evidence.toolCalls.find((c) => c.toolName === 'staging.db_migrate');
    expect(toolEvidence).toBeDefined();
    expect(toolEvidence?.httpStatus).toBe(403);
    expect(toolEvidence?.outputPayload['error']).toContain('Emergency Production Incident Freeze');
  });

  it('enforces tenant maxBlastRadius limit on mutating tool invocations', async () => {
    const mockJev = createMockJev({ route: 'CODE_MODE', requiresMutation: true });
    const agent = new ReflexAgent({
      tenantPolicyManager: tenantManager,
      jevClient: new JevClient({ customProvider: mockJev }),
    });

    agent.registerTool({
      name: 'staging.db_migrate',
      isMutation: true,
      handler: async (params) => ({ success: true, data: { step: params['step'] } }),
    });

    const context: TaskContext = {
      taskId: 'task-e2e-blast-radius',
      task: 'Run three-step staging migration',
      environment: 'staging',
      callerRole: 'developer',
      availableTools: ['staging.db_migrate'],
      tenantId: 'tenant-acme',
    };

    const result = await agent.run(context, {
      script: `
        const r1 = await tools.invoke("staging.db_migrate", { step: 1 });
        const r2 = await tools.invoke("staging.db_migrate", { step: 2 });
        const r3 = await tools.invoke("staging.db_migrate", { step: 3 });
        return { step1: r1.success, step2: r2.success, step3: r3.success };
      `,
    });

    const calls = result.evidence.toolCalls.filter((c) => c.toolName === 'staging.db_migrate');
    expect(calls.length).toBe(3);
    // Call 1 & 2 succeed
    expect(calls[0]?.httpStatus).toBe(200);
    expect(calls[1]?.httpStatus).toBe(200);
    // Call 3 is blocked with 429 Blast Radius Exceeded
    expect(calls[2]?.httpStatus).toBe(429);
    expect(calls[2]?.outputPayload['error']).toContain('Blast radius limit exceeded');
  });

  it('blocks tool calls prohibited by tenant role tool permissions', async () => {
    const mockJev = createMockJev({ route: 'CODE_MODE', requiresMutation: false });
    const agent = new ReflexAgent({
      tenantPolicyManager: tenantManager,
      jevClient: new JevClient({ customProvider: mockJev }),
    });

    agent.registerTool({
      name: 'production.purge_all',
      isMutation: false,
      handler: async () => ({ success: true, data: { purged: true } }),
    });

    const context: TaskContext = {
      taskId: 'task-e2e-tool-deny',
      task: 'Purge all resources',
      environment: 'staging',
      callerRole: 'developer', // developer has production.purge_all in deny list
      availableTools: ['production.purge_all'],
      tenantId: 'tenant-acme',
    };

    const result = await agent.run(context, {
      script: `
        const r = await tools.invoke("production.purge_all", {});
        return { success: r.success };
      `,
    });

    const call = result.evidence.toolCalls.find((c) => c.toolName === 'production.purge_all');
    expect(call).toBeDefined();
    expect(call?.httpStatus).toBe(403);
    expect(call?.outputPayload['error']).toContain("is prohibited for role 'developer'");
  });

  it('prevents viewer and auditor roles from approving mutations, permitting authorized lead', async () => {
    const mockJev = createMockJev({ route: 'ASK_USER', requiresMutation: true });
    const agent = new ReflexAgent({
      tenantPolicyManager: tenantManager,
      jevClient: new JevClient({ customProvider: mockJev }),
      policyConfig: {
        requireApprovalForMutations: true,
      },
    });

    agent.registerFastPath('fast-remediate', async () => ({ fixed: true }));

    const context: TaskContext = {
      taskId: 'task-e2e-approval-rbac',
      task: 'fast-remediate',
      environment: 'staging',
      callerRole: 'developer',
      availableTools: ['staging.db_migrate'],
      tenantId: 'tenant-acme',
    };

    // Initial run triggers human review gate
    const initResult = await agent.run(context);
    expect(initResult.status).toBe('NEEDS_HUMAN_REVIEW');
    const approvalId = initResult.approvalId;
    expect(approvalId).toBeDefined();

    // Viewer role attempts to approve -> denied
    expect(() => {
      agent.approve(approvalId!, 'operator_viewer', 'viewer');
    }).toThrow(/is not authorized to approve mutations/);

    // Auditor role attempts to approve -> denied
    expect(() => {
      agent.approve(approvalId!, 'operator_auditor', 'auditor');
    }).toThrow(/is not authorized to approve mutations/);

    // Authorized Lead approves and execution resumes successfully
    const resumed = await agent.approveAndResume(approvalId!, {}, 'lead_operator', 'lead');
    expect(resumed.status).toBe('VERIFIED_SUCCESS');
  });
});
