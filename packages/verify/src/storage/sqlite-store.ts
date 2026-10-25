import type {
  EvidenceLedger,
  ILedgerStore,
  LedgerStoreFilter,
  VerificationStatus,
} from '@reflex-ai/core';

export const LEDGER_SQL_SCHEMA = `
CREATE TABLE IF NOT EXISTS evidence_ledgers (
  task_id TEXT PRIMARY KEY,
  timestamp TEXT NOT NULL,
  status TEXT,
  checksum TEXT NOT NULL,
  signature_algorithm TEXT,
  public_key TEXT,
  signature_hex TEXT,
  ledger_data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ledgers_status ON evidence_ledgers(status);
CREATE INDEX IF NOT EXISTS idx_ledgers_timestamp ON evidence_ledgers(timestamp);
`;

interface SqliteRow {
  task_id: string;
  timestamp: string;
  status: string | null;
  checksum: string;
  signature_algorithm: string | null;
  public_key: string | null;
  signature_hex: string | null;
  ledger_data: string;
}

interface DatabaseSyncInstance {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...params: unknown[]): unknown;
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
  };
  close?(): void;
}

export class SqliteLedgerStore implements ILedgerStore {
  private readonly db: DatabaseSyncInstance;

  constructor(options: { dbPath?: string; databaseInstance?: DatabaseSyncInstance } = {}) {
    if (options.databaseInstance) {
      this.db = options.databaseInstance;
    } else {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { DatabaseSync } = (eval('require') as (mod: string) => {
          DatabaseSync: new (path: string) => DatabaseSyncInstance;
        })('node:sqlite');
        this.db = new DatabaseSync(options.dbPath ?? ':memory:');
      } catch {
        // Fallback in-memory map simulation if node:sqlite is disabled
        this.db = this.createFallbackDatabase();
      }
    }

    this.initializeSchema();
  }

  private initializeSchema(): void {
    this.db.exec(LEDGER_SQL_SCHEMA);
  }

  public async saveLedger(
    ledger: EvidenceLedger,
    status?: VerificationStatus
  ): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT INTO evidence_ledgers (
        task_id,
        timestamp,
        status,
        checksum,
        signature_algorithm,
        public_key,
        signature_hex,
        ledger_data
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(task_id) DO UPDATE SET
        timestamp = excluded.timestamp,
        status = excluded.status,
        checksum = excluded.checksum,
        signature_algorithm = excluded.signature_algorithm,
        public_key = excluded.public_key,
        signature_hex = excluded.signature_hex,
        ledger_data = excluded.ledger_data;
    `);

    stmt.run(
      ledger.taskId,
      ledger.timestamp,
      status ?? null,
      ledger.checksum,
      ledger.signature?.algorithm ?? null,
      ledger.signature?.publicKey ?? null,
      ledger.signature?.signatureHex ?? null,
      JSON.stringify(ledger)
    );
  }

  public async getLedger(taskId: string): Promise<EvidenceLedger | null> {
    const stmt = this.db.prepare('SELECT ledger_data FROM evidence_ledgers WHERE task_id = ?;');
    const row = stmt.get(taskId) as { ledger_data?: string } | undefined;

    if (!row || !row.ledger_data) {
      return null;
    }

    return JSON.parse(row.ledger_data) as EvidenceLedger;
  }

  public async listLedgers(
    filter?: LedgerStoreFilter
  ): Promise<EvidenceLedger[]> {
    let sql = 'SELECT ledger_data FROM evidence_ledgers';
    const params: unknown[] = [];

    if (filter?.status) {
      sql += ' WHERE status = ?';
      params.push(filter.status);
    }

    sql += ' ORDER BY timestamp DESC';

    if (filter?.limit && filter.limit > 0) {
      sql += ' LIMIT ?';
      params.push(filter.limit);
    }

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params) as Array<{ ledger_data: string }>;

    return rows.map((r) => JSON.parse(r.ledger_data) as EvidenceLedger);
  }

  private createFallbackDatabase(): DatabaseSyncInstance {
    const memoryTable = new Map<string, SqliteRow>();

    return {
      exec: () => {},
      prepare: (sql: string) => ({
        run: (...params: unknown[]) => {
          if (sql.includes('INSERT INTO evidence_ledgers')) {
            const taskId = String(params[0]);
            memoryTable.set(taskId, {
              task_id: taskId,
              timestamp: String(params[1]),
              status: (params[2] as string) ?? null,
              checksum: String(params[3]),
              signature_algorithm: (params[4] as string) ?? null,
              public_key: (params[5] as string) ?? null,
              signature_hex: (params[6] as string) ?? null,
              ledger_data: String(params[7]),
            });
          }
          return undefined;
        },
        get: (...params: unknown[]) => {
          const taskId = String(params[0]);
          const row = memoryTable.get(taskId);
          return row ? { ledger_data: row.ledger_data } : undefined;
        },
        all: (...params: unknown[]) => {
          let rows = Array.from(memoryTable.values());
          if (sql.includes('WHERE status = ?') && params[0]) {
            rows = rows.filter((r) => r.status === params[0]);
          }
          if (sql.includes('LIMIT ?')) {
            const limit = Number(params[params.length - 1]);
            if (!isNaN(limit)) {
              rows = rows.slice(0, limit);
            }
          }
          return rows.map((r) => ({ ledger_data: r.ledger_data }));
        },
      }),
    };
  }
}
