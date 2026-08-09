# Acidbath skills-topology evaluation

**Status:** planning and research only. This report does not implement a capability, change Pi settings, change `/Users/ameno/dev/lib`, or add a package/registry entry.

**Scope:** current Acidbath extension and uncommitted changes, the configured Pi surface, the canonical skill library at `/Users/ameno/dev/lib`, and pinned read-only reviews of the requested external candidates.

## Executive recommendation

Keep `acidbath` as a **focused presentation and lifecycle extension**. It should own the compact TUI contract—header, borderless editor, orb, context indicator, and renderer decoration for the seven built-in tools it deliberately wraps. It should not become the skill manager, research executor, browser automation layer, CI orchestrator, or general-purpose distribution of every useful workflow.

Adopt a staged form of **Option B** (core Acidbath plus opt-in capability packages/modes), while retaining the operational discipline of Option A and leaving a path to Option C later:

1. Stabilize and test the current core UI and renderer ownership boundary.
2. Let `/Users/ameno/dev/lib` remain the single authoring and deployment authority for skills. Add a Pi build target there only after human approval; expose a generated `dist/pi/skills` view through a future Acidbath package manifest, not through `~/.pi/agent/skills`.
3. Keep execution-heavy capabilities—browser, research, subagents, CI, and evaluation—in separate optional packages or explicitly launched profiles. Acidbath may render their lifecycle through a generic adapter contract, but it must not own their permissions or executors.
4. Treat modes as composition of independent UI settings and capability profiles. Profile changes happen at launch/relaunch, not as an in-band command that silently adds or removes tools.
5. Reconsider a pix-mono-style monorepo only after there are at least two independently publishable Acidbath capability packages or a genuinely shared runtime library with a second consumer.

The important design invariant is: **one visible Acidbath surface, many independently governed capabilities**. A user should see consistent status vocabulary and discoverability without every skill becoming an Acidbath dependency.

---

## 1. Evidence base and current state

### 1.1 Acidbath package boundary

Evidence: `package.json`, `README.md`, `extensions/acidbath/*.ts`, `themes/*.json`, `config/*`, `docs/feature-inventory.md`.

The package is currently one Pi package with one extension entrypoint and two themes:

- `extensions/acidbath/index.ts`: session lifecycle, environment gates, working indicator, editor/header/context installation, commands, shutdown cleanup.
- `ui-header.ts`: `acidbath` header, model and cwd metadata, theme accent, narrow fallback.
- `ui-orb.ts`: six semantic states, deterministic frames, reduced-motion/no-color behavior, tool-to-state mapping.
- `ui-motion.ts`: pure motion phases and pending/success/error glyph selection.
- `ui-tools.ts`: wrappers around `read`, `bash`, `edit`, `write`, `grep`, `find`, and `ls`; one shared pending-motion clock; built-in renderer delegation.
- `ui-context-pyramid.ts`: pure context-pressure model and renderer.
- `ui-context-widget.ts`: above/below-editor widget, animated convergence, narrow fallback, cleanup.
- `ui-labels.ts`: pure deterministic label synthesis, now called by the live path and tool render callbacks.
- `themes/`: `acidbath` and `acidbath-cyberdyne-teal`.

This is a coherent product boundary. The seven built-in wrappers are not merely cosmetic files: registering a tool with the same name makes Acidbath the owner of that tool definition and renderer for the session. That ownership must remain explicit and opt-out-able.

### 1.2 Configured Pi surface

Evidence: `/Users/ameno/.pi/agent/settings.json`, `/Users/ameno/.pi/settings.json`, `docs/PLAN.md`, `docs/skills-lib-integration.md`.

The current agent settings configure:

- `acidbath` from `../../dev/acidbath`;
- `pi-interactive-shell@0.14.0`;
- pinned `pi-ast-grep` at `4a7d1beee684d96a6890e5fc55710bb63fecca85`;
- pinned `visual-explainer` at `528b71f`;
- a global `!extensions/**` blocklist;
- a global `!skills/**` blocklist with explicit allow entries for `agent-browser`, `gotem`, `herdr`, `mmx-cli`, and `react-native-dev`.

`~/.pi/settings.json` separately names `react-native-dev`. The settings show configured package intent, not proof that every package surface loaded successfully; the existing evaluation docs specifically record `visual-explainer` as filtered/inferred and recommend re-verifying it.

The practical active tool surface is therefore the Pi built-ins plus Acidbath's seven wrappers, with separate extensions/capabilities potentially contributing interactive shell, AST-grep, or visual-explainer surfaces. Acidbath currently does not own those external tools. Its label helper can name arbitrary tool events, but `ui-tools.ts` only wraps the seven built-ins.

### 1.3 Canonical lib facts

Evidence: `/Users/ameno/dev/lib/README.md`, `registry.yaml`, `manifest.md`, `skills.lock`, `scripts/skills`, `scripts/build-skills.py`, `scripts/validate-skills.py`, `scripts/skills_lock.py`, `platform/*.md`, ADR-0006, ADR-0007, and `docs/skill-scope-codex-droid-pi-plan.md`.

- `/Users/ameno/dev/lib` is the canonical source for shared skills, agents, workflows, packages, and the catalog.
- `registry.yaml` currently defines `agent-skills`, `codex`, `claude`, `factory`, and `antigravity`; it has no `pi` platform and ordinary entries do not target Pi.
- `skills.lock` records exact local package versions and SHA-256 digests. It is the integrity record for canonical content, not a runtime tool registry.
- `scripts/skills build` creates disposable `dist/<platform>/skills/<name>` symlink mirrors from registry-selected canonical sources.
- `scripts/skills deploy <platform>` manages platform install roots; it is not an Acidbath concern and must not be duplicated in Acidbath.
- The validator requires package-local relative paths and self-contained manifests. This matters if a future Pi view is generated: the generated view can point outward at canonical sources operationally, but canonical package metadata must remain valid and platform-neutral.
- The library already has portable foundations relevant to this topology: `agent-delegate`, `model-router`, `agent-browser`, `dev-browser`, `browser-use`, `context-budget`, `i-have-adhd`, `frontend-design`, `workflow-recall`, `benchmark-campaign`, `eval-debug`, and `open-prose`.
- ADR-0006 says Ponytail was reviewed at `16f29800fd2681bdf24f3eb4ccffe38be3baec6b` and retained as a Builder policy, not dynamically installed as a plugin or lifecycle hook.
- ADR-0007 makes Pi the preferred headless delegate runtime, but keeps tool profiles and explicitly loaded skills separate from personality/prompt text.
- The Pi scoping plan finds no top-level SessionStart hook equivalent. A per-session skill selection therefore requires an external launcher/wrapper or explicit settings/package composition; it should not be smuggled into a normal Acidbath session hook.

