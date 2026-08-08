# Handoff prompt: Acidbath UI iteration

Work in `/Users/ameno/dev/acidbath` as a terminal UI designer and Pi TUI
engineer. The parent user will review visuals in a fresh session.

## Read first

- `README.md`
- `docs/feature-inventory.md`
- `docs/ui-plan-revisit.md`
- `docs/visuals/ui-revisit.html`
- `extensions/acidbath/index.ts`
- `extensions/acidbath/ui-header.ts`
- `extensions/acidbath/ui-context-widget.ts`
- `extensions/acidbath/ui-tools.ts`
- `docs/ui-tool-display-research.md`
- `docs/repo-structure-review.md`

## User feedback to implement/prototype

1. Context must be **on by default**.
2. Context should appear on the **right side**, not as another full-width
   block. Preserve an explicit off option.
3. Context animation needs coarse visible granularity: a 3% change must cause
   a perceptible visual change, not disappear in a smooth 0.16-step animation.
4. Remove duplicate information from the editor/footer/header region. Model,
   thinking level, context usage, cwd, and working status should each have one
   clear owner and one visible location.
5. Tool-call UI is currently verbose and unattractive. Explore compact rows,
   collapsed output, structured metadata, clear errors/partials, and adaptive
   diffs.
6. Preserve compact and quiet variants, NO_COLOR, reduced motion, narrow
   widths, and low redraw churn.

## Deliverables

- Prototype at least two right-side context layouts and two compact tool-call
  row layouts in `docs/visuals/` or an extension of `ui-revisit.html`.
- Show 60, 80, and 120 column examples.
- Include an information-ownership table for header, footer, editor, context,
  orb, and tool rows.
- Include example outputs for read, bash, edit, grep, external research, and
  subagent calls.
- Explain why the current header may not be visible in the real Pi TUI.
- Do not wire production behavior until the parent reviews the prototype.
- Run `git diff --check` and relevant pure tests.

## Candidate rendering principles

- Pending: compact semantic indicator plus target/argument summary.
- Success: one-line completion row with duration/count/diff metadata.
- Error: remain visible and expanded enough to explain failure.
- Partial/streaming: never auto-collapse.
- Bash: show command, exit status, duration, and bounded output lines.
- Edit/write: show path and diff statistics; choose unified/split display by
  width.
- External tools: display only through an adapter contract; do not take over
  their execution or registrations.

Report changed files, prototype alternatives, the recommended layout, and
production changes intentionally left unwired.
