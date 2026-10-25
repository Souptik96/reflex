import type { IBenchmarkHarness } from './base.js';
import type { BenchmarkTask, HarnessExecutionResult } from '../types.js';

export class ReActHarness implements IBenchmarkHarness {
  public readonly name = 'BASELINE_A_REACT';

  public async runTask(task: BenchmarkTask): Promise<HarnessExecutionResult> {
    const steps = task.reactSteps ?? [];
    const numRoundtrips = Math.max(1, steps.length + 1);

    // ReAct sequential model latency: ~300ms per roundtrip + tool execution
    const modelLatencyPerStepMs = 320;
    const toolLatencyMs = 25;
    const totalLatencyMs = numRoundtrips * modelLatencyPerStepMs + steps.length * toolLatencyMs;

    // ReAct token accumulation: each turn carries the entire prior conversation history
    let inputTokens = 0;
    let outputTokens = 0;
    const basePromptTokens = 850;

    for (let i = 0; i < numRoundtrips; i++) {
      inputTokens += basePromptTokens + i * 250;
      outputTokens += 110;
    }

    // Cost calculation (Standard frontier LLM pricing: $3.00/1M in, $15.00/1M out)
    const costUsd = Math.round(((inputTokens * 3.0 + outputTokens * 15.0) / 1_000_000) * 100_000) / 100_000;

    // Safety checks: ReAct models lack deterministic preflight, so they may prompt or attempt tools
    if (task.category === 'UNAUTHORIZED_MUTATION') {
      return {
        harnessName: this.name,
        taskId: task.id,
        reportedSuccess: false,
        realStateSuccess: false,
        latencyMs: totalLatencyMs,
        costUsd,
        usedSlowPath: true, // Used slow LLM instead of deterministic block
        isFalseSafe: false,
        detectedFailure: false, // Model refused or failed without deterministic boundary
        tokensUsed: { inputTokens, outputTokens },
        error: 'Refused or blocked by model completion prompt',
      };
    }

    // Adversarial tasks: ReAct trusts self-reported claims
    if (task.isAdversarial) {
      // The model reports success in its final response regardless of real state
      return {
        harnessName: this.name,
        taskId: task.id,
        reportedSuccess: true, // Lying agent claims success!
        realStateSuccess: false, // State was NOT mutated correctly
        latencyMs: totalLatencyMs,
        costUsd,
        usedSlowPath: true,
        isFalseSafe: true, // Crucial metric: ReAct accepted a false claim!
        detectedFailure: false, // ReAct failed to verify
        tokensUsed: { inputTokens, outputTokens },
        output: { message: 'ReAct agent claimed task was successfully performed.' },
      };
    }

    // Standard successful task
    return {
      harnessName: this.name,
      taskId: task.id,
      reportedSuccess: true,
      realStateSuccess: true,
      latencyMs: totalLatencyMs,
      costUsd,
      usedSlowPath: true, // Always uses heavy LLM slow path
      isFalseSafe: false,
      detectedFailure: false,
      tokensUsed: { inputTokens, outputTokens },
      output: { completed: true, stepsExecuted: steps.length },
    };
  }
}
