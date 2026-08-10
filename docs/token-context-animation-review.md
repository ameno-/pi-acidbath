# Token/context animation review

Status: **historical review**. Token/context facts remain active, but the
animated bubble and shared motion-clock wiring were removed. The current footer
uses a static context rail.

Implementation note: the default footer renders a light `ctx` rail without a
numeric percentage. Percentage/token facts remain internal inputs and are
available to expanded/diagnostic formatters, not the default rail.

This review documents the separate, pure animation contract now used by the Acidbath
footer/context surface. It does not replace the semantic orb or tool lifecycle
motion. The intended effect is a small burst of context bubbles/segments when
new, trustworthy usage arrives, followed by a truthful `done`/`settled` state.

## What was inspected

- `extensions/acidbath/index.ts` — lifecycle wiring, context polling, label
  debounce, cleanup, and the current `agent_end` behavior.
- `extensions/acidbath/ui-footer.ts` — one-line metadata/context layout.
- `extensions/acidbath/ui-orb.ts` — existing semantic frames, reduced-motion,
  and `NO_COLOR` conventions.
- `extensions/acidbath/ui-context-widget.ts` and
  `extensions/acidbath/ui-context-pyramid.ts` — context easing, quantization,
  narrow fallback, and pure pyramid model.
- `extensions/acidbath/ui-header.ts` and `ui-tools.ts` — component width and
  shared timer/lifecycle patterns.
- `docs/context-pyramid-spec.md`, `docs/ui-plan-revisit.md`,
  `docs/tool-call-ui-research.md`, `docs/ascii-animation-research.md`,
  `docs/PLAN.md`, and `docs/feature-inventory.md`.
- The installed Pi declaration files for `ExtensionContext`, lifecycle events,
  `ContextUsage`, `AssistantMessage.usage`, and the built-in footer.

## Current findings

1. The current footer has `modelName`, `thinkingLevel`, `contextPercent`, and a
   working label, but no token facts. `workingLabel()` defaults to `● working`.
2. `ui-labels.ts` maps `agent_end` to `orbState: "working"` with an empty
   message. `index.ts` also sends that state to the footer, so completion can
   still look like working rather than done.
3. `ctx.getContextUsage()` is available and returns `{ tokens, contextWindow,
   percent }`, but `tokens` and `percent` can be `null`/unknown, especially
   around compaction. The current footer uses `contextPercent ?? 0`, which can
   visually claim `0%` when the value is actually unknown.
4. Context is polled every 1,000ms and refreshed on lifecycle events. The
   pyramid has its own 80ms `setInterval` while easing. A new animation must
   not add another polling loop or an always-on clock.
5. The footer's fit decisions use JavaScript string length and do not provide a
   final visible-width clamp for every segment. Long model names, Unicode, and
   ANSI styling need an explicit width-safe formatter.
6. The existing orb's `OrbState` intentionally describes active work. Done/
   settled is a different lifecycle fact and should be represented by the new
   status contract, not by pretending that `working` means complete.

## Provider and model API limits

The contract must distinguish observed facts from visual estimates.

### Facts available to an extension

- `ctx.model` supplies provider/model identity and configured model metadata,
  including `contextWindow` and `maxTokens`. These are limits/configuration,
  not observed usage.
- `ctx.getContextUsage()` is the canonical Pi context snapshot. Its `tokens`
  value is an estimated/current context token count or `null`; `percent` is
  the corresponding percentage or `null`; `contextWindow` is the configured
  window.
- `message_update` carries an `assistantMessageEvent`, whose partial/final
  assistant message has normalized `usage` fields in the installed API.
  `message_end`/`agent_end` messages can also contain the final assistant
  usage. A partial usage value may be zero, provisional, or not meaningfully
  updated by a provider, so it must not be presented as final merely because
  the field exists.
- Normalized provider usage has `input`, `output`, `cacheRead`, `cacheWrite`,
  optional `reasoning`, and `totalTokens`. The final usage is useful for a
  turn summary when it is positive and complete.
