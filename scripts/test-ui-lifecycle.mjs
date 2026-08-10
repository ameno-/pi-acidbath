import assert from "node:assert/strict";
import { activityKindForState, INITIAL_LIFECYCLE_STATE, phaseForStatus, reduceLifecycle, StatusTimingRecorder } from "../extensions/acidbath/ui-lifecycle.ts";

let state = reduceLifecycle(INITIAL_LIFECYCLE_STATE, { type: "session", generation: "session-1" });
assert.equal(state.generation, "session-1");
state = reduceLifecycle(state, { type: "status", status: "provider-wait", message: "listening" });
assert.equal(state.phase, "listening");
assert.equal(state.message, "listening");
state = reduceLifecycle(state, { type: "reasoning", active: true, preview: "Inspecting the provider response" });
assert.equal(state.phase, "reasoning");
assert.equal(state.reasoningActive, true);
assert.match(state.reasoningPreview, /Inspecting/);
state = reduceLifecycle(state, { type: "status", status: "tool-running", message: "running read" });
assert.equal(state.phase, "tool");
assert.equal(state.reasoningActive, false);
state = reduceLifecycle(state, { type: "settled" });
assert.deepEqual(state, { ...INITIAL_LIFECYCLE_STATE, generation: "session-1" });

assert.equal(phaseForStatus("tool-error"), "error");
assert.equal(activityKindForState("searching"), "listening");
assert.equal(activityKindForState("shaping"), "editing");

const timings = new StatusTimingRecorder("settled", 0);
timings.transition("reasoning", 100);
timings.transition("tool-running", 300);
const summaries = timings.summaries(500);
assert.equal(summaries.find((item) => item.state === "settled")?.count, 1);
assert.equal(summaries.find((item) => item.state === "settled")?.meanMs, 100);
assert.equal(summaries.find((item) => item.state === "reasoning")?.meanMs, 200);
assert.equal(summaries.find((item) => item.state === "tool-running")?.meanMs, 200);

console.log("lifecycle state machine: transitions and timing summaries pass");
