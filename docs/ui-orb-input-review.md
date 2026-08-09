# Acidbath orb/input review

Date: 2026-08-06

Scope: inspect the current working tree, Pi's installed TUI source/docs, and a
real pseudo-TTY startup smoke. This review does not change production
TypeScript or settings.

## Findings

### 1. The working-indicator orb and an editor orb are different surfaces

Pi's `setWorkingIndicator()` configures a `WorkingStatusIndicator`. Pi mounts
that indicator in `statusContainer`, which is a row **above** the editor. The
indicator is rendered as a blank spacer plus the spinner/message, not inside
`Editor` (`.../dist/modes/interactive/components/status-indicator.js` and
`.../dist/modes/interactive/components/loader.js`).

Acidbath then calls `ctx.ui.setWorkingVisible(false)` in
`extensions/acidbath/index.ts:268-270`. Pi's implementation clears the working
status indicator when visibility is false. Therefore configuring
`indicatorFor(...)` alone cannot make an orb appear next to input; a custom
editor must render that orb.

The current working-tree `BorderlessEditor` does render an idle dot and an
orb prefix. In the NO_COLOR smoke, typing `abc` produced the visible shape:

```text
·   abc
```

The input begins after the four-column prefix, and the footer remains below
it. This is the correct general direction, but the implementation still has
edge cases listed below.

### 2. Current fixed slot is stable for ordinary, uncolored input, but not a
complete fixed-width contract

Current `BorderlessEditor.render()` uses `slotWidth = 4` for normal widths,
renders the base editor at `width - slotWidth`, removes its top/bottom borders,
and prefixes every remaining line. That preserves the input origin when the
idle/working/searching frames have the same intended slot width. The override
of `setPaddingX()` is also important: Pi copies the default editor padding into
a custom editor when it is installed, so ignoring that value prevents a
settings change from moving the origin.

The primary frame/slot risks have now been addressed; retain these as acceptance checks:

- Normal-width frames are no longer sliced by JavaScript string index. ANSI
  sequences remain intact and the complete three-cell frame is rendered.
- The four-column slot intentionally reserves three visible braille cells plus
  one separator; the existing orb frame data is three cells wide.
- The slot remains four columns at every usable width. At four columns or less
  there is no usable input width, so the renderer returns only the emergency
  orb slot rather than moving the input origin.
- The prefix is added to every visual editor line, which is good for wrapped
  text, but the implementation should assert visible width after adding it.
  It must also preserve Pi's cursor marker: the marker is emitted by the base
  editor and must remain after the prefix so IME cursor positioning stays
  correct.
- `/orb off` and `/orb default` currently change the Pi working indicator but
  do not explicitly change `editorWidget` to an off/default visual state.
  Manual orb modes also do not call `setOrbState()` from `apply()`. Conversely,
  lifecycle events can still update the editor orb while a manual mode is
  selected. These command/lifecycle semantics need fixture coverage.

Recommended rendering contract (not wired here):

```text
ORB_SLOT_WIDTH = 5                 # four braille cells + one gap
contentWidth = max(1, width - ORB_SLOT_WIDTH)
baseLines = super.render(contentWidth)
remove only the base top and bottom border lines
for each content line:
  prefix = visible-cell-safe orb frame padded to ORB_SLOT_WIDTH
  output = prefix + line
```

Use `visibleWidth`/`truncateToWidth` or a separately styled frame token; never
slice an ANSI-bearing frame. Reserve the same slot for `idle`, `done`, `off`,
and every semantic state. The off token may be spaces, but it must still
reserve the slot so toggling it does not shift existing text.

### 3. Header and footer do render in the real TUI; they are intentionally tiny

Pi's interactive source creates and mounts `headerContainer` and
`footerContainer`, then lays them out as:

```text
... statusContainer
    widget above editor
    editorContainer
    widget below editor
    footerContainer (min height 1)
```

The built-in header is created before Pi rebinds the session and invokes
`session_start`. `setExtensionHeader()` replaces the built-in header at its
existing child index; it is a no-op only if called before the built-in header
has been initialized. `setExtensionFooter()` clears the footer container and
adds the custom component. These facts are in the installed
`dist/modes/interactive/interactive-mode.js` around lines 346-372, 631-650,
694-704, and 1746-1801.

The current `AcidbathHeader.render()` returns exactly one line, `acidbath`.
The current footer returns one line and replaces Pi's normal token/cost footer.
That means the header is visible as a single top line, not as Pi's logo and
startup help, and the footer is visible as a compact replacement, not an
addition to Pi's footer.

A real pseudo-TTY smoke was run with the local extension explicitly loaded,
`--no-session`, `--no-extensions`, `--no-context-files`, `--no-approve`, and
`PI_OFFLINE=1`. It showed:

```text
acidbath
...
·   abc
acidbath · GPT-5.6 Luna · think:default  context 0% ················
```

The colored run showed the same header/footer and input placement. Thus “the
header/footer do not render” is not the current TUI behavior in TUI mode; the
likely confusion is that the custom header is only one line and the borderless
empty editor is mostly blank space.

