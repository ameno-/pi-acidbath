# Acidbath UI plan revisit

Status: **active implementation plus visual review**. The borderless editor,
Acidbath header, consolidated footer, and optional context placements are now
production surfaces; tool-call compaction and animation remain under review.

## Current UI contract

| Surface | Current behavior | Revisit constraint |
|---|---|---|
| Orb | Six semantic states, animated braille frames, fixed four-column editor slot | Preserve state clarity without adding screen noise |
| Tool lifecycle | Pending dot animation; `✓` success; `×` error; wrapped built-in renderers | Keep lifecycle status scannable in dense output |
| Context display | Right-side quantized footer meter by default; pyramid above/below alternatives | `/context right|above|below|off`; 3% changes should move a visible segment |
| Labels | Deterministic event/tool labels, 100ms trailing debounce, same-string guard | Labels must remain short, stable, and render-time-derived |
| Motion controls | `/motion live|0|1|2|3`; reduced-motion environment flag | Reduced motion must collapse to a deterministic single frame |

The old plan contains stale claims that must be reconciled: `ui-labels.ts` is
now wired, and its debounce uses a timer; the old “no new timers” statement is
not compatible with the approved trailing-edge debounce. The authoritative
implementation facts are in `extensions/acidbath/index.ts`, `ui-labels.ts`,
`ui-tools.ts`, `ui-orb.ts`, `ui-context-widget.ts`, and `ui-header.ts`.

## Design principles

1. **Compact first.** The UI communicates state in the existing working area;
   it does not become a dashboard by default.
2. **One signal, one meaning.** Orb = agent phase, tool glyph = tool lifecycle,
   gauge = context pressure. Avoid duplicating the same status in all three.
3. **Readable without color.** Shape, text, and glyph semantics must survive
   `NO_COLOR=1`.
4. **Motion is subordinate.** Animation draws attention only while work is
   pending; success/error settle immediately.
5. **No model-generated status.** V1 labels use lifecycle events and structured
   render arguments only; thinking text remains out of scope.
6. **Bounded layout.** Labels truncate deterministically; the gauge degrades
   cleanly at narrow widths.

## Isolated visual alternatives

The browser prototype is `docs/visuals/ui-revisit.html`. The context-specific
shape and widget contract are in `docs/context-pyramid-spec.md`.

### A — Compact semantic (recommended baseline)

The selected baseline remains the visual direction. Context is now visible on
the right by default in the consolidated footer; the orb pyramid remains an
explicit above/below alternative.

- Keep the fixed left orb slot as the primary live-phase signal; let tool rows and the footer carry readable settled facts.
- Use the orb shape and label as the primary state signal.
- Keep tool glyphs inline and the context meter on the consolidated footer's right side.
- Refine only vocabulary, spacing, and contrast.

**Best for:** everyday coding, low distraction, reduced-motion users.

### B — Compact segmented rail

- Keep the same information, but visually separate orb state, current detail,
  and context percentage with subtle separators.
- Tool results retain inline glyphs.
- The rail collapses back to A below a narrow terminal width.

**Best for:** users who need faster scanning across simultaneous activity.

### C — Quiet monochrome with exceptional accents

- Use one neutral orb/gauge palette by default.
- Reserve accent color for error, context-pressure threshold, and the active
  tool lifecycle.
- Labels carry most of the semantic load; motion is reduced by default.

**Best for:** long sessions, accessibility, and visually busy themes.

## Evaluation rubric for the prototypes

Score each alternative 1–5 at widths 60, 80, and 120 columns, with and without
color:

- state recognized within one glance;
- tool success/error distinguished without reading output;
- context percentage remains legible;
- no label or gauge collision with editor content;
- reduced-motion equivalence;
- visual density stays appropriate for a coding terminal.

Reject any variant that requires model output parsing, adds an always-on timer,
changes the meaning of the orb/tool/gauge, or fails the no-color case.

## Proposed sequence

1. Review `ui-revisit.html` and select A, B, or C (or a hybrid).
2. Convert the selection into a small token table: glyphs, colors, spacing,
   truncation, timing, and narrow-width behavior.
3. Add fixture-based render snapshots for the selected tokens and terminal
   widths.
4. Implement one surface at a time: orb/labels → tool lifecycle → gauge.
5. Re-run the existing performance harness and the reduced-motion checks after
   each surface.

No V2 adaptive intent, thinking-block parsing, or dashboard-style expansion is
part of this pass.
