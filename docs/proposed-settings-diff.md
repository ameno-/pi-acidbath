# Proposed Pi settings diff

Status: The dead-entry/visual-explainer diff below was approved and applied.
The file remains here as an audit record; it is not an executable config.
An approved ast-grep package entry was added afterward (see below).

Source reviewed: `/Users/ameno/.pi/agent/settings.json` on 2026-08-06.
The existing global discovery controls are intentionally preserved:

```json
"extensions": ["!extensions/**"],
"skills": [
  "!skills/**",
  "+skills/agent-browser/SKILL.md",
  "+skills/gotem/SKILL.md",
  "+skills/herdr/SKILL.md",
  "+skills/mmx-cli/SKILL.md",
  "+skills/react-native-dev/SKILL.md"
],
"prompts": ["!prompts/**"]
```

## Proposed unified diff

```diff
--- /Users/ameno/.pi/agent/settings.json
+++ /Users/ameno/.pi/agent/settings.json (proposed)
@@
   "packages": [
-    {
-      "source": "npm:pi-screenshots-picker@1.2.2",
-      "extensions": []
-    },
     "npm:pi-interactive-shell@0.14.0",
-    {
-      "source": "/Users/ameno/dev/pi-minimax-mcp",
-      "extensions": []
-    },
-    {
-      "source": "~/.pi/agent/extensions/session-replay",
-      "extensions": []
-    },
-    {
-      "source": "~/.pi/agent/extensions/damage-control",
-      "extensions": []
-    },
-    {
-      "source": "~/.pi/agent/extensions/tool-status",
-      "extensions": []
-    },
-    {
-      "source": "/Users/ameno/dev/pi-ext/.pi/council",
-      "extensions": []
-    },
     {
-      "source": "https://github.com/nicobailon/visual-explainer@528b71f",
-      "extensions": [],
-      "skills": [],
-      "prompts": []
+      "source": "https://github.com/nicobailon/visual-explainer@528b71f"
     },
-    {
-      "source": "npm:@plannotator/pi-extension@0.25.0",
-      "extensions": []
-    },
-    {
-      "source": "https://github.com/eko24ive/pi-ask@2bba854",
-      "skills": []
-    },
     "../../dev/acidbath"
   ],
```

This removes exactly eight dead/filtered package entries:

- `npm:pi-screenshots-picker@1.2.2`
- `/Users/ameno/dev/pi-minimax-mcp`
- `~/.pi/agent/extensions/session-replay`
- `~/.pi/agent/extensions/damage-control`
- `~/.pi/agent/extensions/tool-status`
- `/Users/ameno/dev/pi-ext/.pi/council`
- `npm:@plannotator/pi-extension@0.25.0`
- `https://github.com/eko24ive/pi-ask@2bba854`

## Why the visual-explainer change is sufficient

The local Pi package cache contains the requested revision:

- Checkout: `/Users/ameno/.pi/agent/git/github.com/nicobailon/visual-explainer`
- `HEAD`: `528b71feb85dab5d92b82c3554880826f50a75da`
- Manifest: `package.json`

That manifest declares these real surfaces:

```json
"extensions": ["./plugins/visual-explainer/extension.ts"],
"skills": ["./plugins/visual-explainer"],
"prompts": ["./plugins/visual-explainer/commands"]
```

The empty arrays in the current settings object are an explicit per-package
surface filter, so they suppress all three declared surfaces. Removing the
arrays lets Pi use the package manifest. This does **not** weaken the global
`!extensions/**`, `!skills/**`, or `!prompts/**` rules: those rules apply to
roots under `~/.pi/agent`, while this package is loaded from Pi's git cache.

## Approved follow-up: ast-grep package entry

After the diff above, the approved ast-grep candidate was added as a pinned
package entry:

```json
{
  "source": "git+https://github.com/code-yeongyu/pi-ast-grep.git#4a7d1beee684d96a6890e5fc55710bb63fecca85"
}
```

This entry is only safe when Pi is launched with `PI_OFFLINE=1`; that
environment control prevents the extension's last-resort GitHub binary
auto-download. The `sg` binary was installed separately with
`cargo install ast-grep --locked` (0.45.0). The Pi launch environment must
still expose `/Users/ameno/.cargo/bin` on `PATH` (or provide the paired
`/opt/homebrew/bin/ast-grep` and `/opt/homebrew/bin/sg` links) before using
the extension.

## Apply/verify procedure (historical)

1. Back up the settings file using the user's normal settings workflow.
2. Apply only the diff above; do not alter blocklists or unrelated settings.
3. Restart/reload Pi so package discovery runs again.
4. Verify the visual-explainer extension, skill, and command prompts are
   discovered, and verify the eight removed entries are absent.
5. If discovery fails, restore the backup. Do not compensate by removing a
   blocklist or adding global skill/extension paths.
