# Errors Structure

## Purpose

This document summarizes the major errors, failure modes, and structural weaknesses encountered during the production process in this chat, from the first inspection of the orchestrator through backend/frontend bring-up and UI review.

It is intentionally high-level and grouped by failure class rather than by strict timestamp.

---

## 1. Original Orchestrator Design Problems

### 1.1 Hard-coded finance pipeline instead of a reusable app orchestrator
- The original workflow file was finance-specific and embedded a fixed task brief.
- It was not ready to ingest an external `project_specification.md`.
- It mixed deterministic controls with domain-specific assumptions.

### 1.2 Invalid `main()` structure in the original script
- The original finance workflow had a malformed `main()` region.
- `task_list` and the awaited pipeline calls were not correctly scoped under the async function.
- Result: the file was structurally invalid as a runnable orchestrator.

### 1.3 Weak subprocess orchestration model
- The initial `run_codex()` approach was a prototype, not production-grade.
- Weaknesses included:
  - experimental JSON schema assumptions
  - only capturing the last agent message
  - not draining stdout/stderr robustly
  - timeout applied too late
  - weak runtime classification
  - no staged isolation
  - low observability

---

## 2. Planner and Plan Validation Failures

### 2.1 Planner produced prose where file paths were required
- Example failure:
  - `required_outputs` contained a sentence such as:
    `Responsive UI with block workspace, 17 puzzle scenes, mentor dialog, controls, and animations`
- Root cause:
  - plan schema only required strings, not path-like strings
  - planner prompt did not sufficiently distinguish deliverables from file paths

### 2.2 Planner-generated `validation_keywords` were too brittle
- Roles were given validation phrases like:
  - `on-start root block`
  - `analytics aggregates`
- The orchestrator originally treated these planner-authored phrases as hard validation gates.
- This caused correct implementations to fail due to wording mismatch rather than real defects.

### 2.3 Oversized single implementation roles
- Planner often produced very broad frontend/backend roles.
- These workers ran too long and became fragile.
- Long Codex sessions increased the chance of runtime instability and timeouts.

---

## 3. Orchestrator Validation Logic Problems

### 3.1 Output validation coupled to planner prose
- Fatal validation depended on planner-generated keyword phrases.
- This created false negatives unrelated to actual artifact quality.

### 3.2 Backend route validation too literal at first
- The validator compared raw contract text against backend source content.
- It did not account for:
  - markdown formatting
  - query strings
  - path parameters
  - mounted router composition

### 3.3 Test-plan validation too literal
- `tests/TEST_PLAN.md` validation originally required exact phrasing such as:
  - `Manual checks`
- Equivalent headings like:
  - `Manual Exploratory Checklist`
  were rejected incorrectly.

### 3.4 SQL validation ignored `.sql` files
- The backend validator checked for schema content like `CREATE TABLE`.
- But `.sql` files were not included in the collected validation text.
- Result: valid SQL schema outputs failed validation.

### 3.5 Route parsing bug caused false backend failures
- Backend route parsing was performed against lowercased source text.
- Mount-prefix extraction expected `create...Router` shape and broke after case loss.
- This caused false route-missing reports even when routes existed.

### 3.6 Concrete example paths were treated as unique required routes
- Contract/test content sometimes referenced examples like:
  - `/api/analytics/puzzles/1`
- These were treated as separate routes instead of normalized parameterized routes.

---

## 4. Codex Runtime / Worker Execution Problems

### 4.1 Internal Codex tool-call corruption
- Workers emitted repeated runtime errors like:
  - `Custom tool call output is missing`
- Root cause was likely Codex runtime/session instability, not project code.
- Effect:
  - workers stalled
  - long waits
  - eventual timeout

### 4.2 Worker timeout handling was originally too passive
- Broken Codex workers were allowed to run until full timeout.
- This wasted substantial time and obscured the true failure mode.

### 4.3 Large JSON event lines broke asyncio line reading
- Codex emitted a JSON line larger than the default asyncio line buffer.
- This raised:
  - `LimitOverrunError`
- Root cause:
  - line-based stdout parsing
- Result:
  - orchestrator crash during worker execution

### 4.4 Weak cleanup after timeout/failure
- Subprocess cleanup produced noisy event-loop shutdown traces.
- The orchestrator needed more defensive cancellation and retry behavior.

---

## 5. Directory / Workspace Confusion

### 5.1 Workspace depended on current working directory
- The orchestrator used `Path.cwd()` as the effective workspace.
- This meant running from the wrong directory generated files in the wrong place.

### 5.2 Confusion between `Helping_files` and `Project_0`
- Early work and orchestration logic existed under `Helping_files`.
- Generated project artifacts later appeared in `Project_0`.
- This created temporary ambiguity over which orchestrator copy and outputs were active.

---

## 6. Backend Generation and Runtime Problems

### 6.1 Missing CORS support
- Frontend requests to `http://localhost:4000` failed with browser CORS errors.
- Symptoms:
  - `No 'Access-Control-Allow-Origin' header`
  - failed session start
  - failed analytics fetches

### 6.2 Route contract mismatches
- Generated backend routes sometimes did not match the documented contract.
- One concrete class of issue:
  - using `app.use('/api/analytics', router)` together with `router.get('/analytics/...')`
  - causing doubled final paths like `/api/analytics/analytics/...`

### 6.3 TypeScript module-system mismatch
- Backend was generated with:
  - CommonJS package setting
  - ESM-style TypeScript imports
  - `verbatimModuleSyntax`
- Result:
  - `ts-node` compile failures

### 6.4 Strict optional-property typing mismatch
- Backend code returned `undefined` into optional fields under `exactOptionalPropertyTypes`.
- Result:
  - compile-time type errors in `server.ts`

