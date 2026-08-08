# Acidbath feature inventory and implementation details

This is the current product contract for the Acidbath Pi extension. It separates
implemented behavior from planned capability so a fresh session can review the
real surface without treating research notes as shipped features.

## Package and ownership

- Package: `acidbath` (`package.json`)
- Pi extension entrypoint: `extensions/acidbath/index.ts`
- Themes: `themes/acidbath.json`, `themes/acidbath-cyberdyne-teal.json`
- Config examples: `config/settings.global.example.json`,
  `config/keybindings.example.json`
- Canonical skills: external `/Users/ameno/dev/lib`; not vendored into this
  package
- Active global package path: `../../dev/acidbath` in Pi settings, resolving to
  `/Users/ameno/dev/acidbath`

## Skill and capability map

### Currently used or available in the Acidbath workflow

These are the skills/capabilities currently helping us build and evaluate the
extension, without being bundled into the Acidbath npm package:

- `agent-browser` — verify visual prototypes and terminal-adjacent web views;
- `visual-explainer` — visual comparison/prototype surface;
- `interactive-shell` / agent delegation — run visible or headless sub-agents;
- `typescript`, `safe-bash`, and `code-review` — implementation and QA discipline;
- `plan-check`, `workflow-recall`, and `context-budget` — planning and session hygiene;
- `ux-cognitive-simplicity`, `ux-learnability-confidence`, and
  `ux-visual-clarity` — UI review criteria;
- `gotem` — optional research/library persistence when explicitly requested;
- `pi-ast-grep`, `pi-interactive-shell`, and other Pi packages — separate
  runtime capabilities, not Acidbath-owned code.

### Additional skills to evaluate from `/Users/ameno/dev/lib`

The primary taxonomy is the user's three-group model:

| Group | Skills/capabilities | Acidbath relationship |
|---|---|---|
| **Development** | `karpathy-guidelines`, `ux-cognitive-simplicity`, `ux-learnability-confidence`, `ux-visual-clarity`, `i-have-adhd`, `agent-delegate`, `prototype`, `wizard`, `control-ui`, `ponytail` | Reference skills for implementation, UI design, optimization, delegation, and developer experience; never runtime-owned by Acidbath |
| **Validation** | `verify-this`, `thermo-nuclear-code-quality-review`, `loop-on-ci`, `get-pr-comments`, `pr-review-canvas`, `plane-cli`, `pi-research`, `eval-debug`, `benchmark-campaign` | Review/evidence/issue-management capabilities; compose into an explicit validation profile |
| **Brainstorming** | `teach`, `workflow-recall`, `workflow-from-chats`, `prototype`, `visual-explainer`, `agent-browser`, `context-budget` | Exploration and visual iteration; compose into an explicit brainstorming profile |

Candidate skills remain canonical in `/lib`. Acidbath should expose only
capability status and display adapters, not duplicate or execute their skill
content. Full dispositions and mode proposals are in
`docs/skills-topology-evaluation.md` and `docs/handoff-acidbath-topology.md`.

## Implemented features

### 1. Acidbath header

Files: `index.ts`, `ui-header.ts`

- Renders a compact `acidbath` header through Pi's custom-header API.
- Uses the active theme's `borderAccent` color; the bundled `acidbath` theme
  gives it a distinct purple accent.
- Deliberately contains only the product mark; model/cwd/thinking/context are
  consolidated into the footer instead of repeated in the header.
- No animation timer yet; animation is isolated in
  `docs/handoff-animation-agent.md` for separate exploration.
- TUI-only and restored on session shutdown.

### 2. Borderless editor with fixed orb slot

Files: `index.ts`

- Reuses Pi's `CustomEditor` behavior and removes its top and bottom border
  rows.
- Reserves a fixed four-column left slot for the animated semantic orb.
- The editor renders into the remaining width, so the input origin never shifts
  as orb frames change.
- Orb states settle to `✓` on agent end and `·` while idle.
- Keeps editor input, keybindings, and Pi lifecycle behavior.
- The four-column slot remains fixed at every usable width; at widths too narrow
  for input, the renderer shows only the emergency orb slot rather than shifting
  the input origin.

### 3. Optional context display

Files: `ui-context-pyramid.ts`, `ui-context-widget.ts`, `index.ts`

- Default is `right`, using the consolidated footer.
- Runtime command: `/context right|above|below|off`.
- Startup environment: `PI_ACIDBATH_CONTEXT=right|above|below|off`.
- Right-side context uses a quantized inline light rail with no numeric
  percentage; token bubbles visibly move into or out of the rail on known usage
  deltas. `above`/`below` retain the three-row orb pyramid alternatives without
  a numeric label.
- `●` represents consumed capacity; `·` represents remaining capacity.
- Fills from the base upward and exposes fill order for progressive color.
- Uses one-line fallback below the minimum width.
- Animates toward updated context values unless reduced motion is enabled.
- Clears timers/widgets at session shutdown.
- `NO_COLOR` removes ANSI while retaining labels and shape.

### 4. Semantic working orb

Files: `ui-orb.ts`, `index.ts`

