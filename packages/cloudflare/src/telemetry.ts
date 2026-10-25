import { z } from 'zod';

export const TelemetryEventSchema = z.object({
  taskId: z.string(),
  stage: z.string(),
  timestamp: z.string(),
  durationMs: z.number().nonnegative(),
  memoryUsageMb: z.number().nonnegative().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type TelemetryEvent = z.infer<typeof TelemetryEventSchema>;

export class ExecutionTracer {
  private readonly events: TelemetryEvent[] = [];
  private readonly startTime = performance.now();

  public recordEvent(
    taskId: string,
    stage: string,
    durationMs: number,
    metadata?: Record<string, unknown>
  ): TelemetryEvent {
    let memoryUsageMb: number | undefined;
    if (typeof process !== 'undefined' && typeof process.memoryUsage === 'function') {
      memoryUsageMb = Math.round((process.memoryUsage().heapUsed / 1024 / 1024) * 100) / 100;
    }

    const event: TelemetryEvent = {
      taskId,
      stage,
      timestamp: new Date().toISOString(),
      durationMs,
      memoryUsageMb,
      metadata,
    };

    this.events.push(event);
    return event;
  }

  public getEvents(): readonly TelemetryEvent[] {
    return [...this.events];
  }

  public getTotalElapsedMs(): number {
    return performance.now() - this.startTime;
  }
}
