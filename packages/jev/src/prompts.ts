import type { TaskContext } from '@reflex-ai/core';
import type { JevBatchRequest, JevQuestion } from './types.js';

export function buildStandardQuestions(): JevQuestion[] {
  return [
    {
      id: 'route_selection',
      type: 'choice',
      prompt: 'Select the optimal execution route for this task.',
      options: ['FAST_PATH', 'CODE_MODE', 'ASK_USER', 'BLOCK'],
    },
    {
      id: 'policy_risk',
      type: 'noul',
      prompt:
        'Does this request attempt an unauthorized, dangerous, or production-breaking mutation?',
    },
    {
      id: 'complexity_score',
      type: 'score',
      prompt:
        'Evaluate task complexity from 1 (single deterministic lookup) to 5 (multi-step cross-API orchestration).',
      min: 1,
      max: 5,
    },
    {
      id: 'requires_mutation',
      type: 'noul',
      prompt:
        'Will fulfilling this task modify, delete, or create persistent state in any external system?',
    },
  ];
}

export function buildJevBatchRequest(context: TaskContext): JevBatchRequest {
  return {
    context: {
      task: context.task,
      environment: context.environment,
      caller_role: context.callerRole,
      available_tools: context.availableTools,
    },
    questions: buildStandardQuestions(),
  };
}
