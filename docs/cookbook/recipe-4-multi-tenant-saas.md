# Cookbook Recipe 4: Multi-Tenant Enterprise SaaS Isolation

## Overview & Architecture

Multi-tenant SaaS architectures require rigorous tenant isolation guarantees:
1. **Namespace Isolation**: A customer in Tenant Alpha must never execute tasks or mutate resources belonging to Tenant Beta.
2. **Per-Tenant Freeze Windows**: Change freezes declared by Tenant Alpha (e.g. peak promotional sale freeze) must not interrupt Tenant Beta's deployment cycles.
3. **Role & Tool Customization**: Custom enterprise roles (e.g. `billing_auditor`, `compliance_operator`) with specific permission masks and tool denylists.
4. **Distributed Idempotency**: Atomic CAS deduplication ensuring concurrent client requests with the same idempotency key execute exactly once.

---

## Code Example (`examples/04-multi-tenant-saas/index.ts`)

```typescript
import {
  ReflexAgent,
  TenantPolicyManager,
  DistributedIdempotencyManager,
  type TenantConfig,
  type TaskContext,
} from '@reflex-ai/reflex';

// 1. Configure Multi-Tenant Policies
const tenantManager = new TenantPolicyManager([
  // Tenant 1: High-security fintech customer
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
        startDate: '2026-10-24T00:00:00.000Z',
        endDate: '2026-10-26T23:59:59.000Z',
        active: true,
      },
    ],
    toolPermissions: {
      auditor: { allow: ['ledger.query'], deny: ['*'] },
    },
    maxBlastRadius: 1, // Strict single mutation limit
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

// 2. Configure Distributed Idempotency Manager
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

// Scenario A: Tenant Apex Bank during active freeze window (Blocked)
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

console.log('Tenant Apex Bank (During Freeze):');
console.log('Status: ', apexResult.evidence.toolCalls[0]?.httpStatus); // 403 Forbidden
console.log('Reason: ', apexResult.evidence.toolCalls[0]?.outputPayload['error']);

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

console.log('\nTenant Retail Corp (No Freeze):');
console.log('Status: ', retailResult.status); // VERIFIED_SUCCESS
console.log('Refund: ', JSON.stringify(retailResult.output));
```

---

## Architectural Guarantees

1. **Deterministic Isolation**: Freeze windows and blast radius counters in `tenant-apex-bank` have zero effect on `tenant-retail-corp`.
2. **Idempotent Mutations**: Multiple concurrent requests with matching `idempotencyKey` guarantee that payment refunds or external mutations execute exactly once.
3. **Auditable Evidence**: Each tenant's evidence ledgers can be stored in distinct partitions or database schemas via `ILedgerStore`.
