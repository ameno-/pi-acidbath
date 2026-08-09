# Acidbath ↔ lib skills integration

Status: **design only**. No skill files, registry entries, install roots, or
symlinks were changed by this session.

## Facts from the current lib repository

| Fact | Evidence |
|---|---|
| Canonical source is `/Users/ameno/dev/lib/skills` plus the repo's supported top-level package roots. | `/Users/ameno/dev/lib/scripts/skills_lib/__init__.py` (`PACKAGE_ROOTS`) |
| The registry currently has 54 entries and platform keys `agent-skills`, `codex`, `claude`, `factory`, and `antigravity`. | `/Users/ameno/dev/lib/registry.yaml` (verified locally) |
| No `pi` platform exists yet. | `/Users/ameno/dev/lib/registry.yaml` |
| Every ordinary shared skill currently targets the four non-Pi agent platforms; no entry currently lists `pi` in `build_targets`. | `/Users/ameno/dev/lib/registry.yaml` |
| `scripts/skills build` delegates to `scripts/build-skills.py`. The builder creates `dist/<platform>/skills/<name>` symlinks to canonical sources. | `/Users/ameno/dev/lib/scripts/skills`, `/Users/ameno/dev/lib/scripts/build-skills.py` |
| `scripts/skills deploy <platform>` symlinks directly from the canonical package directory into that platform's install root. | `/Users/ameno/dev/lib/scripts/skills_lib/__init__.py`, `cmd_deploy` |
| Pi supports package `skills/` directories and `pi.skills` entries in `package.json`; a package skill directory is recursively discovered. | Pi `docs/skills.md`, from the installed `@earendil-works/pi-coding-agent` checkout under the visual-explainer cache |
| The lib registry does not currently contain `focused-delivery` or `herdr`. | Exact-name lookup in `/Users/ameno/dev/lib/registry.yaml` |

The last fact matters: the old PLAN example names skills that are not
currently lib-managed. They must not be added to an acidbath manifest until
there is a real canonical lib entry and source directory.

## Proposed ownership model

1. **Author once in lib.** Skill content, references, assets, frontmatter,
   registry metadata, and `skills.lock` remain owned by `/Users/ameno/dev/lib`.
2. **Add a Pi build target in lib.** Add a `pi` platform definition to
   `registry.yaml`, with no global install root. Add `pi` to `build_targets`
   only for skills approved for Pi. The first candidate set should be decided
   from actual registry entries (for example `karpathy-guidelines`), not from
   stale PLAN names.
3. **Generate a Pi view.** Extend the registry/build path so
   `scripts/skills build` produces `dist/pi/skills/<name>` symlinks. This keeps
   the generated view disposable and makes the source-to-view relationship
   inspectable. `skills.lock` remains the integrity record for the canonical
   package content; the Pi view must not become a second authoring location.
4. **Deploy other agents through lib.** Prefer the existing lib command:
   `~/dev/lib/scripts/skills deploy codex`, `deploy claude`, or `deploy factory`.
   Do not create an acidbath-owned copy or a second symlink manager. If a
   wrapper is eventually needed, it should invoke the lib CLI and record no
   independent skill inventory.
5. **Keep Pi global discovery blocked.** Do not place Pi links under
   `~/.pi/agent/skills/`. Acidbath's package manifest is the intended scoped
   surface, while global settings continue to use `!skills/**` plus its
   explicit allowlist.

## `dist/pi` mirror vs direct canonical links

This is the remaining human decision. Both options preserve lib ownership, but
they have different failure modes.

### Option A — manifest points to `lib/dist/pi/skills` (recommended contract)

- `lib` owns the generated Pi view and its platform filtering.
- `acidbath/package.json` points `pi.skills` at the generated Pi view (or at
  explicit generated skill paths).
- `scripts/skills build` is the required preflight after registry changes.
- The manifest path is host/repository-specific unless Pi package metadata is
  later made relocatable; this is suitable for the current local umbrella but
  not sufficient for publishing acidbath as a standalone portable package.
- Because the generated entries are symlinks, the view is cheap to rebuild and
  cannot silently become a second skill source.

Illustrative local-only manifest shape (not to apply yet):

```json
"skills": [
  "/Users/ameno/dev/lib/dist/pi/skills/karpathy-guidelines"
]
```

A single directory entry is preferable when the selected Pi surface is
stable; explicit `SKILL.md` entries are preferable when package filtering
needs to be obvious in review.

### Option B — manifest points directly to canonical lib skills

- `acidbath/package.json` points at `/Users/ameno/dev/lib/skills/<name>`
  (or a generated local symlink under the acidbath tree).
- No generated Pi mirror is required.
- Changes in canonical content are immediately visible to Pi, but registry
  `build_targets` filtering is bypassed unless a separate selector is added.
- The path is even more host-specific, and direct links are easier to confuse
  with acidbath-owned skill files.

Option B is acceptable for a temporary development probe, not as the durable
integration contract.

## Recommended sequence after approval

1. Add and document the `pi` platform in lib's `registry.yaml`; choose the
   initial `build_targets` list from existing skills.
2. Update `scripts/build-skills.py`/validation only as needed for a platform
   with no install root, then run `~/dev/lib/scripts/skills build`.
3. Verify every generated `dist/pi/skills/*` entry is a symlink into lib's
   canonical source and run the lib validation/lock verification commands.
4. Add the selected generated paths to acidbath's `pi.skills` manifest.
5. Start a fresh Pi session and verify skill discovery while confirming the
   global blocklist still excludes `~/.pi/agent/skills/**`.
6. Use the lib deploy command for Claude/Codex/Factory; verify with `readlink`
   and do not add acidbath-local skill copies.

## Rollback and gates

- Remove `pi` from the selected registry entries and delete generated
  `dist/pi`; no canonical skill content needs reverting.
- Remove the acidbath `pi.skills` entries to disable Pi integration.
- Do not implement the manifest or registry changes until the human chooses
  Option A or B and approves the initial Pi skill set.
