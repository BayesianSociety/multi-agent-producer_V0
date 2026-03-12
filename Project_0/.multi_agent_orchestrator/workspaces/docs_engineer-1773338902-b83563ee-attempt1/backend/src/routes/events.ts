import { Router } from 'express';
import {
  ConstraintViolationError,
  EventEnvelope,
  EventsBatchInput,
  TelemetryStore,
} from '../db/schema';

export function createEventsRouter(store: TelemetryStore): Router {
  const router = Router();

  router.post('/batch', (req, res, next) => {
    try {
      const payload = validateEventsBatch(req.body, store.getEventBatchLimit());
      const result = store.insertEventsBatch(payload);
      res.status(202).json({
        accepted: result.insertedEvents,
        movements: result.insertedMovements,
        maxBatchSize: store.getEventBatchLimit(),
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

function validateEventsBatch(body: any, maxBatch: number): EventsBatchInput {
  if (!body || typeof body !== 'object') {
    throw new ConstraintViolationError('Body must be a JSON object');
  }
  const sessionId = coerceString(body.sessionId, 'sessionId');
  const attemptId = typeof body.attemptId === 'string' && body.attemptId.trim().length > 0 ? body.attemptId.trim() : undefined;
  const userId = typeof body.userId === 'string' && body.userId.trim().length > 0 ? body.userId.trim() : undefined;
  const puzzleId = body.puzzleId === undefined ? undefined : coerceNumber(body.puzzleId, 'puzzleId');
  if (!Array.isArray(body.events)) {
    throw new ConstraintViolationError('events must be an array');
  }
  if (body.events.length === 0) {
    throw new ConstraintViolationError('events array cannot be empty');
  }
  if (body.events.length > maxBatch) {
    throw new ConstraintViolationError(`events array exceeds max batch size of ${maxBatch}`);
  }
  const events: EventEnvelope[] = body.events.map((event: any, index: number) => {
    if (!event || typeof event !== 'object') {
      throw new ConstraintViolationError(`Event at index ${index} must be an object`);
    }
    const type = coerceString(event.type, `events[${index}].type`);
    const envelope: EventEnvelope = { type };
    if (typeof event.id === 'string' && event.id.trim()) {
      envelope.id = event.id.trim();
    }
    if (event.ts !== undefined) {
      envelope.ts = coerceNumber(event.ts, `events[${index}].ts`);
    }
    if ('payload' in event) {
      envelope.payload = event.payload;
    }
    return envelope;
  });

  return {
    sessionId,
    attemptId,
    userId,
    puzzleId,
    events,
  };
}

function coerceString(value: any, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ConstraintViolationError(`${field} must be a non-empty string`);
  }
  return value.trim();
}

function coerceNumber(value: any, field: string): number {
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num)) {
    throw new ConstraintViolationError(`${field} must be a valid number`);
  }
  return num;
}
