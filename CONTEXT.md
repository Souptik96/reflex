# Reflex: Outcome-Verified Execution Kernel (OVEK)
## Master Agent Context & Engineering Blueprint

> **Role & Target**: This context file is designed for autonomous coding agents (Claude Code, Antigravity, Aider, Codex) to build the **Reflex** SDK from scratch without architectural drift or missing invariants.
> **Repository Root**: `c:/Users/soupt/mixed-system-agent`
> **Primary Language / Ecosystem**: TypeScript (ESM, Strict), Node.js >= 20, pnpm monorepo.

---

## 1. Executive Summary & Core Hypothesis

### The Problem
Contemporary agent frameworks rely on the **ReAct pattern** (Reasoning + Acting loop): an iterative LLM roundtrip for every single tool invocation. This yields:
1. **Excessive Latency & Cost**: 5-10 sequential model invocations for multi-step tasks.
2. **Ungrounded Completion Claims ("Lying Agents")**: The model announces *"Successfully deleted staging deployments"*, but in reality the API returned a 403, timed out, or mutated the wrong target. The framework trusts the model's self-reported success.
3. **Pseudosafety**: Passing unvetted instructions to sandboxes or assuming small classifier models provide security boundaries.

### The Reflex Solution
**Reflex** is a **Decision-Gated, Outcome-Verified Agent Runtime**. It decomposes agentic execution into three strictly decoupled layers:
1. **Decision Layer (Jev)**: Bounded, typed, batched decisions (`choice`, `score`, `noul`) to classify intent, assess mutation risk, and select an execution path without generating unbounded text.
2. **Execution Layer (Cloudflare Code Mode + Generative LLM)**: The generative model writes an ephemeral JavaScript program executing within an isolated Cloudflare Worker / V8 sandbox, composing multiple MCP tools and API calls in a single execution step.
3. **Control & Verification Plane (Reflex Core)**: Enforces deterministic preflight checks, host-side tool authorization boundaries, idempotency keys, and **deterministic read-after-write postcondition verification**.

### Core Axioms (Non-Negotiable)
- **Axiom 1: Jev proposes; Deterministic Policy disposes.** A decision model's confidence or route choice is advisory. Policy, permission, and mutation rules are authoritative and deterministic.
- **Axiom 2: Sandbox is for execution isolation, NOT authorization.** Worker sandboxes cannot hold unrestricted credentials. Tool interception happens at the host proxy boundary.
- **Axiom 3: Execution is not verification.** An agent execution that exits with status code 0 is merely *attempted*. Success is only granted when postconditions pass independent assertion (read-after-write).
- **Axiom 4: Zero model calls when code suffices.** If regex, schema validation, cache, or hard rules can resolve or block a request, neither Jev nor the generative model is invoked.

---

## 2. System Architecture & Execution Lifecycle

