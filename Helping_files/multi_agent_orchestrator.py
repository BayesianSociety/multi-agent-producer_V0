#!/usr/bin/env python3
"""
Multi-Agent Orchestrator

Production-oriented Codex CLI orchestrator for generating a new software project
from a local `project_specification.md` file.

Design goals:
- No OpenAI API key in code
- No Codex SDK
- Uses `codex exec --experimental-json`
- Emulates spawn_agent-like orchestration with isolated worker subprocesses
- Deterministic planning, manifests, validation, and controlled file ownership

This orchestrator is optimized for application-style projects that may include
frontend, backend, CLI, data, and docs components.
"""

from __future__ import annotations

import argparse
import asyncio
import contextlib
import fnmatch
import hashlib
import json
import os
import re
import shlex
import shutil
import sys
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple


MODEL = os.getenv("CODEX_MODEL", "gpt-5.1-codex")
SANDBOX = os.getenv("CODEX_SANDBOX", "workspace-write")
APPROVAL = 'approval_policy="never"'
WORKSPACE = Path.cwd()
CODEX_TIMEOUT_SECONDS = int(os.getenv("CODEX_TIMEOUT_SECONDS", "1800"))
MAX_CONCURRENCY = int(os.getenv("ORCHESTRATOR_MAX_CONCURRENCY", "3"))

STATE_DIR = WORKSPACE / ".multi_agent_orchestrator"
WORKSPACES_DIR = STATE_DIR / "workspaces"
PLAN_JSON = STATE_DIR / "plan.json"
PLAN_SCHEMA_JSON = STATE_DIR / "plan_schema.json"
MANIFEST_JSON = STATE_DIR / "manifest.json"
RUN_REPORT_JSON = STATE_DIR / "run_report.json"

SPEC_FILE_DEFAULT = WORKSPACE / "project_specification.md"
REQUIREMENTS_MD = WORKSPACE / "REQUIREMENTS.md"
TEST_CONTRACT_MD = WORKSPACE / "TEST_CONTRACT.md"
AGENT_TASKS_MD = WORKSPACE / "AGENT_TASKS.md"
PLAN_OVERVIEW_MD = WORKSPACE / "plan" / "overview.md"
ARCHITECTURE_MD = WORKSPACE / "design" / "architecture.md"
UI_SPEC_MD = WORKSPACE / "design" / "ui_spec.md"
README_MD = WORKSPACE / "README.md"
RUNBOOK_MD = WORKSPACE / "RUNBOOK.md"
TEST_PLAN_MD = WORKSPACE / "tests" / "TEST_PLAN.md"

EXCLUDE_DIRNAMES = {".git", "node_modules", ".venv", "__pycache__"}
EXCLUDE_TOP_LEVEL = {STATE_DIR.name}


class OrchestratorError(RuntimeError):
    pass


@dataclass(frozen=True)
class WorkerRole:
    name: str
    goal: str
    owned_paths: Tuple[str, ...]
    required_inputs: Tuple[str, ...]
    required_outputs: Tuple[str, ...]
    validation_keywords: Tuple[str, ...] = ()
    parallel_group: str = "default"
    notes: Tuple[str, ...] = ()


@dataclass
class CodexRunResult:
    final_text: str
    usage: Dict[str, Any]
    events: List[Dict[str, Any]]
    stderr: str
    returncode: int
    duration_s: float
    cwd: Path
    cmd: List[str]


@dataclass
class WorkerExecutionResult:
    role: WorkerRole
    result: CodexRunResult
    created: List[str]
    modified: List[str]
    deleted: List[str]
    merged_files: List[str]


def sha256_bytes(data: bytes) -> str:
    h = hashlib.sha256()
    h.update(data)
    return h.hexdigest()


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def write_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def require_exists(path: Path) -> None:
    if not path.exists():
        raise OrchestratorError(f"Required file missing: {path}")


def require_nonempty_text(path: Path, *, min_chars: int = 20) -> None:
    require_exists(path)
    text = read_text(path).strip()
    if len(text) < min_chars:
        raise OrchestratorError(f"File is too small or empty: {path} (length={len(text)})")


def ensure_dirs() -> None:
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    WORKSPACES_DIR.mkdir(parents=True, exist_ok=True)
    (WORKSPACE / "plan").mkdir(parents=True, exist_ok=True)
    (WORKSPACE / "design").mkdir(parents=True, exist_ok=True)
    (WORKSPACE / "tests").mkdir(parents=True, exist_ok=True)


def iter_workspace_files(root: Path) -> Iterable[Path]:
    for path in root.rglob("*"):
        if path.is_dir():
            continue
        rel = path.relative_to(root)
        parts = rel.parts
        if parts and parts[0] in EXCLUDE_TOP_LEVEL:
            continue
        if any(part in EXCLUDE_DIRNAMES for part in parts):
            continue
        yield path


