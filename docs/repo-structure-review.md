# Acidbath repository structure review

## Current state

Acidbath is currently a single Pi package with a coherent runtime surface:

```text
package.json              Pi package + one extension entrypoint
extensions/acidbath/      header, orb, motion, context, tool wrappers
 themes/                  two installable themes
config/                   settings/keybinding examples
docs/                     design, evaluation, handoff, and visual prototypes
scripts/                  pure tests and benchmarks
```

The active extension owns these surfaces:

- `/orb` semantic working indicator;
- `/motion` deterministic tool lifecycle motion;
- `/context` optional context pyramid placement;
- borderless editor and `acidbath` header widget;
- wrappers for the seven built-in read/write/edit/find/grep/ls/bash tools;
- themes loaded through `themes/*.json`.

Research and companion tools remain separate: `pi-interactive-shell`,
`pi-ast-grep`, `visual-explainer`, and the evaluated-but-not-enabled
`pi-research`.

## Comparison with pix-mono

`pix-mono` is a genuine distribution monorepo: many independently installable
packages, shared runtime/data/pretty layers, a core bundle, standalone opt-in
extensions, workspace tests, static analysis, publishing, and a distro
installer. Its package-per-capability boundary is justified by its size and
release model.

Acidbath is not yet at that scale. Splitting every UI file into a package now
would add workspace/build/versioning overhead without improving user control.
The useful patterns to adopt are:

- a workspace root with explicit package boundaries when a capability is
  independently installable;
- a shared runtime/utilities package only after two or more packages need it;
- core versus opt-in package policy;
- package-local tests plus root typecheck/lint/check;
- publish/install scripts that do not mutate unrelated global configuration;
- a README inventory of package ownership and collision risk.

## Recommendation: monorepo-lite first

Keep the repository publishable as one `acidbath` package for now, but reshape
its source layout toward a future workspace without breaking the Pi manifest:

```text
packages/
  acidbath/                 current published package boundary
    extensions/acidbath/    Pi extension entrypoint and UI modules
    themes/
    config/
  acidbath-toolkit/         only when shared pure renderers become reusable
  acidbath-research/        optional adapter only if a safe research contract exists
```

Do **not** create packages for `ui-header.ts`, `ui-orb.ts`, or each built-in
tool. They are one product surface. First extract only stable, independently
tested pure libraries (frame player, icon catalog, diff/metadata renderer) if a
second package actually consumes them.

A staged alternative is even lower risk: keep the current root package but add
source folders mirroring the eventual boundaries:

```text
src/
  ui/       header, context, orb, motion
  tools/    built-in adapters and metadata renderers
  runtime/  lifecycle/config/registry
  pure/     frame, icons, layout, evaluation helpers
```

Move files only when tests and import paths are ready; do not combine a layout
migration with visual behavior changes.

## Skills and `ameno-/lib`

`/Users/ameno/dev/lib` should remain the canonical skill source and package
manager. Acidbath should not vendor skills, use an absolute `../../lib` runtime
import, or make the published npm package depend on the local checkout.

Preferred boundary:

1. Add a `pi` target to `lib/registry.yaml` when the shared-library owner is
   ready to support Pi explicitly, with an install root such as
   `~/.pi/agent/skills`.
2. Generate a Pi mirror from the existing canonical skills, just as the repo
   already generates Codex/Claude/Factory/Antigravity views.
3. During local development, use an explicit `skills deploy pi` or
   `skills link pi` command that creates symlinks from the generated Pi mirror.
4. In Acidbath, document skills as an external capability and detect/report
   availability; do not copy skill content into the extension bundle.
5. Keep host-specific skills and secrets out of the published Acidbath package.

If modifying `lib` is not desired yet, use a small local-only script outside the
published package to link selected skills into `~/.pi/agent/skills`. Avoid a
Pi package postinstall hook that silently changes global settings.

## Tool-surface review

| Surface | Current state | Recommendation |
|---|---|---|
| Built-in tools | Acidbath wraps seven built-ins and adds lifecycle glyphs | Keep ownership here; next add structured display metadata and width tests |
| `pi-ast-grep` | Separate active package with documented controls | Keep separate; expose status in header/welcome only if useful |
| `pi-interactive-shell` | Separate active package | Keep separate; Acidbath should render generic delegated-tool rows later |
| `visual-explainer` | Separate package and prototype workflow | Keep separate; use it to review Acidbath visuals |
| `pi-research` | Reviewed, not enabled by default | Opt-in only until AGY permissions and output limits are hardened |
| Skills | Canonical in `ameno-/lib` | Add Pi as a generated deployment target, not a vendored dependency |
| Animation | Research-only handoff/prototype | Keep local and dependency-free; no production wiring yet |

## Proposed next milestones

1. Finish the animation concepts with the handoff prompt in
   `docs/handoff-animation-agent.md`.
2. Add a root `check` command that runs syntax/typecheck, pure tests,
   render-width fixtures, and manifest/theme validation.
3. Extract a small tool metadata contract and evaluate all built-in wrappers
   consistently.
4. Decide whether to add `pi` as a target in `ameno-/lib` and create a
   reversible local linking command.
5. Migrate to a workspace only when there are at least two independently
   publishable Acidbath packages or a shared library with a real second
   consumer.
