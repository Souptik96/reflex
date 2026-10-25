import { z } from 'zod';
import { TaskContextSchema, type TaskContext } from '../types/result.js';

export const PreflightErrorCodeSchema = z.enum([
  'SCHEMA_ERROR',
  'SAFETY_VIOLATION',
  'RBAC_DENIED',
  'QUOTA_EXCEEDED',
]);
export type PreflightErrorCode = z.infer<typeof PreflightErrorCodeSchema>;

export const PreflightValidationResultSchema = z.object({
  passed: z.boolean(),
  violationReason: z.string().optional(),
  flaggedPattern: z.string().optional(),
  errorCode: PreflightErrorCodeSchema.optional(),
});
export type PreflightValidationResult = z.infer<typeof PreflightValidationResultSchema>;

export const DEFAULT_FORBIDDEN_PATTERNS: readonly RegExp[] = [
  // Destructive bash/system commands
  /rm\s+-rf\s+[\/\*]/i,
  /:()\s*\{\s*:\|:&\s*\};:/i, // fork bomb
  /mkfs(\.[a-z0-9]+)?\s+/i,
  /dd\s+if=.*of=\/dev\/(sd[a-z]|nvme[0-9])/i,
  />\s*\/dev\/(sda|nvme[0-9]|null)/i,

  // Destructive SQL
  /DROP\s+(DATABASE|SCHEMA)\s+/i,
  /DROP\s+TABLE\s+/i,
  /TRUNCATE\s+TABLE\s+/i,

  // Exfiltration / sensitive system files
  /\/etc\/(passwd|shadow)/i,
  /\.aws\/credentials/i,
  /\.ssh\/id_(rsa|ed25519)/i,

  // Jailbreak / prompt injection markers
  /ignore\s+(all\s+)?previous\s+instructions/i,
  /disregard\s+all\s+(prior|safety)\s+rules/i,
  /you\s+are\s+now\s+in\s+DAN\s+mode/i,
];

export interface PreflightConfig {
  forbiddenPatterns?: RegExp[];
  maxTaskLength?: number;
  environmentRolePermissions?: Record<string, string[]>; // environment -> allowed roles
  allowedEnvironments?: string[];
  quotaChecker?: (context: TaskContext) => boolean | Promise<boolean>;
  tenantPolicyManager?: import('../policy/tenant.js').TenantPolicyManager;
}

const DEFAULT_ENVIRONMENT_ROLE_PERMISSIONS: Record<string, string[]> = {
  production: ['admin', 'sre', 'lead'],
  staging: ['admin', 'sre', 'lead', 'developer', 'qa'],
  development: ['admin', 'sre', 'lead', 'developer', 'qa', 'intern'],
};

export class PreflightValidator {
  private readonly forbiddenPatterns: RegExp[];
  private readonly maxTaskLength: number;
  private readonly environmentRolePermissions: Record<string, string[]>;
  private readonly allowedEnvironments: Set<string> | null;
  private readonly quotaChecker?: (context: TaskContext) => boolean | Promise<boolean>;
  private readonly tenantPolicyManager?: import('../policy/tenant.js').TenantPolicyManager;

  constructor(config: PreflightConfig = {}) {
    this.forbiddenPatterns = config.forbiddenPatterns ?? [...DEFAULT_FORBIDDEN_PATTERNS];
    this.maxTaskLength = config.maxTaskLength ?? 10_000;
    this.environmentRolePermissions =
      config.environmentRolePermissions ?? DEFAULT_ENVIRONMENT_ROLE_PERMISSIONS;
    this.allowedEnvironments = config.allowedEnvironments
      ? new Set(config.allowedEnvironments)
      : null;
    this.quotaChecker = config.quotaChecker;
    this.tenantPolicyManager = config.tenantPolicyManager;
  }

  public async validate(rawContext: unknown): Promise<PreflightValidationResult> {
    // 1. Zod Schema Validation
    const parseResult = TaskContextSchema.safeParse(rawContext);
    if (!parseResult.success) {
      const issue = parseResult.error.issues[0];
      const message = issue
        ? `${issue.path.join('.')}: ${issue.message}`
        : 'Invalid task context schema';
      return {
        passed: false,
        violationReason: `Schema validation failed: ${message}`,
        errorCode: 'SCHEMA_ERROR',
      };
    }

    const context = parseResult.data;

    // 2. Task Length & Quota Baseline Check
    if (context.task.length > this.maxTaskLength) {
      return {
        passed: false,
        violationReason: `Task length ${context.task.length} exceeds maximum allowed of ${this.maxTaskLength}`,
        errorCode: 'QUOTA_EXCEEDED',
      };
    }

    // 3. Hard Safety Regex Checks on Task text
    for (const pattern of this.forbiddenPatterns) {
      if (pattern.test(context.task)) {
        return {
          passed: false,
          violationReason: `Task matches prohibited safety pattern: ${pattern.source}`,
          flaggedPattern: pattern.source,
          errorCode: 'SAFETY_VIOLATION',
        };
      }
    }

    // 4. Allowed Environments Check
    if (this.allowedEnvironments && !this.allowedEnvironments.has(context.environment)) {
      return {
        passed: false,
        violationReason: `Environment '${context.environment}' is not permitted in configuration`,
        errorCode: 'RBAC_DENIED',
      };
    }

    // 5. Identity & RBAC Baseline
    const allowedRoles = this.environmentRolePermissions[context.environment.toLowerCase()];
    if (allowedRoles && !allowedRoles.includes(context.callerRole.toLowerCase())) {
      return {
        passed: false,
        violationReason: `Role '${context.callerRole}' is not authorized to execute tasks in environment '${context.environment}'`,
        errorCode: 'RBAC_DENIED',
      };
    }

    // 6. External Quota Checker (if registered)
    if (this.quotaChecker) {
      const quotaPassed = await this.quotaChecker(context);
      if (!quotaPassed) {
        return {
          passed: false,
          violationReason: `Task rejected: User or tenant quota exceeded`,
          errorCode: 'QUOTA_EXCEEDED',
        };
      }
    }

    // 7. Multi-Tenant Policy Evaluation (if registered and tenantId present)
    if (this.tenantPolicyManager) {
      const tenantId = context.tenantId ?? (context.metadata?.['tenantId'] as string | undefined);
      if (tenantId) {
        const startResult = this.tenantPolicyManager.recordTaskStart(tenantId, context.taskId);
        if (!startResult.allowed) {
          return {
            passed: false,
            violationReason: startResult.reason ?? `Tenant '${tenantId}' quota exceeded`,
            errorCode: 'QUOTA_EXCEEDED',
          };
        }

        const tenantResult = this.tenantPolicyManager.evaluateTenantPolicy(context, tenantId);
        if (!tenantResult.allowed) {
          const errorCode: PreflightErrorCode = tenantResult.quotaExceeded
            ? 'QUOTA_EXCEEDED'
            : tenantResult.isFreezeWindowActive
            ? 'SAFETY_VIOLATION'
            : 'RBAC_DENIED';
          return {
            passed: false,
            violationReason: tenantResult.reason ?? 'Blocked by tenant policy',
            errorCode,
          };
        }
      }
    }

    return { passed: true };
  }
}
