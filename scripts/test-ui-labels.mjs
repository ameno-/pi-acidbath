/**
 * Unit tests for ui-labels.ts (V1 deterministic label synthesis).
 *
 * Run:
 *   node --experimental-strip-types --no-warnings scripts/test-ui-labels.mjs
 *
 * Pure test file — imports the production ui-labels.ts and exercises
 * every code path. No Pi runtime, no TUI. Asserts:
 *   1. Pure determinism: same input → same output, every call.
 *   2. Coverage: every LabelEvent + every toolName mapping branch.
 *   3. V1 contract: no timer creation, no model output parsing, no
 *      random/time-based behavior.
 *   4. State mapping: read/grep/find/ls → searching, edit/write →
 *      shaping, bash/ast_grep/subagent → working.
 *   5. Render-time args: file_path, command, pattern, subagent.
 *   6. Aggregate: tool_result with editedFilesThisTurn of size N →
 *      "Edited N files" message.
 *   7. Error: tool_result with isError → "<tool> failed".
 *   8. agent_end → cleared message.
 *
 * The test exits 1 on any failure.
 */

import { synthesizeLabel } from "../extensions/acidbath/ui-labels.ts";

let passed = 0;
let failed = 0;
const failures = [];

function eq(actual, expected) {
	if (actual === expected) return true;
	if (typeof actual === "string" && typeof expected === "string" && actual === expected) return true;
	return false;
}

function assert(name, cond, detail) {
	if (cond) {
		passed++;
	} else {
		failed++;
		failures.push({ name, detail });
		console.log(`FAIL  ${name}  ${detail ? "(" + detail + ")" : ""}`);
	}
}

function run(name, fn) {
	try {
		fn();
	} catch (e) {
		failed++;
		failures.push({ name, detail: `threw: ${e?.message ?? e}` });
		console.log(`FAIL  ${name}  threw: ${e?.message ?? e}`);
	}
}

// ---------------------------------------------------------------------------
// 1. Pure determinism
// ---------------------------------------------------------------------------

run("determinism — same input, same output, 1000x", () => {
	const input = { event: "tool_call", toolName: "read", toolArgs: { file_path: "/tmp/foo.ts" } };
	const first = synthesizeLabel(input);
	for (let i = 0; i < 1000; i++) {
		const out = synthesizeLabel(input);
		assert(`determinism[${i}]`, eq(out.message, first.message) && eq(out.orbState, first.orbState) && eq(out.rule, first.rule), `drift: ${JSON.stringify(out)} vs ${JSON.stringify(first)}`);
	}
});

// ---------------------------------------------------------------------------
// 2. Coverage — every event
// ---------------------------------------------------------------------------

run("agent_start → solving / 'Solving…'", () => {
	const out = synthesizeLabel({ event: "agent_start" });
	assert("agent_start.orbState", out.orbState === "solving", `got=${out.orbState}`);
	assert("agent_start.message", out.message === "Solving…", `got="${out.message}"`);
	assert("agent_start.rule", out.rule === "agent_start", `got=${out.rule}`);
});

run("before_provider_request → listening / 'Listening…'", () => {
	const out = synthesizeLabel({ event: "before_provider_request" });
	assert("bp.orbState", out.orbState === "listening");
	assert("bp.message", out.message === "Listening…");
	assert("bp.rule", out.rule === "before_provider_request");
});

run("after_provider_response → solving / 'Reasoning over response…'", () => {
	const out = synthesizeLabel({ event: "after_provider_response" });
	assert("ap.orbState", out.orbState === "solving");
	assert("ap.message", out.message === "Reasoning over response…");
	assert("ap.rule", out.rule === "after_provider_response");
});

run("message_update → composing / 'Composing…'", () => {
	const out = synthesizeLabel({ event: "message_update" });
	assert("mu.orbState", out.orbState === "composing");
	assert("mu.message", out.message === "Composing…");
	assert("mu.rule", out.rule === "message_update");
});

run("agent_end → working / cleared", () => {
	const out = synthesizeLabel({ event: "agent_end" });
	assert("end.orbState", out.orbState === "working");
	assert("end.message", out.message === "", `got="${out.message}"`);
	assert("end.rule", out.rule === "agent_end");
});

// ---------------------------------------------------------------------------
// 3. tool_call — state mapping per PLAN §4 + extended for ast-grep / droid
// ---------------------------------------------------------------------------

