/**
 * clef — the hook handlers.
 *
 * Plain async functions over synthetic events, so they can be driven in a
 * test without a live Pi session — exactly the way the acidbath compactor
 * tests do. `index.ts` is the thin wiring layer that registers these with Pi.
 *
 * Every handler fails open: an unreachable, slow or malformed service changes
 * no behaviour.
 */

import type { ClefClient } from "./client.ts";
import type { ClefConfig } from "./config.ts";
import { compactionTier, gateToolCall, screenToolResult, toolCallState } from "./lib.ts";
import type { Ledger } from "./ledger.ts";

// ─── the synthetic event shapes the handlers consume ─────────────────────

export interface ToolCallEventLike {
	toolName: string;
	input: Record<string, unknown>;
}

export interface ToolResultEventLike {
	toolName: string;
	content: { type: string; text?: string }[];
	isError?: boolean;
}

export interface ContextUsageLike {
	tokens: number | null;
	contextWindow: number;
	percent: number | null;
}

export interface ToolCallResult {
	block?: boolean;
	reason?: string;
}

export interface ToolResultResult {
	content?: { type: "text"; text: string }[];
}

export interface TurnEndResult {
	entries?: {
		type: "custom_message";
		customType: string;
		content: string;
		display: boolean;
	}[];
}

/** The message a compaction tier injects. */
export function compactionNotice(tier: string, percent: number | null): string {
	const pct = percent === null ? "unknown" : `${percent.toFixed(0)}%`;
	switch (tier) {
		case "notice":
			return `[clef] context is at ${pct} of the window. Compaction is available if you want it.`;
		case "recommend":
			return `[clef] context is at ${pct} of the window. Consider compacting before continuing.`;
		case "request":
			return `[clef] context is at ${pct} of the window. Compact now before continuing.`;
		default:
			return `[clef] context is at ${pct} of the window.`;
	}
}

export interface Hooks {
	onToolCall(event: ToolCallEventLike, ctx: { cwd?: string }): Promise<ToolCallResult | undefined>;
	onToolResult(event: ToolResultEventLike): Promise<ToolResultResult | undefined>;
	onTurnEnd(usage: ContextUsageLike | undefined): Promise<TurnEndResult | undefined>;
}

export function createHooks(client: ClefClient, ledger: Ledger, config: ClefConfig): Hooks {
	return {
		async onToolCall(event, ctx) {
			if (!config.hooks.toolCall) return undefined;
			if (event.toolName !== "bash" && event.toolName !== "powershell") return undefined;

			const state = toolCallState(event.toolName, event.input ?? {}, ctx?.cwd ?? "");
			const result = await gateToolCall(client, ledger, state);
			if (!result.blocked) return undefined;
			return { block: true, reason: result.reason };
		},

		async onToolResult(event) {
			if (!config.hooks.toolResult) return undefined;
			if (event.isError) return undefined;

			const textParts = (event.content ?? []).filter(
				(c): c is { type: "text"; text: string } => c.type === "text" && typeof c.text === "string",
			);
			if (textParts.length !== 1) return undefined;

			const rewritten = await screenToolResult(client, ledger, event.toolName, textParts[0].text);
			if (rewritten === null) return undefined;
			return { content: [{ type: "text", text: rewritten }] };
		},

		async onTurnEnd(usage) {
			if (!config.hooks.turnEnd) return undefined;
			const percent = usage?.percent ?? null;
			const tier = compactionTier(percent, config.compaction);
			if (tier === "silent") return undefined;

			const message = compactionNotice(tier, percent);
			ledger.record({
				ts: Date.now(),
				hook: "turn_end",
				policy: "local",
				verdict: tier,
				probability: percent,
				action: tier,
				reason: message,
			});

			return {
				entries: [
					{
						type: "custom_message",
						customType: "clef-compaction",
						content: message,
						display: false,
					},
				],
			};
		},
	};
}
