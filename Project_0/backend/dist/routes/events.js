"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createEventsRouter = createEventsRouter;
const express_1 = require("express");
const schema_1 = require("../db/schema");
function createEventsRouter(store) {
    const router = (0, express_1.Router)();
    router.post('/batch', (req, res, next) => {
        try {
            const payload = validateEventsBatch(req.body, store.getEventBatchLimit());
            const result = store.insertEventsBatch(payload);
            res.status(202).json({
                accepted: result.insertedEvents,
                movements: result.insertedMovements,
                maxBatchSize: store.getEventBatchLimit(),
            });
        }
        catch (error) {
            next(error);
        }
    });
    return router;
}
function validateEventsBatch(body, maxBatch) {
    if (!body || typeof body !== 'object') {
        throw new schema_1.ConstraintViolationError('Body must be a JSON object');
    }
    const sessionId = coerceString(body.sessionId, 'sessionId');
    const attemptId = typeof body.attemptId === 'string' && body.attemptId.trim().length > 0 ? body.attemptId.trim() : undefined;
    const userId = typeof body.userId === 'string' && body.userId.trim().length > 0 ? body.userId.trim() : undefined;
    const puzzleId = body.puzzleId === undefined ? undefined : coerceNumber(body.puzzleId, 'puzzleId');
    if (!Array.isArray(body.events)) {
        throw new schema_1.ConstraintViolationError('events must be an array');
    }
    if (body.events.length === 0) {
        throw new schema_1.ConstraintViolationError('events array cannot be empty');
    }
    if (body.events.length > maxBatch) {
        throw new schema_1.ConstraintViolationError(`events array exceeds max batch size of ${maxBatch}`);
    }
    const events = body.events.map((event, index) => {
        if (!event || typeof event !== 'object') {
            throw new schema_1.ConstraintViolationError(`Event at index ${index} must be an object`);
        }
        const type = coerceString(event.type, `events[${index}].type`);
        const envelope = { type };
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
function coerceString(value, field) {
    if (typeof value !== 'string' || value.trim().length === 0) {
        throw new schema_1.ConstraintViolationError(`${field} must be a non-empty string`);
    }
    return value.trim();
}
function coerceNumber(value, field) {
    const num = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(num)) {
        throw new schema_1.ConstraintViolationError(`${field} must be a valid number`);
    }
    return num;
}
//# sourceMappingURL=events.js.map