// replay-pipeline.test.mjs — Deterministic end-to-end test of a complete .dip run.
// This uses the production parser, runtime, gates, templates, event protocol,
// and a recorded agent transport. It intentionally never makes a live model call.
// Run with: node --experimental-strip-types adw/tests/e2e/replay-pipeline.test.mjs

import assert from "node:assert/strict";
import { DipRuntime } from "../../runtime.ts";

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (error) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${error.message}`);
    failed++;
  }
}

const PIPELINE = `
name: replay-e2e
description: deterministic end-to-end fixture
agents:
  scout:
    model: fixture/scout
    tools: [read, grep]
    system_prompts: []
  planner:
    model: fixture/planner
    tools: []
    system_prompts: []
phases:
  - id: inspect
    kind: agent
    agent: scout
    prompt: "Inspect {{prompt}}"
    gates: [always_pass]
  - id: plan
    kind: agent
    agent: planner
    prompt: "Plan from {{inspect}}"
    gates: [always_pass]
  - id: validate
    kind: code
    command: "fixture-verify"
    gates: [always_pass]
  - id: human-review
    kind: halt
    prompt: "Review {{plan}}"
`;

/** Recorded/fixture transport: this is the deterministic stand-in for an LLM. */
async function replayAgent({ agent, prompt, phaseId }) {
  const summaries = {
    scout: `SCOUT:${prompt}`,
    planner: `PLAN:${prompt}`,
  };
  return {
    status: "success",
    summary: summaries[agent],
    artifacts: [],
    notes_for_next_agent: `replay:${phaseId}`,
    agent_name: agent,
    phase_id: phaseId,
  };
}

function runFixture() {
  const events = [];
  const runtime = new DipRuntime((event) => events.push(event), {
    cwd: "/replay/project",
    now: () => 1_000,
    runIdFactory: () => "dip-replay-001",
    executeCode: (command, cwd) => {
      assert.equal(command, "fixture-verify");
      assert.equal(cwd, "/replay/project");
      return "verified\n";
    },
    dispatchAgent: replayAgent,
  });

  return runtime.run(runtime.parseDip(PIPELINE), "src/example.ts").then((result) => ({ result, events }));
}

console.log("Replay E2E Tests");
console.log("================");

await test("complete replay reaches the human validation gate", async () => {
  const { result, events } = await runFixture();
  assert.equal(result.status, "halted");
  assert.deepEqual(Object.keys(result.envelopes), ["inspect", "plan", "validate", "human-review"]);
  assert.equal(result.envelopes.inspect.summary, "SCOUT:Inspect src/example.ts");
  assert.equal(result.envelopes.plan.summary, "PLAN:Plan from SCOUT:Inspect src/example.ts");
  assert.equal(result.envelopes.validate.summary, "Command: fixture-verify");
  assert.deepEqual(events.map((event) => event.type), [
    "dip_start", "phase_start", "gate_check", "phase_end",
    "phase_start", "gate_check", "phase_end",
    "phase_start", "gate_check", "phase_end",
    "phase_start", "gate_check", "phase_end", "halt", "dip_end",
  ]);
});

await test("50 replays are byte-for-byte identical", async () => {
  const baseline = await runFixture();
  const expected = JSON.stringify(baseline);
  for (let iteration = 0; iteration < 50; iteration++) {
    assert.equal(JSON.stringify(await runFixture()), expected, `replay ${iteration} drifted`);
  }
});

await test("concurrent replays do not share runtime state", async () => {
  const runs = await Promise.all(Array.from({ length: 20 }, () => runFixture()));
  const expected = JSON.stringify(runs[0]);
  for (const run of runs) assert.equal(JSON.stringify(run), expected);
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
