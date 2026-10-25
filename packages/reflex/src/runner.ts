import {
  DecisionCache,
  ExecutionStateMachine,
  FastPathCompiler,
  MutationApprovalGate,
  PolicyEngine,
  PreflightValidator,
  SpanNames,
  SpanAttributesKeys,
  type ILedgerStore,
  type IReflexTracer,
  type JevDecisionBatch,
  type ReflexExecutionResult,
  type ReflexRoute,
  type TaskContext,
  type TenantPolicyManager,
  type VerificationStatus,
} from '@reflex-ai/core';
import { JevClient } from '@reflex-ai/jev';
import { HostToolProxy, SandboxExecutor, type ICodeSynthesisProvider } from '@reflex-ai/cloudflare';
import { EvidenceLedgerBuilder, VerificationEngine, type LedgerSigner } from '@reflex-ai/verify';
import type {
  CodeSynthesizer,
  FastPathHandler,
  ReflexAgentConfig,
  RunOptions,
} from './types.js';

export class ReflexRunner {
  private readonly preflightValidator: PreflightValidator;
  private readonly policyEngine: PolicyEngine;
  private readonly jevClient: JevClient;
  private readonly hostToolProxy: HostToolProxy;
  private readonly sandboxExecutor: SandboxExecutor;
  private readonly verificationEngine: VerificationEngine;
  private readonly approvalGate: MutationApprovalGate;
  private readonly fastPathHandlers: Map<string, FastPathHandler>;
  private readonly codeSynthesizer?: CodeSynthesizer;
  private readonly codeSynthesisProvider?: ICodeSynthesisProvider;
  private readonly ledgerSigner?: LedgerSigner;
  private readonly ledgerStore?: ILedgerStore;
  private readonly tracer?: IReflexTracer;
  private readonly decisionCache?: DecisionCache;
  private readonly fastPathCompiler?: FastPathCompiler;
  private readonly tenantPolicyManager?: TenantPolicyManager;

  constructor(config: ReflexAgentConfig = {}) {
    this.tenantPolicyManager = config.tenantPolicyManager;
    this.policyEngine = new PolicyEngine(config.policyConfig);
    this.preflightValidator = new PreflightValidator({
      ...config.preflightConfig,
      tenantPolicyManager: this.tenantPolicyManager,
    });
    this.jevClient = config.jevClient ?? new JevClient(config.jevConfig);
    this.approvalGate =
      config.approvalGate ??
      new MutationApprovalGate({
        tenantPolicyManager: this.tenantPolicyManager,
      });
    this.tracer = config.tracer;
    this.decisionCache = config.decisionCache;
    this.fastPathCompiler = config.fastPathCompiler;
    this.hostToolProxy =
      config.hostToolProxy ??
      new HostToolProxy({
        policyEngine: this.policyEngine,
        tenantPolicyManager: this.tenantPolicyManager,
        tracer: this.tracer,
      });
    this.sandboxExecutor = new SandboxExecutor(this.hostToolProxy);
    this.verificationEngine =
      config.verificationEngine ??
      new VerificationEngine({ semanticEvaluator: config.semanticEvaluator });
    this.fastPathHandlers = new Map(
      Object.entries(config.fastPathHandlers ?? {})
    );
    this.codeSynthesizer = config.codeSynthesizer;
    this.codeSynthesisProvider = config.codeSynthesisProvider;
    this.ledgerSigner = config.ledgerSigner;
    this.ledgerStore = config.ledgerStore;
  }

  public getDecisionCache(): DecisionCache | undefined {
    return this.decisionCache;
  }

  public getFastPathCompiler(): FastPathCompiler | undefined {
    return this.fastPathCompiler;
  }

  public getTenantPolicyManager(): TenantPolicyManager | undefined {
    return this.tenantPolicyManager;
  }

  public getTracer(): IReflexTracer | undefined {
    return this.tracer;
  }

  public getApprovalGate(): MutationApprovalGate {
    return this.approvalGate;
  }

  public getHostToolProxy(): HostToolProxy {
    return this.hostToolProxy;
  }

  public registerFastPath(key: string, handler: FastPathHandler): void {
    this.fastPathHandlers.set(key, handler);
  }