def snapshot_workspace(root: Path) -> Dict[str, Dict[str, Any]]:
    snap: Dict[str, Dict[str, Any]] = {}
    for path in iter_workspace_files(root):
        rel = path.relative_to(root).as_posix()
        try:
            stat = path.stat()
            snap[rel] = {"sha256": sha256_file(path), "size": stat.st_size}
        except FileNotFoundError:
            continue
    return snap


def diff_snapshots(before: Dict[str, Dict[str, Any]], after: Dict[str, Dict[str, Any]]) -> Dict[str, List[str]]:
    before_keys = set(before)
    after_keys = set(after)
    created = sorted(after_keys - before_keys)
    deleted = sorted(before_keys - after_keys)
    modified = sorted(
        rel for rel in (before_keys & after_keys) if before[rel]["sha256"] != after[rel]["sha256"]
    )
    return {"created": created, "modified": modified, "deleted": deleted}


def matches_any_glob(rel_path: str, globs: Sequence[str]) -> bool:
    return any(fnmatch.fnmatch(rel_path, pattern) for pattern in globs)


def is_relative_non_parent(path_text: str) -> bool:
    p = Path(path_text)
    return not p.is_absolute() and ".." not in p.parts


def owned_roots(globs: Sequence[str]) -> List[str]:
    roots: List[str] = []
    for glob in globs:
        first = glob.split("/", 1)[0]
        if any(ch in first for ch in "*?[]"):
            raise OrchestratorError(f"Owned path glob must begin with a concrete top-level path: {glob}")
        roots.append(first)
    return roots


def copy_workspace(src: Path, dst: Path) -> None:
    if dst.exists():
        shutil.rmtree(dst)

    def ignore(directory: str, names: List[str]) -> set[str]:
        ignored: set[str] = set()
        rel = Path(directory).resolve().relative_to(src.resolve())
        if rel == Path("."):
            for name in names:
                if name in EXCLUDE_TOP_LEVEL:
                    ignored.add(name)
        for name in names:
            if name in EXCLUDE_DIRNAMES:
                ignored.add(name)
        return ignored

    shutil.copytree(src, dst, ignore=ignore)


def copy_file(src: Path, dst: Path) -> None:
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dst)


def summarize_text_block(path: Path, limit: int = 8000) -> str:
    text = read_text(path)
    if len(text) <= limit:
        return text
    head = text[: limit - 1200]
    tail = text[-1000:]
    return f"{head}\n\n[... truncated ...]\n\n{tail}"


def plan_schema() -> Dict[str, Any]:
    return {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "project_name": {"type": "string", "minLength": 1},
            "project_type": {
                "type": "string",
                "enum": ["web_app", "api_service", "cli_tool", "library", "automation", "mobile_app", "desktop_app"],
            },
            "summary": {"type": "string", "minLength": 1},
            "components": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "frontend": {"type": "boolean"},
                    "backend": {"type": "boolean"},
                    "cli": {"type": "boolean"},
                    "mobile": {"type": "boolean"},
                    "database": {"type": "boolean"},
                    "docs": {"type": "boolean"},
                },
                "required": ["frontend", "backend", "cli", "mobile", "database", "docs"],
            },
            "implementation_roles": {
                "type": "array",
                "minItems": 1,
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {
                        "name": {"type": "string", "minLength": 1},
                        "goal": {"type": "string", "minLength": 1},
                        "owned_paths": {"type": "array", "minItems": 1, "items": {"type": "string", "minLength": 1}},
                        "required_inputs": {
                            "type": "array",
                            "minItems": 1,
                            "items": {"type": "string", "minLength": 1},
                        },
                        "required_outputs": {
                            "type": "array",
                            "minItems": 1,
                            "items": {"type": "string", "minLength": 1},
                        },
                        "validation_keywords": {
                            "type": "array",
                            "items": {"type": "string", "minLength": 1},
                        },
                        "parallel_group": {"type": "string", "minLength": 1},
                        "notes": {"type": "array", "items": {"type": "string", "minLength": 1}},
                    },
                    "required": [
                        "name",
                        "goal",
                        "owned_paths",
                        "required_inputs",
                        "required_outputs",
                        "validation_keywords",
                        "parallel_group",
                        "notes",
                    ],
                },
            },
            "global_constraints": {"type": "array", "items": {"type": "string", "minLength": 1}},
        },
        "required": [
            "project_name",
            "project_type",
            "summary",
            "components",
            "implementation_roles",
            "global_constraints",
        ],
    }


