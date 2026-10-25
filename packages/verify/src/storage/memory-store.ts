import type {
  EvidenceLedger,
  ILedgerStore,
  LedgerStoreFilter,
  VerificationStatus,
} from '@reflex-ai/core';

interface StoredEntry {
  ledger: EvidenceLedger;
  status?: VerificationStatus;
}

export class MemoryLedgerStore implements ILedgerStore {
  private readonly store = new Map<string, StoredEntry>();

  public async saveLedger(
    ledger: EvidenceLedger,
    status?: VerificationStatus
  ): Promise<void> {
    this.store.set(ledger.taskId, {
      ledger: { ...ledger },
      status,
    });
  }

  public async getLedger(taskId: string): Promise<EvidenceLedger | null> {
    const entry = this.store.get(taskId);
    return entry ? { ...entry.ledger } : null;
  }

  public async listLedgers(
    filter?: LedgerStoreFilter
  ): Promise<EvidenceLedger[]> {
    let entries = Array.from(this.store.values());

    if (filter?.status) {
      entries = entries.filter((e) => e.status === filter.status);
    }

    if (filter?.limit && filter.limit > 0) {
      entries = entries.slice(0, filter.limit);
    }

    return entries.map((e) => ({ ...e.ledger }));
  }

  public clear(): void {
    this.store.clear();
  }

  public size(): number {
    return this.store.size;
  }
}
