# Pet Vet Coding Puzzles Test Plan

## 1. Scope & Objectives
- Validate every externally observable behavior from `TEST_CONTRACT.md`, spanning backend HTTP endpoints, frontend gameplay UX, telemetry persistence, analytics UI, and acceptance evidence.
- Ensure regressions are caught via a mix of automated API checks (e.g., `curl`, `npm test`) and manual exploratory gameplay that mirrors real learner/teacher flows.

## 2. Environment, Startup, and Teardown
- **Prereqs:** Node.js LTS, npm, SQLite3 CLI. Source tree synced to same revision for frontend/backend/shared packages.
- **Startup:**
  1. `npm install` (root/back/front as needed).
  2. Run `npm run migrate` or equivalent to apply `backend/src/db/migrations/001_init.sql`.
  3. `npm run dev:backend` (ensures `/health` exposes DB + schema state) and `npm run dev:frontend` pointing to backend base URL.
- **Test Data:** Seed at least one synthetic user/session plus puzzle metadata (17 rows) before executing suites.
- **Teardown:** Stop dev servers, archive SQLite DB for evidence, and reset DB between destructive tests via migration rollback/recreate.

## 3. Test Strategy Overview
- **Automation:** Lightweight shell/API scripts hit REST endpoints with golden payloads + validation (`jq` assertions). DB state verified via SQLite queries.
- **Manual Checks:** Required for drag/drop UX, Oops modal behavior, workspace hide/show, analytics visualizations, and hint accuracy.
- **Failure Injection:** Use crafted payloads (e.g., oversized event batches, invalid attempt IDs) to confirm defensive paths.

## 4. HTTP Endpoint Test Matrix
For each endpoint below, execute success + error scenarios and log evidence (request/response, DB snapshot).

### 4.1 `GET /health`
- **Happy Path:** With backend + DB running, expect `200` and JSON `{status:"ok", uptime:number}`.
- **Failure Case:** Simulate DB outage (rename SQLite file) → expect `503`/error body and logged alarm.
- **Manual Check:** Validate response time <200 ms and uptime monotonic across calls.

### 4.2 `POST /api/session/start`
- **Happy Path:** Payload `{ userId:"qa-user", locale:"en-US", userAgent:"QA" }` returns `201` + `{ sessionId }`; confirm `sessions` insert + optional `users` row.
- **Edge Cases:**
  - Missing `locale` -> expect `400` validation error.
  - Duplicate `userId` -> still create session; verify multiple rows linked to same user.

### 4.3 `POST /api/session/end`
- **Happy Path:** Provide valid `sessionId`; expect `200` idempotent response even if already ended.
- **Failure Case:** Unknown `sessionId` -> expect `404` or documented error.
- **DB Check:** `sessions.ended_at` populated and not regressing (no earlier timestamp after later request).

### 4.4 `POST /api/attempts/start`
- **Happy Path:** Provide known `sessionId`, `puzzleId`, `codeSnapshotJson`, `blockCount`; expect `201/200` with `{attemptId}` and `attempts` row stub.
- **Failure Case:** `blockCount` mismatch (<0) → expect `400`.
- **Manual Note:** Capture returned `attemptId` for chaining later tests.

### 4.5 `POST /api/events/batch`
- **Happy Path:** Send batch with `run.started`, `exec.block_*`, `move.step`, etc.; expect `202` with persisted rows in both `events` and `movements` tables. Verify `movements` counts match executed steps.
- **Failure Cases:**
  - Batch length > configured max → expect `413/400` with descriptive error.
  - Missing `sessionId` → expect `400`.
  - Movement payload missing coordinates → backend rejects item, transaction rolls back.
- **Manual Check:** Confirm partial failure does not write any rows (atomicity).

### 4.6 `POST /api/attempts/complete`
- **Success Scenario:** Provide `result:"success"`, `executionSteps`, `endedAt`; expect attempt row update, `puzzle_progress` upsert, and JSON envelope mirroring DB state.
- **Failure Scenario:** Provide `result:"failure"` + `failureReason:"collision"`; ensure attempt row records failure, `puzzle_progress` unchanged.
- **Data Integrity:** `executionSteps` must equal number of `exec.block_*` events; cross-check via SQL.

### 4.7 `GET /api/analytics/dashboard`
- **Happy Path:** With seeded attempts, expect totals (sessions, attempts, success rate, avg attempts/time). Validate formula accuracy via manual SQL queries.
- **Failure Case:** Force empty DB to ensure zeros returned gracefully.
- **Manual Check:** Response refresh performed at least every 60s by frontend (see Section 5 tests).

### 4.8 `GET /api/analytics/puzzles/:puzzleId`
- **Happy Path:** Query existing `puzzleId`; expect ordered attempt timeline objects incl. `codeSnapshotJson`, movement arrays for replay. Compare movement path vs. `movements` table order.
- **Failure Case:** Invalid puzzle ID (0/18) returns `404` or empty array per contract.
- **Edge Case:** Puzzle with no attempts returns empty timeline but still includes basic metadata.

