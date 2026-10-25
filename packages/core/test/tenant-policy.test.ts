import { describe, it, expect, beforeEach } from 'vitest';
import {
  TenantPolicyManager,
  MutationApprovalGate,
  PreflightValidator,
  isRoleAtLeast,
  matchesCron,
  type TenantConfig,
  type TaskContext,
} from '../src/index.js';

describe('Phase 8: Multi-Tenant Policy Engine & RBAC Hierarchy (@reflex-ai/core)', () => {
  let tenantManager: TenantPolicyManager;

  const tenantAlpha: TenantConfig = {
    tenantId: 'tenant-alpha',
    tier: 'starter',
    quotas: {
      maxTasksPerMinute: 5,
      maxConcurrentExecutions: 2,
      maxMonthlyBudgetUsd: 100,
    },
    allowedEnvironments: ['development', 'staging'],
    freezeWindows: [
      {
        id: 'fw-q4-deploy-freeze',
        name: 'Q4 Deploy Freeze',
        reason: 'Year-end code freeze',
        startDate: '2026-12-20T00:00:00.000Z',
        endDate: '2027-01-05T23:59:59.000Z',
        active: true,
      },
      {
        id: 'fw-daily-maintenance',
        name: 'Daily 02:00 UTC Maintenance Freeze',
        reason: 'Automated backup window',
        cronExpression: '0 2 * * *',
        active: true,
      },
    ],
    toolPermissions: {
      developer: {
        allow: ['staging.deploy', 'staging.query', 'logs.read'],
        deny: ['staging.destroy_all', 'database.drop'],
      },
      viewer: {
        allow: ['logs.read'],
        deny: ['*'],
      },
    },
    maxBlastRadius: 3,
  };

  const tenantBeta: TenantConfig = {
    tenantId: 'tenant-beta',
    tier: 'enterprise',
    quotas: {
      maxTasksPerMinute: 100,
      maxConcurrentExecutions: 20,
      maxMonthlyBudgetUsd: 5000,
    },
    allowedEnvironments: ['development', 'staging', 'production'],
    freezeWindows: [],
    toolPermissions: {},
    maxBlastRadius: 50,
    customRoles: {
      security_officer: ['read_only', 'audit_export', 'policy_admin'],
      automation_bot: ['staging_mutate', 'prod_mutate'],
    },
  };

  beforeEach(() => {
    tenantManager = new TenantPolicyManager([tenantAlpha, tenantBeta]);
  });

  describe('1. Freeze Window Rejection of Mutations', () => {
    it('blocks mutating operations during an active date-range freeze window', () => {
      const taskContext: TaskContext = {
        taskId: 'task-freeze-1',
        task: 'Migrate staging schema',
        environment: 'staging',
        callerRole: 'developer',
        availableTools: ['staging.deploy'],
        tenantId: 'tenant-alpha',
      };

      const duringFreeze = new Date('2026-12-25T12:00:00.000Z');
      const evalResult = tenantManager.evaluateTenantPolicy(taskContext, 'tenant-alpha', {
        isMutation: true,
        toolName: 'staging.deploy',
        atTime: duringFreeze,
      });

      expect(evalResult.allowed).toBe(false);
      expect(evalResult.action).toBe('BLOCK');
      expect(evalResult.isFreezeWindowActive).toBe(true);
      expect(evalResult.reason).toContain('Q4 Deploy Freeze');
      expect(evalResult.activeFreezeWindows).toContain('Q4 Deploy Freeze');
    });

    it('permits non-mutating read-only operations during a freeze window', () => {
      const taskContext: TaskContext = {
        taskId: 'task-freeze-2',
        task: 'Inspect staging logs',
        environment: 'staging',
        callerRole: 'developer',
        availableTools: ['logs.read'],
        tenantId: 'tenant-alpha',
      };

      const duringFreeze = new Date('2026-12-25T12:00:00.000Z');
      const evalResult = tenantManager.evaluateTenantPolicy(taskContext, 'tenant-alpha', {
        isMutation: false,
        toolName: 'logs.read',
        atTime: duringFreeze,
      });

      expect(evalResult.allowed).toBe(true);
      expect(evalResult.action).toBe('ALLOW');
      expect(evalResult.isFreezeWindowActive).toBe(true);
    });

    it('blocks mutating operations when a cron-based freeze window triggers', () => {
      const taskContext: TaskContext = {
        taskId: 'task-freeze-3',
        task: 'Deploy hotfix',
        environment: 'staging',
        callerRole: 'developer',
        availableTools: ['staging.deploy'],
        tenantId: 'tenant-alpha',
      };

      // 02:00 UTC matches '0 2 * * *'
      const atTwoAm = new Date('2026-05-10T02:00:00.000Z');
      const evalResult = tenantManager.evaluateTenantPolicy(taskContext, 'tenant-alpha', {
        isMutation: true,
        toolName: 'staging.deploy',
        atTime: atTwoAm,
      });

      expect(evalResult.allowed).toBe(false);
      expect(evalResult.isFreezeWindowActive).toBe(true);
      expect(evalResult.reason).toContain('Daily 02:00 UTC Maintenance Freeze');
    });

    it('permits mutating operations outside the freeze window', () => {
      const taskContext: TaskContext = {
        taskId: 'task-freeze-4',
        task: 'Deploy hotfix',
        environment: 'staging',
        callerRole: 'developer',
        availableTools: ['staging.deploy'],
        tenantId: 'tenant-alpha',
      };

      // 10:30 UTC on a normal day
      const normalTime = new Date('2026-05-10T10:30:00.000Z');
      const evalResult = tenantManager.evaluateTenantPolicy(taskContext, 'tenant-alpha', {
        isMutation: true,
        toolName: 'staging.deploy',
        atTime: normalTime,
      });

      expect(evalResult.allowed).toBe(true);
      expect(evalResult.isFreezeWindowActive).toBe(false);
    });
  });

  describe('2. Tenant Blast-Radius Violation', () => {
    it('enforces maxBlastRadius limit by blocking mutating calls beyond threshold', () => {
      const taskId = 'task-blast-radius-1';
      const tenantId = 'tenant-alpha'; // maxBlastRadius = 3

      // Call 1
      const res1 = tenantManager.recordMutation(tenantId, taskId);
      expect(res1.allowed).toBe(true);
      expect(res1.currentCount).toBe(1);

      // Call 2
      const res2 = tenantManager.recordMutation(tenantId, taskId);
      expect(res2.allowed).toBe(true);
      expect(res2.currentCount).toBe(2);

      // Call 3 (at limit)
      const res3 = tenantManager.recordMutation(tenantId, taskId);
      expect(res3.allowed).toBe(true);
      expect(res3.currentCount).toBe(3);

      // Call 4 (exceeds blast radius of 3)
      const res4 = tenantManager.recordMutation(tenantId, taskId);
      expect(res4.allowed).toBe(false);
      expect(res4.currentCount).toBe(4);
      expect(res4.maxAllowed).toBe(3);

      // Verify evaluateTenantPolicy catches blast radius violation
      const context: TaskContext = {
        taskId,
        task: 'Massive staging deletion',
        environment: 'staging',
        callerRole: 'developer',
        availableTools: ['staging.deploy'],
        tenantId,
      };

      const evalResult = tenantManager.evaluateTenantPolicy(context, tenantId, {
        isMutation: true,
      });
      expect(evalResult.allowed).toBe(false);
      expect(evalResult.blastRadiusExceeded).toBe(true);
      expect(evalResult.reason).toContain('Blast radius limit exceeded');
    });
  });

  describe('3. Role Hierarchy & RBAC Enforcement', () => {
    it('correctly ranks the built-in role hierarchy', () => {
      expect(isRoleAtLeast('admin', 'sre')).toBe(true);
      expect(isRoleAtLeast('sre', 'lead')).toBe(true);
      expect(isRoleAtLeast('lead', 'developer')).toBe(true);
      expect(isRoleAtLeast('developer', 'auditor')).toBe(true);
      expect(isRoleAtLeast('auditor', 'viewer')).toBe(true);

      // Inverted rankings should be false
      expect(isRoleAtLeast('developer', 'admin')).toBe(false);
      expect(isRoleAtLeast('viewer', 'developer')).toBe(false);
      expect(isRoleAtLeast('auditor', 'lead')).toBe(false);
    });

    it('denies viewer and auditor from approving mutations in MutationApprovalGate', () => {
      const gate = new MutationApprovalGate({ tenantPolicyManager: tenantManager });
      const context: TaskContext = {
        taskId: 'task-appr-rbac',
        task: 'Drop staging test database',
        environment: 'staging',
        callerRole: 'developer',
        availableTools: ['staging.deploy'],
        tenantId: 'tenant-alpha',
      };

      const req = gate.createRequest(context, 'CODE_MODE', true, 'Needs human confirmation');

      // Viewer attempts approval
      expect(() => {
        gate.approve(req.approvalId, 'alice_viewer', 'viewer');
      }).toThrow(/is not authorized to approve mutations/);

      // Auditor attempts approval
      expect(() => {
        gate.approve(req.approvalId, 'bob_auditor', 'auditor');
      }).toThrow(/is not authorized to approve mutations/);

      // Lead approves successfully
      const approved = gate.approve(req.approvalId, 'carol_lead', 'lead');
      expect(approved.status).toBe('APPROVED');
      expect(approved.reviewer).toBe('carol_lead');
      expect(approved.reviewerRole).toBe('lead');
    });

    it('restricts developer role from mutating production without approval', () => {
      expect(tenantManager.canRoleMutateInEnvironment('developer', 'production')).toBe(false);
      expect(tenantManager.canRoleMutateInEnvironment('developer', 'staging')).toBe(true);
      expect(tenantManager.canRoleMutateInEnvironment('admin', 'production')).toBe(true);
      expect(tenantManager.canRoleMutateInEnvironment('sre', 'production')).toBe(true);
    });

    it('respects custom enterprise roles defined on tenant', () => {
      // Security officer in tenant Beta has audit_export and policy_admin
      expect(tenantManager.hasPermission('security_officer', 'policy_admin', 'tenant-beta')).toBe(true);
      expect(tenantManager.hasPermission('security_officer', 'prod_mutate', 'tenant-beta')).toBe(false);

      // Automation bot in tenant Beta has prod_mutate
      expect(tenantManager.hasPermission('automation_bot', 'prod_mutate', 'tenant-beta')).toBe(true);
      expect(tenantManager.hasPermission('automation_bot', 'policy_admin', 'tenant-beta')).toBe(false);
    });

    it('enforces role tool allowlists and denylists per tenant', () => {
      // developer in tenant Alpha
      expect(tenantManager.canRoleInvokeTool('developer', 'staging.deploy', 'tenant-alpha')).toBe(true);
      expect(tenantManager.canRoleInvokeTool('developer', 'database.drop', 'tenant-alpha')).toBe(false);
      expect(tenantManager.canRoleInvokeTool('developer', 'random_unregistered_tool', 'tenant-alpha')).toBe(false);

      // viewer in tenant Alpha has deny: ['*'] except logs.read
      expect(tenantManager.canRoleInvokeTool('viewer', 'logs.read', 'tenant-alpha')).toBe(false); // deny '*' takes precedence
    });
  });

  describe('4. Multi-Tenant Cross-Boundary Isolation', () => {
    it('isolates allowed environments between tenants', () => {
      const preflight = new PreflightValidator({ tenantPolicyManager: tenantManager });

      // Tenant Alpha is only allowed in development & staging
      const alphaProdContext: TaskContext = {
        taskId: 'task-iso-1',
        task: 'Deploy to production cluster',
        environment: 'production',
        callerRole: 'admin',
        availableTools: ['cluster.deploy'],
        tenantId: 'tenant-alpha',
      };

      // Tenant Beta is allowed in production
      const betaProdContext: TaskContext = {
        taskId: 'task-iso-2',
        task: 'Deploy to production cluster',
        environment: 'production',
        callerRole: 'admin',
        availableTools: ['cluster.deploy'],
        tenantId: 'tenant-beta',
      };

      const resultAlpha = tenantManager.evaluateTenantPolicy(alphaProdContext, 'tenant-alpha');
      expect(resultAlpha.allowed).toBe(false);
      expect(resultAlpha.rbacDenied).toBe(true);
      expect(resultAlpha.reason).toContain('is not whitelisted for tenant');

      const resultBeta = tenantManager.evaluateTenantPolicy(betaProdContext, 'tenant-beta');
      expect(resultBeta.allowed).toBe(true);
    });

    it('ensures freeze windows in Tenant A do not block Tenant B executions', () => {
      const duringFreeze = new Date('2026-12-25T12:00:00.000Z');

      const alphaTask: TaskContext = {
        taskId: 'task-iso-3',
        task: 'Deploy staging hotfix',
        environment: 'staging',
        callerRole: 'developer',
        availableTools: ['staging.deploy'],
        tenantId: 'tenant-alpha',
      };

      const betaTask: TaskContext = {
        taskId: 'task-iso-4',
        task: 'Deploy staging hotfix',
        environment: 'staging',
        callerRole: 'developer',
        availableTools: ['staging.deploy'],
        tenantId: 'tenant-beta',
      };

      const alphaRes = tenantManager.evaluateTenantPolicy(alphaTask, 'tenant-alpha', {
        isMutation: true,
        atTime: duringFreeze,
      });
      const betaRes = tenantManager.evaluateTenantPolicy(betaTask, 'tenant-beta', {
        isMutation: true,
        atTime: duringFreeze,
      });

      expect(alphaRes.allowed).toBe(false);
      expect(alphaRes.isFreezeWindowActive).toBe(true);

      // Tenant Beta has no freeze windows and is allowed
      expect(betaRes.allowed).toBe(true);
      expect(betaRes.isFreezeWindowActive).toBe(false);
    });

    it('rejects unregistered tenants gracefully', () => {
      const unknownTask: TaskContext = {
        taskId: 'task-iso-5',
        task: 'Run query',
        environment: 'development',
        callerRole: 'developer',
        availableTools: ['query'],
        tenantId: 'tenant-unknown-evil',
      };

      const res = tenantManager.evaluateTenantPolicy(unknownTask, 'tenant-unknown-evil');
      expect(res.allowed).toBe(false);
      expect(res.rbacDenied).toBe(true);
      expect(res.reason).toContain("Tenant 'tenant-unknown-evil' is not registered");
    });
  });

  describe('5. Quotas & Rate-Limiting', () => {
    it('enforces rolling task-per-minute rate limit', () => {
      const now = Date.now();
      // Tenant Alpha limit: 5 tasks per minute (concurrency limit is 2)
      for (let i = 0; i < 5; i++) {
        const start = tenantManager.recordTaskStart('tenant-alpha', `task-${i}`, now + i * 100);
        expect(start.allowed).toBe(true);
        tenantManager.recordTaskEnd('tenant-alpha', `task-${i}`);
      }

      // 6th task exceeds quota
      const start6 = tenantManager.recordTaskStart('tenant-alpha', 'task-6', now + 600);
      expect(start6.allowed).toBe(false);
      expect(start6.reason).toContain('exceeded max tasks per minute rate limit');
    });

    it('enforces concurrency limits per tenant', () => {
      // Tenant Alpha max concurrent: 2
      const taskA = tenantManager.recordTaskStart('tenant-alpha', 'conc-task-1');
      const taskB = tenantManager.recordTaskStart('tenant-alpha', 'conc-task-2');
      expect(taskA.allowed).toBe(true);
      expect(taskB.allowed).toBe(true);

      const taskC = tenantManager.recordTaskStart('tenant-alpha', 'conc-task-3');
      expect(taskC.allowed).toBe(false);
      expect(taskC.reason).toContain('exceeded max concurrent executions');

      // Completing task 1 frees up concurrency slot
      tenantManager.recordTaskEnd('tenant-alpha', 'conc-task-1');
      const taskD = tenantManager.recordTaskStart('tenant-alpha', 'conc-task-4');
      expect(taskD.allowed).toBe(true);
    });
  });

  describe('6. Deterministic Cron Matching Utilities', () => {
    it('matches exact minute and hour', () => {
      const d1 = new Date('2026-06-15T04:30:00.000Z');
      expect(matchesCron('30 4 * * *', d1)).toBe(true);
      expect(matchesCron('0 4 * * *', d1)).toBe(false);
    });

    it('matches step expressions', () => {
      const d2 = new Date('2026-06-15T12:15:00.000Z');
      expect(matchesCron('*/15 * * * *', d2)).toBe(true);
      const d3 = new Date('2026-06-15T12:17:00.000Z');
      expect(matchesCron('*/15 * * * *', d3)).toBe(false);
    });

    it('matches day of week lists', () => {
      // Sunday is 0, Saturday is 6
      const sunday = new Date('2026-10-25T10:00:00.000Z'); // 2026-10-25 is Sunday
      expect(sunday.getDay()).toBe(0);
      expect(matchesCron('* * * * 0,6', sunday)).toBe(true);
      expect(matchesCron('* * * * 1-5', sunday)).toBe(false);
    });
  });
});
