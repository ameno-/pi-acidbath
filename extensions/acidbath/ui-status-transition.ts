/** Pure, deterministic status-transition and dwell-timing helpers. */

export const STATUS_TRANSITION_FRAME_MS = 56;
export const STATUS_TRANSITION_FRAMES = 4;
export const STATUS_TRANSITION_DURATION_MS = STATUS_TRANSITION_FRAME_MS * STATUS_TRANSITION_FRAMES;
export const STATUS_MIN_DWELL_MS = 180;

const ABOVE_MARKS = ["\u0301", "\u0307", "\u0308", "\u030c"] as const;
const BELOW_MARKS = ["\u0316", "\u0323", "\u0324", "\u0331"] as const;
const COMBINING_MARKS = /[\u0300-\u036f]/g;
const CONTROL_OR_ANSI = /\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1b\\))|[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g;

export interface StatusTransitionOptions {
	frameMs?: number;
	frames?: number;
	minDwellMs?: number;
	reducedMotion?: boolean;
}

export interface StatusTransitionSnapshot {
	text: string;
	stableText: string;
	targetText: string;
	transitioning: boolean;
	phase: number;
}

/**
 * Keeps the previous label present until a deterministic glitch bridge can
 * replace it. Bursts coalesce to the newest target instead of restarting or
 * briefly rendering every intermediate word.
 */
export class StatusTransitionTimeline {
	private readonly frameMs: number;
	private readonly frames: number;
	private readonly minDwellMs: number;
	private readonly reducedMotion: boolean;
	private stableText: string;
	private stableSince: number;
	private pendingText: string | undefined;
	private transition: { from: string; to: string; startedAt: number } | undefined;

	constructor(initialText: string, nowMs = 0, options: StatusTransitionOptions = {}) {
		this.frameMs = Math.max(1, Math.trunc(options.frameMs ?? STATUS_TRANSITION_FRAME_MS));
		this.frames = Math.max(1, Math.trunc(options.frames ?? STATUS_TRANSITION_FRAMES));
		this.minDwellMs = Math.max(0, Math.trunc(options.minDwellMs ?? STATUS_MIN_DWELL_MS));
		this.reducedMotion = options.reducedMotion === true;
		this.stableText = cleanStatusText(initialText);
		this.stableSince = nowMs;
	}

	setTarget(text: string, nowMs: number): StatusTransitionSnapshot {
		const target = cleanStatusText(text);
		if (!target) return this.snapshot(nowMs);
		if (this.reducedMotion) {
			this.stableText = target;
			this.stableSince = nowMs;
			this.pendingText = undefined;
			this.transition = undefined;
			return this.snapshot(nowMs);
		}
		const activeTarget = this.transition?.to ?? this.pendingText ?? this.stableText;
		if (target === activeTarget) return this.snapshot(nowMs);
		if (this.transition) {
			// Retarget an in-flight bridge from its current visible word. This
			// coalesces bursts without making the UI finish obsolete states first.
			const visible = cleanStatusText(this.snapshot(nowMs).text) || this.transition.from;
			this.transition = { from: visible, to: target, startedAt: nowMs };
			this.pendingText = undefined;
			return this.snapshot(nowMs);
		}
		this.pendingText = target;
		this.advance(nowMs);
		return this.snapshot(nowMs);
	}

	advance(nowMs: number): StatusTransitionSnapshot {
		if (this.transition) {
			const elapsed = Math.max(0, nowMs - this.transition.startedAt);
			if (elapsed >= this.frameMs * this.frames) {
				this.stableText = this.transition.to;
				this.stableSince = this.transition.startedAt + this.frameMs * this.frames;
				this.transition = undefined;
			}
		}
		if (!this.transition && this.pendingText && this.pendingText !== this.stableText) {
			if (nowMs - this.stableSince >= this.minDwellMs) {
				const target = this.pendingText;
				this.pendingText = undefined;
				this.transition = { from: this.stableText, to: target, startedAt: nowMs };
			}
		}
		return this.snapshot(nowMs);
	}

	isActive(): boolean {
		return this.transition !== undefined || (this.pendingText !== undefined && this.pendingText !== this.stableText);
	}

	currentTarget(): string {
		return this.transition?.to ?? this.pendingText ?? this.stableText;
	}

	private snapshot(nowMs: number): StatusTransitionSnapshot {
		if (!this.transition) {
			return {
				text: this.stableText,
				stableText: this.stableText,
				targetText: this.pendingText ?? this.stableText,
				transitioning: false,
				phase: 0,
			};
		}
		const elapsed = Math.max(0, nowMs - this.transition.startedAt);
		const phase = Math.min(this.frames - 1, Math.floor(elapsed / this.frameMs));
		return {
			text: glitchBridge(this.transition.from, this.transition.to, phase, this.frames),
			stableText: this.stableText,
			targetText: this.transition.to,
			transitioning: true,
			phase,
		};
	}
}

/** A restrained Zalgo bridge: at most one combining mark above and below. */
export function glitchBridge(from: string, to: string, phase: number, frameCount = STATUS_TRANSITION_FRAMES): string {
	const left = cleanStatusText(from);
	const right = cleanStatusText(to);
	if (!left) return right;
	if (!right || frameCount <= 1) return right || left;
	const normalizedPhase = Math.max(0, Math.min(frameCount - 1, Math.trunc(phase)));
	const progress = (normalizedPhase + 1) / (frameCount + 1);
	const length = Math.max([...left].length, [...right].length);
	const leftChars = [...left.padEnd(length)];
	const rightChars = [...right.padEnd(length)];
	const pivot = Math.round(length * progress);
	const mixed = rightChars.map((char, index) => index < pivot ? char : leftChars[index] ?? char);
	return mixed.map((char, index) => {
		if (!/[\p{L}\p{N}]/u.test(char) || (index + normalizedPhase) % 3 !== 0) return char;
		const above = ABOVE_MARKS[(index + normalizedPhase) % ABOVE_MARKS.length]!;
		const below = BELOW_MARKS[(index * 2 + normalizedPhase) % BELOW_MARKS.length]!;
		return `${char}${above}${below}`;
	}).join("").trimEnd();
}

export function cleanStatusText(text: string): string {
	return text
		.replace(CONTROL_OR_ANSI, "")
		.replace(COMBINING_MARKS, "")
		.replace(/[\r\n\t]+/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

export interface StatusTimingSample {
	state: string;
	durationMs: number;
}

export interface StatusTimingSummary {
	state: string;
	count: number;
	totalMs: number;
	minMs: number;
	meanMs: number;
	p50Ms: number;
	p95Ms: number;
	maxMs: number;
}

/** Records real event-to-event dwell times for /status-timings and evals. */
export class StatusTimingRecorder {
	private currentState: string;
	private enteredAt: number;
	private readonly samples: StatusTimingSample[] = [];

	constructor(initialState = "settled", nowMs = 0) {
		this.currentState = initialState;
		this.enteredAt = nowMs;
	}

	transition(state: string, nowMs: number): void {
		if (!state || state === this.currentState) return;
		this.samples.push({ state: this.currentState, durationMs: Math.max(0, nowMs - this.enteredAt) });
		this.currentState = state;
		this.enteredAt = nowMs;
	}

	reset(state = this.currentState, nowMs = 0): void {
		this.samples.length = 0;
		this.currentState = state;
		this.enteredAt = nowMs;
	}

	summaries(nowMs?: number): StatusTimingSummary[] {
		const samples = [...this.samples];
		if (nowMs !== undefined) samples.push({ state: this.currentState, durationMs: Math.max(0, nowMs - this.enteredAt) });
		const byState = new Map<string, number[]>();
		for (const sample of samples) {
			const values = byState.get(sample.state) ?? [];
			values.push(sample.durationMs);
			byState.set(sample.state, values);
		}
		return [...byState.entries()].map(([state, values]) => summarize(state, values)).sort((a, b) => a.state.localeCompare(b.state));
	}
}

function summarize(state: string, values: number[]): StatusTimingSummary {
	const sorted = [...values].sort((a, b) => a - b);
	const totalMs = sorted.reduce((sum, value) => sum + value, 0);
	return {
		state,
		count: sorted.length,
		totalMs,
		minMs: sorted[0] ?? 0,
		meanMs: sorted.length > 0 ? totalMs / sorted.length : 0,
		p50Ms: percentile(sorted, 0.5),
		p95Ms: percentile(sorted, 0.95),
		maxMs: sorted[sorted.length - 1] ?? 0,
	};
}

function percentile(sorted: number[], value: number): number {
	if (sorted.length === 0) return 0;
	return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * value) - 1))]!;
}
