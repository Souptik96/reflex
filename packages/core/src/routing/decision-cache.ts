import { createHash } from 'node:crypto';
import type { JevDecisionBatch, TaskContext } from '../types/index.js';

export interface DecisionCacheOptions {
  maxCapacity?: number;
  defaultTtlMs?: number;
}

interface CacheEntry {
  batch: JevDecisionBatch;
  expiresAt?: number;
}

export class DecisionCache {
  private readonly maxCapacity: number;
  private readonly defaultTtlMs: number;
  private readonly cache = new Map<string, CacheEntry>();

  constructor(options: DecisionCacheOptions = {}) {
    this.maxCapacity = options.maxCapacity ?? 500;
    this.defaultTtlMs = options.defaultTtlMs ?? 60_000; // 1 minute default TTL
  }

  /**
   * Computes a canonical SHA-256 hash representing the task routing context.
   */
  public computeCacheKey(context: TaskContext): string {
    const canonicalPayload = {
      task: context.task.trim().toLowerCase(),
      environment: context.environment,
      callerRole: context.callerRole,
      availableTools: [...context.availableTools].sort(),
    };

    const serialized = JSON.stringify(canonicalPayload);
    return createHash('sha256').update(serialized).digest('hex');
  }

  public get(context: TaskContext): JevDecisionBatch | undefined {
    const key = this.computeCacheKey(context);
    const entry = this.cache.get(key);
    if (!entry) return undefined;

    const now = Date.now();
    if (entry.expiresAt && entry.expiresAt <= now) {
      this.cache.delete(key);
      return undefined;
    }

    // Refresh LRU order (delete and re-insert)
    this.cache.delete(key);
    this.cache.set(key, entry);

    // Return instant cached resolution with 0 token usage and sub-1ms latency
    return {
      ...entry.batch,
      fromCache: true,
      rawLatencyMs: 0.1,
      tokenUsage: {
        inputTokens: 0,
        outputTokens: 0,
      },
    };
  }

  public set(
    context: TaskContext,
    batch: JevDecisionBatch,
    ttlMs?: number
  ): void {
    const key = this.computeCacheKey(context);
    const effectiveTtl = ttlMs ?? this.defaultTtlMs;
    const expiresAt = effectiveTtl > 0 ? Date.now() + effectiveTtl : undefined;

    // LRU eviction if at capacity
    if (this.cache.size >= this.maxCapacity && !this.cache.has(key)) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) {
        this.cache.delete(firstKey);
      }
    }

    this.cache.set(key, {
      batch: { ...batch, fromCache: false },
      expiresAt,
    });
  }

  public has(context: TaskContext): boolean {
    return this.get(context) !== undefined;
  }

  public size(): number {
    return this.cache.size;
  }

  public clear(): void {
    this.cache.clear();
  }

  public evictExpired(): number {
    const now = Date.now();
    let evicted = 0;
    for (const [key, entry] of this.cache.entries()) {
      if (entry.expiresAt && entry.expiresAt <= now) {
        this.cache.delete(key);
        evicted++;
      }
    }
    return evicted;
  }
}
