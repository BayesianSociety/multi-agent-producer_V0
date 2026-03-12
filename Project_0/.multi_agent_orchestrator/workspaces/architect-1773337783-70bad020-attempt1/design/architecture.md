# Pet Vet Coding Puzzles Architecture

## System Context
- Browser-based React/TypeScript client renders the drag-and-drop block workspace, puzzle scenes, and analytics dashboards for educators. Runs in modern Chromium/Gecko browsers with WebGL/canvas support and speaks HTTPS to backend APIs.
- Shared runtime/content package (TypeScript) delivers puzzle data (17 JSON puzzles), block definitions, and deterministic execution engine. Bundled for both frontend (client-side execution, validation, hint selection) and backend (server-side validation, analytics enrichment).
- Node.js/Express backend hosts REST APIs, ingesting telemetry and persisting SQLite storage. Provides analytics endpoints consumed by frontend dashboards and seeds puzzle metadata during startup/migrations.
- SQLite database resides on the backend host/container filesystem. Stores canonical puzzle metadata cache, session/attempt lifecycle, high-volume events/movements, and per-user puzzle progression for analytics and replay.
- Local educators/developers interact through analytics UI; optional CLI/testing utilities drive HTTP endpoints based on TEST_CONTRACT.md.

## Major Modules / Components
1. **Shared Runtime & Content (`shared/**`)**
   - Puzzle pack: JSON definitions for scenes, grids, entities, available blocks, constraints, success criteria, hint rules.
   - Block definitions: strongly typed descriptions for movement/actions/control/logic/sensing categories, used to render workspace palette and to serialize/deserialize programs.
   - Execution engine: compiles On Start block graph into instruction list with loop guards, deterministic grid movement, collision detection, failure reason classification, and hint selection heuristics.
2. **Frontend Client (`frontend/**`)**
   - **Workspace UI**: Command library (left), code assembly column (right) with drag-and-drop, On Start root, Play/Reset/Step controls, speed toggle, and Show Code view.
   - **Game Canvas**: Renders puzzle scene backgrounds, characters, tweened movements, story bubbles, celebration/failure overlays.
   - **Telemetry Client**: Buffers UI/gameplay events, tags attempt/session IDs, flushes via POST `/api/events/batch`, retries on failure.
   - **Analytics Pages**: Dashboard totals, puzzle detail timeline + movement replay canvas, event stream viewer with filters.
   - **State Management**: Stores current puzzle, workspace graph, execution state, hint data, and integrates with shared runtime to simulate runs before/after sending telemetry.
3. **Backend Service (`backend/**`)**
   - Express server with routers: `events`, `analytics`, session/attempt lifecycle, health.
   - Telemetry ingestion pipeline: validates payload schema, stores events, movements, attempts, updates puzzle_progress, responds with counts.
   - Analytics queries: aggregated metrics, per-puzzle timelines, event streaming with pagination, path reconstructions from `movements` table.
   - SQLite data access layer with migrations, prepared statements, and transaction helpers for batch inserts.
4. **Database Layer (SQLite)**
   - Tables mandated in REQUIREMENTS/plan: `users`, `sessions`, `puzzles`, `attempts`, `events`, `movements`, `puzzle_progress`.
   - Views or helper queries for dashboard metrics, attempt timelines, movement replay.

## Data Flow
1. **Session Establishment**
   - Frontend Start CTA -> `POST /api/session/start` with user metadata.
   - Backend persists `sessions`, ensures `users` row exists, returns `sessionId` to client for subsequent calls.
2. **Puzzle Loading**
   - Frontend loads shared puzzle JSON & runtime types locally (bundled asset).
   - Backend seeds/validates identical puzzle metadata into `puzzles` table on startup/migration for analytics consistency.
3. **Workspace Interaction**
   - User drags blocks; client updates block graph state and logs UI events (`ui.block_added`, `ui.block_removed`). Events buffered locally until flush.
   - Show Code toggle leverages shared runtime to produce textual AST view; toggles log `ui.code_view_toggled`.
4. **Attempt Execution**
   - Play click -> backend `POST /api/attempts/start` with snapshot + block count; backend returns `attemptId`.
   - Client compiles block graph using shared execution engine, animates instructions, emits telemetry (`run.started`, `exec.block_*`, `move.*`, `world.*`, failure/success events) via `POST /api/events/batch` (immediate for run start/end, batched for block movements but never lossy).
   - On completion, client calls `POST /api/attempts/complete` with result, failureReason (if any), execution metrics.
   - Backend completes attempt row, updates `puzzle_progress`, runs hint mapping as needed.
