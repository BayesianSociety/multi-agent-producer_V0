"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TelemetryStore = exports.ConstraintViolationError = exports.ResourceNotFoundError = void 0;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const node_crypto_1 = __importDefault(require("node:crypto"));
const better_sqlite3_1 = __importDefault(require("better-sqlite3"));
class ResourceNotFoundError extends Error {
    constructor() {
        super(...arguments);
        this.statusCode = 404;
    }
}
exports.ResourceNotFoundError = ResourceNotFoundError;
class ConstraintViolationError extends Error {
    constructor() {
        super(...arguments);
        this.statusCode = 400;
    }
}
exports.ConstraintViolationError = ConstraintViolationError;
const DEFAULT_DB_PATH = node_path_1.default.resolve(process.cwd(), 'data', 'pet-vet.sqlite');
const DEFAULT_PUZZLES_PATH = process.env.PUZZLES_JSON_PATH
    ? node_path_1.default.resolve(process.env.PUZZLES_JSON_PATH)
    : node_path_1.default.resolve(__dirname, '../../../shared/puzzles/puzzles.json');
const MIGRATIONS_DIR = node_path_1.default.resolve(__dirname, './migrations');
class TelemetryStore {
    constructor(options = {}) {
        const databasePath = options.databasePath ?? DEFAULT_DB_PATH;
        node_fs_1.default.mkdirSync(node_path_1.default.dirname(databasePath), { recursive: true });
        this.db = new better_sqlite3_1.default(databasePath);
        this.db.pragma('journal_mode = WAL');
        this.db.pragma('foreign_keys = ON');
        this.maxBatchSize = options.eventBatchMax ?? Number(process.env.EVENT_BATCH_MAX ?? 500);
        this.ensureSchema();
        this.puzzlePack = loadPuzzlePack(options.puzzlesPath ?? DEFAULT_PUZZLES_PATH);
        this.seedPuzzles();
    }
    getEventBatchLimit() {
        return this.maxBatchSize;
    }
    getPuzzlePack() {
        return this.puzzlePack;
    }
    startSession(input) {
        const now = input.startedAt ?? Date.now();
        const userId = this.ensureUser(input.userId, input.displayName, now);
        const sessionId = node_crypto_1.default.randomUUID();
        this.db
            .prepare(`INSERT INTO sessions (id, user_id, started_at, user_agent, locale)
         VALUES (@id, @user_id, @started_at, @user_agent, @locale)`)
            .run({
            id: sessionId,
            user_id: userId,
            started_at: now,
            user_agent: input.userAgent ?? null,
            locale: input.locale ?? null,
        });
        return { sessionId, userId, startedAt: now };
    }
    endSession(sessionId, endedAt = Date.now()) {
        const result = this.db.prepare(`UPDATE sessions SET ended_at=@ended_at WHERE id=@id`).run({
            id: sessionId,
            ended_at: endedAt,
        });
        if (result.changes === 0) {
            throw new ResourceNotFoundError(`Session ${sessionId} not found`);
        }
    }
    startAttempt(input) {
        const session = this.getSessionRow(input.sessionId);
        this.assertPuzzleExists(input.puzzleId);
        const now = input.startedAt ?? Date.now();
        const attemptId = node_crypto_1.default.randomUUID();
        const targetUserId = input.userId ?? session.user_id ?? undefined;
        const userId = this.ensureUser(targetUserId, undefined, now);
        this.db
            .prepare(`INSERT INTO attempts (
          id, session_id, user_id, puzzle_id, started_at, result, failure_reason,
          code_snapshot_json, block_count, execution_steps, client_version
        ) VALUES (@id, @session_id, @user_id, @puzzle_id, @started_at, @result, @failure_reason,
          @code_snapshot_json, @block_count, @execution_steps, @client_version)`)
            .run({
            id: attemptId,
            session_id: input.sessionId,
            user_id: userId,
            puzzle_id: input.puzzleId,
            started_at: now,
            result: 'aborted',
            failure_reason: null,
            code_snapshot_json: input.codeSnapshotJson,
            block_count: input.blockCount,
            execution_steps: 0,
            client_version: input.clientVersion ?? null,
        });
        return { attemptId, startedAt: now };
    }
    completeAttempt(input) {
        const attempt = this.db
            .prepare(`SELECT id, session_id, user_id, puzzle_id, started_at, code_snapshot_json
         FROM attempts WHERE id = ?`)
            .get(input.attemptId);
        if (!attempt) {
            throw new ResourceNotFoundError(`Attempt ${input.attemptId} not found`);
        }
        const endedAt = input.endedAt ?? Date.now();
        this.db
            .prepare(`UPDATE attempts
         SET result=@result,
             failure_reason=@failure_reason,
             execution_steps=@execution_steps,
             ended_at=@ended_at
         WHERE id=@id`)
            .run({
            id: input.attemptId,
            result: input.result,
            failure_reason: input.failureReason ?? null,
            execution_steps: input.executionSteps,
            ended_at: endedAt,
        });
        if (input.result === 'success' && attempt.user_id && attempt.puzzle_id) {
            this.db
                .prepare(`INSERT INTO puzzle_progress (user_id, puzzle_id, completed_at, best_attempt_id)
           VALUES (@user_id, @puzzle_id, @completed_at, @best_attempt_id)
           ON CONFLICT(user_id, puzzle_id)
           DO UPDATE SET completed_at=excluded.completed_at, best_attempt_id=excluded.best_attempt_id`)
                .run({
                user_id: attempt.user_id,
                puzzle_id: attempt.puzzle_id,
                completed_at: endedAt,
                best_attempt_id: input.attemptId,
            });
        }
        return this.getAttemptWithMovements(input.attemptId);
    }
    insertEventsBatch(batch) {
        if (!batch.sessionId) {
            throw new ConstraintViolationError('sessionId is required');
        }
        if (!Array.isArray(batch.events) || batch.events.length === 0) {
            return { insertedEvents: 0, insertedMovements: 0 };
        }
        if (batch.events.length > this.maxBatchSize) {
            throw new ConstraintViolationError(`Batch exceeds maximum of ${this.maxBatchSize} events`);
        }
        const session = this.getSessionRow(batch.sessionId);
        let attemptRow = null;
        if (batch.attemptId) {
            attemptRow = this.getAttemptRow(batch.attemptId);
            if (attemptRow.session_id && attemptRow.session_id !== batch.sessionId) {
                throw new ConstraintViolationError('Attempt does not belong to the provided session');
            }
        }
        if (typeof batch.puzzleId === 'number') {
            this.assertPuzzleExists(batch.puzzleId);
        }
        const effectiveUserId = batch.userId ?? attemptRow?.user_id ?? session.user_id ?? null;
        const effectivePuzzleId = typeof batch.puzzleId === 'number' ? batch.puzzleId : attemptRow?.puzzle_id ?? null;
        const insertEventStmt = this.db.prepare(`INSERT INTO events (id, session_id, user_id, attempt_id, puzzle_id, ts, type, payload_json)
       VALUES (@id, @session_id, @user_id, @attempt_id, @puzzle_id, @ts, @type, @payload_json)`);
        const insertMovementStmt = this.db.prepare(`INSERT INTO movements (id, attempt_id, ts, entity, from_x, from_y, to_x, to_y, direction, cause, blocked)
       VALUES (@id, @attempt_id, @ts, @entity, @from_x, @from_y, @to_x, @to_y, @direction, @cause, @blocked)`);
        const txn = this.db.transaction((events) => {
            let movementCount = 0;
            for (const event of events) {
                const eventId = event.id ?? node_crypto_1.default.randomUUID();
                const ts = event.ts ?? Date.now();
                const payloadJson = JSON.stringify(event.payload ?? {});
                insertEventStmt.run({
                    id: eventId,
                    session_id: batch.sessionId,
                    user_id: effectiveUserId,
                    attempt_id: batch.attemptId ?? null,
                    puzzle_id: effectivePuzzleId,
                    ts,
                    type: event.type,
                    payload_json: payloadJson,
                });
                if (event.type === 'move.step') {
                    if (!batch.attemptId) {
                        throw new ConstraintViolationError('move.step events require attemptId');
                    }
                    const movement = coerceMovement(event.payload);
                    insertMovementStmt.run({
                        id: node_crypto_1.default.randomUUID(),
                        attempt_id: batch.attemptId,
                        ts,
                        entity: movement.entity,
                        from_x: movement.from.x,
                        from_y: movement.from.y,
                        to_x: movement.to.x,
                        to_y: movement.to.y,
                        direction: movement.direction ?? null,
                        cause: movement.cause,
                        blocked: movement.blocked ? 1 : 0,
                    });
                    movementCount += 1;
                }
            }
            return movementCount;
        });
        const movementsInserted = txn(batch.events);
        return { insertedEvents: batch.events.length, insertedMovements: movementsInserted };
    }
    getDashboardMetrics() {
        const row = this.db
            .prepare(`SELECT
          (SELECT COUNT(*) FROM sessions) AS total_sessions,
          (SELECT COUNT(*) FROM attempts) AS total_attempts,
          (SELECT COUNT(*) FROM attempts WHERE result = 'success') AS successful_attempts,
          (SELECT AVG(count_per_puzzle) FROM (
             SELECT COUNT(*) AS count_per_puzzle FROM attempts GROUP BY puzzle_id
           )) AS avg_attempts_per_puzzle,
          (SELECT AVG(ended_at - started_at) FROM attempts WHERE ended_at IS NOT NULL) AS avg_duration
        `)
            .get();
        const totalAttempts = Number(row.total_attempts ?? 0);
        const successfulAttempts = Number(row.successful_attempts ?? 0);
        return {
            totalSessions: Number(row.total_sessions ?? 0),
            totalAttempts,
            successRate: totalAttempts === 0 ? 0 : successfulAttempts / totalAttempts,
            averageAttemptsPerPuzzle: Number(row.avg_attempts_per_puzzle ?? 0) || 0,
            averageTimePerAttemptMs: Number(row.avg_duration ?? 0) || 0,
        };
    }
    getPuzzleTimeline(puzzleId) {
        const puzzle = this.db.prepare(`SELECT id, title, concepts FROM puzzles WHERE id = ?`).get(puzzleId);
        if (!puzzle) {
            throw new ResourceNotFoundError(`Puzzle ${puzzleId} not found`);
        }
        const attempts = this.db
            .prepare(`SELECT id, session_id, user_id, puzzle_id, started_at, ended_at, result,
                failure_reason, execution_steps, code_snapshot_json
         FROM attempts
         WHERE puzzle_id = ?
         ORDER BY started_at ASC`)
            .all(puzzleId);
        const analyticsAttempts = attempts.map((attempt) => ({
            attemptId: attempt.id,
            sessionId: attempt.session_id,
            userId: attempt.user_id,
            puzzleId: attempt.puzzle_id,
            startedAt: attempt.started_at,
            endedAt: attempt.ended_at ?? null,
            durationMs: attempt.ended_at ? attempt.ended_at - attempt.started_at : null,
            result: attempt.result,
            failureReason: attempt.failure_reason ?? null,
            executionSteps: attempt.execution_steps,
            codeSnapshotJson: attempt.code_snapshot_json,
            movements: this.getMovementsForAttempt(attempt.id),
        }));
        return {
            puzzle: {
                id: puzzle.id,
                title: puzzle.title,
                concepts: puzzle.concepts.split(',').map((c) => c.trim()).filter(Boolean),
            },
            attempts: analyticsAttempts,
        };
    }
    getEventsStream(filter) {
        const clauses = [];
        const params = [];
        if (filter.sessionId) {
            clauses.push('session_id = ?');
            params.push(filter.sessionId);
        }
        if (filter.attemptId) {
            clauses.push('attempt_id = ?');
            params.push(filter.attemptId);
        }
        if (typeof filter.puzzleId === 'number') {
            clauses.push('puzzle_id = ?');
            params.push(filter.puzzleId);
        }
        if (filter.type) {
            clauses.push('type = ?');
            params.push(filter.type);
        }
        const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
        const limit = Math.min(filter.limit ?? 200, 500);
        const offset = Math.max(filter.offset ?? 0, 0);
        const rows = this.db
            .prepare(`SELECT id, session_id, user_id, attempt_id, puzzle_id, ts, type, payload_json
         FROM events
         ${where}
         ORDER BY ts DESC
         LIMIT ? OFFSET ?`)
            .all(...params, limit, offset);
        const events = rows.map((row) => ({
            id: row.id,
            sessionId: row.session_id,
            userId: row.user_id ?? null,
            attemptId: row.attempt_id ?? null,
            puzzleId: row.puzzle_id ?? null,
            ts: row.ts,
            type: row.type,
            payload: safeJsonParse(row.payload_json),
        }));
        return { events };
    }
    getAttemptWithMovements(attemptId) {
        const row = this.db
            .prepare(`SELECT id, session_id, user_id, puzzle_id, started_at, ended_at, result,
                failure_reason, execution_steps, code_snapshot_json
         FROM attempts WHERE id = ?`)
            .get(attemptId);
        if (!row) {
            throw new ResourceNotFoundError(`Attempt ${attemptId} not found`);
        }
        const movements = this.getMovementsForAttempt(attemptId);
        return {
            attemptId: row.id,
            sessionId: row.session_id,
            userId: row.user_id,
            puzzleId: row.puzzle_id,
            startedAt: row.started_at,
            endedAt: row.ended_at ?? null,
            durationMs: row.ended_at ? row.ended_at - row.started_at : null,
            result: row.result,
            failureReason: row.failure_reason ?? null,
            executionSteps: row.execution_steps,
            codeSnapshotJson: row.code_snapshot_json,
            movements,
        };
    }
    getHealthSnapshot() {
        return {
            status: 'ok',
            puzzles: this.puzzlePack.puzzles.length,
            version: this.puzzlePack.version,
        };
    }
    getMovementsForAttempt(attemptId) {
        const rows = this.db
            .prepare(`SELECT id, ts, entity, from_x, from_y, to_x, to_y, direction, cause, blocked
         FROM movements
         WHERE attempt_id = ?
         ORDER BY ts ASC`)
            .all(attemptId);
        return rows.map((row) => ({
            id: row.id,
            ts: row.ts,
            entity: row.entity,
            from: { x: row.from_x, y: row.from_y },
            to: { x: row.to_x, y: row.to_y },
            direction: row.direction,
            cause: row.cause,
            blocked: Boolean(row.blocked),
        }));
    }
    ensureUser(userId, displayName, now = Date.now()) {
        if (userId) {
            const existing = this.db.prepare(`SELECT id FROM users WHERE id = ?`).get(userId);
            if (!existing) {
                this.db
                    .prepare(`INSERT INTO users (id, created_at, display_name) VALUES (@id, @created_at, @display_name)`)
                    .run({ id: userId, created_at: now, display_name: displayName ?? null });
            }
            else if (displayName) {
                this.db
                    .prepare(`UPDATE users SET display_name=@display_name WHERE id=@id`)
                    .run({ id: userId, display_name: displayName });
            }
            return userId;
        }
        const generatedId = node_crypto_1.default.randomUUID();
        this.db
            .prepare(`INSERT INTO users (id, created_at, display_name) VALUES (@id, @created_at, @display_name)`)
            .run({ id: generatedId, created_at: now, display_name: displayName ?? null });
        return generatedId;
    }
    getSessionRow(sessionId) {
        const row = this.db.prepare(`SELECT id, user_id FROM sessions WHERE id = ?`).get(sessionId);
        if (!row) {
            throw new ResourceNotFoundError(`Session ${sessionId} not found`);
        }
        return { id: row.id, user_id: row.user_id ?? null };
    }
    getAttemptRow(attemptId) {
        const row = this.db
            .prepare(`SELECT id, session_id, user_id, puzzle_id FROM attempts WHERE id = ?`)
            .get(attemptId);
        if (!row) {
            throw new ResourceNotFoundError(`Attempt ${attemptId} not found`);
        }
        return {
            id: row.id,
            session_id: row.session_id ?? null,
            user_id: row.user_id ?? null,
            puzzle_id: typeof row.puzzle_id === 'number' ? row.puzzle_id : null,
        };
    }
    assertPuzzleExists(puzzleId) {
        const row = this.db.prepare(`SELECT id FROM puzzles WHERE id = ?`).get(puzzleId);
        if (!row) {
            throw new ConstraintViolationError(`Puzzle ${puzzleId} is not recognized`);
        }
    }
    ensureSchema() {
        const applied = new Set();
        this.db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
         id TEXT PRIMARY KEY,
         applied_at INTEGER NOT NULL
       )`);
        const rows = this.db.prepare(`SELECT id FROM schema_migrations`).all();
        for (const row of rows) {
            applied.add(row.id);
        }
        if (!node_fs_1.default.existsSync(MIGRATIONS_DIR)) {
            return;
        }
        const files = node_fs_1.default
            .readdirSync(MIGRATIONS_DIR)
            .filter((file) => file.endsWith('.sql'))
            .sort();
        for (const file of files) {
            if (applied.has(file)) {
                continue;
            }
            const sql = node_fs_1.default.readFileSync(node_path_1.default.join(MIGRATIONS_DIR, file), 'utf-8');
            this.db.exec(sql);
            this.db
                .prepare(`INSERT INTO schema_migrations (id, applied_at) VALUES (@id, @applied_at)`)
                .run({ id: file, applied_at: Date.now() });
        }
    }
    seedPuzzles() {
        const insert = this.db.prepare(`INSERT INTO puzzles (id, title, concepts, version, checksum)
       VALUES (@id, @title, @concepts, @version, @checksum)
       ON CONFLICT(id) DO UPDATE SET
         title=excluded.title,
         concepts=excluded.concepts,
         version=excluded.version,
         checksum=excluded.checksum`);
        const ids = [];
        const version = this.puzzlePack.version;
        for (const puzzle of this.puzzlePack.puzzles) {
            const checksum = node_crypto_1.default.createHash('sha256').update(JSON.stringify(puzzle)).digest('hex');
            insert.run({
                id: puzzle.id,
                title: puzzle.title,
                concepts: puzzle.concepts.join(','),
                version,
                checksum,
            });
            ids.push(puzzle.id);
        }
        if (ids.length) {
            const placeholders = ids.map(() => '?').join(',');
            this.db.prepare(`DELETE FROM puzzles WHERE id NOT IN (${placeholders})`).run(...ids);
        }
    }
}
exports.TelemetryStore = TelemetryStore;
function loadPuzzlePack(puzzlesPath) {
    if (!node_fs_1.default.existsSync(puzzlesPath)) {
        throw new Error(`Puzzle data not found at ${puzzlesPath}`);
    }
    const raw = node_fs_1.default.readFileSync(puzzlesPath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.puzzles) || typeof parsed.version !== 'string') {
        throw new Error('Invalid puzzle pack format');
    }
    if (parsed.puzzles.length !== 17) {
        throw new Error(`Expected 17 puzzles, got ${parsed.puzzles.length}`);
    }
    return parsed;
}
function coerceMovement(payload) {
    if (typeof payload !== 'object' || payload === null) {
        throw new ConstraintViolationError('Movement payload must be an object');
    }
    const data = payload;
    const from = data.from ?? data.start;
    const to = data.to ?? data.end;
    if (!isPoint(from) || !isPoint(to)) {
        throw new ConstraintViolationError('Movement payload missing from/to coordinates');
    }
    const cause = typeof data.cause === 'string' ? data.cause : 'unknown';
    const entity = typeof data.entity === 'string' ? data.entity : 'pet';
    const direction = typeof data.direction === 'string' ? data.direction : undefined;
    const blocked = Boolean(data.blocked);
    return {
        entity,
        from,
        to,
        direction,
        cause,
        blocked,
    };
}
function isPoint(value) {
    return value && typeof value.x === 'number' && typeof value.y === 'number';
}
function safeJsonParse(payload) {
    try {
        return JSON.parse(payload);
    }
    catch (err) {
        return { raw: payload };
    }
}
//# sourceMappingURL=schema.js.map