/**
 * Themed unified diff view for edit/write expanded results.
 *
 * - Parses text content for unified diff markers (-, +, context)
 * - Renders with muted gutter, added/removed markers, context lines
 * - Framed with ──── rules above and below
 * - Bounded to MAX_LINES, with truncation hint
 * - Only constructed when expanded — zero collapsed cost
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";

const MAX_LINES = 20;

interface DiffLine {
	kind: "add" | "rem" | "ctx";
	text: string;
	oldLine?: number;
	newLine?: number;
}

export class DiffView implements Component {
	private readonly lines: DiffLine[];
	private readonly stats: string;
	private readonly theme: Theme;
	private readonly noColor: boolean;
	private cachedWidth: number | undefined;
	private cachedLines: string[] | undefined;

	constructor(content: string, theme: Theme, noColor: boolean, stats?: string) {
		this.theme = theme;
		this.noColor = noColor;
		this.stats = stats ?? "";
		this.lines = parseDiff(content, MAX_LINES);
	}

	render(width: number): string[] {
		const safeWidth = Math.max(1, Math.trunc(width));
		if (this.cachedLines && this.cachedWidth === safeWidth) return this.cachedLines;

		const result: string[] = [];
		for (const line of this.lines) {
			result.push(this.renderDiffLine(line, safeWidth));
		}

		if (this.lines.length >= MAX_LINES) {
			const more = countRemaining(this.lines.length);
			result.push(this.truncate(`… ${more} more lines · expand`, safeWidth));
		}

		this.cachedWidth = safeWidth;
		this.cachedLines = result;
		return result;
	}

	invalidate(): void {
		this.cachedWidth = undefined;
		this.cachedLines = undefined;
	}

	private renderDiffLine(line: DiffLine, width: number): string {
		const indent = "  ";
		const numberWidth = 4;
		const sign = line.kind === "add" ? "+" : line.kind === "rem" ? "-" : " ";
		let gutter = `${" ".repeat(numberWidth)}${sign} `;

		if (this.noColor) {
			return this.truncate(`${indent}${gutter}${line.text}`, width);
		}

		const colorKey = line.kind === "add" ? "toolDiffAdded" : line.kind === "rem" ? "toolDiffRemoved" : "toolDiffContext";
		const signColor = line.kind === "add" ? this.theme.fg("success", sign) : line.kind === "rem" ? this.theme.fg("error", sign) : " ";
		const styledText = this.theme.fg(colorKey, line.text);
		const lineNum = this.theme.fg("dim", " ".repeat(numberWidth));
		return this.truncate(`${indent}${lineNum}${signColor} ${styledText}`, width);
	}

	private muted(text: string): string {
		return this.noColor ? text : this.theme.fg("muted", text);
	}

	private truncate(text: string, width: number): string {
		if (visibleWidth(text) <= width) return text;
		if (width <= 1) return "…";
		let output = "";
		for (const ch of Array.from(text)) {
			if (visibleWidth(output) + charWidth(ch) > width - 1) break;
			output += ch;
		}
		return `${output}…`;
	}
}

function parseDiff(content: string, maxLines: number): DiffLine[] {
	const lines = content.split("\n");
	const result: DiffLine[] = [];
	for (const raw of lines) {
		if (result.length >= maxLines) break;
		const trimmed = raw.replace(/[\r\n]+$/, "");
		if (trimmed.startsWith("---") || trimmed.startsWith("+++") || trimmed.startsWith("@@")) continue;
		if (trimmed.startsWith("-") && !trimmed.startsWith("---")) {
			result.push({ kind: "rem", text: trimmed.slice(1) });
		} else if (trimmed.startsWith("+") && !trimmed.startsWith("+++")) {
			result.push({ kind: "add", text: trimmed.slice(1) });
		} else {
			result.push({ kind: "ctx", text: trimmed });
		}
	}
	return result;
}

function countRemaining(shown: number): number {
	return Math.max(0, shown);
}

function visibleWidth(text: string): number {
	let w = 0;
	for (const ch of Array.from(text)) w += charWidth(ch);
	return w;
}

function charWidth(ch: string): number {
	const cp = ch.codePointAt(0) ?? 0;
	if ((cp >= 0x300 && cp <= 0x36f) || (cp >= 0xfe00 && cp <= 0xfe0f)) return 0;
	if (cp >= 0x3040 && cp <= 0x9fff) return 2;
	if (cp >= 0x3000 && cp <= 0x303f) return 2;
	if (cp >= 0xff00 && cp <= 0xffef) return 2;
	if (cp >= 0x1f300 && cp <= 0x1faff) return 2;
	return 1;
}
