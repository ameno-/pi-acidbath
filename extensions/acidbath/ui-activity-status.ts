/**
 * One persistent two-lane activity surface.
 *
 * The left lane is exclusively reserved for the shimmering reasoning preview.
 * Lyrics and every other lifecycle state share a right-aligned lane whose
 * words transition through a restrained, deterministic glitch bridge.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, type Component, type TUI } from "@earendil-works/pi-tui";
import type { OrbState } from "./ui-orb.ts";

export const ACTIVITY_STATUS_WIDGET_KEY = "acidbath-activity-status";

const MAX_PREVIEW_CHARS = 240;
const REASONING_GLOW_INTERVAL_MS = 112;
const CONTROL_OR_ANSI = /\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1b\\))|[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g;
const GLOW_PHASES = ["dim", "muted", "accent", "bold", "accent", "muted"] as const;

export interface ActivityStatusUpdate {
	visible?: boolean;
	workingState?: OrbState;
	message?: string;
	lyric?: string;
	contentMode?: "status" | "lyric";
	reasoningActive?: boolean;
	reasoningPreview?: string;
	statusActive?: boolean;
}

interface ActivityStatusState {
	visible: boolean;
	workingState: OrbState;
	message: string;
	lyric: string;
	contentMode: "status" | "lyric";
	reasoningActive: boolean;
	reasoningPreview: string;
	statusActive: boolean;
}

const INITIAL_STATE: ActivityStatusState = {
	visible: true,
	workingState: "working",
	message: "settled",
	lyric: "",
	contentMode: "status",
	reasoningActive: false,
	reasoningPreview: "",
	statusActive: false,
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
		if (block.type === "thinking" && typeof block.thinking === "string" && block.thinking.trim()) {
			return block.thinking;
		}
	}
	return undefined;
}

/** Build a terminal-safe, one-line tail preview without mutating source content. */
export function thinkingPreview(text: string | undefined, maxChars = MAX_PREVIEW_CHARS): string {
	if (!text || maxChars <= 0) return "";
	const normalized = text
		.replace(CONTROL_OR_ANSI, "")
		.replace(/[\r\n\t]+/g, " ")
		.replace(/\s+/g, " ")
		.trim();
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
	private timer: ReturnType<typeof setInterval> | undefined;

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
		this.syncTimer();
		this.tui.requestRender();
	}

	render(width: number): string[] {
		const statusActive = this.state.statusActive || this.hasActiveMessage();
		if (!this.state.visible || (!this.state.reasoningActive && !statusActive) || width <= 0) return [];
		const safeWidth = Math.max(1, Math.trunc(width));
		const label = this.activityLabel();
		const detail = this.state.reasoningActive ? this.state.reasoningPreview || "…" : this.state.message || "…";
		return [truncateToWidth(`◇ ${this.glowingLabel(label)}  ${this.muted(detail)}`, safeWidth)];
	}

	invalidate(): void {
		// Theme functions are evaluated at render time; there is no baked cache.
	}

	dispose(): void {
		if (this.timer !== undefined) clearInterval(this.timer);
		this.timer = undefined;
	}

	private activityLabel(): string {
		if (this.state.reasoningActive) return "reasoning";
		switch (this.state.workingState) {
			case "listening": return "listening";
			case "searching": return "searching";
			case "shaping": return "editing";
			case "composing": return "composing";
			default: return "working";
		}
	}

	private statusColor(): "accent" | "warning" | "success" {
		if (this.state.workingState === "listening" || this.state.workingState === "searching") return "accent";
		if (this.state.workingState === "composing") return "success";
		return "warning";
	}

	private glowingLabel(text: string): string {
		if (this.noColor || this.reducedMotion) return text;
		const phase = GLOW_PHASES[this.glowPhase % GLOW_PHASES.length]!;
		const color = phase === "accent" || phase === "bold" ? this.statusColor() : phase;
		if (phase === "bold") return this.theme.bold(this.theme.fg(color, text));
		return this.theme.fg(color, text);
	}

	private muted(text: string): string {
		return this.noColor ? text : this.theme.fg("muted", text);
	}

	private hasActiveMessage(): boolean {
		const message = this.state.message.trim().toLowerCase();
		return message.length > 0 && !["settled", "done", "turn complete", "context compacted"].includes(message);
	}

	private syncTimer(): void {
		const shouldRun = this.state.visible && !this.reducedMotion && (this.state.reasoningActive || this.state.statusActive || this.hasActiveMessage());
		if (shouldRun && this.timer === undefined) {
			this.timer = setInterval(() => {
				this.glowPhase = (this.glowPhase + 1) % GLOW_PHASES.length;
				this.tui.requestRender();
			}, REASONING_GLOW_INTERVAL_MS);
		} else if (!shouldRun && this.timer !== undefined) {
			clearInterval(this.timer);
			this.timer = undefined;
			this.glowPhase = 0;
		}
	}
}

function sameState(left: ActivityStatusState, right: ActivityStatusState): boolean {
	return left.visible === right.visible
		&& left.workingState === right.workingState
		&& left.message === right.message
		&& left.lyric === right.lyric
		&& left.contentMode === right.contentMode
		&& left.reasoningActive === right.reasoningActive
		&& left.reasoningPreview === right.reasoningPreview
		&& left.statusActive === right.statusActive;
}