def validate_plan_obj(plan: Dict[str, Any]) -> List[WorkerRole]:
    roles_raw = plan.get("implementation_roles")
    if not isinstance(roles_raw, list) or not roles_raw:
        raise OrchestratorError("Plan validation failed: implementation_roles must be a non-empty array.")

    seen_names: set[str] = set()
    claimed_roots: Dict[str, str] = {}
    roles: List[WorkerRole] = []

    for item in roles_raw:
        if not isinstance(item, dict):
            raise OrchestratorError("Plan validation failed: each role must be an object.")

        name = str(item.get("name", "")).strip()
        goal = str(item.get("goal", "")).strip()
        owned_paths = tuple(item.get("owned_paths", []))
        required_inputs = tuple(item.get("required_inputs", []))
        required_outputs = tuple(item.get("required_outputs", []))
        validation_keywords = tuple(item.get("validation_keywords", []))
        parallel_group = str(item.get("parallel_group", "default")).strip() or "default"
        notes = tuple(item.get("notes", []))

        if not name or not goal:
            raise OrchestratorError("Plan validation failed: each role needs non-empty name and goal.")
        if name in seen_names:
            raise OrchestratorError(f"Plan validation failed: duplicate role name '{name}'.")
        seen_names.add(name)

        for rel in list(owned_paths) + list(required_inputs) + list(required_outputs):
            if not is_relative_non_parent(rel):
                raise OrchestratorError(f"Plan validation failed: path must be relative and safe: {rel}")

        for rel in required_outputs:
            if not matches_any_glob(rel, owned_paths):
                raise OrchestratorError(
                    f"Plan validation failed: required output '{rel}' is not covered by owned_paths for role '{name}'."
                )

        for root in owned_roots(owned_paths):
            owner = claimed_roots.get(root)
            if owner and owner != name:
                raise OrchestratorError(
                    f"Plan validation failed: top-level path '{root}' is owned by both '{owner}' and '{name}'."
                )
            claimed_roots[root] = name

        roles.append(
            WorkerRole(
                name=name,
                goal=goal,
                owned_paths=owned_paths,
                required_inputs=required_inputs,
                required_outputs=required_outputs,
                validation_keywords=validation_keywords,
                parallel_group=parallel_group,
                notes=notes,
            )
        )

    return roles


def role_header(role_name: str) -> str:
    return (
        f"You are the {role_name} in a production-grade multi-agent software delivery pipeline.\n"
        "You must follow the provided sources of truth exactly.\n"
        "You must write the requested files to disk in the current workspace.\n"
        f"Use the workspace sandbox: {SANDBOX}.\n"
        "Do not ask for approval.\n"
        "Do not use external dependencies unless the specification explicitly requires them.\n"
        "End with a short machine-readable footer:\n"
        "FINAL_STATUS: success|blocked\n"
        "CHANGED_FILES:\n"
        "- path\n"
        "SUMMARY: one sentence\n"
    )


def planner_prompt(spec_text: str) -> str:
    return f"""\
{role_header("Planner")}

Task:
Read project_specification.md and produce a strict execution plan as JSON only.
Output only the JSON object. Do not wrap in markdown. Do not write any files.

Planning rules:
- This orchestrator is optimized for delivering real software/apps from one workspace.
- Prefer a small number of implementation roles with disjoint ownership.
- Each implementation role must own a concrete top-level path or file tree.
- Valid owned paths examples:
  - frontend/**
  - backend/**
  - mobile/**
  - cli/**
  - src/**
  - infra/**
- Avoid overlapping owned top-level paths across roles.
- Always include at least one implementation role.
- Always set components.docs = true.
- Put implementation roles that can safely run together in the same parallel_group.
- Do not include product/docs/test planning roles in implementation_roles; those are handled by the orchestrator.
- Include validation_keywords that provide lightweight evidence of the intended output.

Project specification:
{spec_text}
"""


def pm_prompt(spec_text: str, plan_json: str, manifest: str) -> str:
    return f"""\
{role_header("Product Manager")}

Write exactly these files:
- REQUIREMENTS.md
- TEST_CONTRACT.md
- AGENT_TASKS.md
- plan/overview.md

Do not modify any other file.

Requirements:
- REQUIREMENTS.md must define scope, user stories, architecture expectations, constraints, non-functional requirements,
  delivery assumptions, and acceptance criteria.
- TEST_CONTRACT.md must define the externally testable contract.
- If the project has a backend or HTTP surface, TEST_CONTRACT.md must include explicit endpoint lines such as:
  - GET /health
  - POST /api/items
- If the project exposes CLI behavior, include explicit command lines such as:
  - COMMAND tool-name subcommand --flag
- AGENT_TASKS.md must map each role to owned paths, inputs, outputs, dependencies, and done criteria.
- plan/overview.md must summarize the system, the delivery phases, and the dependency graph between artifacts.

Determinism rules:
- Treat the plan JSON as a hard constraint.
- Do not modify plan.json or manifest.json.
- Keep contracts concrete and testable.

Plan JSON:
{plan_json}

Manifest:
{manifest}

project_specification.md:
{spec_text}
"""


def architect_prompt(spec_text: str, plan_json: str, requirements: str, agent_tasks: str, manifest: str) -> str:
    return f"""\
{role_header("Architect")}

Write into design/ only.

Required outputs:
- design/architecture.md
- design/ui_spec.md only if the project includes a frontend, mobile, or desktop user interface

architecture.md must include:
- system context
- major modules/components
- data flow
- integration boundaries
- storage strategy
- error handling strategy
- deployment/runtime assumptions
- risks and simplifications

If a UI exists, ui_spec.md must include:
- primary screens or views
- interaction model
- state transitions
- empty/loading/error states
- accessibility basics

Do not modify any file outside design/.

Plan JSON:
{plan_json}

Manifest:
{manifest}

project_specification.md:
{spec_text}

REQUIREMENTS.md:
{requirements}

AGENT_TASKS.md:
{agent_tasks}
"""


