› You are an expert in OpenAI Codex. Explain how is it possible to spawn multiple agents to parallelize the work
  using Codex only multi-agent workflow (no OpenAI application programming interface key required) and no Codex
  software development kit.


• Yes. In Codex’s built-in agent environment, multi-agent work is possible without an OpenAI API key and without
  the Codex SDK because agent orchestration is provided by the host runtime, not by your code.

  How it works

  Codex exposes agent-management tools directly inside the session:

  - spawn_agent: start a sub-agent
  - send_input: give it more work
  - wait: wait for one or more agents to finish
  - close_agent: clean up finished agents
  - multi_tool_use.parallel: run multiple tool calls concurrently when independent

  So instead of writing code against an API, Codex itself is the orchestrator.

  What “no API key” really means

  You are not calling the OpenAI API yourself. The Codex environment already has access to the underlying model/
  runtime and exposes higher-level tools for delegation. Your workflow is:

  1. Main Codex agent analyzes the task.
  2. It splits bounded subtasks.
  3. It spawns sub-agents in parallel.
  4. Each sub-agent works in its own forked context/workspace view.
  5. The main agent waits for results, reviews them, and integrates them.

  No user-supplied API credentials are needed because the platform is doing the model invocation internally.

  Typical pattern

  1. Keep the critical-path task local.
  2. Delegate side tasks in parallel.
  3. Give each worker a narrow scope and file ownership.
  4. Continue local work while agents run.
  5. Collect results with wait.
  6. Merge or refine.

  Minimal example

  Conceptually, the main agent does this:

  spawn_agent(worker A: implement auth fix in file set A)
  spawn_agent(worker B: add tests in file set B)
  spawn_agent(explorer C: inspect where config is loaded)

  do local integration work

  wait for agents
  review outputs
  apply final edits
  close agents

  Why this counts as “Codex-only”

  Because all of this is happening through Codex-native tools in the session:

  - no SDK imports
  - no REST calls
  - no custom agent framework
  - no API key management
  When it works well

  Best for:

  - codebase exploration in parallel
  - disjoint file edits
  - test creation while implementation proceeds
  - verification tasks running beside feature work

  Less useful when:

  - tasks are tightly coupled
  - every next step depends on the previous result
  - multiple agents would constantly collide on the same files

  Important constraint

  This is not “plain terminal Codex magically spawning processes by itself.” It works when your Codex environment
  includes agent tools like spawn_agent. If you are in a simpler Codex surface that does not expose those tools,
  then you cannot do true built-in multi-agent orchestration without falling back to your own scripts, SDK, or
  API.

  Bottom line

  Multiple agents can be spawned without an API key or SDK when Codex is running in a host environment that
  provides built-in delegation tools. The orchestration layer is part of Codex’s runtime, so the main agent can
  create, coordinate, and merge sub-agent work directly.

  If you want, I can also show:

  1. a concrete spawn_agent / wait workflow,
  2. a best-practice task-splitting template,
  3. or a comparison between Codex multi-agent tools vs SDK/API-based orchestration.


› Is it possible to use this code, and explain how would you adjust it. Be critical.
  async def run_codex(
      prompt: str,
      *,
      cwd: Optional[Path] = None,
      extra_args: Optional[List[str]] = None,
  ) -> Tuple[str, Dict[str, Any]]:
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

      proc = await asyncio.create_subprocess_exec(
          *cmd,
          stdin=asyncio.subprocess.PIPE,
          stdout=asyncio.subprocess.PIPE,
          stderr=asyncio.subprocess.PIPE,
          cwd=str(cwd or WORKSPACE),
          env=os.environ.copy(),
      )

      proc.stdin.close()

      assert proc.stdout
      final_text = ""
      usage: Dict[str, Any] | None = None

      async for raw_line in proc.stdout:
          line = raw_line.decode("utf-8", errors="replace").strip()
          if not line:
              continue
          event = json.loads(line)
          if event.get("type") == "item.completed" and event.get("item", {}).get("type") == "agent_message":
              final_text = event["item"].get("text", "")
          elif event.get("type") == "turn.completed":
              usage = event.get("usage")

      stderr = await proc.stderr.read()
      try:
          returncode = await asyncio.wait_for(proc.wait(), timeout=CODEX_TIMEOUT_SECONDS)
      except asyncio.TimeoutError:
          proc.kill()
          raise RuntimeError(
              f"codex timed out after {CODEX_TIMEOUT_SECONDS} seconds: {' '.join(shlex.quote(x) for x in cmd)}"
          )

      if returncode != 0:
          raise RuntimeError(f"codex failed ({returncode}): {stderr.decode('utf-8', errors='replace')}")

      if not final_text.strip():
          final_text = "(no agent_message text)"
      return final_text, usage or {}


