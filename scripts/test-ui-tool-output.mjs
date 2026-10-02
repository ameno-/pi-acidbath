import assert from "node:assert/strict";
import {
	countTextLines,
	summarizeToolOutput,
	targetForTool,
} from "../extensions/acidbath/ui-tool-output.ts";

const textResult = (text, details) => ({ content: [{ type: "text", text }], details });

assert.equal(
	targetForTool("read", { path: "/home/donatello/dev/pi-acidbath/skills/acidbath-operator/SKILL.md" }),
	"skill acidbath-operator",
);
assert.equal(targetForTool("read", { path: "docs/plan.md", offset: 10, limit: 5 }), "doc docs/plan.md:10-14");
assert.equal(targetForTool("read", { path: "AGENTS.md" }), "context AGENTS.md");
assert.equal(targetForTool("grep", { pattern: "renderResult", path: "extensions" }), "\"renderResult\" in extensions");
assert.equal(targetForTool("find", { pattern: "*.ts", path: "src" }), "*.ts in src");

assert.equal(countTextLines(""), 0);
assert.equal(countTextLines("one"), 1);
assert.equal(countTextLines("one\ntwo\n"), 2);

const skill = summarizeToolOutput(
	"read",
	{ path: "/tmp/acidbath-operator/SKILL.md" },
	textResult(["---", "name: acidbath-operator", "---", "", "# Acidbath", "body"].join("\n")),
	{ isPartial: false, isError: false },
);
assert.deepEqual(skill.metadata, ["6 lines"]);
assert.equal(skill.hasDetails, true);
assert.equal(skill.errorLine, undefined);

const partialResult = {};
Object.defineProperty(partialResult, "content", { get: () => { throw new Error("partial output was scanned"); } });
const partial = summarizeToolOutput(
	"bash",
	{ command: "npm test" },
	partialResult,
	{ isPartial: true, isError: false },
);
assert.deepEqual(partial, { metadata: ["running"], hasDetails: false });

const bash = summarizeToolOutput(
	"bash",
	{ command: "npm test" },
	textResult("one\ntwo\nthree"),
	{ isPartial: false, isError: false, durationMs: 1250 },
);
assert.deepEqual(bash.metadata, ["completed", "3 lines", "1.3s"]);

const failure = summarizeToolOutput(
	"bash",
	{ command: "npm test" },
	textResult("\nAssertionError: expected true\nCommand exited with code 1"),
	{ isPartial: false, isError: true },
);
assert.deepEqual(failure.metadata, ["failed", "2 lines"]);
assert.equal(failure.errorLine, "Command exited with code 1");

const noMatches = summarizeToolOutput(
	"grep",
	{ pattern: "missing", path: "src" },
	textResult("No matches found"),
	{ isPartial: false, isError: false },
);
assert.deepEqual(noMatches.metadata, ["0 matches"]);

const noFiles = summarizeToolOutput(
	"find",
	{ pattern: "*.ts", path: "src" },
	textResult("No files found matching pattern"),
	{ isPartial: false, isError: false },
);
assert.deepEqual(noFiles.metadata, ["0 results"]);

const emptyDirectory = summarizeToolOutput(
	"ls",
	{ path: "empty" },
	textResult("(empty directory)"),
	{ isPartial: false, isError: false },
);
assert.deepEqual(emptyDirectory.metadata, ["0 entries"]);

const readNotice = summarizeToolOutput(
	"read",
	{ path: "large.txt" },
	textResult("one\ntwo\n\n[3 more lines in file...]"),
	{ isPartial: false, isError: false },
);
assert.deepEqual(readNotice.metadata, ["2 lines"]);

const bashNotice = summarizeToolOutput(
	"bash",
	{ command: "sed -n '1,2p' file.txt" },
	textResult("one\ntwo\n\n[Showing lines 1-2 of 10 total lines]"),
	{ isPartial: false, isError: false },
);
assert.deepEqual(bashNotice.metadata, ["completed", "2 lines"]);

const limitedMatches = summarizeToolOutput(
	"grep",
	{ pattern: "token", path: "src" },
	textResult("a.ts:1: token\nb.ts:2: token\n\n[2 matches limit reached]", { matchLimitReached: 2 }),
	{ isPartial: false, isError: false },
);
assert.deepEqual(limitedMatches.metadata, ["2 matches"]);

const edit = summarizeToolOutput(
	"edit",
	{ path: "src/app.ts" },
	textResult("Done", { diff: "--- a/src/app.ts\n+++ b/src/app.ts\n-old\n+new\n+next" }),
	{ isPartial: false, isError: false },
);
assert.deepEqual(edit.metadata, ["+2 -1"]);

const truncated = summarizeToolOutput(
	"read",
	{ path: "large.txt" },
	textResult("one\ntwo", { truncation: { truncated: true, outputLines: 2, totalLines: 100 } }),
	{ isPartial: false, isError: false },
);
assert.deepEqual(truncated.metadata, ["2 lines", "truncated"]);

console.log("tool output summaries: semantic targets, bounded summaries, and diagnostics pass");
