# Acidbath + Herdr cohesive cleanup and refinement plan

**Status:** implementation authority for the remaining extension cleanup. The original orb, context-pyramid, footer-lyric, and tool-motion experiments have now been archived; the active runtime is a single lifecycle presentation with static transcript rows and one transient activity rail.

**Current direction update:** capability profiles are not part of Acidbath's runtime. The default package is the full approved development composition; Pi's native TUI/RPC/print modes remain intact. Research/web access remain explicit package capabilities, while AST-grep is still under safety evaluation. Sections below that describe profiles, orb/context placement, footer lyrics, or tool-motion controls are historical design evidence and must not be treated as current implementation tasks.

**Scope:** Acidbath core UI, tool-output presentation, Pi/Herdr integration, local subagent orchestration and messaging, research/web access, compaction continuation, profile composition, extension/package cleanup, telemetry/egress policy, tests, migration, and rollback.

**Supersession rule:** where this plan conflicts with `docs/PLAN.md`, `docs/tool-eval-matrix.md`, or earlier handoffs, this plan wins. Those files remain evidence, but several of their adoption claims were disproved by later source audits.

**Explicitly deferred:** SSH/remote-Herdr transport. The local design keeps host-qualified identities and a transport boundary, but no SSH commands, tunnels, remote inboxes, or remote-focus behavior belong in the initial implementation.

---

## 1. Executive decision

Build one coherent system with strict ownership boundaries:

1. **Acidbath remains the Pi presentation core.** It owns the header/editor/footer/context surfaces, the seven deliberately wrapped built-in tool renderers, and a generic display-event contract. It does not own research execution, subagent processes, Herdr lifecycle, browser automation, skill deployment, or CI/eval runners.
2. **`herdr-subagents` becomes the local delegation and messaging package.** It is a hybrid Herdr plugin + Pi package. Herdr owns panes, PTYs, processes, worktrees, lifecycle, focus, persistence, and native agent attention. The package adds profiles, bounded parent/worker envelopes, a local inbox, three small Pi tools, and a read-only Herdr viewer.
3. **The Acidbath–Herdr adapter is optional and event-based.** It lives with `herdr-subagents`, emits a versioned generic Acidbath display/fleet event, and has no direct import into Acidbath. Acidbath renders a compact aggregate; native Herdr remains the detailed fleet UI.
4. **Pi-Herdr becomes a thin composition/operator layer.** Its launcher composes Acidbath, native Herdr state integration, `herdr-subagents`, and selected skills. It stops owning duplicate generic UI, AGY subagent orchestration, and the research bridge.
5. **Research becomes a separate capability profile.** `pi-research` owns AGY reasoning/search. `pi-web-access` owns structured search, extraction, PDFs/video/GitHub retrieval, stored content, and source verification. Acidbath only decorates their lifecycle.
6. **Capabilities are selected before launch.** Profiles compose packages, tools, skills, model/thinking, network/write declarations, and UI defaults. Presentation toggles may change in-session; authority does not.
7. **No telemetry is allowed.** Install/usage analytics are disabled globally and are an adoption blocker in dependencies. Functional provider/search traffic must be explicit, profile-declared, and user-invoked.
8. **Destructive cleanup happens last.** First establish contracts, tests, and parity; then remove old bridges, widgets, packages, and launcher entries.

### Target repository ownership

| Repository/package | Owns | Must not own |
|---|---|---|
| `acidbath` | Pi presentation, built-in renderer ownership, generic display adapter, visual modes | Subprocesses, Herdr control, research/browser executors, global settings mutation |
| `herdr-subagents` | Local Herdr agent profiles, launch plans, messages/results, viewer, Pi/Herdr adapter | Acidbath generic UI, SSH in MVP, research execution |
| `pi-herdr` | Herdr plugin/operator launcher and composition | Duplicate orb/footer/tool renderers, research bridge, AGY master orchestrator |
| `pi-research` | AGY quick/deep research orchestration | Acidbath UI, implicit AGY permission changes, pretending AGY can call Pi tools |
| `pi-web-access` | Web primitives, extraction, evidence and stored content | Acidbath UI ownership, implicit cookies/hosted fetch opt-ins |
| `/Users/ameno/dev/lib` | Canonical skills, agents, workflow prose, metadata and cross-agent deployment | Pi runtime tool execution or Acidbath-owned copies |

---

## 2. Current-state findings that drive the cleanup

### 2.1 Documentation and activation truth diverge

- `docs/PLAN.md` still recommends `pi-subagents`, Codex telemetry-bearing packages, Pix collapse, broad `pi-lens`, and autoresearch using claims superseded by the source audits.
- Current global settings load `pi-interactive-shell`, configure a missing/filtered ast-grep checkout, configure visual-explainer, and load local Acidbath. Loose extensions remain blocked by `!extensions/**`.
- Acidbath currently bundles and activates `pi-research`, contrary to the later topology/security recommendation that research be independent.
- `npm ls` reports the bundled git `pi-research` dependency invalid, so the current bundle is not a clean reproducible install despite the configured commit pin.
- Visual-explainer is reported as filtered by `pi list`, although prior RPC inspection observed its surfaces. Package-list labels are not sufficient evidence; each profile needs a resolved-resource smoke test.

