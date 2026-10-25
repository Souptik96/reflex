import { describe, it, expect } from 'vitest';
import {
  calculatePercentile,
  computeHarnessMetrics,
  formatComparisonMarkdownTable,
  generateComparisonReport,
} from '../src/metrics.js';
import type { BenchmarkTask, HarnessExecutionResult } from '../src/types.js';

describe('Benchmark Metrics & Statistical Engine', () => {
  it('calculates p50, p90, and p95 percentiles correctly', () => {
    const values = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    expect(calculatePercentile(values, 50)).toBe(50);
    expect(calculatePercentile(values, 90)).toBe(90);
    expect(calculatePercentile(values, 95)).toBe(100);
    expect(calculatePercentile([], 50)).toBe(0);
  });

  it('computes metrics with zero divide-by-zero errors', () => {
    const emptyMetrics = computeHarnessMetrics('TEST', [], []);
    expect(emptyMetrics.totalTasks).toBe(0);
    expect(emptyMetrics.costPerSuccessfulTask).toBe(0);
  });

  it('formats markdown table containing all core metrics', () => {
    const mockReport = generateComparisonReport({
      BASELINE_A_REACT: {
        harnessName: 'BASELINE_A_REACT',
        totalTasks: 10,
        completedTasks: 5,
        taskCompletionRate: 50.0,
        p50LatencyMs: 650,
        p90LatencyMs: 1200,
        p95LatencyMs: 1400,
        meanLatencyMs: 720,
        totalCostUsd: 0.05,
        costPerSuccessfulTask: 0.01,
        unnecessarySlowPathRate: 100.0,
        falseSafeRate: 30.0,
        verificationDetectionRate: 0.0,
      },
      BASELINE_B_CODEMODE: {
        harnessName: 'BASELINE_B_CODEMODE',
        totalTasks: 10,
        completedTasks: 5,
        taskCompletionRate: 50.0,
        p50LatencyMs: 380,
        p90LatencyMs: 450,
        p95LatencyMs: 500,
        meanLatencyMs: 390,
        totalCostUsd: 0.03,
        costPerSuccessfulTask: 0.006,
        unnecessarySlowPathRate: 100.0,
        falseSafeRate: 30.0,
        verificationDetectionRate: 0.0,
      },
      CANDIDATE_C_REFLEX: {
        harnessName: 'CANDIDATE_C_REFLEX',
        totalTasks: 10,
        completedTasks: 5,
        taskCompletionRate: 50.0,
        p50LatencyMs: 25,
        p90LatencyMs: 180,
        p95LatencyMs: 200,
        meanLatencyMs: 75,
        totalCostUsd: 0.008,
        costPerSuccessfulTask: 0.0016,
        unnecessarySlowPathRate: 0.0,
        falseSafeRate: 0.0,
        verificationDetectionRate: 100.0,
      },
    });

    const markdown = formatComparisonMarkdownTable(mockReport);
    expect(markdown).toContain('Reflex Benchmark & Comparative Evaluation');
    expect(markdown).toContain('Task Completion Rate');
    expect(markdown).toContain('Cost Per Successful Task');
    expect(markdown).toContain('0.0% Strict Target Met');
    expect(markdown).toContain('< 5% Target Met');
  });
});
