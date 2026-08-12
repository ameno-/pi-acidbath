# acidbath

Standalone Pi package containing UI-focused enhancements extracted from `pi-herdr`:

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
