This is going to be a long document.
Please read it fully to the very end and confirm when you’re done by saying "I read it all".
After you fully read the document start executing the prompt from here:

Goal: we are producing Codex-only multi-agent concurent, modular and semi-deterministic workflow using Python programming language (no OpenAI application programming interface key required), and parallelize work by spawning multiple codex exec processes concurrently.


Prerequisite: Codex command line interface authenticated via 'codex login'.
Determinism levers implemented in Python (no Codex software development kit):
- Validators beyond file existence
- Hash manifests to snapshot inputs (Secure Hash Algorithm 256)
- File system allowlists per step


Use Hub-and-spoke multi-agent model with 6 agents. Almost everything should report to the orchestrator. That is the cleanest structure.

Hub

Orchestrator
Role: Receives the external prompt, decomposes the work, assigns tasks, tracks dependencies, merges outputs, and decides when to re-plan.
Why: This is the control plane. Without it, concurrency becomes chaos.
Reporting: Everyone reports to the Orchestrator. The Orchestrator is the only “traffic controller.”

Spokes

Context Analyst
Role: Interprets the incoming prompt and extracts domain, constraints, success criteria, assumptions, and missing information. Produces structured requirements.
Why: Financial, educational, and business software each have different requirements. This agent normalizes context before execution.
Reports to: Orchestrator

Architect
Role: Defines system boundaries, module structure, interfaces, data contracts, and the task graph used by other agents.
Why: Modularity depends on clear interfaces. Prevents overlapping work and tight coupling.
Reports to: Orchestrator

Backend Producer
Role: Builds services, APIs, business logic, workflows, data access, and integration points.
Why: Most software products need a durable execution layer.
Reports to: Orchestrator (and follows Architect’s interfaces/contracts)

Frontend Producer
Role: Builds UI, user flows, forms, dashboards, and client-side state handling.
Why: Keeps presentation concerns isolated from backend work.
Reports to: Orchestrator (and follows Architect’s interfaces/contracts)

Verification Agent
Role: Validates outputs, runs tests, checks acceptance criteria, looks for regressions, and flags inconsistencies between modules.
Why: Prevents integration surprises and ensures the final result matches requirements.
Reports to: Orchestrator
 

Simple execution flow (clean pipeline)
External prompt enters the system
- Context Analyst → Structured Requirements
Domain + constraints + success criteria + assumptions + missing info
- Orchestrator → Task Plan
Breaks work into tasks, assigns owners, sets dependencies, schedules parallelism
- Architect → Interfaces & Contracts
Module boundaries, API specs, data contracts, shared conventions
- Backend Producer + Frontend Producer → Parallel Build
Implement against the Architect’s contracts
Report progress and blockers to the Orchestrator
- Verification Agent → Review & Test
Validates acceptance criteria, runs tests, checks integration consistency
Flags issues to Orchestrator
- Orchestrator → Merge, Resolve, Re-plan if needed
Integrates outputs, resolves conflicts, triggers fixes, decides “done” vs “iterate”


Messages

- Messages for coordination
- Shared artifacts for deliverables
- Orchestrator as the control hub
- Limited direct communication for tightly scoped collaboration

Each agent should follow these rules:

- Never assume another agent saw a prior conversation unless it is in shared state.
- Every important decision must be written to a decision log.
- Every artifact must have a version.
- Every task must have an owner.
- Every blocker must go to the orchestrator.
- Agents should not overwrite shared artifacts without ownership or lock rules.


The structure of the multi-agent 

Global runtime/config layer
- Defines the Codex model, sandbox mode, approval policy, workspace root, and timeout.
- Defines all canonical output locations up front, including requirements/test docs, generated frontend/
backend files, docs, runbook

Determinism and filesystem-control layer
- Computes SHA-256 hashes of files and snapshots the workspace before and after each step.
- Diffs snapshots to detect created, modified, or deleted files.
- Enforces a per-step allowlist policy through StepPolicy and enforce_policy().
- This is the core safety mechanism: each agent step is only allowed to create/modify specific files, cannot
delete files, and can mark some inputs as frozen.

