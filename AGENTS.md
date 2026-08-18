# Acidbath Agent Guidelines

These instructions apply to the entire Acidbath repository.

## Hosted environment

Acidbath's primary public surfaces are **acidbath.com** and **acidbath.sh**.
Host experiments and deployments on the Cloudflare account for
`ameno.osman13@gmail.com` (`CLOUDFLARE_ACCOUNT_ID=b18b69cd68141488bc79bdd876a3ece4`).
Do not use the `dev.amenoosman` or Storied Cloudflare accounts for Acidbath
hosting unless explicitly requested.

## Product boundary

- Acidbath is a Pi extension. Use documented Pi extension and TUI APIs; do not patch Pi, edit installed `node_modules`, monkey-patch private modules, or rewrite terminal scrollback.
- Native session entries, tool arguments, tool results, ordering, usage, and model-visible content remain canonical and unchanged. Acidbath owns presentation only.
- Preserve user changes already present in the worktree. Never reset or rewrite unrelated modified/untracked files.

## Performance is a correctness requirement

Pi terminal input, extension event handlers, and TUI rendering share the JavaScript event loop. A visually correct feature is not acceptable if it delays keyboard input.

### Streaming and event handlers

- Treat `message_update` and `tool_execution_update` as hot paths: events may arrive token-by-token or in rapid bursts.
- Never scan, normalize, split, stringify, or estimate over the full accumulated response on every streaming event. Work from the current delta or a bounded tail.
- Never call `ctx.getContextUsage()` on every streaming update. Sample usage only at meaningful lifecycle boundaries or through an explicitly throttled sampler.
- Coalesce display-only streaming updates. A preview does not need token-level fidelity; cap its refresh frequency and always render the final boundary state.
- Event handlers must be synchronous and bounded unless they are awaiting genuinely asynchronous I/O. Do not introduce synchronous filesystem/process work into streaming handlers.
- Deduplicate lifecycle events by semantic state and `toolCallId`. Duplicate notifications must become no-ops.

### Rendering

- `render()` and tool `renderCall`/`renderResult` callbacks must be pure presentation paths: no execution, lifecycle dispatch, state-machine transitions, `requestRender()`, timers, queued microtasks, or other side effects.
- Renderer callbacks may be called repeatedly because of input, resize, theme changes, streaming, or unrelated UI updates. Never assume a render callback is a one-shot event.
- Cache rendered lines by every value that affects output, including width, semantic state, expansion, and theme generation where relevant. Clear caches in `invalidate()` and when state changes.
- Reuse `context.lastComponent` and Pi's per-call `context.state` when practical. Do not keep an unbounded global renderer history.
- Return immediately for collapsed paths. Do not build, split, syntax-highlight, diff, or invoke native detail renderers for content that is not visible.
- Bound previews before normalization/splitting. Never create a full array of lines merely to display the first or last few lines of a large result.
- Every rendered line must satisfy the supplied terminal width using ANSI-aware `visibleWidth`/`truncateToWidth`; do not use JavaScript string length for layout.
- Avoid full-row backgrounds and gratuitous ANSI spans in frequently repainted surfaces. Terminal output volume is part of performance.

### Invalidations and animation

- Call `tui.requestRender()` only after an observable state change. Same-state updates must not request another frame.
- Never call `requestRender()` from inside `render()`.
- Idle repeating timers must be zero.
- Prefer no animation. If motion is justified, use one shared/bounded clock, a restrained frame rate, scoped invalidation, reduced-motion support, and explicit disposal on settlement, shutdown, and reload.
- Do not create one timer per tool call, row, component, or result.
- Any async diff/highlight computation must be cancellable or generation-checked, coalesced, cached, and prevented from invalidating a stale session/tool row.

## Tool presentation contract

