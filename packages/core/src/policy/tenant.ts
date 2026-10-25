import { z } from 'zod';
import type { TaskContext } from '../types/result.js';
import { PolicyActionSchema } from '../types/policy.js';

// ─────────────────────────────────────────────────────────────
// 1. Zod Schemas for Multi-Tenant Configuration & Quotas
// ─────────────────────────────────────────────────────────────

export const TenantTierSchema = z.enum(['free', 'starter', 'enterprise']);
export type TenantTier = z.infer<typeof TenantTierSchema>;

export const TenantQuotaSchema = z.object({
  maxTasksPerMinute: z.number().int().positive().default(60),
  maxConcurrentExecutions: z.number().int().positive().default(10),
  maxMonthlyBudgetUsd: z.number().nonnegative().default(1000),
});
export type TenantQuota = z.infer<typeof TenantQuotaSchema>;

export const FreezeWindowSchema = z.object({
  id: z.string().min(1),
  name: z.string().optional(),
  reason: z.string().optional(),
  startDate: z.string().optional(), // ISO datetime or YYYY-MM-DD
  endDate: z.string().optional(),
  cronExpression: z.string().optional(), // Standard 5-field cron expression e.g. "0 0 * * *"
  daysOfWeek: z.array(z.number().int().min(0).max(6)).optional(), // 0 = Sunday, 6 = Saturday
  active: z.boolean().default(true),
});
export type FreezeWindow = z.infer<typeof FreezeWindowSchema>;

export const BuiltinRoleSchema = z.enum([
  'admin',
  'sre',
  'lead',
  'developer',
  'auditor',
  'viewer',
]);
export type BuiltinRole = z.infer<typeof BuiltinRoleSchema>;

export const PermissionMaskSchema = z.enum([
  'read_only',
  'staging_mutate',
  'prod_mutate',
  'policy_admin',
  'audit_export',
]);
export type PermissionMask = z.infer<typeof PermissionMaskSchema>;

export const RoleToolPermissionsSchema = z.object({
  allow: z.array(z.string()).default([]),
  deny: z.array(z.string()).default([]),
});
export type RoleToolPermissions = z.infer<typeof RoleToolPermissionsSchema>;

export const TenantConfigSchema = z.object({
  tenantId: z.string().min(1),
  tier: TenantTierSchema,
  quotas: TenantQuotaSchema.default({}),
  freezeWindows: z.array(FreezeWindowSchema).default([]),
  allowedEnvironments: z.array(z.string()).default(['development', 'staging', 'production']),
  toolPermissions: z.record(z.string(), RoleToolPermissionsSchema).default({}),
  maxBlastRadius: z.number().int().nonnegative().default(10), // Maximum mutating tool calls per task
  customRoles: z.record(z.string(), z.array(PermissionMaskSchema)).optional(),
});
export type TenantConfig = z.infer<typeof TenantConfigSchema>;

export const TenantPolicySchema = TenantConfigSchema;
export type TenantPolicy = TenantConfig;

export const TenantPolicyEvaluationResultSchema = z.object({
  allowed: z.boolean(),
  action: PolicyActionSchema,
  reason: z.string().optional(),
  isFreezeWindowActive: z.boolean().default(false),
  blastRadiusExceeded: z.boolean().default(false),
  quotaExceeded: z.boolean().default(false),
  rbacDenied: z.boolean().default(false),
  activeFreezeWindows: z.array(z.string()).default([]),
});
export type TenantPolicyEvaluationResult = z.infer<typeof TenantPolicyEvaluationResultSchema>;

// ─────────────────────────────────────────────────────────────
// 2. Role Hierarchy & Built-In Permission Masks
// ─────────────────────────────────────────────────────────────

export const ROLE_HIERARCHY: Record<BuiltinRole, number> = {
  admin: 60,
  sre: 50,
  lead: 40,
  developer: 30,
  auditor: 20,
  viewer: 10,
};

