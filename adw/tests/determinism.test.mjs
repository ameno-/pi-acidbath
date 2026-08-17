// determinism.test.mjs — Tests for pipeline determinism
// The core ADW insight: same input → same pipeline execution → same output
// Run with: npx tsx adw/tests/determinism.test.mjs

import assert from "node:assert/strict";
import { DipRuntime } from "../runtime.ts";
import { verifyGates, resolveGates } from "../gates.ts";
// Types imported implicitly through runtime.ts and gates.ts

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    failed++;
  }
}

console.log("Determinism Tests");
console.log("=================");

// Determinism 1: Same .dip → Same parsed pipeline
const FIXTURE_DIP = `
name: "fixture-pipeline"
description: "Deterministic fixture for testing"
agents:
  tester:
    model: gemini-3.6-flash
    tools: [read, grep, find, ls]
    system_prompts: [@context-budget.md]
phases:
  - id: phase-1
    kind: code
    command: "echo deterministic"
    gates: [always_pass]
  - id: phase-2
    kind: code
    command: "date +%s"
`;

await test("same .dip content produces identical parse 5 times", () => {
  const rt = new DipRuntime();
  const results = [];
  for (let i = 0; i < 5; i++) {
    results.push(JSON.stringify(rt.parseDip(FIXTURE_DIP)));
  }
  const first = results[0];
  for (let i = 1; i < results.length; i++) {
    assert.equal(results[i], first, `iteration ${i} differs from first`);
  }
});

await test("pipeline property order is deterministic", () => {
  const rt = new DipRuntime();
  const p1 = rt.parseDip(FIXTURE_DIP);
  const p2 = rt.parseDip(FIXTURE_DIP);
  
  // Phase order must be preserved
  for (let i = 0; i < p1.phases.length; i++) {
    assert.equal(p1.phases[i].id, p2.phases[i].id, `phase ${i} id mismatch`);
    assert.equal(p1.phases[i].kind, p2.phases[i].kind, `phase ${i} kind mismatch`);
  }
  
  // Agent keys must be stable
  assert.deepEqual(
    Object.keys(p1.agents),
    Object.keys(p2.agents),
    "agent key order differs"
  );
});

// Determinism 2: Same gates → Same results
await test("always_pass gate is deterministic (100 calls)", async () => {
  const envelope = { status: "success", summary: "", artifacts: [], notes_for_next_agent: "" };
  const phase = { id: "p1", kind: "code" };
  for (let i = 0; i < 100; i++) {
    const result = await resolveGates(["always_pass"])[0](envelope, phase);
    assert.equal(result.passed, true, `iteration ${i} failed`);
    assert.equal(result.violations.length, 0, `iteration ${i} has violations`);
  }
});

await test("artifacts_exist gate is deterministic (same path → same result)", async () => {
  const gates = resolveGates(["artifacts_exist"]);
  // Test with a known-existing path
  const existingEnv = { status: "success", summary: "", artifacts: ["/tmp"], notes_for_next_agent: "" };
  const nonExistingEnv = { status: "success", summary: "", artifacts: ["/tmp/definitely-missing-xyz"], notes_for_next_agent: "" };
  const phase = { id: "p1", kind: "code" };
  
  for (let i = 0; i < 25; i++) {
    const r1 = await gates[0](existingEnv, phase);
    assert.equal(r1.passed, true, `existing path iteration ${i} failed`);
    
    const r2 = await gates[0](nonExistingEnv, phase);
    assert.equal(r2.passed, false, `missing path iteration ${i} passed`);
  }
});

// Determinism 3: Same envelope + phase → Same gate result
await test("verifyGates is a pure function of (phase, envelope)", async () => {
  const envelope = { status: "success", summary: "test", artifacts: [], notes_for_next_agent: "" };
  const phase = { id: "p1", kind: "code", gates: ["always_pass"] };
  
  const firstResult = await verifyGates(phase, envelope);
  for (let i = 0; i < 20; i++) {
    const nextResult = await verifyGates(phase, envelope);
    assert.equal(nextResult.length, firstResult.length);
    for (let j = 0; j < nextResult.length; j++) {
      assert.equal(nextResult[j].passed, firstResult[j].passed, `gate ${j} iteration ${i} differs`);
      assert.equal(nextResult[j].violations.length, firstResult[j].violations.length, `gate ${j} violations count differs`);
    }
  }
});

