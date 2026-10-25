#!/usr/bin/env node

import { runCommand } from '../commands/run.js';
import { verifyCommand } from '../commands/verify.js';
import { benchCommand } from '../commands/bench.js';
import type {
  BenchCommandOptions,
  RunCommandOptions,
  VerifyCommandOptions,
} from '../types.js';

function printHelp(): void {
  const helpText = `
Reflex CLI - Decision-Gated, Outcome-Verified Agent Runtime

USAGE:
  reflex <command> [arguments] [options]

COMMANDS:
  run <task>              Execute a task using Reflex runtime
    --env <env>           Execution environment (default: development)
    --role <role>         Caller role (default: developer)
    --script <path>       Path to JS script override
    --approval-id <id>    Resume an approved task by approval ID
    --output-json         Output raw execution result in JSON format
    --store <file|memory> Persist evidence ledger to store
    --sign                Cryptographically sign the evidence ledger (Ed25519)
    --interactive         Interactively prompt to approve mutations via stdin

  verify <ledger.json>    Independently audit and verify a signed EvidenceLedger
    --expected-key <key>  Expected Ed25519 public key hex
    --output-json         Output audit report in JSON format

  bench                   Run benchmark matrix (ReAct vs Code Mode vs Reflex)
    --output-json         Output benchmark matrix in JSON format

  --help, -h              Show this help message
  --version, -v           Show CLI version
`;
  process.stdout.write(helpText);
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
    printHelp();
    return 0;
  }

  if (argv.includes('--version') || argv.includes('-v')) {
    process.stdout.write('reflex 0.1.0\n');
    return 0;
  }

  const [command, ...args] = argv;

  if (command === 'run') {
    const task = args[0];
    if (!task || task.startsWith('--')) {
      process.stderr.write('Error: task description is required for "reflex run <task>"\n');
      return 1;
    }

    const options: RunCommandOptions = {
      env: 'development',
      role: 'developer',
      sign: false,
      outputJson: false,
      interactive: false,
    };

    for (let i = 1; i < args.length; i++) {
      const arg = args[i];
      if (arg === '--env') {
        const val = args[++i];
        if (val) options.env = val;
      } else if (arg === '--role') {
        const val = args[++i];
        if (val) options.role = val;
      } else if (arg === '--script') {
        const val = args[++i];
        if (val) options.script = val;
      } else if (arg === '--approval-id') {
        const val = args[++i];
        if (val) options.approvalId = val;
      } else if (arg === '--output-json') {
        options.outputJson = true;
      } else if (arg === '--store') {
        const val = args[++i];
        if (val === 'file' || val === 'memory') {
          options.store = val;
        }
      } else if (arg === '--sign') {
        options.sign = true;
      } else if (arg === '--interactive') {
        options.interactive = true;
      }
    }

    const out = await runCommand(task, options);
    if (out.stdout) process.stdout.write(`${out.stdout}\n`);
    if (out.stderr && out.exitCode !== 0 && !options.outputJson) {
      process.stderr.write(`Error: ${out.stderr}\n`);
    }
    return out.exitCode;
  }

  if (command === 'verify') {
    const ledgerPath = args[0];
    if (!ledgerPath || ledgerPath.startsWith('--')) {
      process.stderr.write('Error: ledger file path is required for "reflex verify <ledger.json>"\n');
      return 1;
    }

    const options: VerifyCommandOptions = {
      outputJson: false,
    };

    for (let i = 1; i < args.length; i++) {
      const arg = args[i];
      if (arg === '--expected-key') {
        const val = args[++i];
        if (val) options.expectedPublicKey = val;
      } else if (arg === '--output-json') {
        options.outputJson = true;
      }
    }

    const out = await verifyCommand(ledgerPath, options);
    if (out.stdout) process.stdout.write(`${out.stdout}\n`);
    if (out.stderr && out.exitCode !== 0 && !options.outputJson) {
      process.stderr.write(`Error: ${out.stderr}\n`);
    }
    return out.exitCode;
  }

  if (command === 'bench') {
    const options: BenchCommandOptions = {
      outputJson: args.includes('--output-json'),
    };

    const out = await benchCommand(options);
    if (out.stdout) process.stdout.write(`${out.stdout}\n`);
    return out.exitCode;
  }

  process.stderr.write(`Unknown command: ${command}. Use --help for usage.\n`);
  return 1;
}

// Execute if run directly
if (process.argv[1]?.endsWith('reflex.js') || process.argv[1]?.endsWith('reflex.ts')) {
  main().then((exitCode) => {
    process.exit(exitCode);
  }).catch((err: unknown) => {
    process.stderr.write(`Fatal error: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
}
