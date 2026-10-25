# Enterprise Governance & Multi-Tenant RBAC

Reflex provides enterprise-grade governance controls designed to isolate execution namespaces, prevent runaway mutations, enforce deployment freeze windows, and restrict sensitive tool operations according to granular Role-Based Access Control (RBAC).

---

## 1. Multi-Tenant Architecture & Data Model

Every task executed within Reflex can be scoped to an isolated `tenantId`. Tenant configuration governs execution quotas, permitted environments, tool allowlists, and deployment freeze windows.

### Schema Definition (`@reflex-ai/core`)

```typescript
import { z } from 'zod';

export const TenantConfigSchema = z.object({
  tenantId: z.string().min(1),
  tier: z.enum(['free', 'starter', 'enterprise']),
  quotas: z.object({
    maxTasksPerMinute: z.number().int().positive().default(60),
    maxConcurrentExecutions: z.number().int().positive().default(10),
    maxMonthlyBudgetUsd: z.number().nonnegative().default(1000),
  }),
  freezeWindows: z.array(FreezeWindowSchema).default([]),
  allowedEnvironments: z.array(z.string()).default(['development', 'staging', 'production']),
  toolPermissions: z.record(z.string(), RoleToolPermissionsSchema).default({}),
  maxBlastRadius: z.number().int().nonnegative().default(10),
  customRoles: z.record(z.string(), z.array(PermissionMaskSchema)).optional(),
});
```

---

## 2. Role-Based Access Control (RBAC) Hierarchy

Reflex defines a deterministic role hierarchy ranking:

```
admin (60) > sre (50) > lead (40) > developer (30) > auditor (20) > viewer (10)
```

### Granular Permission Masks

| Permission Mask | Description | Default Roles |
| :--- | :--- | :--- |
| `read_only` | Execute pure reads, queries, and diagnostics | `admin`, `sre`, `lead`, `developer`, `auditor`, `viewer` |
| `staging_mutate` | Perform mutating actions in `development` or `staging` | `admin`, `sre`, `lead`, `developer` |
| `prod_mutate` | Execute live production modifications or deployments | `admin`, `sre`, `lead` |
| `policy_admin` | Modify tenant policies, approve exceptions, register freezes | `admin` |
| `audit_export` | Export and inspect cryptographic Evidence Ledgers | `admin`, `sre`, `lead`, `developer`, `auditor` |

### Custom Enterprise Roles

Tenants on the `enterprise` tier can define custom roles mapped to specific permission masks:

```typescript
const customTenant: TenantConfig = {
  tenantId: 'fintech-corp',
  tier: 'enterprise',
  customRoles: {
    security_officer: ['read_only', 'audit_export', 'policy_admin'],
    compliance_bot: ['read_only', 'audit_export'],
    migration_runner: ['staging_mutate', 'prod_mutate'],
  },
  // ...
};
```

### Approval Gate Invariant

Under Reflex Axiom 1, `viewer` and `auditor` roles are cryptographically and deterministically prohibited from approving mutations:

```typescript
// Throws Error: Role 'viewer' is not authorized to approve mutations
gate.approve(approvalId, 'alice_operator', 'viewer');
```

---

## 3. Freeze Windows (Change Management & Deployment Freezes)

Freeze windows block mutating operations during critical periods (holidays, peak shopping events, quarterly financial closes, or maintenance outages). Non-mutating read-only tasks (e.g. system diagnostics, log inspections) continue to execute normally.

### Supported Freeze Window Configurations

1. **Calendar Date-Time Ranges**:
   ```typescript
   {
     id: 'fw-q4-deploy-freeze',
     name: 'Year-End Code Freeze',
     startDate: '2026-12-20T00:00:00.000Z',
     endDate: '2027-01-05T23:59:59.000Z',
     active: true,
   }
   ```
2. **Cron Expressions (UTC)**:
   ```typescript
   {
     id: 'fw-daily-backup',
     name: 'Daily 02:00 UTC Database Backup Window',
     cronExpression: '0 2 * * *',
     active: true,
   }
   ```
3. **Day-of-Week Freezes (e.g. Weekend Deploy Freeze)**:
   ```typescript
   {
     id: 'fw-weekend-freeze',
     name: 'Weekend Production Freeze',
     daysOfWeek: [0, 6], // Sunday = 0, Saturday = 6
     active: true,
   }
   ```

---

## 4. Blast Radius Control

To prevent runaway loops or rogue generative code synthesis from modifying hundreds of external resources, tenants enforce a strict `maxBlastRadius`:

- The host authorization boundary (`HostToolProxy`) tracks mutating tool invocations per task ID.
- Once the count exceeds `tenant.maxBlastRadius`, any further mutating tool invocation is intercepted and rejected with an HTTP 429 response.
- The violation is immutably recorded in the `EvidenceLedger`.

```typescript
const tenant: TenantConfig = {
  tenantId: 'payments-service',
  tier: 'starter',
  maxBlastRadius: 3, // At most 3 mutations per single task
  // ...
};
```

---

## 5. Multi-Tenant Cross-Boundary Isolation

Reflex guarantees strict isolation across tenants:
- **Environment Isolation**: Tenant A cannot execute in `production` if its whitelisted environments only include `['staging']`, even if other tenants have access.
- **Quota Independence**: Rate limits (tasks per minute) and concurrency counters are tracked in memory per tenant namespace.
- **Freeze Isolation**: A freeze window active in Tenant A never impedes executions in Tenant B.
- **Ledger Scoping**: Evidence ledgers and cryptographic audit logs record tenant IDs for auditable SOC 2 and ISO 27001 compliance.
