// delegate.test.mjs — Tests for DelegateSystem (no real Pi session required)
// Run with: npx tsx adw/tests/delegate.test.mjs

import assert from "node:assert/strict";
import { DelegateSystem, parseModelSpec, resolveTools, SIDESHOW_HANDOFF_PROMPT } from "../delegate.ts";
import { OUTPUT_SCHEMAS, SUBMIT_INSTRUCTION } from "../envelope.ts";

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

console.log("Delegate Tests");
console.log("==============");

// Create a minimal agent def for testing
const TEST_AGENT = {
  name: "tester",
  model: "gemini-3.6-flash",
  tools: ["read", "grep"],
  system_prompts: [],
};

// Tests must never use local credentials or issue a provider request.
const missingModelDependencies = {
  createModelRuntime: async () => ({ getModel: () => undefined }),
  createSession: async () => {
    throw new Error("a missing model must never create a session");
  },
  now: () => 100,
};

// --- Model spec parsing ---
await test("parseModelSpec: basic model without provider or thinking", () => {
  const spec = parseModelSpec("gemini-3.6-flash");
  assert.equal(spec.provider, "ap-openai");
  assert.equal(spec.modelId, "gemini-3.6-flash");
  assert.equal(spec.thinking, undefined);
});

await test("parseModelSpec: model with thinking level", () => {
  const spec = parseModelSpec("gemini-3.6-flash:high");
  assert.equal(spec.provider, "ap-openai");
  assert.equal(spec.modelId, "gemini-3.6-flash");
  assert.equal(spec.thinking, "high");
});

await test("parseModelSpec: model with provider prefix", () => {
  const spec = parseModelSpec("anthropic/claude-opus-4-5");
  assert.equal(spec.provider, "anthropic");
  assert.equal(spec.modelId, "claude-opus-4-5");
  assert.equal(spec.thinking, undefined);
});

await test("parseModelSpec: full spec with provider and thinking", () => {
  const spec = parseModelSpec("openai/gpt-5.6-terra:high");
  assert.equal(spec.provider, "openai");
  assert.equal(spec.modelId, "gpt-5.6-terra");
  assert.equal(spec.thinking, "high");
});

await test("parseModelSpec: model with dots and numbers", () => {
  const spec = parseModelSpec("glm-5p2-fw");
  assert.equal(spec.provider, "ap-openai");
  assert.equal(spec.modelId, "glm-5p2-fw");
});

// --- Tool resolution ---
await test("resolveTools: filters to only listed tools", () => {
  const tools = resolveTools(["read", "bash"], process.cwd());
  const names = tools.map((t) => t.name);
  assert.ok(names.includes("read"), "should include read");
  assert.ok(names.includes("bash"), "should include bash");
  assert.ok(!names.includes("edit"), "should NOT include edit");
  assert.ok(!names.includes("write"), "should NOT include write");
});

await test("resolveTools: returns empty array for empty allowlist", () => {
  const tools = resolveTools([], process.cwd());
  assert.equal(tools.length, 0);
});

await test("resolveTools: read-only tools are present", () => {
  const tools = resolveTools(["read", "grep", "find", "ls"], process.cwd());
  const names = tools.map((t) => t.name);
  assert.ok(names.includes("read"));
  assert.ok(names.includes("grep"));
  assert.ok(names.includes("find"));
  assert.ok(names.includes("ls"));
  assert.ok(!names.includes("bash"));
});

// --- Envelope shape consistency ---
await test("unknown model fails before session creation and returns a valid envelope", async () => {
  const ds = new DelegateSystem(undefined, missingModelDependencies);
  const result = await ds.dispatchPi({
    agent: { ...TEST_AGENT, model: "nonexistent-model-xyz" }, prompt: "test", cwd: process.cwd(),
  });
  assert.equal(result.status, "fail");
  assert.match(result.summary, /Configured model not found/);
  assert.deepEqual(Object.keys(result).sort(), [
    "agent_name", "artifacts", "duration_ms", "notes_for_next_agent", "phase_id", "status", "summary",
  ]);
  assert.equal(result.duration_ms, 0);
});

