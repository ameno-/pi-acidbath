// gates.test.mjs — Tests for gate verification
// Run with: node --experimental-strip-types adw/tests/gates.test.mjs

import assert from "node:assert/strict";
import { BUILTIN_GATES, resolveGates, verifyGates } from "../gates.ts";

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

console.log("Gates Tests");
console.log("===========");

// --- always_pass ---
await test("always_pass gate returns passed=true", async () => {
  const envelope = { status: "success", summary: "", artifacts: [], notes_for_next_agent: "" };
  const phase = { id: "p1", kind: "agent" };
  const result = await BUILTIN_GATES.always_pass(envelope, phase);
  assert.equal(result.passed, true);
  assert.equal(result.violations.length, 0);
  assert.equal(result.name, "always_pass");
});

// --- artifacts_exist ---
await test("artifacts_exist passes when artifacts list is empty", async () => {
  const envelope = { status: "success", summary: "", artifacts: [], notes_for_next_agent: "" };
  const phase = { id: "p1", kind: "agent" };
  const result = await BUILTIN_GATES.artifacts_exist(envelope, phase);
  assert.equal(result.passed, true);
});

await test("artifacts_exist fails for non-existent file", async () => {
  const envelope = {
    status: "success", summary: "", artifacts: ["/tmp/definitely-does-not-exist-abc123.txt"], notes_for_next_agent: ""
  };
  const phase = { id: "p1", kind: "agent" };
  const result = await BUILTIN_GATES.artifacts_exist(envelope, phase);
  assert.equal(result.passed, false);
  assert.equal(result.violations.length, 1);
  assert.match(result.violations[0], /Artifact not found/);
});

await test("artifacts_exist passes for existing file", async () => {
  const envelope = {
    status: "success", summary: "", artifacts: ["/tmp"], notes_for_next_agent: ""
  };
  const phase = { id: "p1", kind: "agent" };
  const result = await BUILTIN_GATES.artifacts_exist(envelope, phase);
  assert.equal(result.passed, true);
});

// --- diff_non_empty ---
await test("diff_non_empty passes on success status", async () => {
  const envelope = { status: "success", summary: "", artifacts: [], notes_for_next_agent: "" };
  const phase = { id: "p1", kind: "code" };
  const result = await BUILTIN_GATES.diff_non_empty(envelope, phase);
  assert.equal(result.passed, true);
});

await test("diff_non_empty fails on fail status with empty artifacts", async () => {
  const envelope = { status: "fail", summary: "", artifacts: [], notes_for_next_agent: "" };
  const phase = { id: "p1", kind: "code" };
  const result = await BUILTIN_GATES.diff_non_empty(envelope, phase);
  assert.equal(result.passed, false);
  assert.ok(result.violations.length > 0);
});

// --- resolveGates ---
await test("resolveGates returns always_pass for undefined gates", () => {
  const gates = resolveGates(undefined);
  assert.equal(gates.length, 1);
});

await test("resolveGates returns always_pass for empty array", () => {
  const gates = resolveGates([]);
  assert.equal(gates.length, 1);
});

await test("resolveGates resolves known gate names", () => {
  const gates = resolveGates(["artifacts_exist", "always_pass"]);
  assert.equal(gates.length, 2);
});

await test("resolveGates falls back to always_pass for unknown gate name", () => {
  const gates = resolveGates(["unknown_gate_xyz"]);
  assert.equal(gates.length, 1);
  // Should not throw when called
});

// --- verifyGates ---
await test("verifyGates runs all gates for a phase", async () => {
  const envelope = { status: "success", summary: "", artifacts: [], notes_for_next_agent: "" };
  const phase = { id: "p1", kind: "agent", gates: ["always_pass", "always_pass"] };
  const results = await verifyGates(phase, envelope);
  assert.equal(results.length, 2);
  assert.ok(results.every((r) => r.passed));
});

await test("verifyGates uses always_pass when phase has no gates", async () => {
  const envelope = { status: "success", summary: "", artifacts: [], notes_for_next_agent: "" };
  const phase = { id: "p1", kind: "agent" };
  const results = await verifyGates(phase, envelope);
  assert.equal(results.length, 1);
  assert.equal(results[0].passed, true);
});

// Summary
console.log("");
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
