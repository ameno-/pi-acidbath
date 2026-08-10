/** Deterministic token/context and tool-row fixtures at production widths. */
import {
  createTokenContextState,
  formatContextFact,
  formatContextRail,
  formatTurnUsage,
  reduceTokenContext,
  unknownUsageFacts,
} from "../extensions/acidbath/ui-token-context.ts";
import { formatToolRow, toolRowVisibleWidth } from "../extensions/acidbath/ui-tool-rows.ts";

let passed = 0;
let failed = 0;
function assert(name, condition, detail = "") {
  if (condition) passed += 1;
  else { failed += 1; console.log(`FAIL ${name}${detail ? ` (${detail})` : ""}`); }
}
function facts(generation, sequence, extra = {}) {
  return { ...unknownUsageFacts(generation, sequence), ...extra };
}

let state = createTokenContextState({ generation: "run-1" });
state = reduceTokenContext(state, { type: "usage", facts: facts("run-1", 1, { contextTokens: 82000, contextWindow: 200000, contextPercent: 0.41 }) });
assert("known context fact", formatContextFact(state.facts) === "ctx 82k/200k 41%");
assert("default rail has no numeric percent", !formatContextRail(state, 80).includes("41%"));
for (const width of [40, 60, 80, 120]) {
  const rail = formatContextRail(state, width);
  assert(`rail width ${width}`, Array.from(rail).length <= width, rail);
}
state = reduceTokenContext(state, { type: "usage", facts: facts("run-1", 2, { contextTokens: 84500, contextWindow: 200000, contextPercent: 0.4225 }) });
assert("increase queues bounded bubbles", state.pendingBubbles >= 1 && state.pendingBubbles <= 3);
const moving = formatContextRail(state, 80);
assert("increase shows bubble", moving.includes("○"));
state = reduceTokenContext(state, { type: "frame_tick" });
state = reduceTokenContext(state, { type: "agent_end", outcome: "success" });
assert("agent end is done", state.lifecycle === "done" && state.pendingBubbles === 0);
state = reduceTokenContext(state, { type: "agent_settled" });
assert("agent settled is terminal", state.lifecycle === "settled");

const compacted = reduceTokenContext(state, { type: "reset", generation: "run-2" });
assert("reset clears facts", compacted.facts === null && compacted.pendingBubbles === 0);
const unknown = reduceTokenContext(compacted, { type: "usage", facts: facts("run-2", 1) });
assert("unknown remains unknown", formatContextFact(unknown.facts) === "ctx ?");
assert("unknown rail reserves an empty fixed view", formatContextRail(unknown, 20) === "ctx ················");
assert("unknown turn reserves zero-width-safe fields", formatTurnUsage(unknown.facts) === "turn   0 in /   0 out");

const usage = reduceTokenContext(unknown, { type: "usage", facts: facts("run-2", 2, { inputTokens: 1200, outputTokens: 340, complete: true, source: "assistant-usage" }) });
assert("turn usage formatter", formatTurnUsage(usage.facts) === "turn 1.2k in / 340 out");
assert("stale sequence rejected", reduceTokenContext(usage, { type: "usage", facts: facts("run-2", 1, { contextPercent: 0.9 }) }).facts?.contextPercent === null);

for (const width of [40, 60, 80, 120]) {
  const row = formatToolRow({ width, toolName: "bash", target: "bun test && bun run lint", status: "pending", phase: 2, metadata: ["running"], expandable: true });
  assert(`tool row width ${width}`, toolRowVisibleWidth(row) <= width, row);
}
const phaseRows = [0, 1, 2, 3].map((phase) => formatToolRow({ width: 60, toolName: "grep", target: "src", status: "pending", phase }));
assert("pending tool target stays aligned", phaseRows.every((row) => row.indexOf("grep") === phaseRows[0].indexOf("grep")));
assert("tool success status survives plain text", formatToolRow({ width: 60, toolName: "edit", target: "src/app.ts", status: "success", metadata: ["+3 -1"] }).startsWith("ok  edit"));
assert("tool error expansion survives plain text", formatToolRow({ width: 60, toolName: "edit", target: "src/app.ts", status: "error", metadata: ["old text not found"], expandable: true }).includes("expand"));
const wideRow = formatToolRow({ width: 40, toolName: "read", target: "資料/編集.ts", status: "success", metadata: ["214 lines"], expandable: true });
assert("wide unicode row remains width-safe", toolRowVisibleWidth(wideRow) <= 40, wideRow);

console.log(`token/tool fixtures: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
