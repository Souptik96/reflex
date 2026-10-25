import type {
  CodeSynthesisParams,
  CodeSynthesisResult,
  ICodeSynthesisProvider,
} from './types.js';

export interface MockCodeSynthesizerOptions {
  fixedCode?: string;
  generator?: (params: CodeSynthesisParams) => string | Promise<string>;
  tokenUsage?: {
    inputTokens: number;
    outputTokens: number;
  };
}

export class MockCodeSynthesizer implements ICodeSynthesisProvider {
  private readonly fixedCode?: string;
  private readonly generator?: (params: CodeSynthesisParams) => string | Promise<string>;
  private readonly tokenUsage: { inputTokens: number; outputTokens: number };

  constructor(options: MockCodeSynthesizerOptions = {}) {
    this.fixedCode = options.fixedCode;
    this.generator = options.generator;
    this.tokenUsage = options.tokenUsage ?? { inputTokens: 100, outputTokens: 80 };
  }

  public async synthesizeProgram(params: CodeSynthesisParams): Promise<CodeSynthesisResult> {
    if (this.fixedCode) {
      return {
        code: this.fixedCode,
        tokenUsage: { ...this.tokenUsage },
      };
    }

    if (this.generator) {
      const generated = await this.generator(params);
      return {
        code: generated,
        tokenUsage: { ...this.tokenUsage },
      };
    }

    // Default deterministic program generation based on task and tools
    const primaryTool = params.availableTools[0]?.name;
    let code: string;

    if (primaryTool) {
      const parts = primaryTool.split('.');
      const invocation = parts.length === 2
        ? `await mcp.${parts[0]}.${parts[1]}({ task: "${params.task}" });`
        : `await mcp.tools.invoke("${primaryTool}", { task: "${params.task}" });`;

      code = [
        `const result = ${invocation}`,
        `return { status: "success", data: result, summary: "Completed task using ${primaryTool}" };`,
      ].join('\n');
    } else {
      code = `return { status: "success", data: { executedTask: "${params.task}" }, summary: "Executed without external tools" };`;
    }

    return {
      code,
      tokenUsage: { ...this.tokenUsage },
    };
  }
}
