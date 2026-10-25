import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { ApprovalRequest, MutationApprovalGate } from '@reflex-ai/core';

export const SlackApprovalActionSchema = z.enum(['approve', 'reject']);
export type SlackApprovalAction = z.infer<typeof SlackApprovalActionSchema>;

export const SlackApprovalTokenPayloadSchema = z.object({
  approvalId: z.string(),
  taskId: z.string(),
  requestedRoute: z.string(),
  requiresMutation: z.boolean(),
  reason: z.string(),
  createdAt: z.string(),
  expiresAt: z.number(),
});
export type SlackApprovalTokenPayload = z.infer<typeof SlackApprovalTokenPayloadSchema>;

export interface SlackBlockKitPayload {
  channel?: string;
  text: string;
  blocks: Array<Record<string, unknown>>;
}

export interface ApprovalPayloadResult {
  token: string;
  signature: string;
  payload: SlackApprovalTokenPayload;
  slackBlocks?: SlackBlockKitPayload;
}

export interface VerifyCallbackResult {
  valid: boolean;
  payload?: SlackApprovalTokenPayload;
  error?: string;
}

export interface DispatchCallbackParams {
  token: string;
  signature: string;
  secret?: string;
  action: SlackApprovalAction;
  reviewer?: string;
}

export class SlackApprovalBridge {
  private readonly defaultSecret?: string;
  private readonly defaultTtlMs: number;

  constructor(options: { secret?: string; ttlMs?: number } = {}) {
    this.defaultSecret = options.secret;
    this.defaultTtlMs = options.ttlMs ?? 15 * 60 * 1000; // 15 minutes default TTL
  }

  public createApprovalPayload(
    request: ApprovalRequest,
    secret?: string,
    ttlMs?: number
  ): ApprovalPayloadResult {
    const activeSecret = secret ?? this.defaultSecret;
    if (!activeSecret) {
      throw new Error('Secret is required to create signed approval payload');
    }

    const expiresAt = Date.now() + (ttlMs ?? this.defaultTtlMs);
    const payload: SlackApprovalTokenPayload = {
      approvalId: request.approvalId,
      taskId: request.taskId,
      requestedRoute: request.requestedRoute,
      requiresMutation: request.requiresMutation,
      reason: request.reason,
      createdAt: request.createdAt,
      expiresAt,
    };

    const token = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = this.computeSignature(token, activeSecret);
    const slackBlocks = this.formatSlackBlocks(request, token, signature);

    return {
      token,
      signature,
      payload,
      slackBlocks,
    };
  }

  public verifyApprovalCallback(
    token: string,
    signature: string,
    secret?: string
  ): VerifyCallbackResult {
    const activeSecret = secret ?? this.defaultSecret;
    if (!activeSecret) {
      return { valid: false, error: 'Missing HMAC verification secret' };
    }

    const expectedSignature = this.computeSignature(token, activeSecret);

    if (
      signature.length !== expectedSignature.length ||
      !timingSafeEqual(Buffer.from(signature, 'utf8'), Buffer.from(expectedSignature, 'utf8'))
    ) {
      return { valid: false, error: 'Invalid HMAC signature' };
    }

    try {
      const decodedJson = Buffer.from(token, 'base64url').toString('utf8');
      const parsed = SlackApprovalTokenPayloadSchema.safeParse(JSON.parse(decodedJson));
      if (!parsed.success) {
        return { valid: false, error: 'Malformed token payload structure' };
      }

      if (Date.now() > parsed.data.expiresAt) {
        return { valid: false, error: 'Approval token has expired' };
      }

      return { valid: true, payload: parsed.data };
    } catch {
      return { valid: false, error: 'Failed to decode approval token' };
    }
  }

  public dispatchApprovalCallback(
    params: DispatchCallbackParams,
    gate: MutationApprovalGate
  ): ApprovalRequest {
    const verification = this.verifyApprovalCallback(
      params.token,
      params.signature,
      params.secret ?? this.defaultSecret
    );

    if (!verification.valid || !verification.payload) {
      throw new Error(`Approval callback rejected: ${verification.error ?? 'Invalid signature'}`);
    }

    const reviewer = params.reviewer ?? 'slack_webhook';
    if (params.action === 'approve') {
      return gate.approve(verification.payload.approvalId, reviewer);
    } else {
      return gate.reject(verification.payload.approvalId, reviewer);
    }
  }

  public computeSignature(token: string, secret: string): string {
    return createHmac('sha256', secret).update(token).digest('hex');
  }

  public formatSlackBlocks(
    request: ApprovalRequest,
    token: string,
    signature: string
  ): SlackBlockKitPayload {
    return {
      text: `Reflex Approval Request: ${request.reason} (Task: ${request.taskId})`,
      blocks: [
        {
          type: 'header',
          text: {
            type: 'plain_text',
            text: '⚠️ Reflex Mutation Approval Required',
            emoji: true,
          },
        },
        {
          type: 'section',
          fields: [
            { type: 'mrkdwn', text: `*Task ID:*\n\`${request.taskId}\`` },
            { type: 'mrkdwn', text: `*Approval ID:*\n\`${request.approvalId}\`` },
            { type: 'mrkdwn', text: `*Requested Route:*\n\`${request.requestedRoute}\`` },
            { type: 'mrkdwn', text: `*Requires Mutation:*\n\`${request.requiresMutation}\`` },
          ],
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Reason:*\n${request.reason}`,
          },
        },
        {
          type: 'actions',
          elements: [
            {
              type: 'button',
              text: { type: 'plain_text', text: 'Approve', emoji: true },
              style: 'primary',
              value: JSON.stringify({ action: 'approve', token, signature }),
              action_id: 'reflex_approve_button',
            },
            {
              type: 'button',
              text: { type: 'plain_text', text: 'Reject', emoji: true },
              style: 'danger',
              value: JSON.stringify({ action: 'reject', token, signature }),
              action_id: 'reflex_reject_button',
            },
          ],
        },
      ],
    };
  }
}
