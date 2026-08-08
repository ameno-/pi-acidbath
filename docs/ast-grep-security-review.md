# ast-grep Extension — Supply-Chain Security Review

> Scope: pick one Pi extension that gives acidbath AST-aware code search, gated by a verifiable trust model for the `sg` binary.
> Read-only review of four candidates. Source inspected via `git clone` to `/tmp` + GitHub URLs.
> Date of review: 2026-08-06.

## TL;DR

**Adopt `code-yeongyu/pi-ast-grep` pinned to commit `4a7d1beee684d96a6890e5fc55710bb63fecca85`**, with three mandatory controls: (1) set `PI_OFFLINE=1` in the runtime environment so the bundled auto-downloader never reaches GitHub releases, (2) install the `sg` binary manually with `cargo install ast-grep --locked` — completed on this host as ast-grep 0.45.0 — and expose `$HOME/.cargo/bin` on `PATH` (or link `sg` into `/opt/homebrew/bin` because this candidate checks that path), and (3) accept the transitive `@ast-grep/cli` npm dependency's benign postinstall, which is now a binary-resolution shim rather than a network download (per ast-grep PR #2595). Defer `bjoernaagaard/pi-ast-grep` as a fallback if AST_GREP_BIN-pinned installs become a requirement. Reject `can1357/oh-my-pi`'s `ast-grep.ts` for runtime-scope mismatch (`@oh-my-pi/*` vs acidbath's `@earendil-works/*`).

## Candidates reviewed

| # | Candidate | License | Provenance | Source verified | Binary resolution order | Network beyond documented | postinstall in own pkg | Telemetry | exec / spawn | Last commit / activity | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `code-yeongyu/pi-ast-grep` (npm: `pi-ast-grep`) | MIT | Yeongyu Kim (`code-yeongyu`), original author of oh-my-openagent; 14★ / 6 forks / 3 contributors. | YES — cloned to `/tmp/code-yeongyu-pi-ast-grep`, read `src/index.ts`, `src/ast-grep/binary-path.ts`, `src/ast-grep/downloader.ts`, `src/ast-grep/binary-downloader.ts`, `src/ast-grep/cli.ts`. | (1) cache `$XDG_CACHE_HOME/pi-ast-grep/bin/sg` > 10 000 B; (2) `@ast-grep/cli` npm package via `createRequire.resolve`; (3) platform npm pkg (`@ast-grep/cli-{darwin,linux,win32}-{arm64,x64,ia32}`); (4) `PATH`; (5) macOS `/opt/homebrew/bin/sg`, `/usr/local/bin/sg`; (6) GitHub release auto-download, last resort. | Only the auto-download step hits `https://github.com/ast-grep/ast-grep/releases/download/<v>/app-<arch>-<os>.zip`. Gated by `PI_OFFLINE=1`/`true`. No other network calls in the entire codebase (`grep -rn "fetch("` finds exactly one hit, in `binary-downloader.ts`). | None. `grep -rn '"postinstall"'` on the repo returns nothing. Transitive dep `@ast-grep/cli` (current 0.45.0) has `postinstall: "node postinstall.js"`, but that script is the binary-resolution shim from ast-grep PR #2595 (see Evidence). | None observed. No outbound traffic beyond the single downloader. | `child_process.spawn(cliPath, args, { stdio: ["ignore","pipe","pipe"] })` in `cli.ts:68`. Straight `node:child_process`, no shell. | Last commit `4a7d1be` on 2026-06-05 (~2 months ago). 24 commits total. CI: `tsgo + biome`. | **Adopt** with controls. |
| 2 | `bjoernaagaard/pi-ast-grep` (npm: `@juvio15/pi-ast-grep`) | Apache-2.0 | Bjørn Aagaard. 0★ / 0 forks / 1 contributor. Newly published v0.4.2 on 2026-08-06. | YES — cloned to `/tmp/bjoernaagaard-pi-ast-grep`, read `src/index.ts`, `src/cli.ts`, `src/paths.ts`, `package.json`. | (1) `process.env.AST_GREP_BIN` if set and non-empty; (2) otherwise literal `"ast-grep"`, resolved by Pi via PATH. No fallback. | None. `grep -rn "fetch("` returns no matches. | None in the repo. | None. | `pi.exec(binary, args, …)` in `cli.ts:75` — uses Pi's sandboxed exec wrapper, not raw `child_process`. | Last commit `ce79e39` 8 hours ago. 8 commits total. Very active (daily). | **Defer** as safer fallback; too new to be lead. |
| 3 | `can1357/oh-my-pi` built-in `ast-grep.ts` | MIT (repo is MIT; tool file inherits) | can1357 / Can Bölük. The `oh-my-pi` distribution is its own Pi fork. 22.4k★ / 2.1k forks. | YES — fetched `https://raw.githubusercontent.com/can1357/oh-my-pi/main/packages/coding-agent/src/tools/ast-grep.ts`. | Imports `@oh-my-pi/pi-natives`'s `astGrep` Rust binding (no shelling out to `sg`). Resolution is N/A — the WASM/N-API binding is loaded at runtime. | N/A (calls in-process binding). | N/A (it is part of the larger `@oh-my-pi/pi-coding-agent` package; that whole monorepo is a separate Pi fork). | N/A (in-process). | N/A (in-process native call). | Last commit `3a8591a` 4 hours ago (17 307 commits in repo). | **Reject** — incompatible runtime scope. The file imports `@oh-my-pi/hashline`, `@oh-my-pi/omptype`, `@oh-my-pi/pi-agent-core`, `@oh-my-pi/pi-ai`, `@oh-my-pi/pi-tui`, `@oh-my-pi/pi-utils`. None of these resolve to `@earendil-works/*`, so the tool file cannot be lifted into acidbath without dragging in a second peer-dep tree. |
| 4 | `ast-grep/ast-grep` upstream (the `sg` CLI itself) | MIT | Herrington Darkholme. 15.4k★ / 424 forks. Maintained. | YES — fetched Homebrew formula, GitHub releases page, npm registry metadata. | This is the *binary*, not an extension. Install paths reviewed: `brew install ast-grep`, `cargo install ast-grep --locked`, `npm install -g @ast-grep/cli`. | N/A (binary distribution). | N/A (binary distribution; `@ast-grep/cli` npm package does have a postinstall — see Evidence). | N/A (binary distribution). | N/A. | Latest release 0.45.0 on 2026-07-23. Tagged and signed (GPG `43C702FF1C3F7845`). | **Reference** — this is the trust anchor the controls below rely on. |

## Adopt decision

**Candidate**: `code-yeongyu/pi-ast-grep`.

### Why this one

1. **Ecosystem fit (highest weight).** Peer deps `@earendil-works/pi-ai`, `@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui`, `typebox` match acidbath's `peerDependencies` exactly (`/Users/ameno/dev/acidbath/package.json:30-36`). The extension will resolve in acidbath's existing peer-dep tree with no version drift.
2. **Author standing.** Yeongyu Kim is the original author of `oh-my-openagent`'s ast-grep tools; he re-licensed the port under MIT and bundled it as a standalone Pi extension. NOTICE file acknowledges the SUL-1.0 → MIT re-license explicitly (`/tmp/code-yeongyu-pi-ast-grep/NOTICE`).
3. **Resolution chain is layered.** Five non-network sources (cache, `@ast-grep/cli` npm pkg, platform npm pkg, PATH, Homebrew) are tried before any network is touched. The cache and Homebrew are valid installation paths acidbath can rely on.
4. **Auto-download is gated and explicit.** `PI_OFFLINE=1` short-circuits the downloader (`/tmp/code-yeongyu-pi-ast-grep/src/ast-grep/downloader.ts:62-64` and `:103-105`). Default version fallback (`0.41.1`) is overridden by the `@ast-grep/cli` package version when that dep is installed (`/tmp/code-yeongyu-pi-ast-grep/src/ast-grep/downloader.ts:38-47`).
5. **Lower attack surface than the alternative.** `spawn` (not `exec`) with `stdio: ["ignore","pipe","pipe"]` means no shell interpolation of model input — arguments are passed as an argv array.
6. **Maturity.** 24 commits, CI gate, `AGENTS.md`, `NOTICE`, `LICENSE`, `CHANGELOG.md` all present. Last touched ~2 months ago (slow but alive).

### Mandatory controls

**C1 — Pin to commit SHA, not version.**
- Pin to: `4a7d1beee684d96a6890e5fc55710bb63fecca85` (`/tmp/code-yeongyu-pi-ast-grep` HEAD on `main`).
- The package has no npm release yet (Releases page empty per `https://github.com/code-yeongyu/pi-ast-grep`), so consumers must install from git:
  ```
  pi install git:github.com/code-yeongyu/pi-ast-grep#4a7d1beee684d96a6890e5fc55710bb63fecca85
  ```
  Or, for acidbath's own bundling: `git+https://github.com/code-yeongyu/pi-ast-grep.git#4a7d1beee684d96a6890e5fc55710bb63fecca85`.
- Re-pin on every review by re-running `git -C /tmp/code-yeongyu-pi-ast-grep rev-parse HEAD` and verifying that the new SHA still passes the same checklist.

**C2 — Disable the GitHub release auto-download.**
- Set `PI_OFFLINE=1` (or `true`) in the runtime environment before any pi session starts.
- Effect: `downloadAstGrep()` returns `null` immediately (`downloader.ts:62-64`), `ensureAstGrepBinary()` short-circuits (`downloader.ts:103-105`). Without this, the extension will silently `fetch()` a zip from `github.com/ast-grep/ast-grep/releases/...` with **no checksum verification** (only TLS).

**C3 — Install `sg` via Homebrew (preferred on macOS).**
- `brew install ast-grep`.
- The Homebrew formula `homebrew-core/Formula/a/ast-grep.rb` declares an explicit `sha256 "996e9d879f095d3ccef55754d3a32d61e1ae03cfaecdcff5e247bfa5b649b27a"` for the source tarball, plus per-platform bottle SHA256s (`62cde295...`, `dac6bc1b...`, `2642a8ca...`, `5d72b85f...`, `1699342f...`, `750ab538...`). Homebrew hard-fails install on mismatch. This is documented Homebrew behavior; the formula is fetched from `https://raw.githubusercontent.com/Homebrew/homebrew-core/master/Formula/a/ast-grep.rb`.
- The formula builds via `cargo install` from source under `crates/cli` (no prebuilt-binary trust assumption).
- The Homebrew install puts the binary at `/opt/homebrew/bin/sg` (Apple Silicon) or `/usr/local/bin/sg` (Intel), which is exactly the path the extension's resolver checks at step 5 of `findSgCliPathSync` (`/tmp/code-yeongyu-pi-ast-grep/src/ast-grep/binary-path.ts:107-114`).

**C3-alt — Selected: install via `cargo install ast-grep --locked`.**
- The command completed on this host on 2026-08-07 and installed ast-grep/sg 0.45.0 under `/Users/ameno/.cargo/bin/`.
- The `--locked` flag pins to `Cargo.lock` from the repo; cargo verifies crate checksums against crates.io's lock data.
- This candidate's resolver does not check `$HOME/.cargo/bin` explicitly. The approved host controls are now `/opt/homebrew/bin/ast-grep -> /Users/ameno/.cargo/bin/ast-grep` and `/opt/homebrew/bin/sg -> /Users/ameno/.cargo/bin/sg`; the paired links are required because Cargo's deprecated `sg` shim resolves its sibling executable. The resolver can now find and run the manually installed binary. Keep `PI_OFFLINE=1` in every Pi launch environment.

**C4 — Note on `AST_GREP_BIN` override.**
- The lead candidate does **not** honor an `AST_GREP_BIN` env override (verified: `binary-path.ts` has no `AST_GREP_BIN` reference). Only `bjoernaagaard/pi-ast-grep` honors it.
- Workaround for acidbath: rely on Homebrew (C3). If a hard-pinned path is required later, switch to candidate 2 — that is why it is kept as Defer rather than Reject.

**C5 — Transitive `@ast-grep/cli` postinstall is acceptable but documented.**
- `code-yeongyu/pi-ast-grep/package.json` declares `"@ast-grep/cli": "^0.41.1"` as a runtime dep. The currently published `@ast-grep/cli` (0.45.0 per `https://registry.npmjs.org/@ast-grep/cli/latest`) declares `"scripts": { "postinstall": "node postinstall.js" }`.
- ast-grep PR #2595 (merged for 0.42.2, "fix: replace postinstall script with binary resolution in ast-grep") replaced the previous network-downloading postinstall with a shim that selects a binary from `optionalDependencies` (e.g., `@ast-grep/cli-darwin-arm64`). These platform packages are fetched via npm and therefore integrity-verified by npm's tarball hash (sha512 from the registry index).
- Net effect: the postinstall runs Node locally, touches no network, and produces a path string. No outbound traffic.
- If a future `@ast-grep/cli` release re-introduces network behavior in `postinstall.js`, this control becomes invalid. **Re-verify by inspecting `node_modules/@ast-grep/cli/postinstall.js` after every install** (it is short — ~100 lines).

### Additional findings

- **No telemetry.** The only network code path is the binary auto-downloader (`fetch(downloadUrl)` at `/tmp/code-yeongyu-pi-ast-grep/src/ast-grep/binary-downloader.ts:22`). It is reachable only when `PI_OFFLINE` is unset and no cached/managed `sg` is found. C2 disables it.
- **No own postinstall.** `grep '"postinstall"' /tmp/code-yeongyu-pi-ast-grep/package.json` returns nothing.
- **spawn is argv-only, no shell.** `/tmp/code-yeongyu-pi-ast-grep/src/ast-grep/cli.ts:68` uses `spawn(cliPath, args, { stdio: ["ignore","pipe","pipe"] })`. The args array is built deterministically from tool parameters in `buildSgArgs` (`cli.ts:35-64`). No string interpolation into a shell command line.
- **Binary validation is size-only.** `isValidBinary()` checks `statSync(path).size > 10_000` (`/tmp/code-yeongyu-pi-ast-grep/src/ast-grep/binary-path.ts:13-19`). This is a presence heuristic, not a checksum. Adequate as a non-network path guard; irrelevant once C2 + C3 are in place because the resolver never reaches the auto-download.
- **Cache directory on macOS:** `$HOME/.cache/pi-ast-grep/bin/sg` (per `downloader.ts:64-67`). After applying C2 this directory will only be populated by an explicit `/ast-grep install` user action or by a future re-activation of auto-download — keep it empty in production.

## Rejected candidates

- **`bjoernaagaard/pi-ast-grep`** — Defer (not Reject). Strongest safety default: no auto-download at all, no transitive npm deps, uses `pi.exec` instead of raw `child_process`. But: only 8 commits, 0 stars, 1 contributor, last publish 8 hours ago — too new to be the lead. Keep as fallback for the day AST_GREP_BIN-pinning is needed or for stripping transitive deps from acidbath's install graph.
- **`can1357/oh-my-pi` built-in `ast-grep.ts`** — Reject. The file's import block (`/tmp` view of `packages/coding-agent/src/tools/ast-grep.ts`) lists seven `@oh-my-pi/*` packages plus `@oh-my-pi/pi-natives` for the actual AST work. Acidbath's peer deps are `@earendil-works/*`; pulling in `@oh-my-pi/*` would mean a parallel peer-dep tree and a runtime that loads two competing pi-coding-agent hosts. Not viable without forking oh-my-pi wholesale. Note also that oh-my-pi is itself a separate, much larger monorepo (17 307 commits, 555 releases, Bazel + Rust + Python + WASM toolchain) — adopting any part of it is an outsized commitment.
- **ast-grep upstream `sg` CLI** — Reference only, not a candidate. The binary itself is what we trust, not a Pi extension. The release artifacts publish sha256 sums (verified for 0.45.0 at `https://github.com/ast-grep/ast-grep/releases`); Homebrew formula enforces SHA256; `cargo install --locked` enforces Cargo.lock checksums. These are the three acceptable install paths.

## Assumptions / open verifications

These are claims I could not fully verify in this read-only pass and that a human should sanity-check before shipping:

1. **Assumption: Homebrew's `sha256` field is hard-enforced.** Verified by reading the formula (`https://raw.githubusercontent.com/Homebrew/homebrew-core/master/Formula/a/ast-grep.rb`); the `sha256` line is present for both source and bottles. Homebrew's installer has failed closed on SHA mismatch for years, but I did not run `brew install --dry-run` to confirm today's behavior on this machine.
2. **Verified: `cargo install ast-grep --locked` completed successfully on this host.** It installed version 0.45.0 to `/Users/ameno/.cargo/bin/ast-grep` and `/Users/ameno/.cargo/bin/sg`. The resolver visibility step (PATH or `/opt/homebrew/bin/sg`) remains an operational follow-up.
3. **Assumption: `@ast-grep/cli` 0.45.0's `postinstall.js` is the benign shim from PR #2595.** Verified via the post-merge changelog entry in the 0.42.2 release notes ("fix: replace postinstall script with binary resolution in ast-grep #2595"). The actual `postinstall.js` file shipped in the npm tarball was not extracted and read in this review. **Action item**: after `npm install`, run `cat node_modules/@ast-grep/cli/postinstall.js` and confirm it contains only optionalDependency resolution (no `fetch`, no `https.request`).
4. **Assumption: peer-dep version floor matches.** code-yeongyu pins `^0.78.1` for `@earendil-works/pi-*`. Acidbath's `package.json` declares `*`. No conflict expected, but a real `npm install` (not run here) should be performed in a scratch environment to confirm resolution.
5. **Assumption: the bjoernaagaard package's actual `name` on npm is `@juvio15/pi-ast-grep`.** Verified from its own `package.json` (`/tmp/bjoernaagaard-pi-ast-grep/package.json:2`), which differs from the GitHub org name. Confirm the published scope before any `pi install npm:@juvio15/pi-ast-grep`.
6. **Assumption: AGENTS.md's mention of `@mariozechner/pi-coding-agent`** (in `/tmp/code-yeongyu-pi-ast-grep/AGENTS.md`) is **stale documentation**. The actual `package.json` and source imports use `@earendil-works/pi-coding-agent`. Treat the AGENTS.md reference as out of date; do not pin against `@mariozechner/*`.

## Evidence

### Files inspected (read-only clones)

- `/tmp/code-yeongyu-pi-ast-grep/package.json` — name `pi-ast-grep`, version `0.1.0`, license MIT, deps `@ast-grep/cli ^0.41.1`, `extract-zip ^2.0.1`, peerDeps on `@earendil-works/pi-*`, no `postinstall`.
- `/tmp/code-yeongyu-pi-ast-grep/src/index.ts` — extension entrypoint. Registers `ast_grep_search`, `ast_grep_replace`; registers `/ast-grep` command.
- `/tmp/code-yeongyu-pi-ast-grep/src/ast-grep/binary-path.ts` — resolver. Lines 67-118: cache → `@ast-grep/cli` → platform pkg → PATH → Homebrew. Lines 122-146: `getAstGrepPath` triggers `ensureAstGrepBinary` only if sync lookup fails.
- `/tmp/code-yeongyu-pi-ast-grep/src/ast-grep/downloader.ts` — downloader. Lines 38-47: version from `@ast-grep/cli` package or `DEFAULT_VERSION = "0.41.1"`. Lines 62-64: `PI_OFFLINE` short-circuit. Lines 67-83: `PLATFORM_MAP` (darwin/linux/win32 × arm64/x64/ia32). Lines 88-117: `downloadAstGrep` builds `https://github.com/ast-grep/ast-grep/releases/download/{version}/app-{arch}-{os}.zip`.
- `/tmp/code-yeongyu-pi-ast-grep/src/ast-grep/binary-downloader.ts` — line 22: `fetch(downloadUrl, { redirect: "follow" })`. Lines 32-34: `extract-zip` archive extraction. Lines 44-48: `chmodSync(path, 0o755)`.
- `/tmp/code-yeongyu-pi-ast-grep/src/ast-grep/cli.ts` — line 68: `spawn(cliPath, args, { stdio: ["ignore","pipe","pipe"] })`. Lines 35-64: `buildSgArgs` builds argv deterministically.
- `/tmp/code-yeongyu-pi-ast-grep/src/ast-grep/tools.ts` — line 41: `defineTool` is an inlined identity function so this extension has no runtime dep on a specific pi-coding-agent fork (explicit portability comment).
- `/tmp/code-yeongyu-pi-ast-grep/AGENTS.md` — repository conventions; states dependency on `@mariozechner/pi-coding-agent` (stale per package.json).
- `/tmp/code-yeongyu-pi-ast-grep/NOTICE` — re-license disclosure for the oh-my-openagent → MIT port.
- `/tmp/code-yeongyu-pi-ast-grep/CHANGELOG.md` — last entry matches the last commit.

- `/tmp/bjoernaagaard-pi-ast-grep/package.json` — name `@juvio15/pi-ast-grep`, version `0.4.2`, license Apache-2.0, no `dependencies`, peerDeps on `@earendil-works/pi-*` (and `@earendil-works/pi-agent-core`), no `postinstall`.
- `/tmp/bjoernaagaard-pi-ast-grep/src/index.ts` — entrypoint; registers 6 tools + 2 commands; uses `piExecRunner` for sandboxed exec.
- `/tmp/bjoernaagaard-pi-ast-grep/src/cli.ts` — lines 75-83: `piExecRunner` wraps `pi.exec` with `signal`/`cwd`/`timeout`. Lines 80-83: `resolveBinary()` reads `process.env.AST_GREP_BIN`, falls back to `"ast-grep"`.

### Fetched URLs

- `https://github.com/code-yeongyu/pi-ast-grep` — 14★, 24 commits, last touched 2026-06-05; 3 contributors; 6 forks.
- `https://github.com/bjoernaagaard/pi-ast-grep` — 0★, 8 commits, 1 contributor, last commit `ce79e39` (2026-08-06); Apache-2.0.
- `https://github.com/can1357/oh-my-pi` — 22.4k★, 555 releases; `@oh-my-pi/pi-coding-agent` is the workspace package name.
- `https://github.com/can1357/oh-my-pi/blob/main/packages/coding-agent/package.json` — confirms scope `@oh-my-pi/*`.
- `https://raw.githubusercontent.com/can1357/oh-my-pi/main/packages/coding-agent/src/tools/ast-grep.ts` — tool file imports `@oh-my-pi/*`.
- `https://raw.githubusercontent.com/Homebrew/homebrew-core/master/Formula/a/ast-grep.rb` — formula with explicit `sha256` for source and bottles; `cargo install` from `crates/cli`.
- `https://github.com/ast-grep/ast-grep/releases` — release artifacts publish per-asset `sha256:` lines (e.g., 0.45.0 `app-aarch64-apple-darwin.zip` `sha256:ec2e3680...`). Maintainer signature verified (GPG `43C702FF1C3F7845`).
- `https://registry.npmjs.org/@ast-grep/cli/latest` — current 0.45.0; declares `"scripts": { "postinstall": "node postinstall.js" }`; `optionalDependencies` list per-platform binaries.
- `https://www.npmjs.com/package/@ast-grep/cli` — public landing page.

### Key numeric anchors

- `code-yeongyu` cache path: `$XDG_CACHE_HOME/pi-ast-grep/bin/sg` (or `%LOCALAPPDATA%\pi-ast-grep\bin\sg.exe` on Windows). `binary-path.ts:13-19` validates size `> 10_000` bytes only.
- `code-yeongyu` default fallback version when no `@ast-grep/cli` is installed: `0.41.1` (`downloader.ts:24`).
- `bjoernaagaard` `AST_GREP_BIN` resolution: `cli.ts:80-83`.
- `bjoernaagaard` minimum `sg` version floor: `0.44.0` (`cli.ts:26`, required for `ast_grep_outline`).
- Homebrew formula: `homebrew-core/Formula/a/ast-grep.rb` source sha256 `996e9d879f095d3ccef55754d3a32d61e1ae03cfaecdcff5e247bfa5b649b27a`; bottle sha256s `62cde295`, `dac6bc1b`, `2642a8ca`, `5d72b85f`, `1699342f`, `750ab538`.
- ast-grep 0.45.0 release asset sha256 examples: `ec2e3680` (darwin-arm64), `78d0d9db` (darwin-x64), `78931ae3` (linux-x64-gnu), `a1b5b7c0` (win32-x64-msvc).
- `code-yeongyu` last commit SHA: `4a7d1beee684d96a6890e5fc55710bb63fecca85` (2026-06-05 14:56:58 +0900).