5. **Analytics Consumption**
   - Dashboard page -> `GET /api/analytics/dashboard`: backend aggregates from attempts/events tables.
   - Puzzle detail -> `GET /api/analytics/puzzles/:id`: backend returns attempt metadata plus ordered movement arrays (join `movements` + `events`).
   - Event stream -> `GET /api/analytics/events`: backend filters events by session/attempt/puzzle for educators to inspect.

## Integration Boundaries
- **Frontend ↔ Shared Runtime**: imported TypeScript package exposes puzzle schema, block definitions, interpreter interfaces. Frontend never hardcodes puzzle logic; it delegates validation/hints to runtime and only renders blocks defined therein.
- **Frontend ↔ Backend APIs** (per TEST_CONTRACT): typed API client handles sessions, attempts, events, analytics endpoints. Payloads use deterministic JSON, no websockets. All HTTP requests include version headers to aid telemetry correlation.
- **Backend ↔ SQLite**: data access encapsulated in `backend/src/db/schema.ts` with migrations ensuring schema parity. Higher layers call repository functions rather than raw SQL to centralize validation and transaction management.
- **Shared Runtime ↔ Backend**: backend imports runtime package for data validation (e.g., verifying puzzle IDs, deriving concept tags) and for reusing instruction/failureReason enums when enriching analytics responses.

## Storage Strategy
- Single SQLite database file per deployment environment, located under configurable path (default `data/pet-vet.sqlite`).
- Write patterns:
  - Sessions/attempts inserted per lifecycle event.
  - Events/movements inserted via batch transactions for each POST `/api/events/batch` to guarantee atomicity.
  - Puzzle metadata seeded via migration 001 to ensure 17 puzzles synced with `shared/puzzles/puzzles.json` (checksum stored to detect drift).
  - Indexes on `events(session_id, ts)`, `movements(attempt_id, ts)`, `attempts(puzzle_id, result)` to support analytics queries.
- Backup/rotation: simple file-level backups or WAL mode to improve concurrent reads during analytics while ingestion occurs.

## Error Handling & Observability Strategy
- **Client**: Workspace disables play controls during run; UI shows inline validation if disconnected blocks exist. Failures produce Oops modal with hint text from runtime mapping. Network/API failures display toast with retry option; telemetry buffer persists until ack.
- **Backend**: Centralized error middleware returns JSON with `code`, `message`, `details`. Input validation via zod/io-ts ensures malformed batches rejected with 400 while logging sample payload. Database operations wrapped in try/catch with automatic retry for transient busy errors.
- **Telemetry Guarantees**: Attempt completion requires ack from backend; client retries with exponential backoff on failure. Movement logging considered critical; backend validates counts vs. execution_steps to detect drops.
- **Observability**: Structured logs (JSON) per request/event batch, metrics for request latency, batch sizes, DB write duration. Health endpoint checks DB connectivity and schema version.

## Deployment / Runtime Assumptions
- Local dev: `docker-compose` or npm scripts start Node server + React dev server + SQLite file on shared volume. Shared runtime published via workspace-relative TypeScript project references.
- Production-like: Node backend container (LTS 20) behind reverse proxy (NGINX) serving both API and static frontend build. SQLite stored on persistent volume with WAL enabled.
- Environment variables: `DATABASE_PATH`, `PORT`, `EVENT_BATCH_MAX`, `FRONTEND_BASE_URL`, `SHARED_CONTENT_VERSION`.
- Scaling: Expected classroom-scale usage; SQLite + single Node instance sufficient. For higher load, read replicas or migration to Postgres is future option but out-of-scope per simplifications.

## Risks & Simplifications
- **Risk: Telemetry Volume** — Movement + block events per attempt can be large. Mitigation: enforce batch size caps, streaming insert transactions, and optional compression (future). Need profiling tests.
- **Risk: Puzzle Data Drift** — Divergence between shared JSON and DB cache would break analytics. Mitigation: migration checksum + startup validation that halts server on mismatch.
- **Risk: Workspace Usability** — Custom block editor must remain performant and accessible. Mitigation: consider leveraging Blockly under custom skin; otherwise allocate time for keyboard navigation and screen-reader cues.
- **Risk: Replay Accuracy** — Animations must match stored movement coordinates; discrepancies harm teacher trust. Mitigation: single source of truth for physics/execution in shared runtime.
- **Simplification: Authentication** — Analytics area assumed local-only; no user auth beyond optional session/user IDs.
- **Simplification: Networking** — All communication via HTTP/JSON over same origin; no websockets or push notifications.
- **Simplification: Single Locale** — Copy uses English by default; localization hooks exist but not populated for MVP.
