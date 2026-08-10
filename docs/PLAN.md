# Acidbath Umbrella — Integration Roadmap

Status: **Implementation in progress.** Visual appearance changes remain human-gated; the approved V1 label infrastructure is wired. All facts are cited to file paths or fetched repos; inferences are labeled.

Companion visuals (open in a browser):
- `docs/visuals/architecture-overview.html` — umbrella architecture + 4 topology profiles
- `docs/visuals/dynamic-labels.html` — orb state machine, V1 deterministic / V2 adaptive
- `docs/visuals/adoption-matrix.html` — community tool adoption decision matrix
- `docs/visuals/roadmap.html` — phased implementation roadmap
- `docs/visuals/ui-revisit.html` — compact UI alternatives plus context-pyramid prototype
- `docs/context-pyramid-spec.md` — pure pyramid model and widget contract
- `docs/ui-tool-display-research.md` — pi-tool-display/pix pattern review and own-version plan

---

## 0. Round-2 decisions (supersede prior entries)

Applied from your answers on 2026-08-06. Where these conflict with later sections, this block wins.

1. **Delegation and research are separate surfaces.** `pi-subagents` remains the delegation surface. AGY is not vendored from pi-herdr; the canonical `ameno-/pi-research` package is now bundled into Acidbath as the core web-research surface. `research-bridge` remains dropped because it depends on the AGY master pane. The vendored "heritage" set from pi-herdr is **scheduler + cockpit only** (both render-only/state).
2. **`web_search` is dropped** (orphan). The `explore` profile no longer lists it; web work goes through the `agent-browser` skill and `pi-subagents` researcher lanes.
3. **`pi-codex-tools` `apply_patch` is kept** and auto-disables on macOS (it already fails-closed on non-Linux). The portable streaming-render pattern ships everywhere.
4. **Eval rubric = scored-matrix-only first pass** (compat/maintenance/license/security/perf/operational-risk per tool). No `measure.sh` objective benchmark yet — added later if needed.
5. **Skills remain canonical in `/Users/ameno/dev/lib` and are exposed cross-agent without duplicate authorship.** Mechanism (see §6.1): add a lib-managed `pi` build target and expose its generated `dist/pi/skills/` view through acidbath's `pi.skills` manifest (or use direct canonical paths only as a temporary development shortcut — human decision pending); other agents use lib's existing `scripts/skills deploy <platform>` symlink deployment. Do **not** symlink into `~/.pi/agent/skills/`.
6. **`pi-lens` is ADOPTED, scoped to the `debug` profile behind a gate.** It is MIT, very active, and real-time LSP/linter feedback fits `debug`. The original "defer" was perf-weighting: the gate (load only when `PI_ACIDBATH_PROFILE=debug` or an env flag is set) keeps `default`/`explore`/`eval` from paying LSP server-management cost. Revised decision in §3/§8.
7. **Eval profile freezes motion** (`PI_ACIDBATH_REDUCED_MOTION=1`, `PHASE=3`). Confirmed.

Profile tool sets after reconciliation:

| Profile | Tools | Delegation | Notable gates |
|---|---|---|---|
| default | read,bash,edit,write,grep,find,ls | none | scheduler injection if Herdr |
| debug | read,grep,find,ls,bash(read-only) | none (no fan-out) | +pi-lens (LSP, gated); edit/write off |
| eval | read,grep,find,ls | pi-subagents read-only reviewer/oracle jury (≤3 lanes) | motion frozen; zero write/network/bash |
| explore | read,grep,find,ls | pi-subagents scout/researcher | +agent-browser skill (web); edit/write off |

---

## 1. Executive Brief

Acidbath is a clean, deterministic, event-driven Pi UI package (acidbath header, semantic orb, tool lifecycle motion, optional context pyramid, theme) extracted from `pi-herdr`. It is the **umbrella**: one package that owns UI, bundles the canonical `ameno-/pi-research` AGY research capability, wires skills, and adds custom tool rendering and topology profiles. AGY execution remains explicit and permission-gated.

Three findings drive the plan:

1. **The umbrella consolidation is low-risk and mostly mechanical.** Acidbath loads correctly today (bare path in `packages`, outside the `!extensions/**` blocklist, valid manifest). The selected pi-herdr extensions already import `@earendil-works/pi-*` (the installed namespace), so vendoring them into acidbath's tree compiles against the same runtime. The one hard rule: **do not bring `pi-herdr-ui.ts` into acidbath** — it registers the same `/orb` and `/motion` commands and the same indicator hooks, which would collide. Acidbath already owns those.