- Runtime command: `/orb auto|working|searching|solving|listening|composing|shaping|off|default`.
- Maps agent/provider/message/tool lifecycle events to semantic states.
- Supports reduced-motion and no-color paths.
- Uses a subtle two-frame idle pulse only while the input is empty; typed input
  keeps a stable idle token, and submitted work uses one accent-colored
  expressive animation until completion.
- Uses deterministic frames and no model-output parsing.

### 5. Deterministic tool lifecycle motion

Files: `ui-tools.ts`, `ui-motion.ts`

- Wraps Pi built-ins: `read`, `bash`, `edit`, `write`, `grep`, `find`, `ls`.
- Queues built-in tool rows by `toolCallId`, animates pending rows through one
  shared clock, and settles each call into one compact status-first row without
  changing model-facing tool names or result payloads.
- Pending frames occupy a fixed three-cell status slot, preventing tool targets
  from shifting horizontally during animation.
- Runtime command: `/motion live|0|1|2|3`.
- Uses one shared motion clock, subscribed only while pending calls exist.
- Disposes timers and tool-call slots on session shutdown.
- External tools such as `agy_web_search` are not currently wrapped; they still
  receive the semantic working state through the label path.

### 6. Deterministic labels

Files: `ui-labels.ts`, `index.ts`

- Pure event-to-label synthesis.
- Uses tool arguments such as `file_path`, `command`, and `pattern`.
- Includes aggregate edited-file counts and error labels.
- Uses a 100ms trailing debounce and same-string churn guard.
- No model output parsing, randomness, or timing in the pure helper.

### 7. Consolidated footer

File: `ui-footer.ts`

- Owns the single visible line for model, thinking level, cwd, completion/error
  status, and context when context placement is `right`; active work is shown by
  the fixed left orb slot.
- Uses `think:default` when Pi has not emitted a thinking-level selection, rather
  than leaving an empty field.
- Gives context priority at narrow widths and drops secondary working metadata
  before hiding the context meter.
- Avoids repeating the `acidbath` product mark and repository basename.

### 8. Theme surface

Files: `themes/*.json`

- `acidbath`: purple header accent, teal/acid/amber semantic palette.
- `acidbath-cyberdyne-teal`: existing Cyberdyne-style theme.
- Themes are selectable through Pi settings; Acidbath does not force a global
  theme automatically.

## Current evaluation surface

- `scripts/test-ui-labels.mjs`: 1103 assertions.
- `scripts/test-context-pyramid.mjs`: 23 assertions.
- `scripts/bench-tool-render.mjs`: pure helper and lifecycle benchmark.
- `docs/tool-eval-matrix.md`: package/capability scoring.
- `docs/pi-research-evaluation.md`: AGY research tool safety/evaluation.
- `docs/ui-tool-display-research.md`: tool renderer patterns.
- `docs/repo-structure-review.md`: package/skills topology recommendation.
- `docs/handoff-animation-agent.md`: animation handoff contract.

## Known gaps before calling the extension complete

1. Add a real TypeScript typecheck command/dependency to the repository; current
   local verification has syntax checks and pure tests but no root `tsc` binary.
2. Add render fixtures for header/context/tool rows at widths 40/60/80/120.
3. Add direct tests for `ContextPyramidWidget` placement, lifecycle cleanup,
   reduced motion, and narrow fallback.
4. Verify the borderless editor in a real Pi TUI session rather than only by
   source inspection.
5. Replace the benchmark's historical gauge emphasis with context-pyramid
   measurements while retaining the old gauge as a comparison baseline.
6. Add a generic external-tool metadata adapter for research/subagent tools.
7. Extend structured tool output summaries with any missing tool-specific
   duration, exit code, line count, match count, diff stats, truncation, and
   source count fields.
8. Decide whether auto-collapse belongs in Acidbath after expansion behavior is
   tested.
9. Add a mode/profile layer only after the core UI contract is stable.
10. Keep `pi-research` opt-in until AGY permission and output controls improve.

## Intended non-goals

- Do not turn Acidbath into the skill package manager.
- Do not vendor `/Users/ameno/dev/lib` skills into the published package.
- Do not silently install or modify global skill/settings configuration.
- Do not make every community extension a hard dependency.
- Do not add a second renderer that collides with another package's built-in
  tool ownership.
- Do not ship an animation engine dependency for the header.

## Fresh-session demo contract

A reviewer should be able to verify:

```text
1. Start Pi with the Acidbath package active.
2. Confirm the header says `acidbath` and is theme-colored.
3. Confirm the editor has no top/bottom border.
4. Run /context above; inspect the pyramid and token rail without a numeric percentage.
5. Run /context below; confirm placement changes without a second widget.
6. Run /context off; confirm the editor remains borderless and quiet.
7. Run /orb auto and /motion 0, then invoke read/bash/edit.
8. Set NO_COLOR=1 and PI_ACIDBATH_REDUCED_MOTION=1; repeat visual checks.
9. Run the pure tests and benchmark.
10. Review the external skill/capability plan before enabling new packages.
```