### 1.4 Existing tests and checks

Present tests are intentionally pure:

- `scripts/test-context-pyramid.mjs`: 23 assertions; all passed in this review.
- `scripts/test-ui-labels.mjs`: 1,103 assertions; all passed in this review.
- `scripts/bench-tool-render.mjs` and `docs/baselines.md`: useful lower-bound performance and timer-hygiene evidence, but not a real Pi TUI acceptance harness.

`package.json` has no `check`, `test`, or `typecheck` script and no local TypeScript dependency. `npx tsc --noEmit` could not run: the repository has no installed `tsc` binary and `npx` reported that TypeScript must first be installed. This is a repository verification gap, not evidence that the TypeScript compiles.

---

## 2. Current Acidbath correctness review

### 2.1 Borderless editor and header/context placement

**What is sound:** `BorderlessEditor` reuses `CustomEditor` and only removes the first and last rendered rows, preserving Pi editor input and keybindings. The context widget uses the documented-looking `aboveEditor`/`belowEditor` placement shape and is keyed as `acidbath-context`, so `/context` replacement can remove the prior widget before installing a new one. The header has a separate `acidbath-header` key and is TUI-only.

**Risks to verify before calling this stable:**

- Removing the first and last rows assumes every `CustomEditor.render()` output has both border rows at every width and editor state. If Pi emits an empty, one-row, or alternate narrow layout, the implementation can remove editor content rather than only borders. The current pure tests do not exercise the actual `CustomEditor` output.
- `setEditorComponent()` and `setWidget()` are runtime placement APIs. Their real behavior must be observed in a Pi session at widths 40, 60, 80, and 120, not inferred solely from types/source.
- A second `session_start` in one extension lifetime is not guarded: the existing context interval is not stopped before another interval is created, and old widget/header references can survive until shutdown. If Pi guarantees one session per process this is harmless; otherwise it is a leak/duplication risk that should be made explicit.
- `contextPercent`, `activeLabel`, `lastWorkingMessage`, and `automaticState` are not reset at session start/shutdown. Shutdown directly clears `setWorkingMessage`, but does not update `lastWorkingMessage`; a later session can suppress the first message because the churn guard still remembers the old value.
- `ContextPyramidWidget.updateTarget(undefined)` clears the widget and asks for a render, but its construction/startup path needs a real TUI fixture to verify no flicker or stale target when the first context query is unavailable.
- Header metadata is all-or-nothing once it exceeds the width. That is a defensible quiet fallback, but should be an explicit acceptance rule. Width calculations use JavaScript string length rather than terminal display width, so wide Unicode model names or cwd characters can overrun.

### 2.2 Tool renderer ownership and external tools

`ui-tools.ts` registers replacements for seven built-in tool names. It delegates execution and the base Pi renderer, then wraps the rendered call row with a lifecycle glyph. This is a reasonable current ownership model **only if no other extension registers the same tool names**.

Important gaps:

- There is no collision detection or ownership declaration. A second renderer package can register `read`/`edit`/`bash` and silently win, fail registration, or create order-dependent behavior. The package should eventually expose an ownership table and a startup diagnostic rather than assuming exclusivity.
- External tools are not rendered by Acidbath. `interactive_shell`, AST-grep, research, subagent, and future tools receive at most a semantic label if Pi lifecycle events reach `index.ts`; they do not receive the pending/success/error glyph or structured result row.
- Calling `onLabel` during `renderCall` and `renderResult` supplements the lifecycle events already subscribed in `index.ts`. That can produce duplicate state transitions and label churn. Render functions can also be called more than once during redraw, so render-time callbacks should be idempotent and keyed by `toolCallId`, not treated as one-shot lifecycle events.
- The `editedFilesThisTurn` contract exists in `LabelInput`, but no caller maintains the set or resets it at `agent_end`. The advertised “Edited N files” path is therefore not wired in production even though the pure helper tests cover it.
- The wrapper's `definition` is created from `process.cwd()` at extension initialization and then a runtime definition is created from `ctx.cwd` for execution/rendering. This is probably safe because the names are stable, but it is an unnecessary boundary assumption worth testing with a session cwd different from process cwd.
- `NO_COLOR` only suppresses Acidbath's own glyph coloring. Whether the delegated built-in renderers honor the environment is owned by Pi/theme code and needs an acceptance test; Acidbath cannot claim a completely colorless output without checking the child component.

The correct future boundary is a **display decorator/adapter contract**: execution remains owned by each tool package, and Acidbath decorates only when the tool exposes structured metadata or explicitly opts into an Acidbath renderer adapter. Do not make Acidbath know every external tool name.

### 2.3 NO_COLOR, reduced motion, and narrow width

The intent is good and documented in `docs/ui-plan-revisit.md`, `docs/context-pyramid-spec.md`, and `docs/ascii-animation-research.md`:

- `NO_COLOR` removes Acidbath ANSI while preserving shape/text.
- `PI_ACIDBATH_REDUCED_MOTION=1` freezes orb/context/tool motion.
- `PI_ACIDBATH_MOTION_PHASE` makes tool pending frames deterministic.
- Context degrades from a three-row pyramid to a one-line fallback below 28 columns; below eight columns it emits `ctx`.

Missing proof:

- No snapshots or visible-width assertions exist for header, context widget, tool lifecycle rows, or editor at 40/60/80/120 columns.
- No test proves `NO_COLOR` output contains no ANSI when delegated renderers are involved.
- No test proves reduced motion creates zero intervals for the context widget and motion clock across transitions, not just pure frame selection.
- No test covers widths 4, 7, 8, 27, 28, a long Unicode model, a long cwd, or a long tool/result line.
- No test covers a pending call transitioning to success/error while another call remains pending; that is the important shared-clock and cleanup case.

