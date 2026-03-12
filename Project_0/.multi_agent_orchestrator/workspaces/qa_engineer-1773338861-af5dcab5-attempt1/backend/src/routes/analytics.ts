import { Router } from 'express';
import { ConstraintViolationError, TelemetryStore } from '../db/schema';

export function createAnalyticsRouter(store: TelemetryStore): Router {
  const router = Router();

  router.get('/dashboard', (req, res, next) => {
    try {
      const metrics = store.getDashboardMetrics();
      res.json(metrics);
    } catch (error) {
      next(error);
    }
  });

  router.get('/puzzles/:puzzleId', (req, res, next) => {
    try {
      const puzzleId = parsePuzzleId(req.params.puzzleId);
      const timeline = store.getPuzzleTimeline(puzzleId);
      res.json(timeline);
    } catch (error) {
      next(error);
    }
  });

  router.get('/events', (req, res, next) => {
    try {
      const { sessionId, attemptId } = req.query;
      const puzzleId = req.query.puzzleId !== undefined ? parsePuzzleId(String(req.query.puzzleId)) : undefined;
      const type = typeof req.query.type === 'string' ? req.query.type : undefined;
      const limit = req.query.limit !== undefined ? parseLimit(String(req.query.limit)) : undefined;
      const offset = req.query.offset !== undefined ? parseOffset(String(req.query.offset)) : undefined;
      const result = store.getEventsStream({
        sessionId: typeof sessionId === 'string' ? sessionId : undefined,
        attemptId: typeof attemptId === 'string' ? attemptId : undefined,
        puzzleId,
        type,
        limit,
        offset,
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  return router;
}

function parsePuzzleId(value: string): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw new ConstraintViolationError('puzzleId must be a positive integer');
  }
  return id;
}

function parseLimit(value: string): number {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) {
    throw new ConstraintViolationError('limit must be a positive number');
  }
  return Math.min(Math.floor(num), 500);
}

function parseOffset(value: string): number {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) {
    throw new ConstraintViolationError('offset must be a non-negative number');
  }
  return Math.floor(num);
}
