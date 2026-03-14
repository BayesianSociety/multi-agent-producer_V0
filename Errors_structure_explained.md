# Errors Structure Explained

## Scope

This document explains the important failures encountered while running and repairing the orchestrator-driven production flow in this chat.

It is based only on:
- the real error output pasted during the session
- the real files in this repository
- the real orchestrator and generated project files that were inspected and patched

For each issue, this document shows:
- what failed
- what the failed state looked like
- what the desired state should have been
- why the failure happened

At the end, all issues are grouped into unified error classes.

---

## 1. Planner Produced a Description Instead of a File Path

### What failed

The planner produced a `required_outputs` entry that was a human description instead of a relative file path.

### Real failed error

The orchestrator failed with:

```text
ERROR: Plan validation failed: required output 'Responsive UI with block workspace, 17 puzzle scenes, mentor dialog, controls, and animations' is not covered by owned_paths for role 'Frontend Game & Analytics'.
```

### Failed state

The plan contained a value shaped like:

```text
Responsive UI with block workspace, 17 puzzle scenes, mentor dialog, controls, and animations
```

That is not a path.

### Desired state

The same field needed to contain concrete relative file outputs, for example the real patterns enforced later by the orchestrator:

```text
frontend/index.html
frontend/src/App.tsx
backend/src/server.ts
tests/TEST_PLAN.md
```

### Why it failed

The planner prompt and schema were too permissive. They allowed strings, but not strictly path-like strings, so Codex returned a deliverable description instead of a filesystem path.

---

## 2. Planner Keywords Were Used as Hard Validation and Caused False Failures

### What failed

The orchestrator originally treated planner-generated `validation_keywords` as mandatory literal evidence in generated files.

### Real failed errors

Examples from the run:

```text
ERROR: [Gameplay Frontend Engineer] Validation failed: expected keyword 'on-start root block' in required outputs.
```

and later:

```text
ERROR: [Backend Telemetry & Data Lead] Validation failed: expected keyword 'analytics aggregates' in required outputs.
```

### Failed state

The planner generated phrases like:

```text
on-start root block
analytics aggregates
```

These phrases were then checked literally against implementation artifacts.

### Desired state

Planner-authored phrases should not be a fatal gate unless they are exact, stable strings that truly must appear.

The desired validator behavior was:
- validate real files exist
- validate route contract is implemented
- validate schema files contain SQL
- validate UI/backend assets exist
- do not fail only because wording differs

### Why it failed

The planner was allowed to invent semantic phrases, but the validator treated them as exact proof requirements. That made the system fail on phrasing differences rather than actual broken output.

---

## 3. Backend Contract Validation Was Too Literal for Route Text

### What failed

Backend contract validation originally compared route requirements too literally against source text.

### Real failed error

One of the early backend validation failures was:

```text
ERROR: [Backend Telemetry & Platform Engineer] Validation failed: backend outputs do not reference contract path(s): /api/analytics/events?sessionId=...&attemptId=...`, /api/analytics/puzzles/:puzzleId`, /api/analytics/summary`, /health`, /api/events/batch`, /api/session/end`
```

### Failed state

The contract file contained real endpoint lines in markdown, for example from [`TEST_CONTRACT.md`](/home/postnl/multi-agent-producer_V0/Project_0/TEST_CONTRACT.md):

```text
- `GET /api/analytics/events?sessionId=...&attemptId=...`
- `GET /api/analytics/puzzles/:puzzleId`
- `GET /api/analytics/summary`
```

But the backend used mounted routers, for example from [`backend/src/server.ts`](/home/postnl/multi-agent-producer_V0/Project_0/backend/src/server.ts):

```ts
app.use('/api', createEventsRouter(db));
app.use('/api/analytics', createAnalyticsRouter(db));
```

And the route definitions were split into route files.

### Desired state

Validation should normalize:
- markdown backticks
- query strings
- `:param` route syntax
- mounted router prefixes

So the route contract:

```text
GET /api/analytics/puzzles/:puzzleId
```

and the implementation pattern:

```ts
app.use('/api/analytics', createAnalyticsRouter(...))
router.get('/puzzles/:puzzleId', ...)
```

should be understood as a match.

### Why it failed

