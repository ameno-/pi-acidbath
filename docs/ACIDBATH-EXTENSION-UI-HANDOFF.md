# Acidbath Extension-Only UI Handoff

Paste this prompt into a fresh Pi session when beginning implementation.

---

## Mission

Design and implement the next Acidbath UI as a **Pi extension only**. Do not modify Pi source, patch installed `node_modules`, monkey-patch private Pi modules, or create a fork as part of this phase.

The goal is a coherent terminal UI that preserves Pi's native session data as the canonical record while presenting compact activity by default and full detail on demand.

Before changing code, inspect the current Pi extension/TUI APIs and the Acidbath files listed below. Confirm which behaviors are actually supported by the installed Pi version. If an API is unavailable, design a graceful fallback rather than modifying Pi core.

## Core product decisions

1. Native Pi session JSONL remains canonical.
2. Acidbath display state is a projection only; it must never mutate model-visible reasoning, tool arguments, tool results, signatures, ordering, usage, or compaction data.
3. There is one compact activity surface and one unified detail overlay.
4. No permanent full reasoning or tool-output wall.
5. No simultaneous orb + lyrics + reasoning animation + tool transcript animation competing for attention.
6. Terminal-native overlays and scrolling are preferred over terminal scrollback rewriting.
7. Animation is restrained, reduced-motion aware, and disabled when idle.
8. Extension-only compatibility is more important than perfect replacement of Pi internals.

## Visual target

The default screen should feel like one calm workbench rather than several independent dashboards.

### Idle screen, wide terminal

```text
┌─ ACIDBATH ─────────────────────────────────────────────────────────────────────┐
│ fix authentication flow                                      session · 12m      │
│                                                                                │
│  > Type a message…                                                            │
│                                                                                │
│  ◇ settled   ready                                                            │
│                                                                                │
│  pi · sonnet · thinking default                 context 42% · turn 3 · 18.4k │
└────────────────────────────────────────────────────────────────────────────────┘
```

The activity line disappears or becomes a quiet `settled` state when there is no active work. Do not keep a large empty activity panel on screen.

### Reasoning in progress

```text
┌────────────────────────────────────────────────────────────────────────────────┐
│  ◇ reasoning  Inspecting the auth middleware and comparing token paths…        │
└────────────────────────────────────────────────────────────────────────────────┘
```

Only a safe, one-line preview is shown. It is not a replacement for the native thinking block. The preview must be bounded, ANSI/control-character safe, and display-only.

### Tool in progress

```text
┌────────────────────────────────────────────────────────────────────────────────┐
│  ◇ running   bash · pnpm test --filter auth                  4.2s              │
└────────────────────────────────────────────────────────────────────────────────┘
```

If multiple tools are active, show one aggregate line plus at most two compact active rows:

```text
│  ◇ tools  2 running   read src/auth.ts · grep token ./src                    │
```

Do not show full command output inline while a tool is running.

### Completed transcript rows

Completed calls should retain meaningful compact rows in the normal transcript. They must not be moved into a second persistent activity transcript.

```text
◇ bash  pnpm test --filter auth                              ✓ 4.2s · 18 passed
◇ read  src/auth.ts                                         ✓ 124 lines
◇ edit  src/middleware.ts                                   ✓ changed 1 file
```

A row may expose a small bounded result summary. Full output is available through the normal Pi detail affordance or the Run Inspector.

### Narrow terminal behavior

At 40–60 columns, collapse labels before content:

```text
◇ working  Inspecting auth middleware…
◇ bash     ✓ 4.2s
pi · sonnet                         ctx 42%
```

The UI must never wrap into a second competing dashboard merely because the terminal is narrow. Use width-aware elision and test at 40, 60, 80, and 120 columns.

## Unified Run Inspector

Add one command/shortcut, preferably `/inspect` or a verified Pi shortcut, opening a centered terminal overlay. Use `ctx.ui.custom(..., { overlay: true })` and Pi's native `ScrollView`/`Markdown` components where supported.

The overlay is the authoritative display surface for detail, but still reads from projection state and native session entries rather than replacing them.

### Inspector layout

```text
╭─ Run Inspector · current turn ───────────────────────────────────────────────╮
│ [t] Timeline   [r] Reasoning   [o] Tools   [c] Context                       │
├───────────────────────────────────────────────────────────────────────────────┤
│ 03:14:08  reasoning  Inspecting auth middleware                               │
│ 03:14:10  tool       read src/auth.ts                         ✓ 124 lines     │
│ 03:14:11  tool       grep token ./src                         ✓ 6 matches     │
│ 03:14:13  reasoning  The refresh path bypasses…                              │
│                                                                               │
│  ↑↓ scroll   tab/change view   enter/open   q/esc close       follow: on      │
╰───────────────────────────────────────────────────────────────────────────────╯
```

