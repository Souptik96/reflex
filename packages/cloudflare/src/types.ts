import { z } from 'zod';
import type { TaskContext, ToolInvocationEvidence } from '@reflex-ai/core';

export const ToolParameterSchema = z.record(z.string(), z.unknown());
export type ToolParameter = z.infer<typeof ToolParameterSchema>;

export const ToolDefinitionSchema = z.object({
  name: z.string().min(1),
  description: z.string().default(''),
  isMutation: z.boolean().default(false),
  parametersSchema: z.record(z.string(), z.unknown()).optional(),
});
export type ToolDefinition = z.infer<typeof ToolDefinitionSchema>;

export type ToolHandler = (
  params: Record<string, unknown>,
  context: TaskContext
) => Promise<{
  httpStatus?: number;
  data: unknown;
}>;

export const ToolInvocationResponseSchema = z.object({
  callId: z.string(),
  success: z.boolean(),
  httpStatus: z.number().int(),
  data: z.unknown().optional(),
  error: z.string().optional(),
  isMutation: z.boolean(),
  durationMs: z.number().nonnegative(),
});
export type ToolInvocationResponse = z.infer<typeof ToolInvocationResponseSchema>;

export interface IHostToolProxy {
  invokeTool(
    taskId: string,
    toolName: string,
    params: Record<string, unknown>
  ): Promise<ToolInvocationResponse>;
  getEvidenceLog(): readonly ToolInvocationEvidence[];
  clearEvidenceLog(): void;
}

export const SandboxExecutionResultSchema = z.object({
  success: z.boolean(),
  returnValue: z.unknown().optional(),
  error: z.string().optional(),
  logs: z.array(z.string()),
  wallTimeMs: z.number().nonnegative(),
});
export type SandboxExecutionResult = z.infer<typeof SandboxExecutionResultSchema>;

export interface SandboxExecutionOptions {
  timeoutMs?: number; // default 5000ms
  context?: TaskContext;
}
