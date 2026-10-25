import type { TaskContext } from '../types/result.js';
import type { ReflexRoute } from '../types/route.js';
import type { JevDecisionBatch } from '../types/decision.js';
import type {
  PolicyConfig,
  PolicyRule,
  PolicyEvaluationResult,
} from '../types/policy.js';

export interface PolicyDecisionResolution {
  effectiveRoute: ReflexRoute;
  overrideApplied: boolean;
  overrideReason?: string;
  flaggedRules: string[];
}

export class PolicyEngine {
  private readonly confidenceThreshold: number;
  private readonly requireApprovalForMutations: boolean;
  private readonly maxComplexityBudget: number;
  private readonly rules: PolicyRule[];

  constructor(config: PolicyConfig = {}) {
    this.confidenceThreshold = config.confidenceThreshold ?? 0.75;
    this.requireApprovalForMutations = config.requireApprovalForMutations ?? false;
    this.maxComplexityBudget = config.maxComplexityBudget ?? 5;
    this.rules = config.rules ?? [];
  }

  public async evaluateJevDecision(
    context: TaskContext,
    decision: JevDecisionBatch
  ): Promise<PolicyDecisionResolution> {
    const flaggedRules: string[] = [];

    // 1. If Jev flagged a policy violation
    if (decision.policyViolation.isViolation) {
      if (decision.policyViolation.flaggedRules) {
        flaggedRules.push(...decision.policyViolation.flaggedRules);
      }
      return {
        effectiveRoute: 'BLOCK',
        overrideApplied: decision.route.selected !== 'BLOCK',
        overrideReason: 'Jev decision flagged policy violation',
        flaggedRules,
      };
    }

    // 2. Evaluate custom programmatic rules on context
    for (const rule of this.rules) {
      const isMatch = await rule.match(context);
      if (isMatch) {
        flaggedRules.push(rule.id);
        if (rule.action === 'BLOCK') {
          return {
            effectiveRoute: 'BLOCK',
            overrideApplied: true,
            overrideReason: `Blocked by policy rule: ${rule.description} (${rule.reason})`,
            flaggedRules,
          };
        }
        if (rule.action === 'REQUIRE_HUMAN_APPROVAL') {
          return {
            effectiveRoute: 'ASK_USER',
            overrideApplied: decision.route.selected !== 'ASK_USER',
            overrideReason: `Policy rule requires human confirmation: ${rule.description}`,
            flaggedRules,
          };
        }
      }
    }

    // 3. Complexity budget check
    if (decision.complexityScore.score > this.maxComplexityBudget) {
      return {
        effectiveRoute: 'ASK_USER',
        overrideApplied: true,
        overrideReason: `Complexity score ${decision.complexityScore.score} exceeds budget of ${this.maxComplexityBudget}`,
        flaggedRules,
      };
    }

    // 4. Low Confidence Escalation
    if (decision.route.confidence < this.confidenceThreshold) {
      // If low confidence and task requires mutation, escalate to ASK_USER
      if (decision.requiresMutation.willMutateState) {
        return {
          effectiveRoute: 'ASK_USER',
          overrideApplied: true,
          overrideReason: `Route confidence ${decision.route.confidence.toFixed(2)} is below threshold ${this.confidenceThreshold.toFixed(2)} and mutation was indicated`,
          flaggedRules,
        };
      }
      // If low confidence on FAST_PATH, escalate to CODE_MODE
      if (decision.route.selected === 'FAST_PATH') {
        return {
          effectiveRoute: 'CODE_MODE',
          overrideApplied: true,
          overrideReason: `Fast path confidence ${decision.route.confidence.toFixed(2)} is below threshold ${this.confidenceThreshold.toFixed(2)}; escalated to code mode`,
          flaggedRules,
        };
      }
    }

    // 5. Mutation Guard & Human Approval Policy
    // Axiom 1: Deterministic Policy Disposes
    if (decision.requiresMutation.willMutateState) {
      // Mutations in production always require human review if configured
      if (
        this.requireApprovalForMutations ||
        context.environment.toLowerCase() === 'production'
      ) {
        return {
          effectiveRoute: 'ASK_USER',
          overrideApplied: decision.route.selected !== 'ASK_USER',
          overrideReason: `State mutation in ${context.environment} requires human confirmation`,
          flaggedRules,
        };
      }

      // Fast path must never silently mutate state
      if (decision.route.selected === 'FAST_PATH') {
        return {
          effectiveRoute: 'CODE_MODE',
          overrideApplied: true,
          overrideReason: 'Fast path cannot execute unverified mutations; routed to Code Mode',
          flaggedRules,
        };
      }
    }

    // 6. Natural route acceptance
    return {
      effectiveRoute: decision.route.selected,
      overrideApplied: false,
      flaggedRules,
    };
  }

  public async evaluateToolInvocation(
    context: TaskContext,
    toolName: string,
    params: Record<string, unknown>,
    isMutation: boolean
  ): Promise<PolicyEvaluationResult> {
    const flaggedRules: string[] = [];

    // Check custom rules
    for (const rule of this.rules) {
      const isMatch = await rule.match(context, toolName, params);
      if (isMatch) {
        flaggedRules.push(rule.id);
        if (rule.action === 'BLOCK') {
          return {
            allowed: false,
            action: 'BLOCK',
            violationReason: `Tool ${toolName} invocation blocked by rule ${rule.id}: ${rule.reason}`,
            flaggedRules,
            requiresHumanReview: false,
          };
        }
        if (rule.action === 'REQUIRE_HUMAN_APPROVAL') {
          return {
            allowed: false,
            action: 'REQUIRE_HUMAN_APPROVAL',
            violationReason: `Tool ${toolName} requires human confirmation: ${rule.reason}`,
            flaggedRules,
            requiresHumanReview: true,
          };
        }
      }
    }

    // Mutation in production
    if (isMutation && context.environment.toLowerCase() === 'production' && this.requireApprovalForMutations) {
      return {
        allowed: false,
        action: 'REQUIRE_HUMAN_APPROVAL',
        violationReason: `Mutating tool ${toolName} in production requires explicit confirmation`,
        flaggedRules,
        requiresHumanReview: true,
      };
    }

    return {
      allowed: true,
      action: 'ALLOW',
      flaggedRules,
      requiresHumanReview: false,
    };
  }
}
