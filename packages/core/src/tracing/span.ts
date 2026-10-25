import { randomBytes } from 'node:crypto';
import type {
  ReflexSpan,
  SpanAttributes,
  SpanAttributeValue,
  SpanStatus,
  TraceEvent,
} from './types.js';

export interface CreateSpanParams {
  name: string;
  traceId?: string;
  parentSpanId?: string;
  startTime?: number;
  attributes?: SpanAttributes;
  onEnd?: (span: ReflexSpan) => void;
}

export class ReflexSpanImpl implements ReflexSpan {
  public readonly spanId: string;
  public readonly traceId: string;
  public readonly parentSpanId?: string;
  public readonly name: string;
  public readonly startTime: number;
  public endTime?: number;
  public durationMs?: number;
  public status: SpanStatus = 'UNSET';
  public statusMessage?: string;

  private readonly _attributes: Map<string, SpanAttributeValue> = new Map();
  private readonly _events: TraceEvent[] = [];
  private _ended: boolean = false;
  private readonly onEndCallback?: (span: ReflexSpan) => void;

  constructor(params: CreateSpanParams) {
    this.name = params.name;
    this.spanId = randomBytes(8).toString('hex');
    this.traceId = params.traceId ?? randomBytes(16).toString('hex');
    this.parentSpanId = params.parentSpanId;
    this.startTime = params.startTime ?? Date.now();
    this.onEndCallback = params.onEnd;

    if (params.attributes) {
      for (const [k, v] of Object.entries(params.attributes)) {
        if (v !== undefined) {
          this._attributes.set(k, v);
        }
      }
    }
  }

  public get attributes(): Readonly<SpanAttributes> {
    const obj: SpanAttributes = {};
    for (const [k, v] of this._attributes.entries()) {
      obj[k] = v;
    }
    return obj;
  }

  public get events(): readonly TraceEvent[] {
    return [...this._events];
  }

  public setAttribute(key: string, value: SpanAttributeValue): this {
    if (!this._ended) {
      this._attributes.set(key, value);
    }
    return this;
  }

  public setAttributes(attrs: SpanAttributes): this {
    if (!this._ended) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v !== undefined) {
          this._attributes.set(k, v);
        }
      }
    }
    return this;
  }

  public setStatus(status: SpanStatus, message?: string): this {
    if (!this._ended) {
      this.status = status;
      this.statusMessage = message;
    }
    return this;
  }

  public addEvent(name: string, attributes?: SpanAttributes): this {
    if (!this._ended) {
      this._events.push({
        name,
        timestamp: Date.now(),
        attributes,
      });
    }
    return this;
  }

  public end(endTime?: number): void {
    if (this._ended) return;
    this._ended = true;
    this.endTime = endTime ?? Date.now();
    this.durationMs = Math.max(0, this.endTime - this.startTime);

    if (this.status === 'UNSET') {
      this.status = 'OK';
    }

    if (this.onEndCallback) {
      this.onEndCallback(this);
    }
  }

  public isEnded(): boolean {
    return this._ended;
  }
}
