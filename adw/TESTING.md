# dip testing

Run the deterministic suite with:

```bash
npm run test:adw
```

`npm test` includes this suite, and `npm run typecheck` covers `adw/**/*.ts`.

## What is deterministic

The runtime is tested as a deterministic orchestrator: a fixed `.dip` source,
input, clock, run ID, shell executor, and agent transport must produce identical
result envelopes, logs, and progress events. The replay e2e test executes the
real parser, template expansion, phase ordering, gates, halt behavior, and
failure behavior 50 times and concurrently without drift.

LLM generation itself is not deterministic enough to be a correctness oracle.
Agent behavior is therefore tested with recorded/replay transports; a live Pi
session is an opt-in integration smoke test to add only once a real pipeline and
approved model fixture exist. A live result must still satisfy the deterministic
runtime envelope and gate contracts, but its prose must not be snapshot-tested.

## Test layers

- `gates.test.mjs`: built-in gate predicates and resolution.
- `runtime.test.mjs`: parser, phase executor boundary, ordering, failures,
  gates, templates, and human halts. The `research` phase kind is an injection
  seam only (`dispatchResearch`); production AGY extension wiring is deferred
  to bd-acid009. Research envelope source artifacts are capped at a bounded
  maximum, preserving order.
- `delegate.test.mjs`: model parsing, explicit tool allowlists, typed failures,
  forwarding, and session disposal—all with injected Pi SDK doubles.
- `determinism.test.mjs`: repeatability properties of pure runtime behavior.
- `command.test.mjs`: `/dip` argument parsing and pipeline discovery.
- `agents.test.mjs`: YAML catalog load, prompt resolution, and catalog/inline merge.
- `e2e/replay-pipeline.test.mjs`: complete deterministic pipeline replay.
- `e2e/production-pipelines.test.mjs`: the three production `.dip` files halt at the first review gate and load catalog agents.
