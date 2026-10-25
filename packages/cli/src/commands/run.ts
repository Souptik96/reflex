import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { ReflexExecutionResult, TaskContext } from '@reflex-ai/core';
import { ReflexAgent } from '@reflex-ai/reflex';
import { FileLedgerStore, LedgerSigner, MemoryLedgerStore } from '@reflex-ai/verify';
import { formatRunSummary } from '../formatters.js';
import { promptConfirmation, type InputReader } from '../prompt.js';
import type { CliExecutionOutput, RunCommandOptions } from '../types.js';

export async function runCommand(
  task: string,
  options: RunCommandOptions,
  providedAgent?: ReflexAgent,
  inputReader?: InputReader
): Promise<CliExecutionOutput<ReflexExecutionResult>> {
  let scriptContent = options.script;
  if (options.script && fs.existsSync(options.script)) {
    scriptContent = fs.readFileSync(options.script, 'utf8');
  }

  let ledgerStore = undefined;
  if (options.store === 'file') {
    const storeDir = options.storeDir ?? '.reflex/ledgers';
    ledgerStore = new FileLedgerStore({ storageDir: storeDir });
  } else if (options.store === 'memory') {
    ledgerStore = new MemoryLedgerStore();
  }

  const ledgerSigner = options.sign ? new LedgerSigner() : undefined;

  const agent =
    providedAgent ??
    new ReflexAgent({
      ledgerStore,
      ledgerSigner,
    });

  const taskId = `task_${randomUUID().replace(/-/g, '').slice(0, 10)}`;
  const context: TaskContext = {
    taskId,
    task,
    environment: options.env ?? 'development',
    callerRole: options.role ?? 'developer',
    availableTools: ['deployments.list', 'deployments.delete', 'metrics.query'],
  };

  let result = await agent.run(context, {
    script: scriptContent,
    approvalId: options.approvalId,
  });

  // Handle interactive approval gate
  if (result.status === 'NEEDS_HUMAN_REVIEW' && options.interactive && result.approvalId) {
    const reason = result.error ?? 'State modification requires approval';
    const approved = await promptConfirmation(
      `\n⚠️  Task requires human review: "${reason}". Approve and resume?`,
      false,
      inputReader
    );

    if (approved) {
      result = await agent.approveAndResume(result.approvalId, {
        script: scriptContent,
      });
    }
  }

  // Determine exit code
  let exitCode = 1;
  if (
    result.status === 'VERIFIED_SUCCESS' ||
    result.status === 'UNVERIFIED_SUCCESS'
  ) {
    exitCode = 0;
  } else if (result.status === 'NEEDS_HUMAN_REVIEW') {
    exitCode = 2;
  } else {
    // EXECUTION_FAILED, VERIFICATION_FAILED, BLOCKED_BY_POLICY, SYSTEM_FALLBACK
    exitCode = 1;
  }

  const stdout = options.outputJson
    ? JSON.stringify(result, null, 2)
    : formatRunSummary(result);

  return {
    exitCode,
    stdout,
    stderr: exitCode !== 0 ? (result.error ?? 'Execution ended with non-zero status') : '',
    data: result,
  };
}
