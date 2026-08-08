/**
 * Pi UI Enhancements — context gauge pure helpers.
 *
 * The gauge turns Pi's editor bottom border into a live fill that
 * reflects how much of the model's context window is consumed.
 */

const FG_FILLED = "\x1b[38;2;120;170;220m";
export const FG_EMPTY = "\x1b[38;2;90;100;120m";
const FG_RESET = "\x1b[39m";

export function colorizeGaugeText(text: string, color: string, noColor: boolean): string {
	return noColor ? text : `${color}${text}${FG_RESET}`;
}

export const GAUGE_FILLED_GLYPH = "█";
export const GAUGE_EMPTY_GLYPH = "─";
export const GAUGE_LEFT_CORNER = "└";
export const GAUGE_RIGHT_CORNER = "┘";

export function clamp(value: number, min: number, max: number): number {
	if (Number.isNaN(value)) return min;
	if (value < min) return min;
	if (value > max) return max;
	return value;
}

export function clamp01(value: number): number {
	return clamp(value, 0, 1);
}

export function advanceToward(current: number, target: number, step: number, epsilon = 0.001): number {
	if (current < target) {
		const next = current + step;
		return next >= target - epsilon ? target : next;
	}
	if (current > target) {
		const next = current - step;
		return next <= target + epsilon ? target : next;
	}
	return target;
}

export function formatPercent(percent: number): string {
	const pct = Math.round(clamp01(percent) * 100);
	return `${pct}%`;
}

export function truncateLabel(text: string, maxWidth: number): string {
	if (maxWidth <= 0) return "";
	if (text.length === maxWidth) return text;
	if (text.length < maxWidth) {
		return ` ${text.padEnd(maxWidth - 1)}`;
	}
	const cut = Math.max(1, maxWidth - 1);
	return `${text.slice(0, cut)}…`;
}

export interface FillPlan {
	filled: number;
	unfilled: number;
	label: string;
	gapWidth: number;
}

export interface GaugeOptions {
	width: number;
	percent: number;
	noColor: boolean;
}

export const MIN_GAUGE_WIDTH = 12;
export const MAX_LABEL_WIDTH = 8;

export function computeFillPlan(opts: GaugeOptions): FillPlan | undefined {
	if (opts.width < MIN_GAUGE_WIDTH) return undefined;

	const labelText = formatPercent(opts.percent);
	const labelMax = Math.max(4, Math.min(MAX_LABEL_WIDTH, Math.floor(opts.width / 4)));
	const label = truncateLabel(labelText, labelMax);

	const gapWidth = opts.width - 2 - label.length;
	if (gapWidth < 4) return undefined;

	const filled = Math.round(gapWidth * clamp01(opts.percent));
	const unfilled = gapWidth - filled;

	return { filled, unfilled, label, gapWidth };
}

export interface GaugeLine {
	line: string;
	visibleWidth: number;
	rendered: boolean;
}

export function buildGaugeLine(opts: GaugeOptions): GaugeLine {
	const plan = computeFillPlan(opts);
	if (!plan) {
		const fallback = GAUGE_EMPTY_GLYPH.repeat(opts.width);
		return {
			line: colorizeGaugeText(fallback, FG_EMPTY, opts.noColor),
			visibleWidth: opts.width,
			rendered: false,
		};
	}

	const filled = colorizeGaugeText(GAUGE_FILLED_GLYPH.repeat(plan.filled), FG_FILLED, opts.noColor);
	const empty = colorizeGaugeText(GAUGE_EMPTY_GLYPH.repeat(plan.unfilled), FG_EMPTY, opts.noColor);
	const label = colorizeGaugeText(plan.label, FG_FILLED, opts.noColor);
	const leftCorner = colorizeGaugeText(GAUGE_LEFT_CORNER, FG_EMPTY, opts.noColor);
	const rightCorner = colorizeGaugeText(GAUGE_RIGHT_CORNER, FG_EMPTY, opts.noColor);

	const line = `${leftCorner}${label}${filled}${empty}${rightCorner}`;
	return { line, visibleWidth: opts.width, rendered: true };
}

export function visibleWidth(text: string): number {
	let width = 0;
	for (const token of tokenizeAnsi(text)) {
		if (token.startsWith("\x1b")) continue;
		for (const character of Array.from(token)) width += characterWidth(character);
	}
	return width;
}

export function stripAnsi(text: string): string {
	// eslint-disable-next-line no-control-regex
	return text.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "");
}

/**
 * Truncate a possibly styled terminal string by visible cells. ANSI escape
 * sequences are copied as whole tokens and never count toward the budget.
 */
export function truncateToWidth(text: string, maxWidth: number, ellipsis = "…"): string {
	const limit = Math.max(0, Math.trunc(maxWidth));
	if (limit === 0) return "";
	if (visibleWidth(text) <= limit) return text;
	const suffixWidth = Math.min(visibleWidth(ellipsis), limit);
	const contentLimit = Math.max(0, limit - suffixWidth);
	let output = "";
	let used = 0;
	let hasAnsi = false;
	for (const token of tokenizeAnsi(text)) {
		if (token.startsWith("\x1b")) {
			hasAnsi = true;
			output += token;
			continue;
		}
		for (const character of Array.from(token)) {
			const characterWidthValue = characterWidth(character);
			if (used + characterWidthValue > contentLimit) {
				const result = `${output}${ellipsis}`;
				return hasAnsi ? `${result}\x1b[0m` : result;
			}
			output += character;
			used += characterWidthValue;
		}
	}
	const result = `${output}${ellipsis}`;
	return hasAnsi ? `${result}\x1b[0m` : result;
}

function tokenizeAnsi(text: string): string[] {
	// eslint-disable-next-line no-control-regex
	return text.split(/(\x1b\[[0-9;?]*[ -/]*[@-~])/g).filter(Boolean);
}

function characterWidth(character: string): number {
	const codePoint = character.codePointAt(0) ?? 0;
	// Combining marks and variation selectors occupy no terminal cell.
	if (codePoint === 0 || (codePoint >= 0x300 && codePoint <= 0x36f) || (codePoint >= 0xfe00 && codePoint <= 0xfe0f)) return 0;
	// A compact wcwidth approximation for CJK/full-width and emoji glyphs.
	if (
		(codePoint >= 0x1100 && codePoint <= 0x115f) ||
		(codePoint >= 0x2329 && codePoint <= 0x232a) ||
		(codePoint >= 0x2e80 && codePoint <= 0xa4cf) ||
		(codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
		(codePoint >= 0xf900 && codePoint <= 0xfaff) ||
		(codePoint >= 0xfe10 && codePoint <= 0xfe6f) ||
		(codePoint >= 0xff00 && codePoint <= 0xff60) ||
		(codePoint >= 0x1f300 && codePoint <= 0x1faff)
	) return 2;
	return 1;
}

export function findEditorBottomBorderIndex(lines: string[], width: number): number {
	const plainBorder = GAUGE_EMPTY_GLYPH.repeat(width);
	for (let index = lines.length - 1; index > 0; index -= 1) {
		const line = stripAnsi(lines[index]!);
		if (line === plainBorder || /^─── ↓ \d+ more ─*$/.test(line)) return index;
	}
	return -1;
}
