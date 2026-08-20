/** Unified tool renderers with native Pi detail bodies in the transcript. */

import { truncateToWidth as tuiTruncateToWidth } from "@earendil-works/pi-tui";
import type { Component } from "@earendil-works/pi-tui";
import type {
	Theme,
	ToolDefinition,
	ToolRenderResultOptions,
} from "@earendil-works/pi-coding-agent";
type ToolMotionState = "pending" | "success" | "error";
import { formatToolRow } from "./ui-tool-rows.js";
import { classifySemanticCommand } from "./ui-semantic-commands.js";
import { createExpandedView } from "./rendering/expanded-views.js";
import { DiffView } from "./rendering/diff-view.js";
import { statusGlyph, toolGlyph, animFrame, animFrameCount, STATUS_LUMPY } from "./rendering/kaomoji.js";
import { subscribe, currentFrame } from "./rendering/motion.js";

interface ToolRowState {
	toolCallId: string;
	toolName: string;
	args: Record<string, unknown>;
	status: ToolMotionState;
	target: string;
	metadata: string[];
	truncated: boolean;
	settled: boolean;
	callInvalidate?: () => void;
	nativeDetails?: Component;
	previewLines: string[];
	previewHidden: number;
	/** Unsubscribe from the shared motion clock while pending. */
	unsubscribe?: () => void;
}

interface AcidbathRendererState {
	acidbathToolRow?: ToolRowState;
}

type AnyToolDefinition = ToolDefinition<any, any, any>;
type AnyRendererContext = {
	args: any;
	toolCallId: string;
	invalidate: () => void;
	lastComponent: Component | undefined;
	state: any;
	cwd: string;
	executionStarted: boolean;
	argsComplete: boolean;
	isPartial: boolean;
	expanded: boolean;
	showImages: boolean;
	isError: boolean;
};
type AnyResultOptions = ToolRenderResultOptions;

/** Presentation contract for one tool. Execution stays in ui-tools.ts. */
export interface CompactToolRendererOptions {
	noColor: boolean;
	reducedMotion: boolean;
}

class ToolRowComponent implements Component {
	private readonly row: ToolRowState;
	private readonly theme: Theme;
	private readonly noColor: boolean;
	private readonly details: Component | undefined;
	private readonly previewLines: string[];
	private readonly previewHidden: number;
	private readonly expanded: boolean;
	/** When true, the call slot returns empty once the result is settled. */
	private readonly isCallSlot: boolean;
	private cachedWidth: number | undefined;
	private cachedLines: string[] | undefined;
	private cachedFrame: number = -1;

	constructor(
		row: ToolRowState,
		theme: Theme,
		noColor: boolean,
		details: Component | undefined,
		previewLines: readonly string[],
		previewHidden: number,
		expanded: boolean,
		isCallSlot = false,
	) {
		this.row = row;
		this.theme = theme;
		this.noColor = noColor;
		this.details = details;
		this.previewLines = [...previewLines];
		this.previewHidden = previewHidden;
		this.expanded = expanded;
		this.isCallSlot = isCallSlot;
	}

	render(width: number): string[] {
		const safeWidth = Math.max(1, Math.trunc(width));
		// Call slot returns empty when the result is settled — prevents double rows
		if (this.isCallSlot && this.row.settled) return [];

		const frame = this.row.settled ? 0 : currentFrame();
		if (this.cachedLines && this.cachedWidth === safeWidth && this.cachedFrame === frame) return this.cachedLines;

		// ── Build kaomoji glyphs ────────────────────────────────────
		const settled = this.row.settled;
		const stGlyph = this.noColor ? "" : (settled ? statusGlyph(this.row.status, true) : STATUS_LUMPY);
		const tGlyph = this.noColor ? "" : (settled ? toolGlyph(this.row.toolName) : animFrame(this.row.toolName, frame));

		const plain = formatToolRow({
			width: safeWidth,
			statusGlyph: stGlyph,
			toolGlyph: tGlyph,
			toolName: this.row.toolName,
			target: this.row.target,
			status: this.row.status,
			metadata: this.row.metadata,
			expandable: this.row.status !== "pending" || Boolean(this.details) || this.row.truncated,
			expanded: this.expanded,
		});

		// ── Apply colors ───────────────────────────────────────────
		const lifecycleColor = this.row.status === "error" ? "error" : this.row.status === "success" ? "success" : "accent";
		let styled: string;
		if (this.noColor || !stGlyph || !tGlyph) {
			styled = plain;
		} else {
			// kaomoji format: "(glyph) (tool) target (meta)"
			const afterTool = plain.slice(stGlyph.length + 1 + tGlyph.length);
			styled = `${this.theme.fg(lifecycleColor, stGlyph)} ${this.theme.fg("accent", tGlyph)}${afterTool}`;
		}

		const lines = [tuiTruncateToWidth(styled, safeWidth, "…")];
		const indent = this.noColor ? "  " : `${this.theme.fg("dim", "  ")}`;
		if (!this.expanded && this.previewLines.length > 0) {
			const previewColor = this.row.status === "error" ? "error" : "toolOutput";
			for (const previewLine of this.previewLines) {
				const preview = `${this.theme.fg("dim", "  ")}${this.theme.fg(previewColor, previewLine)}`;
				lines.push(tuiTruncateToWidth(`${indent}${preview}`, safeWidth, "…"));
			}
			if (this.previewHidden > 0) {
				const noun = this.previewHidden === 1 ? "line" : "lines";
				lines.push(tuiTruncateToWidth(`${indent}${this.theme.fg("dim", "  … ")}${this.previewHidden} more ${noun} · expand`, safeWidth, "…"));
			}
		}
		if (this.expanded && this.details) {
			for (const line of this.details.render(safeWidth)) lines.push(tuiTruncateToWidth(`${indent}${line}`, safeWidth, "…"));
		}
		this.cachedWidth = safeWidth;
		this.cachedFrame = frame;
		this.cachedLines = lines;
		return lines;
	}

