/** Compact-first tool renderers with native Pi detail views on expansion. */

import { truncateToWidth as tuiTruncateToWidth, visibleWidth as tuiVisibleWidth } from "@earendil-works/pi-tui";
import type { Component } from "@earendil-works/pi-tui";
import type {
	Theme,
	ToolDefinition,
	ToolRenderResultOptions,
} from "@earendil-works/pi-coding-agent";
import { MotionClock, toolMotionGlyphForTool, type ToolMotionState } from "./ui-motion.js";
import { formatToolRow } from "./ui-tool-rows.js";
import type { ToolActivityUpdate } from "./ui-tool-activity.js";
import type { LabelInput } from "./ui-labels.js";

interface ToolRowState {
	toolCallId: string;
	toolName: string;
	args: Record<string, unknown>;
	status: ToolMotionState;
	target: string;
	metadata: string[];
	startedAt: number;
	durationMs?: number;
	truncated: boolean;
	settled: boolean;
	callInvalidate?: () => void;
	nativeDetails?: Component;
	previewLines: string[];
	previewHidden: number;
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
	clock: MotionClock;
	reducedMotion: boolean;
	noColor: boolean;
	onLabel?: (input: LabelInput) => void;
	onActivity?: (update: ToolActivityUpdate) => void;
	hideTranscript?: boolean;
}

class ToolRowComponent implements Component {
	private readonly row: ToolRowState;
	private readonly theme: Theme;
	private readonly clock: MotionClock;
	private readonly reducedMotion: boolean;
	private readonly noColor: boolean;
	private readonly details: Component | undefined;
	private readonly previewLines: string[];
	private readonly previewHidden: number;
	private readonly expanded: boolean;
	private readonly hideWhenSettled: boolean;
	private readonly hideTranscript: boolean;

	constructor(
		row: ToolRowState,
		theme: Theme,
		clock: MotionClock,
		reducedMotion: boolean,
		noColor: boolean,
		details: Component | undefined,
		previewLines: readonly string[],
		previewHidden: number,
		expanded: boolean,
		hideWhenSettled = false,
		hideTranscript = false,
	) {
		this.row = row;
		this.theme = theme;
		this.clock = clock;
		this.reducedMotion = reducedMotion;
		this.noColor = noColor;
		this.details = details;
		this.previewLines = [...previewLines];
		this.previewHidden = previewHidden;
		this.expanded = expanded;
		this.hideWhenSettled = hideWhenSettled;
		this.hideTranscript = hideTranscript;
	}

	render(width: number): string[] {
		if (this.hideTranscript) return [];
		if (this.hideWhenSettled && this.row.status !== "pending") return [];
		const plain = formatToolRow({
			width,
			toolName: this.row.toolName,
			target: this.row.target,
			status: this.row.status,
			phase: this.clock.currentPhase(),
			reducedMotion: this.reducedMotion,
			metadata: this.row.metadata,
			expandable: this.row.status !== "pending" || Boolean(this.details) || this.row.truncated,
			expanded: this.expanded,
		});
		const lifecycleColor = this.row.status === "error" ? "error" : this.row.status === "success" ? "success" : "accent";
		const styled = this.noColor ? plain : styleToolRow(plain, this.row.toolName, lifecycleColor, this.theme);
		// Keep lifecycle animation in a dedicated four-cell rail. The glyph and
		// tool name carry the state; no filled row or border is needed.
		const glyph = toolMotionGlyphForTool(this.row.toolName, this.row.status, this.clock.currentPhase(), this.reducedMotion);
		const rail = fixedActivityRail(glyph, this.row.status, this.theme, this.noColor);
		// Native tool renderers can emit OSC-8 hyperlinks and other terminal
		// sequences. Use Pi's width helpers here; the local gauge helpers are
		// intentionally smaller and do not understand every sequence Pi emits.
		const lines = [tuiTruncateToWidth(`${rail}${styled}`, width, "…")];
		const indent = " ".repeat(4);
		if (!this.expanded && this.previewLines.length > 0) {
			const previewColor = this.row.status === "error" ? "error" : "toolOutput";
			const previewRows = this.previewLines.length + (this.previewHidden > 0 ? 1 : 0);
			for (const previewLine of this.previewLines) {
				const preview = `${this.theme.fg("dim", "  ")}${this.theme.fg(previewColor, previewLine)}`;
				lines.push(tuiTruncateToWidth(`${indent}${preview}`, width, "…"));
			}
			if (this.previewHidden > 0) {
				const noun = this.previewHidden === 1 ? "line" : "lines";
				lines.push(tuiTruncateToWidth(`${indent}${this.theme.fg("dim", "  … ")}${this.previewHidden} more ${noun} · expand`, width, "…"));
			}
		}
		if (this.expanded && this.details) {
			for (const line of this.details.render(Math.max(1, width))) lines.push(tuiTruncateToWidth(`${indent}${line}`, width, "…"));
		}
		return lines;
	}