- `after_provider_response` exposes response status and headers, not a typed
  token-usage payload. Do not parse arbitrary headers or provider response
  bodies in the UI extension.
- The extension-facing `sessionManager` is read-only and does not expose the
  full `getSessionStats()` helper. Do not label a number as a session total
  unless a future API explicitly supplies that aggregate.
- A recent Pi API also has `agent_settled`, meaning the run has ended with no
  retry, compaction, or queued continuation. Older runtimes may only expose
  `agent_end`; capability-detect this event rather than assuming it exists.

There is no portable provider-independent stream of exact token deltas.
`text_delta` is a text update, not a token count. Some providers report usage
only at the end, some report it in streaming events, and cache/reasoning
accounting varies. The animation therefore treats a context-token delta as a
delta between two trustworthy Pi context snapshots, not as one bubble per
provider token.

## Proposed information ownership

| Fact | Owner | Rule |
|---|---|---|
| Active agent/tool phase | Existing orb + working indicator | Keep the current semantic labels while work is active. |
| Completion lifecycle | Token/context status contract | `agent_end` becomes `done`; `agent_settled` becomes `settled`; never fall back to `working`. |
| Context pressure | Footer context rail | Show exact `N%` and/or `used/window` only when supplied by Pi. |
| Turn usage | Footer status metadata | Show `in`, `out`, cache, or reasoning only when final normalized usage is trustworthy. |
| Token animation | Footer context rail | Bubbles are a bounded visual pulse derived from a known delta; they are not a token counter. |
| Tool outcome | Tool row | Do not duplicate tool result details in the context rail. |

The status line should be the single owner of completion and token/context
metadata. The orb can stop when the status becomes `done`; it should not be
made to spell `done` by adding a fake active orb state.

## Pure animation contract

The future pure module could be named `ui-token-context.ts`. It must have no
Pi, TUI, theme, timer, environment, or logging dependency. The following is a
contract sketch, not code to wire in this pass.

```ts
type Lifecycle = "idle" | "working" | "done" | "settled" | "error";
type FactSource = "context-api" | "assistant-usage" | "unknown";

type UsageFacts = {
  // Canonical context facts. Never use zero as an unknown sentinel.
  contextTokens: number | null;
  contextWindow: number | null;
  contextPercent: number | null;

  // Final/provider usage for the current response when reported.
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  reasoningTokens: number | null;
  totalTokens: number | null;

  source: FactSource;
  complete: boolean;
  sequence: number;       // rejects stale/out-of-order snapshots
  generation: string;     // changes across compaction/new session/model turn
};

type AnimationEvent =
  | { type: "agent_start"; generation: string }
  | { type: "usage"; facts: UsageFacts }
  | { type: "agent_end"; outcome: "success" | "error" | "aborted" }
  | { type: "agent_settled" }
  | { type: "frame_tick" }
  | { type: "reset"; generation: string };

type AnimationState = {
  lifecycle: Lifecycle;
  facts: UsageFacts | null;
  contextDelta: number | null;
  segments: readonly ("filled" | "empty" | "bubble")[];
  pendingBubbles: number;
  frameIndex: number;
};

function reduce(state: AnimationState, event: AnimationEvent): AnimationState;
function render(state: AnimationState, width: number, opts: {
  reducedMotion: boolean;
  noColor: boolean;
}): { lines: string[]; visibleWidth: number };
```

### Reducer rules

- `agent_start` sets `working`, clears transient bubbles, and starts a new
  generation. It does not erase the last known context facts unless the
  session/model actually changed.
- A `usage` event is accepted only if its generation and sequence are current.
  Normalize negative/non-finite values to unknown, not zero.
- `contextDelta` is derived only when both old and new context token values are
  known, from the same generation, and the new snapshot is newer. A decrease
  after compaction is a real reset, not negative token production; reset the
  rail target and show the new snapshot without an animated fake drain.
