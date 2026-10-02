/** Pure, bounded summaries for collapsed tool output. */

export interface ToolOutputSummary {
	metadata: string[];
	hasDetails: boolean;
	errorLine?: string;
}

export interface ToolOutputSummaryOptions {
	isPartial: boolean;
	isError: boolean;
	durationMs?: number;
}

interface TextStats {
	lines: number;
	firstLine?: string;
	lastLine?: string;
	text: string;
}

const RESOURCE_FILES = new Set(["AGENTS.md", "AGENTS.MD", "AGENTS.override.md", "CLAUDE.md", "CLAUDE.MD"]);

export function targetForTool(toolName: string, args: Record<string, unknown>): string {
	const path = stringValue(args.path ?? args.file_path);
	switch (toolName) {
		case "bash":
			return cleanInline(stringValue(args.command));
		case "read":
			return describeReadTarget(path, args);
		case "grep": {
			const pattern = cleanInline(stringValue(args.pattern));
			const scope = cleanInline(path || stringValue(args.glob));
			return scope ? `"${pattern}" in ${scope}` : `"${pattern}"`;
		}
		case "find": {
			const pattern = cleanInline(stringValue(args.pattern));
			const scope = cleanInline(path);
			return scope ? `${pattern} in ${scope}` : pattern;
		}
		case "ls":
			return cleanInline(path) || ".";
		default:
			return cleanInline(path || stringValue(args.pattern ?? args.directory ?? args.query));
	}
}

export function summarizeToolOutput(
	toolName: string,
	args: Record<string, unknown>,
	result: Record<string, unknown>,
	options: ToolOutputSummaryOptions,
): ToolOutputSummary {
	if (options.isPartial) return { metadata: ["running"], hasDetails: false };

	const details = isRecord(result.details) ? result.details : {};
	const stats = textStats(result);
	const metadata: string[] = [];

	if (toolName === "bash") metadata.push(options.isError ? "failed" : "completed");
	else if (options.isError) metadata.push("failed");

	const semanticCount = countForTool(toolName, details, stats);
	if (semanticCount !== undefined) metadata.push(formatCount(toolName, semanticCount));

	const diff = diffStats(toolName, args, details);
	if (diff) metadata.push(diff);
	if (hasTruncation(result)) metadata.push("truncated");
	if (options.durationMs !== undefined && options.durationMs >= 100) metadata.push(formatDuration(options.durationMs));
	if (metadata.length === 0) metadata.push("done");

	return {
		metadata,
		hasDetails: stats.lines > 0 || Object.keys(details).length > 0,
		errorLine: options.isError ? (toolName === "bash" ? stats.lastLine : stats.firstLine) : undefined,
	};
}

function describeReadTarget(path: string, args: Record<string, unknown>): string {
	const cleanPath = cleanInline(path);
	const segments = cleanPath.split(/[\\/]/).filter(Boolean);
	const fileName = segments.at(-1) ?? cleanPath;
	let target = cleanPath;
	if (fileName === "SKILL.md") target = `skill ${segments.at(-2) ?? "SKILL"}`;
	else if (RESOURCE_FILES.has(fileName)) target = `context ${fileName}`;
	else if (contentKind(cleanPath) === "markdown") target = `doc ${cleanPath}`;

	const offset = finiteNumber(args.offset);
	const limit = finiteNumber(args.limit);
	if (offset !== undefined || limit !== undefined) {
		const start = Math.max(1, Math.trunc(offset ?? 1));
		const end = limit === undefined ? "" : `-${start + Math.max(0, Math.trunc(limit)) - 1}`;
		target += `:${start}${end}`;
	}
	return target;
}

function countForTool(
	toolName: string,
	details: Record<string, unknown>,
	stats: TextStats,
): number | undefined {
	const truncation = isRecord(details.truncation) ? details.truncation : {};
	const outputLines = finiteNumber(truncation.outputLines);
	if (toolName === "read") return outputLines ?? noticeAwareLineCount(stats.lines, details, stats.text, toolName);
	if (toolName === "grep") {
		if (stats.firstLine?.startsWith("No matches found")) return 0;
		return finiteNumber(details.matchCount) ?? finiteNumber(details.matchLimitReached) ?? noticeAwareLineCount(stats.lines, details);
	}
	if (toolName === "find") {
		if (stats.firstLine?.startsWith("No files found")) return 0;
		return finiteNumber(details.resultCount) ?? finiteNumber(details.resultLimitReached) ?? noticeAwareLineCount(stats.lines, details);
	}
	if (toolName === "ls") {
		if (stats.firstLine === "(empty directory)" || stats.firstLine === "Directory is empty") return 0;
		return finiteNumber(details.entryCount) ?? finiteNumber(details.entryLimitReached) ?? noticeAwareLineCount(stats.lines, details);
	}
	if (toolName === "read" || toolName === "bash") {
		return noticeAwareLineCount(stats.lines, details, stats.text, toolName);
	}
	return undefined;
}