### 2.4 pi-research safety boundary

`docs/pi-research-evaluation.md` reviewed `ameno-/pi-research` at `eb3de4ed13128da3153022fc20579fd83470a19b`. It reports useful `agy_web_search` and `agy_research` tools, but the executor invokes `agy --dangerously-skip-permissions --output-format stream-json` and requires broad AGY `command(*)` permission. It also has unbounded/weakly validated fields, fixed binary paths, malformed-stream fallback behavior, and setup scripts that edit global settings.

Recommendation remains: keep it a separate, explicit opt-in capability. Acidbath may offer generic lifecycle display for it, but must not enable it, invoke it, write its configuration, or imply that a research profile grants permission to execute commands. Acceptance fixtures should prove:

- default Acidbath does not load it;
- an opt-in profile announces the capability and permission boundary before use;
- invalid freshness/depth/results are rejected or clamped;
- cancellation and timeout stop the process;
- streamed progress and final output are bounded/sanitized;
- no setup path mutates global Pi or AGY settings without an explicit human action.

### 2.5 Current test surface and missing acceptance fixtures

Add planning-level fixtures before implementation expands the surface:

1. **TUI placement transcript:** actual Pi session with header, editor, context `off`, `above`, `below`; assert one header, one context widget, no border rows, and no editor content loss.
2. **Width matrix:** render header/context/tool rows at 4/7/8/27/28/40/60/80/120; check terminal display width, truncation, and no accidental wrapping.
3. **Accessibility matrix:** `NO_COLOR=1`, reduced motion, ASCII fallback if supported, and error/success semantics without color.
4. **Lifecycle matrix:** sequential and 16-concurrent calls; partial updates; success/error; redraw/re-render; session shutdown; second session in one process if supported.
5. **Ownership matrix:** Acidbath plus `pi-interactive-shell`, `pi-ast-grep`, and a synthetic external tool; verify Acidbath does not replace external execution/renderers and reports collisions for duplicate built-ins.
6. **Skill topology fixture:** generated Pi skill view points to `/lib` canonical sources, no link is created under `~/.pi/agent/skills`, and a missing/filtered skill produces a visible diagnostic rather than a silent partial topology.
7. **Profile safety fixture:** each profile's expected tool allowlist is asserted at startup; guarded/research/review profiles cannot silently add write, bash, browser, or subagent permissions.
8. **Research boundary fixture:** the `pi-research` checks above, with no live network required for the default test suite.

---

## 3. External candidate research

All candidates were cloned read-only with shallow source pinned at the commit below. All three repositories declare MIT licensing at the reviewed root/plugin level. “Adoption status” means status in the current Acidbath and `/lib` trees, not an upstream quality claim.

### 3.1 Candidate evidence table

| Candidate | Pinned source / license | Runtime assumptions and overlap | Current adoption status | Disposition |
|---|---|---|---|---|
| DietrichGebert/ponytail | `16f29800fd2681bdf24f3eb4ccffe38be3baec6b`, 2026-07-15; root MIT; npm `@dietrichgebert/ponytail` 4.8.4. Pi manifest exposes `./pi-extension/index.js` and `./skills`. | Pi extension uses `before_agent_start`, `session_start`, `agent_start`, `agent_end`, `input`, commands, `appendEntry`, `ui.setStatus`, and optional config writes. Broader package also contains hooks, MCP, multiple host adapters, and Node lifecycle assumptions. The mode/rules policy overlaps `/lib` ADR-0006 and the planned guarded/quiet modes; the status UI and command names can collide less with Acidbath but add another always-on behavioral layer. | Not configured in current Pi settings; policy already adapted into `/lib` ADR-0006 rather than shipped as a dynamic dependency. | **Adapt into `/lib` (partially done); keep upstream external.** Do not vendor the full extension into Acidbath. |
| mattpocock/skills — engineering/wizard | `84fdeffd12f2ee307994d1eb6feb48173b6e0502`, 2026-08-06; root MIT; package is an npm/Claude plugin bundle. | Markdown skill plus generated Bash template. Template can open URLs, read hidden secrets, update `.env`, call `gh`, and perform irreversible writes behind confirmation. No Pi runtime package in the reviewed manifest; portability comes through skills.sh/ordinary files. Overlaps `/lib` configuration skills and one-shot operator workflows. | No matching `/lib` registry entry and no Acidbath copy. | **Adapt into `/lib` only after a safety review; do not make it an Acidbath capability.** Keep one canonical wizard template and keep it user-invoked. |
| mattpocock/skills — engineering/prototype | Same pinned commit/license. | Purely instructional Markdown; UI branch assumes an existing web route and a browser/dev environment, logic branch creates a self-contained throwaway HTML file. Overlaps Acidbath's existing `docs/visuals/*`, `ui-plan-revisit.md`, and `handoff-animation-agent.md`; also complements visual-explainer. | Not in `/lib` or Acidbath. Existing Acidbath prototype work is local documentation, not this skill. | **Adapt into `/lib` as a cross-agent prototype workflow; keep all generated artifacts outside production Acidbath.** |
| mattpocock/skills — productivity/teach | Same pinned commit/license. | Stateful workspace convention (`MISSION.md`, `RESOURCES.md`, lessons, learning records, assets); `disable-model-invocation: true`. No runtime tools, but it creates/updates persistent learning artifacts and can expand repository scope. | Not in `/lib` or Acidbath. | **Keep as external skill** unless a real shared teaching workspace is requested. It is orthogonal to Acidbath and should not be auto-loaded. |
| cursor/plugins — cursor-team-kit/skills/control-ui | `7f00574f7afd6043df8d52e395aeaf6b9a83b668`, 2026-08-07; Cursor Team Kit MIT. | Instructional browser/CDP harness; assumes existing dev server, Playwright/browser tooling or Chromium CDP. It is read-only by intent but can capture screenshots, traces, network logs, and profiles. Directly overlaps `/lib` `agent-browser`, `dev-browser`, `browser-use`, and the configured `agent-browser` skill. | Not in `/lib`; no Acidbath code. | **Adapt into `/lib` / consolidate with `agent-browser`; do not add a second browser skill and do not implement browser automation in Acidbath.** |
| cursor/plugins — cursor-team-kit/skills/pr-review-canvas | Same pinned commit/license. | Requires `gh` API and a local HTML assembly/serve flow; ships a renderer/template/styles and embeds PR patches safely. It produces a review artifact, not a Pi TUI capability. Overlaps `visual-explainer`, but is narrower and PR-specific. | Not in `/lib`; `visual-explainer` is configured but its load status is unresolved. | **Adapt into `/lib` as a PR-review artifact workflow that references visual-explainer; keep the renderer as an optional artifact, not Acidbath runtime.** |
| cursor/plugins — cursor-team-kit/skills/get-pr-comments | Same pinned commit/license. | Assumes a GitHub PR can be resolved from the current branch and `gh` can access review/discussion comments. No runtime dependency beyond CLI/auth. Overlaps `/lib` `github` and review workflows. | Not in `/lib` registry; no Acidbath implementation. | **Adapt into `/lib` `github`/review workflow or keep external until needed; not an Acidbath capability.** |
| cursor/plugins — cursor-team-kit/skills/loop-on-ci | Same pinned commit/license. | Assumes GitHub PR checks and `gh pr checks --watch`; long-running watcher, network/auth, and focused fix loop. Overlaps `/lib` CI/wiki automation and planned review/CI profile. | Not in `/lib`; no Acidbath runtime. | **Adapt into `/lib` as an explicit CI workflow; keep network/watch ownership outside Acidbath.** |
| cursor/plugins — cursor-team-kit/skills/workflow-from-chats | Same pinned commit/license. | Requires access to recent parent/subagent transcripts and a privacy-preserving extraction process. It is a durable workflow-mining method, not a tool. Strong overlap with `/lib` `workflow-recall` and the repository's session/capture practices. | Not in `/lib` under this name. | **Consolidate into `/lib` `workflow-recall`; do not duplicate it in Acidbath.** |
| cursor/plugins — cursor-team-kit/skills/thermo-nuclear-code-quality-review | Same pinned commit/license. | Prompt-only strict maintainability review; no runtime dependency. It encourages structural simplification, decomposition, type/boundary review, and a 1,000-line smell threshold. Overlaps `/lib` quality/review agents and Ponytail's simplification policy, but is more review-specific. | Not in `/lib`; no Acidbath implementation. | **Adapt into `/lib` review guidance after de-duplicating with Ponytail and quality-engineer; not an Acidbath capability.** |
| cursor/plugins — cursor-team-kit/skills/verify-this | Same pinned commit/license. | Requires a falsifiable claim, baseline/treatment artifacts, repeatable measurements, and one of three verdicts. It is a strong general verification protocol with no runtime tool dependency. Overlaps `pi-research`/AGY only at the evidence/output layer, not at the research executor layer; also overlaps `/lib` `eval-debug` and `benchmark-campaign`. | Not in `/lib` under this name; no Acidbath implementation. | **Adapt into `/lib` as a canonical verification contract; Acidbath may expose a status/profile label but must not implement the verifier.** |

