/** Deterministic motion helpers for Pi tool lifecycle rendering. */

export type ToolMotionState = "pending" | "success" | "error";

export const TOOL_PENDING_FRAMES = ["·", "∙", "●", "∙"] as const;
export const TOOL_SUCCESS_GLYPH = "✓";
export const TOOL_ERROR_GLYPH = "×";
export const TOOL_MOTION_INTERVAL_MS = 100;

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
	if (state === "success") return TOOL_SUCCESS_GLYPH;
	if (state === "error") return TOOL_ERROR_GLYPH;
	const selectedPhase = reducedMotion ? 0 : normalizeMotionPhase(phase, TOOL_PENDING_FRAMES.length);
	return TOOL_PENDING_FRAMES[selectedPhase]!;
}
