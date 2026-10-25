import type {
  CodeSynthesisParams,
  CodeSynthesisResult,
  ICodeSynthesisProvider,
} from './types.js';
import {
  buildCodeSynthesisSystemPrompt,
  buildCodeSynthesisUserPrompt,
  extractExecutableCode,
} from './prompt.js';

export interface AnthropicSynthesizerOptions {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  fetchFn?: typeof fetch;
}

interface AnthropicMessageContent {
  type: string;
  text?: string;
}

interface AnthropicResponsePayload {
  id: string;
  type: string;
  content: AnthropicMessageContent[];
  model: string;
  usage?: {
    input_tokens: number;
    output_tokens: number;
  };
}

export class AnthropicCodeSynthesizer implements ICodeSynthesisProvider {
  private readonly apiKey?: string;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;

  constructor(options: AnthropicSynthesizerOptions = {}) {
    this.apiKey = options.apiKey ?? (typeof process !== 'undefined' ? process.env['ANTHROPIC_API_KEY'] : undefined);
    this.model = options.model ?? 'claude-3-5-sonnet-20241022';
    this.baseUrl = (options.baseUrl ?? 'https://api.anthropic.com').replace(/\/+$/, '');
    this.fetchFn = options.fetchFn ?? fetch;
  }

  public async synthesizeProgram(params: CodeSynthesisParams): Promise<CodeSynthesisResult> {
    if (!this.apiKey) {
      throw new Error(
        'AnthropicCodeSynthesizer requires an API key. Provide apiKey in constructor or set ANTHROPIC_API_KEY in environment.'
      );
    }

    const systemPrompt = buildCodeSynthesisSystemPrompt();
    const userPrompt = buildCodeSynthesisUserPrompt(params);

    const endpoint = `${this.baseUrl}/v1/messages`;
    const response = await this.fetchFn(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 4096,
        system: systemPrompt,
        messages: [
          {
            role: 'user',
            content: userPrompt,
          },
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Anthropic API request failed [HTTP ${response.status}]: ${errorText}`
      );
    }

    const data = (await response.json()) as AnthropicResponsePayload;
    const textChunk = data.content.find((c) => c.type === 'text');
    const rawCode = textChunk?.text ?? '';
    const executableCode = extractExecutableCode(rawCode);

    return {
      code: executableCode,
      tokenUsage: {
        inputTokens: data.usage?.input_tokens ?? 0,
        outputTokens: data.usage?.output_tokens ?? 0,
      },
    };
  }
}
