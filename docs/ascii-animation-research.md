# Terminal animation research

_Status: research only; no production UI wiring._

## Recommendation

Implement a tiny local frame renderer. Borrow the **data and lifecycle patterns**, not an animation engine or generated component. ASCII Motion is useful as an authoring/export reference, but its exported Ink/OpenTUI/Bubble Tea components are target-specific, large, and introduce a renderer/runtime boundary that Acidbath does not need. `awesome-ascii-animation` is a CC0 curated list, not an engine.

The first Acidbath animation should be a small, original **acid droplet hitting a bath** beside a static `acidbath` label: a 2–3 row, ASCII-only mark whose droplet moves down and whose ripple changes across 4–6 frames. Keep it under roughly 24 columns and 3 rows. This is more distinctive than another spinner and remains legible in a narrow terminal.

Suggested frame sketch (illustrative):

```text
    o  acidbath
  (===) terminal UI
 ~~~~~~~
```

The `o`, inner `=`, and ripple positions vary; the label and overall footprint do not.

## Current Acidbath architecture

- `extensions/acidbath/index.ts` owns session lifecycle, environment gates, the Pi working indicator, the custom editor component, and shutdown cleanup.
- `ui-orb.ts` already has the closest frame model: semantic state -> string frames + interval, with a reduced-motion single-frame path and `NO_COLOR` handling.
- `ui-tools.ts` has the best timer pattern: one shared `MotionClock`, subscribed only while pending tool calls exist, invalidating only subscribed components, and `dispose()` clearing the timer/map.
- `ui-gauge.ts` is retained as a benchmark/reference helper; `ui-context-pyramid.ts` and `ui-context-widget.ts` now provide the optional borderless-editor context surface.
- `index.ts` clears the label timer, context timers/widgets, header widget, editor, and tool motion on `session_shutdown`. A future animated header must follow the same ownership model and must not start an always-on timer.
- Existing controls are `PI_ACIDBATH_REDUCED_MOTION=1`, `PI_ACIDBATH_MOTION_PHASE=0..3`, and `NO_COLOR` (presence disables color). A header should reuse these conventions and remain TUI-only; non-TUI sessions should get no animation output.

## Reference findings

### [cameronfoxly/Ascii-Motion](https://github.com/cameronfoxly/Ascii-Motion)

Reviewed at commit `9828229fe9becbde7f021f12a3b70f485e1ed65f` (network clone succeeded).

Useful patterns:

- `src/components/features/WelcomeAsciiAnimation.tsx` uses frame records with per-frame durations and cleans up its `setTimeout` in the effect teardown.
- The CLI exports use compact frame data: `content: string[]`, a duration, and optional foreground/background maps keyed by `x,y`.
- OpenTUI exports expose `play`, `pause`, and `restart`; they measure elapsed time and clean up the interval. This is a useful control shape, but the generated implementation ticks every 16ms and renders every cell as a component span—too much churn for a tiny Pi header.
- Bubble Tea exports schedule the next `tea.Tick` at the current frame duration and render through a `strings.Builder`; this “schedule only the next frame” pattern is closer to what Acidbath needs.

Do not import the generated components as a dependency. They target React/Ink, OpenTUI, or Bubble Tea, contain large precomputed art payloads, and can require additional runtime packages. The repository is dual-licensed: `LICENSE-MIT` covers the stated open-source core, while `LICENSE-PREMIUM` covers premium/web/marked files. The CLI export directories are not individually marked clearly enough to vendor code or frames without a separate provenance review. If any MIT code is copied later, retain its copyright and license notice.

### [mu-ct/awesome-ascii-animation](https://github.com/mu-ct/awesome-ascii-animation)

Reviewed at commit `b620a4effa07a0f6e7a93802cfa07545651e34af` (network clone succeeded). The repository README is CC0 and only curates links to tools, libraries, and classic works. It confirms the ecosystem is fragmented across image converters, editors, and terminal UI libraries; it supplies no reusable player implementation. Each linked project retains its own license, so the list's CC0 status does not license linked art or code.

## Implementation options

| Option | Assessment |
|---|---|
| **A. Local fixed-frame player (recommended)** | Add a pure `Frame[]`/`renderFrame()` helper and a small controller owned by the header component. Use 4–6 hand-authored ASCII frames, one timer only while active, and `setTimeout` for the current frame duration. Lowest CPU, output, dependency, and license risk. |
| **B. Local generic frame player** | Same renderer, but support `durationMs`, `next()`, `setPhase()`, `start()`, `stop()`, and `dispose()`. Worth doing if the header, orb, and future welcome animation will share playback. Do not make it a general animation framework yet. |
| **C. ASCII Motion export as an authoring artifact** | Acceptable only as an offline design aid. Export a small frame payload, rewrite it into Acidbath's own `string[]` data, and verify the source path/license before distributing it. Do not ship the exported React/OpenTUI/Bubble Tea component or its dependencies. |

## Runtime contract

1. **Lifecycle:** render frame 0 statically at session start. Start playback only for an active agent/tool phase (or an explicitly shown welcome), stop at `agent_end`, and clear the header on shutdown/first-turn dismissal as appropriate. `dispose()` must be idempotent and clear the timer, subscribers, and pending invalidation.
2. **Reduced motion:** `PI_ACIDBATH_REDUCED_MOTION=1` renders one deterministic representative frame and starts no timer. A future setting may disable the header entirely; do not infer motion preference from model text.
3. **Color:** `NO_COLOR` returns the same ASCII shapes and labels without escape sequences. If colored, apply one theme color to the compact mark rather than per-cell ANSI spans. Shape and `ACIDBATH` text must carry the meaning.
4. **Width safety:** expose `render(width, theme?)`; below a minimum width return a single-line static label (or no header), never wrap. Clamp/pad every line to the requested width. Prefer ASCII punctuation over wide or ambiguous Unicode for this surface.
5. **Churn budget:** target 6–10 frame changes/second, not a 16ms polling loop. Schedule the next frame at its duration, invalidate only when the frame index changes, and cache the colorless/colored strings. Do not write directly to stdout; let Pi's TUI render once per invalidation. Idle must have zero animation timers.
6. **Determinism:** support a frozen phase for snapshot/eval use, analogous to `/motion`; frame data and render helpers should be pure and testable at widths 40/60/80/120 with and without color.

The likely integration point is a small above-editor widget if the installed Pi build supports the widget contract described in `docs/context-pyramid-spec.md`; otherwise keep the prototype as a standalone `Component`/editor-adjacent render fixture. Do not add a second working indicator or duplicate the orb's semantic state.

## Decision

Proceed with **Option A**, shaped so it can become Option B without changing frame data. Use ASCII Motion for visual inspiration and timing/data patterns only. Keep the first implementation isolated behind render fixtures and lifecycle tests; production placement, default visibility, and the final droplet/ripple frames remain human-gated.
