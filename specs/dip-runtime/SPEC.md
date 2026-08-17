# dip Runtime — Architecture Spec

**Status:** Approved / Wave 1 complete
**Updated:** 2026-08-14
**Project:** Acidbath (`ENG`)
**Cycle:** Sprint 1: dip Runtime
**Extension:** `.dip` — pipeline definition files for orchestrating agent work

---

## North Star

A composable in-process TypeScript pipeline runtime that turns a single prompt
into a sequence of deterministic phases. Some phases dispatch work to headless
Pi sessions via `createAgentSession()`, some run local commands, some stop for
human validation. Each pipeline is a `.dip` file. Acidbath owns presentation
only; native Pi session content stays canonical.

The runtime is **not** a Rust CLI and does **not** subprocess `pi --print`.

## Core Concepts

### Pipeline (`.dip` file)

A pipeline is a sequence of phases. Each phase has a `kind`, an `agent` or
`command`, optional `gates`, and optional `prompt` text.

```yaml
name: "wayfind-and-implement"
description: "Full pipeline: wayfind → research → spec → implement → verify"

agents:
  wayfinder:
    model: ap-openai/gemini-3.6-flash
    tools: [read, grep, find, ls]
    system_prompts: [@context-budget.md]
  builder:
    model: ap-openai/glm-5p2-fw
    thinking: high
    tools: [read, edit, write, grep, find, ls, bash]
    system_prompts: [@ponytail-ladder.md, @karpathy-guidelines.md]
  reviewer:
    # Always write the provider prefix. A bare spec defaults to ap-openai, which
    # is how a copilot-* model resolves to a provider that does not serve it.
    model: ap-copilot/copilot-claude-sonnet-4.6
    tools: [read, grep, find, ls]
    system_prompts: [@context-budget.md]

phases:
  - id: wayfind
    kind: agent
    agent: wayfinder
    prompt: "Wayfind: {{prompt}}"
    halt: true

  - id: implement
    kind: agent
    agent: builder
    prompt: "Implement {{wayfind}}"

  - id: test
    kind: code
    command: "npm test"

  - id: review
    kind: agent
    agent: reviewer
    prompt: "Review against the plan"
    halt: true
```

Pipelines live in `adw/pipelines/`. Shared agent defaults live in
`adw/agents/*.yaml` and may be inlined or referenced by the pipeline.

### Phases

| Kind | Description |
|---|---|
| `agent` | Dispatches to a headless Pi session with the named agent's config |
| `code` | Runs a deterministic local command |
| `halt` | Completes, then stops the run for human validation |
| `engineer` | Completes, then stops the run for human input |

`halt: true` on any phase also stops the run after that phase succeeds.

### Typed phase output

An `agent` phase may declare `output: <schema>`, naming one of the schemas in
`adw/envelope.ts` (`generic`, `research`, `brainstorm`, `build`, `review`). The
agent is then handed one extra tool — `submit` — whose parameters *are* that
schema, and the phase does not complete until it is called. The prose handoff
is withheld when a schema is present: asking for a written report *and* a
structured submission reliably produces both.

`submit_mode:` decides what happens when the agent finishes without submitting:

| Mode | Behaviour |
|---|---|
| `strict` (default) | Fail the phase. The final message is carried in `notes_for_next_agent` so a refusal is distinguishable from an error. |
| `permissive` | Accept the final message as an unstructured summary, with `submit_missing: true` on the envelope. None of the schema's fields will be present. |

An unknown schema name or mode fails that phase before it dispatches, rather
than silently downgrading it — the parser drops unrecognized keys in silence,
so a typo would otherwise vanish.

### Model preflight

Before the first phase dispatches, every agent the pipeline names is resolved
through the same `parseModelSpec` + `ModelRuntime.getModel` pair a dispatch
uses. An unresolvable model refuses the whole run with the fix named, instead
of surfacing one phase at a time after work has been paid for. `node
adw/run.mjs --preflight` runs the same check over the entire agent catalog.

Resolution is not reachability: a model can resolve locally and still be
rejected by the gateway.

### Agents

Agent definitions specify:

- Model (`provider/model` or `provider/model:thinking`)
- Optional `thinking` level
- Tool allowlist (empty list means **no tools**)
- System prompt fragments from `adw/prompts/`
- Optional write path globs

Ponytail is extracted as a prompt fragment. It is not vendored as a Pi
lifecycle extension.

### Envelopes

Every phase returns a typed envelope. Later phases consume earlier summaries
via `{{phase-id}}` templates.

