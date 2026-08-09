/** Pure context/token facts, lifecycle reducer, and width-safe rail formatter. */

export type TokenLifecycle = "idle" | "working" | "done" | "settled" | "error";
export type FactSource = "context-api" | "assistant-usage" | "unknown";
export type RailSegment = "filled" | "empty" | "bubble";
export type BubbleDirection = "in" | "out";

export interface UsageFacts {
	contextTokens: number | null;
	contextWindow: number | null;
	contextPercent: number | null;
	inputTokens: number | null;
	outputTokens: number | null;
	cacheReadTokens: number | null;
	cacheWriteTokens: number | null;
	reasoningTokens: number | null;
	totalTokens: number | null;
	source: FactSource;
	complete: boolean;
	sequence: number;
	generation: string;
}

export type TokenContextEvent =
	| { type: "agent_start"; generation: string }
	| { type: "usage"; facts: UsageFacts }
	| { type: "agent_end"; outcome: "success" | "error" | "aborted" }
	| { type: "agent_settled" }
	| { type: "frame_tick" }
	| { type: "reset"; generation: string };

export interface TokenContextState {
	lifecycle: TokenLifecycle;
	facts: UsageFacts | null;
	contextDelta: number | null;
	segments: readonly RailSegment[];
	pendingBubbles: number;
	bubbleDirection: BubbleDirection | null;
	frameIndex: number;
	generation: string;
	motionReduced: boolean;
}

export interface TokenContextRender {
	line: string;
	context: string;
	turn: string;
	rail: string;
	visibleWidth: number;
}

const RAIL_SLOTS = 16;
const BUBBLE_LIMIT = 3;

export function unknownUsageFacts(generation = "initial", sequence = 0): UsageFacts {
	return {
		contextTokens: null,
		contextWindow: null,
		contextPercent: null,
		inputTokens: null,
		outputTokens: null,
		cacheReadTokens: null,
		cacheWriteTokens: null,
		reasoningTokens: null,
		totalTokens: null,
		source: "unknown",
		complete: false,
		sequence,
		generation,
	};
}

export function createTokenContextState(options: { generation?: string; reducedMotion?: boolean } = {}): TokenContextState {
	return {
		lifecycle: "idle",
		facts: null,
		contextDelta: null,
		segments: emptySegments(RAIL_SLOTS),
		pendingBubbles: 0,
		bubbleDirection: null,
		frameIndex: 0,
		generation: options.generation ?? "initial",
		motionReduced: options.reducedMotion ?? false,
	};
}

export function normalizeUsageFacts(input: UsageFacts): UsageFacts {
	return {
		...input,
		contextTokens: finiteOrUnknown(input.contextTokens),
		contextWindow: finitePositiveOrUnknown(input.contextWindow),
		contextPercent: percentOrUnknown(input.contextPercent),
		inputTokens: finiteOrUnknown(input.inputTokens),
		outputTokens: finiteOrUnknown(input.outputTokens),
		cacheReadTokens: finiteOrUnknown(input.cacheReadTokens),
		cacheWriteTokens: finiteOrUnknown(input.cacheWriteTokens),
		reasoningTokens: finiteOrUnknown(input.reasoningTokens),
		totalTokens: finiteOrUnknown(input.totalTokens),
		sequence: Number.isInteger(input.sequence) && input.sequence >= 0 ? input.sequence : 0,
		generation: input.generation || "unknown",
	};
}

export function reduceTokenContext(state: TokenContextState, event: TokenContextEvent): TokenContextState {
	switch (event.type) {
		case "agent_start":
			return {
				...state,
				lifecycle: "working",
				generation: event.generation,
				contextDelta: null,
				pendingBubbles: 0,
				bubbleDirection: null,
				frameIndex: 0,
			};
		case "reset":
			return {
				...state,
				lifecycle: "working",
				generation: event.generation,
				facts: null,
				contextDelta: null,
				segments: emptySegments(RAIL_SLOTS),
				pendingBubbles: 0,
				bubbleDirection: null,
				frameIndex: 0,
			};
		case "usage": {
			const facts = normalizeUsageFacts(event.facts);
			if (facts.generation !== state.generation || (state.facts && facts.sequence <= state.facts.sequence)) {
				return state;
			}
			const previous = state.facts;
			const delta = previous && previous.generation === facts.generation && previous.contextTokens !== null && facts.contextTokens !== null
				? facts.contextTokens - previous.contextTokens
				: null;
			const direction = delta === null || delta === 0 ? null : delta > 0 ? "in" : "out";
			const pendingBubbles = state.motionReduced || delta === null || delta === 0
				? 0
				: Math.min(BUBBLE_LIMIT, Math.max(1, Math.floor(Math.abs(delta) / 1000)));
			return {
				...state,
				facts,
				contextDelta: delta,
				segments: segmentsForPercent(facts.contextPercent),
				pendingBubbles,
				bubbleDirection: pendingBubbles > 0 ? direction : null,
				frameIndex: 0,
			};
		}
		case "frame_tick":
			if (state.pendingBubbles <= 0) return state;
			return {
				...state,
				pendingBubbles: state.pendingBubbles - 1,
				bubbleDirection: state.pendingBubbles <= 1 ? null : state.bubbleDirection,
				frameIndex: state.frameIndex + 1,
			};
		case "agent_end":
			return {
				...state,
				lifecycle: event.outcome === "success" ? "done" : "error",
				pendingBubbles: 0,
				bubbleDirection: null,
			};
		case "agent_settled":
			return {
				...state,
				lifecycle: state.lifecycle === "done" ? "settled" : state.lifecycle,
				pendingBubbles: 0,
				bubbleDirection: null,
			};
	}
}

