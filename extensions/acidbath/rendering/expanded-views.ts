/**
 * Expanded detail views for each built-in tool type.
 *
 * Each factory takes raw result data and returns a Component,
 * or undefined to fall back to Pi's native renderer.
 *
 * All views are:
 * - Framed with ──── rules
 * - Bounded to MAX_LINES
 * - Width-safe using visibleWidth
 * - NO_COLOR safe (structure preserved without color)
 * - Only constructed when expanded — zero collapsed cost
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";

const MAX_LINES = 20;

// ── Utilities shared by all views ──────────────────────────────────

type ViewContent = string[];

function extractContent(result: Record<string, unknown>): string {
	const content = Array.isArray(result.content)
		? result.content
			.filter((part): part is Record<string, unknown> => typeof part === "object" && part !== null && part.type === "text")
			.map((part) => String(part.text ?? ""))
			.join("\n")
		: "";
	return content.replace(/\r\n?/g, "\n");
}

function extractLines(result: Record<string, unknown>, maxLines = MAX_LINES): ViewContent {
	const text = extractContent(result);
	const all = text.split("\n").filter((l) => l.trim() !== "");
	return all.slice(0, maxLines);
}

function visibleWidth(text: string): number {
	let w = 0;
	for (const ch of Array.from(text)) w += charWidth(ch);
	return w;
}

function charWidth(ch: string): number {
	const cp = ch.codePointAt(0) ?? 0;
	if ((cp >= 0x300 && cp <= 0x36f) || (cp >= 0xfe00 && cp <= 0xfe0f)) return 0;
	if (cp >= 0x3040 && cp <= 0x9fff || (cp >= 0x3000 && cp <= 0x303f) || (cp >= 0xff00 && cp <= 0xffef)) return 2;
	if (cp >= 0x1f300 && cp <= 0x1faff) return 2;
	return 1;
}

function truncateToWidth(text: string, maxWidth: number): string {
	if (visibleWidth(text) <= maxWidth || maxWidth <= 1) return text;
	let out = "";
	for (const ch of Array.from(text)) {
		if (visibleWidth(out) + charWidth(ch) > maxWidth - 1) break;
		out += ch;
	}
	return `${out}…`;
}

// ── Shared framed component base ───────────────────────────────────

class FramedView implements Component {
	private readonly lines: string[];
	private readonly footer: string;
	private readonly theme: Theme;
	private readonly noColor: boolean;
	private cachedWidth: number | undefined;
	private cachedLines: string[] | undefined;

	constructor(
		bodyLines: string[],
		footer: string,
		theme: Theme,
		noColor: boolean,
	) {
		this.lines = bodyLines;
		this.footer = footer;
		this.theme = theme;
		this.noColor = noColor;
	}

	render(width: number): string[] {
		const safe = Math.max(1, Math.trunc(width));
		if (this.cachedLines && this.cachedWidth === safe) return this.cachedLines;

		const result: string[] = [];
		for (const line of this.lines) {
			result.push(truncateToWidth(line, safe));
		}

		if (this.footer) {
			const styled = this.noColor ? this.footer : this.theme.fg("muted", this.footer);
			result.push(truncateToWidth(styled, safe));
		}

		this.cachedWidth = safe;
		this.cachedLines = result;
		return result;
	}

	invalidate(): void {
		this.cachedWidth = undefined;
		this.cachedLines = undefined;
	}
}

// ── Bash view: framed output ───────────────────────────────────────

export function createBashView(
	result: Record<string, unknown>,
	theme: Theme,
	noColor: boolean,
): Component | undefined {
	const code = extractContent(result);
	const details = (result.details ?? {}) as Record<string, unknown>;
	const exitCode = details.exitCode ?? result.exitCode;

	const allLines = code.split("\n");
	// Trim leading blank lines
	while (allLines.length > 0 && allLines[0]!.trim() === "") allLines.shift();
	// Trim trailing blank lines
	while (allLines.length > 0 && allLines[allLines.length - 1]!.trim() === "") allLines.pop();

	const showLines = allLines.slice(0, MAX_LINES);
	const hidden = Math.max(0, allLines.length - showLines.length);

	const body: string[] = [];

	if (showLines.length === 0) {
		// Quiet command
		body.push(exitCode !== undefined
			? `command completed · exit ${exitCode} · no output`
			: "command completed · no output");
	} else {
		for (const line of showLines) {
			body.push(line);
		}
	}

	const footerParts: string[] = [];
	if (hidden > 0) footerParts.push(`… ${hidden} more lines`);
	if (exitCode !== undefined) footerParts.push(`exit ${String(exitCode)}`);
	const footer = footerParts.join(" · ");

	return new FramedView(body, footer, theme, noColor);
}

// ── Read view: plain preview ───────────────────────────────────────

export function createReadView(
	result: Record<string, unknown>,
	theme: Theme,
	noColor: boolean,
): Component | undefined {
	const lines = extractLines(result, MAX_LINES);
	const total = extractContent(result).split("\n").filter((l) => l.trim() !== "").length;
	const hidden = Math.max(0, total - lines.length);

	if (lines.length === 0) return undefined;

	const body = lines.map((line) => line);
	const footer = hidden > 0 ? `… ${hidden} more lines` : "";
	return new FramedView(body, footer, theme, noColor);
}

// ── Grep view: context lines around matches ───────────────────────

export function createGrepView(
	result: Record<string, unknown>,
	theme: Theme,
	noColor: boolean,
): Component | undefined {
	const text = extractContent(result);
	const rawLines = text.split("\n");
	const details = (result.details ?? {}) as Record<string, unknown>;
	const matchCount = Number(details.matchCount ?? details.match_count ?? details.lines ?? 0);
	const fileCount = Number(details.fileCount ?? details.file_count ?? 0);

	const body: string[] = [];
	let currentFile = "";
	let linesShown = 0;

	for (const raw of rawLines) {
		if (linesShown >= MAX_LINES) break;
		const trimmed = raw.replace(/[\r\n]+$/, "").trimEnd();
		if (!trimmed) continue;

		// Detect file headers (common in grep output)
		if (trimmed.endsWith(":") && !trimmed.includes(":")) {
			currentFile = trimmed;
			if (body.length > 0) body.push("  ──");
			body.push(noColor ? currentFile : theme.fg("accent", currentFile));
			continue;
		}

		// Line with match: "path:line:content" or "path:line: content"
		const match = trimmed.match(/^([^:]+):(\d+):\s*(.*)$/);
		if (match) {
			const [, path, lineNum, content] = match;
			if (path !== currentFile) {
				currentFile = path;
				if (body.length > 0) body.push("  ──");
				body.push(noColor ? path : theme.fg("accent", path));
			}
			const gutter = `${noColor ? "" : theme.fg("dim", `${lineNum.padStart(4, " ")}`)}  ${content}`;
			body.push(`  ${gutter}`);
			linesShown++;
		} else {
			// Non-matching line (context before/after)
			if (body.length > 0) {
				const gutter = noColor ? "" : theme.fg("dim", "       ");
				body.push(`  ${gutter}${trimmed}`);
				linesShown++;
			}
		}
	}

	if (body.length === 0) return undefined;

	const footerParts: string[] = [];
	if (matchCount > linesShown) footerParts.push(`… ${matchCount - linesShown} more matches`);
	if (fileCount > 0) footerParts.push(`${fileCount} files`);
	const footer = footerParts.join(" · ");
	return new FramedView(body, footer, theme, noColor);
}

// ── Ls view: tree view ─────────────────────────────────────────────

export function createLsView(
	result: Record<string, unknown>,
	theme: Theme,
	noColor: boolean,
): Component | undefined {
	const lines = extractLines(result, MAX_LINES);
	if (lines.length === 0) return undefined;

	const details = (result.details ?? {}) as Record<string, unknown>;
	const total = Number(details.entryCount ?? details.lines ?? details.entries ?? lines.length);
	const hidden = Math.max(0, total - lines.length);

	// Build tree: group by directory prefix
	const body: string[] = [];
	let currentDir = "";

	for (const line of lines) {
		const clean = line.replace(/\s+/g, " ").trim();
		if (!clean) continue;

		// Check if it looks like a dir entry (ends with /)
		if (clean.endsWith("/")) {
			currentDir = clean;
			body.push(noColor ? `  ${clean}` : theme.fg("warning", `  ${clean}`));
		} else if (currentDir) {
			body.push(noColor ? `  ├── ${clean}` : theme.fg("dim", `  ├── ${clean}`));
		} else {
			body.push(`  ${clean}`);
		}
	}

	// If no tree structure detected, fall back to simple list
	if (!body.some((l) => l.includes("├──"))) {
		body.length = 0;
		for (const line of lines) {
			const clean = line.replace(/\s+/g, " ").trim();
			if (clean) body.push(`  ${clean}`);
		}
	}

	const footer = hidden > 0 ? `… ${hidden} more entries` : "";
	return new FramedView(body, footer, theme, noColor);
}

// ── Find view: tree view ───────────────────────────────────────────

export function createFindView(
	result: Record<string, unknown>,
	theme: Theme,
	noColor: boolean,
): Component | undefined {
	const lines = extractLines(result, MAX_LINES);
	if (lines.length === 0) return undefined;

	const details = (result.details ?? {}) as Record<string, unknown>;
	const total = Number(details.resultCount ?? details.lines ?? details.entryCount ?? lines.length);
	const hidden = Math.max(0, total - lines.length);

	// Find paths from a common root
	const paths = lines.map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);

	// Try to build tree from common prefix
	const tree = buildPathTree(paths);
	const body = tree.length > 0 ? tree : paths.map((p) => `  ${p}`);

	const footer = hidden > 0 ? `… ${hidden} more results` : "";
	return new FramedView(body, footer, theme, noColor);
}

function buildPathTree(paths: string[]): string[] {
	if (paths.length === 0) return [];

	// Find common prefix
	const sorted = [...paths].sort();
	const first = sorted[0]!;
	const last = sorted[sorted.length - 1]!;
	let prefixLen = 0;
	for (let i = 0; i < first.length && i < last.length; i++) {
		if (first[i] !== last[i]) break;
		if (first[i] === "/") prefixLen = i;
	}
	const root = prefixLen > 0 ? first.slice(0, prefixLen + 1) : "";

	const result: string[] = [];
	if (root) result.push(`  ${root}`);

	const seen = new Set<string>();
	for (const p of paths) {
		const rel = root ? p.slice(root.length) : p;
		const parts = rel.split("/").filter(Boolean);
		if (parts.length === 0) continue;

		// Build the tree line
		let line = "";
		if (parts.length === 1) {
			line = `  ├── ${parts[0]}`;
		} else {
			const dirs = parts.slice(0, -1).join("/");
			const file = parts[parts.length - 1]!;
			if (!seen.has(dirs)) {
				seen.add(dirs);
				line = `  ├── ${dirs}/`;
				result.push(line);
			}
			line = `  │   └── ${file}`;
		}
		result.push(line);
	}

	return result.length > 1 ? result : [];
}

// ── Master dispatch ────────────────────────────────────────────────

/**
 * Create the appropriate expanded view for a tool result.
 * Returns undefined to fall back to Pi's native renderer.
 */
export function createExpandedView(
	toolName: string,
	result: Record<string, unknown>,
	theme: Theme,
	noColor: boolean,
): Component | undefined {
	switch (toolName) {
		case "bash":
			return createBashView(result, theme, noColor);
		case "read":
			return createReadView(result, theme, noColor);
		case "grep":
			return createGrepView(result, theme, noColor);
		case "ls":
			return createLsView(result, theme, noColor);
		case "find":
			return createFindView(result, theme, noColor);
		// edit/write are handled by DiffView separately
		default:
			return undefined;
	}
}
