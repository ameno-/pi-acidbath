# oh-my-pi Tool Rendering Review

Reviewed `can1357/oh-my-pi` at commit `08819b2` (2026-08-08), with emphasis on
`packages/coding-agent/src/tui`, `modes/components/tool-execution.ts`,
and the built-in renderer registry.

## Executive conclusion

Pi's renderer surface is substantially more composable than Acidbath currently
uses. Acidbath should decouple **tool execution**, **tool lifecycle state**, and
**tool presentation policy**. We should borrow the architecture and small,
license-compatible patterns rather than vendor the whole oh-my-pi TUI.

The most important change is to stop treating a compact renderer as a reason to
replace the built-in tool renderer. Pi resolves `renderCall` and `renderResult`
per slot and allows an extension override to inherit either built-in renderer
when that slot is omitted. This lets Acidbath wrap execution while preserving
Pi's domain renderers, or choose a compact/rich policy per tool.

## Implementation status

Phase 1 is now implemented in `ui-tools.ts` and `ui-tool-renderers.ts`:
Acidbath has one presentation policy — compact lifecycle rows by default, with bounded result previews (up to four lines) and Pi's native
renderer retained as the expansion body. Renderer state is stored in Pi's
per-call `context.state`, and native detail components are reused separately
from the compact wrapper. TypeScript checking is now a first-class `npm run
typecheck`
command.

## What oh-my-pi does well

### 1. A renderer registry independent of tool execution

`src/tools/renderers.ts` defines a `ToolRenderer` contract and maps tool names to
small, domain-specific renderer modules. The registry owns presentation only;
tool implementations remain separate.

Useful renderer metadata includes:

- separate `renderCall` and `renderResult` slots;
- `mergeCallAndResult` for tools that own one combined card;
- `inline` for low-noise rows;
- explicit animated-preview flags so the host only schedules repaint ticks
  when a renderer actually consumes them;
- first-result viewport replay flags for topology-changing streaming previews.

### 2. A composition host for renderer lifecycle

`modes/components/tool-execution.ts` is the important seam. It owns the
execution card and passes each renderer a context containing:

- stable `toolCallId`;
- mutable per-execution `state`;
- `lastComponent` for in-place updates;
- current args and cwd;
- execution/argument/result lifecycle flags;
- `expanded`, `isPartial`, `isError`, and image visibility;
- a scoped `invalidate()` callback.

It also supplies fallbacks and catches renderer failures without taking down the
agent UI. This is safer than a renderer-owned global map.

### 3. Reusable visual primitives

The `src/tui` package separates visual vocabulary from tool-specific semantics:

- `renderOutputBlock` / `CachedOutputBlock`: framed stateful blocks with width
  accounting, sections, optional backgrounds, and cache keys;
- `renderStatusLine`: consistent icon/title/description/badge/meta rows;
- `renderCodeCell` and `renderMarkdownCell`: bounded previews with expansion;
- `renderTreeList`: branch prefixes, collapse budgets, summaries, and multiline
  items;
- `fileHyperlink` / `urlHyperlink`: safe OSC 8 links;
- `WidthAwareText`: defers width-dependent formatting until render time;
- `Hasher` and per-component memoization to avoid repeated expensive formatting.

This is the right level of decoupling for Acidbath: shared render primitives,
small tool adapters, and a host-owned lifecycle.

### 4. Streaming is treated as a topology problem

The strongest implementation detail is not the boxes; it is the handling of
streaming output:

- command/code previews use a bounded tail window so a live block does not grow
  past the viewport;
- partial edit previews coalesce asynchronous diff work instead of cancelling
  every computation on every argument delta;
- the host knows when a pending shape is replaced by a result shape and can
  request a scoped/full viewport replay only when needed;
- detached/live-region blocks can be sealed so committed scrollback is never
  rewritten;
- spinner frame cadence is shared and matched to actual glyph advancement.

These ideas directly address Acidbath's previous redraw recursion and CPU
regressions.

### 5. Grouping is a presentation concern

`ReadToolGroupComponent` groups consecutive reads while retaining tool-call
identity, usage attachment, pending state, expansion, hyperlinks, previews, and
live-region finalization. This is a good example of decoupling raw tool calls
from the visible transcript without changing model-facing results.

## Acidbath gaps

Current relevant files:

- `extensions/acidbath/ui-tools.ts`
- `extensions/acidbath/ui-tool-rows.ts`
- `extensions/acidbath/ui-motion.ts`
- `extensions/acidbath/ui-labels.ts`

### Current strengths

- `formatToolRow` is pure and deterministic.
- Rows are keyed by `toolCallId`.
- Pending animation has a fixed-width status cell.
- Expanded output can retain Pi's normal renderer output.
- Motion uses one shared clock and has reduced-motion/frozen-phase paths.

### Current coupling to remove

1. `ui-tools.ts` re-registers the seven built-in tools and supplies a compact
   renderer for each. That makes Acidbath the owner of both execution wrapping
   and presentation, and discards most of Pi's built-in renderer richness.
2. The renderer lifecycle is stored in an Acidbath-wide `Map` rather than in
   Pi's per-tool-call renderer state/context.