They genuinely do not render through these APIs in RPC mode: Pi's RPC UI
adapter documents `setHeader`, `setFooter`, and custom editor factories as
unsupported. JSON and print modes have no TUI. `session_shutdown` also clears
both custom surfaces. `quietStartup` suppresses Pi's built-in startup content,
but is not a reason to expect the custom one-line Acidbath header to be tall.

One layout ownership recommendation follows from restoring the editor orb:
make the orb/editor own live working state and remove the duplicate `●
working`/message from the custom footer. Keep the footer for model, thinking,
and context. Otherwise the same state is presented in both the editor rail and
footer.

### 4. Thinking level must never render as an empty field

The old implementation initialized `thinkingLevel` to `"—"` and only updated it
from `thinking_level_select`. The current implementation uses `think:default`
until Pi emits a real selection, then displays the selected level. This avoids
an empty-looking field without guessing a provider-specific level. If a future
Pi API exposes a trustworthy effective level at session start, seed from that
value; otherwise use `think:default` or `think:unavailable`, never a blank or
misleading numeric value.

## Concrete fixture cases

These are render-level fixtures to add before wiring further production
behavior. Each fixture should assert `visibleWidth(line) <= width`, exact
editor origin, cursor marker preservation, and no ANSI-sequence truncation.

### Orb/editor fixtures

| ID | Width | State/input | Expected invariant |
|---|---:|---|---|
| `orb-idle-empty-60` | 60 | idle, empty editor | Prefix occupies the chosen fixed slot; cursor is immediately after the slot; no border remains. |
| `orb-working-60` | 60 | working frame 0, `abc` | `abc` starts at the same visible column as idle; full intended braille frame is visible. |
| `orb-searching-60` | 60 | searching frame, `abc` | Shorter frame is padded, not allowed to move `abc`. |
| `orb-frame-transition-80` | 80 | alternate every working frame with `abc` | Every rendered line has the same input origin; all lines remain width 80 after styling. |
| `orb-wrap-80` | 80 | long text that wraps | Content width is `80 - ORB_SLOT_WIDTH`; every wrapped line receives the same prefix and the cursor marker remains after it. |
| `orb-no-color-120` | 120 | `NO_COLOR=1`, working/searching/done | No ANSI; frame and done glyph are still visible; origin equals the colored case. |
| `orb-color-120` | 120 | normal color, working/done | Strip ANSI and assert the frame cells, then assert the raw output contains complete escape sequences (no partial `\x1b[` prefix). |
| `orb-reduced-motion` | 80 | `PI_ACIDBATH_REDUCED_MOTION=1` | Exactly one deterministic frame; no interval is left running. |
| `orb-off-stable` | 80 | toggle auto → off with existing `abc` | Orb may become blank, but the reserved slot and input origin do not change. |
| `orb-manual-working` | 80 | `/orb working` while idle | The editor rail shows the commanded state, or the command explicitly documents that it only controls Pi's streaming loader. It must not silently disagree. |
| `orb-done-next-turn` | 80 | agent end, then next agent start | Done is visible until the next lifecycle state; next start replaces it without changing the text origin. |
| `orb-narrow` | 3/4/7 | `abc` where possible | Define the degradation: either fixed slot clipped by terminal, or documented breakpoint. Assert no negative width and no malformed prefix. |

### Header/footer fixtures

| ID | Mode/setting | Expected result |
|---|---|---|
| `header-tui` | regular TUI, extension loaded after Pi startup initialization | One custom `acidbath` line replaces the built-in header; it is not additive. |
| `footer-tui` | regular TUI, model/context available | One custom footer line at the bottom; context appears only when placement is `right`. |
| `header-footer-rpc` | `--mode rpc` | No terminal header/footer component; verify the RPC adapter's documented no-op behavior instead of treating it as a render failure. |
| `header-footer-print` | `-p`/JSON | No TUI output from these components. |
| `header-footer-shutdown` | session shutdown | Custom header/footer are cleared and the default editor/footer restoration path runs. |
| `footer-60` | width 60, long model and active context | Full left/right row falls back deterministically to compact left, context-only, then `acidbath`; never overflows. |
| `footer-think-initial` | session start before any level-change event | Display the effective `ctx.thinkingLevel`; if absent, exactly `think:unavailable`. |
| `footer-orb-ownership` | active editor orb + active footer | Assert there is one working-state owner, not both an editor orb and `● working` footer label. |

## Verification notes

- Pi TUI docs require each component render line to stay within the supplied
  width, and explain that `Focusable` editors emit `CURSOR_MARKER` for IME
  positioning. Relevant local docs: `.../docs/tui.md` and
  `.../docs/extensions.md` (custom editors, working indicators, custom header,
  and custom footer).
- `git diff --check` passes for the current working tree.
- The repository's pure-test commands could not run because this checkout has
  no `tsx` dependency (`node --import tsx ...` fails with
  `ERR_MODULE_NOT_FOUND`). The real TUI smoke therefore provides the runtime
  evidence; the fixture table above remains to be automated.
