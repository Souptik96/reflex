import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { EvidenceLedger } from '@reflex-ai/core';
import {
  EvidenceLedgerBuilder,
  FileLedgerStore,
  MemoryLedgerStore,
  SqliteLedgerStore,
} from '../src/index.js';

describe('Phase 5: Persistent Ledger Storage Engine', () => {
  function makeLedger(taskId: string): EvidenceLedger {
    const builder = new EvidenceLedgerBuilder(taskId);
    builder.recordPreconditionSnapshot('env', 'staging');
    builder.addToolCalls([
      {
        callId: `call_${taskId}`,
        toolName: 'deployments.delete',
        inputPayload: { id: taskId },
        outputPayload: { deleted: true },
        isMutation: true,
        httpStatus: 200,
        timestamp: new Date().toISOString(),
        latencyMs: 12,
      },
    ]);
    builder.addSandboxLogs([`Deleted ${taskId}`]);
    builder.addPostconditionCheck({
      layer: 'READ_AFTER_WRITE',
      target: 'deployments',
      expected: 'deleted',
      actual: 'deleted',
      passed: true,
    });
    return builder.build();
  }

  describe('MemoryLedgerStore', () => {
    it('saves, retrieves, and lists ledgers with status filtering', async () => {
      const store = new MemoryLedgerStore();
      const l1 = makeLedger('task_mem_1');
      const l2 = makeLedger('task_mem_2');

      await store.saveLedger(l1, 'VERIFIED_SUCCESS');
      await store.saveLedger(l2, 'EXECUTION_FAILED');

      const retrieved = await store.getLedger('task_mem_1');
      expect(retrieved).toEqual(l1);

      const nonExistent = await store.getLedger('task_none');
      expect(nonExistent).toBeNull();

      // List all
      const all = await store.listLedgers();
      expect(all.length).toBe(2);

      // Filter by status
      const verified = await store.listLedgers({ status: 'VERIFIED_SUCCESS' });
      expect(verified.length).toBe(1);
      expect(verified[0]?.taskId).toBe('task_mem_1');

      // Limit
      const limited = await store.listLedgers({ limit: 1 });
      expect(limited.length).toBe(1);
    });
  });

  describe('FileLedgerStore', () => {
    let tempDir: string;
    let store: FileLedgerStore;

    beforeAll(async () => {
      tempDir = path.join(os.tmpdir(), `reflex_file_store_${Date.now()}`);
      store = new FileLedgerStore({ storageDir: tempDir });
    });

    afterAll(async () => {
      try {
        await fs.rm(tempDir, { recursive: true, force: true });
      } catch {
        // cleanup ignore
      }
    });

    it('atomically saves ledger to disk and reads back accurately', async () => {
      const l1 = makeLedger('task_file_1');
      const l2 = makeLedger('task_file_2');

      await store.saveLedger(l1, 'VERIFIED_SUCCESS');
      await store.saveLedger(l2, 'UNVERIFIED_SUCCESS');

      const retrieved1 = await store.getLedger('task_file_1');
      expect(retrieved1).toEqual(l1);

      const missing = await store.getLedger('task_unknown');
      expect(missing).toBeNull();

      // List with filter
      const verified = await store.listLedgers({ status: 'VERIFIED_SUCCESS' });
      expect(verified.length).toBe(1);
      expect(verified[0]?.taskId).toBe('task_file_1');

      // Check atomic persistence - temporary files should be removed
      const files = await fs.readdir(tempDir);
      expect(files.some((f) => f.includes('.tmp.'))).toBe(false);
      expect(files.filter((f) => f.endsWith('.json')).length).toBe(2);
    });
  });

  describe('SqliteLedgerStore', () => {
    it('persists and queries ledgers in SQLite relational store', async () => {
      const store = new SqliteLedgerStore({ dbPath: ':memory:' });
      const l1 = makeLedger('task_sql_1');
      const l2 = makeLedger('task_sql_2');

      await store.saveLedger(l1, 'VERIFIED_SUCCESS');
      await store.saveLedger(l2, 'VERIFICATION_FAILED');

      const retrieved = await store.getLedger('task_sql_1');
      expect(retrieved).toEqual(l1);

      // Upsert on conflict
      const l1Updated: EvidenceLedger = {
        ...l1,
        sandboxLogs: ['Updated log'],
      };
      await store.saveLedger(l1Updated, 'VERIFIED_SUCCESS');
      const retrievedUpdated = await store.getLedger('task_sql_1');
      expect(retrievedUpdated?.sandboxLogs).toEqual(['Updated log']);

      // List with filter
      const failed = await store.listLedgers({ status: 'VERIFICATION_FAILED' });
      expect(failed.length).toBe(1);
      expect(failed[0]?.taskId).toBe('task_sql_2');

      // Limit
      const all = await store.listLedgers({ limit: 1 });
      expect(all.length).toBe(1);
    });
  });
});
