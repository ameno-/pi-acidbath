/**
 * Unit tests for ui-surfaces.ts — the three-surface health report formatter.
 *
 * Run:
 *   node --experimental-strip-types --no-warnings scripts/test-ui-surfaces.mjs
 *
 * Asserts:
 *   1. Deterministic, color-free output for ok/warn/error mixes.
 *   2. Every line fits 40/60/80/120 columns.
 *   3. Long details truncate with an ellipsis instead of wrapping.
 *   4. Status aggregation helper maps counts to ok/warn/error.
 */

import { formatSurfaceReport, surfaceStatusFromCounts } from "../extensions/acidbath/ui-surfaces.ts";

let passed = 0;
let failed = 0;

function run(name, fn) {
	try {
		fn();
		passed++;
	} catch (error) {
		failed++;
		console.log(`FAIL  ${name}  (${error?.message ?? error})`);
	}
}

function assert(cond, detail) {
	if (!cond) throw new Error(detail ?? "assertion failed");
}

const SAMPLE = [
	{ name: "Linear", status: "ok", detail: "workspace acids" },
	{ name: "Notion", status: "warn", detail: "5 checks passed, 2 warnings" },
	{ name: "Sideshow", status: "error", detail: "localhost:8228 unreachable" },
];

run("deterministic across 1000 iterations", () => {
	const first = formatSurfaceReport(SAMPLE);
	for (let i = 0; i < 1000; i++) {
		if (formatSurfaceReport(SAMPLE) !== first) throw new Error("nondeterministic");
	}
});

run("renders marks and header without color codes", () => {
	const out = formatSurfaceReport(SAMPLE);
	assert(!/\x1b\[/.test(out), "output must not contain ANSI escapes");
	assert(out.includes("Sideshow live · Notion durable · Linear ledger"), "missing header");
	assert(out.includes("✓ Linear"), "missing ok mark");
	assert(out.includes("! Notion"), "missing warn mark");
	assert(out.includes("✗ Sideshow"), "missing error mark");
});

run("lines fit 40/60/80/120 columns", () => {
	for (const width of [40, 60, 80, 120]) {
		const out = formatSurfaceReport(SAMPLE, width);
		for (const line of out.split("\n")) {
			assert(line.length <= width, `line exceeds ${width}: ${JSON.stringify(line)}`);
		}
	}
});

run("long details truncate with ellipsis", () => {
	const out = formatSurfaceReport([{ name: "Linear", status: "ok", detail: "x".repeat(200) }], 40);
	const line = out.split("\n")[1];
	assert(line.length === 40, `expected width 40, got ${line.length}`);
	assert(line.endsWith("…"), "truncated line must end with ellipsis");
});

run("status aggregation maps counts", () => {
	if (surfaceStatusFromCounts(3, 0, 0) !== "ok") throw new Error("3/0/0 should be ok");
	if (surfaceStatusFromCounts(3, 1, 0) !== "warn") throw new Error("3/1/0 should be warn");
	if (surfaceStatusFromCounts(3, 0, 1) !== "error") throw new Error("3/0/1 should be error");
	if (surfaceStatusFromCounts(0, 0, 0) !== "warn") throw new Error("0/0/0 should be warn");
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