- Tool output is compact and collapsed by default. Do not force `ctx.ui.setToolsExpanded(true)` or silently override the user's expansion preference.
- A normal completed call should occupy one backgroundless, borderless semantic row. Large output, code, listings, and diffs are available on explicit expansion.
- Pending, partial, success, error, aborted, and truncated states must remain understandable without color.
- Tool execution remains owned by Pi. Renderer wrappers must preserve the exact execution/result behavior.
- Keep compact and expanded work separate: compact formatters consume bounded structured metadata; expanded adapters may use richer native/domain rendering.
- `edit`/`write`: compact row shows target and diff stats; compute/render the actual themed diff only when expanded. Prefer unified diffs at ordinary widths and split views only when both panes remain readable.
- `bash`: compact row shows a safe command summary and structured exit/count/duration facts. Expanded output is bounded and readable. Quiet commands explicitly say they produced no output.
- `read`: compact row shows path/range/count. Syntax-highlighted or line-numbered content belongs behind expansion.
- `ls`/`find`/`grep`: compact row shows scope and count. Expanded output uses a bounded list/tree/match view rather than an unstyled raw dump.
- A bash command that happens to invoke `ls` may receive list-oriented presentation only when classification is conservative and display-only. Never reinterpret arbitrary shell pipelines or alter execution.
- Use theme semantic tokens (`toolDiffAdded`, `toolDiffRemoved`, `toolDiffContext`, `toolOutput`, `muted`, status colors) rather than hard-coded style colors. `NO_COLOR` must retain structure and meaning.
- Do not take over external/custom tools by name. Any future adapter must be explicit and ownership-aware.

## Required validation

For UI/rendering changes, run:

```bash
npm run typecheck
npm test
npm run test:visual
```

Also add or update focused tests that prove:

- collapsed rendering does not construct rich/native details;
- repeated same-state updates do not request renders;
- repeated same-width renders reuse cached output where appropriate;
- previews remain bounded for very large input;
- all lines fit 40, 60, 80, and 120 columns with ANSI and Unicode;
- `NO_COLOR` and reduced motion preserve semantics;
- partial/concurrent tools, errors, truncation, expansion, resize, theme invalidation, shutdown, and reload do not leak timers or stale state.

When changing a hot path, include a benchmark or instrumentation result that measures the real risk (render count, event-loop delay, allocations, or work versus accumulated stream size), not only pure formatter throughput. Performance must remain approximately constant as accumulated streaming content grows.

## Documentation sources

Before implementing Pi extension/TUI behavior, read the installed Pi documentation completely and follow its cross-references:

- `docs/extensions.md`
- `docs/tui.md`
- relevant examples under the installed Pi package

Useful repository context includes:

- `docs/tool-call-ui-research.md`
- `docs/tool-call-interaction-review.md`
- `docs/oh-my-pi-tool-rendering-review.md`
- `docs/ui-tool-display-research.md`
- `docs/baselines.md`

Some documents describe historical experiments. Verify claims against the current code and installed Pi version before adopting them.

## Three-surface workflow: Sideshow + Notion + Linear

Substantial Acidbath work runs across three surfaces, each with a distinct
job. Route deliberately:

- **Sideshow (live board, session-scoped):** watch work happen — streaming
  previews, diagrams in flight, diffs under live review. High-frequency while
  working. Deployment: `sideshow-selfhost` skill.
- **Notion (design space, permanent):** durable record — decisions, specs,
  READMEs, diagrams worth keeping, migration records, handoffs. One evolving
  task page under the **Agent Design Space** root (page id
  `3bfdcb48-9c71-812d-9227-deeff8e70b0e`), updated in place at lifecycle
  boundaries. Protocol: `notion-design-space` skill.
- **Linear (execution ledger, permanent):** queue, statuses, blockers,
  comments. Workspace `acids`, team pinned by `.linear.toml`. Transition and
  comment at lifecycle boundaries (task start, phase settled, validation,
  blocker, completion). Commands: `linear-cli` skill. Beads (`.beads/`)
  mirrors execution state locally.

Rule of thumb: in-flight and visual → Sideshow; must survive the session →
Notion; changes what-happens-next → Linear. A lifecycle boundary is one beat
across all three: Linear transition + Notion page update + live-board update
(while a session is running).

Any surface may record concise evidence, alternatives, decisions, validation,
risks, and next actions. None may contain private chain-of-thought,
credentials, unredacted sensitive output, or full tool transcripts.

The parent agent owns all three surfaces and their credentials. Headless
workers report structured results to the parent; do not hand workers board,
Notion, or Linear credentials merely to produce progress updates.