• Yes, with an important distinction:

  This code can parallelize work by spawning multiple codex exec processes concurrently. That is a viable Codex-
  only orchestration pattern if the codex CLI is already installed and authenticated on the machine. It still does
  not require an OpenAI API key in your code, and it does not require the Codex SDK.

  What it is not:

  - It is not using Codex’s in-session spawn_agent tool.
  - It is not a true shared-runtime multi-agent system unless the CLI itself exposes that internally.
  - It is an external supervisor pattern: your Python code launches multiple Codex CLI jobs.

  Bottom line

  Possible: yes.
  Good as written: not really.
  I would treat the current function as a fragile prototype.

  What the code is doing

  It runs:

  codex exec --experimental-json ...

  then:

  - sends a prompt on stdin
  - reads JSON events from stdout
  - extracts the last agent_message
  - extracts usage from turn.completed

  If you call run_codex(...) many times with asyncio.gather(...), you get parallel Codex workers.

  Example:

  results = await asyncio.gather(
      run_codex("Task A", cwd=repo_a),
      run_codex("Task B", cwd=repo_b),
      run_codex("Task C", cwd=repo_c),
  )

  That is the basic multi-agent pattern.

  Why I’m critical of the current version

  1. It assumes the JSON event schema is stable.
     --experimental-json is explicitly unstable. Hard-coding only item.completed -> agent_message and
     turn.completed is brittle.
  2. It only keeps the last agent_message.
     If Codex emits multiple assistant messages, tool summaries, or intermediate status items, you silently
     discard useful output.
  3. It can hang on stderr-heavy runs.
     You read stdout first and only read stderr after. If stderr fills its pipe buffer, the child can block.
  4. The timeout is applied too late.
     You wait for the process timeout only after finishing the stdout loop. If the process stalls before closing
     stdout, this can hang longer than intended.
  5. It does not handle malformed JSON lines.
     One bad line and the whole run crashes.
  6. It does not distinguish orchestration failure from model/task failure.
     A nonzero exit is treated uniformly, but in practice you want categories:

  - CLI not installed
  - auth/session expired
  - sandbox denial
  - model failure
  - timeout
  - invalid JSON stream

  7. It shares the parent environment blindly.
     env=os.environ.copy() may leak unrelated state and make runs non-reproducible.
  8. Parallel runs against the same repo are risky.
     If multiple Codex processes edit the same working tree, you will get collisions, inconsistent diffs, or
     corrupted assumptions.
  9. It returns too little structure.
     For orchestration, returning only final_text and usage is too weak. You usually need:

  - exit code
  - stderr
  - parsed events
  - duration
  - cwd
  - command
  - maybe raw transcript

  How I would adjust it

  1. Treat each Codex run as a worker job
  Define a richer result object.

  from dataclasses import dataclass
  from pathlib import Path
  from typing import Any, Optional

  @dataclass
  class CodexRunResult:
      final_text: str
      usage: dict[str, Any]
      events: list[dict[str, Any]]
      stderr: str
      returncode: int
      duration_s: float
      cwd: Path

  2. Read stdout and stderr concurrently
  This is the biggest technical fix.

  3. Apply timeout to the whole run
  Wrap the whole subprocess lifecycle in asyncio.wait_for(...), not just proc.wait().

  4. Make JSON parsing defensive
  Ignore or record non-JSON lines instead of crashing.

  5. Capture all assistant text, not only the last one
  Aggregate messages, then choose the final one if needed.

  6. Limit concurrency
  Use an asyncio.Semaphore so you do not start 20 Codex processes at once and destroy latency or local resources.

  7. Isolate file writes
  For coding tasks:

  - use separate cwds
  - or separate git worktrees
  - or read-only exploration in parallel, single-writer integration afterward

  This matters more than the Python details.

  8. Pass a minimal env
  Only keep what Codex actually needs.

  9. Add orchestration-level retries carefully
  Retry only on transport/runtime failures, not on bad task outputs.

  A more defensible version

  import asyncio
  import contextlib
  import json
  import os
  import shlex
  import time
  from dataclasses import dataclass
  from pathlib import Path
  from typing import Any, Optional

  MODEL = "..."
  SANDBOX = "..."
  APPROVAL = "..."
  WORKSPACE = Path("/path/to/workspace")
  CODEX_TIMEOUT_SECONDS = 300


  @dataclass
  class CodexRunResult:
      final_text: str
      usage: dict[str, Any]
      events: list[dict[str, Any]]
      stderr: str
      returncode: int
      duration_s: float
      cwd: Path


  async def run_codex(
      prompt: str,
      *,
      cwd: Optional[Path] = None,
      extra_args: Optional[list[str]] = None,
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
          **os.environ,
      }

      start = time.monotonic()
      proc = await asyncio.create_subprocess_exec(
          *cmd,
          stdin=asyncio.subprocess.PIPE,
          stdout=asyncio.subprocess.PIPE,
          stderr=asyncio.subprocess.PIPE,
          cwd=str(run_cwd),
          env=env,
      )

      assert proc.stdin and proc.stdout and proc.stderr

      events: list[dict[str, Any]] = []
      stderr_chunks: list[str] = []
      assistant_texts: list[str] = []
      usage: dict[str, Any] = {}

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
                      text = item.get("text", "")
                      if text:
                          assistant_texts.append(text)

              if event.get("type") == "turn.completed":
                  usage = event.get("usage")
                  if isinstance(usage, dict):
                      # last turn.completed wins
                      pass

      async def read_stderr() -> None:
          async for raw_line in proc.stderr:
              stderr_chunks.append(raw_line.decode("utf-8", errors="replace"))

      async def run_all() -> int:
          await asyncio.gather(write_prompt(), read_stdout(), read_stderr())
          return await proc.wait()

      try:
          returncode = await asyncio.wait_for(run_all(), timeout=CODEX_TIMEOUT_SECONDS)
      except asyncio.TimeoutError:
          proc.kill()
          with contextlib.suppress(Exception):
              await proc.wait()
          raise RuntimeError(
              f"codex timed out after {CODEX_TIMEOUT_SECONDS}s: "
              f"{' '.join(shlex.quote(x) for x in cmd)}"
          )

      stderr_text = "".join(stderr_chunks)
      duration_s = time.monotonic() - start

      if returncode != 0:
          raise RuntimeError(f"codex failed ({returncode}): {stderr_text}")

      final_text = assistant_texts[-1].strip() if assistant_texts else "(no agent_message text)"

      last_usage = {}
      for event in reversed(events):
          if event.get("type") == "turn.completed" and isinstance(event.get("usage"), dict):
              last_usage = event["usage"]
              break

      return CodexRunResult(
          final_text=final_text,
          usage=last_usage,
          events=events,
          stderr=stderr_text,
          returncode=returncode,
          duration_s=duration_s,
          cwd=run_cwd,
      )

  How to use it for actual parallelization

  Use a bounded worker pool:

  async def run_many(jobs, max_concurrency=3):
      sem = asyncio.Semaphore(max_concurrency)

      async def one(job):
          async with sem:
              return await run_codex(job["prompt"], cwd=job.get("cwd"))

      return await asyncio.gather(*(one(job) for job in jobs))

  How I would structure the jobs

  Do not send three agents into the same writable repo unless one of these is true:

  - they are read-only
  - each owns a different worktree
  - each owns a disjoint file set and you accept merge work

  A better pattern:

  1. Parallel explorers:
      - find relevant files
      - identify risks
      - propose patch plans
  2. Parallel implementers in isolated worktrees:
      - worker A edits auth
      - worker B edits tests
      - worker C updates docs
  3. Main integrator:
      - reviews outputs
      - cherry-picks or reapplies clean diffs
      - runs final verification

  What I would change at the orchestration level

  Your function alone is not enough. You also need:

  1. A job spec

  @dataclass
  class Job:
      name: str
      prompt: str
      cwd: Path
      read_only: bool = False

  2. Role-specific prompting
     Each worker prompt should include:

  - task scope
  - owned files
  - forbidden files
  - expected output format
  - whether to modify files or only analyze

  3. Separate workspaces
     For editing, use git worktree add or cloned temp dirs.
  4. Structured result contracts
     Ask Codex to end with machine-readable output, for example:

  FINAL_STATUS: success
  CHANGED_FILES:
  - path/a.py
  - path/b_test.py
  SUMMARY:
  ...

  Without that, your supervisor has to infer too much from free text.

  Can this replace built-in spawn_agent?

  Partially.

  What this approach gives you:

  - parallel Codex jobs
  - no SDK
  - no direct API usage
  - full control from Python

  What it does not give you:

  - shared agent lifecycle semantics from the Codex host runtime
  - cheap in-session delegation
  - native inter-agent messaging
  - built-in context fork behavior

  So yes, this is a workable fallback, but it is cruder than native multi-agent tools.

  My judgment

  Use it if:

  - you want practical parallelism today
  - you already have codex CLI available
  - you can isolate workers safely

  Do not use it unchanged because:

  - it is too brittle for long-running or large-scale orchestration
  - it does not safely handle concurrency, I/O, or repo collisions
  - it assumes too much about an experimental output format

  Best-practice adjustment in one sentence

  Turn this from “run one Codex CLI and scrape the last message” into “run isolated Codex workers with bounded
  concurrency, concurrent pipe draining, defensive event parsing, structured outputs, and single-writer
  integration.”

  If you want, I can next show either:

  1. a complete MultiCodexOrchestrator class around this function, or
  2. a concrete design for running 3-5 Codex workers safely on one git repository.
  
  
