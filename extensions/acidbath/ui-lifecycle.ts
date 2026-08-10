/** Single source of truth for Acidbath's visible agent lifecycle. */

export type LifecyclePhase =
	| "settled"
	| "preparing"
	| "listening"
	| "reasoning"
	| "composing"
	| "tool"
	| "compacting"
	| "error"
	| "done";

export interface LifecycleState {
	generation: string;
	phase: LifecyclePhase;
	status: string;
	message: string;
	reasoningActive: boolean;
	reasoningPreview: string;
}

export type LifecycleEvent =
	| { type: "session"; generation: string }
	| { type: "status"; status: string; message?: string }
	| { type: "reasoning"; active: boolean; preview?: string }
	| { type: "message"; message: string; phase?: LifecyclePhase }
	| { type: "settled" };

export const INITIAL_LIFECYCLE_STATE: LifecycleState = {
	generation: "session-0",
	phase: "settled",
	status: "settled",
	message: "settled",
	reasoningActive: false,
	reasoningPreview: "",
};

export function reduceLifecycle(state: LifecycleState, event: LifecycleEvent): LifecycleState {
	switch (event.type) {
		case "session":
			return { ...INITIAL_LIFECYCLE_STATE, generation: event.generation };
		case "status": {
			const phase = phaseForStatus(event.status);
			return {
				...state,
				phase,
				status: event.status,
				message: event.message ?? state.message,
				reasoningActive: phase === "reasoning" ? state.reasoningActive : false,
				reasoningPreview: phase === "reasoning" ? state.reasoningPreview : "",
			};
		}
		case "reasoning":
			return {
				...state,
				phase: "reasoning",
				status: "reasoning",
				reasoningActive: event.active,
				reasoningPreview: event.preview ?? state.reasoningPreview,
			message: event.active ? "working" : state.message,
			};
		case "message":
			return {
				...state,
				phase: event.phase ?? state.phase,
				message: event.message,
				reasoningActive: event.phase === "reasoning" ? state.reasoningActive : false,
				reasoningPreview: event.phase === "reasoning" ? state.reasoningPreview : "",
			};
		case "settled":
			return {
				...state,
				phase: "settled",
				status: "settled",
				message: "settled",
				reasoningActive: false,
				reasoningPreview: "",
			};
	}
}

export function phaseForStatus(status: string): LifecyclePhase {
	switch (status) {
		case "preparing":
		case "agent-start":
		case "session-switch":
		case "session-fork":
			return "preparing";
		case "provider-wait":
			return "listening";
		case "reasoning":
			return "reasoning";
		case "composing":
		case "response-done":
			return "composing";
		case "tool-running":
		case "tool-preparing":
		case "tool-streaming":
		case "tool-result":
		case "tool-complete":
			return "tool";
		case "compacting":
		case "compacted":
		case "retrying":
			return "compacting";
		case "error":
		case "provider-error":
		case "tool-error":
		case "aborted":
			return "error";
		case "done":
		case "turn-end":
			return "done";
		default:
			return "settled";
	}
}

export function activityKindForState(state: string): string {
	if (state === "listening" || state === "searching") return "listening";
	if (state === "shaping") return "editing";
	if (state === "composing") return "composing";
	return "working";
}

export interface StatusTimingSummary {
	state: string;
	count: number;
	totalMs: number;
	meanMs: number;
	p50Ms: number;
	p95Ms: number;
	maxMs: number;
}

/** Lightweight in-memory dwell instrumentation; it never drives rendering. */
export class StatusTimingRecorder {
	private currentState: string;
	private enteredAt: number;
	private readonly samples = new Map<string, number[]>();

	constructor(initialState = "settled", nowMs = 0) {
		this.currentState = initialState;
		this.enteredAt = nowMs;
	}

	transition(state: string, nowMs: number): void {
		if (!state || state === this.currentState) return;
		const values = this.samples.get(this.currentState) ?? [];
		values.push(Math.max(0, nowMs - this.enteredAt));
		this.samples.set(this.currentState, values);
		this.currentState = state;
		this.enteredAt = nowMs;
	}

	reset(state = this.currentState, nowMs = 0): void {
		this.samples.clear();
		this.currentState = state;
		this.enteredAt = nowMs;
	}

	summaries(nowMs?: number): StatusTimingSummary[] {
		const values = new Map(this.samples);
		if (nowMs !== undefined) {
			const current = values.get(this.currentState) ?? [];
			values.set(this.currentState, [...current, Math.max(0, nowMs - this.enteredAt)]);
		}
		return [...values.entries()]
			.map(([state, samples]) => {
				const sorted = [...samples].sort((a, b) => a - b);
				const totalMs = sorted.reduce((sum, value) => sum + value, 0);
				return {
					state,
					count: sorted.length,
					totalMs,
					meanMs: sorted.length ? totalMs / sorted.length : 0,
					p50Ms: percentile(sorted, 0.5),
					p95Ms: percentile(sorted, 0.95),
					maxMs: sorted.at(-1) ?? 0,
				};
			})
			.sort((a, b) => a.state.localeCompare(b.state));
	}
}

function percentile(values: readonly number[], ratio: number): number {
	if (values.length === 0) return 0;
	return values[Math.min(values.length - 1, Math.max(0, Math.ceil(values.length * ratio) - 1))]!;
}