- A known context percentage/window updates committed segments. A delta that
  does not cross a segment boundary still creates one short `bubble` pulse so
  a small change is visible. The number of bubbles is capped (for example,
  three per update) and is proportional only to the bounded delta bucket; it
  never claims one glyph equals one token.
- `agent_end(success)` sets `done`, freezes the final known metadata, removes
  the working pulse, and emits a final settled-looking frame. `agent_end(error
  | aborted)` sets `error` and retains the last truthful metadata.
- If `agent_settled` arrives, it changes `done` to `settled`. If a runtime has
  no settled event, `done` is the terminal label. If a retry/continuation flag
  is available, `agent_end` must remain `working` until the run is actually
  settled; otherwise the adapter must not invent that flag.
- `frame_tick` advances/removes transient bubbles only. It must never change
  the numeric context target or token facts.
- In reduced motion, `pendingBubbles` is always zero and `render()` returns the
  final target segments immediately.

### Metadata formatting rules

Prefer the most specific truthful representation, in this order:

```text
ctx 82k/200k 41%       # context tokens and window are known
ctx 41%                # only percentage is known
ctx 82k                # tokens known but no usable window
ctx ?                  # context is unknown
turn 1.2k in / 340 out # final current-response usage is known
turn ?                 # it is not known; never print 0 as a substitute
```

Cache-read/write and reasoning breakdowns are optional secondary metadata;
never add them to `output` or `context` a second time. A provider-reported
`totalTokens` is authoritative for the turn if positive; otherwise compute a
clearly documented normalized fallback from its components. A `contextTokens`
value from `getContextUsage()` owns the context label even if it differs from a
provider's billed-input number: those values answer different questions.

Unknown data must stay unknown. In particular, do not infer output tokens from
characters, infer context growth from a `message_update` text length, turn a
model's `maxTokens` into current usage, or display `0%`/`0 tokens` just because
a field is absent.

## Visual direction and sample frames

Use a compact horizontal rail. Filled cells are committed context pressure;
`o`/`○` is a transient bubble; empty cells are remaining headroom. The rail is
decoration around the numeric fact, not the fact itself. Sixteen slots at wide
sizes make a 3% change cross a visible boundary in the common case.

### Known context, token delta, and completion (wide frame)

These are uncolored sample frames at approximately 80 columns. The first two
frames show a `contextTokens` delta of `+600` that has not yet crossed the
quantized 40% segment boundary. The third frame commits the new 43% snapshot.

```text
… working · ctx 40% [●●●●●●○·········] · Δctx +600
… working · ctx 40% [●●●●●●··········] · Δctx +600
… working · ctx 43% [●●●●●●●·········] · Δctx +600
✓ done    · ctx 43% [●●●●●●●·········] · turn 1.2k in / 340 out
✓ settled · ctx 43% [●●●●●●●·········] · ctx 82k/200k
```

The `turn` line is shown only if final assistant usage is complete. The last
line uses the canonical context snapshot, not a claim that `82k` is the whole
session's billed total.

### Unknown-token/context fallback

```text
… working · ctx ? · tok ?
✓ done    · ctx ? · tok ?
✓ settled · ctx ? · tok ?
```

There is no empty `0%` rail in this case. If context percentage is known but
turn token usage is not, preserve the useful fact:

```text
✓ settled · ctx 43% · tok ?
```

### Narrow frames

At 60 columns, drop the rail before dropping the numeric context fact; at 40
columns, drop transient delta text and keep lifecycle plus context:

```text
# 60 columns
✓ done · ctx 43% · 1.2k/340 tok

# 40 columns
✓ done · ctx 43%

# 40 columns, unknown
✓ done · ctx ?
```

At very narrow widths, a deterministic fallback such as `✓ done` or `ctx ?`
is preferable to wrapping. The full status remains available in the normal
transcript/session UI; the footer is a compact summary.

## Color, reduced motion, and width safety

