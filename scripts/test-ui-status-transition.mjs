import { visibleWidth } from "@earendil-works/pi-tui";
import {
	cleanStatusText,
	glitchBridge,
	StatusTimingRecorder,
	StatusTransitionTimeline,
} from "../extensions/acidbath/ui-status-transition.ts";

let passed = 0;
let failed = 0;
function assert(name, condition, detail = "") {
	if (condition) passed += 1;
	else {
		failed += 1;
		console.error(`FAIL ${name}${detail ? ` (${detail})` : ""}`);
	}
}

const glitched = glitchBridge("◇ waiting", "◇ searching", 2, 5);
assert("glitch bridge never becomes blank", glitched.trim().length > 0);
assert("glitch bridge preserves bounded visible width", visibleWidth(glitched) <= Math.max("◇ waiting".length, "◇ searching".length));
assert("glitch bridge uses combining marks", /[\u0300-\u036f]/u.test(glitched));
assert("cleaning strips previous glitch marks", !/[\u0300-\u036f]/u.test(cleanStatusText(glitched)));
assert("cleaning strips terminal controls", cleanStatusText("ok\x1b[31m red\x1b[0m") === "ok red");

const timeline = new StatusTransitionTimeline("settled", 0, { frameMs: 10, frames: 3, minDwellMs: 20 });
timeline.setTarget("preparing", 5);
assert("minimum dwell keeps old word visible", timeline.advance(19).text === "settled");
assert("transition starts after dwell", timeline.advance(20).transitioning === true);
timeline.setTarget("reasoning", 25);
assert("burst retarget never blanks", timeline.advance(30).text.trim().length > 0);
assert("obsolete state is coalesced", timeline.advance(54).transitioning === true);
assert("retargeted transition settles to newest state", timeline.advance(55).stableText === "reasoning");

const reduced = new StatusTransitionTimeline("settled", 0, { reducedMotion: true });
assert("reduced motion snaps immediately", reduced.setTarget("working", 1).text === "working");
assert("reduced motion owns no active transition", reduced.isActive() === false);

const recorder = new StatusTimingRecorder("settled", 0);
recorder.transition("preparing", 100);
recorder.transition("reasoning", 150);
recorder.transition("settled", 550);
const summaries = recorder.summaries(650);
const reasoning = summaries.find((item) => item.state === "reasoning");
assert("timing recorder captures dwell", reasoning?.totalMs === 400);
assert("timing recorder computes percentiles", reasoning?.p50Ms === 400 && reasoning.p95Ms === 400);

console.log(`status transition: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
