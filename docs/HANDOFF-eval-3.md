# Handoff — Acidbath Extension and Resource Evaluation (Session 3)

**Purpose:** provide the next evaluation agent with a source-backed inventory from Session 3. This document is an evidence pack, not an adoption plan or a verdict. The runtime inventory and command tables below are historical; the native-transcript tool migration and current command surface are documented in `docs/ACIDBATH-EXTENSION-UI-HANDOFF.md`.

The human's evaluation rule is:

- Every visual change must justify visual value against performance and resource cost.
- Every extension must be judged implementation quality first, utility second.
- Do not dismiss a selected capability as useless. Identify concrete ways to improve its quality, safety, integration, utility, or cost profile.
- Do not add more extensions or change visual behavior during the evaluation pass without explicit approval.

## 1. Snapshot and verification

- Working repository: `/Users/ameno/dev/acidbath`
- Pi: `0.84.1` (`pi --version`)
- Node used by the current shell: `v22.23.2`
- Package: `acidbath@0.1.0`
- Current repository HEAD: `86420b6` (`Merge pull request #6 from ameno-/feat/startup-header`)
- Current global settings: `/Users/ameno/.pi/agent/settings.json`
- Pi extension docs used for this inventory:
  - `/Users/ameno/.nvm/versions/node/v22.13.1/lib/node_modules/@earendil-works/pi-coding-agent/docs/extensions.md`
  - `.../docs/compaction.md`
  - `.../docs/rpc.md`

Verification completed before writing this handoff:

- `npm test` — passed (package manifest, context pyramid, labels, token context, tool motion, and summary tests).
- `npm run typecheck` — passed.
- `pi --mode rpc --no-session --no-approve` with `{"type":"get_commands"}` — startup succeeded and returned the active command/resource inventory below.
- Explicitly loading the two newly installed extensions with `-e` — startup succeeded; `/cloak-status` appeared.
- Current Acidbath benchmark: `docs/bench-results/current.json`, generated on Node `v24.17.0`/darwin-arm64 at `2026-08-07T19:07:29.228Z`.

The repository was clean before this handoff was created. The handoff itself is the only intended repository change in this pass.

## 2. Runtime activation facts

### Current global settings

Relevant portions of `/Users/ameno/.pi/agent/settings.json`:

- `extensions`: `["!extensions/**"]`
- `skills`: `["!skills/**", "+skills/agent-browser/SKILL.md", "+skills/gotem/SKILL.md", "+skills/herdr/SKILL.md", "+skills/mmx-cli/SKILL.md", "+skills/react-native-dev/SKILL.md"]`
- `prompts`: `["!prompts/**"]`
- `packages`:
  - `npm:pi-interactive-shell@0.14.0`
  - git `code-yeongyu/pi-ast-grep` pinned to `4a7d1beee684d96a6890e5fc55710bb63fecca85`
  - visual-explainer pinned to `528b71f`
  - `../../dev/acidbath`
- `defaultProvider`: `openai-codex`
- `defaultModel`: `gpt-5.6-luna`
- `defaultThinkingLevel`: `high`
- `theme`: `ameno-cyberdyne-soft`
- `transport`: `sse`
- `compaction.enabled`: `false`
- `tuiMode`: `fullscreen`
- `steeringMode`: `all`

Do not read or copy authentication/token files as part of evaluation.

### What normal startup actually loads

The RPC `get_commands` probe returned these extension commands:

| Source | Commands / surfaces | Location |
|---|---|---|
| `pi-interactive-shell@0.14.0` | `/spawn`, `/attach`, `/dismiss` | `/Users/ameno/.pi/agent/npm/node_modules/pi-interactive-shell/index.ts` |
| Acidbath | `/preflight`, `/acidbath-update`, `/context`, `/tools`, `/orb`, `/motion` | `/Users/ameno/dev/acidbath/extensions/acidbath/index.ts` |
| bundled `pi-research` | `/agy-setup` | `/Users/ameno/dev/acidbath/node_modules/pi-research/extension/index.ts` |
| Pi inline provider | `/llama` | `<inline:llama.cpp>` |
| visual-explainer prompts | `/diff-review`, `/fact-check`, `/generate-slides`, `/generate-visual-plan`, `/generate-web-diagram`, `/plan-review`, `/project-recap` | `/Users/ameno/.pi/agent/git/github.com/nicobailon/visual-explainer/plugins/visual-explainer/commands/` |

