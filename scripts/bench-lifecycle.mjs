import { performance } from "node:perf_hooks";
import { synthesizeLabel } from "../extensions/acidbath/ui-labels.ts";
import { INITIAL_LIFECYCLE_STATE, reduceLifecycle } from "../extensions/acidbath/ui-lifecycle.ts";
import { formatContextRail } from "../extensions/acidbath/ui-token-context.ts";
import { formatToolRow } from "../extensions/acidbath/ui-tool-rows.ts";

function benchmark(name, iterations, fn) {
	const start = performance.now();
	for (let index = 0; index < iterations; index += 1) fn(index);
	const elapsed = performance.now() - start;
	console.log(`${name}: ${iterations.toLocaleString()} iterations in ${elapsed.toFixed(2)}ms (${(elapsed * 1000 / iterations).toFixed(3)}µs/op)`);
}

let lifecycle = INITIAL_LIFECYCLE_STATE;
benchmark("label synthesis", 100_000, (index) => {
	synthesizeLabel({ event: index % 2 ? "tool_call" : "message_update", toolName: index % 3 ? "grep" : "bash", toolArgs: { pattern: "token", command: "npm test" } });
});
benchmark("lifecycle reducer", 100_000, (index) => {
	lifecycle = reduceLifecycle(lifecycle, { type: "status", status: index % 2 ? "tool-running" : "reasoning", message: "working" });
});
benchmark("context rail formatting", 100_000, (index) => {
	const state = {
		lifecycle: "working",
		facts: { contextTokens: 80_000, contextWindow: 200_000, contextPercent: (index % 100) / 100, inputTokens: null, outputTokens: null, cacheReadTokens: null, cacheWriteTokens: null, reasoningTokens: null, totalTokens: null, source: "context-api", complete: false, sequence: index, generation: "bench" },
		contextDelta: null,
		segments: [],
		generation: "bench",
	};
	formatContextRail(state, 20);
});
benchmark("tool row formatting", 100_000, (index) => {
	formatToolRow({ width: 80, toolName: index % 2 ? "grep" : "bash", target: "src", status: index % 5 ? "pending" : "success", metadata: ["running"], expandable: true });
});