### 3.2 Consolidation findings

- **`verify-this` + `pi-research`/AGY:** consolidate the *evidence contract*, not the executor. `verify-this` supplies claim/baseline/treatment/verdict discipline. `pi-research` supplies optional research tools with a high-risk executor. A research profile may require a verification artifact, but should never inherit AGY command permissions merely because it can produce evidence.
- **`pr-review-canvas` + `visual-explainer`:** use one artifact-generation vocabulary. `visual-explainer` is the general renderer; PR review is a specialized content/annotation recipe. Keep the PR-specific workflow outside Acidbath and make it reference the generic visual artifact contract.
- **`control-ui` + `agent-browser`/`dev-browser`:** consolidate browser/CDP harness guardrails and evidence conventions in `/lib`. The Acidbath extension should only consume a generic “external capability status” adapter, not launch a browser.
- **`prototype` + existing prototype work:** the Matt skill provides the operating procedure; Acidbath's `docs/visuals` and context-pyramid artifacts are evidence/decisions. Keep the procedure in `/lib`, keep prototypes as disposable or review artifacts, and do not move prototype HTML into the extension bundle.
- **`ponytail` + optimizer modes:** Ponytail's `lite/full/ultra/off` is a behavioral simplification intensity. It should not become a permission profile or a TUI mode. Reuse its reviewed policy in `/lib`; model an Acidbath guarded/quiet profile separately so “less code” never silently means “more authority.”
- **Ponytail and thermo review:** both reward simplification, but Ponytail is implementation-time discipline while thermo is a harsh review rubric. A canonical `/lib` review skill can reference the policy without loading two always-on prompts.

---

## 4. Topology options

The key axes are: where capabilities are authored, how they are discovered, who owns runtime tools, how modes select them, and how a user rolls back one capability without removing the UI package.

### Option A — Acidbath-focused extension + external skill library

**Shape**

```text
acidbath/                         one published Pi package
  extensions/acidbath/             UI + built-in renderer ownership
  themes/                          presentation only
/Users/ameno/dev/lib/              canonical skills, agents, workflows, locks
  dist/codex|claude|factory/...    generated platform views
~/.pi/agent/skills/                remains globally blocked except explicit entries
```

**Discovery/loading:** Pi loads Acidbath and separately configured package skills. `/lib` deploys other CLIs using its own CLI. Pi skills are either explicit package-manifest paths or a future launcher-provided list; there is no automatic cross-repo discovery.

**Mode selection:** Acidbath can expose UI commands/env toggles (`/orb`, `/motion`, `/context`, compact/quiet settings). Capability selection remains the user's Pi package/skill settings or a wrapper. A mode cannot safely add tools in-band.

**Runtime ownership:** Acidbath owns only its seven built-in wrapper names and its widgets/commands. External packages own browser/research/subagent/CI tools. Skill files never own runtime tools; they describe workflows.

