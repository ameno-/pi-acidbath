/** One transient activity rail above the editor. */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, type Component, type TUI } from "@earendil-works/pi-tui";

export const ACTIVITY_STATUS_WIDGET_KEY = "acidbath-activity-status";

const MAX_PREVIEW_CHARS = 240;
const REASONING_GLOW_INTERVAL_MS = 112;
const CONTROL_OR_ANSI = /\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1b\\))|[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g;
const GLOW_PHASES = ["dim", "muted", "accent", "bold", "accent", "muted"] as const;

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
	const normalized = text.replace(CONTROL_OR_ANSI, "").replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
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
		const active = this.state.reasoningActive || this.hasActiveMessage();
		if (!this.state.visible || !active || width <= 0) return [];
		const detail = this.state.reasoningActive ? this.state.reasoningPreview || "…" : this.state.message || "…";
		return [truncateToWidth(`◇ ${this.glowingLabel(this.state.reasoningActive ? "reasoning" : this.state.kind)}  ${this.muted(detail)}`, Math.max(1, Math.trunc(width)))];
	}

	invalidate(): void {}

	dispose(): void {
	if (this.timer !== undefined) clearInterval(this.timer);
	this.timer = undefined;
	}

	private glowingLabel(text: string): string {
		if (this.noColor || this.reducedMotion) return text;
		const phase = GLOW_PHASES[this.glowPhase % GLOW_PHASES.length]!;
		const color = phase === "accent" || phase === "bold" ? this.statusColor() : phase;
		return phase === "bold" ? this.theme.bold(this.theme.fg(color, text)) : this.theme.fg(color, text);
	}

	private statusColor(): "accent" | "warning" | "success" {
		if (this.state.kind === "listening" || this.state.kind === "searching") return "accent";
		if (this.state.kind === "composing") return "success";
		return "warning";
	}

	private muted(text: string): string {
		return this.noColor ? text : this.theme.fg("muted", text);
	}

	private hasActiveMessage(): boolean {
		return !["", "settled", "done", "turn complete", "context compacted"].includes(this.state.message.trim().toLowerCase());
	}

	private syncTimer(): void {
		const shouldRun = this.state.visible && !this.reducedMotion && (this.state.reasoningActive || this.hasActiveMessage());
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
		&& left.kind === right.kind
		&& left.message === right.message
		&& left.reasoningActive === right.reasoningActive
		&& left.reasoningPreview === right.reasoningPreview;
}
