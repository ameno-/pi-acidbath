// delegate.test.mjs — Tests for DelegateSystem (no real Pi session required)
// Run with: npx tsx adw/tests/delegate.test.mjs

import assert from "node:assert/strict";
import { DelegateSystem, parseModelSpec, resolveTools, SIDESHOW_HANDOFF_PROMPT } from "../delegate.ts";

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

// Summary
console.log("");
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
