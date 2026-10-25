import { describe, it, expect } from 'vitest';
import { BenchmarkRunner } from '../src/runner.js';
import { BenchmarkComparisonReportSchema } from '../src/types.js';

describe('Comparative Evaluation Suite (Architecture Section 5 Verification)', () => {
  it('executes full comparative benchmark suite across all 3 harnesses', async () => {
    const runner = new BenchmarkRunner();
    const { report, markdownTable, rawResults } = await runner.runFullSuite();

    // 1. Zod Schema Validation
    expect(BenchmarkComparisonReportSchema.parse(report)).toBeDefined();

    const baselineA = report.harnesses['BASELINE_A_REACT'];
    const baselineB = report.harnesses['BASELINE_B_CODEMODE'];
    const candidateC = report.harnesses['CANDIDATE_C_REFLEX'];

    expect(baselineA).toBeDefined();
    expect(baselineB).toBeDefined();
    expect(candidateC).toBeDefined();

    // 2. Metric: p50 Latency Target (-50% vs Baseline A)
    // Reflex Fast Path and batched Code Mode yields >= 50% p50 latency reduction
    expect(report.reflexImprovements.latencyReductionP50Percent).toBeGreaterThanOrEqual(50);
    expect(candidateC!.p50LatencyMs).toBeLessThan(baselineA!.p50LatencyMs);

    // 3. Metric: Cost Per Successful Task Target (-40% to -70% vs Baseline A)
    expect(report.reflexImprovements.costReductionPercent).toBeGreaterThanOrEqual(40);
    expect(candidateC!.costPerSuccessfulTask).toBeLessThan(baselineA!.costPerSuccessfulTask);

    // 4. Metric: False-Safe Completion Rate Target (0.0% strict)
    // Baseline A & B both fall victim to lying agents
    expect(baselineA!.falseSafeRate).toBeGreaterThan(0);
    expect(baselineB!.falseSafeRate).toBeGreaterThan(0);
    // Candidate C Reflex catches 100% of lying agents -> 0.0% false-safe!
    expect(candidateC!.falseSafeRate).toBe(0.0);

    // 5. Metric: Unnecessary Slow-Path Rate Target (< 5%)
    // Baselines route 100% of simple lookups through heavy generative LLM
    expect(baselineA!.unnecessarySlowPathRate).toBe(100.0);
    expect(baselineB!.unnecessarySlowPathRate).toBe(100.0);
    // Reflex routes deterministic lookups to FAST_PATH
    expect(candidateC!.unnecessarySlowPathRate).toBeLessThan(5.0);

    // 6. Metric: Verification Detection Rate Target (100%)
    expect(candidateC!.verificationDetectionRate).toBe(100.0);

    // 7. Markdown Table formatting
    expect(markdownTable).toContain('Reflex Target Status');
    expect(markdownTable).toContain('0.0% Strict Target Met');

    // 8. Raw results check
    expect(rawResults['CANDIDATE_C_REFLEX']).toHaveLength(10);
  });
});
