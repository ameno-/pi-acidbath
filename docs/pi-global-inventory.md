# Pi global inventory

Audit date: 2026-08-11

## Runtime package set

`pi list` now reports exactly one user package:

```text
../../dev/acidbath -> /Users/ameno/dev/acidbath
```

Removed from the global package set:

- `code-yeongyu/pi-ast-grep`
- `npm:pi-interactive-shell@0.14.0`
- `visual-explainer@528b71f`
- orphaned `@plannotator/pi-extension`
- orphaned `pi-screenshots-picker`
- orphaned `eko24ive/pi-ask` checkout

The global npm install root is now empty apart from npm metadata and reports
zero audit vulnerabilities. The old global extension files and custom themes
were moved, not deleted, to:

```text
/Users/ameno/.pi/agent/backups/pi-global-cleanup-2026-08-11/
```

## Resource policy

`~/.pi/agent/settings.json` now has:

- `packages`: local Acidbath only;
- `extensions`: no active global extension material;
- `skills`: all global skills excluded from Pi loading;
- no custom global theme selection;
- prompts remain excluded.

Global skill files remain on disk for possible later review, but they are not
visible to Pi under the current resource filters.

## Acidbath project dependencies

The project package itself currently declares only:

- `pi-research` pinned to a specific git commit;
- `pi-web-access@0.20.0`;
- TypeScript as a development dependency.

Pi core packages and TypeBox are peer dependencies. The project production
audit reports zero known advisories.

## Deliberately untouched settings

Provider definitions, model defaults, credentials, transport, session history,
and Pi's own installed CLI were not deleted during this package cleanup. They
are configuration/data rather than extension packages and need a separate
explicit reset decision to avoid destroying working authentication or provider
setup.

## Maintenance rule

Use the local Acidbath package as the only global package entry. Add new
third-party packages only to a project-local manifest after source/provenance,
install-script, dependency, capability, and audit review. For experiments, use
`pi -e` or a temporary package without adding it to global settings.