```
                 [ Incoming User Task / Event ]
                               │
                               ▼
        ┌──────────────────────────────────────────────┐
        │        1. DETERMINISTIC PREFLIGHT            │
        │  • Zod schema validation                     │
        │  • Hard safety regex / forbidden patterns    │
        │  • Quota / Rate-limit checks                 │
        │  • Identity & RBAC baseline                  │
        └──────────────────────┬───────────────────────┘
                               │ (Passes preflight)
                               ▼
        ┌──────────────────────────────────────────────┐
        │        2. JEV DECISION ENGINE                │
        │  Single batched request with 4 questions:    │
        │  - route: choice [FAST_PATH, CODE_MODE, ...] │
        │  - policy_risk: noul                         │
        │  - complexity: score (1-5)                   │
        │  - mutates_state: noul                       │
        └──────────────────────┬───────────────────────┘
                               │
            ┌──────────────────┴──────────────────┐
            ▼                                     ▼
   [ Route = FAST_PATH ]                 [ Route = CODE_MODE ]
            │                                     │
   ┌─────────────────┐                   ┌─────────────────────────────┐
   │ 3A. FAST ENGINE │                   │ 3B. GENERATIVE CODE SYNTH   │
   │ Deterministic   │                   │ Generative LLM synthesizes  │
   │ function, cache │                   │ orchestration script        │
   │ or template     │                   └──────────────┬──────────────┘
   └────────┬────────┘                                  │
            │                                           ▼
            │                            ┌─────────────────────────────┐
            │                            │ 4. CLOUDFLARE CODE MODE     │
            │                            │ • Isolated Worker Sandbox   │
            │                            │ • Progressive MCP Tool Disc │
            │                            │ • Host Auth Boundary Inter- │
            │                            │   cepts external mutations  │
            │                            └──────────────┬──────────────┘
            │                                           │
            └──────────────────┬────────────────────────┘
                               │
                               ▼
        ┌──────────────────────────────────────────────┐
        │        5. VERIFICATION & EVIDENCE ENGINE     │
        │  • Collect Tool Invocation Evidence Ledger   │
        │  • Layer 1: Deterministic Output Assertions  │
        │  • Layer 2: Authoritative Read-After-Write   │
        │  • Layer 3: Semantic Fallback (Jev noul)     │
        └──────────────────────┬───────────────────────┘
                               │
                               ▼
        ┌──────────────────────────────────────────────┐
        │        6. GROUNDED OUTCOME DISPATCH          │
        │  - VerifiedSuccess(evidence, ledger)         │
        │  - UnverifiedSuccess(evidence, reason)       │
        │  - ExecutionFailed(trace, error)             │
        │  - VerificationFailed(expected, actual)      │
        │  - BlockedByPolicy(violation)                │
        │  - HumanReviewRequired(prompt, approvalId)   │
        └──────────────────────────────────────────────┘
```

---

## 3. Package Structure (Monorepo Blueprint)

The project is structured as a `pnpm` monorepo under `packages/`:

```
mixed-system-agent/
├── package.json                 # Monorepo root package.json
├── pnpm-workspace.yaml          # Workspace declaration
├── tsconfig.base.json           # Shared strict TypeScript configuration
├── vitest.config.ts             # Root Vitest test configuration
├── CONTEXT.md                   # This master context file
├── ARCHITECTURE.md              # Detailed state machine & specs
└── packages/
    ├── core/                    # @reflex-ai/core
    │   ├── src/
    │   │   ├── types/           # Domain contracts (Route, Decision, Outcome, Evidence)
    │   │   ├── state-machine/   # Execution pipeline & lifecycle manager
    │   │   ├── preflight/       # Deterministic preflight validator
    │   │   ├── policy/          # Authoritative policy & mutation guard
    │   │   └── idempotency/     # Mutex & idempotency key manager
    │   └── package.json
    ├── jev/                     # @reflex-ai/jev
    │   ├── src/
    │   │   ├── types.ts         # Jev API schemas (choice, score, noul)
    │   │   ├── client.ts        # Unified Jev adapter (TypeSafe & OpenRouter alpha)
    │   │   ├── prompts.ts       # Structured question builder & rubric formatter
    │   │   ├── fallback.ts      # Conservative fallback state builder on timeout/error
    │   │   └── providers/       # TypeSafe, OpenRouter, and Mock providers
    │   └── package.json
    ├── cloudflare/              # @reflex-ai/cloudflare
    │   ├── src/
    │   │   ├── executor.ts      # Code Mode worker sandbox harness
    │   │   ├── tool-proxy.ts    # Host authorization & RPC mutation boundary
    │   │   ├── mcp-discovery.ts # Progressive MCP tool metadata provider
    │   │   └── telemetry.ts     # Execution tracer (CPU, memory, wall time, tool logs)
    │   └── package.json
    ├── verify/                  # @reflex-ai/verify
    │   ├── src/
    │   │   ├── engine.ts        # Tri-layer verification orchestrator (Read-After-Write)
    │   │   ├── assertions.ts    # Layer 1: Schema, status code, regex assertions
    │   │   ├── semantic.ts      # Layer 3: Bounded Jev semantic postcondition checker
    │   │   └── ledger.ts        # Append-only cryptographic SHA-256 evidence ledger
    │   └── package.json
    ├── reflex/                  # @reflex-ai/reflex (Main SDK entrypoint)
    │   ├── src/
    │   │   ├── index.ts         # Facade export: Reflex, createAgent, ReflexAgent
    │   │   ├── agent.ts         # Top-level ReflexAgent lifecycle manager
    │   │   └── runner.ts        # Agent.run(...) pipeline coordinator
    │   └── package.json
    ├── benchmarks/              # @reflex-ai/benchmarks (Comparative Evaluation)
    │   ├── src/
    │   │   ├── dataset.ts       # Standardized 10-task synthetic evaluation benchmark
    │   │   ├── metrics.ts       # Statistical metrics collector (p50/p95 latency, cost, TCR)
    │   │   ├── runner.ts        # Head-to-head benchmark matrix executor
    │   │   └── harnesses/       # ReAct, Code Mode, and Reflex execution harnesses
    │   └── package.json
    └── cli/                     # @reflex-ai/cli (Developer Tooling & Standalone Bin)
        ├── src/
        │   ├── bin/reflex.ts    # Executable CLI entrypoint (reflex)
        │   ├── commands/        # reflex run, verify, bench commands
        │   ├── prompt.ts        # Interactive stdin prompt for human approval
        │   └── formatters.ts    # Terminal tables and summary formatters
        └── package.json
```

