# Acidbath harness

Non-visual Pi extension at `extensions/harness/`. Acidbath keeps UI ownership.
The bash-result `compactor` extension stays independent.

Tracked as Beads `acidbath-9ih` / Linear [MIGHT-493](https://linear.app/acids/issue/MIGHT-493/acidbath-integrate-omp-inspired-harness-capabilities).

## Commands

| Command | Purpose |
|---|---|
| `/handoff [goal]` | Generate a structured handoff, edit it, open a child session. Never auto-submit. |
| `/recap [focus]` | Persist a custom session entry (not LLM context). |
| `/role [list]` | Show the active model/role, every role with its description, thinking level, availability, the fallback chain, and the cycle. |
| `/role models [query]` | Browse the live model catalog: human name, context window, cost per Mtok, reasoning/vision flags. Search matches provider, id, and name; typos get "did you mean" suggestions. |
| `/role set [alias\|provider/model[:thinking]]` | Switch the session model. Bare `/role set` opens an interactive picker (TUI/RPC). Direct `provider/model:high` selectors skip the registry for one-off switches. Every switch is verified: it is refused if the live model did not change. |
| `/role next` | Cycle to the next role in the configured cycle (default `smol → default → slow`), skipping entries whose model is unavailable. |
| `/role cycle [a,b,c]` | Show or set the cycle order that `/role next` walks. |
| `/role add` | Bare `/role add` runs a guided flow (name → filter → pick model → thinking → description → switch now). With arguments: `/role add <alias> <provider/model> [thinking] [description]`. |
| `/role remove <alias>` | Remove a role (also drops it from the cycle and the saved active selector). |
| `/role info <alias>` | Full detail for one role: resolved model line, cost/context, thinking, tools, availability, fallback/cycle membership. |
| `/role clear` | Restore the pre-role model, thinking level, and tools snapshot. |
| `/role resolve <alias>` | Dry-run resolution without switching. |
| `/magic list\|add <word> [--raise] [hint]\|remove <id>\|enable <id>\|disable <id>` | Add exact-prose keywords. Adding or enabling a word turns matching on; disabling the last enabled word turns it off. |
| `/agents [list\|run <name> <task>]` | Core subagent substrate, no delegation policy. |

### Magic words

Keywords match only as exact lowercase standalone prose tokens. Fenced code
is ignored in every form — backtick and tilde fences, indented and
info-string variants, and fences left unterminated mid-edit, which mask to
the end of the prompt rather than leaking their contents as prose. Inline
code, paths, file extensions, and HTML tag spans are masked too, while
ordinary prose and identifiers that merely contain a keyword (`task-item`,
`risk-analysis.py`) are left alone.

A matched keyword appends `[magic:<id>] <hint>` to the system prompt; the
user's text is never modified. Hints never outlive their turn: both `input`
and `agent_settled` reset pending matches, so an aborted turn cannot leak
its hints into a later, unrelated prompt. A keyword marked `raiseThinking`
lifts the level to `high` for that turn and restores the previous level when
the turn settles.

### Role workflow

Roles are named model bundles (model + optional thinking level + optional
tool restriction) kept in `~/.pi/agent/acidbath/roles.json`. The intended
loop, in the order a person actually uses it:

1. **Discover** — `/role models sonnet` shows what exists and what it costs.
2. **Bind** — `/role add` (guided picker, or typed
   `/role add fast ap-codex/gpt-5.6-sol low quick hops`) creates the alias.
3. **Switch** — `/role set` opens the picker; `/role set fast` or
   `/role next` flips models without ceremony; a direct
   `/role set anthropic/claude-opus-4-1:high` works without any alias.
4. **Trust** — every switch verifies the live model changed, persists the
   active selector for the next session, and `/role clear` restores the
   exact pre-role snapshot.
5. **Wire features** — subagent profiles (`agents.json` `role` fields) and
   Codex compaction (`compact` role) consume named roles, so one alias
   change re-routes the whole harness.

## Tool

- `subagent` — bounded isolated Pi SDK session. Parallel only when explicitly requested. No nested fan-out by default.

### Agent run semantics

Every run returns a result envelope with a stable `error.code`, surfaced in the
UI as `[<agent> <traceId> error] <code>: <message>`.

| Code | Meaning |
| --- | --- |
| `unknown_agent` | No profile by that name in the registry. |
| `nested_not_allowed` | Profile has `allowNested: false` and the call was nested. |
| `project_confirm_required` | Project-sourced profile needs a TUI confirmation that this host cannot show. |
| `cancelled` | The caller aborted, or the project confirmation was declined. |
| `timeout` | The profile's `timeoutMs` elapsed. |
| `role_unavailable` / `model_unavailable` | The profile's role resolved, but its model is not registered. |
| `execution_failed` | The run threw, or the provider returned an error turn. |

Two details worth knowing:

- **Provider failures are not silent.** When a model call fails, Pi does not
  throw out of `prompt()`; it lands as an assistant message with
  `stopReason: "error"` and empty content. That is promoted to an
  `execution_failed` envelope carrying the provider's own message, rather than
  reported as a successful run with no output.
- **An empty reply is not an error.** A reply with no text and no error stays a
  success and renders as `(no output)`.

Preflight (unknown agent, nested policy, project confirmation, cwd policy),
fan-out clamping, result extraction, redaction, and error description are pure
functions in `extensions/harness/agents.ts` and covered by
`scripts/test-harness-agents.mjs`.

Boundaries: `parallel[]` is capped at 8 items (the schema rejects more before
the runner sees them), concurrency is `min(registry maxConcurrency, batch
size)`, and output is truncated to the profile's `maxOutputChars` with an
explicit `[...N chars omitted...]` marker. Returned text is scrubbed of
OpenAI, Anthropic, AWS, GitHub, Google, and Slack credentials, bearer tokens,
and `key=value` credential assignments.

## Config

- `config/roles.example.json` — starter role aliases and the `cycle` order. Runtime edits are saved to `~/.pi/agent/acidbath/roles.json`, or `PI_ACIDBATH_ROLES_PATH`. A registry that fails to parse is never swallowed silently: `/role list` shows the built-in defaults *and* the parse error with its file path.
- `config/magic.example.json` — starter keyword table, matching off. Added keywords are saved to `~/.pi/agent/acidbath/magic.json`, or `PI_ACIDBATH_MAGIC_PATH`. The registry is also recorded in the session transcript, so resuming a session keeps keywords added mid-session.
- `config/agents.example.json` — agent profiles and concurrency ceiling. Override with `PI_ACIDBATH_AGENTS_PATH`.
- `PI_ACIDBATH_CODEX_COMPACT=1` — opt-in Codex-session compaction via `modelRegistry.complete` and native fallback. The gate accepts `openai-codex`, any provider whose final path segment is `codex` (so gateway-namespaced `ap-codex` works), and a codex-named model on an OpenAI-ish provider. Every skip notifies before falling back.

## Tests

Run with Node 22 or 24 (`--experimental-strip-types`). System Node 20 is insufficient.

## Prompt injection boundary

`/recap`, `/handoff`, and Codex compaction all summarise or compress text the
user (or a tool, or a pasted document) produced, and all three interpolate
that untrusted text beneath their own structural delimiters. Left alone,
content reading `## Goal`, `---`, or `Conversation so far:` is parsed as
prompt framing rather than as data, letting session content pose as
instructions to the model doing the summarising.

All three now fence the untrusted region between explicit `BEGIN`/`END`
markers, label it as data-not-instructions, and restate the framing after it.
Lines inside the region that imitate a structural delimiter are prefixed with
a zero-width joiner, which changes the line's identity without altering what
it means. Ordinary content passes through untouched.

## Known limitations

- Compaction and `/handoff` both fall back to Pi's native behaviour on
  failure. The fallback path now notifies, but a Codex session with an
  unavailable `compact` role will warn on every compaction rather than once.
- The persisted-state validators are module-private, so they are exercised
  through live sessions rather than unit tests.
- Screenshot capture for evidence requires the `true-input` backend and a
  Wayland compositor; this environment has neither, so live verification is
  captured as terminal transcripts.

## ADRs

`docs/decisions/adr-0001.md` through `adr-0006.md`, each with an amendment
describing the hardening pass.
