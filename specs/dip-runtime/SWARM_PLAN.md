# dip Runtime — Execution Plan

**Status:** Waves 1–3 command surface complete. The next increment is one research-ADW vertical slice; ENG-74 remains open for the later opt-in live smoke.
**Updated:** 2026-08-14
**Tracker:** Plane `ENG` is authoritative. Local Beads clones execution state.

---

## Dependency Graph

```
ENG-68 spec ────────────────────────────────────────────── ✓ Done
  │
  ├── ENG-69 runtime core (types/runtime/gates) ────────── ✓ Done
  ├── ENG-70 createAgentSession delegate ───────────────── ✓ Done
  └── ENG-71 agent prompts + YAML configs ──────────────── ✓ Done
                        │
                        └── ENG-72 first .dip pipelines ── ✓ Done
                              │
                              ├── ENG-73 Acidbath /dip ─── ✓ Done
                              └── ENG-74 live E2E ──────── ○ Frontier
```

Wave 1 also added the deterministic test harness that ENG-74 originally
assumed would come last. ENG-74 is now a **live** smoke/validation ticket,
not the unit/replay suite.

---

## Shared contract

See `adw/types.ts`. The runtime, delegate, gates, and tests all import it.

```typescript
type PhaseKind = "agent" | "code" | "halt" | "engineer";

interface Envelope {
  status: "success" | "fail";
  summary: string;
  artifacts: string[];
  notes_for_next_agent: string;
}
```

`DipRuntime` never talks to Pi directly. Agent phases call an injected
`dispatchAgent`. Production wiring is `DelegateSystem.dispatchPi()`.

---

## Wave 1 — complete

| Ticket | Bead | Delivered |
|---|---|---|
| ENG-68 | bd-acid001 | Spec approved; architecture corrected to in-process TS |
| ENG-69 | bd-acid002 | `adw/types.ts`, `runtime.ts`, `gates.ts` |
| ENG-70 | bd-acid003 | `adw/delegate.ts` via `createAgentSession()` |
| ENG-71 | bd-acid004 | `adw/prompts/` + six `adw/agents/*.yaml` |

Follow-up that landed in the same wave: `adw/TESTING.md` and
`npm run test:adw` (49 tests: gates, runtime, delegate, determinism, replay e2e).

---

## Next increment — one research ADW vertical slice

This is the only new implementation track until it works end-to-end. It
refines the delegate/runtime boundary using the existing AGY research system;
it does **not** begin generic halt/resume or a multi-agent workflow redesign.

### R1 / bd-acid008 — research ADW contract + AGY bridge

1. Make `deep-research` the sole active ADW.
2. Define a small injected AGY research transport, equivalent to the existing
   injected agent transport, so tests can replay it without AGY or a live model.
3. Pass the already-registered AGY capability explicitly to the research path;
   do not patch, duplicate, or vendor the AGY extension.
4. Keep AGY unavailable to non-research roles.
5. Return the existing free-text `Envelope` contract, with bounded source
   artifacts when available, then halt for human review.

### R2 / bd-acid009 — research pipeline and `/dip` integration

- Update only `adw/pipelines/deep-research.dip` and its command path.
- Render bounded phase transitions through the existing activity rail; preserve
  Pi's tool-expansion preference.
- Use AGY for research rather than a direct `gemini-3.6-flash` agent model.
- Keep Wayfinder separate: when introduced later, it inherits the parent
  session model by default and offers an explicit model picker.

### R3 / bd-acid010 — replay evaluation, then opt-in live validation

- Add deterministic replay coverage for the research transport, phase order,
  gate, envelope shape, sources, and halt.
- Add an opt-in live AGY smoke only after R1/R2 pass. It asserts contracts,
  not generated prose.
- ENG-74 / bd-acid007 remains the authoritative Plane live-validation ticket;
  the local R3 bead is its scoped prerequisite and evidence trail.

### Deferred deliberately

- Halt/resume checkpoints and `/dip resume`.
- Generic custom-model selection beyond the later Wayfinder picker.
- Reviewer, builder, and other production ADWs.
- TypeBox or other structured-output contracts.

---

## Halt points

1. R1: review the AGY capability boundary and least-privilege tool policy.
2. R2: dogfood `/dip run deep-research` and halt for human review.
3. R3: review deterministic replay and the opt-in live result before resuming
   broader ADW work.

---

## Local Beads

Use `.beads/beads.py` while implementing. Plane remains the source of truth
for titles, descriptions, cycle membership, and Done/In Progress.

```bash
python3 .beads/beads.py frontier
python3 .beads/beads.py update bd-acid005 --status=in_progress
```