export function formatContextFact(facts: UsageFacts | null): string {
	if (!facts || facts.contextTokens === null && facts.contextPercent === null) return "ctx ?";
	if (facts.contextTokens !== null && facts.contextWindow !== null && facts.contextPercent !== null) {
		return `ctx ${formatCount(facts.contextTokens)}/${formatCount(facts.contextWindow)} ${Math.round(facts.contextPercent * 100)}%`;
	}
	if (facts.contextPercent !== null) return `ctx ${Math.round(facts.contextPercent * 100)}%`;
	if (facts.contextTokens !== null) return `ctx ${formatCount(facts.contextTokens)}`;
	return "ctx ?";
}

export function formatTurnUsage(facts: UsageFacts | null): string {
	if (!facts || facts.inputTokens === null && facts.outputTokens === null) return "turn ?";
	const input = facts.inputTokens === null ? "?" : formatCount(facts.inputTokens);
	const output = facts.outputTokens === null ? "?" : formatCount(facts.outputTokens);
	return `turn ${input} in / ${output} out`;
}

/** The default footer deliberately shows pressure as a light rail, not a second percentage fact. */
export function formatContextRail(state: TokenContextState, width: number, reducedMotion = state.motionReduced): string {
	const facts = state.facts;
	if (!facts || facts.contextPercent === null) return truncateToWidth("ctx ?", width);
	const label = "ctx ";
	const maxSlots = width >= 120 ? 24 : width >= 80 ? 16 : width >= 60 ? 12 : Math.max(4, Math.floor((width - visibleWidth(label)) / 2));
	const slots = Math.max(1, Math.min(maxSlots, width - visibleWidth(label)));
	const cells = railCells(state, slots, reducedMotion);
	return truncateToWidth(`${label}${cells}`, width);
}

export function renderTokenContext(
	state: TokenContextState,
	width: number,
	opts: { reducedMotion?: boolean; noColor?: boolean } = {},
): TokenContextRender {
	const reducedMotion = opts.reducedMotion ?? state.motionReduced;
	const context = formatContextFact(state.facts);
	const turn = formatTurnUsage(state.facts);
	const rail = formatContextRail(state, Math.max(1, width), reducedMotion);
	const line = truncateToWidth(`${rail} · ${turn}`, Math.max(1, width));
	return { line, context, turn, rail, visibleWidth: visibleWidth(line) };
}

function railCells(state: TokenContextState, slots: number, reducedMotion: boolean): string {
	const percent = state.facts?.contextPercent ?? 0;
	const filled = Math.round(Math.max(0, Math.min(1, percent)) * slots);
	const cells: string[] = Array.from({ length: slots }, (_, index) => index < filled ? "●" : "·");
	if (!reducedMotion && state.pendingBubbles > 0 && state.bubbleDirection) {
		const position = state.bubbleDirection === "in"
			? Math.min(slots - 1, filled + (state.frameIndex % Math.max(1, slots - filled)))
			: Math.max(0, filled - 1 - (state.frameIndex % Math.max(1, filled)));
		cells[position] = "○";
	}
	return cells.join("");
}

function segmentsForPercent(percent: number | null): readonly RailSegment[] {
	if (percent === null || !Number.isFinite(percent)) return emptySegments(RAIL_SLOTS);
	const filled = Math.round(Math.max(0, Math.min(1, percent)) * RAIL_SLOTS);
	return Array.from({ length: RAIL_SLOTS }, (_, index) => index < filled ? "filled" : "empty");
}

function emptySegments(count: number): readonly RailSegment[] {
	return Array.from({ length: count }, () => "empty" as const);
}

function finiteOrUnknown(value: number | null): number | null {
	return value !== null && Number.isFinite(value) && value >= 0 ? value : null;
}

function finitePositiveOrUnknown(value: number | null): number | null {
	return value !== null && Number.isFinite(value) && value > 0 ? value : null;
}

function percentOrUnknown(value: number | null): number | null {
	return value !== null && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : null;
}

function formatCount(value: number): string {
	if (value < 1000) return String(Math.round(value));
	if (value < 1_000_000) return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0).replace(/\.0$/, "")}k`;
	return `${(value / 1_000_000).toFixed(value < 10_000_000 ? 1 : 0).replace(/\.0$/, "")}m`;
}

function visibleWidth(text: string): number {
	let width = 0;
	for (const token of text.split(/(\x1b\[[0-9;?]*[ -/]*[@-~])/g)) {
		if (!token || token.startsWith("\x1b")) continue;
		for (const character of Array.from(token)) {
			const codePoint = character.codePointAt(0) ?? 0;
			width += codePoint >= 0x1f300 && codePoint <= 0x1faff ? 2 : 1;
		}
	}
	return width;
}

function truncateToWidth(text: string, maxWidth: number): string {
	const limit = Math.max(0, Math.trunc(maxWidth));
	if (visibleWidth(text) <= limit) return text;
	if (limit <= 1) return "…";
	let output = "";
	for (const character of Array.from(text)) {
		if (visibleWidth(output) + 1 > limit - 1) break;
		output += character;
	}
	return `${output}…`;
}
