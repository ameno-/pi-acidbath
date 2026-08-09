/**
 * acidbath
 *
 * Features:
 * 1) Semantic working indicator (orb) with event-driven states.
 * 2) Context display in a consolidated footer, with optional pyramid placement.
 * 3) Compact tool lifecycle motion for built-in tools.
 */

import {
	CustomEditor,
	getAgentDir,
	type ExtensionAPI,
	type ExtensionContext,
	type KeybindingsManager,
	type WorkingIndicatorOptions,
} from "@earendil-works/pi-coding-agent";
import type { EditorTheme, TUI } from "@earendil-works/pi-tui";
import { ContextPyramidWidget, parseContextPlacement, type ContextPlacement } from "./ui-context-widget.js";
import { AcidbathFooter } from "./ui-footer.js";
import { findEditorBottomBorderIndex } from "./ui-gauge.js";
import { AcidbathHeader } from "./ui-header.js";
import { DEFAULT_SESSION_SUMMARY, summarizeTask } from "./ui-summary.js";
import { MotionClock, parseMotionPhase } from "./ui-motion.js";
import {
	indicatorFor,
	isOrbState,
	ORB_LABELS,
	ORB_STATES,
	type OrbMode,
	type OrbState,
} from "./ui-orb.js";
import { registerToolMotionRenderers } from "./ui-tools.js";
import { activityPreview, activityTarget, ToolActivityStore, ToolActivityTranscript } from "./ui-tool-activity.js";
import { synthesizeLabel, type LabelInput, type LabelOutput } from "./ui-labels.js";
import {
	createTokenContextState,
	reduceTokenContext,
	type TokenContextEvent,
	type TokenContextState,
	type UsageFacts,
} from "./ui-token-context.js";
import { truncateToWidth } from "./ui-gauge.js";
import {
	AcidbathWelcome,
	discoverSkillNames,
	initialWelcomeState,
	WELCOME_WIDGET_KEY,
	type PreflightStatus,
} from "./ui-welcome.js";

interface WorkingUi {
	setWorkingIndicator?: (options?: WorkingIndicatorOptions) => void;
	setWorkingMessage?: (message?: string) => void;
	setWorkingVisible?: (visible: boolean) => void;
	notify: (message: string, type?: "info" | "warning" | "error") => void;
}

const REDUCED_MOTION = process.env.PI_ACIDBATH_REDUCED_MOTION === "1";
const INITIAL_MOTION_PHASE = process.env.PI_ACIDBATH_MOTION_PHASE;
const COLOR_ENABLED = process.env.NO_COLOR === undefined;

const CONTEXT_POLL_MS = 1_000;
const LABEL_DEBOUNCE_MS = 100;
const CONTEXT_WIDGET_KEY = "acidbath-context";
const TOOL_ACTIVITY_ENTRY_TYPE = "acidbath-tool-activity";

function workingUi(ctx: ExtensionContext): WorkingUi {
	return ctx.ui as unknown as WorkingUi;
}

const INPUT_PROMPT = "> ";
const INPUT_PROMPT_WIDTH = 2;

type EditorOrbState = OrbState | "done" | "idle" | "off";

class BorderlessEditor extends CustomEditor {
	constructor(tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager) {
		super(tui, theme, keybindings, { paddingX: 0 });
	}

	override setPaddingX(_paddingX: number): void {
		// Keep the input origin stable behind the fixed terminal prompt.
		super.setPaddingX(0);
	}

	/** Retained as a compatibility hook; the input prompt itself is static. */
	public setOrbState(_state: EditorOrbState): void {
		this.tui.requestRender();
	}