2. **The dynamic-label work is now wired and deterministic.** The orb state machine in `index.ts` maps every agent/tool/provider event to a state. V1 is the pure `synthesizeLabel(event, toolName, renderArgs, flags)` function next to `ui-motion.ts`/`ui-gauge.ts`, wired through `apply()` with a bounded 100ms trailing debounce and same-string churn guard. There is no model output parsing; the richest deterministic signal is the tool renderer's `args` (`file_path`, `command`, `pattern`), not free-form result content. Thinking-block content is **out of scope** for V1 and gated behind a typed `intent` field for V2.

3. **The ecosystem already has the pieces you want; the work is selection + wiring, not invention.** `pi-subagents` (2.9k★, MIT, released today) gives the subagent/fleet surface. `pi-autoresearch` (7.5k★, MIT) is literally an eval/experiment loop — a perfect harness for "eval the tools." `oh-my-pi/metaharness` (22.5k★, MIT) is the serious benchmark manager for Phase 4. `pi-codex-compaction` + `pi-codex-tools` extend the Codex path you already use. `visual-explainer` (9.4k★, MIT) is **already in your packages array but filtered** — fixing that is a one-line win for the visual-deliverable requirement. `pi-ast-grep` and `pix-bash` give the structural-search and framed-output patterns.

The roadmap is five phases: instrument baselines → deterministic labels → tool wrappers/perf → extension integrations → sandbox/eval infra. Every recommendation carries a rollback. Total estimated effort is medium; the highest-risk item is the eval/sandbox harness (Phase 4), which is why it is last and spec-only for now.

---

## 2. Current-State Inventory (active / filtered / blocked + why)

Source: `~/.pi/agent/settings.json`, each package's `package.json`, `LS` of install dirs, `pi-herdr/scripts/launcher.sh`.

| Name | Source | Status | Why | Declared surfaces |
|---|---|---|---|---|
| acidbath | `/Users/ameno/dev/acidbath` (bare path) | **active** | Outside `~/.pi/agent/**` blocklist; valid manifest; files present | ext `./extensions/acidbath/index.ts`; themes `./themes/*.json` |
| pi-interactive-shell | `npm:pi-interactive-shell@0.14.0` | **active** | npm; not under blocklist; loadable surface | ext (declared) |
| acidbath-cyberdyne-teal | via acidbath `pi.themes` | **active** | Loaded through acidbath theme glob; selected by `theme` setting | theme JSON |
| session-replay | `~/.pi/agent/extensions/session-replay` | **filtered** | Physical path under `!extensions/**` blocklist (blocklist wins over `packages` for paths under `~/.pi/agent/`) | ext `./session-replay.ts` (file exists) |
| damage-control | `~/.pi/agent/extensions/damage-control` | **filtered** | Same blocklist reason | ext `./damage-control.ts` (exists) |
| tool-status | `~/.pi/agent/extensions/tool-status` | **filtered + broken** | Blocklist **and** declared `./tool-status.ts` is missing (dir has only `package.json`) | ext (file absent) |
| council | `/Users/ameno/dev/pi-ext/.pi/council` | **filtered** | Manifest malformed: `pi.extensions: ["extensions"]` (bare string, no `./`, no `.ts`); actual file is `extensions/council-review.ts` | ext `"extensions"` (malformed) |
| pi-minimax-mcp | `/Users/ameno/dev/pi-minimax-mcp` | **filtered** (inferred) | Valid manifest + files, outside blocklist → should load. Inferred cause: `peerDependencies` use `@mariozechner/pi-*` while runtime is `@earendil-works/pi-*` (namespace mismatch) | ext `./src/extensions/index.ts`; skill `./skill/SKILL.md` |
| pi-screenshots-picker | `npm:pi-screenshots-picker@1.2.2` | **filtered** (inferred) | Not inspected; inferred empty/missing `pi.extensions` | unknown |
| visual-explainer | `github:nicobailon/visual-explainer@528b71f` | **filtered** (inferred) | Declares `pi.extensions`/`skills`/`prompts` in its manifest; filtered cause unverified locally (likely empty-surfaces or prompt blocklist) — re-verify with `pi list`/debug | ext + skill + prompts |
| @plannotator/pi-extension | `npm:@plannotator/pi-extension@0.25.0` | **filtered** (inferred) | Not inspected | unknown |
| pi-ask | `github:eko24ive/pi-ask@2bba854` | **filtered** (inferred) | Not inspected | skill |
| pi-herdr | `/Users/ameno/dev/pi-herdr` | **not in main session** | Not in `packages`; `package.json` has no `pi` field; loads only via `launcher.sh --extension` in a separate companion pane | ext (explicit `--extension`); skills; prompt |
| global skills | `~/.pi/agent/skills/**` | **blocked** except 5 | `skills: ["!skills/**", "+agent-browser", "+gotem", "+herdr", "+mmx-cli", "+react-native-dev"]` | 5 allowlisted |
| global prompts | `~/.pi/agent/prompts/**` | **blocked** | `prompts: ["!prompts/**"]` | none |
| global extensions | `~/.pi/agent/extensions/**` | **blocked** | `extensions: ["!extensions/**"]` | none |