The same probe returned these loaded skills:

- `/Users/ameno/.pi/agent/skills/agent-browser/SKILL.md`
- `/Users/ameno/.pi/agent/skills/gotem/SKILL.md`
- `/Users/ameno/.pi/agent/skills/herdr/SKILL.md`
- `/Users/ameno/.pi/agent/skills/mmx-cli/SKILL.md`
- `/Users/ameno/.pi/agent/skills/react-native-dev/SKILL.md`
- `/Users/ameno/.pi/agent/npm/node_modules/pi-interactive-shell/skills/pi-interactive-shell/SKILL.md`
- `/Users/ameno/.pi/agent/git/github.com/nicobailon/visual-explainer/plugins/visual-explainer/SKILL.md`

Important distinction: `pi list` prints object-form package entries as `(filtered)`, but the RPC probe proves visual-explainer's extension surfaces, prompts, and skill are currently loaded. The ast-grep source appears in settings but has no installed path under `/Users/ameno/.pi/agent/git/`, and no ast-grep commands appeared in the RPC inventory. Treat ast-grep as configured-but-not-currently-loaded until separately verified.

### Global extensions: installed vs loaded

Because normal settings block `extensions/**`, files under `/Users/ameno/.pi/agent/extensions/` are not auto-loaded in a normal session. Explicit `pi -e /absolute/path` loading works.

This was verified for the two most recent additions:

| Extension | Installed location | Source | Normal startup | Explicit `-e` |
|---|---|---|---|---|
| pi-cloak | `/Users/ameno/.pi/agent/extensions/pi-cloak/index.ts` | `https://github.com/dmmulroy/.dotfiles/blob/main/home/.pi/agent/extensions/pi-cloak/index.ts` | blocked by `!extensions/**` | loaded; registers `/cloak-status` |
| continue-after-compaction | `/Users/ameno/.pi/agent/extensions/continue-after-compaction.ts` | `https://github.com/dmmulroy/.dotfiles/blob/main/home/.pi/agent/extensions/continue-after-compaction.ts` | blocked by `!extensions/**` | loaded |

The companion pi-cloak config was installed at `/Users/ameno/.pi/agent/cloak.json` from the same dotfiles repository. It contains seven rules covering env/vars files, selected JSON/OpenCode/config token fields, and auth JSON fields. It does not contain credentials.

Other global extension files and directories on disk:

| Resource | Location | Current state / source context |
|---|---|---|
| autoresearch | `/Users/ameno/.pi/agent/extensions/pi-autoresearch/index.ts` | on disk; not normal-startup loaded |
| session replay | `/Users/ameno/.pi/agent/extensions/session-replay/session-replay.ts` | on disk; package manifest exists; blocked |
| subagent widget | `/Users/ameno/.pi/agent/extensions/subagent-widget/subagent-widget.ts` | on disk; blocked |
| damage control | `/Users/ameno/.pi/agent/extensions/damage-control/damage-control.ts` | on disk; blocked |
| tool status | `/Users/ameno/.pi/agent/extensions/tool-status.ts` | legacy loose file; blocked |
| handoff | `/Users/ameno/.pi/agent/extensions/handoff.ts` | legacy loose file; blocked |
| Herdr state | `/Users/ameno/.pi/agent/extensions/herdr-agent-state.ts` | legacy loose file; blocked |
| shared/core helpers | `/Users/ameno/.pi/agent/extensions/_core/`, `/Users/ameno/.pi/agent/extensions/_util/` | helper files, not normal-startup loaded |
| data/config | `/Users/ameno/.pi/agent/extensions/*.json`, `*.yaml` | config/rules; not extension entrypoints |