const searchTools = ["read", "grep", "find", "ls", "search", "web_search"];
for (const name of searchTools) {
	run(`tool_call ${name} → searching`, () => {
		const out = synthesizeLabel({ event: "tool_call", toolName: name });
		assert(`${name}.state`, out.orbState === "searching", `got=${out.orbState}`);
		assert(`${name}.defaultMessage`, out.message === "Searching…", `got="${out.message}"`);
	});
}

const shapeTools = ["edit", "write", "apply_patch"];
for (const name of shapeTools) {
	run(`tool_call ${name} → shaping (no file_path)`, () => {
		const out = synthesizeLabel({ event: "tool_call", toolName: name });
		assert(`${name}.state`, out.orbState === "shaping", `got=${out.orbState}`);
		assert(`${name}.defaultMessage`, out.message === "Shaping…", `got="${out.message}"`);
	});
}

const workTools = ["bash", "ast_grep_search", "ast_grep_replace", "ast_grep_run", "ast_grep_scan", "agy_subagent", "subagent", "complete_research_request", "droid", "weird_tool"];
for (const name of workTools) {
	run(`tool_call ${name} → working`, () => {
		const out = synthesizeLabel({ event: "tool_call", toolName: name });
		assert(`${name}.state`, out.orbState === "working", `got=${out.orbState}`);
	});
}

// ---------------------------------------------------------------------------
// 4. tool_call — render-time args
// ---------------------------------------------------------------------------

run("tool_call read with file_path → 'Searching in <path>'", () => {
	const out = synthesizeLabel({ event: "tool_call", toolName: "read", toolArgs: { file_path: "/Users/ameno/dev/acidbath/extensions/acidbath/index.ts" } });
	assert("read.path.message", out.message === "Searching in /Users/ameno/dev/acidbath/extensions/acidbath/index.ts", `got="${out.message}"`);
	assert("read.path.state", out.orbState === "searching");
	assert("read.path.rule", out.rule === "tool_call.searching.file_path");
});

run("tool_call read with very long file_path → truncated", () => {
	const longPath = `/Users/ameno/${"x".repeat(200)}/file.ts`;
	const out = synthesizeLabel({ event: "tool_call", toolName: "read", toolArgs: { file_path: longPath } });
	assert("read.long.truncated", out.message.length <= 80, `len=${out.message.length}`);
	assert("read.long.hasEllipsis", out.message.includes("…"));
});

run("tool_call grep with pattern → 'Searching for <pattern>'", () => {
	const out = synthesizeLabel({ event: "tool_call", toolName: "grep", toolArgs: { pattern: "PI_ACIDBATH_" } });
	assert("grep.pattern.message", out.message === "Searching for PI_ACIDBATH_", `got="${out.message}"`);
	assert("grep.pattern.rule", out.rule === "tool_call.searching.pattern");
});

run("tool_call edit with file_path → 'Editing <basename>'", () => {
	const out = synthesizeLabel({ event: "tool_call", toolName: "edit", toolArgs: { file_path: "/Users/ameno/dev/acidbath/index.ts" } });
	assert("edit.path.message", out.message === "Editing index.ts", `got="${out.message}"`);
	assert("edit.path.rule", out.rule === "tool_call.shaping.file_path");
});

run("tool_call write with file_path → 'Writing <basename>'", () => {
	const out = synthesizeLabel({ event: "tool_call", toolName: "write", toolArgs: { file_path: "/tmp/output.txt" } });
	assert("write.path.message", out.message === "Writing output.txt", `got="${out.message}"`);
	assert("write.path.rule", out.rule === "tool_call.shaping.file_path");
});

run("tool_call apply_patch with file_path → 'Applying patch <basename>'", () => {
	const out = synthesizeLabel({ event: "tool_call", toolName: "apply_patch", toolArgs: { file_path: "/tmp/diff.patch" } });
	assert("patch.path.message", out.message === "Applying patch diff.patch", `got="${out.message}"`);
});

run("tool_call bash with command → 'Running command: <cmd>'", () => {
	const out = synthesizeLabel({ event: "tool_call", toolName: "bash", toolArgs: { command: "ls -la" } });
	assert("bash.cmd.message", out.message === "Running command: ls -la", `got="${out.message}"`);
	assert("bash.cmd.rule", out.rule === "tool_call.working.bash.command");
});

run("tool_call bash without command → 'Running command…'", () => {
	const out = synthesizeLabel({ event: "tool_call", toolName: "bash" });
	assert("bash.empty.message", out.message === "Running command…", `got="${out.message}"`);
});

