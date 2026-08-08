# Acidbath tool-call interaction review

Status: implemented baseline. The renderer-only, status-first contract is now
wired for the seven built-ins; this document remains the behavioral reference
for subsequent refinement.

## Decision summary

Adopt a renderer-only, status-first contract for the seven built-ins. The default
state is one compact row per completed tool call; output, diffs, and diagnostics
are details behind Pi's existing expansion affordance (`app.tools.expand`,
usually Ctrl+O). Keep partial calls live, keep errors visible, and never infer
an external tool adapter from its name.

Recommended row grammar:

```text
[state] tool target [· structured metadata] [· expansion hint]
```

The renderer should own presentation only. Tool execution remains Pi's
`execute()` path. A result link is not an action protocol, and a visible row
must not execute a command during `render()`.

## Evidence and scope

Read-only sources reviewed:

- `docs/tool-call-ui-research.md`
- `extensions/acidbath/ui-tools.ts`
- `/tmp/pi-tool-display/README.md`
- `/tmp/pi-tool-display/src/tool-overrides.ts`
- `/tmp/pi-tool-display/src/render-utils.ts`
- `/tmp/pi-tool-display/src/bash-display.ts`
- `/tmp/pi-tool-display/src/diff-presentation.ts`
- `/tmp/pi-tool-display/src/types.ts` and registration/custom-tool tests
- `/tmp/pix-mono/packages/pix-pretty/src/{utils,renderers,diff-render,widget-format,types}.ts`
- `/tmp/pix-mono/packages/pix-bash/src/{bash,bash.test}.ts`
- `/tmp/pix-mono/packages/pix-read/src/read.ts`
- `/tmp/pix-mono/packages/pix-edit/src/edit.ts`
- `/tmp/pix-mono/packages/pix-grep/src/grep.ts`
- `/tmp/pix-mono/packages/pix-find/src/find.ts`
- `/tmp/pix-mono/packages/pix-ls/src/ls.ts`
- `/tmp/pix-mono/packages/pix-write/src/write.ts`
- `/tmp/pix-mono/packages/pix-footer/src/footer.ts`
- `/tmp/pix-mono/packages/pix-welcome/src/welcome.ts`
- installed Pi `docs/extensions.md`, `docs/tui.md`, `docs/sdk.md`,
  `docs/keybindings.md`, and `dist/.../components/tool-execution.js`
- installed `@mariozechner/pi-tui` 0.46.0 sources/types

The pix-mono and pi-tool-display implementations are useful pattern sources,
not proposed runtime dependencies for Acidbath.

## Findings about the current Acidbath wrapper

`extensions/acidbath/ui-tools.ts` re-registers `read`, `bash`, `edit`, `write`,
`grep`, `find`, and `ls`. It delegates both stock renderers and decorates only
the first call-rendered line with a lifecycle glyph. The result is returned
unchanged. This produces three problems:

1. The call and result do not share a visual contract. A compact call can be
   followed by a large stock result, so the apparent card changes shape twice.
2. Counts, duration, exit status, diff stats, truncation, and image information
   are not represented as structured display metadata. The wrapper cannot
   reliably summarize them without parsing rendered text.
3. The wrapper reduces the child width by two columns but does not itself use
   `visibleWidth`/`truncateToWidth`. Long paths, Unicode, ANSI, and a narrow
   terminal can still violate the component width contract.

The shared `MotionClock` is a good baseline: one timer while at least one call
is pending, row-local invalidation, and disposal. Keep that pattern. Do not add
one spinner/timer per tool result.

Pi's tool host creates separate call and result slots, carries a shared
row-local `context.state`, and passes `toolCallId`, `isPartial`, `isError`,
`expanded`, `lastComponent`, `invalidate`, `cwd`, and execution state. The
renderer seam is therefore sufficient for a compact contract; parsing rendered
stock strings is not.

## Proposed display contract

### Lifecycle

- Pending/partial: one stable row, current safe argument summary, no collapse.
- Final success: one row replacing the pending row, with semantic metrics.
- Final error: one row with an error marker and short diagnostic; preserve the
  full diagnostic for expansion.
