# pi-research evaluation

Reviewed repository `ameno-/pi-research` at commit
`eb3de4ed13128da3153022fc20579fd83470a19b`.

## Summary

`pi-research` provides two useful tools:

- `agy_web_search` for quick current-information lookups;
- `agy_research` for multi-source synthesis with streamed progress.

It is a **companion extension**, not an Acidbath feature. Keep it separate so
Acidbath can remain a local UI/renderer package and so research availability can
be enabled or disabled independently.

## Strengths

- Native Pi tool registration and parameter schemas.
- Clear two-tier UX: quick search versus deep research.
- `stream-json` progress is a good fit for Acidbath's lifecycle renderer.
- Explicit model, freshness, depth, and subtopic controls.
- `pi-web-access` detection makes URL/PDF/video extraction composable.
- Includes unit parsing tests and a benchmark harness with cached reports.

## Risks and gaps

### High-risk execution permissions

The executor invokes:

```text
agy --dangerously-skip-permissions --output-format stream-json
```

and requires AGY's global `command(*)` permission. The tool can therefore
delegate command execution to an external agent with broad permissions. This is
the main adoption blocker; it should not be silently enabled in the global
package list.

The setup script also edits `~/.gemini/.../settings.json`, symlinks an
extension, and edits `~/.pi/agent/settings.json`. These actions are explicit in
the script but should remain opt-in and user-confirmed.

### Tool correctness

- `freshness` and `depth` are `Type.String`, not enums; invalid values are
  accepted and passed into prompts.
- `max_results` has no minimum/maximum bound.
- The declared `agy` binary path is fixed to `~/.local/bin/agy` rather than
  resolving `PATH`.
- Stream parsing silently skips malformed lines and falls back to returning raw
  stdout, which can expose logs instead of a structured error.
- `writeAGYPermissions()` preserves JSON semantically but does not preserve
  formatting/comments; it should never run without confirmation.
- The startup hook emits notifications and checks configuration on every Pi
  session, adding noise when the tool is not being used.
- The tests duplicate parser logic instead of importing exported pure helpers;
  they do not test cancellation, timeout, malformed final results, output caps,
  or command-injection-shaped queries.
- The README's eval harness is promising, but quality scoring is not yet an
  objective/independent judge and the benchmark should be run before adoption.

## Current Acidbath decision

Acidbath now installs `pi-web-access@0.20.0` as a direct dependency and loads
its extension explicitly alongside `pi-research`. This makes `fetch_content`,
`get_search_content`, `source_check`, and the direct `web_search` capability
available to the primary Pi. AGY remains usable without those tools; after an
AGY result returns URLs, the primary Pi can use `fetch_content` and
`source_check` for extraction and evidence instead of pretending AGY can call a
parent Pi tool.

The existing `pi-research` package still has a stale availability heuristic: it
checks only the global Pi npm directory, so its deep-research prompt may say
pi-web-access is unavailable even when the local Acidbath package has loaded it.
The tools themselves are available; fixing that heuristic belongs in the next
pi-research hardening pass rather than patching `node_modules`.

## Recommendation

**Study/adopt behind an explicit opt-in profile, not the default Acidbath
package set.** Keep the repository available at its own package path when AGY
is intentionally configured, but do not add it to global settings until the
following controls exist:

1. Replace `--dangerously-skip-permissions` with a documented, least-privilege
   AGY mode, or make the risky mode a separately named tool/profile.
2. Validate schema enums and clamp numeric limits (`max_results`, prompt size,
   output size, timeout).
3. Resolve `agy` via `PATH` or a user-configurable setting; do not assume one
   home-directory location.
4. Cap and sanitize streamed progress, final stdout, and stderr before display.
5. Export and unit-test pure stream parsing; add cancellation/timeout/error tests.
6. Make startup notifications opt-in or only show status when a tool is called.
7. Run the quick/deep benchmark and record success, latency, citation coverage,
   source diversity, and answer quality in `docs/tool-eval-matrix.md`.

## Acidbath integration opportunity

Do not copy the AGY executor into Acidbath. If pi-research is enabled, Acidbath
should recognize its tool names through the generic tool lifecycle adapter and
render:

```text
● agy_web_search · query · 3 sources · 8.4s
● agy_research · topic · 7 sources · 31.2s
```

Partial updates should remain expanded, with a compact phase label and a
bounded source/progress preview. Completed results should retain source links
and duration metadata. This gives the tool a first-class display without
coupling Acidbath to AGY or granting Acidbath additional execution powers.

## Evaluation cadence

For every version update:

- run unit tests without network;
- run a fixed 10-query quick set and 5-query deep set when credentials exist;
- compare success rate, latency, citation coverage, source diversity, answer
  quality, cancellation behavior, and rendered output size;
- review permissions, setup scripts, dependency changes, and CLI flags;
- record the commit and decision in the tool matrix.