The validator originally compared raw strings or very weak text evidence, so it misread equivalent route definitions as missing.

---

## 4. Backend Contract Validation Also Caught a Real Routing Bug

### What failed

One backend generation produced doubled route prefixes.

### Real observed code

The app mounted the analytics router in [`backend/src/server.ts`](/home/postnl/multi-agent-producer_V0/Project_0/backend/src/server.ts):

```ts
app.use('/api/analytics', createAnalyticsRouter(db));
```

But the generated analytics router in [`backend/src/routes/analytics.ts`](/home/postnl/multi-agent-producer_V0/Project_0/backend/src/routes/analytics.ts) contained lines like:

```ts
router.get('/analytics/dashboard', ...)
router.get('/analytics/puzzles/:id', ...)
router.get('/analytics/events', ...)
router.get('/analytics/movements/:attemptId', ...)
```

### Failed state

That composition results in final endpoints like:

```text
/api/analytics/analytics/dashboard
/api/analytics/analytics/puzzles/:id
```

### Desired state

Mounted router prefix and router-local paths should compose once:

If server mounts:

```ts
app.use('/api/analytics', router)
```

then router should define:

```ts
router.get('/dashboard', ...)
router.get('/puzzles/:id', ...)
router.get('/events', ...)
```

### Why it failed

The generated backend repeated the mount prefix inside the router file. This was a real implementation error, not just a validator error.

---

## 5. Backend SQL Validation Failed Because `.sql` Files Were Not Read

### What failed

The orchestrator required SQL schema evidence but initially did not include `.sql` files in the validation text set.

### Real failed error

```text
ERROR: [Backend Telemetry & Analytics API] Validation failed: expected SQL schema content in backend/database outputs.
```

### Failed state

The backend role did generate a schema file, and the plan required it, for example from [`.multi_agent_orchestrator/plan.json`](/home/postnl/multi-agent-producer_V0/Project_0/.multi_agent_orchestrator/plan.json):

```json
"required_outputs": [
  "backend/package.json",
  "backend/src/server.ts",
  "backend/src/db/schema.sql",
  "backend/src/routes/events.ts",
  "backend/src/routes/analytics.ts"
]
```

But the validator’s collected text did not include `.sql` files yet.

### Desired state

If a backend worker owns:

```text
backend/src/db/schema.sql
```

then that file must be read during validation so strings like:

```sql
CREATE TABLE
ALTER TABLE
```

can actually be detected.

### Why it failed

The validator logic excluded `.sql` from the set of readable validation sources, so it could never see the schema content it was trying to prove.

---

## 6. QA Validation Required One Exact Heading

### What failed

The QA validator required the exact phrase `Manual checks`, even when the generated test plan clearly included a manual section under a different but equivalent title.

### Real failed error

```text
ERROR: tests/TEST_PLAN.md validation failed: missing 'Manual checks' section.
```

### Failed state

The generated file [`tests/TEST_PLAN.md`](/home/postnl/multi-agent-producer_V0/Project_0/tests/TEST_PLAN.md) contained:

```text
## 5. Manual Exploratory Checklist
```

It also contained manual test content such as:

```text
- Run through 3 representative puzzles (early, mid, late) ...
- Simulate slow network / offline scenario ...
```

### Desired state

The validator should accept equivalent section titles such as:

```text
Manual checks
Manual checklist
Manual exploratory checklist
Manual testing
```

### Why it failed

The check was too literal and tested one exact phrase instead of the presence of a real manual-testing section.

---

## 7. QA Endpoint Coverage Validation Was Too Literal for Route Variants

### What failed

The QA plan sometimes used one equivalent parameterized path form while the validator required another.

### Real failed error

```text
ERROR: tests/TEST_PLAN.md missing endpoint coverage for GET /api/analytics/puzzles/{param}.
```

### Failed state

The generated test plan in [`tests/TEST_PLAN.md`](/home/postnl/multi-agent-producer_V0/Project_0/tests/TEST_PLAN.md) used route examples like:

```text
GET /api/analytics/puzzles/:id
```

while normalized contract validation looked for:

```text
/api/analytics/puzzles/{param}
```

### Desired state

These forms should be treated as the same route family:

```text
/api/analytics/puzzles/:id
/api/analytics/puzzles/{param}
/api/analytics/puzzles/1
```

