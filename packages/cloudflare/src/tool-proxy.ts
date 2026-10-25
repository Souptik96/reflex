import { randomUUID } from 'node:crypto';
import type { IReflexTracer, TaskContext, ToolInvocationEvidence, TenantPolicyManager } from '@reflex-ai/core';
import {
  PolicyEngine,
  IdempotencyManager,
  SpanNames,
  SpanAttributesKeys,
} from '@reflex-ai/core';
import { McpDiscoveryService } from './mcp-discovery.js';
import type {
  IHostToolProxy,
  ToolHandler,
  ToolInvocationResponse,
} from './types.js';

export interface HostToolProxyOptions {
  policyEngine?: PolicyEngine;
  mcpDiscovery?: McpDiscoveryService;
  idempotencyManager?: IdempotencyManager;
  tenantPolicyManager?: TenantPolicyManager;
  taskContext?: TaskContext;
  tracer?: IReflexTracer;
}

export class HostToolProxy implements IHostToolProxy {
  private readonly policyEngine: PolicyEngine;
  private readonly mcpDiscovery: McpDiscoveryService;
  private readonly idempotencyManager: IdempotencyManager;
  private readonly tenantPolicyManager?: TenantPolicyManager;
  private readonly toolHandlers = new Map<string, ToolHandler>();
  private readonly evidenceLog: ToolInvocationEvidence[] = [];
  private taskContext?: TaskContext;
  private isTaskApproved = false;
  private tracer?: IReflexTracer;

  constructor(options: HostToolProxyOptions = {}) {
    this.policyEngine = options.policyEngine ?? new PolicyEngine();
    this.mcpDiscovery = options.mcpDiscovery ?? new McpDiscoveryService();
    this.idempotencyManager = options.idempotencyManager ?? new IdempotencyManager();
    this.tenantPolicyManager = options.tenantPolicyManager;
    this.taskContext = options.taskContext;
    this.tracer = options.tracer;
  }

  public setTracer(tracer?: IReflexTracer): void {
    this.tracer = tracer;
  }

  public setTaskContext(context: TaskContext, isTaskApproved: boolean = false): void {
    this.taskContext = context;
    this.isTaskApproved = isTaskApproved;
  }

  public registerTool(
    name: string,
    isMutation: boolean,
    handler: ToolHandler,
    description: string = ''
  ): void {
    this.mcpDiscovery.registerTool({
      name,
      description,
      isMutation,
    });
    this.toolHandlers.set(name, handler);
  }

  public getEvidenceLog(): readonly ToolInvocationEvidence[] {
    return [...this.evidenceLog];
  }

  public getMcpDiscovery(): McpDiscoveryService {
    return this.mcpDiscovery;
  }

  public clearEvidenceLog(): void {
    this.evidenceLog.length = 0;
  }

  public async invokeTool(
    taskId: string,
    toolName: string,
    params: Record<string, unknown>
  ): Promise<ToolInvocationResponse> {
    const isMutation = this.mcpDiscovery.isMutation(toolName);
    const span = this.tracer?.startSpan(`${SpanNames.TOOL_PREFIX}${toolName}`, {
      attributes: {
        [SpanAttributesKeys.TOOL_NAME]: toolName,
        [SpanAttributesKeys.TOOL_IS_MUTATION]: isMutation,
      },
    });

    const res = await this.internalInvokeTool(taskId, toolName, params, isMutation);

    if (span) {
      span.setAttributes({
        [SpanAttributesKeys.TOOL_NAME]: toolName,
        [SpanAttributesKeys.TOOL_IS_MUTATION]: isMutation,
        [SpanAttributesKeys.TOOL_HTTP_STATUS]: res.httpStatus,
        [SpanAttributesKeys.TOOL_DURATION_MS]: Math.round(res.durationMs),
      });
      span.setStatus(res.success ? 'OK' : 'ERROR', res.error);
      span.end();
    }

    return res;
  }

