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

export interface OpenAISynthesizerOptions {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  fetchFn?: typeof fetch;
}

interface OpenAIChoice {
  message?: {
    content?: string | null;
    role?: string;
  };
  finish_reason?: string;
}

interface OpenAIResponsePayload {
  id: string;
  choices: OpenAIChoice[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export class OpenAICodeSynthesizer implements ICodeSynthesisProvider {
  private readonly apiKey?: string;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;

  constructor(options: OpenAISynthesizerOptions = {}) {
    this.apiKey = options.apiKey ?? (typeof process !== 'undefined' ? process.env['OPENAI_API_KEY'] : undefined);
    this.model = options.model ?? 'gpt-4o';
    this.baseUrl = (options.baseUrl ?? 'https://api.openai.com').replace(/\/+$/, '');
    this.fetchFn = options.fetchFn ?? fetch;
  }

  public async synthesizeProgram(params: CodeSynthesisParams): Promise<CodeSynthesisResult> {
    if (!this.apiKey) {
      throw new Error(
        'OpenAICodeSynthesizer requires an API key. Provide apiKey in constructor or set OPENAI_API_KEY in environment.'
      );
    }

    const systemPrompt = buildCodeSynthesisSystemPrompt();
    const userPrompt = buildCodeSynthesisUserPrompt(params);

    const endpoint = `${this.baseUrl}/v1/chat/completions`;
    const response = await this.fetchFn(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          {
            role: 'system',
            content: systemPrompt,
          },
          {
            role: 'user',
            content: userPrompt,
          },
        ],
        temperature: 0.1,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `OpenAI API request failed [HTTP ${response.status}]: ${errorText}`
      );
    }

    const data = (await response.json()) as OpenAIResponsePayload;
    const firstChoice = data.choices[0];
    const rawContent = firstChoice?.message?.content ?? '';
    const executableCode = extractExecutableCode(rawContent);

    return {
      code: executableCode,
      tokenUsage: {
        inputTokens: data.usage?.prompt_tokens ?? 0,
        outputTokens: data.usage?.completion_tokens ?? 0,
      },
    };
  }
}
