# Cookbook Recipe 2: Production Database Migration

## Overview & Architecture

Production database schema migrations and data backfills represent the highest-risk operations an engineering team executes. A faulty script or unvetted table lock can bring down core transactional processing.

In this recipe, we configure an enterprise-grade migration pipeline combining:
1. **Human-in-the-Loop Slack HMAC Webhook Gate**: State mutations in `production` pause execution in `NEEDS_HUMAN_REVIEW` and dispatch an interactive Slack notification with HMAC-SHA256 signature verification.
2. **Role Authorization Check**: Only operators with `lead`, `sre`, or `admin` roles can approve mutations; attempts by `viewer` or `auditor` roles are rejected.
3. **Blast Radius Control**: Caps the maximum number of table mutations per task to prevent cascading data alteration.
4. **Ed25519 Cryptographic Notary Signing**: Generates a tamper-proof evidence ledger for compliance audits.

---

## Code Example (`examples/02-db-migration/index.ts`)

```typescript
import {
  ReflexAgent,
  TenantPolicyManager,
  SlackApprovalBridge,
  type TaskContext,
} from '@reflex-ai/reflex';
import { LedgerSigner } from '@reflex-ai/verify';

// 1. Initialize Tenant Policy with Blast Radius & Role Constraints
const tenantPolicy = new TenantPolicyManager([
  {
    tenantId: 'core-database-services',
    tier: 'enterprise',
    allowedEnvironments: ['staging', 'production'],
    maxBlastRadius: 2, // Maximum 2 mutating operations
    toolPermissions: {
      sre: { allow: ['db.apply_migration', 'db.verify_schema', 'db.health_check'], deny: [] },
      developer: { allow: ['db.verify_schema'], deny: ['db.apply_migration'] },
    },
  },
]);

// 2. Setup Ed25519 Cryptographic Signer & Slack HMAC Approval Bridge
const signer = new LedgerSigner(); // Generates keypair
const slackBridge = new SlackApprovalBridge({
  signingSecret: 'slack_signing_secret_998877',
});

const agent = new ReflexAgent({
  tenantPolicyManager: tenantPolicy,
  ledgerSigner: signer,
  policyConfig: {
    requireApprovalForMutations: true,
  },
});

// 3. Register Database Tools on Host Authorization Boundary
agent.registerToolHandler('db.apply_migration', true, async (params) => {
  return {
    httpStatus: 200,
    data: { migration: params['migrationId'], applied: true, rowsUpdated: 450 },
  };
});

agent.registerToolHandler('db.verify_schema', false, async () => {
  return {
    httpStatus: 200,
    data: { table: 'users_v2', status: 'ready', indexes: ['idx_user_email'] },
  };
});

// 4. Initial Task Run (Pauses for Human Review)
const context: TaskContext = {
  taskId: 'task-db-migrate-prod-01',
  task: 'Apply partition schema migration to production database',
  environment: 'production',
  callerRole: 'sre',
  availableTools: ['db.apply_migration', 'db.verify_schema'],
  tenantId: 'core-database-services',
};

const initialResult = await agent.run(context);
console.log('Initial Status:', initialResult.status); // NEEDS_HUMAN_REVIEW
console.log('Approval ID:', initialResult.approvalId);

// 5. Send Slack Interactive Message with HMAC Signature
const approvalReq = agent.getApprovalGate().getRequest(initialResult.approvalId!);
const slackPayload = slackBridge.createApprovalPayload(approvalReq!);

// 6. Simulate Incoming Approved Webhook from Slack
const resumeResult = await agent.approveAndResume(
  initialResult.approvalId!,
  {
    verificationContract: {
      readAfterWrite: [
        {
          targetResource: 'db.schema.users_v2',
          query: async () => ({ table: 'users_v2', partitioned: true }),
          assert: async (actual) => (actual as { partitioned: boolean }).partitioned === true,
          failureMessage: 'Table users_v2 partition verification failed',
        },
      ],
    },
    script: `
      const res = await tools.invoke("db.apply_migration", { migrationId: "2026_10_add_user_partitions" });
      const verify = await tools.invoke("db.verify_schema", {});
      return { migration: res, schema: verify };
    `,
  },
  'sre_oncall_engineer',
  'sre' // Role verification passed
);

console.log('Final Execution Status:', resumeResult.status); // VERIFIED_SUCCESS
console.log('Ledger Ed25519 Signature:', resumeResult.evidence.signature?.signatureHex);
console.log('Signer Public Key:', resumeResult.evidence.signature?.publicKey);
```

---

## Security Verification Guarantees

1. **Deterministic Pause**: Unapproved production mutations can never execute without explicit signed approval.
2. **Blast Radius Protection**: If the migration script attempts more mutating tool calls than `maxBlastRadius` (2), subsequent mutations are rejected with HTTP 429.
3. **Cryptographic Non-Repudiation**: The resulting `EvidenceLedger` contains the reviewer ID, timestamp, and an Ed25519 digital signature.