Codex execution engine
- run_codex() launches codex exec --experimental-json, streams JSON events, captures the final agent
message, tracks usage, and enforces a timeout.
- This is the application’s main integration point with Codex. Every role step uses this function.




  4. Structured planning system
      - plan_schema() defines a JSON schema for the project plan.
      - The plan must include six required roles: Project Manager, Designer, Frontend Developer, Backend
        Developer, Tester, and Data Scanner.
      - normalize_role_name() canonicalizes role names, and validate_plan_obj() ensures all required roles exist
        and that output paths are relative.
      - This makes the planning phase schema-driven rather than free-form.
      - Relevant section: multi_agent_workflow_deterministic_ver3_finance.py:270
  5. Role prompt templates
      - The file contains explicit prompt builders for each role:
          - planner_prompt()
          - pm_prompt()
          - designer_prompt()
          - data_scanner_prompt()
          - frontend_prompt()
          - backend_prompt()
          - tester_prompt()
          - tester_fix_prompt()
          - docs_prompt()
          - runbook_prompt()
      - These prompts are highly prescriptive. Each role is told exactly what files it may write, what inputs are
        read-only, and what content must exist.
      - The finance specialization is concentrated here:
          - PM must describe a financial analysis app.
          - Data Scanner must scan 13F XML files and build plan/issuers_index.json.
          - Frontend must render a single-page issuer dashboard.
          - Backend must expose finance-related endpoints listed in TEST.md.
      - Relevant section start: multi_agent_workflow_deterministic_ver3_finance.py:366
  6. Finance-specific data scanning contract
      - The Data Scanner role is a major top-level addition in this version.
      - Its prompt requires recursive discovery of every infotable.xml, extraction of all <nameOfIssuer> values,
        deduplication per file, sort order rules, error recording for malformed XML, and output to exactly one
        file: plan/issuers_index.json.
      - The required JSON contains:
          - data_root
          - generated_at_utc
          - items[] with cik, period, infotable_relpath, issuers, issuer_count
          - errors[]
      - This is the core bridge from local SEC data into the generated app.
      - Relevant section: multi_agent_workflow_deterministic_ver3_finance.py:500
  7. Contract extraction and validation layer
      - extract_endpoints_from_test_md() parses endpoint definitions directly from TEST.md using patterns like
        GET /path and POST /path.
      - Validators then use that extracted contract to verify backend routes and test-plan coverage.
      - This is strategically important because the backend/test steps are driven by a document contract rather
        than hard-coded route lists.
      - Relevant section: multi_agent_workflow_deterministic_ver3_finance.py:828
  8. Output validators
      - There is a dedicated validator for each role’s deliverables:
          - PM outputs
          - design spec
          - frontend HTML
          - backend server/package
          - tests
          - README
          - RUNBOOK
          - issuer index JSON
      - These validators go beyond existence checks. Examples:
          - frontend must contain a <script> tag and evidence of issuer/period UI.
          - backend must include /health and every route listed in TEST.md.
          - tests must mention every endpoint from TEST.md.
          - plan/issuers_index.json must have the expected object shape.
      - This is the application’s main quality gate.
      - Relevant section start: multi_agent_workflow_deterministic_ver3_finance.py:852
  9. Manifesting and provenance
      - write_manifest() snapshots the workspace and writes .pipeline_manifest.json with hashes of all files.
      - The manifest is rewritten after each major stage.
      - Strategically, this gives the pipeline a provenance record and a way to lock role prompts to a known input
        state.
      - Relevant section: multi_agent_workflow_deterministic_ver3_finance.py:998
  10. Pipeline step orchestration

  - The workflow is broken into explicit async steps:
      - step_plan()
      - step_pm()
      - step_designer()
      - step_data_scanner()
      - step_frontend_backend_parallel()
      - snapshot again
      - enforce file policy
      - validate outputs
  - Notable orchestration choices:
      - frontend and backend are run in parallel
      - tester has a built-in repair loop using tester_fix_prompt() if validation fails
      - docs and runbook are generated last
  - Relevant section start: multi_agent_workflow_deterministic_ver3_finance.py:1020

  11. Embedded project brief

  - The file contains a built-in task_list string describing the exact application to generate:
      - a single-page financial dashboard
      - local SEC 13F issuer exploration
      - filtering/search/detail interactions
      - Node backend with /health and finance endpoints
      - Data Scanner role producing plan/issuers_index.json
  - This means the pipeline is not generic at runtime; it is preconfigured for this finance use case.
  - Relevant section: multi_agent_workflow_deterministic_ver3_finance.py:1321

  12. Intended entrypoint

  - The file intends to run everything through asyncio.run(main()).
  - However, the current top-level structure around main() is malformed: task_list is defined at module scope, but
    the subsequent await calls remain indented as if still inside main(). That makes the script structurally
    invalid as written rather than simply being a normal runnable orchestrator.
  - Relevant section: multi_agent_workflow_deterministic_ver3_finance.py:1318