# Acidbath next UI pass: layout and tool-call research

**Status: historical research.** The current layout keeps a static right-side
footer context rail and one transient activity rail. Context placement controls,
footer lyrics, and tool-row animation described below are no longer part of the
core runtime.

## Executive recommendation

1. Make context **on by default**, but move the visible context indicator into a **right-aligned footer rail**, not another full-width widget. Keep `/context off` as an explicit escape hatch. A right rail is supported by the existing footer contract; Pi's widget API is vertical-only (`aboveEditor`/`belowEditor`).
2. Give each fact one owner: Acidbath identity in a minimal header, cwd and model/thinking in one footer line, context at the footer's right edge, and working state in Pi's working indicator/message. Do not repeat model/cwd/context in the header.
3. Replace the current tool wrapper's “glyph around the stock renderer” with an Acidbath-owned **status-first row**. Keep default output collapsed to metadata; reserve framed output and diffs for expansion or errors. Use the existing shared pending clock, but no new always-on animation loop.
4. Treat `read`, `grep`, `find`, `ls`, `bash`, `edit`, and `write` as Acidbath's explicit built-in ownership set. Do not render external tools by name or take over their execution. If an adapter is added later, it must be opt-in and ownership-aware.
5. Prototype the right rail, row vocabulary, and width behavior as pure fixtures before changing the extension. Production work should follow only after real TUI placement and collision tests.

## Evidence reviewed

### Acidbath

- `extensions/acidbath/index.ts` — session lifecycle, borderless editor, custom header/footer/context installation, context polling, working labels, cleanup.
- `extensions/acidbath/ui-header.ts` — current `AcidbathHeader` component.
- `extensions/acidbath/ui-context-widget.ts`, `ui-context-pyramid.ts`, and `ui-gauge.ts` — context model and animation.
- `extensions/acidbath/ui-tools.ts`, `ui-motion.ts`, and `ui-labels.ts` — current tool wrappers and motion/label behavior.
- `README.md`, `docs/context-pyramid-spec.md`, `docs/ui-tool-display-research.md`, and the existing UI handoff/review notes.

### Pi renderer and TUI API

- Installed Pi documentation: `.../pi-coding-agent/docs/extensions.md`, `docs/tui.md`, and `docs/sdk.md`.
- Installed runtime source: `.../pi-coding-agent/dist/modes/interactive/interactive-mode.js` and `dist/core/extensions/types.d.ts`.
- Relevant API facts: `ctx.ui.setHeader`, `ctx.ui.setFooter`, `ctx.ui.setWidget`, `ctx.ui.setEditorComponent`, `ctx.ui.setWorkingIndicator`, `ctx.ui.setWorkingMessage`, and tool `renderCall`/`renderResult`/`renderShell`.

### Reference packages (read-only)

- `/tmp/pi-tool-display` — README, `src/tool-overrides.ts`, `src/bash-display.ts`, `src/render-utils.ts`, and `src/diff-presentation.ts`.
- `/tmp/pix-mono/packages/pix-pretty` — `src/utils.ts`, `src/renderers.ts`, `src/diff-render.ts`, `src/widget-format.ts`, `src/types.ts`, and tool context helpers.
- `/tmp/pix-mono/packages/pix-bash/src/bash.ts` and tests.
- `/tmp/pix-mono/packages/pix-read/src/read.ts` and tests.
- `/tmp/pix-mono/packages/pix-edit/src/edit.ts` and tests.
- `/tmp/pix-mono/packages/pix-footer/src/footer.ts` and tests.
- `/tmp/pix-mono/packages/pix-welcome/src/welcome.ts`.

The references are pattern sources only. Acidbath should not load either package as a runtime dependency for this pass.

---

## 1. Context and layout

### Current behavior and the requested delta

The current implementation is intentionally not yet the requested layout:

- `parseContextPlacement()` defaults to `"right"`; `README.md` documents `PI_ACIDBATH_CONTEXT=right|above|below|off` with default `right`.
- `index.ts` uses a consolidated footer for the default right rail and installs `acidbath-context` with `setWidget(..., { placement: "aboveEditor" | "belowEditor" })` only for expanded alternatives.
- `ContextPyramidWidget` renders a three-row, left-aligned pyramid and falls back to a one-line gauge below 28 columns.
- A context value is polled every 1,000 ms and also refreshed on provider/tool/agent events.
- The animation ticks every 80 ms and advances `renderedPercent` by `0.16` toward the target.

