import assert from "node:assert/strict";
import { describeDipProgress, listPipelines, parseDipArgs, pipelinePath } from "../command.ts";

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

console.log("Command Tests");
console.log("=============");

await test("parseDipArgs rejects empty input with usage", () => {
  const result = parseDipArgs("   ");
  assert.equal(result.ok, false);
  assert.match(result.error, /Usage/);
});

await test("parseDipArgs accepts list and status without extra tokens", () => {
  assert.deepEqual(parseDipArgs("list"), { ok: true, action: "list" });
  assert.deepEqual(parseDipArgs("status"), { ok: true, action: "status" });
  assert.equal(parseDipArgs("list extra").ok, false);
});

await test("parseDipArgs keeps the remaining tokens as the run prompt", () => {
  assert.deepEqual(parseDipArgs("run quick-fix broken test"), {
    ok: true, action: "run", name: "quick-fix", prompt: "broken test",
  });
  assert.deepEqual(parseDipArgs("run deep-research"), {
    ok: true, action: "run", name: "deep-research", prompt: "",
  });
});

await test("listPipelines returns the checked-in production files", () => {
  const names = listPipelines();
  assert.ok(names.includes("wayfind-and-implement"));
  assert.ok(names.includes("deep-research"));
  assert.ok(names.includes("quick-fix"));
  assert.ok(names.includes("test-pipeline"));
});

await test("pipelinePath accepts a bare name or .dip suffix", () => {
  assert.ok(pipelinePath("quick-fix").endsWith("quick-fix.dip"));
  assert.ok(pipelinePath("quick-fix.dip").endsWith("quick-fix.dip"));
});

await test("describeDipProgress maps lifecycle events without inventing animation", () => {
  assert.equal(describeDipProgress({ type: "dip_start", name: "quick-fix" }), "dip: quick-fix");
  assert.equal(describeDipProgress({ type: "phase_start", id: "diagnose" }), "dip: diagnose");
  assert.equal(describeDipProgress({ type: "gate_check", gate: "always_pass", passed: true }), "dip: always_pass pass");
  assert.equal(describeDipProgress({ type: "halt", id: "diagnose" }), "dip halt: diagnose");
  assert.equal(describeDipProgress({ type: "phase_progress" }), undefined);
});

await test("a dip_error renders its reason, not the word 'failed'", () => {
  // The event's field is `error`; a preflight refusal is multi-line.
  assert.equal(
    describeDipProgress({ type: "dip_error", error: "2 agents named a model that does not resolve\n\n  reviewer: ..." }),
    "dip error: 2 agents named a model that does not resolve",
  );
  assert.equal(describeDipProgress({ type: "dip_error" }), "dip error: failed");
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