- `NO_COLOR=1` removes ANSI only. It must retain `✓`, `!`, `●`, `○`, `·`, the
  words `done`/`settled`, and all numeric labels. If a terminal cannot render
  those glyphs, an explicit ASCII mode may use `#`, `o`, and `.`; do not make
  color the source of meaning.
- `PI_ACIDBATH_REDUCED_MOTION=1` renders the target segment state immediately,
  skips bubble pulses, and starts no animation timer. Metadata still updates
  normally.
- Every pure render accepts `width`; use terminal visible-width measurement
  after ANSI removal and a width-aware truncator. Never use raw JavaScript
  `.length` as the final fit decision. Reserve status and `ctx N%` before the
  decorative rail, and never split an escape sequence or wrap a line.
- Recommended priority at a width boundary: lifecycle glyph/word → light
  context rail or `?` → compact token fact → context segments → cache/reasoning
  detail. The default rail never prints a percentage number.
- Test widths 20, 28, 40, 60, 80, and 120 with color on/off, long model names,
  wide Unicode, unknown values, and both increasing and decreasing context.

## Runtime adapter and timer plan

The pure reducer/renderer owns no clock. A future footer/widget adapter may
schedule one `setTimeout` only while `pendingBubbles > 0` and motion is enabled.
It should schedule the next frame at its duration, rather than run a fixed
polling interval.

Required lifecycle:

1. Render a static frame at session start.
2. On a known usage delta, enqueue at most the bounded bubble count and start
   the one timer if needed.
3. On `agent_end`, stop the working pulse immediately and render `done`; do not
   let a stale bubble keep the footer saying `working`.
4. On `agent_settled`, render `settled` and clear transient animation state.
5. On `error`/abort, render the error glyph and clear the pulse.
6. When the queue reaches zero, clear the timer and leave idle/done/settled with
   zero active animation timers.
7. `dispose()` must be idempotent: clear the timeout, clear subscribers and
   queued bubbles, invalidate no future component, and tolerate a later stale
   event. Session shutdown, reload, and session replacement all call dispose.

The existing context poll can remain the source of snapshots. This contract
must not create a second poller, an interval per bubble, or a timer for an
unchanged target. A stale generation check is required so a late provider
update cannot restart animation after shutdown or after a new session begins.

## Implementation plan after review

1. Add a pure `ui-token-context.ts` model/reducer/formatter with fixture tests;
   keep it independent from `ExtensionContext`, themes, and timers.
2. Add a thin adapter that converts `getContextUsage()` and final assistant
   usage into `UsageFacts`, preserving `null`/unknown and sequence/generation
   information. Register `agent_settled` when supported; keep a compatibility
   path for `agent_end`.
3. Extend the footer state with lifecycle and optional token/context facts.
   Replace the current `contextPercent ?? 0` fallback with an explicit unknown
   representation. Keep the existing orb state separate.
4. Prototype the rail at the sample widths and verify one status owner: no
   duplicate working sentence, context percentage, or token total in header,
   working indicator, and footer.
5. Add reducer/render tests for +3% and sub-segment deltas, compaction reset,
   unknown usage, provider final usage, `agent_end` → `done`, `agent_settled` →
   `settled`, errors, reduced motion, `NO_COLOR`, ANSI/visible-width safety,
   stale events, and timer disposal.
6. Only after those fixtures pass, wire the adapter into production. This
   review intentionally makes no such wiring change.

## Decision

Proceed with a **pure token/context reducer plus a small, bounded bubble pulse**.
Use Pi's context snapshot for committed segments and final assistant usage for
turn metadata. Treat provider deltas as unavailable unless Pi supplies a
trustworthy snapshot; show `?` rather than estimates. Change completion
semantics to `done` at `agent_end` and `settled` at `agent_settled`, never
`working`. Keep the animation subordinate to the facts, reduced-motion safe,
color-independent, width-clamped, and timer-free when idle.
