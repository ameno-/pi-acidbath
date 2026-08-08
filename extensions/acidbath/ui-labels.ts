/**
 * Acidbath — V1 deterministic label synthesis (PURE, UNCONNECTED).
 *
 * Status: **wired through the live apply() path**. The export remains a
 * pure function with no runtime dependencies; the caller owns the 100ms
 * trailing debounce and churn guard. There are no timers, Pi context reads,
 * theme calls, or logging inside this module. The function is deterministic
 * and unit-testable in isolation.
 *
 * Spec: docs/PLAN.md §4 (V1 deterministic / V2 adaptive).
 *
 * Wire-in contract:
 *   - The `OrbState` type reuses the live one from `ui-orb.ts`.
 *   - The production caller (a thin hook in `apply()`) is expected
 *     to (1) call `synthesizeLabel`, (2) skip `setWorkingMessage`
 *     when the result is structurally equal to the previous result,
 *     (3) trailing-edge debounce 100ms so `tool_call→tool_result`
 *     produces one label, not two flashes.
 *
 * V2 addendum: the `intent` field is gated — V1 ignores it. When a
 * caller passes `input.intent`, the function still returns the V1
 * deterministic label. The V2 caller is expected to optionally call
 * a separate `refine()` (≤1ms, fail-open) that the human can adopt
 * later, behind a `pi.environment.intent` capability check.
 */

import { ORB_LABELS, ORB_STATES, stateForTool, type OrbState } from "./ui-orb.ts";

/**
 * The set of Pi lifecycle events acidbath already subscribes to in
 * `index.ts`. The list here is the **complete** set; unknown
 * events must be handled by the fallback case.
 */
export type LabelEvent =
	| "agent_start"
	| "before_provider_request"
	| "after_provider_response"
	| "message_update"
	| "tool_call"
	| "tool_result"
	| "agent_end";

const TOOL_RESULT_LABELS: Record<"searching" | "shaping" | "working" | "default", string> = {
	searching: "Search complete",
	shaping: "Edit complete",
	working: "Command finished",
	default: "Done",
};

const TOOL_BASH_OTHER: Record<"searching" | "shaping" | "working", string> = {
	searching: "Searching…",
	shaping: "Editing",
	working: "Running command…",
};

const TOOL_AUTORESEARCH: Record<"searching" | "shaping" | "working", string> = {
	searching: "Searching…",
	shaping: "Editing",
	working: "Running ast-grep…",
};

const TOOL_SUBAGENT: Record<"searching" | "shaping" | "working", string> = {
	searching: "Searching…",
	shaping: "Editing",
	working: "Working on subagent…",
};

const TOOL_DROID: Record<"searching" | "shaping" | "working", string> = {
	searching: "Searching…",
	shaping: "Editing",
	working: "Working on droid…",
};

export type LabelMessage = string;

/**
 * The render-time context the renderer passes. These fields are
 * confirmed in `ui-tools.ts` (`toolCallId`, `isError`, `isPartial`,
 * `args`, `invalidate`). We only consume the safe ones: `toolName`,
 * `isError`, `isPartial`, `args`.
 */
export interface LabelInput {
	event: LabelEvent;
	toolName?: string;
	/** Render-time args (e.g. { file_path, command, pattern }). V1 reads confirmed fields only. */
	toolArgs?: Record<string, unknown>;
	/** Set by the renderer for the first call of a tool. */
	isPartial?: boolean;
	/** Set by the renderer when the tool exited with an error. */
	isError?: boolean;
	/**
	 * V1.1 aggregate: distinct successful edit/write file_paths in
	 * this turn, reset on `agent_end`. The caller is expected to
	 * maintain this set; the function reads it as-is.
	 */
	editedFilesThisTurn?: ReadonlySet<string>;
	/**
	 * V2 placeholder. Ignored by V1. When the typed `intent` field
	 * ships upstream, V2 callers may opt into a separate `refine`
	 * pass. Today the field exists so the wire-in contract is
	 * stable when V2 lands.
	 */
	intent?: unknown;
}

export interface LabelOutput {
	orbState: OrbState;
	message: LabelMessage;
	/** True when V1 produced this label (V2 refinement did not run). */
	deterministic: true;
	/** Provenance for tests/observability: which rule fired. */
	rule: string;
}

const CLEAR_MESSAGE = "";
const RENDERED_ELLIPSIS = "…";
const FILES_SUFFIX = "files";

function getStringArg(args: Record<string, unknown> | undefined, key: string): string | undefined {
	if (!args) return undefined;
	const value = args[key];
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	if (trimmed.length === 0) return undefined;
	return trimmed;
}

function truncate(text: string, max: number): string {
	if (text.length <= max) return text;
	return `${text.slice(0, Math.max(1, max - 1))}…`;
}

function basenameOf(path: string): string {
	const idx = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
	return idx >= 0 ? path.slice(idx + 1) : path;
}

function isOrbState(value: string): value is OrbState {
	return (ORB_STATES as readonly string[]).includes(value);
}

/**
 * Deterministic V1 label synthesis.
 *
 * Algorithm: pure switch over the event. The tool_call branch reads
 * the `stateForTool` mapping (which already encodes the read/grep →
 * searching, edit/write → shaping, else → working decision) and
 * the render-time `args` to produce a context-aware message.
 *
 * No model output is parsed, no timers are started, no
 * `setWorkingMessage` is invoked. The caller owns the churn guard
 * and the trailing-edge debounce.
 */