### Why it failed

The validator was comparing normalized contract routes against raw text in the test plan without fully canonicalizing the test-plan endpoints too.

---

## 8. Codex Runtime Corruption During Worker Execution

### What failed

A frontend worker entered an unstable Codex runtime state and then timed out.

### Real failed output

The logs showed repeated runtime errors such as:

```text
[verbose] Frontend Experience Lead: stderr=2026-03-12T07:15:06.434929Z ERROR codex_core::util: Custom tool call output is missing for call id: call_TagMREwXYSeUyzKNutUjg8Bp
```

followed later by:

```text
[verbose] Frontend Experience Lead: timed out after 1800s

ERROR: codex timed out after 1800s: codex exec --experimental-json --model gpt-5.1-codex --sandbox workspace-write --config 'approval_policy="never"' --skip-git-repo-check
```

### Failed state

The worker stayed alive while repeatedly reporting:

```text
Custom tool call output is missing
```

and only failed after the full timeout period.

### Desired state

The orchestrator should detect repeated runtime corruption signatures early, terminate the bad worker, and retry in a fresh staged workspace.

### Why it failed

The worker subprocess entered a broken Codex tool-call state. The orchestrator did not originally classify that as a transient runtime failure.

---

## 9. Asyncio Stdout Reader Crashed on Oversized Codex JSON Line

### What failed

The orchestrator read Codex stdout line-by-line using asyncio’s default line buffer.

### Real failed error

```text
asyncio.exceptions.LimitOverrunError: Separator is found, but chunk is longer than limit
...
ValueError: Separator is found, but chunk is longer than limit
```

### Failed state

The original `run_codex()` used iteration like this in [`multi_agent_orchestrator.py`](/home/postnl/multi-agent-producer_V0/Project_0/multi_agent_orchestrator.py):

```python
async for raw_line in proc.stdout:
    line = raw_line.decode("utf-8", errors="replace").strip()
```

### Desired state

Stdout and stderr should be read in chunks, buffered, and then split on newlines manually so unusually large JSON lines do not crash the orchestrator.

### Why it failed

Codex emitted a JSON event line larger than asyncio’s default internal line limit.

---

## 10. Backend TypeScript Module System Was Inconsistent

### What failed

The generated backend could not run under `ts-node` because package/module configuration conflicted with the source code.

### Real failed error

From the pasted output:

```text
error TS1295: ECMAScript imports and exports cannot be written in a CommonJS file under 'verbatimModuleSyntax'.
```

and:

```text
error TS1287: A top-level 'export' modifier cannot be used on value declarations in a CommonJS module when 'verbatimModuleSyntax' is enabled.
```

### Failed state

[`backend/package.json`](/home/postnl/multi-agent-producer_V0/Project_0/backend/package.json) originally contained:

```json
"type": "commonjs"
```

while [`backend/tsconfig.json`](/home/postnl/multi-agent-producer_V0/Project_0/backend/tsconfig.json) originally contained:

```json
"module": "nodenext",
"verbatimModuleSyntax": true,
"exactOptionalPropertyTypes": true
```

and [`backend/src/server.ts`](/home/postnl/multi-agent-producer_V0/Project_0/backend/src/server.ts) used ESM-style imports:

```ts
import express, { NextFunction, Request, Response } from 'express';
```

### Desired state

The backend should choose one consistent execution model.

For the repaired CommonJS-compatible path, the desired state became:

in [`backend/tsconfig.json`](/home/postnl/multi-agent-producer_V0/Project_0/backend/tsconfig.json):

```json
"module": "commonjs",
"moduleResolution": "node",
"verbatimModuleSyntax": false,
"esModuleInterop": true
```

### Why it failed

The generated backend mixed CommonJS package identity with ESM-oriented TS settings and strict syntax semantics.

---

## 11. Backend Optional Property Typing Was Too Strict for Generated Code

### What failed

The backend generated objects with `undefined` values in optional fields, but `exactOptionalPropertyTypes` was enabled.

### Real failed errors

From the pasted output:

```text
error TS2375: Type '{ userId: string | undefined; displayName: string | undefined; locale: string | undefined; userAgent: string | undefined; }' is not assignable to type 'SessionStartInput' with 'exactOptionalPropertyTypes: true'.
```

