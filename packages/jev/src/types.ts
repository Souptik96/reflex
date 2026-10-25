import { z } from 'zod';

// Question Schemas
export const JevChoiceQuestionSchema = z.object({
  id: z.string(),
  type: z.literal('choice'),
  prompt: z.string(),
  options: z.array(z.string()).min(2),
});
export type JevChoiceQuestion = z.infer<typeof JevChoiceQuestionSchema>;

export const JevScoreQuestionSchema = z.object({
  id: z.string(),
  type: z.literal('score'),
  prompt: z.string(),
  min: z.number(),
  max: z.number(),
});
export type JevScoreQuestion = z.infer<typeof JevScoreQuestionSchema>;

export const JevNoulQuestionSchema = z.object({
  id: z.string(),
  type: z.literal('noul'),
  prompt: z.string(),
});
export type JevNoulQuestion = z.infer<typeof JevNoulQuestionSchema>;

export const JevQuestionSchema = z.discriminatedUnion('type', [
  JevChoiceQuestionSchema,
  JevScoreQuestionSchema,
  JevNoulQuestionSchema,
]);
export type JevQuestion = z.infer<typeof JevQuestionSchema>;

// Request Schema
export const JevBatchRequestSchema = z.object({
  context: z.object({
    task: z.string(),
    environment: z.string(),
    caller_role: z.string(),
    available_tools: z.array(z.string()),
  }),
  questions: z.array(JevQuestionSchema),
});
export type JevBatchRequest = z.infer<typeof JevBatchRequestSchema>;

// Answer Schemas
export const JevChoiceAnswerSchema = z.object({
  type: z.literal('choice'),
  selected: z.string(),
  probabilities: z.record(z.string(), z.number()),
  confidence: z.number(),
});
export type JevChoiceAnswer = z.infer<typeof JevChoiceAnswerSchema>;

export const JevScoreAnswerSchema = z.object({
  type: z.literal('score'),
  value: z.number(),
  normalized: z.number(),
});
export type JevScoreAnswer = z.infer<typeof JevScoreAnswerSchema>;

export const JevNoulAnswerSchema = z.object({
  type: z.literal('noul'),
  judgment: z.boolean(),
  probability: z.number(),
});
export type JevNoulAnswer = z.infer<typeof JevNoulAnswerSchema>;

export const JevBatchResponseSchema = z.object({
  decision_id: z.string(),
  latency_ms: z.number(),
  usage: z
    .object({
      input_tokens: z.number(),
      output_tokens: z.number(),
    })
    .optional(),
  answers: z.object({
    route_selection: JevChoiceAnswerSchema,
    policy_risk: JevNoulAnswerSchema,
    complexity_score: JevScoreAnswerSchema,
    requires_mutation: JevNoulAnswerSchema,
  }),
});
export type JevBatchResponse = z.infer<typeof JevBatchResponseSchema>;

// Provider Interfaces & Client Config
export interface IJevProvider {
  name: string;
  evaluate(
    request: JevBatchRequest,
    signal?: AbortSignal
  ): Promise<JevBatchResponse>;
}

export const JevProviderTypeSchema = z.enum([
  'typesafe',
  'openrouter',
  'custom',
  'mock',
]);
export type JevProviderType = z.infer<typeof JevProviderTypeSchema>;

export interface JevClientConfig {
  provider?: JevProviderType;
  apiKey?: string;
  baseUrl?: string;
  timeoutMs?: number; // default 800ms
  customProvider?: IJevProvider;
}
