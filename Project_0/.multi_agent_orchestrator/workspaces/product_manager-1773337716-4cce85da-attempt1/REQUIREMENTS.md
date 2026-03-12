# Pet Vet Coding Puzzles Requirements

## Scope
- Deliver a browser-based veterinary-themed block-coding puzzle game with exactly 17 data-driven puzzles covering sequencing, loops, and conditionals.
- Provide a shared runtime + content pack used by both frontend gameplay logic and backend analytics/validation.
- Ship a polished React/TypeScript UI with draggable workspace, puzzle scenes, telemetry client buffers, and teacher-facing analytics views.
- Implement a Node/Express + SQLite backend that ingests telemetry, persists mandated tables, and powers analytics + replay APIs.
- Include project documentation (this requirements doc, TEST_CONTRACT.md, AGENT_TASKS.md, plan/overview.md) within the workspace.

## User Stories
1. **Learner:** "As a new coder, I need a drag-and-drop On Start workspace with puzzle-specific blocks so I can assemble solutions without typing code."
2. **Learner (feedback):** "When I run the wrong solution, I want an 'Oops!' message with a contextual hint so I understand what to fix."
3. **Learner (progression):** "I want 17 progressively harder puzzles introducing sequencing, loops, and conditionals so I can gain confidence step by step."
4. **Mentor/Teacher:** "I need analytics dashboards that summarize sessions, attempts, success rates, and movement replays so I can monitor how learners perform."
5. **Data Engineer:** "I need every gameplay/UI action logged into SQLite so that no movement, execution step, or interaction is missed."
6. **QA/Operator:** "I need clear health and telemetry endpoints plus deterministic content so I can verify deployments quickly."

## Architecture Expectations
- **Shared Layer (`shared/**`):** Owns JSON-defined puzzle pack (17 levels), hint rules, and deterministic execution engine compiling block graphs to instructions (grid movement, loops, conditionals, collisions, failure reasons).
- **Frontend (`frontend/**`):** React/TypeScript client with canvas/scene renderer, left command library, right workspace anchored by On Start, Play/Reset/Step controls, code-view toggle, telemetry buffering, analytics dashboard pages (sessions summary, puzzle detail, event stream viewer).
- **Backend (`backend/**`):** Node/Express service exposing session lifecycle endpoints, telemetry ingestion (`POST /api/events/batch`), analytics queries (`GET /api/analytics/...`), movement replay API, and SQLite integration (tables: users, sessions, puzzles, attempts, events, movements, puzzle_progress). Includes migrations + schema module.
- **Database:** Single SQLite file initialized with required tables and puzzle metadata cache. Writes batched transactions for event ingestion.
- **Analytics:** Uses backend APIs to materialize dashboards, attempt timelines, and path replays (reconstruct from `movements`).
- **Deployment:** Runs locally with environment-configurable paths; no external dependencies beyond standard Node/React toolchain.

## Constraints
- Must honor plan JSON: do not change project type/components/roles; keep exactly 17 puzzles and mandated deliverables.
- Workspace UI must show command library left, on-start code area right, and hide/minimize during run while honoring "Oops + hint" pattern.
- Execution engine must be deterministic, compile block graph to instruction list, enforce loop safety cap, and detect collisions/failure reasons.
- Telemetry must capture every movement, execution step, UI event, and treatment interaction; movement steps also persisted in `movements` table.
- SQLite schema must include users, sessions, puzzles, attempts, events, movements, puzzle_progress with described columns + constraints.
- Frontend/Backend integration must use HTTP (no websockets) and keep payloads JSON.
- No proprietary characters/logos; maintain original mentor/pet designs.

## Non-Functional Requirements
- **Reliability:** Telemetry ingestion cannot drop events; client buffering plus backend batching with retry semantics.
- **Performance:** Workspace interactions should respond <50ms; event ingestion endpoints handle burst of block events without blocking UI.
- **Accessibility:** Keyboard navigation for controls, color-contrast compliant palette, optional text-to-speech for goal text.
- **Maintainability:** Puzzle data-driven so new levels require JSON edits only; runtime shared across tiers to avoid duplication.
- **Observability:** Health endpoint, structured logs, traceable attempt IDs linking UI events to DB rows.
- **Security:** Backend validates payloads, limits batch sizes, and sanitizes inputs before storage.

## Delivery Assumptions
- Development occurs within current workspace; no external SaaS or third-party services beyond allowed OSS libraries.
- Analytics pages are local-only and can assume trusted educator audience; no auth beyond local safeguards.
- Testing uses local SQLite file seeded/migrated through provided scripts/migrations.
- Shared runtime contract is stable before frontend/backend phase-2 work begins (phase grouping from plan JSON).
- Build + package scripts rely on Node LTS and standard React toolchain; CLI is optional/not in scope per plan.

## Acceptance Criteria
1. Exactly 17 puzzles defined in JSON with titles, goals, scenes, available blocks, constraints, success criteria, and hint rules.
2. Workspace shows left command library, right On Start area, Play/Reset/Step controls, code-view toggle, and hides during run.
3. Failed runs trigger "Oops!" UI plus contextual hint based on computed failureReason.
4. Execution engine compiles block graph to deterministic instructions supporting movement, actions, loops, conditionals, and collision detection.
5. Telemetry covers attempt lifecycle, UI interactions, block executions, movement steps, collisions, pickups, treatments, hints, completions.
6. SQLite contains mandated tables plus migrations; completed attempt writes attempts/events/movements rows and updates puzzle_progress.
7. Backend exposes documented HTTP endpoints (session start/end, event batch, analytics, health) returning JSON and proper status codes.
8. Analytics dashboard shows totals, averages, and puzzle-level timelines with movement replay driven by SQLite data.
9. All documentation artifacts (REQUIREMENTS.md, TEST_CONTRACT.md, AGENT_TASKS.md, plan/overview.md) exist and reflect current constraints.
