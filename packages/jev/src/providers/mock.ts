import type {
  IJevProvider,
  JevBatchRequest,
  JevBatchResponse,
} from '../types.js';

export interface MockJevOptions {
  fixedResponse?: JevBatchResponse;
  delayMs?: number;
  shouldTimeout?: boolean;
  shouldThrow?: boolean;
  errorMessage?: string;
  responseGenerator?: (request: JevBatchRequest) => JevBatchResponse;
}

export class MockJevProvider implements IJevProvider {
  public readonly name = 'mock';
  private options: MockJevOptions;

  constructor(options: MockJevOptions = {}) {
    this.options = { ...options };
  }

  public setOptions(options: Partial<MockJevOptions>): void {
    this.options = { ...this.options, ...options };
  }

  public async evaluate(
    request: JevBatchRequest,
    signal?: AbortSignal
  ): Promise<JevBatchResponse> {
    if (this.options.delayMs && this.options.delayMs > 0) {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => resolve(), this.options.delayMs);
        if (signal) {
          signal.addEventListener('abort', () => {
            clearTimeout(timeout);
            reject(new DOMException('Request aborted', 'AbortError'));
          });
        }
      });
    }

    if (signal?.aborted) {
      throw new DOMException('Request aborted', 'AbortError');
    }

    if (this.options.shouldTimeout) {
      // Hang until aborted
      await new Promise<void>((_, reject) => {
        if (signal) {
          signal.addEventListener('abort', () => {
            reject(new DOMException('Request aborted', 'AbortError'));
          });
        }
      });
    }

    if (this.options.shouldThrow) {
      throw new Error(this.options.errorMessage ?? 'Simulated Jev network error');
    }

    if (this.options.fixedResponse) {
      return this.options.fixedResponse;
    }

    if (this.options.responseGenerator) {
      return this.options.responseGenerator(request);
    }

    // Default intelligent mock based on task contents
    return this.generateDefaultMockResponse(request);
  }

  private generateDefaultMockResponse(request: JevBatchRequest): JevBatchResponse {
    const task = request.context.task.toLowerCase();

    // Check for hard policy violation / block markers
    if (task.includes('steal') || task.includes('exfiltrate') || task.includes('malicious')) {
      return {
        decision_id: `dec_mock_${Date.now()}`,
        latency_ms: 45,
        usage: { input_tokens: 50, output_tokens: 10 },
        answers: {
          route_selection: {
            type: 'choice',
            selected: 'BLOCK',
            probabilities: { FAST_PATH: 0.0, CODE_MODE: 0.0, ASK_USER: 0.05, BLOCK: 0.95 },
            confidence: 0.95,
          },
          policy_risk: { type: 'noul', judgment: true, probability: 0.98 },
          complexity_score: { type: 'score', value: 4, normalized: 0.8 },
          requires_mutation: { type: 'noul', judgment: true, probability: 0.9 },
        },
      };
    }

    // Check for ambiguous / human confirmation markers
    if (task.includes('confirm') || task.includes('approve') || task.includes('ambiguous')) {
      return {
        decision_id: `dec_mock_${Date.now()}`,
        latency_ms: 38,
        usage: { input_tokens: 48, output_tokens: 10 },
        answers: {
          route_selection: {
            type: 'choice',
            selected: 'ASK_USER',
            probabilities: { FAST_PATH: 0.05, CODE_MODE: 0.1, ASK_USER: 0.85, BLOCK: 0.0 },
            confidence: 0.85,
          },
          policy_risk: { type: 'noul', judgment: false, probability: 0.1 },
          complexity_score: { type: 'score', value: 2, normalized: 0.4 },
          requires_mutation: { type: 'noul', judgment: true, probability: 0.75 },
        },
      };
    }

    // Check for fast path / lookup markers
    if (task.includes('get') || task.includes('status') || task.includes('ping') || task.includes('lookup')) {
      return {
        decision_id: `dec_mock_${Date.now()}`,
        latency_ms: 22,
        usage: { input_tokens: 32, output_tokens: 8 },
        answers: {
          route_selection: {
            type: 'choice',
            selected: 'FAST_PATH',
            probabilities: { FAST_PATH: 0.92, CODE_MODE: 0.05, ASK_USER: 0.02, BLOCK: 0.01 },
            confidence: 0.92,
          },
          policy_risk: { type: 'noul', judgment: false, probability: 0.02 },
          complexity_score: { type: 'score', value: 1.2, normalized: 0.24 },
          requires_mutation: { type: 'noul', judgment: false, probability: 0.02 },
        },
      };
    }

    // Default to CODE_MODE for multi-step / generative orchestration
    return {
      decision_id: `dec_mock_${Date.now()}`,
      latency_ms: 60,
      usage: { input_tokens: 64, output_tokens: 12 },
      answers: {
        route_selection: {
          type: 'choice',
          selected: 'CODE_MODE',
          probabilities: { FAST_PATH: 0.1, CODE_MODE: 0.82, ASK_USER: 0.05, BLOCK: 0.03 },
          confidence: 0.82,
        },
        policy_risk: { type: 'noul', judgment: false, probability: 0.05 },
        complexity_score: { type: 'score', value: 3.5, normalized: 0.7 },
        requires_mutation: {
          type: 'noul',
          judgment: task.includes('delete') || task.includes('create') || task.includes('update'),
          probability: 0.7,
        },
      },
    };
  }
}