### 2.2 Acidbath has grown multiple competing status surfaces

Current or experimental code can update:

- Pi's working indicator and working message;
- the borderless editor prompt/orb slot;
- an above-editor thinking/activity widget;
- a persistent transcript tool-activity block;
- hidden built-in tool rows;
- a large header with task/context state;
- a footer with product/model/thinking/lyrics/context/usage;
- per-run agent-output provenance banners.

This is more state ownership than one event needs. The implementation now has multiple event handlers and render callbacks updating the same semantic facts. Some fields (`agentActive`, activity `lyric`/`contentMode`) are unused or do not affect rendering. `index.ts` has become the lifecycle controller, presentation controller, instrumentation collector, tool adapter, startup probe, and command registry at once.

### 2.3 Timer and redraw ownership is fragmented

Potentially active clocks include:

- shared tool/token `MotionClock` at 100ms;
- context widget at 80ms while converging;
- thinking glow at 112ms;
- footer status transition at 56ms;
- one-second context polling;
- 100ms label debounce;
- state-driven or timed whimsical-message callbacks.

Most settle correctly, but simultaneous work can run several clocks for one visual story. Context is already refreshed on lifecycle events, making an unconditional idle one-second poll difficult to justify.

### 2.4 Tool presentation currently violates its own intended contract

- Acidbath re-registers `read`, `bash`, `edit`, `write`, `grep`, `find`, and `ls`, so it is the active owner of those tool definitions and must detect collisions explicitly.
- The compact renderer has a sensible structured row and native expansion path, but `hideTranscript: true` suppresses those normal call/result rows.
- A separate appended tool-activity entry then becomes the visible history, limited to a custom four-row viewport. This breaks the documented “one native compact row per call with Ctrl+O details” contract and does work in a renderer whose output is hidden.
- Timing begins during rendering rather than the authoritative execution event, so delayed/repeated render calls can distort duration.
- Built-in and generic lifecycle events both update activity state. De-duplication exists in the store but the architecture remains unnecessarily coupled.

### 2.5 Experimental UI requires a deliberate product/legal gate

The current worktree contains uncommitted lyric/status-transition, thinking-preview, and agent-output-banner work.

- Provider thinking is intentionally hidden in global settings, while the new above-editor preview re-exposes a tail. This needs an explicit privacy/display setting and must never feed lifecycle inference.
- Verbatim commercial lyrics should not ship in a published MIT package without a separate rights decision. If the feature remains useful, use user-local content or original status text and make it opt-in.
- A colored agent-output banner before every run repeats prompt text and adds persistent visual/session entries. Its provenance value must be measured against area and history noise.
- Glitch bridges, lyric rotation, and dwell timing are useful experiments, not automatic default-profile features.

### 2.6 Startup/preflight performs avoidable work

- Every TUI session launches `pi --version` and recursively scans global/project/npm directories for skills.
- Acidbath already has Pi resource/tool APIs and should report the resolved runtime rather than rediscovering package files.
- Startup notifications/checks from bundled research add more unrelated work even if research is never used.

### 2.7 Research pairing is only nominal today

- `pi-research` tells its AGY subprocess to use `fetch_content`, but AGY is a separate process and cannot call the parent Pi tool.
- It checks one global npm path rather than the active tool inventory.
- It awaits buffered `pi.exec` output and only then replays parsed updates, so “live stream-json progress” is not live.
- Schemas and outputs are insufficiently bounded, the AGY binary path is fixed, startup is noisy, and the default permission model requires `command(*)` plus `--dangerously-skip-permissions`.
- `pi-web-access` is complementary and generally better hardened, but its default surface is broad, its curator can load CDN assets, and provider/browser/hosted-fetch egress needs an explicit profile configuration.

### 2.8 Native Herdr is underused and duplicated

- Installed Herdr is currently 0.7.1/protocol 14; reviewed latest docs are 0.8.0. The package must negotiate capabilities.
- Herdr already owns recognized agents, semantic status, custom metadata/state labels, pane reads, waits, focus, plugin panes, worktrees, persistence, and remote attachments.
- Herdr's official Pi integration is installed but the global loose-extension block can prevent normal discovery. Herdr profiles must explicitly load/allow that one extension rather than reopening all global extensions.
- `pi-herdr-ui`, scheduler/cockpit, AGY orchestration, Acidbath, `interactive_shell`, and old subagent widgets overlap in process/status/presentation ownership.

### 2.9 Compaction continuation is useful but currently unsafe

The loose extension currently queues a large JSONL-archaeology prompt after every compaction and ignores `willRetry`. With compaction now enabled globally, this can duplicate native overflow recovery. The desired behavior is narrower: only continue when compaction completes while the agent is between turns.

### 2.10 Package/security facts supersede prior recommendations

