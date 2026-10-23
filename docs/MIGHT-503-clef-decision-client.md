# MIGHT-503 clef decision client

Acidbath ships a **client** of the clef decision service. It hosts no model and
holds no threshold: the question sets, the thresholds and the graded verdicts
all live in the service on the ai-lab. This document says what the extension
does, how it is configured, and how it fails.

## What it does

Three lifecycle hooks, which MCP cannot express because they intercept Pi
rather than being called by the model:

| Hook | What it does |
|---|---|
| `tool_call` | asks the service whether a tool call is destructive, and blocks it before Pi runs it |
| `tool_result` | asks whether the result carries injected instructions, and rewrites it when it does |
| `turn_end` | asks whether this is a good moment to compact, and injects a tier as a transient message |

Three model-facing tools:

| Tool | What it does |
|---|---|
| `ask_clef` | typed questions over state — **the code reads the files**, so the model never pastes content it did not ask for |
| `should_i_compact` | compaction advice on demand |
| `/clef` | status: the endpoint, the thresholds in force, the session ledger |

## Configuration

Off by default. `PI_CLEF_ENABLED=1` arms it.

| Variable | Default | Meaning |
|---|---|---|
| `PI_CLEF_ENABLED` | `0` | arm the extension at all |
| `PI_CLEF_ENDPOINT` | `http://100.88.51.44:8802` | the decision service |
| `PI_CLEF_MODEL` | `clef-flash` | the model recorded in the ledger |
| `PI_CLEF_TIMEOUT_MS` | `1500` | client timeout — a system-1 call must never slow the loop |
| `PI_CLEF_FAIL_OPEN` | `1` | when the service is unreachable, allow instead of block |
| `PI_CLEF_HOOKS` | all three | comma list of armed hooks: `tool_call`, `tool_result`, `turn_end` |
| `PI_CLEF_MAX_STATE_BYTES` | `65536` | hard cap on the state we send |
| `PI_CLEF_COMPACT_NOTICE_PCT` | `50` | context usage % that triggers a notice |
| `PI_CLEF_COMPACT_RECOMMEND_PCT` | `70` | context usage % that recommends compacting |
| `PI_CLEF_COMPACT_REQUEST_PCT` | `85` | context usage % that requests compaction |

## Failure mode

**Everything fails open.** If the service is unreachable, slow, or answers with
something malformed, the extension changes no behaviour: commands run, results
pass through, no compaction message is injected. The ledger records that it
failed open, so `/clef` shows it.

The one way to make it fail *closed* is `PI_CLEF_FAIL_OPEN=0`. That is not the
default, and it should not be: a gate that blocks traffic when it is sick is
worse than no gate.

## The endpoint

The default endpoint is the ai-lab's decision service over the tailnet:

```
100.88.51.44:8802   the service   (systemd --user unit clef-decision-service)
100.88.51.44:8801   clef-flash    (the model behind it)
```

Neither port is reachable from the public internet. The public path to the
service is through the gateway on hostinger-gateway, which is where the
Executor and Nasir integrations point.

## Where it came from

Built in the `clef` repository against a frozen contract
(`contract/decision-service.md`) with an evidence harness: every acceptance
criterion is a check that must be able to fail. Eight of eight criteria, eight
mutations proven, and an independent re-run from a clean checkout of the
merged branch — by a reviewer that was not the author.

## Tests

```
node --experimental-strip-types --no-warnings scripts/test-clef.mjs
bash scripts/run-clef-status-test.sh
```

The hooks are driven with synthetic events — no live Pi session needed. The
status test needs a service to read, so the wrapper starts the pinned stub in
`scripts/stub-service.mjs` and tears it down afterwards.
