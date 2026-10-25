import { describe, expect, it } from 'vitest';
import {
  AnthropicCodeSynthesizer,
  MockCodeSynthesizer,
  OpenAICodeSynthesizer,
  buildCodeSynthesisSystemPrompt,
  buildCodeSynthesisUserPrompt,
  extractExecutableCode,
  ExecutionOutputSchema,
} from '../src/index.js';

describe('Phase 4: Generative Code Synthesis Providers', () => {
  const dummyTools = [
    {
      name: 'deployments.list',
      description: 'List active deployments',
      isMutation: false,
    },
    {
      name: 'deployments.delete',
      description: 'Delete deployment by ID',
      isMutation: true,
      parametersSchema: { id: { type: 'string' } },
    },
  ];

  describe('Prompt Builders & Code Extraction', () => {
    it('builds a strict system prompt targeting isolated execution and ExecutionOutputSchema', () => {
      const prompt = buildCodeSynthesisSystemPrompt();
      expect(prompt).toContain('Reflex Outcome-Verified Execution Kernel');
      expect(prompt).toContain('ExecutionOutput');
      expect(prompt).toContain('mcp');
      expect(prompt).toContain('status');
    });

    it('builds a comprehensive user prompt formatting tools and mutations', () => {
      const userPrompt = buildCodeSynthesisUserPrompt({
        task: 'Delete inactive deployments',
        availableTools: dummyTools,
        context: { environment: 'staging' },
      });

      expect(userPrompt).toContain('Task: Delete inactive deployments');
      expect(userPrompt).toContain('deployments.list [READ-ONLY]');
      expect(userPrompt).toContain('deployments.delete [MUTATION]');
      expect(userPrompt).toContain('staging');
    });

    it('extracts JavaScript code cleanly from markdown fences', () => {
      const codeInsideFence = 'const a = 1;\nreturn { status: "success", data: a };';
      const markdown = `Here is the solution:\n\`\`\`javascript\n${codeInsideFence}\n\`\`\`\nHope this helps!`;
      expect(extractExecutableCode(markdown)).toBe(codeInsideFence);

      const tsMarkdown = `\`\`\`typescript\n${codeInsideFence}\n\`\`\``;
      expect(extractExecutableCode(tsMarkdown)).toBe(codeInsideFence);

      const plain = 'return { status: "success" };';
      expect(extractExecutableCode(plain)).toBe(plain);
    });
  });

  describe('MockCodeSynthesizer', () => {
    it('generates deterministic code and token counts without live API keys', async () => {
      const mockSynthesizer = new MockCodeSynthesizer();
      const res = await mockSynthesizer.synthesizeProgram({
        task: 'List deployments',
        availableTools: dummyTools,
      });

      expect(res.code).toContain('await mcp.deployments.list');
      expect(res.code).toContain('status: "success"');
      expect(res.tokenUsage.inputTokens).toBeGreaterThan(0);
      expect(res.tokenUsage.outputTokens).toBeGreaterThan(0);
    });

    it('supports custom generator callback', async () => {
      const mock = new MockCodeSynthesizer({
        generator: (params) => `return { status: "success", customTask: "${params.task}" };`,
      });

      const res = await mock.synthesizeProgram({
        task: 'Purge cache',
        availableTools: [],
      });

      expect(res.code).toBe('return { status: "success", customTask: "Purge cache" };');
    });

    it('supports fixed code override', async () => {
      const fixed = 'return { status: "success", direct: true };';
      const mock = new MockCodeSynthesizer({ fixedCode: fixed });
      const res = await mock.synthesizeProgram({
        task: 'Any',
        availableTools: [],
      });
      expect(res.code).toBe(fixed);
    });
  });

  describe('AnthropicCodeSynthesizer (Offline Simulated Harness)', () => {
    it('throws descriptive error when API key is missing', async () => {
      const synthesizer = new AnthropicCodeSynthesizer({ apiKey: '' });
      await expect(
        synthesizer.synthesizeProgram({
          task: 'Find pods',
          availableTools: dummyTools,
        })
      ).rejects.toThrow('AnthropicCodeSynthesizer requires an API key');
    });

    it('calls Messages API with correct structure and extracts code', async () => {
      let capturedUrl = '';
      let capturedHeaders: Record<string, string> = {};
      let capturedBody: Record<string, unknown> = {};

      const mockFetch: typeof fetch = async (input, init) => {
        capturedUrl = String(input);
        capturedHeaders = (init?.headers ?? {}) as Record<string, string>;
        capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;

        const responsePayload = {
          id: 'msg_123',
          type: 'message',
          model: 'claude-3-5-sonnet-20241022',
          content: [
            {
              type: 'text',
              text: '```javascript\nconst deps = await mcp.deployments.list({});\nreturn { status: "success", data: deps };\n```',
            },
          ],
          usage: {
            input_tokens: 150,
            output_tokens: 45,
          },
        };

        return new Response(JSON.stringify(responsePayload), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      };

      const synthesizer = new AnthropicCodeSynthesizer({
        apiKey: 'test-ant-key',
        fetchFn: mockFetch,
      });

      const result = await synthesizer.synthesizeProgram({
        task: 'List all staging deployments',
        availableTools: dummyTools,
      });

      expect(capturedUrl).toContain('/v1/messages');
      expect(capturedHeaders['x-api-key']).toBe('test-ant-key');
      expect(capturedHeaders['anthropic-version']).toBe('2023-06-01');
      expect(capturedBody['model']).toBe('claude-3-5-sonnet-20241022');
      expect(result.code).toBe('const deps = await mcp.deployments.list({});\nreturn { status: "success", data: deps };');
      expect(result.tokenUsage.inputTokens).toBe(150);
      expect(result.tokenUsage.outputTokens).toBe(45);
    });

    it('handles non-200 API responses gracefully', async () => {
      const mockFetch: typeof fetch = async () => {
        return new Response('Rate limit exceeded', { status: 429 });
      };

      const synthesizer = new AnthropicCodeSynthesizer({
        apiKey: 'test-ant-key',
        fetchFn: mockFetch,
      });

      await expect(
        synthesizer.synthesizeProgram({ task: 'T', availableTools: [] })
      ).rejects.toThrow('Anthropic API request failed [HTTP 429]: Rate limit exceeded');
    });
  });

  describe('OpenAICodeSynthesizer (Offline Simulated Harness)', () => {
    it('throws descriptive error when API key is missing', async () => {
      const synthesizer = new OpenAICodeSynthesizer({ apiKey: '' });
      await expect(
        synthesizer.synthesizeProgram({
          task: 'Find pods',
          availableTools: dummyTools,
        })
      ).rejects.toThrow('OpenAICodeSynthesizer requires an API key');
    });

    it('calls Chat Completions API with correct payload and extracts code', async () => {
      let capturedUrl = '';
      let capturedHeaders: Record<string, string> = {};
      let capturedBody: Record<string, unknown> = {};

      const mockFetch: typeof fetch = async (input, init) => {
        capturedUrl = String(input);
        capturedHeaders = (init?.headers ?? {}) as Record<string, string>;
        capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;

        const responsePayload = {
          id: 'chatcmpl-123',
          choices: [
            {
              message: {
                role: 'assistant',
                content: '```javascript\nreturn { status: "success", summary: "all done" };\n```',
              },
            },
          ],
          usage: {
            prompt_tokens: 110,
            completion_tokens: 30,
            total_tokens: 140,
          },
        };

        return new Response(JSON.stringify(responsePayload), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      };

      const synthesizer = new OpenAICodeSynthesizer({
        apiKey: 'test-openai-key',
        fetchFn: mockFetch,
      });

      const result = await synthesizer.synthesizeProgram({
        task: 'Run cleanup',
        availableTools: dummyTools,
      });

      expect(capturedUrl).toContain('/v1/chat/completions');
      expect(capturedHeaders['Authorization']).toBe('Bearer test-openai-key');
      expect(capturedBody['model']).toBe('gpt-4o');
      expect(result.code).toBe('return { status: "success", summary: "all done" };');
      expect(result.tokenUsage.inputTokens).toBe(110);
      expect(result.tokenUsage.outputTokens).toBe(30);
    });

    it('handles OpenAI API errors gracefully', async () => {
      const mockFetch: typeof fetch = async () => {
        return new Response('Invalid API key', { status: 401 });
      };

      const synthesizer = new OpenAICodeSynthesizer({
        apiKey: 'bad-key',
        fetchFn: mockFetch,
      });

      await expect(
        synthesizer.synthesizeProgram({ task: 'T', availableTools: [] })
      ).rejects.toThrow('OpenAI API request failed [HTTP 401]: Invalid API key');
    });
  });

  describe('ExecutionOutputSchema Validation', () => {
    it('validates success output conforms to schema', () => {
      const parsed = ExecutionOutputSchema.safeParse({
        status: 'success',
        data: { deletedCount: 3 },
        summary: 'Deleted 3 deployments',
      });
      expect(parsed.success).toBe(true);
    });

    it('rejects invalid status values', () => {
      const parsed = ExecutionOutputSchema.safeParse({
        status: 'unknown_status',
      });
      expect(parsed.success).toBe(false);
    });
  });
});