› Explain how to implement spawn_agent without using OpenAI API keys. Just codex cli authenticaiton.

• You do not implement the real built-in spawn_agent primitive yourself without platform support. What you can
  implement is a spawn_agent-like supervisor on top of codex CLI, using the CLI’s existing authentication session
  instead of OpenAI API keys.

  That is the practical answer.

  What “no API key” means here

  Your Python code does not call OpenAI directly. It only launches:

  codex exec ...

  The codex CLI is already authenticated, so each child process inherits that auth context from the local machine.
  Your code is only a local orchestrator.

  What your spawn_agent implementation really is

  It should do 4 things:

  1. Start a new codex exec process asynchronously.
  2. Give that process a bounded task prompt.
  3. Track its lifecycle by an agent ID.
  4. Let the parent wait, poll, send more input if supported, and collect results.

  So your custom spawn_agent is not a model API call. It is a process manager.

  Architecture

  Use these pieces:

  - spawn_agent(...):
    launches a background codex exec subprocess and returns an ID
  - wait(agent_ids):
    waits for one or more subprocesses to finish
  - send_input(agent_id, ...):
    only possible if you keep the subprocess interactive and the CLI supports continued stdin-driven interaction
    cleanly; often easier to treat agents as single-shot jobs
  - close_agent(agent_id):
    terminates or cleans up finished subprocesses

  Minimal design

  from dataclasses import dataclass, field
  from pathlib import Path
  from typing import Optional, Any
  import asyncio
  import os
  import json
  import uuid

  @dataclass
  class AgentHandle:
      id: str
      name: str
      prompt: str
      cwd: Path
      proc: asyncio.subprocess.Process
      stdout_lines: list[str] = field(default_factory=list)
      stderr_lines: list[str] = field(default_factory=list)
      events: list[dict[str, Any]] = field(default_factory=list)
      final_text: Optional[str] = None
      status: str = "running"

  A simple manager

  class CodexAgentManager:
      def __init__(self, model: str, sandbox: str, approval: str, workspace: Path):
          self.model = model
          self.sandbox = sandbox
          self.approval = approval
          self.workspace = workspace
          self.agents: dict[str, AgentHandle] = {}

      async def spawn_agent(
          self,
          prompt: str,
          *,
          name: Optional[str] = None,
          cwd: Optional[Path] = None,
          extra_args: Optional[list[str]] = None,
      ) -> str:
          agent_id = str(uuid.uuid4())
          cmd = [
              "codex",
              "exec",
              "--experimental-json",
              "--model", self.model,
              "--sandbox", self.sandbox,
              "--config", self.approval,
              "--skip-git-repo-check",
          ]
          if extra_args:
              cmd.extend(extra_args)

          proc = await asyncio.create_subprocess_exec(
              *cmd,
              stdin=asyncio.subprocess.PIPE,
              stdout=asyncio.subprocess.PIPE,
              stderr=asyncio.subprocess.PIPE,
              cwd=str(cwd or self.workspace),
              env=os.environ.copy(),
          )

          handle = AgentHandle(
              id=agent_id,
              name=name or agent_id,
              prompt=prompt,
              cwd=cwd or self.workspace,
              proc=proc,
          )
          self.agents[agent_id] = handle

          asyncio.create_task(self._run_agent(handle))
          return agent_id

      async def _run_agent(self, handle: AgentHandle) -> None:
          proc = handle.proc
          assert proc.stdin and proc.stdout and proc.stderr

          async def write_prompt():
              proc.stdin.write(handle.prompt.encode("utf-8"))
              await proc.stdin.drain()
              proc.stdin.close()

          async def read_stdout():
              async for raw_line in proc.stdout:
                  line = raw_line.decode("utf-8", errors="replace").strip()
                  if not line:
                      continue
                  handle.stdout_lines.append(line)
                  try:
                      event = json.loads(line)
                      handle.events.append(event)
                      if (
                          event.get("type") == "item.completed"
                          and event.get("item", {}).get("type") == "agent_message"
                      ):
                          handle.final_text = event["item"].get("text", "")
                  except json.JSONDecodeError:
                      pass

          async def read_stderr():
              async for raw_line in proc.stderr:
                  handle.stderr_lines.append(raw_line.decode("utf-8", errors="replace"))

          try:
              await asyncio.gather(write_prompt(), read_stdout(), read_stderr())
              rc = await proc.wait()
              handle.status = "completed" if rc == 0 else "failed"
          except Exception:
              handle.status = "failed"
              raise

      async def wait(self, agent_ids: list[str]) -> dict[str, str]:
          while True:
              statuses = {aid: self.agents[aid].status for aid in agent_ids}
              if all(s in ("completed", "failed") for s in statuses.values()):
                  return statuses
              await asyncio.sleep(0.2)

      def result(self, agent_id: str) -> dict[str, Any]:
          h = self.agents[agent_id]
          return {
              "id": h.id,
              "name": h.name,
              "status": h.status,
              "final_text": h.final_text,
              "stderr": "".join(h.stderr_lines),
              "events": h.events,
          }

  Usage

  manager = CodexAgentManager(
      model=MODEL,
      sandbox=SANDBOX,
      approval=APPROVAL,
      workspace=WORKSPACE,
  )

  a1 = await manager.spawn_agent(
      "Find where authentication middleware is configured. Do not edit files."
  )
  a2 = await manager.spawn_agent(
      "Find all tests covering session expiry. Do not edit files."
  )
  a3 = await manager.spawn_agent(
      "Inspect config loading flow and summarize env vars used. Do not edit files."
  )

  await manager.wait([a1, a2, a3])

  print(manager.result(a1)["final_text"])
  print(manager.result(a2)["final_text"])
  print(manager.result(a3)["final_text"])

  That is the core spawn_agent pattern.

  Critical limitations

  This is where people get sloppy. The hard part is not spawning. The hard part is making it reliable.

  1. This is process-level parallelism, not native agent orchestration.
     Each “agent” is just a separate codex exec subprocess.
  2. Shared-repo editing is dangerous.
     If multiple agents edit the same working tree, you will get conflicting changes and invalid assumptions.
  3. send_input is usually weak or impractical.
     If codex exec is single-shot, you cannot really continue the conversation with that same subprocess in a
     robust way. In practice, respawn a new agent with prior context.
  4. --experimental-json may change.
     Your parser must be defensive.
  5. CLI auth must already exist.
     Your code is not authenticating; it is piggybacking on codex CLI login state.

  How to make it production-worthy

  If you actually want a useful spawn_agent, add these.

  1. Give each agent an isolated workspace
  For editing tasks, use separate git worktrees.

  Example strategy:

  - parent repo: integration only
  - worker A: /tmp/worktrees/task-a
  - worker B: /tmp/worktrees/task-b

  That avoids file collisions.

  2. Restrict each agent’s scope
  Every prompt should state:

  - owned files
  - forbidden files
  - read-only vs edit allowed
  - required output format

  Example:

  You own only:
  - src/auth/*
  - tests/auth/*

  Do not modify any other files.
  Return:
  FINAL_STATUS:
  CHANGED_FILES:
  SUMMARY:

  3. Bound concurrency
  Do not run 10 agents at once unless you have a reason. Use a semaphore.

  4. Capture structured outputs
  Do not rely only on prose. Require a parseable footer.

  5. Separate roles
  Use:

  - explorers for read-only analysis
  - workers for isolated edits
  - integrator for final merge

  Why this works without API keys

  Because your code never talks to OpenAI services directly. The codex binary does. If the CLI is already logged
  in, your subprocesses inherit that authenticated capability.

  So the model is:

  your orchestrator -> local codex CLI subprocesses -> Codex-authenticated backend

  No API key appears in your Python code.

  What I would not claim

  I would not claim this is “the same as OpenAI’s internal spawn_agent tool.” It is an emulation layer. Good
  enough for parallel Codex work, but not the same primitive.

  Practical recommendation

  Implement only these methods first:

  1. spawn_agent(prompt, cwd, extra_args=None) -> agent_id
  2. wait(agent_ids) -> statuses
  3. result(agent_id) -> structured result
  4. close_agent(agent_id)

  Skip interactive send_input initially. Stateless agents are much easier to make reliable.

  If you want, I can write a complete CodexAgentManager module with:

  1. bounded concurrency,
  2. timeout handling,
  3. git worktree isolation,
  4. and a simple spawn_agent / wait / result API.
  
  
› How to use the real OpenAI’s internal spawn_agent tool with Codex CLI, without the API keys. Using current
  authenticaiton method.
  
• You generally cannot use the real built-in spawn_agent tool directly from plain codex CLI just because you are
  logged in.

  The critical distinction is:

  - codex login authenticates the CLI session.
  - spawn_agent is not an auth feature. It is a host-exposed tool feature.
  - If the runtime hosting Codex does not inject that tool, CLI login alone does not make it appear.

  What the local CLI exposes right now

  - codex exec
  - codex resume
  - codex fork
  - codex mcp-server
  - codex app-server
  - JSON output via codex exec --json

  What it does not expose

  - no codex spawn-agent
  - no CLI flag that enables an internal spawn_agent tool
  - no documented subcommand for agent lifecycle management

  So the answer is:

  No, not from stock codex CLI alone, based on the currently exposed commands.

  How the real internal spawn_agent is actually used

  - It works in a host environment that provides tool injection to the model/runtime.
  - That host handles authentication and permissions.
  - The model can then call spawn_agent because the tool exists in that session.

  Examples of such environments:

  - a specialized Codex host/runtime
  - an internal orchestration environment
  - a product surface that explicitly exposes multi-agent tools

  Why current authentication is not enough
  Your current auth method, likely codex login --device-auth, proves identity for the CLI. It does not grant
  arbitrary access to hidden internal tools. Authentication and tool availability are separate concerns.

  What you can do with plain CLI instead
  You have three realistic options:

  1. Emulate spawn_agent

  - launch multiple codex exec --json subprocesses in parallel
  - track them yourself
  - treat each subprocess as a worker

  2. Use fork and resume

  - useful for branching conversation state
  - not a replacement for programmatic multi-agent orchestration

  3. Use mcp-server or app-server

  - only if you build or use a host that can orchestrate Codex sessions
  - this is the closest route to a real tool-driven environment, but it is not “CLI alone”

  Be critical about bad assumptions
  Bad assumption: “If Codex is authenticated, I can call any internal OpenAI tool.”

  - False.

  Bad assumption: “fork means multi-agent orchestration.”

  - False. It forks session history; it is not the same as spawn_agent.

  Bad assumption: “There must be a hidden flag to unlock spawn_agent.”

  - There is no evidence of that in the current CLI surface.

  Practical conclusion
  If your requirement is:

  - no API keys
  - current Codex CLI authentication
  - plain CLI only

  then you should build a spawn_agent-like supervisor around parallel codex exec processes. That is feasible.

  If your requirement is:

  - the actual built-in OpenAI internal spawn_agent tool

  then you need a Codex host environment that exposes that tool. CLI login by itself is not sufficient.

  If you want, I can show the exact architecture for a spawn_agent clone built on top of:

  1. codex exec --json
  2. codex fork
  3. isolated git worktrees for safe parallel edits.  


codex resume 019cd15e-966a-7341-a58e-6b0fc2a80f82