// --- Progress events ---
await test("DelegateSystem constructor accepts progress callback", () => {
  const events = [];
  const ds = new DelegateSystem((event) => events.push(event));
  // Just verify the callback is stored — the actual dispatch will call it
  assert.ok(ds instanceof DelegateSystem);
});

await test("dispatchPi forwards the explicit model and tool allowlist, then cleans up", async () => {
  let options;
  let prompt;
  let disposed = false;
  let unsubscribed = false;
  const events = [];
  const ds = new DelegateSystem((event) => events.push(event), {
    createModelRuntime: async () => ({ getModel: () => ({ provider: "ap-openai", id: "gemini-3.6-flash" }) }),
    createSession: async (received) => {
      options = received;
      return { session: {
        subscribe: (listener) => { listener({ type: "fixture" }); return () => { unsubscribed = true; }; },
        prompt: async (value) => { prompt = value; },
        waitForIdle: async () => {},
        getLastAssistantText: () => "fixture response",
        getSessionStats: () => ({ tokens: { total: 12, input: 7, output: 5 }, cost: 0.01 }),
        dispose: () => { disposed = true; },
      } };
    },
    now: () => 100,
  });
  const result = await ds.dispatchPi({
    agent: TEST_AGENT, prompt: "task", cwd: process.cwd(), systemPromptOverrides: ["rules"], phaseId: "p1",
  });
  assert.equal(result.status, "success");
  assert.equal(result.summary, "fixture response");
  assert.equal(prompt, `rules\n\n${SIDESHOW_HANDOFF_PROMPT}\n\ntask`);
  assert.deepEqual(options.tools, ["read", "grep"]);
  assert.equal(options.noTools, "all");
  assert.deepEqual(options.customTools.map((tool) => tool.name), ["read", "grep"]);
  assert.equal(events.length, 1);
  assert.ok(disposed && unsubscribed, "session resources must be released");
});

await test("dispatchPi disposes a session when prompt execution fails", async () => {
  let disposed = false;
  let unsubscribed = false;
  const ds = new DelegateSystem(undefined, {
    createModelRuntime: async () => ({ getModel: () => ({ provider: "ap-openai", id: "gemini-3.6-flash" }) }),
    createSession: async () => ({ session: {
      subscribe: () => () => { unsubscribed = true; },
      prompt: async () => { throw new Error("fixture failure"); },
      waitForIdle: async () => {},
      getLastAssistantText: () => "",
      getSessionStats: () => ({ tokens: { total: 0, input: 0, output: 0 }, cost: 0 }),
      dispose: () => { disposed = true; },
    } }),
    now: () => 100,
  });
  const result = await ds.dispatchPi({ agent: TEST_AGENT, prompt: "task", cwd: process.cwd() });
  assert.equal(result.status, "fail");
  assert.match(result.summary, /fixture failure/);
  assert.ok(disposed && unsubscribed, "session resources must be released on error");
});

// --- The submit path ---------------------------------------------------------
// These drive the real `createSubmitTool` through the real dispatch code: the
// fake session looks up `submit` in the customTools the dispatcher registered
// and calls it, exactly as a model would. Nothing about the schema path is
// stubbed except the provider.

/**
 * A DelegateSystem whose session optionally submits, optionally speaks, and
 * optionally reports a provider error. Returns the seen dispatch inputs too.
 */