The requested pass changes the contract to: **context visible by default, right side, and visibly responsive to small changes such as 3%**. The existing full-width pyramid and `aboveEditor`/`belowEditor` placement cannot satisfy “right side” by changing only the placement string: Pi's widget API has no right-dock placement.

### What Pi actually provides

The installed `ExtensionUIContext` defines:

- `setWidget(key, content, { placement })`, where placement is only `aboveEditor` or `belowEditor`; factories receive `(tui, theme)`.
- `setEditorComponent(factory)`, whose factory receives `(tui, theme, keybindings)`; `CustomEditor` is the supported base when preserving app keybindings and abort/model controls.
- `setFooter(factory)`, whose factory receives `(tui, theme, footerData)`. `footerData` exposes git branch and extension statuses; model, thinking level, cwd, and context can be read from the session/extension context.
- `setHeader(factory)`, which replaces Pi's built-in header component above the chat/document area. It is a different surface from a widget.
- `setWorkingIndicator` and `setWorkingMessage`, which customize the transient streaming loader.

The TUI component contract is `render(width): string[]`, optional `handleInput`, and `invalidate()`. Every returned line must be no wider than the supplied width. The host appends resets per line. A component that starts timers must own and dispose them, and state changes should call `tui.requestRender()`.

The installed interactive layout is important:

```text
transcript scroll view (document/header/chat)

pending messages
status / working indicator
above-editor widget container   (shrinkable, min size 0)
editor container                (min size 3)
below-editor widget container   (shrinkable, min size 0)
footer                          (min size 1)
```

The source uses `VStack` rows with `shrink: 1, minSize: 0` for both widget containers. The above container also gets a spacer when it is empty. There is no lateral widget dock.

### Why the current Acidbath header may not be visible

There is no single proven failure from source inspection, but the current design has several credible visibility failure modes:

1. **It is registered as a widget, not as Pi's header.** `index.ts` calls `ctx.ui.setWidget("acidbath-header", ...)` with the default `aboveEditor` placement. The installed Pi API has a dedicated `ctx.ui.setHeader(...)` surface. A widget is in the dock, not in the header/document container.
2. **The widget row is shrinkable to zero.** The above-editor widget container has `minSize: 0`. As transcript, pending status, editor, below widgets, and footer compete for a short terminal, the layout may allocate no rows to the header widget. This is the strongest source-level explanation for “it exists but cannot be seen.”
3. **Widgets and the editor share the lower dock.** A context widget placed `aboveEditor` stacks with the header widget. Once context is made default-on, the two compete for the same vertical budget unless they are consolidated. A welcome widget from another extension can add more pressure.
4. **The header is easy to mistake for a startup-only surface.** Pi's real `setHeader` lives above chat in the scrollable document; it can scroll out of view after enough transcript content. Conversely, the current widget should be docked, but is vulnerable to shrink. The two APIs have different persistence/visibility semantics.
5. **The extension only installs it in TUI mode and startup ordering matters.** `index.ts` correctly guards `ctx.mode !== "tui"`, but print/RPC/JSON runs will not show it. Pi's `setHeader` implementation also ignores a factory called before its built-in header is initialized; Acidbath calls from `session_start`, which is normally late enough, but a real-session fixture should confirm this.
6. **The borderless editor is an independent risk.** `BorderlessEditor.render()` removes the first and last returned rows unconditionally. If a Pi version or narrow editor state returns fewer/different rows, it can remove editor content. That does not directly hide the widget, but can make the whole lower layout appear broken and obscure diagnosis.
7. **Width logic is not terminal-width-safe for all text.** `ui-header.ts` uses JavaScript `.length`, not Pi's `visibleWidth`, for model/cwd fit decisions. Wide Unicode or ANSI-bearing names can overrun or be dropped to the title-only fallback. This is a truncation/visibility defect, not the primary missing-widget cause.

The minimal diagnostic is an actual TUI transcript at 40/60/80/120 columns with: context off, context above, context below, a long transcript, and a short terminal. It should count the header and inspect whether the widget container was squeezed.

### Minimal layout contract (proposed production target)