**Collision risks:** low package coupling, but fragmented discovery, duplicate skill names, inconsistent renderer vocabulary, and a user may not know whether an external tool is loaded. Built-in registration collisions remain possible.

**Rollback:** remove Acidbath from `packages` to roll back all UI; remove one external package/skill entry to roll back one capability. `/lib` generated views can be rebuilt without changing canonical content.

**Consistent surface:** weakest of the options unless Acidbath adds a read-only capability catalog/status line and a generic renderer adapter. This is the safest immediate model and preserves focus.

### Option B — Acidbath plus optional capability packages/modes

**Shape**

```text
acidbath-core/                    UI, themes, contracts, built-in decorators
acidbath-capability-research/     opt-in adapter or package; no default load
acidbath-capability-review/       opt-in adapters for review/CI metadata
acidbath-capability-prototype/    optional artifact/display integration
/Users/ameno/dev/lib/              canonical skills and external workflows
```

The repository can remain monorepo-lite and publish one core package plus optional packages only when they have independent install/rollback value. Capability packages should not copy skill content; they can declare which external skill names they expect from `/lib`.

**Discovery/loading:** a profile/launcher resolves a manifest of packages, selected `/lib` skill view, and Pi flags before session start. Acidbath core can show the resolved topology. Missing optional packages degrade to “unavailable” with a diagnostic, not a partial silent load.

**Mode selection:** capability profiles select package/tool/skill sets; UI modes select presentation knobs. Example: `review/CI` loads a review capability package plus read-only `gh`/test tools, while `quiet` only changes rendering. Profile change requires relaunch because tool removal is not safely supported in-band.

**Runtime ownership:** each capability package owns its executor and permissions; Acidbath core owns common lifecycle/event and display contracts; no package may register a tool name already declared by another owner without an explicit conflict result.

**Collision risks:** manifest version skew, duplicate commands, package ordering, and more complex support matrix. A capability package that declares broad tools can undermine a guarded profile unless startup validates the resolved allowlist.

**Rollback:** remove one optional package/profile entry, leave core UI untouched. A profile can pin packages/skill digests and be rolled back to a previous manifest. `/lib` changes roll back by generated view/digest, not by copying files into Acidbath.

**Consistent surface:** strong. Core provides one vocabulary, a topology report, renderer adapter contract, and profile safety assertion while capabilities stay independently governed.

### Option C — distro/monorepo model like pix-mono

**Shape**

```text
packages/
  acidbath-core/                   core contracts + TUI
  acidbath-ui/                     widgets/themes
  acidbath-tools/                  built-in display adapters
  acidbath-research/               opt-in research adapter
  acidbath-review/                 review/CI adapter
  acidbath-browser/                browser adapter
  acidbath-bundle/                 curated default distribution
```

`/lib` remains the canonical skill source, but the Acidbath distro adds a package catalog, lockfile, workspace tests, independent releases, and core/opt-in bundles modeled on pix-mono.

**Discovery/loading:** a distro manifest selects package versions, tool owners, profile capabilities, and `/lib` skill mirror names. A launcher builds explicit Pi `--extension`, `--skill`, tool, model, and thinking arguments, starting from no global discovery. A generated inventory is visible before launch.

**Mode selection:** profiles are first-class distro manifests; UI modes are package configuration. The bundle can provide default/research/review/prototype distributions, but the capability boundary must still be explicit.

**Runtime ownership:** package-level ownership is strongest and testable. Shared contracts could be versioned. This is appropriate if Acidbath becomes a real distribution rather than a UI package.

**Collision risks:** highest: workspace package versions, duplicate extension registration, skill name collisions, cross-package peer dependency compatibility, and a larger release/security surface. A package manager can make a bad capability easy to enable.

**Rollback:** excellent once mature—pin bundle lockfiles and revert one package—but migration/bootstrapping is more complex and may itself mutate settings if poorly designed.

**Consistent surface:** strongest, at the cost of significant infrastructure and operational policy. Pix-mono's package-per-capability boundary is justified by its scale; Acidbath does not yet have that number of independently publishable packages.

### Comparison and recommendation

| Dimension | A: focused + external | B: core + opt-in capabilities | C: distro monorepo |
|---|---:|---:|---:|
| Immediate safety | Highest | High with profile assertions | Medium until infrastructure matures |
| Acidbath focus | Highest | High | Medium/low |
| Consistent user surface | Medium | High | Highest |
| Independent rollback | Medium | High | Highest |
| Discovery complexity | Low | Medium | High |
| Fit to current scale | Best now | Best staged target | Premature |

Recommend **A as the current implementation discipline and B as the target topology**. Do not build C's workspace/installer/lock/bundle machinery now. Promote to C only when optional capabilities have independent release cadence, tests, ownership, and user demand.

---

## 5. Modes, profiles, and skill metadata

These are three different concepts and must not be represented by one overloaded `mode` string.

### 5.1 UI modes

UI modes change presentation only and cannot grant authority:

- `compact`: Acidbath header, semantic orb, inline lifecycle glyphs; context off unless explicitly requested; short labels.
- `quiet`: minimal header or no header, context off, no transient notifications, reduced motion, stable labels.
- `expanded` (future, opt-in): context widget and richer tool summaries; still no new execution permissions.
- `no-color` and `reduced-motion` are accessibility/environment axes, not capability profiles.

`/orb`, `/motion`, and `/context` are existing UI controls. A future `/ui-mode compact|quiet|expanded` may safely switch these presentation choices in-session if it does not add/remove tools.

### 5.2 Capability profiles

Profiles select tools, external packages, skills, network, delegation, and permission posture **before session start**:

| Profile | Intended capability set | Explicit safety boundary |
|---|---|---|
| `research/verify` | read/grep/find/ls; optional browser/research skill; verification artifact workflow; optional bounded subagents | no edit/write/bash by default; network/browser/research are separately declared and approval-gated; `pi-research` remains opt-in and hardened |
| `prototype/design` | read/write workspace only if the user explicitly wants a prototype; `prototype`, `frontend-design`, visual artifact workflow, local browser verification | no deployment/auth/CI mutation; prototypes are disposable; browser uses local/disposable data and an explicit network declaration |
| `review/CI` | read-only inspection, `gh` read operations, test/check tools, review/verification skills; optional `loop-on-ci` watcher | default cannot push, merge, edit, or open a PR; any fix lane is a separate profile or explicit tool approval |
| `guarded/quiet` | read/grep/find/ls; Acidbath quiet UI; no network, write, bash, browser, or subagent fan-out | strongest default for untrusted repos or evaluation; motion frozen and no hidden capability escalation |
| `default` | current day-to-day built-ins, with Acidbath UI and approved baseline skills | preserves Pi's normal user-approved permissions; no silent addition of external executors |

