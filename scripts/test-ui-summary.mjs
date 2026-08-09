import {
	countSummaryWords,
	DEFAULT_SESSION_SUMMARY,
	formatSessionHeader,
	MAX_SUMMARY_WORDS,
	summarizeTask,
} from "../extensions/acidbath/ui-summary.ts";

let passed = 0;
let failed = 0;

function assert(name, condition, detail = "") {
	if (condition) passed += 1;
	else {
		failed += 1;
		console.log(`FAIL ${name}${detail ? ` (${detail})` : ""}`);
	}
}

const summary = summarizeTask(
	"Can you pin a meaningful session summary to the top of the active Pi pane?",
);
assert("summary is non-empty", summary.length > 0);
assert("summary is capped", countSummaryWords(summary) <= MAX_SUMMARY_WORDS, summary);
assert("summary keeps the task target", summary === "Pin a meaningful session summary atop the active Pi pane", summary);
assert("summary strips request lead-in", !summary.toLowerCase().startsWith("can you"), summary);
assert("low-signal follow-up preserves task", summarizeTask("agreed, build it buddy", summary) === summary);
assert("meta follow-up preserves task", summarizeTask("Hmm, how would you summarize our current task?", summary) === summary);
assert("default is available", summarizeTask("ok", DEFAULT_SESSION_SUMMARY) === DEFAULT_SESSION_SUMMARY);
assert("URLs become readable project names", summarizeTask("Research https://github.com/hazat/glimpse implementations") .includes("glimpse"));
assert("header includes task summary", formatSessionHeader(summary) === `acidbath · ${summary}`);
assert("header includes context percentage", formatSessionHeader(summary, 0.42).endsWith(" · ctx 42%"));
assert("header clamps context percentage", formatSessionHeader(summary, 1.5).endsWith(" · ctx 100%"));

console.log(`ui-summary.ts: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