	invalidate(): void {
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
		startedAt: Date.now(),
		truncated: false,
		settled: false,
		previewLines: [],
		previewHidden: 0,
	};
	state.acidbathToolRow = row;
	return row;
}

/**
 * Build the one Acidbath presentation policy: compact lifecycle rows by
 * default, with Pi's native domain renderer retained as the expansion body.
 */
export function createCompactToolRenderers(
	definition: AnyToolDefinition,
	factory: (cwd: string) => AnyToolDefinition,
	options: CompactToolRendererOptions,
): Pick<AnyToolDefinition, "renderCall" | "renderResult"> {
	const { clock, reducedMotion, noColor, onLabel, onActivity, hideTranscript = false } = options;

	return {
		renderCall(args: unknown, theme: Theme, context: AnyRendererContext): Component {
			onLabel?.({
				event: "tool_call",
				toolName: definition.name,
				toolArgs: args as Record<string, unknown>,
				isPartial: context.isPartial,
				isError: context.isError,
			});
			const row = getOrCreateRow(context, definition.name, args as Record<string, unknown>);
			onActivity?.({
				event: "start",
				toolCallId: context.toolCallId,
				toolName: definition.name,
				target: row.target,
				status: "pending",
				metadata: ["running"],
			});
			// A call slot remains pending until its result slot settles. Once
			// settled, do not reinstall its invalidation callback during redraw.
			if (!row.settled) {
				row.status = context.isError ? "error" : "pending";
				row.target = targetForTool(definition.name, row.args);
				row.callInvalidate = context.invalidate;
				if (row.status === "pending") clock.subscribe(context.toolCallId, context.invalidate);
				else clock.unsubscribe(context.toolCallId);
			}
			return new ToolRowComponent(row, theme, clock, reducedMotion, noColor, undefined, [], 0, false, true, hideTranscript);
		},

		renderResult(
			result: any,
			resultOptions: AnyResultOptions,
			theme: Theme,
			context: AnyRendererContext,
		): Component {
			onLabel?.({
				event: "tool_result",
				toolName: definition.name,
				toolArgs: context.args as Record<string, unknown>,
				isPartial: resultOptions.isPartial,
				isError: context.isError,
			});
			const row = getOrCreateRow(context, definition.name, context.args as Record<string, unknown>);
			row.status = context.isError ? "error" : resultOptions.isPartial ? "pending" : "success";
			row.settled = !resultOptions.isPartial;
			row.target = targetForTool(definition.name, row.args);
			if (!resultOptions.isPartial && row.durationMs === undefined) {
				row.durationMs = Math.max(0, Date.now() - row.startedAt);
			}
			row.metadata = resultOptions.isPartial
				? ["running"]
				: metadataForTool(definition.name, row.args, result as Record<string, unknown>, row.durationMs);
			row.truncated = hasTruncation(result as Record<string, unknown>);
			const preview = previewForResult(definition.name, result);
			row.previewLines = preview.lines;
			row.previewHidden = preview.hidden;
			onActivity?.({
				event: "update",
				toolCallId: context.toolCallId,
				toolName: definition.name,
				target: row.target,
				status: row.status,
				metadata: row.metadata,
				previewLines: row.previewLines,
				previewHidden: row.previewHidden,
			});
			if (row.status === "pending") {
				clock.subscribe(context.toolCallId, context.invalidate);
			} else {
				clock.unsubscribe(context.toolCallId);
				const invalidateCall = row.callInvalidate;
				row.callInvalidate = undefined;
				if (invalidateCall) queueMicrotask(invalidateCall);
			}

			// Keep Pi's native renderer as the rich inspection surface. This is the
			// same separation used by oh-my-pi: compact status first, domain-aware
			// code/diff/tree/image output only when the user expands the row.
			const runtimeDefinition = factory(context.cwd);
			if (resultOptions.expanded && runtimeDefinition.renderResult) {
				try {
					row.nativeDetails = runtimeDefinition.renderResult(result, resultOptions, theme, {
						...context,
						// Keep Pi's reusable native component separate from Acidbath's
						// compact wrapper; passing our wrapper as lastComponent would
						// couple the two render layers.
						lastComponent: row.nativeDetails,
					});
				} catch {
					row.nativeDetails = undefined;
				}
			}
			return new ToolRowComponent(row, theme, clock, reducedMotion, noColor, row.nativeDetails, row.previewLines, row.previewHidden, resultOptions.expanded, false, hideTranscript);
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
	const value = toolName === "bash"
		? args.command
		: args.path ?? args.file_path ?? args.pattern ?? args.directory ?? args.query;
	return cleanInline(typeof value === "string" ? value : "");
}

function metadataForTool(toolName: string, args: Record<string, unknown>, result: Record<string, unknown>, durationMs: number | undefined): string[] {
	const details = isRecord(result.details) ? result.details : {};
	const metadata: string[] = [];
	const exitCode = numberValue(details.exitCode ?? result.exitCode);
	if (toolName === "bash" && exitCode !== undefined) metadata.push(`exit ${exitCode}`);
	const lines = numberValue(details.lines ?? details.lineCount ?? details.matchCount ?? details.entryCount);
	if (lines !== undefined) metadata.push(`${Math.round(lines)} ${toolName === "grep" ? "matches" : "lines"}`);
	const added = numberValue(details.added ?? details.addedLines);
	const removed = numberValue(details.removed ?? details.removedLines);
	if (added !== undefined || removed !== undefined) metadata.push(`+${Math.round(added ?? 0)} -${Math.round(removed ?? 0)}`);
	if (durationMs !== undefined && durationMs > 0) metadata.push(formatDuration(durationMs));
	if (hasTruncation(result)) metadata.push("truncated");
	if (metadata.length === 0 && toolName === "bash" && typeof args.command === "string") metadata.push("completed");
	return metadata;
}

function hasTruncation(result: Record<string, unknown>): boolean {
	const details = isRecord(result.details) ? result.details : result;
	const truncation = isRecord(details.truncation) ? details.truncation : undefined;
	return details.truncated === true || truncation?.truncated === true || truncation?.truncatedByBytes === true || truncation?.truncatedByLines === true;
}

function formatDuration(durationMs: number): string {
	return durationMs < 1000 ? `${Math.round(durationMs)}ms` : `${(durationMs / 1000).toFixed(1).replace(/\.0$/, "")}s`;
}

function numberValue(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, any> {
	return typeof value === "object" && value !== null;
}

function styleToolRow(plain: string, toolName: string, color: "accent" | "success" | "error", theme: Theme): string {
	const statusWidth = tuiVisibleWidth(plain.split(" ", 1)[0] ?? "");
	const toolStart = statusWidth + 1;
	const toolWidth = tuiVisibleWidth(toolName);
	const toolEnd = Math.min(plain.length, toolStart + toolWidth);
	return `${theme.fg(color, plain.slice(0, statusWidth))}${plain.slice(statusWidth, toolStart)}${theme.fg(color, plain.slice(toolStart, toolEnd))}${plain.slice(toolEnd)}`;
}

function fixedActivityRail(glyph: string, status: ToolMotionState, theme: Theme, noColor: boolean): string {
	const safeGlyph = tuiTruncateToWidth(glyph, 4);
	const padded = `${safeGlyph}${" ".repeat(Math.max(0, 4 - tuiVisibleWidth(safeGlyph)))}`;
	if (noColor) return padded;
	return theme.fg(status === "error" ? "error" : status === "success" ? "success" : "accent", padded);
}

function cleanInline(value: string): string {
	return value.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
}
