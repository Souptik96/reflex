import {
  createAgent,
  type TaskContext,
  type VerificationContract,
} from '../../packages/reflex/dist/index.js';

async function main() {
  console.log('--- Running Reflex Recipe 1: Staging Infrastructure Cleanup ---');

  // Simulated cloud infrastructure state
  const activeDeployments = new Map<string, { id: string; traffic: number; status: string }>([
    ['dep_active_101', { id: 'dep_active_101', traffic: 1500, status: 'active' }],
    ['dep_stale_102', { id: 'dep_stale_102', traffic: 0, status: 'active' }],
    ['dep_stale_103', { id: 'dep_stale_103', traffic: 0, status: 'active' }],
  ]);

  const agent = createAgent({
    policyConfig: {
      allowedEnvironments: ['development', 'staging'],
    },
  });

  // Register tools on host proxy
  agent.registerToolHandler('deployments.list', false, async () => {
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

  // Authoritative Read-After-Write verification contract
  const cleanupContract: VerificationContract = {
    readAfterWrite: [
      {
        targetResource: 'staging-deployment-dep_stale_102',
        query: async () => {
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
      const all = await tools.invoke("deployments.list", {});
      const stale = all.filter(d => d.traffic === 0);
      console.log("Found " + stale.length + " stale deployments to delete");

      const deletedIds = [];
      for (const d of stale) {
        await tools.invoke("deployments.delete", { id: d.id });
        deletedIds.push(d.id);
      }

      return { deletedCount: deletedIds.length, deletedIds };
    `,
  });

  console.log('Result Status:', result.status);
  console.log('Error:', result.error);
  console.log('Sandbox Logs:', result.evidence.sandboxLogs);
  console.log('Route Taken:', result.routeTaken);
  console.log('Output:', JSON.stringify(result.output));
  console.log('Tool Calls Recorded:', result.evidence.toolCalls.length);
  console.log('Ledger SHA-256 Checksum:', result.evidence.checksum);
}

main().catch(console.error);