function submittingDelegate({ submission, finalText = "", providerError } = {}) {
  const seen = {};
  const ds = new DelegateSystem(undefined, {
    createModelRuntime: async () => ({ getModel: () => ({ provider: "ap-openai", id: "glm-5p2-fw" }) }),
    createSession: async (options) => {
      seen.options = options;
      let listener = () => {};
      return { session: {
        subscribe: (fn) => { listener = fn; return () => {}; },
        prompt: async (value) => {
          seen.prompt = value;
          if (providerError) {
            listener({ type: "message_end", message: { role: "assistant", stopReason: "error", errorMessage: providerError } });
            return;
          }
          if (submission) {
            const submit = options.customTools.find((tool) => tool.name === "submit");
            assert.ok(submit, "the dispatcher must have registered a submit tool");
            await submit.execute("call-1", submission);
          }
          listener({ type: "message_end", message: { role: "assistant", stopReason: "stop" } });
        },
        waitForIdle: async () => {},
        getLastAssistantText: () => finalText,
        getSessionStats: () => ({ tokens: { total: 0, input: 0, output: 0 }, cost: 0 }),
        dispose: () => {},
      } };
    },
    now: () => 100,
  });
  return { ds, seen };
}

const REVIEW_SCHEMA = OUTPUT_SCHEMAS.review;
const REVIEW_SUBMISSION = {
  status: "success",
  summary: "Reviewed the diff.",
  artifacts: ["adw/delegate.ts"],
  notes_for_next_agent: "",
  verdict: "block",
  blocking: [{ file: "adw/delegate.ts", line: 298, why: "summary was the whole message" }],
};

await test("a declared schema registers submit in both customTools and the allowlist", async () => {
  const { ds, seen } = submittingDelegate({ submission: REVIEW_SUBMISSION });
  await ds.dispatchPi({ agent: TEST_AGENT, prompt: "review", cwd: process.cwd(), outputSchema: REVIEW_SCHEMA });
  assert.deepEqual(seen.options.customTools.map((tool) => tool.name), ["read", "grep", "submit"]);
  assert.deepEqual(seen.options.tools, ["read", "grep", "submit"], "registering is not enough; it must be allowed");
  const submit = seen.options.customTools.at(-1);
  assert.equal(submit.parameters, REVIEW_SCHEMA, "submit's parameters are the phase's schema, not a copy");
});

await test("no schema means no submit tool and the prose handoff instead", async () => {
  const { ds, seen } = submittingDelegate({ finalText: "prose" });
  await ds.dispatchPi({ agent: TEST_AGENT, prompt: "review", cwd: process.cwd() });
  assert.ok(!seen.options.tools.includes("submit"));
  assert.ok(seen.prompt.includes(SIDESHOW_HANDOFF_PROMPT));
  assert.ok(!seen.prompt.includes(SUBMIT_INSTRUCTION));
});

await test("the submit instruction replaces the prose handoff — never both", async () => {
  const { ds, seen } = submittingDelegate({ submission: REVIEW_SUBMISSION });
  await ds.dispatchPi({ agent: TEST_AGENT, prompt: "review", cwd: process.cwd(), outputSchema: REVIEW_SCHEMA });
  assert.ok(seen.prompt.includes(SUBMIT_INSTRUCTION));
  assert.ok(!seen.prompt.includes(SIDESHOW_HANDOFF_PROMPT), "asking for both reliably gets you both");
});

await test("submitted fields reach the envelope", async () => {
  const { ds } = submittingDelegate({ submission: REVIEW_SUBMISSION });
  const result = await ds.dispatchPi({
    agent: TEST_AGENT, prompt: "review", cwd: process.cwd(), outputSchema: REVIEW_SCHEMA,
  });
  assert.equal(result.status, "success");
  assert.equal(result.summary, "Reviewed the diff.");
  assert.equal(result.verdict, "block");
  assert.deepEqual(result.blocking, REVIEW_SUBMISSION.blocking);
  assert.deepEqual(result.artifacts, ["adw/delegate.ts"]);
  assert.equal(result.submit_missing, false);
});