- `pi-codex-tools` and `pi-codex-compaction` contain default-on install telemetry to `mocito.dev`. They are not adoption candidates until telemetry is removed/default-off and independently verified.
- Current `pi-codex-tools` supports macOS native bindings; older “Linux-only” rationale is stale.
- Pix collapse is default-on upstream and does not reliably cancel/dispose timers. Pix packages should not be loaded; only independently implemented, tested patterns may remain.
- `pi-lens` is not a read-only LSP helper by default. It includes mutation, installers, context injection, subprocess fleets, and downloads. Defer it.
- `pi-autoresearch` is destructive and not safely bounded by default. Keep it outside normal profiles and revisit only in isolated worktrees/VMs.
- `pi-interactive-shell` is useful but has oversized context/schema and lifecycle/memory defects. Keep it only until local Herdr parity, then remove it from default.

---

## 3. Target runtime architecture

```text
Pi session
├── acidbath core
│   ├── one UI state store
│   ├── header/editor/footer/context
│   ├── seven built-in compact renderers
│   └── generic display-event listener
├── selected capability extensions (profile-controlled)
│   ├── herdr-subagents Pi surface
│   ├── acidbath-herdr adapter
│   ├── pi-research
│   ├── pi-web-access
│   └── visual/debug utilities
└── native Herdr integration (when HERDR_ENV=1)
    ├── Herdr server owns process/pane/agent lifecycle
    ├── native Agents view owns fleet detail and attention
    └── plugin viewer owns read-only summarized transcripts
```

### 3.1 Generic Acidbath display contract

Use Pi's shared extension event bus. Acidbath listens on a versioned channel, for example `acidbath.display.v1`. External packages may emit bounded presentation facts without Acidbath importing them or replacing their tools.

```ts
interface AcidbathDisplayEventV1 {
  source: string;                 // e.g. "herdr-subagents", "pi-research"
  operationId: string;            // tool call, agent task, or message id
  phase: "pending" | "success" | "warning" | "error";
  label: string;                  // bounded human label
  target?: string;                // bounded path/query/agent
  metrics?: Array<{ kind: string; value: string | number }>;
  preview?: string[];             // terminal-safe, bounded lines
  attention?: "none" | "done" | "blocked" | "error";
}
```

Rules:

- no raw shell command is executable through this contract;
- no model-facing tool content is changed;
- unknown fields are ignored and all strings/counts are bounded;
- events are keyed/deduplicated by `source + operationId`;
- Acidbath can be absent without breaking the emitting capability;
- subscriptions are disposed automatically on runtime replacement/shutdown.

### 3.2 UI state ownership

One reducer/store should own these facts:

- session generation and presentation mode;
- active agent/turn/provider phase;
- active tool calls keyed by `toolCallId`;
- final tool metadata and previews;
- context/token usage;
- optional external capability/fleet summaries;
- reduced-motion/no-color/width policy.

Render surfaces become projections, not independent state machines.

### 3.3 Intended visible hierarchy

| Surface | Default responsibility | What must not be duplicated there |
|---|---|---|
| Header/welcome | Product identity and initial task/session summary | model/cwd/context repeated from footer; permanent fleet detail |
| Editor/working slot | One semantic active-state indicator | lyrics, full reasoning, fleet list |
| Transient activity dock | Only current reasoning preview **or** currently running tools; disappear when idle | completed tool history, persistent banners |
| Tool transcript | One compact final row per call; native bounded expansion | separate completed-call activity history |
| Footer | model/thinking/profile, compact activity/fleet aggregate, context/turn usage | full subagent view, long lyrics, duplicate product metadata at narrow widths |
| Native Herdr Agents view | fleet status, blocked/done attention, focus/navigation | Acidbath reimplementation of a full fleet list |
| Herdr summary viewer | read-only per-agent summary/artifacts/recent activity | prompt entry or terminal emulation |

Large-header persistence, thinking preview, provenance banners, whimsical text, and glitch transitions each get a separate visual approval checkpoint. Refactors must preserve current approved appearance until that checkpoint.

---

## 4. Workstreams

## A. Truth, baselines, and release discipline

### Work

1. Mark this file as the implementation authority and add “superseded” banners to stale planning/matrix documents without deleting their evidence.
2. Capture the current worktree separately; do not fold pre-existing uncommitted UI experiments into cleanup commits.
3. Record a resolved startup inventory from RPC, not only `pi list`: extensions, commands, active tools, skills, prompts, system-prompt size, tool-schema size, and timers.
4. Fix package reproducibility: clean lock/install state, no invalid git dependency, exact pins, source/license/telemetry/postinstall record for every profile package.
5. Make `npm test` run **every** existing test file; current package scripts omit available header, welcome, and tool-activity tests.
6. Establish release commands: unit tests, typecheck, visual snapshots, RPC profile smoke, dependency audit, telemetry/egress scan, and dirty-tree check.

### Exit criteria

- one reproducible clean install;
- one current feature inventory generated from code/tests;
- no stale claim is presented as shipped behavior;
- baseline artifacts cover 40/60/80/120 columns and active/idle timer counts.

### Rollback

Documentation/tests only; no runtime behavior changes.

---

## B. Acidbath core lifecycle and performance refactor

### Work

1. Split the monolithic entrypoint into controllers with explicit disposal:
   - `session-controller`;
   - `activity-controller`;
   - `context-controller`;
   - `tool-controller`;
   - `surface-controller`;
   - `commands`.
