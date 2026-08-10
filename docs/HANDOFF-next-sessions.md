# Handoff prompt: Acidbath + Herdr implementation

Use this as the startup prompt for the next implementation session.

---

You are continuing the Acidbath + Herdr cleanup/refinement project. Use **Luna** (`openai-codex/gpt-5.6-luna`) for this session and for every delegated Herdr Pi agent. Do not silently fall back to Sol. Confirm the model in the pane footer before assigning work.

## Read first

1. `docs/COHESIVE-IMPLEMENTATION-PLAN.md` — implementation authority.
2. `docs/HANDOFF-eval-3.md` — historical evaluation/context.
3. `docs/PLAN.md` — evidence only; mark conflicting claims stale rather than following them.
4. `~/.agent/diagrams/acidbath-herdr-subagents-plan.html` — approved architecture and UI/tool-output examples.
5. The current `git status`; preserve unrelated pre-existing worktree changes.

## Mission

Build a slim Acidbath presentation layer around native Herdr capabilities:

- Acidbath owns Pi header/editor/footer/context and deliberate built-in tool renderers.
- Herdr owns panes, PTYs, processes, worktrees, lifecycle, focus, persistence, and agent status.
- `herdr-subagents` will provide local profiles, bounded spawn/fleet/message tools, result envelopes, a read-only viewer, and an optional event-based Acidbath adapter.
- Research is an explicit profile pairing hardened `pi-research` with `pi-web-access`.
- Compaction continuation is safe, bounded, deduplicated, and only runs between turns.
- Destructive deletion waits until replacement parity is proven.

SSH/remote Herdr is deferred. The MVP is local-only, but identities must retain host/session/workspace/tab/pane fields for future transport.

## Non-negotiable constraints

- Quality before utility; do not preserve a poor implementation merely because the capability is useful.
- Do not make visual/settings changes without an explicit approval gate.
- No telemetry, analytics, surprise downloads, implicit browser-cookie access, or undocumented egress.
- Network access is only available through an explicitly selected capability profile.
- Do not embed a PTY/session manager in Pi.
- Do not kill Pi or Herdr processes. Use `/reload`, isolated sessions, and profile rollback.
- Do not delete old packages/extensions until parity, migration, and rollback tests pass.
- Do not load `pi-subagents`, `pi-messenger`, Pix runtime packages, `pi-lens`, autoresearch, or telemetry-bearing Codex packages in the default profile.
- Preserve historical session JSONL/artifacts unless the user separately requests data deletion.
- All delegated tasks use explicit non-overlapping worktrees/files, finite scopes, and a bounded result envelope. No nested worker fan-out.

## Current repository state

The Acidbath worktree is already dirty. Do not reset or overwrite these changes:

- `README.md`
- `docs/PLAN.md`
- `docs/ui-plan-revisit.md`
- `extensions/acidbath/index.ts`
- `extensions/acidbath/ui-footer.ts`
- `extensions/acidbath/ui-token-context.ts`
- `package.json`
- existing/new status, whimsical, agent-output, benchmark, and test files shown by `git status`.

Implementation has begun without settings migration or destructive cleanup. Phase 1 removed Acidbath's unconditional idle context poll, and the Phase 2 local `herdr-subagents` contract/transport slice is now passing tests and has been exercised against native Herdr 0.7.1. The new plan document itself is the authority.

## Execution order

### Phase 0 — truth and gates

- Run and record baseline `npm test`, `npm run typecheck`, and `npm run test:visual`.
- Ensure all existing test scripts are actually included in the test command.
- Capture active Pi resources/tools/extensions, system-prompt/tool-schema sizes, and idle/active timer counts.
- Fix reproducibility findings without broad cleanup: invalid dependency state, exact pins, and package/source/telemetry audit.
- Keep the current visual experiments unchanged until the user approves their disposition.

### Phase 1 — no-visual Acidbath stabilization

- Split lifecycle responsibilities from `extensions/acidbath/index.ts` only as needed.
- Create one generation-keyed state store/reducer for activity, tools, context, and external summaries.
- Make session reload/new/fork/shutdown idempotent and dispose every subscription/timer.
- Remove unconditional idle context polling and avoid startup subprocess/recursive skill discovery.
- Consolidate animation/redraw timing; target zero repeating timers at idle.
- Add the versioned `acidbath.display.v1` event contract using Pi's event bus.
- Refactor `continue-after-compaction` separately: no overflow retry, only idle between-turn continuation, deduplicate by compaction entry/generation, use the retained summary, and send a bounded handoff prompt.

### Phase 2 — local Herdr vertical slice

The first contract/transport slice now exists at `/Users/ameno/dev/herdr-subagents`. Continue by reviewing and hardening it before adding the viewer or broad dogfooding.

Create/extend tests first:

- host-qualified identity;
- profile/capability ceilings;
- bounded message/result envelopes;
- local mailbox/inbox;
- Herdr 0.7.1 protocol fixtures and capability negotiation;
- local transport using installed Herdr CLI.

Then implement one `luna-scout` flow:

`herdr_spawn → working → status/wait → bounded result/message → parent delivery`.

Use native Herdr metadata/status and focus. Do not implement SSH, arbitrary terminal input, or Pi-owned PTYs.

### Phase 3 — dogfood with Luna

After the vertical slice passes, use `herdr-subagents` to delegate:

- Acidbath core/controller work;
- tool-output renderer correction;
- read-only Herdr viewer;
- profile/worktree enforcement;
- research hardening;
- compaction/security validation;
- Pi-Herdr migration review.

Review every result in the parent. Keep concurrency at three until message/result reliability is proven.

### Phase 4 — parity-gated cleanup

Only after tests and a fresh-process profile smoke test pass:

- remove `pi-research` from Acidbath’s default dependency/loading path;
- replace the Pi-Herdr research bridge with explicit research-profile orchestration;
- replace/remove the AGY master orchestrator with `herdr-subagents`;
- slim duplicate `pi-herdr-ui` generic renderers;
- remove old `tool-status`, `session-replay`, stale subagent views/widgets, Pix runtime references, and stale launcher entries;
- remove `pi-interactive-shell` from default only after Herdr viewer/process parity;
- update settings atomically with backup and verify using a fresh RPC session.

## Tool-output target

Restore one visible compact transcript row per built-in call and preserve native expansion/details. Do not hide native transcript rows and then recreate them in a custom persistent activity transcript. Timing must come from execution lifecycle events keyed by `toolCallId`, not renderer invocation. External packages emit bounded display facts; Acidbath does not infer semantics by tool name.

## Research target

`pi-research` returns bounded findings and structured source URLs. The primary Pi invokes `pi-web-access` extraction/evidence tools. AGY must not be told it can invoke parent Pi tools. Research is opt-in, least-privilege, explicitly network-declared, cookie-off by default, and tested for cancellation, malformed output, timeouts, bounds, and egress.

## Required result format for every implementation session

End with:

1. **Summary** — what changed.
2. **Files** — exact paths.
3. **Tests** — exact commands and outcomes.
4. **Model** — confirm `openai-codex/gpt-5.6-luna` for every Pi/Herdr session used.
5. **Risks** — unresolved compatibility/security/visual concerns.
6. **Next step** — one ordered action, not a vague backlog.

If the task would change visual output, settings, dependency defaults, or delete a legacy path, stop before applying that change and report the approval/parity gate required.
