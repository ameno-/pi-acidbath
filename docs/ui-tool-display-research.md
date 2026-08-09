# UI/tool display research and implementation plan

Status: **research complete; compact baseline now wired**.

Sources reviewed:

- `MasuRii/pi-tool-display` @ `91cef7580078371f8dc49a8607222807ad6a424d`
- `xynogen/pix-mono` @ `141882fecd158b15178f21784468dbcf9987cb83`
  - `packages/pix-welcome`
  - `packages/pix-bash`, `pix-read`, `pix-edit`, `pix-ls`, `pix-pretty`,
    `pix-runtime`

## Decision: build our own, borrow patterns

Do **not** add `pi-tool-display` or the pix suite as runtime dependencies yet.
Both are useful references, but acidbath should own its renderer contract and
avoid a second extension competing for the same built-in tools.

`pi-tool-display` also has a `postinstall` script that conditionally runs a
local dependency-patching script in Pi's extension directory. That is not
needed for a pattern-only adoption and deserves a separate security review if
we ever install it directly.

## Patterns worth borrowing

### From pi-tool-display

1. **Explicit ownership:** per-built-in toggles prevent renderer collisions.
2. **Output modes:** hidden, summary/count, and preview are better than one
   fixed output policy.
3. **Shared collapse state:** completed output collapses after a delay and
   expansion restores the exact previous view.
4. **Adaptive diff presentation:** summary at narrow widths, unified at medium
   widths, split only when the terminal can support it.
5. **Projected pending diffs:** show a safe edit/write preview while arguments
   are still streaming, bounded to workspace files and capped in bytes.
6. **Structured metadata:** preserve model-visible results while attaching
   display-only counts, durations, exit codes, truncation, and file paths.
7. **Consumer API shape:** a future `decorateTool`-style adapter is preferable
   to hardcoding every community tool name into acidbath.

### From pix-mono

1. **Semantic icon catalog:** one global mode (`nerd`, `unicode`, `ascii`) so
   glyph choices remain aligned and tofu-safe.
2. **Welcome lifecycle:** render above the editor, update checks live, dismiss
   on the first user turn.
3. **Bash metadata:** capture duration, exit code, command summary, and output
   line count; frame output and show a compact completed row.
4. **Read metadata:** capture path, offset, line count, image type/size, and
   provide a bounded preview with expansion.
5. **Shared result rows:** `✓ tool target · metadata`, `✗ tool target · failed`,
   and a warning/interrupt state are a strong common vocabulary.
6. **Framed output:** top/bottom rules, bounded previews, and explicit
   `… N more lines` hints make long output predictable.
7. **Auto-collapse:** a shared 10-second default is useful, but should be off
   until the acidbath renderer has expansion tests.

## Proposed acidbath tool-output contract

| Tool | Call row | Completed summary | Expanded/preview behavior |
|---|---|---|---|
| `read` | `read path [from line N]` | `✓ read path · N lines` | Bounded syntax-highlighted preview; image type/size |
| `grep` | `grep pattern [path]` | `✓ grep pattern · N matches` | Highlight matches; count semantic matches, not display lines |
| `find` | `find pattern [path]` | `✓ find pattern · N results` | Bounded result list; `… N more` |
| `ls` | `ls path` | `✓ ls path · N entries` | Compact tree; bounded depth/rows |
| `bash` | `bash command [timeout]` | `✓ bash command · exit 0 · N lines · 1.2s` | Framed output; no-output summary; error keeps diagnostic visible |
| `edit` | `edit path · N edits` | `✓ edit path · +A -R` | Unified/split diff by width; pending projected preview |
| `write` | `write path · N lines` | `✓ write path · +A -R` | Create/overwrite distinction; bounded diff/preview |
| custom tools | `tool name · argument summary` | `✓ tool target · structured metadata` | Explicit adapter or safe generic summary; never dump raw JSON by default |

### Common rules

- Preserve the original result for the model; cap only the display.
- Use semantic counts from structured details, never recount visible lines.
- Sanitize ANSI and clamp every rendered line to terminal width.
- Errors remain expanded or show a compact error row plus an expansion hint.
- Partial results never auto-collapse.
- Keep all display state keyed by `toolCallId` and dispose it on completion or
  session shutdown.
- Use one semantic icon catalog and support `NO_COLOR`/ASCII fallback.

## Custom welcome direction

The acidbath welcome should be inspired by `pix-welcome`, not copied:

- compact ASCII/orb mark above the editor;
- model, cwd, tool count, skill count, and ast-grep availability;
- checks update live but remain read-only;
- dismiss on first user turn;
- no automatic `.gitignore` mutation;
- no auth/token contents or provider secrets in the banner;
- use the same orb/icon tokens as the context pyramid and tool rows.

The welcome should be optional and independently disable-able. It must not
compete with the context pyramid for more than a small fixed number of lines.

## Implementation order

1. Implement and snapshot-test the context pyramid as a pure renderer.
2. Add a local semantic icon/orb token module shared by pyramid, welcome, and
   tool rows.
3. Add display-only structured metadata to acidbath's built-in wrappers.
4. Add summary/preview modes and a shared collapse controller, defaulting to
   no auto-collapse until expansion behavior is tested.
5. Add the custom welcome after the pyramid and tool rows have stable tokens.
6. Re-run the render benchmark at widths 60/80/120 and with `NO_COLOR=1`.

Production wiring now follows this local contract; no community renderer should
be loaded alongside acidbath's built-in wrappers.