2. Replace multiple mutable status fields with one generation-keyed reducer/store.
3. Make session start/replacement idempotent: dispose previous timers/widgets/subscriptions before installing new ones; reset all message/status/model/context state.
4. Replace recursive skill discovery and `pi --version` startup process with resolved Pi resource/runtime data. Move expensive diagnostics behind `/preflight`.
5. Remove unconditional idle context polling. Prefer `context`, provider, turn, tool, and usage events; if a compatibility poll remains, run it only while active and stop at idle.
6. Consolidate animation onto one shared bounded UI clock (maximum 10Hz) or prove why a separate clock is needed. Zero repeating timers at idle is mandatory.
7. Remove dead fields and duplicate lifecycle handlers. Event-to-state transitions must be pure/tested; render callbacks cannot be lifecycle authority.
8. Keep hidden-thinking handling reversible and restore the prior Pi state exactly on shutdown.

### Visual/product gates

- Thinking preview: default off until explicitly approved; bounded display-only if enabled.
- Whimsical/lyric rail: keep experimental/local-only; do not publish commercial lyrics. Replace with user-local/original text before distribution.
- Agent-output banner: default off until area/session-history value is demonstrated.
- Status dwell command: debug/instrumentation profile only.
- Large header: preserve during no-visual refactor; later compare persistent vs transient startup forms.

### Exit criteria

- zero timers/subscriptions at idle and after shutdown/reload;
- no duplicate header/footer/widget after session switch/fork/reload;
- no thinking text displayed when disabled;
- no startup subprocess or recursive npm traversal in the default path;
- event/reducer tests cover sequential and concurrent lifecycle transitions.

---

## C. Tool-output and external-adapter correction

### Work

1. Declare the seven Acidbath-owned built-ins and inspect `pi.getAllTools()`/source info before replacement. Fail visibly and safely on a non-built-in owner collision.
2. Restore one compact transcript row per tool call; remove `hideTranscript: true` after fixtures prove no duplicate call/result row.
3. Preserve Pi's native renderer as the expanded detail view. Expansion must work for output, images, diffs, diagnostics, and partial calls.
4. Convert the current persistent tool-activity transcript into a transient **active-only** dock, or remove it. Completed history belongs to tool transcript rows.
5. Capture start/end/duration from execution lifecycle events keyed by `toolCallId`, not renderer invocation time.
6. Attach namespaced `acidbathDisplay` details without mutating model-visible content or discarding upstream details.
7. Implement tool-specific structured metadata:
   - read: path/range/line or image metadata;
   - grep: target/matches/files;
   - find/ls: scope/result count;
   - bash: command summary/exit/duration/output count/truncation;
   - edit/write: path/diff stats/result state.
8. Add the generic event-bus adapter for external tools. Research, Herdr, browser, and future tools opt in; Acidbath never guesses semantics from names.
9. Keep auto-collapse off. Reconsider only with explicit expansion, error-preservation, cancellation, and timer-disposal tests.

### Exit criteria

- one pending row becomes one final row;
- full native details return on expansion;
- lines stay within 40/60/80/120-column visible widths including Unicode/ANSI;
- parallel tool durations and counts are correct;
- `NO_COLOR` preserves text status;
- 16-concurrent-call fixture leaves zero per-call state/timers at idle.

---

## D. Research + web-access capability profile

### Package boundary

Remove `pi-research` from Acidbath's dependency, bundled dependencies, package extension list, startup notifications, and package-manifest test. Load it only through the research overlay/profile.

### `pi-research` hardening

1. Replace broad string schemas with enums and hard bounds for query/topic, subtopics, result count, freshness, depth, model, time, progress, stdout/stderr, final answer, source count, and details.
2. Resolve AGY from explicit config or `PATH`; verify version/capabilities lazily on first use or `/agy-status`.
3. Remove the fixed startup notification/check path.
4. Implement true incremental subprocess streaming with cancellation and TERM→KILL escalation, or stop advertising live progress.
5. Export and test the production parser/prompt/source-extraction helpers. Malformed streams return bounded structured errors, never raw unbounded stdout.
6. Replace `command(*)`/permission bypass with a least-privilege AGY policy. If AGY cannot support it, expose a clearly named risky research profile and require an explicit human gate.
7. Return normalized source URLs in result details. Do not instruct AGY to call a parent Pi tool.
8. Record the exact source commit and make install/lock state clean.

### `pi-web-access` pairing

Use distinct tool routing in the research profile:

- `agy_web_search`: quick agentic synthesized answer;
- `agy_research`: multi-angle research synthesis;
- rename PWA `web_search` to `structured_web_search` through `toolNames`;
- `fetch_content`: direct page/PDF/video/GitHub extraction;
- `get_search_content`: bounded retrieval from stored content;
- `source_check`: evidence-backed claim verification.

Safe profile defaults:

- `allowBrowserCookies: false`;
- `fetchRouting.allowRemoteHostedProviders: false`;
- explicit provider selection/routing rather than surprise paid/all-provider execution;
- curator `workflow: "none"` or locally bundled assets with explicit browser open;
- no automatic browser opening in headless/automation modes;
- SSRF guard remains enabled;
- exact package pin and no package telemetry.

### Orchestration contract

The primary Pi agent performs the composition:

