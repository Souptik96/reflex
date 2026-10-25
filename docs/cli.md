# Reflex CLI Reference Manual

The `@reflex-ai/cli` package provides a standalone binary (`reflex`) for running agents, resuming human approvals, auditing cryptographic evidence ledgers, and running comparative benchmark evaluations.

---

## 1. Installation

Install globally via pnpm or run ephemerally with npx:

```bash
pnpm add -g @reflex-ai/cli
# Or run with npx
npx @reflex-ai/cli --help
```

---

## 2. Command: `reflex run <task>`

Executes a user task through the complete OVEK pipeline (Preflight -> Jev Decision -> Fast Path / Code Mode -> Verification).

```bash
reflex run "<task-description>" [options]
```

### Options

| Flag | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `--env <env>` | string | `development` | Target execution environment (`development`, `staging`, `production`) |
| `--role <role>` | string | `developer` | Caller RBAC role (`admin`, `sre`, `lead`, `developer`, `auditor`, `viewer`) |
| `--script <path>` | string | — | Path to custom JavaScript script override (bypasses synthesis) |
| `--approval-id <id>` | string | — | Resume an approved mutation task by approval ID |
| `--interactive` | flag | `false` | Interactively prompt on `stdin` for human approval if `NEEDS_HUMAN_REVIEW` |
| `--store <type>` | string | — | Persist evidence ledger to store (`file` or `memory`) |
| `--sign` | flag | `false` | Cryptographically sign the evidence ledger using Ed25519 |
| `--output-json` | flag | `false` | Output raw `ReflexExecutionResult` JSON to stdout |

### Examples

#### Example 1: Run Staging Cleanup Task
```bash
reflex run "Find all staging deployments with 0 traffic and delete them" \
  --env staging \
  --role lead \
  --sign \
  --store file
```

#### Example 2: Interactive Human-in-the-Loop Mutation
When a task requests a high-risk mutation in production:
```bash
reflex run "Drop obsolete users_temp table in production" \
  --env production \
  --role sre \
  --interactive
```
Output:
```
Reflex Execution Paused: Human Approval Required
Approval ID: appr_98bfa2e1
Task: Drop obsolete users_temp table in production
Reason: State mutation in production requires human confirmation

Do you approve this mutation? (y/N): y
Resuming task execution with approval ID: appr_98bfa2e1...
Status: VERIFIED_SUCCESS
```

---

## 3. Command: `reflex verify <ledger.json>`

Independently audits a signed `EvidenceLedger` JSON file without executing tools or connecting to external networks.

```bash
reflex verify <path/to/ledger.json> [options]
```

### Options

| Flag | Type | Description |
| :--- | :--- | :--- |
| `--expected-key <hex>` | string | Expected Ed25519 public key hex for non-repudiation verification |
| `--output-json` | flag | Output full audit report in JSON format |

### Audit Verifications Performed
1. **JSON Structure & Schema**: Validates against `EvidenceLedgerSchema`.
2. **Cryptographic SHA-256 Checksum**: Recomputes hash of canonical payload to detect any in-transit byte tampering.
3. **Ed25519 Digital Signature**: Verifies that the ledger was notarized by the authorized host key.
4. **Tool Invocations Audit**: Confirms all recorded tool HTTP statuses are valid.
5. **Postcondition Assertions**: Verifies that Layer 1, Layer 2, and Layer 3 assertions passed.

### Example
```bash
reflex verify ./evidence-ledger-2026-10-25.json --expected-key 4a9f3b...
```
Output:
```
======================================================================
 Reflex Evidence Ledger Independent Audit
======================================================================
Task ID:               task_deploy_01
Timestamp:             2026-10-25T11:00:00.000Z
Recorded Tool Calls:   3
Recorded Logs:         12
Postcondition Checks:  2

[AUDIT CHECKS]
  ✓ Schema Integrity: Valid EvidenceLedger
  ✓ SHA-256 Integrity: Checksum matches canonical content
  ✓ Ed25519 Signature: Cryptographically authentic (Signed by 4a9f3b...)
  ✓ Tool Ingress/Egress: All 3 tool calls returned HTTP 2xx
  ✓ Verification Assertions: All 2 postconditions PASSED

AUDIT VERDICT: VERIFIED_AUTHENTIC (Integrity Confirmed)
```

---

## 4. Command: `reflex bench`

Runs the standardized comparative benchmark matrix across three harnesses:
1. **Baseline A (ReAct)**: Sequential model calls per tool step.
2. **Baseline B (Code Mode Alone)**: Generative isolate execution without verification.
3. **Candidate C (Reflex)**: Jev routing + Code Mode sandbox + Tri-layer verification.

```bash
reflex bench [--output-json]
```

### Output Metrics
- **Task Completion Rate (TCR)**
- **p50 and p95 Latency (ms)**
- **Cost Per Successful Task (USD)**
- **False-Safe Completion Rate (Lying Agent vulnerability)**
- **Unnecessary Slow-Path Rate (%)**