| Surface | Sole owner | Visible content | Default behavior |
|---|---|---|---|
| Acidbath header | `ctx.ui.setHeader` or a deliberately reserved one-line brand surface | `acidbath` identity only; optional static mark | One compact line; no model/cwd/context/status |
| Footer | `ctx.ui.setFooter` (or the built-in footer if it already meets this contract) | `cwd` + `model · thinking`; right-aligned context rail | One line, width-clamped; no working sentence |
| Editor | `CustomEditor` wrapper | User input only; no status metadata | Borderless only if border removal is verified against real Pi output |
| Working indicator | `setWorkingIndicator` + `setWorkingMessage` | Orb and one short lifecycle phrase | Visible only while working; no duplicate footer status |
| Context | Right segment of the footer, owned by Acidbath | `ctx 43%` plus a small coarse gauge | On by default; `/context off` hides it; no second widget |
| Tool row | Acidbath tool renderer | Pending/success/error + target + structured metadata | One compact row; detail only when expanded or exceptional |

This contract makes the right side a stable horizontal rail rather than trying to force a right-side widget into a vertical-only API. It also prevents the header from becoming a second status bar.

The footer should be laid out from stable segments, then right-align the context segment:

```text
[cwd] · [model · thinking]                         [ctx gauge] 43%
```

At narrow widths, drop optional separators and shorten the cwd/model before dropping the context percentage. The percentage is the semantic fallback; the cells are decoration. If retaining Pi's built-in footer is preferable, Acidbath should only add a named status segment and verify that the built-in footer does not already repeat these fields. Replacing the footer is justified only to guarantee the one-owner contract.

### Coarse, visible context motion

The current `0.16` easing step is smooth in the wrong way for a tiny indicator. A 3% target change can converge in one tick, and a three-row pyramid has too few cells for that change to move a cell. The numeric label may change, but the fill can appear static.

Recommended behavior for a prototype and eventual production implementation:

- Quantize the display to explicit, deterministic steps rather than a continuous easing fraction.
- For every non-zero change, render at least one distinct transition frame. A small delta must not be swallowed by rounding.
- Use a compact horizontal rail with a fixed cell budget (for example, 16–24 cells) and a stable `ctx 43%` label. For a delta that does not cross a cell boundary, the percentage still changes and a one-frame directional marker (`↑`/`↓`) or one-step wipe supplies visible motion. The marker should disappear when settled; it is not a second status.
- Keep the transition short and event-driven: one timer per active context transition, stopped at the target. Do not poll or animate while the value is unchanged.
- `PI_ACIDBATH_REDUCED_MOTION=1` jumps directly to the final percentage and starts no animation timer.
- `NO_COLOR` keeps the same ASCII-safe gauge and directional semantics without ANSI. Do not rely on color to make a 3% change visible.
- Use `visibleWidth`/`truncateToWidth` for all segments. At 60 columns the right rail may be only `ctx 43%`; at 80/120 it can show cells.

A pure formatter should accept `{ percent, target, phase, width, noColor }` and be testable without Pi. The runtime widget/footer controller should only own invalidation and timer lifecycle.

### Information ownership and duplication audit

Current and reference behavior makes repetition likely: the Acidbath header shows model/cwd, Pi's footer also has model/context/token information, the working loader has a message, and the context pyramid has a percentage. The next pass should make this table executable:

| Fact | Current candidates | Choose one |
|---|---|---|
| Product identity | Acidbath widget/header; Pi startup header | Acidbath header brand only |
| Model | Acidbath header; Pi footer; model selector | Footer; selector is interaction, not a persistent duplicate |
| Thinking level | Pi hidden-thinking label and possibly footer | Footer abbreviated (`med`, `high`); hidden thinking label is content labeling, not status |
| Cwd | Acidbath header; tool paths; Pi footer | Footer short cwd; tool rows show target paths only when relevant |
| Context usage | Optional pyramid; Pi footer may show usage | Footer right rail; one percentage, one gauge |
| Working status | Orb, working message, pending tool glyph | Working indicator/message owns agent phase; tool rows own tool phase |
| Tool target/result | Stock renderer plus Acidbath glyph | Acidbath row contract; expanded body is the only second presentation |
| Git branch/status | Pi footer data provider | Footer, only if retained; never duplicate in header |

The word “header” should not imply “all session state.” A minimal brand header plus a single operational footer is quieter and more legible than a metadata-heavy header.

### Prototypes versus production

**Prototype now (documentation/fixtures only):**

