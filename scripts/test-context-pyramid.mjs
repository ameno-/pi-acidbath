/** Pure tests for the isolated context pyramid prototype. */
import {
	buildContextPyramid,
	formatContextPercent,
	pressureForContext,
	renderContextPyramid,
} from "../extensions/acidbath/ui-context-pyramid.ts";

let passed = 0;
let failed = 0;

function assert(name, condition, detail = "") {
	if (condition) {
		passed += 1;
		return;
	}
	failed += 1;
	console.log(`FAIL ${name}${detail ? ` (${detail})` : ""}`);
}

const empty = buildContextPyramid(0);
assert("0% has no filled cells", empty.filledCells === 0);
assert("0% has nine cells", empty.totalCells === 9);
assert("0% is healthy", empty.pressure === "healthy");
assert("0% fills no rows", empty.rows.every((row) => row.cells.every((cell) => !cell)));

const half = buildContextPyramid(0.42);
assert("42% rounds to four cells", half.filledCells === 4);
assert("42% fills the base first", half.rows[2].cells.slice(0, 4).every(Boolean));
assert("42% leaves the base tail empty", half.rows[2].cells[4] === false);

const full = buildContextPyramid(1);
assert("100% fills every cell", full.filledCells === full.totalCells);
assert("100% fills every row", full.rows.every((row) => row.cells.every(Boolean)));

assert("negative percent clamps", buildContextPyramid(-1).percent === 0);
assert("overfull percent clamps", buildContextPyramid(2).percent === 1);
assert("NaN clamps", buildContextPyramid(Number.NaN).percent === 0);
assert("60% is warning", pressureForContext(0.6) === "warning");
assert("80% is high", pressureForContext(0.8) === "high");
assert("95% is critical", pressureForContext(0.95) === "critical");
assert("percent formatter", formatContextPercent(0.864) === "86%");

const rendered = renderContextPyramid(half);
assert("render has three rows", rendered.length === 3);
assert("render uses filled orb", rendered[2].includes("●"));
assert("render uses empty orb", rendered[2].includes("·"));
assert("render includes percent when requested by default", rendered[2].endsWith("42%"));
const compactRendered = renderContextPyramid(half, { showLabel: false });
assert("compact render omits percent", !compactRendered[2].includes("%"));

const roles = [];
renderContextPyramid(buildContextPyramid(0.95), {
	colorize: (text, token, pressure, rowIndex, cellIndex, fillIndex) => {
		roles.push(`${token}:${pressure}:${rowIndex}:${cellIndex}:${fillIndex}`);
		return text;
	},
});
assert("colorizer sees filled cells", roles.some((role) => role.startsWith("filled:critical:")));
assert("colorizer sees label", roles.includes("label:critical:2:-1:-1"));
assert("colorizer exposes fill order", roles.includes("filled:critical:2:0:0"));

console.log(`context-pyramid.ts: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
