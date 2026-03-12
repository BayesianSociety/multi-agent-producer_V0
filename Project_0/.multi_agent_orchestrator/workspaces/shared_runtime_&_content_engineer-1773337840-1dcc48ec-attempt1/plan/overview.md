# Plan Overview

## System Summary
Pet Vet Coding Puzzles is a web app delivering a 17-level veterinary-themed block-coding experience. A shared runtime defines puzzle JSON, hint rules, and the deterministic interpreter. The React frontend renders the workspace (command library left, On Start canvas right), scenes, telemetry buffering, and analytics dashboards. The Node/Express backend ingests telemetry via HTTP, persists it in a SQLite schema (users, sessions, puzzles, attempts, events, movements, puzzle_progress), and exposes analytics/replay APIs powering educator views.

## Delivery Phases (per plan JSON)
1. **Phase 1 – Shared Runtime & Content Engineer**
   - Model 17-level JSON data pack, hint rules, and execution engine contracts.
   - Deliver shared TypeScript APIs consumed by app tiers.
2. **Phase 2a – Frontend Experience & Workspace Engineer**
   - Build React UI, drag-and-drop workspace, code-view toggle, telemetry client, analytics pages.
   - Integrate shared runtime for instruction execution and puzzle rendering.
3. **Phase 2b – Backend Telemetry & Analytics Engineer**
   - Implement Express server, SQLite schema/migrations, telemetry ingestion, analytics + replay routes.
   - Seed puzzle metadata from shared JSON and coordinate payload contracts with frontend.

Phase 2a and 2b run in parallel after Phase 1 artifacts are frozen; cross-team API mocks enable earlier integration tests.

## Dependency Graph Between Key Artifacts
- `shared/puzzles/puzzles.json` → consumed by `frontend/src/game/*` for rendering and by `backend/src/db/schema.ts` for puzzles table seeding.
- `shared/runtime/executionEngine.ts` → consumed by frontend run loop (instruction playback) and referenced by backend analytics to interpret stored executions.
- `frontend/src/components/Workspace/Workspace.tsx` → depends on shared block definitions and emits telemetry payloads expected by `backend/src/routes/events.ts`.
- `backend/src/db/migrations/001_init.sql` → generates SQLite tables required by analytics routes and by QA verifications defined in TEST_CONTRACT.md.
- `frontend/src/pages/AnalyticsDashboard.tsx` ↔ `backend/src/routes/analytics.ts` → bidirectional contract ensuring dashboard cards, puzzle detail timelines, and event stream viewers display DB-derived metrics.