await test("run metadata is not clobbered by a submission that names the same fields", async () => {
  const { ds } = submittingDelegate({
    submission: {
      ...REVIEW_SUBMISSION,
      agent_name: "impostor",
      phase_id: "not-this-phase",
      model_used: "someone-elses-model",
      duration_ms: 999_999,
      session_id: "not-this-run",
      submit_missing: true,
    },
  });
  const result = await ds.dispatchPi({
    agent: TEST_AGENT, prompt: "review", cwd: process.cwd(),
    outputSchema: REVIEW_SCHEMA, runId: "run-1", phaseId: "review",
  });
  assert.equal(result.agent_name, "tester");
  assert.equal(result.phase_id, "review");
  assert.equal(result.model_used, "ap-openai/gemini-3.6-flash:medium");
  assert.equal(result.duration_ms, 0);
  assert.equal(result.session_id, "run-1");
  assert.equal(result.submit_missing, false);
});

await test("strict: finishing without submit fails the phase and carries what it said", async () => {
  const { ds } = submittingDelegate({ finalText: "Here is my review in prose." });
  const result = await ds.dispatchPi({
    agent: TEST_AGENT, prompt: "review", cwd: process.cwd(), outputSchema: REVIEW_SCHEMA,
  });
  assert.equal(result.status, "fail");
  assert.match(result.summary, /finished without calling submit/);
  assert.match(result.notes_for_next_agent, /Here is my review in prose\./);
  assert.equal(result.submit_missing, true);
});

await test("permissive: finishing without submit is accepted as unstructured prose", async () => {
  const { ds } = submittingDelegate({ finalText: "Here is my review in prose." });
  const result = await ds.dispatchPi({
    agent: TEST_AGENT, prompt: "review", cwd: process.cwd(),
    outputSchema: REVIEW_SCHEMA, submitMode: "permissive",
  });
  assert.equal(result.status, "success");
  assert.equal(result.summary, "Here is my review in prose.");
  assert.equal(result.verdict, undefined, "permissive cannot invent the schema's fields");
  assert.match(result.notes_for_next_agent, /never called submit/);
  assert.equal(result.submit_missing, true);
});

await test("permissive still fails when there is no text to accept", async () => {
  const { ds } = submittingDelegate({ finalText: "   " });
  const result = await ds.dispatchPi({
    agent: TEST_AGENT, prompt: "review", cwd: process.cwd(),
    outputSchema: REVIEW_SCHEMA, submitMode: "permissive",
  });
  assert.equal(result.status, "fail");
  assert.equal(result.submit_missing, true);
});

await test("a provider error is reported as a provider error, not as a missing submit", async () => {
  const { ds } = submittingDelegate({ providerError: "400 model not supported, no fallback group" });
  const result = await ds.dispatchPi({
    agent: TEST_AGENT, prompt: "review", cwd: process.cwd(), outputSchema: REVIEW_SCHEMA,
  });
  assert.equal(result.status, "fail");
  assert.match(result.summary, /could not reach its model/);
  assert.match(result.summary, /no fallback group/);
  assert.match(result.notes_for_next_agent, /provider or gateway error/);
  // Deliberately absent: the request never reached a model, so whether the
  // contract would have been honoured is not a question this run can answer.
  assert.equal(result.submit_missing, undefined);
});

await test("a provider error that a later attempt recovers from is not a failure", async () => {
  // An errored message is emitted before any auto-retry decision. Latching on
  // the first error would report a recovered run as a hard provider failure.
  const ds = new DelegateSystem(undefined, {
    createModelRuntime: async () => ({ getModel: () => ({ provider: "ap-openai", id: "glm-5p2-fw" }) }),
    createSession: async (options) => {
      let listener = () => {};
      return { session: {
        subscribe: (fn) => { listener = fn; return () => {}; },
        prompt: async () => {
          listener({ type: "message_end", message: { role: "assistant", stopReason: "error", errorMessage: "transient" } });
          const submit = options.customTools.find((tool) => tool.name === "submit");
          await submit.execute("call-1", REVIEW_SUBMISSION);
          listener({ type: "message_end", message: { role: "assistant", stopReason: "stop" } });
        },
        waitForIdle: async () => {},
        getLastAssistantText: () => "",
        getSessionStats: () => ({ tokens: { total: 0, input: 0, output: 0 }, cost: 0 }),
        dispose: () => {},
      } };
    },
    now: () => 100,
  });
  const result = await ds.dispatchPi({
    agent: TEST_AGENT, prompt: "review", cwd: process.cwd(), outputSchema: REVIEW_SCHEMA,
  });
  assert.equal(result.status, "success");
  assert.equal(result.verdict, "block");
});

