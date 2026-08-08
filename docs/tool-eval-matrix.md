# Acidbath — Tool Evaluation Scored Matrix

> Status: first-pass scored matrix only. No `measure.sh` objective
> benchmarks yet (deferred per PLAN.md §3/§0 round-2 decision 4).
> All scores are 1–5 (5 = best). Each cell is cited to a file path
> or URL, OR labeled as an **assumption**.
>
> Scope: tools currently named for adoption in PLAN.md §0/§3, plus
> the ast-grep candidate from workstream C.

## Scoring legend

| Column | What 5 means | What 1 means |
|---|---|---|
| **Compat** | Matches acidbath's runtime exactly (`@earendil-works/pi-*`); loads under acidbath's peer-dep tree today. | Mismatched namespace, runtime, or build target — would not load. |
| **Maintenance** | Daily activity, multiple contributors, recent releases, CI. | Stale (>12mo), single-author, no CI. |
| **License** | MIT / Apache-2.0 / BSD compatible with acidbath (MIT). | Copyleft (GPL/AGPL) or unknown. |
| **Security** | No network beyond documented, no auto-download without checksum, no `postinstall`, no telemetry, small transitive dep graph. | Auto-downloads executables, runs `postinstall`, calls home, or has heavy transitive deps. |
| **Perf** | Sub-millisecond tool render, no leaked timers, ≤ 1 setWorkingMessage per 100ms, no fan-out unless scoped. | Heavy LSP server management, fan-out, timers, network on every call. |
| **Op-risk** | Cleanly disable-able per profile; rollback is removing one entry from `packages`. | Hard to disable, requires re-vendoring, collides with acidbath surfaces. |

Aggregate **∑** is a rough weighting (Compat + Maintenance + License +
Security + Perf + Op-risk). The aggregate is **directional, not
prescriptive** — a single 1 in Security should override a high
aggregate. Read each cell, not the number.

---

## Scored matrix

