# Harness TUI evidence

Live Pi session on `feat/harness-omp-capabilities`, captured 2026-10-02.

These frames are rendered from the actual tuistory screen snapshots. The virtual terminal driver does not provide compositor screenshots.

- `magic.png` — `/magic enable ultrathink` checks the word and marks it as a thinking-level raise.
- `roles.png` — `/role list` and `/role set compact` switch the active model to Claude Haiku 4.5 at `thinking:low`.
- `recap.png` — `/recap visual evidence` writes a persistent recap after a real one-turn exchange.
- `handoff-editor.png` — `/handoff` opens the generated handoff for review.
- `handoff-child.png` — submitting the handoff opens a child session with the document prefilled.

The Anthropic compact-role prompt failed because the local refresh token is expired. `/role clear` restored GPT-5.6 Sol before the recap and handoff calls.