// --- The tool allowlist ------------------------------------------------------
// Pi ignores unknown tool names rather than reporting them, so a misspelled or
// undiscoverable tool used to mean the agent quietly ran without it. Extension
// tools are discovered from `cwd`, which makes this the failure mode a research
// phase run from the wrong directory would hit.

/**
 * A DelegateSystem whose session activates only `activates`. Passing undefined
 * omits `getActiveToolNames` entirely, modelling an SDK that cannot report it.
 */
function toolCheckingDelegate(activates) {
  let disposed = false;
  const ds = new DelegateSystem(undefined, {
    createModelRuntime: async () => ({ getModel: () => ({ provider: "ap-openai", id: "glm-5p2-fw" }) }),
    createSession: async () => ({ session: {
      subscribe: () => () => {},
      prompt: async () => {},
      waitForIdle: async () => {},
      ...(activates ? { getActiveToolNames: () => activates } : {}),
      getLastAssistantText: () => "fixture response",
      getSessionStats: () => ({ tokens: { total: 0, input: 0, output: 0 }, cost: 0 }),
      dispose: () => { disposed = true; },
    } }),
    now: () => 100,
  });
  return { ds, disposed: () => disposed };
}

await test("a tool that did not activate fails the dispatch instead of running without it", async () => {
  const { ds, disposed } = toolCheckingDelegate(["read"]);
  const result = await ds.dispatchPi({
    agent: { name: "scout", model: "glm-5p2-fw", tools: ["read", "agy_research"], system_prompts: [] },
    prompt: "research",
    cwd: "/elsewhere",
    phaseId: "gather",
  });
  assert.equal(result.status, "fail");
  assert.match(result.summary, /agy_research/);
  assert.match(result.notes_for_next_agent, /\/elsewhere/, "the note must name the cwd that was searched");
  assert.ok(disposed(), "the session must still be released");
});

await test("the submit tool is checked too, since a dropped submit cannot be recovered from", async () => {
  const { ds } = toolCheckingDelegate(["read"]);
  const result = await ds.dispatchPi({
    agent: { name: "tester", model: "glm-5p2-fw", tools: ["read"], system_prompts: [] },
    prompt: "task",
    cwd: process.cwd(),
    outputSchema: OUTPUT_SCHEMAS.generic,
  });
  assert.equal(result.status, "fail");
  assert.match(result.summary, /submit/);
});

await test("a dispatch whose tools all activate proceeds normally", async () => {
  const { ds } = toolCheckingDelegate(["read", "agy_research"]);
  const result = await ds.dispatchPi({
    agent: { name: "scout", model: "glm-5p2-fw", tools: ["read", "agy_research"], system_prompts: [] },
    prompt: "research",
    cwd: process.cwd(),
  });
  assert.equal(result.status, "success");
  assert.equal(result.summary, "fixture response");
});

await test("a session that cannot report its active tools is waved through, not failed", async () => {
  // A check that cannot run must never be the thing that decides.
  const { ds } = toolCheckingDelegate(undefined);
  const result = await ds.dispatchPi({
    agent: TEST_AGENT, prompt: "task", cwd: process.cwd(),
  });
  assert.equal(result.status, "success");
});

// Summary
console.log("");
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
