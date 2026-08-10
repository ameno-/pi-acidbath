/** Unified tool renderers with native Pi detail bodies in the transcript. */

import { truncateToWidth as tuiTruncateToWidth, visibleWidth as tuiVisibleWidth } from "@earendil-works/pi-tui";
import type { Component } from "@earendil-works/pi-tui";
import type {
	Theme,
	ToolDefinition,
	ToolRenderResultOptions,
} from "@earendil-works/pi-coding-agent";
type ToolMotionState = "pending" | "success" | "error";
import { formatToolRow } from "./ui-tool-rows.js";
import type { LabelInput } from "./ui-labels.js";

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
	onLabel?: (input: LabelInput) => void;
}

class ToolRowComponent implements Component {
	private readonly row: ToolRowState;
	private readonly theme: Theme;
	private readonly noColor: boolean;
	private readonly details: Component | undefined;
	private readonly previewLines: string[];
	private readonly previewHidden: number;
	private readonly expanded: boolean;
	private readonly hideWhenSettled: boolean;

	constructor(
		row: ToolRowState,
		theme: Theme,
		noColor: boolean,
		details: Component | undefined,
		previewLines: readonly string[],
		previewHidden: number,
		expanded: boolean,
		hideWhenSettled = false,
	) {
		this.row = row;
		this.theme = theme;
		this.noColor = noColor;
		this.details = details;
		this.previewLines = [...previewLines];
		this.previewHidden = previewHidden;
		this.expanded = expanded;
		this.hideWhenSettled = hideWhenSettled;
	}

	render(width: number): string[] {
		if (this.hideWhenSettled && this.row.status !== "pending") return [];
		const plain = formatToolRow({
			width,
			toolName: this.row.toolName,
			target: this.row.target,
			status: this.row.status,
			metadata: this.row.metadata,
			expandable: this.row.status !== "pending" || Boolean(this.details) || this.row.truncated,
			expanded: this.expanded,
		});
		const lifecycleColor = this.row.status === "error" ? "error" : this.row.status === "success" ? "success" : "accent";
		const styled = this.noColor ? plain : styleToolRow(plain, this.row.toolName, lifecycleColor, this.theme);
		// Native tool renderers can emit OSC-8 hyperlinks and other terminal
		// sequences. Use Pi's width helpers here; the local gauge helpers are
		// intentionally smaller and do not understand every sequence Pi emits.
		const lines = [tuiTruncateToWidth(styled, width, "…")];
		const indent = " ".repeat(4);
		if (!this.expanded && this.previewLines.length > 0) {
			const previewColor = this.row.status === "error" ? "error" : "toolOutput";
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
		truncated: false,
		settled: false,
		previewLines: [],
		previewHidden: 0,
	};
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
	const { noColor, onLabel } = options;

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
			row.metadata = resultOptions.isPartial
				? ["running"]
				: metadataForTool(definition.name, row.args, result as Record<string, unknown>);
			row.truncated = hasTruncation(result as Record<string, unknown>);
			const preview = previewForResult(definition.name, result);
			row.previewLines = preview.lines;
			row.previewHidden = preview.hidden;
			if (row.status !== "pending") {
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
	const value = toolName === "bash"
		? args.command
		: args.path ?? args.file_path ?? args.pattern ?? args.directory ?? args.query;
	return cleanInline(typeof value === "string" ? value : "");
}

function metadataForTool(toolName: string, args: Record<string, unknown>, result: Record<string, unknown>): string[] {
	const details = isRecord(result.details) ? result.details : {};
	const metadata: string[] = [];
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

function styleToolRow(plain: string, toolName: string, color: "accent" | "success" | "error", theme: Theme): string {
	const statusWidth = tuiVisibleWidth(plain.split(" ", 1)[0] ?? "");
	const toolStart = statusWidth + 1;
	const toolWidth = tuiVisibleWidth(toolName);
	const toolEnd = Math.min(plain.length, toolStart + toolWidth);
	return `${theme.fg(color, plain.slice(0, statusWidth))}${plain.slice(statusWidth, toolStart)}${theme.fg(color, plain.slice(toolStart, toolEnd))}${plain.slice(toolEnd)}`;
}

function cleanInline(value: string): string {
	return value.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
}
