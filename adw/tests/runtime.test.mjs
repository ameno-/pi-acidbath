// runtime.test.mjs — Unit tests for the deterministic pipeline orchestrator.
// Run with: npx tsx adw/tests/runtime.test.mjs

import assert from "node:assert/strict";
import { DipRuntime, RESEARCH_MAX_ARTIFACTS } from "../runtime.ts";

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

const SAMPLE_DIP = `
name: "test-pipeline"
description: "Test pipeline for dip runtime validation"
agents:
  tester:
    model: ap-openai/gemini-3.6-flash
    tools: [read, grep]
    system_prompts: [@context-budget.md]
phases:
  - id: inspect
    kind: agent
    agent: tester
    prompt: "Inspect {{prompt}}"
  - id: verify
    kind: code
    command: "echo done"
    gates: [always_pass]
`;

function testRuntime(onProgress = () => {}, overrides = {}) {
  return new DipRuntime(onProgress, {
    cwd: "/fixture/cwd",
    now: () => 100,
    runIdFactory: () => "dip-fixture",
    executeCode: (command) => {
      if (command === "exit 1") throw new Error("command failed");
      return `${command}\n`;
    },
    dispatchAgent: async ({ agent, prompt, phaseId }) => ({
      status: "success",
      summary: `${agent}:${prompt}`,
      artifacts: [],
      notes_for_next_agent: "fixture result",
      phase_id: phaseId,
      agent_name: agent,
    }),
    ...overrides,
  });
}

console.log("Runtime Tests");
console.log("=============");

await test("parseDip preserves pipeline metadata, agents, and phase order", () => {
  const pipeline = testRuntime().parseDip(SAMPLE_DIP);
  assert.equal(pipeline.name, "test-pipeline");
  assert.equal(pipeline.description, "Test pipeline for dip runtime validation");
  assert.deepEqual(pipeline.agents.tester.tools, ["read", "grep"]);
  assert.deepEqual(pipeline.phases.map((phase) => phase.id), ["inspect", "verify"]);
});

await test("loadPipeline parses the checked-in fixture", () => {
  const pipeline = testRuntime().loadPipeline("adw/pipelines/test-pipeline.dip");
  assert.equal(pipeline.name, "test-pipeline");
  assert.ok(pipeline.phases.length > 0);
});

await test("runs phases in order and sends a resolved prompt to the injected agent", async () => {
  const requests = [];
  const runtime = testRuntime(() => {}, {
    dispatchAgent: async (request) => {
      requests.push(request);
      return { status: "success", summary: "inspected", artifacts: [], notes_for_next_agent: "" };
    },
  });
  const result = await runtime.run(runtime.parseDip(SAMPLE_DIP), "a target");
  assert.equal(result.status, "success");
  assert.deepEqual(Object.keys(result.envelopes), ["inspect", "verify"]);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].agent, "tester");
  assert.equal(requests[0].prompt, "Inspect a target");
  assert.equal(requests[0].cwd, "/fixture/cwd");
  assert.equal(requests[0].runId, "dip-fixture");
  assert.equal(requests[0].phaseId, "inspect");
  assert.equal(requests[0].agentDef.model, "ap-openai/gemini-3.6-flash");
});

await test("emits a stable lifecycle event sequence", async () => {
  const events = [];
  const runtime = testRuntime((event) => events.push(event));
  await runtime.run(runtime.parseDip(SAMPLE_DIP), "target");
  assert.deepEqual(events.map((event) => event.type), [
    "dip_start", "phase_start", "gate_check", "phase_end", "phase_start", "gate_check", "phase_end", "dip_end",
  ]);
  assert.equal(events[0].run_id, "dip-fixture");
  assert.equal(events.at(-1).status, "success");
});

await test("agent phases fail loudly when the named agent is absent", async () => {
  const pipeline = testRuntime().parseDip(`
name: bad-agent
description: test
agents:
phases:
  - id: missing
    kind: agent
    agent: absent
`);
  const result = await testRuntime().run(pipeline, "test");
  assert.equal(result.status, "fail");
  assert.match(result.envelopes.missing.summary, /Unknown agent/);
});

await test("agent phases never fake success when no executor is configured", async () => {
  const runtime = testRuntime(() => {}, { dispatchAgent: undefined });
  const result = await runtime.run(runtime.parseDip(SAMPLE_DIP), "test");
  assert.equal(result.status, "fail");
  assert.match(result.envelopes.inspect.summary, /No agent executor configured/);
  assert.equal(result.envelopes.verify, undefined, "execution must stop after failure");
});

const RESEARCH_DIP = `
name: research-only
description: test
agents:
phases:
  - id: gather
    kind: research
    prompt: "Research: {{prompt}} (run {{run_id}})"
  - id: after
    kind: code
    command: "echo after"
`;

await test("research phases execute through the injected executor with template expansion and source artifacts", async () => {
  const requests = [];
  const runtime = testRuntime(() => {}, {
    dispatchResearch: async (request) => {
      requests.push(request);
      return {
        status: "success",
        summary: "researched: " + request.prompt,
        artifacts: ["https://example.com/a", "https://example.com/b"],
        notes_for_next_agent: "sources found",
      };
    },
  });
  const result = await runtime.run(runtime.parseDip(RESEARCH_DIP), "dip determinism");
  assert.equal(result.status, "success");
  assert.deepEqual(requests.length, 1);
  assert.equal(requests[0].prompt, "Research: dip determinism (run dip-fixture)");
  assert.equal(requests[0].cwd, "/fixture/cwd");
  assert.equal(requests[0].runId, "dip-fixture");
  assert.equal(requests[0].phaseId, "gather");
  assert.equal(result.envelopes.gather.status, "success");
  assert.equal(result.envelopes.gather.phase_id, "gather");
  assert.deepEqual(result.envelopes.gather.artifacts, ["https://example.com/a", "https://example.com/b"]);
  assert.equal(result.envelopes.gather.notes_for_next_agent, "sources found");
  assert.equal(result.envelopes.after.status, "success", "a successful research phase does not stop later phases");
});

