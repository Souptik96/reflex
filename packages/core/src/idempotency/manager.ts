import { z } from 'zod';

export const IdempotencyRecordSchema = z.object({
  key: z.string().min(1),
  taskId: z.string().min(1),
  status: z.enum(['IN_PROGRESS', 'COMPLETED', 'FAILED']),
  createdAt: z.string(),
  updatedAt: z.string(),
  result: z.unknown().optional(),
  httpStatus: z.number().int().optional(),
  error: z.string().optional(),
});
export type IdempotencyRecord = z.infer<typeof IdempotencyRecordSchema>;

export class IdempotencyManager {
  private readonly records = new Map<string, IdempotencyRecord>();

  public registerKey(
    key: string,
    taskId: string
  ): { isDuplicate: boolean; existingRecord?: IdempotencyRecord } {
    const existing = this.records.get(key);
    if (existing) {
      return { isDuplicate: true, existingRecord: existing };
    }

    const now = new Date().toISOString();
    const record: IdempotencyRecord = {
      key,
      taskId,
      status: 'IN_PROGRESS',
      createdAt: now,
      updatedAt: now,
    };

    this.records.set(key, record);
    return { isDuplicate: false };
  }

  public commitKey(key: string, result: unknown, httpStatus: number): void {
    const record = this.records.get(key);
    if (!record) return;

    record.status = 'COMPLETED';
    record.result = result;
    record.httpStatus = httpStatus;
    record.updatedAt = new Date().toISOString();
  }

  public failKey(key: string, error: string): void {
    const record = this.records.get(key);
    if (!record) return;

    record.status = 'FAILED';
    record.error = error;
    record.updatedAt = new Date().toISOString();
  }

  public getRecord(key: string): IdempotencyRecord | undefined {
    return this.records.get(key);
  }

  public hasKey(key: string): boolean {
    return this.records.has(key);
  }

  public clear(): void {
    this.records.clear();
  }
}
