# pi-advice Implementation Plan

## Status and authority

This is the authoritative implementation plan for the initial `pi-advice` extension.

- The product and architecture decisions recorded here are approved.
- The extension has not yet been implemented.
- This plan does not authorize implementation by itself. Begin implementation only after the user explicitly assigns execution.
- Do not publish to npm or push Git repositories as part of this plan.

## Amendment 1 — Safe pending-message restriction (Option B)

Verified against Pi 0.82.1: after each awaited `turn_end` handler, Pi refreshes
the next low-level turn's model, thinking, and tools from live agent state
(`prepareNextTurn`), and only then emits `message_start` for the next drained
steering message. Switching the model in `message_start` cannot affect that
same turn, and the public extension API does not expose which message will
drain next. Exact FIFO advisor activation *behind* earlier queued steering
messages therefore cannot be made fail-closed without an upstream Pi capability.

The user approved a safe behavioral restriction rather than an upstream change:

- **Manual `/advice`:** if `ctx.hasPendingMessages()` is true, reject the request
  with a concise message and do not queue an advisor prompt. The user can retry
  once the queued steering work has drained.
- **Automatic schedule:** at the turn threshold, if messages are pending,
  saturate the counter at the threshold and defer; trigger as soon as the
  steering queue is empty.
- When advice **is** accepted, snapshot the advisee and activate the advisor
  (set model/thinking/tools) **before** the advisor prompt is queued, so the
  next-turn snapshot captures the advisor. Delivery is chosen by agent idle
  state at send time: an idle agent sends the advisor prompt immediately; a
  streaming agent queues it as steering. The advisee's in-flight turn finishes
  under the advisee and is recognized by controller phase (not `ctx.model`); it
  does not count and does not trigger advisor handling.
- Restoration happens during the advisor's final `turn_end`, before Pi's
  next-turn snapshot, so the continuation turn captures the restored advisee.

This supersedes the earlier "do not switch models until this extension's advice
user message is the next message being delivered" wording and the
`Starting with earlier steering messages` FIFO-detection approach below, and
resolves the `turn_end` snapshot and FIFO fail-closed stop conditions for V1.

## Objective

Create a standalone Pi extension package that lets an **advisee** model temporarily hand the active conversation to a configured **advisor** model for a focused review, then automatically hands control back so the advisee continues the work using that advice.

The package must expose:

- `/advice [optional context]`
- `/advice --tools [optional context]`
- `/advice-every <positive integer> [optional context]`
- `/advice-every <positive integer> --tools [optional context]`
- `/advice-every off`

The extension is primarily intended for interactive Pi use:

- `/advice` is the manual recovery mechanism when an advisee appears stuck, misguided, or in need of a push.
- `/advice-every` is primarily useful during autonomous, long-running work, such as a worker executing a plan. It periodically interrupts the advisee at safe Pi steering boundaries, obtains advisor guidance, and pushes the advisee back into execution.

Both commands must finish their advice cycle by promoting continuation from the advisee. The advisor response is not the final user-facing outcome of the cycle.

## Terminology

Use these terms consistently in source, tests, and documentation:

- **Advisor:** the configured smarter model temporarily reviewing the work.
- **Advisee:** the model active when an advice cycle takes control and the model restored afterward.
- **Advice cycle:** advisor activation, advice request, any permitted advisor tool loop, advisor response, advisee restoration, and promoted advisee continuation.
- **Automatic schedule:** the `/advice-every` interval, tool permission, optional context, and progress counter.
- **Low-level Pi turn:** one assistant model response plus the tool calls and tool results belonging to that response. This corresponds to Pi's `turn_end` event, not to a complete user/agent exchange.

Avoid “smart model,” “dumb model,” “default agent,” or similar terms in public package documentation when the precise advisor/advisee terms apply.

## Approved behavior

### Manual advice

Bare `/advice` is valid. It uses the generic advisor prompt with tools unavailable.

Optional free-form text after `/advice` is additional context or focus for the advisor. It augments rather than replaces the generic prompt.

`/advice --tools` allows the advisor to use the advisee's active tool set. Text after `--tools` is optional additional context.

A manual advice request behaves like a regular Pi steering message:

1. If the advisee is idle and no earlier steering work is pending, begin the advice cycle immediately.
2. If the advisee is streaming, let its current response and already-issued tool calls finish.
3. Queue the advice request for delivery before a subsequent model call.
4. If `ctx.hasPendingMessages()` is true, reject the request with a concise message and do not queue anything. The user can retry once the queued steering work has drained (Option B).
5. Otherwise, snapshot the advisee and activate the advisor before queueing the advisor prompt, so the next-turn snapshot captures the advisor. Existing queued messages are never reordered or discarded.

A second `/advice` while an advice cycle is queued or active must be rejected with a concise explanation. The advisor must never recursively advise itself.

### Automatic advice

`/advice-every N` enables or replaces an automatic schedule. `N` must be a positive safe integer of at least `1`.

The interval counts low-level Pi turns from the advisee:

- Count every ordinary advisee `turn_end`, including responses that issue tool calls.
- Trigger after the Nth counted advisee turn has completed its tool calls and tool results.
- Insert the automatic advice request as a steering message before the advisee's next otherwise-unqueued model call.
- If messages are pending at the threshold, saturate the counter at the threshold and defer; trigger as soon as the steering queue is empty (Option B).
- Exclude all advisor turns from the interval.
- Exclude the extension-generated advisee continuation turn from the interval. Once that initial continuation turn completes, later autonomous advisee turns count normally.
- Manual `/advice` does not reset or otherwise change the automatic counter.

Reissuing `/advice-every N ...` replaces all previous automatic schedule fields and resets the counter to zero. This includes the interval, tool permission, and optional context.

`/advice-every off` disables future automatic cycles and clears the schedule and counter. If an advice cycle is already active, let that cycle finish; disabling the schedule must not strand the advisor or prevent advisee restoration.

Reconfiguring `/advice-every` during an active cycle takes effect after that cycle. Because advice-cycle turns are excluded, the replacement counter remains at zero until ordinary advisee work resumes.

### Advisor/advisee state transition

At the moment the advice request is ready to take control:

1. Resolve and validate the configured advisor model and its authentication.
2. Snapshot the current advisee model, thinking level, and exact active tool-name set.
3. Switch to the advisor model.
4. Apply the configured advisor thinking level.
5. Apply the cycle's tool policy.
6. Submit the visible advice prompt as a user message.

When the advisor finishes:

1. Restore the exact advisee model captured for this cycle.
2. Restore the advisee thinking level, allowing Pi's normal model-capability clamping.
3. Restore the exact active tool-name set.
4. Submit a visible continuation user message as steering input.
5. Let the advisee resume work rather than merely acknowledging or summarizing the advice.

Do not assume the advisee is Pi's configured default model. The advisee is whichever model is active when this particular advice request actually takes control. This matters when FIFO steering delays advisor activation.

Pi records model and thinking changes in normal session history. Preserve that accurate history; do not bypass or rewrite it.

### Advisor completion and tool loops

Without `--tools`, the advisor has no active tools. Its first finalized assistant response ends the advisor phase.

With `--tools`, the advisor may require multiple low-level turns:

- A response ending in tool use remains in the advisor phase.
- Tool results return to the advisor.
- The advisor phase ends on its final non-tool response.
- There is no hard numeric tool-call cap.
- Prompt guidance must strongly favor the minimum reasonable number of calls and a prompt return to the advisee.

Advisor failure, authentication loss, error, or abort must fail safely:

- Restore any advisee state already changed.
- Do not issue the advisee continuation prompt if no usable advisor response was produced.
- Notify the user concisely.
- Do not leave the session on the advisor model or with a temporary tool set.

A manual request that cannot validate the advisor must make no state change. If an automatic attempt fails before producing advice, leave the schedule enabled, reset its progress for that attempted interval, and wait a full interval before trying again; do not retry on every subsequent turn.

## Commands, parsing, and autocomplete

### `/advice`

Accepted forms:

```text
/advice
/advice focus on whether the current approach matches the plan
/advice --tools
/advice --tools inspect the relevant implementation before advising
```

Parsing rules:

- Bare `/advice` is valid generic advice.
- Recognize `--tools` as an option only in the leading option position.
- Treat all remaining text as opaque additional context; do not semantically parse it.
- If an unknown leading `--...` option is supplied, show helpful usage rather than silently treating it as context.

Autocomplete behavior:

- At the initial argument position, offer `--tools` with a concise description.
- Return `null` when no command-specific completion applies so Pi's normal completion behavior remains intact.

### `/advice-every`

Accepted forms:

```text
/advice-every 50
/advice-every 50 focus on correctness and overlooked risks
/advice-every 50 --tools
/advice-every 50 --tools inspect the relevant implementation first
/advice-every off
```

Parsing rules:

- The first token is either `off` or a positive integer.
- `off` must not accept trailing interval/context options; report misuse clearly.
- After an interval, recognize `--tools` in the immediate option position.
- Remaining text is optional opaque context.
- Reject zero, negative values, decimals, non-numeric intervals, unsafe integers, and unknown leading options.

Calling `/advice-every` without arguments, or with malformed arguments, must display concise usage plus representative examples. The message should show at least:

```text
/advice-every 50
/advice-every 50 focus on correctness and overlooked risks
/advice-every 50 --tools
/advice-every 50 --tools inspect the relevant implementation first
/advice-every off
```

Autocomplete behavior:

- At the first argument position, offer `off` with a description.
- After a valid interval and separating whitespace, offer `--tools` with a description.
- Filter completions using the current prefix and avoid inserting placeholder text as though it were literal syntax.

### User feedback

Provide concise notifications for:

- automatic schedule enabled/replaced;
- automatic schedule disabled;
- malformed command syntax;
- missing or invalid advisor configuration;
- unavailable advisor authentication;
- overlapping advice requests;
- an advice cycle that fails and restores the advisee.

Do not add verbose transcript entries for internal phase transitions or counters.

## Prompt contracts

Keep prompt constants centralized and directly testable. Additional context must be clearly delimited so it cannot accidentally replace the base contract.

### Base advisor prompt

The visible advisor user message must use second-person framing and direct the advisor to review the advisee's current work using the conversation already present in the session. It should require the advisor to:

- assess how the work is going;
- identify what the advisee is doing well;
- identify mistakes, weak assumptions, omissions, unnecessary work, risks, and better approaches;
- provide all materially useful guidance without padding or unnecessary verbosity;
- focus on helping the advisee proceed effectively;
- act as an advisor rather than taking over implementation;
- finish with a clearly labeled `Recommended next action for the advisee:` section.

The tone should encourage thoroughness without encouraging exhaustive or irrelevant output. A suitable durable formulation is “Include every materially useful point, but avoid padding, repetition, and unnecessary verbosity.”

### Tool-free reinforcement

For a cycle without `--tools`:

- Set the active tool list to empty before the advisor call.
- Explicitly tell the advisor not to call or request tools and to answer from the conversation context.

The prompt reinforcement is intentional even though tools are technically unavailable.

### Tool-enabled guidance

For a cycle with `--tools`:

- Preserve the advisee's active tool set for the advisor.
- Tell the advisor to use tools only when needed to improve the advice.
- Tell it to make the minimum reasonable number of tool calls needed to be effective.
- Tell it to return its advice promptly rather than expanding into open-ended investigation.
- Tell it not to modify the project, execute the plan, or perform the advisee's work. Tool access is for investigation supporting advice.

The no-modification rule is prompt-level. Do not claim that arbitrary extension tools have been technically sandboxed or classified as read-only.

### Additional context

When present, append a clearly labeled section such as:

```text
Additional focus supplied by the user:
<verbatim context>
```

Do not reinterpret the context as package configuration. In tool-enabled mode it may tell the advisor what to inspect, but it cannot override the core role boundary that the advisor advises rather than implements.

### Advisee continuation prompt

After restoration, inject a visible user message that tells the advisee to:

- continue the current work now;
- use the preceding advisor analysis to get back on track and improve its execution;
- exercise its own judgment rather than following advice blindly;
- take the next appropriate action instead of merely acknowledging or summarizing the advice;
- state clearly if no legitimate work remains rather than inventing work.

Both manual and automatic advice use this continuation behavior.

## Configuration

### Files and precedence

Load package-specific JSON configuration from:

1. `~/.pi/agent/pi-advice.json` (global)
2. `<cwd>/.pi/pi-advice.json` (project override)

Use Pi's exported `getAgentDir()` and `CONFIG_DIR_NAME` rather than hardcoding branded directory locations.