**Loading mechanics (verified):** `packages` entries resolve a manifest's `pi.extensions`/`pi.themes`/`pi.skills`/`pi.prompts`. A bare path entry behaves like `{path}`. The `!root/**` blocklists are **path-rooted at `~/.pi/agent/`** and filter surfaces whose physical path falls under those roots, **even when the package is also in `packages`** — this is why the three `~/.pi/agent/extensions/*` packages are dead. `pi-herdr/launcher.sh` bypasses all discovery with `--no-extensions --no-skills --offline` + explicit `--extension <file>` / `--skill <file>` absolute paths.

**Implications:** (1) safety posture is intact but coarse; (2) the three `~/.pi/agent/extensions/*` packages are dead weight — relocate or drop; (3) `tool-status` and `council` are broken regardless; (4) `pi-minimax-mcp` needs a peer-dep namespace migration to join the umbrella; (5) `~/.pi/agent/keybindings.json` does **not** exist (only the acidbath `config/keybindings.example.json` template).

---

## 3. Adoption Matrix (community repos / tools)

Scores: 1–5 (5 best). "Fit" = alignment to umbrella + your stated lanes. Read-only inspection only; no execution this session.

| Repo | Stars | License | Activity | Fit | Maint. | Sec | Perf | Op-risk | Decision | Rationale |
|---|---|---|---|---|---|---|---|---|---|---|
| nicobailon/pi-subagents | 2.9k | MIT | daily (v0.42.1 today) | 5 | 5 | 4 | 4 | 3 | **Adopt (P3)** | Subagent/fleet/workflowScript surface acidbath needs; MIT; very active. Watch cmd-name collisions (it registers `subagent_wait`, not `/orb`) |
| davebcn87/pi-autoresearch | 7.5k | MIT | monthly (v1.6.2) | 5 | 4 | 4 | 4 | 3 | **Adopt (P4)** | Autonomous experiment loop = the tool-eval harness you asked for; `.auto/` persistence survives compaction; MAD confidence scoring |
| can1357/oh-my-pi metaharness | 22.5k | MIT | weekly | 4 | 5 | 4 | 5 | 4 | **Study (P4)** | Serious benchmark manager (experiment→run→trace, SQLite, REST/SSE, dashboard). Borrow the model; don't hard-depend — it's large + container-oriented |
| jvm/pi-codex-compaction | 14 | MIT | daily (v0.1.1) | 4 | 4 | 4 | 5 | 2 | **Adopt (P2)** | Codex RemoteCompactionV2 for long Codex sessions; you run `copilot-gpt-5.3-codex`; direct perf win |
| jvm/pi-codex-tools | 14 | Apache-2.0 | daily (v0.1.3) | 4 | 4 | 4 | 4 | 3 | **Adopt pattern + tool (P2)** | `apply_patch` for Codex + **streaming diff preview rendering** = exactly the custom-tool-render pattern Lane C wants |
| xynogen/pix-bash (pix-mono) | 44 | MIT | daily | 4 | 4 | 4 | 5 | 3 | **Adopt pattern (P2)** | Framed output + auto-collapse after delay + exit-code summary. Reimplement the pattern in acidbath wrappers; decide pix-pretty dep vs inline |
| apmantza/pi-lens | 312 | MIT | daily (3.3k commits) | 4 | 5 | 3 | 3 | 3 | **Adopt (P3, debug-scoped)** | Real-time LSP/linter/formatter + ast-grep feedback; MIT; very active. Heavy LSP server surface → gated to `debug` profile only so default/explore/eval never pay the cost |
| nicobailon/visual-explainer | 9.4k | MIT | 2mo stale (v0.8.1) | 5 | 3 | 4 | 4 | 2 | **Adopt now (P1)** | Already in your `packages` but filtered; unblock it to satisfy the visual-deliverable requirement. Low risk |
| davis7dotsh/my-pi-setup | 950 | — | weekly | 3 | 4 | 3 | 3 | 3 | **Study (P4)** | `workflows/sandbox-child.cjs` sandbox pattern + cross-harness subagent skill (pi/claude/codex). Borrow sandbox pattern; subagent skill overlaps pi-subagents |
| bjoernaagaard/pi-ast-grep | 0 | Apache-2.0 | daily (v0.4.2) | 4 | 3 | 4 | 4 | 2 | **Adopt (P3)** | 6 ast-grep tools (run/scan/rewrite/outline) + skill + runtime promotion. Small, standalone, low risk; complements `grep` with AST search |
| ast-grep (upstream) | — | MIT | active | — | — | — | — | — | **Prerequisite** | Binary `ast-grep` ≥0.44 on PATH (or `AST_GREP_BIN`) for pi-ast-grep |
| can1357/oh-my-pi coding-agent/tools | (in oh-my-pi) | MIT | daily | — | — | — | — | — | **Reference only** | This is the Pi upstream tool source (bash/edit/read/grep/browser/computer/eval). Read for rendering patterns; never depend |

