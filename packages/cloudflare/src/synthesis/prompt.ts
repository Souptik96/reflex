import type { CodeSynthesisParams } from './types.js';

export function buildCodeSynthesisSystemPrompt(): string {
  return [
    'You are an expert AI code synthesis engine in the Reflex Outcome-Verified Execution Kernel (OVEK).',
    'Your goal is to generate an ephemeral, isolated JavaScript script to fulfill the user task.',
    '',
    'Execution Environment Constraints:',
    '1. The code runs inside an isolated V8 sandbox without access to `process`, `require`, `fs`, `fetch`, or direct sockets.',
    '2. You have access to a global `mcp` RPC proxy object to invoke registered tools.',
    '   Tools are grouped by namespace or flat name, e.g. `await mcp.deployments.list({ env: "staging" })` or `await mcp.tools.invoke("deployments.list", { env: "staging" })`.',
    '3. Your script MUST return an ExecutionOutput outcome object adhering to the following structure:',
    '   {',
    '     status: "success" | "failure" | "partial",',
    '     data?: unknown,',
    '     error?: string,',
    '     summary?: string',
    '   }',
    '4. Do NOT use `import` or `export` keywords.',
    '5. Write your solution as sequential, await-able code.',
    '6. Return ONLY executable JavaScript inside a ```javascript ... ``` markdown fence or as plain code. No conversational preambles.',
  ].join('\n');
}

export function buildCodeSynthesisUserPrompt(params: CodeSynthesisParams): string {
  const toolsDescription = params.availableTools.map((t) => {
    const mut = t.isMutation ? '[MUTATION]' : '[READ-ONLY]';
    const desc = t.description ? ` - ${t.description}` : '';
    const schema = t.parametersSchema ? ` (params: ${JSON.stringify(t.parametersSchema)})` : '';
    return `- ${t.name} ${mut}${desc}${schema}`;
  }).join('\n');

  const contextJson = params.context ? `\nContext:\n${JSON.stringify(params.context, null, 2)}` : '';

  return [
    `Task: ${params.task}`,
    contextJson,
    '',
    'Available MCP Tools:',
    toolsDescription || '- No external tools registered (pure computation)',
    '',
    'Synthesize the JavaScript code to execute this task and return the ExecutionOutput object.',
  ].join('\n');
}

export function extractExecutableCode(rawText: string): string {
  const trimmed = rawText.trim();
  const fenceRegex = /```(?:javascript|js|typescript|ts)?\s*([\s\S]*?)\s*```/i;
  const match = fenceRegex.exec(trimmed);

  if (match && match[1]) {
    return match[1].trim();
  }

  return trimmed;
}