export const DEFAULT_ROLE_PERMISSIONS: Record<BuiltinRole, readonly PermissionMask[]> = {
  admin: ['read_only', 'staging_mutate', 'prod_mutate', 'policy_admin', 'audit_export'],
  sre: ['read_only', 'staging_mutate', 'prod_mutate', 'audit_export'],
  lead: ['read_only', 'staging_mutate', 'prod_mutate', 'audit_export'],
  developer: ['read_only', 'staging_mutate', 'audit_export'],
  auditor: ['read_only', 'audit_export'],
  viewer: ['read_only'],
};

export function isRoleAtLeast(role: string, targetRole: BuiltinRole): boolean {
  const roleLower = role.toLowerCase() as BuiltinRole;
  const currentRank = ROLE_HIERARCHY[roleLower] ?? 0;
  const targetRank = ROLE_HIERARCHY[targetRole] ?? 0;
  return currentRank >= targetRank;
}

// ─────────────────────────────────────────────────────────────
// 3. Cron Pattern Matcher (Deterministic, Zero-Dependency)
// ─────────────────────────────────────────────────────────────

function matchesCronField(field: string, value: number): boolean {
  if (field === '*') {
    return true;
  }
  // Step: */N or 1-5/2
  if (field.includes('/')) {
    const [rangePart, stepPart] = field.split('/');
    const step = parseInt(stepPart ?? '1', 10);
    if (isNaN(step) || step <= 0) return false;
    if (rangePart === '*') {
      return value % step === 0;
    }
    const [startStr, endStr] = (rangePart ?? '').split('-');
    const start = parseInt(startStr ?? '0', 10);
    const end = parseInt(endStr ?? '0', 10);
    if (value < start || value > end) return false;
    return (value - start) % step === 0;
  }
  // List: 1,3,5
  if (field.includes(',')) {
    return field.split(',').some((part) => matchesCronField(part.trim(), value));
  }
  // Range: 1-5
  if (field.includes('-')) {
    const [startStr, endStr] = field.split('-');
    const start = parseInt(startStr ?? '0', 10);
    const end = parseInt(endStr ?? '0', 10);
    return value >= start && value <= end;
  }
  // Exact value
  const num = parseInt(field, 10);
  return !isNaN(num) && num === value;
}

export function matchesCron(expression: string, date: Date): boolean {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) {
    return false;
  }

  const minute = date.getUTCMinutes();
  const hour = date.getUTCHours();
  const dayOfMonth = date.getUTCDate();
  const month = date.getUTCMonth() + 1; // 1-12
  const dayOfWeek = date.getUTCDay(); // 0-6 (Sunday = 0)

  const [minPart, hrPart, domPart, monPart, dowPart] = parts;
  if (!minPart || !hrPart || !domPart || !monPart || !dowPart) {
    return false;
  }

  return (
    matchesCronField(minPart, minute) &&
    matchesCronField(hrPart, hour) &&
    matchesCronField(domPart, dayOfMonth) &&
    matchesCronField(monPart, month) &&
    matchesCronField(dowPart, dayOfWeek)
  );
}

// ─────────────────────────────────────────────────────────────
// 4. Tenant Policy Manager & Registry
// ─────────────────────────────────────────────────────────────

export class TenantPolicyManager {
  private readonly tenants = new Map<string, TenantConfig>();
  // tenantId -> timestamps of executions in milliseconds
  private readonly taskExecutionTimestamps = new Map<string, number[]>();
  // tenantId -> active concurrent taskIds
  private readonly activeConcurrentTasks = new Map<string, Set<string>>();
  // tenantId -> accumulated monthly cost in USD
  private readonly monthlySpendUsd = new Map<string, number>();
  // `${tenantId}:${taskId}` -> number of mutating tool invocations
  private readonly taskMutationCounts = new Map<string, number>();

  constructor(initialTenants: TenantConfig[] = []) {
    for (const tenant of initialTenants) {
      this.registerTenant(tenant);
    }
  }

  public registerTenant(config: TenantConfig): void {
    const parsed = TenantConfigSchema.parse(config);
    this.tenants.set(parsed.tenantId, parsed);
  }

  public getTenant(tenantId: string): TenantConfig | undefined {
    return this.tenants.get(tenantId);
  }

  public hasTenant(tenantId: string): boolean {
    return this.tenants.has(tenantId);
  }

  public removeTenant(tenantId: string): boolean {
    return this.tenants.delete(tenantId);
  }

