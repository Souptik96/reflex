import type {
  IJevProvider,
  JevBatchRequest,
  JevBatchResponse,
} from '../types.js';
import { JevBatchResponseSchema } from '../types.js';

export class OpenRouterJevProvider implements IJevProvider {
  public readonly name = 'openrouter';
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(
    apiKey: string,
    baseUrl: string = 'https://openrouter.ai/api/alpha/decisions'
  ) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
  }

  public async evaluate(
    request: JevBatchRequest,
    signal?: AbortSignal
  ): Promise<JevBatchResponse> {
    const response = await fetch(this.baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(request),
      signal,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(
        `OpenRouter Alpha Decisions API returned status ${response.status}: ${errorText}`
      );
    }

    const json = (await response.json()) as unknown;
    return JevBatchResponseSchema.parse(json);
  }
}
