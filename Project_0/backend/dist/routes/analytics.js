"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createAnalyticsRouter = createAnalyticsRouter;
const express_1 = require("express");
const schema_1 = require("../db/schema");
function createAnalyticsRouter(store) {
    const router = (0, express_1.Router)();
    router.get('/dashboard', (req, res, next) => {
        try {
            const metrics = store.getDashboardMetrics();
            res.json(metrics);
        }
        catch (error) {
            next(error);
        }
    });
    router.get('/puzzles/:puzzleId', (req, res, next) => {
        try {
            const puzzleId = parsePuzzleId(req.params.puzzleId);
            const timeline = store.getPuzzleTimeline(puzzleId);
            res.json(timeline);
        }
        catch (error) {
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
        }
        catch (error) {
            next(error);
        }
    });
    return router;
}
function parsePuzzleId(value) {
    const id = Number(value);
    if (!Number.isInteger(id) || id <= 0) {
        throw new schema_1.ConstraintViolationError('puzzleId must be a positive integer');
    }
    return id;
}
function parseLimit(value) {
    const num = Number(value);
    if (!Number.isFinite(num) || num <= 0) {
        throw new schema_1.ConstraintViolationError('limit must be a positive number');
    }
    return Math.min(Math.floor(num), 500);
}
function parseOffset(value) {
    const num = Number(value);
    if (!Number.isFinite(num) || num < 0) {
        throw new schema_1.ConstraintViolationError('offset must be a non-negative number');
    }
    return Math.floor(num);
}
//# sourceMappingURL=analytics.js.map