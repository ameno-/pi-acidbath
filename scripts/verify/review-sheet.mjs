/**
 * Review sheet — a single screen showing what the renderer actually produces.
 *
 * This exists for human eyes, not for assertions: the harness proves the
 * invariants, this shows the design so it can be judged and annotated. Every
 * line below comes from renderToolRowLines, the same function production
 * uses, so the sheet cannot drift from the real output.
 *
 *   node --experimental-strip-types scripts/verify/review-sheet.mjs
 */

import { loadRenderer, harnessTheme, caseById } from "./harness.mjs";

// The glyph catalog arrives with the renderer, so the sheet can never disagree
// about a glyph with the thing it is reviewing.
const { render, kaomoji } = await loadRenderer();

const dim = (text) => `\u001b[90m${text}\u001b[0m`;
const head = (text) => `\u001b[1;36m${text}\u001b[0m`;
const rule = (width) => dim("─".repeat(width));

const out = [];
const WIDTH = 96;

function section(title) {
	out.push("");
	out.push(head(title));
	out.push(rule(WIDTH));
}

function rows(caseId, width, frames, { noColor = false } = {}) {
	const testCase = caseById(caseId);
	return frames.map((frame) => {
		const lines = render({ ...testCase.spec, noColor, theme: harnessTheme, frame }, width);
		return lines[0];
	});
}

out.push(head("ACIDBATH · COMPACT TOOL ROW · REVIEW SHEET"));
out.push(dim(`every line rendered by renderToolRowLines · width ${WIDTH}`));

section("SETTLED STATES");
for (const [id, w] of [["read/success", WIDTH], ["write/plain", WIDTH], ["grep/error", WIDTH]]) {
	out.push(...rows(id, w, [0]));
}

section("ANIMATION · bash/pending · frames 0-3 · does the target hold its column?");
const cols = rows("bash/pending", WIDTH, [0, 1, 2, 3]);
const targetCol = cols.map((line) => {
	const plain = line.replace(/\u001b\[[0-9;]*m/g, "");
	return plain.indexOf("npm test");
});
cols.forEach((line, i) => out.push(`${dim(`f${i}`)} ${line}`));
out.push(dim(`target column per frame: ${targetCol.join(", ")} ${new Set(targetCol).size === 1 ? "(stable ✓)" : "(DRIFTED ✗)"}`));

section("ANIMATION · edit/truncated · frames 0-2");
for (const line of rows("edit/truncated", WIDTH, [0, 1, 2])) out.push(line);

section("WIDTH LADDER · edit/truncated · 24 → 120 · elision must fill the budget");
for (const w of [24, 40, 60, 80, 120]) {
	const [line] = render({ ...caseById("edit/truncated").spec, frame: 0, theme: harnessTheme }, w);
	out.push(`${dim(String(w).padStart(3))} │${line}${dim("│")}`);
}

section("NO_COLOR · same rows, colour off · no escape bytes may appear");
for (const line of rows("bash/pending", WIDTH, [0], { noColor: true })) out.push(line);
for (const line of rows("ls/pending-nocolor", WIDTH, [0], { noColor: true })) out.push(line);

section("ERROR DIAGNOSTIC · collapsed · the diagnostic is its own line");
for (const line of render({ ...caseById("grep/error").spec, frame: 0, theme: harnessTheme }, WIDTH)) out.push(line);

out.push("");
out.push(dim(`status cell is padded to the widest status glyph · pending ${kaomoji.STATUS_LUMPY} vs settled ${kaomoji.statusGlyph("success", true)}`));
out.push("");

process.stdout.write(`${out.join("\n")}\n`);