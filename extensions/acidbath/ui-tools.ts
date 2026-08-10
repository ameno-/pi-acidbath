/** Built-in tool execution wrappers with one native, expanded transcript policy. */

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
import {
	MotionClock,
	parseMotionPhase,
	TOOL_MOTION_INTERVAL_MS,
	TOOL_PENDING_FRAMES,
	type ToolMotionState,
	toolMotionGlyph,
	toolMotionGlyphForTool,
	toolMotionStyle,
} from "./ui-motion.js";
import { createCompactToolRenderers } from "./ui-tool-renderers.js";
import type { LabelInput } from "./ui-labels.js";

function registerWrappedTool<TParams extends ToolDefinition["parameters"], TDetails, TState>(
	pi: ExtensionAPI,
	factory: (cwd: string) => ToolDefinition<TParams, TDetails, TState>,
	clock: MotionClock,
	reducedMotion: boolean,
	noColor: boolean,
	onLabel: ((input: LabelInput) => void) | undefined,
): void {
	const definition = factory(process.cwd());
	const presentation = createCompactToolRenderers(definition, factory, {
		clock,
		reducedMotion,
		noColor,
		onLabel,
	});
	pi.registerTool({
		...definition,
		...presentation,
		async execute(toolCallId, params, signal, onUpdate, ctx) {
			// Presentation state never changes the model-visible result.
			return factory(ctx.cwd).execute(toolCallId, params, signal, onUpdate, ctx);
		},
	});
}

export interface ToolMotionControls {
	dispose(): void;
	setFrozenPhase(phase: number | undefined): void;
	modeLabel(): string;
}

/**
 * Install the single Acidbath tool presentation policy: one lifecycle row per
 * call, with native Pi result details expanded by the host's default policy.
 */
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

	registerWrappedTool(pi, createReadToolDefinition, clock, options.reducedMotion, options.noColor, options.onLabel);
	registerWrappedTool(pi, createBashToolDefinition, clock, options.reducedMotion, options.noColor, options.onLabel);
	registerWrappedTool(pi, createEditToolDefinition, clock, options.reducedMotion, options.noColor, options.onLabel);
	registerWrappedTool(pi, createWriteToolDefinition, clock, options.reducedMotion, options.noColor, options.onLabel);
	registerWrappedTool(pi, createGrepToolDefinition, clock, options.reducedMotion, options.noColor, options.onLabel);
	registerWrappedTool(pi, createFindToolDefinition, clock, options.reducedMotion, options.noColor, options.onLabel);
	registerWrappedTool(pi, createLsToolDefinition, clock, options.reducedMotion, options.noColor, options.onLabel);

	return {
		dispose: () => {
			if (ownsClock) clock.dispose();
		},
		setFrozenPhase: (phase) => clock.setFrozenPhase(phase),
		modeLabel: () => clock.modeLabel(),
	};
}

export { MotionClock, parseMotionPhase, TOOL_MOTION_INTERVAL_MS, TOOL_PENDING_FRAMES, toolMotionGlyph, toolMotionGlyphForTool, toolMotionStyle };
export type { ToolMotionState };
