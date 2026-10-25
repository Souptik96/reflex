import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  EvidenceLedger,
  ILedgerStore,
  LedgerStoreFilter,
  VerificationStatus,
} from '@reflex-ai/core';

interface StoredFileRecord {
  ledger: EvidenceLedger;
  status?: VerificationStatus;
}

export class FileLedgerStore implements ILedgerStore {
  private readonly storageDir: string;
  private isDirInitialized = false;

  constructor(options: { storageDir: string }) {
    this.storageDir = options.storageDir;
  }

  private async ensureDir(): Promise<void> {
    if (!this.isDirInitialized) {
      await fs.mkdir(this.storageDir, { recursive: true });
      this.isDirInitialized = true;
    }
  }

  private getFilePath(taskId: string): string {
    const sanitized = taskId.replace(/[^a-zA-Z0-9_-]/g, '_');
    return path.join(this.storageDir, `${sanitized}.json`);
  }

  public async saveLedger(
    ledger: EvidenceLedger,
    status?: VerificationStatus
  ): Promise<void> {
    await this.ensureDir();

    const targetFile = this.getFilePath(ledger.taskId);
    const tempFile = `${targetFile}.tmp.${randomUUID()}`;

    const record: StoredFileRecord = {
      ledger,
      status,
    };

    const serialized = JSON.stringify(record, null, 2);

    // Atomic write: write to temp file then rename
    await fs.writeFile(tempFile, serialized, 'utf8');
    await fs.rename(tempFile, targetFile);
  }

  public async getLedger(taskId: string): Promise<EvidenceLedger | null> {
    await this.ensureDir();

    const filePath = this.getFilePath(taskId);
    try {
      const content = await fs.readFile(filePath, 'utf8');
      const parsed = JSON.parse(content) as StoredFileRecord | EvidenceLedger;
      if ('ledger' in parsed && parsed.ledger) {
        return parsed.ledger;
      }
      return parsed as EvidenceLedger;
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code;
      if (code === 'ENOENT') {
        return null;
      }
      throw err;
    }
  }

  public async listLedgers(
    filter?: LedgerStoreFilter
  ): Promise<EvidenceLedger[]> {
    await this.ensureDir();

    const files = await fs.readdir(this.storageDir);
    const jsonFiles = files.filter((f) => f.endsWith('.json') && !f.includes('.tmp.'));
    const ledgers: EvidenceLedger[] = [];

    for (const file of jsonFiles) {
      try {
        const fullPath = path.join(this.storageDir, file);
        const content = await fs.readFile(fullPath, 'utf8');
        const parsed = JSON.parse(content) as StoredFileRecord | EvidenceLedger;

        const ledger = 'ledger' in parsed && parsed.ledger ? parsed.ledger : (parsed as EvidenceLedger);
        const status = 'status' in parsed ? parsed.status : undefined;

        if (filter?.status && status !== filter.status) {
          continue;
        }

        ledgers.push(ledger);

        if (filter?.limit && ledgers.length >= filter.limit) {
          break;
        }
      } catch {
        // Skip corrupted or unparseable files
      }
    }

    return ledgers;
  }
}