def implementation_guidance(role: WorkerRole) -> str:
    lower = role.name.lower()
    if "frontend" in lower or "ui" in lower:
        return (
            "Frontend guidance:\n"
            "- Preserve clear entrypoints and a runnable local development path.\n"
            "- Keep state handling simple and readable.\n"
            "- Implement empty/loading/error states.\n"
            "- Avoid placeholder-only UIs.\n"
        )
    if "backend" in lower or "api" in lower or "server" in lower:
        return (
            "Backend guidance:\n"
            "- Implement the contract defined in TEST_CONTRACT.md.\n"
            "- Add input validation, error handling, and a health endpoint when HTTP is used.\n"
            "- Prefer simple, production-readable code over framework-heavy scaffolding.\n"
        )
    if "cli" in lower:
        return (
            "CLI guidance:\n"
            "- Ensure command behavior matches TEST_CONTRACT.md exactly.\n"
            "- Provide usage/help behavior.\n"
            "- Return non-zero exit codes on failures.\n"
        )
    if "data" in lower:
        return (
            "Data guidance:\n"
            "- Keep parsing and transformation deterministic.\n"
            "- Handle malformed inputs explicitly.\n"
            "- Separate pure processing logic from I/O where practical.\n"
        )
    return (
        "Implementation guidance:\n"
        "- Deliver complete, runnable code in your owned paths.\n"
        "- Keep code maintainable, direct, and production-readable.\n"
    )


def implementation_prompt(
    role: WorkerRole,
    spec_text: str,
    plan_json: str,
    requirements: str,
    test_contract: str,
    agent_tasks: str,
    architecture: str,
    ui_spec: str,
    manifest: str,
) -> str:
    notes = "\n".join(f"- {note}" for note in role.notes) if role.notes else "- No extra notes."
    return f"""\
{role_header(role.name)}

Your specific mission:
{role.goal}

You own only these paths:
{os.linesep.join(f"- {path}" for path in role.owned_paths)}

You must produce these required outputs:
{os.linesep.join(f"- {path}" for path in role.required_outputs)}

You may read these declared inputs:
{os.linesep.join(f"- {path}" for path in role.required_inputs)}

Non-negotiable constraints:
- Do not modify files outside your owned paths.
- Do not edit the shared planning/docs inputs.
- Make the result runnable and coherent within your owned scope.
- Prefer minimal dependencies and explicit setup.

Additional notes:
{notes}

{implementation_guidance(role)}

Manifest:
{manifest}

Plan JSON:
{plan_json}

project_specification.md:
{spec_text}

REQUIREMENTS.md:
{requirements}

TEST_CONTRACT.md:
{test_contract}

AGENT_TASKS.md:
{agent_tasks}

design/architecture.md:
{architecture}

design/ui_spec.md:
{ui_spec or "(not applicable)"} 
"""


def qa_prompt(
    spec_text: str,
    plan_json: str,
    requirements: str,
    test_contract: str,
    agent_tasks: str,
    architecture: str,
    manifest: str,
) -> str:
    return f"""\
{role_header("QA Engineer")}

Write into tests/ only.

Required output:
- tests/TEST_PLAN.md

Optional outputs:
- tests/test.sh
- tests/smoke_test.sh
- tests/http_contract.sh

Requirements:
- TEST_PLAN.md must cover every externally testable behavior in TEST_CONTRACT.md.
- If TEST_CONTRACT.md contains HTTP endpoint lines, explicitly test each one.
- If TEST_CONTRACT.md contains COMMAND lines, explicitly test each one.
- Include manual checks, failure cases, and startup/teardown notes.
- Optional scripts must use only common shell tooling unless the specification requires something else.
- If you create a shell script, it must start with a shebang.

Do not modify files outside tests/.

Manifest:
{manifest}

Plan JSON:
{plan_json}

project_specification.md:
{spec_text}

REQUIREMENTS.md:
{requirements}

TEST_CONTRACT.md:
{test_contract}

AGENT_TASKS.md:
{agent_tasks}

design/architecture.md:
{architecture}
"""


def docs_prompt(
    spec_text: str,
    plan_json: str,
    requirements: str,
    test_contract: str,
    architecture: str,
    manifest: str,
) -> str:
    return f"""\
{role_header("Docs Engineer")}

Write exactly these files:
- README.md
- RUNBOOK.md

README.md must include:
- what the software does
- project structure
- how to run it locally
- how to validate it
- key constraints and assumptions

RUNBOOK.md must include:
- startup steps
- configuration/runtime dependencies
- basic health verification
- release/update steps
- troubleshooting

Do not modify any other file.

Manifest:
{manifest}

Plan JSON:
{plan_json}

project_specification.md:
{spec_text}

REQUIREMENTS.md:
{requirements}

TEST_CONTRACT.md:
{test_contract}

design/architecture.md:
{architecture}
"""


