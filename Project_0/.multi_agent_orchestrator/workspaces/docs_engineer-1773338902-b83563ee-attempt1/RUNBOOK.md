# Pet Vet Coding Puzzles Runbook

Operational checklist for the Pet Vet Coding Puzzles stack (React/Vite frontend, Node/Express + SQLite backend, shared TypeScript runtime).

## Startup Steps
1. **Pre-flight**
   - Confirm Node.js ≥ 20, npm ≥ 10, SQLite CLI ≥ 3.39.
   - Ensure `shared/` is available locally; the backend seeds puzzle metadata from `shared/puzzles/puzzles.json`.
2. **Database**
   - `mkdir -p data`
   - `sqlite3 data/pet-vet.sqlite < backend/src/db/migrations/001_init.sql`
   - Verify tables/puzzle cache: `sqlite3 data/pet-vet.sqlite 'SELECT COUNT(*) FROM puzzles;'` → 17.
3. **Backend API**
   - Install dependencies if not already done (`cd backend && npm install express better-sqlite3 && npm install -D ts-node typescript @types/express @types/node`).
   - Export runtime env (see next section) and start the server: `npx ts-node backend/src/server.ts`.
   - Watch logs for `Telemetry API listening on port …`.
4. **Frontend workspace + analytics**
   - `cd frontend && npm install` (first run only).
   - `VITE_API_BASE_URL="http://localhost:4000" npm run dev` (or `npm run build && npm run preview` for a production-like bundle).
   - Navigate to the printed Vite URL and confirm the Start session call succeeds (network tab shows `POST /api/session/start`).

## Configuration & Runtime Dependencies
- **Node/Express backend** (`backend/src/server.ts`)
  - `PORT` (default 4000) – listening port.
  - `DATABASE_PATH` (default `data/pet-vet.sqlite`) – SQLite file path; directory must be writable.
  - `PUZZLES_JSON_PATH` – optional override for puzzle pack; defaults to `shared/puzzles/puzzles.json`.
  - `EVENT_BATCH_MAX` – maximum events accepted per `/api/events/batch` request (default 500).
  - `better-sqlite3` native module must match the OS/Node ABI; rebuild with `npm rebuild better-sqlite3 --build-from-source` if prebuilt binaries fail.
- **Frontend** (`frontend/package.json`)
  - `VITE_API_BASE_URL` – base URL for REST calls; must match the backend host/port and scheme (http/https).
  - Uses the shared runtime through TS path aliases (`@shared/*`), so both `frontend/src` and `shared` must be available when building.
- **Data**
  - SQLite runs in WAL mode with foreign keys enabled; keep filesystem permissions strict because the DB stores user/session telemetry.

## Basic Health Verification
1. **API health**
   - `curl http://localhost:4000/health` should return `{ status: "ok", uptime: <number>, ... }`. Any checksum/schema mismatch surfaces in this payload.
2. **Telemetry ingestion smoke**
   - From the frontend, click Play once. Query `sqlite3 data/pet-vet.sqlite 'SELECT COUNT(*) FROM attempts;'` and ensure it incremented.
   - Inspect `/api/events/batch` responses in the browser network panel; they should be 202 with counts below `EVENT_BATCH_MAX`.
3. **Analytics endpoints**
   - `curl http://localhost:4000/api/analytics/dashboard` should return totals even if zeroed.
   - `curl http://localhost:4000/api/analytics/puzzles/1` should return attempt arrays (empty when no data).
4. **Frontend UI**
   - Load the app, confirm the progress indicator reads "Puzzle 1 of 17" and the command library appears on the left. Trigger an intentional failure to ensure the "Oops + hint" modal renders.

## Release / Update Steps
1. **Cut a release branch/tag** referencing the commit under deployment.
2. **Run the validation suite**
   - Follow `tests/TEST_PLAN.md` (HTTP matrix, manual workspace checks) and `TEST_CONTRACT.md` for acceptance evidence.
   - Run `npm run build` in `frontend/` and lint/compile the backend (`npx tsc --project backend/tsconfig.json` if you generated one, or `npx ts-node --transpile-only backend/src/server.ts` as a sanity check).
3. **Bundle frontend assets**
   - `cd frontend && npm run build`; deploy the resulting `frontend/dist` folder behind your static server or copy into the backend's public root if you serve both from one host.
4. **Prepare backend artifact**
   - Either continue using `ts-node` (dev/staging) or emit JavaScript once by running `npx tsc --project backend/tsconfig.json --outDir backend/dist` and serving with `node backend/dist/server.js`.
   - Ensure the deployment target has `better-sqlite3` rebuilt for its CPU/OS.
5. **Migrate and seed database**
   - Re-run the SQL migration against the production database; TelemetryStore validates checksum/version for all 17 puzzles on boot and will refuse to start if they drift.
6. **Deploy & verify**
   - Restart backend, then rerun the health checks plus one synthetic puzzle attempt to ensure telemetry + analytics remain functional post-release.

## Troubleshooting
- **`better-sqlite3` install errors** – Run `npm rebuild better-sqlite3 --build-from-source` or install build tools (`python3`, `make`, `gcc`) before repeating `npm install`.
- **`/health` shows checksum mismatch** – The puzzles table hash no longer matches `shared/puzzles/puzzles.json`. Re-seed by deleting/recreating `data/pet-vet.sqlite` or rerun the migration, then restart the server.
- **`POST /api/events/batch` returns 400/413** – Batch exceeded `EVENT_BATCH_MAX` or payload invalid. Inspect logs; reduce client batch size (see `frontend/src/lib/telemetry.ts`) or raise the environment limit after confirming capacity.
- **Frontend cannot reach backend (CORS/network errors)** – Confirm `VITE_API_BASE_URL` matches the backend origin and that the backend is reachable from the browser. In dev, run both hosts on `localhost` or configure a proxy.
- **Analytics dashboard empty despite attempts** – Query `sqlite3 data/pet-vet.sqlite 'SELECT * FROM movements LIMIT 1;'`. If empty, ensure the frontend is flushing telemetry (watch network tab) and that backend logs do not show constraint violations. Movement inserts are wrapped in transactions; a single malformed row rejects the whole batch.
- **Session never completes** – If the browser tab closes before `/api/session/end`, stale sessions remain. Run `sqlite3 data/pet-vet.sqlite 'UPDATE sessions SET ended_at=strftime("%s","now")*1000 WHERE ended_at IS NULL;'` to clean up for analytics testing.