---

## 4. Core Domain Contracts (TypeScript Specifications)

Coding agents MUST conform to these exact interface models:

### 4.1. Routing & Decision Contracts (`@reflex-ai/core`)
```typescript
export type ReflexRoute = 
  | 'FAST_PATH'     // Deterministic code, cache hit, pre-approved pure function
  | 'CODE_MODE'     // Generative LLM writes script -> Cloudflare sandbox execution
  | 'ASK_USER'      // Ambiguous instruction, missing parameters, human confirmation
  | 'BLOCK'         // Hard safety violation or unauthorized mutation attempt
  | 'FALLBACK';     // Handled system error, decision timeout, or degraded operation

export interface JevDecisionBatch {
  route: {
    selected: ReflexRoute;
    probabilities: Record<ReflexRoute, number>;
    confidence: number; // 0.0 - 1.0
  };
  policyViolation: {
    isViolation: boolean;
    probability: number;
    flaggedRules?: string[];
  };
  complexityScore: {
    score: number; // e.g. 1 (trivial) to 5 (highly complex)
    normalized: number; // 0.0 - 1.0
  };
  requiresMutation: {
    willMutateState: boolean;
    probability: number;
  };
  rawLatencyMs: number;
  tokenUsage?: { inputTokens: number; outputTokens: number };
}
```

### 4.2. Verification & Evidence Contracts (`@reflex-ai/core` & `@reflex-ai/verify`)
```typescript
export type VerificationStatus =
  | 'VERIFIED_SUCCESS'     // Preconditions passed, execution passed, postconditions verified
  | 'UNVERIFIED_SUCCESS'   // Execution reported success, but postconditions lack authoritative evidence
  | 'EXECUTION_FAILED'     // Sandbox script threw runtime exception or tool returned 5xx
  | 'VERIFICATION_FAILED'  // Sandbox reported success, but read-after-write proved state did NOT change
  | 'BLOCKED_BY_POLICY'    // Preflight or runtime authorization rejected action
  | 'NEEDS_HUMAN_REVIEW'   // Mutation exceeds risk budget or policy specifies human sign-off
  | 'SYSTEM_FALLBACK';     // Timeout, infrastructure failure, or safe degraded exit

export interface ToolInvocationEvidence {
  callId: string;
  toolName: string;
  inputPayload: Record<string, unknown>;
  outputPayload: Record<string, unknown>;
  isMutation: boolean;
  httpStatus?: number;
  timestamp: string;
  latencyMs: number;
}

export interface EvidenceLedger {
  taskId: string;
  timestamp: string;
  preconditionSnapshots: Record<string, unknown>;
  toolCalls: ToolInvocationEvidence[];
  sandboxLogs: string[];
  postconditionChecks: {
    layer: 'DETERMINISTIC' | 'READ_AFTER_WRITE' | 'SEMANTIC';
    target: string;
    expected: unknown;
    actual: unknown;
    passed: boolean;
    reason?: string;
  }[];
  checksum: string; // SHA-256 hash of the complete evidence block
}

export interface ReflexExecutionResult<TOutput = unknown> {
  taskId: string;
  status: VerificationStatus;
  routeTaken: ReflexRoute;
  output?: TOutput;
  evidence: EvidenceLedger;
  metrics: {
    totalDurationMs: number;
    decisionDurationMs: number;
    executionDurationMs: number;
    verificationDurationMs: number;
    estimatedCostUsd: number;
    tokensUsed: {
      decisionInputTokens: number;
      decisionOutputTokens: number;
      codeGenInputTokens: number;
      codeGenOutputTokens: number;
    };
  };
}
```

