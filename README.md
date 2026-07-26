# pi-advice

Invite a configured **advisor** model to review an **advisee** model's current
work, then hand control back so the advisee continues using that advice.

`pi-advice` is a [Pi](https://pi.dev) extension for interactive and autonomous
work. A manual `/advice` review lets you unstick or redirect an advisee
mid-flight; a periodic `/advice-every` cadence interrupts an advisee executing a
long-running plan at safe steering boundaries, gets focused guidance, and pushes
it back into execution.

The advisor **advises**. It never takes over implementation, even when it is
allowed to use the advisee's tools.

## Why

- **`/advice`** is the manual recovery mechanism when an advisee looks stuck,
  misguided, or in need of a push. It hands the conversation to a configured
  advisor for a focused review, then automatically restores and continues the
  advisee.
- **`/advice-every`** is primarily useful during autonomous, long-running work —
  for example, a worker executing a plan. It periodically pauses the advisee at
  the next safe Pi steering boundary, obtains advisor guidance, and resumes the
  advisee so it keeps working with that guidance.

Both commands finish their advice cycle by promoting continuation from the
advisee. The advisor's response is not the final user-facing outcome of the
cycle.

## Install

From GitHub:

```bash
pi install git:github.com/arcanemachine/pi-advice
```

To update:

```bash
pi update git:github.com/arcanemachine/pi-advice
```

For a temporary trial in the current run only:

```bash
pi -e git:github.com/arcanemachine/pi-advice
```

For local development:

```bash
git clone https://github.com/arcanemachine/pi-advice.git
cd pi-advice
pi -e ./src/index.ts
```

The package is source-loaded by Pi from `src/index.ts`; no compiled artifact is
required. It is not yet published to npm.

## Configuration

`pi-advice` reads JSON configuration from two files and merges them: a global
file and, for trusted projects, a project override. Project fields override
matching global fields.

| File                           | Scope                         |
| ------------------------------ | ----------------------------- |
| `~/.pi/agent/pi-advice.json`   | Global                        |
| `<project>/.pi/pi-advice.json` | Trusted project override only |

Global example:

```json
{
  "provider": "openai-codex",
  "model": "gpt-5.6-sol",
  "thinkingLevel": "high"
}
```

Project override example (keeps the global provider and thinking level, selects
a different model):

```json
{
  "model": "gpt-5.6-terra"
}
```

Fields:

| Field           | Required | Description                                                                                                   |
| --------------- | -------- | ------------------------------------------------------------------------------------------------------------- |
| `provider`      | yes      | Provider id, e.g. `openai-codex` or `anthropic`.                                                              |
| `model`         | yes      | Model id within the provider, e.g. `gpt-5.6-sol`.                                                             |
| `thinkingLevel` | no       | Advisor thinking level. Defaults to `high`. One of `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`. |

Never place credentials in `pi-advice.json`. Authentication stays owned by Pi's
model registry — configure it with `/login <provider>`.

## Commands

### `/advice`

```text
/advice
/advice focus on whether the current approach matches the plan
/advice --tools
/advice --tools inspect the relevant implementation before advising
```

- Bare `/advice` requests a generic advisor review with no tools.
- Free-form text is additional focus for the advisor; it augments the base
  review prompt.
- `--tools` lets the advisor investigate with the advisee's active tool set.
  Text after `--tools` is optional focus.
- `/advice` is not queued behind other steering messages: if steering messages
  are already pending, the request is reported and rejected so it can never run
  under the wrong model. Wait for them to finish, then retry.

Autocomplete offers `--tools` at the leading option position.

### `/advice-every`

```text
/advice-every 50
/advice-every 50 focus on correctness and overlooked risks
/advice-every 50 --tools
/advice-every 50 --tools inspect the relevant implementation first
/advice-every off
```

- `<N>` is a positive integer. The cadence counts **low-level advisee turns** —
  each assistant response plus its tool calls and tool results (Pi's `turn_end`),
  not full user/agent exchanges. Advisor turns and the generated advisee
  continuation turn are excluded from the count.
- At the Nth counted turn, an automatic advisor review is queued as a steering
  message at the next safe boundary before the advisee's next model call. If
  other steering messages are pending at the threshold, the automatic review is
  deferred until the queue is empty, so it is never delivered under the wrong
  model. Existing queued steering messages keep their order.
- Reissuing `/advice-every N ...` replaces the schedule and resets the counter.
- `/advice-every off` disables future automatic reviews and clears the
  schedule. An active cycle is allowed to finish.

Malformed input shows concise usage with the examples above. Autocomplete
offers `off` at the first position and `--tools` after a valid interval.

## Tool-free versus `--tools`

- **Tool-free** (default): the advisor's active tool set is set to empty and the
  advisor is told not to call or request tools. It answers from the conversation
  context already in the session.
- **`--tools`**: the advisor keeps the advisee's active tool set, but is told to
  use tools only to investigate, make the minimum reasonable number of calls,
  and return promptly. It must not modify the project, execute the plan, or
  perform the advisee's work.

The no-modification rule is prompt-level guidance, not a technical sandbox. Do
not assume arbitrary tools are read-only.

## How an advice cycle works

Before the advisor prompt is queued, `pi-advice` snapshots the advisee's exact
model, thinking level, and active tool set, switches to the configured advisor,
applies the configured thinking level and the cycle's tool policy, and then
sends the advisor prompt as a visible user message. (The model switch is made
before queueing because Pi freezes the next low-level turn's model from agent
state just after the previous `turn_end`.) If the advisee is mid-response, its
current turn finishes under the advisee; the advisor takes the turn that
follows. When the advisor finishes, `pi-advice` restores the exact advisee
model, thinking level, and tools and sends a visible continuation message that
tells the advisee to act on the advice rather than merely acknowledge it.

A second advice request while a cycle is queued or active is rejected. The
advisor never advises itself. On advisor failure, abort, or an empty response,
the advisee is restored and no continuation is sent.

## Reload and session lifetime

The active `/advice-every` schedule survives idle `/reload` (the same Pi process
re-evaluates the extension, and the schedule lives on a process-global object),
so edits to configuration take effect after a reload. It does **not** survive a
Pi process restart, and it does not carry across `/new`, `/resume`, `/fork`, or
`/clone`: those clear it.

Pi refuses `/reload` while a response is streaming; `pi-advice` does not
override that built-in behavior.

## Troubleshooting

- **"Advisor model ... not found."** — the configured `provider`/`model` is not
  available. Check the spelling and that the provider is registered (see
  `/model` or `pi --list-models`).
- **"No API key configured for ...".** — run `/login <provider>` to authenticate.
- **"Advisor configuration is invalid: ..."** — `pi-advice.json` is malformed or
  missing required fields. The message names the offending field and source.

## Security

Extensions run with your full system permissions and can execute arbitrary code.
Only install `pi-advice` from a source you trust. The advisor can read the
conversation; with `--tools` it also gains the advisee's active tool set, which
can modify the project.

## Development

```bash
npm install
npm run typecheck
npm run test
npm run build
npm run format
```

Tests use Vitest and exercise behavior with a fake Pi harness; no model
requests or network calls are made. Verify user-facing changes against a running
Pi session before release.

## License

MIT. See [LICENSE.md](./LICENSE.md).
