# clef — Acidbath as a pure client of the decision service

A Pi extension. It calls `POST /v1/policy/decide` on the clef decision
service and does nothing else: no model, no GPU, no threshold.

The thresholds, the question sets and the judgments live in the service.
This extension holds **no threshold of its own** — it reads the effective set
back from the service and shows it in `/clef`.

## Install

Copy `extension/` into `~/.pi/agent/extensions/clef/`, or load it directly:

```bash
pi --extension ./extension/index.ts
```

It is **inert unless enabled**:

```bash
export PI_CLEF_ENABLED=1
export PI_CLEF_ENDPOINT=http://100.88.51.44:8802   # the decision service (the default)
```

## What it does

### Stays in Pi (lifecycle interception — MCP cannot express these)

| Hook | What it does |
|---|---|
| `tool_call` | blocks a destructive command before Pi runs it |
| `tool_result` | rewrites a result that carries injected instructions, so the model receives it as data rather than as orders |
| `turn_end` | a compaction tier (silent / notice / recommend / request), injected as a transient message |

### Becomes callable

| Tool / command | What it does |
|---|---|
| `ask_clef` | typed questions over state. Give it **file paths**, not pasted content: the extension reads the files, and their content never comes back to the model — only probabilities, a verdict and a reason. |
| `should_i_compact` | the compaction advice, as a tool |
| `/clef` | the endpoint, the thresholds in force and the session ledger |

## Fail-open is a contract term

If the service is unreachable, times out, or returns a malformed body, **every
hook changes no behaviour**: the tool call is allowed, the result is not
rewritten, the compaction tier stays silent. A gate that blocks traffic when
it is sick is worse than no gate. Fail-open can be turned off with
`PI_CLEF_FAIL_OPEN=0`, but the default is on.

The client timeout is `1500ms` — shorter than the service's, as the contract
requires of interactive clients.

## Configuration

Everything is env-driven, like the acidbath compactor.

| Variable | Default | Meaning |
|---|---|---|
| `PI_CLEF_ENABLED` | off | arm the extension at all |
| `PI_CLEF_ENDPOINT` | `http://100.88.51.44:8802` | base URL of the decision service |
| `PI_CLEF_MODEL` | `clef-flash` | model name recorded in the ledger |
| `PI_CLEF_TIMEOUT_MS` | `1500` | client timeout |
| `PI_CLEF_FAIL_OPEN` | on | allow (not block) when the service is unreachable |
| `PI_CLEF_HOOKS` | all three | comma list of `tool_call`, `tool_result`, `turn_end`; `off` arms none |
| `PI_CLEF_MAX_STATE_BYTES` | `65536` | hard cap on the state sent to the service |
| `PI_CLEF_COMPACT_NOTICE_PCT` | `50` | context usage % that triggers a notice |
| `PI_CLEF_COMPACT_RECOMMEND_PCT` | `70` | context usage % that triggers a recommendation |
| `PI_CLEF_COMPACT_REQUEST_PCT` | `85` | context usage % that requests compaction |

## Tests

```bash
node --experimental-strip-types --no-warnings extension/scripts/test-clef.mjs
bash verify/with-mock.sh  node --experimental-strip-types --no-warnings extension/scripts/test-clef-service.mjs
bash verify/with-stub.sh  node --experimental-strip-types --no-warnings extension/scripts/test-clef-service.mjs
```

The hooks are driven with synthetic events, exactly as the acidbath compactor
tests do — no live Pi session needed.

`extension/scripts/stub-service.mjs` is a tiny pinned decision service used by
the extension's tests only. It exists because `mock/server.mjs` grades by
hashing the state, so it cannot pin a verdict for a destructive command; the
stub grades `tool_safety` by rule instead. The mock remains the reference
implementation of the *shape*.

Typecheck (needs the installed Pi package and a `tsc`):

```bash
bash extension/scripts/typecheck.sh
```
