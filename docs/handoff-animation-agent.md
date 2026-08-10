# Handoff prompt: Acidbath terminal animation exploration

> **Archived.** The legacy orb, motion, and context animation surfaces were
> removed from Acidbath core. Keep this document only as historical design
> context; do not restore those surfaces without a new product review.

You are a visual/TUI animation specialist working in `/Users/ameno/dev/acidbath`.
Your task is to explore and prototype an original terminal animation for the
Acidbath header. Do not make production UI changes until the parent agent has
reviewed the prototype.

## Read first

- `README.md`
- `docs/ascii-animation-research.md`
- `docs/ui-plan-revisit.md`
- `docs/visuals/ui-revisit.html`
- `extensions/acidbath/index.ts`
- `extensions/acidbath/ui-header.ts`
- `extensions/acidbath/ui-motion.ts`
- `extensions/acidbath/ui-orb.ts`
- `extensions/acidbath/ui-tools.ts`

Reference repositories already reviewed:

- `cameronfoxly/Ascii-Motion`: use only for ideas about frame data,
  durations, and lifecycle cleanup. Do not add it as a dependency or copy
  unclear-license generated output.
- `mu-ct/awesome-ascii-animation`: use as an inspiration index only.

## Current product direction

- Header text must be exactly lowercase `acidbath`.
- The editor is borderless.
- Context display is optional and controlled independently with `/context
  off|above|below`.
- Compact semantic UI is the preferred baseline.
- Preserve `NO_COLOR`, `PI_ACIDBATH_REDUCED_MOTION=1`, narrow widths, and
  deterministic test frames.
- Do not duplicate the semantic working orb or tool lifecycle indicator.

## Animation concept to explore

Prototype an Acidbath-specific mark: an acid droplet entering a small bath,
with a ripple or surface disturbance beside the static `acidbath` label.
Prefer ASCII-safe punctuation and a stable footprint of 2–3 rows and under
roughly 24 columns. Explore at least three distinct concepts, for example:

1. droplet + ripple;
2. bubbling chemical bath;
3. a compact waveform/oscilloscope mark.

The animation should feel authored for Acidbath, not like a generic spinner.

## Deliverables

1. Add a visual prototype to `docs/visuals/` or extend
   `docs/visuals/ui-revisit.html` with side-by-side concepts.
2. Show each concept at widths 40, 60, 80, and 120.
3. Show normal color, `NO_COLOR`, and reduced-motion/static frames.
4. Document frame count, duration, footprint, lifecycle start/stop behavior,
   and why one concept is preferred in a short companion Markdown note.
5. If you implement a pure frame-data prototype, put it under
   `extensions/acidbath/` without wiring it into `index.ts` yet. Include tests
   for frame determinism, width safety, reduced motion, and cleanup.
6. Run `git diff --check` and the relevant tests.

## Runtime constraints

- No direct writes to stdout; invalidate through Pi's TUI component contract.
- No 16ms loop. Target 6–10 frame changes per second, preferably scheduling
  only the next frame.
- Idle must have zero animation timers.
- `dispose()` must be idempotent and clear all timers.
- Color should be applied to the compact mark as a whole, not per-cell ANSI
  spans unless a prototype proves that necessary.
- Never add network calls, dependencies, setup scripts, or global settings
  changes.
- Do not modify the active Acidbath package surface beyond isolated prototype
  files.

## Report back

Return:

- the concepts explored;
- the recommended concept and why;
- exact files changed;
- tests/checks run;
- any licensing or terminal-compatibility concerns;
- a clear statement that production wiring was not performed.
