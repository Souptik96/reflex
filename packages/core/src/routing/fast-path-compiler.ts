import type { TaskContext } from '../types/index.js';

export interface FastPathRule<TOutput = unknown> {
  id: string;
  pattern: RegExp | string;
  environments?: string[];
  roles?: string[];
  handler: (context: TaskContext) => Promise<TOutput> | TOutput;
  description?: string;
}

export interface FastPathMatchResult<TOutput = unknown> {
  matched: boolean;
  ruleId?: string;
  output?: TOutput;
  durationMs: number;
}

export class FastPathCompiler {
  private readonly rules: FastPathRule[] = [];

  constructor(rules: FastPathRule[] = []) {
    this.compileRules(rules);
  }

  public registerRule<TOutput = unknown>(rule: FastPathRule<TOutput>): this {
    this.rules.push(rule as FastPathRule);
    return this;
  }

  public compileRules(rules: FastPathRule[]): this {
    for (const rule of rules) {
      this.registerRule(rule);
    }
    return this;
  }

  public match(context: TaskContext): FastPathRule | undefined {
    const taskTrimmed = context.task.trim();

    for (const rule of this.rules) {
      // 1. Environment filter
      if (rule.environments && rule.environments.length > 0) {
        if (!rule.environments.includes(context.environment)) {
          continue;
        }
      }

      // 2. Caller role filter
      if (rule.roles && rule.roles.length > 0) {
        if (!rule.roles.includes(context.callerRole)) {
          continue;
        }
      }

      // 3. Pattern match
      if (typeof rule.pattern === 'string') {
        if (taskTrimmed.toLowerCase().includes(rule.pattern.toLowerCase())) {
          return rule;
        }
      } else if (rule.pattern instanceof RegExp) {
        if (rule.pattern.test(taskTrimmed)) {
          return rule;
        }
      }
    }

    return undefined;
  }

  public async execute(context: TaskContext): Promise<FastPathMatchResult> {
    const start = performance.now();
    const matchedRule = this.match(context);

    if (!matchedRule) {
      return {
        matched: false,
        durationMs: performance.now() - start,
      };
    }

    const output = await matchedRule.handler(context);
    const durationMs = performance.now() - start;

    return {
      matched: true,
      ruleId: matchedRule.id,
      output,
      durationMs,
    };
  }

  public getRules(): readonly FastPathRule[] {
    return [...this.rules];
  }

  public clear(): void {
    this.rules.length = 0;
  }
}