- Expanded: the same semantic header plus bounded details. Expansion is the
  only normal reason for a multi-line body.
- Truncated output: show `truncated` or `... N more`; preserve Pi's original
  model-visible result and do not change context content merely to make the UI
  compact.
- State is keyed by `toolCallId`; remove it on completion, shutdown, and reload.

To prevent a settled card from jumping, the completed call slot should be
empty (or otherwise hidden) when its result slot owns the one-line summary.
The transition is then one pending line to one final line. A body appears only
when the user explicitly expands it or when a short error diagnostic is part of
the error policy.

### Status vocabulary

The semantic status must survive `NO_COLOR` and terminals with incomplete
Unicode support:

```text
pending   ...
success   ok
warning   !
error     ERR
external  ->
```

A themed build may use `...`, `✓`, `!`, and `↗`, but glyph shape and color must
not be the only indication of state.

### Namespaced display metadata

Do not replace or conflate a tool's result details. Add a presentation namespace
at the wrapper boundary, for example:

```text
acidbathDisplay: {
  schemaVersion: 1,
  target: "src/acidbath/ui-tools.ts",
  summary: "read",
  metrics: { kind: "lines", value: 214 },
  durationMs: 8700,
  exitCode: null,
  truncated: false,
  expandable: true
}
```

The actual implementation can use an object rather than this text notation.
The important rules are: keep model-visible `content` unchanged; merge with,
not discard, upstream `details`; use explicit metric kinds; capture duration at
execution boundaries; and never count a display body after notices or truncation
hints have been added.

### Built-in metadata policy

| Tool | Default row | Expanded details |
| --- | --- | --- |
| `read` | path + line count, or image MIME/size | bounded, line-numbered preview |
| `grep` | target + match count | bounded matching lines |
| `find` | scope + result count | bounded paths |
| `ls` | path + entry count | bounded listing/tree |
| `bash` | safe command summary + exit + output lines + duration | bounded framed output; no-output is explicit |
| `edit` | path + `+added -removed` | adaptive unified/split diff |
| `write` | path + created/updated + line/diff stats | adaptive diff or bounded preview |

Do not show raw JSON by default. For an unknown result, show only tool name,
safe target, and explicitly supplied metadata. Do not guess `sources`, `files`,
or `matches` by scraping arbitrary text.

## Layout and width rules

Pi's `Component` contract requires every rendered line to be no wider than the
provided width. `setWidget()` supports only `aboveEditor` and `belowEditor`;
it is not a right-dock API. A right-side context indicator therefore belongs
in a footer segment, not in a widget. `setFooter`, `setHeader`, `setWorkingIndicator`,
`setWorkingMessage`, and `ctx.ui.custom()` are separate surfaces with separate
lifecycle/input behavior.

For tool rows:

- format semantic segments first, then clamp the complete ANSI-bearing line;
- use `visibleWidth` and `truncateToWidth`, not JavaScript `.length`;
- reserve space for state and tool name, then shorten optional metadata and
  target before dropping the status;
- keep the compact row to one line at 40/60/80/120 columns;
- use `renderShell: "self"` only for renderers that need full-width framing;
- cache async highlight/diff results by call id, width, theme, and expanded
  state, and call `context.invalidate()` when ready;
- do not auto-collapse on a timer in the first Acidbath implementation. A timer
  that changes a card after it settles is itself layout shift and can hide an
  error before the user reads it.

The pix-pretty helpers demonstrate the right primitives: shared collapsed-row
formatting, ANSI-aware width handling, namespaced display details, and one
semantic count used by both summary and expanded views. pix-bash demonstrates
capturing command, exit, duration, and line count. pix-read/edit/write show
structured file/image/diff details and adaptive diff presentation. Their
`tickCollapse()` policy is intentionally not copied for the initial baseline.
The pix footer is a useful truncation reference, but its long multi-segment
line should not be copied wholesale into Acidbath.

## Plain-text fixtures

These fixtures contain no ANSI. They are intended as snapshots for a pure
formatter, not as production output yet.

### 60 columns: compact baseline

