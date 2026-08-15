---
name: acidbath-operator
description: Operate Acidbath as the personal Pi development and delegation system on this machine. Use when installing Acidbath, migrating off the old global Pi session, enabling dormant skills, launching delegates, or deciding what belongs in the package versus lib versus this host.
---

# Acidbath operator

Acidbath is the **personal development tool** for this machine. The TUI is
the visible layer. Under it, Acidbath is the composition surface for
coding, review, research, and bounded delegation.

It is not "just a UI library." UI is what shipped first. Delegation,
skill topology, and host integration are the product.

## What Acidbath is

| Layer | Role |
| ----- | ---- |
| Presentation | Header, footer, activity rail, built-in tool rows, themes |
| Research | Bundled `pi-research` (AGY) + explicit `pi-web-access` |
| Delegation | Herdr / `herdr-subagents` / `pi-messenger` — bounded workers, not nested fan-out |
| Skills | Curated roster. Package skills + lib operator skills + host skills |
| Gateway | VPS LiteLLM via `agent-proxyctl sync --client pi-default` |

Acidbath does **not** own Herdr PTYs, LiteLLM, or the `lib` catalog. It
composes them.

## This machine is the home system

`donatello-svr` is the infrastructure host. Migrate **to** Acidbath here
instead of growing the old global Pi session (`~/.pi/agent/skills` dump +
ad-hoc extensions).

Old session (being replaced as the default):

- packages: screenshots, interactive-shell, session-replay, damage-control,
  tool-status, handoff, pi-messenger, ask-user-question, pi-web-access, sideshow
- skills actually listed: `safe-bash`, `interactive-shell`, `nomfeed`,
  `hermes-dispatch`
- ~23 other skills on disk were dormant (not in the settings roster)

New default: install this package, keep global discovery blocked, load an
**explicit** development roster.

## Install / migrate on this host

```bash
cp -a ~/.pi/agent/settings.json ~/.pi/agent/settings.json.bak-$(date +%Y%m%d)
pi install /home/donatello/dev/pi-acidbath
```

Then keep `skills` as an explicit list (see
`config/settings.global.example.json`). Do not remove `!skills/**` and
hope the whole `~/.pi/agent/skills` tree is "the system."

Restart Pi after install. Confirm `/preflight` and that package skills
`hunk-review` + `acidbath-operator` loaded.

## Default development roster

Always-on for day-to-day coding on this host:

| Skill | Source | Why |
| ----- | ------ | --- |
| `acidbath-operator` | this package | how to run the system |
| `hunk-review` | this package | live diff review via Hunk |
| `safe-bash` | host | shell discipline |
| `interactive-shell` | host / npm | long-running / delegated CLIs |
| `typescript` | host | TS/JS implementation |
| `code-review` | host | review checklist |
| `plan-check` | host | plan gate before execution |
| `lockin-workflow` | host | scout → plan → execute |
| `session-completion` | host | beads/git handoff |
| `gotem` | host | save/search personal library |
| `the-library` | host | runbooks + personal repos |
| `nomfeed` | host | URL/file → markdown library |
| `hermes-dispatch` | host | VPS Hermes jobs |
| `coding-gateway-control` | `~/dev/lib` | LiteLLM / gateway ops |
| `agent-proxy-sync` | `~/dev/lib` | regenerate Pi/Droids configs |
| `pi-messenger-crew` | pi-messenger ext | multi-agent crew on this host |

## Dormant on purpose (enable only when the task needs them)

Do not put these in the default roster. They explode context or are
narrow:

| Skill | When to enable |
| ----- | -------------- |
| `bowser` | headless browser / screenshots |
| `wrangler`, `workers-best-practices`, `cloudflare-*` | CF Workers / One |
| `email` | Himalaya / Gmail |
| `minimax-mcp` | MiniMax image/search MCP (extension already exists) |
| `custom-pi-agent` | writing a new Pi SDK agent |
| `architectural-decision-records` | new ADR |
| `puffy-skill-manager` | publishing skills into lib |
| `agent-metrics`, `pi-pi`, `codex-cli`, `qmd-knowledge` | specialized |
| `firecracker-vm` | parked Firecracker tool-relay; restore from `~/.pi/agent/extensions-archive/20260815/firecracker-vm` |

To enable one for a session, add a `+skills/<name>/SKILL.md` line or pass
`--skill` on the launcher. Do not flip the global blocklist off.

## Delegation rules

- Prefer one visible Acidbath parent + bounded workers (Herdr / messenger).
- No nested worker fan-out.
- Explicit worktrees / file reservations.
- Research stays behind `pi-research` + `pi-web-access` (already in the
  package). Do not silently grant AGY `command(*)`.
- Do not load `pi-subagents`, `pi-lens`, or telemetry-bearing Codex
  packages in the default composition.


## Skill catalog (thin core, pull the rest)

Do **not** bake the library into Acidbath. Install `ameno-/lib` on the
machine. Acidbath only ships a **manifest**:

- `config/skill-catalog.json` — default vs on-demand vs archived
- `/skills list` — Acidbath default + on-demand catalog
- `/skills scan [query]` — local scan of the installed library map
- `/skills pull <name>` — print the path and relaunch flag
- Map: `~/dev/lib/MAP.md`  Scanner: `library-access`

Cloudflare (`wrangler`, `workers-best-practices`, `cloudflare-one`,
`cloudflare-email-service`) stays on-demand. Enable when the directory
is a Worker / Zero Trust tree, not in every coding session.

Host skills archived 2026-08-15 live in
`~/.pi/agent/skills-archive/20260815/` (metrics, bowser, email, UX trio,
broken `qmd-knowledge`, etc.). Restore one file if needed; do not dump
the archive back onto the default path.

## Gateway

Models still come from VPS LiteLLM:

```bash
agent-proxyctl sync --client pi-default
```

Then restart Pi. Client name is `pi-default` on this host **and** the Mac.

## Drift rules

- New **UI / composition** behavior → this repo.
- New **reusable skill** → `~/dev/lib/skills` + registry `pi` target.
- New **host-only** skill → `~/.pi/agent/skills`, then add to the explicit
  roster only if it should be default.
- New **gateway/model** behavior → LiteLLM + agent-proxy control plane.

Do not grow the old global Pi session as a second product.
