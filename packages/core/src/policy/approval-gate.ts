import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { TaskContext } from '../types/result.js';
import type { ReflexRoute } from '../types/route.js';

export const ApprovalStatusSchema = z.enum(['PENDING', 'APPROVED', 'REJECTED']);
export type ApprovalStatus = z.infer<typeof ApprovalStatusSchema>;

export const ApprovalRequestSchema = z.object({
  approvalId: z.string(),
  taskId: z.string(),
  context: z.unknown(),
  requestedRoute: z.string(),
  requiresMutation: z.boolean(),
  reason: z.string(),
  createdAt: z.string(),
  status: ApprovalStatusSchema,
  reviewedAt: z.string().optional(),
  reviewer: z.string().optional(),
  reviewerRole: z.string().optional(),
});
export type ApprovalRequest = z.infer<typeof ApprovalRequestSchema>;

export class MutationApprovalGate {
  private readonly pendingRequests = new Map<string, ApprovalRequest>();
  private readonly tenantPolicyManager?: import('./tenant.js').TenantPolicyManager;

  constructor(options: { tenantPolicyManager?: import('./tenant.js').TenantPolicyManager } = {}) {
    this.tenantPolicyManager = options.tenantPolicyManager;
  }

  public createRequest(
    context: TaskContext,
    requestedRoute: ReflexRoute,
    requiresMutation: boolean,
    reason: string
  ): ApprovalRequest {
    const approvalId = `appr_${randomUUID().replace(/-/g, '').slice(0, 10)}`;
    const request: ApprovalRequest = {
      approvalId,
      taskId: context.taskId,
      context,
      requestedRoute,
      requiresMutation,
      reason,
      createdAt: new Date().toISOString(),
      status: 'PENDING',
    };

    this.pendingRequests.set(approvalId, request);
    return request;
  }

  public approve(
    approvalId: string,
    reviewer: string = 'human_operator',
    reviewerRole?: string
  ): ApprovalRequest {
    const request = this.pendingRequests.get(approvalId);
    if (!request) {
      throw new Error(`Approval request '${approvalId}' not found`);
    }

    if (reviewerRole) {
      const roleNormalized = reviewerRole.toLowerCase();
      if (roleNormalized === 'viewer' || roleNormalized === 'auditor') {
        throw new Error(`Role '${reviewerRole}' is not authorized to approve mutations`);
      }
      if (this.tenantPolicyManager) {
        const tenantId = (request.context as TaskContext | undefined)?.tenantId;
        const allowed = this.tenantPolicyManager.canRoleApproveMutation(reviewerRole, tenantId);
        if (!allowed) {
          throw new Error(
            `Role '${reviewerRole}' is not authorized to approve mutations under tenant '${tenantId ?? 'default'}'`
          );
        }
      }
    }

    request.status = 'APPROVED';
    request.reviewedAt = new Date().toISOString();
    request.reviewer = reviewer;
    if (reviewerRole) {
      request.reviewerRole = reviewerRole;
    }
    return request;
  }

  public reject(approvalId: string, reviewer: string = 'human_operator'): ApprovalRequest {
    const request = this.pendingRequests.get(approvalId);
    if (!request) {
      throw new Error(`Approval request '${approvalId}' not found`);
    }

    request.status = 'REJECTED';
    request.reviewedAt = new Date().toISOString();
    request.reviewer = reviewer;
    return request;
  }

  public getRequest(approvalId: string): ApprovalRequest | undefined {
    return this.pendingRequests.get(approvalId);
  }

  public isApproved(approvalId: string): boolean {
    const req = this.pendingRequests.get(approvalId);
    return req ? req.status === 'APPROVED' : false;
  }

  public listPending(): readonly ApprovalRequest[] {
    return Array.from(this.pendingRequests.values()).filter(
      (r) => r.status === 'PENDING'
    );
  }
}
