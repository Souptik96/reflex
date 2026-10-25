import { describe, it, expect } from 'vitest';
import type { TaskContext } from '@reflex-ai/core';
import { buildStandardQuestions, buildJevBatchRequest } from '../src/prompts.js';
import { JevBatchRequestSchema } from '../src/types.js';

describe('Jev Prompts & Question Builders', () => {
  const context: TaskContext = {
    taskId: 'task_jev_1',
    task: 'Scan all stale deployments and remove them',
    environment: 'staging',
    callerRole: 'developer',
    availableTools: ['deployments.list', 'deployments.delete'],
  };

  it('builds standard 4 questions for batch evaluation', () => {
    const questions = buildStandardQuestions();
    expect(questions).toHaveLength(4);

    const [qRoute, qPolicy, qComplexity, qMutation] = questions;
    expect(qRoute?.id).toBe('route_selection');
    expect(qRoute?.type).toBe('choice');
    if (qRoute?.type === 'choice') {
      expect(qRoute.options).toEqual(['FAST_PATH', 'CODE_MODE', 'ASK_USER', 'BLOCK']);
    }

    expect(qPolicy?.id).toBe('policy_risk');
    expect(qPolicy?.type).toBe('noul');

    expect(qComplexity?.id).toBe('complexity_score');
    expect(qComplexity?.type).toBe('score');
    if (qComplexity?.type === 'score') {
      expect(qComplexity.min).toBe(1);
      expect(qComplexity.max).toBe(5);
    }

    expect(qMutation?.id).toBe('requires_mutation');
    expect(qMutation?.type).toBe('noul');
  });

  it('constructs wire-compliant JevBatchRequest that validates with Zod', () => {
    const batchReq = buildJevBatchRequest(context);
    const parsed = JevBatchRequestSchema.parse(batchReq);

    expect(parsed.context.task).toBe(context.task);
    expect(parsed.context.environment).toBe(context.environment);
    expect(parsed.context.caller_role).toBe(context.callerRole);
    expect(parsed.context.available_tools).toEqual(context.availableTools);
    expect(parsed.questions).toHaveLength(4);
  });
});