1. AGY returns synthesized findings and structured source URLs.
2. Pi selects high-value sources.
3. Pi invokes `fetch_content`/`get_search_content` for direct evidence.
4. Pi invokes `source_check` for important claims.
5. Acidbath renders bounded lifecycle/metrics through the external display contract.

### Exit criteria

- default Acidbath exposes no research tool or AGY startup work;
- research profile has deterministic names/routing and an egress declaration;
- cancellation/timeout/malformed/output-cap tests pass without live network;
- fixed online benchmark records latency, citation validity, source diversity, and extraction success;
- no implicit permission/settings/cookie change.

---

## E. Compaction continuation and security utilities

### Continue-after-compaction V2

Activation remains separate from Acidbath core but may be included by the default profile after tests.

On `session_compact`, continue only when all are true:

- `event.willRetry === false`;
- `event.reason !== "overflow"`;
- `ctx.isIdle() === true`;
- `ctx.signal === undefined`;
- `ctx.hasPendingMessages() === false`;
- the compaction entry ID has not already been handled;
- the runtime/session generation has not been replaced or shut down.

The continuation prompt trusts Pi's retained compaction summary. It does not read/reconstruct raw JSONL. It requests a concise operational handoff:

1. goal and user constraints;
2. decisions and completed work;
3. repository/session state;
4. unresolved risks/blockers;
5. ordered next steps;
6. immediately execute the first unfinished step.

Add `off | manual | auto` policy, bounded prompt text, deduplication, shutdown cancellation, and tests for manual, threshold, overflow retry, queued steering/follow-up, duplicate event, send failure, and session replacement.

### Telemetry and egress policy

1. Set Pi `enableInstallTelemetry: false` and launch capability profiles with `PI_TELEMETRY=0`.
2. Do not use `PI_OFFLINE=1` as a universal profile flag; it disables legitimate explicit network capabilities. Use it for guarded/debug tooling where required.
3. Add a dependency-source gate scanning telemetry endpoints, analytics SDKs, install scripts, executable downloads, and unexpected network calls.
4. Reject default-on telemetry dependencies. A documented opt-out is insufficient for the normal adoption path when a telemetry-free fork/removal is feasible.
5. Every profile declares `network`, `writes`, `globalWrites`, `subagents`, and `browserCookies`.

### `pi-cloak`

Keep as a candidate for guarded/default use after it:

- canonicalizes real paths and handles symlinks;
- validates rule-by-rule and retains last-known-good config;
- documents itself as read-result redaction, not access control;
- has CRLF/multiline/escaped JSON/invalid-regex tests;
- makes fixed-length masking a deliberate policy.

### Other quarantined utilities

- `damage-control`: do not rely on it; keep quarantined or remove after archival.
- old `handoff`: do not load; it is unrelated to the safe compaction handoff and retains stale-session defects.
- `pi-autoresearch`: isolated evaluation worktree/VM only in a future phase.

---

## F. `herdr-subagents` local MVP

### Package shape

```text
herdr-subagents/
├── package.json                 Pi package manifest
├── herdr-plugin.toml            Herdr plugin manifest
├── src/core/                    identity, profiles, envelopes, stores
├── src/transports/local-cli.ts  Herdr 0.7 baseline
├── src/transports/socket.ts     capability-gated 0.8 snapshot/events
├── src/pi/extension.ts          spawn/fleet/message tools + commands
├── src/pi/acidbath-adapter.ts   event-bus projection
├── src/plugin/viewer.ts         read-only tabbed summary TUI
├── profiles/luna-*.json         explicit worker profiles
└── tests/fixtures/herdr-*/      protocol/version fixtures
```

### Model-facing tools

- `herdr_spawn`: start a configured agent profile and subscribe the parent to blocked/done/result.
- `herdr_fleet`: list/read/wait on bounded agent state/results.
- `herdr_message`: send a bounded structured message to a worker or parent inbox.

Human commands/shortcuts own topology/view/focus actions (`/herdr-tab`, `/herdr-agents`, `/herdr-focus`, `/herdr-cleanup confirm`). Do not add focus/terminal control to the model tool surface unless later justified.

### Dedicated fleet-tab UX

The default local fleet is one explicitly labeled `H-subagents [idle]` tab in
the current Herdr workspace. When work starts it becomes `H-subagents [task]`.
It has a hard four-pane 2×2 grid. Slots are stable
logical names (`top-left`, `top-right`, `bottom-left`, `bottom-right`) mapped to
opaque Herdr pane IDs. `herdr_spawn` reuses an idle owned slot and fails closed
when all four are occupied; it never silently creates a new random pane,
tab, or workspace. Each slot carries a stable ownership prefix plus a task suffix
(`herdr-subagents:<slot> | <task>`) and Herdr metadata (source, title, role,
lifecycle state, correlation ID). A spawn accepts an optional human task label;
otherwise it derives a sanitized bounded slug from the task.

Creation is idempotent and non-focusing by default. Cleanup is operator-only and
closes the tab only when every pane has the exact package ownership marker; a
foreign/unlabeled pane causes refusal. Spawn failure, timeout, reload, and
explicit cleanup must reconcile the owned slot rather than leaving an orphan.
The native Herdr tab is the detailed operator surface; Acidbath receives only a
bounded aggregate status projection.