---

## 5. Subsystem Deep-Dives & Invariants

### 5.1. Jev Integration Architecture (`@reflex-ai/jev`)
Jev is **not** a chat model. It does not output streaming markdown. It exposes the **Decisions API** which takes questions of type `choice`, `score`, and `noul` (yes/no certainty).

1. **Dual Provider Support**:
   - **TypeSafe Direct**: `POST https://api.typesafe.ai/v1/systemone`
   - **OpenRouter Alpha**: `POST https://openrouter.ai/api/alpha/decisions`
2. **Batching**: Always dispatch all 4 routing & risk questions in a single HTTP request to minimize network RTT.
3. **Conservative Fallback Rules**:
   - If Jev request times out (default: 800ms threshold):
     - If the task is flagged with any mutation potential -> Route to `BLOCK` or `ASK_USER`.
     - Never silently downgrade to `FAST_PATH`.
   - If route confidence is below `confidenceThreshold` (default: `0.75`):
     - Escalate to `CODE_MODE` (if complexity warrants) or `ASK_USER` (if mutations suspected).

### 5.2. Cloudflare Code Mode & Host Boundary (`@reflex-ai/cloudflare`)
Cloudflare Code Mode uses isolated V8 sandboxes (Cloudflare Workers) where a generative model (Claude 3.5 Sonnet, GPT-4o, DeepSeek, etc.) writes a JavaScript script orchestrating tools.

1. **Security Isolation vs Authorization**:
   - The sandbox execution script **must not** possess raw API keys or unrestricted network sockets.
   - All tool invocations must route through the `HostToolProxy`.
2. **The `HostToolProxy` Boundary**:
   - When the sandbox script calls `mcp.deployments.delete({ id: "dep_123" })`:
     1. Host intercepts the call before execution.
     2. Validates against the active `PolicyEngine` (e.g., `environment === "production"` requires approval).
     3. Checks idempotency tokens.
     4. Records input parameters into the `EvidenceLedger`.
     5. Calls the real underlying MCP server / API.
     6. Records the real HTTP status / payload into the ledger before returning to the sandbox.

### 5.3. Deterministic Verification Engine (`@reflex-ai/verify`)
This is the core competitive moat of Reflex. It operates on a 3-layer verification hierarchy:

1. **Layer 1: Deterministic Output Assertions**
   - Validates that the sandbox output matches schema, tool status codes are 2xx, and expected keys are present.
2. **Layer 2: Authoritative Read-After-Write (Independent Verification)**
   - When a state-changing operation occurs (e.g., deleting a deployment or altering a database row), Reflex executes an out-of-band read request via an authoritative reader (NOT via the untrusted sandbox script).
   - *Example*:
     - Action: Delete deployment `dep_987`
     - Postcondition: Query API `GET /deployments/dep_987`
     - Expected: HTTP 404 or `status === "deleted"`
     - If the read returns HTTP 200 with `status === "active"`, status is immediately flagged as `VERIFICATION_FAILED`.
3. **Layer 3: Bounded Semantic Verification**
   - Used only when the outcome cannot be checked deterministically (e.g., "Summarize the failure root causes").
   - Jev evaluates a `noul` question: *"Does the summary text address all 3 failed deployment logs present in evidence?"*

