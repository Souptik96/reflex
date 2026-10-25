import { z } from 'zod';

export const ExecutionStateSchema = z.enum([
  'PREFLIGHT',
  'JEV_DECISION',
  'FAST_PATH_EXEC',
  'CODE_MODE_SYNTH',
  'CODE_MODE_EXEC',
  'VERIFICATION',
  'VERIFIED_SUCCESS',
  'UNVERIFIED_SUCCESS',
  'EXECUTION_FAILED',
  'VERIFICATION_FAILED',
  'BLOCKED_BY_POLICY',
  'HUMAN_REVIEW',
  'SYSTEM_FALLBACK',
]);
export type ExecutionState = z.infer<typeof ExecutionStateSchema>;

export const StateTransitionRecordSchema = z.object({
  from: ExecutionStateSchema,
  to: ExecutionStateSchema,
  timestamp: z.string(),
  epochMs: z.number(),
  reason: z.string().optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
});
export type StateTransitionRecord = z.infer<typeof StateTransitionRecordSchema>;

const TERMINAL_STATES: ReadonlySet<ExecutionState> = new Set([
  'VERIFIED_SUCCESS',
  'UNVERIFIED_SUCCESS',
  'EXECUTION_FAILED',
  'VERIFICATION_FAILED',
  'BLOCKED_BY_POLICY',
  'HUMAN_REVIEW',
  'SYSTEM_FALLBACK',
]);

const ALLOWED_TRANSITIONS: Readonly<Record<ExecutionState, ReadonlySet<ExecutionState>>> = {
  PREFLIGHT: new Set(['BLOCKED_BY_POLICY', 'JEV_DECISION', 'FAST_PATH_EXEC']),
  JEV_DECISION: new Set([
    'FAST_PATH_EXEC',
    'CODE_MODE_SYNTH',
    'HUMAN_REVIEW',
    'BLOCKED_BY_POLICY',
    'SYSTEM_FALLBACK',
  ]),
  FAST_PATH_EXEC: new Set(['VERIFICATION', 'EXECUTION_FAILED']),
  CODE_MODE_SYNTH: new Set(['CODE_MODE_EXEC', 'EXECUTION_FAILED']),
  CODE_MODE_EXEC: new Set(['VERIFICATION', 'EXECUTION_FAILED']),
  VERIFICATION: new Set([
    'VERIFIED_SUCCESS',
    'UNVERIFIED_SUCCESS',
    'VERIFICATION_FAILED',
    'EXECUTION_FAILED',
  ]),
  VERIFIED_SUCCESS: new Set(),
  UNVERIFIED_SUCCESS: new Set(),
  EXECUTION_FAILED: new Set(),
  VERIFICATION_FAILED: new Set(),
  BLOCKED_BY_POLICY: new Set(),
  HUMAN_REVIEW: new Set(),
  SYSTEM_FALLBACK: new Set(),
};

export class ExecutionStateMachine {
  private currentState: ExecutionState = 'PREFLIGHT';
  private readonly history: StateTransitionRecord[] = [];

  public getCurrentState(): ExecutionState {
    return this.currentState;
  }

  public getHistory(): readonly StateTransitionRecord[] {
    return [...this.history];
  }

  public isTerminal(): boolean {
    return TERMINAL_STATES.has(this.currentState);
  }

  public canTransitionTo(nextState: ExecutionState): boolean {
    const allowed = ALLOWED_TRANSITIONS[this.currentState];
    return allowed ? allowed.has(nextState) : false;
  }

  public transition(
    to: ExecutionState,
    reason?: string,
    payload?: Record<string, unknown>
  ): StateTransitionRecord {
    if (this.isTerminal()) {
      throw new Error(
        `Cannot transition from terminal state ${this.currentState} to ${to}`
      );
    }

    if (!this.canTransitionTo(to)) {
      throw new Error(
        `Invalid state transition: ${this.currentState} -> ${to}`
      );
    }

    const from = this.currentState;
    this.currentState = to;

    const record: StateTransitionRecord = {
      from,
      to,
      timestamp: new Date().toISOString(),
      epochMs: performance.timeOrigin + performance.now(),
      reason,
      payload,
    };

    this.history.push(record);
    return record;
  }
}