Read project configuration only when `ctx.isProjectTrusted()` is true. Merge project fields over global fields. Do not read untrusted project configuration.

Global example:

```json
{
  "provider": "openai-codex",
  "model": "gpt-5.6-sol",
  "thinkingLevel": "high"
}
```

Project override example:

```json
{
  "model": "gpt-5.6-terra"
}
```

The merged project example therefore keeps `openai-codex` and `high` while selecting `gpt-5.6-terra`.

### Schema

The initial public configuration surface is limited to:

```ts
interface AdviceConfig {
  provider: string;
  model: string;
  thinkingLevel?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
}
```

Behavior:

- Default `thinkingLevel` to `high` when omitted.
- Require non-empty `provider` and `model` after merging.
- Reject malformed JSON and wrong field types with a clear path-specific diagnostic.
- Ignore neither malformed values nor unavailable models silently.
- Do not add prompt customization, interval defaults, tool defaults, model fallbacks, or speculative settings in the initial version.
- Reload configuration during `session_start`, including `reason: "reload"`, so edits take effect after `/reload`.

Never place credentials in `pi-advice.json`. Authentication remains owned by Pi's model registry.

## Process-local automatic state

### Lifetime requirement

The active `/advice-every` schedule must survive extension re-evaluation caused by `/reload`, but it must not survive a Pi process restart or leak into another session.

Do not persist this authority using:

- `pi.appendEntry()`;
- session custom entries;
- files;
- environment variables;
- command arguments.

Those mechanisms have the wrong lifetime or visibility.

### Carrier architecture

Use a versioned process-global carrier based on:

```ts
globalThis[Symbol.for("pi-advice.schedule.v1")]
```

The stored shape should be small and contain no transcript bodies beyond the user's schedule context:

```ts
interface ProcessAdviceStateV1 {
  version: 1;
  schedule: null | {
    sessionId: string;
    every: number;
    tools: boolean;
    context: string;
    count: number;
  };
}
```

Requirements:

- Initialize malformed or absent global state to a safe disabled default.
- Reuse one stable object in place so freshly evaluated extension code observes the same state.
- Keep the current in-flight advice controller module-local; only the idle automatic schedule crosses reload.
- Validate `sessionId` before restoring schedule state.

This deliberately reuses the simple architecture pattern established by `pi-session-manager` authorization rather than inter-agent's expiring one-use mailbox handoff. `pi-advice` carries a small ongoing schedule, not message bodies requiring TTL, generation, or one-use consumption.

### Session lifecycle

- `session_shutdown` with `reason: "reload"`: retain schedule state.
- `session_start` with `reason: "reload"`: retain the schedule only when the session ID matches; reload config and rebind handlers/UI.
- `/new`, `/resume`, `/fork`, `/clone`, and non-reload shutdown: clear the schedule.
- Process exit naturally clears `globalThis` state.

Pi refuses built-in `/reload` while a response is streaming. Do not override that built-in behavior. When `/reload` is attempted during an active advice or advisee run, Pi displays its normal wait warning and no reload occurs. When idle reload succeeds, schedule interval, context, tool permission, and count must remain intact.

## Runtime controller and event sequencing

Implement an explicit, testable phase machine rather than scattered booleans. Suggested semantic phases are:

- `idle`
- `adviceQueued`
- `advisorActive`
- `continuationQueued`
- `adviseeContinuing`

Names may vary, but the invariants must not.

### Controller invariants

- At most one advice cycle exists at a time.
- Every activated cycle has one advisee snapshot.
- Advisor turns never increment the automatic counter.
- Advisee state restoration is idempotent and runs on every exit path after activation.
- No continuation is sent before a usable final advisor response.
- No second continuation is sent.
- Existing steering messages retain FIFO order.
- Internal extension-injected messages are identified by controller phase plus the exact stored prompt, not by fragile broad prefix matching.

### Starting while idle

When Pi is idle and no earlier steering work is pending:

1. Validate advisor config/model/authentication.
2. Snapshot the advisee and activate the advisor.
3. Send the advisor user message immediately; the run it starts captures the advisor configuration.

### Starting while streaming without an earlier queue

Extension commands execute immediately during streaming. For a manual request with no earlier pending messages:

1. Validate advisor availability.
2. Snapshot the advisee and activate the advisor (set model/thinking/tools) before queueing, so the next-turn snapshot captures the advisor.
3. Queue the advisor user message with `deliverAs: "steer"`.
4. Let the current advisee response and its tool batch finish; its `turn_end` is ignored by phase and does not count.
5. The queued advice message becomes the next user input and the advisor makes the next model call.

If the in-flight turn ends while activation is still in flight, the advisor prompt is simply sent once activation completes — immediately if the agent has since gone idle, or as a steer otherwise. Either way the advisor runs under the activated advisor configuration.

Pi documents that active-tool changes take effect on the next agent turn; do not interfere with already-issued tool execution.

### Starting with earlier steering messages (Option B)

If `ctx.hasPendingMessages()` is true before queuing manual advice, reject the request with a concise message and do not queue anything. The user can retry once the queued steering work has drained. Exact FIFO activation behind earlier queued steering messages is not attempted; see Amendment 1.

### Automatic threshold

On ordinary advisee `turn_end` while phase is `idle` and a schedule is active:

1. Increment the process-global counter.
2. If below `every`, stop.
3. At the threshold, reset progress for the completed interval and queue an automatic advice cycle.
4. Use the same FIFO and activation rules as manual advice.

Use the assistant message's recorded provider/model and controller phase when classifying turns. Do not rely only on `ctx.model`, because the active model may already have been changed in preparation for the next call.

### Advisor final response

On advisor `turn_end`:

- If the response requests tools and tools were enabled, remain `advisorActive`.
- If the response is a usable final response, restore the advisee and queue the continuation prompt as steering input.
- If it ends in error or abort, restore without continuation and report the failure.

If user steering messages arrived during the advisor cycle, preserve their order. Restore the advisee before any post-advisor queued user work can trigger another model call. The continuation prompt may follow earlier queued user messages; do not discard them to force continuation to the front.

### Continuation completion

The first advisee response triggered by the extension's continuation message is part of the advice cycle and does not count toward `/advice-every`. After that low-level turn completes, return the controller to `idle`. If that response called tools, subsequent autonomous advisee responses count normally.

### Restoration safety

Centralize restoration in one idempotent operation. It must:

- set the captured advisee model;
- restore thinking level;
- restore active tools;
- clear cycle-local phase/snapshot fields appropriately;
- tolerate being requested more than once;
- report restoration failures without concealing them.

Also invoke restoration defensively from relevant abort/error and non-reload shutdown paths when a cycle was activated. A force-killed process cannot be repaired; do not add filesystem persistence merely to cover that case.

## Package and repository structure

The implementation owner must make `pi-advice` resemble the other standalone Pi extension repositories in this superproject while keeping it independently installable and testable.

Expected package areas include:

```text
AGENTS.md
CHANGELOG.md
LICENSE.md
README.md
package.json
tsconfig.json
src/
  index.ts
  config.ts
  process-state.ts
  advice-controller.ts
tests/
  command.test.ts
  config.test.ts
  process-state.test.ts
  advice-controller.test.ts
```

The exact source split may be adjusted when cohesion improves, but do not put all parsing, configuration, persistence, event sequencing, and prompt logic into one untestable entrypoint. Conversely, do not introduce a framework or abstractions beyond this state machine's needs.

Package requirements:

- TypeScript extension entrypoint.
- `pi-package` keyword.
- `pi.extensions` manifest pointing to the source entrypoint.
- Pi-owned imports declared as `peerDependencies` using the package conventions documented by Pi.
- Test/build/typecheck/format-check scripts matching neighboring standalone packages.
- Runtime dependencies declared in the child package if any are introduced. Prefer Pi/Node APIs and avoid unnecessary dependencies.
- The child repository must remain usable outside the superproject.

Do not publish an npm package in this phase.

## README requirements

Document:

- the advisor/advisee concept;
- why `/advice` is useful for manually unsticking an advisee;
- why `/advice-every` is useful for autonomous, long-running plan execution;
- all command forms and examples;
- the low-level-turn meaning of the interval;
- tool-free versus `--tools` behavior;
- the investigation-only advisor boundary;
- global and trusted-project configuration with `gpt-5.6-sol`, `gpt-5.6-terra`, and `high` examples;
- reload-only schedule persistence and clearing on session replacement/process exit;
- helpful troubleshooting for missing configuration, model, or authentication;
- security note that extensions execute with user privileges and `--tools` exposes the active tool set.

