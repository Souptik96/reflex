import type {
  DecisionCache,
  FastPathCompiler,
  ILedgerStore,
  IReflexTracer,
  MutationApprovalGate,
  PolicyConfig,
  PreflightConfig,
  TaskContext,
  TenantPolicyManager,
} from '@reflex-ai/core';
import type { JevClient, JevClientConfig } from '@reflex-ai/jev';
import type { HostToolProxy, ICodeSynthesisProvider, ToolHandler } from '@reflex-ai/cloudflare';
import type {
  LedgerSigner,
  SemanticEvaluator,
  VerificationContract,
  VerificationEngine,
} from '@reflex-ai/verify';

export type FastPathHandler<TOutput = unknown> = (
  context: TaskContext
) => Promise<TOutput> | TOutput;

export type CodeSynthesizer = (
  context: TaskContext
) => Promise<string> | string;

export interface ReflexAgentConfig {
  policyConfig?: PolicyConfig;
  preflightConfig?: PreflightConfig;
  tenantPolicyManager?: TenantPolicyManager;
  jevConfig?: JevClientConfig;
  jevClient?: JevClient;
  hostToolProxy?: HostToolProxy;
  verificationEngine?: VerificationEngine;
  approvalGate?: MutationApprovalGate;
  semanticEvaluator?: SemanticEvaluator;
  fastPathHandlers?: Record<string, FastPathHandler>;
  fastPathCompiler?: FastPathCompiler;
  decisionCache?: DecisionCache;
  codeSynthesizer?: CodeSynthesizer;
  codeSynthesisProvider?: ICodeSynthesisProvider;
  ledgerSigner?: LedgerSigner;
  ledgerStore?: ILedgerStore;
  tracer?: IReflexTracer;
}

export interface RunOptions {
  verificationContract?: VerificationContract;
  script?: string; // Explicit script override for Code Mode testing
  timeoutMs?: number;
  approvalId?: string; // Provide to resume an approved mutation
  tracer?: IReflexTracer;
  decisionCache?: DecisionCache;
  fastPathCompiler?: FastPathCompiler;
}

export interface RegisterToolOptions {
  name: string;
  isMutation: boolean;
  handler: ToolHandler;
  description?: string;
}