### Profiles

Initial local profiles:

- `luna-scout`: read/grep/find/ls + `herdr_message`, shared checkout, no writes;
- `luna-builder`: isolated Herdr worktree, explicit edit/write/bash, finite task;
- `luna-reviewer`: read-only diff/review, no child fan-out;
- `luna-validator`: read + bounded tests, no source edits;
- `luna-researcher`: loaded only with the research capability profile.

Each profile defines model/thinking, tools, skills, cwd policy, placement, worktree policy, max output, task timeout, child fan-out (default none), message/result policy, and status labels.

### Native Herdr use

- Herdr creates topology and starts recognized agents.
- Official Pi integration remains lifecycle authority.
- `pane.report_metadata` adds display-only title, profile, parent, task summary, and custom state labels without overriding semantic state.
- Native Agents sidebar is the primary fleet view.
- Herdr plugin viewer is read-only: tabs, scroll, refresh, focus, close. It never forwards arbitrary terminal input.
- Full interaction always focuses the real Herdr pane.
- Reads do not mark an unseen `done` result seen.

### Compatibility

- Detect Herdr version/protocol/capabilities per session.
- Herdr 0.7.1 baseline: CLI list/get/read/wait/focus/start, scheduler/cache fallback as needed.
- Capable 0.8 path: `session.snapshot`, event subscriptions, server-owned waits, atomic prompt+wait, agent view projection, popup viewer.
- Do not hardcode IDs; parse all returned IDs and keep host/session/workspace/tab/pane identity even while only `local` exists.
- No SSH implementation in this plan.

### Message/result contract

Prefer explicit bounded worker envelopes:

```text
status
summary
artifacts[]
next_steps[]
needs_input?
```

Full transcript remains in Herdr. If a non-Pi worker cannot emit the envelope, read a bounded settled transcript as a fallback. Deliver parent messages only at safe turn boundaries; do not interrupt an active primary turn unless explicitly steering.

### Exit criteria

- local spawn → working → blocked/done → bounded result works;
- profiles enforce exact tool ceilings and no child fan-out by default;
- viewer and Acidbath adapter survive absent Acidbath/Herdr features;
- shutdown removes subscriptions but does not close unowned/persistent worker panes;
- version fixtures cover 0.7 and 0.8 response differences;
- package has no telemetry and no idle polling when events are available.

---

## G. Pi-Herdr composition and migration

### Keep/refactor

- Keep native Herdr integration and the operator/launcher concept.
- Keep the useful fleet/attention projection as a compatibility library while 0.7 requires it.
- Reuse tested cockpit normalization/priority/attention logic in `herdr-subagents` rather than maintaining duplicate presentation.
- Launch Acidbath as the generic Pi UI profile instead of loading `pi-herdr-ui`'s duplicate orb/motion/tool surfaces.

### Remove after parity

- `extensions/pi-herdr-research-bridge.ts` and all launcher/config/docs references;
- `extensions/pi-herdr-agy.ts` and the AGY master-orchestrator subagent protocol;
- duplicate generic UI/tool-renderer ownership in `pi-herdr-ui.ts`/helpers;
- scheduler polling/injected 7K snapshot when native event/snapshot support is proven adequate;
- duplicate cockpit surface if native Agents view + viewer fully covers it.

### Launcher target

The Pi-Herdr launcher should compose explicit resources from a no-discovery baseline:

```text
acidbath core
+ official Herdr Pi state integration
+ herdr-subagents Pi extension
+ acidbath-herdr adapter
+ selected /lib skills
+ optional research/visual/debug overlays
```

It must print the resolved profile/resources before launch and never silently add permissions.

---

## H. Profiles, settings, and package cleanup

### Composable overlays

| Overlay | Adds | Safety/defaults |
|---|---|---|
| `core` | Acidbath, built-ins, approved baseline skills | no extra network/subagents |
| `herdr` | official Herdr state, `herdr-subagents`, adapter | local only; bounded profiles |
| `research` | hardened `pi-research`, configured `pi-web-access` | explicit egress; cookies/hosted fetch off |
| `visual` | visual-explainer | explicit artifact/browser-open workflow; offline-safe assets target |
| `debug` | ast-grep after reinstall/audit | `PI_OFFLINE=1`; no auto-download; no `pi-lens` initially |
| `guarded` | read-only tools, cloak, reduced motion | no network/write/bash/subagents |
| `eval` | reduced/frozen motion, reviewer/validator Luna profiles | finite concurrency, isolated worktrees |

Profiles are composed at launch (`core+herdr`, `core+research`, `core+herdr+research`). A slash command may report the topology, but cannot change capability authority in-band.

### Default settings migration target

After parity and explicit approval:

- retain the global `!extensions/**`, `!skills/**`, and `!prompts/**` policy;
- explicitly allow/load the official `herdr-agent-state.ts` only where appropriate;
- set `enableInstallTelemetry: false`;
- remove stale ast-grep entry until its checkout is reconciled and audited;
- remove `pi-interactive-shell` after `herdr-subagents` covers the required local long-process/agent workflow;
- keep visual-explainer only according to the chosen default/on-demand visual policy;
- keep Acidbath core free of research dependencies;
- do not add pi-subagents, pi-messenger, Pix, Codex telemetry packages, pi-lens, or autoresearch to the default.

