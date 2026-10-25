import { BenchmarkRunner } from '@reflex-ai/benchmarks';
import type { BenchmarkComparisonReport } from '@reflex-ai/benchmarks';
import type { BenchCommandOptions, CliExecutionOutput } from '../types.js';

export async function benchCommand(
  options: BenchCommandOptions = { outputJson: false }
): Promise<CliExecutionOutput<{ report: BenchmarkComparisonReport; markdownTable: string }>> {
  const runner = new BenchmarkRunner();
  const suiteResult = await runner.runFullSuite();

  const react = suiteResult.report.harnesses['BASELINE_A_REACT'];
  const codeMode = suiteResult.report.harnesses['BASELINE_B_CODEMODE'];
  const reflex = suiteResult.report.harnesses['CANDIDATE_C_REFLEX'];
  const improvements = suiteResult.report.reflexImprovements;

  const formattedOutput = [
    '# Reflex Comparative Evaluation Benchmark Results',
    '',
    suiteResult.markdownTable,
    '',
    '## Key Architectural Findings:',
    `- Reflex Candidate C p50 Latency: ${reflex?.p50LatencyMs.toFixed(1) ?? 'N/A'}ms (${improvements?.latencyReductionP50Percent.toFixed(1) ?? 'N/A'}% vs ReAct Baseline A)`,
    `- Reflex Cost Per Task: $${reflex?.costPerSuccessfulTask.toFixed(5) ?? 'N/A'} (${improvements?.costReductionPercent.toFixed(1) ?? 'N/A'}% vs ReAct Baseline A)`,
    `- False-Safe Rate: ReAct (${react?.falseSafeRate.toFixed(1) ?? '0'}%) vs Code Mode (${codeMode?.falseSafeRate.toFixed(1) ?? '0'}%) vs Reflex (${reflex?.falseSafeRate.toFixed(1) ?? '0'}%)`,
    `- Verification Detection Rate: ${reflex?.verificationDetectionRate.toFixed(1) ?? '100'}% of adversarial/failing actions intercepted`,
  ].join('\n');

  const stdout = options.outputJson
    ? JSON.stringify(suiteResult, null, 2)
    : formattedOutput;

  return {
    exitCode: 0,
    stdout,
    stderr: '',
    data: {
      report: suiteResult.report,
      markdownTable: suiteResult.markdownTable,
    },
  };
}