export function synthesizeLabel(input: LabelInput): LabelOutput {
	const event = input.event;
	const toolName = input.toolName;
	const args = input.toolArgs;
	const isError = input.isError === true;
	const isPartial = input.isPartial === true;

	// Non-tool events.
	if (event === "agent_start") {
		return { orbState: "solving", message: `${ORB_LABELS.solving}${RENDERED_ELLIPSIS}`, deterministic: true, rule: "agent_start" };
	}
	if (event === "before_provider_request") {
		return { orbState: "listening", message: `${ORB_LABELS.listening}${RENDERED_ELLIPSIS}`, deterministic: true, rule: "before_provider_request" };
	}
	if (event === "after_provider_response") {
		return { orbState: "solving", message: `Reasoning over response${RENDERED_ELLIPSIS}`, deterministic: true, rule: "after_provider_response" };
	}
	if (event === "message_update") {
		return { orbState: "composing", message: `${ORB_LABELS.composing}${RENDERED_ELLIPSIS}`, deterministic: true, rule: "message_update" };
	}
	if (event === "agent_end") {
		return { orbState: "working", message: CLEAR_MESSAGE, deterministic: true, rule: "agent_end" };
	}

	// tool_call
	if (event === "tool_call") {
		const name = toolName ?? "";
		const state: OrbState = isOrbState(name) ? name : stateForTool(name);
		const filePath = getStringArg(args, "file_path");
		const command = getStringArg(args, "command");
		const pattern = getStringArg(args, "pattern");
		const subagent = getStringArg(args, "subagent");

		if (state === "searching") {
			if (filePath) return { orbState: "searching", message: `Searching in ${truncate(filePath, 64)}`, deterministic: true, rule: "tool_call.searching.file_path" };
			if (pattern) return { orbState: "searching", message: `Searching for ${truncate(pattern, 48)}`, deterministic: true, rule: "tool_call.searching.pattern" };
			return { orbState: "searching", message: `${ORB_LABELS.searching}${RENDERED_ELLIPSIS}`, deterministic: true, rule: "tool_call.searching" };
		}

		if (state === "shaping") {
			if (filePath) return { orbState: "shaping", message: `${name === "apply_patch" ? "Applying patch" : name === "write" ? "Writing" : "Editing"} ${truncate(basenameOf(filePath), 32)}`, deterministic: true, rule: "tool_call.shaping.file_path" };
			return { orbState: "shaping", message: `${ORB_LABELS.shaping}${RENDERED_ELLIPSIS}`, deterministic: true, rule: "tool_call.shaping" };
		}

		// working branch — bash, subagent, ast-grep, droid, default
		if (name === "bash" || name === "interactive_shell") {
			if (command) return { orbState: "working", message: `Running command: ${truncate(command, 40)}`, deterministic: true, rule: "tool_call.working.bash.command" };
			return { orbState: "working", message: TOOL_BASH_OTHER.working, deterministic: true, rule: "tool_call.working.bash" };
		}
		if (name === "ast_grep_search" || name === "ast_grep_replace" || name === "ast_grep_run" || name === "ast_grep_scan") {
			return { orbState: "working", message: TOOL_AUTORESEARCH.working, deterministic: true, rule: "tool_call.working.ast_grep" };
		}
		if (name === "agy_subagent" || name === "subagent" || name === "complete_research_request" || subagent !== undefined) {
			const target = subagent ?? "subagent";
			return { orbState: "working", message: `Working on ${target}${RENDERED_ELLIPSIS}`, deterministic: true, rule: "tool_call.working.subagent" };
		}
		if (name === "droid") {
			return { orbState: "working", message: TOOL_DROID.working, deterministic: true, rule: "tool_call.working.droid" };
		}
		return { orbState: "working", message: `Running ${name || "tool"}${RENDERED_ELLIPSIS}`, deterministic: true, rule: "tool_call.working.default" };
	}

	// tool_result
	if (event === "tool_result") {
		const state: OrbState = toolName && isOrbState(toolName) ? toolName : stateForTool(toolName ?? "");
		if (isError) {
			return { orbState: "solving", message: `${toolName ?? "tool"} failed`, deterministic: true, rule: "tool_result.error" };
		}
		if (isPartial) {
			// Streaming partial — don't churn the label, mirror the
			// call-state label so the orb stays consistent.
			return { orbState: state, message: state === "searching" ? `${ORB_LABELS.searching}${RENDERED_ELLIPSIS}` : state === "shaping" ? `${ORB_LABELS.shaping}${RENDERED_ELLIPSIS}` : `Working${RENDERED_ELLIPSIS}`, deterministic: true, rule: "tool_result.partial" };
		}
		if (state === "shaping") {
			const n = input.editedFilesThisTurn?.size ?? 0;
			if (n > 1) {
				return { orbState: "solving", message: `Edited ${n} ${FILES_SUFFIX}`, deterministic: true, rule: "tool_result.shaping.aggregate" };
			}
			if (n === 1) {
				return { orbState: "solving", message: `Edited 1 file`, deterministic: true, rule: "tool_result.shaping.single" };
			}
			return { orbState: "solving", message: TOOL_RESULT_LABELS.shaping, deterministic: true, rule: "tool_result.shaping" };
		}
		if (state === "searching") {
			return { orbState: "solving", message: TOOL_RESULT_LABELS.searching, deterministic: true, rule: "tool_result.searching" };
		}
		if (toolName === "bash" || toolName === "interactive_shell") {
			return { orbState: "solving", message: TOOL_RESULT_LABELS.working, deterministic: true, rule: "tool_result.bash" };
		}
		return { orbState: "solving", message: TOOL_RESULT_LABELS.default, deterministic: true, rule: "tool_result.default" };
	}

	// Fallback: unknown event — caller passed a bad event.
	return { orbState: "working", message: `${ORB_LABELS.working}${RENDERED_ELLIPSIS}`, deterministic: true, rule: "fallback" };
}
