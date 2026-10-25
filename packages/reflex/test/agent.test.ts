import { describe, it, expect } from 'vitest';
import type { TaskContext } from '@reflex-ai/core';
import { createAgent } from '../src/agent.js';
import { MockJevProvider, JevClient } from '@reflex-ai/jev';

describe('ReflexAgent End-to-End Pipeline (All 5 Route Executions)', () => {
  it('Route 1: FAST_PATH executes registered pure function and returns VERIFIED_SUCCESS', async () => {
    const mockJev = new MockJevProvider({
      responseGenerator: () => ({
        decision_id: 'dec_fast_1',
        latency_ms: 15,
        usage: { input_tokens: 30, output_tokens: 8 },
        answers: {
          route_selection: {
            type: 'choice',
            selected: 'FAST_PATH',
            probabilities: { FAST_PATH: 0.96, CODE_MODE: 0.04, ASK_USER: 0.0, BLOCK: 0.0 },
            confidence: 0.96,
          },
          policy_risk: { type: 'noul', judgment: false, probability: 0.01 },
          complexity_score: { type: 'score', value: 1.0, normalized: 0.2 },
          requires_mutation: { type: 'noul', judgment: false, probability: 0.0 },
        },
      }),
    });

    const agent = createAgent({
      jevClient: new JevClient({ customProvider: mockJev }),
    });

    agent.registerFastPath('fast:health_check', (ctx) => ({
      status: 'healthy',
      env: ctx.environment,
    }));

    const result = await agent.run({
      taskId: 'task_fast_e2e',
      task: 'fast:health_check',
      environment: 'staging',
      callerRole: 'developer',
      availableTools: [],
    });

    expect(result.routeTaken).toBe('FAST_PATH');
    expect(result.status).toBe('VERIFIED_SUCCESS');
    expect(result.output).toEqual({ status: 'healthy', env: 'staging' });
    expect(result.evidence.checksum).toBeDefined();
    expect(result.metrics.totalDurationMs).toBeGreaterThan(0);
  });

  it('Route 2: CODE_MODE executes script in Cloudflare sandbox with HostToolProxy tool call', async () => {
    const mockJev = new MockJevProvider({
      responseGenerator: () => ({
        decision_id: 'dec_code_1',
        latency_ms: 35,
        usage: { input_tokens: 70, output_tokens: 12 },
        answers: {
          route_selection: {
            type: 'choice',
            selected: 'CODE_MODE',
            probabilities: { FAST_PATH: 0.05, CODE_MODE: 0.92, ASK_USER: 0.03, BLOCK: 0.0 },
            confidence: 0.92,
          },
          policy_risk: { type: 'noul', judgment: false, probability: 0.02 },
          complexity_score: { type: 'score', value: 3.2, normalized: 0.64 },
          requires_mutation: { type: 'noul', judgment: false, probability: 0.05 },
        },
      }),
    });

    const agent = createAgent({
      jevClient: new JevClient({ customProvider: mockJev }),
    });

    // Register a tool on the host proxy
    agent.registerToolHandler('deployments.list', false, async (params) => {
      return {
        httpStatus: 200,
        data: [
          { id: 'dep_1', env: params['env'], traffic: 100 },
          { id: 'dep_2', env: params['env'], traffic: 0 },
        ],
      };
    });

    const result = await agent.run(
      {
        taskId: 'task_code_e2e',
        task: 'List deployments and filter inactive ones',
        environment: 'staging',
        callerRole: 'developer',
        availableTools: ['deployments.list'],
      },
      {
        // Script executing in isolated sandbox using mcp RPC proxy
        script: `
          const deps = await mcp.deployments.list({ env: "staging" });
          const inactive = deps.filter(d => d.traffic === 0);
          console.log("Found " + inactive.length + " inactive deployments");
          return { total: deps.length, inactiveCount: inactive.length };
        `,
      }
    );

    expect(result.routeTaken).toBe('CODE_MODE');
    expect(result.status).toBe('VERIFIED_SUCCESS');
    expect(result.output).toEqual({ total: 2, inactiveCount: 1 });
    expect(result.evidence.toolCalls).toHaveLength(1);
    expect(result.evidence.toolCalls[0]?.toolName).toBe('deployments.list');
    expect(result.evidence.sandboxLogs).toContain('Found 1 inactive deployments');
  });

  it('Route 3: ASK_USER returns NEEDS_HUMAN_REVIEW for production mutation', async () => {
    const mockJev = new MockJevProvider({
      responseGenerator: () => ({
        decision_id: 'dec_ask_1',
        latency_ms: 25,
        usage: { input_tokens: 50, output_tokens: 10 },
        answers: {
          route_selection: {
            type: 'choice',
            selected: 'CODE_MODE',
            probabilities: { FAST_PATH: 0.0, CODE_MODE: 0.85, ASK_USER: 0.15, BLOCK: 0.0 },
            confidence: 0.85,
          },
          policy_risk: { type: 'noul', judgment: false, probability: 0.1 },
          complexity_score: { type: 'score', value: 4.0, normalized: 0.8 },
          requires_mutation: { type: 'noul', judgment: true, probability: 0.95 },
        },
      }),
    });

    const agent = createAgent({
      jevClient: new JevClient({ customProvider: mockJev }),
      policyConfig: {
        requireApprovalForMutations: true,
      },
    });

    const result = await agent.run({
      taskId: 'task_ask_e2e',
      task: 'Delete production deployment dep_999',
      environment: 'production',
      callerRole: 'admin',
      availableTools: ['deployments.delete'],
    });

    expect(result.routeTaken).toBe('ASK_USER');
    expect(result.status).toBe('NEEDS_HUMAN_REVIEW');
    expect(result.error).toContain('requires human confirmation');
  });

  it('Route 4: BLOCK returns BLOCKED_BY_POLICY on safety regex violation', async () => {
    const agent = createAgent();

    const result = await agent.run({
      taskId: 'task_block_e2e',
      task: 'Run rm -rf /var/log to clear disk space',
      environment: 'staging',
      callerRole: 'developer',
      availableTools: [],
    });

    expect(result.routeTaken).toBe('BLOCK');
    expect(result.status).toBe('BLOCKED_BY_POLICY');
    expect(result.error).toContain('prohibited safety pattern');
  });

  it('Route 5: FALLBACK returns SYSTEM_FALLBACK on provider timeout/network failure', async () => {
    const failingMock = new MockJevProvider({
      shouldThrow: true,
      errorMessage: '503 Service Unavailable',
    });

    const agent = createAgent({
      jevClient: new JevClient({ customProvider: failingMock }),
    });

    const result = await agent.run({
      taskId: 'task_fallback_e2e',
      task: 'Query node health status',
      environment: 'staging',
      callerRole: 'developer',
      availableTools: ['nodes.query'],
    });

    expect(result.routeTaken).toBe('FALLBACK');
    expect(result.status).toBe('SYSTEM_FALLBACK');
  });
});
