I’m going to paste a long document.
Please read it fully and confirm when you’re done by saying "I read it all".
After you fully read the document start executing the prompt from here:

Goal: we are producing Codex-only multi-agent concurent, modular and semi-deterministic workflow (no OpenAI application programming interface key required).
Prerequisite: Codex command line interface authenticated via 'codex login'.
Determinism levers implemented in Python (no Codex software development kit):
- Validators beyond file existence
- Hash manifests to snapshot inputs (Secure Hash Algorithm 256)
- File system allowlists per step

Recommended setup: 6 agents

- Orchestrator
Role: Receives the context prompt, decomposes the work, assigns tasks, tracks dependencies, merges outputs, and decides when to re-plan.
Why: This is the control plane. Without it, concurrency becomes chaos.
- Context Analyst
Role: Interprets the incoming prompt, extracts domain, constraints, success criteria, assumptions, and missing information.
Why: Financial, educational, and business software each have different requirements. This agent normalizes that context before execution.
- Architect
 Role: Defines system boundaries, module structure, interfaces, data contracts, and task graph for the other agents.
Why: Modularity depends on clear interfaces. This agent prevents overlapping work and tight coupling.
- Backend Producer
Role: Builds services, APIs, business logic, workflows, data access, and integration points.
Why: Most software products need a durable execution layer.
- Frontend Producer
Role: Builds UI, user flows, forms, dashboards, and client-side state handling.
Why: Keeps presentation concerns isolated from backend work.
- QA / Verification Agent
Role: Validates outputs, runs tests, checks acceptance criteria, looks for regressions, and flags inconsistencies between modules.
 
Use a hub-and-spoke model. Almost everything should report to the orchestrator. That is the cleanest structure.
 
Simple flow

- External prompt enters system
- context_analyst produces structured requirements
- orchestrator creates tasks
- architect defines interfaces
- backend_producer and frontend_producer work in parallel
- qa_verifier reviews outputs

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