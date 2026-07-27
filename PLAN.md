# pi-advice Completion Plan

## Status and authority

This file is the authoritative execution plan for completing the initial
`pi-advice` extension.

The user has explicitly approved:

- continuing implementation after this plan is committed and the conversation
  is supercompacted;
- replacing the old plan with this plan;
- renaming the public commands from `/advice` and `/advice-every` to `/advise`
  and `/advise-every`;
- presenting the injected review and continuation instructions as hidden custom
  messages rather than visible user messages;
- showing only a concise notification when a review begins;
- making the model-switch cycle read as one assistant reconsidering its own work,
  not as a conversation between an advisor and an advisee;
- the safe pending-message compromise: reject manual review when earlier
  steering messages are pending and defer automatic review until pending
  steering work has drained;
- support for Pi's default `one-at-a-time` steering mode only. The non-default
  `all` steering mode is explicitly unsupported because Pi 0.82.1 does not
  expose the active steering drain mode through the public extension context;
- child-first follow-up commits;
- resuming implementation immediately after supercompaction without requesting
  another implementation approval.

The user's prompt changes are already committed and pushed in the child
repository. Start from that clean child baseline. Do not amend or rewrite pushed
history. Implement the remaining work in new follow-up commits.

Do not push or publish. The user controls pushes.

## Objective

Complete a standalone Pi extension package that temporarily changes the model
used by the current conversation, asks that model to reconsider the assistant's
own ongoing work, restores the previous model and runtime state, and invisibly
prompts the restored model to continue from the resulting realization.

The user-facing experience should feel like one assistant pausing, having a
better idea, and continuing—not like an explicit handoff to another agent.

The package remains named `pi-advice`. Configuration files, package identifiers,
repository names, process-global symbol names, and the noun “advice” remain
unchanged unless a specific item below says otherwise.

The public commands become:

```text
/advise [optional focus]
/advise --tools [optional focus]
/advise-every <positive integer> [optional focus]
/advise-every <positive integer> --tools [optional focus]
/advise-every off
```

Remove the old `/advice` and `/advice-every` commands. Do not retain aliases or
backward-compatibility shims.

## Current repository state and boundaries

At the time this plan is written:

- the child repository is clean and its `main` branch matches its remote;
- the child contains an initial implementation with known correctness defects;
- the user's latest prompt changes are committed;
- the superproject already registers `./packages/pi-advice/src/index.ts` and
  lists `pi-advice` in its README;
- the superproject working tree shows the newer child commit through a modified
  `packages/pi-advice` gitlink;
- the superproject also has unrelated `packages/pi-session-manager` and
  `pnpm-lock.yaml` state;
- the superproject is ahead of its remote from earlier local commits.

Never stage, reset, overwrite, or otherwise disturb the unrelated
`packages/pi-session-manager` state or its unstaged lockfile importer hunk.

Do not run the superproject-wide formatter.

## Non-negotiable runtime facts

Implementation and tests must honor the verified Pi 0.82.1 ordering:

1. A newly started agent run captures the current model, thinking level, system
   prompt, and tools when Pi creates its loop configuration/context snapshot.
2. During an existing run, an assistant response and all tool results belonging
   to that response finish before `turn_end` is emitted.
3. Pi awaits extension `turn_end` handlers.
4. Pi then runs `prepareNextTurn` and refreshes the next low-level turn from
   live agent state.
5. Only after that snapshot is frozen does Pi drain queued steering messages and
   emit their `message_start` events.
6. The provider call uses the already-frozen loop model and tool context.

Consequences:

- `message_start` is too late to switch the model or tools for that same turn;
- the review model must be activated before the hidden review message is queued;
- restoration during the review model's final `turn_end` happens before Pi
  snapshots the continuation turn, so it is the correct restoration boundary;
- the currently streaming assistant turn retains its already-frozen model and
  tools even when live agent state is changed in preparation for the next turn;
- a test harness that changes the model at `message_start` is invalid;
- a test harness must distinguish live agent state from the frozen loop snapshot
  used by the current assistant turn.

Pi's `_queueSteer()` enqueues synchronously before yielding. After an async
activation completes, the final pending-message check and the subsequent
`pi.sendMessage()` call may therefore be treated as one synchronous
check-and-enqueue boundary. Do not insert an `await` between the final check and
message injection.

## User-facing transcript design

### Hidden control messages

Replace visible `pi.sendUserMessage()` calls for the extension's review request
and continuation request with `pi.sendMessage()` custom messages.

Use distinct stable custom types, for example:

```text
pi-advice.review.v1
pi-advice.continue.v1
```

The exact names may differ if a better stable name is chosen, but they must be:

- package-scoped;
- versioned or otherwise safe for future evolution;
- different for review and continuation;
- centralized constants rather than repeated string literals.

For both hidden messages:

- `display` must be `false`;
- the full prompt remains in `content` so it participates in LLM context;
- `details` should be omitted unless controller identification genuinely needs
  non-LLM metadata;
- message recognition must use controller phase plus exact custom type and exact
  stored prompt content;
- do not use broad prefix matching;
- do not register a TUI renderer or add `@earendil-works/pi-tui` merely to hide
  the prompts;
- do not claim the messages are absent from session history: they are hidden
  from the normal chat display but remain custom-message entries and are sent to
  the LLM; raw session inspection may reveal them.

Delivery rules:

- send the review custom message with `triggerTurn: true` and
  `deliverAs: "steer"`;
- when Pi is idle, `triggerTurn: true` starts a new run whose initial snapshot
  captures the already-activated review model;
- while Pi is streaming, the message is queued as steering and delivered after
  the current low-level turn finishes;
- send the continuation custom message with `triggerTurn: true` and
  `deliverAs: "steer"` during the final review `turn_end`; it will be delivered
  within the still-active run after restoration and the next-turn snapshot;
- never use a fabricated tool call, tool result, custom session entry, or direct
  session-file mutation for these prompts.

Pi converts custom messages to LLM-compatible user-role messages internally.
The self-continuity effect therefore comes from their hidden TUI presentation,
the wording of the prompts, and the fact that the review model's visible output
is an ordinary assistant message in the same transcript. Do not document or
claim that the transport-level LLM role changed.

### Start notification

After configuration/model/auth validation, successful review-model activation,
and the final pending-message safety check, show exactly one informational
notification for the accepted cycle:

- with no user-supplied focus: `Advising...`
- with nonblank user-supplied focus: `Advising: <trimmed focus>`

Requirements:

- use `ctx.ui.notify(..., "info")` through the controller dependency;
- use the user's verbatim focus after trimming leading/trailing whitespace;
- do not include provider, model, tools, interval, or internal phase details;
- do not display the hidden base prompt;
- do not show the notification for rejected, deferred, invalid, or failed-to-
  activate attempts;
- automatic cycles use the schedule's stored focus and the same notification
  format;
- the notification is ephemeral UI feedback, not a transcript message.

## Self-continuity prompt contract

Keep prompt builders centralized and directly testable in `src/prompts.ts`.
Preserve the useful substance of the user's committed prompt edits while making
the role continuity explicit and removing language that caused the restored
model to think another agent or the user had pasted a script.

### Hidden reconsideration prompt

The reconsideration prompt must tell the temporarily selected model to:

- pause execution and take a fresh, more capable look at its own current work
  and reasoning;
- treat the full conversation and all work so far as entirely its own ongoing
  work;
- avoid mentioning or implying another agent, advisor, advisee, model switch,
  review request, handoff, hidden prompt, or external reviewer;
- present the response as a realization, correction, or improved understanding
  it has just reached itself;
- assess how the work is going overall;
- identify what is going well;
- identify mistakes, weak assumptions, omissions, unnecessary work, risks, and
  better approaches;
- include every materially useful point without padding, repetition, or
  unnecessary verbosity;
- avoid taking implementation actions during this review turn;
- finish with a clearly labeled `Recommended next action(s):` section;
- provide one concrete next action for each materially distinct point in the
  optional focus, when multiple points were supplied;
- remain grounded in the actual user request and current authorization state;
- if no implementation or action is authorized, recognize that correctly rather
  than inventing work.

Do not use an exposed heading such as “Additional focus supplied by the user”
that encourages the model to frame the review as advice to somebody else.
Append optional focus verbatim under a neutral delimiter such as:

```text
Focus for this reconsideration:
<verbatim trimmed focus>
```

The focus augments rather than replaces the base contract.

### Tool-free reinforcement

For a tool-free cycle:

- physically set the active tool list to `[]` before the review turn;
- explicitly say that no tools are available and none should be requested;
- request one complete response containing as much information as necessary to
  make the useful realization clear;
- direct the model to rely on conversation context;
- do not say “advisor” or “advisee.”

### Tool-enabled reinforcement

For an `--tools` cycle:

- preserve the exact active tool-name set captured from the original model;
- allow tools only for minimal investigation supporting the reconsideration;
- require the minimum reasonable number of calls;
- require a prompt return to the written realization;
- prohibit modifying the project, executing the plan, or doing the substantive
  implementation work during the review phase;
- do not claim tools are technically read-only or sandboxed;
- do not use “advisor” or “advisee” in the LLM-facing prompt.

### Hidden continuation prompt

Replace the current explicit handoff text with a hidden self-continuity prompt.
It must:

- tell the restored model to continue the current work now from the realization
  in its preceding assistant response;
- frame the preceding response as its own realization;
- prohibit mentioning a separate reviewer, advisor, advisee, model switch,
  handoff, hidden control message, or prompt;