  public async run<TOutput = unknown>(
    contextInput: TaskContext,
    options: RunOptions = {}
  ): Promise<ReflexExecutionResult<TOutput>> {
    const runStartTime = performance.now();
    const tracer = options.tracer ?? this.tracer;
    const rootSpan = tracer?.startSpan(SpanNames.TASK, {
      attributes: {
        [SpanAttributesKeys.TASK_ID]: contextInput.taskId,
        [SpanAttributesKeys.TASK_ENVIRONMENT]: contextInput.environment,
        [SpanAttributesKeys.TASK_CALLER_ROLE]: contextInput.callerRole,
      },
    });

    if (tracer) {
      this.hostToolProxy.setTracer(tracer);
    }

    const fsm = new ExecutionStateMachine();
    const ledgerBuilder = new EvidenceLedgerBuilder(contextInput.taskId);
    const isExplicitlyApproved = Boolean(
      options.approvalId && this.approvalGate.isApproved(options.approvalId)
    );
    this.hostToolProxy.setTaskContext(contextInput, isExplicitlyApproved);
    this.hostToolProxy.clearEvidenceLog();

    let decisionDurationMs = 0;
    let executionDurationMs = 0;
    let verificationDurationMs = 0;
    let decisionInputTokens = 0;
    let decisionOutputTokens = 0;
    let codeGenInputTokens = 0;
    let codeGenOutputTokens = 0;

    let routeTaken: ReflexRoute = 'FALLBACK';
    let output: TOutput | undefined;
    let errorMessage: string | undefined;

    // ─────────────────────────────────────────────────────────────
    // 1. DETERMINISTIC PREFLIGHT
    // ─────────────────────────────────────────────────────────────
    const preflightStart = performance.now();
    const preflightSpan = tracer?.startSpan(SpanNames.PREFLIGHT, {
      parentSpanId: rootSpan?.spanId,
    });

    const preflightResult = await this.preflightValidator.validate(contextInput);
    const preflightDurationMs = performance.now() - preflightStart;

    if (preflightSpan) {
      preflightSpan.setAttributes({
        [SpanAttributesKeys.PREFLIGHT_PASSED]: preflightResult.passed,
        [SpanAttributesKeys.PREFLIGHT_ERROR_CODE]: preflightResult.errorCode ?? '',
        [SpanAttributesKeys.PREFLIGHT_DURATION_MS]: Math.round(preflightDurationMs),
      });
      preflightSpan.setStatus(
        preflightResult.passed ? 'OK' : 'ERROR',
        preflightResult.violationReason
      );
      preflightSpan.end();
    }

    if (!preflightResult.passed) {
      fsm.transition(
        'BLOCKED_BY_POLICY',
        preflightResult.violationReason,
        { errorCode: preflightResult.errorCode }
      );

      if (rootSpan) {
        rootSpan.setAttributes({
          [SpanAttributesKeys.TASK_STATUS]: 'BLOCKED_BY_POLICY',
          [SpanAttributesKeys.TASK_ROUTE]: 'BLOCK',
        });
        rootSpan.setStatus('ERROR', preflightResult.violationReason);
        rootSpan.end();
        await tracer?.flush();
      }

      const totalDurationMs = performance.now() - runStartTime;
      return {
        taskId: contextInput.taskId,
        status: 'BLOCKED_BY_POLICY',
        routeTaken: 'BLOCK',
        error: preflightResult.violationReason,
        evidence: ledgerBuilder.build(),
        metrics: {
          totalDurationMs,
          decisionDurationMs: 0,
          executionDurationMs: 0,
          verificationDurationMs: 0,
          estimatedCostUsd: 0,
          tokensUsed: {
            decisionInputTokens: 0,
            decisionOutputTokens: 0,
            codeGenInputTokens: 0,
            codeGenOutputTokens: 0,
          },
        },
      };
    }

    // Preflight passed -> check FastPathCompiler or proceed to Jev Decision
    const decisionCache = options.decisionCache ?? this.decisionCache;
    const fastPathCompiler = options.fastPathCompiler ?? this.fastPathCompiler;

    if (fastPathCompiler) {
      const fastPathResult = await fastPathCompiler.execute(contextInput);
      if (fastPathResult.matched) {
        fsm.transition(
          'FAST_PATH_EXEC',
          `Fast path rule matched: ${fastPathResult.ruleId ?? 'default'}`
        );
        output = fastPathResult.output as TOutput;
        executionDurationMs = fastPathResult.durationMs;
        fsm.transition('VERIFICATION', 'Fast path output produced');

        const verifyStart = performance.now();
        const toolCalls = this.hostToolProxy.getEvidenceLog();
        ledgerBuilder.addToolCalls(toolCalls);

        const verificationResult = await this.verificationEngine.verify(
          contextInput,
          output,
          toolCalls,
          options.verificationContract
        );
        verificationDurationMs = performance.now() - verifyStart;

        for (const check of verificationResult.checks) {
          ledgerBuilder.addPostconditionCheck(check);
        }

        let finalEvidence = ledgerBuilder.build();
        if (this.ledgerSigner) {
          finalEvidence = this.ledgerSigner.signLedger(finalEvidence);
        }
        if (this.ledgerStore) {
          await this.ledgerStore.saveLedger(finalEvidence, verificationResult.status);
        }

        const terminalState = this.mapStatusToState(verificationResult.status);
        fsm.transition(terminalState, verificationResult.reason ?? 'Verification complete');

        if (rootSpan) {
          rootSpan.setAttributes({
            [SpanAttributesKeys.TASK_STATUS]: verificationResult.status,
            [SpanAttributesKeys.TASK_ROUTE]: 'FAST_PATH',
          });
          rootSpan.setStatus('OK');
          rootSpan.end();
          await tracer?.flush();
        }

        const totalDurationMs = performance.now() - runStartTime;
        return {
          taskId: contextInput.taskId,
          status: verificationResult.status,
          routeTaken: 'FAST_PATH',
          output,
          evidence: finalEvidence,
          metrics: {
            totalDurationMs,
            decisionDurationMs: 0,
            executionDurationMs,
            verificationDurationMs,
            estimatedCostUsd: 0,
            tokensUsed: {
              decisionInputTokens: 0,
              decisionOutputTokens: 0,
              codeGenInputTokens: 0,
              codeGenOutputTokens: 0,
            },
          },
        };
      }
    }

    fsm.transition('JEV_DECISION', 'Preflight validation passed');

    // ─────────────────────────────────────────────────────────────
    // 2. JEV DECISION ENGINE
    // ─────────────────────────────────────────────────────────────
    const jevSpan = tracer?.startSpan(SpanNames.JEV_DECISION, {
      parentSpanId: rootSpan?.spanId,
    });

    let decisionBatch: JevDecisionBatch;
    if (decisionCache && decisionCache.has(contextInput)) {
      decisionBatch = decisionCache.get(contextInput)!;
      decisionDurationMs = decisionBatch.rawLatencyMs;
    } else {
      const jevStart = performance.now();
      decisionBatch = await this.jevClient.evaluate(contextInput);
      decisionDurationMs = performance.now() - jevStart;
      if (decisionCache) {
        decisionCache.set(contextInput, decisionBatch);
      }
    }

    if (decisionBatch.tokenUsage) {
      decisionInputTokens = decisionBatch.tokenUsage.inputTokens;
      decisionOutputTokens = decisionBatch.tokenUsage.outputTokens;
    }

    // Evaluate authoritative policy over Jev proposal
    const policyResolution = await this.policyEngine.evaluateJevDecision(
      contextInput,
      decisionBatch
    );

    routeTaken = policyResolution.effectiveRoute;

    if (jevSpan) {
      const totalTokens = decisionInputTokens + decisionOutputTokens;
      jevSpan.setAttributes({
        [SpanAttributesKeys.JEV_ROUTE]: routeTaken,
        [SpanAttributesKeys.JEV_CONFIDENCE]: decisionBatch.route.confidence,
        [SpanAttributesKeys.JEV_COMPLEXITY]: decisionBatch.complexityScore.score,
        [SpanAttributesKeys.JEV_MUTATION_REQUIRED]:
          decisionBatch.requiresMutation.willMutateState,
        [SpanAttributesKeys.JEV_TOKENS]: totalTokens,
      });
      jevSpan.setStatus(routeTaken === 'BLOCK' ? 'ERROR' : 'OK');
      jevSpan.end();
    }

    // ─────────────────────────────────────────────────────────────
    // 3. ROUTE RESOLUTION
    // ─────────────────────────────────────────────────────────────

    // Route: BLOCK
    if (routeTaken === 'BLOCK') {
      fsm.transition(
        'BLOCKED_BY_POLICY',
        policyResolution.overrideReason ?? 'Policy engine rejected action',
        { flaggedRules: policyResolution.flaggedRules }
      );

      if (rootSpan) {
        rootSpan.setAttributes({
          [SpanAttributesKeys.TASK_STATUS]: 'BLOCKED_BY_POLICY',
          [SpanAttributesKeys.TASK_ROUTE]: 'BLOCK',
        });
        rootSpan.setStatus('ERROR', policyResolution.overrideReason ?? 'Blocked by policy');
        rootSpan.end();
        await tracer?.flush();
      }

      const totalDurationMs = performance.now() - runStartTime;
      return {
        taskId: contextInput.taskId,
        status: 'BLOCKED_BY_POLICY',
        routeTaken: 'BLOCK',
        error: policyResolution.overrideReason ?? 'Blocked by policy',
        evidence: ledgerBuilder.build(),
        metrics: {
          totalDurationMs,
          decisionDurationMs,
          executionDurationMs: 0,
          verificationDurationMs: 0,
          estimatedCostUsd: this.calculateCost(decisionInputTokens, decisionOutputTokens, 0, 0),
          tokensUsed: {
            decisionInputTokens,
            decisionOutputTokens,
            codeGenInputTokens: 0,
            codeGenOutputTokens: 0,
          },
        },
      };
    }

    // Route: ASK_USER
    if (routeTaken === 'ASK_USER') {
      if (isExplicitlyApproved) {
        // Approved mutation proceeds to CODE_MODE
        routeTaken = 'CODE_MODE';
      } else {
        const approvalReason = policyResolution.overrideReason ?? 'User confirmation required';
        const approvalRequest = this.approvalGate.createRequest(
          contextInput,
          decisionBatch.route.selected,
          decisionBatch.requiresMutation.willMutateState,
          approvalReason
        );

        fsm.transition('HUMAN_REVIEW', approvalReason, {
          flaggedRules: policyResolution.flaggedRules,
          approvalId: approvalRequest.approvalId,
        });

        if (rootSpan) {
          rootSpan.setAttributes({
            [SpanAttributesKeys.TASK_STATUS]: 'NEEDS_HUMAN_REVIEW',
            [SpanAttributesKeys.TASK_ROUTE]: 'ASK_USER',
          });
          rootSpan.setStatus('OK', approvalReason);
          rootSpan.end();
          await tracer?.flush();
        }

        const totalDurationMs = performance.now() - runStartTime;
        return {
          taskId: contextInput.taskId,
          status: 'NEEDS_HUMAN_REVIEW',
          routeTaken: 'ASK_USER',
          error: approvalReason,
          approvalId: approvalRequest.approvalId,
          evidence: ledgerBuilder.build(),
          metrics: {
            totalDurationMs,
            decisionDurationMs,
            executionDurationMs: 0,
            verificationDurationMs: 0,
            estimatedCostUsd: this.calculateCost(decisionInputTokens, decisionOutputTokens, 0, 0),
            tokensUsed: {
              decisionInputTokens,
              decisionOutputTokens,
              codeGenInputTokens: 0,
              codeGenOutputTokens: 0,
            },
          },
        };
      }
    }

    // Route: FALLBACK
    if (routeTaken === 'FALLBACK') {
      fsm.transition('SYSTEM_FALLBACK', 'System fallback triggered');

      if (rootSpan) {
        rootSpan.setAttributes({
          [SpanAttributesKeys.TASK_STATUS]: 'SYSTEM_FALLBACK',
          [SpanAttributesKeys.TASK_ROUTE]: 'FALLBACK',
        });
        rootSpan.setStatus('ERROR', 'System fallback executed');
        rootSpan.end();
        await tracer?.flush();
      }

      const totalDurationMs = performance.now() - runStartTime;
      return {
        taskId: contextInput.taskId,
        status: 'SYSTEM_FALLBACK',
        routeTaken: 'FALLBACK',
        error: 'System fallback executed',
        evidence: ledgerBuilder.build(),
        metrics: {
          totalDurationMs,
          decisionDurationMs,
          executionDurationMs: 0,
          verificationDurationMs: 0,
          estimatedCostUsd: this.calculateCost(decisionInputTokens, decisionOutputTokens, 0, 0),
          tokensUsed: {
            decisionInputTokens,
            decisionOutputTokens,
            codeGenInputTokens: 0,
            codeGenOutputTokens: 0,
          },
        },
      };
    }

    // Route: FAST_PATH
    if (routeTaken === 'FAST_PATH') {
      fsm.transition('FAST_PATH_EXEC', 'Dispatching to registered fast path function');
      const execStart = performance.now();

      try {
        const handler =
          this.fastPathHandlers.get(contextInput.task) ??
          this.fastPathHandlers.get('default');

        if (handler) {
          output = (await handler(contextInput)) as TOutput;
        } else {
          // Default deterministic echo/output
          output = { message: `Fast path resolved for ${contextInput.task}` } as TOutput;
        }

        executionDurationMs = performance.now() - execStart;
        fsm.transition('VERIFICATION', 'Fast path output produced');
      } catch (err: unknown) {
        executionDurationMs = performance.now() - execStart;
        errorMessage = err instanceof Error ? err.message : String(err);
        fsm.transition('EXECUTION_FAILED', errorMessage);

        if (rootSpan) {
          rootSpan.setAttributes({
            [SpanAttributesKeys.TASK_STATUS]: 'EXECUTION_FAILED',
            [SpanAttributesKeys.TASK_ROUTE]: 'FAST_PATH',
          });
          rootSpan.setStatus('ERROR', errorMessage);
          rootSpan.end();
          await tracer?.flush();
        }

        const totalDurationMs = performance.now() - runStartTime;
        return {
          taskId: contextInput.taskId,
          status: 'EXECUTION_FAILED',
          routeTaken: 'FAST_PATH',
          error: errorMessage,
          evidence: ledgerBuilder.build(),
          metrics: {
            totalDurationMs,
            decisionDurationMs,
            executionDurationMs,
            verificationDurationMs: 0,
            estimatedCostUsd: this.calculateCost(decisionInputTokens, decisionOutputTokens, 0, 0),
            tokensUsed: {
              decisionInputTokens,
              decisionOutputTokens,
              codeGenInputTokens: 0,
              codeGenOutputTokens: 0,
            },
          },
        };
      }
    }

    // Route: CODE_MODE
    if (routeTaken === 'CODE_MODE') {
      fsm.transition('CODE_MODE_SYNTH', 'Synthesizing orchestration program');

      let scriptToRun = options.script;
      if (!scriptToRun && this.codeSynthesisProvider) {
        const synthResult = await this.codeSynthesisProvider.synthesizeProgram({
          task: contextInput.task,
          availableTools: Array.from(this.hostToolProxy.getMcpDiscovery().listTools()),
          context: {
            environment: contextInput.environment,
            callerRole: contextInput.callerRole,
          },
        });
        scriptToRun = synthResult.code;
        codeGenInputTokens = synthResult.tokenUsage.inputTokens;
        codeGenOutputTokens = synthResult.tokenUsage.outputTokens;
      } else if (!scriptToRun && this.codeSynthesizer) {
        scriptToRun = await this.codeSynthesizer(contextInput);
        codeGenInputTokens = 120;
        codeGenOutputTokens = 85;
      }

      if (!scriptToRun) {
        scriptToRun = `return { status: "success", executed: "${contextInput.task}" };`;
      }

      fsm.transition('CODE_MODE_EXEC', 'Executing script in Cloudflare sandbox');
      const sandboxSpan = tracer?.startSpan(SpanNames.CODEMODE_SANDBOX, {
        parentSpanId: rootSpan?.spanId,
      });

      const execStart = performance.now();

      const sandboxResult = await this.sandboxExecutor.executeScript(
        scriptToRun,
        {
          context: contextInput,
          timeoutMs: options.timeoutMs,
        }
      );
      executionDurationMs = performance.now() - execStart;

      ledgerBuilder.addSandboxLogs(sandboxResult.logs);

      if (sandboxSpan) {
        sandboxSpan.setAttributes({
          [SpanAttributesKeys.SANDBOX_WALL_TIME_MS]: Math.round(executionDurationMs),
          [SpanAttributesKeys.SANDBOX_TOOL_COUNT]: this.hostToolProxy.getEvidenceLog().length,
          [SpanAttributesKeys.SANDBOX_LOGS_COUNT]: sandboxResult.logs.length,
        });
        sandboxSpan.setStatus(sandboxResult.success ? 'OK' : 'ERROR', sandboxResult.error);
        sandboxSpan.end();
      }

      if (!sandboxResult.success) {
        errorMessage = sandboxResult.error ?? 'Sandbox runtime error';
        fsm.transition('EXECUTION_FAILED', errorMessage);

        if (rootSpan) {
          rootSpan.setAttributes({
            [SpanAttributesKeys.TASK_STATUS]: 'EXECUTION_FAILED',
            [SpanAttributesKeys.TASK_ROUTE]: 'CODE_MODE',
          });
          rootSpan.setStatus('ERROR', errorMessage);
          rootSpan.end();
          await tracer?.flush();
        }

        const totalDurationMs = performance.now() - runStartTime;
        ledgerBuilder.addToolCalls(this.hostToolProxy.getEvidenceLog());

        return {
          taskId: contextInput.taskId,
          status: 'EXECUTION_FAILED',
          routeTaken: 'CODE_MODE',
          error: errorMessage,
          evidence: ledgerBuilder.build(),
          metrics: {
            totalDurationMs,
            decisionDurationMs,
            executionDurationMs,
            verificationDurationMs: 0,
            estimatedCostUsd: this.calculateCost(
              decisionInputTokens,
              decisionOutputTokens,
              codeGenInputTokens,
              codeGenOutputTokens
            ),
            tokensUsed: {
              decisionInputTokens,
              decisionOutputTokens,
              codeGenInputTokens,
              codeGenOutputTokens,
            },
          },
        };
      }

      output = sandboxResult.returnValue as TOutput;
      fsm.transition('VERIFICATION', 'Sandbox completed successfully');
    }

    // ─────────────────────────────────────────────────────────────
    // 4. VERIFICATION ENGINE
    // ─────────────────────────────────────────────────────────────
    const verifyStart = performance.now();
    const toolCalls = this.hostToolProxy.getEvidenceLog();
    ledgerBuilder.addToolCalls(toolCalls);

    const verificationResult = await this.verificationEngine.verify(
      contextInput,
      output,
      toolCalls,
      options.verificationContract
    );
    verificationDurationMs = performance.now() - verifyStart;

    for (const check of verificationResult.checks) {
      ledgerBuilder.addPostconditionCheck(check);
    }

    // Emit verification spans
    if (tracer) {
      const layer1Checks = verificationResult.checks.filter(
        (c) => c.layer === 'DETERMINISTIC'
      );
      if (layer1Checks.length > 0) {
        const l1Passed = layer1Checks.every((c) => c.passed);
        const l1Span = tracer.startSpan(SpanNames.VERIFY_LAYER1, {
          parentSpanId: rootSpan?.spanId,
        });
        l1Span.setAttributes({
          [SpanAttributesKeys.VERIFY_PASSED]: l1Passed,
          [SpanAttributesKeys.VERIFY_CHECKS_COUNT]: layer1Checks.length,
        });
        l1Span.setStatus(l1Passed ? 'OK' : 'ERROR');
        l1Span.end();
      }

      const layer2Checks = verificationResult.checks.filter(
        (c) => c.layer === 'READ_AFTER_WRITE'
      );
      for (const c2 of layer2Checks) {
        const l2Span = tracer.startSpan(SpanNames.VERIFY_LAYER2, {
          parentSpanId: rootSpan?.spanId,
        });
        l2Span.setAttributes({
          [SpanAttributesKeys.VERIFY_TARGET_RESOURCE]: c2.target,
          [SpanAttributesKeys.VERIFY_SETTLED_VIA]: 'direct_read',
          [SpanAttributesKeys.VERIFY_POLL_ATTEMPTS]: 1,
        });
        l2Span.setStatus(c2.passed ? 'OK' : 'ERROR', c2.reason);
        l2Span.end();
      }

      const layer3Checks = verificationResult.checks.filter(
        (c) => c.layer === 'SEMANTIC'
      );
      for (const c3 of layer3Checks) {
        const l3Span = tracer.startSpan(SpanNames.VERIFY_LAYER3, {
          parentSpanId: rootSpan?.spanId,
        });
        l3Span.setAttributes({
          [SpanAttributesKeys.VERIFY_JUDGMENT]: Boolean(c3.passed),
          [SpanAttributesKeys.VERIFY_PROBABILITY]: 0.95,
        });
        l3Span.setStatus(c3.passed ? 'OK' : 'ERROR', c3.reason);
        l3Span.end();
      }
    }

    let finalEvidence = ledgerBuilder.build();
    if (this.ledgerSigner) {
      finalEvidence = this.ledgerSigner.signLedger(finalEvidence);
    }
    if (this.ledgerStore) {
      await this.ledgerStore.saveLedger(finalEvidence, verificationResult.status);
    }

    // Map verification status to FSM terminal state
    const terminalState = this.mapStatusToState(verificationResult.status);
    fsm.transition(terminalState, verificationResult.reason ?? 'Verification complete');

    if (rootSpan) {
      rootSpan.setAttributes({
        [SpanAttributesKeys.TASK_STATUS]: verificationResult.status,
        [SpanAttributesKeys.TASK_ROUTE]: routeTaken,
      });
      const isSuccess =
        verificationResult.status === 'VERIFIED_SUCCESS' ||
        verificationResult.status === 'UNVERIFIED_SUCCESS';
      rootSpan.setStatus(
        isSuccess ? 'OK' : 'ERROR',
        verificationResult.reason ?? errorMessage
      );
      rootSpan.end();
      await tracer?.flush();
    }

    const totalDurationMs = performance.now() - runStartTime;

    return {
      taskId: contextInput.taskId,
      status: verificationResult.status,
      routeTaken,
      output,
      error: verificationResult.reason ?? errorMessage,
      evidence: finalEvidence,
      metrics: {
        totalDurationMs,
        decisionDurationMs,
        executionDurationMs,
        verificationDurationMs,
        estimatedCostUsd: this.calculateCost(
          decisionInputTokens,
          decisionOutputTokens,
          codeGenInputTokens,
          codeGenOutputTokens
        ),
        tokensUsed: {
          decisionInputTokens,
          decisionOutputTokens,
          codeGenInputTokens,
          codeGenOutputTokens,
        },
      },
    };
  }

  private mapStatusToState(
    status: VerificationStatus
  ): 'VERIFIED_SUCCESS' | 'UNVERIFIED_SUCCESS' | 'VERIFICATION_FAILED' | 'EXECUTION_FAILED' {
    switch (status) {
      case 'VERIFIED_SUCCESS':
        return 'VERIFIED_SUCCESS';
      case 'UNVERIFIED_SUCCESS':
        return 'UNVERIFIED_SUCCESS';
      case 'VERIFICATION_FAILED':
        return 'VERIFICATION_FAILED';
      default:
        return 'EXECUTION_FAILED';
    }
  }

  private calculateCost(
    decIn: number,
    decOut: number,
    codeIn: number,
    codeOut: number
  ): number {
    // $0.15 per 1M input tokens, $0.60 per 1M output tokens for Jev / small models
    // $3.00 per 1M input tokens, $15.00 per 1M output tokens for code-gen LLM
    const jevCost = (decIn * 0.15 + decOut * 0.6) / 1_000_000;
    const codeCost = (codeIn * 3.0 + codeOut * 15.0) / 1_000_000;
    return Math.round((jevCost + codeCost) * 100_000) / 100_000;
  }
}
