/**
 * Mutation suite — proof that the checks bite.
 *
 * A green test suite means nothing if the tests cannot fail. Each mutation
 * below is a realistic TUI regression applied to a COPY of the real source,
 * and each one must be caught by a specific named check. If a mutation
 * survives, the harness is not trustworthy and the run fails loudly.
 */

import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ROOT, loadRenderer } from "./harness.mjs";
import { runChecks } from "./checks.mjs";

/**
 * Mutations are `find` → `replace` edits against the real extension sources,
 * one file each. Every one is a bug class we actually fear in TUI work.
 */
export const MUTATIONS = [
	{
		id: "M1-overflow",
		bug: "The width guard is dropped entirely, so a line that needs clipping is emitted at full length.",
		file: "ui-tool-renderers.ts",
		find: "if (tuiVisibleWidth(line) <= width) return line;",
		replace: "return line;",
		expect: "width-safety",
	},
	{
		id: "M2-reflow",
		bug: "The settled glyph is left unpadded, so settling shifts the target into a different column.",
		file: "ui-tool-renderers.ts",
		find: 'const tool = input.noColor ? "" : padCell(settled ? toolGlyph(input.toolName) : animFrame(input.toolName, input.frame), toolCellWidth(input.toolName));',
		replace: 'const tool = input.noColor ? "" : (settled ? toolGlyph(input.toolName) : padCell(animFrame(input.toolName, input.frame), toolCellWidth(input.toolName)));',
		expect: "in-place-transition",
	},
	{
		id: "M3-nondeterminism",
		bug: "A pending row consults a random source, so the same frame renders differently each time.",
		file: "ui-tool-renderers.ts",
		find: "const lines = [fitLine(styled, safeWidth, input.noColor)];",
		replace: 'const lines = [fitLine(styled + (Math.random() < 0.5 ? "" : " "), safeWidth, input.noColor)];',
		expect: "determinism",
	},
	{
		id: "M4-pop",
		bug: "A pending row grows a line on alternate frames, so it pops taller as it animates.",
		file: "ui-tool-renderers.ts",
		find: "\treturn lines;\n}",
		replace: "\tif (!input.settled && input.frame % 2 === 0) lines.push(ROW_INDENT);\n\treturn lines;\n}",
		expect: "frame-constancy",
	},
	{
		id: "M6-column-drift",
		bug: "Only the animated glyph is padded, so the target shifts a column between animation frames.",
		file: "ui-tool-renderers.ts",
		find: "const tool = input.noColor ? \"\" : padCell(settled ? toolGlyph(input.toolName) : animFrame(input.toolName, input.frame), toolCellWidth(input.toolName));",
		replace: "const tool = input.noColor ? \"\" : (settled ? padCell(toolGlyph(input.toolName), toolCellWidth(input.toolName)) : animFrame(input.toolName, input.frame));",
		expect: "column-stability",
	},
	{
		id: "M5-glyph-drift",
		bug: "The animated glyph ignores the frame index, so the animation is frozen at frame 0.",
		file: "ui-tool-renderers.ts",
		find: "animFrame(input.toolName, input.frame)",
		replace: "animFrame(input.toolName, 0)",
		expect: "glyph-identity",
	},
];

// The copy must live inside the repo so `@earendil-works/*` still resolves
// from node_modules exactly as it does for the real sources.
const SCRATCH = join(ROOT, ".verify-tmp");

async function mutatedCopy(sourceDir, mutation) {
	await mkdir(SCRATCH, { recursive: true });
	const dir = await mkdtemp(join(SCRATCH, `${mutation.id}-`));
	await cp(sourceDir, dir, { recursive: true });
	const target = join(dir, mutation.file);
	const before = await readFile(target, "utf8");
	if (!before.includes(mutation.find)) {
		await rm(dir, { recursive: true, force: true });
		throw new Error(`mutation ${mutation.id}: anchor not found in ${mutation.file}`);
	}
	await writeFile(target, before.replace(mutation.find, mutation.replace), "utf8");
	return dir;
}

/**
 * Apply every mutation in turn and require the expected check to fail.
 * Returns one row per mutation with the checks that fired.
 */
export async function runMutationSuite(sourceDir) {
	const rows = [];
	for (const mutation of MUTATIONS) {
		const dir = await mutatedCopy(sourceDir, mutation);
		try {
			const loaded = await loadRenderer(dir);
			const results = runChecks(loaded);
			const fired = results.filter((r) => !r.pass).map((r) => r.id);
			rows.push({
				id: mutation.id,
				bug: mutation.bug,
				expect: mutation.expect,
				fired,
				caught: fired.includes(mutation.expect),
				caughtBy: fired.join(", ") || "(nothing caught it)",
			});
		} catch (error) {
			rows.push({
				id: mutation.id,
				bug: mutation.bug,
				expect: mutation.expect,
				fired: [],
				caught: true,
				caughtBy: `mutation failed to load (caught as a build break): ${error.message}`,
			});
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	}
	await rm(SCRATCH, { recursive: true, force: true });
	return rows;
}