import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { truncateToWidth, visibleWidth } from "./ui-gauge.ts";
import { DEFAULT_SESSION_SUMMARY } from "./ui-summary.ts";

const WORDMARK_FONT: Record<string, readonly string[]> = {
	A: [" ███ ", "█   █", "█████", "█   █", "█   █"],
	B: ["████ ", "█   █", "████ ", "█   █", "████ "],
	C: [" ████", "█    ", "█    ", "█    ", " ████"],
	D: ["████ ", "█   █", "█   █", "█   █", "████ "],
	H: ["█   █", "█   █", "█████", "█   █", "█   █"],
	I: ["█████", "  █  ", "  █  ", "  █  ", "█████"],
	T: ["█████", "  █  ", "  █  ", "  █  ", "  █  "],
};

export const WORDMARK_TEXT = "ACIDBATH";
export const WORDMARK_LINES = buildWordmarkLines();
export const WORDMARK_BLOCK_WIDTH = Math.max(...WORDMARK_LINES.map((line) => visibleWidth(line)));
export const HEADER_TAGLINE = "honest tools · useful work";

const PALETTE_STEPS = 24;
const ROW_PHASE_STEP = 0.12;
const FALLBACK_BASE_RGB: Rgb = { r: 80, g: 160, b: 255 };

export interface Rgb {
	r: number;
	g: number;
	b: number;
}

export interface AcidbathHeaderState {
	summary: string;
}

