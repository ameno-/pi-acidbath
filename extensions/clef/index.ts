/**
 * clef — Acidbath as a pure client of the decision service.
 *
 * Acidbath hosts no model and knows no GPU details. It calls the policy
 * endpoint and nothing else. The thresholds, the question sets and the
 * judgments all live in the decision service; this extension holds no
 * threshold of its own.
 *
 * What stays in Pi (lifecycle interception — MCP cannot express these):
 *   tool_call   — block a destructive command before Pi runs it
 *   tool_result — rewrite the result Pi hands back to the model when it
 *                 carries injected instructions
 *   turn_end    — a compaction tier, injected as a transient message
 *
 * What becomes callable:
 *   ask_clef           — typed questions over state; the code reads the files
 *                        so the agent never pastes content
 *   should_i_compact   — compaction advice
 *   /clef              — status, the session ledger and the effective thresholds
 *
 * The extension is inert unless PI_CLEF_ENABLED=1. Every hook fails open: an
 * unreachable service changes no behaviour.
 *
 * Config (env) is documented in ./config.ts.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { ClefClient } from "./client.ts";
import { loadConfig } from "./config.ts";
import { createHooks } from "./hooks.ts";
import { createLedger } from "./ledger.ts";
import { renderStatus, thresholdsFromPrompts } from "./status.ts";
import {
	askClef,
	askClefSchema,
	formatAskClefResult,
	shouldICompact,
	shouldICompactSchema,
	type AskClefParams,
} from "./tools.ts";

export default function clefExtension(pi: ExtensionAPI) {
	const config = loadConfig();

	// ─── inert unless explicitly enabled ─────────────────────────────────
	//
	// The extension registers nothing at all when it is off: no hooks, no
	// tools, no command. An unconfigured Acidbath behaves exactly as it did
	// before clef existed.
	if (!config.enabled) {
		return;
	}

	let ledger = createLedger();
	const client = new ClefClient(config);
	const hooks = createHooks(client, ledger, config);

	pi.on("session_start", () => {
		ledger = createLedger();
	});

	// ─── the tool_call gate ────────────────────────────────────────────
	//
	// Blocks a destructive command before Pi runs it. Fail-open: an
	// unreachable service allows the call and records the failure.
	pi.on("tool_call", async (event, ctx) => {
		const result = await hooks.onToolCall(
			{ toolName: event.toolName, input: event.input as Record<string, unknown> },
			{ cwd: ctx?.cwd ?? "" },
		);
		return result;
	});

	// ─── the tool_result screen ────────────────────────────────────────
	//
	// Rewrites a result that carries injected instructions, so the model
	// receives it as data rather than as orders.
	pi.on("tool_result", async (event) => {
		const result = await hooks.onToolResult({
			toolName: event.toolName,
			content: event.content as { type: string; text?: string }[],
			isError: event.isError,
		});
		return result;
	});

	// ─── the turn_end compaction tier ──────────────────────────────────
	//
	// Injected as a transient message, so it reaches the model without
	// becoming part of the durable transcript.
	pi.on("turn_end", async (_event, ctx) => {
		return hooks.onTurnEnd(ctx?.getContextUsage?.());
	});

	// ─── ask_clef ──────────────────────────────────────────────────────
	//
	// Typed questions over state. The extension reads the files, so the
	// agent never pastes content and never gets it back: what comes back is
	// probabilities, a verdict and a one-line reason.
	pi.registerTool({
		name: "ask_clef",
		label: "ask clef",
		description:
			"Ask the clef decision service a question about some state. The service grades it against a policy's own question set and returns probabilities, a verdict and a one-line reason. Give it file paths rather than pasting file content: the extension reads the files, and file content is never returned to you.",
		parameters: askClefSchema,
		annotations: { readOnlyHint: true },
		async execute(_toolCallId, params: AskClefParams, _signal, _onUpdate, ctx) {
			const outcome = await askClef(client, ledger, params, ctx?.cwd ?? process.cwd(), config);
			return {
				content: [{ type: "text" as const, text: formatAskClefResult(outcome) }],
				details: {
					verdict: outcome.verdict,
					probabilities: outcome.probabilities,
					confidence: outcome.confidence,
					policy: outcome.policy,
					thresholds: outcome.thresholds,
					degraded: outcome.degraded,
					files: outcome.files,
				},
			};
		},
	});

	// ─── should_i_compact ──────────────────────────────────────────────
	pi.registerTool({
		name: "should_i_compact",
		label: "should i compact",
		description:
			"Ask whether the current context should be compacted. Returns the tier (silent, notice, recommend, request) and the context usage percentage.",
		parameters: shouldICompactSchema,
		annotations: { readOnlyHint: true },
		async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
			const usage = ctx?.getContextUsage?.();
			const advice = shouldICompact(usage?.percent ?? null, config);
			return {
				content: [
					{
						type: "text" as const,
						text: `tier: ${advice.tier}\ncontext usage: ${advice.percent === null ? "unknown" : `${advice.percent.toFixed(0)}%`}`,
					},
				],
				details: { tier: advice.tier, percent: advice.percent },
			};
		},
	});

	// ─── /clef ─────────────────────────────────────────────────────────
	//
	// Shows the endpoint, the thresholds in force and the session ledger.
	pi.registerCommand("clef", {
		description: "Show clef status: the endpoint, the effective thresholds and the session ledger.",
		handler: async (_args, ctx) => {
			// The thresholds in force are the service's, read from its own
			// reviewable prompt set. The ledger says which of them this
			// session actually saw. Fail-open: an unreachable service still
			// shows the status — with what the session saw.
			const prompts = await client.prompts();
			const lines = renderStatus({
				config,
				service: thresholdsFromPrompts(prompts),
				observed: ledger.effectiveThresholds(),
				ledger,
				serviceReachable: prompts !== null,
			});
			ctx.ui.notify(lines.join("\n"), "info");
		},
	});
}

export { loadConfig, createLedger, ClefClient, createHooks };