- tell it to use its own judgment;
- tell it to take the next concrete action rather than merely acknowledging,
  summarizing, or discussing the realization;
- tell it to respect the user's actual request and authorization state;
- tell it to ask for the required user input or authorization if that is the
  legitimate next action;
- tell it to state clearly when no legitimate work remains rather than inventing
  work.

The continuation prompt itself is hidden (`display: false`). The restored model's
assistant response remains visible.

## Public command rename

Rename the public command surface everywhere:

- `/advice` becomes `/advise`;
- `/advice-every` becomes `/advise-every`.

Update:

- command registration in `src/index.ts`;
- parsing functions/types/constants where naming clarity improves;
- usage strings;
- autocomplete functions and test descriptions;
- controller method names if they encode the old command names;
- notifications and recovery messages;
- README command forms and examples;
- CHANGELOG command references;
- `AGENTS.md` architecture notes;
- tests and fixture strings;
- this plan's implementation references;
- any other user-visible `/advice` or `/advice-every` occurrence found by a
  focused repository search.

Do not rename:

- the package/repository `pi-advice`;
- `~/.pi/agent/pi-advice.json`;
- `<project>/.pi/pi-advice.json`;
- `Symbol.for("pi-advice.schedule.v1")`;
- the conceptual noun “advice” when it is not a command name;
- internal advisor/advisee terminology used to reason precisely about model
  snapshots and restoration, unless a clearer internal name is helpful.

Accepted command forms:

```text
/advise
/advise focus on whether the current approach matches the plan
/advise --tools
/advise --tools inspect the relevant implementation before reconsidering

/advise-every 50
/advise-every 50 focus on correctness and overlooked risks
/advise-every 50 --tools
/advise-every 50 --tools inspect the relevant implementation first
/advise-every off
```

Parsing behavior remains:

- `--tools` is recognized only in the leading option position for `/advise`;
- for `/advise-every`, the first token is `off` or a positive safe integer;
- after an interval, `--tools` is recognized only in the immediate option
  position;
- remaining text is opaque focus;
- unknown leading options, zero, negatives, decimals, unsafe integers,
  nonnumeric intervals, missing interval, and malformed `off` usage produce
  concise usage guidance;
- old command names are not registered.

Autocomplete remains:

- offer `--tools` at the initial `/advise` argument position;
- offer `off` at the first `/advise-every` argument position;
- offer `--tools` after a valid interval and separating whitespace;
- return `null` when no command-specific completion applies.

## Steering restriction and pending-message safety

### Supported steering mode

Support Pi's default `one-at-a-time` steering mode only.

Document prominently in the README:

- `pi-advice` requires `steeringMode: "one-at-a-time"` (or the unset default);
- non-default `steeringMode: "all"` is unsupported;
- in `all` mode, later user steering may be batched with the hidden review
  message into one provider call, which prevents exact model isolation;
- Pi 0.82.1 does not expose steering mode through the public extension context,
  so the extension cannot detect or enforce this requirement.

Do not read or rewrite Pi's settings files to infer or force the mode. Do not add
an upstream patch or private runtime dependency for this V1 feature.

### Manual start

For `/advise`:

1. Parse arguments.
2. Reject overlap if a cycle is queued or active.
3. If `ctx.hasPendingMessages()` is true, reject with updated `/advise` wording;
   do not validate/activate/send a review message.
4. Load and validate configuration.
5. Resolve the review model and authentication.
6. Create the cycle record and mark it queued before the first `await` so a
   concurrent command cannot create overlap.
7. Snapshot the original model, thinking level, and exact active tool names.
8. Activate the review model/thinking/tool policy.
9. After all async activation work completes, check
   `ctx.hasPendingMessages()` again.
10. If a user message appeared during activation, restore the original state,
    cancel the cycle, notify that pending steering prevented `/advise`, and send
    no hidden review message.
11. If still safe, show the exact `Advising...`/`Advising: <focus>` notification.
12. Without another `await`, inject the hidden review custom message with
    `triggerTurn: true`, `deliverAs: "steer"`, and `display: false`.
13. If Pi was idle at send time, enter the active-review phase before injection;
    if streaming, remain queued until the exact custom message is delivered.

### Automatic threshold and deferral

Correct the current premature-saturation bug. Pending steering must not jump the
counter to the interval before the interval has actually elapsed.

For each ordinary original-model `turn_end` while the controller is idle:

1. Validate schedule session ownership; clear a mismatched schedule.
2. Classify the turn using controller phase and the assistant message's recorded
   provider/model; do not rely only on mutable `ctx.model`.
3. If `count < every`, increment by exactly one.
4. If the new count remains below `every`, return even when steering messages
   are pending.
5. Once `count >= every`, clamp it to exactly `every`.
6. If messages are pending, retain `count === every` and defer without
   notification or activation.
