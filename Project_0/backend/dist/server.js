"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createServer = createServer;
const express_1 = __importDefault(require("express"));
const schema_1 = require("./db/schema");
const events_1 = require("./routes/events");
const analytics_1 = require("./routes/analytics");
const ALLOWED_RESULTS = new Set(['success', 'failure', 'aborted']);
function createServer(options = {}) {
    const store = options.store ?? new schema_1.TelemetryStore();
    const app = (0, express_1.default)();
    const allowedOrigin = process.env.CORS_ORIGIN ?? 'http://localhost:5173';
    app.use((req, res, next) => {
        res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
        res.setHeader('Vary', 'Origin');
        res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        if (req.method === 'OPTIONS') {
            res.status(204).end();
            return;
        }
        next();
    });
    app.use(express_1.default.json({ limit: '2mb' }));
    app.get('/health', (_req, res) => {
        const snapshot = store.getHealthSnapshot();
        res.json({ ...snapshot, uptime: process.uptime() });
    });
    app.post('/api/session/start', (req, res, next) => {
        try {
            const payload = normalizeSessionStart(req);
            const result = store.startSession(payload);
            res.status(201).json(result);
        }
        catch (error) {
            next(error);
        }
    });
    app.post('/api/session/end', (req, res, next) => {
        try {
            const sessionId = requireString(req.body?.sessionId, 'sessionId');
            const endedAt = req.body?.endedAt !== undefined ? requireNumber(req.body.endedAt, 'endedAt') : Date.now();
            store.endSession(sessionId, endedAt);
            res.json({ sessionId, endedAt });
        }
        catch (error) {
            next(error);
        }
    });
    app.post('/api/attempts/start', (req, res, next) => {
        try {
            const payload = normalizeAttemptStart(req.body);
            const result = store.startAttempt(payload);
            res.status(201).json(result);
        }
        catch (error) {
            next(error);
        }
    });
    app.post('/api/attempts/complete', (req, res, next) => {
        try {
            const payload = normalizeAttemptCompletion(req.body);
            const result = store.completeAttempt(payload);
            res.json(result);
        }
        catch (error) {
            next(error);
        }
    });
    app.use('/api/events', (0, events_1.createEventsRouter)(store));
    app.use('/api/analytics', (0, analytics_1.createAnalyticsRouter)(store));
    app.use((err, _req, res, _next) => {
        const status = deriveStatusCode(err);
        if (status >= 500) {
            // eslint-disable-next-line no-console
            console.error(err);
        }
        res.status(status).json({ error: err?.message ?? 'Unknown error', code: err?.code ?? null });
    });
    return { app, store };
}
if (require.main === module) {
    const port = Number(process.env.PORT ?? 4000);
    const { app } = createServer();
    app.listen(port, () => {
        // eslint-disable-next-line no-console
        console.log(`Telemetry API listening on port ${port}`);
    });
}
function normalizeSessionStart(req) {
    if (!req.body || typeof req.body !== 'object') {
        throw new schema_1.ConstraintViolationError('Body must be a JSON object');
    }
    const userId = optionalString(req.body.userId);
    const displayName = optionalString(req.body.displayName);
    const locale = optionalString(req.body.locale);
    const userAgent = optionalString(req.body.userAgent) ?? req.get('user-agent') ?? undefined;
    return { userId, displayName, locale, userAgent };
}
function normalizeAttemptStart(body) {
    if (!body || typeof body !== 'object') {
        throw new schema_1.ConstraintViolationError('Body must be a JSON object');
    }
    const sessionId = requireString(body.sessionId, 'sessionId');
    const puzzleId = requireInteger(body.puzzleId, 'puzzleId');
    const blockCount = requireNumber(body.blockCount, 'blockCount');
    if (!Number.isInteger(blockCount) || blockCount < 0) {
        throw new schema_1.ConstraintViolationError('blockCount must be a non-negative integer');
    }
    const userId = optionalString(body.userId);
    const clientVersion = optionalString(body.clientVersion);
    const codeSnapshotJson = normalizeCodeSnapshot(body.codeSnapshotJson);
    return {
        sessionId,
        puzzleId,
        blockCount,
        codeSnapshotJson,
        userId,
        clientVersion,
    };
}
function normalizeAttemptCompletion(body) {
    if (!body || typeof body !== 'object') {
        throw new schema_1.ConstraintViolationError('Body must be a JSON object');
    }
    const attemptId = requireString(body.attemptId, 'attemptId');
    const result = requireString(body.result, 'result');
    if (!ALLOWED_RESULTS.has(result)) {
        throw new schema_1.ConstraintViolationError(`result must be one of ${Array.from(ALLOWED_RESULTS).join(', ')}`);
    }
    const executionSteps = requireNumber(body.executionSteps, 'executionSteps');
    if (!Number.isInteger(executionSteps) || executionSteps < 0) {
        throw new schema_1.ConstraintViolationError('executionSteps must be a non-negative integer');
    }
    const failureReason = optionalString(body.failureReason);
    const endedAt = body.endedAt !== undefined ? requireNumber(body.endedAt, 'endedAt') : Date.now();
    return {
        attemptId,
        result: result,
        executionSteps,
        failureReason: failureReason ?? undefined,
        endedAt,
    };
}
function normalizeCodeSnapshot(snapshot) {
    if (typeof snapshot === 'string') {
        if (!snapshot.trim()) {
            throw new schema_1.ConstraintViolationError('codeSnapshotJson cannot be empty');
        }
        return snapshot;
    }
    if (!snapshot || typeof snapshot !== 'object') {
        throw new schema_1.ConstraintViolationError('codeSnapshotJson must be a JSON object or string');
    }
    return JSON.stringify(snapshot);
}
function optionalString(value) {
    if (typeof value === 'string' && value.trim().length > 0) {
        return value.trim();
    }
    return undefined;
}
function requireString(value, field) {
    if (typeof value !== 'string' || value.trim().length === 0) {
        throw new schema_1.ConstraintViolationError(`${field} must be a non-empty string`);
    }
    return value.trim();
}
function requireNumber(value, field) {
    const num = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(num)) {
        throw new schema_1.ConstraintViolationError(`${field} must be a valid number`);
    }
    return num;
}
function requireInteger(value, field) {
    const num = requireNumber(value, field);
    if (!Number.isInteger(num) || num <= 0) {
        throw new schema_1.ConstraintViolationError(`${field} must be a positive integer`);
    }
    return num;
}
function deriveStatusCode(err) {
    if (typeof err?.statusCode === 'number') {
        return err.statusCode;
    }
    if (err instanceof schema_1.ConstraintViolationError) {
        return 400;
    }
    if (err instanceof schema_1.ResourceNotFoundError) {
        return 404;
    }
    return 500;
}
//# sourceMappingURL=server.js.map