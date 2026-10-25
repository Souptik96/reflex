import crypto from 'node:crypto';
import type { ToolInvocationEvidence } from '@reflex-ai/core';

export interface AsyncPollingStrategy {
  maxAttempts: number;
  intervalMs: number;
  backoffMultiplier: number;
  timeoutMs: number;
}

export interface PollAttemptRecord {
  attempt: number;
  timestamp: string;
  durationMs: number;
  passed: boolean;
  state?: unknown;
  error?: string;
}

export interface WebhookGateConfig {
  enabled: boolean;
  secretKey: string;
  expectedEventType?: string;
}

export interface AsyncReadAfterWriteContract {
  targetResource: string;
  query: (evidence: ToolInvocationEvidence[], attempt: number) => Promise<unknown>;
  assert: (readState: unknown, evidence: ToolInvocationEvidence[]) => boolean | Promise<boolean>;
  failureMessage: string;
  pollingStrategy?: Partial<AsyncPollingStrategy>;
  webhookGate?: WebhookGateConfig;
}

export interface AsyncVerificationResult {
  passed: boolean;
  settledVia: 'ASSERTION' | 'WEBHOOK' | 'TIMEOUT';
  attempts: PollAttemptRecord[];
  finalState?: unknown;
  failureReason?: string;
}

export class AsyncReadAfterWriteVerifier {
  private readonly defaultStrategy: AsyncPollingStrategy = {
    maxAttempts: 5,
    intervalMs: 50,
    backoffMultiplier: 1.5,
    timeoutMs: 2000,
  };
  private readonly sleepFn: (ms: number) => Promise<void>;
  private pendingWebhookPayload?: {
    payload: Record<string, unknown>;
    timestamp: string;
  };

  constructor(options: { sleepFn?: (ms: number) => Promise<void> } = {}) {
    this.sleepFn = options.sleepFn ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  /**
   * Validates and ingests an incoming out-of-band webhook event signed with HMAC-SHA256.
   * Resolves the webhook gate if the signature is authentic.
   */
  public receiveWebhook(
    payload: string | Record<string, unknown>,
    signatureHeader: string,
    secretKey: string
  ): boolean {
    const rawString = typeof payload === 'string' ? payload : JSON.stringify(payload);
    const computedHmac = crypto
      .createHmac('sha256', secretKey)
      .update(rawString)
      .digest('hex');

    // Strip prefix like "sha256=" if present
    const cleanHeader = signatureHeader.replace(/^sha256=/, '').trim();

    if (computedHmac.length !== cleanHeader.length) {
      return false;
    }

    const isValid = crypto.timingSafeEqual(
      Buffer.from(computedHmac, 'hex'),
      Buffer.from(cleanHeader, 'hex')
    );

    if (isValid) {
      const parsedObj = typeof payload === 'string'
        ? (JSON.parse(payload) as Record<string, unknown>)
        : payload;

      this.pendingWebhookPayload = {
        payload: parsedObj,
        timestamp: new Date().toISOString(),
      };
      return true;
    }

    return false;
  }

  /**
   * Executes asynchronous polling with exponential backoff and webhook event listening.
   */
  public async verify(
    contract: AsyncReadAfterWriteContract,
    evidence: ToolInvocationEvidence[]
  ): Promise<AsyncVerificationResult> {
    const strategy: AsyncPollingStrategy = {
      ...this.defaultStrategy,
      ...contract.pollingStrategy,
    };

    const startTime = performance.now();
    const attempts: PollAttemptRecord[] = [];
    let currentInterval = strategy.intervalMs;

    for (let attempt = 1; attempt <= strategy.maxAttempts; attempt++) {
      // 1. Check if a valid webhook event has already settled this contract
      if (contract.webhookGate?.enabled && this.pendingWebhookPayload) {
        const payload = this.pendingWebhookPayload.payload;
        if (
          !contract.webhookGate.expectedEventType ||
          payload['eventType'] === contract.webhookGate.expectedEventType ||
          payload['type'] === contract.webhookGate.expectedEventType
        ) {
          return {
            passed: true,
            settledVia: 'WEBHOOK',
            attempts,
            finalState: payload,
          };
        }
      }

      // Check remaining timeout budget
      const elapsedMs = performance.now() - startTime;
      if (elapsedMs >= strategy.timeoutMs) {
        return {
          passed: false,
          settledVia: 'TIMEOUT',
          attempts,
          failureReason: `Verification budget exceeded (${elapsedMs.toFixed(0)}ms >= ${strategy.timeoutMs}ms). ${contract.failureMessage}`,
        };
      }

      const queryStart = performance.now();
      let state: unknown;
      let passed = false;
      let error: string | undefined;

      try {
        state = await contract.query(evidence, attempt);
        passed = await contract.assert(state, evidence);
      } catch (err: unknown) {
        passed = false;
        error = err instanceof Error ? err.message : String(err);
      }

      const durationMs = performance.now() - queryStart;
      attempts.push({
        attempt,
        timestamp: new Date().toISOString(),
        durationMs,
        passed,
        state,
        error,
      });

      if (passed) {
        return {
          passed: true,
          settledVia: 'ASSERTION',
          attempts,
          finalState: state,
        };
      }

      // Check if we reached maxAttempts
      if (attempt === strategy.maxAttempts) {
        break;
      }

      // Sleep before next polling attempt, capped by remaining timeout
      const remainingMs = strategy.timeoutMs - (performance.now() - startTime);
      const sleepDuration = Math.min(currentInterval, Math.max(0, remainingMs));

      if (sleepDuration > 0) {
        await this.sleepFn(sleepDuration);
      }

      currentInterval = Math.round(currentInterval * strategy.backoffMultiplier);
    }

    return {
      passed: false,
      settledVia: 'TIMEOUT',
      attempts,
      failureReason: `Assertion failed after ${attempts.length} polling attempts. ${contract.failureMessage}`,
    };
  }
}