**Recommended adoption order:** visual-explainer (unblock) → pi-codex-compaction + pi-codex-tools (perf) → pix-bash pattern (rendering) → pi-subagents (subagents) → pi-ast-grep (structural) → pi-autoresearch (eval loop) → metaharness/pi-lens (advanced, later).

---

## 4. Dynamic-Label Spec (V1 deterministic / V2 adaptive)

### V1 — pure deterministic label synthesis

A pure function sibling to `ui-motion.ts`/`ui-context-pyramid.ts` (unit-testable without booting Pi). **No timers, no model output parsing, O(1).**

Signature (spec):
```ts
// extensions/acidbath/ui-labels.ts  (pure helper; wired by index.ts)
interface LabelInput {
  event: "agent_start"|"before_provider_request"|"after_provider_response"
       | "message_update"|"tool_call"|"tool_result"|"agent_end";
  toolName?: string;                       // confirmed on tool_call
  toolArgs?: Record<string, unknown>;      // renderCall args (render-time only)
  isPartial?: boolean; isError?: boolean;  // render-time lifecycle flags
  editedFilesThisTurn?: Set<string>;       // V1.1 aggregate, reset on agent_end
}
interface LabelOutput { orbState: OrbState; message: string; }  // reuse ui-orb OrbState
function synthesizeLabel(input: LabelInput): LabelOutput;        // pure, no ctx/pi/tui
```

Deterministic label vocabulary (confirmed fields only):

| Event / condition | orbState | message |
|---|---|---|
| `agent_start` | solving | `Solving…` |
| `before_provider_request` | listening | `Waiting for provider response…` |
| `after_provider_response` | solving | `Reasoning over response…` |
| `message_update` | composing | `Composing reply…` |
| `tool_call` read/grep/find/ls/search/web_search | searching | `Searching…` / `Searching in {path}` (render args) |
| `tool_call` edit/write/apply_patch | shaping | `Editing {file_path}` / `Writing {file_path}` (render args) |
| `tool_call` bash | working | `Running command…` (truncated `args.command`) |
| `tool_call` agy_subagent/complete_research_request | working | `Working on {subagent}…` (args.subagent) |
| `tool_call` other | working | `Running {toolName}…` |
| `tool_result` success (edit/write) | solving | `Edited {basename}` (V1.1: `Edited {n} files`) |
| `tool_result` success (bash) | solving | `Command finished` |
| `tool_result` error | solving | `{toolName} failed` (from `isError`) |
| `agent_end` | working | *(cleared)* |

**Feasibility of the three example labels:** "waiting for provider response" = yes (`before_provider_request`); "working on droid (tool call)" = yes (`event.toolName`); "applied edit to X files" = **not from a single event** — aggregate distinct successful edit/write `file_path`s across a turn in the renderer, reset on `agent_end`. **Do not parse `tool_result.content`** (free-form, tool-specific, unverified).

### V2 — optional adaptive intent (gated)

Additive: `synthesizeLabel` calls `intentProvider?.refine(...) ?? v1Fallback`. `refine` is synchronous, ≤1ms, fail-open. **Safe signals only:** tool `details` objects (agy already returns `details.subagent`), structured `[subagent-result]` envelopes, or a future **typed** `event.intent` field gated by capability check. **Raw thinking text remains permanently out of scope for label synthesis and state inference.** The live activity widget may render a terminal-safe, bounded tail preview of provider-supplied thinking as display-only content; it does not feed `synthesizeLabel`, session context, or tool decisions.

### Latency / perf budget