```text
... read src/acidbath/ui-tools.ts (214 lines)
ok grep "renderResult" extensions (12 matches)
ok edit extensions/acidbath/index.ts (+3 -1)
ok bash git diff --check (exit 0, 0 lines, 180ms)
ERR bash bun test (exit 1, failed; expand)
-> research Pi TUI footer (6 sources)
```

### 80 columns: useful optional metadata

```text
... bash bun test && bun run lint (running)
ok bash bun test (exit 0, 18 lines, 2.4s)
ok read src/acidbath/ui-tools.ts (214 lines)
ok grep "renderCall" extensions (12 matches)
ok edit extensions/acidbath/index.ts (+3 -1, 1.1s)
ERR edit src/index.ts (old text not found; expand)
```

### 120 columns: full compact metadata

```text
... bash bun test && bun run lint && git diff --check (running)
ok bash bun test (exit 0, 18 lines, 2.4s, cwd acidbath)
ok read extensions/acidbath/ui-tools.ts:1-214 (214 lines, 8.7KB)
ok grep "renderResult" extensions/acidbath (12 matches, 3 files)
ok edit extensions/acidbath/index.ts (+3 -1, line 173, 1.1s)
ERR edit extensions/acidbath/index.ts (old text not found; expand diagnostic)
```

### Expanded exception fixture

```text
ok bash bun test (exit 0, 2.4s)
----------------------------------------------------------------
  1 passing
  2 files checked
----------------------------------------------------------------

ok edit src/index.ts (+3 -1)
----------------------------------------------------------------
  41  const before = value;
  41- const before = oldValue;
  41+ const before = nextValue;
----------------------------------------------------------------
```

Width policy: at 60 columns use the row summary and at most three expanded
body lines; at 80 use a bounded unified diff; at 120 split is eligible only if
both panes remain readable. `NO_COLOR` removes styling, not the status words,
signs, counts, or truncation markers.

### Transition fixture

```text
frame 1: ... bash bun test (running)
frame 2: ... bash bun test (running 420ms)
final:   ok bash bun test (exit 0, 2 lines, 1.1s)
```

The pending row may animate through the existing shared clock. The final row
must be deterministic. A 3% context change needs a distinct numeric or marker
frame, but tool result rows should not add a new animation loop.

### Failure and partial fixture

```text
... edit src/app.ts (pending, 2 edits)
... bash bun test (running)
ERR edit src/app.ts (old text not found; expand)
  diagnostic is available only after explicit expansion
```

A partial edit/write preview must be labeled pending and must not be presented
as an applied diff. A finalized error must never settle into `ok` or an empty
result block.

## Ownership and external tools

Acidbath's explicit ownership set is the seven built-ins above. Registering the
same name replaces Pi's built-in tool and can replace another extension's
renderer depending on load order. Before any production takeover, inspect
`pi.getAllTools()` and `sourceInfo`; do not silently replace a non-builtin owner.

The `/tmp/pi-tool-display` adapter and ownership model are sound precedents:
non-built-in tools are opt-in, generic output is not guessed from names, and an
adapter supplies a stable label/target/metadata contract. Acidbath should not
intercept `research`, `subagent`, `pi-interactive-shell`, MCP, or other external
tools merely because a name looks familiar. External rows are a future adapter
feature, not a blanket renderer.

## Interactive actions and security boundary

### Direct answer

- **A normal tool-call response link cannot execute a Herdr command through the
  Pi renderer API.**
- **A normal tool-call response link cannot execute an arbitrary shell command
  through the Pi renderer API.**
- **A trusted extension can deliberately add an interactive component or
  shortcut that executes Herdr or a process.** That is extension behavior, not
  a capability of a response link/button.

### Why

Pi's `Component` interface is `render(width)`, `invalidate()`, and optional
`handleInput(data)` when that component has focus. Tool call/result components
are rendered transcript rows; they do not have a built-in button model, click
callback, hit-test region, or action return value. `renderCall` and `renderResult`
return components and are called during redraw, so execution from render would
be unsafe and could run repeatedly on resize/theme changes.