and:

```text
error TS2375: Type '{ sessionId: string; puzzleId: number; blockCount: number; codeSnapshotJson: string; userId: string | undefined; clientVersion: string | undefined; }' is not assignable to type 'AttemptStartInput'
```

### Failed state

The generated code returned objects like:

```ts
return { userId, displayName, locale, userAgent };
```

where each variable could be `undefined`.

### Desired state

Either:
- omit absent optional properties entirely

or:
- disable `exactOptionalPropertyTypes` for the generated backend

### Why it failed

The generated source code did not follow the stricter TS style required by that compiler option.

---

## 12. Native SQLite Dependency Failed Because npm Scripts Were Disabled

### What failed

The backend repeatedly failed to start because `better-sqlite3` never built its native binding.

### Real failed runtime error

The pasted runtime error was:

```text
Error: Could not locate the bindings file. Tried:
 → /home/postnl/multi-agent-producer_V0/Project_0/backend/node_modules/better-sqlite3/build/better_sqlite3.node
 ...
```

Later the environment check revealed:

```text
npm config get ignore-scripts
true
```

### Failed state

The package install appeared successful, but:

```text
find node_modules/better-sqlite3 -name 'better_sqlite3.node'
```

returned nothing.

### Desired state

`npm` must allow install/build scripts for native dependencies:

```text
npm config get ignore-scripts
false
```

and the native binding file should actually exist under `node_modules/better-sqlite3/...`.

### Why it failed

`ignore-scripts=true` prevented native install scripts from running, so `better-sqlite3` was never actually built.

---

## 13. Backend Lacked CORS for Vite Frontend

### What failed

The frontend could not call the backend because browser CORS preflight failed.

### Real failed browser errors

From the pasted frontend console:

```text
Access to fetch at 'http://localhost:4000/api/session/start' from origin 'http://localhost:5173' has been blocked by CORS policy: Response to preflight request doesn't pass access control check: No 'Access-Control-Allow-Origin' header is present on the requested resource.
```

and:

```text
TypeError: Failed to fetch
    at startSession (App.tsx:91:32)
```

### Failed state

The backend in [`backend/src/server.ts`](/home/postnl/multi-agent-producer_V0/Project_0/backend/src/server.ts) originally had no CORS middleware before route handling.

### Desired state

The backend must respond with headers such as:

```text
Access-Control-Allow-Origin: http://localhost:5173
Access-Control-Allow-Methods: GET,POST,PATCH,PUT,DELETE,OPTIONS
Access-Control-Allow-Headers: Content-Type, Authorization
```

and short-circuit `OPTIONS` requests with a successful empty response.

### Why it failed

The frontend and backend were served from different dev origins (`5173` and `4000`), but the backend was not configured for cross-origin browser access.

---

## 14. Frontend Play/Step Crashed Because Outcome Could Be Undefined

### What failed

The frontend runtime crashed when it tried to inspect `outcome` as though it were always an object.

### Real failed browser error

From the pasted frontend console:

```text
executionEngine.ts:537  Uncaught TypeError: Cannot use 'in' operator to search for 'loopIterations' in undefined
```

### Failed state

In [`shared/runtime/executionEngine.ts`](/home/postnl/multi-agent-producer_V0/Project_0/shared/runtime/executionEngine.ts), the real failing code was:

```ts
if ('loopIterations' in outcome && typeof outcome.loopIterations === 'number') {
  loopIterations += outcome.loopIterations;
}
```

### Desired state

The guard must verify `outcome` exists first:

```ts
if (outcome && 'loopIterations' in outcome && typeof outcome.loopIterations === 'number') {
  loopIterations += outcome.loopIterations;
}
```

### Why it failed

`executeInstruction()` can return `void`, but the call site assumed a non-null object before using the `in` operator.

---

## 15. Frontend Vite Entry File Was in the Wrong Place

### What failed

The Vite dev server started, but `http://localhost:5173/` returned `404`.

### Real observed state

The frontend directory contained:

```text
frontend/public/index.html
```

but not a root:

```text
frontend/index.html
```

### Failed state

Vite was started successfully, but the browser got:

```text
This localhost page can’t be found
HTTP ERROR 404
```

### Desired state