  public listTenants(): readonly TenantConfig[] {
    return Array.from(this.tenants.values());
  }

  /**
   * Check if any freeze window is currently active for this tenant
   */
  public isFreezeWindowActive(
    tenantId: string,
    atTime: Date = new Date()
  ): { active: boolean; windows: FreezeWindow[] } {
    const tenant = this.tenants.get(tenantId);
    if (!tenant) {
      return { active: false, windows: [] };
    }

    const activeWindows: FreezeWindow[] = [];
    const currentTimeMs = atTime.getTime();
    const currentDayOfWeek = atTime.getUTCDay();

    for (const fw of tenant.freezeWindows) {
      if (!fw.active) continue;

      let isTriggered = false;

      // Check date range
      if (fw.startDate && fw.endDate) {
        const startMs = new Date(fw.startDate).getTime();
        const endMs = new Date(fw.endDate).getTime();
        if (currentTimeMs >= startMs && currentTimeMs <= endMs) {
          isTriggered = true;
        }
      } else if (fw.startDate && !fw.endDate) {
        const startMs = new Date(fw.startDate).getTime();
        if (currentTimeMs >= startMs) {
          isTriggered = true;
        }
      }

      // Check cron expression
      if (!isTriggered && fw.cronExpression) {
        if (matchesCron(fw.cronExpression, atTime)) {
          isTriggered = true;
        }
      }

      // Check days of week
      if (!isTriggered && fw.daysOfWeek && fw.daysOfWeek.length > 0) {
        if (fw.daysOfWeek.includes(currentDayOfWeek)) {
          isTriggered = true;
        }
      }

      if (isTriggered) {
        activeWindows.push(fw);
      }
    }

    return {
      active: activeWindows.length > 0,
      windows: activeWindows,
    };
  }

  /**
   * Evaluate whether a role has a specific permission mask under a tenant
   */
  public hasPermission(role: string, permission: PermissionMask, tenantId?: string): boolean {
    const roleNormalized = role.toLowerCase();
    const tenant = tenantId ? this.tenants.get(tenantId) : undefined;

    // Check custom roles first if defined on tenant
    if (tenant?.customRoles && tenant.customRoles[roleNormalized]) {
      const perms = tenant.customRoles[roleNormalized];
      return perms ? perms.includes(permission) : false;
    }

    // Fall back to built-in roles
    const builtinRole = roleNormalized as BuiltinRole;
    const permissions = DEFAULT_ROLE_PERMISSIONS[builtinRole];
    if (!permissions) {
      return false;
    }
    return permissions.includes(permission);
  }

  /**
   * Check whether a role can approve mutations.
   * Viewer and auditor can NEVER approve mutations.
   */
  public canRoleApproveMutation(role: string, tenantId?: string): boolean {
    const roleNormalized = role.toLowerCase();
    if (roleNormalized === 'viewer' || roleNormalized === 'auditor') {
      return false;
    }
    // Must possess policy_admin or prod_mutate or staging_mutate
    return (
      this.hasPermission(role, 'policy_admin', tenantId) ||
      this.hasPermission(role, 'prod_mutate', tenantId) ||
      this.hasPermission(role, 'staging_mutate', tenantId)
    );
  }

  /**
   * Check if role can execute mutations in environment
   */
  public canRoleMutateInEnvironment(
    role: string,
    environment: string,
    tenantId?: string
  ): boolean {
    const env = environment.toLowerCase();
    if (env === 'production') {
      return this.hasPermission(role, 'prod_mutate', tenantId);
    }
    if (env === 'staging') {
      return (
        this.hasPermission(role, 'staging_mutate', tenantId) ||
        this.hasPermission(role, 'prod_mutate', tenantId)
      );
    }
    // Development allows any role that has at least staging_mutate or is not read-only
    return (
      this.hasPermission(role, 'staging_mutate', tenantId) ||
      this.hasPermission(role, 'prod_mutate', tenantId) ||
      this.hasPermission(role, 'policy_admin', tenantId)
    );
  }

