/** Built-in tool wrappers with a keyed, status-first presentation layer. */

import {
	createBashToolDefinition,
	createEditToolDefinition,
	createFindToolDefinition,
	createGrepToolDefinition,
	createLsToolDefinition,
	createReadToolDefinition,
	createWriteToolDefinition,
	type ExtensionAPI,
	type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { Component, Theme } from "@earendil-works/pi-tui";
import {
	MotionClock,
	nextMotionPhase,
	parseMotionPhase,
	TOOL_MOTION_INTERVAL_MS,
	TOOL_PENDING_FRAMES,
	toolMotionGlyph,
	type ToolMotionState,
} from "./ui-motion.js";
import { truncateToWidth, visibleWidth } from "./ui-gauge.js";
import { formatToolRow } from "./ui-tool-rows.js";
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
}

class ToolRowComponent implements Component {
	private readonly row: ToolRowState;
	private readonly theme: Theme;
	private readonly clock: MotionClock;
	private readonly reducedMotion: boolean;
	private readonly noColor: boolean;
	private readonly details: Component | undefined;
	private readonly expanded: boolean;
	private readonly hideWhenSettled: boolean;

	constructor(
		row: ToolRowState,
		theme: Theme,
		clock: MotionClock,
		reducedMotion: boolean,
		noColor: boolean,
		details: Component | undefined,
		expanded: boolean,
		hideWhenSettled = false,
	) {
		this.row = row;
		this.theme = theme;
		this.clock = clock;
		this.reducedMotion = reducedMotion;
		this.noColor = noColor;
		this.details = details;
		this.expanded = expanded;
		this.hideWhenSettled = hideWhenSettled;
	}

	public render(width: number): string[] {
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
		const statusWidth = visibleWidth(plain.split(" ", 1)[0] ?? "");
		const styled = this.noColor
			? plain
			: `${this.theme.fg(this.row.status === "error" ? "error" : this.row.status === "success" ? "success" : "dim", plain.slice(0, statusWidth))}${plain.slice(statusWidth)}`;
		const lines = [truncateToWidth(styled, width)];
		if (this.expanded && this.details) {
			for (const line of this.details.render(Math.max(1, width))) lines.push(truncateToWidth(line, width));
		}
		return lines;
	}

	public invalidate(): void {
		this.details?.invalidate();
	}
}

function registerWrappedTool<TParams extends ToolDefinition["parameters"], TDetails, TState>(
	pi: ExtensionAPI,
	factory: (cwd: string) => ToolDefinition<TParams, TDetails, TState>,
	clock: MotionClock,
	reducedMotion: boolean,
	noColor: boolean,
	rows: Map<string, ToolRowState>,
	onLabel: ((input: LabelInput) => void) | undefined,
): void {
	const definition = factory(process.cwd());
	pi.registerTool({
		...definition,
		async execute(toolCallId, params, signal, onUpdate, ctx) {
			// Presentation state never changes the model-visible result.
			return factory(ctx.cwd).execute(toolCallId, params, signal, onUpdate, ctx);
		},
		renderCall(args, theme, context) {
			onLabel?.({
				event: "tool_call",
				toolName: definition.name,
				toolArgs: args as Record<string, unknown>,
				isPartial: context.isPartial,
				isError: context.isError,
			});
			const row = getOrCreateRow(rows, context.toolCallId, definition.name, args as Record<string, unknown>);
			// A call slot is always pending until its result slot settles; Pi may
			// invoke renderCall with isPartial=false before execution completes.
			// Once settled, do not reinstall the invalidation callback during the
			// redraw that hides this call slot.
			if (!row.settled) {
				row.status = context.isError ? "error" : "pending";
				row.target = targetForTool(definition.name, row.args);
				row.callInvalidate = context.invalidate;
				if (row.status === "pending") clock.subscribe(context.toolCallId, context.invalidate);
				else clock.unsubscribe(context.toolCallId);
			}
			return new ToolRowComponent(row, theme, clock, reducedMotion, noColor, undefined, false, true);
		},
		renderResult(result, options, theme, context) {
			onLabel?.({
				event: "tool_result",
				toolName: definition.name,
				isPartial: options.isPartial,
				isError: context.isError,
			});
			const row = getOrCreateRow(rows, context.toolCallId, definition.name, context.args as Record<string, unknown>);
			row.status = context.isError ? "error" : options.isPartial ? "pending" : "success";
			row.settled = !options.isPartial;
			row.target = targetForTool(definition.name, row.args);
			if (!options.isPartial && row.durationMs === undefined) row.durationMs = Math.max(0, Date.now() - row.startedAt);
			row.metadata = options.isPartial
				? ["running"]
				: metadataForTool(definition.name, row.args, result as unknown as Record<string, unknown>, row.durationMs);
			row.truncated = hasTruncation(result as unknown as Record<string, unknown>);
			if (row.status === "pending") clock.subscribe(context.toolCallId, context.invalidate);
			else {
				clock.unsubscribe(context.toolCallId);
				// The call slot owns the pending row. Invalidate it after the current
				// result render; doing this synchronously re-enters Pi's renderer and
				// can create an infinite redraw loop. Clear the callback first so a
				// result rerender cannot schedule it repeatedly.
				const invalidateCall = row.callInvalidate;
				row.callInvalidate = undefined;
				if (invalidateCall) queueMicrotask(invalidateCall);
			}

			// The stock renderer is retained only as an explicitly expanded detail
			// body. Its content is never altered or fed back to the model.
			const runtimeDefinition = factory(context.cwd);
			const details = options.expanded
				? runtimeDefinition.renderResult?.(result, options, theme, { ...context, lastComponent: context.lastComponent })
				: undefined;
			return new ToolRowComponent(row, theme, clock, reducedMotion, noColor, details, options.expanded);
		},
	});
}