### Views

**Timeline**

- chronological reasoning/tool/status events for the current run;
- compact rows by default;
- active event pinned near the bottom while follow mode is on;
- scrolling up pauses follow mode;
- `g` returns to top, `G` returns to bottom.

**Reasoning**

- full Markdown-rendered thinking blocks where Pi exposes them to the extension;
- headings and paragraphs preserved;
- no truncation except terminal viewport scrolling;
- show block boundaries and timestamps when available;
- if historical reasoning cannot be intercepted on this Pi version, state that clearly and show the available native/session projection rather than fabricating content.

**Tools**

- one expandable card/section per call;
- tool name, target, status, duration, exit/result metadata;
- bounded output preview initially;
- full output scrollable inside the overlay;
- errors visually distinct;
- `read`, `grep`, `find`, `ls`, `bash`, `edit`, and `write` each get an explicit formatter contract;
- unknown/custom tools use a safe generic formatter.

**Context**

- model/provider/thinking level;
- token usage and context percentage;
- turn number and session/run id;
- compaction status when relevant;
- current profile/capability indicators;
- no duplicated giant context widget in the main layout.

The inspector should be useful after completion, not only while work is active. It must handle empty, active, completed, failed, aborted, and restored-session states.

## Extension-only implementation boundary

First verify the installed APIs in Pi documentation/source. Expected usable seams include:

- custom assistant-thinking renderer registration, if available;
- hidden thinking label configuration as a compatibility fallback;
- custom entry renderers;
- custom tool registration/renderers for built-in tools;
- `ctx.ui.custom` overlays;
- `ScrollView` and `Markdown`;
- Pi extension commands/shortcuts and event subscriptions;
- session-manager/context entries for canonical data access.

### Reasoning strategy

Prefer this order:

1. Use Pi's public assistant-thinking renderer hook to make the default thinking row compact while preserving the underlying message.
2. Capture the same thinking blocks into Acidbath's projection store for the Inspector.
3. If the hook is unavailable, use the supported hidden-thinking-label mechanism plus a compact activity widget, and expose only content the extension can safely observe.
4. Never rewrite terminal scrollback and never delete or mutate native session entries.

Be explicit in code comments and documentation about the historical limitation: an extension may not be able to replace every already-rendered historical native reasoning block on every Pi version.

### Tool strategy

Acidbath already wraps the built-in tools. Refine that approach:

- preserve model-visible tool definitions and execution results;
- use compact custom renderers;
- restore normal completed transcript rows rather than hiding all transcript rendering;
- remove the separate `ToolActivityTranscript` history and its command-driven scrolling;
- keep a one-line transient active-tool status above the editor;
- leave completed calls in Pi's native transcript, expanded by default and collapsible with Pi's native `Ctrl+O` affordance;
- route cross-run/full-detail browsing to the Inspector;
- detect/handle registration collisions rather than silently double-registering tools.

The active-tool projection and the final transcript row must share one entry keyed by `toolCallId`, not maintain separate histories.

## Proposed state model

Create a small UI projection store, separate from the native session:

```ts
interface RunProjection {
  generation: string;
  runId?: string;
  phase: "idle" | "reasoning" | "tool" | "composing" | "error" | "done";
  startedAt?: number;
  reasoning: ReasoningProjection[];
  tools: Map<string, ToolProjection>;
  timeline: TimelineEvent[];
  context?: ContextProjection;
}

interface ReasoningProjection {
  id: string;
  text: string;
  startedAt?: number;
  completedAt?: number;
  active: boolean;
}

interface ToolProjection {
  id: string;
  name: string;
  target?: string;
  status: "pending" | "success" | "error" | "aborted";
  startedAt?: number;
  completedAt?: number;
  metadata: string[];
  previewLines: string[];
  fullResultAvailable: boolean;
}
```

Use immutable snapshots or a reducer where practical. All views should render from the same store. Add generation checks so events from a replaced session/run cannot update the current screen.

## Suggested file changes

Inspect and then refactor, rather than assuming these files are still unchanged:

- `extensions/acidbath/index.ts`
- `extensions/acidbath/ui-activity-status.ts`
- `extensions/acidbath/ui-tool-activity.ts` (remove after native transcript migration)
- `extensions/acidbath/ui-tools.ts`
- `extensions/acidbath/ui-footer.ts`
- `extensions/acidbath/ui-header.ts`
- `extensions/acidbath/ui-context-widget.ts`
- `docs/ui-tool-display-research.md`
- `docs/COHESIVE-IMPLEMENTATION-PLAN.md`
- `package.json`

