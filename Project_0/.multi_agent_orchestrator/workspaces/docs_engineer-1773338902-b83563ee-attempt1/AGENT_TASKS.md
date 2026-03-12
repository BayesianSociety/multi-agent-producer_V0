# Agent Task Matrix

## Shared Runtime & Content Engineer (phase1)
- **Owned Paths:** `shared/**`
- **Required Inputs:** `project_specification.md` (full gameplay + telemetry rules), plan JSON constraints, UI requirements shared with frontend/backend.
- **Required Outputs:** `shared/puzzles/puzzles.json`, `shared/runtime/blockDefinitions.ts`, `shared/runtime/executionEngine.ts` containing deterministic interpreter, hint rules, 17-level progression data.
- **Dependencies:** None upstream beyond specs; acts as the first producer in phase1.
- **Downstream Consumers:** Frontend Experience & Workspace Engineer (needs block definitions + puzzles), Backend Telemetry & Analytics Engineer (needs puzzles JSON for metadata validation and runtime parity).
- **Done Criteria:**
  - 17 puzzles defined with titles, goalText, scenes, availableBlocks, constraints, successCriteria, hintRules.
  - Execution engine compiles On Start graph to instruction list with loop safety caps, movement grid rules, and failure reason emission.
  - Shared typings exported for frontend/backend use (puzzle schema, event enums).
  - Content pack versioned and accessible as npm/ts module.

## Frontend Experience & Workspace Engineer (phase2)
- **Owned Paths:** `frontend/**`
- **Required Inputs:** `shared/**` (puzzle data + runtime contracts), backend endpoint definitions (`backend/src/server.ts`, API spec), plan JSON global constraints.
- **Required Outputs:** `frontend/public/index.html`, `frontend/src/App.tsx`, `frontend/src/components/Workspace/Workspace.tsx`, `frontend/src/game/GameCanvas.tsx`, `frontend/src/pages/AnalyticsDashboard.tsx`.
- **Dependencies:**
  - Blocks on Shared Runtime & Content deliverables for puzzle data, block definitions, and interpreter contract.
  - Requires Backend telemetry endpoints to push buffered events and fetch analytics data.
- **Outputs Consumed By:** QA/analytics reviewers via browser, backend integration tests for telemetry payload validation.
- **Done Criteria:**
  - UI shows left command library + right workspace with On Start root, Play/Reset/Step controls, and code-view toggle.
  - Scenes render puzzle states and animate runs via shared runtime instructions.
  - Telemetry client buffers events, flushes via POST `/api/events/batch`, and tags attempt IDs.
  - Analytics dashboard + puzzle detail + event viewer pages use backend APIs and replay movement paths from SQLite data.
  - Accessibility affordances implemented (keyboard focus, contrast, text scaling).

## Backend Telemetry & Analytics Engineer (phase2)
- **Owned Paths:** `backend/**`
- **Required Inputs:** `project_specification.md`, `shared/puzzles/puzzles.json` (for seeding `puzzles` table), API expectations from plan.
- **Required Outputs:** `backend/src/server.ts`, `backend/src/routes/events.ts`, `backend/src/routes/analytics.ts`, `backend/src/db/schema.ts`, `backend/src/db/migrations/001_init.sql`.
- **Dependencies:**
  - Needs Shared Runtime puzzles JSON for metadata seeding and runtime parity checks.
  - Coordinates with Frontend engineer on payload formats (session lifecycle, event batches, analytics responses).
- **Outputs Consumed By:** Frontend telemetry + analytics clients, QA automation verifying DB schema + HTTP contract.
- **Done Criteria:**
  - Express server exposes documented endpoints (health, session start/end, attempts start/complete, events batch, analytics dashboards, puzzle detail, event stream).
  - SQLite migrations create users, sessions, puzzles, attempts, events, movements, puzzle_progress tables with indexes.
  - Event ingestion writes to events + movements with transactional batching, rejects malformed payloads, and emits analytics-ready aggregates.
  - Analytics routes compute dashboard metrics, attempt timelines, and movement replays sourced from DB rows.
  - Automated schema validation + seed ensures puzzles table always has 17 records matching shared data.

## Cross-Agent Dependencies & Handoffs
- Phase ordering enforced: Shared Runtime completes before frontend/backend begin (phase1 → phase2).
- Shared puzzle schema version must be semver-tagged; frontend/backend pin same version to prevent drift.
- Backend provides mocked endpoints early so frontend can develop while telemetry persistence finishes; contract tracked in TEST_CONTRACT.md.
- Agents share integration artifacts (TypeScript types, API clients) through `shared/` or generated SDK to keep single source of truth.