- Right-aligned footer rail variants.
- A formatter that shows the 3% transition as a discrete, visible change.
- A width matrix for the brand/header, footer, and borderless editor.
- A short ownership/collision matrix.

**Production recommendation after review:**

- Change the default context setting to on and make the right rail the only context surface.
- Consolidate the footer only if a real Pi capture confirms the built-in footer cannot meet the table above.
- Prefer `setHeader` for the brand if a startup/document header is acceptable; otherwise use one reserved one-line widget and explicitly test short-terminal behavior.
- Do not add a general layout framework or a dependency.

---

## 2. Tool-call UI research

### Why current lifecycle output is verbose/ugly

`extensions/acidbath/ui-tools.ts` currently does four things:

1. Re-registers seven tools under their built-in names.
2. Delegates `renderCall` to each stock renderer and wraps the first rendered line with a pending/success/error glyph.
3. Delegates `renderResult` unchanged, so the result has no corresponding Acidbath lifecycle glyph or compact metadata contract.
4. Uses one shared `MotionClock`, subscribed only for pending calls, which is a good low-churn pattern.

This creates an inconsistent pair: a decorated call header followed by a potentially large stock result block. The wrapper changes the available width by two columns, but does not itself truncate with `visibleWidth`/`truncateToWidth`. It also does not collapse output, summarize duration/counts/exit status, render diffs, or distinguish partial output beyond the delegated renderer.

The current `NO_COLOR` flag only controls Acidbath's lifecycle glyph color. Delegated stock renderers still receive and may emit their normal theme styling, so “NO_COLOR means no ANSI” is not established by `ui-tools.ts` alone. That needs a fixture, not an assumption.

### Pi's renderer contract and useful lifecycle fields

Pi's tool docs establish a better seam than post-processing terminal strings:

- `renderCall(args, theme, context)` and `renderResult(result, options, theme, context)` each return a `Component`.
- `context` includes `toolCallId`, `state`, `lastComponent`, `invalidate`, `cwd`, `executionStarted`, `argsComplete`, `isPartial`, `isError`, `expanded`, and image/width-related flags in the installed runtime.
- `context.state` is row-local and shared between call/result slots; `lastComponent` permits in-place `Text.setText()` updates.
- `renderShell: "self"` opts out of Pi's default `Box`, allowing an extension to own background, framing, and full-width clamping.
- Partial rows should remain live; `expanded` is the explicit detail affordance; errors should not disappear into a success-looking compact row.
- Component output must honor the passed width. `invalidate()` must clear caches after theme changes, and async highlighting/diff rendering must call `context.invalidate()` when ready.

The production renderer should use these APIs directly, not parse the already-rendered stock component.

### `pi-tool-display` findings

`/tmp/pi-tool-display` is the strongest reference for policy and ownership:

- Per-tool ownership flags prevent an extension from silently taking over a built-in renderer.
- Result modes are `hidden`, `summary`/`count`, and `preview`; this preserves a compact default while keeping expansion useful.
- Completed rows can collapse to a metadata summary while `Ctrl+O` restores the exact output. Partial results are not collapsed.
- `bash` supports a collapsed command form, a line-count summary, or a bounded preview. It recognizes quiet commands and can say “command completed (no output)” instead of showing an empty block.
- `edit`/`write` have adaptive diff modes: summary at very narrow widths, unified at medium widths, split only when the terminal can support it. Pending edit/write previews are projected only when safe and scoped to the workspace.
- Structured display metadata is kept separate from the model-visible content: counts, truncation, full-output path, line statistics, and write execution metadata.
- Custom/external tools are opt-in through an adapter API and do not get blanket rendering based on their name.

Acidbath should borrow these contracts, not the package. The package is a second renderer/owner of the same seven built-ins and therefore increases collision risk if installed alongside Acidbath.

### `pix-mono` findings

`pix-pretty`, `pix-bash`, `pix-read`, `pix-edit`, `pix-footer`, and `pix-welcome` show a coherent visual vocabulary:

- `renderCollapsedToolRow()` uses a common one-row form: `✓ tool target · metadata`, `✗ tool target · failed`, or a warning icon. `hideCollapsedToolCall()` removes the old call row once the result owns the collapsed summary, avoiding call/result duplication.
- `tickCollapse()` is shared, but the default auto-collapse delay is a product choice. It should not be copied into Acidbath until expansion, timer disposal, and accessibility behavior are tested.
- `pix-bash` captures command, exit code, duration, and output line count in display details. Its `renderShell: "self"` allows full-width rules and a bounded body. It summarizes command chains rather than repeating every step.
- `pix-read` stores file path, offset, normalized content, line count, and image MIME/size. Its expanded form uses line numbers, bounded syntax highlighting, and a “more lines” footer.
- `pix-edit` stores diff stats and structured old/new content, renders `+A -R` summaries, and chooses split/unified diff based on width. It also uses word-level emphasis when the paired lines are sufficiently similar.
- `pix-pretty` centralizes background fill, ANSI-safe truncation, rule frames, semantic counts, and error rows. The shared helpers are more important than the icons.
- `pix-footer` demonstrates a single footer line that composes cwd/branch, context usage, model/thinking, extension statuses, token totals, and transient throughput, then clamps with `truncateToWidth`.
- `pix-welcome` uses an above-editor widget, live startup checks, bounded content, and dismissal on first turn. It is a useful lifecycle reference but would compete with a default-on context widget; Acidbath should not stack both by default.

Potentially useful, but not for immediate production: syntax-highlighted read previews, full framed bash output, projected pending diffs, word diffs, and auto-collapse timers. Each adds rendering work and more state than the current quiet baseline.

### Comparison of display strategies

| Strategy | Strength | Cost/risk | Acidbath judgment |
|---|---|---|---|
| Current glyph wrapper | Very low code churn; shared pending clock is sound | Duplicates stock call/result visual language; no metadata; result remains verbose; ownership is implicit | Retain only as a compatibility baseline, not the next UI |
| Compact collapsed rows | One glance gives state/target/result; low vertical churn | Requires structured details, expansion state, and hiding the paired call row | **Production baseline** |
| Framed bash/output | Output boundaries are clear; errors and previews are readable | More lines, background/width complexity, self-shell responsibility | Prototype; production only for expanded bash or errors |
| Adaptive diffs | High value for edit/write; summary works at 60, unified at 80, split at 120 | Async highlighting, width fixtures, diff metadata and cache invalidation | **Production for expanded edit/write; summary by default** |
| Generic external-tool rows | Covers research, subagents, interactive shell, and future tools | Unknown schemas, result ownership, load order, and misleading metadata | Adapter prototype only; no blanket interception |
| Auto-collapse after delay | Keeps long sessions quiet | Timer churn, surprising state changes, error accessibility, concurrent-call races | Defer; explicit expansion first |

### Acidbath-owned alternatives

These are original contracts to prototype locally, not imports from the reference packages.

#### Alternative A — Status-first compact row (recommended)

Each tool call/result owns one stable row. The call row is pending only; once a result is finalized, the result row replaces it. Default output is summarized, not dumped.

```text
pending:  … read src/acidbath/ui-tools.ts (1–160)
success:  ✓ read src/acidbath/ui-tools.ts · 160 lines
error:    ! edit extensions/acidbath/index.ts · old text not found
partial:  … bash bun test · running
```

Rules:

- `…` means partial/pending, `✓` success, `!` error/warning. The same shapes remain meaningful under `NO_COLOR`.
- Metadata is semantic: `42 lines`, `8 matches`, `+3 -1`, `exit 0 · 2.4s`, `3 sources`.
- No raw JSON by default. A generic result gets only tool name, a safe target/label, and a count if one is explicitly present in details.
- Errors stay as a visible one-line diagnostic when short; longer errors remain expanded or show `! tool target · failed · Ctrl+O`.
- Partial rows never auto-collapse and are invalidated only by their own call id.
- Expanded content delegates to an Acidbath-owned preview/diff policy; it is not another summary row.

This is the recommended production base because it directly fixes repetition and vertical churn without requiring a new shell for every tool.

#### Alternative B — Framed exception shell

Use the same status-first row for normal results, but switch to a self-rendered framed block only for expanded output, bash with useful output, edit/write diffs, and errors:

```text
✓ bash bun test · exit 0 · 18 lines · 2.4s
────────────────────────────────────────────────────────────
  1 passing
  2 changed 3 files
────────────────────────────────────────────────────────────
```

Rules:

- `renderShell: "self"` is used only by the tools that need it, with a single width-aware frame helper.
- The body is bounded and gets an explicit `… N more lines` footer.
- Read output uses line-numbered preview only when expanded; grep/find/ls use count summaries by default.
- Edit/write use `+A -R` in the row, unified diff at medium width, and split diff only when the fixture proves it fits.