Installation documentation must initially use GitHub/Pi package installation rather than claiming npm availability, for example:

```bash
pi install git:github.com/arcanemachine/pi-advice
```

Also document an appropriate temporary trial command if supported by the current Pi package docs, such as `pi -e git:github.com/arcanemachine/pi-advice`. Do not document a remote as available until the user has created/pushed it.

## Superproject integration

After the child implementation is complete and committed:

1. Add `./packages/pi-advice/src/index.ts` to the superproject root `package.json` `pi.extensions` array.
2. Add `pi-advice` to the root package list/documentation where neighboring extensions are listed.
3. Update the root lockfile through pnpm workspace operations when package metadata requires it.
4. Validate from `/workspace/projects/pi` without running the destructive root-wide formatter.
5. Commit the child repository first.
6. Commit the updated submodule pointer and root integration in the superproject second.
7. Do not stage or alter unrelated `pi-session-manager` worktree state.
8. Do not push.

## Required implementation reading

Before implementation, read these sources in full where Markdown guidance requires it and inspect the named source anchors before coding.

### Workspace and representative package conventions

- `/workspace/AGENTS.md`
- `/workspace/projects/pi/AGENTS.md`
- `/workspace/projects/pi/packages/pi-notify-marker/AGENTS.md`
- `/workspace/projects/pi/packages/pi-notify-marker/package.json`
- `/workspace/projects/pi/packages/pi-notify-marker/README.md`
- `/workspace/projects/pi/packages/pi-notify-marker/src/index.ts`
- `/workspace/projects/pi/packages/pi-role/AGENTS.md`
- `/workspace/projects/pi/packages/pi-role/package.json`
- `/workspace/projects/pi/packages/pi-role/README.md`

Use neighboring repositories as structural inspiration, not as authority to copy unrelated features or dependencies.

### Pi documentation

- `/usr/local/share/npm-global/lib/node_modules/@earendil-works/pi-coding-agent/README.md`
- `/usr/local/share/npm-global/lib/node_modules/@earendil-works/pi-coding-agent/docs/extensions.md`
- `/usr/local/share/npm-global/lib/node_modules/@earendil-works/pi-coding-agent/docs/packages.md`
- `/usr/local/share/npm-global/lib/node_modules/@earendil-works/pi-coding-agent/docs/models.md`
- `/usr/local/share/npm-global/lib/node_modules/@earendil-works/pi-coding-agent/docs/settings.md`
- `/usr/local/share/npm-global/lib/node_modules/@earendil-works/pi-coding-agent/docs/sessions.md`
- `/usr/local/share/npm-global/lib/node_modules/@earendil-works/pi-coding-agent/docs/session-format.md`

### Pi examples and runtime anchors

- `/usr/local/share/npm-global/lib/node_modules/@earendil-works/pi-coding-agent/examples/extensions/commands.ts`
- `/usr/local/share/npm-global/lib/node_modules/@earendil-works/pi-coding-agent/examples/extensions/send-user-message.ts`
- `/usr/local/share/npm-global/lib/node_modules/@earendil-works/pi-coding-agent/examples/extensions/model-status.ts`
- `/usr/local/share/npm-global/lib/node_modules/@earendil-works/pi-coding-agent/examples/extensions/preset.ts`
- `/usr/local/share/npm-global/lib/node_modules/@earendil-works/pi-coding-agent/examples/extensions/reload-runtime.ts`
- `/usr/local/share/npm-global/lib/node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js` — inspect command execution, steering queueing, `turn_end`, model selection, tool activation, and user-message injection.
- `/usr/local/share/npm-global/lib/node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/runner.js` — inspect awaited extension handler sequencing and context binding.
- `/usr/local/share/npm-global/lib/node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/interactive-mode.js` — inspect extension command execution during streaming, autocomplete integration, and built-in reload guards.

### Reload precedent

- `/workspace/projects/inter-agent/integrations/pi/src/mailbox.ts` — inspect `createProcessGlobalHandoffCarrier()` only to understand the `globalThis[Symbol.for(...)]` precedent and why its complex one-use mailbox semantics are unnecessary here.
- `/workspace/projects/inter-agent/integrations/pi/tests/extension-mailbox.test.ts` — inspect same-process extension-instance restoration tests.
- `/workspace/projects/pi/packages/pi-session-manager/src/authorization.ts` — preferred simple stable, versioned process-global object pattern.
- `/workspace/projects/pi/packages/pi-session-manager/tests/authorization.test.ts` — module re-evaluation and stable-object tests.

