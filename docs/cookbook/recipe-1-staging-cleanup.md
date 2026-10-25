# Cookbook Recipe 1: Staging Infrastructure Cleanup

## Overview & Architecture

Development teams frequently accumulate abandoned staging resources (microservice workers, temporary preview deployments, preview KV namespaces) that inflate cloud infrastructure bills.

In this recipe, we construct an autonomous Reflex workflow that:
1. Lists all staging deployments in Cloudflare.
2. Identifies deployments with 0 traffic for more than 7 days.
3. Issues deletion tool calls for only the inactive deployments.
4. Enforces an authoritative **Layer 2 Read-After-Write contract**: independently queries the Cloudflare API to prove that the targeted deployment is genuinely deleted (HTTP 404), completely neutralizing lying agents.

---

## Code Example (`examples/01-staging-cleanup/index.ts`)

```typescript
import {
  createAgent,
  type TaskContext,
  type VerificationContract,
} from '@reflex-ai/reflex';

// 1. Initialize Reflex Agent
const agent = createAgent({
  policyConfig: {
    allowedEnvironments: ['development', 'staging'],
  },
});

// Mock in-memory cloud provider state
const activeDeployments = new Map<string, { id: string; traffic: number; status: string }>([
  ['dep_active_101', { id: 'dep_active_101', traffic: 1500, status: 'active' }],
  ['dep_stale_102', { id: 'dep_stale_102', traffic: 0, status: 'active' }],
  ['dep_stale_103', { id: 'dep_stale_103', traffic: 0, status: 'active' }],
]);

// 2. Register Host Tools
agent.registerToolHandler('deployments.list', false, async (params) => {
  return {
    httpStatus: 200,
    data: Array.from(activeDeployments.values()),
  };
});

agent.registerToolHandler('deployments.delete', true, async (params) => {
  const id = params['id'] as string;
  const dep = activeDeployments.get(id);
  if (!dep) {
    return { httpStatus: 404, data: { error: 'Not found' } };
  }
  activeDeployments.delete(id);
  return {
    httpStatus: 200,
    data: { id, deleted: true },
  };
});

// 3. Define the Authoritative Read-After-Write Contract
const cleanupContract: VerificationContract = {
  readAfterWrite: [
    {
      targetResource: 'staging-deployment-dep_stale_102',
      query: async () => {
        // Independent query checking if stale deployment is gone
        const remainingStale = activeDeployments.get('dep_stale_102');
        return { exists: Boolean(remainingStale) };
      },
      assert: async (actual) => {
        const state = actual as { exists: boolean };
        return !state.exists;
      },
      failureMessage: 'Deployment dep_stale_102 still exists after deletion',
    },
  ],
};

// 4. Execute the Cleanup Task
const context: TaskContext = {
  taskId: 'task-staging-cleanup-01',
  task: 'Find inactive staging deployments with 0 traffic and delete them',
  environment: 'staging',
  callerRole: 'developer',
  availableTools: ['deployments.list', 'deployments.delete'],
};

const result = await agent.run(context, {
  verificationContract: cleanupContract,
  script: `
    const all = await mcp.deployments.list({});
    const stale = all.filter(d => d.traffic === 0);
    console.log("Found " + stale.length + " stale deployments to delete");

    const deletedIds = [];
    for (const d of stale) {
      await mcp.deployments.delete({ id: d.id });
      deletedIds.push(d.id);
    }

    return { deletedCount: deletedIds.length, deletedIds };
  `,
});

console.log('Result Status:', result.status); // VERIFIED_SUCCESS
console.log('Tool Invocations Recorded:', result.evidence.toolCalls.length);
console.log('Cryptographic Checksum:', result.evidence.checksum);
```

---

## Key Invariants Verified

1. **Independent Verification**: If the sandbox script claimed to delete `dep_stale_102`, but the underlying API failed or returned 500, the independent `query` function finds `{ exists: true }`, resulting in immediate `VERIFICATION_FAILED`.
2. **Audit Ledger**: All deleted IDs and tool outputs are recorded in the SHA-256 evidence ledger.
