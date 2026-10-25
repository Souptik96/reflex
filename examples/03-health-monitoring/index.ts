import {
  createAgent,
  FastPathCompiler,
  DecisionCache,
  type TaskContext,
} from '../../packages/reflex/dist/index.js';

async function main() {
  console.log('--- Running Reflex Recipe 3: High-Frequency Health Monitoring & Auto-Remediation ---');

  // 1. Configure FastPathCompiler with deterministic compiled patterns
  const compiler = new FastPathCompiler();
  compiler.registerRule({
    id: 'fast-routine-health-check',
    pattern: /^health:check:routine$/i,
    handler: async () => {
      return {
        status: 'UP',
        cluster: 'us-east-prod',
        errorRate: 0.0005,
        p99LatencyMs: 8.5,
        resolvedBy: 'FAST_PATH_COMPILER',
      };
    },
  });

  const cache = new DecisionCache({ maxEntries: 500, ttlMs: 60_000 });

  const agent = createAgent({
    fastPathCompiler: compiler,
    decisionCache: cache,
  });

  agent.registerToolHandler('cluster.scale_up', true, async (params) => {
    return {
      httpStatus: 200,
      data: { addedReplicas: params['count'], currentCapacity: 15 },
    };
  });

  // Scenario A: Routine Health Ping (Fast-Path hit)
  const normalContext: TaskContext = {
    taskId: 'task-health-normal-01',
    task: 'health:check:routine',
    environment: 'production',
    callerRole: 'sre',
    availableTools: ['cluster.scale_up'],
  };

  const t0 = performance.now();
  const normalResult = await agent.run(normalContext);
  const normalDuration = performance.now() - t0;

  console.log('\n[SCENARIO A: Normal Health Check]');
  console.log('Route Taken:      ', normalResult.routeTaken);
  console.log('Status:           ', normalResult.status);
  console.log('Execution Time:   ', normalDuration.toFixed(2), 'ms (Sub-5ms)');
  console.log('Cost:             ', '$' + normalResult.metrics.estimatedCostUsd.toFixed(4));
  console.log('Output:           ', JSON.stringify(normalResult.output));

  // Scenario B: Incident Auto-Remediation (Escalates to Code Mode)
  const incidentContext: TaskContext = {
    taskId: 'task-health-anomaly-02',
    task: 'Anomalous 502 spike detected: scale up worker instances and verify',
    environment: 'production',
    callerRole: 'sre',
    availableTools: ['cluster.scale_up'],
  };

  console.log('\n[SCENARIO B: Anomaly Detection & Sandbox Remediation]');
  const incidentResult = await agent.run(incidentContext, {
    script: `
      console.log("Anomaly confirmed: requesting 5 additional worker replicas");
      const scale = await tools.invoke("cluster.scale_up", { count: 5 });
      return { remediated: true, scaleResult: scale.data };
    `,
  });

  console.log('Route Taken:      ', incidentResult.routeTaken);
  console.log('Status:           ', incidentResult.status);
  console.log('Output:           ', JSON.stringify(incidentResult.output));
  console.log('Tool Calls Made:  ', incidentResult.evidence.toolCalls.length);
  console.log('Evidence Checksum:', incidentResult.evidence.checksum);
}

main().catch(console.error);
