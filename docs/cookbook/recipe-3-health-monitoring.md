# Cookbook Recipe 3: High-Frequency Health Monitoring & Auto-Remediation

## Overview & Architecture

High-frequency monitoring and auto-remediation agents run hundreds or thousands of times every hour. If every periodic health check dispatches to an LLM, latency spikes and token costs explode.

In this recipe, we demonstrate the **Fast-Path Engine & Adaptive Code Mode Escalation**:
1. **Normal Operating State**: Fast-Path declarative pattern matching evaluates the health check deterministically in sub-5ms at **$0.00 cost** (bypassing both Jev and generative LLM entirely).
2. **Anomalous Traffic State**: When an anomaly is detected (e.g. error rate > 5%), the task matches an escalation rule that transitions into **Code Mode**.
3. **Automated Sandbox Remediation**: In Code Mode, an isolated Worker program orchestrates remediation tools (e.g. rate-limiting bad IP subnets, triggering pod scale-up) with full cryptographic evidence logging.

---

## Code Example (`examples/03-health-monitoring/index.ts`)

```typescript
import {
  createAgent,
  FastPathCompiler,
  DecisionCache,
  type TaskContext,
} from '@reflex-ai/reflex';

// 1. Configure the FastPathCompiler with compiled regex rules
const compiler = new FastPathCompiler();

// Fast-Path Rule 1: Routine Health Ping (Sub-5ms, $0.00 Cost)
compiler.registerRule({
  id: 'fast-routine-health-check',
  pattern: /^health:check:routine$/i,
  handler: async (context) => {
    return {
      status: 'UP',
      cluster: 'us-east-prod',
      errorRate: 0.001,
      p99LatencyMs: 12,
      resolvedBy: 'FAST_PATH_COMPILER',
    };
  },
});

const cache = new DecisionCache({ maxEntries: 500, ttlMs: 60_000 });

// 2. Initialize Reflex Agent
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

// Scenario A: Normal Operating Request (Fast-Path Hit)
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

console.log('--- Scenario A: Routine Check ---');
console.log('Route Taken:', normalResult.routeTaken); // FAST_PATH
console.log('Resolution Latency:', normalDuration.toFixed(2), 'ms (< 5ms)');
console.log('Estimated Cost:', '$' + normalResult.metrics.estimatedCostUsd); // $0.00

// Scenario B: Anomalous Incident Escalation (Transition to Code Mode)
const incidentContext: TaskContext = {
  taskId: 'task-health-anomaly-02',
  task: 'Anomalous 502 spike detected: scale up worker instances and verify',
  environment: 'production',
  callerRole: 'sre',
  availableTools: ['cluster.scale_up'],
};

console.log('\n--- Scenario B: Incident Auto-Remediation ---');
const incidentResult = await agent.run(incidentContext, {
  script: `
    console.log("Analyzing traffic spike... requesting 5 additional worker replicas");
    const scale = await tools.invoke("cluster.scale_up", { count: 5 });
    return { remediated: true, scaleResult: scale.data };
  `,
});

console.log('Route Taken:', incidentResult.routeTaken); // CODE_MODE
console.log('Status:', incidentResult.status); // VERIFIED_SUCCESS
console.log('Output:', JSON.stringify(incidentResult.output));
console.log('Evidence Ledger SHA-256:', incidentResult.evidence.checksum);
```

---

## Architectural Benchmarks

| Execution Mode | Latency (ms) | LLM Cost (USD) | Reliability |
| :--- | :--- | :--- | :--- |
| **Fast-Path Pattern Match** | **< 3ms** | **$0.0000** | 100% Deterministic |
| **LRU Decision Cache Hit** | **< 2ms** | **$0.0000** | 100% Deterministic |
| **Code Mode Remediation** | ~150ms | ~$0.004 | Outcome-Verified Sandbox |
| *Conventional ReAct Baseline* | *~4,200ms* | *~$0.042* | Vulnerable to Hallucination |
