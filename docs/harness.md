# Acidbath harness

Non-visual Pi extension at `extensions/harness/`. Acidbath keeps UI ownership.
The bash-result `compactor` extension stays independent.

Tracked as Beads `acidbath-9ih` / Linear [MIGHT-493](https://linear.app/acids/issue/MIGHT-493/acidbath-integrate-omp-inspired-harness-capabilities).

## Commands

| Command | Purpose |
|---|---|
| `/handoff [goal]` | Generate a structured handoff, edit it, open a child session. Never auto-submit. |
| `/recap [focus]` | Persist a custom session entry (not LLM context). |
| `/role [list\|set <alias>\|clear\|resolve <alias>]` | Explicit model/thinking/tool routing with visible fallback. |
| `/magic [list\|enable <id>\|disable <id>]` | Exact-prose keyword notices. |
| `/agents [list\|run <name> <task>]` | Core subagent substrate, no delegation policy. |

## Tool

- `subagent` — bounded isolated Pi SDK session. Parallel only when explicitly requested. No nested fan-out by default.

## Config

- `config/roles.example.json` — role aliases and fallback chain. Override with `PI_ACIDBATH_ROLES_PATH`.
- `config/magic.example.json` — keyword table. Override with `PI_ACIDBATH_MAGIC_PATH`.
- `config/agents.example.json` — agent profiles and concurrency ceiling. Override with `PI_ACIDBATH_AGENTS_PATH`.
- `PI_ACIDBATH_CODEX_COMPACT=1` — opt-in Codex-session compaction via `modelRegistry.complete` and native fallback.

## Tests

Run with Node 22 or 24 (`--experimental-strip-types`). System Node 20 is insufficient.

## ADRs

`docs/decisions/adr-0001.md` through `adr-0006.md`.