Profile selection should be a launcher/env/config composition that starts from explicit no-discovery defaults and validates the resolved active tool list. It should not pretend that `/profile research` can safely remove already-registered write tools inside a running session.

### 5.3 Skill metadata

Skills are documents/packages, not modes. The canonical `/lib` registry already has name, purpose, domain, scope, entitlement, sync, decision, `build_targets`, and optional match signals. A future Pi-facing view should add or derive metadata such as:

```text
name, source, version, digest, platform targets,
invocation=user|model|explicit, capability=knowledge|workflow|executor-adapter,
required_tools, network=none|local|remote, writes=none|workspace|global,
subagents=none|bounded|unbounded, risk, default_profiles, conflicts
```

This metadata lets a launcher answer “why is this available?” and “what authority does it require?” without embedding skill prose or silently interpreting a skill as permission.

### 5.4 Composition rule

A session is the product of three resolved layers:

```text
presentation = UI mode + theme + NO_COLOR/reduced-motion + width
capabilities = profile + explicit package/tool approvals
knowledge    = /lib skill view + user-invoked external skills + project context
```

Changing presentation must not mutate capabilities. Changing skills must not mutate tool permissions. Changing capabilities requires a new resolved session plan or an explicit approval flow. The status/header should report the active profile and available-but-not-loaded capabilities without claiming that a skill is a loaded tool.

---

## 6. Skill inventory and integration matrix

“Current” means configured/used in the active Pi environment or already adopted in Acidbath/lib documentation. “Additional” means needed to meet the proposed topology, not an instruction to enable it now.

| Skill/capability | Current status | Canonical source | Likely home | Integration mode |
|---|---|---|---|---|
| Acidbath UI | current package | `/Users/ameno/dev/acidbath` | Acidbath | Pi extension; owns header/orb/context/editor and seven built-in display wrappers |
| `agent-browser` | explicit global allowlist; also in `/lib` registry | `/Users/ameno/dev/lib/skills/agent-browser` | `/lib` | generated Pi view later; browser capability stays external/opt-in; Acidbath generic lifecycle adapter only |
| `gotem` | explicit global allowlist; not a current `/lib` registry entry | current Pi skill path | external/local unless promoted | keep separate; content retrieval/storage must not become Acidbath runtime |
| `herdr` | explicit global allowlist; host-specific | current Pi skill/Herdr integration | external/host-specific | keep separate; Acidbath must not absorb multiplexer control |
| `mmx-cli` | explicit global allowlist; host/vendor-specific | current Pi skill path and mmx skill | external/host-specific | keep separate; media/provider tool ownership remains external |
| `react-native-dev` | explicit global/top-level Pi allowlist | current Pi skill path | external or future `/lib` only if normalized | skill only; no Acidbath runtime dependency |
| `pi-interactive-shell` | configured npm package | npm `pi-interactive-shell@0.14.0` | external Pi package | owns interactive shell; Acidbath generic status/label adapter only |
| `pi-ast-grep` | configured pinned package | `code-yeongyu/pi-ast-grep@4a7d1be...` | external Pi package; possible future lib skill companion | owns AST tools and binary controls; Acidbath does not wrap execution |
| `visual-explainer` | configured pinned package, load status unresolved | `nicobailon/visual-explainer@528b71f` | external package | artifact renderer; keep outside Acidbath; verify package loading separately |
| Ponytail policy | adapted in `/lib` ADR-0006; not a current Acidbath package | upstream pinned commit above | `/lib` policy/reference | inject only through explicit delegate/profile policy; no full always-on extension in Acidbath |
| `agent-delegate` | current `/lib` canonical skill | `/Users/ameno/dev/lib/skills/agent-delegate` | `/lib` | generated Pi view and explicit delegation profile; Acidbath renders generic delegated lifecycle |
| `model-router` | current `/lib` canonical skill | `/Users/ameno/dev/lib/skills/model-router` | `/lib` | policy/selection metadata for launcher/delegate; not a Pi tool |
| `codebase-navigation` | current `/lib` canonical skill | `/Users/ameno/dev/lib/skills/codebase-navigation` | `/lib` | baseline knowledge skill in default/review/research profiles |
| `context-budget` | current `/lib` canonical skill | `/Users/ameno/dev/lib/skills/context-budget` | `/lib` | default/review/research guidance; complements Acidbath context widget but does not control it |
| `i-have-adhd` | current `/lib` canonical skill | `/Users/ameno/dev/lib/skills/i-have-adhd` | `/lib` | output-shaping skill; user/model invocation policy, not UI mode |
| `frontend-design` | current `/lib` canonical skill | `/Users/ameno/dev/lib/skills/frontend-design` | `/lib` | prototype/design profile; no Acidbath UI coupling |
| `workflow-recall` | current `/lib` canonical skill | `/Users/ameno/dev/lib/skills/workflow-recall` | `/lib` | consolidate `workflow-from-chats`; user-invoked workflow mining |
| `verify-this` | additional candidate | Cursor pinned source; adapt prose to `/lib` | `/lib` | verification contract used by research/review/eval profiles; no executor |
| `pr-review-canvas` | additional candidate | Cursor pinned source; adapt recipe | `/lib` plus visual-explainer | user-invoked PR artifact workflow; not TUI runtime |
| `control-ui` | additional candidate | Cursor pinned source; consolidate with agent-browser | `/lib` | local browser evidence workflow; external browser runtime |
| `get-pr-comments` | additional candidate | Cursor pinned source; likely merge into `/lib` `github` | `/lib` | explicit `gh` review workflow |
| `loop-on-ci` | additional candidate | Cursor pinned source | `/lib` | explicit network/watch workflow; review/CI profile only |
| thermo review | additional candidate | Cursor pinned source; reconcile with quality guidance | `/lib` or reference-only | user-invoked strict review; no Acidbath tool |
| Matt wizard | additional candidate | Matt pinned source | `/lib` configuration/workflow layer | user-invoked script authoring; never automatic and never package postinstall |
| Matt prototype | additional candidate | Matt pinned source | `/lib` | user/model-invoked design/logic prototype workflow; artifacts disposable |
| Matt teach | optional external | Matt pinned source | external | stateful teaching workspace; no reason to couple to Acidbath |
| `pi-research` | evaluated opt-in, not default | `ameno-/pi-research@eb3de4e...` | external Pi package | separate profile only after safety controls; generic Acidbath display adapter |
| browser/research subagents | additional capability | `/lib` `agent-delegate` + selected external packages | external packages + `/lib` skills | bounded profile; no Acidbath executor |