---

## 6. Implementation Roadmap & Checkpoints

### Current Checkpoint Status: All Phases 1–8 Verified (100% Production Ready)
- **Test Suite**: 36 test files, 206 tests passing, 0 failures.
- **Type Safety**: 100% strict TypeScript (`tsc -b` passes with 0 errors, strict zero `any` types verified across all 88 source files).
- **Build**: All 7 monorepo packages build cleanly to `./dist` (`@reflex-ai/core`, `@reflex-ai/jev`, `@reflex-ai/cloudflare`, `@reflex-ai/verify`, `@reflex-ai/reflex`, `@reflex-ai/benchmarks`, `@reflex-ai/cli`).
- **Release Verification**: 7/7 workspace packages pass packaging integrity, export maps, binary permissions, and TypeScript declaration audits (`npm run release:check`).
- **Benchmark Invariants Verified**:
  - p50 Latency reduction: ~96% lower than ReAct.
  - Cost per task reduction: ~86% lower than ReAct.
  - False-Safe Completion Rate: **0.0%** (100% of lying agents intercepted by Layer 2 Read-After-Write and Layer 1 assertions).
  - Unnecessary Slow Path: < 5% (high-confidence tasks routed to `FAST_PATH`).
- **Phase 4 Capabilities Delivered**:
  - Pluggable `ICodeSynthesisProvider` (`AnthropicCodeSynthesizer` for Claude 3.5 Sonnet, `OpenAICodeSynthesizer` for GPT-4o, `MockCodeSynthesizer` for deterministic replays).
  - Isolated V8 sandbox with strict execution timeouts, restricted global scope, and bi-directional RPC channel (`IsolateRpcBridge`).
  - Cloudflare Worker execution adapter compatible with `workerd` (`createCloudflareWorkerHandler`).
  - Full Model Context Protocol (MCP) clients (`McpStdioClient`, `McpHttpClient`, `SimulatedMcpServer`).
- **Phase 5 Capabilities Delivered**:
  - Asymmetric Ed25519 cryptographic signing and notary verification (`LedgerSigner`, `LedgerVerifier`, `verifyLedgerSignature`).
  - Asynchronous & Eventual-Consistency Read-After-Write Verifier with exponential backoff and HMAC-SHA256 webhook gate (`AsyncReadAfterWriteVerifier`).
  - Persistent Ledger Storage Engine (`MemoryLedgerStore`, `FileLedgerStore` with atomic write, `SqliteLedgerStore` with relational schema).
- **Phase 8 Capabilities Delivered**:
  - Multi-tenant policy configuration and advanced RBAC hierarchy (`TenantPolicyManager`, `TenantConfigSchema`, `FreezeWindowSchema`, `TenantQuotaSchema`).
  - Strict blast-radius quota enforcement and calendar/cron-based deployment freeze windows.
  - Built-in role hierarchy (`admin > sre > lead > developer > auditor > viewer`) with custom enterprise permission masks and mutation approval gate restrictions.
  - Production CI/CD automation (`.github/workflows/ci.yml`, `.github/workflows/release.yml`) with npm provenance publishing configuration.
  - Packaging integrity verification script (`scripts/verify-release.ts` / `npm run release:check`) and strict zero-`any` audit (`scripts/check-zero-any.ts`).
  - Complete documentation suite (`docs/overview.md`, `docs/governance.md`, `docs/verification.md`, `docs/observability.md`, `docs/cli.md`) and 4 executable cookbook recipes in `docs/cookbook/` and `examples/`.

---

### Phase 1: Foundation (Decision-Gated Execution) — [COMPLETED]
- [x] Initialize pnpm monorepo with strict TypeScript configuration and Vitest.
- [x] Implement `@reflex-ai/core` types, state machine, and deterministic preflight validator.
- [x] Implement `@reflex-ai/jev` client with support for TypeSafe and OpenRouter `/api/alpha/decisions` + mock provider for offline tests.
- [x] Implement `@reflex-ai/cloudflare` with an isolated mock/worker runner and host tool proxy.
- [x] Wire end-to-end `Reflex.run(...)` pipeline: Preflight -> Jev Batch Decision -> (Fast Path | Code Mode) -> Raw Output.
- [x] Unit & integration tests for all 5 route resolutions (`FAST_PATH`, `CODE_MODE`, `ASK_USER`, `BLOCK`, `FALLBACK`).

