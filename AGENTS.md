# Agent Instructions

## Workflow

Commit completed work in this child repository first, then commit the updated
submodule pointer in the `pi-projects` superproject. Do not push unless the user
explicitly authorizes it.

## Sanity checks

```bash
npm run format:check
npm run typecheck
npm run test
npm run build
npm run format
```

Verify user-facing changes against a running Pi session before release.

## Architecture notes

- The package remains `pi-advice`; its public commands are `/advise` and
  `/advise-every`.
- The reconsideration and continuation controls are hidden custom messages.
  They are absent from normal transcript rendering but remain session/LLM
  context. Use the package-scoped versioned message types in
  `src/advice-controller.ts`; do not replace them with visible user messages,
  fabricated tool calls, renderers, or persistent custom entries.
- The cycle is an explicit phase machine in `src/advice-controller.ts`. Pi
  snapshots next-turn model/thinking/tools after awaited `turn_end` handlers and
  before queued steering messages emit `message_start`. Activate the review
  model before queuing its prompt; restore original state in the review model's
  final `turn_end` before queuing continuation.
- Support Pi's default `one-at-a-time` steering mode only. The public extension
  context does not expose the setting. Manual `/advise` rejects pending
  steering; an automatic threshold defers after the count reaches its interval.
- The `/advise-every` schedule survives idle `/reload` only through the
  versioned `globalThis[Symbol.for("pi-advice.schedule.v1")]` object. It never
  uses session entries, files, environment variables, or command arguments.
- The reconsidering model may investigate only with `--tools`; it must not
  implement during reconsideration. Restoration failure must never queue a
  continuation.
- Set Pi's `Advising...` working message only when the exact hidden review
  message starts; clear it before restoration/continuation and during shutdown.

## Commit style

Use Conventional Commits:

- `feat: add reconsideration cycle controller`
- `docs: expand installation guidance`
- `test: cover review tool-loop restoration`