/** Extract a usable RGB value from the ANSI color emitted by a Pi theme. */
export function parseForegroundRgbFromAnsi(ansi: string): Rgb | undefined {
	const truecolor = ansi.match(/\x1b\[38;2;(\d+);(\d+);(\d+)m/);
	if (truecolor) {
		return {
			r: clampByte(Number(truecolor[1])),
			g: clampByte(Number(truecolor[2])),
			b: clampByte(Number(truecolor[3])),
		};
	}

	const ansi256 = ansi.match(/\x1b\[38;5;(\d+)m/);
	if (ansi256) return ansi256ToRgb(Number(ansi256[1]));

	const basic = ansi.match(/\x1b\[(3[0-7]|9[0-7])m/);
	if (basic) return BASIC_ANSI_RGB[Number(basic[1])];
	return undefined;
}

/** Build a gently cycling palette around a theme's accent color. */
export function buildGradientPalette(base: Rgb = FALLBACK_BASE_RGB, steps = PALETTE_STEPS): Rgb[] {
	const count = Math.max(1, Math.trunc(steps));
	return Array.from({ length: count }, (_, index) => {
		const wave = -Math.cos((index / count) * Math.PI * 2);
		if (wave < 0) {
			const amount = -wave * 0.18;
			return {
				r: Math.round(base.r * (1 - amount)),
				g: Math.round(base.g * (1 - amount)),
				b: Math.round(base.b * (1 - amount)),
			};
		}
		const amount = wave * 0.18;
		return {
			r: Math.round(base.r + (255 - base.r) * amount),
			g: Math.round(base.g + (255 - base.g) * amount),
			b: Math.round(base.b + (255 - base.b) * amount),
		};
	});
}

/** Return the normalized horizontal position used by a wordmark row. */
export function getWordmarkGradientPosition(index: number, phase: number): number {
	return index / Math.max(WORDMARK_BLOCK_WIDTH - 1, 1) + phase;
}

export function renderHeaderLines(
	width: number,
	theme: Theme,
	noColor = false,
	summary = DEFAULT_SESSION_SUMMARY,
): string[] {
	const lineWidth = Math.max(1, Math.trunc(width));
	const base = parseForegroundRgbFromAnsi(theme.getFgAnsi("accent")) ?? FALLBACK_BASE_RGB;
	const palette = buildGradientPalette(base);
	const wordmark = WORDMARK_LINES.map((line, row) => {
		const painted = noColor ? line : paintWordmarkLine(line, row, palette);
		return fitLineToWidth(painted, lineWidth);
	});
	const tagline = noColor ? HEADER_TAGLINE : theme.fg("muted", HEADER_TAGLINE);
	const status = noColor ? summary : theme.fg("text", summary);
	return ["", ...wordmark, "", fitLineToWidth(tagline, lineWidth), fitLineToWidth(status, lineWidth), ""];
}

/** Fit a styled line without allowing ANSI sequences to affect alignment. */
export function fitLineToWidth(line: string, width: number): string {
	const limit = Math.max(1, Math.trunc(width));
	const currentWidth = visibleWidth(line);
	if (currentWidth > limit) return truncateToWidth(line, limit, "");
	const left = Math.floor((limit - currentWidth) / 2);
	return `${" ".repeat(left)}${line}`;
}

function buildWordmarkLines(): string[] {
	return Array.from({ length: 5 }, (_, row) => WORDMARK_TEXT
		.split("")
		.map((letter) => WORDMARK_FONT[letter]![row])
		.join(" "));
}

function paintWordmarkLine(line: string, row: number, palette: Rgb[]): string {
	return Array.from(line).map((character, index) => {
		if (character === " ") return character;
		const position = getWordmarkGradientPosition(index, row * ROW_PHASE_STEP);
		const paletteIndex = Math.floor(((position % 1 + 1) % 1) * palette.length) % palette.length;
		return paintRgb(character, palette[paletteIndex]!);
	}).join("");
}

function paintRgb(text: string, rgb: Rgb): string {
	return `\x1b[38;2;${rgb.r};${rgb.g};${rgb.b}m${text}\x1b[39m`;
}

function ansi256ToRgb(index: number): Rgb | undefined {
	if (!Number.isInteger(index) || index < 0 || index > 255) return undefined;
	if (index < 16) return BASIC_ANSI_RGB[index < 8 ? 30 + index : 90 + index - 8];
	if (index < 232) {
		const value = index - 16;
		const r = Math.floor(value / 36);
		const g = Math.floor((value % 36) / 6);
		const b = value % 6;
		const cube = [0, 95, 135, 175, 215, 255];
		return { r: cube[r]!, g: cube[g]!, b: cube[b]! };
	}
	const gray = 8 + (index - 232) * 10;
	return { r: gray, g: gray, b: gray };
}

function clampByte(value: number): number {
	return Math.max(0, Math.min(255, Math.trunc(value)));
}

const BASIC_ANSI_RGB: Record<number, Rgb> = {
	30: { r: 0, g: 0, b: 0 },
	31: { r: 205, g: 49, b: 49 },
	32: { r: 13, g: 188, b: 121 },
	33: { r: 229, g: 229, b: 16 },
	34: { r: 36, g: 114, b: 200 },
	35: { r: 188, g: 63, b: 188 },
	36: { r: 17, g: 168, b: 205 },
	37: { r: 229, g: 229, b: 229 },
	90: { r: 102, g: 102, b: 102 },
	91: { r: 241, g: 76, b: 76 },
	92: { r: 35, g: 209, b: 139 },
	93: { r: 245, g: 245, b: 67 },
	94: { r: 59, g: 142, b: 234 },
	95: { r: 214, g: 112, b: 214 },
	96: { r: 41, g: 184, b: 219 },
	97: { r: 255, g: 255, b: 255 },
};

export class AcidbathHeader implements Component {
	private readonly tui: TUI;
	private readonly theme: Theme;
	private readonly noColor: boolean;
	private state: AcidbathHeaderState;

	constructor(_tui: TUI, theme: Theme, _modelName: string | undefined, _cwd: string, noColor: boolean, summary = DEFAULT_SESSION_SUMMARY) {
		this.tui = _tui;
		this.theme = theme;
		this.noColor = noColor;
		this.state = { summary };
	}

	public update(next: Partial<AcidbathHeaderState>): void {
		this.state = { ...this.state, ...next };
		this.tui.requestRender();
	}

	public render(width: number): string[] {
		return renderHeaderLines(width, this.theme, this.noColor, this.state.summary);
	}

	public invalidate(): void {
		// The header is rendered from the current theme on every pass.
	}
}
