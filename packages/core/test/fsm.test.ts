import { describe, it, expect } from 'vitest';
import { ExecutionStateMachine } from '../src/state-machine/fsm.js';

describe('ExecutionStateMachine', () => {
  it('starts in PREFLIGHT state', () => {
    const fsm = new ExecutionStateMachine();
    expect(fsm.getCurrentState()).toBe('PREFLIGHT');
    expect(fsm.isTerminal()).toBe(false);
    expect(fsm.getHistory()).toHaveLength(0);
  });

  it('allows valid transitions for fast path flow', () => {
    const fsm = new ExecutionStateMachine();

    fsm.transition('JEV_DECISION', 'Preflight passed');
    expect(fsm.getCurrentState()).toBe('JEV_DECISION');

    fsm.transition('FAST_PATH_EXEC', 'Selected FAST_PATH');
    expect(fsm.getCurrentState()).toBe('FAST_PATH_EXEC');

    fsm.transition('VERIFICATION', 'Output ready');
    expect(fsm.getCurrentState()).toBe('VERIFICATION');

    fsm.transition('VERIFIED_SUCCESS', 'Assertions passed');
    expect(fsm.getCurrentState()).toBe('VERIFIED_SUCCESS');
    expect(fsm.isTerminal()).toBe(true);

    const history = fsm.getHistory();
    expect(history).toHaveLength(4);
    expect(history[0]?.from).toBe('PREFLIGHT');
    expect(history[0]?.to).toBe('JEV_DECISION');
    expect(history[3]?.to).toBe('VERIFIED_SUCCESS');
  });

  it('allows valid transitions for code mode flow', () => {
    const fsm = new ExecutionStateMachine();

    fsm.transition('JEV_DECISION');
    fsm.transition('CODE_MODE_SYNTH');
    fsm.transition('CODE_MODE_EXEC');
    fsm.transition('VERIFICATION');
    fsm.transition('UNVERIFIED_SUCCESS');

    expect(fsm.getCurrentState()).toBe('UNVERIFIED_SUCCESS');
    expect(fsm.isTerminal()).toBe(true);
  });

  it('allows direct transition to BLOCKED_BY_POLICY from PREFLIGHT', () => {
    const fsm = new ExecutionStateMachine();
    fsm.transition('BLOCKED_BY_POLICY', 'Forbidden regex match');
    expect(fsm.getCurrentState()).toBe('BLOCKED_BY_POLICY');
    expect(fsm.isTerminal()).toBe(true);
  });

  it('allows transition to HUMAN_REVIEW from JEV_DECISION', () => {
    const fsm = new ExecutionStateMachine();
    fsm.transition('JEV_DECISION');
    fsm.transition('HUMAN_REVIEW', 'Production mutation requires review');
    expect(fsm.getCurrentState()).toBe('HUMAN_REVIEW');
    expect(fsm.isTerminal()).toBe(true);
  });

  it('allows transition to SYSTEM_FALLBACK from JEV_DECISION', () => {
    const fsm = new ExecutionStateMachine();
    fsm.transition('JEV_DECISION');
    fsm.transition('SYSTEM_FALLBACK', 'Network timeout on decision model');
    expect(fsm.getCurrentState()).toBe('SYSTEM_FALLBACK');
    expect(fsm.isTerminal()).toBe(true);
  });

  it('throws on illegal transition', () => {
    const fsm = new ExecutionStateMachine();
    // Cannot jump from PREFLIGHT straight to CODE_MODE_EXEC
    expect(() => fsm.transition('CODE_MODE_EXEC')).toThrowError(
      /Invalid state transition: PREFLIGHT -> CODE_MODE_EXEC/
    );
  });

  it('throws on transition from terminal state', () => {
    const fsm = new ExecutionStateMachine();
    fsm.transition('BLOCKED_BY_POLICY');
    expect(() => fsm.transition('JEV_DECISION')).toThrowError(
      /Cannot transition from terminal state/
    );
  });
});
