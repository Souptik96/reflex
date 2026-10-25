import {
  ReflexAgent,
  TenantPolicyManager,
  SlackApprovalBridge,
  type TaskContext,
} from '../../packages/reflex/dist/index.js';
import { LedgerSigner } from '../../packages/verify/dist/index.js';
import { MockJevProvider, JevClient } from '../../packages/jev/dist/index.js';

async function main() {
  console.log('--- Running Reflex Recipe 2: Production Database Migration ---');

  // 1. Initialize Tenant Policy with Blast Radius & Role Constraints
  const tenantPolicy = new TenantPolicyManager([
    {
      tenantId: 'core-database-services',
      tier: 'enterprise',
      allowedEnvironments: ['staging', 'production'],
      maxBlastRadius: 2,
      toolPermissions: {
        sre: { allow: ['db.apply_migration', 'db.verify_schema'], deny: [] },
        developer: { allow: ['db.verify_schema'], deny: ['db.apply_migration'] },
      },
    },
  ]);

  // 2. Setup Ed25519 Cryptographic Signer & Slack HMAC Approval Bridge
  const signer = new LedgerSigner();
  const slackBridge = new SlackApprovalBridge({
    secret: 'slack_signing_secret_998877',
  });

  // Mock Jev decision model detecting a production mutation
  const mockJev = new MockJevProvider({
    responseGenerator: () => ({
      decision_id: 'dec_db_mig_1',
      latency_ms: 25,
      usage: { input_tokens: 50, output_tokens: 10 },
      answers: {
        route_selection: {
          type: 'choice',
          selected: 'CODE_MODE',
          probabilities: { FAST_PATH: 0.0, CODE_MODE: 0.95, ASK_USER: 0.05, BLOCK: 0.0 },
          confidence: 0.95,
        },
        policy_risk: { type: 'noul', judgment: false, probability: 0.01 },
        complexity_score: { type: 'score', value: 4.0, normalized: 0.8 },
        requires_mutation: { type: 'noul', judgment: true, probability: 0.99 },
      },
    }),
  });

  const agent = new ReflexAgent({
    tenantPolicyManager: tenantPolicy,
    ledgerSigner: signer,
    jevClient: new JevClient({ customProvider: mockJev }),
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

  // 4. Initial Task Run (Escalates to Human Review)
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

  // 5. Build Slack Interactive Block Message with HMAC Signature
  const approvalReq = agent.getApprovalGate().getRequest(initialResult.approvalId!);
  if (approvalReq) {
    const slackPayload = slackBridge.createApprovalPayload(approvalReq);
    console.log('HMAC Token Generated:', slackPayload.token.slice(0, 20) + '...');
    console.log('Slack Block Header:', slackPayload.slackBlocks?.text);
  }

  // 6. Resume Task Execution with Authorized SRE Role
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
    'sre'
  );

  console.log('Resumed Execution Status:', resumeResult.status); // VERIFIED_SUCCESS
  console.log('Signed Evidence Ledger SHA-256 Checksum:', resumeResult.evidence.checksum);
  console.log('Ed25519 Notary Signature:', resumeResult.evidence.signature ? 'VALID_ED25519' : 'NONE');
  console.log('Signer Public Key:', resumeResult.evidence.signature?.publicKey.slice(0, 16) + '...');
}

main().catch(console.error);
