You protect it from drift by reducing how much each agent is allowed to interpret.

The core rule is: every boundary in the system must become a contract, and every contract must be checked by code, not by prose. Your current prompt already moves in that direction, but full drift resistance requires tightening these areas:

**1. Lock the planner into a real schema**
The planner is the main drift source. If it drifts, every downstream agent drifts with it.
Protect it by requiring:
- one exact JSON schema version
- strict field enums where possible
- regex validation for path fields
- no free-text in machine-consumed fields
- explicit nullable fields instead of omitted meaning
- rejection on unknown fields

If the planner can invent extra structure or vague strings, drift starts there.

**2. Make ownership executable, not advisory**
“Owned paths” should not just be written in prompts. They should be enforced after each worker run.
Protect it by:
- diffing workspace before/after every step
- rejecting writes outside allowed paths
- rejecting deletions unless preapproved
- freezing shared contract files except in the stage that owns them

This prevents worker scope drift and accidental cross-agent interference.

**3. Separate narrative fields from enforcement fields**
A major drift pattern is when descriptive text becomes validation logic.
Protect it by splitting:
- human summary fields
- machine enforcement fields

For example:
- `summary`: prose allowed
- `required_outputs`: paths only
- `routes_expected`: normalized route specs only
- `checks_required`: typed check objects only

Never let prose be reused as a validator input.

**4. Use canonical normalization layers**
A lot of drift is “same thing, different representation.”
Protect it by defining one shared normalization function for:
- file paths
- routes
- query params
- mount prefixes
- parameter syntax
- headings/section titles
- command forms

The planner, orchestrator, and verifier must all use the same normalizers. Otherwise each stage develops its own interpretation drift.

**5. Turn validators into typed evidence collectors**
Validation should answer: what exact evidence proves this requirement?
Protect it by defining checks like:
- `file_exists`
- `path_owned_by_role`
- `route_family_present`
- `build_command_succeeds`
- `http_healthcheck_passes`
- `sql_contains_table`
- `ts_exports_symbol`

Each check should produce structured evidence, not just pass/fail prose. That reduces validator drift and repair-loop drift.

**6. Make repair loops field-targeted**
Generic “please fix the plan” requests cause drift amplification.
Protect it by requiring repair messages like:
- schema version
- offending field path
- validator rule violated
- actual value
- expected shape
- retry count

Then the repair agent fixes one defect class at a time instead of regenerating the whole plan loosely.

**7. Version all contracts**
Without versioning, agents may follow different assumptions.
Protect it by versioning:
- planner schema
- worker output schema
- manifest schema
- validation rule schema
- contract file format

Every stage should refuse incompatible versions instead of guessing.

**8. Minimize hidden memory**
Agents drift when they rely on chat history or unstated assumptions.
Protect it by ensuring each worker receives only:
- task packet
- owned paths
- dependencies
- contract artifacts
- allowed outputs
- required output schema

If a fact is not in the packet or shared state, it should not be relied on.

**9. Classify failures before retrying**
Blind retries create infrastructure drift and duplicate work.
Protect it by separating:
- infra failure
- schema failure
- validation failure
- ownership violation
- build failure
- runtime failure

Only retry infra failures automatically. Everything else should go through targeted repair.

**10. Add merge gates before final acceptance**
Final drift often appears at integration, not generation.
Protect it by requiring:
- no overlapping ownership violations
- merged manifest matches expected outputs
- contracts still satisfied after merge
- build still passes after merge
- runtime checks still pass after merge

This prevents “locally valid, globally broken.”

**11. Reduce prompt freedom for worker roles**
Workers should not receive broad goals like “build the feature.”
Protect them with packets that specify:
- exact files they may edit
- exact outputs expected
- exact interfaces they must satisfy
- exact format for reporting completion

The less they improvise, the less they drift.

**12. Accept that prompt-only protection is not enough**
This is the main point: prompt rules reduce drift, but only enforcement code prevents drift.
Real protection comes from:
- schemas
- parsers
- diff enforcement
- manifests
- typed validators
- explicit repair protocol
- merge gates

So the right design principle is:

Prompt for intention.
Code for enforcement.
Validate at every boundary.

If you want, I can next give you a concrete “anti-drift architecture checklist” for this exact 6-agent system, stage by stage, without editing any files.
