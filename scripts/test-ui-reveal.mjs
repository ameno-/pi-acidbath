/**
 * Text reveal invariants.
 *
 * The reveal is a promise about time: nothing appears during the hold, what
 * appears only ever grows, and the full text is always eventually visible.
 * A broken reveal is worse than no reveal, so these are asserted directly.
 */

import {
	DEFAULT_REVEAL,
	TextReveal,
	revealOptions,
	revealedChars,
	revealedText,
} from "../extensions/acidbath/reveal.ts";

let passed = 0;
let failed = 0;

function assert(name, condition, detail = "") {
	if (condition) {
		passed++;
	} else {
		failed++;
		console.error(`FAIL ${name}${detail ? `: ${detail}` : ""}`);
	}
}

const TEXT = Array.from({ length: 12 }, (_, i) => `Line ${i + 1} of a response, with a few words in it.`).join("\n");
const POINTS = Array.from(TEXT).length;

// The hold window shows nothing at all.
assert("nothing before the hold", revealedText(TEXT, 0) === "");
assert("nothing during the hold", revealedText(TEXT, DEFAULT_REVEAL.holdMs - 1) === "");
assert("something after the hold", revealedText(TEXT, DEFAULT_REVEAL.holdMs + 40).length > 0);

// It only ever grows, and never past the end.
let previous = -1;
let monotonic = true;
let inRange = true;
for (let t = 0; t <= 4000; t += 7) {
	const n = revealedChars(TEXT, t);
	if (n < previous) monotonic = false;
	if (n < 0 || n > POINTS) inRange = false;
	previous = n;
}
assert("reveal never shrinks", monotonic);
assert("reveal stays within the text", inRange);

// It finishes, and finishes exactly.
assert("reveal completes", revealedText(TEXT, 5000) === TEXT);

// Pure: the same text and time always give the same slice.
assert("reveal is deterministic", revealedText(TEXT, 913) === revealedText(TEXT, 913));

// It grows by code points, never splitting a surrogate pair.
// An astral character is a surrogate pair in UTF-16, so slicing by
// code units instead of code points would leave a lone surrogate behind.
const astral = "\u{1F642}".repeat(80);
const wide = `${astral}　x`.repeat(30);
let split = false;
for (const probe of [astral, wide]) {
	for (let t = 0; t <= 3000; t += 11) {
		const slice = revealedText(probe, t);
		// A lone surrogate is a high one with no low after it, or a low one
		// with no high before it. Both halves of a valid pair are fine.
		for (let i = 0; i < slice.length; i++) {
			const code = slice.charCodeAt(i);
			const isHigh = code >= 0xd800 && code <= 0xdbff;
			const isLow = code >= 0xdc00 && code <= 0xdfff;
			if (isHigh) {
				const next = slice.charCodeAt(i + 1);
				if (!(next >= 0xdc00 && next <= 0xdfff)) split = true;
			} else if (isLow) {
				const prev = slice.charCodeAt(i - 1);
				if (!(prev >= 0xd800 && prev <= 0xdbff)) split = true;
			}
		}
	}
}
assert("reveal never splits a surrogate pair", !split);

// Empty and single-line input are handled.
assert("empty text reveals empty", revealedText("", 5000) === "");
assert("single line completes", revealedText("just one line", 3000) === "just one line");

// The scheduler: off while idle, running while revealing, cleared on completion.
let renders = 0;
const reveal = new TextReveal(() => { renders++; }, { holdMs: 10, msPerLine: 5 });
assert("idle reveal is inactive", !reveal.active);
assert("non-streaming passes text straight through", reveal.update(TEXT, 0, false) === TEXT);
assert("non-streaming leaves the reveal inactive", !reveal.active);

reveal.update(TEXT, 0, true);
assert("streaming starts a reveal", reveal.active);
const partial = reveal.update(TEXT, 5, true);
assert("reveal withholds early text", partial === "");
reveal.update(TEXT, 4000, true);
const complete = reveal.update(TEXT, 4000, true);
assert("reveal eventually shows everything", complete === TEXT);
reveal.update(TEXT, 4000, false);
assert("reveal stops when streaming ends", !reveal.active);
reveal.dispose();
assert("reveal survives dispose", !reveal.active);

// Turning it off is a supported configuration.
const previousEnv = process.env.PI_ACIDBATH_REVEAL;
process.env.PI_ACIDBATH_REVEAL = "off";
assert("reveal can be disabled", revealOptions() === null);
process.env.PI_ACIDBATH_REVEAL = previousEnv;
assert("reveal is on by default", revealOptions() !== null);

console.log(`reveal: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);