`/Users/ameno/.pi/agent/CONTEXT-AUDIT.md` contains the earlier source review, known defects, and rollback rationale for the quarantined resources. It predates the two newly installed dotfiles extensions and has an older Pi version/config snapshot; use it as historical reasoning, not as current activation truth.

## 3. Acidbath implementation inventory

Pi package manifest: `/Users/ameno/dev/acidbath/package.json`

Entrypoint: `/Users/ameno/dev/acidbath/extensions/acidbath/index.ts`

### Shipped runtime surfaces

| Capability | Source locations | Runtime surface / behavior |
|---|---|---|
| Header | `extensions/acidbath/ui-header.ts`, `index.ts` | Large centered `ACIDBATH` wordmark, theme-derived gradient, tagline, task summary, optional context display; width-safe and `NO_COLOR` aware. |
| Welcome/preflight | `ui-welcome.ts`, `index.ts` | Transient above-editor widget with cwd/model/skills/checks and attributed Stoic message; `/preflight` reruns it; first agent prompt clears it. |
| Borderless editor | `index.ts` (`BorderlessEditor`) | Custom editor removes top/bottom border rows, preserves a fixed prompt/orb slot and input origin, handles narrow widths. |
| Semantic orb | `ui-orb.ts`, `index.ts` | States `working`, `searching`, `solving`, `listening`, `composing`, `shaping`; `/orb` supports auto, named states, off/default; provider/message/tool lifecycle mapping. |
| Tool lifecycle motion | `ui-motion.ts`, `ui-tools.ts`, `ui-tool-renderers.ts` | Wraps built-in `read`, `bash`, `edit`, `write`, `grep`, `find`, `ls` for renderer-only compact status rows; one shared 100ms `MotionClock`; expanded rows reuse native Pi renderers. `/motion live|0|1|2|3`. |
| Tool activity transcript | `ui-tool-activity.ts`, `index.ts` | TUI-only bounded four-row activity entry; deduplicated by tool call id; active calls pinned; history scroll/toggle/expand commands and Ctrl-Alt-Up/Down. |
| Deterministic labels | `ui-labels.ts`, `ui-tool-renderers.ts`, `index.ts` | Pure event/tool/argument-to-label synthesis; tool path/command/pattern labels; edit aggregate hooks; 100ms trailing debounce and same-message guard in the caller. |
| Context/token rail | `ui-token-context.ts`, `ui-footer.ts`, `index.ts` | Usage facts reducer with generation/sequence guards, truthful unknown values, compact context rail, turn usage, lifecycle state, bounded token bubbles. |
| Optional context pyramid | `ui-context-pyramid.ts`, `ui-context-widget.ts`, `index.ts` | `/context right|above|below|off`; right is inline footer rail; above/below is animated three-row pyramid; 80ms animation only while target differs; narrow fallback. |
| Footer | `ui-footer.ts`, `index.ts` | Consolidated model, cwd, thinking, lifecycle, context, and terminal usage line with width-aware degradation. |
| Themes | `themes/acidbath.json`, `themes/acidbath-cyberdyne-teal.json` | Reusable theme definitions; Acidbath does not force the current global theme. |
| AGY research | package dependency `pi-research`, `extensions/acidbath/index.ts`, `README.md` | Bundled/pinned `agy_web_search` and `agy_research` tools plus `/agy-setup`; authentication/permission changes remain explicit. |
| Maintenance command | `index.ts` | `/acidbath-update` confirms before `pi update --extensions`, then `pi update`. |

Other project source files:

- `extensions/acidbath/ui-gauge.ts` — ANSI-aware visible-width, truncation, legacy gauge helpers.
- `extensions/acidbath/ui-summary.ts` — deterministic ten-word-ish task summary.
- `extensions/acidbath/ui-tool-rows.ts` — compact tool row formatting.
- `extensions/acidbath/ui-tool-activity.ts` — activity store/transcript described above.
- `config/settings.global.example.json`, `config/keybindings.example.json` — templates only; not automatically installed.
- `docs/visuals/*.html` — architecture, roadmap, UI alternatives, adoption matrix, and other visual research artifacts.

### Timers and performance-relevant paths

