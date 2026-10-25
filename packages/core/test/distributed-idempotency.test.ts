import { describe, expect, it } from 'vitest';
import {
  DistributedIdempotencyManager,
  InMemoryDistributedLockProvider,
} from '../src/index.js';

describe('Distributed Idempotency & High-Concurrency Locking (@reflex-ai/core)', () => {
  it('handles atomic CAS locking and release in InMemoryDistributedLockProvider', async () => {
    const provider = new InMemoryDistributedLockProvider();
    const key = 'lock:payment_charge_01';

    // 1. First acquirer succeeds
    const acquired = await provider.acquireLock(key, 'worker_1', 1000);
    expect(acquired).toBe(true);

    // 2. Second acquirer with different owner fails
    const secondAcquired = await provider.acquireLock(key, 'worker_2', 1000);
    expect(secondAcquired).toBe(false);

    // 3. Re-entrant / owner extension succeeds
    const reentrant = await provider.acquireLock(key, 'worker_1', 2000);
    expect(reentrant).toBe(true);

    // 4. Release by wrong owner fails
    const badRelease = await provider.releaseLock(key, 'worker_2');
    expect(badRelease).toBe(false);

    // 5. Release by valid owner succeeds
    const goodRelease = await provider.releaseLock(key, 'worker_1');
    expect(goodRelease).toBe(true);

    // 6. Now second acquirer can acquire
    const afterRelease = await provider.acquireLock(key, 'worker_2', 1000);
    expect(afterRelease).toBe(true);
  });

  it('runs 100 concurrent racers with identical key: exactly 1 executes mutation, 99 get cached results', async () => {
    const manager = new DistributedIdempotencyManager();
    const idempotencyKey = 'order_mutation_race_condition_999';

    let mutationExecutionCount = 0;

    const executeTask = async (racerId: number) => {
      return manager.executeWithIdempotency(
        idempotencyKey,
        `task_racer_${racerId}`,
        async () => {
          // Mutating side-effect work simulation
          mutationExecutionCount++;
          await new Promise((resolve) => setTimeout(resolve, 25)); // simulate network delay
          return {
            result: { chargeId: 'ch_live_999888', amount: 5000, currency: 'usd' },
            httpStatus: 200,
          };
        },
        {
          ttlMs: 60_000,
          lockTimeoutMs: 3000,
          pollIntervalMs: 5,
        }
      );
    };

    // Spawn 100 concurrent racing requests
    const racers = Array.from({ length: 100 }, (_, i) => executeTask(i));
    const results = await Promise.all(racers);

    // CRITICAL INVARIANT: Mutating side-effect happened EXACTLY ONCE
    expect(mutationExecutionCount).toBe(1);

    // Exactly 1 caller ran the function; 99 received cached results
    const executedRacers = results.filter((r) => !r.cached);
    const cachedRacers = results.filter((r) => r.cached);

    expect(executedRacers).toHaveLength(1);
    expect(cachedRacers).toHaveLength(99);

    // All 100 racers received identical results and HTTP 200 status
    for (const res of results) {
      expect(res.httpStatus).toBe(200);
      expect(res.result).toEqual({ chargeId: 'ch_live_999888', amount: 5000, currency: 'usd' });
    }
  });

  it('expires deduplication key after TTL window, allowing subsequent execution', async () => {
    const provider = new InMemoryDistributedLockProvider();
    const manager = new DistributedIdempotencyManager(provider);
    const idempotencyKey = 'temporary_short_lived_key';

    let runs = 0;
    const taskFn = async () => {
      runs++;
      return {
        result: { runNumber: runs },
        httpStatus: 200,
      };
    };

    // 1. Initial run with very short TTL (50ms)
    const run1 = await manager.executeWithIdempotency(
      idempotencyKey,
      'task_1',
      taskFn,
      { ttlMs: 50 }
    );
    expect(run1.cached).toBe(false);
    expect(runs).toBe(1);

    // 2. Immediate second call receives cached result
    const run2 = await manager.executeWithIdempotency(
      idempotencyKey,
      'task_2',
      taskFn,
      { ttlMs: 50 }
    );
    expect(run2.cached).toBe(true);
    expect(runs).toBe(1);

    // 3. Wait for TTL window to elapse (> 50ms)
    await new Promise((resolve) => setTimeout(resolve, 60));

    // 4. Third call after TTL expiration re-executes task
    const run3 = await manager.executeWithIdempotency(
      idempotencyKey,
      'task_3',
      taskFn,
      { ttlMs: 50 }
    );
    expect(run3.cached).toBe(false);
    expect(runs).toBe(2);
    expect(run3.result.runNumber).toBe(2);
  });

  it('records failure and releases lock if task function throws exception', async () => {
    const manager = new DistributedIdempotencyManager();
    const idempotencyKey = 'faulty_tool_key';

    await expect(
      manager.executeWithIdempotency(
        idempotencyKey,
        'task_fail',
        async () => {
          throw new Error('Database connection reset');
        }
      )
    ).rejects.toThrow('Database connection reset');

    const record = await manager.getLockProvider().getRecord(idempotencyKey);
    expect(record?.status).toBe('FAILED');
    expect(record?.error).toBe('Database connection reset');

    // Verify lock was released so it is not deadlocked
    const canAcquire = await manager.getLockProvider().acquireLock(idempotencyKey, 'subsequent_task', 1000);
    expect(canAcquire).toBe(true);
  });
});
