# OpenTelemetry Distributed Tracing & Observability

Reflex natively integrates **OpenTelemetry (OTel)** distributed tracing across the entire execution lifecycle. Every state machine transition, preflight check, Jev decision batch, sandbox isolate invocation, tool proxy RPC call, and postcondition verification check emits standardized semantic convention spans.

---

## 1. Span Hierarchy & Semantic Conventions

A typical Reflex execution generates a structured trace hierarchy:

```
reflex.task [Root Span: Task Lifecycle]
├── reflex.preflight [Deterministic schema, regex & RBAC validation]
├── reflex.jev.decision [Batched Decision Engine request]
├── reflex.codemode.synth [Generative program synthesis]
├── reflex.codemode.sandbox [Worker Isolate Execution]
│   ├── reflex.tool.deployments.list [Host boundary tool call]
│   └── reflex.tool.deployments.delete [Host boundary mutating tool call]
└── reflex.verify.layer2 [Authoritative Read-After-Write verification]
```

### Standard Semantic Attributes (`SpanAttributesKeys`)

| Attribute Key | Type | Description |
| :--- | :--- | :--- |
| `reflex.task.id` | string | Unique task execution identifier |
| `reflex.task.environment` | string | Environment (`development`, `staging`, `production`) |
| `reflex.task.caller_role` | string | Caller RBAC role (`admin`, `developer`, etc.) |
| `reflex.task.route` | string | Route selected (`FAST_PATH`, `CODE_MODE`, etc.) |
| `reflex.task.status` | string | Final verification status (`VERIFIED_SUCCESS`, etc.) |
| `reflex.preflight.passed` | boolean | Whether preflight validation succeeded |
| `reflex.preflight.error_code` | string | Error code on preflight rejection |
| `reflex.jev.confidence` | number | Decision route confidence score (0.0 to 1.0) |
| `reflex.jev.latency_ms` | number | Remote decision API network latency in ms |
| `reflex.tool.name` | string | MCP tool name invoked |
| `reflex.tool.is_mutation` | boolean | Whether tool performs state modifications |
| `reflex.tool.http_status` | number | HTTP status code returned by tool |
| `reflex.tool.duration_ms` | number | Execution duration of tool dispatch |
| `reflex.verify.status` | string | Tri-layer verification outcome |

---

## 2. Trace Exporters

Reflex provides three pluggable trace exporters:

### 1. `InMemoryTraceExporter`
Buffers spans in an in-memory queue for programmatic assertions and test fixtures:
```typescript
import { InMemoryTraceExporter, ReflexTracer } from '@reflex-ai/core';

const exporter = new InMemoryTraceExporter();
const tracer = new ReflexTracer({ exporter });
```

### 2. `ConsoleJsonTraceExporter`
Emits single-line JSON log events to `stdout` or `stderr` for ingestion by fluentd, Vector, or CloudWatch:
```typescript
import { ConsoleJsonTraceExporter, ReflexTracer } from '@reflex-ai/core';

const exporter = new ConsoleJsonTraceExporter();
const tracer = new ReflexTracer({ exporter });
```

### 3. `OtlpHttpTraceExporter`
Dispatches standard OTLP HTTP/protobuf spans directly to any enterprise telemetry collector (Datadog, Honeycomb, Grafana Tempo, SigNoz, Dynatrace):
```typescript
import { OtlpHttpTraceExporter, ReflexTracer } from '@reflex-ai/core';

const exporter = new OtlpHttpTraceExporter({
  endpoint: 'https://api.honeycomb.io/v1/traces',
  headers: {
    'x-honeycomb-team': process.env.HONEYCOMB_API_KEY!,
  },
  batchSize: 50,
  flushIntervalMs: 5000,
});

const tracer = new ReflexTracer({ exporter });
```

---

## 3. Configuring Tracing on ReflexAgent

Pass the configured tracer into `createAgent` or `ReflexAgent`:

```typescript
import { createAgent } from '@reflex-ai/reflex';
import { ReflexTracer, OtlpHttpTraceExporter } from '@reflex-ai/core';

const tracer = new ReflexTracer({
  serviceName: 'order-remediation-service',
  serviceVersion: '1.4.0',
  exporter: new OtlpHttpTraceExporter({
    endpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
  }),
});

const agent = createAgent({
  tracer,
  // ...
});
```

Every `agent.run(context)` call automatically traces child operations and flushes on task completion.