- `MotionClock`: one interval at 100ms, created only when pending render subscribers exist; removed at idle and on shutdown.
- Context pyramid widget: one interval at 80ms only while displayed value animates toward a different target; removed at target/dispose.
- Context usage polling: one `setInterval` at 1000ms during a TUI session; removed on shutdown.
- Label debounce: one 100ms timeout, replaced/cancelled on new label and cleared on shutdown.
- Tool activity store and header/footer rendering: no independent timers.
- `PI_ACIDBATH_REDUCED_MOTION=1` freezes motion paths; `PI_ACIDBATH_MOTION_PHASE=0..3` selects a deterministic tool phase; `PI_ACIDBATH_CONTEXT=right|above|below|off` controls context placement; `NO_COLOR` removes ANSI.

The current benchmark records 0 idle MotionClock timers/subscribers, 0 idle lifecycle timers, no redundant guarded messages, and sub-millisecond pure-helper medians. It is a microbenchmark, not a full-screen TUI latency or CPU/battery measurement. The next evaluation should keep that distinction explicit.

## 4. Test and evidence surface

Package scripts from `package.json`:

- `npm test`
- `npm run typecheck`
- `npm run test:visual`
- `node --experimental-strip-types --no-warnings scripts/bench-tool-render.mjs`

Test files:

- `scripts/test-package-manifest.mjs`
- `scripts/test-context-pyramid.mjs`
- `scripts/test-ui-labels.mjs`
- `scripts/test-token-context.mjs`
- `scripts/test-tool-motion.mjs`
- `scripts/test-ui-summary.mjs`
- `scripts/test-ui-header.mjs`
- `scripts/test-ui-welcome.mjs`
- `scripts/test-tool-activity.mjs`
- `tests/visual/test-tool-row-visual.mjs`
- `tests/visual/fixtures/tool-row-fixture.mjs`

Current known evidence gaps to preserve for evaluation:

- No full real-Pi-TUI screenshot/interaction run is captured in this handoff.
- Header/context/editor visual fixtures are not comprehensive across widths 40/60/80/120.
- Context widget placement, lifecycle cleanup, reduced-motion, and narrow fallback need direct tests beyond pure model tests.
- Benchmark coverage is mostly pure helpers and synthetic renderer calls; it does not yet measure sustained TUI CPU, render frequency, terminal output volume, or battery impact.
- `ui-labels.ts` comments include historical “unconnected” wording even though the function is now wired; documentation quality should be checked against behavior.
- `feature-inventory.md` contains historical statements that no longer match the current root `tsc` availability and current runtime; reconcile before using it as a final status report.

## 5. Prior reasoning and decision context

These are decisions already recorded in `docs/PLAN.md`, `docs/HANDOFF-eval.md`, `docs/HANDOFF-eval-2.md`, and related research files. They are context for the next agent, not fresh recommendations:

- Acidbath is the umbrella for its own UI and bundled `pi-research`; do not duplicate ownership with `pi-herdr-ui.ts` because of `/orb`/`/motion`/indicator collisions.
- Visual changes remain human-gated. Existing motion is deterministic and has reduced-motion/frozen-phase controls for eval.
- Labels are deterministic V1: no raw thinking parsing, no model-output parsing, no new model call; safe structured tool args are the signal.
- `pi-subagents` was selected in prior research as the future delegation surface; AGY/research-bridge from Pi-Herdr were not to be vendored as the delegation mechanism.
- `pi-codex-compaction`, `pi-codex-tools`, pix-bash framing/collapse patterns, pi-lens, pi-ast-grep, and pi-autoresearch were research candidates with gates/controls, not all current active runtime capabilities.
- Canonical cross-agent skills are intended to live in `/Users/ameno/dev/lib`; do not duplicate them into Acidbath or symlink them into `~/.pi/agent/skills/` without an explicit integration decision.
- The global profile intentionally blocks auto-discovered extensions, skills, and prompts; explicit package/CLI surfaces are preferred so startup context stays bounded and rollback is easy.
- Settings changes were intended to be propose-then-apply. Preserve that discipline for any activation of the newly installed global extensions.

Primary research locations:

