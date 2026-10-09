/** Unified tool renderers with compact summaries and lazy native detail bodies. */

import { truncateToWidth as tuiTruncateToWidth } from "@earendil-works/pi-tui";
import type { Component } from "@earendil-works/pi-tui";
import type {
	Theme,
	ToolDefinition,
	ToolRenderResultOptions,
} from "@earendil-works/pi-coding-agent";
import { formatToolRow } from "./ui-tool-rows.js";
import { summarizeToolOutput, targetForTool, type ToolOutputSummary } from "./ui-tool-output.js";
import { subscribe } from "./rendering/motion.js";

type ToolMotionState = "pending" | "success" | "error";

interface SummaryCache {
	inputs: unknown[];
	isPartial: boolean;
	isError: boolean;
	durationMs: number | undefined;
	value: ToolOutputSummary;
}

interface ToolRowState {
	toolCallId: string;
	toolName: string;
	args: Record<string, unknown>;
	status: ToolMotionState;
	target: string;
	metadata: string[];
	truncated: boolean;
	settled: boolean;
	hasResult: boolean;
	hasDetails: boolean;
	errorLine?: string;
	startedAt?: number;
	endedAt?: number;
	callComponent?: ToolRowComponent;
	nativeDetails?: Component;
	nativeState: Record<string, unknown>;
	summaryCache?: SummaryCache;
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
	private readonly slot: "call" | "result";
	private details: Component | undefined;
	private expanded = false;
	private hidden = false;
	private cachedWidth: number | undefined;
	private cachedLines: string[] | undefined;

	constructor(row: ToolRowState, theme: Theme, noColor: boolean, slot: "call" | "result") {
		this.row = row;
		this.theme = theme;
		this.noColor = noColor;
		this.slot = slot;
	}

	isSlot(slot: "call" | "result"): boolean {
		return this.slot === slot;
	}

	update(options: { details?: Component; expanded?: boolean; hidden?: boolean } = {}): void {
		const nextExpanded = options.expanded ?? false;
		const nextHidden = options.hidden ?? false;
		if (this.details === options.details && this.expanded === nextExpanded && this.hidden === nextHidden) return;
		this.details = options.details;
		this.expanded = nextExpanded;
		this.hidden = nextHidden;
		this.clearCache();
	}

	setHidden(hidden: boolean): void {
		if (this.hidden === hidden) return;
		this.hidden = hidden;
		this.clearCache();
	}

	refresh(): void {
		this.clearCache();
	}

	render(width: number): string[] {
		if (this.hidden) return [];
		const safeWidth = Math.max(1, Math.trunc(width));
		if (this.cachedLines && this.cachedWidth === safeWidth) return this.cachedLines;

		const status = this.noColor ? "" : statusMark(this.row.status);
		const plain = formatToolRow({
			width: safeWidth,
			statusGlyph: status,
			toolGlyph: "",
			toolName: this.row.toolName,
			target: this.row.target,
			status: this.row.status,
			metadata: this.row.metadata,
			expandable: this.row.hasDetails || this.row.truncated,
			expanded: this.expanded,
		});

		const lifecycleColor = this.row.status === "error" ? "error" : this.row.status === "success" ? "success" : "accent";
		const styled = !this.noColor && status && plain.startsWith(`${status} `)
			? `${this.theme.fg(lifecycleColor, status)}${plain.slice(status.length)}`
			: plain;

		const lines = [tuiTruncateToWidth(styled, safeWidth, "…")];
		const indent = "  ";
		if (!this.expanded && this.row.status === "error" && this.row.errorLine) {
			const diagnostic = `${indent}${this.noColor ? "error: " : this.theme.fg("error", "error: ")}${this.noColor ? this.row.errorLine : this.theme.fg("toolOutput", this.row.errorLine)}`;
			lines.push(tuiTruncateToWidth(diagnostic, safeWidth, "…"));
		}
		if (this.expanded && this.details) {
			const detailWidth = Math.max(1, safeWidth - indent.length);
			for (const line of this.details.render(detailWidth)) {
				lines.push(tuiTruncateToWidth(`${indent}${line}`, safeWidth, "…"));
			}
		}

		this.cachedWidth = safeWidth;
		this.cachedLines = lines;
		return lines;
	}

	invalidate(): void {
		this.clearCache();
		this.details?.invalidate();
	}

	private clearCache(): void {
		this.cachedWidth = undefined;
		this.cachedLines = undefined;
	}
}

/** One mark for every tool. Faces stay out of the transcript. */
function statusMark(status: ToolMotionState): string {
	if (status === "success") return "·";
	if (status === "error") return "×";
	return "◦";
}

function rendererState(context: AnyRendererContext): AcidbathRendererState {
	if (context.state && typeof context.state === "object") return context.state as AcidbathRendererState;
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
		hasResult: false,
		hasDetails: false,
		nativeState: {},
	};
	state.acidbathToolRow = row;
	return row;
}

function ensureMotion(row: ToolRowState, context: AnyRendererContext, animate: boolean): void {
	// Keep the shared clock subscribed while a call is live so settlement
	// still releases it. The row itself no longer animates a face.
	if (!animate || !context.executionStarted || row.hasResult || row.unsubscribe) return;
	row.unsubscribe = subscribe(context.toolCallId, () => undefined);
}

function reusableComponent(
	context: AnyRendererContext,
	row: ToolRowState,
	theme: Theme,
	noColor: boolean,
	slot: "call" | "result",
): ToolRowComponent {
	const previous = context.lastComponent;
	return previous instanceof ToolRowComponent && previous.isSlot(slot)
		? previous
		: new ToolRowComponent(row, theme, noColor, slot);
}

