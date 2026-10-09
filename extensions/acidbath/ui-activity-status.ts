/** One transient activity rail above the editor. */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, type Component, type TUI } from "@earendil-works/pi-tui";
import { STATUS_LUMPY } from "./rendering/kaomoji.ts";
import { isGenericMessage } from "./ui-lyrics.ts";

export const ACTIVITY_STATUS_WIDGET_KEY = "acidbath-activity-status";

const MAX_PREVIEW_CHARS = 240;
// Phase advances on real lifecycle events, not on a timer. The minimum
// interval prevents strobing during fast token-by-token streaming.
const MIN_PHASE_ADVANCE_MS = 80;
const CONTROL_OR_ANSI = /\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1b\\))|[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g;
const GLOW_PHASES = ["dim", "muted", "accent", "bold", "accent", "muted"] as const;

export interface ActivityStatusUpdate {
	visible?: boolean;
	kind?: string;
	message?: string;
	reasoningActive?: boolean;
	reasoningPreview?: string;
	/** Live child agents, already formatted as "name · task". Empty hides the line. */
	agents?: readonly string[];
}

interface ActivityStatusState {
	visible: boolean;
	kind: string;
	message: string;
	reasoningActive: boolean;
	reasoningPreview: string;
	agents: readonly string[];
}

const INITIAL_STATE: ActivityStatusState = {
	visible: true,
	kind: "working",
	message: "settled",
	reasoningActive: false,
	reasoningPreview: "",
	agents: [],
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
		const active = this.state.reasoningActive || this.isActiveKind();
		const agents = this.state.agents.filter((agent) => agent.trim().length > 0);
		const settledNote = !active && !isGenericMessage(this.state.message) ? this.state.message : "";
		if (!active && agents.length === 0 && !settledNote) return [];

		const lines: string[] = [];
		if (active) {
			const phase = this.state.reasoningActive ? "reasoning" : this.state.kind;
			const detail = this.state.reasoningActive
				? this.state.reasoningPreview || ""
				: isGenericMessage(this.state.message) ? "" : this.state.message;
			const face = this.noColor ? "" : `${this.face()} `;
			const label = this.phaseLabel(phase);
			const detailText = detail ? `  ${this.muted(detail)}` : "";
			lines.push(truncateToWidth(`${face}${label}${detailText}`, safeWidth));
		}
		if (!active && settledNote) {
			lines.push(truncateToWidth(this.muted(settledNote), safeWidth));
		}
		if (agents.length > 0) {
			const shown = agents.slice(0, 3);
			const extra = agents.length - shown.length;
			const body = shown.join("  ·  ");
			const suffix = extra > 0 ? `  +${extra}` : "";
			const prefix = this.noColor ? "agents  " : `${this.theme.fg("muted", "agents")}  `;
			lines.push(truncateToWidth(`${prefix}${body}${suffix}`, safeWidth));
		}
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

	/** The one face in the interface. It marks the live phase and nowhere else. */
	private face(): string {
		if (this.reducedMotion) return STATUS_LUMPY;
		const phase = GLOW_PHASES[this.glowPhase % GLOW_PHASES.length]!;
		const color = phase === "accent" || phase === "bold" ? this.statusColor() : phase;
		const painted = phase === "bold" ? this.theme.bold(this.theme.fg(color, STATUS_LUMPY)) : this.theme.fg(color, STATUS_LUMPY);
		return painted;
	}

	private phaseLabel(phase: string): string {
		const label = PHASE_LABELS[phase] ?? phase;
		if (this.noColor) return label;
		return this.theme.fg(this.statusColor(), label);
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

const PHASE_LABELS: Record<string, string> = {
	preparing: "preparing",
	listening: "listening",
	reasoning: "reasoning",
	composing: "composing",
	tool: "running",
	compacting: "compacting",
	error: "error",
	working: "working",
	editing: "editing",
};

function sameAgents(left: readonly string[], right: readonly string[]): boolean {
	return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sameState(left: ActivityStatusState, right: ActivityStatusState): boolean {
	return left.visible === right.visible
		&& left.kind === right.kind
		&& left.message === right.message
		&& left.reasoningActive === right.reasoningActive
		&& left.reasoningPreview === right.reasoningPreview
		&& sameAgents(left.agents, right.agents);
}
