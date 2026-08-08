# Handoff — Acidbath Eval & Perf Session

Paste-ready for a new AI session. Supersedes nothing; continues `docs/PLAN.md`.

## Mission

Begin the **evaluation and performance** work for the `acidbath` Pi extension umbrella. This session is perf/eval/security focused. Three deliverables:

1. **Phase 0 instrumentation + baselines** — measure before changing anything.
2. **Tool-eval scored matrix** — a comparable rubric for each candidate tool/extension (first pass: scored matrix only; no objective benchmark yet).
3. **ast-grep extension supply-chain review** — carefully decide which ast-grep Pi extension to adopt; there are several and the binary trust model is a real risk. Do **not** adopt a random/unknown one.

**Visual/UI changes (orb, motion, gauge, labels rendering) are deferred — the human decides those.** This session does not implement visual changes. It may instrument them and measure their cost, but not change their look/behavior.

## Hard constraints

- PLAN-ONLY for the ast-grep selection and the eval rubric design until the human approves; implementation of perf instrumentation is allowed once the approach is agreed.
- No secret/auth/token file reads. No exfiltration.
- Keep Pi global discovery blocked (`!extensions/**`, `!prompts/**`, `!skills/**`+allowlist). Never load `pi-herdr-ui.ts` into the same session as acidbath (it collides on `/orb`, `/motion`, gauge).
- Do not adopt any extension that auto-downloads executables without checksum verification unless a mitigating control (e.g. `PI_OFFLINE=1` + manual binary install) is mandated.
- Skills canonical source is `~/dev/lib` (the user's library ecosystem), NOT `acidbath/skills`. Do not duplicate skill authorship into acidbath.
- Run up to 6 concurrent subagent lanes if useful; one lane must be the ast-grep supply-chain review.
- Separate facts from assumptions; cite file paths or repo URLs.

## Verified environment context (source of truth)

- Acidbath repo: `/Users/ameno/dev/acidbath` — standalone Pi package; `pi.extensions: ["./extensions/acidbath/index.ts"]`, `pi.themes: ["./themes/*.json"]`; peer deps `@earendil-works/pi-*` (= renamed `@mariozechner/pi-*` = badlogic/pi-mono runtime). Features: acidbath header, semantic orb (`/orb`), tool lifecycle motion (`/motion`), optional context pyramid (`/context`), themes `acidbath` and `acidbath-cyberdyne-teal`.
- Pi global settings: `~/.pi/agent/settings.json` — `defaultProvider: ap-copilot`, `defaultModel: copilot-gpt-5.3-codex`, `defaultThinkingLevel: high`, `hideThinkingBlock: true`, `transport: sse`, blocklists as above. Active packages: acidbath + `npm:pi-interactive-shell@0.14.0`. Three `~/.pi/agent/extensions/*` packages (session-replay, damage-control, tool-status) are filtered by the `!extensions/**` blocklist (tool-status also has a missing file; council has a malformed manifest).
- Pi-Herdr repo: `/Users/ameno/dev/pi-herdr` — origin of acidbath's UI; has scheduler, cockpit, agy, research-bridge extensions + skills. Loads only via `scripts/launcher.sh` (`--no-extensions` + explicit `--extension`/`--skill`) in a separate companion pane.
- **User's library: `/Users/ameno/dev/lib`** — the canonical skills/agents/workflows ecosystem. Contains `registry.yaml`, `skills.lock`, a `skills` CLI (`scripts/skills`), `build-skills.py` (generates `dist/<platform>/` mirrors), `validate-skills.py`, `collections/`, `skills-as-deps/` (package manager). Skills present include `agent-delegate`, `karpathy-guidelines`, `github`, `ios-debugger-agent`, `agent-browser`, `model-router`, etc. **This is where acidbath's skills must be authored/sourced**, not `acidbath/skills`.
- Full plan + visuals already written: `/Users/ameno/dev/acidbath/docs/PLAN.md` and `docs/visuals/*.html`. Read `PLAN.md` §0 (round-2 decisions) and §5 (perf plan) before starting.

## Round-2 decisions already locked (from PLAN.md §0)

- `pi-subagents` is the delegation surface. agy + research-bridge are **dropped** (do not vendor). Heritage vendored from pi-herdr = **scheduler + cockpit only**.
- `web_search` dropped (orphan).
- `pi-codex-tools` apply_patch kept; auto-disables on non-Linux (macOS host = inactive; streaming-render pattern still ships).
- `pi-lens` adopted, **debug-profile-scoped only** (gated).
- Eval rubric = **scored-matrix-only** first pass (compat/maintenance/license/security/perf/operational-risk).
- Skills via `pi.skills` manifest for Pi + cross-agent symlinks for others — but canonical source is `~/dev/lib` (revise §6.1 accordingly).
- Eval profile freezes motion (`PI_ACIDBATH_REDUCED_MOTION=1`, `PHASE=3`).

## ast-grep extension candidate inventory (supply-chain review lane)

There are multiple ast-grep Pi extensions. Do **not** pick blindly. Review at least:

| Candidate | Provenance | License | Tools | Binary handling | Notes |
|---|---|---|---|---|---|
| `code-yeongyu/pi-ast-grep` | Yeongyu Kim (pi-ecosystem author; port of `oh-my-openagent`; targets badlogic/pi-mono = acidbath's runtime) | MIT | `ast_grep_search`, `ast_grep_replace` (dry-run default) | Resolves `sg` via cache → `@ast-grep/cli` npm → platform pkg → PATH → homebrew → **GitHub release auto-download (last resort)**. **No checksum verification beyond TLS.** `PI_OFFLINE=1` disables auto-download. | 14★, 24 commits, last touched ~2mo ago. Strong provenance; binary trust model is the issue. |
| `bjoernaagaard/pi-ast-grep` | Unknown single author | Apache-2.0 | 6 tools (run/scan/rewrite/outline/debug_query/languages) + skill + runtime promotion | `AST_GREP_BIN` override or PATH; own binary resolution | 0★, very active (daily), pi 0.84 compat. Weaker provenance; needs code review before trust. |
| `oh-my-pi` built-in `ast-grep.ts` | can1357 (oh-my-pi distribution) | MIT | built into coding-agent | bundled with oh-my-pi | **Different runtime scope** (`@oh-my-pi`), not acidbath's `@earendil-works`. Not directly usable. |
| `coctostan/pi-hashline-readmap` | coctostan | — | wraps `@ast-grep/cli` (`ast_search`) | ships npm-managed `sg` | Broader tool than just ast-grep; review if considered. |
| `cortexKit/aft` pi-plugin | cortexKit | — | `ast_grep_*` + `lsp_diagnostics` + others | "One persistent Rust process per session" | Heavier; Rust process; review supply chain. |
| `ast-grep/ast-grep` (upstream) | Herrington Darkholme | MIT | the `sg` CLI itself (not a Pi extension) | cargo/brew/npm | This is the **binary**, not a Pi extension. Preferred manual-install source for the extension's `sg`. |

**Leading recommendation to validate:** `code-yeongyu/pi-ast-grep` (correct runtime, MIT, pi-ecosystem author) **with `PI_OFFLINE=1` mandated** + `sg` installed manually via `brew install ast-grep` (or `cargo install ast-grep --locked`) to eliminate the no-checksum auto-download. Reject `bjoernaagaard` unless a code review clears it. The review lane must: read the candidate's source for any network/exec behavior beyond the documented binary resolution, verify the `sg` binary provenance, check for telemetry, and confirm no `postinstall` runs untrusted code.

## Workstreams

### A) Phase 0 — instrumentation + baselines (perf)
- Build `scripts/bench-tool-render.mjs`: measure `renderCall`/`renderResult` cost for 1k synthetic calls; assert `MotionClock`/collapse timers cleared at idle; count `setWorkingMessage` churn for a 20-event burst.
- Capture baseline numbers into `docs/baselines.md` (current acidbath, before any change): tool-render ms/call, timer count at idle, label churn, context-gauge tick cost.
- Unblock `visual-explainer` (it's in `packages` but filtered) — diagnose why and fix loading without weakening the blocklist.
- Clean dead `packages` entries (session-replay, damage-control, tool-status) from settings — but **propose the diff first**, don't apply without confirmation.
- Exit criteria: baselines committed; visual-explainer renders HTML; dead-entry diff proposed.

### B) Tool-eval scored matrix (eval rubric)
- For each adopted/candidate tool (pi-subagents, pi-codex-compaction, pi-codex-tools, pix-bash pattern, pi-lens, visual-explainer, pi-ast-grep, pi-autoresearch), produce a scored matrix: compat / maintenance / license / security / perf / operational-risk (1–5).
- Security column must call out: network egress, executable download + checksum posture, telemetry, `postinstall` scripts, dependency count/audit.
- No `measure.sh` objective benchmark yet (deferred). Deliver the matrix as `docs/tool-eval-matrix.md`.
- Exit criteria: one scored row per candidate with cited evidence.

### C) ast-grep supply-chain review (dedicated lane)
- Read the leading candidate's source (`code-yeongyu/pi-ast-grep` `src/`) for network/exec behavior; confirm the binary resolution order and the no-checksum auto-download; confirm `PI_OFFLINE=1` fully closes it.
- Verify `brew install ast-grep` provides a checksum-verified `sg` (Homebrew verifies SHA256).
- Produce a 1-page security finding: adopt/reject + the mandated controls (`PI_OFFLINE=1`, manual `sg`, pin a version). Deliver as `docs/ast-grep-security-review.md`.
- Exit criteria: a defensible adopt decision with controls, or a rejection with an alternative.

### D) Skills ↔ lib integration (design only this session)
- Revise PLAN.md §6.1: canonical skill source = `~/dev/lib/skills`, not `acidbath/skills`. Determine how lib's `skills` CLI / `build-skills.py` dist mirrors feed acidbath's `pi.skills` manifest, and how cross-agent symlinks point at lib-managed outputs (not acidbath-owned files).
- Do not duplicate skill authorship into acidbath. Propose the wiring; don't implement yet.
- Exit criteria: a revised §6.1 + a lib-integration note in `docs/tool-eval-matrix.md` or a new `docs/skills-lib-integration.md`.

### E) Visual changes — DEFERRED
- Do not implement orb/motion/gauge/label rendering changes. The human decides these.
- You may instrument and **measure** their current cost (part of A), and you may prototype V1 `ui-labels.ts` as a **pure, unconnected** function with tests — but do not wire it into `apply()` or change the UI without explicit approval.

## Required deliverables

1. `docs/baselines.md` — Phase 0 measured baselines.
2. `docs/tool-eval-matrix.md` — scored matrix per candidate tool.
3. `docs/ast-grep-security-review.md` — supply-chain finding + adopt/reject + controls.
4. `docs/skills-lib-integration.md` (or revised PLAN.md §6.1) — lib-as-skill-source wiring.
5. A proposed (not applied) `~/.pi/agent/settings.json` diff cleaning dead entries + unblocking visual-explainer.
6. Open questions for the human before any implementation beyond instrumentation.

## Open questions to surface (don't guess)

- Which ast-grep candidate after the security review? (C delivers the recommendation; human approves.)
- Confirm `brew install ast-grep` is the preferred manual binary source on this macOS host (vs cargo).
- For lib integration: should acidbath consume lib's `dist/pi/` mirror, or symlink directly to `~/dev/lib/skills/<name>` in its `pi.skills` manifest? (Needs lib's install model.)
- May this session apply the perf-instrumentation scripts to the repo, or propose-then-apply?