```typescript
interface Envelope {
  status: "success" | "fail";
  summary: string;
  artifacts: string[];
  notes_for_next_agent: string;
  agent_name?: string;
  phase_id?: string;
  model_used?: string;
  duration_ms?: number;
  usage?: {
    tokens: number;
    cost: number;
    input_tokens: number;
    output_tokens: number;
  };
}
```

Subtypes (`PlanOutput`, `BuildOutput`, `ReviewOutput`, `ScoutOutput`) exist
for later structured-output validation. Live LLM prose is not a determinism
oracle; orchestration, gates, ordering, and envelope shape are.

### Gates

Gate functions run after a phase completes. A failed gate fails the phase and
stops the pipeline.

Built-ins:

- `always_pass` — default when no gates are listed
- `artifacts_exist` — verify listed artifact paths exist
- `diff_non_empty` — fail empty unsuccessful diffs

Unknown gate names currently fall back to `always_pass`. New gates must be
explicit and tested.

---

## Runtime Surface

There is no standalone `dip` binary. The public surface is TypeScript:

```
adw/runtime.ts     DipRuntime — parse, execute, halt, gates
adw/delegate.ts    DelegateSystem — createAgentSession() transport
adw/types.ts       shared contracts
adw/gates.ts       gate predicates
```

Acidbath will expose `/dip` as a Pi slash command that calls `DipRuntime`
in-process and renders progress events. That command is not implemented yet.

Useful local commands:

```bash
npm run test:adw
npm test
npm run typecheck
```

---

## Architecture

```
Pi session (parent)
  /dip run wayfind-and-implement "Design auth"
        │
        ▼
Acidbath extension (presentation only)
        │
        ▼
DipRuntime (adw/runtime.ts)
  1. Parse .dip
  2. Resolve agent configs
  3. For each phase:
       agent → DelegateSystem.dispatchPi() → createAgentSession()
       code  → injected / local command
       halt  → emit halt, stop run
  4. Verify gates
  5. Accumulate envelopes
  6. Emit DipProgressEvent callbacks
        │
        ▼
Acidbath activity / status widgets
```

### Delegation transport

```typescript
class DelegateSystem {
  async dispatchPi(request: PiDispatchRequest): Promise<PiDispatchResult> {
    // Resolve model via Pi ModelRuntime
    // Apply explicit tool allowlist
    // createAgentSession({ model, tools, noTools: "all", ... })
    // session.prompt(...) + waitForIdle()
    // Wrap last assistant text in an Envelope
  }
}
```

`DipRuntime` accepts an injected `dispatchAgent`. Production wiring should
pass `DelegateSystem.dispatchPi`. Tests inject a recorded transport.

---

## File layout

```
acidbath/
├── adw/
│   ├── runtime.ts
│   ├── delegate.ts
│   ├── types.ts
│   ├── gates.ts
│   ├── TESTING.md
│   ├── agents/
│   ├── pipelines/
│   ├── prompts/
│   └── tests/
├── extensions/acidbath/          ← /dip command (not yet)
└── specs/dip-runtime/
    ├── SPEC.md
    ├── SWARM_PLAN.md
    ├── VALIDATION.md
    └── TESTING.md                ← points at adw/TESTING.md
```

---

## Determinism

The orchestrator is deterministic given a fixed `.dip`, prompt, clock, run ID,
shell executor, and agent transport. `adw/tests/e2e/replay-pipeline.test.mjs`
replays a complete pipeline 50 times and concurrently with no drift.

Agent *prose* is not snapshot-tested. A later structured-output contract can
make agent outcomes schema-checked without claiming byte-identical LLM text.

---

## Implementation sequence

### Done — Wave 1

1. Architecture correction: TypeScript + `createAgentSession()`
2. `adw/types.ts`, `runtime.ts`, `gates.ts`
3. `adw/delegate.ts`
4. Prompt fragments and six agent YAML configs
5. Deterministic unit + replay e2e suite

### Remaining — Wave 2 / 3

6. Wire `DipRuntime` to `DelegateSystem` and load `adw/agents/*.yaml`
7. First production pipelines: `wayfind-and-implement`, `deep-research`, `quick-fix`
8. `/dip` Acidbath command and activity-widget progress
9. Live smoke test against an approved model (envelope/gate contracts only)

---

## Non-goals

- Vendoring Ponytail, pi-dynamic-workflows, or other third-party Pi plugins
- Patching Pi or rewriting terminal scrollback
- A separate Rust/Cargo CLI
- Silent tool-expansion overrides
- Live-model snapshot tests
