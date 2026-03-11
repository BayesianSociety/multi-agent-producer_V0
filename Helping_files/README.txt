Usage:

python3 multi_agent_orchestrator.py --spec project_specification.md

Verification: python3 -m py_compile multi_agent_orchestrator.py passed.

Two critical limits remain, by design:

- This emulates spawn_agent with parallel codex exec workers; it is not the real host-provided internal
spawn_agent tool.
- Full reliability still depends on the quality of project_specification.md and the Codex CLI’s current
--experimental-json behavior.