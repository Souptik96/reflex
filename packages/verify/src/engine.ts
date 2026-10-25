import type {
  PostconditionCheck,
  TaskContext,
  ToolInvocationEvidence,
} from '@reflex-ai/core';
import type {
  VerificationContract,
  VerificationResult,
} from './types.js';
import { evaluateAssertion, resolveFieldPath } from './assertions.js';
import {
  evaluateSemanticPostcondition,
  type SemanticEvaluator,
} from './semantic.js';
import { AsyncReadAfterWriteVerifier } from './async-verifier.js';

export class VerificationEngine {
  private readonly semanticEvaluator?: SemanticEvaluator;
  private readonly asyncVerifier: AsyncReadAfterWriteVerifier;

  constructor(options: {
    semanticEvaluator?: SemanticEvaluator;
    asyncVerifier?: AsyncReadAfterWriteVerifier;
  } = {}) {
    this.semanticEvaluator = options.semanticEvaluator;
    this.asyncVerifier = options.asyncVerifier ?? new AsyncReadAfterWriteVerifier();
  }

  public async verify(
    _context: TaskContext,
    output: unknown,
    evidenceLedgerToolCalls: readonly ToolInvocationEvidence[],
    contract?: VerificationContract
  ): Promise<VerificationResult> {
    const checks: PostconditionCheck[] = [];

    // ─────────────────────────────────────────────────────────────
    // 1. LAYER 1: Host-Intercepted Tool Ingress & Status Code Check
    // ─────────────────────────────────────────────────────────────
    // If an agent script caught an HTTP error and swallowed it, the host proxy
    // recorded the real HTTP status. Verification fails immediately.
    for (const toolCall of evidenceLedgerToolCalls) {
      const httpStatus = toolCall.httpStatus ?? 200;
      const passed = httpStatus >= 200 && httpStatus < 300;
      checks.push({
        layer: 'DETERMINISTIC',
        target: `tool:${toolCall.toolName}`,
        expected: '2xx',
        actual: httpStatus,
        passed,
        reason: passed
          ? undefined
          : `Tool '${toolCall.toolName}' failed with HTTP ${httpStatus} [Call ID: ${toolCall.callId}]`,
      });

      if (!passed) {
        return {
          status: 'VERIFICATION_FAILED',
          passed: false,
          reason: `Tool '${toolCall.toolName}' returned HTTP ${httpStatus}`,
          checks,
        };
      }
    }

    // ─────────────────────────────────────────────────────────────
    // 2. LAYER 1: Required Tool Invocations (Anti-Phantom / Anti-Hallucination)
    // ─────────────────────────────────────────────────────────────
    // If the agent claimed it mutated or queried a resource, but never invoked the tool
    if (contract?.requiredToolCalls && contract.requiredToolCalls.length > 0) {
      for (const required of contract.requiredToolCalls) {
        const calls = evidenceLedgerToolCalls.filter(
          (c) => c.toolName === required.toolName
        );
        const minCalls = required.minCalls ?? 1;
        const maxCalls = required.maxCalls;

        let passed = calls.length >= minCalls;
        if (maxCalls !== undefined && calls.length > maxCalls) {
          passed = false;
        }

        const reason = passed
          ? undefined
          : `Required tool '${required.toolName}' invocation count (${calls.length}) failed expectation (min: ${minCalls}${maxCalls !== undefined ? `, max: ${maxCalls}` : ''})`;

        checks.push({
          layer: 'DETERMINISTIC',
          target: `required_tool:${required.toolName}`,
          expected: `>= ${minCalls} call(s)`,
          actual: `${calls.length} call(s)`,
          passed,
          reason,
        });

        if (!passed) {
          return {
            status: 'VERIFICATION_FAILED',
            passed: false,
            reason: reason ?? `Required tool '${required.toolName}' was not invoked as expected`,
            checks,
          };
        }
      }
    }

    // ─────────────────────────────────────────────────────────────
    // 3. LAYER 1: Deterministic Output Assertions
    // ─────────────────────────────────────────────────────────────
    if (contract?.deterministicAssertions && contract.deterministicAssertions.length > 0) {
      for (const assertion of contract.deterministicAssertions) {
        const result = evaluateAssertion(assertion, output);
        checks.push({
          layer: 'DETERMINISTIC',
          target: `output.${assertion.field}`,
          expected: `${assertion.operator} ${assertion.expected !== undefined ? JSON.stringify(assertion.expected) : ''}`.trim(),
          actual: result.actual,
          passed: result.passed,
          reason: result.reason,
        });

        if (!result.passed) {
          return {
            status: 'VERIFICATION_FAILED',
            passed: false,
            reason: result.reason ?? `Deterministic assertion on '${assertion.field}' failed`,
            checks,
          };
        }
      }
    }

    // ─────────────────────────────────────────────────────────────
    // 4. LAYER 2: Authoritative Read-After-Write (Synchronous & Asynchronous)
    // ─────────────────────────────────────────────────────────────
    if (contract?.readAfterWrite && contract.readAfterWrite.length > 0) {
      for (const rawCheck of contract.readAfterWrite) {
        try {
          // Out-of-band query executed directly against source-of-truth
          const readState = await rawCheck.query(evidenceLedgerToolCalls);
          const passed = await rawCheck.assert(readState, evidenceLedgerToolCalls);

          checks.push({
            layer: 'READ_AFTER_WRITE',
            target: rawCheck.targetResource,
            expected: 'Mutated state validated via authoritative read',
            actual: readState,
            passed,
            reason: passed ? undefined : rawCheck.failureMessage,
          });

          if (!passed) {
            return {
              status: 'VERIFICATION_FAILED',
              passed: false,
              reason: rawCheck.failureMessage,
              checks,
            };
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          checks.push({
            layer: 'READ_AFTER_WRITE',
            target: rawCheck.targetResource,
            expected: 'Successful out-of-band query',
            actual: msg,
            passed: false,
            reason: `Read-after-write query threw exception: ${msg}`,
          });

          return {
            status: 'VERIFICATION_FAILED',
            passed: false,
            reason: `Read-after-write query failed: ${msg}`,
            checks,
          };
        }
      }
    }

    // Asynchronous Read-After-Write with Polling & Eventual Consistency
    if (contract?.asyncReadAfterWrite && contract.asyncReadAfterWrite.length > 0) {
      for (const asyncCheck of contract.asyncReadAfterWrite) {
        const asyncResult = await this.asyncVerifier.verify(
          asyncCheck,
          [...evidenceLedgerToolCalls]
        );

        checks.push({
          layer: 'READ_AFTER_WRITE',
          target: asyncCheck.targetResource,
          expected: `Eventual consistency (${asyncResult.settledVia})`,
          actual: asyncResult.finalState ?? `Attempts: ${asyncResult.attempts.length}`,
          passed: asyncResult.passed,
          reason: asyncResult.passed ? undefined : asyncResult.failureReason,
        });

        if (!asyncResult.passed) {
          return {
            status: 'VERIFICATION_FAILED',
            passed: false,
            reason: asyncResult.failureReason ?? asyncCheck.failureMessage,
            checks,
          };
        }
      }
    }

    // ─────────────────────────────────────────────────────────────
    // 5. LAYER 3: Bounded Semantic Verification (Jev Noul)
    // ─────────────────────────────────────────────────────────────
    if (contract?.semanticVerifications && contract.semanticVerifications.length > 0) {
      for (const semanticCheck of contract.semanticVerifications) {
        let targetContent: string;
        if (semanticCheck.targetField) {
          const fieldValue = resolveFieldPath(output, semanticCheck.targetField);
          targetContent = typeof fieldValue === 'string'
            ? fieldValue
            : JSON.stringify(fieldValue);
        } else {
          targetContent = typeof output === 'string' ? output : JSON.stringify(output);
        }

        const semanticResult = await evaluateSemanticPostcondition(
          semanticCheck,
          targetContent,
          evidenceLedgerToolCalls,
          this.semanticEvaluator
        );

        checks.push({
          layer: 'SEMANTIC',
          target: `semantic:${semanticCheck.description}`,
          expected: `Jev noul true (${((semanticCheck.minimumConfidence ?? 0.7) * 100).toFixed(0)}% conf)`,
          actual: `judgment: ${semanticResult.judgment}, probability: ${(semanticResult.probability * 100).toFixed(1)}%`,
          passed: semanticResult.passed,
          reason: semanticResult.reason,
        });

        if (!semanticResult.passed) {
          return {
            status: 'VERIFICATION_FAILED',
            passed: false,
            reason: semanticResult.reason ?? `Semantic postcondition check failed: ${semanticCheck.prompt}`,
            checks,
          };
        }
      }
    }

    // ─────────────────────────────────────────────────────────────
    // 6. Terminal Verification Status Dispatch
    // ─────────────────────────────────────────────────────────────
    const hadReadAfterWrite = Boolean(
      (contract?.readAfterWrite && contract.readAfterWrite.length > 0) ||
      (contract?.asyncReadAfterWrite && contract.asyncReadAfterWrite.length > 0)
    );
    const hasMutations = evidenceLedgerToolCalls.some((c) => c.isMutation);

    if (hadReadAfterWrite) {
      // Authoritative read-after-write ran and passed
      return {
        status: 'VERIFIED_SUCCESS',
        passed: true,
        checks,
      };
    }

    if (hasMutations) {
      // Mutations occurred without authoritative read check
      return {
        status: 'UNVERIFIED_SUCCESS',
        passed: true,
        checks,
      };
    }

    // Pure read or deterministic execution with assertions passed
    return {
      status: 'VERIFIED_SUCCESS',
      passed: true,
      checks,
    };
  }
}
