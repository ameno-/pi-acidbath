/** One transient activity rail above the editor. */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, type Component, type TUI } from "@earendil-works/pi-tui";
import { isGenericMessage, lyricFor, lyricKind, LYRIC_MAX_VISIBLE_WIDTH, type LyricKind } from "./ui-lyrics.ts";

export const ACTIVITY_STATUS_WIDGET_KEY = "acidbath-activity-status";

/**
 * Preview length for the collapsed thinking block.
 *
 * This is a preview, not a transcript. The default used to be 240 characters,
 * which packed a paragraph of reasoning onto a one-line status rail and made
 * it the widest, most restless thing on screen.
 */
const MAX_PREVIEW_CHARS = intFromEnv("PI_ACIDBATH_THINKING_PREVIEW_CHARS", 72);

/**
 * Minimum gap between glow-phase advances.
 *
 * Phase advances on real lifecycle events, which during token-by-token
 * thinking arrive continuously. At 80ms that is twelve and a half colour
 * changes a second across a six-step palette — a strobe, not a pulse. The
 * default is a calm cadence: the rail breathes rather than flickers.
 */
const MIN_PHASE_ADVANCE_MS = intFromEnv("PI_ACIDBATH_THINKING_PHASE_MS", 700);
const CONTROL_OR_ANSI = /\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1b\\))|[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g;
const GLOW_PHASES = ["dim", "muted", "accent", "bold", "accent", "muted"] as const;

function intFromEnv(name: string, fallback: number): number {
	const raw = process.env[name];
	if (typeof raw !== "string" || raw.trim() === "") return fallback;
	const parsed = Number.parseInt(raw, 10);
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

const RAIL_PREFIX = "◇ ";
const DETAIL_INDENT = "  ";

/**
 * Layout for the activity rail.
 *
 * The rail mixes two kinds of content with opposite natures: the lyric is ours
 * and stable, the reasoning tail is not and changes on every streamed token.
 * Sharing one line lets the unstable half push the stable half around, and
 * near the wrap boundary the line count flips and everything below it jumps.
 *
 * So they get separate lines. Line one holds fixed content only and never
 * moves. The reasoning gets its own clipped slot on line two, which is always
 * exactly one line: elided to fit, never wrapped. The rail's geometry is
 * therefore constant while reasoning runs; only its text changes.
 */
export type ThinkingLayout = "two-line" | "inline";

export function railLayout(): ThinkingLayout {
	return process.env.PI_ACIDBATH_THINKING_LAYOUT === "inline" ? "inline" : "two-line";
}

/** Pure render of the rail: label, detail and width to lines. */
export function renderRailLines(
	label: string,
	detail: string,
	width: number,
	style: { layout: ThinkingLayout },
): string[] {
	const safeWidth = Math.max(1, Math.trunc(width));
	const head = truncateToWidth(`${RAIL_PREFIX}${label}`, safeWidth);
	if (!detail) return [head];
	if (style.layout === "inline") return [truncateToWidth(`${head}${DETAIL_INDENT}${detail}`, safeWidth)];
	const slot = safeWidth - DETAIL_INDENT.length;
	if (slot <= 0) return [head];
	return [head, truncateToWidth(`${DETAIL_INDENT}${detail}`, safeWidth)];
}

export interface ActivityStatusUpdate {
	visible?: boolean;
	kind?: string;
	message?: string;
	reasoningActive?: boolean;
	reasoningPreview?: string;
}

interface ActivityStatusState {
	visible: boolean;
	kind: string;
	message: string;
	reasoningActive: boolean;
	reasoningPreview: string;
}

const INITIAL_STATE: ActivityStatusState = {
	visible: true,
	kind: "working",
	message: "settled",
	reasoningActive: false,
	reasoningPreview: "",
};

/** Return the latest provider-supplied thinking block from an assistant message. */
export function thinkingTextFromMessage(message: unknown): string | undefined {
	if (!message || typeof message !== "object") return undefined;
	const value = message as Record<string, unknown>;
	if (value.role !== "assistant" || !Array.isArray(value.content)) return undefined;
	for (let index = value.content.length - 1; index >= 0; index--) {
		const part = value.content[index];
		if (!part || typeof part !== "object") continue;
		const block = part as Record<string, unknown>;
		if (block.type === "thinking" && typeof block.thinking === "string" && block.thinking.trim()) return block.thinking;
	}
	return undefined;
}

/** Build a terminal-safe, one-line tail preview without mutating source content. */
export function thinkingPreview(text: string | undefined, maxChars = MAX_PREVIEW_CHARS): string {
	if (!text || maxChars <= 0) return "";
	// Provider messages contain the entire accumulated thinking block on each
	// delta. Only its tail can be visible, so avoid repeatedly normalizing an
	// ever-growing string (quadratic work over a long response).
	const sampleLimit = Math.max(maxChars * 8, maxChars + 256);
	const sample = text.length > sampleLimit ? text.slice(-sampleLimit) : text;
	const normalized = sample.replace(CONTROL_OR_ANSI, "").replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
	if (normalized.length <= maxChars) return normalized;
	if (maxChars === 1) return "…";
	let tail = normalized.slice(-(maxChars - 1));
	const firstSpace = tail.indexOf(" ");
	if (firstSpace > 0 && firstSpace < Math.floor(maxChars / 3)) tail = tail.slice(firstSpace + 1);
	return `…${tail}`;
}

export class AcidbathActivityStatus implements Component {
	private readonly tui: TUI;
	private readonly theme: Theme;
	private readonly reducedMotion: boolean;
	private readonly noColor: boolean;
	private state: ActivityStatusState = { ...INITIAL_STATE };
	private glowPhase = 0;
	private lastPhaseAdvanceAt = 0;
	private cachedWidth: number | undefined;
	private cachedLines: string[] | undefined;

	constructor(tui: TUI, theme: Theme, reducedMotion: boolean, noColor: boolean) {
		this.tui = tui;
		this.theme = theme;
		this.reducedMotion = reducedMotion;
		this.noColor = noColor;
	}

	update(update: ActivityStatusUpdate): void {
		const next = { ...this.state, ...update };
		if (sameState(this.state, next)) return;
		this.state = next;
		this.clearRenderCache();
		// Advance the glow phase on every real state change (lifecycle
		// events already trigger tui.requestRender through the caller).
		// Throttle so fast streaming doesn't strobe through the palette.
		const now = performance.now();
		if (now - this.lastPhaseAdvanceAt >= MIN_PHASE_ADVANCE_MS) {
			this.glowPhase = (this.glowPhase + 1) % GLOW_PHASES.length;
			this.lastPhaseAdvanceAt = now;
		}
		this.tui.requestRender();
	}

	render(width: number): string[] {
		if (width <= 0) return [];
		const safeWidth = Math.max(1, Math.trunc(width));
		if (this.cachedLines && this.cachedWidth === safeWidth) return this.cachedLines;
		if (!this.state.visible) return [];
		if (!this.state.reasoningActive && !this.isActiveKind()) return [];

		// Resolve the lyric set from the current lifecycle kind.
		const rawKind = this.state.reasoningActive ? "reasoning" : this.state.kind;
		const kind: LyricKind = lyricKind(rawKind);

		let label: string;
		if (this.noColor) {
			label = rawKind;
		} else {
			const lyric = lyricFor(kind, this.glowPhase);
			label = this.glowingLabel(truncateToWidth(lyric, LYRIC_MAX_VISIBLE_WIDTH));
		}

		// Detail is shown only when it adds specific information the lyric
		// doesn't convey (file paths, commands, result stats).
		const detail = this.state.reasoningActive
			? this.state.reasoningPreview || ""
			: isGenericMessage(this.state.message) ? "" : this.state.message;
		const lines = renderRailLines(label, detail, safeWidth, {
			layout: railLayout(),
		});
		this.cachedWidth = safeWidth;
		this.cachedLines = lines;
		return lines;
	}

	invalidate(): void {
		this.clearRenderCache();
	}

	dispose(): void {
		// No timer to release — the phase advances on real events.
		this.glowPhase = 0;
		this.clearRenderCache();
	}

	private glowingLabel(text: string): string {
		if (this.noColor || this.reducedMotion) return text;
		const phase = GLOW_PHASES[this.glowPhase % GLOW_PHASES.length]!;
		const color = phase === "accent" || phase === "bold" ? this.statusColor() : phase;
		return phase === "bold" ? this.theme.bold(this.theme.fg(color, text)) : this.theme.fg(color, text);
	}

	private statusColor(): "accent" | "warning" | "success" {
		if (this.state.kind === "listening") return "accent";
		if (this.state.kind === "composing") return "success";
		return "warning";
	}

	private muted(text: string): string {
		return this.noColor ? text : this.theme.fg("muted", text);
	}

	/** True when the lifecycle kind represents active work that should show the widget. */
	private isActiveKind(): boolean {
		return this.state.kind !== "settled" && this.state.kind !== "done" && this.state.kind !== "";
	}

	private clearRenderCache(): void {
		this.cachedWidth = undefined;
		this.cachedLines = undefined;
	}
}

function sameState(left: ActivityStatusState, right: ActivityStatusState): boolean {
	return left.visible === right.visible
		&& left.kind === right.kind
		&& left.message === right.message
		&& left.reasoningActive === right.reasoningActive
		&& left.reasoningPreview === right.reasoningPreview;
}