The matrix deliberately separates skill authorship (`/lib`) from runtime package ownership. A generated Pi mirror should contain only an approved subset, and other CLIs should continue using `scripts/skills deploy <platform>` rather than an Acidbath installer.

---

## 7. Complete Acidbath feature inventory

### Current core

1. **Package/theme distribution:** npm-compatible Pi manifest, peer dependencies, two themes, config examples.
2. **Acidbath header:** theme-colored name, model/cwd metadata, narrow fallback, model-select refresh.
3. **Borderless editor:** Pi `CustomEditor` behavior with top/bottom border removal.
4. **Context pyramid:** pure pressure model, progressive fill/color, percentage, placement command, animated convergence, narrow fallback.
5. **Semantic orb:** six semantic states, manual and automatic modes, `off`/`default`, reduced motion and no-color behavior.
6. **Tool lifecycle motion:** seven built-in tool wrappers, shared pending phase clock, fixed/live motion, success/error glyphs, cleanup.
7. **Deterministic labels:** lifecycle/tool argument mapping, error/partial labels, trailing debounce, same-string guard.
8. **Safety/accessibility switches:** `NO_COLOR`, reduced motion, fixed motion phase, context placement right by default with explicit off/above/below alternatives.
9. **Pure evaluation artifacts:** context and label tests, renderer/motion baseline benchmark, UI/tool research docs.

### Needed to complete the core contract

1. A repository-local typecheck/check command and installed/declared TypeScript verification path.
2. Real TUI acceptance fixtures for editor/header/widget placement and lifecycle cleanup.
3. Render width/ANSI/reduced-motion snapshots.
4. Label event de-duplication and real edited-file aggregation keyed by tool call.
5. Session reset/re-entry handling for state, timers, widgets, and header.
6. Explicit built-in tool ownership/collision diagnostic.
7. Generic external-tool metadata/renderer adapter contract that does not replace external execution.
8. Structured display metadata: duration, exit code, line/match count, diff stats, truncation, source count.
9. Optional summary/preview/collapse behavior only after expansion and timer tests; default collapse should remain off initially.
10. A read-only topology/capability status view that reports resolved profile, loaded skills, missing optional packages, and tool ownership.

### Deliberately not core

- Skill package management, canonical skill content, locks, or global symlink deployment.
- Browser/CDP automation, web search, AGY execution, CI watchers, PR APIs, subagent orchestration, or media generation.
- A general animation engine.
- Automatic global settings mutation or postinstall setup.
- A runtime interpretation of model thinking text as status.

---

## 8. Staged implementation sequence

### Milestone 0 — contract and evidence (now)

- Approve topology B-staged direction and ownership rules.
- Capture the current configured package/skill surface and unresolved load status.
- Add no runtime code yet; keep this report as the architecture gate.

**Exit:** human decisions recorded; no new package or settings changes implied.

### Milestone 1 — core UI correctness

- Add typecheck/check path without relying on a global `tsc`.
- Test the real `CustomEditor`, widget placement, header, and renderer components.
- Reset session state safely and assert timer disposal.
- Add width/no-color/reduced-motion fixtures.

**Rollback:** no topology change; revert only test/contract work.

### Milestone 2 — renderer ownership and external adapter contract

- Define an explicit Acidbath-owned built-in renderer table.
- Make duplicate ownership visible and fail-safe.
- Add a generic display adapter for external tools that supplies structured metadata without taking execution ownership.
- Deduplicate lifecycle/render callbacks and implement real edited-file aggregation.

**Rollback:** retain only current seven wrappers; disable adapter registration.

### Milestone 3 — lib-backed skill discovery

- Human approves a Pi platform in `/lib` and the initial skill roster.
- Extend `/lib` build output to `dist/pi/skills` only as needed; preserve `skills.lock` and validate no package content is duplicated.
- Choose generated Pi mirror over direct canonical paths for durable integration; direct paths may be a temporary development probe only.
- Add selected generated entries to an Acidbath package manifest only after verifying the global `!skills/**` boundary remains intact.

**Rollback:** remove Pi target/manifest entries and discard generated view; do not change canonical skill authorship.

### Milestone 4 — profile launcher and capability packages

- Define a versioned profile manifest with tool allowlists, skill names/digests, package sources, network/write/subagent declarations, and UI defaults.
- Resolve explicit `--extension`/`--skill`/tool/model/thinking arguments from a clean no-discovery baseline.
- Add a read-only `/topology` report and startup self-check. Profile changes relaunch rather than mutate active tools.
- Introduce optional capability packages only where a capability has independent ownership and rollback value.

**Rollback:** launch core Acidbath only; remove optional package/profile entries.

### Milestone 5 — adopted workflows and evidence

- Consolidate approved external workflows into `/lib`: verification, prototype, browser evidence, GitHub review/CI, workflow recall, and safe Ponytail/thermo guidance.
- Enable `research/verify`, `prototype/design`, and `review/CI` as explicit profiles only after safety/acceptance fixtures pass.
- Keep `pi-research` opt-in and separately audited.

**Rollback:** disable profile; retain the skills as user-invoked external documents.

### Milestone 6 — reassess Option C

