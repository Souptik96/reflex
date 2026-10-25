import { z } from 'zod';
import type { ToolDefinition } from '../types.js';

export type ToolSchema = ToolDefinition;

export interface CodeSynthesisParams {
  task: string;
  availableTools: ToolDefinition[];
  context?: Record<string, unknown>;
}

export interface CodeSynthesisResult {
  code: string;
  tokenUsage: {
    inputTokens: number;
    outputTokens: number;
  };
}

export interface ICodeSynthesisProvider {
  synthesizeProgram(params: CodeSynthesisParams): Promise<CodeSynthesisResult>;
}

export const ExecutionOutputSchema = z.object({
  status: z.enum(['success', 'failure', 'partial']),
  data: z.unknown().optional(),
  error: z.string().optional(),
  summary: z.string().optional(),
});
export type ExecutionOutput = z.infer<typeof ExecutionOutputSchema>;