If installed Pi paths change with an upgrade, locate the corresponding files in the active `@earendil-works/pi-coding-agent` installation rather than relying on stale copied behavior.

## Testing strategy

Tests must exercise behavior, not only helper functions.

### Command parsing and completion

Cover:

- bare `/advice`;
- `/advice <context>`;
- `/advice --tools` with and without context;
- malformed leading options;
- positive integer interval parsing;
- zero, negative, decimal, unsafe, missing, and non-numeric intervals;
- `/advice-every off`;
- rejection of malformed `off` usage;
- replacement/reset behavior;
- autocomplete suggestions for `--tools` and `off` at the correct token positions;
- helpful usage output containing the approved examples.

### Configuration

Cover:

- global-only configuration;
- trusted project override;
- untrusted project config ignored;
- partial project override retaining global provider/thinking level;
- omitted thinking level defaulting to `high`;
- malformed JSON;
- wrong field types;
- missing provider/model after merge;
- advisor model not found;
- missing authentication;
- config reloaded on `session_start` reason `reload`.

Do not include real credentials or make network calls.

### Process-global state

Cover:

- disabled default;
- enable, update counter, replace, and disable;
- stable object identity;
- persistence across `vi.resetModules()` or equivalent module re-evaluation;
- interval, tool flag, context, and count all survive reload;
- malformed symbol value fails safely to disabled;
- matching session ID retained on reload;
- session mismatch cleared;
- non-reload session shutdown clears;
- no session entry or file persistence used.

### Advice controller

Use a deterministic fake Pi/extension harness or focused integration fixture to cover:

- idle manual tool-free advice;
- streaming manual advice queued as steering;
- current advisee tool results complete before advisor call;
- advisor model/high thinking selection;
- exact advisee model/thinking/tools restoration;
- tool-free mode activates an empty tool set and includes prompt reinforcement;
- tool-enabled mode retains the active tool set and includes minimal-tool/no-modification guidance;
- advisor tool call followed by tool result and final advisor response;
- continuation generated only after final advisor output;
- continuation runs under the restored advisee;
- continuation tells the advisee to act, not merely acknowledge;
- overlapping advice rejected;
- failure before activation leaves advisee untouched;
- failure/abort after activation restores advisee and sends no continuation;
- restoration is idempotent;
- user steering messages queued before advice retain FIFO order and stay with the advisee;
- user steering messages arriving during advisor work are not lost and run under the restored advisee;
- model classification uses recorded assistant metadata rather than only mutable current context.

### Automatic cadence

Cover:

- every advisee low-level turn counts, including tool-calling responses;
- trigger occurs after the configured Nth turn's tool results;
- advisor turns do not count;
- extension-generated continuation turn does not count;
- later autonomous advisee turns resume counting;
- manual advice does not reset the automatic counter;
- reconfiguration resets the counter;
- `off` clears it;
- disabling or reconfiguring during a cycle has the approved deferred effect;
- failed automatic advice waits a full new interval;
- automatic advice respects FIFO steering order;
- `--tools` and context persist as schedule attributes and are applied to every automatic cycle.

### Reload and session lifecycle

Cover the extension-owned behavior:

- idle reload retains schedule state and progress under a new module instance;
- reload reloads advisor configuration;
- new/resume/fork/non-reload shutdown clears the schedule;
- an active cycle is not serialized into session history as extension authority.

Pi's built-in refusal to reload during streaming is upstream behavior. Do not duplicate Pi's entire interactive-mode test; document the dependency and test only extension behavior around idle reload.

## Validation

The implementation owner must identify the child package's exact scripts after creating its package metadata, then run at least:

- package formatting check;
- package typecheck;
- package test suite;
- package build if a build script is present;
- `git diff --check` in the child;
- focused superproject workspace validation for `pi-advice` from `/workspace/projects/pi`;
- root integration checks appropriate to the changed root manifest/lockfile.

Do not run `/workspace/projects/pi`'s root-wide formatter for this package task because it rewrites unrelated submodules.