run("tool_call bash with long command → truncated", () => {
	const out = synthesizeLabel({ event: "tool_call", toolName: "bash", toolArgs: { command: "x".repeat(200) } });
	assert("bash.long.truncated", out.message.length <= 60, `len=${out.message.length}`);
});

run("tool_call subagent with subagent arg → 'Working on <name>…'", () => {
	const out = synthesizeLabel({ event: "tool_call", toolName: "agy_subagent", toolArgs: { subagent: "code-reviewer" } });
	assert("subagent.message", out.message === "Working on code-reviewer…", `got="${out.message}"`);
	assert("subagent.rule", out.rule === "tool_call.working.subagent");
});

run("tool_call droid → 'Working on droid…'", () => {
	const out = synthesizeLabel({ event: "tool_call", toolName: "droid" });
	assert("droid.message", out.message === "Working on droid…", `got="${out.message}"`);
	assert("droid.rule", out.rule === "tool_call.working.droid");
});

run("tool_call ast_grep_search → 'Running ast-grep…'", () => {
	const out = synthesizeLabel({ event: "tool_call", toolName: "ast_grep_search" });
	assert("ast.message", out.message === "Running ast-grep…", `got="${out.message}"`);
	assert("ast.rule", out.rule === "tool_call.working.ast_grep");
});

run("tool_call unknown → 'Running <name>…'", () => {
	const out = synthesizeLabel({ event: "tool_call", toolName: "totally_uninvented_tool" });
	assert("unknown.message", out.message === "Running totally_uninvented_tool…", `got="${out.message}"`);
	assert("unknown.rule", out.rule === "tool_call.working.default");
});

// ---------------------------------------------------------------------------
// 5. tool_result — single + aggregate
// ---------------------------------------------------------------------------

run("tool_result read success → 'Search complete'", () => {
	const out = synthesizeLabel({ event: "tool_result", toolName: "read" });
	assert("tr.search.message", out.message === "Search complete", `got="${out.message}"`);
	assert("tr.search.state", out.orbState === "solving");
});

run("tool_result edit success with N=3 → 'Edited 3 files'", () => {
	const files = new Set(["/a", "/b", "/c"]);
	const out = synthesizeLabel({ event: "tool_result", toolName: "edit", editedFilesThisTurn: files });
	assert("tr.edit.aggregate", out.message === "Edited 3 files", `got="${out.message}"`);
	assert("tr.edit.agg.rule", out.rule === "tool_result.shaping.aggregate");
});

run("tool_result edit success with N=1 → 'Edited 1 file'", () => {
	const files = new Set(["/only"]);
	const out = synthesizeLabel({ event: "tool_result", toolName: "edit", editedFilesThisTurn: files });
	assert("tr.edit.single", out.message === "Edited 1 file", `got="${out.message}"`);
	assert("tr.edit.single.rule", out.rule === "tool_result.shaping.single");
});

run("tool_result edit success with empty set → 'Edit complete'", () => {
	const out = synthesizeLabel({ event: "tool_result", toolName: "edit", editedFilesThisTurn: new Set() });
	assert("tr.edit.empty", out.message === "Edit complete", `got="${out.message}"`);
});

run("tool_result bash success → 'Command finished'", () => {
	const out = synthesizeLabel({ event: "tool_result", toolName: "bash" });
	assert("tr.bash.message", out.message === "Command finished", `got="${out.message}"`);
	assert("tr.bash.rule", out.rule === "tool_result.bash");
});

run("tool_result with isError → '<tool> failed'", () => {
	const out = synthesizeLabel({ event: "tool_result", toolName: "read", isError: true });
	assert("tr.error.message", out.message === "read failed", `got="${out.message}"`);
	assert("tr.error.rule", out.rule === "tool_result.error");
});

run("tool_result with isPartial → mirror call-state label", () => {
	const outRead = synthesizeLabel({ event: "tool_result", toolName: "read", isPartial: true });
	assert("tr.partial.read", outRead.message === "Searching…" && outRead.orbState === "searching", `got=${JSON.stringify(outRead)}`);
	const outEdit = synthesizeLabel({ event: "tool_result", toolName: "edit", isPartial: true });
	assert("tr.partial.edit", outEdit.message === "Shaping…" && outEdit.orbState === "shaping", `got=${JSON.stringify(outEdit)}`);
	const outBash = synthesizeLabel({ event: "tool_result", toolName: "bash", isPartial: true });
	assert("tr.partial.bash", outBash.message === "Working…" && outBash.orbState === "working", `got=${JSON.stringify(outBash)}`);
});

