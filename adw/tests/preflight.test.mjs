// preflight.test.mjs — model resolution checked before a run dispatches anything.
// Run with: node --experimental-strip-types adw/tests/preflight.test.mjs

import assert from "node:assert/strict";
import { checkAgentModels, formatModelProblems } from "../preflight.ts";

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

/** A catalog fixture. No credentials, no gateway, no models.json. */
function catalogOf(...specs) {
  const models = specs.map((spec) => {
    const [provider, id] = spec.split("/");
    return { provider, id };
  });
  return {
    getModels: (provider) => (provider ? models.filter((m) => m.provider === provider) : models),
    getModel: (provider, id) => models.find((m) => m.provider === provider && m.id === id),
  };
}

const CATALOG = catalogOf(
  "ap-openai/glm-5p2-fw",
  "ap-copilot/copilot-claude-opus-4.8",
  "ap-copilot/copilot-gemini-3.5-flash",
  "google/copilot-claude-opus-4.8",
  "ap-anthropic/claude-opus-4-5",
);

const agent = (name, model) => ({ name, model, tools: [], system_prompts: [] });

console.log("Preflight Tests");
console.log("===============");

await test("a fully-qualified model that exists produces no problem", () => {
  assert.deepEqual(checkAgentModels([agent("builder", "ap-openai/glm-5p2-fw")], CATALOG), []);
});

await test("the :thinking suffix is stripped before resolution", () => {
  assert.deepEqual(checkAgentModels([agent("builder", "ap-openai/glm-5p2-fw:high")], CATALOG), []);
});

await test("a bare model resolves against ap-openai, which is the defect this exists to catch", () => {
  const [problem] = checkAgentModels([agent("reviewer", "copilot-claude-opus-4.8")], CATALOG);
  assert.equal(problem.agent, "reviewer");
  assert.equal(problem.provider, "ap-openai", "a missing prefix defaults to ap-openai");
  assert.equal(problem.reason, "unknown-model");
  assert.ok(
    problem.suggestions.includes("ap-copilot/copilot-claude-opus-4.8"),
    "the same id under another provider must be suggested",
  );
});

await test("an unregistered provider is reported as such, not as a missing model", () => {
  const [problem] = checkAgentModels([agent("griller", "nope/glm-5p2-fw")], CATALOG);
  assert.equal(problem.reason, "unknown-provider");
  assert.deepEqual(problem.suggestions, ["ap-openai/glm-5p2-fw"]);
});

await test("an agent with no model at all is a problem, not a pass", () => {
  const [problem] = checkAgentModels([agent("stub", "")], CATALOG);
  assert.equal(problem.reason, "no-model");
  assert.deepEqual(problem.suggestions, []);
});

await test("suggestions rank providers the healthy agents already use", () => {
  // Both ap-copilot and google serve this id. ap-copilot is the one in use.
  const [problem] = checkAgentModels(
    [agent("wayfinder", "ap-copilot/copilot-gemini-3.5-flash"), agent("reviewer", "copilot-claude-opus-4.8")],
    CATALOG,
  );
  assert.equal(problem.agent, "reviewer");
  assert.equal(problem.suggestions[0], "ap-copilot/copilot-claude-opus-4.8");
});

await test("every problem agent is named in the report, with its suggestion", () => {
  const problems = checkAgentModels(
    [agent("reviewer", "copilot-claude-opus-4.8"), agent("stub", "")],
    CATALOG,
  );
  const report = formatModelProblems(problems, CATALOG);
  assert.match(report, /2 agents named a model that does not resolve/);
  assert.match(report, /reviewer: copilot-claude-opus-4\.8/);
  assert.match(report, /ap-copilot\/copilot-claude-opus-4\.8/);
  assert.match(report, /stub: no model configured/);
  assert.ok(!report.includes("Known providers:"), "the provider list is noise when a suggestion exists");
});

await test("the provider list appears only when nothing concrete can be suggested", () => {
  const problems = checkAgentModels([agent("ghost", "nope/no-such-model-anywhere")], CATALOG);
  assert.deepEqual(problems[0].suggestions, []);
  assert.match(formatModelProblems(problems, CATALOG), /Known providers: ap-anthropic, ap-copilot, ap-openai, google/);
});

await test("an empty agent list is not an error", () => {
  assert.deepEqual(checkAgentModels([], CATALOG), []);
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
