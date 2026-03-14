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


### Solution for future `orchestrator.py`

Enforce a strict planner schema where every `required_outputs` entry must match a relative-path regex, reject prose-like values before any worker runs, and surface a targeted repair message that tells the planner exactly which field violated the path contract.

### Solution for future Prompt which would create `orchestrator.py`

Define the planner contract in the generator prompt as path-only, include positive and negative examples, and instruct the model that deliverable descriptions belong in narrative fields while `required_outputs` must contain only concrete relative file paths.
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


### Solution for future `orchestrator.py`

Treat planner-authored keywords as hints for diagnostics, not as fatal validation gates, unless a keyword is explicitly marked as an exact required literal; validators should prioritize structural checks against files, routes, schemas, and commands.

### Solution for future Prompt which would create `orchestrator.py`

Tell the generator prompt to design validators around durable evidence such as file existence, route normalization, AST/text patterns, and executable checks, and to forbid using free-form planner wording as a mandatory proof mechanism.
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


### Solution for future `orchestrator.py`

Canonicalize contract and implementation routes before comparison by stripping markdown wrappers, normalizing query strings, converting parameter syntax to one internal form, and composing mounted router prefixes with local route declarations.

### Solution for future Prompt which would create `orchestrator.py`

Require the generated orchestrator design to define one shared route-normalization function used by both planner validation and QA validation so equivalent route spellings are compared semantically instead of literally.
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


### Solution for future `orchestrator.py`

Add a route-composition check that reconstructs final mounted endpoints from server mounts plus router-local paths and fails when a router repeats an already-mounted prefix.

### Solution for future Prompt which would create `orchestrator.py`

Instruct the generator prompt to include backend validation that understands Express mount semantics and explicitly checks for duplicated prefixes such as `/api/analytics/analytics/...`.
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


### Solution for future `orchestrator.py`

Include `.sql` files in the validator’s readable artifact set whenever backend ownership or required outputs include database paths, and run SQL-specific evidence checks against those file contents.

### Solution for future Prompt which would create `orchestrator.py`

Tell the generator prompt that validation sources must cover all expected implementation file types, explicitly naming `.sql` as a first-class backend artifact instead of assuming only code files matter.
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


### Solution for future `orchestrator.py`

Validate semantic section intent using an allowlist of equivalent headings or section classifiers, so manual-test coverage passes when the plan clearly contains the right content under a synonymous title.

### Solution for future Prompt which would create `orchestrator.py`

Direct the prompt to generate tolerant QA validators that accept equivalent human-facing headings and look for manual-testing content patterns rather than one exact heading string.
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


### Solution for future `orchestrator.py`

Normalize endpoint examples inside test plans with the same canonicalization used for backend contracts, so `:id`, `{param}`, and representative literals map to the same route family during coverage checks.

### Solution for future Prompt which would create `orchestrator.py`

Require the prompt to keep one canonical endpoint-normalization routine shared across contract validation, backend validation, and QA-plan validation to avoid drift between subsystems.
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


### Solution for future `orchestrator.py`

Detect repeated worker-runtime corruption signatures, classify them as transient execution failures, terminate the affected worker early, clean its staging area, and retry in a fresh workspace with bounded retry counts.

### Solution for future Prompt which would create `orchestrator.py`

Tell the generator prompt to treat recognizable Codex runtime corruption messages as retryable infrastructure failures, not as ordinary task failures, and to encode early-abort heuristics instead of waiting for the full timeout.
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


### Solution for future `orchestrator.py`

Read worker stdout/stderr in chunks, accumulate buffers manually, split on newlines safely, and preserve partial lines so oversized JSON events cannot crash the orchestrator’s log reader.

### Solution for future Prompt which would create `orchestrator.py`

Specify in the prompt that the subprocess I/O layer must be chunk-based and resilient to arbitrarily long JSON lines, with no dependence on asyncio’s default line-length limits.
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


### Solution for future `orchestrator.py`

Add a backend config consistency validator that cross-checks `package.json`, `tsconfig.json`, and source import style, then fails fast when CommonJS/ESM settings do not define one coherent execution model.

### Solution for future Prompt which would create `orchestrator.py`

