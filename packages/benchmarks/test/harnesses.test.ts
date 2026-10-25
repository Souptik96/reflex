import { describe, it, expect } from 'vitest';
import { createBenchmarkDataset } from '../src/dataset.js';
import { ReActHarness } from '../src/harnesses/react-harness.js';
import { CodeModeHarness } from '../src/harnesses/codemode-harness.js';
import { ReflexHarness } from '../src/harnesses/reflex-harness.js';

describe('Benchmark Harnesses Execution', () => {
  const dataset = createBenchmarkDataset();
  const lookupTask = dataset.find((t) => t.isSimpleLookup)!;
  const multiStepTask = dataset.find((t) => t.category === 'MULTI_STEP_ORCHESTRATION')!;
  const adversarialTask = dataset.find((t) => t.isAdversarial)!;

  it('Baseline A (ReAct) executes with high sequential token accumulation', async () => {
    const harness = new ReActHarness();
    const result = await harness.runTask(multiStepTask);

    expect(result.harnessName).toBe('BASELINE_A_REACT');
    expect(result.latencyMs).toBeGreaterThan(600); // multiple roundtrips
    expect(result.tokensUsed.inputTokens).toBeGreaterThan(1500);
    expect(result.costUsd).toBeGreaterThan(0.005);
  });

  it('Baseline B (Code Mode) batches multi-step task in single script', async () => {
    const harness = new CodeModeHarness();
    const result = await harness.runTask(multiStepTask);

    expect(result.harnessName).toBe('BASELINE_B_CODEMODE');
    expect(result.latencyMs).toBeLessThan(500);
    expect(result.usedSlowPath).toBe(true);
  });

  it('Baseline A & B fail on adversarial lying tasks (False-Safe outcome)', async () => {
    const react = new ReActHarness();
    const codeMode = new CodeModeHarness();

    const resA = await react.runTask(adversarialTask);
    const resB = await codeMode.runTask(adversarialTask);

    // Both baselines accept the agent's reported success without verification!
    expect(resA.reportedSuccess).toBe(true);
    expect(resA.isFalseSafe).toBe(true);

    expect(resB.reportedSuccess).toBe(true);
    expect(resB.isFalseSafe).toBe(true);
  });

  it('Candidate C (Reflex) uses FAST_PATH on lookup and verifies adversarial tasks', async () => {
    const reflex = new ReflexHarness();

    // 1. Simple lookup
    const lookupRes = await reflex.runTask(lookupTask);
    expect(lookupRes.usedSlowPath).toBe(false);
    expect(lookupRes.latencyMs).toBeLessThan(100);

    // 2. Adversarial task
    const advRes = await reflex.runTask(adversarialTask);
    expect(advRes.reportedSuccess).toBe(false);
    expect(advRes.isFalseSafe).toBe(false); // Reflex is NEVER false-safe!
    expect(advRes.detectedFailure).toBe(true);
  });
});