	invalidate(): void {
		this.cachedWidth = undefined;
		this.cachedLines = undefined;
		this.details?.invalidate();
	}
}

function rendererState(context: AnyRendererContext): AcidbathRendererState {
	if (context.state && typeof context.state === "object") return context.state as AcidbathRendererState;
	// Pi initializes renderer state as an object. Keep a defensive fallback for
	// alternate hosts that provide an absent state value.
	return {};
}

function getOrCreateRow(
	context: AnyRendererContext,
	toolName: string,
	args: Record<string, unknown>,
): ToolRowState {
	const state = rendererState(context);
	const existing = state.acidbathToolRow;
	if (existing && existing.toolCallId === context.toolCallId) {
		existing.args = args;
		return existing;
	}
	const row: ToolRowState = {
		toolCallId: context.toolCallId,
		toolName,
		args,
		status: "pending",
		target: targetForTool(toolName, args),
		metadata: ["pending"],
		truncated: false,
		settled: false,
		previewLines: [],
		previewHidden: 0,
		unsubscribe: undefined,
	};
	// Subscribe to animation clock while pending (kaomoji animation frames)
	if (animFrameCount(toolName) > 0) {
		row.unsubscribe = subscribe(context.toolCallId, () => {
			context.invalidate();
		});
	}
	state.acidbathToolRow = row;
	return row;
}

/**
 * Build the one Acidbath presentation policy: one lifecycle row per call,
 * with Pi's native domain renderer retained as the result body.
 */
export function createCompactToolRenderers(
	definition: AnyToolDefinition,
	factory: (cwd: string) => AnyToolDefinition,
	options: CompactToolRendererOptions,
): Pick<AnyToolDefinition, "renderCall" | "renderResult"> {
	const { noColor, reducedMotion } = options;

	return {
		renderCall(args: unknown, theme: Theme, context: AnyRendererContext): Component {
			const row = getOrCreateRow(context, definition.name, args as Record<string, unknown>);
			// A call slot remains pending until its result slot settles. Once
			// settled, do not reinstall its invalidation callback during redraw.
			if (!row.settled) {
				row.status = context.isError ? "error" : "pending";
				row.target = targetForTool(definition.name, row.args);
				row.callInvalidate = context.invalidate;
			}
			return new ToolRowComponent(row, theme, noColor, undefined, [], 0, false, true);
		},

		renderResult(
			result: any,
			resultOptions: AnyResultOptions,
			theme: Theme,
			context: AnyRendererContext,
		): Component {
			const row = getOrCreateRow(context, definition.name, context.args as Record<string, unknown>);
			row.status = context.isError ? "error" : resultOptions.isPartial ? "pending" : "success";
			row.settled = !resultOptions.isPartial;
			row.target = targetForTool(definition.name, row.args);
			row.metadata = resultOptions.isPartial
				? ["running"]
				: metadataForTool(definition.name, row.args, result as Record<string, unknown>);
			row.truncated = hasTruncation(result as Record<string, unknown>);

			// Expanded rows never display the compact preview. Avoid repeatedly
			// splitting large streaming results that Pi will render natively.
			const preview = resultOptions.expanded ? { lines: [], hidden: 0 } : previewForResult(definition.name, result);
			row.previewLines = preview.lines;
			row.previewHidden = preview.hidden;
			if (row.status !== "pending") {
				const invalidateCall = row.callInvalidate;
				row.callInvalidate = undefined;
				if (invalidateCall) queueMicrotask(invalidateCall);
			}

			// Unsubscribe from animation clock when settled
			if (!resultOptions.isPartial && row.unsubscribe) {
				row.unsubscribe();
				row.unsubscribe = undefined;
			}

			// Expanded detail view: Acidbath custom views preferred, fall back to Pi's native.
			if (resultOptions.expanded) {
				const resultRecord = result as Record<string, unknown>;
				const acidbathView = createExpandedView(definition.name, resultRecord, theme, noColor);
				if (acidbathView) {
					row.nativeDetails = acidbathView;
				} else if (definition.name === "edit" || definition.name === "write") {
					const content = extractContentForDiff(resultRecord);
					if (content) {
						const details = isRecord(resultRecord.details) ? resultRecord.details as Record<string, unknown> : {};
						const added = numberValue(details.added ?? details.addedLines);
						const removed = numberValue(details.removed ?? details.removedLines);
						const stats = (added !== undefined || removed !== undefined)
							? `+${Math.round(added ?? 0)} -${Math.round(removed ?? 0)}`
							: "";
						row.nativeDetails = new DiffView(content, theme, noColor, stats);
					}
				} else {
					// Fall back to Pi's native renderer
					const runtimeDefinition = factory(context.cwd);
					if (runtimeDefinition.renderResult) {
						try {
							row.nativeDetails = runtimeDefinition.renderResult(result, resultOptions, theme, {
								...context,
								lastComponent: row.nativeDetails,
							});
						} catch {
							row.nativeDetails = undefined;
						}
					}
				}
			}
			return new ToolRowComponent(row, theme, noColor, row.nativeDetails, row.previewLines, row.previewHidden, resultOptions.expanded);
		},
	};
}

