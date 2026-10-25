import type {
  ReflexExecutionResult,
  TaskContext,
  TenantConfig,
  TenantPolicyManager,
} from '@reflex-ai/core';
import type { ToolHandler } from '@reflex-ai/cloudflare';
import { ReflexRunner } from './runner.js';
import type {
  FastPathHandler,
  ReflexAgentConfig,
  RegisterToolOptions,
  RunOptions,
} from './types.js';

export class ReflexAgent {
  private readonly runner: ReflexRunner;

  constructor(config: ReflexAgentConfig = {}) {
    this.runner = new ReflexRunner(config);
  }

  public registerTool(options: RegisterToolOptions): this {
    this.runner
      .getHostToolProxy()
      .registerTool(
        options.name,
        options.isMutation,
        options.handler,
        options.description
      );
    return this;
  }

  public registerToolHandler(
    name: string,
    isMutation: boolean,
    handler: ToolHandler,
    description: string = ''
  ): this {
    return this.registerTool({
      name,
      isMutation,
      handler,
      description,
    });
  }

  public registerFastPath(key: string, handler: FastPathHandler): this {
    this.runner.registerFastPath(key, handler);
    return this;
  }

  public registerTenant(config: TenantConfig): this {
    const mgr = this.runner.getTenantPolicyManager();
    if (!mgr) {
      throw new Error('TenantPolicyManager is not configured on this agent');
    }
    mgr.registerTenant(config);
    return this;
  }

  public getTenantPolicyManager(): TenantPolicyManager | undefined {
    return this.runner.getTenantPolicyManager();
  }

  public getApprovalGate() {
    return this.runner.getApprovalGate();
  }

  public getTracer() {
    return this.runner.getTracer();
  }

  public getDecisionCache() {
    return this.runner.getDecisionCache();
  }

  public getFastPathCompiler() {
    return this.runner.getFastPathCompiler();
  }

  public getRunner(): ReflexRunner {
    return this.runner;
  }

  public approve(approvalId: string, reviewer?: string, reviewerRole?: string) {
    return this.runner.getApprovalGate().approve(approvalId, reviewer, reviewerRole);
  }

  public reject(approvalId: string, reviewer?: string) {
    return this.runner.getApprovalGate().reject(approvalId, reviewer);
  }

  public async approveAndResume<TOutput = unknown>(
    approvalId: string,
    options: RunOptions = {},
    reviewer?: string,
    reviewerRole?: string
  ): Promise<ReflexExecutionResult<TOutput>> {
    const request = this.runner.getApprovalGate().approve(approvalId, reviewer, reviewerRole);
    return this.run<TOutput>(request.context as TaskContext, {
      ...options,
      approvalId,
    });
  }

  public async run<TOutput = unknown>(
    context: TaskContext,
    options: RunOptions = {}
  ): Promise<ReflexExecutionResult<TOutput>> {
    return this.runner.run<TOutput>(context, options);
  }
}

export function createAgent(config: ReflexAgentConfig = {}): ReflexAgent {
  return new ReflexAgent(config);
}
