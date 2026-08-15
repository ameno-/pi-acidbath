/**
 * acidbath
 *
 * Features:
 * 1) One transient lifecycle activity rail above the editor.
 * 2) Native transcript tool rows with compact, width-safe details.
 * 3) Consolidated header, footer, context, and token surfaces.
 */

import {
	CustomEditor,
	type ExtensionAPI,
	type ExtensionContext,
	type KeybindingsManager,
} from "@earendil-works/pi-coding-agent";
import type { EditorTheme, TUI } from "@earendil-works/pi-tui";
import { AGENT_OUTPUT_ENTRY_TYPE, AgentOutputBanner, type AgentOutputEntryData } from "./ui-agent-output.js";
import { AcidbathFooter } from "./ui-footer.js";
import { findEditorBottomBorderIndex } from "./ui-gauge.js";
import {
	AcidbathActivityStatus,
	ACTIVITY_STATUS_WIDGET_KEY,
	thinkingPreview,
	thinkingTextFromMessage,
} from "./ui-activity-status.js";
import { AcidbathHeader } from "./ui-header.js";
import { DEFAULT_SESSION_SUMMARY, summarizeTask } from "./ui-summary.js";
import { activityKindForState, INITIAL_LIFECYCLE_STATE, reduceLifecycle, StatusTimingRecorder, type LifecycleState } from "./ui-lifecycle.js";
import { registerToolRenderers } from "./ui-tools.js";
import { synthesizeLabel, type LabelInput } from "./ui-labels.js";
import {
	createTokenContextState,
	reduceTokenContext,
	type TokenContextEvent,
	type TokenContextState,
	type UsageFacts,
} from "./ui-token-context.js";
import { truncateToWidth } from "./ui-gauge.js";
import {
import { expandPath, findEntry, formatCatalog, loadCatalog } from "./skill-catalog.ts";
	AcidbathWelcome,
	initialWelcomeState,
	modelCardFor,
	WELCOME_WIDGET_KEY,
	type PreflightStatus,
} from "./ui-welcome.js";

interface WorkingUi {
	setWorkingVisible?: (visible: boolean) => void;
	notify: (message: string, type?: "info" | "warning" | "error") => void;
}

const REDUCED_MOTION = process.env.PI_ACIDBATH_REDUCED_MOTION === "1";
const COLOR_ENABLED = process.env.NO_COLOR === undefined;
// Provider events can arrive token-by-token. Keep preview work bounded so it
// cannot monopolize the same event loop that accepts terminal input.
const THINKING_PREVIEW_INTERVAL_MS = 100;

function workingUi(ctx: ExtensionContext): WorkingUi {
	return ctx.ui as unknown as WorkingUi;
}

export const INPUT_PROMPT = "╰─› ";
export const INPUT_CONTINUATION = "│  ";
const INPUT_PROMPT_WIDTH = 4;

class BorderlessEditor extends CustomEditor {
	constructor(tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager) {
		super(tui, theme, keybindings, { paddingX: 0 });
	}

	override setPaddingX(_paddingX: number): void {
		// Keep the input origin stable behind the fixed terminal prompt.
		super.setPaddingX(0);
	}

	override render(width: number): string[] {
		if (width <= INPUT_PROMPT_WIDTH) return [truncateToWidth(INPUT_PROMPT, Math.max(1, width))];
		const innerWidth = Math.max(1, width - INPUT_PROMPT_WIDTH);
		const lines = super.render(innerWidth);
		if (lines.length > 0) lines.shift();
		const bottomBorderIndex = findEditorBottomBorderIndex(lines, innerWidth);
		if (bottomBorderIndex !== -1) lines.splice(bottomBorderIndex, 1);
		else if (lines.length > 0) lines.pop();

		return lines.map((line, index) => {
			const prefix = index === 0 ? INPUT_PROMPT : INPUT_CONTINUATION;
			return truncateToWidth(`${prefix}${line}`, width);
		});
	}

	public dispose(): void {
		// The static prompt has no animation resources to release.
	}
}

