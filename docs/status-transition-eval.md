# Footer lyric transition timing eval

## Goal

Keep one lyric continuously visible in the footer beside the context rail. Every
semantic state change advances to the next line from the session-selected song.
Rapid hooks display the glitch bridge; longer provider/tool/composing states
settle into a readable lyric. The playlist spans 14 eligible lines across the
full bundled song set rather than repeating the two or three lines from one
session-selected song.

The separate above-editor lane remains exclusively reserved for the shimmering
reasoning preview.

The footer's left identity rail shows the working directory in gray, the model
in the theme's red/error color, and the current Git branch with a branch glyph.
The branch is refreshed asynchronously after session startup so Git lookup never
blocks the first render. Branch is more actionable than thinking level there:
users can see which checkout they are editing without opening a command or
session panel. Thinking level remains available in the extension state.

The welcome surface separately renders a compact native-cost model card with
only model name, input/output price per million tokens, and thinking level.
Spend color is intentionally simple: low is green, default is blue, high is
red. Unknown native pricing is rendered as `cost unavailable`. The Stoic quote
collection contains 24 entries; one is selected randomly per session and shown
as centered yellow text with the author only. It is not coupled to the footer or
input field.

## Current policy

- Footer identity: directory (gray), model (red), branch (amber).
- Behavior tag slot: **10 fixed terminal cells** (`listening`, `searching`, `writing`, `running`, and related states).
- Footer lyric slot: **44 fixed terminal cells** on normal terminals, centered within the slot. Narrow terminals use a smaller fixed-per-width slot and show `♪ …` rather than chop a phrase.
- Context rail: **20 fixed terminal cells**, with empty dots when pressure is unknown; it never renders `ctx ?` in the footer.
- Token fields are always reserved as fixed-width `0 in / 0 out` until facts arrive.
- Only complete, reviewed phrases of at most 42 characters enter the playlist. Overlong phrases are excluded rather than chopped; shorter lines are padded, so `ctx` never shifts.
- Minimum stable-word dwell: **180 ms**.
- Glitch bridge: **4 frames × 56 ms = 224 ms**.
- No empty transition frame is permitted.
- A new event retargets the current bridge instead of finishing an obsolete
  lyric first.
- Reduced motion snaps directly to the next clipped line and starts no timer.
- The transition timer stops after the lyric settles.

The visual reference used Zalgo-style Unicode combining marks. Acidbath uses a
restrained version during transitions only: at most one mark above and one
below selected characters. Stable lyrics never contain glitch marks.

## Synthetic profiles

Run:

```bash
npm run bench:status
```

Reference run (Node 22, macOS):

| Profile | Stable states | Coalesced states | Time animating | Key result |
|---|---:|---:|---:|---|
| rapid-hooks | 2 | 8 | 39.8% | rapid 20–90 ms hooks remain an animated bridge |
| long-tools | 6 | 6 | 30.0% | write, grep, and bash all settle to readable lyrics |
| mixed-agent-loop | 8 | 7 | 24.0% | provider, reasoning, tool, composing, and settled states display cleanly |

Long-tool fixture results:

| State | Synthetic dwell | Lyric stable after |
|---|---:|---:|
| write | 900 ms | 224 ms |
| grep | 650 ms | 320 ms |
| bash | 1,200 ms | 224 ms |
| provider wait | 300 ms | 224 ms |
| settled | 600 ms | 224 ms |

The pure transition engine completed 100,000 advances in about **641 ms**, or
**6.4 µs per advance**, below the 50 µs acceptance budget. This remains a
microbenchmark rather than a complete TUI CPU measurement.

## Real-session measurements

Acidbath records real event-to-event dwell time in memory:

```text
/status-timings show
/status-timings reset
```

The report includes count, mean, p50, p95, and maximum duration for every
observed provider, reasoning, tool, compaction, session, completion, and settled
state. State changes also drive lyric changes, while repeated deltas within the
same state do not churn the lyric.

## Calibration rule

Collect several real sessions before changing the constants. States whose p95
stays below 180 ms should normally remain transition-only unless they represent
an error or require user action. Long tools should retain at least 400 ms of
stable lyric time after the 224 ms bridge.
