# acidbath

Standalone Pi package containing UI-focused enhancements extracted from `pi-herdr`:

- Semantic working orb (`/orb`) plus a reviewed cross-song Roc Marciano / Stove God Cooks playlist in a fixed-width footer slot beside `ctx`
- Dynamic ten-word session summary pinned to the active Pi header
- Deterministic built-in tool lifecycle motion (`/motion`) with keyed compact rows in Pi's native transcript
- State-driven lyric changes with fixed behavior tags (`listening`, `searching`, `writing`, `running`, etc.): rapid hooks remain a restrained glitch bridge, while longer states settle to complete phrases without moving `ctx`
- Footer identity rail: gray working directory, red model name, and the current Git branch in place of the less-actionable thinking label
- Welcome-only Stoic quote card plus a native-cost model card showing model name, input/output price per million tokens, and thinking level; spend tiers use green/blue/red
- Borderless editor with fixed-width semantic orb frames and a light right-side context rail (`/context`)
- Pure token/context lifecycle reducer with truthful unknown/final usage formatting
- Centered, large theme-aware `ACIDBATH` wordmark startup header
- Transient above-editor welcome metadata and preflight checks (cwd, model, and tools)
- Backgrounded agent-output provenance banners with local timestamp and the prompt that triggered each run
- Curated attributed Stoic messages with width-aware rendering
- Reusable custom themes (`acidbath`, `acidbath-cyberdyne-teal`)
- Bundled AGY research tools from [`ameno-/pi-research`](https://github.com/ameno-/pi-research): `agy_web_search` and `agy_research`
- Explicit [`pi-web-access`](https://github.com/nicobailon/pi-web-access) capability: `web_search`, `fetch_content`, `get_search_content`, and `source_check` for pages, PDFs, video, GitHub, and evidence retrieval

## Install (local dev)

```bash
pi install /Users/ameno/dev/acidbath
```

This writes the package path into `~/.pi/agent/settings.json` so it loads in all global Pi sessions.

## Configure

Set your theme in `~/.pi/agent/settings.json`:

```json
{
  "theme": "acidbath"
}
```

Optional environment toggles:

- `PI_ACIDBATH_REDUCED_MOTION=1` — freeze motion to representative frames (including the working lyric rail).
- `PI_ACIDBATH_MOTION_PHASE=0..3` — pin the shared editor/tool pending animation to a fixed phase.
- `PI_ACIDBATH_CONTEXT=right|above|below|off` — choose context placement (default: `right`).
- `PI_OFFLINE=1` — required when the approved `pi-ast-grep` package is loaded; disables its last-resort executable download.

## Commands

- `/orb [auto|working|searching|solving|listening|composing|shaping|off|default]`
- `/motion [live|0|1|2|3]`
- `/context [right|above|below|off]`
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

The startup header is implemented locally in `extensions/acidbath/ui-header.ts`: it renders a large centered `ACIDBATH` wordmark, derives a smooth gradient from the active theme's `accent` color, clips safely to narrow terminals, and falls back to plain text when `NO_COLOR` is set. The above-editor welcome is intentionally transient: it shows cwd, a native-cost model card with thinking level, compact preflight status, and one centered yellow Stoic message with its author, then dismisses before the first agent turn. Updates are opt-in through `/acidbath-update`; Acidbath never updates Pi automatically. `pi-research` is bundled and loaded as a first-party core capability at a pinned upstream commit. `pi-web-access` is loaded explicitly from the same package and supplies direct extraction/evidence tools; AGY can operate without those tools, while the primary Pi can follow research URLs with `fetch_content` and `source_check`. AGY still requires a locally authenticated CLI; Acidbath never installs AGY or silently grants `command(*)` permissions. Use `/agy-setup` only after reviewing and explicitly confirming that permission change. The default footer rail is width-safe and intentionally omits a duplicate numeric percentage; known context/turn facts remain available in the formatter and expanded context views. Tool rows are renderer-only: external tools and Herdr/shell actions are not intercepted or executed, while completed built-in results remain in Pi's native transcript. Copy/adapt these into `~/.pi/agent/settings.json` and `~/.pi/agent/keybindings.json`.
