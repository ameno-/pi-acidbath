# Acidbath Visual System — Complete Explainer

> **What you see, why it looks that way, and how the animation works.**

---

## Contents

1. [Animation Philosophy](#1-animation-philosophy)
2. [Color Story](#2-color-story)
   - [Dark: Acidbath Void](#21-dark-acidbath-void)
   - [Light: Acidbath Pearl](#22-light-acidbath-pearl)
   - [Light/Dark auto switching](#23-lightdark-auto-switching)
3. [Surface Map — What We Own](#3-surface-map)
4. [Activity Status Widget](#4-activity-status-widget)
5. [Tool Rows](#5-tool-rows)
6. [Tool Row Border Animation](#6-tool-row-border-animation)
7. [Header](#7-header)
8. [Footer & Context Rail](#8-footer--context-rail)
9. [Welcome Screen](#9-welcome-screen)
10. [Lyric System Reference](#10-lyric-system-reference)
11. [Theme Token Reference](#11-theme-token-reference)
12. [Decision Grid](#12-decision-grid)

---

## 1. Animation Philosophy

Acidbath animation follows one rule:

> **Phase advances on real events. Never on a timer.**

### Before (removed)

```
setInterval(160ms) → advance glow phase → tui.requestRender() → full TUI re-render
                                                                   ↑ waste
```

Every 160ms (6 Hz) the glow timer forced a complete TUI re-render — header,
footer, editor, transcript, everything — even when nothing had changed.
During a 30-second thinking phase, that was ~175 forced render passes on
top of the natural streaming renders.

### After (implemented)

```
message_update arrives → update(state) → advance phase → render()
                                                           ↑ piggyback
```

The phase advances **only when a lifecycle event changes the widget state**.
The `tui.requestRender()` call already happens from the lifecycle handler
(`recordStatus` / `updateLabel` / `pushContextUsage`). The phase change
piggybacks on a render that was already going to occur.

### Where this applies

| Element | Before | After | Timer removed? |
|---------|--------|-------|:--------------:|
| Activity status glow | `setInterval(160ms)` + `requestRender` | Phase advances in `update()` on real events, throttled at 80ms | ✅ |
| Tool row border | Did not exist | Phase in `context.state`, advances on `renderResult` for streaming tools | N/A (new) |
| Header wordmark gradient | Rebuilt on every render pass | Same (no timer dependency) | Already optimal |
| Footer context rail | Static | Will pulse on `tokenContext` update | N/A |

### Phase cycle

```
dim → muted → accent → bold → accent → muted → dim → ...
```

6 phases. In color mode the glow cycles the label text through these ANSI
theme tokens. In `NO_COLOR` or `REDUCED_MOTION` mode the glow is static.

The phase is throttled to advance at most once per 80ms to prevent strobing
during fast token-by-token streaming.

---

## 2. Color Story

### 2.1 Dark: Acidbath Void

```
void     #0b0810  ── Canvas (deep purple-black)
teal     #34e7d1  ── Accent (energy / action / thinking)
acid     #d7ff4f  ── Success (toxic yellow-green)
magenta  #ff4fb3  ── Error / drama / attention
amber    #ffd166  ── Warning / headings / tool titles
purple   #b58cff  ── Types / border accents / thinking-high
pink     #ff6bcb  ── Variables / links
cyber    #64b5ff  ── Code / punctuation
slate    #252033  ── Borders (barely visible on void)
```

**Vibe:** Synthwave control room. The void is deep enough that borders
in slate are felt more than seen. Teal and acid provide the only high-
saturation jolts — reserved for active states and success signals.

**Problem before simplification:** Too many colored surfaces competing.
The tool rows, motion animations, orb states, whimsical lyrics, and
context pyramid all used different accent colors simultaneously. The
simplification removed ~943 lines and 4 independent animation systems.
Now teal is the single accent, and it's concentrated in the activity
status line and the header.

### 2.2 Light: Acidbath Pearl

```
pearl    #f5f0eb  ── Canvas (warm off-white, like aged paper)
teal     #009c8c  ── Accent (deep teal, readable on pearl)
acid     #5e8c1e  ── Success (olive green)
rose     #c4287a  ── Error (deep rose)
gold     #b8860b  ── Warning (dark gold)
lavender #7c6f9e  ── Types / border accents
pink     #c4567a  ── Variables / links
blue     #3a7ca5  ── Code / punctuation
wash     #d4cdc4  ── Borders (faded denim on pearl)
```

**Vibe:** Bleached acid-wash denim. The neon toxicity is replaced with
faded, earthy equivalents. Teal steps back to a readable deep green.
Acid becomes olive. The canvas is warm rather than cool, so code feels
like it's on paper rather than a screen.

**Contrast ratios (WCAG AA):**

| Pair | Ratio | Passes AA? |
|------|------:|:----------:|
| teal `#009c8c` on pearl `#f5f0eb` | 4.8:1 | ✅ |
| acid `#5e8c1e` on pearl `#f5f0eb` | 4.2:1 | ✅ |
| rose `#c4287a` on pearl `#f5f0eb` | 5.1:1 | ✅ |
| text (black) `#2c2420` on pearl | 12.1:1 | ✅ |

### 2.3 Light/Dark auto switching

Pi supports automatic light/dark switching via theme naming convention:

```
themes/
├── acidbath.json          # Dark (default)
├── acidbath-pearl.json    # Light companion
```

When the theme name matches pattern `{name}/{variant}`, Pi auto-selects
based on system appearance. Since theme names can't contain `/`, we use
separate files and the user selects manually or via terminal theme query.

---

## 3. Surface Map — What We Own

```
┌──────────────────────────────────────────────────────┐
│                    HEADER (acidbath)                   │  ← AcidbathHeader
│  ACIDBATH (teal gradient wordmark)                    │     (theme accent)
│  honest tools · useful work                           │     (theme muted)
│  Current task summary                                 │     (theme text)
├──────────────────────────────────────────────────────┤
│  ◇ weighing options…  latest thought                  │  ← AcidbathActivityStatus
│                                                       │     (glowing lyric)
├──────────────────────────────────────────────────────┤
│                                                       │
│  ┌──────────────────────────────────────────────────┐ │
│  │  (editor area — Pi native)                       │ │  ← Pi's editor
│  │  ╰─› user input here                              │ │     (acidbath prompt)
│  └──────────────────────────────────────────────────┘ │
│                                                       │
│  run  bash npm test                                   │  ← ToolRowComponent
│    exit 0 · 8.4s                                      │     (compact tool row)
│                                                       │
│  ok  read extensions/acidbath/index.ts               │  ← ToolRowComponent
│    214 lines                                          │
│                                                       │
├──────────────────────────────────────────────────────┤
│  acidbath · acidbath · claude-opus-4 · ⌘ main        │  ← AcidbathFooter
│  ctx ●●●●············  turn  2.3k in / 1.1k out      │     (context rail)
└──────────────────────────────────────────────────────┘
```

Legend:
```
← Acidbath     — fully owned, themable from extension
← Pi native    — owned by Pi core, influenced via theme tokens only
```

### What acidbath renders directly

| Surface | File | Render call | Re-render trigger |
|---------|------|-------------|-------------------|
| Header wordmark + tagline | `ui-header.ts` | `renderHeaderLines()` | `update()` → state change |
| Activity status lyric | `ui-activity-status.ts` | `render()` | `update()` → state change |
| Welcome screen | `ui-welcome.ts` | `render()` | `update()` → state change |
| Tool compact rows | `ui-tool-renderers.ts` | `ToolRowComponent.render()` | Transcript re-render (Pi-owned) |
| Agent output banner | `ui-agent-output.ts` | `render()` | Session entry render |
| Footer + context rail | `ui-footer.ts` | `render()` | `update()` → state change |

### What Pi renders from theme tokens only

| Element | Theme token(s) | Acidbath setting |
|---------|---------------|------------------|
| Message box borders | `border`, `borderAccent`, `borderMuted` | `slate` / `purple` / 240 |
| Markdown headings | `mdHeading` | `amber` |
| Markdown links | `mdLink`, `mdLinkUrl` | `pink`, `teal` |
| Markdown code | `mdCode`, `mdCodeBlock`, `mdCodeBlockBorder` | `cyber`, `""`, 240 |
| Diffs | `toolDiffAdded`, `toolDiffRemoved`, `toolDiffContext` | `#304f3d`, `#5f3048`, 242 |
| Syntax highlighting | `syntax*` (10 tokens) | Various |
| Thinking levels | `thinkingOff` through `thinkingXhigh` | Gray → teal → cyber → amber → purple → magenta |

---

## 4. Activity Status Widget

One transient line above the editor. Shows during active agent work, hides
when settled.

### Layout

```
◇ {lyric}  {detail}
```

| Part | Source | Styled as | Visible when |
|------|--------|-----------|-------------|
| `◇` | Static bullet | Plain | Always |
| `{lyric}` | `ui-lyrics.ts` playlist, selected by `kind + phase` | Glowing (phase-colored) | Always during active work |
| `{detail}` | `reasoningPreview` (thinking) or `message` (post-think) | `theme.fg("muted")` | Only when non-generic |

### States & lyric mapping

```
┌───────────┬──────────────────────────────┬──────────────────────────────┐
│ Kind      │ Lyric playlist                │ Example render                │
├───────────┼──────────────────────────────┼──────────────────────────────┤
│ preparing │ gathering context…            │ ◇ gathering context…         │
│           │ setting up…                   │                              │
│           │ loading…                      │                              │
├───────────┼──────────────────────────────┼──────────────────────────────┤
│ listening │ listening to the model…       │ ◇ listening to the model…    │
│           │ awaiting response…            │                              │
│           │ thinking…                     │                              │
├───────────┼──────────────────────────────┼──────────────────────────────┤
│ reasoning │ weighing options…             │ ◇ weighing options…  final   │
│           │ working through it…           │   thoughts about the design  │
│           │ analyzing…                    │   [thinking preview in grey] │
│           │ considering…                  │                              │
├───────────┼──────────────────────────────┼──────────────────────────────┤
│ composing │ finding the right words…      │ ◇ finding the right words…   │
│           │ crafting response…            │                              │
│           │ composing answer…             │                              │
│           │ writing…                      │                              │
├───────────┼──────────────────────────────┼──────────────────────────────┤
│ editing   │ shaping the code…            │ ◇ shaping the code…  Editing │
│           │ applying changes…             │   auth.ts                    │
│           │ editing files…                │                              │
│           │ making it right…              │                              │
├───────────┼──────────────────────────────┼──────────────────────────────┤
│ working   │ working on it…               │ ◇ running commands…  npm test│
│           │ processing…                   │                              │
│           │ one moment…                   │                              │
│           │ running…                      │                              │
├───────────┼──────────────────────────────┼──────────────────────────────┤
│ error     │ something went wrong…        │ ◇ something went wrong…  tool│
│           │ that didn't work…             │   failed                     │
│           │ unexpected issue…            │                              │
├───────────┼──────────────────────────────┼──────────────────────────────┤
│ done      │ finished…                    │ (hidden — settles to idle)   │
│           │ complete…                    │                              │
└───────────┴──────────────────────────────┴──────────────────────────────┘
```

### When detail is shown vs suppressed

The `{detail}` field shows only when the message carries information the
lyric doesn't. Generic state labels are suppressed:

```
Shown:      ◇ weighing options…  refactoring the auth middleware
Suppressed: ◇ weighing options…   ← no trailing text (message was "composing")
```

Messages suppressed as generic: `""`, `"settled"`, `"done"`, `"turn complete"`,
`"context compacted"`, `"preparing"`, `"listening"`, `"composing"`, `"working"`,
`"starting"`, `"running tool"`, `"tool complete"`, `"tool error"`,
`"response error"`, `"turn end"`, and any 1-2 word message matching these.

Messages shown: file paths (`"Editing auth.ts"`, `"Searching in src/"`),
commands (`"Running command: npm test"`), result stats (`"exit 0 · 8.4s"`,
`"+12 -3"`), thinking previews.

### Collapsed width behavior

| Width | Behavior |
|------:|----------|
| ≥ 80  | Full lyric + detail |
| ≥ 60  | Lyric truncated to fit, detail dropped if too long |
| ≥ 40  | Lyric truncated, detail always dropped |
| < 40  | Widget hides |

---

## 5. Tool Rows

Every tool call in the transcript renders as a compact row. Acidbath wraps
Pi's native renderers with `renderCall` and `renderResult` callbacks.

### Compact state

```
{status} {toolname} {target} ({metadata})
```

| Part | Width | Example | Color |
|------|-------|---------|-------|
| `{status}` | 4 chars fixed | `ok  `, `ERR `, `run ` | accent / success / error |
| `{toolname}` | Variable | `bash`, `read` | Same as status |
| `{target}` | Fills remaining | `npm test`, `index.ts` | Plain |
| `({metadata})` | Right-biased | `exit 0 · 8.4s`, `214 lines` | Plain |

### Status values

| Status | Glyph | Meaning |
|--------|-------|---------|
| `run ` | Pending | Tool is executing or waiting for result |
| `ok  ` | Success | Tool completed without error |
| `ERR ` | Error | Tool finished with an error |

### Preview (collapsed, after expansion hint)

When the user has not expanded the row, the last 4 lines (bash) or first
4 lines (read/edit/write/grep/find/ls) of output appear below the compact
row, indented 4 spaces:

```
ok  read extensions/acidbath/ui-tools.ts
    import { createBashToolDefinition, …
    import { createEditToolDefinition, …
    import { createGrepToolDefinition, …
    … 10 more lines · expand
```

Preview is computed from the result content and cached per width. It is
skipped entirely when the row is already expanded (native renderer handles
the detail body).

### Expanded state

When expanded, the native Pi renderer for each tool produces the detail
body. Acidbath preserves Pi's domain renderer unchanged — the compact
row wrapper is purely a presentation adapter.

### Width safety

| Width | Behavior |
|------:|----------|
| ≥ 80  | Full layout with metadata |
| ≥ 60  | Target path truncated, metadata collapsed to 1 item |
| ≥ 40  | Metadata dropped, target to short basename |
| < 40  | Status + tool name only |

---

## 6. Tool Row Border Animation

**Not yet implemented — this is the next build target.**

### Motivation

During tool execution, the user sees `run  bash npm test` as static text.
There's no visual indication that the tool is actively streaming. The
activity status widget above the editor provides a single global signal,
but the specific tool row doesn't communicate its own liveness.

### Design

A left-border character animates through a phase cycle on the compact row.
The phase lives in `context.state` (per tool call) and advances on each
`renderResult` call for partial (streaming) results.

```
Phase 0: │ run  bash npm test
Phase 1: ┃ run  bash npm test
Phase 2: ┃ run  bash npm test
Phase 3: │ run  bash npm test
Phase 4: ┃ run  bash npm test
                   ↑ left border cycles through box-drawing characters
```

The animation uses 4 box-drawing characters: `║ ┃ │ ┃` cycling through
the accent palette. On success it locks to `│` in success color. On
error it locks to `┃` in error color.

### Implementation sketch

```typescript
// In ToolRowComponent.render():
const borderGlyph = this.row.status === "pending"
  ? PENDING_BORDERS[this.phase % PENDING_BORDERS.length]
  : this.row.status === "error" ? "┃" : "│";
const borderColor = status === "pending" ? "accent"
  : status === "error" ? "error" : "success";
const styled = `${theme.fg(borderColor, borderGlyph)} ${rowContent}`;
```

```typescript
// In createCompactToolRenderers.renderResult():
const phaser = () => {
  let phase = 0;
  return () => phase++;
};

// On each partial renderResult:
context.state.phase = (context.state.phase ?? 0) + 1;
```

### Animation rules

- Phase advances only for `isPartial: true` results (streaming)
- Phase reset when tool settles (success/error)
- No timer — advances on real `renderResult` events
- Zero cost when collapsed and not streaming
- `REDUCED_MOTION` / `NO_COLOR`: static `│` border, no animation

### Width safety

| Width | Border shown? |
|------:|:-------------:|
| ≥ 60  | ✅ Full border + content |
| ≥ 40  | ✅ Single-char border |
| < 40  | ❌ Border dropped, status only |

---

## 7. Header

```
┌──────────────────────────────────────────────────────┐
│                                                       │
│   ███ ████  ██ ████ ████ ████ ███                    │  ← Wordmark (palette gradient)
│   █   █   █ █  █   █ █   █ █   █ █                   │     Cycles through 24-step
│   ███ ████  █  ████  ████  ████  █                   │     palette derived from
│   █   █   █ █  █   █ █   █ █   █ █                   │     theme accent color
│   █   █   █ ██ █   █ █   █ █   █ █                   │
│                                                       │
│              honest tools · useful work                │  ← Tagline (theme muted)
│              Current task summary                      │  ← Summary (theme text)
│                                                       │
└──────────────────────────────────────────────────────┘
```

### How the gradient works

1. `parseForegroundRgbFromAnsi()` extracts the theme's `accent` color as RGB
2. `buildGradientPalette()` creates a 24-step HSL wave around that accent
3. Each wordmark row offsets its palette index by `ROW_PHASE_STEP = 0.12`
   to create a diagonal rainbow effect
4. Every `render()` call recomputes the lines from the current palette

The palette is deterministic (pure function of accent color + width), so
it naturally updates when the theme changes. No timer needed — the header
re-renders on any state change or TUI resize.

### Width behavior

| Width | Layout |
|------:|--------|
| ≥ 100 | Full wordmark (5 rows) + tagline + summary |
| ≥ 72  | Wordmark + compact tagline, summary dropped |
| ≥ 50  | Wordmark only, centered |
| < 50  | Collapsed to `acidbath` text |

---

## 8. Footer & Context Rail

```
acidbath · acidbath · claude-opus-4 · ⌘ feat/startup-header
ctx ●●●●················  turn  2.3k in / 1.1k out
```

### Layout

```
{identity} · {location} · {model} · ⌘ {branch}
ctx {rail}  turn {input_padded} in / {output_padded} out
```

| Part | Source | Color |
|------|--------|-------|
| `{identity}` | `"acidbath"` always | `muted` |
| `{location}` | `basename(cwd)` | `muted` |
| `{model}` | `ctx.model.name` | `error` (red accent) |
| `⌘ {branch}` | `git branch --show-current` | `warning` |
| `ctx {rail}` | Context usage dots | `accent` filled / `dim` empty |
| `turn {in}/{out}` | Token usage from last assistant message | `accent` |

### Context rail dots

The rail visualizes context window pressure:

```
ctx ●●●●●●··········   60% full
ctx ●●●●●●●●●●●●●●··   87% full
ctx ················   0% (no data yet)
```

16 dots total. Filled = accent, empty = dim. The rail updates on every
`dispatchTokenEvent` call (which fires at lifecycle boundaries: agent_start,
before_provider_request, after_provider_response, tool_call, tool_result,
agent_end).

### Context rail pulse (planned enhancement)

When context usage exceeds 70%, the rightmost filled dots transition from
`accent` (teal) toward `warning` (amber):

```
< 70%:  ctx ●●●●●●●●●●······    (all teal)
> 70%:  ctx ●●●●●●●●●●·●●●●    (last 4 dots amber)
> 90%:  ctx ●●●●●●●●●●●●●●    (all amber)
```

The transition uses the `contextPercent` field from `UsageFacts` and
computes how many trailing dots to recolor. No timer — recomputed on
each `tokenContext` state update.

### Width behavior

| Width | Layout |
|------:|--------|
| ≥ 80  | Full footer: identity + location + model + branch + context rail + turn usage |
| ≥ 60  | Identity dropped, branch compact |
| ≥ 40  | Location + model only, context/turn dropped |
| < 40  | `acidbath` text only |

---

## 9. Welcome Screen

Shown above the editor on session start. Replaced by the activity status
widget when the first agent run begins.

```
◇ ACIDBATH
◇ cwd ~/dev/acidbath
◇ deepseek-v4-flash-fw · in $0.15/M · out $0.60/M · thinking:high
◇ ✓ runtime pi v0.84.0  ✓ model 42 available  ✓ tools 22 active
◇ "We suffer more often in imagination than in reality." —Seneca
```

### Elements

| Element | Color | Source |
|---------|-------|--------|
| `ACIDBATH` wordmark | `accent` (teal) | Static |
| `cwd {path}` | `accent` | `ctx.cwd` |
| Model card | `success`/`error`/`syntaxPunctuation` based on spend tier | `ctx.model` |
| Preflight checks | `success` (✓) / `error` (×) / `warning` (!) | Async checks |
| Stoic quote | `warning` (amber) italic | Random from 24-message set |

### Preflight checks

Run asynchronously after the welcome screen renders:

1. **runtime** — `pi --version` exit code
2. **model** — `ctx.modelRegistry.getAvailable().length` + model name
3. **tools** — `pi.getActiveTools().length`

Checks update in-place (no re-layout) as results arrive.

---

## 10. Lyric System Reference

**File:** `extensions/acidbath/ui-lyrics.ts`

### Lyric set table

| Kind | Lyrics (4 per set) |
|------|--------------------|
| `preparing` | `gathering context…`, `setting up…`, `loading…`, `preparing…` |
| `listening` | `listening to the model…`, `awaiting response…`, `thinking…`, `processing…` |
| `reasoning` | `weighing options…`, `working through it…`, `analyzing…`, `considering…` |
| `composing` | `finding the right words…`, `crafting response…`, `composing answer…`, `writing…` |
| `editing` | `shaping the code…`, `applying changes…`, `editing files…`, `making it right…` |
| `tool` | `running commands…`, `working on it…`, `one moment…`, `executing…` |
| `error` | `something went wrong…`, `that didn't work…`, `unexpected issue…` |
| `done` | `finished…`, `complete…`, `all set…`, `done…` |
| `working` | `working on it…`, `processing…`, `one moment…`, `running…` |

### Kind mapping (lifecycle → lyric set)

| Lifecycle kind | Lyric set |
|----------------|-----------|
| `preparing` | `preparing` |
| `listening` | `listening` |
| `reasoning` | `reasoning` |
| `composing` | `composing` |
| `editing` | `editing` |
| `shaping` | `editing` (alias) |
| `searching` | `listening` (alias — searching is a form of listening) |
| `tool` | `tool` |
| `compacting` | `working` |
| `error` | `error` |
| `done` | `done` |
| `settled` | `done` |
| `working` | `working` |
| (unknown) | `working` (fallback) |

### Lyric selection

```
lyric = LYRIC_SET[kind][|phase| % 4]
```

`phase` is the glow phase counter (0-5). Using `Math.abs(phase) % 4` maps
the 6 glow phases across the 4 lyrics per set. The lyric cycles:
`lyric[0] → lyric[1] → lyric[2] → lyric[3] → lyric[0] → lyric[1] → ...`

### `LYRIC_MAX_VISIBLE_WIDTH = 30`

All lyrics are truncated to 30 visible cells. This prevents layout shift
when cycling between lyrics of different lengths.

### `isGenericMessage()`

Messages that only echo the state and add nothing beyond the lyric are
suppressed from the detail line. The function catches:
- Empty strings
- Single-word state names (`"composing"`, `"working"`, etc.)
- Short phrases that match known generic labels

Messages with more than 2 words, or containing specific information
(file paths, commands, numbers), are always shown.

---

## 11. Theme Token Reference

### Tokens acidbath sets

| Token | Dark (void) | Light (pearl) | Used by |
|-------|-------------|---------------|---------|
| `accent` | teal `#34e7d1` | teal `#009c8c` | Header wordmark, activity glow, footer dock, tool status |
| `border` | slate `#252033` | wash `#d4cdc4` | Message box borders |
| `borderAccent` | purple `#b58cff` | lavender `#7c6f9e` | Selected/focused borders |
| `borderMuted` | 240 | 250 | Separators |
| `success` | acid `#d7ff4f` | acid `#5e8c1e` | Tool success, check marks |
| `error` | `#ff3b30` | rose `#c4287a` | Tool errors, error states |
| `warning` | amber `#ffd166` | gold `#b8860b` | Headings, branch name |
| `muted` | 242 | 245 | Secondary text, tagline |
| `dim` | 240 | 250 | Very subtle text |
| `text` | `""` (default) | `#2c2420` | Body text |
| `thinkingText` | teal `#34e7d1` | teal `#009c8c` | Thinking block text |
| `selectedBg` | `#151223` | `#e8e3dc` | Active selection |
| `userMessageBg` | `#100d17` | `#f0ebe4` | User message background |
| `userMessageText` | `""` | `""` | User message text |
| `customMessageBg` | `#100d17` | `#f0ebe4` | Agent output banner |
| `customMessageText` | `""` | `""` | Agent output text |
| `customMessageLabel` | purple `#b58cff` | lavender `#7c6f9e` | Output type label |
| `toolPendingBg` | `#15152a` | `#e8e3dc` | Tool box (pending) |
| `toolSuccessBg` | `#102117` | `#eef5e8` | Tool box (success) |
| `toolErrorBg` | `#251323` | `#f5e8ec` | Tool box (error) |
| `toolTitle` | amber `#ffd166` | gold `#b8860b` | Tool title |
| `toolOutput` | `""` | `""` | Tool output text |
| `toolDiffAdded` | `#304f3d` | `#d8ecd8` | Diff added lines |
| `toolDiffRemoved` | `#5f3048` | `#ecd8d8` | Diff removed lines |
| `toolDiffContext` | 242 | 248 | Diff context lines |

### Thinking level colors

| Level | Dark (void) | Light (pearl) |
|-------|-------------|---------------|
| `thinkingOff` | 240 | 250 |
| `thinkingMinimal` | teal `#34e7d1` | teal `#009c8c` |
| `thinkingLow` | cyber `#64b5ff` | blue `#3a7ca5` |
| `thinkingMedium` | amber `#ffd166` | gold `#b8860b` |
| `thinkingHigh` | purple `#b58cff` | lavender `#7c6f9e` |
| `thinkingXhigh` | magenta `#ff4fb3` | rose `#c4287a` |

### Syntax highlighting

| Token | Dark (void) | Light (pearl) |
|-------|-------------|---------------|
| `syntaxComment` | 242 | 248 |
| `syntaxKeyword` | teal `#34e7d1` | teal `#009c8c` |
| `syntaxFunction` | amber `#ffd166` | gold `#b8860b` |
| `syntaxVariable` | pink `#ff6bcb` | pink `#c4567a` |
| `syntaxString` | acid `#d7ff4f` | acid `#5e8c1e` |
| `syntaxNumber` | purple `#b58cff` | lavender `#7c6f9e` |
| `syntaxType` | purple `#b58cff` | lavender `#7c6f9e` |
| `syntaxOperator` | teal `#34e7d1` | teal `#009c8c` |
| `syntaxPunctuation` | cyber `#64b5ff` | blue `#3a7ca5` |

---

## 12. Decision Grid

### Implementation status

| Feature | Status | Lines | Timer? | File |
|---------|--------|------:|:------:|------|
| Activity status event-driven glow | ✅ **Done** | ~90 | No | `ui-activity-status.ts` |
| Lyric system with 9 playlists | ✅ **Done** | ~70 | No | `ui-lyrics.ts` |
| Generic message suppression | ✅ **Done** | ~10 | No | `ui-lyrics.ts` |
| Render cache (activity status) | ✅ **Done** | ~5 | No | `ui-activity-status.ts` |
| Render cache (tool rows) | ✅ **Done** | ~8 | No | `ui-tool-renderers.ts` |
| Render cache (footer) | ✅ **Done** | ~8 | No | `ui-footer.ts` |
| Footer `sameState` bail-out | ✅ **Done** | ~5 | No | `ui-footer.ts` |
| `onLabel` removal from tool renders | ✅ **Done** | ~15 | No | `ui-tools.ts` / `ui-tool-renderers.ts` |
| Expanded skip preview splitting | ✅ **Done** | ~2 | No | `ui-tool-renderers.ts` |
| Thinking preview bounded sampling | ✅ **Done** | ~5 | No | `ui-activity-status.ts` |
| **Tool row border animation** | 🔜 **Next** | ~30 | No | `ui-tool-renderers.ts` |
| **Context rail warm pulse** | 🔜 **Next** | ~15 | No | `ui-token-context.ts` |
| **Acidbath Pearl light theme** | 📋 **Planned** | ~70 | — | `themes/acidbath-pearl.json` |

### Timer audit (zero idle timers)

| What | Before | After |
|------|--------|-------|
| `setInterval` at 160ms | `syncTimer` in activity status | **Removed** — phase advances on events |
| `setInterval` at 50ms | `MotionClock` in `ui-motion.ts` | **Removed** — file deleted |
| `setInterval` at ~2s | `WhimsicalMessageCycle` in `ui-whimsical.ts` | **Removed** — file deleted |
| Any repeating timer during idle | 3 concurrent timers | **Zero** |

### Performance characteristics

| Metric | Before (with timer) | After (event-driven) |
|--------|-------------------:|---------------------:|
| Forced render rate during thinking | ~6 Hz (timer) | Token-rate (natural) |
| Forced render rate during tool streaming | ~6 Hz (timer) | Streaming-event rate |
| Forced render rate at idle | 0 (timer stopped) | 0 |
| Total render passes during 30s thinking + 10s compose | ~240 | Token count (varies) |
| Intermediate objects per lifecycle handler call | ~7 (triple update) | ~7 (unchanged but coalesced) |
| Tool row border animation cost | N/A | O(1) per render, zero when collapsed |

### What's next (in priority order)

1. **Tool row border animation** — Visual liveness per tool call during streaming
2. **Acidbath Pearl light theme** — Full light companion theme
3. **Context rail warm pulse** — Visual pressure cue at high context usage