Every settings change is proposed as a diff, backed up, applied atomically, verified with a fresh RPC startup, and reversible.

---

## 5. Revised candidate ledger

| Capability | Final disposition in this roadmap |
|---|---|
| Acidbath core | keep, stabilize, slim ownership |
| `herdr-subagents` | build local MVP; primary delegation/messaging path |
| `pi-interactive-shell` | transitional keep; remove after local parity |
| `pi-subagents` | do not install/adopt |
| `pi-messenger` | do not install/adopt |
| Pix packages | runtime zero; do not install; retain only independent patterns/evidence |
| `pi-research` | separate, harden, research profile only |
| `pi-web-access` | integrate in research profile with explicit safe config/tool names |
| Pi-Herdr research bridge | delete after research-profile parity |
| Pi-Herdr AGY subagents | delete after `herdr-subagents` parity |
| `continue-after-compaction` | refactor/test as separate small extension |
| `pi-cloak` | harden, then guarded/default candidate |
| session replay | delete; no replacement |
| old subagent widget | delete after parity; preserve historical session data unless separately requested |
| legacy tool-status | delete source; replace with Acidbath/Herdr event data |
| damage-control | quarantine/drop; no safety claims |
| old handoff | quarantine; not the compaction handoff |
| `pi-ast-grep` | remove stale entry; reconsider in debug after exact reinstall/offline audit |
| visual-explainer | keep explicit visual workflow; fix offline/atomic/test/install-footprint issues upstream when practical |
| `pi-codex-tools` / compaction | defer/reject while telemetry exists; no default adoption |
| `pi-lens` | defer; too broad/mutating/install-heavy for current debug contract |
| `pi-autoresearch` | future isolated eval only, never normal profile |
| historical subagent JSONL/artifacts | preserve unless the user explicitly requests data deletion |

---

## 6. Phased implementation roadmap

### Phase 0 — freeze truth and establish gates

- Complete Workstream A.
- Separate the existing uncommitted UI experiment from cleanup/refactor commits.
- Add profile/resource/timer/context-size baselines.
- Decide the visual gates, but do not change appearance yet.

**Exit:** reproducible baseline and authoritative plan.

### Phase 1 — no-visual core stabilization

- Refactor Acidbath lifecycle/store/controllers while preserving approved output.
- Fix session re-entry/disposal, startup work, context refresh, test aggregation, and ownership diagnostics.
- Implement generic event-bus display contract with synthetic fixtures.
- Refactor continue-after-compaction and `pi-cloak` in parallel.

**Exit:** same intended visuals, simpler ownership, zero idle leaks, passing matrices.

### Phase 2 — local Herdr vertical slice and profile skeleton

- Create `/Users/ameno/dev/herdr-subagents`.
- Implement contracts, local 0.7 CLI transport, one `luna-scout`, spawn/status/result, native metadata, and the minimal profile resolver.
- Explicitly load/verify official Herdr Pi state in the Herdr profile.
- Create the optional Acidbath adapter.

**Exit:** first dogfoodable local subagent flow.

### Phase 3 — parallel Luna implementation

Using Herdr worktrees and the new package:

- Luna Core: profile/capability ceilings and lifecycle store;
- Luna Tools: Pi tools/commands and result delivery;
- Luna Viewer: read-only Herdr plugin pane;
- Luna Socket: capability-gated 0.8 snapshot/events;
- Luna Acidbath: footer/activity adapter;
- Luna QA: protocol, cancellation, blocked/done, cleanup fixtures.

**Exit:** local system reaches parity for agent delegation/status with the relevant subset of `pi-interactive-shell`.

### Phase 4 — tool-output and research refinement

- Implement Workstream C under golden visual tests.
- Separate/harden `pi-research` and integrate `pi-web-access` routing.
- Add research adapters and benchmark/evidence fixtures.
- Review visual experiments (thinking, header, whimsical, banners) independently.

**Exit:** coherent tool transcript and optional research profile.

### Phase 5 — Pi-Herdr composition and profiles

- Slim Pi-Herdr launcher/UI ownership.
- Move cockpit state logic where needed; use native Herdr detail/focus.
- Implement composable profile overlays and `/topology` report.
- Run full profile safety/resource/egress tests.

**Exit:** `core+herdr` is the preferred daily workflow.

### Phase 6 — destructive cleanup and default migration

Only after acceptance:

- remove research bridge and AGY orchestrator from Pi-Herdr;
- remove stale subagent widget, tool-status, session replay, and dead package entries;
- remove default `pi-interactive-shell` after parity/rollback period;
- remove bundled research from Acidbath;
- apply settings diff with backup and fresh startup validation;
- update README, feature inventory, diagrams, handoff, and package/release records.

**Exit:** one clean default, explicit overlays, no duplicate owners.

### Deferred Phase 7 — remote Herdr

SSH transport, socket tunneling, remote inbox retrieval, and remote focus/attach remain out of scope until the local system is stable and proven.

---

## 7. Luna fleet implementation and review graph

