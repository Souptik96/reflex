import { describe, expect, it, vi } from 'vitest';
import {
  ConsoleJsonTraceExporter,
  InMemoryTraceExporter,
  NoopTracer,
  OtlpHttpTraceExporter,
  ReflexTracer,
  SpanNames,
  SpanAttributesKeys,
} from '../src/index.js';

describe('OpenTelemetry Tracing Framework (@reflex-ai/core)', () => {
  it('creates and records hierarchical spans in InMemoryTraceExporter', async () => {
    const exporter = new InMemoryTraceExporter();
    const tracer = new ReflexTracer({ exporter });

    const rootSpan = tracer.startSpan(SpanNames.TASK, {
      attributes: {
        [SpanAttributesKeys.TASK_ID]: 'test_task_123',
        [SpanAttributesKeys.TASK_ENVIRONMENT]: 'staging',
      },
    });

    await tracer.withSpan(rootSpan, async () => {
      const childSpan = tracer.startSpan(SpanNames.PREFLIGHT, {
        attributes: {
          [SpanAttributesKeys.PREFLIGHT_PASSED]: true,
          [SpanAttributesKeys.PREFLIGHT_DURATION_MS]: 4,
        },
      });
      childSpan.setStatus('OK');
      childSpan.end();
    });

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(2);

    const preflight = exporter.getSpanByName(SpanNames.PREFLIGHT);
    expect(preflight).toBeDefined();
    expect(preflight?.parentSpanId).toBe(rootSpan.spanId);
    expect(preflight?.traceId).toBe(rootSpan.traceId);
    expect(preflight?.attributes[SpanAttributesKeys.PREFLIGHT_PASSED]).toBe(true);
    expect(preflight?.status).toBe('OK');

    const root = exporter.getSpanByName(SpanNames.TASK);
    expect(root).toBeDefined();
    expect(root?.parentSpanId).toBeUndefined();
    expect(root?.attributes[SpanAttributesKeys.TASK_ID]).toBe('test_task_123');
    expect(root?.status).toBe('OK');
  });

  it('handles span error statuses and events', () => {
    const exporter = new InMemoryTraceExporter();
    const tracer = new ReflexTracer({ exporter });

    const span = tracer.startSpan('test.span');
    span.addEvent('cache_miss', { key: 'sample' });
    span.setStatus('ERROR', 'Connection timed out');
    span.end();

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    expect(spans[0]?.status).toBe('ERROR');
    expect(spans[0]?.statusMessage).toBe('Connection timed out');
    expect(spans[0]?.events).toHaveLength(1);
    expect(spans[0]?.events[0]?.name).toBe('cache_miss');
  });

  it('NoopTracer operates without side effects', async () => {
    const tracer = new NoopTracer();
    const span = tracer.startSpan('noop.span');
    expect(tracer.getActiveSpan()).toBeUndefined();
    expect(tracer.getExporter()).toBeUndefined();

    const res = await tracer.withSpan(span, () => 42);
    expect(res).toBe(42);
  });

  it('ConsoleJsonTraceExporter formats spans as JSON', () => {
    const logs: string[] = [];
    const exporter = new ConsoleJsonTraceExporter({
      logger: (msg) => logs.push(msg),
    });

    const tracer = new ReflexTracer({ exporter });
    const span = tracer.startSpan('console.test');
    span.setAttribute('test.attr', 99);
    span.end();

    expect(logs).toHaveLength(1);
    const parsed = JSON.parse(logs[0] ?? '{}') as { name: string; attributes: { 'test.attr': number } };
    expect(parsed.name).toBe('console.test');
    expect(parsed.attributes['test.attr']).toBe(99);
  });

  it('OtlpHttpTraceExporter converts spans to standard OTLP JSON and dispatches via HTTP POST', async () => {
    let capturedUrl: string | undefined;
    let capturedBody: string | undefined;

    const mockFetch = vi.fn().mockImplementation(async (url: string | URL, init?: RequestInit) => {
      capturedUrl = String(url);
      capturedBody = init?.body as string;
      return new Response(JSON.stringify({ status: 'ok' }), { status: 200 });
    });

    const exporter = new OtlpHttpTraceExporter({
      url: 'https://otel-collector.internal/v1/traces',
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    const tracer = new ReflexTracer({ exporter });
    const span = tracer.startSpan(SpanNames.TASK, {
      attributes: {
        [SpanAttributesKeys.TASK_ID]: 'task_otlp_01',
        is_active: true,
        count: 5,
      },
    });
    span.end();

    await tracer.flush();

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(capturedUrl).toBe('https://otel-collector.internal/v1/traces');
    expect(capturedBody).toBeDefined();

    const parsed = JSON.parse(capturedBody ?? '{}') as {
      resourceSpans: Array<{
        scopeSpans: Array<{
          spans: Array<{ name: string; attributes: Array<{ key: string; value: unknown }> }>;
        }>;
      }>;
    };

    const exportedSpans = parsed.resourceSpans[0]?.scopeSpans[0]?.spans;
    expect(exportedSpans).toHaveLength(1);
    expect(exportedSpans?.[0]?.name).toBe(SpanNames.TASK);
  });
});
