import type { IdempotencyRecord } from './manager.js';

export interface IDistributedLockProvider {
  acquireLock(key: string, ownerId: string, ttlMs: number): Promise<boolean>;
  releaseLock(key: string, ownerId: string): Promise<boolean>;
  getRecord(key: string): Promise<IdempotencyRecord | undefined>;
  setRecord(key: string, record: IdempotencyRecord, ttlMs?: number): Promise<void>;
  deleteKey(key: string): Promise<boolean>;
  clear(): Promise<void>;
}

interface LockEntry {
  ownerId: string;
  expiresAt: number;
}

interface RecordEntry {
  record: IdempotencyRecord;
  expiresAt?: number;
}

export class InMemoryDistributedLockProvider implements IDistributedLockProvider {
  private readonly locks = new Map<string, LockEntry>();
  private readonly records = new Map<string, RecordEntry>();

  public async acquireLock(
    key: string,
    ownerId: string,
    ttlMs: number
  ): Promise<boolean> {
    const now = Date.now();
    const existing = this.locks.get(key);

    if (existing && existing.expiresAt > now) {
      if (existing.ownerId === ownerId) {
        // Re-entrant lock extension
        existing.expiresAt = now + ttlMs;
        return true;
      }
      return false;
    }

    this.locks.set(key, {
      ownerId,
      expiresAt: now + ttlMs,
    });
    return true;
  }

  public async releaseLock(key: string, ownerId: string): Promise<boolean> {
    const existing = this.locks.get(key);
    if (!existing) return true;

    if (existing.ownerId === ownerId || existing.expiresAt <= Date.now()) {
      this.locks.delete(key);
      return true;
    }

    return false;
  }

  public async getRecord(key: string): Promise<IdempotencyRecord | undefined> {
    const entry = this.records.get(key);
    if (!entry) return undefined;

    if (entry.expiresAt && entry.expiresAt <= Date.now()) {
      this.records.delete(key);
      return undefined;
    }

    return entry.record;
  }

  public async setRecord(
    key: string,
    record: IdempotencyRecord,
    ttlMs?: number
  ): Promise<void> {
    this.records.set(key, {
      record,
      expiresAt: ttlMs ? Date.now() + ttlMs : undefined,
    });
  }

  public async deleteKey(key: string): Promise<boolean> {
    const hadRecord = this.records.delete(key);
    const hadLock = this.locks.delete(key);
    return hadRecord || hadLock;
  }

  public async clear(): Promise<void> {
    this.locks.clear();
    this.records.clear();
  }
}

export interface ExecuteWithIdempotencyOptions {
  ttlMs?: number;
  lockTimeoutMs?: number;
  pollIntervalMs?: number;
}

export interface ExecuteWithIdempotencyResult<T = unknown> {
  result: T;
  httpStatus: number;
  cached: boolean;
}

export class DistributedIdempotencyManager {
  private readonly lockProvider: IDistributedLockProvider;
  private readonly defaultTtlMs: number;

  constructor(
    lockProvider?: IDistributedLockProvider,
    defaultTtlMs: number = 300_000 // 5 minutes
  ) {
    this.lockProvider = lockProvider ?? new InMemoryDistributedLockProvider();
    this.defaultTtlMs = defaultTtlMs;
  }

  public getLockProvider(): IDistributedLockProvider {
    return this.lockProvider;
  }

  public async executeWithIdempotency<T = unknown>(
    key: string,
    taskId: string,
    fn: () => Promise<{ result: T; httpStatus: number }>,
    options: ExecuteWithIdempotencyOptions = {}
  ): Promise<ExecuteWithIdempotencyResult<T>> {
    const ttlMs = options.ttlMs ?? this.defaultTtlMs;
    const lockTimeoutMs = options.lockTimeoutMs ?? 5000;
    const pollIntervalMs = options.pollIntervalMs ?? 10;

    // Fast check: return existing completed record
    const initialRecord = await this.lockProvider.getRecord(key);
    if (initialRecord && initialRecord.status === 'COMPLETED') {
      return {
        result: initialRecord.result as T,
        httpStatus: initialRecord.httpStatus ?? 200,
        cached: true,
      };
    }

    const startWait = Date.now();
    let acquired = false;

    while (Date.now() - startWait < lockTimeoutMs) {
      // Check if a racing caller already finished
      const activeRecord = await this.lockProvider.getRecord(key);
      if (activeRecord && activeRecord.status === 'COMPLETED') {
        return {
          result: activeRecord.result as T,
          httpStatus: activeRecord.httpStatus ?? 200,
          cached: true,
        };
      }

      acquired = await this.lockProvider.acquireLock(key, taskId, ttlMs);
      if (acquired) {
        break;
      }

      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }

    if (!acquired) {
      // Check one last time if completed while waiting for lock
      const finalCheck = await this.lockProvider.getRecord(key);
      if (finalCheck && finalCheck.status === 'COMPLETED') {
        return {
          result: finalCheck.result as T,
          httpStatus: finalCheck.httpStatus ?? 200,
          cached: true,
        };
      }
      throw new Error(`Timed out waiting for distributed lock on idempotency key: ${key}`);
    }

    // Set status to IN_PROGRESS
    const now = new Date().toISOString();
    await this.lockProvider.setRecord(
      key,
      {
        key,
        taskId,
        status: 'IN_PROGRESS',
        createdAt: now,
        updatedAt: now,
      },
      ttlMs
    );

    try {
      const execResult = await fn();

      const commitTime = new Date().toISOString();
      await this.lockProvider.setRecord(
        key,
        {
          key,
          taskId,
          status: 'COMPLETED',
          result: execResult.result,
          httpStatus: execResult.httpStatus,
          createdAt: now,
          updatedAt: commitTime,
        },
        ttlMs
      );

      return {
        result: execResult.result,
        httpStatus: execResult.httpStatus,
        cached: false,
      };
    } catch (err: unknown) {
      const failTime = new Date().toISOString();
      const message = err instanceof Error ? err.message : String(err);
      await this.lockProvider.setRecord(
        key,
        {
          key,
          taskId,
          status: 'FAILED',
          error: message,
          createdAt: now,
          updatedAt: failTime,
        },
        ttlMs
      );
      throw err;
    } finally {
      await this.lockProvider.releaseLock(key, taskId);
    }
  }
}
