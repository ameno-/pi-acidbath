/** Deterministic motion helpers for Pi tool lifecycle rendering. */

export type ToolMotionState = "pending" | "success" | "error";

// Every pending frame is four visible cells. The animated rail is rendered
// separately from the status text, so the tool target and lifecycle color never
// shift. Individual tools can opt into a distinct rail or no rail at all.
export const TOOL_PENDING_FRAMES = ["·   ", "∘   ", "○   ", "●   "] as const;
const SEARCH_FRAMES = ["·   ", "· · ", "⋅⋅  ", "· · "] as const;
const SHAPE_FRAMES = ["✦   ", "✧   ", "⋄   ", "✧   "] as const;
const COMMAND_FRAMES = [">   ", "»   ", "›   ", "»   "] as const;

export type ToolMotionStyle = "default" | "search" | "shape" | "command" | "none";

const TOOL_MOTION_STYLES: Readonly<Record<string, ToolMotionStyle>> = {
	read: "search",
	grep: "search",
	find: "search",
	ls: "none",
	edit: "shape",
	write: "shape",
	bash: "command",
};

export const TOOL_SUCCESS_GLYPH = "✓";
export const TOOL_ERROR_GLYPH = "×";
export const TOOL_MOTION_INTERVAL_MS = 100;

export type MotionInvalidate = () => void;

/** One shared clock for editor lifecycle and tool-row animation. */
export class MotionClock {
	private readonly subscribers = new Map<string, MotionInvalidate>();
	private readonly reducedMotion: boolean;
	private timer: ReturnType<typeof setInterval> | undefined;
	private phase = 0;
	private frozenPhase: number | undefined;

	constructor(reducedMotion: boolean, initialFrozenPhase?: number) {
		this.reducedMotion = reducedMotion;
		this.frozenPhase = initialFrozenPhase;
		if (initialFrozenPhase !== undefined) this.phase = initialFrozenPhase;
	}

	public currentPhase(): number {
		return this.frozenPhase ?? this.phase;
	}

	public subscribe(id: string, invalidate: MotionInvalidate): void {
		this.subscribers.set(id, invalidate);
		this.syncTimer();
	}

	public unsubscribe(id: string): void {
		this.subscribers.delete(id);
		this.syncTimer();
	}

	public setFrozenPhase(phase: number | undefined): void {
		this.frozenPhase = phase;
		if (phase !== undefined) this.phase = phase;
		this.syncTimer();
		this.invalidateAll();
	}

	public modeLabel(): string {
		if (this.reducedMotion) return "reduced";
		return this.frozenPhase === undefined ? "live" : `frame ${this.frozenPhase}`;
	}

	public dispose(): void {
		if (this.timer !== undefined) clearInterval(this.timer);
		this.timer = undefined;
		this.subscribers.clear();
	}

	private syncTimer(): void {
		const shouldRun = !this.reducedMotion && this.frozenPhase === undefined && this.subscribers.size > 0;
		if (shouldRun && this.timer === undefined) {
			this.timer = setInterval(() => {
				this.phase = nextMotionPhase(this.phase, TOOL_PENDING_FRAMES.length);
				this.invalidateAll();
			}, TOOL_MOTION_INTERVAL_MS);
		} else if (!shouldRun && this.timer !== undefined) {
			clearInterval(this.timer);
			this.timer = undefined;
		}
	}

	private invalidateAll(): void {
		for (const invalidate of this.subscribers.values()) invalidate();
	}
}

export function normalizeMotionPhase(phase: number, frameCount: number): number {
	if (!Number.isFinite(phase) || frameCount <= 0) return 0;
	const integer = Math.trunc(phase);
	return ((integer % frameCount) + frameCount) % frameCount;
}

export function nextMotionPhase(phase: number, frameCount: number): number {
	return normalizeMotionPhase(phase + 1, frameCount);
}

export function parseMotionPhase(value: string | undefined): number | undefined {
	if (value === undefined || value.trim() === "") return undefined;
	if (!/^\d+$/.test(value.trim())) return undefined;
	const phase = Number(value);
	return phase >= 0 && phase < TOOL_PENDING_FRAMES.length ? phase : undefined;
}

export function toolMotionGlyph(state: ToolMotionState, phase: number, reducedMotion: boolean): string {
	return toolMotionGlyphForTool(undefined, state, phase, reducedMotion);
}

export function toolMotionGlyphForTool(
	toolName: string | undefined,
	state: ToolMotionState,
	phase: number,
	reducedMotion: boolean,
): string {
	if (state === "success") return TOOL_SUCCESS_GLYPH;
	if (state === "error") return TOOL_ERROR_GLYPH;
	const style = toolName ? TOOL_MOTION_STYLES[toolName] ?? "default" : "default";
	if (style === "none") return "    ";
	const frames = style === "search"
		? SEARCH_FRAMES
		: style === "shape"
			? SHAPE_FRAMES
			: style === "command"
			? COMMAND_FRAMES
			: TOOL_PENDING_FRAMES;
	const selectedPhase = reducedMotion ? 0 : normalizeMotionPhase(phase, frames.length);
	return frames[selectedPhase]!;
}

export function toolMotionStyle(toolName: string): ToolMotionStyle {
	return TOOL_MOTION_STYLES[toolName] ?? "default";
}