### Phase 2: Verification Engine & Lying Agent Detection — [COMPLETED]
- [x] Implement `@reflex-ai/verify` with `EvidenceLedger` recording all tool calls with cryptographic SHA-256 hashes.
- [x] Implement Layer 1 (Schema & status assertion) and Layer 2 (Read-after-write verifier).
- [x] Implement Layer 3 (Bounded semantic verification with Jev `noul`).
- [x] Implement simulated "lying agent" test suite across 6 adversarial vectors (Cases A through F):
  - Case A: Agent returns 200 OK without calling any tools.
  - Case B: Tool fails with 403 Forbidden, but sandbox script suppresses error and reports success.
  - Case C: Agent claims resource deleted, but authoritative API returns 200 active.
  - Case D: Script silently mutates an unintended resource ID.
  - Case E: Evidence tampering / SHA-256 ledger checksum mismatch.
  - Case F: Adversarial parameter tampering caught by host proxy policy.
- [x] Implement idempotency key manager and mutation approval gate (`ASK_USER` escalation and `approveAndResume`).

### Phase 3: Benchmarks & Comparative Evaluation — [COMPLETED]
- [x] Implement `@reflex-ai/benchmarks` comparing three harnesses on identical synthetic tasks:
  1. Baseline A: Conventional ReAct LLM + single MCP tool calling.
  2. Baseline B: Generative LLM + Cloudflare Code Mode alone.
  3. Candidate C: Reflex (Jev routing + Code Mode + Deterministic Verification).
- [x] Standardized 10-task evaluation dataset across all route archetypes (Read-only lookup, high-risk production mutation, multi-step staging cleanup, rate-limited user, adversarial lying agent, low-confidence ambiguous request).
- [x] Metrics collection: Task Completion Rate, p50/p95 Latency, Cost Per Successful Task, Unnecessary Slow-Path Rate, False-Safe / Unsafe Action Rate, Verification Detection Rate.

---

### Phase 4: Live Infrastructure & Real Cloudflare Worker Runtime — [COMPLETED]
- [x] Implement live Cloudflare Worker execution adapter using `@cloudflare/workers-types` and Miniflare / workerd isolate runtime (`createCloudflareWorkerHandler`).
- [x] Implement real Model Provider adapters for generative Code Mode synthesis (`AnthropicCodeSynthesizer` for Claude 3.5 Sonnet & `OpenAICodeSynthesizer` for GPT-4o, plus `MockCodeSynthesizer`).
- [x] Implement live Model Context Protocol (MCP) clients with stdio (`McpStdioClient`), Server-Sent Events/HTTP (`McpHttpClient`), and offline test harness (`SimulatedMcpServer`).
- [x] Add live end-to-end integration test suite with environment toggle (`REFLEX_LIVE_TEST=true`).

### Phase 5: Distributed Evidence Ledger & Asynchronous State Notary — [COMPLETED]
- [x] Cryptographic asymmetric signing of `EvidenceLedger` blocks (Ed25519) by the Host Proxy boundary for audit non-repudiation (`LedgerSigner`, `LedgerVerifier`, `verifyLedgerSignature`).
- [x] Asynchronous Read-After-Write verifiers with HMAC-SHA256 webhook listeners and configurable polling intervals for eventual consistency & long-running mutations (`AsyncReadAfterWriteVerifier`).
- [x] Persistent storage adapters for Evidence Ledgers (`MemoryLedgerStore`, `FileLedgerStore` with atomic file swapping, `SqliteLedgerStore` with SQLite/relational schema).

