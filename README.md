# acidbath

Standalone Pi package containing UI-focused enhancements extracted from `pi-herdr`:

- Semantic working orb (`/orb`)
- Deterministic built-in tool lifecycle motion (`/motion`)
- Context-usage editor gauge
- Reusable custom theme (`ameno-cyberdyne-teal`)

## Install (local dev)

```bash
pi install /Users/ameno/dev/acidbath
```

This writes the package path into `~/.pi/agent/settings.json` so it loads in all global Pi sessions.

## Configure

Set your theme in `~/.pi/agent/settings.json`:

```json
{
  "theme": "ameno-cyberdyne-teal"
}
```

Optional environment toggles:

- `PI_ACIDBATH_REDUCED_MOTION=1` — freeze motion to representative frames.
- `PI_ACIDBATH_MOTION_PHASE=0..3` — pin tool pending animation to a fixed phase.

## Commands

- `/orb [auto|working|searching|solving|listening|composing|shaping|off|default]`
- `/motion [live|0|1|2|3]`

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
- Theme: `themes/ameno-cyberdyne-teal.json`

Copy/adapt these into `~/.pi/agent/settings.json` and `~/.pi/agent/keybindings.json`.
