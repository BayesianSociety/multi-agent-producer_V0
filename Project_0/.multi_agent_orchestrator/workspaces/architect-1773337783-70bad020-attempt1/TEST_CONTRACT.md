# Pet Vet Coding Puzzles Test Contract

## 0. Environment Preconditions
- Node/Express backend running with access to local SQLite file initialized via migrations in `backend/src/db/migrations/001_init.sql`.
- React frontend served with access to shared runtime assets from `shared/**` and configured backend base URL.
- Puzzle content JSON includes exactly 17 entries and is identical for frontend and backend imports.

## 1. HTTP Surface (Externally Testable)
- GET /health — returns `{ "status": "ok", "uptime": <number> }` and HTTP 200 when the server, DB connection, and migration state are healthy.
- POST /api/session/start — accepts `{ userId?, locale, userAgent }`, creates session row, returns `{ sessionId }` within 201.
- POST /api/session/end — accepts `{ sessionId }`, timestamps session end, idempotent 200.
- POST /api/events/batch — accepts `{ sessionId, attemptId?, userId?, puzzleId, events: [ { id, type, ts, payload } ] }`, validates payload length <= configured max, persists to events/movements tables, returns 202 with counts.
- POST /api/attempts/start — accepts `{ sessionId, userId?, puzzleId, codeSnapshotJson, blockCount }`, creates attempt row, returns `{ attemptId }`.
- POST /api/attempts/complete — accepts `{ attemptId, result, failureReason?, executionSteps, endedAt }`, updates attempt row and puzzle_progress, returns final attempt envelope.
- GET /api/analytics/dashboard — returns totals (sessions, attempts, success rate, avg attempts per puzzle, avg time per puzzle) derived from SQLite.
- GET /api/analytics/puzzles/:puzzleId — returns attempt timeline array with `attemptId`, `result`, `failureReason`, `executionSteps`, `codeSnapshotJson`, and ordered movement path (for replay) reconstructed from `movements`.
- GET /api/analytics/events?sessionId=&attemptId= — streams ordered events with pagination for event stream viewer.

## 2. Frontend Behavioral Contract
- Landing flow displays title + Start CTA that triggers session start call; QA verifies by checking POST /api/session/start payload.
- Level select screen shows 17 nodes with lock/unlock progression tied to puzzle_progress data; QA unlocks next level via success attempt.
- Workspace renders left command library categories (Movement, Actions, Control, Logic, Sensing) and right On Start column; dragging blocks snaps them in sequence.
- Play button hides or minimises workspace overlay, runs shared execution engine, and disables editing until run ends.
- Reset button returns scene/pet state to puzzle defaults and logs `ui.reset_clicked` event.
- Show Code toggle switches to read-only textual representation of current block graph; state change emits `ui.code_view_toggled` event.
- Failure path: engine emits failureReason, UI shows "Oops!" modal and hint tied to hintRules entry, logs `ui.hint_shown` with hint id.
- Success path: UI celebrates, logs `puzzle.completed`, unlocks next puzzle, and updates progress indicator ("Puzzle X of 17").

## 3. Telemetry + Data Persistence Contract
- Every Play click creates or references an attempt row and logs `ui.play_clicked`, `run.started`, `exec.block_*`, `move.*`, `world.*`, and `run.ended` events; QA verifies by inspecting SQLite tables.
- Movement steps insert into `movements` table with accurate `from_x`, `from_y`, `to_x`, `to_y`, `direction`, `cause`, and `blocked` status consistent with attempt replay.
- Collision-caused failures must produce `world.collision` event plus attempt `failure_reason='collision'` and set `blocked=1` on movement row that triggered it.
- Hint displays append to `events` with payload containing `hintId`, `failureReason`, and `puzzleId`.
- Puzzle metadata exists in `puzzles` table (17 rows) with concepts column enumerating sequencing/loops/conditionals tags; analytics queries rely on this cache.

## 4. Analytics UI Contract
- Dashboard page fetches GET /api/analytics/dashboard on load and renders totals + averages, refreshing automatically at least every 60 seconds.
- Puzzle detail route loads GET /api/analytics/puzzles/:puzzleId and renders attempt timeline (chronological cards) plus a canvas replay using returned movement arrays.
- Event stream viewer issues GET /api/analytics/events with filters and shows tabular rows (`ts`, `type`, `payload_json` parsed) with copy functionality.

## 5. Acceptance Evidence Checklist
- Triggered GET /health returns 200 during manual smoke test.
- Creating a full attempt results in new rows across `attempts`, `events` (>10 rows for non-trivial attempts), `movements` (>= movement steps), and `puzzle_progress` (on success) verified via SQLite query.
- Analytics dashboard numbers change after simulated gameplay (e.g., success rate adjusts); testers capture before/after snapshots.
- Puzzle replay view animates path identical to stored `movements` data when QA cross-references coordinates.
- Workspace honors deterministic block execution order: testers create loops/conditionals and confirm runtime output matches JSON-defined world state.
