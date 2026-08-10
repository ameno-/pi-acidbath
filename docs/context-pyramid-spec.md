# Context pyramid specification

Status: **archived prototype**. The context pyramid and placement controls
were removed from the core runtime. The current context surface is the static
right-aligned footer rail.

## Shape

The compact default uses three rows of orb cells, rendered as a widget above
the editor:

```text
    ·
  · · ·
● ● · · ·   42%
```

Filled cells use `●`; unfilled cells use `·`. Cells fill from the base upward,
then from left to right within a row. The percentage is shown once, on the
baseline row. At 60 columns the shape remains left-aligned and consumes a fixed
maximum width; it does not center against the full terminal.

Examples:

```text
    ·
  · · ·
● ● · · ·   42%

    ●
  ● ● ●
● ● ● ● ·   86%
```

## Color model

The value is context consumed, so color represents pressure rather than
progress:

| Percent | Filled orb color | Meaning |
|---:|---|---|
| 0–59 | `accent`/teal | healthy headroom |
| 60–79 | `warning`/amber | plan compaction soon |
| 80–94 | orange/warning | high pressure |
| 95–100 | `error`/red | critical pressure |

Unfilled cells use `dim`. At `NO_COLOR=1`, use the same shapes and labels with
no ANSI color. The percentage remains mandatory because color is not semantic
on its own.

## Motion

- Fill updates follow context polling, not a new high-frequency animation loop.
- A change may ease by one cell per 80ms using the existing gauge cadence, but
  the final shape must always equal the current percentage.
- Reduced motion updates directly to the final shape.
- No pulsing or color cycling; color changes only when crossing a threshold.

## Widget contract

The borderless editor uses a normal custom editor with both border rows
removed. Right-side context is rendered in the consolidated footer. The
pyramid uses
`ctx.ui.setWidget("acidbath-context", ..., { placement: "aboveEditor" })` or
`belowEditor` for the expanded alternatives; it must:

- coexist with the welcome widget by clearing/dismissing the welcome before the
  first turn, or by stacking in a deterministic order;
- clear itself on session shutdown;
- degrade to the current one-line gauge below a configurable terminal width;
- use a stable key so reload does not duplicate widgets.

## Open visual choices

The prototype should show these alternatives before production wiring:

1. **Placement:** three-row widget above the editor versus a one-line
   border-preserving fallback;
2. left-aligned versus centered shape;
3. three rows versus five rows;
4. whether the percentage sits on the baseline or in a right-side label;
5. whether progressive color is applied per filled orb or only at threshold
   bands.

The currently requested visual direction is `●` filled / `·` empty with
progressive color; placement remains open pending the visual prototype.