### 6.5 Missing runtime scripts and inconsistent package setup
- Backend package metadata/scripts were incomplete for actual development usage.
- Needed explicit `dev`, `build`, and `start` paths.

### 6.6 Missing local typings for `better-sqlite3`
- TypeScript compile failed because no declaration file existed for `better-sqlite3`.

### 6.7 Native module runtime failure for `better-sqlite3`
- Even after TS fixes, runtime failed because native binding file was missing.
- Error class:
  - `Could not locate the bindings file`

### 6.8 Environment-level npm misconfiguration
- Root cause of native addon failure was:
  - `npm config get ignore-scripts` returning `true`
- Because install scripts were disabled, `better-sqlite3` never built its native binding.

### 6.9 Node version mismatch amplified native addon issues
- Initial backend runtime attempts were on Node 24.
- `better-sqlite3` was not viable in that setup.
- Switching to Node 20 removed one layer of incompatibility, but npm script suppression still blocked the final fix.

---

## 7. Frontend Generation and Runtime Problems

### 7.1 Wrong Vite entrypoint location
- Frontend initially placed `index.html` under `public/`.
- Vite expects project-root `index.html`.
- Result:
  - Vite dev server started
  - browser root URL returned `404`

### 7.2 Frontend TypeScript/build configuration remained broken
- Even after UI/runtime fixes, `npm run build` exposed broader TS config problems:
  - missing lib settings
  - missing node typings in Vite context
  - unresolved config typing issues
  - type errors in multiple app files
- This means the generated frontend is not fully production-ready yet.

### 7.3 Runtime crash on Play/Step
- Frontend runtime crashed in `executeProgram()` because code assumed:
  - `'loopIterations' in outcome`
  while `outcome` could be `undefined`
- Result:
  - pressing Play/Step could break the app even independent of backend success

### 7.4 Analytics/event fetches affected by browser client blocking
- One request class showed:
  - `ERR_BLOCKED_BY_CLIENT`
- This was likely caused by browser extensions/ad blockers, not application logic.

---

## 8. UI / UX Communication Problems

### 8.1 Scene markers were visually ambiguous
- The board used placeholder markers:
  - mentor as `M`
  - target as dashed square
  - pet as orange circle with paw
  - trail as blue dot
- Users could not infer what was what from the board alone.

### 8.2 Entity positioning math and CSS were inconsistent
- Entities were positioned using tile-center coordinates.
- But CSS did not initially apply a centering transform.
- Result:
  - markers were visually offset
  - edge entities looked clipped or misplaced

### 8.3 Missing in-scene explanation
- There was no board legend or immediate explanation of:
  - player marker
  - mentor
  - target
  - trail
- Users had poor situational understanding.

---

## 9. QA / Test-Plan Generation Problems

### 9.1 QA generated valid but differently titled sections
- The QA file often had the right content but not the exact heading name expected by the validator.

### 9.2 Endpoint coverage normalization mismatch
- Test plan could cover equivalent route families, but validation compared them too literally before normalization improvements.

### 9.3 Generated QA contract did not always align with generated backend
- In some iterations, the QA plan and backend implementation diverged in route names and semantics.

---

## 10. Environment and Tooling Issues

### 10.1 npm warning noise
- Repeated warning:
  - unknown user config `always-auth`
- This was not the root cause of failures, but it added noise and could distract diagnosis.

### 10.2 Browser extension interference
- `ERR_BLOCKED_BY_CLIENT` likely came from a local browser extension.
- Not an application bug, but relevant to debugging.

### 10.3 Missing native build outputs despite “successful” install/rebuild
- npm reported success even when the native binding file was still absent.
- This made the underlying issue harder to detect.

---

## 11. Root-Cause Themes Across the Process

### 11.1 Generated artifacts were validated structurally before being validated operationally
- The process initially emphasized:
  - file presence
  - contract shape
  - heuristic content checks
- But runtime viability and buildability were not guaranteed early enough.

### 11.2 Planner freedom created downstream instability
- The planner produced:
  - brittle keyword phrases
  - overly large worker scopes
  - variable route/file conventions
- Downstream logic had to be hardened repeatedly to compensate.

### 11.3 Environment assumptions were under-specified
- Success depended on:
  - correct cwd
  - supported Node version
  - npm install scripts enabled
  - native build capability
  - browser without blocking extensions
- These assumptions were not enforced early in the process.

### 11.4 UI polish and clarity lagged behind artifact generation
- The frontend could produce files and partial mechanics, yet still fail basic player comprehension and interaction quality.

---

## 12. Current State Summary

### What improved
- Orchestrator became generic and spec-driven.
- Verbose mode was added.
- Worker retries and staged isolation were added.
- Planner path validation was hardened.
- Route normalization and contract parsing improved.
- CORS support was added.
- Scene readability was improved.
- Backend TypeScript configuration was repaired enough to build.

### What still remains structurally risky
- Frontend TypeScript/build configuration is still not fully repaired.
- Full end-to-end app readiness is not yet proven.
- Native dependency setup depends on local npm/script environment correctness.
- Some generated contracts and generated implementation details can still drift.

---

## 13. Practical Takeaway

This production process did not fail because of one single bug. It failed repeatedly across four layers:

1. **Orchestration layer**
   - plan quality
   - worker stability
   - validation brittleness

2. **Generated code layer**
   - backend route/config correctness
   - frontend runtime robustness
   - UI clarity

3. **Build/runtime layer**
   - TypeScript config
   - native dependency handling

4. **Environment layer**
   - Node version
   - npm script policy
   - browser extension interference

The dominant pattern was: the system could generate many artifacts successfully, but operational correctness, environment compatibility, and user-facing clarity required repeated manual hardening afterward.
