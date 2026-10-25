import { z } from 'zod';

export type SpanAttributeValue =
  | string
  | number
  | boolean
  | string[]
  | number[]
  | boolean[];

export type SpanAttributes = Record<string, SpanAttributeValue | undefined>;

export const SpanStatusSchema = z.enum(['UNSET', 'OK', 'ERROR']);
export type SpanStatus = z.infer<typeof SpanStatusSchema>;

export interface TraceEvent {
  name: string;
  timestamp: number;
  attributes?: SpanAttributes;
}

export interface ReflexSpan {
  readonly spanId: string;
  readonly traceId: string;
  readonly parentSpanId?: string;
  readonly name: string;
  readonly startTime: number;
  readonly endTime?: number;
  readonly durationMs?: number;
  readonly status: SpanStatus;
  readonly statusMessage?: string;
  readonly attributes: Readonly<SpanAttributes>;
  readonly events: readonly TraceEvent[];

  setAttribute(key: string, value: SpanAttributeValue): this;
  setAttributes(attrs: SpanAttributes): this;
  setStatus(status: SpanStatus, message?: string): this;
  addEvent(name: string, attributes?: SpanAttributes): this;
  end(endTime?: number): void;
  isEnded(): boolean;
}

export interface ITraceExporter {
  export(spans: readonly ReflexSpan[]): Promise<void> | void;
  shutdown(): Promise<void> | void;
}

export interface StartSpanOptions {
  parentSpanId?: string;
  attributes?: SpanAttributes;
  traceId?: string;
  startTime?: number;
}

export interface IReflexTracer {
  startSpan(name: string, options?: StartSpanOptions): ReflexSpan;
  getActiveSpan(): ReflexSpan | undefined;
  withSpan<T>(span: ReflexSpan, fn: () => Promise<T> | T): Promise<T>;
  recordSpan(span: ReflexSpan): void;
  getExporter(): ITraceExporter | undefined;
  flush(): Promise<void>;
}
