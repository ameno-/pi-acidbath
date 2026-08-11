# Dependency and extension security inventory

Audit date: 2026-08-11

This is a behavior/provenance review, not a proof that any package is benign.
`npm audit` only reports known advisories; it does not detect malicious source,
maintainer compromise, or dangerous intentional capabilities.

## Active Pi packages after cleanup

`pi list` now reports only the local Acidbath package:

- `../../dev/acidbath`

The configured `code-yeongyu/pi-ast-grep`, `pi-interactive-shell`, and
`visual-explainer` entries were removed from `/Users/ameno/.pi/agent/settings.json`.
Their global extension/theme material was moved to
`~/.pi/agent/backups/pi-global-cleanup-2026-08-11/` rather than destroyed.

## Findings

| Package | Observed privileged behavior | Assessment |
|---|---|---|
| `pi-interactive-shell@0.14.0` | Spawned configured shells/PTYs, passed environment, and intentionally ran arbitrary interactive commands | Removed from the active global package set; retained only in package-manager history/backups if present. |
| `visual-explainer@528b71f` | Wrote validated HTML under `~/.agent/diagrams` and optionally opened it with the platform browser. Generated HTML could load CDN resources when opened. | Removed from the active global package set; source retained in the separate git checkout only if independently needed. |
| `pi-research` | Runs a fixed AGY executable with fixed argv and a timeout; performs web research through that executable | High capability by design. Review AGY separately; it is not an npm postinstall/download behavior. |
| `pi-web-access@0.20.0` | Performs network requests; GitHub tools invoke `gh`/`git`; Chrome-cookie support invokes platform credential/database helpers | Sensitive intentional capabilities. Keep enabled only because they are part of the approved web/research composition; do not classify as a generic-safe dependency. |
| `code-yeongyu/pi-ast-grep` | Resolved binaries through cache/npm/PATH/Homebrew and had a last-resort GitHub release download; source explicitly documented no checksum beyond TLS | Removed. This is not evidence of malicious intent, but it is unacceptable as an unreviewed Pi dependency for this project. |

## Checks performed

- Root Acidbath production dependency audit: no known advisories.
- Retrospective candidate audit of `bjoernaagaard/pi-ast-grep`: no known npm
  advisories in its lockfile; this does not clear the extension itself.
- Static inspection of active extension/package sources for lifecycle hooks,
  remote binary downloads, shell execution, credential access, and file writes.
- Pi package inventory via `pi list` after removing the AST-grep entry, interactive shell, and visual explainer.
- Global npm tree pruning and audit after removing the orphaned Plannotator and
  screenshot-picker install; it is now empty and reports zero advisories.

## Policy

- No third-party Pi extension is added without source, provenance, lockfile,
  lifecycle-script, dependency, and capability review.
- No package with automatic binary download is accepted by default.
- New tools should be built inside Acidbath where practical.
- Network access, shell access, browser-cookie access, and file mutation are
  individually documented capabilities, not treated as harmless because an
  audit command is clean.