- `docs/PLAN.md`
- `docs/HANDOFF-eval.md`
- `docs/HANDOFF-eval-2.md`
- `docs/tool-eval-matrix.md`
- `docs/ast-grep-security-review.md`
- `docs/pi-research-evaluation.md`
- `docs/ui-tool-display-research.md`
- `docs/token-context-animation-review.md`
- `docs/skills-lib-integration.md`
- `docs/skills-topology-evaluation.md`
- `docs/handoff-acidbath-topology.md`
- `/Users/ameno/dev/pi-herdr` (separate Herdr launcher/runtime; do not assume it is in normal Acidbath startup)
- `/Users/ameno/dev/lib` (canonical skills/agent ecosystem; do not assume its proposed `pi` target exists yet)

## 6. Skill inventory and locations

### Normal-startup allowlist

| Skill | Location | Role |
|---|---|---|
| agent-browser | `/Users/ameno/.pi/agent/skills/agent-browser/SKILL.md` | headless browser verification/automation |
| gotem | `/Users/ameno/.pi/agent/skills/gotem/SKILL.md` | explicit content/library save/search/analyze workflow |
| herdr | `/Users/ameno/.pi/agent/skills/herdr/SKILL.md` | Herdr control only when explicitly requested |
| mmx-cli | `/Users/ameno/.pi/agent/skills/mmx-cli/SKILL.md` | MiniMax media/chat/search CLI |
| react-native-dev | `/Users/ameno/.pi/agent/skills/react-native-dev/SKILL.md` | React Native/Expo reference |
| pi-interactive-shell | `/Users/ameno/.pi/agent/npm/node_modules/pi-interactive-shell/skills/pi-interactive-shell/SKILL.md` | long-running process/delegated CLI supervision |
| visual-explainer | `/Users/ameno/.pi/agent/git/github.com/nicobailon/visual-explainer/plugins/visual-explainer/SKILL.md` | self-contained HTML diagrams, reviews, plans, slides, recaps |

### Installed but disabled/on-demand skill files

All are under `/Users/ameno/.pi/agent/skills/` and excluded by `!skills/**` unless explicitly loaded:

`agent-metrics`, `autoresearch-create`, `autoresearch-finalize`, `bowser`, `code-review`, `custom-pi-agent`, `git-commits`, `karpathy-guidelines`, `linear-session-workflow`, `lockin-workflow`, `minimax-mcp`, `minimax-multimodal-toolkit`, `nomfeed`, `plan-check`, `safe-bash`, `session-completion-linear`, `typescript`, `ux-cognitive-simplicity`, `ux-learnability-confidence`, `ux-visual-clarity`, and `workflow-recall`.

Additional canonical skills/capability source under `/Users/ameno/dev/lib` is described by `docs/skills-lib-integration.md`; Acidbath does not currently own those files.

## 7. Evaluation checklist for the next agent

For each existing or proposed extension/capability, capture facts before scoring:

1. Exact source path, package/version/commit, manifest surface, and normal activation path.
2. Events, tools, commands, timers, subprocesses, filesystem/network access, and session/shutdown cleanup.
3. Model-context cost: system prompt additions, tool schemas, skill disclosure, result growth, and compaction interaction.
4. Failure behavior: throw vs return error, fail-open/fail-closed behavior, cancellation, retries, stale session objects, and partial startup.
5. Test evidence: pure unit tests, integration tests, TUI/visual checks, typecheck, and reproducibility.
6. Utility evidence: the concrete workflow it improves, who uses it, and whether an existing active capability already covers the job.
7. Improvement path: smallest quality improvement, safest activation scope, rollback, and a measurable acceptance criterion.

For visuals, add the corresponding value/perf evidence:

- What decision or task becomes faster/clearer?
- What persistent screen area, redraws, timers, ANSI output, or cognitive load does it add?
- Does reduced motion, narrow-width behavior, `NO_COLOR`, and expansion/fallback preserve usability?
- Is the benefit worth the always-on cost, or should it be command/profile/opt-in scoped?

Do not convert this checklist into implementation work until the evaluation agent has returned its findings and the human has chosen the next gate.
