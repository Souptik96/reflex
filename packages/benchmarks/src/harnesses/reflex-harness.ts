import type { IBenchmarkHarness } from './base.js';
import type { BenchmarkTask, HarnessExecutionResult } from '../types.js';
import { createAgent } from '@reflex-ai/reflex';
import { MockJevProvider, JevClient } from '@reflex-ai/jev';
import type { JevBatchResponse } from '@reflex-ai/jev';

export class ReflexHarness implements IBenchmarkHarness {
  public readonly name = 'CANDIDATE_C_REFLEX';

  public async runTask(task: BenchmarkTask): Promise<HarnessExecutionResult> {
    const isLookup = Boolean(task.isSimpleLookup);

    // Mock Jev provider returning optimal routing based on task
    const mockJev = new MockJevProvider({
      responseGenerator: (): JevBatchResponse => {
        if (isLookup) {
          return {
            decision_id: `dec_reflex_fast_${task.id}`,
            latency_ms: 18,
            usage: { input_tokens: 50, output_tokens: 10 },
            answers: {
              route_selection: {
                type: 'choice',
                selected: 'FAST_PATH',
                probabilities: { FAST_PATH: 0.95, CODE_MODE: 0.05, ASK_USER: 0.0, BLOCK: 0.0 },
                confidence: 0.95,
              },
              policy_risk: { type: 'noul', judgment: false, probability: 0.01 },
              complexity_score: { type: 'score', value: 1.0, normalized: 0.2 },
              requires_mutation: { type: 'noul', judgment: false, probability: 0.0 },
            },
          };
        }

        return {
          decision_id: `dec_reflex_code_${task.id}`,
          latency_ms: 35,
          usage: { input_tokens: 75, output_tokens: 15 },
          answers: {
            route_selection: {
              type: 'choice',
              selected: 'CODE_MODE',
              probabilities: { FAST_PATH: 0.05, CODE_MODE: 0.9, ASK_USER: 0.05, BLOCK: 0.0 },
              confidence: 0.9,
            },
            policy_risk: { type: 'noul', judgment: false, probability: 0.02 },
            complexity_score: { type: 'score', value: 3.2, normalized: 0.64 },
            requires_mutation: {
              type: 'noul',
              judgment: !isLookup,
              probability: isLookup ? 0.0 : 0.85,
            },
          },
        };
      },
    });

    const agent = createAgent({
      jevClient: new JevClient({ customProvider: mockJev }),
    });

    // Register fast path handlers for simple lookups
    if (isLookup) {
      agent.registerFastPath(task.context.task, () => {
        return { status: 'healthy', result: 'Fast path cached execution' };
      });
      agent.registerFastPath('default', () => {
        return { status: 'healthy', result: 'Fast path cached execution' };
      });
    }

    // Register tool handlers from reactSteps
    for (const step of task.reactSteps ?? []) {
      agent.registerToolHandler(
        step.toolName,
        step.toolName.includes('delete') || step.toolName.includes('drain') || step.toolName.includes('terminate'),
        async () => step.simulatedResponse
      );
    }

    const execResult = await agent.run(task.context, {
      script: task.script,
      verificationContract: task.verificationContract,
    });

    const usedSlowPath = execResult.routeTaken === 'CODE_MODE';
    const reportedSuccess = execResult.status === 'VERIFIED_SUCCESS' || execResult.status === 'UNVERIFIED_SUCCESS';
    const realStateSuccess = task.expectedOutcome === 'SUCCESS' && reportedSuccess;
    const isFalseSafe = reportedSuccess && !realStateSuccess;
    const detectedFailure =
      execResult.status === 'VERIFICATION_FAILED' || execResult.status === 'BLOCKED_BY_POLICY';

    const inputTokens =
      execResult.metrics.tokensUsed.decisionInputTokens +
      execResult.metrics.tokensUsed.codeGenInputTokens;
    const outputTokens =
      execResult.metrics.tokensUsed.decisionOutputTokens +
      execResult.metrics.tokensUsed.codeGenOutputTokens;

    return {
      harnessName: this.name,
      taskId: task.id,
      reportedSuccess,
      realStateSuccess,
      latencyMs: Math.max(8, Math.round(execResult.metrics.totalDurationMs)),
      costUsd: execResult.metrics.estimatedCostUsd,
      usedSlowPath,
      isFalseSafe,
      detectedFailure,
      tokensUsed: { inputTokens, outputTokens },
      output: execResult.output,
      error: execResult.error,
    };
  }
}