Instruct the prompt to generate explicit config-consistency checks for package type, TypeScript module options, runtime command, and source syntax, with one recommended backend module strategy chosen up front.
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


### Solution for future `orchestrator.py`

Validate generated TypeScript against enabled compiler strictness flags and either require helper patterns that omit undefined optional properties or automatically reject incompatible strict flags during project synthesis.

### Solution for future Prompt which would create `orchestrator.py`

Tell the generator prompt to align emitted TypeScript patterns with compiler strictness options, especially `exactOptionalPropertyTypes`, and to avoid enabling flags unless the generated code style is designed for them.
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


### Solution for future `orchestrator.py`

Run an environment preflight before dependency-sensitive work that checks npm script policy, native build prerequisites, and the actual presence of compiled bindings after install, failing early with a targeted remediation message.

### Solution for future Prompt which would create `orchestrator.py`

Require the prompt to generate environment-preflight logic for native dependencies, including checks for `ignore-scripts`, postinstall build expectations, and verification that critical native artifacts exist on disk.
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


### Solution for future `orchestrator.py`

Detect cross-origin dev setups from planned frontend/backend ports and require backend middleware that handles CORS headers and `OPTIONS` requests whenever browser clients call a separate origin.

### Solution for future Prompt which would create `orchestrator.py`

Instruct the prompt to infer integration requirements from the stack definition, specifically generating CORS validation whenever a Vite frontend and separate backend origin are part of the plan.
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


### Solution for future `orchestrator.py`

Add runtime-safety validation rules for generated frontend logic that look for unsafe object inspection patterns after functions documented to return `void | object`, and require defensive null checks before property probes.

### Solution for future Prompt which would create `orchestrator.py`

Tell the prompt to generate frontend validation focused on common nullability hazards and to prefer guard patterns before `in` checks, destructuring, or nested property access in uncertain return paths.
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


### Solution for future `orchestrator.py`

Validate framework-specific required file layouts before declaring frontend success, including the presence of Vite’s root `index.html` and rejection of layouts that place the entry page only under `public/`.

### Solution for future Prompt which would create `orchestrator.py`

Require the prompt to encode stack-aware filesystem validation rules, with explicit Vite project conventions rather than generic frontend file expectations.
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


### Solution for future `orchestrator.py`

Expand validation beyond code existence to include minimum UX clarity heuristics for gameplay surfaces, such as centered positioning, visible labels or legend support, and distinct rendering for key entities.

### Solution for future Prompt which would create `orchestrator.py`

Tell the prompt that orchestrator validation should include lightweight UX acceptance criteria for generated interfaces when the task is user-facing, not just build/run checks.
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


### Solution for future `orchestrator.py`

Make production build and type-check execution mandatory acceptance gates for generated frontend roles, and fail the orchestration if the project is only dev-runnable but not build-clean.

### Solution for future Prompt which would create `orchestrator.py`

Instruct the prompt to generate end-to-end viability gates that run the real frontend build/type-check commands before declaring completion, with stack-specific config validation for Vite and TypeScript.
---

## Unified Error Classes

Below are the unified classes that cover all of the issues above.

### Class A. Planner Output Errors
- Planner produced prose where file paths were required
- Planner generated brittle validation phrases
- Planner produced oversized roles

#### Solution for future `orchestrator.py`

Separate planner semantics from validator semantics: planner outputs should be schema-constrained, size-limited, and machine-checkable before any downstream orchestration step accepts them.

#### Solution for future Prompt which would create `orchestrator.py`

Tell the prompt to generate a planner contract that is narrow, typed, and validated immediately, with no prose allowed in machine-consumed path or ownership fields.

### Class B. Validator Design Errors
- Validation depended on planner wording
- Route validation was too literal
- Test-plan validation was too literal
- SQL validation omitted `.sql` content
- Parameterized path normalization was inconsistent

#### Solution for future `orchestrator.py`

Centralize normalization, make validators semantic instead of wording-driven, and ensure every validator checks the artifact type it claims to verify.

#### Solution for future Prompt which would create `orchestrator.py`

Require the prompt to design validators around canonical forms, shared helper functions, and artifact-aware evidence collection rather than raw string matching.

