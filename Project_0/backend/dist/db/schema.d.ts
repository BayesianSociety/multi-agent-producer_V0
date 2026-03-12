export declare class ResourceNotFoundError extends Error {
    statusCode: number;
}
export declare class ConstraintViolationError extends Error {
    statusCode: number;
}
export interface TelemetryStoreOptions {
    databasePath?: string;
    puzzlesPath?: string;
    eventBatchMax?: number;
}
export interface SessionStartInput {
    userId?: string;
    displayName?: string;
    locale?: string;
    userAgent?: string;
    startedAt?: number;
}
export interface AttemptStartInput {
    sessionId: string;
    userId?: string;
    puzzleId: number;
    codeSnapshotJson: string;
    blockCount: number;
    clientVersion?: string;
    startedAt?: number;
}
export interface AttemptCompletionInput {
    attemptId: string;
    result: 'success' | 'failure' | 'aborted';
    failureReason?: string;
    executionSteps: number;
    endedAt?: number;
}
export interface EventEnvelope {
    id?: string;
    type: string;
    ts?: number;
    payload?: unknown;
}
export interface EventsBatchInput {
    sessionId: string;
    attemptId?: string;
    userId?: string;
    puzzleId?: number;
    events: EventEnvelope[];
}
export interface DashboardMetrics {
    totalSessions: number;
    totalAttempts: number;
    successRate: number;
    averageAttemptsPerPuzzle: number;
    averageTimePerAttemptMs: number;
}
export interface AnalyticsAttempt {
    attemptId: string;
    sessionId: string | null;
    userId: string | null;
    puzzleId: number | null;
    startedAt: number;
    endedAt: number | null;
    durationMs: number | null;
    result: 'success' | 'failure' | 'aborted';
    failureReason: string | null;
    executionSteps: number;
    codeSnapshotJson: string;
    movements: MovementRow[];
}
export interface MovementRow {
    id: string;
    ts: number;
    entity: string;
    from: {
        x: number;
        y: number;
    };
    to: {
        x: number;
        y: number;
    };
    direction?: string | null;
    cause: string;
    blocked: boolean;
}
export interface EventsStreamResult {
    events: Array<{
        id: string;
        sessionId: string;
        userId: string | null;
        attemptId: string | null;
        puzzleId: number | null;
        ts: number;
        type: string;
        payload: unknown;
    }>;
}
interface PuzzlePack {
    version: string;
    puzzles: PuzzleDefinition[];
}
interface PuzzleDefinition {
    id: number;
    title: string;
    concepts: string[];
}
export declare class TelemetryStore {
    private readonly db;
    private readonly puzzlePack;
    private readonly maxBatchSize;
    constructor(options?: TelemetryStoreOptions);
    getEventBatchLimit(): number;
    getPuzzlePack(): PuzzlePack;
    startSession(input: SessionStartInput): {
        sessionId: string;
        userId: string;
        startedAt: number;
    };
    endSession(sessionId: string, endedAt?: number): void;
    startAttempt(input: AttemptStartInput): {
        attemptId: string;
        startedAt: number;
    };
    completeAttempt(input: AttemptCompletionInput): AnalyticsAttempt;
    insertEventsBatch(batch: EventsBatchInput): {
        insertedEvents: number;
        insertedMovements: number;
    };
    getDashboardMetrics(): DashboardMetrics;
    getPuzzleTimeline(puzzleId: number): {
        puzzle: PuzzleDefinition;
        attempts: AnalyticsAttempt[];
    };
    getEventsStream(filter: {
        sessionId?: string;
        attemptId?: string;
        puzzleId?: number;
        type?: string;
        limit?: number;
        offset?: number;
    }): EventsStreamResult;
    getAttemptWithMovements(attemptId: string): AnalyticsAttempt;
    getHealthSnapshot(): {
        status: 'ok';
        puzzles: number;
        version: string;
    };
    private getMovementsForAttempt;
    private ensureUser;
    private getSessionRow;
    private getAttemptRow;
    private assertPuzzleExists;
    private ensureSchema;
    private seedPuzzles;
}
export {};
//# sourceMappingURL=schema.d.ts.map