# AST-grep evaluation

## Current finding

AST-grep is not currently a Pi mode problem. The host has `ast-grep 0.45.0`
installed at `/opt/homebrew/bin/ast-grep`, but the configured `pi-ast-grep`
package is an object-form global package entry and Pi reports it as filtered.
Acidbath does not currently load an AST-grep extension.

## Candidate comparison

| Candidate | Search | Rewrite safety | Process/security | Recommendation |
|---|---|---|---|---|
| `code-yeongyu/pi-ast-grep` | Focused `ast_grep_search`; good structured output | `ast_grep_replace` is dry-run by default, but `dryRun=false` applies directly without a human confirmation; paths are broadly accepted | argv-based CLI, bounded output, but includes a last-resort GitHub binary download | Good search reference; do not enable mutation unchanged |
| `bjoernaagaard/pi-ast-grep` / `@juvio15/pi-ast-grep` | `run`, `scan`, `outline`, language catalog; bounded matches, context, threads | Rewrite defaults to preview, records a preview fingerprint, requires the matching preview before headless apply, and uses Pi's file mutation queue | Explicit argv CLI, bounded schemas, deterministic PATH/env resolution, no auto-download | Safest current extension candidate; prefer after compatibility smoke test |
| `oh-my-pi` native AST tools | Fast in-process structural search/edit | Separate read and edit permission surfaces; native implementation avoids CLI/IPC | Not compatible as a dependency: it uses a separate `@oh-my-pi/*` runtime | Reference only |
| Raw `sg` CLI | Fast and reliable for local execution | No Pi-level confirmation, preview bookkeeping, or mutation queue | Safe only when wrapped with argv, path bounds, output caps, and a trusted binary path | Engine only, not the model-facing integration |
| Plain `grep` / `rg` | Best for literal text and regex | No structural rewrite | Mature and fast, but syntax-blind | Keep for text search; AST-grep is complementary |

## Proposed Acidbath policy

1. Load AST-grep search by default in the single full-development composition.
2. Prefer `bjoernaagaard/pi-ast-grep` if its Pi 0.84 compatibility smoke test
   passes; otherwise adapt its safety patterns into a small local wrapper.
3. Keep rewrite visible as a preview-capable tool, but require all of:
   - an explicit `apply: true`/`dryRun: false` request;
   - a matching preview fingerprint from the same session;
   - Pi's mutation queue;
   - a user confirmation when a TUI is available;
   - cwd/path and symlink boundary checks.
4. If mutation is disabled entirely, expose search only. Enabling mutation
   should be a deliberate `/ast-grep enable-replace` action followed by a
   fresh Pi reload, or an explicit environment setting at launch. Do not
   silently add write authority in-band.
5. Keep `grep`/`rg` for plain text. The model should choose AST-grep only when
   the query depends on syntax structure.

## Speed evaluation

Measure the same repository fixture with `rg`, `ast_grep_search`, and the
candidate's `run` tool at 1, 10, and 100 matches. Record cold process start,
hot process time, serialization time, output bytes, and end-to-end Pi tool
latency. Search speed should be compared separately from replacement safety;
fast structural search is not a reason to weaken mutation controls.
