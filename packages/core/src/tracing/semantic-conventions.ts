export const SpanNames = {
  TASK: 'reflex.task',
  PREFLIGHT: 'reflex.preflight',
  JEV_DECISION: 'reflex.jev.decision',
  CODEMODE_SANDBOX: 'reflex.codemode.sandbox',
  TOOL_PREFIX: 'reflex.tool.',
  VERIFY_LAYER1: 'reflex.verify.layer1',
  VERIFY_LAYER2: 'reflex.verify.layer2',
  VERIFY_LAYER3: 'reflex.verify.layer3',
} as const;

export const SpanAttributesKeys = {
  // Root task attributes
  TASK_ID: 'reflex.task.id',
  TASK_ENVIRONMENT: 'reflex.task.environment',
  TASK_CALLER_ROLE: 'reflex.task.caller_role',
  TASK_STATUS: 'reflex.task.status',
  TASK_ROUTE: 'reflex.task.route',

  // Preflight attributes
  PREFLIGHT_PASSED: 'passed',
  PREFLIGHT_ERROR_CODE: 'errorCode',
  PREFLIGHT_DURATION_MS: 'durationMs',

  // Jev decision attributes
  JEV_ROUTE: 'route',
  JEV_CONFIDENCE: 'confidence',
  JEV_COMPLEXITY: 'complexity',
  JEV_MUTATION_REQUIRED: 'mutationRequired',
  JEV_TOKENS: 'tokens',

  // Sandbox attributes
  SANDBOX_WALL_TIME_MS: 'wallTimeMs',
  SANDBOX_TOOL_COUNT: 'toolCount',
  SANDBOX_LOGS_COUNT: 'sandboxLogsCount',

  // Tool attributes
  TOOL_NAME: 'toolName',
  TOOL_IS_MUTATION: 'isMutation',
  TOOL_HTTP_STATUS: 'httpStatus',
  TOOL_DURATION_MS: 'durationMs',

  // Verify layer attributes
  VERIFY_PASSED: 'passed',
  VERIFY_CHECKS_COUNT: 'checksCount',
  VERIFY_TARGET_RESOURCE: 'targetResource',
  VERIFY_SETTLED_VIA: 'settledVia',
  VERIFY_POLL_ATTEMPTS: 'pollAttempts',
  VERIFY_JUDGMENT: 'judgment',
  VERIFY_PROBABILITY: 'probability',
} as const;
