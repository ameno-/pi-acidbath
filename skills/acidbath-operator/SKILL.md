---
name: acidbath-operator
description: Operate Acidbath as a Pi UI package on top of this machine's coding-gateway control plane. Use when installing Acidbath, choosing which skills load, syncing Pi models, or deciding what belongs in the published package versus lib.
---

# Acidbath operator

Acidbath is a **Pi UI package**. It is not the skill library and it is not
the live model gateway.

## Ownership

| Layer | Owner | What belongs here |
| ----- | ----- | ----------------- |
| UI / TUI | this package (`extensions/`, `themes/`) | header, footer, activity rail, tool rows |
| Shared skills | `ameno-/lib` (`~/dev/lib/skills`) | hunk-review, coding-gateway-control, agent-proxy-sync, plus the rest of the catalog |
| Live models | VPS LiteLLM + `agent-proxyctl sync` | catalogs, virtual keys, ChatGPT/Copilot auth |
| Host-only skills | this machine (`~/.pi/agent/skills`) | nomfeed, gotem, wrangler, email — do not publish |

Do **not** vendor `~/dev/lib/skills` into the npm package. Do **not**
symlink skills into `~/.pi/agent/skills` from Acidbath. Package-relative
`pi.skills` entries are the scoped surface.

## First-party skills in this package

- `hunk-review` — live Hunk session control
- `acidbath-operator` — this file

Host operator skills stay in lib:

- `coding-gateway-control`
- `agent-proxy-sync`

On a machine that has `~/dev/lib`, load those via the lib tree or a
generated `dist/pi/skills` view. On a machine that does not, skip them.

## This host (donatello-svr)

1. Install the local package: `pi install /home/donatello/dev/pi-acidbath`
2. Keep global discovery tight. Prefer package skills over dumping the
   whole `~/.pi/agent/skills` tree into every session.
3. After LiteLLM catalog or key changes: `agent-proxyctl sync --client pi-default`
4. Theme: `acidbath` or `acidbath-cyberdyne-teal` (this host currently uses
   `ameno-cyberdyne-teal` — either is fine).

## Drift rules

- New reusable skill → author in `~/dev/lib/skills`, register in
  `registry.yaml` with `pi` in `build_targets` if Pi should see it.
- New Acidbath UI behavior → this repo only.
- New gateway/model behavior → LiteLLM + agent-proxy control plane, not
  Acidbath.
