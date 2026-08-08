# Handoff prompt: Acidbath topology, modes, and repository integration

Work in `/Users/ameno/dev/acidbath`. This is the parent implementation prompt
for the next session. Do not change `/Users/ameno/dev/lib`, global Pi settings,
Plane, GitHub Projects, or infrastructure until explicitly approved.

## Product boundary

Acidbath remains a focused Pi presentation/lifecycle extension. It owns:

- the Acidbath header;
- borderless editor presentation;
- context display;
- semantic orb and motion;
- built-in tool display decorators;
- stable display/ownership contracts;
- diagnostic reporting of available capabilities.

It does not own skill prose, browser execution, research execution, subagent
execution, CI orchestration, PR APIs, or the `/lib` package manager.

## Canonical external boundary

`/Users/ameno/dev/lib` is the canonical source for shared skills, agents,
workflows, metadata, and locks. Treat those as external dependencies by
contract, not by absolute runtime import and not by vendoring content into the
Acidbath npm package.

Potential future direction: a generated Pi skill view such as
`/lib/dist/pi/skills`, loaded explicitly by a profile/launcher. Do not create
that infrastructure in this task.

## Three top-level groupings

Do not use the previous authoring/validation/UI taxonomy as the primary model.
Use these three broad groupings:

### Development

Authoring, UI design, optimization, codebase navigation, prototype, browser
work, agent delegation, and implementation workflows.

Relevant skills include:

- `karpathy-guidelines`
- `ux-cognitive-simplicity`
- `ux-learnability-confidence`
- `ux-visual-clarity`
- `i-have-adhd`
- `agent-delegate`
- `prototype`
- `wizard`
- `control-ui`
- `ponytail`

### Validation

Verification, review, CI, issue management, quality, evidence, and research.

Relevant skills include:

- `verify-this`
- `thermo-nuclear-code-quality-review`
- `loop-on-ci`
- `get-pr-comments`
- `pr-review-canvas`
- `plane-cli`
- `pi-research`
- `eval-debug`
- `benchmark-campaign`

### Brainstorming

Ideation, teaching, exploration, visual alternatives, and workflow discovery.

Relevant skills include:

- `teach`
- `workflow-recall`
- `workflow-from-chats`
- `prototype`
- `visual-explainer`
- `agent-browser`
- `context-budget`

A skill may belong to more than one grouping, but its canonical source must
remain singular in `/lib`.

## Modes

Keep UI modes separate from capability profiles.

UI modes:

- `compact`
- `quiet`
- `expanded`

Capability profiles:

- `default`
- `development`
- `validation`
- `brainstorming`
- `guarded`

A UI mode changes presentation only. A capability profile selects skills,
tools, extensions, network, write access, and subagent access before launch.
Do not silently add/remove dangerous tools in an active session.

## Required work

1. Review the current Acidbath implementation and tests.
2. Fix correctness issues before adding new surfaces:
   - session state reset;
   - timer/widget cleanup;
   - render callback de-duplication;
   - built-in renderer ownership diagnostics;
   - width/NO_COLOR/reduced-motion fixtures.
3. Define a display adapter contract for external tools without taking over
   their execution.
4. Define a topology/capability diagnostic report, not an installer.
5. Track planned work through the approved project tracker once credentials and
   project access are available.
6. Keep `/lib` integration as a documented boundary and candidate plan only.

## Do not do yet

- Do not modify `/Users/ameno/dev/lib`.
- Do not add global Pi skills or package settings.
- Do not create a new monorepo/workspace.
- Do not enable `pi-research` by default.
- Do not add every candidate skill as an Acidbath dependency.
- Do not wire unreviewed tool-call UI or animation changes.

## Acceptance

Run pure tests, syntax checks, `git diff --check`, and document all missing
runtime/TUI verification. End with a short list of decisions that require user
feedback.
