import { performance } from "node:perf_hooks";
import {
	STATUS_MIN_DWELL_MS,
	STATUS_TRANSITION_DURATION_MS,
	StatusTimingRecorder,
	StatusTransitionTimeline,
} from "../extensions/acidbath/ui-status-transition.ts";

const LYRICS = [
	"You a chair, I'm a spaceship",
	"Judge a cook by how it bubble",
	"Your favorite rapper send fan mail",
	"We made it to the top floor",
	"The bricks came whiter than Jon B",
];

const PROFILES = {
	"rapid-hooks": [
		["settled", 500], ["preparing", 45], ["agent-start", 20], ["turn-boundary", 35],
		["provider-wait", 90], ["tool-preparing", 20], ["tool-result", 35], ["turn-end", 25],
		["done", 20], ["settled", 600],
	],
	"long-tools": [
		["settled", 500], ["preparing", 40], ["tool-preparing", 25], ["tool-write", 900],
		["tool-complete", 35], ["provider-wait", 300], ["tool-preparing", 20], ["tool-grep", 650],
		["tool-complete", 35], ["tool-bash", 1_200], ["done", 20], ["settled", 600],
	],
	"mixed-agent-loop": [
		["settled", 800], ["preparing", 45], ["agent-start", 20], ["turn-boundary", 35],
		["provider-wait", 500], ["reasoning", 2_200], ["tool-preparing", 20], ["tool-running", 700],
		["tool-result", 35], ["provider-wait", 350], ["reasoning", 900], ["composing", 1_100],
		["turn-end", 25], ["done", 20], ["settled", 800],
	],
};

function runProfile(name, trace) {
	const timeline = new StatusTransitionTimeline(`♪ ${LYRICS[0]}`, 0);
	const recorder = new StatusTimingRecorder(trace[0][0], 0);
	const observations = [];
	let now = 0;
	let lyricIndex = 0;
	let totalSamples = 0;
	let glitchSamples = 0;

	for (let index = 0; index < trace.length; index += 1) {
		const [state, requestedMs] = trace[index];
		if (index > 0) {
			recorder.transition(state, now);
			lyricIndex = (lyricIndex + 1) % LYRICS.length;
			timeline.setTarget(`♪ ${LYRICS[lyricIndex]}`, now);
		}
		const target = timeline.currentTarget();
		let firstStableMs;
		let glitchFrames = 0;
		const end = now + requestedMs;
		for (let sample = now; sample < end; sample += 16) {
			const snapshot = timeline.advance(sample);
			totalSamples += 1;
			if (snapshot.transitioning) {
				glitchFrames += 1;
				glitchSamples += 1;
			}
			if (firstStableMs === undefined && snapshot.stableText === target && !snapshot.transitioning) firstStableMs = sample - now;
		}
		observations.push({ state, requestedMs, firstStableMs, glitchFrames });
		now = end;
	}
	const finalTarget = timeline.currentTarget();
	const final = timeline.advance(now + STATUS_MIN_DWELL_MS + STATUS_TRANSITION_DURATION_MS);
	return {
		name,
		observations,
		summaries: recorder.summaries(now),
		animationRatio: totalSamples > 0 ? glitchSamples / totalSamples : 0,
		displayed: observations.filter((row) => row.firstStableMs !== undefined).length,
		coalesced: observations.filter((row) => row.firstStableMs === undefined).length,
		finalSettled: final.stableText === finalTarget,
	};
}

function microbenchmark(iterations = 100_000) {
	const timeline = new StatusTransitionTimeline(`♪ ${LYRICS[0]}`, 0, { minDwellMs: 0 });
	let now = 0;
	const started = performance.now();
	for (let index = 0; index < iterations; index += 1) {
		now += 17;
		if (index % 9 === 0) timeline.setTarget(`♪ ${LYRICS[(index / 9) % LYRICS.length | 0]}`, now);
		timeline.advance(now);
	}
	const elapsedMs = performance.now() - started;
	return { iterations, elapsedMs, meanUs: elapsedMs * 1000 / iterations };
}

const results = Object.entries(PROFILES).map(([name, trace]) => runProfile(name, trace));
const perf = microbenchmark();

console.log("Acidbath lyric/status transition profiles");
console.log(`policy: fixed status slot=10 cells fixed lyric slot=44 cells min-dwell=${STATUS_MIN_DWELL_MS}ms glitch-duration=${STATUS_TRANSITION_DURATION_MS}ms sample=16ms`);
for (const result of results) {
	console.log(`\n[${result.name}] displayed=${result.displayed} coalesced=${result.coalesced} animation=${(result.animationRatio * 100).toFixed(1)}%`);
	console.log("state               dwell    lyric-stable  glitch-frames");
	for (const row of result.observations) {
		console.log(`${row.state.padEnd(19)} ${`${row.requestedMs}ms`.padStart(7)} ${row.firstStableMs === undefined ? "coalesced".padStart(13) : `${row.firstStableMs}ms`.padStart(13)} ${String(row.glitchFrames).padStart(14)}`);
	}
}
console.log(`\ntransition engine: ${perf.iterations.toLocaleString()} advances in ${perf.elapsedMs.toFixed(2)}ms (${perf.meanUs.toFixed(3)}µs/advance)`);

if (results.some((result) => !result.finalSettled)) {
	console.error("FAIL one or more profiles did not settle on the final lyric");
	process.exitCode = 1;
}
const longTools = results.find((result) => result.name === "long-tools");
for (const state of ["tool-write", "tool-grep", "tool-bash"]) {
	if (!longTools?.observations.some((row) => row.state === state && row.firstStableMs !== undefined)) {
		console.error(`FAIL ${state} did not display a stable lyric`);
		process.exitCode = 1;
	}
}
if (perf.meanUs > 50) {
	console.error(`FAIL transition engine exceeded 50µs/advance budget: ${perf.meanUs.toFixed(3)}µs`);
	process.exitCode = 1;
}
