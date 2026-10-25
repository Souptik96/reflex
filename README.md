# Reflex: Decision-Gated, Outcome-Verified Agent Runtime

Reflex is an adaptive execution framework that pairs **Jev** (typed structured decision model) with **Cloudflare Code Mode** (isolated sandbox execution) under a rigorous **Deterministic Control and Verification Plane**.

---

## Key Documentation
- **[CONTEXT.md](./CONTEXT.md)**: Master agent context file for autonomous coding agents (Claude Code, Antigravity, Aider). Contains the executive summary, invariants, TypeScript interfaces, and Phase 1-3 roadmap.
- **[ARCHITECTURE.md](./ARCHITECTURE.md)**: Formal finite state machine transitions, Jev Decisions API wire protocol, Cloudflare Host Tool Proxy boundary, and tri-layer verification engine.

---

## Monorepo Architecture

| Package | Purpose |
|---|---|
| [`@reflex-ai/core`](./packages/core) | Core domain types, FSM state machine, deterministic preflight validator, and policy rules. |
| [`@reflex-ai/jev`](./packages/jev) | Jev Decisions API client (TypeSafe & OpenRouter alpha), question batching, and fallback engine. |
| [`@reflex-ai/cloudflare`](./packages/cloudflare) | Cloudflare Code Mode worker sandbox adapter, progressive MCP discovery, and host tool authorization proxy. |
| [`@reflex-ai/verify`](./packages/verify) | Pre/post-condition assertion engine, authoritative read-after-write validator, and cryptographic evidence ledger. |
| [`@reflex-ai/reflex`](./packages/reflex) | Main top-level SDK developer interface (`new Reflex(...)`). |
| [`@reflex-ai/benchmarks`](./packages/benchmarks) | Synthetic benchmarking suite comparing ReAct, Code Mode, and Reflex across cost, latency, and lying agent detection. |


---

## Quickstart

```bash
# Install dependencies
pnpm install

# Run typechecks and unit tests
pnpm typecheck
pnpm test
```
