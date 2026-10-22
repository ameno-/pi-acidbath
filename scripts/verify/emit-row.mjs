/**
 * Emit one rendered tool row to stdout, for a real terminal to interpret.
 *
 * This is the fixture side of the live capture check. It prints exactly what
 * the production renderer produces — same function, same theme, injected frame
 * — so Rex's VT emulator can be asked what the resulting screen looks like and
 * compared against the model. Nothing else may write to stdout here: the
 * capture treats every glyph on the block's screen as part of the frame.
 *
 *   node --experimental-strip-types scripts/verify/emit-row.mjs <caseId> <width> <frame> [nocolor]
 */

import { loadRenderer, caseById, harnessTheme } from "./harness.mjs";

const [caseId, widthArg, frameArg, colorArg] = process.argv.slice(2);

if (!caseId || !widthArg || !frameArg) {
	process.stderr.write("usage: emit-row.mjs <caseId> <width> <frame> [nocolor]\n");
	process.exit(2);
}

const testCase = caseById(caseId);
const width = Number.parseInt(widthArg, 10);
const frame = Number.parseInt(frameArg, 10);

const { render } = await loadRenderer();
const lines = render(
	{
		...testCase.spec,
		noColor: colorArg === "nocolor",
		theme: harnessTheme,
		frame,
	},
	width,
);

process.stdout.write(`${lines.join("\n")}\n`);