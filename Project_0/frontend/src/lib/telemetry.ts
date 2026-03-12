import { generateId } from './ids';

export type TelemetryImportance = 'critical' | 'buffered';

export interface TelemetryEventInput {
  type: string;
  payload?: Record<string, unknown>;
  importance?: TelemetryImportance;
}

export interface TelemetryContext {
  sessionId?: string;
  attemptId?: string;
  userId?: string;
  puzzleId?: number;
}

export class TelemetryClient {
  private readonly baseUrl: string;
  private readonly flushInterval: number;
  private readonly maxBuffer: number;
  private buffer: TelemetryEventInput[] = [];
  private context: TelemetryContext = {};
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private inflight: Promise<void> | null = null;

  constructor(baseUrl: string, options?: { flushInterval?: number; maxBuffer?: number }) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.flushInterval = options?.flushInterval ?? 1500;
    this.maxBuffer = options?.maxBuffer ?? 32;
  }

  configureContext(next: Partial<TelemetryContext>): void {
    this.context = { ...this.context, ...next };
  }

  log(event: TelemetryEventInput): void {
    if (!this.context.sessionId) {
      return;
    }
    this.buffer.push({ ...event, payload: event.payload ?? {} });
    if (event.importance === 'critical' || this.buffer.length >= this.maxBuffer) {
      void this.flush(true);
      return;
    }
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => {
        this.flushTimer = null;
        void this.flush();
      }, this.flushInterval);
    }
  }

  async flush(force = false): Promise<void> {
    if (!this.context.sessionId || this.buffer.length === 0) {
      return;
    }
    if (this.inflight && !force) {
      return this.inflight;
    }
    const buffered = this.buffer.splice(0, this.buffer.length);
    const events = buffered.map((event) => ({
      id: generateId('evt'),
      type: event.type,
      ts: Date.now(),
      payload: event.payload ?? {}
    }));
    const body = {
      sessionId: this.context.sessionId,
      attemptId: this.context.attemptId,
      userId: this.context.userId,
      puzzleId: this.context.puzzleId,
      events
    };
    const request = fetch(`${this.baseUrl}/api/events/batch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    }).catch((error) => {
      console.error('Failed to flush telemetry', error);
      this.buffer.unshift(...buffered);
    }).finally(() => {
      this.inflight = null;
    });
    this.inflight = request.then(() => undefined);
    return this.inflight;
  }
}
