import assert from "node:assert/strict";
import { loadAgentCatalog } from "../../agents.ts";
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

function replayRuntime() {
  return new DipRuntime(() => {}, {
    cwd: "/replay/project",
    now: () => 1_000,
    runIdFactory: () => "dip-replay-prod",
    catalog: loadAgentCatalog(),
    executeCode: (command) => `${command}\n`,
    dispatchAgent: async ({ agent, agentDef, prompt, phaseId }) => ({
      status: "success",
      summary: `${agent}:${prompt}`,
      artifacts: [],
      notes_for_next_agent: agentDef.model,
      phase_id: phaseId,
      agent_name: agent,
    }),
  });
}

console.log("Production Pipeline Tests");
console.log("=========================");

await test("wayfind-and-implement loads catalog agents and halts after wayfind", async () => {
  const runtime = replayRuntime();
  const pipeline = runtime.loadPipeline("adw/pipelines/wayfind-and-implement.dip");
  assert.equal(pipeline.agents.wayfinder.model.length > 0, true);
  assert.ok(pipeline.agents.builder.tools.includes("edit"));
  const result = await runtime.run(pipeline, "add halt tests");
  assert.equal(result.status, "halted");
  assert.deepEqual(Object.keys(result.envelopes), ["wayfind"]);
  assert.match(result.envelopes.wayfind.summary, /^wayfinder:Wayfind add halt tests/);
});

await test("deep-research and quick-fix halt at their first review gate", async () => {
  const runtime = replayRuntime();
  const research = await runtime.run(runtime.loadPipeline("adw/pipelines/deep-research.dip"), "dip determinism");
  const fix = await runtime.run(runtime.loadPipeline("adw/pipelines/quick-fix.dip"), "broken test");
  assert.equal(research.status, "halted");
  assert.deepEqual(Object.keys(research.envelopes), ["plan"]);
  assert.equal(fix.status, "halted");
  assert.deepEqual(Object.keys(fix.envelopes), ["diagnose"]);
});

await test("resuming after halt is out of scope; later phases stay unexecuted", async () => {
  const runtime = replayRuntime();
  const result = await runtime.run(runtime.loadPipeline("adw/pipelines/quick-fix.dip"), "broken test");
  assert.equal(result.envelopes.fix, undefined);
  assert.equal(result.envelopes.verify, undefined);
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