3. The compact row has no domain-specific result renderer for read, grep, find,
   edit, write, or bash. It mostly exposes status plus metadata.
4. External tools, including `agy_web_search` and `agy_research`, get generic Pi
   rendering rather than an Acidbath renderer policy.
5. There is no shared width-aware block/tree/code/hyperlink layer. Each new
   renderer would otherwise grow another one-off formatter.
6. Motion invalidation is not declared per renderer. A tool that does not
   visibly consume a frame should not receive animation redraws.

## Proposed Acidbath architecture

### Layer A — execution adapter

Keep a thin wrapper only where Acidbath needs execution instrumentation or
result metadata. It should preserve the original definition and avoid defining
`renderCall`/`renderResult` unless a presentation policy explicitly asks for an
override.

Default behavior should therefore be:

```text
Acidbath execution wrapper
        │
        ├── tool execution unchanged
        └── renderer slots inherited from Pi
```

This immediately gives Acidbath the appropriate native renderer for Pi's
built-in tools and keeps future Pi renderer improvements available.

### Layer B — presentation policy

Introduce a separate registry, conceptually:

```text
native      → omit renderer slots; inherit Pi
compact     → status-first row, bounded metadata
rich        → Acidbath domain renderer using shared primitives
hybrid      → compact call + native/rich expanded result
```

The policy should be selected by tool name and UI mode, not baked into the
execution wrapper. A `/tools` or future `/ui` command can change policy without
changing the active tool set.

### Layer C — shared Acidbath renderer kernel

Create small local modules, borrowing patterns from oh-my-pi:

```text
extensions/acidbath/rendering/
  types.ts          renderer state, policy, lifecycle snapshot
  status-line.ts    fixed-width status/title/meta rows
  output-block.ts   cached framed/inline block
  tree-list.ts      bounded tree/list summaries
  code-cell.ts      bounded code/markdown previews
  hyperlinks.ts     inert OSC 8 file/URL links
  registry.ts       tool-name → policy/renderer mapping
```

These modules should remain presentation-only and never execute commands or
interpret rendered links as actions.

### Layer D — per-tool adapters

Prioritize adapters in this order:

1. `bash`: command preview, output tail, exit code, timeout, duration, and
   truncation metadata;
2. `read`: path/selector, grouped reads, code/markdown preview, resolved-path
   hyperlink;
3. `edit`/`write`: streaming tail preview, syntax highlight, compact diff
   summary, diagnostics, and expansion;
4. `grep`/`find`/`ls`: count-first summary plus bounded tree results;
5. `agy_web_search`: query/status/source count/duration and expandable cited
   result;
6. `agy_research`: phase/status/source tree with bounded progress and expanded
   synthesis.

AGY renderers should consume structured `details` from `pi-research`; Acidbath
should not scrape arbitrary model text to infer sources. If needed, enhance
`pi-research` to return bounded structured progress/source metadata while
keeping its model-facing answer unchanged.

## Recommended migration sequence

### Phase 1 — native renderer inheritance

Refactor `registerWrappedTool` so execution wrapping and rendering are separate.
Run the seven built-ins with no Acidbath renderer slots by default and verify
that Pi's built-in renderers remain available. Keep the existing compact row
behind an explicit `compact` policy.

Acceptance checks:

- `renderCall`/`renderResult` inheritance works for each built-in;
- expanded results preserve syntax highlighting, diffs, images, and metadata;
- model-visible tool schemas/results are unchanged;
- no duplicate tool registration or renderer recursion.

### Phase 2 — renderer kernel and policies

Extract the current status-first row into a policy adapter. Add cached,
width-safe output/tree/code primitives. Store mutable per-call state in
`context.state` and reuse `context.lastComponent` where appropriate.

Acceptance checks:

- deterministic fixtures at 40/60/80/120 columns;
- no line exceeds render width;
- theme invalidation rebuilds pre-colored content;
- motion redraws only animated pending/partial components;
- no timer or microtask loop after settlement.

### Phase 3 — hybrid built-in adapters

Add rich adapters one tool family at a time. Compact mode should remain quiet;
expanded mode should reveal the appropriate rich renderer rather than raw
unstructured output.

### Phase 4 — AGY/research renderer contract

Add a small structured details contract to `pi-research` for progress and
sources. Then register Acidbath renderers for `agy_web_search` and
`agy_research`. Keep AGY auth/permission behavior in `pi-research`; Acidbath
only presents lifecycle and results.

## Decisions

- **Adopt the architecture, not the whole codebase.** The oh-my-pi TUI is MIT,
  but copying substantial portions would add maintenance and attribution burden.
- **Prefer native inheritance over overriding built-ins.** Acidbath should not
  make Pi's built-in renderer improvements unavailable.
- **Keep compact rows as a policy, not the universal renderer.** The user can
  have low-noise defaults without losing rich inspection when expanded.
- **Use structured tool details, not output scraping.** This is especially
  important for AGY sources and streaming progress.
- **Treat scrollback/live-region behavior as part of renderer correctness.** A
  visually attractive renderer that rewrites committed terminal history is not
  acceptable.