Bootstrap Phase 0/1 manually. After the Phase 2 vertical slice, dogfood `herdr-subagents` for all parallel work.

| Lane | Profile | Worktree/files | Responsibility | Reviewer |
|---|---|---|---|---|
| Architecture | `luna-scout` | read-only | contracts, dependency graph, ADR checks | primary |
| Acidbath core | `luna-builder` | Acidbath lifecycle/controller files | state/refactor/timers | Luna reviewer + primary |
| Tool output | `luna-builder` | renderer/activity files | compact rows, expansion, metadata | Luna validator |
| Herdr core | `luna-builder` | `herdr-subagents` core/transport | local launch/state/envelopes | Luna reviewer |
| Herdr viewer | `luna-builder` | plugin viewer only | tabbed read-only view/focus | visual validator |
| Research | `luna-builder` | `pi-research` branch/config docs | hardening/pairing | security reviewer |
| Compaction/security | `luna-builder` | isolated extension/tests | handoff/cloak/telemetry gates | Luna validator |
| Pi-Herdr migration | `luna-builder` | launcher/composition only | slim ownership/removals | primary |
| Independent QA | `luna-validator` | no source edits | tests, RPC/TUI, egress, leaks | primary |

Concurrency starts at three and rises to four only after message/result reliability is proven. Each builder gets non-overlapping files/worktrees, finite tasks, explicit tool ceilings, and a required result envelope. No nested fan-out by workers.

---

## 8. Validation and acceptance matrix

### Core lifecycle

- start/new/resume/fork/reload/shutdown in one process where supported;
- no stale `pi`/`ctx`, duplicate widgets, handlers, headers, footers, intervals, or subscriptions;
- reduced motion and no-color behavior;
- widths 4/7/8/27/28/40/60/80/120 plus Unicode paths/model names;
- actual Pi TUI snapshots, not pure helper tests only.

### Rendering

- pending/partial/success/error/truncation;
- parallel calls and redraws;
- one compact transcript row and bounded expanded detail;
- exact structured metrics and model-content preservation;
- synthetic external adapter and malicious oversized/control-character inputs.

### Context/performance

- zero repeating timers at idle/shutdown;
- count `requestRender`/event bursts and same-state no-ops;
- sustained active CPU/render frequency benchmark;
- startup system-prompt/tool-schema byte/token inventory per profile;
- no regression in context-result bounds across 50-turn fixtures.

### Research/network

- lazy startup, schema bounds, cancellation, timeout, malformed stream, nonzero exit, output spillover;
- explicit egress/provider/cookie/hosted-fetch policy;
- no telemetry endpoint calls;
- equivalent fixed online benchmark with citation/source/extraction assertions.

### Herdr/subagents

- 0.7 and 0.8 capability fixtures;
- agent start/working/blocked/done/idle/replacement/closed;
- pane move/ID changes and unowned-pane safety;
- bounded result/message ordering and primary-turn delivery;
- viewer scroll/focus/close and unseen-result semantics;
- profile tool ceiling, worktree isolation, timeout/cancel, no child fan-out.

### Profiles/settings/release

- resolved inventory matches declared allowlist;
- guarded/eval cannot silently activate write/bash/network/browser/subagents;
- install/remove/reload from a scratch `PI_CODING_AGENT_DIR`;
- no postinstall/telemetry/unpinned native artifact surprise;
- settings backup/atomic write/rollback;
- no production Pi/Herdr process kill during tests.

---

## 9. Cleanup order and rollback

1. **Do not delete first.** Disable/replace and prove parity.
2. Keep old paths blocked during the first dogfood window.
3. Store a migration manifest listing old path, replacement, settings entry, backup, and deletion approval.
4. Remove launcher references before deleting source.
5. Delete source/packages only after a fresh process proves no unresolved resource.
6. Preserve historical sessions/artifacts by default.
7. Use Pi `/reload` for extension changes and named isolated Herdr test sessions; never kill active Pi/Herdr processes.
8. Rollback is always profile/manifest reversion first, code reversion second.

---

## 10. Decision checkpoints

Before implementation crosses each gate, the user reviews:

1. **Visual baseline:** which current experimental surfaces remain default, opt-in, or local-only.
2. **Profile defaults:** whether visual-explainer and official Herdr state are globally available or profile-only.
3. **Research risk:** least-privilege AGY feasibility and the exact PWA provider/curator policy.
4. **Herdr upgrade:** remain on 0.7 compatibility or upgrade to 0.8 before the socket/view phase.
5. **Default migration:** exact settings diff and `interactive_shell` removal timing.
6. **Destructive cleanup:** final source/package deletion list; historical data is a separate decision.

---

## 11. Immediate next actions

1. Review/approve this cohesive plan and visual/product checkpoints.
2. Commit or separate the current uncommitted Acidbath UI experiment before cleanup work.
3. Implement Phase 0 baselines/tests/document banners only.
4. Implement Phase 1 no-visual core refactor and compaction/cloak tests.
5. Create the minimal local `herdr-subagents` vertical slice.
6. Dogfood the new Luna system for the remaining implementation and independent validation.

The earlier subagent visual remains useful as the detailed Herdr package example:

`~/.agent/diagrams/acidbath-herdr-subagents-plan.html`