function noticeAwareLineCount(
	textLines: number,
	details: Record<string, unknown>,
	text = "",
	toolName?: string,
): number | undefined {
	if (textLines === 0) return undefined;
	if (toolName === "read") {
		const withoutNotice = text.replace(/\n\s*\[\d+ more lines in file\.\.\.\]\s*$/, "");
		return countDisplayLines(withoutNotice) || undefined;
	}
	if (toolName === "bash") {
		const withoutNotice = text.replace(/\n\s*\[Showing lines .+\]\s*$/, "");
		return countDisplayLines(withoutNotice) || undefined;
	}
	return Math.max(0, textLines - (Object.keys(details).length === 0 ? 0 : 2));
}

function formatCount(toolName: string, count: number): string {
	const rounded = Math.max(0, Math.trunc(count));
	const noun = toolName === "grep"
		? rounded === 1 ? "match" : "matches"
		: toolName === "find"
			? rounded === 1 ? "result" : "results"
			: toolName === "ls"
				? rounded === 1 ? "entry" : "entries"
				: rounded === 1 ? "line" : "lines";
	return `${rounded} ${noun}`;
}

function diffStats(toolName: string, args: Record<string, unknown>, details: Record<string, unknown>): string | undefined {
	if (toolName !== "edit" && toolName !== "write") return undefined;
	const explicitAdded = finiteNumber(details.added ?? details.addedLines);
	const explicitRemoved = finiteNumber(details.removed ?? details.removedLines);
	if (explicitAdded !== undefined || explicitRemoved !== undefined) {
		return `+${Math.trunc(explicitAdded ?? 0)} -${Math.trunc(explicitRemoved ?? 0)}`;
	}
	const diff = stringValue(details.diff);
	if (diff) {
		let added = 0;
		let removed = 0;
		for (const line of diff.split("\n")) {
			if (line.startsWith("+") && !line.startsWith("+++")) added++;
			else if (line.startsWith("-") && !line.startsWith("---")) removed++;
		}
		if (added > 0 || removed > 0) return `+${added} -${removed}`;
	}
	if (toolName === "write") {
		const lines = countTextLines(stringValue(args.content));
		if (lines > 0) return `wrote ${lines} ${lines === 1 ? "line" : "lines"}`;
	}
	return undefined;
}

function textStats(result: Record<string, unknown>): TextStats {
	if (!Array.isArray(result.content)) return { lines: 0, text: "" };
	let lines = 0;
	let firstLine: string | undefined;
	let lastLine: string | undefined;
	const textParts: string[] = [];
	for (const part of result.content) {
		if (!isRecord(part) || part.type !== "text" || typeof part.text !== "string" || part.text.length === 0) continue;
		textParts.push(part.text);
		lines += countDisplayLines(part.text);
		if (firstLine === undefined) firstLine = firstNonEmptyLine(part.text);
		lastLine = lastNonEmptyLine(part.text) ?? lastLine;
	}
	return { lines, firstLine, lastLine, text: textParts.join("\n") };
}

function firstNonEmptyLine(text: string): string | undefined {
	let start = 0;
	while (start < text.length) {
		const end = text.indexOf("\n", start);
		const line = text.slice(start, end === -1 ? text.length : end).replace(/\r$/, "").trim();
		if (line) return cleanInline(line);
		if (end === -1) break;
		start = end + 1;
	}
	return undefined;
}

function lastNonEmptyLine(text: string): string | undefined {
	let end = text.length;
	while (end > 0) {
		const start = text.lastIndexOf("\n", end - 1) + 1;
		const line = text.slice(start, end).replace(/\r$/, "").trim();
		if (line) return cleanInline(line);
		if (start === 0) break;
		end = start - 1;
	}
	return undefined;
}

export function countTextLines(text: string): number {
	if (!text) return 0;
	let lines = 1;
	for (let index = 0; index < text.length; index++) {
		if (text.charCodeAt(index) === 10) lines++;
	}
	if (text.endsWith("\n")) lines--;
	return lines;
}

function countDisplayLines(text: string): number {
	let start = 0;
	let end = text.length;
	while (start < end && (text.charCodeAt(start) === 10 || text.charCodeAt(start) === 13)) start++;
	while (end > start && (text.charCodeAt(end - 1) === 10 || text.charCodeAt(end - 1) === 13)) end--;
	if (start === end) return 0;
	let lines = 1;
	for (let index = start; index < end; index++) {
		if (text.charCodeAt(index) === 10) lines++;
	}
	return lines;
}

function contentKind(path: string): string | undefined {
	const lower = path.toLowerCase();
	if (lower.endsWith(".md") || lower.endsWith(".mdx")) return "markdown";
	return undefined;
}

function formatDuration(ms: number): string {
	if (ms < 1_000) return `${Math.round(ms)}ms`;
	if (ms < 60_000) return `${(ms / 1_000).toFixed(ms < 10_000 ? 1 : 0)}s`;
	const minutes = Math.floor(ms / 60_000);
	return `${minutes}m ${Math.floor((ms % 60_000) / 1_000)}s`;
}

function hasTruncation(result: Record<string, unknown>): boolean {
	const details = isRecord(result.details) ? result.details : result;
	const truncation = isRecord(details.truncation) ? details.truncation : undefined;
	return details.truncated === true || truncation?.truncated === true || truncation?.truncatedByBytes === true || truncation?.truncatedByLines === true;
}

function cleanInline(value: string): string {
	return value.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
}

function stringValue(value: unknown): string {
	return typeof value === "string" ? value : "";
}

function finiteNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, any> {
	return typeof value === "object" && value !== null;
}
