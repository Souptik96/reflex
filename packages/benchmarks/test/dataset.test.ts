import { describe, it, expect } from 'vitest';
import { createBenchmarkDataset } from '../src/dataset.js';
import { BenchmarkCategorySchema } from '../src/types.js';

describe('Benchmark Dataset Suite', () => {
  const dataset = createBenchmarkDataset();

  it('contains 10 synthetic tasks spanning all operational categories', () => {
    expect(dataset).toHaveLength(10);

    const categories = new Set(dataset.map((t) => t.category));
    expect(categories.has('DETERMINISTIC_LOOKUP')).toBe(true);
    expect(categories.has('MULTI_STEP_ORCHESTRATION')).toBe(true);
    expect(categories.has('UNAUTHORIZED_MUTATION')).toBe(true);
    expect(categories.has('ADVERSARIAL_LYING')).toBe(true);
    expect(categories.has('SEMANTIC_ANALYSIS')).toBe(true);
  });

  it('validates each task categories and context', () => {
    for (const task of dataset) {
      expect(BenchmarkCategorySchema.parse(task.category)).toBeDefined();
      expect(task.context.taskId).toBe(task.id);
      expect(task.context.task.length).toBeGreaterThan(5);
      expect(task.context.availableTools).toBeDefined();
    }
  });

  it('marks simple lookups and adversarial tasks appropriately', () => {
    const lookups = dataset.filter((t) => t.isSimpleLookup);
    expect(lookups.length).toBeGreaterThanOrEqual(2);

    const adversarial = dataset.filter((t) => t.isAdversarial);
    expect(adversarial.length).toBeGreaterThanOrEqual(3);
  });
});