  /**
   * Check whether a role can invoke a specific tool under tenant permissions
   */
  public canRoleInvokeTool(role: string, toolName: string, tenantId?: string): boolean {
    if (!tenantId) return true;
    const tenant = this.tenants.get(tenantId);
    if (!tenant) return true;

    const rolePerms = tenant.toolPermissions[role.toLowerCase()];
    if (!rolePerms) {
      return true;
    }

    // Denylist check
    if (rolePerms.deny.includes(toolName) || rolePerms.deny.includes('*')) {
      return false;
    }

    // Allowlist check (if allow list is specified, tool must be in it)
    if (rolePerms.allow.length > 0) {
      return rolePerms.allow.includes(toolName) || rolePerms.allow.includes('*');
    }

    return true;
  }

  /**
   * Record a mutating tool invocation and verify blast radius limit
   */
  public recordMutation(
    tenantId: string,
    taskId: string
  ): { allowed: boolean; currentCount: number; maxAllowed: number } {
    const tenant = this.tenants.get(tenantId);
    const maxAllowed = tenant?.maxBlastRadius ?? 10;
    const key = `${tenantId}:${taskId}`;
    const current = (this.taskMutationCounts.get(key) ?? 0) + 1;
    this.taskMutationCounts.set(key, current);

    return {
      allowed: current <= maxAllowed,
      currentCount: current,
      maxAllowed,
    };
  }

  public getMutationCount(tenantId: string, taskId: string): number {
    return this.taskMutationCounts.get(`${tenantId}:${taskId}`) ?? 0;
  }

  /**
   * Record task start for rate-limiting and concurrency tracking
   */
  public recordTaskStart(
    tenantId: string,
    taskId: string,
    now: number = Date.now()
  ): { allowed: boolean; reason?: string } {
    const tenant = this.tenants.get(tenantId);
    if (!tenant) {
      return { allowed: true };
    }

    // 1. Concurrency limit check
    const activeTasks = this.activeConcurrentTasks.get(tenantId) ?? new Set<string>();
    if (activeTasks.size >= tenant.quotas.maxConcurrentExecutions) {
      return {
        allowed: false,
        reason: `Tenant '${tenantId}' exceeded max concurrent executions (${activeTasks.size}/${tenant.quotas.maxConcurrentExecutions})`,
      };
    }
    activeTasks.add(taskId);
    this.activeConcurrentTasks.set(tenantId, activeTasks);

    // 2. Tasks per minute rate limit check (rolling 60s window)
    const timestamps = (this.taskExecutionTimestamps.get(tenantId) ?? []).filter(
      (ts) => now - ts < 60_000
    );
    if (timestamps.length >= tenant.quotas.maxTasksPerMinute) {
      return {
        allowed: false,
        reason: `Tenant '${tenantId}' exceeded max tasks per minute rate limit (${timestamps.length}/${tenant.quotas.maxTasksPerMinute})`,
      };
    }
    timestamps.push(now);
    this.taskExecutionTimestamps.set(tenantId, timestamps);

    // 3. Monthly budget check
    const currentSpend = this.monthlySpendUsd.get(tenantId) ?? 0;
    if (currentSpend >= tenant.quotas.maxMonthlyBudgetUsd) {
      return {
        allowed: false,
        reason: `Tenant '${tenantId}' monthly budget exceeded ($${currentSpend.toFixed(2)} / $${tenant.quotas.maxMonthlyBudgetUsd.toFixed(2)})`,
      };
    }

    return { allowed: true };
  }

  /**
   * Complete task and track optional cost
   */
  public recordTaskEnd(tenantId: string, taskId: string, costUsd: number = 0): void {
    const activeTasks = this.activeConcurrentTasks.get(tenantId);
    if (activeTasks) {
      activeTasks.delete(taskId);
    }
    if (costUsd > 0) {
      const current = this.monthlySpendUsd.get(tenantId) ?? 0;
      this.monthlySpendUsd.set(tenantId, current + costUsd);
    }
    // Clean up task mutation count
    this.taskMutationCounts.delete(`${tenantId}:${taskId}`);
  }