### Class C. Generated Backend Implementation Errors
- Route prefix duplication
- Missing CORS
- Module-system mismatch
- Optional-property typing mismatch
- Missing runtime/build script consistency

#### Solution for future `orchestrator.py`

Add backend-specific acceptance checks for routing, config coherence, middleware, SQL, and runtime startability so structural backend defects fail before handoff.

#### Solution for future Prompt which would create `orchestrator.py`

Direct the prompt to generate backend orchestration with explicit Express/TypeScript/SQL health checks, not just generic file-generation success criteria.

### Class D. Native Dependency / Environment Errors
- `better-sqlite3` native binding missing
- unsupported or awkward Node version choice
- npm `ignore-scripts=true`

#### Solution for future `orchestrator.py`

Move environment and dependency viability checks to the beginning of the run so native module and package-manager constraints are known before generation proceeds.

#### Solution for future Prompt which would create `orchestrator.py`

Tell the prompt to create a preflight stage that verifies Node, npm behavior, native-build prerequisites, and install-script policy before worker execution begins.

### Class E. Codex Worker Runtime Errors
- Codex internal tool-call corruption
- long worker timeouts
- oversized JSON event line crashing stdout reader
- weak failure cleanup/retry behavior

#### Solution for future `orchestrator.py`

Treat worker execution as unreliable infrastructure: monitor corruption signals, harden I/O collection, bound retries, and ensure failed workers are cleaned up and restarted predictably.

#### Solution for future Prompt which would create `orchestrator.py`

Require the prompt to generate orchestration with explicit transient-failure taxonomy, robust subprocess streaming, and deterministic retry/cleanup behavior.

### Class F. Generated Frontend Runtime Errors
- Vite root entry file missing
- Play/Step runtime crash from undefined outcome
- analytics/session fetch failures caused by backend/browser integration problems

#### Solution for future `orchestrator.py`

Add frontend runtime contract checks that cover entry files, browser-backend integration, and defensive-state handling before the project is considered valid.

#### Solution for future Prompt which would create `orchestrator.py`

Tell the prompt to encode frontend runtime acceptance tests, not just static generation requirements, for the chosen framework and integration pattern.

### Class G. Generated Frontend Build-System Errors
- broken TypeScript/Vite config
- missing typing/lib/moduleResolution setup
- unresolved source-level type errors

#### Solution for future `orchestrator.py`

Make frontend build-system correctness a first-class validator concern by checking config, typings, module resolution, and clean production builds.

#### Solution for future Prompt which would create `orchestrator.py`

Direct the prompt to produce orchestrator logic that treats type-check and production build success as mandatory completion criteria for frontend work.

### Class H. UI/UX Comprehension Errors
- ambiguous markers
- incorrect visual centering
- no legend / insufficient explanation of scene entities

#### Solution for future `orchestrator.py`

Include simple human-centered UX heuristics in validation for interactive apps so visually confusing but technically runnable interfaces are still rejected.

#### Solution for future Prompt which would create `orchestrator.py`

Tell the prompt that for user-facing apps, the orchestrator must validate minimum clarity criteria such as labeling, alignment, and distinguishable entity representation.

### Class I. Process Architecture Errors
- initial orchestrator was not generic enough
- build/runtime viability was checked too late
- environment assumptions were not preflighted early enough

#### Solution for future `orchestrator.py`

Restructure the orchestrator into phased gates: preflight, planning, generation, artifact validation, runtime verification, and final acceptance, with failures surfaced at the earliest responsible stage.

#### Solution for future Prompt which would create `orchestrator.py`

Instruct the prompt to generate the orchestrator as a generic phase-based system with early preflight and build/runtime gates, rather than a late-detection patchwork.

---

## Broader and More Explicit Future Guidance

This appended section expands the earlier solutions into broader design guidance for both the future `orchestrator.py` and the future prompt that should generate `orchestrator.py`.

It is intentionally more explicit and uses concrete examples so the next implementation does not repeat the same structural failures.

### Broad solution for future `orchestrator.py`

The future `orchestrator.py` should be built as a strict multi-stage system with machine-checkable contracts between every stage.

