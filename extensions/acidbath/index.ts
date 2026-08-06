/**
 * acidbath
 *
 * Features:
 * 1) Semantic working indicator (orb) with event-driven states.
 * 2) Context-usage gauge rendered into the editor bottom border.
 * 3) Compact tool lifecycle motion for built-in tools.
 */

import {
	CustomEditor,
	type EditorTheme,
	type ExtensionAPI,
	type ExtensionContext,
	type KeybindingsManager,
	type TUI,
	type WorkingIndicatorOptions,
} from "@earendil-works/pi-coding-agent";
import {
	advanceToward,
	buildGaugeLine,
	clamp01,
	findEditorBottomBorderIndex,
} from "./ui-gauge.js";
import { parseMotionPhase } from "./ui-motion.js";
import {
	indicatorFor,
	isOrbState,
	ORB_LABELS,
	ORB_STATES,
	stateForTool,
	type OrbMode,
	type OrbState,
} from "./ui-orb.js";
import { registerToolMotionRenderers } from "./ui-tools.js";

interface WorkingUi {
	setWorkingIndicator?: (options?: WorkingIndicatorOptions) => void;
	setWorkingMessage?: (message?: string) => void;
	notify: (message: string, type?: "info" | "warning" | "error") => void;
}

const REDUCED_MOTION = process.env.PI_ACIDBATH_REDUCED_MOTION === "1";
const INITIAL_MOTION_PHASE = process.env.PI_ACIDBATH_MOTION_PHASE;
const COLOR_ENABLED = process.env.NO_COLOR === undefined;

const GAUGE_TICK_MS = 80;
const GAUGE_STEP_PER_TICK = 0.16;
const GAUGE_POLL_MS = 1_000;

function workingUi(ctx: ExtensionContext): WorkingUi {
	return ctx.ui as unknown as WorkingUi;
}

class ContextGaugeEditor extends CustomEditor {
	private gaugeTimer: ReturnType<typeof setInterval> | undefined;
	private gaugeTargetPercent: number | undefined;
	private gaugeRenderedPercent: number | undefined;
	private gaugeLastTarget = Number.NaN;

	constructor(tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager) {
		super(tui, theme, keybindings, { paddingX: 0 });
	}

	public updateTarget(percent: number | undefined, reducedMotion: boolean): void {
		if (percent === undefined) {
			const changed = this.gaugeRenderedPercent !== undefined;
			this.dispose();
			this.gaugeTargetPercent = undefined;
			this.gaugeRenderedPercent = undefined;
			this.gaugeLastTarget = Number.NaN;
			if (changed) this.tui.requestRender();
			return;
		}
		const clamped = clamp01(percent);
		this.gaugeTargetPercent = clamped;
		const alreadySettled = clamped === this.gaugeLastTarget && this.gaugeTimer === undefined;
		if (alreadySettled) return;
		this.gaugeLastTarget = clamped;

		if (reducedMotion) {
			this.gaugeRenderedPercent = clamped;
			this.tui.requestRender();
			return;
		}

		if (this.gaugeRenderedPercent === undefined) {
			this.gaugeRenderedPercent = clamped;
			this.tui.requestRender();
			return;
		}
		if (clamped === this.gaugeRenderedPercent) {
			this.tui.requestRender();
			return;
		}
		if (this.gaugeTimer === undefined) {
			this.gaugeTimer = setInterval(() => this.tickAnimation(), GAUGE_TICK_MS);
		}
		this.tui.requestRender();
	}

	public dispose(): void {
		if (this.gaugeTimer !== undefined) {
			clearInterval(this.gaugeTimer);
			this.gaugeTimer = undefined;
		}
	}

	private tickAnimation(): void {
		if (this.gaugeRenderedPercent === undefined || this.gaugeTargetPercent === undefined) {
			this.dispose();
			return;
		}
		if (this.gaugeRenderedPercent === this.gaugeTargetPercent) {
			this.dispose();
			return;
		}
		this.gaugeRenderedPercent = advanceToward(
			this.gaugeRenderedPercent,
			this.gaugeTargetPercent,
			GAUGE_STEP_PER_TICK,
		);
		this.tui.requestRender();
	}

	override render(width: number): string[] {
		const lines = super.render(width);
		if (lines.length === 0) return lines;
		lines.shift();
		if (lines.length === 0) return lines;
		if (this.gaugeRenderedPercent === undefined) return lines;

		const bottomBorderIndex = findEditorBottomBorderIndex(lines, width);
		if (bottomBorderIndex === -1) return lines;
		const gaugeLine = buildGaugeLine({
			width,
			percent: this.gaugeRenderedPercent,
			noColor: !COLOR_ENABLED,
		});
		if (gaugeLine.rendered) {
			lines[bottomBorderIndex] = gaugeLine.line;
		}
		return lines;
	}
}

