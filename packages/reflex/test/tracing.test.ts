import { describe, expect, it } from 'vitest';
import {
  InMemoryTraceExporter,
  ReflexTracer,
  SpanNames,
  SpanAttributesKeys,
  type TaskContext,
} from '@reflex-ai/core';
import { ReflexAgent } from '../src/index.js';

describe('End-to-End OpenTelemetry Tracing Integration (@reflex-ai/reflex)', () => {
  it('records full hierarchical lifecycle spans during Code Mode execution and verification', async () => {
    const exporter = new InMemoryTraceExporter();
    const tracer = new ReflexTracer({ exporter });

    const agent = new ReflexAgent({ tracer });

    agent.registerTool({
      name: 'deployments.list',
      isMutation: false,
      handler: async () => ({
        httpStatus: 200,
        data: [{ id: 'dep_1', traffic: 0 }],
      }),
    });

    const context: TaskContext = {
      taskId: 'trace_test_01',
      task: 'List deployments and filter inactive',
      environment: 'development',
      callerRole: 'developer',
      availableTools: ['deployments.list'],
    };

    const script = `
      const deps = await mcp.deployments.list({});
      return { success: true, count: deps.length };
    `;

    const result = await agent.run(context, { script });
    expect(result.status).toBe('VERIFIED_SUCCESS');

    const finishedSpans = exporter.getFinishedSpans();
    const spanNames = finishedSpans.map((s) => s.name);

    // Root span
    expect(spanNames).toContain(SpanNames.TASK);
    const rootSpan = finishedSpans.find((s) => s.name === SpanNames.TASK);
    expect(rootSpan?.attributes[SpanAttributesKeys.TASK_ID]).toBe('trace_test_01');
    expect(rootSpan?.attributes[SpanAttributesKeys.TASK_STATUS]).toBe('VERIFIED_SUCCESS');

    // Preflight span
    expect(spanNames).toContain(SpanNames.PREFLIGHT);
    const preflightSpan = finishedSpans.find((s) => s.name === SpanNames.PREFLIGHT);
    expect(preflightSpan?.parentSpanId).toBe(rootSpan?.spanId);
    expect(preflightSpan?.attributes[SpanAttributesKeys.PREFLIGHT_PASSED]).toBe(true);

    // Jev Decision span
    expect(spanNames).toContain(SpanNames.JEV_DECISION);
    const jevSpan = finishedSpans.find((s) => s.name === SpanNames.JEV_DECISION);
    expect(jevSpan?.parentSpanId).toBe(rootSpan?.spanId);
    expect(jevSpan?.attributes[SpanAttributesKeys.JEV_ROUTE]).toBeDefined();

    // Code Mode Sandbox span
    expect(spanNames).toContain(SpanNames.CODEMODE_SANDBOX);
    const sandboxSpan = finishedSpans.find((s) => s.name === SpanNames.CODEMODE_SANDBOX);
    expect(sandboxSpan?.parentSpanId).toBe(rootSpan?.spanId);
    expect(sandboxSpan?.attributes[SpanAttributesKeys.SANDBOX_TOOL_COUNT]).toBe(1);

    // Tool Proxy span
    const toolSpan = finishedSpans.find((s) => s.name === `${SpanNames.TOOL_PREFIX}deployments.list`);
    expect(toolSpan).toBeDefined();
    expect(toolSpan?.attributes[SpanAttributesKeys.TOOL_NAME]).toBe('deployments.list');
    expect(toolSpan?.attributes[SpanAttributesKeys.TOOL_IS_MUTATION]).toBe(false);
    expect(toolSpan?.attributes[SpanAttributesKeys.TOOL_HTTP_STATUS]).toBe(200);

    // Layer 1 Verification span
    expect(spanNames).toContain(SpanNames.VERIFY_LAYER1);
    const layer1Span = finishedSpans.find((s) => s.name === SpanNames.VERIFY_LAYER1);
    expect(layer1Span?.parentSpanId).toBe(rootSpan?.spanId);
    expect(layer1Span?.attributes[SpanAttributesKeys.VERIFY_PASSED]).toBe(true);
  });
});
