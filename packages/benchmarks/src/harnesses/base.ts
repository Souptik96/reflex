import type { BenchmarkTask, HarnessExecutionResult } from '../types.js';

export interface IBenchmarkHarness {
  readonly name: HarnessExecutionResult['harnessName'];
  runTask(task: BenchmarkTask): Promise<HarnessExecutionResult>;
}
