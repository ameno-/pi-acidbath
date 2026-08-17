# dip Runtime — Architecture Validation

**Updated:** 2026-08-14
**Verdict:** 🟢 Architecture correction landed. Wave 1 runtime + tests exist.
**Open:** Live smoke test (ENG-74). Halt/resume is not implemented.

---

## Correction that was applied

The first draft specified a Rust `dip` CLI that subprocessed
`pi --print --mode json`. That is the wrong transport.

Pi already exports `createAgentSession()` from
`@earendil-works/pi-coding-agent`. Acidbath now uses that in-process:

```
Acidbath → DipRuntime → DelegateSystem.dispatchPi() → createAgentSession()
```

There is no Cargo project, no `dips/` directory, and no `pi --print` bridge.

---

## Current evidence

| Claim | Evidence |
|---|---|
| Runtime is TypeScript | `adw/runtime.ts`, `adw/delegate.ts`, `adw/types.ts`, `adw/gates.ts` |
| Delegate uses the SDK | `createAgentSession` + `ModelRuntime.getModel` |
| Empty tool list means no tools | `resolveTools([]) === []` and `tools` + `noTools: "all"` |
| Agent phases do not fake success | missing executor → fail envelope |
| Halt stops the run | `status: "halted"` |
| Orchestrator is deterministic | `adw/tests/e2e/replay-pipeline.test.mjs` — 50 identical + 20 concurrent replays |
| Typecheck covers ADW | `tsconfig.json` includes `adw/**/*.ts` |
| Suite is wired | `npm run test:adw` is part of `npm test` |

Last local validation: `npm test`, `npm run typecheck`, `npm run test:visual`.

---

## What is still unproven

- `/dip` is registered and calls `createDipRuntime()` in-process.
- Production pipelines exist and halt at their first review gate.
- No live model smoke test exists. That is intentional until ENG-74.

LLM generation remains non-deterministic. Tests therefore replay a recorded
agent transport. A live result must still satisfy envelope/gate/order
contracts; its prose must not be snapshotted.

---

## Risks still open

| Risk | Mitigation |
|---|---|
| Model names in agent YAML may be unavailable | Delegate fails before session creation if `ModelRuntime.getModel` misses |
| Homegrown YAML parser is a constrained subset | Keep `.dip` files inside the tested subset; do not add nested YAML |
| Halt/resume is not interactive yet | Runtime stops; Acidbath must later resume |
| Extension reload during a live run | ENG-73 must dispose sessions; do not add timers per phase |

---

## Decision recorded

Free-text envelopes plus gates are the v1 agent contract. A TypeBox
structured-output validator is a later ticket, not a Wave 2 blocker.