function getOrCreateRow(
	rows: Map<string, ToolRowState>,
	toolCallId: string,
	toolName: string,
	args: Record<string, unknown>,
): ToolRowState {
	const existing = rows.get(toolCallId);
	if (existing) {
		existing.args = args;
		return existing;
	}
	const row: ToolRowState = {
		toolCallId,
		toolName,
		args,
		status: "pending",
		target: targetForTool(toolName, args),
		metadata: ["pending"],
		startedAt: Date.now(),
		truncated: false,
		settled: false,
	};
	rows.set(toolCallId, row);
	return row;
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

function cleanInline(value: string): string {
	return value.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
}

export interface ToolMotionControls {
	dispose(): void;
	setFrozenPhase(phase: number | undefined): void;
	modeLabel(): string;
}

export function registerToolMotionRenderers(
	pi: ExtensionAPI,
	options: {
		reducedMotion: boolean;
		noColor: boolean;
		initialPhase?: string;
		clock?: MotionClock;
		onLabel?: (input: LabelInput) => void;
	},
): ToolMotionControls {
	const clock = options.clock ?? new MotionClock(options.reducedMotion, parseMotionPhase(options.initialPhase));
	const ownsClock = options.clock === undefined;
	const rows = new Map<string, ToolRowState>();

	registerWrappedTool(pi, createReadToolDefinition, clock, options.reducedMotion, options.noColor, rows, options.onLabel);
	registerWrappedTool(pi, createBashToolDefinition, clock, options.reducedMotion, options.noColor, rows, options.onLabel);
	registerWrappedTool(pi, createEditToolDefinition, clock, options.reducedMotion, options.noColor, rows, options.onLabel);
	registerWrappedTool(pi, createWriteToolDefinition, clock, options.reducedMotion, options.noColor, rows, options.onLabel);
	registerWrappedTool(pi, createGrepToolDefinition, clock, options.reducedMotion, options.noColor, rows, options.onLabel);
	registerWrappedTool(pi, createFindToolDefinition, clock, options.reducedMotion, options.noColor, rows, options.onLabel);
	registerWrappedTool(pi, createLsToolDefinition, clock, options.reducedMotion, options.noColor, rows, options.onLabel);

	return {
		dispose: () => {
			rows.clear();
			if (ownsClock) clock.dispose();
		},
		setFrozenPhase: (phase) => clock.setFrozenPhase(phase),
		modeLabel: () => clock.modeLabel(),
	};
}

export { MotionClock, nextMotionPhase, TOOL_MOTION_INTERVAL_MS, TOOL_PENDING_FRAMES };
