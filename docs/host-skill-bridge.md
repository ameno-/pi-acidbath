# Host skill bridge (donatello-svr, 2026-08-14)

Status: **applied locally**. Acidbath is the personal development/
delegation system on donatello-svr, not a UI-only package.
Does not reorganize `ameno-/lib`.

## Problem

This machine has a large, useful Pi skill tree (`~/.pi/agent/skills`) and a
new operator kit in `agent-proxy`. Acidbath's published package had no
skills. `lib` had no `pi` platform. The Mac-oriented Acidbath docs still
pointed at `/Users/ameno/...`.

## Contract (unchanged)

- Canonical shared skills: `~/dev/lib/skills`
- Acidbath does not author a second skill tree
- Do not farm symlinks into `~/.pi/agent/skills`
- Host-only skills stay on the host

## What landed

1. `lib` gained a `pi` platform (no install root) and three skills:
   `hunk-review`, `coding-gateway-control`, `agent-proxy-sync`.
2. Acidbath ships two **portable** package skills via `pi.skills`:
   `hunk-review`, `acidbath-operator`.
3. `config/settings.global.example.json` uses this host's paths and
   optionally loads the two lib operator skills without unblocking the
   whole global skill directory.

## Not done

- Full `scripts/skills build` `dist/pi` mirror (library is too messy to
  rebuild end-to-end in this pass)
- Dumping every `~/.pi/agent/skills/*` entry into Acidbath
- Changing live `~/.pi/agent/settings.json` automatically