Only consider a pix-mono-like distro if at least two capability packages are independently publishable, have different release cadence, and share a tested runtime contract. Otherwise monorepo-lite keeps the lower operational risk.

---

# Recommended topology

**Option B, staged from Option A:** one focused `acidbath` core package plus optional, independently owned capability packages/profiles; canonical skills remain in `/Users/ameno/dev/lib`; generated Pi skill views are loaded explicitly through Acidbath/profile composition; other agents use `/lib`'s deploy command. Do not build a distro monorepo/installer yet.

Acidbath owns presentation, built-in display decoration, topology diagnostics, and stable contracts. Capability packages own execution, permissions, network, subagents, browser, research, review, and CI. `/lib` owns skill prose, skill metadata, source versions, build targets, lockfile, and cross-agent deployment.

# Recommended modes

- **UI modes:** `compact`, `quiet`, optional `expanded`; plus orthogonal `NO_COLOR` and reduced-motion axes.
- **Capability profiles:** `default`, `research/verify`, `prototype/design`, `review/CI`, `guarded/quiet`.
- **Skill metadata:** source/version/digest/platform/invocation/required-tools/network/writes/subagents/risk/profile/conflict metadata; not a permission-changing mode.
- UI changes may happen in-session. Capability changes must be resolved before launch/relaunch and must never silently add dangerous permissions.

# Candidate skill disposition table

| Candidate | Disposition |
|---|---|
| Ponytail | Adapt into `/lib`; already partially represented by ADR-0006; keep full upstream external, do not vendor into Acidbath. |
| Matt `engineering/wizard` | Adapt into `/lib` after safety review; user-invoked only. |
| Matt `engineering/prototype` | Adapt into `/lib`; consolidate with existing prototype practice; artifacts stay outside production. |
| Matt `productivity/teach` | Keep external; stateful teaching workspace is orthogonal. |
| Cursor `control-ui` | Adapt/consolidate into `/lib` browser evidence with `agent-browser`/`dev-browser`. |
| Cursor `pr-review-canvas` | Adapt into `/lib` PR artifact workflow referencing `visual-explainer`. |
| Cursor `get-pr-comments` | Adapt into `/lib` GitHub/review workflow when needed. |
| Cursor `loop-on-ci` | Adapt into `/lib` explicit CI workflow; no Acidbath watcher. |
| Cursor `workflow-from-chats` | Consolidate into `/lib` `workflow-recall`. |
| Cursor thermo review | Adapt into `/lib` quality/review guidance after de-duplication. |
| Cursor `verify-this` | Adapt into `/lib` canonical verification contract; no Acidbath executor. |

# First 5 implementation tasks

1. Add a real local typecheck/check path and a Pi TUI acceptance harness for header, borderless editor, context placement, widths, `NO_COLOR`, reduced motion, and shutdown cleanup.
2. Fix/verify lifecycle state ownership: reset session state, stop prior timers on re-entry, key render callbacks by `toolCallId`, deduplicate event/render label updates, and wire edited-file aggregation.
3. Define the built-in renderer ownership table and generic external-tool display adapter; add collision and 16-concurrent-call fixtures without taking ownership of external execution.
4. Obtain human approval for `/lib`'s Pi target and initial skill roster; generate a disposable `dist/pi/skills` view and validate the global blocklist boundary in a throwaway environment, without editing live settings.
5. Specify and prototype (without enabling) profile resolution/self-checks for `default`, `guarded/quiet`, `research/verify`, `prototype/design`, and `review/CI`; prove that UI mode changes cannot alter active permissions and profile changes require relaunch.

# Open decisions requiring human feedback

1. Approve staged Option B versus remaining strictly at Option A for another release; explicitly defer Option C unless the package-count/release criteria are met.
2. Approve the `/lib` Pi platform and choose generated `dist/pi/skills` (recommended) versus direct canonical paths (development-only).
3. Approve the initial Pi skill roster; do not infer it from stale names such as `focused-delivery` or `herdr` if they are absent from the current registry.
4. Decide whether Acidbath should own any additional built-in renderer beyond the current seven, and what Pi API/contract will prevent collisions with external renderers.
5. Decide whether `visual-explainer` is actually loadable in the current settings and whether it remains the generic artifact renderer for PR/prototype/research evidence.
6. Decide whether `pi-research` may ever be enabled after controls, and what exact least-privilege AGY mode, network policy, output cap, timeout, and human approval are required.
7. Decide whether `/topology` is diagnostic-only or may provide a relaunch command; it must not mutate settings implicitly.
8. Decide whether `quiet` hides the Acidbath header entirely or only removes transient labels/notifications; preserve a discoverable status path either way.
9. Decide whether `review/CI` is read-only by default with a separate fix profile, or whether explicit per-tool approvals are sufficient.
10. Decide whether community workflows are merely referenced by `/lib` metadata or copied/adapted into canonical `/lib` skills; preserve upstream attribution and avoid two live authors.

# Changed files and checks run

**Changed by this task:**

- `docs/skills-topology-evaluation.md` (new planning report only).

**Not changed:** production TypeScript, `package.json`, Pi settings, `/Users/ameno/dev/lib`, registry, lockfile, install roots, global settings, or infrastructure.

**Checks/research run:**

- Read the complete requested Acidbath docs/files and relevant `/Users/ameno/dev/lib` registry, manifest, lockfile, platform/package-manager docs/scripts, plus current Pi settings.
- Cloned/read-only reviewed `DietrichGebert/ponytail` at `16f29800fd2681bdf24f3eb4ccffe38be3baec6b`, `mattpocock/skills` at `84fdeffd12f2ee307994d1eb6feb48173b6e0502`, and `cursor/plugins` at `7f00574f7afd6043df8d52e395aeaf6b9a83b668`; reviewed root/plugin MIT licenses and requested skill sources.
- `node --experimental-strip-types --no-warnings scripts/test-context-pyramid.mjs` — passed, 23 assertions.
- `node --experimental-strip-types --no-warnings scripts/test-ui-labels.mjs` — passed, 1,103 assertions.
- `npx tsc --noEmit` — could not run because no local TypeScript compiler is installed; `npx` reported that TypeScript must be installed first.
- `git diff --check` — passed with no whitespace errors.
