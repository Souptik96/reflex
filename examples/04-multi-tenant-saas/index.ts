import {
  ReflexAgent,
  TenantPolicyManager,
  DistributedIdempotencyManager,
  type TaskContext,
} from '../../packages/reflex/dist/index.js';

async function main() {
  console.log('--- Running Reflex Recipe 4: Multi-Tenant Enterprise SaaS Isolation ---');

  // 1. Configure Multi-Tenant Policies
  const tenantManager = new TenantPolicyManager([
    // Tenant 1: High-security fintech customer with active freeze window
    {
      tenantId: 'tenant-apex-bank',
      tier: 'enterprise',
      quotas: {
        maxTasksPerMinute: 30,
        maxConcurrentExecutions: 5,
        maxMonthlyBudgetUsd: 10_000,
      },
      allowedEnvironments: ['staging', 'production'],
      freezeWindows: [
        {
          id: 'fw-quarterly-close',
          name: 'Quarterly Financial Close Freeze',
          startDate: '2020-01-01T00:00:00.000Z',
          endDate: '2030-01-01T00:00:00.000Z',
          active: true,
        },
      ],
      toolPermissions: {
        auditor: { allow: ['ledger.query'], deny: ['*'] },
      },
      maxBlastRadius: 1,
      customRoles: {
        compliance_auditor: ['read_only', 'audit_export'],
      },
    },
    // Tenant 2: E-commerce retailer (no active freeze)
    {
      tenantId: 'tenant-retail-corp',
      tier: 'starter',
      quotas: {
        maxTasksPerMinute: 120,
        maxConcurrentExecutions: 20,
        maxMonthlyBudgetUsd: 2000,
      },
      allowedEnvironments: ['development', 'staging', 'production'],
      freezeWindows: [],
      toolPermissions: {},
      maxBlastRadius: 10,
    },
  ]);

  const idempotency = new DistributedIdempotencyManager({ defaultTtlMs: 300_000 });

  const agent = new ReflexAgent({
    tenantPolicyManager: tenantManager,
  });

  agent.registerToolHandler('payments.process_refund', true, async (params) => {
    return {
      httpStatus: 200,
      data: { refundId: 'ref_98124', amount: params['amount'], status: 'completed' },
    };
  });

  // Scenario A: Tenant Apex Bank during active freeze window (Mutation Blocked)
  const apexTask: TaskContext = {
    taskId: 'task-apex-refund-01',
    task: 'Process customer refund',
    environment: 'production',
    callerRole: 'admin',
    availableTools: ['payments.process_refund'],
    tenantId: 'tenant-apex-bank',
  };

  const apexResult = await agent.run(apexTask, {
    script: `
      const res = await tools.invoke("payments.process_refund", { amount: 150 });
      return res.data;
    `,
  });

  console.log('\n[SCENARIO A: Tenant Apex Bank (During Freeze Window)]');
  const apexToolCall = apexResult.evidence.toolCalls[0];
  console.log('Tool HTTP Status: ', apexToolCall?.httpStatus); // 403
  console.log('Interception Error:', apexToolCall?.outputPayload['error']);

  // Scenario B: Tenant Retail Corp executes cleanly without interference
  const retailTask: TaskContext = {
    taskId: 'task-retail-refund-02',
    task: 'Process customer refund',
    environment: 'production',
    callerRole: 'admin',
    availableTools: ['payments.process_refund'],
    tenantId: 'tenant-retail-corp',
  };

  const retailResult = await agent.run(retailTask, {
    script: `
      const res = await tools.invoke("payments.process_refund", { amount: 50 });
      return res;
    `,
  });

  console.log('\n[SCENARIO B: Tenant Retail Corp (No Freeze)]');
  console.log('Execution Status: ', retailResult.status); // VERIFIED_SUCCESS
  console.log('Refund Result:    ', JSON.stringify(retailResult.output));
  console.log('Evidence Checksum:', retailResult.evidence.checksum);
}

main().catch(console.error);
