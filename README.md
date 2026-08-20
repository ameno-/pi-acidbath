# acidbath

Personal Pi **development and delegation system**. The TUI (header, activity
rail, tool rows, footer, themes) is the presentation layer. Acidbath is the
composition surface for coding, review, research, and bounded workers on
this machine.

UI-focused pieces extracted from `pi-herdr`:

- One transient lifecycle activity rail above the editor for listening, reasoning, composing, and tool work
- Dynamic ten-word session summary pinned to the active Pi header
- Deterministic built-in tool rows in Pi's native transcript, with native expanded details
- Footer identity rail: gray working directory, red model name, and the current Git branch in place of the less-actionable thinking label
- Welcome-only Stoic quote card plus a native-cost model card showing model name, input/output price per million tokens, and thinking level; spend tiers use green/blue/red
- Borderless editor with a static, stylized input prompt and a right-side context rail
- Pure token/context lifecycle reducer with truthful unknown/final usage formatting
- Centered, large theme-aware `ACIDBATH` wordmark startup header
- Transient above-editor welcome metadata and preflight checks (cwd, model, and tools)
- Backgrounded agent-output provenance banners with local timestamp and the prompt that triggered each run
- Curated attributed Stoic messages with width-aware rendering
- Reusable custom themes (`acidbath`, `acidbath-cyberdyne-teal`)
- Bundled AGY research tools from [`ameno-/pi-research`](https://github.com/ameno-/pi-research): `agy_web_search` and `agy_research`
- Explicit [`pi-web-access`](https://github.com/nicobailon/pi-web-access) capability: `web_search`, `fetch_content`, `get_search_content`, and `source_check` for pages, PDFs, video, GitHub, and evidence retrieval
- `compactor` extension: post-processes `bash` results, compacting large structured data (JSON/CSV/TSV/NDJSON over 2KB) to a 20-row preview and saving the full output to `/tmp/compact_data/` for nushell querying. Never touches `read`/`ls` results, code, or logs. Validated at 37.2% token savings on SWE-bench (100% pass rate) in [`nushell-agent-runtime`](https://github.com/ameno-/nushell-agent-runtime).

#### Compactor configuration

| Env var | Default | Purpose |
|---|---|---|
| `PI_ACIDBATH_COMPACTOR_DISABLE` | unset | Set to `1` to disable compaction entirely |
| `PI_ACIDBATH_COMPACTOR_DEBUG` | unset | Set to `1` for stderr debug logging |
| `PI_ACIDBATH_COMPACTOR_THRESHOLD` | `2048` | Minimum output size in bytes before compaction is considered |
| `PI_ACIDBATH_COMPACTOR_PREVIEW_ROWS` | `20` | Rows kept in the inline preview |
| `PI_ACIDBATH_COMPACTOR_DATA_DIR` | `/tmp/compact_data` | Where full outputs are saved for nushell querying |
| `PI_ACIDBATH_NU_BIN` | auto-detect | Path to the nushell binary (default: `~/.local/bin/nu`, then `PATH`) |

Requires nushell; without it the compactor is a silent no-op.

## Skills

Acidbath ships two package skills (`hunk-review`, `acidbath-operator`).
Shared operator skills live in [`ameno-/lib`](https://github.com/ameno-/lib)
and are not vendored here. See [`docs/host-skill-bridge.md`](docs/host-skill-bridge.md).

## Install (local dev)

```bash
pi install /home/donatello/dev/pi-acidbath
```

This writes the package path into `~/.pi/agent/settings.json` so it loads in all global Pi sessions.

## Configure

Set your theme in `~/.pi/agent/settings.json`:

```json
{
  "theme": "acidbath"
}
```

The input prompt uses `╰─› ` on the first line and `│  ` on wrapped lines so
arrows do not multiply vertically. Fonts are controlled by the terminal, not
by Pi extensions; select Iosevka in your terminal profile if desired. See
`docs/input-cursor-options.md` for alternatives.

Optional environment toggle:

- `PI_ACIDBATH_REDUCED_MOTION=1` — disable the activity rail pulse.

## Commands

- `/status-timings [show|reset]` — inspect measured event-to-event state dwell times
- `/preflight` — show startup metadata and rerun checks
- `/acidbath-update` — with confirmation, run `pi update --extensions` then `pi update`
- `/agy-setup` — explicitly configure AGY headless permissions

## Publish to npm

1. Update `name`/`version` in `package.json`.
2. Login and publish:

```bash
npm login
npm publish --access public
```

3. Install from npm on any machine:

```bash
pi install npm:acidbath@0.1.0
```

## Reuse config and keymaps

- Settings template: `config/settings.global.example.json`
- Keybindings template: `config/keybindings.example.json`
- Themes: `themes/acidbath.json`, `themes/acidbath-cyberdyne-teal.json`

The startup header is implemented locally in `extensions/acidbath/ui-header.ts`: it renders a large centered `ACIDBATH` wordmark, derives a smooth gradient from the active theme's `accent` color, clips safely to narrow terminals, and falls back to plain text when `NO_COLOR` is set. The above-editor welcome is intentionally transient: it shows cwd, a native-cost model card with thinking level, compact preflight status, and one centered yellow Stoic message with its author, then dismisses before the first agent turn. Updates are opt-in through `/acidbath-update`; Acidbath never updates Pi automatically. `pi-research` and `pi-web-access` are loaded as first-party package capabilities. AGY can operate without direct extraction tools, while the primary Pi can follow research URLs with `fetch_content` and `source_check`. AGY still requires a locally authenticated CLI; Acidbath never installs AGY or silently grants `command(*)` permissions. Use `/agy-setup` only after reviewing and explicitly confirming that permission change. The footer owns identity, branch, context, and token usage; the activity rail is the only animated lifecycle surface. Tool rows are renderer-only: external tools and Herdr/shell actions are not intercepted or executed, while completed built-in results remain in Pi's native transcript. Acidbath preserves Pi's current tool-expansion preference rather than forcing large native results open on every render.
