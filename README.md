# acidbath

Standalone Pi package containing UI-focused enhancements extracted from `pi-herdr`:

- Semantic working orb (`/orb`)
- Dynamic ten-word session summary pinned to the active Pi header
- Deterministic built-in tool lifecycle motion (`/motion`) with keyed compact rows and a transcript-ordered activity block
- Borderless editor with fixed-width semantic orb frames and a light right-side context rail (`/context`)
- Pure token/context lifecycle reducer with truthful unknown/final usage formatting
- Reusable custom themes (`acidbath`, `acidbath-cyberdyne-teal`)
- Bundled AGY research tools from [`ameno-/pi-research`](https://github.com/ameno-/pi-research): `agy_web_search` and `agy_research`

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

- `PI_ACIDBATH_REDUCED_MOTION=1` — freeze motion to representative frames.
- `PI_ACIDBATH_MOTION_PHASE=0..3` — pin the shared editor/tool pending animation to a fixed phase.
- `PI_ACIDBATH_CONTEXT=right|above|below|off` — choose context placement (default: `right`).
- `PI_OFFLINE=1` — required when the approved `pi-ast-grep` package is loaded; disables its last-resort executable download.

## Commands

- `/orb [auto|working|searching|solving|listening|composing|shaping|off|default]`
- `/motion [live|0|1|2|3]`
- `/context [right|above|below|off]`
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

The header is always labeled `acidbath` and uses the theme's `borderAccent` color; the bundled `acidbath` theme gives it a distinct purple accent. `pi-research` is bundled and loaded as a first-party core capability at a pinned upstream commit. It still requires a locally authenticated AGY CLI; Acidbath never installs AGY or silently grants `command(*)` permissions. Use `/agy-setup` only after reviewing and explicitly confirming that permission change. The default footer rail is width-safe and intentionally omits a duplicate numeric percentage; known context/turn facts remain available in the formatter and expanded context views. Tool rows are renderer-only: external tools and Herdr/shell actions are not intercepted or executed. Copy/adapt these into `~/.pi/agent/settings.json` and `~/.pi/agent/keybindings.json`.