/**
 * Build one stable summary row per call. Collapsed results never parse or
 * render raw output; Pi's domain renderer is created lazily on expansion.
 */
export function createCompactToolRenderers(
	definition: AnyToolDefinition,
	factory: (cwd: string) => AnyToolDefinition,
	options: CompactToolRendererOptions,
): Pick<AnyToolDefinition, "renderCall" | "renderResult"> {
	const { noColor, reducedMotion } = options;
	const animate = !noColor && !reducedMotion;
	const definitionsByCwd = new Map<string, AnyToolDefinition>();

	const nativeDefinition = (cwd: string): AnyToolDefinition => {
		const cached = definitionsByCwd.get(cwd);
		if (cached) return cached;
		const created = factory(cwd);
		definitionsByCwd.set(cwd, created);
		return created;
	};

	return {
		renderCall(args: unknown, theme: Theme, context: AnyRendererContext): Component {
			const row = getOrCreateRow(context, definition.name, args as Record<string, unknown>);
			if (context.executionStarted && row.startedAt === undefined) row.startedAt = Date.now();
			ensureMotion(row, context, animate);
			if (!row.hasResult) {
				row.status = context.isError ? "error" : "pending";
				row.target = targetForTool(definition.name, row.args);
			}
			const component = reusableComponent(context, row, theme, noColor, "call");
			component.update({ hidden: row.hasResult });
			component.refresh();
			row.callComponent = component;
			return component;
		},

		renderResult(
			result: any,
			resultOptions: AnyResultOptions,
			theme: Theme,
			context: AnyRendererContext,
		): Component {
			const row = getOrCreateRow(context, definition.name, context.args as Record<string, unknown>);
			row.hasResult = true;
			row.callComponent?.setHidden(true);
			row.status = context.isError ? "error" : resultOptions.isPartial ? "pending" : "success";
			row.settled = !resultOptions.isPartial;
			row.target = targetForTool(definition.name, row.args);
			if (row.settled && row.endedAt === undefined) row.endedAt = Date.now();

			const durationMs = row.startedAt !== undefined && row.endedAt !== undefined
				? Math.max(0, row.endedAt - row.startedAt)
				: undefined;
			const summary = summarizeCached(row, result as Record<string, unknown>, {
				isPartial: resultOptions.isPartial,
				isError: context.isError,
				durationMs,
			});
			row.metadata = summary.metadata;
			row.hasDetails = summary.hasDetails;
			row.errorLine = summary.errorLine;
			row.truncated = summary.metadata.includes("truncated");

			if (row.settled && row.unsubscribe) {
				row.unsubscribe();
				row.unsubscribe = undefined;
			}

			if (resultOptions.expanded && row.settled) {
				const runtime = nativeDefinition(context.cwd);
				try {
					if (definition.name === "write" && !context.isError && runtime.renderCall) {
						row.nativeDetails = runtime.renderCall(context.args, theme, {
							...context,
							lastComponent: row.nativeDetails,
							state: row.nativeState,
						});
					} else if (runtime.renderResult) {
						row.nativeDetails = runtime.renderResult(result, resultOptions, theme, {
							...context,
							lastComponent: row.nativeDetails,
							state: row.nativeState,
						});
					}
				} catch {
					row.nativeDetails = undefined;
				}
			}

			const component = reusableComponent(context, row, theme, noColor, "result");
			component.update({
				details: resultOptions.expanded ? row.nativeDetails : undefined,
				expanded: resultOptions.expanded,
			});
			component.refresh();
			return component;
		},
	};
}

function summarizeCached(
	row: ToolRowState,
	result: Record<string, unknown>,
	options: { isPartial: boolean; isError: boolean; durationMs?: number },
): ToolOutputSummary {
	if (options.isPartial) return summarizeToolOutput(row.toolName, row.args, result, options);
	const inputs = summaryInputs(row.args, result);
	const cached = row.summaryCache;
	if (
		cached
		&& sameInputs(cached.inputs, inputs)
		&& cached.isPartial === options.isPartial
		&& cached.isError === options.isError
		&& cached.durationMs === options.durationMs
	) return cached.value;

	const value = summarizeToolOutput(row.toolName, row.args, result, options);
	row.summaryCache = {
		inputs,
		isPartial: options.isPartial,
		isError: options.isError,
		durationMs: options.durationMs,
		value,
	};
	return value;
}

function summaryInputs(args: Record<string, unknown>, result: Record<string, unknown>): unknown[] {
	const inputs: unknown[] = [args.path, args.file_path, args.content];
	if (Array.isArray(result.content)) {
		for (const part of result.content) {
			if (part && typeof part === "object") {
				const record = part as Record<string, unknown>;
				inputs.push(record.type, record.text);
			}
		}
	}
	const details = result.details && typeof result.details === "object"
		? result.details as Record<string, unknown>
		: {};
	const truncation = details.truncation && typeof details.truncation === "object"
		? details.truncation as Record<string, unknown>
		: {};
	inputs.push(
		Object.keys(details).sort().join(","),
		details.matchCount,
		details.matchLimitReached,
		details.resultCount,
		details.resultLimitReached,
		details.entryCount,
		details.entryLimitReached,
		details.linesTruncated,
		details.added,
		details.addedLines,
		details.removed,
		details.removedLines,
		details.diff,
		truncation.truncated,
		truncation.outputLines,
		truncation.totalLines,
		truncation.truncatedBy,
	);
	return inputs;
}

function sameInputs(left: readonly unknown[], right: readonly unknown[]): boolean {
	return left.length === right.length && left.every((value, index) => Object.is(value, right[index]));
}