await test("research source artifacts are capped at the bounded maximum, preserving order", async () => {
  const overLimit = Array.from({ length: RESEARCH_MAX_ARTIFACTS + 5 }, (_, i) => `https://example.com/src-${i}`);
  const runtime = testRuntime(() => {}, {
    dispatchResearch: async () => ({
      status: "success",
      summary: "researched",
      artifacts: overLimit,
      notes_for_next_agent: "",
    }),
  });
  const result = await runtime.run(runtime.parseDip(RESEARCH_DIP), "test");
  assert.equal(result.envelopes.gather.status, "success");
  assert.equal(result.envelopes.gather.artifacts.length, RESEARCH_MAX_ARTIFACTS);
  assert.deepEqual(
    result.envelopes.gather.artifacts,
    overLimit.slice(0, RESEARCH_MAX_ARTIFACTS),
    "the first (in order) sources must be preserved and the tail dropped",
  );
});

await test("research phases fail loudly when no research executor is configured", async () => {
  const runtime = new DipRuntime(() => {}, {
    cwd: "/fixture/cwd",
    now: () => 100,
    runIdFactory: () => "dip-fixture",
    executeCode: (command) => `${command}\n`,
  });
  const result = await runtime.run(runtime.parseDip(RESEARCH_DIP), "test");
  assert.equal(result.status, "fail");
  assert.equal(result.envelopes.gather.status, "fail");
  assert.match(result.envelopes.gather.summary, /No research executor configured/);
  assert.deepEqual(result.envelopes.gather.artifacts, []);
  assert.equal(result.envelopes.after, undefined, "execution must stop after failure");
});

await test("research phases emit the same stable start/gate/end event sequence", async () => {
  const events = [];
  const runtime = testRuntime((event) => events.push(event), { dispatchResearch: async () => ({
    status: "success",
    summary: "researched",
    artifacts: ["https://example.com/a"],
    notes_for_next_agent: "",
  })});
  const result = await runtime.run(runtime.parseDip(RESEARCH_DIP), "target");
  assert.equal(result.status, "success");
  assert.deepEqual(
    events.map((event) => [event.type, event.id ?? event.name]),
    [
      ["dip_start", "research-only"],
      ["phase_start", "gather"],
      ["gate_check", "gather"],
      ["phase_end", "gather"],
      ["phase_start", "after"],
      ["gate_check", "after"],
      ["phase_end", "after"],
      ["dip_end", undefined],
    ],
  );
  assert.equal(events.find((event) => event.type === "phase_start" && event.id === "gather").kind, "research");
});

await test("a code failure stops later phases", async () => {
  const runtime = testRuntime();
  const pipeline = runtime.parseDip(`
name: fail-fast
description: test
agents:
phases:
  - id: bad
    kind: code
    command: "exit 1"
  - id: never
    kind: code
    command: "echo never"
`);
  const result = await runtime.run(pipeline, "test");
  assert.equal(result.status, "fail");
  assert.ok(result.envelopes.bad);
  assert.equal(result.envelopes.never, undefined);
});

await test("a failed gate stops later phases", async () => {
  const runtime = testRuntime(() => {}, {
    dispatchAgent: async () => ({
      status: "success", summary: "claimed artifact", artifacts: ["/fixture/missing"], notes_for_next_agent: "",
    }),
  });
  const pipeline = runtime.parseDip(`
name: gate-stop
description: test
agents:
  tester:
    model: fixture/tester
    tools: []
    system_prompts: []
phases:
  - id: gated
    kind: agent
    agent: tester
    gates: [artifacts_exist]
  - id: never
    kind: code
    command: "echo never"
`);
  const result = await runtime.run(pipeline, "test");
  assert.equal(result.status, "fail");
  assert.equal(result.envelopes.gated.status, "fail");
  assert.equal(result.envelopes.never, undefined);
});

await test("a halt phase terminates deterministically as halted", async () => {
  const events = [];
  const runtime = testRuntime((event) => events.push(event));
  const pipeline = runtime.parseDip(`
name: halt
description: test
agents:
phases:
  - id: review
    kind: halt
    prompt: "Review {{prompt}}"
  - id: never
    kind: code
    command: "echo never"
`);
  const result = await runtime.run(pipeline, "this change");
  assert.equal(result.status, "halted");
  assert.equal(result.envelopes.never, undefined);
  assert.deepEqual(events.filter((event) => event.type === "halt").map((event) => event.id), ["review"]);
});

await test("halt: true also stops after the completed phase", async () => {
  const runtime = testRuntime();
  const pipeline = runtime.parseDip(`
name: flag-halt
description: test
agents:
phases:
  - id: gated-review
    kind: code
    command: "echo ready"
    halt: true
  - id: never
    kind: code
    command: "echo never"
`);
  const result = await runtime.run(pipeline, "test");
  assert.equal(result.status, "halted");
  assert.equal(result.envelopes.never, undefined);
});

await test("template resolution leaves unknown values intact", () => {
  const runtime = testRuntime();
  assert.equal(runtime.resolveTemplate("{{prompt}} / {{missing}}", { prompt: "hello" }), "hello / {{missing}}");
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