function previewForResult(toolName: string, result: Record<string, unknown>): { lines: string[]; hidden: number } {
	const details = isRecord(result.details) ? result.details : {};
	const displayContent = isRecord(details.displayContent) ? details.displayContent.text : undefined;
	const content = typeof displayContent === "string"
		? displayContent
		: Array.isArray(result.content)
			? result.content
				.filter((part): part is Record<string, unknown> => isRecord(part) && part.type === "text" && typeof part.text === "string")
				.map((part) => part.text as string)
				.join("\n")
			: "";
	if (!content.trim()) return { lines: [], hidden: 0 };

	const rawLines = content.replace(/\r\n?/g, "\n").split("\n");
	const lines = rawLines.map((line) => line.replace(/[\t]+/g, "    ").trimEnd());
	while (lines.length > 0 && lines[0]!.trim() === "") lines.shift();
	while (lines.length > 0 && lines[lines.length - 1]!.trim() === "") lines.pop();
	const limit = 4;
	const visible = toolName === "bash" ? lines.slice(-limit) : lines.slice(0, limit);
	const hidden = Math.max(0, lines.length - visible.length);
	return { lines: visible, hidden };
}

function targetForTool(toolName: string, args: Record<string, unknown>): string {
	if (toolName === "bash") {
		const semantic = classifySemanticCommand(args.command);
		if (semantic) return semantic.target;
	}
	const value = toolName === "bash"
		? args.command
		: args.path ?? args.file_path ?? args.pattern ?? args.directory ?? args.query;
	return cleanInline(typeof value === "string" ? value : "");
}

function metadataForTool(toolName: string, args: Record<string, unknown>, result: Record<string, unknown>): string[] {
	const details = isRecord(result.details) ? result.details : {};
	const metadata: string[] = [];
	if (toolName === "bash") {
		const semantic = classifySemanticCommand(args.command);
		if (semantic) metadata.push(...semantic.metadata);
	}
	const exitCode = numberValue(details.exitCode ?? result.exitCode);
	if (toolName === "bash" && exitCode !== undefined) metadata.push(`exit ${exitCode}`);
	const lines = numberValue(details.lines ?? details.lineCount ?? details.matchCount ?? details.entryCount);
	if (lines !== undefined) metadata.push(`${Math.round(lines)} ${toolName === "grep" ? "matches" : "lines"}`);
	const added = numberValue(details.added ?? details.addedLines);
	const removed = numberValue(details.removed ?? details.removedLines);
	if (added !== undefined || removed !== undefined) metadata.push(`+${Math.round(added ?? 0)} -${Math.round(removed ?? 0)}`);
	if (hasTruncation(result)) metadata.push("truncated");
	if (metadata.length === 0 && toolName === "bash" && typeof args.command === "string") metadata.push("completed");
	return metadata;
}

function hasTruncation(result: Record<string, unknown>): boolean {
	const details = isRecord(result.details) ? result.details : result;
	const truncation = isRecord(details.truncation) ? details.truncation : undefined;
	return details.truncated === true || truncation?.truncated === true || truncation?.truncatedByBytes === true || truncation?.truncatedByLines === true;
}

function numberValue(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, any> {
	return typeof value === "object" && value !== null;
}

function extractContentForDiff(result: Record<string, unknown>): string {
	const content = Array.isArray(result.content)
		? result.content
			.filter((part): part is Record<string, unknown> => typeof part === "object" && part !== null && part.type === "text")
			.map((part) => String(part.text ?? ""))
			.join("\n")
		: "";
	return content.replace(/\r\n?/g, "\n").trim();
}

function cleanInline(value: string): string {
	return value.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
}