	override render(width: number): string[] {
		if (width <= INPUT_PROMPT_WIDTH) return [truncateToWidth(INPUT_PROMPT, Math.max(1, width))];
		const innerWidth = Math.max(1, width - INPUT_PROMPT_WIDTH);
		const lines = super.render(innerWidth);
		if (lines.length > 0) lines.shift();
		const bottomBorderIndex = findEditorBottomBorderIndex(lines, innerWidth);
		if (bottomBorderIndex !== -1) lines.splice(bottomBorderIndex, 1);
		else if (lines.length > 0) lines.pop();

		return lines.map((line) => truncateToWidth(`${INPUT_PROMPT}${line}`, width));
	}

	public dispose(): void {
		// The static prompt has no animation resources to release.
	}
}

export default function acidbath(pi: ExtensionAPI): void {
	let lastContext: ExtensionContext | undefined;
	let activeLabel: LabelOutput | undefined;
	let pendingLabel: LabelOutput | undefined;
	let labelTimer: ReturnType<typeof setTimeout> | undefined;
	let lastWorkingMessage = "";
	let footerWidget: AcidbathFooter | undefined;
	let editorWidget: BorderlessEditor | undefined;
	const toolActivity = new ToolActivityStore();

	pi.registerEntryRenderer(TOOL_ACTIVITY_ENTRY_TYPE, (_entry, _options, theme) =>
		new ToolActivityTranscript(toolActivity, theme, REDUCED_MOTION, !COLOR_ENABLED),
	);

	const cancelLabelTimer = (): void => {
		if (labelTimer !== undefined) {
			clearTimeout(labelTimer);
			labelTimer = undefined;
		}
		pendingLabel = undefined;
	};

	const setWorkingMessageIfChanged = (ctx: ExtensionContext, message: string): void => {
		if (message === lastWorkingMessage) return;
		lastWorkingMessage = message;
		workingUi(ctx).setWorkingMessage?.(message || undefined);
		footerWidget?.update({ workingMessage: message });
	};

	const queueWorkingMessage = (ctx: ExtensionContext, output: LabelOutput): void => {
		pendingLabel = output;
		if (labelTimer !== undefined) clearTimeout(labelTimer);
		labelTimer = setTimeout(() => {
			labelTimer = undefined;
			const next = pendingLabel;
			pendingLabel = undefined;
			if (next) setWorkingMessageIfChanged(ctx, next.message);
		}, LABEL_DEBOUNCE_MS);
	};

	const motionClock = new MotionClock(REDUCED_MOTION, parseMotionPhase(INITIAL_MOTION_PHASE));
	const toolMotion = registerToolMotionRenderers(pi, {
		reducedMotion: REDUCED_MOTION,
		noColor: !COLOR_ENABLED,
		hideTranscript: true,
		initialPhase: INITIAL_MOTION_PHASE,
		clock: motionClock,
		onLabel: (input) => {
			if (lastContext) updateLabel(input, lastContext);
		},
		onActivity: (update) => toolActivity.update(update),
	});
	let mode: OrbMode = "auto";
	let automaticState: OrbState = "working";
	let compatibilityWarningShown = false;
	let contextPlacement: ContextPlacement = parseContextPlacement(process.env.PI_ACIDBATH_CONTEXT, "right");
	let thinkingLevel = "default";
	let contextWidget: ContextPyramidWidget | undefined;
	let contextPollTimer: ReturnType<typeof setInterval> | undefined;
	let contextPercent: number | undefined;
	let tokenContext: TokenContextState = createTokenContextState({ reducedMotion: REDUCED_MOTION });
	let contextSequence = 0;
	let generation = "session-0";
	let headerWidget: AcidbathHeader | undefined;
	let welcomeWidget: AcidbathWelcome | undefined;
	let sessionSummary = DEFAULT_SESSION_SUMMARY;
	let sessionContextPercent: number | undefined;

	const clearWelcome = (ctx: ExtensionContext): void => {
		welcomeWidget = undefined;
		ctx.ui.setWidget(WELCOME_WIDGET_KEY, undefined);
	};

	const setWelcomeCheck = (label: string, status: PreflightStatus, detail: string): void => {
		welcomeWidget?.updateCheck(label, status, detail);
	};

	const runPreflight = async (ctx: ExtensionContext): Promise<void> => {
		const widget = welcomeWidget;
		if (!widget) return;

		const runtimePromise = pi.exec("pi", ["--version"], { timeout: 2_000 });
		const skillsPromise = discoverSkillNames(ctx.cwd, getAgentDir());

		try {
			const result = await runtimePromise;
			const version = `${result.stdout}\n${result.stderr}`.trim().split(/\\r?\\n/)[0] || "unknown";
			setWelcomeCheck("runtime", result.code === 0 ? "ok" : "warn", version.replace(/^pi\\s*/i, ""));
		} catch {
			setWelcomeCheck("runtime", "warn", "unavailable");
		}

		try {
			const available = ctx.modelRegistry.getAvailable().length;
			const model = ctx.model?.name ?? ctx.model?.id ?? "none";
			setWelcomeCheck("model", ctx.model ? "ok" : "warn", `${model} · ${available} available`);
		} catch {
			setWelcomeCheck("model", "warn", "unavailable");
		}

		try {
			setWelcomeCheck("tools", "ok", `${pi.getActiveTools().length} active`);
		} catch {
			setWelcomeCheck("tools", "warn", "unavailable");
		}

		try {
			const skills = await skillsPromise;
			widget.update({ skills });
			setWelcomeCheck("skills", skills.length > 0 ? "ok" : "warn", `${skills.length} loaded`);
		} catch {
			setWelcomeCheck("skills", "warn", "unavailable");
		}
	};

	const installWelcome = (ctx: ExtensionContext): void => {
		clearWelcome(ctx);
		if (ctx.mode !== "tui") return;
		const initial = initialWelcomeState(
			ctx.cwd,
			ctx.model?.name ?? ctx.model?.id ?? "no model",
			contextSequence,
		);
		ctx.ui.setWidget(
			WELCOME_WIDGET_KEY,
			(tui, theme) => {
				const widget = new AcidbathWelcome(tui, theme, initial);
				welcomeWidget = widget;
				void runPreflight(ctx);
				return widget;
			},
			{ placement: "aboveEditor" },
		);
	};

	const updateHeader = (): void => {
		headerWidget?.update({ summary: sessionSummary, contextPercent: sessionContextPercent });
	};

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
			cancelLabelTimer();
			ui.setWorkingIndicator({ frames: [] });
			setWorkingMessageIfChanged(ctx, "");
			editorWidget?.setOrbState("off");
			return;
		}

		if (mode === "default") {
			cancelLabelTimer();
			ui.setWorkingIndicator();
			setWorkingMessageIfChanged(ctx, "");
			editorWidget?.setOrbState("idle");
			return;
		}

		const state = mode === "auto" ? (activeLabel?.orbState ?? automaticState) : mode;
		ui.setWorkingIndicator(indicatorFor(state, REDUCED_MOTION, COLOR_ENABLED));
		if (mode === "auto") editorWidget?.setOrbState(state);
		if (mode !== "auto") {
			cancelLabelTimer();
			editorWidget?.setOrbState(state);
			setWorkingMessageIfChanged(ctx, `${ORB_LABELS[state]}…`);
		} else if (activeLabel) {
			queueWorkingMessage(ctx, activeLabel);
		} else {
			setWorkingMessageIfChanged(ctx, `${ORB_LABELS[state]}…`);
		}
	};

	function updateLabel(input: LabelInput, ctx: ExtensionContext): void {
		lastContext = ctx;
		const output = synthesizeLabel(input);
		const changed =
			activeLabel?.orbState !== output.orbState || activeLabel?.message !== output.message;
		automaticState = output.orbState;
		activeLabel = output;
		const displayState: EditorOrbState = input.event === "agent_end" ? "done" : output.orbState;
		if (mode === "auto") editorWidget?.setOrbState(displayState);
		footerWidget?.update({
			workingState: input.event === "agent_end" ? "done" : output.orbState,
			workingMessage: input.event === "agent_end" ? "done" : output.message,
			tokenContext,
		});
		if (!changed || mode !== "auto") return;
		apply(ctx);
	}

	const clearContextWidget = (ctx: ExtensionContext): void => {
		contextWidget?.dispose();
		contextWidget = undefined;
		ctx.ui.setWidget(CONTEXT_WIDGET_KEY, undefined);
	};

	const installContextWidget = (ctx: ExtensionContext): void => {
		clearContextWidget(ctx);
		footerWidget?.update({ contextVisible: contextPlacement === "right" || (contextPlacement !== "off" && tokenContext.facts?.contextPercent === null) });
		if (contextPlacement === "off" || contextPlacement === "right" || ctx.mode !== "tui") return;
		ctx.ui.setWidget(
			CONTEXT_WIDGET_KEY,
			(tui, theme) => {
				const widget = new ContextPyramidWidget(tui, theme, REDUCED_MOTION, !COLOR_ENABLED);
				contextWidget = widget;
				widget.updateTarget(contextPercent);
				return widget;
			},
			{ placement: contextPlacement === "below" ? "belowEditor" : "aboveEditor" },
		);
	};

	const TOKEN_CLOCK_ID = "token-context";
	const dispatchTokenEvent = (event: TokenContextEvent): void => {
		tokenContext = reduceTokenContext(tokenContext, event);
		contextPercent = tokenContext.facts?.contextPercent ?? undefined;
		sessionContextPercent = contextPercent;
		contextWidget?.updateTarget(contextPercent);
		updateHeader();
		footerWidget?.update({
			contextPercent,
			tokenContext,
			contextVisible: contextPlacement === "right" || (contextPlacement !== "off" && tokenContext.facts?.contextPercent === null),
		});
		if (tokenContext.pendingBubbles > 0 && !REDUCED_MOTION) {
			motionClock.subscribe(TOKEN_CLOCK_ID, () => dispatchTokenEvent({ type: "frame_tick" }));
		} else {
			motionClock.unsubscribe(TOKEN_CLOCK_ID);
		}
	};

	const pushContextUsage = (ctx: ExtensionContext): void => {
		const usage = ctx.getContextUsage();
		const facts: UsageFacts = {
			contextTokens: usage?.tokens ?? null,
			contextWindow: usage?.contextWindow ?? null,
			contextPercent: usage?.percent === null || usage?.percent === undefined ? null : usage.percent / 100,
			inputTokens: tokenContext.facts?.inputTokens ?? null,
			outputTokens: tokenContext.facts?.outputTokens ?? null,
			cacheReadTokens: tokenContext.facts?.cacheReadTokens ?? null,
			cacheWriteTokens: tokenContext.facts?.cacheWriteTokens ?? null,
			reasoningTokens: tokenContext.facts?.reasoningTokens ?? null,
			totalTokens: tokenContext.facts?.totalTokens ?? null,
			source: tokenContext.facts?.complete ? "assistant-usage" : usage ? "context-api" : "unknown",
			complete: tokenContext.facts?.complete ?? false,
			sequence: ++contextSequence,
			generation,
		};
		dispatchTokenEvent({ type: "usage", facts });
	};

	const pushFinalUsage = (messages: readonly unknown[]): void => {
		const assistant = [...messages].reverse().find((message) => {
			if (!message || typeof message !== "object") return false;
			return (message as unknown as Record<string, unknown>).role === "assistant";
		}) as Record<string, unknown> | undefined;
		const usage = assistant && typeof assistant.usage === "object" && assistant.usage !== null
			? assistant.usage as Record<string, unknown>
			: undefined;
		if (!usage) return;
		const number = (key: string): number | null => typeof usage[key] === "number" && Number.isFinite(usage[key]) ? usage[key] as number : null;
		dispatchTokenEvent({
			type: "usage",
			facts: {
				contextTokens: tokenContext.facts?.contextTokens ?? null,
				contextWindow: tokenContext.facts?.contextWindow ?? null,
				contextPercent: tokenContext.facts?.contextPercent ?? null,
				inputTokens: number("input"),
				outputTokens: number("output"),
				cacheReadTokens: number("cacheRead"),
				cacheWriteTokens: number("cacheWrite"),
				reasoningTokens: number("reasoning"),
				totalTokens: number("totalTokens"),
				source: "assistant-usage",
				complete: true,
				sequence: ++contextSequence,
				generation,
			},
		});
	};

	const stopContext = (ctx: ExtensionContext): void => {
		if (contextPollTimer !== undefined) {
			clearInterval(contextPollTimer);
			contextPollTimer = undefined;
		}
		clearContextWidget(ctx);
	};

	pi.on("session_start", async (_event, ctx) => {
		lastContext = ctx;
		sessionSummary = DEFAULT_SESSION_SUMMARY;
		sessionContextPercent = undefined;
		generation = `session-${++contextSequence}`;
		tokenContext = createTokenContextState({ generation, reducedMotion: REDUCED_MOTION });
		dispatchTokenEvent({ type: "agent_start", generation });
		stopContext(ctx);
		apply(ctx);
		if (ctx.mode !== "tui") return;
		ctx.ui.setHiddenThinkingLabel("Reasoning…");
		ctx.ui.setWorkingVisible?.(false);
		ctx.ui.setEditorComponent((tui, theme, kb) => {
			editorWidget?.dispose();
			editorWidget = new BorderlessEditor(tui, theme, kb);
			editorWidget.setOrbState(activeLabel?.orbState ?? "idle");
			return editorWidget;
		});
		const installHeader = (): void => {
			ctx.ui.setHeader(
			(tui, theme) => {
				const header = new AcidbathHeader(tui, theme, ctx.model?.name, ctx.cwd, !COLOR_ENABLED, sessionSummary);
				header.update({ contextPercent: sessionContextPercent });
				headerWidget = header;
				return header;
			},
			);
		};
		// Some Pi builds initialize the built-in header immediately after the
		// session_start callback. Retry on the next microtask so setHeader is not
		// lost to that initialization order.
		installHeader();
		queueMicrotask(installHeader);
		ctx.ui.setFooter((tui, theme) => {
			const footer = new AcidbathFooter(tui, theme, ctx.cwd, !COLOR_ENABLED);
			footerWidget = footer;
			footer.update({
				modelName: ctx.model?.name,
				thinkingLevel,
				contextPercent,
				contextVisible: contextPlacement === "right",
				workingState: automaticState,
				workingMessage: activeLabel?.message,
				tokenContext,
			});
			return footer;
		});
		installContextWidget(ctx);
		installWelcome(ctx);
		pushContextUsage(ctx);
		contextPollTimer = setInterval(() => pushContextUsage(ctx), CONTEXT_POLL_MS);
	});

	pi.on("before_agent_start", async (_event, ctx) => {
		clearWelcome(ctx);
	});

	pi.on("model_select", async (event) => {
		footerWidget?.update({ modelName: event.model.name });
	});

	pi.on("thinking_level_select", async (event) => {
		thinkingLevel = event.level;
		footerWidget?.update({ thinkingLevel });
	});

	pi.on("before_agent_start", async (event, ctx) => {
		const nextSummary = summarizeTask(event.prompt, sessionSummary);
		if (nextSummary !== sessionSummary) {
			sessionSummary = nextSummary;
			updateHeader();
		}
	});

	pi.on("agent_start", async (_event, ctx) => {
		generation = `run-${++contextSequence}`;
		toolActivity.beginRun();
		pi.appendEntry(TOOL_ACTIVITY_ENTRY_TYPE, { generation });
		dispatchTokenEvent({ type: "agent_start", generation });
		updateLabel({ event: "agent_start" }, ctx);
	});
	pi.on("before_provider_request", async (_event, ctx) => {
		updateLabel({ event: "before_provider_request" }, ctx);
		pushContextUsage(ctx);
	});
	pi.on("after_provider_response", async (_event, ctx) => {
		updateLabel({ event: "after_provider_response" }, ctx);
		pushContextUsage(ctx);
	});
	pi.on("message_update", async (_event, ctx) => {
		updateLabel({ event: "message_update" }, ctx);
		pushContextUsage(ctx);
	});
	pi.on("tool_call", async (event, ctx) => {
		updateLabel({ event: "tool_call", toolName: event.toolName }, ctx);
		pushContextUsage(ctx);
	});
	pi.on("tool_result", async (event, ctx) => {
		updateLabel({ event: "tool_result", toolName: event.toolName, isError: event.isError }, ctx);
		pushContextUsage(ctx);
	});
	// Capture custom tools (including pi-research) in the same viewport. The
	// wrapped built-ins also emit these lifecycle events; store de-duplication
	// keeps their renderer updates authoritative.
	pi.on("tool_execution_start", async (event) => {
		toolActivity.update({
			event: "start",
			toolCallId: event.toolCallId,
			toolName: event.toolName,
			target: activityTarget(event.toolName, event.args as Record<string, unknown>),
			status: "pending",
			metadata: ["running"],
		});
	});
	pi.on("tool_execution_update", async (event) => {
		const preview = activityPreview(event.partialResult);
		toolActivity.update({
			event: "update",
			toolCallId: event.toolCallId,
			toolName: event.toolName,
			target: activityTarget(event.toolName, event.args as Record<string, unknown>),
			status: "pending",
			metadata: ["running"],
			previewLines: preview.lines,
			previewHidden: preview.hidden,
		});
	});
	pi.on("tool_execution_end", async (event) => {
		const preview = activityPreview(event.result);
		toolActivity.update({
			event: "update",
			toolCallId: event.toolCallId,
			toolName: event.toolName,
			target: toolActivity.targetFor(event.toolCallId),
			status: event.isError ? "error" : "success",
			metadata: [event.isError ? "failed" : "done"],
			previewLines: preview.lines,
			previewHidden: preview.hidden,
		});
	});

	pi.on("agent_end", async (event, ctx) => {
		pushFinalUsage(event.messages);
		updateLabel({ event: "agent_end" }, ctx);
		const endedWithError = event.messages.some((message) => {
			if (!message || typeof message !== "object") return false;
			const stopReason = (message as unknown as Record<string, unknown>).stopReason;
			return stopReason === "error" || stopReason === "aborted";
		});
		dispatchTokenEvent({ type: "agent_end", outcome: endedWithError ? "error" : "success" });
		pushContextUsage(ctx);
	});
	pi.on("agent_settled", async (_event, _ctx) => {
		dispatchTokenEvent({ type: "agent_settled" });
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		lastContext = ctx;
		cancelLabelTimer();
		const ui = workingUi(ctx);
		ui.setWorkingIndicator?.();
		ui.setWorkingMessage?.();
		ui.setWorkingVisible?.(true);
		stopContext(ctx);
		clearWelcome(ctx);
		headerWidget = undefined;
		footerWidget?.dispose();
		footerWidget = undefined;
		ctx.ui.setHeader(undefined);
		ctx.ui.setFooter(undefined);
		toolActivity.clear();
		toolMotion.dispose();
		motionClock.dispose();
		ctx.ui.setHiddenThinkingLabel();
		editorWidget?.dispose();
		editorWidget = undefined;
		ctx.ui.setEditorComponent(undefined);
		activeLabel = undefined;
		pendingLabel = undefined;
		lastWorkingMessage = "";
		contextPercent = undefined;
		sessionContextPercent = undefined;
		sessionSummary = DEFAULT_SESSION_SUMMARY;
		tokenContext = createTokenContextState({ reducedMotion: REDUCED_MOTION });
		contextSequence = 0;
		generation = "session-0";
		thinkingLevel = "default";
	});

	pi.registerCommand("preflight", {
		description: "Show Acidbath startup metadata and rerun preflight checks.",
		handler: async (_args, ctx) => {
			if (ctx.mode !== "tui") return;
			installWelcome(ctx);
			workingUi(ctx).notify("Acidbath preflight running above the editor.", "info");
		},
	});

	pi.registerCommand("acidbath-update", {
		description: "Update Pi extensions, then update Pi itself.",
		handler: async (_args, ctx) => {
			if (!ctx.hasUI || !(await ctx.ui.confirm("Update Pi?", "Run `pi update --extensions`, then `pi update`?"))) return;
			await ctx.waitForIdle();
			workingUi(ctx).notify("Updating Pi extensions…", "info");
			const extensions = await pi.exec("pi", ["update", "--extensions"], { timeout: 120_000 });
			workingUi(ctx).notify(
				extensions.code === 0 ? "Extensions updated. Updating Pi…" : "Extension update returned a warning; updating Pi…",
				extensions.code === 0 ? "info" : "warning",
			);
			const self = await pi.exec("pi", ["update"], { timeout: 120_000 });
			if (self.code === 0 && extensions.code === 0) workingUi(ctx).notify("Pi and extensions are up to date.", "info");
			else workingUi(ctx).notify("Pi update finished with a warning; inspect the command output.", "warning");
		},
	});

	pi.registerCommand("context", {
		description: "Set context display: right, above, below, or off.",
		handler: async (args, ctx) => {
			const value = args.trim().toLowerCase();
			if (!value) {
				workingUi(ctx).notify(`Context display: ${contextPlacement}`, "info");
				return;
			}
			if (value !== "off" && value !== "right" && value !== "above" && value !== "below") {
				workingUi(ctx).notify("Usage: /context [right|above|below|off]", "error");
				return;
			}
			contextPlacement = value;
			if (ctx.mode === "tui") installContextWidget(ctx);
			workingUi(ctx).notify(`Context display set to: ${contextPlacement}`, "info");
		},
	});

	pi.registerCommand("tools", {
		description: "Scroll or toggle the tool activity viewport.",
		handler: async (args, ctx) => {
			const value = args.trim().toLowerCase();
			if (!value) {
				workingUi(ctx).notify(`Tool activity: ${toolActivity.entryCount()} entries${toolActivity.isVisible() ? "" : " (hidden)"}${toolActivity.isExpanded() ? " (expanded)" : ""}`, "info");
				return;
			}
			if (value === "up") toolActivity.scroll(1);
			else if (value === "down") toolActivity.scroll(-1);
			else if (value === "top") toolActivity.scrollToTop();
			else if (value === "bottom") toolActivity.scrollToBottom();
			else if (value === "show") toolActivity.setVisible(true);
			else if (value === "hide") toolActivity.setVisible(false);
			else if (value === "toggle") toolActivity.toggleVisible();
			else if (value === "expand") toolActivity.setExpanded(true);
			else if (value === "compact") toolActivity.setExpanded(false);
			else if (value === "clear") toolActivity.clear();
			else {
				workingUi(ctx).notify("Usage: /tools [up|down|top|bottom|show|hide|toggle|expand|compact|clear]", "error");
				return;
			}
		},
	});

	pi.registerShortcut("ctrl+alt+up", {
		description: "Scroll tool activity history up.",
		handler: async () => toolActivity.scroll(1),
	});
	pi.registerShortcut("ctrl+alt+down", {
		description: "Scroll tool activity history down.",
		handler: async () => toolActivity.scroll(-1),
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