Likely new modules:

```text
extensions/acidbath/ui-run-store.ts
extensions/acidbath/ui-run-inspector.ts
extensions/acidbath/ui-run-inspector-views.ts
extensions/acidbath/ui-tool-summary.ts
extensions/acidbath/ui-display-contract.ts
```

Do not create a new permanent dashboard unless the existing surfaces can be removed or clearly demoted.

## Interaction contract

- `/inspect` opens the Inspector.
- `Esc` or `q` closes it.
- `Tab` cycles Timeline/Reasoning/Tools/Context.
- `↑/↓` or `j/k` scrolls.
- `g/G` jump to top/bottom.
- scrolling away from bottom disables follow mode;
- `f` toggles follow mode;
- `Enter` expands the selected tool or reasoning block when meaningful;
- Inspector must not steal input when closed.

Use Pi's documented keybinding/overlay APIs. Do not intercept global keys through unsafe terminal hacks.

## Lifecycle and performance requirements

- No repeating animation timers while idle.
- Every timer, subscription, widget, and overlay must have explicit disposal.
- One bounded shared animation clock is preferred.
- Reduced motion and `NO_COLOR` must work.
- Run/session replacement must clear old projection state safely.
- Overlay rendering must not block tool execution or model streaming.
- Long output is scrollable and bounded; do not allocate unbounded joined strings for every render.
- Event handlers must be idempotent and tolerate duplicate lifecycle notifications.

## Implementation phases

### Phase 0: feasibility audit

- Verify each public Pi seam against installed docs/types/source.
- Identify exactly which reasoning content is observable during streaming and after session restore.
- Run the current tests/typecheck and record baseline behavior.
- Do not implement until the extension-only boundary is documented.

### Phase 1: shared projection store

- Add the store and event normalization.
- Feed current tool lifecycle events into it.
- Keep existing visuals temporarily, but make them read from the store where possible.
- Add unit tests for ordering, deduplication, generation replacement, errors, aborts, and bounded previews.

### Phase 2: compact default surface

- Replace duplicate activity surfaces with one compact active line/dock.
- Restore meaningful completed tool rows.
- Remove duplicate persistent tool-activity history.
- Make reasoning compact by the best supported public renderer seam.

### Phase 3: Run Inspector

- Implement overlay shell and scrolling.
- Add Timeline, Reasoning, Tools, and Context views.
- Add keyboard command/shortcut.
- Test active, completed, error, aborted, empty, and restored states.

### Phase 4: cleanup and compatibility

- Remove dead state/timers/widgets.
- Add capability detection and fallback behavior.
- Test multiple Pi versions if available.
- Update documentation and package scripts.
- Keep any unavailable full-history behavior explicitly documented rather than pretending extension-only support is complete.

## Acceptance criteria

A change is successful only if:

1. No Pi source file or installed package is modified.
2. Native session JSONL remains unchanged except for normal Pi behavior.
3. Full reasoning/tool details remain accessible through the Inspector or native Pi affordances.
4. The idle UI has one quiet status surface, not several duplicate activity surfaces.
5. A completed tool call leaves one meaningful compact transcript row.
6. Active tools do not create duplicate history rows.
7. `/inspect` provides scrollable Timeline, Reasoning, Tools, and Context views.
8. The overlay works at 40/60/80/120 columns.
9. Reduced motion, no color, errors, aborts, session replacement, and restored sessions work.
10. Idle repeating timers are zero or demonstrably justified.
11. Tests cover the projection store and every built-in tool formatter.
12. If an installed Pi version lacks a desired renderer seam, Acidbath falls back cleanly and says so in docs/logging.

## Deliverables for the fresh session

Before implementation, return:

1. a short feasibility report naming the exact public Pi APIs available;
2. a proposed file-by-file change list;
3. an ASCII or rendered visual mockup of the final layout and Inspector;
4. a list of behaviors that are impossible or partial under extension-only constraints;
5. a phased implementation plan with test strategy.

Then implement the smallest viable Phase 1/2 slice, run the relevant tests/typecheck, and show the diff. Do not broaden scope into Herdr, research, telemetry, package restructuring, or Pi core changes.

Existing visual reference:

```text
/Users/ameno/.agent/diagrams/acidbath-reasoning-inspector-mockup.html
```

The canonical design principle is:

> Compact by default, inspectable on demand, native session content preserved, and one source of truth for every visible run state.
