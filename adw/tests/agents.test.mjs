import assert from "node:assert/strict";
import { loadAgentCatalog, mergeAgentCatalog, parseAgentYaml } from "../agents.ts";
import { DipRuntime } from "../runtime.ts";

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

console.log("Agent Catalog Tests");
console.log("===================");

await test("loads the six checked-in agent YAML files", () => {
  const catalog = loadAgentCatalog();
  assert.deepEqual(Object.keys(catalog).sort(), [
    "builder", "griller", "researcher", "reviewer", "spec-writer", "wayfinder",
  ]);
  assert.ok(catalog.builder.tools.includes("edit"));
  assert.ok(catalog.wayfinder.system_prompts.some((prompt) => prompt.includes("Context Budget") || prompt.includes("context")));
});

await test("parseAgentYaml resolves prompt files and keeps tool order", () => {
  const yaml = `
name: sample
model: fixture/sample
thinking: low
tools:
  - read
  - grep
system_prompts:
  - ../prompts/context-budget.md
`;
  const agent = parseAgentYaml(yaml, new URL("../agents", import.meta.url).pathname);
  assert.equal(agent.name, "sample");
  assert.deepEqual(agent.tools, ["read", "grep"]);
  assert.ok(agent.system_prompts[0].includes("context") || agent.system_prompts[0].includes("Context"));
});

await test("merge keeps catalog defaults when the .dip only names the agent", () => {
  const catalog = loadAgentCatalog();
  const runtime = new DipRuntime();
  const pipeline = mergeAgentCatalog(runtime.parseDip(`
name: named-only
description: test
agents:
phases:
  - id: diagnose
    kind: agent
    agent: griller
    prompt: "{{prompt}}"
`), catalog);
  assert.equal(pipeline.agents.griller.model, catalog.griller.model);
  assert.deepEqual(pipeline.agents.griller.tools, catalog.griller.tools);
});

await test("inline .dip fields override catalog fields without wiping the rest", () => {
  const catalog = {
    builder: { name: "builder", model: "catalog/builder", tools: ["read"], system_prompts: ["base"] },
  };
  const runtime = new DipRuntime();
  const pipeline = mergeAgentCatalog(runtime.parseDip(`
name: override
description: test
agents:
  builder:
    model: inline/builder
phases:
  - id: build
    kind: agent
    agent: builder
`), catalog);
  assert.equal(pipeline.agents.builder.model, "inline/builder");
  assert.deepEqual(pipeline.agents.builder.tools, ["read"]);
  assert.deepEqual(pipeline.agents.builder.system_prompts, ["base"]);
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