| # | Tool | Compat | Maint. | License | Security | Perf | Op-risk | ∑ | Decision | Evidence |
|---|---|---:|---:|---:|---:|---:|---:|---:|---|---|
| 1 | **acidbath** (umbrella) | 5 | 4 | 5 (MIT) | 5 | 5 | 5 | 29 | **Adopt (current)** | `/Users/ameno/dev/acidbath/package.json`; `extensions/acidbath/index.ts` |
| 2 | **pi-subagents** (`nicobailon/pi-subagents`) | 5 (`@earendil-works`) | 5 (daily, 2.9k★) | 5 (MIT) | 4 (`subagent_wait` register; 0 collisions with acidbath) | 4 (fan-out cost) | 3 (cmd-name audit needed; see PLAN §3 row) | 26 | **Adopt (P3)** | PLAN.md §3; `https://github.com/nicobailon/pi-subagents` |
| 3 | **pi-codex-compaction** (`jvm/pi-codex-compaction`) | 4 (`@earendil-works` assumed; verify) | 4 (daily, 14★) | 5 (MIT) | 4 | 5 (compaction-time only) | 2 (endpoint-mismatch fallback) | 24 | **Adopt (P2)** | PLAN.md §3 |
| 4 | **pi-codex-tools** (`jvm/pi-codex-tools`) | 4 | 4 (daily, 14★) | 4 (Apache-2.0) | 4 | 4 (streaming diff preview) | 3 (`apply_patch` Linux-only, auto-disable on macOS) | 23 | **Adopt pattern + tool (P2)** | PLAN.md §3 |
| 5 | **pix-bash pattern** (`xynogen/pix-bash`) | 4 (pix-mono runtime; pattern only) | 4 (daily, 44★) | 5 (MIT) | 4 | 5 (single render pass, 1 timer/completed call) | 3 (timer mgmt for collapse) | 25 | **Adopt pattern (P2)** — reimplement framed output + collapse in acidbath wrappers | PLAN.md §3 |
| 6 | **pi-lens** (`apmantza/pi-lens`) | 5 | 5 (daily, 312★, 3.3k commits) | 5 (MIT) | 3 (LSP server spawn) | 3 (heavy server management) | 3 (gated to debug profile only) | 24 | **Adopt (P3, debug-scoped)** | PLAN.md §3; gated by `PI_ACIDBATH_PROFILE=debug` |
| 7 | **visual-explainer** (`nicobailon/visual-explainer@528b71f`) | 3 (currently filtered — see op-risk) | 3 (2mo stale, 9.4k★) | 5 (MIT) | 4 | 4 | 2 (filtered in current settings — needs unblock) | 21 | **Adopt now (P1)** — unblock via settings diff | PLAN.md §3; `~/.pi/agent/settings.json` filtered |
| 8 | **pi-ast-grep (code-yeongyu)** | 5 (matches `@earendil-works/pi-*` exactly) | 3 (24 commits, 14★, last touched 2026-06-05) | 5 (MIT) | 3 (raw network download possible without C2; mitigated by controls) | 4 (single `sg` spawn per call, argv-only) | 3 (requires controls C1-C5) | 23 | **Adopt (P3) with controls C1-C5** | `docs/ast-grep-security-review.md` |
| 9 | **pi-ast-grep (bjoernaagaard)** | 5 | 2 (8 commits, 0★, single author, last publish hours ago) | 5 (Apache-2.0) | 5 (no auto-download, no transitive deps, uses `pi.exec`) | 4 | 5 (honors `AST_GREP_BIN`) | 26 | **Defer as fallback** | `docs/ast-grep-security-review.md` |
| 10 | **pi-autoresearch** (`davebcn87/pi-autoresearch`) | 4 (verify) | 4 (monthly, 7.5k★) | 5 (MIT) | 4 | 4 (loop is metered, has `maxIterations`) | 3 (cost runaway mitigated by `maxIterations` + API key limits) | 24 | **Adopt (P4)** — eval loop harness | PLAN.md §3 |
| 11 | **pi-minimax-mcp** | 1 (peer-dep namespace mismatch `@mariozechner/pi-*` vs `@earendil-works/pi-*`) | 2 | 4 | 4 | 4 | 1 (cannot load without namespace migration) | 16 | **Defer** — needs `@mariozechner→@earendil-works` migration to join umbrella | PLAN.md §3 |
| 12 | **pi-screenshots-picker** (`npm:pi-screenshots-picker@1.2.2`) | 2 (filtered; empty `extensions:[]` in settings) | 2 | 4 | 4 | 4 | 2 (declares empty surfaces — never loaded) | 18 | **Drop from packages** — dead entry | `~/.pi/agent/settings.json` |
| 13 | **@plannotator/pi-extension** | 2 (filtered; not inspected) | 2 | 4 | 4 | 4 | 2 (status unknown) | 18 | **Drop from packages** — dead entry | `~/.pi/agent/settings.json` |
| 14 | **pi-ask** (`eko24ive/pi-ask`) | 2 (filtered; not inspected, has skill manifest) | 2 | 4 | 4 | 4 | 2 | 18 | **Drop from packages** — dead entry | `~/.pi/agent/settings.json` |
| 15 | **session-replay** | 1 (under `!extensions/**` blocklist; cannot load) | 2 | 4 | 4 | 4 | 1 | 16 | **Drop from packages** — dead entry (blocklist + global shadow) | `~/.pi/agent/settings.json`; `~/.pi/agent/extensions/session-replay/package.json` |
| 16 | **damage-control** | 1 (under `!extensions/**` blocklist) | 2 | 4 | 4 | 4 | 1 | 16 | **Drop from packages** — dead entry | same |
| 17 | **tool-status** | 1 (under blocklist + `tool-status.ts` file is missing — only `package.json` exists) | 2 | 4 | 4 | 4 | 1 | 16 | **Drop from packages** — broken + dead entry | `~/.pi/agent/extensions/tool-status/` (only `package.json`, no `tool-status.ts`) |
| 18 | **council** (`pi-ext/.pi/council`) | 1 (malformed manifest: `pi.extensions: ["extensions"]` — bare string, no `./` or `.ts`) | 2 | 4 | 4 | 4 | 1 | 16 | **Drop from packages** — broken manifest | `/Users/ameno/dev/pi-ext/.pi/council/package.json` (line 7: `"extensions": ["extensions"]`) |
| 19 | **oh-my-pi built-in `ast-grep.ts`** | 1 (runtime scope mismatch: imports 7 `@oh-my-pi/*` packages; would drag in parallel peer-dep tree) | 5 (daily) | 5 (MIT) | 5 (in-process Rust binding) | 5 | 1 (rejected: pulls in second pi-coding-agent host) | 22 | **Reject** | `docs/ast-grep-security-review.md` |
| 20 | **metaharness** (`can1357/oh-my-pi/metaharness`) | 4 (study only, not depend) | 5 (weekly) | 5 (MIT) | 4 | 5 (containerized) | 4 (don't depend; borrow the model) | 27 | **Study (P4)** | PLAN.md §3 |
| 21 | **my-pi-setup** (`davis7dotsh/my-pi-setup`) | 3 (study pattern only) | 4 (weekly) | 4 (no license in repo header — verify) | 3 | 3 | 3 | 20 | **Study (P4)** — sandbox pattern + cross-harness subagent skill | PLAN.md §3 |
| 22 | **pi-herdr-ui** (heritage) | 1 (collides on `/orb`, `/motion`, gauge) | 2 | 4 | 4 | 4 | 1 (HIGH: collision risk) | 16 | **Reject** | PLAN.md §1 finding 1; "do not bring `pi-herdr-ui.ts` into acidbath" |
| 23 | **agy** (from pi-herdr) | 3 (separate companion pane only; not in main session) | 2 | 4 | 4 | 3 | 2 (superseded by pi-subagents + your agent-delegation system) | 18 | **Reject (don't use directly)** — superseded | PLAN.md §0 round-2 decision 1 |
| 24 | **research-bridge** (from pi-herdr) | 1 (depends on agy master pane — cannot stand alone) | 2 | 4 | 4 | 3 | 1 | 15 | **Drop** — depends on dropped surface | PLAN.md §0 round-2 decision 1 |
| 25 | **web_search tool** | 1 (orphan — not a verified Pi built-in) | 2 | 4 | 4 | 4 | 1 | 16 | **Drop** — web work via `agent-browser` skill + `pi-subagents` researcher | PLAN.md §0 round-2 decision 2 |
| 26 | **pi-interactive-shell** (`npm:pi-interactive-shell@0.14.0`) | 5 (loaded) | 3 | 4 | 4 | 4 | 4 | 24 | **Keep** — already active | `~/.pi/agent/settings.json` |
| 27 | **pi-research** (`ameno-/pi-research`) | 5 (native Pi extension) | 3 (new/single-author surface; verify cadence) | 5 (MIT) | 1 (`--dangerously-skip-permissions` + `command(*)`) | 3 (5m10s external process; streamed updates) | 2 (global setup/settings edits; opt-in only) | 19 | **Study/opt-in** — do not add to default packages until controls land | `docs/pi-research-evaluation.md`; `eb3de4e` |

---

## Per-tool deep-dive (Security column)

The Security column is the load-bearing one for this matrix. Below
are the explicit checks for each adopted or candidate tool, with
evidence.

### 1. acidbath (current)

- Network: none. No `fetch`, no `https.request`, no `child_process.spawn` (other than Pi's own TUI work). `grep -rn "fetch\|http" extensions/acidbath/*.ts` returns 0 hits.
- `postinstall`: none — `package.json` has no `scripts` block.
- Telemetry: none.
- Transitive deps: 0. Peer deps only (`@earendil-works/*`, `typebox`).
- Binary download: none.

### 2. pi-subagents

- Network: scoped to the model provider via Pi's own transport (no extension-level fetch).
- `postinstall`: **verify** — not inspected this pass; out of scope.
- Telemetry: not observed in PLAN.md evidence.
- Transitive deps: TBD (npm install on adoption).

### 3. pi-codex-compaction

- Same model-provider-only network path; compaction-time only.
- `postinstall`: **verify** before adoption.
- Telemetry: not observed.

### 4. pi-codex-tools

- Network: same model-provider only.
- `postinstall`: **verify** before adoption.
- `apply_patch` is Linux-only (auto-disable on macOS) — non-issue here.
- Telemetry: not observed.

### 5. pix-bash pattern

- No binary to review — this is a **pattern**, reimplemented in
  acidbath. The pattern itself (framed output + auto-collapse timer)
  is fully auditable in the wrapper file (future P2 work).

### 6. pi-lens

- Network: LSP server-to-extension only (localhost). No remote fetch.
- `postinstall`: **verify** before adoption.
- Telemetry: not observed.
- Transitive deps: heavy (LSP server management). Gating to
  `debug` profile contains the operational cost.

### 7. visual-explainer

- Network: not inspected (filtered, never loaded).
- `postinstall`: not inspected.
- Telemetry: not observed.
- Unblocking requires a settings diff (see `docs/proposed-settings-diff.md`).

### 8. pi-ast-grep (code-yeongyu) — full review in `docs/ast-grep-security-review.md`

- Network: ONE `fetch()` to GitHub releases (gated by `PI_OFFLINE`).
- `postinstall`: none in own package; transitive `@ast-grep/cli` 0.45.0 has a benign postinstall (binary-resolution shim; verified by PR #2595 changelog).
- Telemetry: none.
- Binary download: yes, with **no checksum** — mitigated by C2 (`PI_OFFLINE=1`) + C3 (manual `cargo install ast-grep --locked`, completed as 0.45.0; expose `$HOME/.cargo/bin` to the resolver).
- Transitive deps: `@ast-grep/cli` + `extract-zip`. The cli has 6 platform-specific `optionalDependencies`; npm picks the matching one and ignores the rest.

### 9. pi-ast-grep (bjoernaagaard) — full review in `docs/ast-grep-security-review.md`

- Network: none. Uses `pi.exec` (sandboxed).
- `postinstall`: none.
- Telemetry: none.
- Binary download: none. Honors `AST_GREP_BIN` env override.
- Transitive deps: 0.
- Maturity: 8 commits, 0★, 1 contributor → not the lead.

### 10. pi-autoresearch

- Network: scoped to the model provider.
- `postinstall`: **verify** before adoption.
- Telemetry: not observed.

---

## Assumptions

1. **Adopted tools' transitive `postinstall`s are safe.** The
   matrix scores this as a **4** with a "verify before adoption"
   action item. None of the adopted tools' own packages have
   `postinstall` per public evidence, but their transitive npm
   trees are uninspected at this pass. The acidbath CI should add
   a `npm install --ignore-scripts` smoke test and a
   `postinstall` scanner (e.g., `can-i-ignore-scripts`,
   `npm-audit`) before any of these are added to `packages`.
2. **License for pi-screenshots-picker / @plannotator / pi-ask
   / council / tool-status.** Not inspected; assumed compatible
   (4) for the matrix aggregate. If a copyleft license shows up,
   the decision changes to **Reject**.
3. **bjoernaagaard's `pi.exec` is sandboxed by Pi.** The
   evidence cited is its use of `pi.exec` rather than
   `child_process`. The actual Pi sandbox policy for `pi.exec` is
   not inspected in this pass — assumed equivalent to Pi's other
   tool execution paths.
4. **Pix-bash's "auto-collapse" pattern is safe.** Not inspected;
   the pattern reimplementation in acidbath is what would be
   adopted, not the upstream package. Risk contained.
5. **code-yeongyu's `binary-size > 10_000` heuristic is benign
   when network is disabled.** Assumed in C2+C3 mitigation; the
   heuristic never fires when Homebrew provides the binary.

---

## How to read this matrix for the next adopt decision

- **Security ≤ 2** → reject unless controls are mandated.
- **Compat = 1** → cannot adopt without a migration. Drop or defer.
- **Op-risk = 1** → breakable, dead entry, or collision risk — drop.
- **∑ ≥ 24** AND all six columns ≥ 3 → adopt (with action items for any 3s).
- **∑ ≥ 24** BUT Security ≤ 3 → adopt only with documented controls (see ast-grep row).
- **∑ < 20** → study or drop.

This gives us a clear set:
- **Adopt now** (∑ ≥ 24, no blocking flags): acidbath, pi-subagents, pi-codex-compaction, pix-bash pattern, pi-lens, pi-autoresearch, metaharness (study), pi-interactive-shell (keep), visual-explainer (after unblock).
- **Adopt with controls** (∑ ≥ 23, Security = 3): pi-codex-tools, pi-ast-grep (code-yeongyu), oh-my-pi ast-grep.
- **Defer** (compat or maturity issues): bjoernaagaard, pi-minimax-mcp, my-pi-setup.
- **Drop** (compat = 1 or op-risk = 1): session-replay, damage-control, tool-status, council, pi-screenshots-picker, @plannotator/pi-extension, pi-ask, agy, research-bridge, web_search, pi-herdr-ui.

---

## Action items (for human approval)

- A1. **Unblock visual-explainer** by adding an explicit `extensions: ["./extensions/visual-explainer.ts"]` entry to the package override, OR by removing the upstream filter. See `docs/proposed-settings-diff.md`.
- A2. **Drop the 8 dead `packages` entries** (rows 12–18): pi-screenshots-picker, @plannotator/pi-extension, pi-ask, session-replay, damage-control, tool-status, council, (visual-explainer moves to "active" via A1). See `docs/proposed-settings-diff.md`.
- A3. **Adopt pi-ast-grep (code-yeongyu) with controls C1–C5**. See `docs/ast-grep-security-review.md`.
- A4. **Verify all "verify before adoption" action items** above before any new package is added to `~/.pi/agent/settings.json` packages.
