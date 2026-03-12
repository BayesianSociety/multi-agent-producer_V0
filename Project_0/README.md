# Pet Vet Coding Puzzles

Pet Vet Coding Puzzles is a full-stack web experience that teaches sequencing, loops, and conditionals through 17 drag-and-drop veterinary missions. The React/Vite frontend renders the block workspace, 2D clinic scenes, and analytics dashboards, while the Node/Express backend with SQLite captures every session, attempt, event, and movement for replay and reporting. Shared TypeScript runtime code keeps puzzle content, instruction compilation, and hint logic consistent across both tiers.

## Project Structure
- `frontend/` – React + Vite single-page app (`frontend/src/App.tsx`) housing the workspace UI, canvas renderer, telemetry client, and analytics routes. Uses `VITE_API_BASE_URL` to locate the API.
- `backend/` – TypeScript Express service (`backend/src/server.ts`) exposing session, attempt, telemetry, analytics, and health endpoints plus SQLite data access (`backend/src/db/schema.ts`) and SQL migrations (`backend/src/db/migrations/001_init.sql`).
- `shared/` – Puzzle data (`shared/puzzles/puzzles.json`) and runtime logic (`shared/runtime/*.ts`) imported by both frontend and backend to avoid drift in level definitions, block catalogs, and interpreter rules.
- `tests/` – Manual + semi-automated verification guidance (`tests/TEST_PLAN.md`) derived from `TEST_CONTRACT.md`.
- `design/`, `plan/`, `REQUIREMENTS.md`, `TEST_CONTRACT.md`, `project_specification.md` – Source-of-truth documentation that captures UX, data, and delivery constraints for every role in the plan JSON.

## Run It Locally
### Prerequisites
- Node.js 20+ and npm 10+
- SQLite 3 CLI (for migrations and ad-hoc inspection)
- macOS/Linux shell or WSL with `curl`

### 1. Install dependencies
The frontend already includes a `package.json`; the backend currently ships only source, so you must create a package manifest locally before running it.

```
cd frontend
npm install

cd ../backend
npm init -y                                  # creates backend/package.json (not checked in)
npm install express better-sqlite3
npm install -D typescript ts-node @types/express @types/node
npx tsc --init --rootDir src --outDir dist   # optional but recommended for builds
```

These commands keep vendor files local without modifying tracked sources.

### 2. Initialize the SQLite database
```
mkdir -p data
sqlite3 data/pet-vet.sqlite < backend/src/db/migrations/001_init.sql
```
`TelemetryStore` also runs migrations on startup, but applying them explicitly lets you verify the schema and seeded puzzle metadata (`SELECT COUNT(*) FROM puzzles;` should be 17).

### 3. Start the backend API
```
PORT=4000 \
DATABASE_PATH="$(pwd)/data/pet-vet.sqlite" \
PUZZLES_JSON_PATH="$(pwd)/shared/puzzles/puzzles.json" \
EVENT_BATCH_MAX=500 \
npx ts-node backend/src/server.ts
```
The API listens on `/health`, `/api/session/*`, `/api/attempts/*`, `/api/events`, and `/api/analytics/*`. Adjust `PORT` or paths as needed for your environment.

### 4. Start the frontend workspace + dashboards
```
cd frontend
VITE_API_BASE_URL="http://localhost:4000" npm run dev
```
Visit `http://localhost:5173` (or the port Vite prints). The app immediately starts a session, loads puzzle data from `shared`, and points its telemetry client at the backend URL configured above.

## How to Validate Changes
1. **Static checks/builds**
   - `cd frontend && npm run build` ensures the Vite bundle compiles and shared runtime imports resolve.
   - For the backend, if you generated a `tsconfig`, run `npx tsc --project backend/tsconfig.json` (or `npx ts-node --transpile-only backend/src/server.ts` for a smoke run).
2. **Contract & plan alignment**
   - Keep `REQUIREMENTS.md`, `TEST_CONTRACT.md`, and `tests/TEST_PLAN.md` nearby; every change should uphold the mandated endpoints, schema, telemetry coverage, and 17-puzzle progression.
3. **Runtime smoke**
   - With both servers running, play through at least one puzzle to confirm:
     - Workspace hides during execution and shows the required "Oops + hint" modal on failure.
     - Telemetry batches hit `/api/events` (check browser devtools).
   - Verify `curl http://localhost:4000/health` responds `{ status: "ok", uptime: ... }`.
4. **Database assertions**
   - Query `attempts`, `events`, and `movements` tables after a run to ensure rows were written and puzzle metadata remains at 17 entries.
5. **Analytics spot check**
   - Browse the Analytics view in the app or hit `/api/analytics/dashboard` and `/api/analytics/puzzles/1` to ensure dashboards respond and playback data is present.

See `tests/TEST_PLAN.md` for the end-to-end verification matrix aligned with the formal `TEST_CONTRACT.md`.

## Key Constraints & Assumptions
- Exactly 17 JSON-defined puzzles must exist at all times; both frontend and backend import the same `shared/puzzles/puzzles.json` and checksum it when seeding the `puzzles` table.
- The workspace layout is fixed: left command library, right On Start stack, hide/minimize during execution, plus Play/Reset/Step buttons and a Show Code toggle.
- Every Play press becomes an `attempt` row, and every UI/gameplay action is persisted via `/api/events` and `/api/events/movements`, ensuring replays and analytics never drop steps.
- Telemetry and analytics rely on a single SQLite database (`data/pet-vet.sqlite`) accessed through `better-sqlite3`; WAL mode and foreign keys are turned on automatically.
- Frontend/backed communication is HTTP+JSON only; websockets, external auth, and third-party APIs are intentionally out of scope per the plan JSON.
- Educator dashboards read directly from backend analytics endpoints; therefore, migrations must be applied before startup, and schemas must not drift from `backend/src/db/migrations/001_init.sql`.
- Local development assumes a trusted environment (no auth); production hardening (TLS termination, auth) is a future enhancement but not assumed today.
