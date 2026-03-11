This is going to be a long document.
Please read it fully to the very end and confirm when you’re done by saying "I read it all".
After you fully read the document start executing the prompt from here:

Goal: we are producing Codex-only multi-agent concurent, modular and semi-deterministic workflow using Python programming language (no OpenAI application programming interface key required).
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