This is a strong visual prototype and a selective production enhancement, but not the initial default for all tools. It has higher redraw and background/ANSI risk than Alternative A.

#### Alternative C — Adapter-aware semantic rail

Built-ins use Alternative A. A separately registered external tool may opt into a tiny renderer adapter:

```text
↗ research "Pi renderer APIs" · 6 sources
↗ subagent review · 1m 12s
↗ shell session · running
```

The adapter supplies a stable `label`, optional `target`, state, and structured metadata. Acidbath does not infer that a tool named `research` or `subagent` is safe to render, does not change execution, and does not override an existing renderer unless an explicit ownership flag says so.

This is useful for `pi-interactive-shell`, research, or subagent extensions, but is a prototype/extension point, not a reason to add external dependencies. The first production pass should leave external tools on their existing renderers and verify no collision.

### Sample output fixtures (Alternative A)

The following are proposed plain-text fixtures. ANSI colors are omitted so they also describe `NO_COLOR`; `…` is a lifecycle glyph, not an ellipsis in a path.

#### 60 columns

```text
… read src/ui-tools.ts (1–160)
✓ read src/ui-tools.ts · 160 lines
✓ grep "renderResult" extensions · 7 matches
✓ edit src/index.ts · +3 -1
✓ bash git diff --check · exit 0 · 0 lines · 180ms
! bash bun test · exit 1 · failed
↗ research "Pi TUI footer" · 6 sources
↗ subagent review · 1m 12s
```

At 60 columns, omit long durations and secondary targets before truncating the tool name/state. An error may use one extra line for the short diagnostic:

```text
! edit src/index.ts · failed
  old text not found (Ctrl+O)
```

#### 80 columns

```text
… bash bun test && bun run lint · running
✓ bash bun test · exit 0 · 18 lines · 2.4s
✓ read src/ui-tools.ts · 214 lines
✓ grep "renderCall" extensions · 12 matches
✓ edit extensions/acidbath/index.ts · +3 -1 · 1.1s
! edit src/index.ts · old text not found
↗ research "Pi renderer APIs" · 6 sources · 4.8s
↗ subagent review · 1m 12s · 5 findings
```

#### 120 columns

```text
… bash bun test && bun run lint && git diff --check · running
✓ bash bun test · exit 0 · 18 lines · 2.4s · cwd acidbath
✓ read extensions/acidbath/ui-tools.ts:1–214 · 214 lines · 8.7KB
✓ grep "renderResult" extensions/acidbath · 12 matches · 3 files
✓ edit extensions/acidbath/index.ts · +3 -1 · at line 173 · 1.1s
! edit extensions/acidbath/index.ts · old text not found · Ctrl+O for diagnostic
↗ research "Pi TUI footer/editor/widget APIs" · 6 sources · 4.8s
↗ subagent review · 1m 12s · 5 findings · model gpt-5.6
```

The 120-column examples intentionally show what is *optional* metadata. They do not make the 60-column contract depend on it.

### Sample output fixtures (Alternative B expanded exceptions)

```text
✓ bash bun test · exit 0 · 18 lines · 2.4s
────────────────────────────────────────────────────────────────────────────
  1 passing
  2 files checked
────────────────────────────────────────────────────────────────────────────

✓ edit src/index.ts · +3 -1
────────────────────────────────────────────────────────────────────────────
  41  const before = value;
  41- const before = oldValue;
  41+ const before = nextValue;
────────────────────────────────────────────────────────────────────────────
```

Width policy for the prototype:

- 60: one-line diff summary; framed bash body capped to 3 lines.
- 80: unified diff with bounded lines; no split columns.
- 120: split is allowed only if both code panes remain readable; otherwise unified wins.
- Any width: `NO_COLOR` keeps signs, line numbers, rules, and status text; reduced motion removes pending frame changes but not the final row.

### Tool-by-tool proposed metadata

