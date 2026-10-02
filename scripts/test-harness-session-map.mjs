/**
 * Unit tests for extensions/harness/session-map.ts
 *
 * Run:
 *   node --experimental-strip-types --no-warnings scripts/test-harness-session-map.mjs
 */

import {
	assistantTextFromComplete,
	mapMessagesToHandoffEntries,
	mapToHandoffEntries,
	mapToRecapEntries,
} from "../extensions/harness/session-map.ts";

let passed = 0;
let failed = 0;

function assert(name, cond, detail) {
	if (cond) {
		passed++;
	} else {
		failed++;
		console.log(`FAIL  ${name}${detail ? `  (${detail})` : ""}`);
	}
}

function run(name, fn) {
	try {
		fn();
	} catch (e) {
		failed++;
		console.log(`FAIL  ${name}  threw: ${e?.message ?? e}`);
	}
}

run("maps user/assistant text blocks", () => {
	const out = mapToHandoffEntries([
		{ type: "message", message: { role: "user", content: "hello" } },
		{
			type: "message",
			message: { role: "assistant", content: [{ type: "text", text: "world" }] },
		},
	]);
	assert("len", out.length === 2);
	assert("user", out[0].type === "message" && out[0].role === "user" && out[0].text === "hello");
	assert("asst", out[1].type === "message" && out[1].role === "assistant" && out[1].text === "world");
});

run("maps compaction and drops tool/other", () => {
	const out = mapToHandoffEntries([
		{ type: "compaction", summary: "prior work" },
		{ type: "tool_result" },
		{ type: "message", message: { role: "system", content: "nope" } },
	]);
	assert("compaction", out[0].type === "compaction" && out[0].summary === "prior work");
	assert("other.tool", out[1].type === "other");
	assert("other.system", out[2].type === "other");
});

run("maps prepared agent messages", () => {
	const out = mapMessagesToHandoffEntries([
		{ role: "user", content: [{ type: "text", text: "goal" }] },
		{ role: "assistant", content: [{ type: "text", text: "progress" }] },
		{ role: "tool", content: [{ type: "text", text: "ignored" }] },
	]);
	assert("prepared.len", out.length === 3);
	assert("prepared.user", out[0].type === "message" && out[0].text === "goal");
	assert("prepared.assistant", out[1].type === "message" && out[1].text === "progress");
	assert("prepared.tool", out[2].type === "other");
});

run("recap maps custom entries and skips unknown", () => {
	const out = mapToRecapEntries([
		{ type: "message", message: { role: "user", content: "goal" } },
		{ type: "custom", customType: "acidbath-recap", data: { version: 1 } },
		{ type: "compaction", summary: "sum" },
		{ type: "label" },
	]);
	assert("len", out.length === 3, `got=${out.length}`);
	assert("msg", out[0].type === "message" && out[0].text === "goal");
	assert("custom", out[1].type === "custom" && out[1].customType === "acidbath-recap");
	assert("cmp", out[2].type === "compaction" && out[2].summary === "sum");
});

run("assistantTextFromComplete joins text parts", () => {
	assert(
		"join",
		assistantTextFromComplete([
			{ type: "thinking", thinking: "nope" },
			{ type: "text", text: "a" },
			{ type: "text", text: "b" },
		]) === "a\nb",
	);
	assert("empty", assistantTextFromComplete(undefined) === "");
});

run("does not mutate input", () => {
	const input = [{ type: "message", message: { role: "user", content: "x" } }];
	const copy = JSON.stringify(input);
	mapToHandoffEntries(input);
	mapToRecapEntries(input);
	assert("immutable", JSON.stringify(input) === copy);
});

console.log(`harness/session-map.ts: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