Vite expects the HTML entry file at the project root:

```text
frontend/index.html
```

`public/` is for static assets, not the main entry page.

### Why it failed

The generated frontend used the wrong file layout for a Vite app.

---

## 16. Scene Board Was Hard to Understand and Visually Misplaced

### What failed

The game board was visually ambiguous and some entities were offset incorrectly.

### Real observed UI complaint

You reported:

```text
The icons are misplaced, and I don't know what is what in this game.
```

### Real failed state from the actual code

In [`frontend/src/game/GameCanvas.tsx`](/home/postnl/multi-agent-producer_V0/Project_0/frontend/src/game/GameCanvas.tsx), entities were rendered as minimal markers:

```tsx
<div className="entity mentor">M</div>
<div className="entity pet">🐾</div>
```

and targets were just unlabeled shapes:

```tsx
<div className="entity target" ... />
```

Also, positions were set using tile-center coordinates:

```ts
left: x * tileSize + tileSize / 2
top: y * tileSize + tileSize / 2
```

but the CSS in [`frontend/src/game/GameCanvas.css`](/home/postnl/multi-agent-producer_V0/Project_0/frontend/src/game/GameCanvas.css) initially had no centering transform on `.entity`.

### Desired state

The board needed:
- centered markers
- readable labels
- a legend
- clearer distinction between:
  - pet
  - mentor
  - goal
  - trail

### Why it failed

The generated UI prioritized placeholder rendering over clarity and used coordinate math inconsistent with the CSS positioning model.

---

## 17. Frontend Production Build Was Still Structurally Broken

### What failed

Even after runtime/UI fixes, the frontend production build still failed with many TypeScript and config errors.

### Real failed output

The actual build emitted many errors, including:

```text
error TS2583: Cannot find name 'Set'. Do you need to change your target library?
```

```text
error TS2688: Cannot find type definition file for 'node'.
```

```text
vite.config.ts(2,19): error TS2307: Cannot find module '@vitejs/plugin-react' or its corresponding type declarations.
```

```text
src/App.tsx(27,34): error TS2339: Property 'env' does not exist on type 'ImportMeta'.
```

```text
src/App.tsx(374,13): error TS2322: Type 'RunState' is not assignable to type '"running" | "success" | "failure" | "idle"'.
```

### Failed state

The generated frontend was enough to run parts of the app in dev, but it was not build-clean or type-clean.

### Desired state

The frontend should have:
- a valid Vite TypeScript config
- correct `lib` settings
- proper Node/Vite typings
- no app-level TypeScript type errors

### Why it failed

The generation flow produced runnable fragments, but the frontend build pipeline was never fully normalized and enforced.

---

## Unified Error Classes

Below are the unified classes that cover all of the issues above.

### Class A. Planner Output Errors
- Planner produced prose where file paths were required
- Planner generated brittle validation phrases
- Planner produced oversized roles

### Class B. Validator Design Errors
- Validation depended on planner wording
- Route validation was too literal
- Test-plan validation was too literal
- SQL validation omitted `.sql` content
- Parameterized path normalization was inconsistent

### Class C. Generated Backend Implementation Errors
- Route prefix duplication
- Missing CORS
- Module-system mismatch
- Optional-property typing mismatch
- Missing runtime/build script consistency

### Class D. Native Dependency / Environment Errors
- `better-sqlite3` native binding missing
- unsupported or awkward Node version choice
- npm `ignore-scripts=true`

### Class E. Codex Worker Runtime Errors
- Codex internal tool-call corruption
- long worker timeouts
- oversized JSON event line crashing stdout reader
- weak failure cleanup/retry behavior

### Class F. Generated Frontend Runtime Errors
- Vite root entry file missing
- Play/Step runtime crash from undefined outcome
- analytics/session fetch failures caused by backend/browser integration problems

### Class G. Generated Frontend Build-System Errors
- broken TypeScript/Vite config
- missing typing/lib/moduleResolution setup
- unresolved source-level type errors

### Class H. UI/UX Comprehension Errors
- ambiguous markers
- incorrect visual centering
- no legend / insufficient explanation of scene entities

### Class I. Process Architecture Errors
- initial orchestrator was not generic enough
- build/runtime viability was checked too late
- environment assumptions were not preflighted early enough
