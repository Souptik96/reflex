import type { ITraceExporter, ReflexSpan, SpanAttributeValue } from './types.js';

export class InMemoryTraceExporter implements ITraceExporter {
  private finishedSpans: ReflexSpan[] = [];

  public export(spans: readonly ReflexSpan[]): void {
    this.finishedSpans.push(...spans);
  }

  public getFinishedSpans(): ReflexSpan[] {
    return [...this.finishedSpans];
  }

  public getSpanByName(name: string): ReflexSpan | undefined {
    return this.finishedSpans.find((s) => s.name === name);
  }

  public getSpansByName(name: string): ReflexSpan[] {
    return this.finishedSpans.filter((s) => s.name === name);
  }

  public reset(): void {
    this.finishedSpans = [];
  }

  public shutdown(): void {
    this.reset();
  }
}

export interface ConsoleJsonTraceExporterOptions {
  logger?: (msg: string) => void;
  pretty?: boolean;
}

export class ConsoleJsonTraceExporter implements ITraceExporter {
  private readonly logger: (msg: string) => void;
  private readonly pretty: boolean;

  constructor(options: ConsoleJsonTraceExporterOptions = {}) {
    this.logger = options.logger ?? ((msg: string) => process.stdout.write(`${msg}\n`));
    this.pretty = options.pretty ?? false;
  }

  public export(spans: readonly ReflexSpan[]): void {
    for (const span of spans) {
      const serialized = {
        name: span.name,
        traceId: span.traceId,
        spanId: span.spanId,
        parentSpanId: span.parentSpanId,
        startTime: span.startTime,
        endTime: span.endTime,
        durationMs: span.durationMs,
        status: span.status,
        statusMessage: span.statusMessage,
        attributes: span.attributes,
        events: span.events,
      };

      const out = this.pretty
        ? JSON.stringify(serialized, null, 2)
        : JSON.stringify(serialized);
      this.logger(out);
    }
  }

  public shutdown(): void {}
}

export interface OtlpHttpTraceExporterOptions {
  url: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
}

export class OtlpHttpTraceExporter implements ITraceExporter {
  private readonly url: string;
  private readonly headers: Record<string, string>;
  private readonly timeoutMs: number;
  private readonly fetchFn: typeof fetch;

  constructor(options: OtlpHttpTraceExporterOptions) {
    this.url = options.url;
    this.headers = {
      'Content-Type': 'application/json',
      ...options.headers,
    };
    this.timeoutMs = options.timeoutMs ?? 5000;
    this.fetchFn = options.fetchFn ?? fetch;
  }

  public async export(spans: readonly ReflexSpan[]): Promise<void> {
    if (spans.length === 0) return;

    const otlpPayload = {
      resourceSpans: [
        {
          resource: {
            attributes: [
              { key: 'service.name', value: { stringValue: 'reflex-agent' } },
            ],
          },
          scopeSpans: [
            {
              scope: { name: '@reflex-ai/core', version: '0.1.0' },
              spans: spans.map((span) => ({
                traceId: span.traceId,
                spanId: span.spanId,
                parentSpanId: span.parentSpanId,
                name: span.name,
                startTimeUnixNano: String(span.startTime * 1_000_000),
                endTimeUnixNano: String((span.endTime ?? span.startTime) * 1_000_000),
                status: {
                  code: span.status === 'OK' ? 1 : span.status === 'ERROR' ? 2 : 0,
                  message: span.statusMessage,
                },
                attributes: Object.entries(span.attributes).map(([key, val]) => ({
                  key,
                  value: this.formatOtlpValue(val),
                })),
              })),
            },
          ],
        },
      ],
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      await this.fetchFn(this.url, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify(otlpPayload),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  private formatOtlpValue(val: SpanAttributeValue | undefined): Record<string, unknown> {
    if (typeof val === 'string') return { stringValue: val };
    if (typeof val === 'number') {
      return Number.isInteger(val) ? { intValue: String(val) } : { doubleValue: val };
    }
    if (typeof val === 'boolean') return { boolValue: val };
    if (Array.isArray(val)) {
      return {
        arrayValue: {
          values: val.map((item) => this.formatOtlpValue(item as SpanAttributeValue)),
        },
      };
    }
    return { stringValue: String(val) };
  }

  public async shutdown(): Promise<void> {}
}
