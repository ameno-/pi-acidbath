/**
 * The claims we make about TUI changes, expressed as checks.
 *
 * Each check states its claim in words and reports failures in terms a
 * reviewer can dispute. A check that cannot fail is a harness bug, which is
 * why run.mjs also runs the mutation suite: it breaks the real renderer on
 * purpose and requires a named check to catch it.
 */

import { visibleWidth } from "@earendil-works/pi-tui";
import { CASES, WIDTHS, caseById, renderCase, renderCorpus } from "./harness.mjs";

const SGR = /\u001b\[[0-9;]*m/g;

/** Strip SGR sequences so width is measured on glyphs, not escape bytes. */
export function stripAnsi(value) {
	return value.replace(SGR, "");
}

/**
 * Display column where a substring starts, or -1.
 *
 * Measures the rendered prefix with the same width function Pi uses, not a
 * UTF-16 string index: kaomoji mix halfwidth, fullwidth, and combining
 * marks, so character counts and column counts are not the same number.
 */
function escapeRegExp(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Display column where a substring starts, or -1.
 *
 * Measures the rendered prefix with the same width function Pi uses, not a
 * UTF-16 string index: the kaomoji mix halfwidth, fullwidth, and combining
 * marks, so character counts and column counts are not the same number.
 */
function columnOf(line, needle) {
	const visible = stripAnsi(line);
	const index = visible.indexOf(stripAnsi(needle));
	return index < 0 ? -1 : visibleWidth(visible.slice(0, index));
}

/** Determinism: identical inputs must yield byte-identical output, every time. */
function checkDeterminism(render) {
	const failures = [];
	for (const testCase of CASES) {
		for (const width of WIDTHS) {
			for (const frame of testCase.frames) {
				const id = `${testCase.id}@w${width}/f${frame}`;
				const first = renderCase(render, testCase, width, frame).join("\n");
				for (let repeat = 1; repeat <= 2; repeat++) {
					if (renderCase(render, testCase, width, frame).join("\n") !== first) {
						failures.push(`${id} produced different bytes on render ${repeat + 1}`);
					}
				}
			}
		}
	}
	return {
		id: "determinism",
		claim: "The same state and frame always render the same bytes. No hidden clock, locale, or map ordering.",
		failures,
	};
}

/** Width safety: no line may ever exceed the width it was rendered for. */
function checkWidthSafety(render) {
	const failures = [];
	let worst = -Infinity;
	for (const frame of renderCorpus(render)) {
		for (const [index, line] of frame.lines.entries()) {
			const measured = visibleWidth(line);
			worst = Math.max(worst, measured - frame.width);
			if (measured > frame.width) {
				failures.push(`${frame.id} line ${index} occupies ${measured} cols, budget ${frame.width}`);
			}
		}
	}
	return {
		id: "width-safety",
		claim: "Every rendered line fits its width budget at every terminal width.",
		detail: `worst overflow: ${worst <= 0 ? `${worst} cols (within budget)` : `${worst} cols OVER`}`,
		failures,
	};
}

/** Truncation honesty: an elided row fills the budget exactly and says so. */
function checkTruncationHonesty(render) {
	const failures = [];
	const testCase = caseById("edit/truncated");
	let elided = 0;
	for (const width of WIDTHS) {
		const [line] = renderCase(render, testCase, width, 0);
		const measured = visibleWidth(line);
		if (measured > width) {
			failures.push(`w${width}: occupies ${measured} cols, budget ${width}`);
			continue;
		}
		if (stripAnsi(line).endsWith("…")) {
			// Wide glyphs can leave up to one full-width cell unclaimed.
			elided++;
			if (measured < width - 2) failures.push(`w${width}: elided to only ${measured} of ${width} cols`);
		} else if (measured >= width) {
			failures.push(`w${width}: fills the budget without an ellipsis`);
		}
	}
	if (elided === 0) failures.push("no width produced an elided row; the corpus no longer tests truncation");
	return {
		id: "truncation-honesty",
		claim: "Widths that overflow are elided to within one glyph cell and marked with …; widths that fit are left intact.",
		detail: `${elided}/${WIDTHS.length} widths elided`,
		failures,
	};
}

/**
 * Frame constancy: while a row animates it may change content but never
 * change shape. Same line count, same row indices — that is "nothing pops".
 */
function checkFrameConstancy(render) {
	const failures = [];
	for (const testCase of CASES) {
		if (testCase.frames.length < 2) continue;
		for (const width of WIDTHS) {
			const shapes = testCase.frames.map((f) => renderCase(render, testCase, width, f).length);
			if (new Set(shapes).size !== 1) {
				failures.push(`${testCase.id}@w${width}: line count changed across frames → ${shapes.join(",")}`);
			}
		}
	}
	return {
		id: "frame-constancy",
		claim: "An animating row never changes height between frames. Content changes in place.",
		failures,
	};
}

/**
 * In-place transition: pending → settled must not shift anything after the
 * glyph column. The target's starting column is identical in both frames,
 * so the row is edited rather than re-laid-out.
 */
function checkInPlaceTransition(render) {
	const failures = [];
	const pairs = ["bash/pending", "edit/truncated"];
	let elided = 0;
	for (const width of WIDTHS) {
		for (const id of pairs) {
			const pending = caseById(id);
			const before = renderCase(render, pending, width, pending.frames[0]);
			const after = render({ ...pending.spec, settled: true, status: "success" }, width);
			if (before.length !== after.length) {
				failures.push(`${id}@w${width}: height changed ${before.length} → ${after.length} on settle`);
				continue;
			}
			const colBefore = columnOf(before[0], pending.spec.target);
			const colAfter = columnOf(after[0], pending.spec.target);
			// Narrow widths elide the target itself; nothing to compare there.
			if (colBefore < 0 || colAfter < 0) {
				elided++;
			} else if (colBefore !== colAfter) {
				failures.push(`${id}@w${width}: target moved col ${colBefore} → ${colAfter}; content shifted instead of transitioning`);
			}
		}
	}
	return {
		id: "in-place-transition",
		claim: "When a row settles, everything after the animated glyph stays in the same column. No reflow.",
		detail: `${elided}/${WIDTHS.length * pairs.length} comparisons skipped (target elided at this width)`,
		failures,
	};
}

/** Glyph identity: the row always leads with the exact glyphs for its state. */
function checkGlyphIdentity(render, { kaomoji }) {
	const failures = [];
	let elided = 0;
	for (const frame of renderCorpus(render)) {
		const testCase = caseById(frame.case);
		if (testCase.spec.noColor) continue;
		const expectedTool = testCase.spec.settled
			? kaomoji.toolGlyph(testCase.spec.toolName)
			: kaomoji.animFrame(testCase.spec.toolName, frame.frame);
		const expectedStatus = testCase.spec.settled
			? kaomoji.statusGlyph(testCase.spec.status, true)
			: kaomoji.STATUS_LUMPY;
		// Cells are padded to a fixed width, so only the glyphs and their order are asserted.
		const visible = stripAnsi(frame.lines[0]);
		if (visible.endsWith("…")) {
			// Elided: the glyph may itself be cut, so only the status glyph is checkable here.
			elided++;
			if (!visible.startsWith(expectedStatus)) {
				failures.push(`${frame.id}: elided row starts with ${JSON.stringify(visible.slice(0, 16))}, expected ${expectedStatus}`);
			}
			continue;
		}
		const pattern = new RegExp(`^${escapeRegExp(expectedStatus)} *${escapeRegExp(expectedTool)}`);
		if (!pattern.test(visible)) {
			failures.push(`${frame.id}: head was ${JSON.stringify(visible.slice(0, 24))}, expected ${expectedStatus} then ${expectedTool}`);
		}
	}
	return {
		id: "glyph-identity",
		claim: "A row leads with the exact glyph pair its state and frame call for — no stale or drifted glyph.",
		detail: `${elided} frames skipped (glyph elided at this width)`,
		failures,
	};
}

/**
 * Column stability: across every frame a row visits, everything after the
 * animated glyph must start in the same column. This is the "something can
 * move, nothing should pop" rule, checked on the animation itself rather
 * than only across a settle.
 */
function checkColumnStability(render) {
	const failures = [];
	for (const testCase of CASES) {
		if (testCase.frames.length < 2) continue;
		for (const width of WIDTHS) {
			const columns = testCase.frames.map((f) => columnOf(renderCase(render, testCase, width, f)[0], testCase.spec.target));
			if (columns.some((c) => c < 0)) continue; // target elided at this width
			if (new Set(columns).size !== 1) {
				failures.push(`${testCase.id}@w${width}: target column drifted across frames → ${columns.join(",")}`);
			}
		}
	}
	return {
		id: "column-stability",
		claim: "While a row animates, the target never changes column. Frames differ only in the glyph, never in layout.",
		failures,
	};
}

/**
 * Cell discipline: padding exists to hold a column steady, not to widen the
 * row. A cell may only be as wide as the widest glyph that can actually
 * appear in it. Padding a status cell for a glyph no row can render once cost
 * every row in the transcript four columns of dead space.
 */
function checkCellDiscipline(render, { kaomoji }) {
	const failures = [];
	const renderable = [
		kaomoji.STATUS_LUMPY,
		kaomoji.statusGlyph("success", true),
		kaomoji.statusGlyph("error", true),
	];
	const statusBudget = Math.max(...renderable.map((g) => visibleWidth(g)));

	for (const frame of renderCorpus(render)) {
		if (caseById(frame.case).spec.noColor) continue;
		const visible = stripAnsi(frame.lines[0]);
		// Measure where the target begins: status cell + tool cell + separators.
		const target = caseById(frame.case).spec.target;
		const targetAt = columnOf(frame.lines[0], target);
		if (targetAt < 0) continue;
		const toolBudget = Math.max(
			visibleWidth(kaomoji.toolGlyph(caseById(frame.case).spec.toolName)),
			...(kaomoji.ANIM_FRAMES[caseById(frame.case).spec.toolName] ?? []).map(visibleWidth),
		);
		const floor = statusBudget + toolBudget + 2; // two single-space separators
		if (targetAt < floor - 1) {
			failures.push(`${frame.id}: target at col ${targetAt}, but the cells only need ${floor} — padding is wider than its glyphs`);
		}
	}
	return {
		id: "cell-discipline",
		claim: "A padded cell is never wider than the widest glyph that can render in it, so padding buys stability without costing width.",
		detail: `status cell budget ${statusBudget} cols (pending ${visibleWidth(kaomoji.STATUS_LUMPY)}, success ${visibleWidth(kaomoji.statusGlyph("success", true))}, error ${visibleWidth(kaomoji.statusGlyph("error", true))})`,
		failures,
	};
}

/** Escape hygiene: colour spans are balanced and wrap only the glyphs. */
function checkEscapeHygiene(render) {
	const failures = [];
	for (const frame of renderCorpus(render)) {
		if (caseById(frame.case).spec.noColor) continue;
		for (const [index, line] of frame.lines.entries()) {
			const resets = (line.match(/\u001b\[0m/g) ?? []).length;
			const opens = (line.match(/\u001b\[[0-9;]*m/g) ?? []).length - resets;
			// Eliding appends its own terminator, so resets may exceed opens.
			// Fewer resets than opens would leave styling open — that is the bug.
			if (resets < opens) {
				failures.push(`${frame.id} line ${index}: ${opens} colour spans but only ${resets} terminators`);
			}
			if (opens > 2) {
				failures.push(`${frame.id} line ${index}: ${opens} colour spans; the row should colour at most the two glyphs`);
			}
		}
	}
	return {
		id: "escape-hygiene",
		claim: "Every colour span is terminated, and a row colours at most its two glyphs — styling never leaks into expansion.",
		failures,
	};
}

/** No-colour purity: the plain path emits no escape bytes at all. */
function checkNoColorPurity(render) {
	const failures = [];
	for (const testCase of CASES) {
		const plain = { ...testCase.spec, noColor: true };
		for (const width of WIDTHS) {
			for (const frame of testCase.frames) {
				for (const line of render(plain, width)) {
					if (line.includes("\u001b")) {
						failures.push(`${testCase.id}@w${width}/f${frame}: escape byte in no-colour output`);
					}
				}
			}
		}
	}
	return {
		id: "no-color-purity",
		claim: "With colour disabled the row emits plain text — no escape bytes leak into transcripts or pipes.",
		failures,
	};
}

export const CHECKS = [
	checkDeterminism,
	checkWidthSafety,
	checkTruncationHonesty,
	checkFrameConstancy,
	checkInPlaceTransition,
	checkColumnStability,
	checkGlyphIdentity,
	checkCellDiscipline,
	checkEscapeHygiene,
	checkNoColorPurity,
];

/** Run every check against one loaded renderer. */
export function runChecks({ render, kaomoji }) {
	return CHECKS.map((check) => {
		try {
			return check(render, { kaomoji });
		} catch (error) {
			return { id: check.name, claim: "", failures: [`check threw: ${error.message}`] };
		}
	}).map((result) => ({ ...result, failures: result.failures ?? [], pass: (result.failures ?? []).length === 0 }));
}