// ---------------------------------------------------------------------------
// 6. V1 invariants
// ---------------------------------------------------------------------------

run("deterministic:true always set", () => {
	const inputs = [
		{ event: "agent_start" },
		{ event: "tool_call", toolName: "read" },
		{ event: "tool_result", toolName: "edit", isError: true },
		{ event: "agent_end" },
	];
	for (const i of inputs) {
		const out = synthesizeLabel(i);
		assert(`deterministic[${i.event}]`, out.deterministic === true, `out=${JSON.stringify(out)}`);
	}
});

run("orbState always one of ORB_STATES", () => {
	const inputs = [
		{ event: "agent_start" },
		{ event: "before_provider_request" },
		{ event: "after_provider_response" },
		{ event: "message_update" },
		{ event: "agent_end" },
		{ event: "tool_call", toolName: "read" },
		{ event: "tool_call", toolName: "edit" },
		{ event: "tool_call", toolName: "bash" },
		{ event: "tool_result", toolName: "read" },
		{ event: "tool_result", toolName: "edit" },
		{ event: "tool_result", toolName: "bash" },
	];
	for (const i of inputs) {
		const out = synthesizeLabel(i);
		const valid = ["working", "searching", "solving", "listening", "composing", "shaping"];
		assert(`valid[${i.event},${i.toolName ?? ""}]`, valid.includes(out.orbState), `got=${out.orbState}`);
	}
});

run("intent field ignored by V1 (deterministic returns same label)", () => {
	const a = synthesizeLabel({ event: "tool_call", toolName: "read", toolArgs: { file_path: "/x.ts" } });
	const b = synthesizeLabel({ event: "tool_call", toolName: "read", toolArgs: { file_path: "/x.ts" }, intent: { adaptive: "anything" } });
	assert("intent.ignored", eq(a.message, b.message) && eq(a.orbState, b.orbState) && eq(a.rule, b.rule));
});

run("tool_call unknown toolName falls through to working.default", () => {
	const out = synthesizeLabel({ event: "tool_call", toolName: "?" });
	assert("fallback.state", out.orbState === "working");
	assert("fallback.message", out.message === "Running ?…", `got="${out.message}"`);
	assert("fallback.rule", out.rule === "tool_call.working.default");
});

run("no side effects — synthesize is referentially transparent", () => {
	const input = { event: "tool_call", toolName: "bash", toolArgs: { command: "ls" } };
	const r1 = synthesizeLabel(input);
	const r2 = synthesizeLabel(input);
	const r3 = synthesizeLabel(input);
	assert("r1===r2", r1.message === r2.message && r1.rule === r2.rule);
	assert("r2===r3", r2.message === r3.message && r2.rule === r3.rule);
});

// ---------------------------------------------------------------------------
// 7. V1 budget: hot path under 50µs
// ---------------------------------------------------------------------------

run("hot path < 50µs/call (100k calls, full grid)", () => {
	const inputs = [
		{ event: "agent_start" },
		{ event: "before_provider_request" },
		{ event: "after_provider_response" },
		{ event: "message_update" },
		{ event: "agent_end" },
		{ event: "tool_call", toolName: "read", toolArgs: { file_path: "/foo/bar/baz.ts" } },
		{ event: "tool_call", toolName: "edit", toolArgs: { file_path: "/x.ts" } },
		{ event: "tool_call", toolName: "bash", toolArgs: { command: "ls -la" } },
		{ event: "tool_result", toolName: "edit", editedFilesThisTurn: new Set(["/a", "/b", "/c"]) },
		{ event: "tool_result", toolName: "read", isError: true },
	];
	const start = performance.now();
	for (let i = 0; i < 100_000; i++) {
		synthesizeLabel(inputs[i % inputs.length]);
	}
	const elapsed = performance.now() - start;
	const perCall = elapsed / 100_000;
	assert("hot path budget", perCall < 0.05, `perCall=${perCall.toFixed(3)}ms`);
});

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

console.log(`\nui-labels.ts: ${passed} passed, ${failed} failed`);
if (failed > 0) {
	for (const f of failures.slice(0, 20)) {
		console.log(`  - ${f.name}: ${f.detail ?? ""}`);
	}
	process.exit(1);
}
