import type {
  BenchmarkComparisonReport,
  BenchmarkTask,
  HarnessExecutionResult,
  HarnessMetrics,
} from './types.js';
import { createBenchmarkDataset } from './dataset.js';
import { ReActHarness } from './harnesses/react-harness.js';
import { CodeModeHarness } from './harnesses/codemode-harness.js';
import { ReflexHarness } from './harnesses/reflex-harness.js';
import {
  computeHarnessMetrics,
  formatComparisonMarkdownTable,
  generateComparisonReport,
} from './metrics.js';

export interface BenchmarkRunnerOptions {
  customDataset?: BenchmarkTask[];
}

export class BenchmarkRunner {
  private readonly dataset: BenchmarkTask[];

  constructor(options: BenchmarkRunnerOptions = {}) {
    this.dataset = options.customDataset ?? createBenchmarkDataset();
  }

  public async runHarness(
    harness: ReActHarness | CodeModeHarness | ReflexHarness
  ): Promise<{ metrics: HarnessMetrics; results: HarnessExecutionResult[] }> {
    const results: HarnessExecutionResult[] = [];
    for (const task of this.dataset) {
      const res = await harness.runTask(task);
      results.push(res);
    }

    const metrics = computeHarnessMetrics(harness.name, results, this.dataset);
    return { metrics, results };
  }

  public async runFullSuite(): Promise<{
    report: BenchmarkComparisonReport;
    markdownTable: string;
    rawResults: Record<string, HarnessExecutionResult[]>;
  }> {
    const reactHarness = new ReActHarness();
    const codeModeHarness = new CodeModeHarness();
    const reflexHarness = new ReflexHarness();

    const reactRun = await this.runHarness(reactHarness);
    const codeModeRun = await this.runHarness(codeModeHarness);
    const reflexRun = await this.runHarness(reflexHarness);

    const metricsMap: Record<string, HarnessMetrics> = {
      [reactHarness.name]: reactRun.metrics,
      [codeModeHarness.name]: codeModeRun.metrics,
      [reflexHarness.name]: reflexRun.metrics,
    };

    const report = generateComparisonReport(metricsMap);
    const markdownTable = formatComparisonMarkdownTable(report);

    return {
      report,
      markdownTable,
      rawResults: {
        [reactHarness.name]: reactRun.results,
        [codeModeHarness.name]: codeModeRun.results,
        [reflexHarness.name]: reflexRun.results,
      },
    };
  }
}