`ctx.ui.custom()` and TUI overlays can own keyboard focus. A custom component's
`handleInput` can dispatch an application-defined action. `pi.registerShortcut`
and extension commands provide other explicit input paths. None turns arbitrary
text in a tool result into executable UI actions automatically.

Pi does support OSC 8 terminal hyperlinks. In fullscreen mode, clicking an OSC
8 link opens it in the terminal's default handler. Pi's path renderer uses this
for `file:` URLs when hyperlink capability is present. This is terminal/OS
integration, not a Pi callback. Behavior varies by terminal and OS; a `herdr:`
or `command:` scheme may be ignored, prompt, or be handled by an externally
registered application. It is not a portable or safe command-execution
contract. Treat all model/result-provided URLs as untrusted and allow only
expected URL schemes/hosts if links are shown.

### Herdr and shell execution matrix

| Mechanism | Can run Herdr/shell? | Boundary and recommendation |
| --- | --- | --- |
| Plain `renderCall`/`renderResult` text | No | renderer-only; no side effects |
| OSC 8 URL in a row | Not through Pi | terminal default handler; external, variable, untrusted |
| Focused `ctx.ui.custom()` component | Yes, if extension code does it | explicit key, fixed action id, confirmation, audit |
| `pi.registerShortcut`/command | Yes, if handler does it | explicit user input; use allowlist and confirmation |
| `pi.exec("herdr", args)` | Yes | extension has full system permissions; use argv, timeout, signal, and `HERDR_ENV` check |
| `child_process`/`sh -c` in extension | Yes | arbitrary process execution; avoid for this feature |
| `pi.sendUserMessage("...")` | Indirectly | can start an LLM turn and tools; not a safe button primitive |

Pi's extension documentation explicitly warns that extensions run with full
system permissions. `pi.exec` is therefore a security boundary at extension
installation/trust, not a sandbox. A tool-call event can block model tool calls,
but a display link does not inherit that permission gate or confirmation flow.

### Safe action design if interaction is later approved

Keep the renderer contract inert and expose actions through an explicit,
trusted extension surface:

1. Store an action id such as `open-output` or `herdr-read-current-pane`, never a
   raw shell string, in namespaced display state.
2. Resolve the id against a static allowlist. Validate paths, Herdr ids, and
   argument types; never pass model-provided command text to `sh -c`.
3. Require a deliberate user key/selection and confirmation for mutations,
   pane control, or any process launch. Do not execute on render or hyperlink
   click.
4. For Herdr, require `HERDR_ENV=1`, prefer a current/explicit pane target,
   use the installed CLI's argv form, and check the returned result. Do not
   control a focused pane implicitly.
5. For local diagnostics, prefer `pi.exec(executable, argv, { signal, timeout })`
   over a shell string. Keep commands read-only by default.
6. Show an audit row after execution (`action ...`, `ok`/`ERR`) and keep the
   original tool result unchanged.

The safest first prototype is therefore a visible expansion hint such as
`(expand)` and no executable link/button at all. If actions are needed, prototype
them in a dedicated focused overlay with synthetic fixed actions, not in tool
response text.

## Acceptance checklist

- [ ] One pending row becomes one completed row; no call/result duplicate in the
      compact state.
- [ ] Partial, success, warning, error, and truncation states survive
      `NO_COLOR`.
- [ ] Every fixture line is within 40/60/80/120-column widths using visible
      width, including wide Unicode and ANSI-bearing paths.
- [ ] Structured counts/duration/exit/diff metadata are stable and separate
      from model-visible content.
- [ ] Ctrl+O expansion restores bounded details; errors and partials are not
      silently collapsed.
- [ ] Built-in ownership detects non-builtin owners before registration.
- [ ] External tools remain untouched unless an explicit adapter is configured.
- [ ] No render path, OSC 8 link, or tool result can invoke Herdr or a shell.
- [ ] Any future interactive action uses fixed ids, explicit focus/input,
      confirmation, argv execution, timeout/signal, and an audit result.
- [ ] `session_shutdown`/reload disposes motion clocks, async invalidators, and
      per-call state.