async def run_codex(
    prompt: str,
    *,
    cwd: Optional[Path] = None,
    extra_args: Optional[List[str]] = None,
) -> CodexRunResult:
    cmd = [
        "codex",
        "exec",
        "--experimental-json",
        "--model",
        MODEL,
        "--sandbox",
        SANDBOX,
        "--config",
        APPROVAL,
        "--skip-git-repo-check",
    ]
    if extra_args:
        cmd.extend(extra_args)

    run_cwd = cwd or WORKSPACE
    env = {
        key: value
        for key, value in os.environ.items()
        if key.startswith("CODEX_") or key in {"PATH", "HOME", "USER", "SHELL", "TERM", "TMPDIR", "TMP", "TEMP"}
    }

    start = time.monotonic()
    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=str(run_cwd),
            env=env,
        )
    except FileNotFoundError as exc:
        raise OrchestratorError("codex CLI is not installed or not on PATH.") from exc

    assert proc.stdin and proc.stdout and proc.stderr

    events: List[Dict[str, Any]] = []
    assistant_texts: List[str] = []
    stderr_chunks: List[str] = []

    async def write_prompt() -> None:
        proc.stdin.write(prompt.encode("utf-8"))
        await proc.stdin.drain()
        proc.stdin.close()
        with contextlib.suppress(Exception):
            await proc.stdin.wait_closed()

    async def read_stdout() -> None:
        async for raw_line in proc.stdout:
            line = raw_line.decode("utf-8", errors="replace").strip()
            if not line:
                continue
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                events.append({"type": "invalid_json_line", "raw": line})
                continue
            events.append(event)
            if event.get("type") == "item.completed":
                item = event.get("item", {})
                if item.get("type") == "agent_message":
                    text = str(item.get("text", "")).strip()
                    if text:
                        assistant_texts.append(text)

    async def read_stderr() -> None:
        async for raw_line in proc.stderr:
            stderr_chunks.append(raw_line.decode("utf-8", errors="replace"))

    async def run_all() -> int:
        await asyncio.gather(write_prompt(), read_stdout(), read_stderr())
        return await proc.wait()

    try:
        returncode = await asyncio.wait_for(run_all(), timeout=CODEX_TIMEOUT_SECONDS)
    except asyncio.TimeoutError as exc:
        proc.kill()
        with contextlib.suppress(Exception):
            await proc.wait()
        raise OrchestratorError(
            f"codex timed out after {CODEX_TIMEOUT_SECONDS}s: {' '.join(shlex.quote(x) for x in cmd)}"
        ) from exc

    stderr_text = "".join(stderr_chunks)
    duration_s = time.monotonic() - start

    if returncode != 0:
        if "login" in stderr_text.lower() or "auth" in stderr_text.lower():
            raise OrchestratorError(f"codex CLI authentication failed or expired: {stderr_text.strip()}")
        raise OrchestratorError(f"codex failed ({returncode}): {stderr_text.strip()}")

    usage: Dict[str, Any] = {}
    for event in reversed(events):
        if event.get("type") == "turn.completed" and isinstance(event.get("usage"), dict):
            usage = event["usage"]
            break

    final_text = assistant_texts[-1] if assistant_texts else "(no agent_message text)"
    return CodexRunResult(
        final_text=final_text,
        usage=usage,
        events=events,
        stderr=stderr_text,
        returncode=returncode,
        duration_s=duration_s,
        cwd=run_cwd,
        cmd=cmd,
    )


def write_manifest(note: str) -> None:
    snap = snapshot_workspace(WORKSPACE)
    manifest = {
        "note": note,
        "model": MODEL,
        "sandbox": SANDBOX,
        "workspace": str(WORKSPACE),
        "snapshot_sha256": sha256_bytes(json.dumps(snap, sort_keys=True).encode("utf-8")),
        "files": snap,
    }
    write_text(MANIFEST_JSON, json.dumps(manifest, indent=2))


def merge_worker_outputs(
    role: WorkerRole,
    stage_dir: Path,
    created: List[str],
    modified: List[str],
) -> List[str]:
    merged: List[str] = []
    for rel in sorted(set(created + modified)):
        if not matches_any_glob(rel, role.owned_paths):
            continue
        src = stage_dir / rel
        if not src.exists():
            continue
        dst = WORKSPACE / rel
        copy_file(src, dst)
        merged.append(rel)
    return merged


def validate_worker_diff(role: WorkerRole, diff: Dict[str, List[str]]) -> None:
    if diff["deleted"]:
        raise OrchestratorError(f"[{role.name}] Unexpected deletions: {diff['deleted'][:20]}")

    violations: List[str] = []
    for rel in diff["created"] + diff["modified"]:
        if not matches_any_glob(rel, role.owned_paths):
            violations.append(rel)
    if violations:
        preview = ", ".join(violations[:10])
        raise OrchestratorError(f"[{role.name}] Modified paths outside ownership: {preview}")