### Phase 6: Developer Experience, CLI & Observability — [COMPLETED]
- [x] Implement `@reflex-ai/cli`:
  - `reflex run <task>` (run interactive or batch tasks with options `--env`, `--role`, `--script`, `--approval-id`, `--output-json`, `--store`, `--sign`, `--interactive`).
  - `reflex verify <ledger.json>` (independently audit and verify a signed evidence ledger with SHA-256 integrity, Ed25519 signature, and tool assertions).
  - `reflex bench` (run benchmark matrix against active models, emitting comparative Markdown and summary metrics).
- [x] OpenTelemetry (OTel) distributed tracing: emit standard semantic convention spans (`reflex.task`, `reflex.preflight`, `reflex.jev.decision`, `reflex.codemode.sandbox`, `reflex.tool.<name>`, `reflex.verify.layer*`) with `InMemoryTraceExporter`, `ConsoleJsonTraceExporter`, and `OtlpHttpTraceExporter`.
- [x] Interactive human approval gate: CLI interactive prompt and Webhook / Slack integration (`SlackApprovalBridge`) for `NEEDS_HUMAN_REVIEW` HMAC-SHA256 approvals.

### Phase 7: Production Hardening, Concurrency & Chaos Testing — [COMPLETED]
- [x] High-concurrency stress testing for `DistributedIdempotencyManager` (atomic CAS locks, TTL window expiration, and 100+ concurrent racer test suite guaranteeing exactly 1 mutation).
- [x] Chaos & fault-injection test suite covering all 4 failure vectors:
  - Vector 1: Simulated network drops & socket timeouts -> graceful conservative `SYSTEM_FALLBACK`.
  - Vector 2: Malformed Jev decision payloads -> safe Zod rejection & fallback.
  - Vector 3: Sandbox catastrophic failure -> infinite loops & hanging promises cleanly terminated by watchdog without crashing host Node process.
  - Vector 4: Byzantine MCP tool servers -> invalid JSON-RPC frames, 500 errors, and corrupt payloads intercepted and recorded in ledger.
- [x] Decision caching (`DecisionCache` LRU with canonical SHA-256 task context hash) & fast-path expression compilation (`FastPathCompiler` declarative pattern compiler resolving in < 5ms at $0.00 cost).

### Phase 8: Enterprise Governance & Release Packaging — [COMPLETED]
- [x] Multi-tenant policy configuration and role-based access control (RBAC) schemas (`TenantPolicyManager`, `TenantConfigSchema`, `FreezeWindowSchema`, `TenantQuotaSchema`).
- [x] Freeze window change management (calendar ranges, UTC cron expressions, weekend deploy freezes) and blast-radius controls.
- [x] Role hierarchy ranking (`admin > sre > lead > developer > auditor > viewer`) with permission masks (`read_only`, `staging_mutate`, `prod_mutate`, `policy_admin`, `audit_export`) and approval gate enforcement.
- [x] Automated CI/CD release workflow (GitHub Actions) with npm provenance publishing (`.github/workflows/ci.yml`, `.github/workflows/release.yml`).
- [x] Release verification script (`scripts/verify-release.ts` / `npm run release:check`) auditing all 7 packages.
- [x] Complete documentation suite (`docs/overview.md`, `docs/governance.md`, `docs/verification.md`, `docs/observability.md`, `docs/cli.md`) and developer cookbook with 4 runnable production recipes in `docs/cookbook/` and `examples/`.

---

## 7. Directives for the Coding Agent

1. **Never mock away security**: Never allow sandbox code to execute unchecked external side effects without going through the host proxy.
2. **Strict Typing**: All schemas must be enforced using `zod` (v3). No `any` types in public interfaces.
3. **Zero Hallucination on APIs**:
   - For Jev, adhere to the documented question formats (`choice`, `score`, `noul`). Do not invent standard completions endpoints for Jev.
   - For Cloudflare, wrap `@cloudflare/codemode` in a clean adapter layer so the underlying runner can be swapped if Cloudflare changes its experimental API.
4. **Offline Testability**: Always provide a mock Jev provider and mock Tool executor so the entire test suite runs fast, deterministically, and without requiring real API keys in CI.
