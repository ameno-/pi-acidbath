/**
 * Wrappers for Pi's built-in tools that add compact lifecycle glyphs.
 */

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
	nextMotionPhase,
	parseMotionPhase,
	TOOL_MOTION_INTERVAL_MS,
	TOOL_PENDING_FRAMES,
	toolMotionGlyph,
	type ToolMotionState,
} from "./ui-motion.js";

type Invalidate = () => void;

interface RendererSlots {
	call?: Component;
	result?: Component;
}

class MotionClock {
	private readonly subscribers = new Map<string, Invalidate>();
	private readonly reducedMotion: boolean;
	private timer: ReturnType<typeof setInterval> | undefined;
	private phase = 0;
	private frozenPhase: number | undefined;

	constructor(reducedMotion: boolean, initialFrozenPhase: number | undefined) {
		this.reducedMotion = reducedMotion;
		this.frozenPhase = initialFrozenPhase;
		if (initialFrozenPhase !== undefined) this.phase = initialFrozenPhase;
	}

	public currentPhase(): number {
		return this.frozenPhase ?? this.phase;
	}

	public subscribe(id: string, invalidate: Invalidate): void {
		this.subscribers.set(id, invalidate);
		this.syncTimer();
	}

	public unsubscribe(id: string): void {
		this.subscribers.delete(id);
		this.syncTimer();
	}

	public setFrozenPhase(phase: number | undefined): void {
		this.frozenPhase = phase;
		if (phase !== undefined) this.phase = phase;
		this.syncTimer();
		this.invalidateAll();
	}

	public modeLabel(): string {
		if (this.reducedMotion) return "reduced";
		return this.frozenPhase === undefined ? "live" : `frame ${this.frozenPhase}`;
	}

	public dispose(): void {
		if (this.timer !== undefined) clearInterval(this.timer);
		this.timer = undefined;
		this.subscribers.clear();
	}

	private syncTimer(): void {
		const shouldRun = !this.reducedMotion && this.frozenPhase === undefined && this.subscribers.size > 0;
		if (shouldRun && this.timer === undefined) {
			this.timer = setInterval(() => {
				this.phase = nextMotionPhase(this.phase, TOOL_PENDING_FRAMES.length);
				this.invalidateAll();
			}, TOOL_MOTION_INTERVAL_MS);
		} else if (!shouldRun && this.timer !== undefined) {
			clearInterval(this.timer);
			this.timer = undefined;
		}
	}

	private invalidateAll(): void {
		for (const invalidate of this.subscribers.values()) invalidate();
	}
}

class ToolLifecycleComponent implements Component {
	private readonly child: Component;
	private readonly state: ToolMotionState;
	private readonly theme: Theme;
	private readonly clock: MotionClock;
	private readonly reducedMotion: boolean;
	private readonly noColor: boolean;

	constructor(
		child: Component,
		state: ToolMotionState,
		theme: Theme,
		clock: MotionClock,
		reducedMotion: boolean,
		noColor: boolean,
	) {
		this.child = child;
		this.state = state;
		this.theme = theme;
		this.clock = clock;
		this.reducedMotion = reducedMotion;
		this.noColor = noColor;
	}

	public render(width: number): string[] {
		const glyph = toolMotionGlyph(this.state, this.clock.currentPhase(), this.reducedMotion);
		const status = this.noColor
			? glyph
			: this.state === "success"
				? this.theme.fg("success", glyph)
				: this.state === "error"
					? this.theme.fg("error", glyph)
					: this.theme.fg("dim", glyph);
		const childLines = this.child.render(Math.max(1, width - 2));
		if (childLines.length === 0) return [status];
		return [`${status} ${childLines[0]}`, ...childLines.slice(1).map((line) => `  ${line}`)];
	}

	public invalidate(): void {
		this.child.invalidate();
	}
}

function registerWrappedTool<TParams extends ToolDefinition["parameters"], TDetails, TState>(
	pi: ExtensionAPI,
	factory: (cwd: string) => ToolDefinition<TParams, TDetails, TState>,
	clock: MotionClock,
	reducedMotion: boolean,
	noColor: boolean,
	slots: Map<string, RendererSlots>,
): void {
	const definition = factory(process.cwd());
	pi.registerTool({
		...definition,
		async execute(toolCallId, params, signal, onUpdate, ctx) {
			return factory(ctx.cwd).execute(toolCallId, params, signal, onUpdate, ctx);
		},
		renderCall(args, theme, context) {
			const rowSlots = slots.get(context.toolCallId) ?? {};
			const runtimeDefinition = factory(context.cwd);
			const base = runtimeDefinition.renderCall?.(args, theme, {
				...context,
				lastComponent: rowSlots.call,
			});
			if (!base) throw new Error(`Missing built-in call renderer for ${definition.name}`);
			rowSlots.call = base;
			slots.set(context.toolCallId, rowSlots);

			const state: ToolMotionState = context.isError ? "error" : context.isPartial ? "pending" : "success";
			if (state === "pending") clock.subscribe(context.toolCallId, context.invalidate);
			else clock.unsubscribe(context.toolCallId);
			return new ToolLifecycleComponent(base, state, theme, clock, reducedMotion, noColor);
		},
		renderResult(result, options, theme, context) {
			const rowSlots = slots.get(context.toolCallId) ?? {};
			const runtimeDefinition = factory(context.cwd);
			const base = runtimeDefinition.renderResult?.(result, options, theme, {
				...context,
				lastComponent: rowSlots.result,
			});
			if (!base) throw new Error(`Missing built-in result renderer for ${definition.name}`);
			rowSlots.result = base;
			slots.set(context.toolCallId, rowSlots);
			if (!options.isPartial) {
				clock.unsubscribe(context.toolCallId);
				slots.delete(context.toolCallId);
			}
			return base;
		},
	});
}

export interface ToolMotionControls {
	dispose(): void;
	setFrozenPhase(phase: number | undefined): void;
	modeLabel(): string;
}

export function registerToolMotionRenderers(
	pi: ExtensionAPI,
	options: { reducedMotion: boolean; noColor: boolean; initialPhase?: string },
): ToolMotionControls {
	const clock = new MotionClock(options.reducedMotion, parseMotionPhase(options.initialPhase));
	const slots = new Map<string, RendererSlots>();

	registerWrappedTool(pi, createReadToolDefinition, clock, options.reducedMotion, options.noColor, slots);
	registerWrappedTool(pi, createBashToolDefinition, clock, options.reducedMotion, options.noColor, slots);
	registerWrappedTool(pi, createEditToolDefinition, clock, options.reducedMotion, options.noColor, slots);
	registerWrappedTool(pi, createWriteToolDefinition, clock, options.reducedMotion, options.noColor, slots);
	registerWrappedTool(pi, createGrepToolDefinition, clock, options.reducedMotion, options.noColor, slots);
	registerWrappedTool(pi, createFindToolDefinition, clock, options.reducedMotion, options.noColor, slots);
	registerWrappedTool(pi, createLsToolDefinition, clock, options.reducedMotion, options.noColor, slots);

	return {
		dispose: () => {
			clock.dispose();
			slots.clear();
		},
		setFrozenPhase: (phase) => clock.setFrozenPhase(phase),
		modeLabel: () => clock.modeLabel(),
	};
}