- Max label-update frequency: 1 per ~100ms (align to fastest clock: orb 95ms / motion 100ms).
- Trailing-edge debounce 100ms so `tool_call→tool_result` produces one label, not two flashes.
- Churn guard: call `setWorkingMessage` **only when the message string changes** (mirror the gauge's `alreadySettled` no-op).
- One bounded 100ms debounce timer is owned by the label controller; no per-tool label timers are created. V2 `refine` ≤1ms or skip.

---

## 5. Custom-Tools Perf Plan

Patterns shortlisted (from pix-bash, pi-codex-tools, oh-my-pi coding-agent/tools, acidbath's existing `ui-tools.ts`):

| Pattern | Source | Benefit | Perf impact | Risk | Adopt? |
|---|---|---|---|---|---|
| Lifecycle glyph wrap (current) | acidbath `ui-tools.ts` | Compact pending/success/error glyph + shared `MotionClock` | One `ToolLifecycleComponent` per active call; timer only while ≥1 pending | Low | Keep (baseline) |
| Framed full-width output + exit-code summary | pix-bash | Readable results; consistent rule frame | Single render pass; no per-line cost | Low | **Adopt** in wrappers |
| Auto-collapse after delay (default 10s) | pix-bash (`pix-runtime/collapse`) | Recovers terminal real estate; reduces scroll churn | One timer per completed call, cancelled on expand | Medium (timer mgmt) | **Adopt** (configurable, default off initially) |
| Streaming diff preview + running +/- tally | pi-codex-tools `apply_patch` | Live write-style glimpse while tool generates | Tolerant partial scanner on stream; reuses `renderDiff` | Medium (parser tolerance) | **Adopt** for edit/write wrappers |
| Header/body count parity (semantic count reuse) | pix-bash `ruleFrame` | No header/body mismatch | O(1) | Low | **Adopt** |
| `useless` result tagging + compaction drop | oh-my-pi coding-agent | Prune uneventful tool results from context | Reduces token growth over long sessions | Low | **Study** (needs upstream support) |
| Bounded output + truncation notice | pi-ast-grep, pi-codex-tools | Prevents context blowup | O(output) cap | Low | **Adopt** |

**Built-in vs wrapped vs replaced:**

| Tool | Decision | Reason |
|---|---|---|
| read, grep, find, ls | **wrapped** (render only) | Execution fine; add framed output + collapse |
| bash | **wrapped** (render) + optional **read-only variant** for `debug` profile | pix-bash-style framing; read-only wrapper rejects mutating argv |
| edit, write | **wrapped** (render + streaming diff) | pi-codex-tools streaming preview pattern |
| apply_patch | **added** (Codex models only) via pi-codex-tools | Distinct grammar tool; capability-gated |
| subagent delegation (pi-subagents) | **added** via `pi-subagents` (replaces agy/research-bridge) | Subagent/research lanes; acidbath renders lifecycle |
| ast_grep_* | **added** via pi-ast-grep | Structural search |
| web_search | **dropped** (orphan) | Web work via `agent-browser` skill + pi-subagents researcher |

**Benchmark plan (spec; execution deferred to P0/P2):**

| Metric | Method | Acceptance threshold |
|---|---|---|
| Tool-render overhead | `performance.now()` around `renderCall`/`renderResult` for 1k synthetic calls | < 0.5ms/call median |
| Timer count | Assert `MotionClock` + collapse timers cleared after all calls complete (no leaked refs) | 0 active timers at idle |
| Context-token growth | Token-count tool results before/after `useless` pruning across a 50-turn fixture | ≤ baseline (no regression) |
| Label churn | Count `setWorkingMessage` calls for a 20-event burst fixture | ≤ 1 per 100ms window; 0 redundant (same-string) calls |
| Streaming preview correctness | Fixture: partial patch → assert +/- tally + file roster match final | 100% parity with executed result |

**Eval harness for tools (the user's explicit priority):** adopt `pi-autoresearch`'s experiment-loop model (try/measure/keep/revert) wrapped around a tool-specific `measure.sh` + `checks.sh`. Phase 4 stands up a `config/tool-evals/` directory with one eval per candidate tool, MAD confidence scoring, `.auto/` persistence. Read-only rubric first (next deliverable section), then execution.

---

## 6. Topology Profile Spec (default / debug / eval / explore)

Selection mechanism (recommended): `--profile <name>` launcher flag or `PI_ACIDBATH_PROFILE` env, applied by composing explicit `--extension`/`--skill`/`--tools`/`--thinking` from a `config/profiles.json`, always starting from `--no-extensions --no-skills --offline` (keeps global discovery blocked). Switching = relaunch the pane (tools register at `session_start`; `setActiveTools` is additive-only and cannot safely remove tools mid-session). A read-only `/topology [name]` command prints the active profile + emits the relaunch command. See `docs/visuals/architecture-overview.html`.

| Profile | Tools enabled | Wrapped/Replaced | Skills | Model/Thinking | Safety | Workflow | Perf envelope |
|---|---|---|---|---|---|---|---|
| **default** | read,bash,edit,write,grep,find,ls | all wrapped (lifecycle) | approved lib Pi roster (pending) | copilot-gpt-5.3-codex / high | Pi defaults; bash unrestricted | Day-to-day coding | baseline + ~1.8K tok/turn scheduler injection (if Herdr) |
| **debug** | read,grep,find,ls,bash | bash → read-only wrapper (rejects mutating argv); edit/write disabled; +pi-lens (LSP/linter feedback, profile-gated) | approved lib Pi roster (pending) | codex / medium | No edit/write; read-only bash; pi-lens approval-gated; no subagent fan-out | Reproduce-and-inspect; real-time diagnostics | + LSP server mgmt (pi-lens); no fan-out |
| **eval** | read,grep,find,ls | all wrapped; motion frozen (REDUCED_MOTION=1, PHASE=3); +pi-subagents (read-only reviewer/oracle jury, ≤3 lanes, no edit/write tools in children) | approved lib Pi roster (pending) | codex / high driver; jury lanes pinned | Zero write/network/bash; every subagent call approval-gated; jury ≤3 lanes, ≤180s | Metaharness-style jury eval via pi-subagents; deterministic render | fan-out per pi-subagents; no scheduler injection |
| **explore** | read,grep,find,ls | bash disabled/read-only; +pi-subagents (scout/researcher lanes) | approved lib Pi roster (pending), agent-browser | codex or long-ctx Claude/Gemini / high | No edit/write; agent-browser approval-gated; subagent sandbox policy | Open research; codebase mapping; fleet cockpit view | highest token budget; +fan-out +cockpit 100ms tick |

Per-profile safety self-check (spec): on `session_start`, assert active tool set matches the profile's expected allowlist (read from `PI_ACIDBATH_PROFILE` + `config/profiles.json`); for `eval` assert `edit`/`write`/`bash` absent from `pi.getActiveTools()`; warn + freeze motion on mismatch.

### 6.1 Skills wiring (lib-owned source, design)

Goal: expose selected skills to Pi and the other agents without duplicating
authorship or fighting Pi's global `!skills/**` blocklist. The canonical
source is `/Users/ameno/dev/lib`, not `acidbath/skills`. See
`docs/skills-lib-integration.md` for the evidence and unresolved choice.

**Current lib facts:** `registry.yaml` has 54 entries and no `pi` platform;
ordinary skills target `codex`, `claude`, `factory`, and `antigravity`.
`/Users/ameno/dev/lib/scripts/skills build` generates disposable
`dist/<platform>/skills/<name>` symlink mirrors, while `deploy <platform>`
symlinks canonical packages into the agent's install root. The old example
names `focused-delivery` and `herdr` are not currently present in the lib
registry and must not be placed in the acidbath manifest as if they existed.

**For Pi — pending platform decision.** Add a `pi` platform to lib's
`registry.yaml`, select the initial skills by adding `pi` to their
`build_targets`, and generate `dist/pi/skills/` mirrors. The human must choose
whether acidbath's `pi.skills` manifest points at those generated mirrors
(recommended durable contract) or directly at canonical
`/Users/ameno/dev/lib/skills/<name>` paths (development-only shortcut). In
both cases, do **not** symlink anything into `~/.pi/agent/skills/`; the
acidbath package surface remains outside the global blocklist.

Illustrative shape only; do not apply until the source/target choice and skill
roster are approved:

```jsonc
"pi": {
  "extensions": ["./extensions/acidbath/index.ts"],
  "themes": ["./themes/*.json"],
  "skills": [
    "/Users/ameno/dev/lib/dist/pi/skills/<approved-skill>"
  ]
}
```

**For other agents — use lib's deploy command.** Do not create the previously
proposed acidbath-owned `scripts/install-skills.sh` symlink farm. Use
`~/dev/lib/scripts/skills deploy codex`, `deploy claude`, or `deploy factory`
for the platform roots declared by lib. If a thin acidbath launcher is later
needed, it must delegate to that CLI rather than maintain an independent
roster, lockfile, or source directory. The Antigravity root is likewise owned
by lib's registry/deploy model.

**Net:** one canonical skill source in lib; a generated, reviewable Pi view;
Pi loads only through acidbath's package manifest; other agents use lib-owned
symlinks; and global discovery remains blocked.

---

## 7. Implementation Roadmap

| Phase | Goal | Key items | Exit criteria | Risk / rollback |
|---|---|---|---|---|
| **P0 — Instrument + baselines** | Measure before changing | Add perf harness (`scripts/bench-tool-render.mjs`); capture baseline metrics from §5; fix `visual-explainer` loading (unblock filtered package); clean dead `packages` entries | Baseline numbers committed to `docs/baselines.md`; visual-explainer renders HTML | Low; rollback = revert settings entry |
| **P1 — Deterministic UI status** | V1 labels | **Complete:** `ui-labels.ts` pure helper; `apply()` wiring with churn guard + 100ms debounce; tool-renderer label hook. `/orb-intent on\|off` remains deferred for V2 | Unit tests for `synthesizeLabel`; label-churn benchmark passes §5 threshold; bounded timer is cleared on shutdown | Low; rollback = keep `ORB_LABELS` path |
| **P2 — Tool wrappers / perf** | Rendering + compaction | Vendor framed-output + auto-collapse + streaming diff preview into acidbath tool wrappers; adopt `pi-codex-compaction`; optionally `pi-codex-tools` apply_patch (Codex) | §5 benchmark thresholds met; no leaked timers; streaming parity 100% | Medium; rollback = keep current `registerToolMotionRenderers` |
| **P3 — Extension integrations** | Umbrella consolidation | Vendor pi-herdr **scheduler + cockpit only** (render-only heritage; agy + research-bridge dropped — superseded by pi-subagents + your agent-delegation system); add `config/profiles.json` + `scripts/launcher.sh --profile`; adopt `pi-subagents` (delegation surface) + `pi-ast-grep` + `pi-lens` (debug-scoped, gated); add lib-managed `pi` skill target + `pi.skills` manifest; use lib's `scripts/skills deploy <platform>` for other agents | `/topology` works; profiles load via explicit flags; no `/orb`/`motion` collision; pi-lens loads only in debug; approved skills load in Pi and deploy from lib to other agents | Medium-High; rollback = drop heritage entries from `pi.extensions`, remove Pi skill entries, and remove lib-managed symlinks |
| **P4 — Sandbox / eval infra** | Tool evals + scored rubric | Stand up `config/tool-evals/` on pi-autoresearch experiment-loop model; per-tool **scored matrix** (compat/maint/license/sec/perf/op-risk) first pass; MAD confidence scoring added when objective benchmarks are introduced later; (study) metaharness trace model | One scored matrix per adopted tool; confidence scores when benchmarks added | High; rollback = evals are additive, disable profile |

---

## 8. Decision Log (adopt / defer / reject + rationale)

| Item | Decision | Expected benefit | Perf impact | Risk | Rollback |
|---|---|---|---|---|---|
| Acidbath = umbrella (absorb pi-herdr exts) | **Adopt** | One package, one `packages` entry, single source of truth | None (same code, new home) | Import remap misses → silent filter | Drop heritage entries from manifest |
| Bring `pi-herdr-ui.ts` into acidbath | **Reject** | — | — | `/orb`+`/motion`+gauge collision (HIGH) | n/a |
| V1 labels deterministic-only | **Adopt** | Predictable, testable, no model coupling | O(1), no new timers | Label churn | Fallback to `ORB_LABELS` |
| V2 thinking-derived lifecycle labels | **Reject (now)** | — | — | Non-deterministic, provider-variant | Keep thinking limited to the display-only live preview; revisit state inference only if typed `intent` ships |
| `pi-subagents` for subagents | **Adopt (P3)** | Fleet, workflows, async delegation | Subagent fan-out cost | Cmd-name audit needed | Disable package |
| `pi-autoresearch` for tool evals | **Adopt (P4)** | Experiment loop + confidence scoring | Loop runs burn tokens (cap via maxIterations) | Cost runaway | maxIterations + API key limits |
| `metaharness` | **Study (P4)** | Benchmark rigor | Container overhead | Large dep, Docker-oriented | Don't depend; borrow model |
| `pi-codex-compaction` | **Adopt (P2)** | Longer Codex sessions | None (compaction-time only) | Model/endpoint mismatch → falls back to Pi compaction | Remove package |
| `pi-codex-tools` apply_patch + streaming render | **Adopt pattern (P2)** | Codex-native patches + live diff preview | Streaming scanner | Linux-only for apply_patch; render pattern portable | Keep edit/write wrappers |
| `pix-bash` framed+collapse pattern | **Adopt pattern (P2)** | Readable output, reclaim space | One timer/completed call | Timer leaks | Default collapse off |
| `pi-lens` | **Adopt (P3, debug-scoped)** | Real-time LSP/linter/formatter diagnostics | LSP server mgmt (gated) | Heavy if unscoped; gated to `debug` profile | Disable in non-debug profiles |
| `agy` (from pi-herdr) | **Reject as an executor source** | — | — | Superseded by canonical `pi-research` | Use bundled `pi-research` instead |
| `research-bridge` (from pi-herdr) | **Drop** | — | — | Depends on AGY master pane; can't stand alone without agy | Use pi-subagents researcher instead |
| `web_search` tool | **Drop (orphan)** | — | — | Not a verified built-in; orphaned | Web work via agent-browser skill |
| `pi-codex-tools` apply_patch on macOS | **Keep, auto-disable** | Codex-native patches on Linux | None on macOS (inactive) | Already fails-closed on non-Linux | Pattern (streaming render) ships everywhere |
| Skills cross-agent sharing | **Adopt (lib manifest + deploy)** | One source, all agents | None | Pi blocklist if symlinked into `~/.pi/agent/skills` | Pi via lib-backed `pi.skills` manifest; others via lib's `scripts/skills deploy <platform>` |
| Eval rubric first pass | **Scored-matrix-only** | Comparable tool scoring | None | No objective benchmark yet | Add `measure.sh` later if needed |
| `visual-explainer` | **Adopt now (P1)** | Visual deliverables | None | Already installed/filtered | Revert settings |
| `pi-ast-grep` | **Adopt (P3)** | AST search complements grep | ast-grep binary spawn | New/0-star repo (well-built) | Disable package |
| `pi-minimax-mcp` join umbrella | **Defer** | MiniMax/Kimi models | — | Needs `@mariozechner→@earendil-works` peer-dep migration | n/a |
| Cross-agent session middleware | **Defer (separate task)** | — | — | Out of scope this round | Mine histories only |
| Profile switch via slash command in-band | **Reject** | — | — | `setActiveTools` additive-only; half-switch unsafe | Use relaunch |

---

## 9. Open Questions (need your answers before implementation)

> **Round-2 direction applied 2026-08-06.** The original questions are retained below for traceability. Items 1–4, 6, and 7 are resolved by §0; item 5 remains an implementation gate because lib has not yet added a `pi` platform and the mirror-vs-direct-path choice is still open.

1. **Subagent surface: `pi-subagents` vs vendored `agy`?** Both provide subagent delegation. `pi-subagents` is mature, MIT, 2.9k★, FleetView, workflowScript orchestration. `agy` is already in pi-herdr, companion-only, master-orchestrator pane model, with configured lanes (directory-mapper/deep-researcher/etc.). Do you want acidbath to (a) adopt `pi-subagents` and retire agy, (b) vendor agy and skip pi-subagents, or (c) keep both with disjoint profiles? They overlap heavily.

2. **`web_search` tool provenance.** The `explore` profile assumes a `web_search` tool. I could not verify Pi exposes it as a built-in via `--tools`. Is `web_search` available on your Pi build, or should acidbath ship a thin wrapper around an agent-proxy search endpoint?

3. **`pi-codex-tools` apply_patch scope.** It replaces `edit`/`write` with `apply_patch` for grammar-capable Codex models and is **Linux-only** (fails closed elsewhere, no Pi filesystem sandbox). You're on macOS (darwin 25.6.0). Do you want it adopted for the streaming-render pattern only (portable), or also for the `apply_patch` tool itself (which would be inactive on your macOS host)?

4. **Eval rigor for P4.** You said spec-only now, read-only checks first, then a rubric. For the rubric: do you want a scored matrix (compat/maintenance/license/security/perf/operational-risk, as in §3) per tool, plus a `measure.sh`-style objective benchmark, or scored-matrix-only for the first pass?

5. **Skill integration choice.** The canonical source is `/Users/ameno/dev/lib`, whose current registry has no `pi` platform and no `focused-delivery`/`herdr` entries. Approve adding a lib-managed `pi` target and choose the generated `dist/pi` mirror or direct canonical paths for acidbath's `pi.skills` manifest; keep `~/.pi/agent/skills/**` blocked.

6. **`pi-lens` appetite.** It's the heaviest integration in the matrix. Is real-time LSP/linter feedback in the `debug` profile a priority, or nice-to-have?

7. **Motion/render determinism for eval.** I propose freezing motion (`PI_ACIDBATH_REDUCED_MOTION=1`, `PHASE=3`) in the `eval` profile for reproducible renders. Acceptable, or do you want live motion in eval too?

---

## Appendix — Facts vs assumptions

**Facts (cited):** acidbath manifest + files; `~/.pi/agent/settings.json` blocklists + packages + providers; `pi-herdr/scripts/launcher.sh` `--no-extensions`+explicit flags; acidbath + pi-herdr-ui both register `/orb`+`/motion`; orb transitions in `index.ts`; render-time context fields in `ui-tools.ts` (toolCallId/isError/isPartial/args/invalidate); `setHiddenThinkingLabel` semantics; peer-dep namespaces (`@earendil-works` vs `@mariozechner`); community repo stars/license/activity (from fetched pages); agy subagent config + policies (`config/agy-subagents.json`); scheduler 7K-char injection bound.

**Assumptions (labeled in reports):** blocklist path-rooting at `~/.pi/agent/` (explains the 3 filtered packages, strongly supported but not runtime-confirmed); `pi-minimax-mcp` filtered by peer-dep mismatch; uninspected npm/git packages filtered by empty `pi.extensions`; `tool_call`/`tool_result`/`message_update` event payload fields beyond `event.toolName` (types not installed); `pi.getActiveTools()` readable at `session_start` for the eval self-check; `web_search` availability.