  private async internalInvokeTool(
    taskId: string,
    toolName: string,
    params: Record<string, unknown>,
    isMutation: boolean
  ): Promise<ToolInvocationResponse> {
    const callId = `call_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const startTime = performance.now();

    const context: TaskContext = this.taskContext ?? {
      taskId,
      task: `Invoke tool ${toolName}`,
      environment: 'development',
      callerRole: 'developer',
      availableTools: this.mcpDiscovery.listToolNames(),
    };

    // 1. Ingress Filter: Check tool existence
    const handler = this.toolHandlers.get(toolName);
    if (!handler) {
      const durationMs = performance.now() - startTime;
      const error = `Tool '${toolName}' is not registered with HostToolProxy`;
      this.recordEvidence({
        callId,
        toolName,
        inputPayload: params,
        outputPayload: { error },
        isMutation,
        httpStatus: 404,
        latencyMs: durationMs,
      });

      return {
        callId,
        success: false,
        httpStatus: 404,
        error,
        isMutation,
        durationMs,
      };
    }

    // 2. Ingress Filter: Policy Engine Authorization Check
    const policyResult = await this.policyEngine.evaluateToolInvocation(
      context,
      toolName,
      params,
      isMutation
    );

    if (!policyResult.allowed) {
      if (this.isTaskApproved && policyResult.requiresHumanReview) {
        // Human reviewer already authorized this task, proceed with mutation
      } else {
        const durationMs = performance.now() - startTime;
        const httpStatus = policyResult.requiresHumanReview ? 401 : 403;
        const error = policyResult.violationReason ?? 'Blocked by policy';

        this.recordEvidence({
          callId,
          toolName,
          inputPayload: params,
          outputPayload: {
            error,
            flaggedRules: policyResult.flaggedRules,
          },
          isMutation,
          httpStatus,
          latencyMs: durationMs,
        });

        return {
          callId,
          success: false,
          httpStatus,
          error,
          isMutation,
          durationMs,
        };
      }
    }

    // 2B. Ingress Filter: Tenant Policy & Blast Radius Check
    if (this.tenantPolicyManager) {
      const tenantId = context.tenantId ?? (context.metadata?.['tenantId'] as string | undefined);
      if (tenantId) {
        const tenantResult = this.tenantPolicyManager.evaluateTenantPolicy(context, tenantId, {
          isMutation,
          toolName,
        });

        if (!tenantResult.allowed) {
          const durationMs = performance.now() - startTime;
          const httpStatus = tenantResult.blastRadiusExceeded ? 429 : 403;
          const error = tenantResult.reason ?? 'Blocked by tenant policy';

          this.recordEvidence({
            callId,
            toolName,
            inputPayload: params,
            outputPayload: {
              error,
              blastRadiusExceeded: tenantResult.blastRadiusExceeded,
              isFreezeWindowActive: tenantResult.isFreezeWindowActive,
            },
            isMutation,
            httpStatus,
            latencyMs: durationMs,
          });

          return {
            callId,
            success: false,
            httpStatus,
            error,
            isMutation,
            durationMs,
          };
        }

        if (isMutation) {
          const mutationRecord = this.tenantPolicyManager.recordMutation(tenantId, taskId);
          if (!mutationRecord.allowed) {
            const durationMs = performance.now() - startTime;
            const httpStatus = 429;
            const error = `Blast radius limit exceeded for tenant '${tenantId}': maximum ${mutationRecord.maxAllowed} mutating tool calls allowed per task`;

            this.recordEvidence({
              callId,
              toolName,
              inputPayload: params,
              outputPayload: { error, blastRadiusExceeded: true },
              isMutation,
              httpStatus,
              latencyMs: durationMs,
            });

            return {
              callId,
              success: false,
              httpStatus,
              error,
              isMutation,
              durationMs,
            };
          }
        }
      }
    }

    // 3. Idempotency Check for mutating calls
    const idempotencyKey = typeof params['idempotencyKey'] === 'string'
      ? (params['idempotencyKey'] as string)
      : undefined;

    if (idempotencyKey) {
      const reg = this.idempotencyManager.registerKey(idempotencyKey, taskId);
      if (reg.isDuplicate) {
        const durationMs = performance.now() - startTime;
        if (reg.existingRecord?.status === 'COMPLETED') {
          return {
            callId: `cached_${idempotencyKey}`,
            success: true,
            httpStatus: reg.existingRecord.httpStatus ?? 200,
            data: reg.existingRecord.result,
            isMutation,
            durationMs,
          };
        }

        const error = `Duplicate request detected for idempotency key: ${idempotencyKey} (status: ${reg.existingRecord?.status})`;
        this.recordEvidence({
          callId,
          toolName,
          inputPayload: params,
          outputPayload: { error },
          isMutation,
          httpStatus: 409,
          latencyMs: durationMs,
        });

        return {
          callId,
          success: false,
          httpStatus: 409,
          error,
          isMutation,
          durationMs,
        };
      }
    }

    // 4. Real Dispatch & Egress Capture
    try {
      const result = await handler(params, context);
      const durationMs = performance.now() - startTime;
      const httpStatus = result.httpStatus ?? 200;

      if (idempotencyKey) {
        if (httpStatus >= 200 && httpStatus < 300) {
          this.idempotencyManager.commitKey(idempotencyKey, result.data, httpStatus);
        } else {
          this.idempotencyManager.failKey(idempotencyKey, `HTTP ${httpStatus}`);
        }
      }

      const outputRecord = typeof result.data === 'object' && result.data !== null
        ? (result.data as Record<string, unknown>)
        : { value: result.data };

      this.recordEvidence({
        callId,
        toolName,
        inputPayload: params,
        outputPayload: outputRecord,
        isMutation,
        httpStatus,
        latencyMs: durationMs,
      });

      return {
        callId,
        success: httpStatus >= 200 && httpStatus < 300,
        httpStatus,
        data: result.data,
        isMutation,
        durationMs,
      };
    } catch (err: unknown) {
      const durationMs = performance.now() - startTime;
      const message = err instanceof Error ? err.message : 'Unknown tool error';

      if (idempotencyKey) {
        this.idempotencyManager.failKey(idempotencyKey, message);
      }

      this.recordEvidence({
        callId,
        toolName,
        inputPayload: params,
        outputPayload: { error: message },
        isMutation,
        httpStatus: 500,
        latencyMs: durationMs,
      });

      return {
        callId,
        success: false,
        httpStatus: 500,
        error: message,
        isMutation,
        durationMs,
      };
    }
  }

  private recordEvidence(item: {
    callId: string;
    toolName: string;
    inputPayload: Record<string, unknown>;
    outputPayload: Record<string, unknown>;
    isMutation: boolean;
    httpStatus: number;
    latencyMs: number;
  }): void {
    this.evidenceLog.push({
      callId: item.callId,
      toolName: item.toolName,
      inputPayload: item.inputPayload,
      outputPayload: item.outputPayload,
      isMutation: item.isMutation,
      httpStatus: item.httpStatus,
      timestamp: new Date().toISOString(),
      latencyMs: item.latencyMs,
    });
  }
}