A change remains unverified until exercised against a running Pi session. After automated checks pass, run an interactive acceptance session with a controllable small interval and verify:

1. Bare `/advice` visibly invokes the configured advisor without tools and automatically returns to an acting advisee.
2. `/advice` entered during streaming waits for the current tool batch and steers at the next appropriate FIFO boundary.
3. Existing queued steering messages are not reordered or answered by the advisor.
4. `/advice --tools` permits a short evidence-gathering tool loop, does not modify the project, and returns promptly.
5. `/advice-every 2` counts low-level autonomous turns and triggers automatically.
6. `/advice-every 2 --tools <context>` carries its tool permission and focus into automatic cycles.
7. `/reload` while idle preserves interval, context, tool permission, and partial count.
8. `/advice-every off` disables future automatic advice.
9. Model, thinking level, and tools are restored exactly after success and after an induced advisor failure or abort.
10. Autocomplete and malformed-command guidance match the approved command forms.

Because this is user-facing behavior, present the observed acceptance surface to the user and obtain explicit user approval or waiver before final integration/closeout.

## Implementation sequence

1. Read the required sources and check current child/superproject status without altering unrelated work.
2. Create package governance and metadata files (`AGENTS.md`, license, package manifest, TypeScript/test configuration) using neighboring standalone packages as structural references.
3. Implement and test configuration loading/merging independently.
4. Implement and test the versioned process-global automatic schedule carrier independently.
5. Implement command parsers, usage text, and autocomplete with focused tests.
6. Implement centralized prompt builders and snapshot-test their material contracts without brittle full-prose tests where unnecessary.
7. Implement the advice controller phase machine and restoration logic against a fake extension harness.
8. Register commands and lifecycle/model/message/turn handlers in the extension entrypoint.
9. Add automatic counting, FIFO steering activation, advisor tool-loop handling, and promoted continuation.
10. Add reload/session cleanup behavior and failure-path tests.
11. Write README, changelog, and security/installation guidance.
12. Run child automated validation and inspect all diffs.
13. Commit the verified child implementation.
14. Integrate the extension path and documentation in the superproject, update the workspace lockfile as needed, and run focused root validation.
15. Exercise the extension in a running Pi session and request explicit user acceptance of the observed behavior.
16. After acceptance, commit verified superproject integration if it was intentionally held for the user-facing gate; otherwise follow the active execution workflow's accepted commit sequencing. Never push.

## Stop conditions

Stop and return to the user rather than improvising if:

- the current Pi version cannot switch the next steered model call at the documented/verified event boundary;
- activating the advisor only when its FIFO message is delivered cannot be made fail-closed;
- exact advisee model/thinking/tool restoration conflicts with Pi runtime behavior;
- a dependency or framework beyond Pi's existing APIs is proposed;
- configuration requires credentials or introduces a new trust mechanism;
- implementing `--tools` requires claiming a technical read-only sandbox that cannot actually be enforced;
- command syntax must change materially from the approved forms;
- reload persistence would require session/file persistence rather than process-local state;
- tests expose that advice or continuation turns cannot be distinguished reliably without changing visible behavior;
- unrelated dirty submodule state would need to be staged, reset, or overwritten;
- user-facing acceptance fails or the user requests a behavioral change.

## Completion criteria

The initial implementation is complete only when:

- every approved command form works and has contextual Pi autocomplete;
- malformed `/advice-every` input provides helpful usage examples;
- advisor configuration merges correctly from global and trusted project files;
- manual advice steers safely during autonomous work;
- automatic advice counts low-level advisee turns and interrupts at safe FIFO boundaries;
- tool-free advice technically disables tools and reinforces that constraint;
- tool-enabled advice uses the active tool set minimally for investigation without taking over implementation;
- the advisor produces a final recommended next action;
- the advisee is restored exactly and automatically continues acting;
- overlap, failure, abort, and queued-message paths lose no user messages and strand no temporary state;
- `/advice-every` state survives idle `/reload` but not session replacement or process restart;
- package structure, documentation, installation guidance, and repository independence match the superproject's standalone extension conventions;
- automated checks pass;
- interactive behavior is exercised and explicitly accepted by the user or waived;
- child and superproject commits contain only `pi-advice` work;
- nothing is pushed.