It should have the following stages in this order:
- environment preflight
- planner generation
- planner repair loop
- worker generation
- artifact validation
- build validation
- runtime validation
- final acceptance summary

Each stage should fail early and should emit one of the following classes of errors:
- planner contract error
- worker execution error
- validator design error
- generated code error
- environment dependency error
- build or runtime viability error

The future `orchestrator.py` should explicitly enforce the following rules:

1. Planner outputs must be schema-safe.
- Every owned path must be a relative file path.
- Every required output must be a relative file path.
- Every validation rule must declare whether it is exact literal matching, normalized structural matching, or executable verification.
- No prose deliverable may appear in a path field.

2. Validation must be semantic, not wording-based.
- Route checks must normalize mounted router prefixes.
- Route checks must normalize path parameters into one internal representation.
- Markdown backticks, query strings, and route examples with sample values must all normalize to the same internal route family.
- Manual testing sections must be accepted by meaning, not by one exact heading string.

3. Every owned artifact type must be readable by validators.
- TypeScript files must be read.
- JavaScript files must be read.
- Structured query language files must be read.
- Markdown files must be read.
- HyperText Markup Language files must be read.
- Cascading Style Sheets files must be read.
- Configuration files must be read.

4. Framework-aware validation must be mandatory.
- A Vite project must contain `index.html` at the project root.
- An Express backend that serves a browser frontend on another origin must have cross-origin resource sharing handling.
- A TypeScript backend must have one coherent module system across `package.json`, `tsconfig.json`, runtime scripts, and import syntax.

5. Build and runtime checks must happen before success is reported.
- The frontend must pass a production build.
- The frontend must pass type checking.
- The backend must start successfully.
- The backend must answer health and contract endpoints.
- Native dependency bindings must be confirmed to exist after installation.

6. Worker execution must be resilient.
- Standard output and standard error must be read in chunks, not with unsafe line-size assumptions.
- Repeated internal tool corruption messages must trigger early worker termination and retry.
- Retries must be bounded and classified by error type.
- Every retry must run in a fresh staged workspace.

7. Human-facing quality should have minimum acceptance rules.
- Interactive boards must have readable entity distinction.
- Important objects must be visually centered if the coordinate system assumes centering.
- User-facing scenes must contain basic labeling or legend support.

### Recommended structure for future `orchestrator.py`

The future file should contain functions with responsibilities that are narrow and testable, for example:

```python
def run_environment_preflight() -> PreflightReport:
    ...

def generate_plan_with_repair_loop(request_text: str) -> Plan:
    ...

def validate_plan_schema(plan: Plan) -> list[ValidationIssue]:
    ...

def normalize_route_signature(method: str, path: str) -> str:
    ...

def collect_validation_artifacts(role: RolePlan) -> ArtifactBundle:
    ...

def validate_backend_contract(bundle: ArtifactBundle, contract_paths: list[str]) -> list[ValidationIssue]:
    ...

def validate_frontend_structure(bundle: ArtifactBundle) -> list[ValidationIssue]:
    ...

def run_frontend_build(project_root: Path) -> CommandResult:
    ...

def run_backend_smoke_tests(project_root: Path) -> CommandResult:
    ...

def classify_worker_failure(log_text: str) -> WorkerFailureClass:
    ...
```

The future `orchestrator.py` should also create a final machine-readable report, for example:

```json
{
  "status": "failed",
  "stage": "artifact_validation",
  "error_class": "validator_design_error",
  "role": "Backend Telemetry and Analytics",
  "details": [
    "Normalized route GET /api/analytics/puzzles/{param} was not found in implementation"
  ],
  "repairable": true
}
```

### Broad solution for the future prompt which would create `orchestrator.py`

The future prompt must be stricter than a general coding request. It must tell the model exactly what the orchestrator is responsible for, what it must reject, and what it must verify before reporting success.

The future prompt should explicitly require all of the following:
- use a phase-based orchestrator design
- include machine-checkable planner schemas
- include a planner repair loop
- include route normalization helpers
- include artifact collection for every relevant file type
- include frontend and backend build verification
- include runtime smoke checks
- include environment preflight checks
- include retry logic for worker-runtime corruption
- include clear, structured error reporting
- do not use planner prose as exact validation evidence
- do not treat file existence alone as completion

