import { type ZodType } from 'zod';
import type { DeterministicAssertion } from './types.js';

export function resolveFieldPath(target: unknown, path: string): unknown {
  if (target === undefined || target === null) {
    return undefined;
  }

  if (!path || path.trim() === '') {
    return target;
  }

  // Normalize array index notations: e.g. "items[0].id" -> "items.0.id"
  const normalizedPath = path.replace(/\[(\w+)\]/g, '.$1');
  const segments = normalizedPath.split('.');

  let current: unknown = target;
  for (const segment of segments) {
    if (current === undefined || current === null) {
      return undefined;
    }
    if (typeof current === 'object') {
      current = (current as Record<string, unknown>)[segment];
    } else {
      return undefined;
    }
  }

  return current;
}

export function evaluateAssertion(
  assertion: DeterministicAssertion,
  output: unknown
): { passed: boolean; actual: unknown; reason?: string } {
  const actual = resolveFieldPath(output, assertion.field);

  switch (assertion.operator) {
    case 'equals': {
      const passed = JSON.stringify(actual) === JSON.stringify(assertion.expected);
      return {
        passed,
        actual,
        reason: passed
          ? undefined
          : `Field '${assertion.field}' expected ${JSON.stringify(assertion.expected)}, got ${JSON.stringify(actual)}`,
      };
    }

    case 'contains': {
      let passed = false;
      if (Array.isArray(actual)) {
        passed = actual.some(
          (item) => JSON.stringify(item) === JSON.stringify(assertion.expected) || item === assertion.expected
        );
      } else if (typeof actual === 'string' && typeof assertion.expected === 'string') {
        passed = actual.includes(assertion.expected);
      } else if (typeof actual === 'object' && actual !== null && typeof assertion.expected === 'string') {
        passed = assertion.expected in actual;
      }
      return {
        passed,
        actual,
        reason: passed
          ? undefined
          : `Field '${assertion.field}' does not contain expected item ${JSON.stringify(assertion.expected)}`,
      };
    }

    case 'matches': {
      let passed = false;
      if (typeof actual === 'string' && typeof assertion.expected === 'string') {
        passed = new RegExp(assertion.expected).test(actual);
      }
      return {
        passed,
        actual,
        reason: passed
          ? undefined
          : `Field '${assertion.field}' with value "${actual}" does not match regex /${assertion.expected}/`,
      };
    }

    case 'schema': {
      let passed = false;
      let errorMsg: string | undefined;

      if (
        assertion.expected &&
        typeof assertion.expected === 'object' &&
        'safeParse' in assertion.expected &&
        typeof (assertion.expected as ZodType).safeParse === 'function'
      ) {
        const parseRes = (assertion.expected as ZodType).safeParse(actual);
        passed = parseRes.success;
        if (!parseRes.success) {
          errorMsg = parseRes.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ');
        }
      } else {
        passed = actual !== undefined && actual !== null;
      }

      return {
        passed,
        actual,
        reason: passed
          ? undefined
          : `Field '${assertion.field}' failed schema validation: ${errorMsg ?? 'Invalid schema match'}`,
      };
    }

    case 'non_empty': {
      let passed = false;
      if (Array.isArray(actual)) {
        passed = actual.length > 0;
      } else if (typeof actual === 'string') {
        passed = actual.trim().length > 0;
      } else if (typeof actual === 'object' && actual !== null) {
        passed = Object.keys(actual).length > 0;
      } else {
        passed = actual !== undefined && actual !== null;
      }
      return {
        passed,
        actual,
        reason: passed ? undefined : `Field '${assertion.field}' is empty`,
      };
    }

    case 'gt': {
      const numActual = Number(actual);
      const numExpected = Number(assertion.expected);
      const passed = !isNaN(numActual) && !isNaN(numExpected) && numActual > numExpected;
      return {
        passed,
        actual,
        reason: passed ? undefined : `Field '${assertion.field}' (${actual}) is not greater than ${assertion.expected}`,
      };
    }

    case 'gte': {
      const numActual = Number(actual);
      const numExpected = Number(assertion.expected);
      const passed = !isNaN(numActual) && !isNaN(numExpected) && numActual >= numExpected;
      return {
        passed,
        actual,
        reason: passed ? undefined : `Field '${assertion.field}' (${actual}) is not greater than or equal to ${assertion.expected}`,
      };
    }

    case 'lt': {
      const numActual = Number(actual);
      const numExpected = Number(assertion.expected);
      const passed = !isNaN(numActual) && !isNaN(numExpected) && numActual < numExpected;
      return {
        passed,
        actual,
        reason: passed ? undefined : `Field '${assertion.field}' (${actual}) is not less than ${assertion.expected}`,
      };
    }

    case 'lte': {
      const numActual = Number(actual);
      const numExpected = Number(assertion.expected);
      const passed = !isNaN(numActual) && !isNaN(numExpected) && numActual <= numExpected;
      return {
        passed,
        actual,
        reason: passed ? undefined : `Field '${assertion.field}' (${actual}) is not less than or equal to ${assertion.expected}`,
      };
    }

    default:
      return { passed: true, actual };
  }
}