// Determinism 4: Code phase determinism (same command → same exit code)
await test("'echo hello' always exits 0", async () => {
  const rt = new DipRuntime();
  const dip = `
name: "deterministic-code"
description: "test"
agents:
phases:
  - id: echo
    kind: code
    command: "echo hello"
`;
  const pipeline = rt.parseDip(dip);
  for (let i = 0; i < 10; i++) {
    const result = await rt.run(pipeline, "test");
    assert.equal(result.envelopes["echo"].status, "success", `iteration ${i} failed`);
    assert.equal(result.status, "success", `iteration ${i} overall failed`);
  }
});

await test("'exit 1' always exits 1", async () => {
  const rt = new DipRuntime();
  const dip = `
name: "deterministic-fail"
description: "test"
agents:
phases:
  - id: fail
    kind: code
    command: "exit 1"
`;
  const pipeline = rt.parseDip(dip);
  for (let i = 0; i < 10; i++) {
    const result = await rt.run(pipeline, "test");
    assert.equal(result.envelopes["fail"].status, "fail", `iteration ${i} succeeded when should fail`);
  }
});

// Determinism 5: Template resolution is deterministic
await test("resolveTemplate produces same output for same input", () => {
  const rt = new DipRuntime();
  const template = "Process {{prompt}} with run {{run_id}}";
  const vars1 = { prompt: "hello", run_id: "abc" };
  const vars2 = { prompt: "hello", run_id: "abc" };
  
  // Access private method via prototype for testing
  const result1 = rt.resolveTemplate(template, vars1);
  const result2 = rt.resolveTemplate(template, vars2);
  assert.equal(result1, result2);
});

await test("template with different variables produces different output", () => {
  const rt = new DipRuntime();
  const template = "Process {{prompt}}";
  const result1 = rt.resolveTemplate(template, { prompt: "hello" });
  const result2 = rt.resolveTemplate(template, { prompt: "world" });
  assert.notEqual(result1, result2);
});

// Determinism 6: Envelope shape consistency across phases
await test("every phase envelope has identical required fields", async () => {
  const rt = new DipRuntime();
  const multiPhaseDip = `
name: "multi-phase"
description: "test"
agents:
phases:
  - id: p1
    kind: code
    command: "echo a"
  - id: p2
    kind: code
    command: "echo b"
  - id: p3
    kind: code
    command: "echo c"
`;
  const pipeline = rt.parseDip(multiPhaseDip);
  const result = await rt.run(pipeline, "test");
  
  const requiredFields = ["status", "summary", "artifacts", "notes_for_next_agent"];
  for (const [id, env] of Object.entries(result.envelopes)) {
    for (const field of requiredFields) {
      assert.ok(field in env, `${id} missing field: ${field}`);
    }
  }
});

// Determinism 7: Pipeline run ID is unique per run
await test("each pipeline run gets unique run_id", async () => {
  const rt = new DipRuntime();
  const dip = `
name: "unique-id"
description: "test"
agents:
phases:
  - id: p1
    kind: code
    command: "echo unique"
`;
  const pipeline = rt.parseDip(dip);
  const events = [];
  const rt1 = new DipRuntime((e) => events.push(e));
  await rt1.run(pipeline, "test1");
  const runId1 = events.find(e => e.type === "dip_start")?.run_id;
  
  const events2 = [];
  const rt2 = new DipRuntime((e) => events2.push(e));
  await rt2.run(pipeline, "test2");
  const runId2 = events2.find(e => e.type === "dip_start")?.run_id;
  
  assert.ok(runId1, "first run_id should exist");
  assert.ok(runId2, "second run_id should exist");
  assert.notEqual(runId1, runId2, "run_ids must be unique");
});

// Summary
console.log("");
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
