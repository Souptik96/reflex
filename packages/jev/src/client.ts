import {
  JevDecisionBatchSchema,
  ReflexRouteSchema,
  type JevDecisionBatch,
  type ReflexRoute,
  type TaskContext,
} from '@reflex-ai/core';
import type {
  IJevProvider,
  JevBatchResponse,
  JevClientConfig,
} from './types.js';
import { buildJevBatchRequest } from './prompts.js';
import { buildConservativeFallback } from './fallback.js';
import { TypeSafeJevProvider } from './providers/typesafe.js';
import { OpenRouterJevProvider } from './providers/openrouter.js';
import { MockJevProvider } from './providers/mock.js';

export class JevClient {
  private readonly provider: IJevProvider;
  private readonly timeoutMs: number;

  constructor(config: JevClientConfig = {}) {
    this.timeoutMs = config.timeoutMs ?? 800;

    if (config.customProvider) {
      this.provider = config.customProvider;
    } else if (config.provider === 'openrouter') {
      this.provider = new OpenRouterJevProvider(config.apiKey ?? '', config.baseUrl);
    } else if (config.provider === 'typesafe') {
      this.provider = new TypeSafeJevProvider(config.apiKey ?? '', config.baseUrl);
    } else {
      // Default to MockJevProvider if no API key or provider is set to mock
      this.provider = new MockJevProvider();
    }
  }

  public getProviderName(): string {
    return this.provider.name;
  }

  public async evaluate(context: TaskContext): Promise<JevDecisionBatch> {
    const startTime = performance.now();
    const batchRequest = buildJevBatchRequest(context);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response: JevBatchResponse = await this.provider.evaluate(
        batchRequest,
        controller.signal
      );
      clearTimeout(timer);
      const elapsedMs = performance.now() - startTime;

      return this.transformResponse(response, elapsedMs);
    } catch (error: unknown) {
      clearTimeout(timer);
      const elapsedMs = performance.now() - startTime;
      const message = error instanceof Error ? error.message : 'Unknown Jev error';
      return buildConservativeFallback(context, elapsedMs, message);
    }
  }

  private transformResponse(
    response: JevBatchResponse,
    measuredLatencyMs: number
  ): JevDecisionBatch {
    const routeAnswer = response.answers.route_selection;
    const policyAnswer = response.answers.policy_risk;
    const complexityAnswer = response.answers.complexity_score;
    const mutationAnswer = response.answers.requires_mutation;

    // Validate that selected route is one of the valid ReflexRoute values
    const parsedRoute = ReflexRouteSchema.safeParse(routeAnswer.selected);
    const selectedRoute: ReflexRoute = parsedRoute.success
      ? parsedRoute.data
      : 'FALLBACK';

    const probabilities: Record<ReflexRoute, number> = {
      FAST_PATH: routeAnswer.probabilities['FAST_PATH'] ?? 0.0,
      CODE_MODE: routeAnswer.probabilities['CODE_MODE'] ?? 0.0,
      ASK_USER: routeAnswer.probabilities['ASK_USER'] ?? 0.0,
      BLOCK: routeAnswer.probabilities['BLOCK'] ?? 0.0,
      FALLBACK: routeAnswer.probabilities['FALLBACK'] ?? 0.0,
    };

    const tokenUsage = response.usage
      ? {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
        }
      : undefined;

    const rawBatch = {
      route: {
        selected: selectedRoute,
        probabilities,
        confidence: routeAnswer.confidence,
      },
      policyViolation: {
        isViolation: policyAnswer.judgment,
        probability: policyAnswer.probability,
      },
      complexityScore: {
        score: Math.min(5, Math.max(1, complexityAnswer.value)),
        normalized: complexityAnswer.normalized,
      },
      requiresMutation: {
        willMutateState: mutationAnswer.judgment,
        probability: mutationAnswer.probability,
      },
      rawLatencyMs: measuredLatencyMs,
      tokenUsage,
    };

    return JevDecisionBatchSchema.parse(rawBatch);
  }
}