export default function acidbath(pi: ExtensionAPI): void {
	let footerWidget: AcidbathFooter | undefined;
	let branchName = "—";
	let editorWidget: BorderlessEditor | undefined;
	let activityStatusWidget: AcidbathActivityStatus | undefined;
	let lifecycleState: LifecycleState = { ...INITIAL_LIFECYCLE_STATE };
	const statusTimings = new StatusTimingRecorder("settled", performance.now());
	pi.registerEntryRenderer(AGENT_OUTPUT_ENTRY_TYPE, (entry, _options, theme) =>
		new AgentOutputBanner(entry.data as AgentOutputEntryData, theme, !COLOR_ENABLED),
	);

	// Renderer callbacks must remain presentation-only. Lifecycle events below
	// own labels so partial tool redraws cannot trigger recursive UI renders.
	registerToolRenderers(pi, { noColor: !COLOR_ENABLED, reducedMotion: REDUCED_MOTION });
	const recordStatus = (status: string, message?: string): void => {
		lifecycleState = reduceLifecycle(lifecycleState, { type: "status", status, message });
		statusTimings.transition(status, performance.now());
		activityStatusWidget?.update({
			kind: lifecycleState.phase,
			message: lifecycleState.message,
			reasoningActive: lifecycleState.reasoningActive,
			reasoningPreview: lifecycleState.reasoningPreview,
		});
	};
	let thinkingLevel = "default";
	let contextPercent: number | undefined;
	let tokenContext: TokenContextState = createTokenContextState();
	let contextSequence = 0;
	let generation = "session-0";
	let headerWidget: AcidbathHeader | undefined;
	let welcomeWidget: AcidbathWelcome | undefined;
	let sessionSummary = DEFAULT_SESSION_SUMMARY;
	let lastThinkingPreviewAt = Number.NEGATIVE_INFINITY;

	const refreshBranch = async (ctx: ExtensionContext): Promise<void> => {
		try {
			const result = await pi.exec("git", ["-C", ctx.cwd, "branch", "--show-current"], { timeout: 1_000 });
			branchName = result.stdout.trim() || "detached";
		} catch {
			branchName = "no-git";
		}
		footerWidget?.update({ branchName });
	};

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
	};

	const installWelcome = (ctx: ExtensionContext): void => {
		clearWelcome(ctx);
		if (ctx.mode !== "tui") return;
		const initial = initialWelcomeState(
			ctx.cwd,
			ctx.model?.name ?? ctx.model?.id ?? "no model",
			contextSequence,
			ctx.model?.cost,
			thinkingLevel,
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
		headerWidget?.update({ summary: sessionSummary });
	};

	function updateLabel(input: LabelInput): void {
		const output = synthesizeLabel(input);
		lifecycleState = reduceLifecycle(lifecycleState, {
			type: "message",
			message: input.event === "agent_end" ? "done" : output.message,
			phase: input.event === "agent_end" ? "done" : undefined,
		});
		activityStatusWidget?.update({
			visible: true,
			kind: activityKindForState(output.orbState),
			message: input.event === "agent_end" ? "done" : output.message,
			reasoningActive: lifecycleState.reasoningActive,
			reasoningPreview: lifecycleState.reasoningPreview,
		});
		footerWidget?.update({ tokenContext });
	}

	const dispatchTokenEvent = (event: TokenContextEvent): void => {
		tokenContext = reduceTokenContext(tokenContext, event);
		contextPercent = tokenContext.facts?.contextPercent ?? undefined;
		updateHeader();
		footerWidget?.update({ contextPercent, tokenContext });
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

	pi.on("session_start", async (_event, ctx) => {
		lifecycleState = reduceLifecycle(lifecycleState, { type: "session", generation: `session-${contextSequence + 1}` });
		statusTimings.reset("settled", performance.now());
		sessionSummary = DEFAULT_SESSION_SUMMARY;
		generation = `session-${++contextSequence}`;
		tokenContext = createTokenContextState({ generation });
		dispatchTokenEvent({ type: "agent_start", generation });
		if (ctx.mode !== "tui") return;
		// Suppress Pi's per-block collapsed labels. The live activity widget
		// below replaces them with one in-place reasoning preview per run.
		ctx.ui.setHiddenThinkingLabel("");
		// Keep Pi's current expansion preference. Forcing every native detail
		// open makes each streaming frame re-render potentially huge tool output.
		ctx.ui.setWorkingVisible?.(false);
		ctx.ui.setWidget(
			ACTIVITY_STATUS_WIDGET_KEY,
			(tui, theme) => {
				const widget = new AcidbathActivityStatus(tui, theme, REDUCED_MOTION, !COLOR_ENABLED);
				activityStatusWidget = widget;
				widget.update({ visible: true, kind: "working", message: "settled" });
				return widget;
			},
			{ placement: "aboveEditor" },
		);
		ctx.ui.setEditorComponent((tui, theme, kb) => {
			editorWidget?.dispose();
			editorWidget = new BorderlessEditor(tui, theme, kb);
			return editorWidget;
		});
		const installHeader = (): void => {
			ctx.ui.setHeader(
			(tui, theme) => {
				const header = new AcidbathHeader(tui, theme, ctx.model?.name, ctx.cwd, !COLOR_ENABLED, sessionSummary);
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
				branchName,
				contextVisible: true,
				tokenContext,
			});
			return footer;
		});
		installWelcome(ctx);
		pushContextUsage(ctx);
		void refreshBranch(ctx);
	});

	pi.on("before_agent_start", async (event, ctx) => {
		clearWelcome(ctx);
		pi.appendEntry(AGENT_OUTPUT_ENTRY_TYPE, { timestamp: Date.now(), prompt: event.prompt } satisfies AgentOutputEntryData);
		recordStatus("preparing", "preparing");
		const nextSummary = summarizeTask(event.prompt, sessionSummary);
		if (nextSummary !== sessionSummary) {
			sessionSummary = nextSummary;
			updateHeader();
		}
	});

	pi.on("session_before_switch", async (event) => {
		recordStatus("session-switch", event.reason === "new" ? "starting new session" : "switching session");
	});
	pi.on("session_before_fork", async () => recordStatus("session-fork", "forking session"));
	pi.on("session_before_compact", async () => recordStatus("compacting", "compacting context"));
	pi.on("session_compact", async (event) => recordStatus(event.willRetry ? "retrying" : "compacted", event.willRetry ? "retrying after compaction" : "context compacted"));
	pi.on("session_before_tree", async () => recordStatus("tree-navigation", "navigating session tree"));
	pi.on("session_tree", async () => recordStatus("settled", "settled"));

	pi.on("model_select", async (event) => {
		footerWidget?.update({ modelName: event.model.name });
		welcomeWidget?.update({ model: event.model.name, modelCard: modelCardFor(event.model.name, event.model.cost, thinkingLevel) });
	});

	pi.on("thinking_level_select", async (event, ctx) => {
		thinkingLevel = event.level;

		if (ctx.model) welcomeWidget?.update({ modelCard: modelCardFor(ctx.model.name, ctx.model.cost, thinkingLevel) });
	});

	pi.on("agent_start", async (_event, ctx) => {
		recordStatus("agent-start", "starting");
		generation = `run-${++contextSequence}`;
		dispatchTokenEvent({ type: "agent_start", generation });
		lastThinkingPreviewAt = Number.NEGATIVE_INFINITY;
		updateLabel({ event: "agent_start" });
	});
	pi.on("turn_start", async () => {
		recordStatus("turn-boundary", "working");
	});
	pi.on("before_provider_request", async (_event, ctx) => {
		recordStatus("provider-wait", "listening");
		updateLabel({ event: "before_provider_request" });
		pushContextUsage(ctx);
	});
	pi.on("after_provider_response", async (event, ctx) => {
		const providerFailed = event.status >= 400;
		recordStatus(providerFailed ? "provider-error" : "reasoning", providerFailed ? `provider error ${event.status}` : "working");
		updateLabel({ event: "after_provider_response" });
		activityStatusWidget?.update({ reasoningActive: !providerFailed, reasoningPreview: "" });
		pushContextUsage(ctx);
	});
	pi.on("message_update", async (event) => {
		const streamType = (event.assistantMessageEvent as unknown as Record<string, unknown>).type;
		if (typeof streamType === "string" && streamType.startsWith("thinking_")) {
			recordStatus("reasoning");
			const now = performance.now();
			const isBoundary = streamType === "thinking_start" || streamType === "thinking_end";
			if (isBoundary || now - lastThinkingPreviewAt >= THINKING_PREVIEW_INTERVAL_MS) {
				lastThinkingPreviewAt = now;
				activityStatusWidget?.update({
					reasoningActive: streamType !== "thinking_end",
					reasoningPreview: thinkingPreview(thinkingTextFromMessage(event.message)),
				});
			}
		} else if (typeof streamType === "string" && streamType.startsWith("text_")) {
			const enteringComposing = lifecycleState.status !== "composing";
			recordStatus("composing");
			activityStatusWidget?.update({ reasoningActive: false });
			if (enteringComposing) updateLabel({ event: "message_update" });
		} else if (streamType === "error") {
			recordStatus("error");
			activityStatusWidget?.update({ message: "response error", reasoningActive: false });
		} else if (streamType === "done") {
			recordStatus("response-done");
		}
		// Context estimation scans the accumulated assistant output. Sampling it
		// for every token is quadratic; lifecycle boundaries below are sufficient.
	});
	pi.on("tool_call", async (event, ctx) => {
		recordStatus("tool-running", "running tool");
		updateLabel({ event: "tool_call", toolName: event.toolName, toolArgs: event.input as Record<string, unknown> });
		pushContextUsage(ctx);
	});
	pi.on("tool_result", async (event, ctx) => {
		recordStatus(event.isError ? "tool-error" : "tool-result", event.isError ? "tool error" : "tool complete");
		updateLabel({ event: "tool_result", toolName: event.toolName, toolArgs: event.input as Record<string, unknown>, isError: event.isError });
		pushContextUsage(ctx);
	});
	// The native Pi transcript owns tool history. Acidbath only projects the
	// currently active call into the shared status line; completed results stay
	// attached to their original tool execution component.
	pi.on("tool_execution_start", async (event) => {
		recordStatus("tool-preparing", `preparing ${event.toolName}`);
	});
	pi.on("tool_execution_update", async (event) => {
		recordStatus("tool-streaming", `running ${event.toolName}`);
	});
	pi.on("tool_execution_end", async (event) => {
		recordStatus(event.isError ? "tool-error" : "tool-complete");
	});

	pi.on("turn_end", async () => {
		recordStatus("turn-end", "turn complete");
	});

	pi.on("agent_end", async (event, ctx) => {
		const stopReasons = event.messages
			.filter((message): message is typeof message & Record<string, unknown> => typeof message === "object" && message !== null)
			.map((message) => message.stopReason);
		const aborted = stopReasons.includes("aborted");
		const endedWithError = aborted || stopReasons.includes("error");
		recordStatus(aborted ? "aborted" : endedWithError ? "error" : "done", aborted ? "aborted" : endedWithError ? "error" : "done");
		pushFinalUsage(event.messages);
		updateLabel({ event: "agent_end" });
		dispatchTokenEvent({ type: "agent_end", outcome: endedWithError ? "error" : "success" });
		pushContextUsage(ctx);
	});
	pi.on("agent_settled", async (_event, _ctx) => {
		recordStatus("settled", "settled");
		dispatchTokenEvent({ type: "agent_settled" });
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		const ui = workingUi(ctx);
		ui.setWorkingVisible?.(true);
		activityStatusWidget?.dispose();
		activityStatusWidget = undefined;
		ctx.ui.setWidget(ACTIVITY_STATUS_WIDGET_KEY, undefined);
		clearWelcome(ctx);
		headerWidget = undefined;
		footerWidget?.dispose();
		footerWidget = undefined;
		ctx.ui.setHeader(undefined);
		ctx.ui.setFooter(undefined);
		ctx.ui.setHiddenThinkingLabel();
		editorWidget?.dispose();
		editorWidget = undefined;
		ctx.ui.setEditorComponent(undefined);
		contextPercent = undefined;
		sessionSummary = DEFAULT_SESSION_SUMMARY;
		tokenContext = createTokenContextState();
		contextSequence = 0;
		generation = "session-0";
		lifecycleState = { ...INITIAL_LIFECYCLE_STATE };
		thinkingLevel = "default";
		lastThinkingPreviewAt = Number.NEGATIVE_INFINITY;
	});

	pi.registerCommand("status-timings", {
		description: "Show or reset measured Acidbath lifecycle-state dwell times.",
		handler: async (args, ctx) => {
			const action = args.trim().toLowerCase();
			if (action === "reset") {
				statusTimings.reset(ctx.isIdle() ? "settled" : "working", performance.now());
				workingUi(ctx).notify("Status timing samples reset.", "info");
				return;
			}
			if (action && action !== "show") {
				workingUi(ctx).notify("Usage: /status-timings [show|reset]", "error");
				return;
			}
			const summaries = statusTimings.summaries(performance.now());
			if (summaries.length === 0) {
				workingUi(ctx).notify("No status timing samples yet.", "info");
				return;
			}
			const rows = summaries.map((item) =>
				`${item.state}: n=${item.count} mean=${Math.round(item.meanMs)}ms p50=${Math.round(item.p50Ms)}ms p95=${Math.round(item.p95Ms)}ms max=${Math.round(item.maxMs)}ms`,
			);
			workingUi(ctx).notify(`Status dwell timings\n${rows.join("\n")}`, "info");
		},
	});

	pi.registerCommand("preflight", {
		description: "Show Acidbath startup metadata and rerun preflight checks.",
		handler: async (_args, ctx) => {
			if (ctx.mode !== "tui") return;
			installWelcome(ctx);
			workingUi(ctx).notify("Acidbath preflight running above the editor.", "info");
		},
	});

	pi.registerCommand("skills", {
		description: "Library catalog. Usage: /skills [list|scan [query]|pull <name>]",
		handler: async (args, ctx) => {
			const parts = args.trim().split(/\s+/).filter(Boolean);
			const action = (parts[0] || "list").toLowerCase();
			let catalog;
			try {
				catalog = loadCatalog();
			} catch (err) {
				workingUi(ctx).notify(`Skill catalog unreadable: ${err instanceof Error ? err.message : String(err)}`, "error");
				return;
			}
			if (action === "list" || action === "") {
				workingUi(ctx).notify(formatCatalog(catalog), "info");
				return;
			}
			if (action === "scan") {
				const query = parts.slice(1).join(" ");
				const scan = expandPath("~/dev/lib/skills/library-access/scripts/scan.py");
				const argv = ["python3", scan];
				if (query) argv.push("--query", query);
				const result = await pi.exec(argv[0], argv.slice(1), { timeout: 20_000 });
				const body = (result.stdout || result.stderr || "").trim() || "(no scan output)";
				workingUi(ctx).notify(body.slice(0, 3500), result.code === 0 ? "info" : "warning");
				return;
			}
			if (action === "pull") {
				const name = parts.slice(1).join(" ");
				if (!name) {
					workingUi(ctx).notify("Usage: /skills pull <name>", "error");
					return;
				}
				const entry = findEntry(catalog, name);
				if (!entry) {
					workingUi(ctx).notify(`Unknown skill "${name}". Run /skills list.`, "error");
					return;
				}
				const resolved = expandPath(entry.path);
				workingUi(ctx).notify(
					[
						`Pull ${entry.name} [${entry.source}]`,
						resolved,
						entry.when ? `when: ${entry.when}` : "",
						"This session cannot hot-load a new skill file. Relaunch with:",
						`  pi --skill ${resolved}`,
						"Or add that path under settings.skills and restart Pi.",
					].filter(Boolean).join("\n"),
					"info",
				);
				return;
			}
			workingUi(ctx).notify("Usage: /skills [list|scan [query]|pull <name>]", "error");
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

}