def validate_footer(result: CodexRunResult) -> None:
    txt = result.final_text
    if "FINAL_STATUS:" not in txt or "CHANGED_FILES:" not in txt or "SUMMARY:" not in txt:
        raise OrchestratorError("Codex output missing required machine-readable footer.")


def validate_pm_outputs() -> None:
    for path in [REQUIREMENTS_MD, TEST_CONTRACT_MD, AGENT_TASKS_MD, PLAN_OVERVIEW_MD]:
        require_nonempty_text(path, min_chars=120)

    req_txt = read_text(REQUIREMENTS_MD).lower()
    for keyword in ["scope", "acceptance", "constraints"]:
        if keyword not in req_txt:
            raise OrchestratorError(f"REQUIREMENTS.md validation failed: missing '{keyword}'.")


def validate_architecture_outputs(components: Dict[str, Any]) -> None:
    require_nonempty_text(ARCHITECTURE_MD, min_chars=160)
    architecture_txt = read_text(ARCHITECTURE_MD).lower()
    for keyword in ["component", "data flow", "error", "runtime"]:
        if keyword not in architecture_txt:
            raise OrchestratorError(f"design/architecture.md validation failed: missing '{keyword}'.")

    if components.get("frontend") or components.get("mobile"):
        require_nonempty_text(UI_SPEC_MD, min_chars=120)


def validate_role_outputs(role: WorkerRole) -> None:
    collected_text = []
    for rel in role.required_outputs:
        path = WORKSPACE / rel
        require_nonempty_text(path, min_chars=40)
        if path.suffix.lower() in {".md", ".txt", ".html", ".css", ".js", ".ts", ".tsx", ".jsx", ".json", ".yml", ".yaml", ".sh", ".py"}:
            collected_text.append(read_text(path).lower())

    merged_text = "\n".join(collected_text)
    for keyword in role.validation_keywords:
        if keyword.lower() not in merged_text:
            raise OrchestratorError(
                f"[{role.name}] Validation failed: expected keyword '{keyword}' in required outputs."
            )


def extract_http_endpoints(test_contract: str) -> List[Tuple[str, str]]:
    matches = re.findall(r"(?im)\b(GET|POST|PUT|PATCH|DELETE)\s+(/[^ \t\r\n]+)", test_contract)
    endpoints = {(method.upper(), path) for method, path in matches}
    return sorted(endpoints, key=lambda item: (item[0], item[1]))


def extract_commands(test_contract: str) -> List[str]:
    matches = re.findall(r"(?im)^\s*COMMAND\s+(.+?)\s*$", test_contract)
    return sorted({match.strip() for match in matches if match.strip()})


def validate_tests_outputs() -> None:
    require_nonempty_text(TEST_PLAN_MD, min_chars=120)
    plan_txt = read_text(TEST_PLAN_MD).lower()
    if "manual checks" not in plan_txt:
        raise OrchestratorError("tests/TEST_PLAN.md validation failed: missing 'Manual checks' section.")

    contract = read_text(TEST_CONTRACT_MD)
    for method, path in extract_http_endpoints(contract):
        target = f"{method.lower()} {path.lower()}"
        if target not in plan_txt and path.lower() not in plan_txt:
            raise OrchestratorError(f"tests/TEST_PLAN.md missing endpoint coverage for {method} {path}.")

    for command in extract_commands(contract):
        if command.lower() not in plan_txt:
            raise OrchestratorError(f"tests/TEST_PLAN.md missing command coverage for: {command}")

    for rel in ["tests/test.sh", "tests/smoke_test.sh", "tests/http_contract.sh"]:
        path = WORKSPACE / rel
        if path.exists():
            require_nonempty_text(path, min_chars=10)
            if not read_text(path).lstrip().startswith("#!"):
                raise OrchestratorError(f"{rel} validation failed: missing shebang.")


def validate_docs_outputs() -> None:
    require_nonempty_text(README_MD, min_chars=120)
    require_nonempty_text(RUNBOOK_MD, min_chars=100)

    readme = read_text(README_MD).lower()
    runbook = read_text(RUNBOOK_MD).lower()
    for keyword in ["run", "project structure", "validate"]:
        if keyword not in readme:
            raise OrchestratorError(f"README.md validation failed: missing '{keyword}'.")
    if "troubleshooting" not in runbook:
        raise OrchestratorError("RUNBOOK.md validation failed: missing troubleshooting section.")


