import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { evaluateAssertion, resolveFieldPath } from '../src/assertions.js';

describe('Deterministic Assertion Engine & Field Path Resolution', () => {
  const sampleOutput = {
    statusCode: 200,
    data: {
      user: {
        id: 'usr_42',
        role: 'admin',
        tags: ['internal', 'beta_tester'],
      },
      metrics: {
        latencyMs: 14.5,
        requestsCount: 150,
      },
    },
  };

  it('resolves nested dot and array index paths', () => {
    expect(resolveFieldPath(sampleOutput, 'statusCode')).toBe(200);
    expect(resolveFieldPath(sampleOutput, 'data.user.id')).toBe('usr_42');
    expect(resolveFieldPath(sampleOutput, 'data.user.tags[0]')).toBe('internal');
    expect(resolveFieldPath(sampleOutput, 'data.user.tags.1')).toBe('beta_tester');
    expect(resolveFieldPath(sampleOutput, 'data.missing.field')).toBeUndefined();
  });

  it('evaluates equals operator', () => {
    const resPass = evaluateAssertion(
      { field: 'data.user.id', operator: 'equals', expected: 'usr_42' },
      sampleOutput
    );
    expect(resPass.passed).toBe(true);

    const resFail = evaluateAssertion(
      { field: 'data.user.id', operator: 'equals', expected: 'usr_99' },
      sampleOutput
    );
    expect(resFail.passed).toBe(false);
    expect(resFail.reason).toContain('expected "usr_99"');
  });

  it('evaluates contains operator for arrays and strings', () => {
    const arrayPass = evaluateAssertion(
      { field: 'data.user.tags', operator: 'contains', expected: 'beta_tester' },
      sampleOutput
    );
    expect(arrayPass.passed).toBe(true);

    const strPass = evaluateAssertion(
      { field: 'data.user.id', operator: 'contains', expected: '42' },
      sampleOutput
    );
    expect(strPass.passed).toBe(true);

    const fail = evaluateAssertion(
      { field: 'data.user.tags', operator: 'contains', expected: 'non_existent' },
      sampleOutput
    );
    expect(fail.passed).toBe(false);
  });

  it('evaluates matches regex operator', () => {
    const pass = evaluateAssertion(
      { field: 'data.user.id', operator: 'matches', expected: '^usr_\\d+$' },
      sampleOutput
    );
    expect(pass.passed).toBe(true);

    const fail = evaluateAssertion(
      { field: 'data.user.id', operator: 'matches', expected: '^admin_\\d+$' },
      sampleOutput
    );
    expect(fail.passed).toBe(false);
  });

  it('evaluates non_empty operator', () => {
    const pass = evaluateAssertion(
      { field: 'data.user.tags', operator: 'non_empty' },
      sampleOutput
    );
    expect(pass.passed).toBe(true);

    const emptyArrayOutput = { items: [] };
    const fail = evaluateAssertion(
      { field: 'items', operator: 'non_empty' },
      emptyArrayOutput
    );
    expect(fail.passed).toBe(false);
  });

  it('evaluates numeric comparison operators (gt, gte, lt, lte)', () => {
    expect(
      evaluateAssertion(
        { field: 'data.metrics.requestsCount', operator: 'gt', expected: 100 },
        sampleOutput
      ).passed
    ).toBe(true);

    expect(
      evaluateAssertion(
        { field: 'data.metrics.requestsCount', operator: 'gte', expected: 150 },
        sampleOutput
      ).passed
    ).toBe(true);

    expect(
      evaluateAssertion(
        { field: 'data.metrics.latencyMs', operator: 'lt', expected: 20 },
        sampleOutput
      ).passed
    ).toBe(true);

    expect(
      evaluateAssertion(
        { field: 'data.metrics.latencyMs', operator: 'lte', expected: 10 },
        sampleOutput
      ).passed
    ).toBe(false);
  });

  it('evaluates schema operator with Zod schemas', () => {
    const UserSchema = z.object({
      id: z.string().startsWith('usr_'),
      role: z.enum(['admin', 'member']),
      tags: z.array(z.string()),
    });

    const pass = evaluateAssertion(
      { field: 'data.user', operator: 'schema', expected: UserSchema },
      sampleOutput
    );
    expect(pass.passed).toBe(true);

    const StrictNumberSchema = z.number().int().min(500);
    const fail = evaluateAssertion(
      { field: 'data.metrics.requestsCount', operator: 'schema', expected: StrictNumberSchema },
      sampleOutput
    );
    expect(fail.passed).toBe(false);
    expect(fail.reason).toContain('failed schema validation');
  });
});
