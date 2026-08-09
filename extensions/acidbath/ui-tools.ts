/** Built-in tool execution wrappers with a compact-first presentation policy. */

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
import type { ToolActivityUpdate } from "./ui-tool-activity.js";
import type { LabelInput } from "./ui-labels.js";

function registerWrappedTool<TParams extends ToolDefinition["parameters"], TDetails, TState>(
	pi: ExtensionAPI,
	factory: (cwd: string) => ToolDefinition<TParams, TDetails, TState>,
	clock: MotionClock,
	reducedMotion: boolean,
	noColor: boolean,
	onLabel: ((input: LabelInput) => void) | undefined,
	onActivity: ((update: ToolActivityUpdate) => void) | undefined,
	hideTranscript: boolean,
): void {
	const definition = factory(process.cwd());
	const presentation = createCompactToolRenderers(definition, factory, {
		clock,
		reducedMotion,
		noColor,
		onLabel,
		onActivity,
		hideTranscript,
	});

	const renderShell = hideTranscript ? "self" as const : definition.renderShell;

	pi.registerTool({
		...definition,
		renderShell,
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
 * Install the single Acidbath tool presentation policy: compact lifecycle rows
 * by default, native Pi renderer details when expanded.
 */
export function registerToolMotionRenderers(
	pi: ExtensionAPI,
	options: {
		reducedMotion: boolean;
		noColor: boolean;
		initialPhase?: string;
		clock?: MotionClock;
		onLabel?: (input: LabelInput) => void;
		onActivity?: (update: ToolActivityUpdate) => void;
		hideTranscript?: boolean;
	},
): ToolMotionControls {
	const clock = options.clock ?? new MotionClock(options.reducedMotion, parseMotionPhase(options.initialPhase));
	const ownsClock = options.clock === undefined;

	registerWrappedTool(pi, createReadToolDefinition, clock, options.reducedMotion, options.noColor, options.onLabel, options.onActivity, options.hideTranscript ?? false);
	registerWrappedTool(pi, createBashToolDefinition, clock, options.reducedMotion, options.noColor, options.onLabel, options.onActivity, options.hideTranscript ?? false);
	registerWrappedTool(pi, createEditToolDefinition, clock, options.reducedMotion, options.noColor, options.onLabel, options.onActivity, options.hideTranscript ?? false);
	registerWrappedTool(pi, createWriteToolDefinition, clock, options.reducedMotion, options.noColor, options.onLabel, options.onActivity, options.hideTranscript ?? false);
	registerWrappedTool(pi, createGrepToolDefinition, clock, options.reducedMotion, options.noColor, options.onLabel, options.onActivity, options.hideTranscript ?? false);
	registerWrappedTool(pi, createFindToolDefinition, clock, options.reducedMotion, options.noColor, options.onLabel, options.onActivity, options.hideTranscript ?? false);
	registerWrappedTool(pi, createLsToolDefinition, clock, options.reducedMotion, options.noColor, options.onLabel, options.onActivity, options.hideTranscript ?? false);

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
