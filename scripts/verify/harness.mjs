/**
 * Verification harness — the evidence layer for TUI changes.
 *
 * Everything here loads the REAL renderer used in production. The only
 * substitutions are the theme (fixed ANSI so snapshots are stable) and the
 * frame index (injected instead of read from the wall clock). That is
 * deliberate: a harness that reimplements the renderer proves nothing.
 */

import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "../../node_modules/@earendil-works/pi-coding-agent/node_modules/jiti/lib/jiti.mjs";

export const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(HERE, "../..");
const jiti = createJiti(import.meta.url);

/** Fixed SGR codes so colour output is byte-stable across machines. */
const CODES = { accent: "36", success: "32", error: "31", toolOutput: "90" };

/** Deterministic stand-in for Pi's Theme. Only fg() is used by the row. */
export const harnessTheme = {
	fg: (color, text) => `\u001b[${CODES[color] ?? "0"}m${text}\u001b[0m`,
};

/**
 * Load the production renderer (and the glyph catalog it uses) from a
 * directory of extension sources. Point it at a mutated copy to test that
 * the checks actually bite.
 */
export async function loadRenderer(extensionDir = join(ROOT, "extensions/acidbath")) {
	const renderers = await jiti.import(join(extensionDir, "ui-tool-renderers.ts"));
	const kaomoji = await jiti.import(join(extensionDir, "rendering/kaomoji.ts"));
	if (typeof renderers.renderToolRowLines !== "function") {
		throw new Error(`renderToolRowLines is not exported from ${extensionDir}`);
	}
	return { render: renderers.renderToolRowLines, kaomoji, extensionDir };
}

/** WIDTHS spans narrow terminals to very wide ones, including awkward edges. */
export const WIDTHS = [20, 24, 40, 60, 72, 80, 100, 120, 160];

/** A long, hostile target used to force truncation at every width. */
const LONG = "extensions/acidbath/rendering/ui-tool-renderers.ts";

/** The corpus: a render spec plus the clock indices a pending row visits. */
export const CASES = [
	{
		id: "bash/pending",
		spec: {
			settled: false, status: "pending", toolName: "bash",
			target: "npm test", metadata: ["2.1s"], hasDetails: true, truncated: false,
			expanded: false, noColor: false, theme: harnessTheme,
		},
		frames: [0, 1, 2, 3],
	},
	{
		id: "read/success",
		spec: {
			settled: true, status: "success", toolName: "read",
			target: "src/index.ts", metadata: ["210 lines"], hasDetails: true, truncated: false,
			expanded: false, noColor: false, theme: harnessTheme,
		},
		frames: [0],
	},
	{
		id: "grep/error",
		spec: {
			settled: true, status: "error", toolName: "grep",
			target: "renderToolRowLines", metadata: ["3 matches"], hasDetails: false, truncated: false,
			errorLine: "exit status 1", expanded: false, noColor: false, theme: harnessTheme,
		},
		frames: [0],
	},
	{
		id: "edit/truncated",
		spec: {
			settled: false, status: "pending", toolName: "edit",
			target: LONG, metadata: ["+12 −3"], hasDetails: true, truncated: true,
			expanded: false, noColor: false, theme: harnessTheme,
		},
		frames: [0, 1, 2],
	},
	{
		id: "write/plain",
		spec: {
			settled: true, status: "success", toolName: "write",
			target: "CHANGELOG.md", metadata: [], hasDetails: false, truncated: false,
			expanded: false, noColor: false, theme: harnessTheme,
		},
		frames: [0],
	},
	{
		id: "ls/pending-nocolor",
		spec: {
			settled: false, status: "pending", toolName: "ls",
			target: "scripts/verify", metadata: [], hasDetails: false, truncated: false,
			expanded: false, noColor: true, theme: harnessTheme,
		},
		frames: [0, 1],
	},
];

export const caseById = (id) => {
	const found = CASES.find((c) => c.id === id);
	if (!found) throw new Error(`unknown case: ${id}`);
	return found;
};

/** Render one case at one width on one frame. Returns the lines verbatim. */
export function renderCase(render, testCase, width, frame) {
	return render({ ...testCase.spec, frame }, width);
}

/** Render every case at every width across all of its frames. */
export function renderCorpus(render, widths = WIDTHS) {
	const frames = [];
	for (const testCase of CASES) {
		for (const width of widths) {
			for (const frame of testCase.frames) {
				frames.push({
					id: `${testCase.id}@w${width}/f${frame}`,
					case: testCase.id,
					width,
					frame,
					lines: renderCase(render, testCase, width, frame),
				});
			}
		}
	}
	return frames;
}