export default function acidbath(pi: ExtensionAPI): void {
	const toolMotion = registerToolMotionRenderers(pi, {
		reducedMotion: REDUCED_MOTION,
		noColor: !COLOR_ENABLED,
		initialPhase: INITIAL_MOTION_PHASE,
	});
	let mode: OrbMode = "auto";
	let automaticState: OrbState = "working";
	let compatibilityWarningShown = false;
	let gaugeEditor: ContextGaugeEditor | undefined;
	let gaugePollTimer: ReturnType<typeof setInterval> | undefined;

	const apply = (ctx: ExtensionContext): void => {
		const ui = workingUi(ctx);
		if (typeof ui.setWorkingIndicator !== "function") {
			if (!compatibilityWarningShown) {
				ui.notify("This Pi build does not support working-indicator extensions.", "warning");
				compatibilityWarningShown = true;
			}
			return;
		}

		if (mode === "off") {
			ui.setWorkingIndicator({ frames: [] });
			ui.setWorkingMessage?.();
			return;
		}

		if (mode === "default") {
			ui.setWorkingIndicator();
			ui.setWorkingMessage?.();
			return;
		}

		const state = mode === "auto" ? automaticState : mode;
		ui.setWorkingIndicator(indicatorFor(state, REDUCED_MOTION, COLOR_ENABLED));
		ui.setWorkingMessage?.(`${ORB_LABELS[state]}…`);
	};

	const transition = (state: OrbState, ctx: ExtensionContext): void => {
		if (automaticState === state) return;
		automaticState = state;
		if (mode === "auto") apply(ctx);
	};

	const pushContextUsage = (ctx: ExtensionContext): void => {
		const editor = gaugeEditor;
		if (!editor) return;
		const usage = ctx.getContextUsage();
		const percent = usage && usage.percent !== null ? usage.percent / 100 : undefined;
		editor.updateTarget(percent, REDUCED_MOTION);
	};

	const stopGauge = (): void => {
		if (gaugePollTimer !== undefined) {
			clearInterval(gaugePollTimer);
			gaugePollTimer = undefined;
		}
		if (gaugeEditor !== undefined) {
			gaugeEditor.dispose();
			gaugeEditor = undefined;
		}
	};

	pi.on("session_start", async (_event, ctx) => {
		apply(ctx);
		if (ctx.mode !== "tui") return;
		ctx.ui.setHiddenThinkingLabel("Reasoning…");
		ctx.ui.setEditorComponent((tui, theme, kb) => {
			gaugeEditor?.dispose();
			const editor = new ContextGaugeEditor(tui, theme, kb);
			gaugeEditor = editor;
			pushContextUsage(ctx);
			return editor;
		});
		gaugePollTimer = setInterval(() => pushContextUsage(ctx), GAUGE_POLL_MS);
	});

	pi.on("agent_start", async (_event, ctx) => transition("solving", ctx));
	pi.on("before_provider_request", async (_event, ctx) => {
		transition("listening", ctx);
		pushContextUsage(ctx);
	});
	pi.on("after_provider_response", async (_event, ctx) => {
		transition("solving", ctx);
		pushContextUsage(ctx);
	});
	pi.on("message_update", async (_event, ctx) => {
		transition("composing", ctx);
		pushContextUsage(ctx);
	});
	pi.on("tool_call", async (event, ctx) => {
		transition(stateForTool(event.toolName), ctx);
		pushContextUsage(ctx);
	});
	pi.on("tool_result", async (_event, ctx) => {
		transition("solving", ctx);
		pushContextUsage(ctx);
	});

	pi.on("agent_end", async (_event, ctx) => {
		automaticState = "working";
		workingUi(ctx).setWorkingMessage?.();
		apply(ctx);
		pushContextUsage(ctx);
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		const ui = workingUi(ctx);
		ui.setWorkingIndicator?.();
		ui.setWorkingMessage?.();
		stopGauge();
		toolMotion.dispose();
		ctx.ui.setHiddenThinkingLabel();
		ctx.ui.setEditorComponent(undefined);
	});

	pi.registerCommand("orb", {
		description: "Set working orb: auto, a named state, off, or default.",
		handler: async (args, ctx) => {
			const nextMode = args.trim().toLowerCase();
			if (!nextMode) {
				workingUi(ctx).notify(`Working orb: ${mode === "auto" ? automaticState : mode}`, "info");
				return;
			}

			if (nextMode !== "auto" && nextMode !== "off" && nextMode !== "default" && !isOrbState(nextMode)) {
				workingUi(ctx).notify(`Usage: /orb [auto|${ORB_STATES.join("|")}|off|default]`, "error");
				return;
			}

			mode = nextMode;
			apply(ctx);
			workingUi(ctx).notify(`Working orb set to: ${mode}`, "info");
		},
	});

	pi.registerCommand("motion", {
		description: "Set deterministic tool motion: live or fixed frame (0-3).",
		handler: async (args, ctx) => {
			const value = args.trim().toLowerCase();
			if (!value) {
				workingUi(ctx).notify(`Tool motion: ${toolMotion.modeLabel()}`, "info");
				return;
			}
			if (value === "live") {
				toolMotion.setFrozenPhase(undefined);
				workingUi(ctx).notify(`Tool motion: ${toolMotion.modeLabel()}`, "info");
				return;
			}
			const phase = parseMotionPhase(value);
			if (phase === undefined) {
				workingUi(ctx).notify("Usage: /motion [live|0|1|2|3]", "error");
				return;
			}
			toolMotion.setFrozenPhase(phase);
			workingUi(ctx).notify(`Tool motion: ${toolMotion.modeLabel()}`, "info");
		},
	});
}
