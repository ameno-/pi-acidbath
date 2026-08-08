/** Pure, status-first tool-row formatting. No Pi/TUI/runtime dependencies. */

export type ToolRowStatus = "pending" | "success" | "error";

export interface ToolRowFormatInput {
	width: number;
	toolName: string;
	target: string;
	status: ToolRowStatus;
	phase?: number;
	reducedMotion?: boolean;
	metadata?: readonly string[];
	expandable?: boolean;
	expanded?: boolean;
}

export function formatToolRow(input: ToolRowFormatInput): string {
	const width = Math.max(1, Math.trunc(input.width));
	const status = input.status === "success" ? "ok" : input.status === "error" ? "ERR" : input.reducedMotion ? "..." : ["...", "∙", "●", "∙"][normalize(input.phase ?? 0)]!;
	const tool = clean(input.toolName) || "tool";
	const target = clean(input.target) || "?";
	const required = `${status} ${tool} ${target}`;
	const metadata = [...(input.metadata ?? [])].map(clean).filter(Boolean);
	if (input.expandable && !input.expanded) metadata.push("expand");
	return truncate(metadata.length === 0 ? required : `${required} (${metadata.join(", ")})`, width);
}

function normalize(value: number): number {
	if (!Number.isFinite(value)) return 0;
	return ((Math.trunc(value) % 4) + 4) % 4;
}

function clean(value: string): string {
	return value.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
}

function truncate(value: string, width: number): string {
	if (toolRowVisibleWidth(value) <= width) return value;
	if (width <= 1) return "…";
	let output = "";
	for (const character of Array.from(value)) {
		if (toolRowVisibleWidth(output) + characterWidth(character) > width - 1) break;
		output += character;
	}
	return `${output}…`;
}

export function toolRowVisibleWidth(value: string): number {
	let width = 0;
	for (const character of Array.from(value)) width += characterWidth(character);
	return width;
}

function characterWidth(character: string): number {
	const codePoint = character.codePointAt(0) ?? 0;
	if ((codePoint >= 0x300 && codePoint <= 0x36f) || (codePoint >= 0xfe00 && codePoint <= 0xfe0f)) return 0;
	if (codePoint >= 0x1f300 && codePoint <= 0x1faff) return 2;
	return 1;
}
