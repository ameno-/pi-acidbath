# AST-grep evaluation

## Current finding

AST-grep is not currently loaded by Acidbath. The host has `ast-grep 0.45.0`
installed at `/opt/homebrew/bin/ast-grep`, but the previously configured
third-party `pi-ast-grep` entry was filtered by Pi. The attempted npm candidate
was uninstalled without being retained as a dependency. The current direction
is the dependency-free Acidbath-native wrapper described in
`docs/ast-grep-native-design.md`.

## Candidate comparison

| Candidate | Search | Rewrite safety | Process/security | Recommendation |
|---|---|---|---|---|
| `code-yeongyu/pi-ast-grep` | Focused `ast_grep_search`; good structured output | `ast_grep_replace` is dry-run by default, but `dryRun=false` applies directly without a human confirmation; paths are broadly accepted | argv-based CLI, bounded output, but includes a last-resort GitHub binary download | Good search reference; do not enable mutation unchanged |
| `bjoernaagaard/pi-ast-grep` / `@juvio15/pi-ast-grep` | `run`, `scan`, `outline`, language catalog; bounded matches, context, threads | Rewrite defaults to preview, records a preview fingerprint, requires the matching preview before headless apply, and uses Pi's file mutation queue | Stronger controls than the other candidate, but still an unaudited third-party Pi extension with filesystem/process authority | Reject as a direct dependency; retain patterns as design reference |
| `oh-my-pi` native AST tools | Fast in-process structural search/edit | Separate read and edit permission surfaces; native implementation avoids CLI/IPC | Not compatible as a dependency: it uses a separate `@oh-my-pi/*` runtime | Reference only |
| Raw `sg` CLI | Fast and reliable for local execution | No Pi-level confirmation, preview bookkeeping, or mutation queue | Safe only when wrapped with argv, path bounds, output caps, and a trusted binary path | Engine only, not the model-facing integration |
| Plain `grep` / `rg` | Best for literal text and regex | No structural rewrite | Mature and fast, but syntax-blind | Keep for text search; AST-grep is complementary |

## Acidbath policy

1. Do not add a third-party AST-grep Pi extension or parser dependency.
2. Build the model-facing tools inside Acidbath around an explicitly trusted,
   already-installed system binary, with no download fallback.
3. Enable read-only structural search and preview by default.
4. Keep replacement inactive until `/ast-grep enable-replace` and require the
   preview, hash, path, queue, and confirmation gates in
   `docs/ast-grep-native-design.md`.
5. Keep `grep`/`rg` for plain text. The model should choose AST-grep only when
   the query depends on syntax structure.

## Speed evaluation

Measure the same repository fixture with `rg`, `ast_grep_search`, and the
candidate's `run` tool at 1, 10, and 100 matches. Record cold process start,
hot process time, serialization time, output bytes, and end-to-end Pi tool
latency. Search speed should be compared separately from replacement safety;
fast structural search is not a reason to weaken mutation controls.
