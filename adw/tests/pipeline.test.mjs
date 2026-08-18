// pipeline.test.mjs — the orchestration layer, and the two shipped pipelines.
// Replaces runtime/determinism/e2e tests: same properties, no DSL to parse.
import assert from "node:assert/strict";
import { runPipeline } from "../pipeline.ts";
import { review } from "../pipelines/review.ts";
import { researchAndBrainstorm } from "../pipelines/research.ts";
import { REVIEWER, THINKER, SCOUT, ALL_AGENTS } from "../agents.ts";
import { parseModelSpec } from "../delegate.ts";

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (error) { console.error(`  ✗ ${name}\n    ${error.message}`); failed++; }
}

console.log("Pipeline Tests");
console.log("==============");

const FIXTURE = { runIdFactory: () => "dip-fixture", now: () => 100, preflight: null, recordRun: false, onNote: () => {} };

/** Run a body with a dispatch that returns canned envelopes per phase. */
function withDispatch(byPhase) {
  const seen = [];
  return {
    seen,
    options: {
      ...FIXTURE,
      dispatch: async (request) => {
        seen.push(request);
        const envelope = byPhase[request.phase];
        if (!envelope) throw new Error(`no fixture for phase ${request.phase}`);
        return envelope;
      },
    },
  };
}

const ok = (extra = {}) => ({ status: "success", summary: "s", artifacts: [], notes_for_next_agent: "", ...extra });
const bad = () => ({ status: "fail", summary: "provider error", artifacts: [], notes_for_next_agent: "" });

// --- The library ------------------------------------------------------------

await test("a run id and cwd reach the body", async () => {
  let seen;
  const outcome = await runPipeline("t", async (ctx) => { seen = ctx; return { status: "success" }; },
    { ...FIXTURE, cwd: "/fixture/cwd" });
  assert.equal(seen.runId, "dip-fixture");
  assert.equal(seen.cwd, "/fixture/cwd");
  assert.equal(outcome.status, "success");
});

await test("every dispatch is recorded as a phase row for the run log", async () => {
  const outcome = await runPipeline("t", async (ctx) => {
    await ctx.dispatch({ agent: REVIEWER, phase: "one", prompt: "p", output: {} });
    await ctx.dispatch({ agent: THINKER, phase: "two", prompt: "p", output: {} });
    return { status: "success" };
  }, { ...FIXTURE, dispatch: async () => ok({ agent_name: "x", duration_ms: 5 }) });
  assert.deepEqual(outcome.phases.map((p) => p.id), ["one", "two"]);
  assert.equal(outcome.phases[0].status, "success");
});

await test("a throwing body fails the run instead of escaping", async () => {
  const outcome = await runPipeline("t", async () => { throw new Error("boom"); }, FIXTURE);
  assert.equal(outcome.status, "fail");
});

await test("a preflight refusal stops the run before any dispatch", async () => {
  let dispatched = 0;
  const outcome = await runPipeline("t", async (ctx) => {
    dispatched++;
    await ctx.dispatch({ agent: REVIEWER, phase: "one", prompt: "p", output: {} });
    return { status: "success" };
  }, { ...FIXTURE, preflight: async () => "no model", uses: [REVIEWER], dispatch: async () => ok() });
  assert.equal(outcome.status, "fail");
  assert.equal(dispatched, 0, "the body must not run at all");
});

await test("a preflight that itself throws is waved through, not fatal", async () => {
  const outcome = await runPipeline("t", async () => ({ status: "success" }),
    { ...FIXTURE, preflight: async () => { throw new Error("catalog down"); }, uses: [REVIEWER] });
  assert.equal(outcome.status, "success");
});

await test("a run with no declared agents skips the preflight entirely", async () => {
  let called = 0;
  await runPipeline("t", async () => ({ status: "success" }),
    { ...FIXTURE, preflight: async () => { called++; return undefined; } });
  assert.equal(called, 0);
});

await test("tools override the agent's own list for a scoped dispatch", async () => {
  const { options, seen } = withDispatch({ one: ok() });
  await runPipeline("t", async (ctx) => {
    await ctx.dispatch({ agent: REVIEWER, phase: "one", prompt: "p", output: {}, tools: ["only_this"] });
    return { status: "success" };
  }, options);
  assert.deepEqual(seen[0].tools, ["only_this"]);
});

// --- The shipped pipelines --------------------------------------------------

await test("review halts with its verdict, and asks for the review schema", async () => {
  const { options, seen } = withDispatch({ review: ok({ verdict: "pass", blocking: [] }) });
  const outcome = await runPipeline("review", (ctx) => review(ctx, "the last commit"), options);
  assert.equal(outcome.status, "halted", "a halt is a decision point, not a failure");
  assert.equal(outcome.result.review.verdict, "pass");
  assert.match(seen[0].prompt, /the last commit/);
  assert.equal(seen[0].agent.name, "reviewer");
});

await test("a failed review is a failure, not a halt", async () => {
  const { options } = withDispatch({ review: bad() });
  const outcome = await runPipeline("review", (ctx) => review(ctx, "x"), options);
  assert.equal(outcome.status, "fail");
});

await test("brainstorm consumes the research findings as structured data", async () => {
  const { options, seen } = withDispatch({
    gather: ok({ findings: [{ claim: "extensions load from cwd", source_url: "u", confidence: "medium" }], gaps: ["scale"] }),
    brainstorm: ok({ options: [{ approach: "a", tradeoff: "t", risk: "r" }], recommended: 0 }),
  });
  const outcome = await runPipeline("research", (ctx) => researchAndBrainstorm(ctx, "how?"), options);
  assert.equal(outcome.status, "halted");
  const prompt = seen[1].prompt;
  assert.match(prompt, /extensions load from cwd/, "the claim itself must reach the next step");
  assert.match(prompt, /"confidence": "medium"/, "confidence must survive — it changes how a claim is treated");
  assert.match(prompt, /scale/, "gaps must reach the next step");
});

await test("a failed research step stops the pipeline before brainstorming", async () => {
  const { options, seen } = withDispatch({ gather: bad() });
  const outcome = await runPipeline("research", (ctx) => researchAndBrainstorm(ctx, "how?"), options);
  assert.equal(outcome.status, "fail");
  assert.equal(seen.length, 1, "brainstorm must not be dispatched");
});

// --- The roster -------------------------------------------------------------

await test("every agent's model carries an explicit provider prefix", () => {
  // A bare spec defaults to ap-openai, which is how a copilot-* model 400s.
  for (const agent of ALL_AGENTS) {
    assert.ok(agent.model.includes("/"), `${agent.name} must name its provider`);
    assert.ok(parseModelSpec(agent.model).provider, `${agent.name} must parse`);
  }
});

await test("scout grants itself no tools; the dispatch site does", () => {
  assert.deepEqual(SCOUT.tools, []);
});

await test("thinker reads but never writes", () => {
  assert.ok(THINKER.tools.includes("read"));
  for (const forbidden of ["write", "edit", "bash"]) {
    assert.ok(!THINKER.tools.includes(forbidden), `thinker must not have ${forbidden}`);
  }
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