### 4.9 `GET /api/analytics/events?sessionId=&attemptId=`
- **Happy Path:** Filter by known `sessionId`/`attemptId`; expect chronologically sorted events and pagination metadata.
- **Failure Case:** Missing filters still permitted? Validate documented behavior (should probably require at least one filter; ensure backend enforces/handles).
- **Manual Check:** Ensure payload JSON fields decode properly (e.g., `payload.hintId`).

## 5. Frontend Behavioral Tests
Execute within browser devtools + automated smoke where feasible.

- **Landing Session Start:** Click Start CTA, confirm network call to `/api/session/start` with locale/userAgent. Validate UI transitions to level select.
- **Level Select Progression:** Verify 17 puzzle cards, lock icons for future levels. After completing puzzle N, ensure puzzle N+1 unlocks (requires telemetry cycle + attempt completion).
- **Workspace Layout:** Confirm command library (Movement, Actions, Control, Logic, Sensing) left panel, On Start column right. Dragging blocks should snap; attempt to leave block disconnected → UI warning toast.
- **Play Cycle:** During run, workspace hides/minimizes; editing disabled until run end. Verify Play button logs `ui.play_clicked`; Reset button emits `ui.reset_clicked` + resets scene state.
- **Show Code Toggle:** Switch to code view; ensure read-only text matches current block graph and event `ui.code_view_toggled` fires (inspect network payloads or telemetry logs).
- **Failure Flow:** Intentionally cause failure (e.g., collide with obstacle) → Expect "Oops!" modal, hint text mapping to `failureReason`, `ui.hint_shown` event payload includes `hintId`. Confirm failure reason forwarded to backend via attempt completion.
- **Success Flow:** Run valid solution, ensure success celebration, `puzzle.completed` event emitted, and progress indicator updates ("Puzzle X of 17").

## 6. Telemetry & Database Validation
- **Attempt Lifecycle Audit:** For a captured attempt, query SQLite:
  - `attempts` row includes `code_snapshot_json`, `block_count`, `execution_steps`.
  - `events` contains >10 rows including UI, run, exec, world actions with consistent timestamps.
  - `movements` rows count equals actual steps, `blocked` flag toggles on collisions, `direction` aligns with runtime orientation.
  - `puzzle_progress` updates only on success, keyed by `user_id`/`puzzle_id`.
- **Consistency Checks:**
  - Execution steps vs. events: number of `exec.block_started` equals `exec.block_finished`.
  - Movement replay accuracy: reconstruct path from DB and compare to frontend canvas trace.
  - Hint telemetry: `ui.hint_shown.payload` includes `failureReason` matching modal text.

## 7. Analytics UI Verification
- **Dashboard Auto-Refresh:** Load dashboard page; observe network polling of `/api/analytics/dashboard` ≤60 s cadence. Compare displayed totals with SQL query snapshots.
- **Puzzle Detail:** Choose puzzle with multiple attempts; ensure timeline ordering newest → oldest, cards show `result`, `failureReason`, `executionSteps`, and read-only code. Replay canvas should animate along coordinates returned by API.
- **Event Stream Viewer:** Apply filters (`sessionId`, `attemptId`); validate table columns (`ts`, `type`, parsed payload). Confirm copy-to-clipboard works and pagination loads further events.
- **Error Handling:** Disconnect backend to confirm UI surfaces error banners without crashing.

## 8. Failure Case Catalog
- Oversized event batch rejection.
- Invalid puzzle ID for analytics endpoints.
- Attempt completion without prior start (expect error response).
- Workspace disconnected blocks preventing Play (UI warning case).
- Collision failure verifying `blocked=1` and hint references obstacles.
- Session end idempotency (repeat call).

## 9. Manual Evidence & Logging
- Capture screenshots/logs for:
  - `/health` success.
  - Session start payload.
  - Attempt lifecycle DB queries (before/after).
  - Analytics dashboard metrics change after new attempt.
  - Puzzle replay overlay vs. DB movement table.
- Store evidence artifacts under `tests/artifacts/<date>` for audit.

## 10. Regression & Smoke Checklist
- **Daily Smoke:**
  1. Start backend/frontend, hit `/health`.
  2. Complete one full puzzle attempt (success) ensuring events + movements rows inserted.
  3. Verify analytics dashboard updates.
- **Release Regression:** Run full HTTP matrix (Section 4) + frontend manual checks (Section 5) + telemetry SQL audits (Section 6) before tagging release.

## 11. Teardown Confirmation
- Drop/reseed SQLite DB if contamination detected.
- Stop servers and clear telemetry buffers to avoid cross-test leakage.
