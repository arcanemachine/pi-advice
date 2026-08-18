# pi-advice

<p align="center">
  <img src="https://raw.githubusercontent.com/arcanemachine/pi-advice/main/logo.jpg" alt="pi-advice logo" width="250" />
</p>

`pi-advice` is a [Pi](https://pi.dev) extension that lets the assistant pause, reconsider its own current work with a configured model (typically a more powerful model), then continue from that fresh realization.

This extension may be useful to help get a weaker model unstuck, or to provide additional information from a more powerful model before continuing with a task.

> Like this extension? See [my other Pi extensions](https://github.com/arcanemachine/pi-projects).

The package is named `pi-advice`; the public commands are `/advise` and `/advise-every`.

## Install

From npm:

```bash
pi install npm:@arcanemachine/pi-advice
```

From GitHub:

```bash
pi install git:github.com/arcanemachine/pi-advice
```

Update it with:

```bash
pi update git:github.com/arcanemachine/pi-advice
```

For a temporary trial in the current run:

```bash
pi -e git:github.com/arcanemachine/pi-advice
```

For local development:

```bash
git clone https://github.com/arcanemachine/pi-advice.git
cd pi-advice
pi -e ./src/index.ts
```

Pi source-loads `src/index.ts`; no compiled artifact is required.

## Configuration

`pi-advice` reads and merges these JSON files. Project fields override global
fields, but only in a trusted project.

| File                           | Scope                    |
| ------------------------------ | ------------------------ |
| `~/.pi/agent/pi-advice.json`   | Global                   |
| `<project>/.pi/pi-advice.json` | Trusted-project override |

Example global configuration:

```json
{
  "provider": "openai-codex",
  "model": "gpt-5.6-sol",
  "thinkingLevel": "high"
}
```

A trusted project may override only selected fields:

```json
{
  "model": "gpt-5.6-terra"
}
```

`provider` and `model` must be nonempty strings after merging.
`thinkingLevel` defaults to `high` and must be one of `off`, `minimal`, `low`,
`medium`, `high`, `xhigh`, or `max`. Unknown fields, malformed JSON, and invalid
field types are rejected with a source-specific diagnostic.

Do not put credentials in `pi-advice.json`. Authenticate models through Pi, for
example with `/login <provider>`.

## Commands

### `/advise`

```text
/advise
/advise focus on whether the current approach matches the plan
/advise --tools
/advise --tools inspect the relevant implementation before reconsidering
```

`/advise` starts one reconsideration cycle. When the hidden reconsideration
response is actively streaming, Pi's working message becomes `Advising...`
and returns to Pi's default before the restored model continues. The working
message remains active through an authorized `--tools` investigation, but not
while a cycle is merely queued behind another turn.

The reconsideration and continuation instructions are hidden custom messages:
they do not appear in the normal chat transcript. They do remain in session and
LLM context, and Pi converts them to LLM-compatible user messages internally.
The visible response is intended to read as the assistant's own fresh
realization, followed by normal continuation from that realization.

A cycle is rejected while another cycle is active. It is also rejected when
steering messages are already pending, so the reconsideration cannot run under
the wrong model. If steering arrives during asynchronous activation, the cycle
is cancelled and the original state is restored.

Autocomplete offers `--tools` in the leading argument position.

### `/advise-every`

```text
/advise-every 50
/advise-every 50 focus on correctness and overlooked risks
/advise-every 50 --tools
/advise-every 50 --tools inspect the relevant implementation first
/advise-every off
```

`<N>` is a positive safe integer. The cadence counts low-level original-model
turns: every assistant response plus its tool calls/results at Pi's `turn_end`.
It excludes reconsideration turns, queued interstitial turns, and the generated
continuation turn.

At the Nth qualifying turn, a cycle begins at the next safe steering boundary.
If messages are pending at the threshold, the count remains saturated at N and
reconsideration waits until a later queue-empty qualifying boundary. Pending
messages before the threshold do not accelerate the counter. Reissuing the
command replaces the schedule and resets its count. `off` disables future
cycles but lets an active cycle restore safely.

Autocomplete offers `off` initially and `--tools` after a valid interval.

## Tools

Tool-free cycles are the default. `pi-advice` temporarily sets the active tool
list to empty and asks the model to reconsider from conversation context.

`--tools` preserves the exact active tool-name set captured from the original
model. The prompt permits only minimal investigation and prohibits modifying
the project, executing the plan, or performing the substantive implementation
work during reconsideration. That is prompt guidance, not a technical sandbox:
active tools may still be capable of modification.

## Steering requirement

`pi-advice` supports Pi's default `steeringMode: "one-at-a-time"` only (including
an unset setting, which defaults to it). `steeringMode: "all"` is unsupported:
it can batch later user steering with a hidden reconsideration message into one
provider call, preventing exact model isolation. Pi 0.82.1 does not expose this
mode through the public extension context, so `pi-advice` cannot detect or
enforce the setting.

## State restoration and reload

Before a cycle, the extension snapshots the original model, thinking level, and
active tool names. It activates the configured reconsideration model before
queueing its hidden message, because Pi snapshots next-turn state before queued
messages emit `message_start`. When reconsideration finishes, it restores the
snapshot before queueing hidden continuation.

If the reconsideration errors, aborts, or produces no usable response, the
extension restores state and sends no continuation. If exact restoration fails,
it sends no continuation, disables automatic advice, and asks you to select the
intended model manually with `/model`.

The `/advise-every` schedule survives an idle `/reload` in the same Pi process
via a versioned process-global object. It does not survive process restart and
is cleared on `/new`, `/resume`, `/fork`, or `/clone`. Reload revalidates
configuration. Pi's existing reload restriction still applies: wait for the
current response to finish before reloading.

## Troubleshooting

- **Advisor model not found**: check the configured provider/model with `/model`
  or `pi --list-models`.
- **No API key configured**: authenticate using `/login <provider>`.
- **Configuration invalid**: correct the named file/field, then use `/reload`.
- **Failed to restore original state**: select the intended model manually with
  `/model`; automatic advice has been disabled for safety.

## Security

Extensions run with your full system permissions. Install `pi-advice` only from
a source you trust. A configured reconsideration model receives conversation
context; with `--tools`, it also receives the active tools.

## Development

```bash
npm install
npm run format:check
npm run typecheck
npm run test
npm run build
npm run format
```

Tests use a runtime-faithful fake Pi harness and make no model requests. Before
release, also verify the user-facing behavior in a running Pi session.

## License

MIT. See [LICENSE.md](./LICENSE.md).