async def run_isolated_worker(role: WorkerRole, prompt: str) -> WorkerExecutionResult:
    worker_id = f"{int(time.time())}-{uuid.uuid4().hex[:8]}"
    stage_dir = WORKSPACES_DIR / f"{role.name.lower().replace(' ', '_')}-{worker_id}"
    copy_workspace(WORKSPACE, stage_dir)

    before = snapshot_workspace(stage_dir)
    result = await run_codex(prompt, cwd=stage_dir)
    after = snapshot_workspace(stage_dir)
    diff = diff_snapshots(before, after)

    validate_footer(result)
    validate_worker_diff(role, diff)

    for rel in role.required_outputs:
        if rel not in after:
            raise OrchestratorError(f"[{role.name}] Required output missing in staged workspace: {rel}")

    merged_files = merge_worker_outputs(role, stage_dir, diff["created"], diff["modified"])
    if not merged_files:
        raise OrchestratorError(f"[{role.name}] No owned files were produced or modified.")

    return WorkerExecutionResult(
        role=role,
        result=result,
        created=diff["created"],
        modified=diff["modified"],
        deleted=diff["deleted"],
        merged_files=merged_files,
    )


def report_worker_result(execution: WorkerExecutionResult) -> None:
    usage = execution.result.usage.get("output_tokens", "?")
    files = ", ".join(execution.merged_files[:6])
    print(f"[{execution.role.name}] merged={len(execution.merged_files)} output_tokens={usage} files={files}")


async def run_parallel_roles(jobs: List[Tuple[WorkerRole, str]], max_concurrency: int) -> List[WorkerExecutionResult]:
    semaphore = asyncio.Semaphore(max_concurrency)

    async def one(role: WorkerRole, prompt: str) -> WorkerExecutionResult:
        async with semaphore:
            return await run_isolated_worker(role, prompt)

    tasks = [asyncio.create_task(one(role, prompt)) for role, prompt in jobs]
    return await asyncio.gather(*tasks)


def build_run_report(plan: Dict[str, Any], results: List[WorkerExecutionResult]) -> Dict[str, Any]:
    return {
        "project_name": plan["project_name"],
        "project_type": plan["project_type"],
        "model": MODEL,
        "sandbox": SANDBOX,
        "results": [
            {
                "role": item.role.name,
                "duration_s": round(item.result.duration_s, 2),
                "output_tokens": item.result.usage.get("output_tokens"),
                "merged_files": item.merged_files,
            }
            for item in results
        ],
    }


async def step_plan(spec_text: str) -> Tuple[Dict[str, Any], List[WorkerRole]]:
    schema = plan_schema()
    write_text(PLAN_SCHEMA_JSON, json.dumps(schema, indent=2))
    result = await run_codex(
        planner_prompt(spec_text),
        extra_args=["--output-schema", str(PLAN_SCHEMA_JSON)],
    )
    plan = json.loads(result.final_text)
    roles = validate_plan_obj(plan)
    write_text(PLAN_JSON, json.dumps(plan, indent=2))
    print(f"[Planner] project={plan['project_name']} type={plan['project_type']} roles={len(roles)}")
    return plan, roles