7. On a later qualifying `turn_end`, if the count is already saturated and the
   queue is empty, attempt the automatic cycle immediately without adding
   another count.
8. Reset count to `0` only when beginning a genuine automatic attempt or when an
   attempt fails for config/model/auth/activation reasons and the contract says
   to wait a full new interval.
9. If a new pending user message appears during async activation, restore and
   return the schedule to saturated `count === every` so it remains deferred;
   do not treat that race as a failed review interval.
10. On the next queue-empty qualifying boundary, attempt again.

Manual `/advise` must not reset or modify the automatic counter.

Reconfiguring `/advise-every` replaces every schedule field and resets count to
`0`. `/advise-every off` clears future scheduling while allowing an active cycle
to restore and finish safely.

## Controller state machine

Keep one explicit controller state machine. Semantic phases should include at
least:

- `idle`;
- `adviceQueued` (internal name may remain even though command is `/advise`);
- `advisorActive`;
- `continuationQueued`;
- `adviseeContinuing`.

Renaming internal phases to review/self-continuity terms is optional. Do not
perform a broad terminology refactor unless it makes the state machine clearer.

Invariants:

- at most one cycle exists;
- every activated cycle has exactly one original-state snapshot;
- no hidden review message is sent before successful activation and the final
  pending check;
- `message_start` identifies delivery but never performs the model switch;
- the current original-model tail turn is not mistaken for the review model;
- review-model turns never increment the schedule;
- queued and continuation-interstitial original-model turns never increment the
  schedule;
- the first restored-model continuation turn never increments the schedule;
- later autonomous original-model turns resume counting;
- original state restoration is centralized and idempotent;
- no continuation is sent until restoration succeeds;
- no continuation is sent after an unusable review, error, or abort;
- no continuation is sent twice;
- extension messages are identified by phase + exact custom type + exact content;
- user messages are never cleared or reordered;
- failures are notified concisely without verbose internal transcript entries.

## Activation and restoration hardening

### Activation

Correctly handle both boolean failure and thrown exceptions from `pi.setModel()`.
The public wrapper may reject even after prior authentication checks.

Activation must:

1. capture the original model/thinking/tools before mutation;
2. attempt `setModel(reviewModel)`;
3. apply configured review thinking;
4. apply `[]` tools for tool-free mode or the exact snapshot tools for
   `--tools`;
5. return a structured result rather than relying on implicit exceptions;
6. if any activation step fails or throws, attempt restoration, send no hidden
   review message, report the failure, and apply the correct automatic-counter
   outcome;
7. if `setModel` throws after live state changed, detect the current model and
   still restore rather than assuming no mutation occurred.

Remove currently unused imports/dependencies and cycle fields during this work.
In particular, remove the unused value import of `loadConfig` from the
controller and remove stored `context` if it has no purpose after prompt and
notification construction.

### Restoration

Change restoration to return a success/failure result.

Restoration must:

- attempt the exact original model;
- restore the original thinking level (allowing Pi's normal capability clamp);
- restore the exact original tool-name set;
- catch thrown model-switch errors;
- recognize success when the live model already equals the original model even
  if a switch call reports/throws after mutation;
- be idempotent;
- consume the snapshot only after the restoration attempt is complete;
- report any model restoration failure with the original provider/model;
- avoid claiming successful restoration when it failed;
- never send the continuation when model restoration failed;
- clear/disable the automatic schedule after a restoration failure so another
  cycle cannot capture the still-active review model as the new original model;
- tell the user to select the intended model manually with `/model` when exact
  restoration is impossible;
- still make best-effort thinking/tool restoration when model restoration fails;
- run defensively from review error/abort paths and non-reload shutdown;
- never persist the in-flight snapshot to files, environment variables, or
  session custom entries merely to survive process death.

Do not add uncontrolled retries. A concise failure and no continuation are safer
than repeatedly switching models.

## Review completion and tool-loop behavior

Correct the current test/implementation mismatch:

- only a cycle created with `--tools` may remain in `advisorActive` after a
  `toolUse` stop reason;
- a tool-enabled review may perform multiple low-level tool turns with no hard
  numeric call cap, but the prompt requires minimal investigation;
- tool results return to the review model because model/tools remain active
  through its tool loop;
- a tool-free cycle must not enter a tool loop;
- if a tool-free response reports `toolUse` but contains usable review text,
  treat that finalized response as the review output and restore;
- if a tool-free `toolUse` response contains no usable text, restore without
  continuation and notify that no usable reconsideration was produced;
- review `error` or `aborted` always restores without continuation;
- a non-tool final response requires nonblank text before continuation;
- `length` with usable text may be treated as a final response;
- after successful restoration, inject exactly one hidden continuation custom
  message.

## Configuration corrections

Preserve the public configuration surface:

```ts
interface AdviceConfig {
  provider: string;
  model: string;
  thinkingLevel?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
}
```

Preserve:

- global file: `~/.pi/agent/pi-advice.json` via `getAgentDir()`;
- trusted project override: `<cwd>/.pi/pi-advice.json` via `CONFIG_DIR_NAME`;
- project file ignored when the project is untrusted;
- project fields override global fields;
- omitted `thinkingLevel` defaults to `high`;
- credentials remain owned by Pi.

Correct and test:

- malformed JSON returns an `ok: false` path-specific diagnostic, never an
  uncaught command-handler exception;
- read failures return path-specific diagnostics;
- wrong types are rejected in each source before merge, even when a later
  project value would otherwise overwrite the malformed field;
- partial source validation allows a project file containing only an override
  such as `model`;
- after merge, nonempty provider and model are required;
- present but invalid thinking levels are rejected;
- unknown fields should be rejected rather than silently accepted because the
  initial public schema is intentionally closed;
- trusted-project diagnostics identify the actual file/source containing the
  malformed field;
- tests do not depend on whether the developer's real global config exists.

Introduce a focused file-loading test seam, such as a `loadConfigFromPaths()`
helper, so tests can create isolated global and project files in a temp
directory. Production `loadConfig()` must still derive paths from Pi's exported
APIs.

On `session_start` with `reason: "reload"`, re-read/validate configuration so
edits are observed and failures are reported concisely. Do not add file watchers
or persistent config caches without need.

## Process-global schedule corrections

Keep the versioned carrier:

```text
globalThis[Symbol.for("pi-advice.schedule.v1")]
```

Do not rename it for the `/advise-every` command rename.

Strengthen malformed-state validation:

- `version === 1`;
- schedule is `null` or an object;
- `sessionId` is a nonempty string;
- `every` is a positive safe integer;
- `tools` is boolean;
- `context` is string;
- `count` is a nonnegative safe integer;
- `count` may equal `every` while an automatic cycle is deferred;
- malformed state resets safely to disabled;
- stable object identity remains across module re-evaluation;
- schedule survives idle `/reload` only for the matching session;
- non-reload session replacement clears it;
- process restart naturally clears it;
- no session entry/file/env persistence is added.

## Package scripts and dependency discipline

Keep the accepted Pi dependency policy:

- `@earendil-works/pi-coding-agent` dev dependency: exactly `0.82.1`;
- optional peer dependency: `*`.

Do not add `@earendil-works/pi-tui` or another dependency for the notification;
use `ctx.ui.notify` and hidden custom messages.

Correct scripts:

- make the package test script reliably run this package, for example
  `vitest run --root .`, because invoking the symlinked Vitest binary without an
  explicit root has been observed to select another workspace package;
- add a nonmutating `format:check` script covering source, tests, package JSON,
  README, AGENTS, and CHANGELOG;
- retain a package-local formatting script;
- retain `typecheck`, `test`, and `build`;
- ensure `prepublishOnly` uses the intended checks if retained;
- do not add a compiled artifact requirement when Pi source-loads
  `src/index.ts`.

## Tests

### Command tests

Update all tests for `/advise` and `/advise-every`:

- bare `/advise`;
- focus text;
- `--tools` with/without focus;
- unknown leading option;
- later `--tools` treated as focus;
- positive safe intervals;
- invalid zero/negative/decimal/exponential/hex/nonnumeric/unsafe intervals;
- `off` and malformed `off` usage;
- exact usage examples with new command names;
- autocomplete for `--tools` and `off`;
- no registration or documentation of old command names.

### Prompt tests

Update tests to match material contracts rather than obsolete exact phrases:

- self-reconsideration framing;
- conversation/work treated as the model's own;
- prohibition on mentioning separate advisor/advisee/model switch/handoff;
- thorough-but-concise review dimensions;
- `Recommended next action(s):`;
- neutral focus delimiter with verbatim trimmed focus;
- tool-free no-tools/one-response guidance;
- tool-enabled minimum-investigation/no-modification guidance;
- hidden continuation framed as continuing from the model's own realization;
- continuation acts rather than acknowledges;
- continuation respects authorization/user-input boundaries;
- absence of old “You are the advisor/advisee” wording.

The user's committed prompt changes currently make six old prompt/controller
assertions fail. Those failures are expected stale-test failures to correct, not
proof that the new wording itself is wrong.

### Runtime-faithful controller harness

Rewrite/adapt the harness for custom messages while preserving the critical Pi
snapshot model:

- separate live state from current frozen-loop state;
- immediate hidden custom message with `triggerTurn: true` starts a run and
  snapshots live state;
- steering custom message remains queued until the current turn ends;
- `turn_end` handler runs before the next loop snapshot refresh;
- custom `message_start` uses role `custom`, exact custom type, and exact content;
- default `one-at-a-time` drain semantics;
- do not claim `all` mode support.

Cover at least:

- idle tool-free `/advise`;
- idle `--tools`;
- exact `Advising...` notification;
- exact `Advising: <focus>` notification;
- hidden review custom message (`display: false`);
- hidden continuation custom message (`display: false`);
- review message triggers when idle;
- review message queues as steer while streaming;
- review model is activated before message injection;
- current original-model tail turn remains under its frozen model;
- tail turn is neither counted nor treated as review output;
- exact next-turn model/thinking/tool snapshot;
- exact restoration before continuation snapshot;
- continuation runs under original model;
- review and continuation messages do not appear as user messages in the harness;
- overlap rejection;
- initial pending rejection;
- pending message arriving during async activation causes restore/cancel/no send;
- notification is not emitted for rejected/deferred/failed starts;
- activation boolean failure;
- activation thrown exception;
- activation partial-mutation exception with restoration;
- tool-free `toolUse` does not loop;
- tool-enabled `toolUse` loops and final response restores;
- error/abort/empty response restores with no continuation;
- restoration failure sends no continuation and clears the automatic schedule;
- restoration failure notification names the recovery action;
- restoration idempotence;
- user steering arriving during review remains FIFO and runs under restored
  original model for default one-at-a-time mode;
- continuation follows earlier queued user steering;
- recorded provider/model guards counting;
- manual cycle leaves schedule count unchanged;
- automatic threshold counts tool-calling original-model turns;
- automatic counter does not jump early merely because pending messages exist;
- automatic threshold saturates only after the configured count;
- automatic cycle starts as soon as a saturated schedule reaches a queue-empty
  qualifying boundary;
- automatic activation race returns to saturated/deferred state;
- genuine automatic config/model/auth/activation failure resets to `0` for a
  full new interval;
- reconfiguration/off behavior during active cycle;
- reload/new/resume/fork/nonreload-shutdown lifecycle;
- config revalidation on reload.

### Config tests

Use isolated temp paths and cover:

- global only;
- trusted project only when it contains a complete config;
- trusted partial override over global;
- untrusted project ignored;
- omitted thinking defaults to high;
- malformed JSON global and project;
- read error where practical;
- nonobject JSON;
- wrong types per source;
- malformed global value still rejected when project overrides same field;
- unknown fields;
- missing provider/model after merge;
- path/source-specific diagnostics;
- no dependence on the real home config.

### Process-state tests

Cover all strengthened validation and reload/session ownership requirements,
including invalid zero/negative/noninteger interval/count values and saturated
`count === every`.

## Documentation updates

Update `README.md` comprehensively:

- command names `/advise` and `/advise-every`;
- self-reconsideration experience rather than visible advisor handoff;
- the configured model's visible response appears as the assistant's own fresh
  realization;
- hidden custom-message mechanics described accurately and without leaking the
  full prompts;
- notification text `Advising...` or `Advising: <focus>`;
- hidden means absent from the normal transcript, not absent from session/LLM
  context;
- default tool-free behavior;
- `--tools` minimal investigation and no-modification prompt boundary;
- low-level-turn cadence semantics;
- pending-message rejection/defer compromise;
- explicit requirement for default `steeringMode: "one-at-a-time"` and warning
  that `all` is unsupported/not detectable;
- overlap and failure behavior;
- exact configuration locations/examples;
- reload-only schedule persistence;
- authentication/model/config troubleshooting;
- security implications of extensions and `--tools`;
- GitHub installation/trial commands;
- package remains `pi-advice` and is not claimed to be published to npm.

Update `CHANGELOG.md` with the command rename, hidden custom messages,
self-continuity UX, notification text, safety fixes, and one-at-a-time
restriction.

Update package `AGENTS.md` so it no longer mentions old commands or stale
“Amendment 1” task context. Keep durable runtime invariants, not a task diary.

Remove transient PLAN references from source comments and other code comments.
Do not rewrite already-pushed commit messages.

Keep the superproject README/package registration unchanged unless a focused
review shows a command-specific statement requiring correction. The package
name/path does not change.

## Implementation sequence

After supercompaction, execute in this order:

1. Re-read the focused sources listed under **Post-compaction reading**.
2. Revalidate child/superproject status before editing; confirm the plan commit
   is the child HEAD and unrelated root state is still unstaged.
3. Update package governance/docs terminology enough to prevent stale guidance
   while coding.
4. Rename command parsing, usage, completion, registrations, controller command
   methods, and tests to `/advise` and `/advise-every`.
5. Finalize the self-reconsideration and hidden-continuation prompt builders and
   prompt tests, preserving the user's committed intent.
6. Add centralized custom-message type constants and the controller dependency
   for hidden `sendMessage()` injection.
7. Adapt `src/index.ts` to wire `pi.sendMessage()` and keep `ctx.ui.notify()`.
8. Rewrite the controller start path for activation-before-injection, exact
   notification, final pending recheck, and structured start outcomes.
9. Correct automatic counting/saturation/defer behavior.
10. Harden activation/restoration exceptions and no-continuation-on-restore-
    failure behavior.
11. Correct tool-free/tool-enabled `toolUse` behavior.
12. Adapt the runtime-faithful harness to custom messages and add all race,
    restoration, notification, and cadence cases.
13. Refactor config loading/validation for isolated paths and strict per-source
    validation; update tests.
14. Strengthen process-global schedule validation and tests.
15. Correct package test root and add `format:check`.
16. Update README, CHANGELOG, AGENTS, and focused source comments.
17. Run focused searches for old command names and stale handoff language;
    distinguish legitimate package name/noun usages from command references.
18. Format only the child package.
19. Run all child validation commands and inspect diffs.
20. Commit the child follow-up implementation with a Conventional Commit that
    does not mention agents, plan files, or transient task context.
21. Update/stage only the superproject `packages/pi-advice` pointer and any
    genuinely required pi-advice root integration changes. Never stage unrelated
    `pi-session-manager` or lockfile state.
22. Run focused root validation for `pi-advice`; do not run root formatting.
23. Commit the superproject pointer/integration follow-up after the child commit.
24. Do not push.
25. Run interactive Pi acceptance and obtain explicit user acceptance or waiver
    before declaring completion.
26. If acceptance exposes defects, fix forward with child-first follow-up commits
    and repeat focused validation/acceptance.

## Automated validation

From `packages/pi-advice`, run and report exact exit results for:

```bash
npm run format
npm run format:check
npm run typecheck
npm run test
npm run build
git diff --check
```

Because formatting writes files, inspect the resulting diff and verify it is
limited to intended child files.

The test output must explicitly show the `pi-advice` root and all five intended
(or updated) test files. Do not accept output from another workspace package.
Do not mask command exit codes through a pipeline; use `pipefail`, capture the
actual status, or run commands directly.

From `/workspace/projects/pi`, run focused nonmutating validation such as:

```bash
pnpm --filter @arcanemachine/pi-advice run format:check
pnpm --filter @arcanemachine/pi-advice run typecheck
pnpm --filter @arcanemachine/pi-advice run test
pnpm --filter @arcanemachine/pi-advice run build
git diff --check
```

Do not run:

```bash
pnpm run format
```

at the superproject root.

If the root lockfile remains dirty solely because of unrelated
`pi-session-manager` work and pi-advice package metadata did not change resolved
dependencies, do not regenerate, reset, or stage that lockfile. If pi-advice
metadata genuinely requires a lock update, stop and isolate only pi-advice hunks
without losing unrelated work.

## Interactive acceptance

Automated tests are not final verification. Exercise the extension in a running
Pi session configured with an authenticated review model and default
`one-at-a-time` steering.

Verify visibly:

1. `/advise` while idle shows `Advising...` and does not show the hidden review
   prompt as a user message.
2. The review model's assistant response reads as its own fresh realization and
   does not mention advisor/advisee/model switch/handoff.
3. The hidden continuation prompt does not appear, and the restored model
   continues as if acting on its own preceding realization.
4. `/advise <focus>` shows exactly `Advising: <focus>`.
5. `/advise --tools <focus>` permits minimal investigation, makes no project
   modifications during the review phase, and returns promptly.
6. Tool-free review has no active tools.
7. `/advise` during streaming waits for the current low-level turn/tool results
   and then runs the review model on the next isolated turn.
8. `/advise` is rejected when an earlier steering message is pending.
9. A steering message arriving during async activation does not run under the
   review model and causes safe cancel/restore.
10. Later steering during the review is preserved under default one-at-a-time
    behavior and runs under the restored original model before the hidden
    continuation when FIFO dictates.
11. `/advise-every 2` counts ordinary low-level original-model turns, including
    tool-calling turns, and triggers only after two.
12. Pending messages before count 2 do not prematurely saturate/trigger.
13. A threshold reached while pending defers and triggers after the queue drains.
14. `/advise-every 2 --tools <focus>` retains focus/tools across cycles and uses
    the correct notification.
15. `/advise-every off` prevents future cycles without stranding an active one.
16. Idle `/reload` preserves schedule interval, focus, tool flag, and partial or
    saturated count, and reloads configuration.
17. Success restores exact original model, thinking, and active tools.
18. An induced review error/abort restores and sends no continuation.
19. An induced restoration failure sends no continuation and gives a clear
    manual recovery notification.
20. Autocomplete and malformed guidance use only `/advise` and
    `/advise-every`.
21. Old `/advice` and `/advice-every` are not registered.

Present observed results to the user and obtain explicit acceptance or an
explicit waiver before declaring the implementation complete.

## Stop conditions

Stop and return to the user rather than improvising if:

- hidden custom messages do not trigger/queue at the verified boundary;
- the current original-model turn is affected by activation intended only for
  the next turn;
- exact restoration cannot be made fail-closed enough to prevent continuation
  under the wrong model;
- the final pending recheck cannot prevent messages queued during async
  activation from running under the review model;
- default one-at-a-time steering does not preserve later user steering as
  expected;
- implementing the notification would require a TUI dependency or custom
  renderer despite the approved `ctx.ui.notify` design;
- a nested/private provider call or fabricated tool call is proposed;
- command syntax must change beyond the approved rename;
- schedule persistence would require file/session/env authority;
- unrelated `pi-session-manager` or lockfile state would need to be staged,
  reset, or overwritten;
- validation selects/tests the wrong workspace package;
- interactive acceptance fails or the user changes the desired behavior.

## Completion criteria

The work is complete only when:

- `/advise` and `/advise-every` are the only registered public commands;
- hidden review/continuation prompts are custom messages and do not render as
  user messages;
- accepted cycles show exactly the approved notification;
- review output reads as the assistant's own realization;
- restored continuation preserves that self-continuity and acts appropriately;
- pending/retry/cadence/restoration/tool-loop defects are corrected;
- one-at-a-time requirement and hidden-message/session semantics are documented
  accurately;
- configuration and process-state validation meet this plan;
- package scripts reliably validate the correct package;
- all child and focused root checks pass;
- diffs contain no unrelated work;
- child follow-up is committed before the superproject pointer follow-up;
- nothing is pushed or published by the agent;
- interactive behavior is exercised and explicitly accepted or waived.

## Post-compaction reading

After supercompaction, do not reread the entire workspace. Read these focused
sources before editing:

### Mandatory project sources

1. `/workspace/AGENTS.md`
2. `/workspace/projects/pi/AGENTS.md`
3. `/workspace/projects/pi/packages/pi-advice/AGENTS.md`
4. `/workspace/projects/pi/packages/pi-advice/PLAN.md` (this file, in full)
5. `/workspace/.agents/languages/nodejs.md`
6. `/workspace/projects/pi/packages/pi-advice/package.json`
7. `/workspace/projects/pi/packages/pi-advice/src/prompts.ts`
8. `/workspace/projects/pi/packages/pi-advice/src/command.ts`
9. `/workspace/projects/pi/packages/pi-advice/src/advice-controller.ts`
10. `/workspace/projects/pi/packages/pi-advice/src/index.ts`
11. `/workspace/projects/pi/packages/pi-advice/src/config.ts`
12. `/workspace/projects/pi/packages/pi-advice/src/process-state.ts`
13. the corresponding five test files, with special attention to
    `tests/advice-controller.test.ts` and `tests/prompts.test.ts`
14. `/workspace/projects/pi/packages/pi-advice/README.md`

Read current Git status/log in both child and superproject before mutation.

### Mandatory Pi documentation/runtime anchors

The Pi extension documentation was previously read, but the next implementation
pass must refresh the exact custom-message and event contracts from:

1. `/usr/local/share/npm-global/lib/node_modules/@earendil-works/pi-coding-agent/docs/extensions.md`
   - read the full Markdown file as required by Pi documentation guidance;
   - focus on `pi.sendMessage()`, `pi.sendUserMessage()`, custom messages,
     `message_start`, `turn_end`, tools, and lifecycle events;
   - follow only links material to this work. No TUI implementation is planned.
2. `/usr/local/share/npm-global/lib/node_modules/@earendil-works/pi-coding-agent/dist/core/messages.js`
   - verify custom messages convert to LLM user-role messages.
3. `/usr/local/share/npm-global/lib/node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js`
   - `_installAgentNextTurnRefresh()`;
   - `prompt()` streaming behavior;
   - `sendCustomMessage()`;
   - `_queueSteer()` synchronous enqueue;
   - extension action wiring for `sendMessage`, `setModel`, tools, and context.
4. `/usr/local/share/npm-global/lib/node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-agent-core/dist/agent-loop.js`
   - `runAgentLoop`, `runLoop`, pending-message delivery, awaited `turn_end`,
     `prepareNextTurn`, provider call, and tool loop.
5. `/usr/local/share/npm-global/lib/node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-agent-core/dist/agent.js`
   - `PendingMessageQueue`, default one-at-a-time behavior, run-start snapshots,
     and queue drain.
6. `/usr/local/share/npm-global/lib/node_modules/@earendil-works/pi-coding-agent/dist/core/settings-manager.js`
   - verify default steering mode is one-at-a-time and remember that the public
     extension context does not expose the getter.
7. `/usr/local/share/npm-global/lib/node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts`
   - exact `sendMessage` custom message/options types and message event types.

Do not assume a true tool-call presentation is possible or desired. The approved
implementation is hidden custom messages plus `ctx.ui.notify`.
