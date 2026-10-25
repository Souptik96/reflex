import type {
  IReflexTracer,
  ITraceExporter,
  ReflexSpan,
  StartSpanOptions,
} from './types.js';
import { ReflexSpanImpl } from './span.js';

export interface ReflexTracerOptions {
  traceId?: string;
  exporter?: ITraceExporter;
}

export class ReflexTracer implements IReflexTracer {
  private readonly defaultTraceId?: string;
  private readonly exporter?: ITraceExporter;
  private readonly spanStack: ReflexSpan[] = [];
  private readonly finishedSpans: ReflexSpan[] = [];

  constructor(options: ReflexTracerOptions = {}) {
    this.defaultTraceId = options.traceId;
    this.exporter = options.exporter;
  }

  public getExporter(): ITraceExporter | undefined {
    return this.exporter;
  }

  public getActiveSpan(): ReflexSpan | undefined {
    return this.spanStack.length > 0
      ? this.spanStack[this.spanStack.length - 1]
      : undefined;
  }

  public startSpan(name: string, options: StartSpanOptions = {}): ReflexSpan {
    const parent = options.parentSpanId
      ? undefined
      : this.getActiveSpan();

    const parentSpanId = options.parentSpanId ?? parent?.spanId;
    const traceId =
      options.traceId ??
      parent?.traceId ??
      this.defaultTraceId;

    const span = new ReflexSpanImpl({
      name,
      traceId,
      parentSpanId,
      startTime: options.startTime,
      attributes: options.attributes,
      onEnd: (endedSpan) => {
        this.recordSpan(endedSpan);
      },
    });

    return span;
  }

  public async withSpan<T>(
    span: ReflexSpan,
    fn: () => Promise<T> | T
  ): Promise<T> {
    this.spanStack.push(span);
    try {
      const result = await fn();
      if (!span.isEnded()) {
        span.setStatus('OK');
        span.end();
      }
      return result;
    } catch (err: unknown) {
      if (!span.isEnded()) {
        const message = err instanceof Error ? err.message : String(err);
        span.setStatus('ERROR', message);
        span.end();
      }
      throw err;
    } finally {
      const index = this.spanStack.lastIndexOf(span);
      if (index !== -1) {
        this.spanStack.splice(index, 1);
      }
    }
  }

  public recordSpan(span: ReflexSpan): void {
    this.finishedSpans.push(span);
    if (this.exporter) {
      void this.exporter.export([span]);
    }
  }

  public async flush(): Promise<void> {
    // Spans are streamed to the exporter as they end
  }
}

export class NoopTracer implements IReflexTracer {
  public startSpan(name: string, options: StartSpanOptions = {}): ReflexSpan {
    return new ReflexSpanImpl({
      name,
      traceId: options.traceId,
      parentSpanId: options.parentSpanId,
      startTime: options.startTime,
      attributes: options.attributes,
    });
  }

  public getActiveSpan(): undefined {
    return undefined;
  }

  public async withSpan<T>(
    span: ReflexSpan,
    fn: () => Promise<T> | T
  ): Promise<T> {
    try {
      return await fn();
    } finally {
      if (!span.isEnded()) {
        span.end();
      }
    }
  }

  public recordSpan(): void {}

  public getExporter(): undefined {
    return undefined;
  }

  public async flush(): Promise<void> {}
}