The future prompt should also tell the model what to avoid:
- do not validate by raw string matching when semantic normalization is possible
- do not assume a frontend is valid just because the development server starts
- do not assume a backend is valid just because files were generated
- do not ignore native dependency installation risks
- do not postpone environment checks until the end

### Example prompt for generating a future `orchestrator.py`

Below is an example of a stronger prompt that should produce a better orchestrator:

```text
Write a production-oriented Python file named orchestrator.py for a multi-worker software generation pipeline.

The file must implement these phases in order:
1. Environment preflight
2. Planner generation
3. Planner schema validation
4. Planner repair loop if validation fails
5. Worker execution
6. Artifact validation
7. Frontend and backend build verification
8. Runtime smoke verification
9. Final structured report

Hard requirements:
- Every planner field that represents a file must be a concrete relative path.
- The planner must not be allowed to place human prose in file path fields.
- Validation must distinguish between exact literal checks, normalized structural checks, and executable checks.
- Route validation must normalize markdown formatting, query strings, mounted router prefixes, and parameter syntax.
- Validation artifact collection must include TypeScript, JavaScript, Structured Query Language, Markdown, HyperText Markup Language, Cascading Style Sheets, and configuration files where relevant.
- The frontend cannot be marked successful unless the production build succeeds.
- The backend cannot be marked successful unless the service starts and contract smoke checks pass.
- The orchestrator must detect repeated internal worker-runtime corruption messages and retry in a fresh workspace.
- Subprocess output must be read in chunks so very large output lines do not crash the orchestrator.
- The final result must be emitted as structured JavaScript Object Notation.

Design constraints:
- Use clear dataclasses or typed structures for planner outputs, validation issues, worker results, and final reports.
- Keep functions small and separated by responsibility.
- Make validation error messages explicit and repair-oriented.
- Do not rely on planner-authored keywords as mandatory literal proof unless the planner explicitly marks them as exact required literals.
- Add comments only where logic is not obvious.

Return only the full orchestrator.py source code.
```

### Example prompt section for planner-schema rules

This sub-prompt can be embedded inside the larger generator prompt:

```text
Planner schema rules:
- owned_paths must be a list of relative file paths only
- required_outputs must be a list of relative file paths only
- validation_rules must be a list of objects with:
  - name
  - mode, one of exact_literal, normalized_structure, executable_check
  - target_paths
  - expected_evidence
- Reject any plan where a supposed path contains sentence-like prose, commas used like narrative text, or no file extension when an output file is expected
- When rejecting a plan, produce a repair message that points to the exact offending field and a concrete example of the correct format
```

### Example prompt section for route normalization rules

This sub-prompt can also be embedded inside the larger generator prompt:

```text
Route validation rules:
- Normalize GET /api/items/:id, GET /api/items/{param}, and GET /api/items/123 to the same route family
- Strip markdown backticks
- Ignore query-string example values when comparing route families
- Compose mounted prefixes with router-local paths before matching implementation to contract
- Fail with a real defect only when normalized routes are still missing after composition
```

### Example prompt section for environment preflight rules

```text
Environment preflight rules:
- Check the installed Node.js version
- Check whether package-manager install scripts are disabled
- Check whether required native dependency bindings exist after installation
- Check whether required command-line tools are available
- Stop before worker execution if any critical environment requirement is missing
- Return a remediation message that explains exactly what is missing
```

### Example prompt section for user-facing quality checks

```text
User-facing quality rules:
- If the generated application has an interactive board or scene, require visually distinct entities
- If the coordinate system implies centered placement, verify that style rules actually center the elements
- Require either labels, a legend, or another explicit explanation for scene entities
- Treat severe visual ambiguity as a validation failure, not as a cosmetic note
```

### Final recommendation

The next prompt that generates `orchestrator.py` should be written more like a technical specification than a casual request.

It should define:
- stages
- schemas
- validation modes
- failure classes
- retry behavior
- framework-aware checks
- environment preflight rules
- required final report format

If the prompt is vague, the generated orchestrator will again default to brittle heuristics.

If the prompt is explicit, typed, and phase-based, the generated orchestrator has a much better chance of being reliable.
