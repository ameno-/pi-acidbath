# Acidbath-native structural search design

## Decision

Do not add a third-party Pi AST extension or an AST parser package to Acidbath.
The next implementation should be a small local Acidbath tool layer around an
explicitly configured, already-installed `ast-grep` executable. The executable
is an optional engine, not an npm dependency and never an auto-downloaded
artifact.

This keeps the model-facing integration, safety policy, rendering, and
mutation lifecycle under Acidbath control. A future in-process parser can be
considered separately; it would introduce a native/WASM dependency and is not
justified for the first safe version.

## Threat model

Pi extensions execute with the user's permissions. Therefore the threat model
includes:

- a compromised npm package or maintainer account;
- a malicious or replaced AST-grep binary;
- a repository containing symlinks, ignored files, or hostile rule/config data;
- an over-broad model query that returns unbounded output;
- a replacement that races with Pi's `edit`/`write` tools;
- a stale preview being applied after files changed.

The wrapper must fail closed when the binary is missing, untrusted, outside the
configured allowlist, or produces malformed/truncated output.

## Tool surface

### `acidbath_ast_search` (enabled by default)

Read-only structural search. Parameters are intentionally narrow:

- `pattern`, `language`, and project-relative `paths`;
- bounded include globs;
- context line limit and match limit;
- no `--follow`, `--no-ignore`, arbitrary config, or arbitrary command flags.

Use `grep`/`rg` for plain text. Use this only when syntax structure matters.

### `acidbath_ast_preview` (enabled by default)

Read-only rewrite preview. It runs AST-grep with `--rewrite` and JSON output,
then returns bounded per-file replacements and a preview fingerprint. It never
passes `--update-all` and never writes files.

### `acidbath_ast_apply` (not active by default)

Registered by the same local extension but excluded from the initial active
tool set. `/ast-grep enable-replace` must:

1. wait for Pi idle;
2. show the exact capability and project root;
3. require interactive confirmation;
4. activate the apply tool only for the current session.

Apply requires a matching preview fingerprint, unchanged file hashes, trusted
project state, and a second confirmation in TUI mode. It is unavailable in
print/JSON mode unless an explicit non-interactive approval flag is supplied by
the user at process launch.

## Binary trust and process policy

- No npm package for AST-grep.
- No GitHub release download, archive extraction, or install command.
- Require `PI_ACIDBATH_AST_GREP_BIN` or a path selected through an explicit
  setup command; do not search arbitrary `PATH` entries silently.
- On setup, resolve and record the real path, version, and SHA-256 digest after
  user confirmation. Refuse execution if the file changes unexpectedly.
- Spawn with an argv array and `shell: false` semantics. Do not interpolate
  patterns, paths, globs, or rewrites into a shell string.
- Use a timeout, abort signal, bounded stdout/stderr, and kill on overflow.
- Use a minimal environment and the session cwd.
- Reject symlinks and paths whose real path escapes the project root. Never
  follow symlinks by default. Exclude `.git`, `node_modules`, and the agent
  state directory unless explicitly added later with a separate policy.

## Safe apply algorithm

1. Canonicalize and validate all target paths under `ctx.cwd`.
2. Run a bounded preview with `--pattern`, `--rewrite`, `--lang`, JSON output,
   and no write flag.
3. Parse only the documented JSON shape. Reject malformed, truncated, or
   overlapping ranges.
4. Read each target file and compute a SHA-256 hash.
5. Build replacement buffers from byte offsets, applying matches in descending
   offset order. Do not ask the AST-grep process to write files.
6. Show the exact file list, counts, and diff preview to the user.
7. Store a session-local fingerprint containing binary digest, cwd, language,
   pattern, rewrite, globs, file hashes, and replacement ranges.
8. On apply, require the same fingerprint and re-check every file hash.
9. Apply each file through Pi's per-file mutation queue using an atomic
   same-directory temp-file write plus rename.
10. Re-run the read-only structural query and report remaining matches. On any
    verification failure, stop before touching later files and report the
    completed file set.

A future transaction layer may add backups/rollback. It should not pretend
that multi-file replacement is atomic unless it can actually restore every
file after a partial failure.

## Why not the reviewed packages

- `code-yeongyu/pi-ast-grep` contains a last-resort GitHub binary downloader;
  the inspected downloader follows redirects, writes an archive, extracts it,
  and chmods the binary without an artifact digest check. Rejected.
- `bjoernaagaard/pi-ast-grep` had stronger rewrite controls, but it is still a
  third-party Pi extension with process and filesystem authority. It was not
  security-audited or provenance-verified before the attempted install.
  Rejected as a direct dependency.
- Official `@ast-grep/napi`, tree-sitter, and WASM bindings remain dependency
  options, not defaults. They add native/WASM supply-chain and crash-surface
  considerations that are unnecessary for the first search-only layer.

## Validation gates before implementation lands

- static review and dependency/license inventory for Acidbath itself;
- unit tests for path, symlink, range, fingerprint, truncation, and approval
  gates;
- fixture tests across TypeScript, JavaScript, Python, Rust, and JSON/YAML;
- binary replacement tests using a fake fixed-path executable;
- concurrent edit/write/rewrite queue tests;
- cold/hot latency and bounded-memory measurements against `rg` and the system
  `ast-grep` binary;
- interactive, RPC, print, and JSON-mode behavior checks.