| Tool | Compact call | Compact finalized row | Expanded body |
|---|---|---|---|
| `read` | `… read path[:range]` | `✓ read path · N lines` or image MIME/size | Bounded line-numbered preview; no output by default |
| `grep` | `… grep pattern path` | `✓ grep path · N matches` | Bounded matching lines, with semantic match count |
| `find` | `… find pattern path` | `✓ find path · N results` | Bounded result list |
| `ls` | `… ls path` | `✓ ls path · N entries` | Compact bounded listing/tree |
| `bash` | `… bash command summary` | `✓ bash summary · exit 0 · N lines · duration` | Framed bounded output; quiet command says no output |
| `edit` | `… edit path · N edits` | `✓ edit path · +A -R` | Adaptive unified/split diff; pending preview only if safe |
| `write` | `… write path · N lines` | `✓ write path · created/updated · +A -R` | Adaptive diff or bounded preview |
| external | `↗ label target` only through adapter | `↗ label · supplied metadata` | Adapter-owned preview; never guessed from raw result |

“Duration” should be captured at execution boundaries, not inferred from render timing. “Count” must come from structured details where possible; do not recount a body after adding notices, blank lines, or truncation hints.

### Partial, error, and ownership rules

**Partial:** Show a stable pending row and the current safe argument summary. Never present a partial edit/write diff as final unless the projection is deterministic, workspace-scoped, and visibly labeled `pending`. Never auto-collapse a streaming result.

**Error:** Preserve a semantic error marker without color. If the diagnostic is short, put it in the row; otherwise show a one-line summary with an expansion hint and preserve the full diagnostic when expanded. An error must not settle into `✓`, `done`, or an empty output block.

**Truncation:** Display truncation metadata (`… N more lines` or `truncated`) while preserving Pi's original model-visible result. Display caps must be bounded independently from the tool's context caps.

**Ownership:** The current Acidbath registration calls `pi.registerTool()` with each built-in name and does not inspect `pi.getAllTools()`/`sourceInfo` before taking ownership. Pi explicitly supports same-name built-in overrides, but multiple extensions then depend on load order and can replace each other's `renderCall`/`renderResult`. `pi-tool-display` mitigates this with per-tool ownership switches and deferred ownership discovery; its adapter API makes external decoration opt-in. Acidbath should adopt the policy, not the package:

- Explicitly document Acidbath's seven built-in renderer ownership.
- Before production takeover, detect a non-`builtin` current owner and skip or report the collision rather than silently winning.
- Keep external tool handling opt-in and renderer-only.
- Do not wrap `pi-interactive-shell`, research, subagent, MCP, or other external execution paths by name.
- Key all transient state by `toolCallId`; dispose on result completion, session shutdown, and reload.

### Low-churn and accessibility constraints

- Keep the current shared `MotionClock` pattern: one timer only while at least one tool call is pending; invalidate subscribed rows only.
- Do not add a spinner per tool or a timer per result.
- Freeze tool motion under `PI_ACIDBATH_REDUCED_MOTION=1`; use a deterministic pending glyph.
- `NO_COLOR` must preserve state through glyph and text, not color alone. Add a fixture that strips ANSI and checks visible-width limits.
- Cache async diff/highlight output by tool call, content, theme, width, and expanded state; invalidate only when the key changes or the async work completes.
- Prefer `truncateToWidth`/`visibleWidth` over JavaScript string length. Preserve path suffixes only if the policy is deterministic.
- Start with explicit expansion, not time-based auto-collapse. If auto-collapse is later approved, test concurrent calls, errors, resize, reduced motion, and re-expansion first.

---

## Production recommendations versus prototypes

### Recommend for production after review

- Context default on, right-aligned footer rail, `/context off` retained.
- One-owner layout contract: brand header, operational footer, working indicator, tool rows.
- Alternative A compact rows for all seven built-ins.
- Structured display metadata for counts, duration, exit code, diff stats, truncation, and image size, kept out of model content.
- Adaptive edit/write summary and expanded diff; framed bash only for expanded output/errors.
- Explicit width/ANSI/reduced-motion fixtures and built-in ownership diagnostics.
- No new dependency and no external tool execution/rendering takeover.

### Prototype only until acceptance evidence exists

- A full `setFooter` replacement if Pi's built-in footer can already satisfy the ownership table.
- Persistent custom header versus startup `setHeader` semantics.
- Directional context transition marker for sub-cell deltas.
- Projected pending edit/write diffs.
- Async syntax highlighting and split diffs.
- Time-based auto-collapse.
- Adapter rendering for research, subagent, shell, MCP, or other external tools.
- Welcome/health-check content alongside default-on context.

---

## Implementation sequence

