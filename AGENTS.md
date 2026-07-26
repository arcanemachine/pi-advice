# Agent Instructions

## Workflow

Commit when a task is completed. Commit in this child repository first, then
commit the updated submodule pointer in the `pi-projects` superproject. Do not
push unless explicitly authorized.

## Sanity checks

```bash
npm run typecheck
npm run test
npm run build
npm run format
```

Verify user-facing changes against a running Pi session before release.

## Architecture notes

- **Advisor/advisee terminology** is canonical in source, tests, and docs. Avoid
  "smart model"/"dumb model" language.
- The `/advice-every` schedule survives idle `/reload` only, via a versioned
  `globalThis[Symbol.for("pi-advice.schedule.v1")]` object. It never uses
  session entries, files, env, or command arguments. See `src/process-state.ts`.
- The advice cycle is an explicit phase machine in `src/advice-controller.ts`.
  Pi freezes the next low-level turn's model/thinking/tools from live agent
  state just after each awaited `turn_end`, before the next drained steering
  message emits `message_start`. The advisor is therefore activated (snapshot +
  model/thinking/tool switch) BEFORE its prompt is queued; the advisee's
  in-flight turn keeps its already-frozen configuration and is ignored by
  phase. Restoration happens during the advisor's final `turn_end`, before the
  continuation turn's snapshot.
- Per PLAN.md Amendment 1 (Option B): manual `/advice` is rejected if
  `ctx.hasPendingMessages()` is true, and an automatic threshold defers until
  the steering queue is empty. Exact FIFO activation behind earlier queued
  messages is intentionally not attempted. Counting only happens on `idle`
  advisee turns, classified by the assistant turn's recorded provider/model.
- The advisor advises and never implements, even with `--tools`.

## Commit style

Use Conventional Commits:

- `feat: add advice cycle controller`
- `docs: expand README installation guidance`
- `test: cover advisor tool-loop restoration`