async def main() -> None:
    parser = argparse.ArgumentParser(description="Production-grade Codex CLI multi-agent orchestrator.")
    parser.add_argument("--spec", default=str(SPEC_FILE_DEFAULT), help="Path to project_specification.md")
    parser.add_argument("--max-concurrency", type=int, default=MAX_CONCURRENCY, help="Maximum concurrent workers")
    args = parser.parse_args()

    spec_path = Path(args.spec).resolve()
    require_nonempty_text(spec_path, min_chars=80)

    ensure_dirs()

    spec_text = summarize_text_block(spec_path, limit=16000)
    write_manifest("Initial manifest before planning")
    plan, implementation_roles = await step_plan(spec_text)
    write_manifest("Manifest after planning")

    manifest = summarize_text_block(MANIFEST_JSON, limit=10000)
    plan_json_text = summarize_text_block(PLAN_JSON, limit=16000)

    pm_role = WorkerRole(
        name="Product Manager",
        goal="Create the source-of-truth requirements, test contract, dependency map, and role task breakdown.",
        owned_paths=("REQUIREMENTS.md", "TEST_CONTRACT.md", "AGENT_TASKS.md", "plan/overview.md"),
        required_inputs=(spec_path.name, ".multi_agent_orchestrator/plan.json", ".multi_agent_orchestrator/manifest.json"),
        required_outputs=("REQUIREMENTS.md", "TEST_CONTRACT.md", "AGENT_TASKS.md", "plan/overview.md"),
        validation_keywords=("scope", "acceptance criteria", "dependencies"),
        parallel_group="sequential",
    )
    print("[Product Manager] generating source-of-truth documents")
    pm_exec = await run_isolated_worker(pm_role, pm_prompt(spec_text, plan_json_text, manifest))
    validate_pm_outputs()
    report_worker_result(pm_exec)
    write_manifest("Manifest after product manager")

    requirements = summarize_text_block(REQUIREMENTS_MD, limit=12000)
    agent_tasks = summarize_text_block(AGENT_TASKS_MD, limit=12000)
    architect_role = WorkerRole(
        name="Architect",
        goal="Create the system architecture and any UI specification needed for implementation.",
        owned_paths=("design/**",),
        required_inputs=(
            spec_path.name,
            "REQUIREMENTS.md",
            "AGENT_TASKS.md",
            ".multi_agent_orchestrator/plan.json",
            ".multi_agent_orchestrator/manifest.json",
        ),
        required_outputs=("design/architecture.md",),
        validation_keywords=("component", "data flow", "error handling"),
        parallel_group="sequential",
    )
    print("[Architect] producing architecture and UI design artifacts")
    architect_exec = await run_isolated_worker(
        architect_role,
        architect_prompt(spec_text, plan_json_text, requirements, agent_tasks, manifest),
    )
    validate_architecture_outputs(plan["components"])
    report_worker_result(architect_exec)
    write_manifest("Manifest after architect")

    test_contract = summarize_text_block(TEST_CONTRACT_MD, limit=12000)
    architecture = summarize_text_block(ARCHITECTURE_MD, limit=12000)
    ui_spec = summarize_text_block(UI_SPEC_MD, limit=8000) if UI_SPEC_MD.exists() else ""

    print("[Implementation] running isolated Codex workers for component delivery")
    implementation_jobs: List[Tuple[WorkerRole, str]] = []
    for role in implementation_roles:
        prompt = implementation_prompt(
            role=role,
            spec_text=spec_text,
            plan_json=plan_json_text,
            requirements=requirements,
            test_contract=test_contract,
            agent_tasks=agent_tasks,
            architecture=architecture,
            ui_spec=ui_spec,
            manifest=manifest,
        )
        implementation_jobs.append((role, prompt))

    grouped: Dict[str, List[Tuple[WorkerRole, str]]] = {}
    for job in implementation_jobs:
        grouped.setdefault(job[0].parallel_group, []).append(job)

    implementation_execs: List[WorkerExecutionResult] = []
    for parallel_group, jobs in grouped.items():
        print(f"[Implementation] group={parallel_group} workers={len(jobs)}")
        results = await run_parallel_roles(jobs, max_concurrency=max(1, args.max_concurrency))
        for result in results:
            validate_role_outputs(result.role)
            report_worker_result(result)
        implementation_execs.extend(results)
        write_manifest(f"Manifest after implementation group {parallel_group}")
        manifest = summarize_text_block(MANIFEST_JSON, limit=10000)

    qa_role = WorkerRole(
        name="QA Engineer",
        goal="Create the test plan and optional smoke scripts covering the externally visible contract.",
        owned_paths=("tests/**",),
        required_inputs=(
            spec_path.name,
            "REQUIREMENTS.md",
            "TEST_CONTRACT.md",
            "AGENT_TASKS.md",
            "design/architecture.md",
            ".multi_agent_orchestrator/plan.json",
        ),
        required_outputs=("tests/TEST_PLAN.md",),
        validation_keywords=("manual checks",),
        parallel_group="sequential",
    )
    print("[QA Engineer] generating verification artifacts")
    qa_exec = await run_isolated_worker(
        qa_role,
        qa_prompt(spec_text, plan_json_text, requirements, test_contract, agent_tasks, architecture, manifest),
    )
    validate_tests_outputs()
    report_worker_result(qa_exec)
    write_manifest("Manifest after QA")

    docs_role = WorkerRole(
        name="Docs Engineer",
        goal="Write the operator and developer documentation for the generated software.",
        owned_paths=("README.md", "RUNBOOK.md"),
        required_inputs=(
            spec_path.name,
            "REQUIREMENTS.md",
            "TEST_CONTRACT.md",
            "design/architecture.md",
            ".multi_agent_orchestrator/plan.json",
        ),
        required_outputs=("README.md", "RUNBOOK.md"),
        validation_keywords=("run", "troubleshooting"),
        parallel_group="sequential",
    )
    print("[Docs Engineer] writing README and RUNBOOK")
    docs_exec = await run_isolated_worker(
        docs_role,
        docs_prompt(spec_text, plan_json_text, requirements, test_contract, architecture, manifest),
    )
    validate_docs_outputs()
    report_worker_result(docs_exec)
    write_manifest("Manifest after docs")

    all_results = [pm_exec, architect_exec, *implementation_execs, qa_exec, docs_exec]
    report = build_run_report(plan, all_results)
    write_text(RUN_REPORT_JSON, json.dumps(report, indent=2))

    print("\nGenerated and validated artifacts:")
    for path in [
        PLAN_JSON,
        MANIFEST_JSON,
        REQUIREMENTS_MD,
        TEST_CONTRACT_MD,
        AGENT_TASKS_MD,
        PLAN_OVERVIEW_MD,
        ARCHITECTURE_MD,
        UI_SPEC_MD,
        TEST_PLAN_MD,
        README_MD,
        RUNBOOK_MD,
        RUN_REPORT_JSON,
    ]:
        if path.exists():
            print(f" - {path}")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\nInterrupted.", file=sys.stderr)
        sys.exit(130)
    except OrchestratorError as exc:
        print(f"\nERROR: {exc}", file=sys.stderr)
        sys.exit(1)