1. **Freeze the contract in pure fixtures.** Add no runtime behavior yet: define plain-text layout cases for the right rail, ownership table, row vocabulary, and 60/80/120 width rules.
2. **Verify installed Pi placement.** Run a real TUI capture with current Acidbath at 40/60/80/120, checking `setWidget`, `setHeader`, `setEditorComponent`, footer height, short terminals, and long transcripts. Confirm the header visibility hypothesis before choosing `setHeader` versus a reserved widget.
3. **Build pure context formatting.** Implement/test a right-rail formatter with explicit quantization, a visible 3% transition, reduced-motion direct settle, no-color output, and ANSI-safe width clamping. Keep the existing context widget untouched until this is approved.
4. **Choose footer ownership.** Compare the installed built-in footer against the minimal contract. If it repeats or cannot right-align context, prototype a one-line `setFooter` replacement; otherwise use a small named status extension and do not replace the footer.
5. **Stabilize header/editor placement.** Prototype `setHeader` and the current widget side by side. Verify the borderless editor removes only borders at every fixture width and does not consume editor text.
6. **Introduce a pure tool-row formatter.** Cover pending, success, warning, error, partial, truncation, long path, and no-color cases. Keep it independent of Pi components.
7. **Add structured display metadata at the wrapper boundary.** Capture only display facts; preserve exact model-visible tool results. Keep state keyed by `toolCallId` and use the existing shared motion clock.
8. **Wire Alternative A for one low-risk tool first.** Start with `read` or `grep`, then add `bash`, `edit`/`write`, and `find`/`ls`. Ensure call/result duplication disappears and expansion restores detail.
9. **Add selective Alternative B.** Add framed bash and adaptive edit/write diffs only after width, async invalidation, error, and reduced-motion fixtures pass.
10. **Add ownership/collision handling.** Detect external current owners before registering built-in renderers. Leave external tools untouched unless a future explicit adapter is approved.
11. **Re-run performance and lifecycle checks.** Confirm idle has no new timers, pending timers stop, shutdown/reload clears widgets and state, and a second session does not retain stale labels, footer callbacks, or render components.

## Acceptance fixtures

1. **Layout transcript:** actual TUI output at 40, 60, 80, and 120 columns with header, editor, footer, context on, `/context off`, and a long transcript. Assert one brand, one context percentage, one cwd, one model, one thinking level, and one working indicator.
2. **Context delta fixture:** render 40% → 43% and 43% → 40%. Assert the percentage changes, at least one transition frame differs visibly, the final gauge equals the target, and reduced motion emits only the final frame.
3. **Right-rail width fixture:** assert the context segment is right-aligned at 60/80/120, never exceeds width, and degrades to `ctx N%` rather than wrapping.
4. **Header visibility fixture:** compare current widget registration with `setHeader`/reserved-widget prototype under a short dock, a long transcript, context on, and a competing welcome widget. Assert the chosen contract remains visible or documents startup-only behavior.
5. **Editor safety fixture:** render empty, one-line, multiline, and narrow editor states. Assert border removal does not remove user text and every line remains within width.
6. **Tool lifecycle matrix:** for each built-in, snapshot pending, partial update, success, warning, error, expanded, and truncated states. Assert a finalized call/result pair produces one compact row.
7. **Tool samples:** include `read`, `bash`, `edit`, `grep`, external research, and subagent fixture labels at 60/80/120. External rows must be adapter fixtures only and must not register or execute external tools.
8. **Bash fixture:** check quiet/no-output, exit 0, non-zero exit, cancellation/partial, duration, bounded framed output, and `… N more lines`.
9. **Diff fixture:** check no-change, `+A -R`, pending projection notice, error diagnostic, summary at 60, unified at 80, and split eligibility at 120. Verify long lines clamp safely.
10. **ANSI/accessibility fixture:** run normal color, `NO_COLOR=1`, reduced motion, narrow widths, long Unicode model/cwd/path, and ambiguous/wide glyph fallback. Assert semantic state survives without color.
11. **Ownership fixture:** load Acidbath alone, with a synthetic non-builtin `read` owner, and with an external tool. Assert Acidbath does not silently replace a non-builtin owner and does not alter external execution/rendering.
12. **Lifecycle/performance fixture:** sequential and concurrent tool calls; pending-to-success/error while another call remains pending; resize; expansion; session shutdown; reload; and second session if supported. Assert no idle animation timer, no stale `toolCallId` state, and no duplicate footer/widget/header.