  /**
   * Full tenant policy evaluation
   */
  public evaluateTenantPolicy(
    context: TaskContext,
    tenantId: string = context.tenantId ?? 'default',
    options: {
      isMutation?: boolean;
      toolName?: string;
      atTime?: Date;
    } = {}
  ): TenantPolicyEvaluationResult {
    const tenant = this.tenants.get(tenantId);
    const atTime = options.atTime ?? new Date();

    // If tenant not found and not default, reject with RBAC error
    if (!tenant && tenantId !== 'default') {
      return {
        allowed: false,
        action: 'BLOCK',
        reason: `Tenant '${tenantId}' is not registered`,
        isFreezeWindowActive: false,
        blastRadiusExceeded: false,
        quotaExceeded: false,
        rbacDenied: true,
        activeFreezeWindows: [],
      };
    }

    if (!tenant) {
      return {
        allowed: true,
        action: 'ALLOW',
        isFreezeWindowActive: false,
        blastRadiusExceeded: false,
        quotaExceeded: false,
        rbacDenied: false,
        activeFreezeWindows: [],
      };
    }

    // 1. Allowed environments check
    if (!tenant.allowedEnvironments.includes(context.environment)) {
      return {
        allowed: false,
        action: 'BLOCK',
        reason: `Environment '${context.environment}' is not whitelisted for tenant '${tenantId}'`,
        isFreezeWindowActive: false,
        blastRadiusExceeded: false,
        quotaExceeded: false,
        rbacDenied: true,
        activeFreezeWindows: [],
      };
    }

    // 2. Freeze window check
    const freezeCheck = this.isFreezeWindowActive(tenantId, atTime);
    if (freezeCheck.active && options.isMutation) {
      const activeNames = freezeCheck.windows.map((w) => w.name || w.id);
      return {
        allowed: false,
        action: 'BLOCK',
        reason: `Mutating operation blocked by active freeze window(s) for tenant '${tenantId}': ${activeNames.join(', ')}`,
        isFreezeWindowActive: true,
        blastRadiusExceeded: false,
        quotaExceeded: false,
        rbacDenied: false,
        activeFreezeWindows: activeNames,
      };
    }

    // 3. Tool permissions check
    if (options.toolName) {
      const canInvoke = this.canRoleInvokeTool(context.callerRole, options.toolName, tenantId);
      if (!canInvoke) {
        return {
          allowed: false,
          action: 'BLOCK',
          reason: `Tool '${options.toolName}' is prohibited for role '${context.callerRole}' in tenant '${tenantId}'`,
          isFreezeWindowActive: false,
          blastRadiusExceeded: false,
          quotaExceeded: false,
          rbacDenied: true,
          activeFreezeWindows: [],
        };
      }
    }

    // 4. RBAC check for mutating operations in environments
    if (options.isMutation) {
      const canMutate = this.canRoleMutateInEnvironment(
        context.callerRole,
        context.environment,
        tenantId
      );
      if (!canMutate) {
        return {
          allowed: false,
          action: 'BLOCK',
          reason: `Role '${context.callerRole}' does not possess mutation privileges in environment '${context.environment}' under tenant '${tenantId}'`,
          isFreezeWindowActive: false,
          blastRadiusExceeded: false,
          quotaExceeded: false,
          rbacDenied: true,
          activeFreezeWindows: [],
        };
      }
    }

    // 5. Blast radius check for mutating operations
    if (options.isMutation) {
      const currentMutations = this.getMutationCount(tenantId, context.taskId);
      if (currentMutations >= tenant.maxBlastRadius) {
        return {
          allowed: false,
          action: 'BLOCK',
          reason: `Blast radius limit exceeded for tenant '${tenantId}': maximum ${tenant.maxBlastRadius} mutating tool calls allowed per task (attempted: ${currentMutations + 1})`,
          isFreezeWindowActive: false,
          blastRadiusExceeded: true,
          quotaExceeded: false,
          rbacDenied: false,
          activeFreezeWindows: [],
        };
      }
    }

    return {
      allowed: true,
      action: 'ALLOW',
      isFreezeWindowActive: freezeCheck.active,
      blastRadiusExceeded: false,
      quotaExceeded: false,
      rbacDenied: false,
      activeFreezeWindows: freezeCheck.windows.map((w) => w.name || w.id),
    };
  }
}
