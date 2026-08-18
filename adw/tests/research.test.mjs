// research.test.mjs — the research capability's scope and contract.
import assert from "node:assert/strict";
import { research, RESEARCH_BRIEF, RESEARCH_TOOL, MAX_SOURCE_ARTIFACTS } from "../research.ts";
import { RESEARCH_OUTPUT } from "../envelope.ts";
import { SCOUT } from "../agents.ts";

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (error) { console.error(`  ✗ ${name}\n    ${error.message}`); failed++; }
}

console.log("Research Capability Tests");
console.log("=========================");

const SUBMITTED = {
  status: "success",
  summary: "found things",
  artifacts: ["notes.md"],
  notes_for_next_agent: "",
  findings: [
    { claim: "a", source_url: "https://example.com/a", confidence: "high" },
    { claim: "b", source_url: "https://example.com/b", confidence: "low" },
    { claim: "c", source_url: "https://example.com/a", confidence: "medium" },
  ],
  gaps: ["unknown"],
};

/** A RunContext whose dispatch records the request and returns a fixture. */
function fakeCtx(envelope = SUBMITTED) {
  const seen = {};
  return {
    seen,
    ctx: {
      cwd: "/w",
      runId: "r1",
      note: () => {},
      dispatch: async (request) => { seen.request = request; return envelope; },
    },
  };
}

await test("a research dispatch is scoped to exactly the research tool", async () => {
  const { ctx, seen } = fakeCtx();
  await research(ctx, "why");
  assert.deepEqual(seen.request.tools, [RESEARCH_TOOL]);
});

await test("the scout roster entry cannot widen its own tool scope", async () => {
  // SCOUT declares no tools; the dispatch site is what grants the one it gets.
  const { ctx, seen } = fakeCtx();
  await research(ctx, "why");
  assert.deepEqual(seen.request.agent, SCOUT);
  assert.deepEqual(seen.request.tools, [RESEARCH_TOOL], "the dispatch site decides, not the roster");
});

await test("a research dispatch always demands the research schema, strictly", async () => {
  const { ctx, seen } = fakeCtx();
  await research(ctx, "why");
  assert.equal(seen.request.output, RESEARCH_OUTPUT);
  assert.equal(seen.request.submitMode, "strict");
});

await test("the sourcing brief is appended to the agent's own prompts, not swapped for them", async () => {
  const { ctx, seen } = fakeCtx();
  await research(ctx, "why");
  assert.equal(seen.request.systemPrompts.at(-1), RESEARCH_BRIEF);
  assert.equal(seen.request.prompt, "why", "the question must reach the agent unwrapped");
});

await test("the phase label is overridable so a pipeline can name its own steps", async () => {
  const { ctx, seen } = fakeCtx();
  await research(ctx, "why", "gather");
  assert.equal(seen.request.phase, "gather");
});

await test("finding sources are promoted into artifacts, deduplicated, submitted ones first", async () => {
  const { ctx } = fakeCtx();
  const envelope = await research(ctx, "why");
  assert.deepEqual(envelope.artifacts, ["notes.md", "https://example.com/a", "https://example.com/b"]);
});

await test("the source list is bounded, preserving the order the claims were argued", async () => {
  const many = Array.from({ length: MAX_SOURCE_ARTIFACTS + 5 }, (_, i) => ({
    claim: `c${i}`, source_url: `https://example.com/${i}`, confidence: "high",
  }));
  const { ctx } = fakeCtx({ ...SUBMITTED, artifacts: [], findings: many });
  const envelope = await research(ctx, "why");
  assert.equal(envelope.artifacts.length, MAX_SOURCE_ARTIFACTS);
  assert.equal(envelope.artifacts[0], "https://example.com/0");
});

await test("structured fields survive the artifact merge for the next step to read", async () => {
  const { ctx } = fakeCtx();
  const envelope = await research(ctx, "why");
  assert.equal(envelope.findings[0].claim, "a");
  assert.deepEqual(envelope.gaps, ["unknown"]);
});

await test("a failed dispatch invents no sources", async () => {
  const { ctx } = fakeCtx({ status: "fail", summary: "provider error", artifacts: [], notes_for_next_agent: "" });
  const envelope = await research(ctx, "why");
  assert.equal(envelope.status, "fail");
  assert.deepEqual(envelope.artifacts, []);
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
