import { basename } from "node:path";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { formatContextRail, formatTurnUsage, type TokenContextState } from "./ui-token-context.ts";
import { truncateToWidth, visibleWidth } from "./ui-gauge.ts";
import { STATUS_TRANSITION_FRAME_MS, StatusTransitionTimeline } from "./ui-status-transition.ts";

export interface AcidbathFooterState {
	modelName?: string;
	/** Current Git branch; a dash is used while the async lookup is pending. */
	branchName?: string;
	thinkingLevel?: string;
	/** Legacy/widget-only normalized context value. The default footer uses a rail. */
	contextPercent?: number;
	contextVisible: boolean;
	workingState?: string;
	workingMessage?: string;
	activityText?: string;
	tokenContext?: TokenContextState;
}

const DEFAULT_STATE: AcidbathFooterState = {
	contextVisible: true,
	branchName: "—",
	thinkingLevel: "default",
	activityText: "…",
};

const ACTIVITY_SLOT_WIDTH = 44;
const CONTEXT_SLOT_WIDTH = 20;
const TOKEN_USAGE_SLOT_WIDTH = 16;

export class AcidbathFooter implements Component {
	private readonly tui: TUI;
	private readonly theme: Theme;
	private readonly cwd: string;
	private readonly noColor: boolean;
	private readonly activityTransition: StatusTransitionTimeline;
	private activityTimer: ReturnType<typeof setInterval> | undefined;
	private state: AcidbathFooterState;

	constructor(tui: TUI, theme: Theme, cwd: string, noColor: boolean) {
		this.tui = tui;
		this.theme = theme;
		this.cwd = cwd;
		this.noColor = noColor;
		this.state = { ...DEFAULT_STATE };
		this.activityTransition = new StatusTransitionTimeline(this.activityTarget(), Date.now(), {
			reducedMotion: process.env.PI_ACIDBATH_REDUCED_MOTION === "1",
		});
	}

	public update(next: Partial<AcidbathFooterState>): void {
		this.state = { ...this.state, ...next };
		this.activityTransition.setTarget(this.activityTarget(), Date.now());
		this.syncActivityTimer();
		this.tui.requestRender();
	}

	public render(width: number): string[] {
		const safeWidth = Math.max(1, Math.trunc(width));
		const model = this.state.modelName || "model";
		const location = basename(this.cwd) || this.cwd;
		const contextWidth = CONTEXT_SLOT_WIDTH;
		const activityWidth = safeWidth >= 140
			? ACTIVITY_SLOT_WIDTH
			: safeWidth >= 80
				? 32
				: Math.max(20, safeWidth - contextWidth - 2);
		const context = this.state.contextVisible ? this.contextLabel(contextWidth) : "";
		const activity = this.activitySlot(activityWidth);
		const usage = this.terminalUsage();
		const fullLeft = this.fullIdentity(location, model);
		const fullRight = [activity, context, usage].filter(Boolean).join(" ");

		const full = this.fit(fullLeft, fullRight, safeWidth);
		if (full) return [this.renderParts(full.left, full.right, safeWidth)];
		const compactRight = [activity, context, usage].filter(Boolean).join(" ");
		const compact = this.fit(this.compactIdentity(location, model), compactRight, safeWidth);
		if (compact) return [this.renderParts(compact.left, compact.right, safeWidth)];
		const dockOnly = this.fit("", compactRight, safeWidth);
		if (dockOnly) return [this.renderParts(dockOnly.left, dockOnly.right, safeWidth)];
		const statusLyricRight = [activity, context].filter(Boolean).join(" ");
		const statusLyricDock = this.fit("", statusLyricRight, safeWidth);
		if (statusLyricDock) return [this.renderParts(statusLyricDock.left, statusLyricDock.right, safeWidth)];
		const lyricRight = [activity, context].filter(Boolean).join(" ");
		const activityAndContext = this.fit("acidbath", lyricRight, safeWidth);
		if (activityAndContext) return [this.renderParts(activityAndContext.left, activityAndContext.right, safeWidth)];
		const lyricDockOnly = this.fit("", lyricRight, safeWidth);
		if (lyricDockOnly) return [this.renderParts(lyricDockOnly.left, lyricDockOnly.right, safeWidth)];
		const contextOnly = this.fit("acidbath", context, safeWidth);
		if (contextOnly) return [this.renderParts(contextOnly.left, contextOnly.right, safeWidth)];

		return [truncateToWidth(this.leftColor("acidbath", "muted"), safeWidth)];
	}

	public invalidate(): void {
		// The footer has no render cache.
	}

	public dispose(): void {
		if (this.activityTimer !== undefined) clearInterval(this.activityTimer);
		this.activityTimer = undefined;
	}

	private fullIdentity(location: string, model: string): string {
		const directory = location === "acidbath" ? "acidbath" : `acidbath · ${location}`;
		return [
			this.leftColor(directory, "muted"),
			this.leftColor(model, "error"),
			this.leftColor(`⌘ ${this.state.branchName || "—"}`, "warning"),
		].join(" · ");
	}

	private compactIdentity(location: string, model: string): string {
		return [
			this.leftColor(location, "muted"),
			this.leftColor(model, "error"),
			this.leftColor(`⌘ ${this.state.branchName || "—"}`, "warning"),
		].join(" · ");
	}

	private leftColor(value: string, color: "muted" | "error" | "warning"): string {
		return this.noColor ? value : this.theme.fg(color, value);
	}

	private activityTarget(): string {
		const candidate = `♪ ${this.state.activityText?.trim() || "…"}`;
		return visibleWidth(candidate) <= ACTIVITY_SLOT_WIDTH ? candidate : "♪ …";
	}

	private activitySlot(width = ACTIVITY_SLOT_WIDTH): string {
		const text = this.activityTransition.advance(Date.now()).text;
		const clipped = visibleWidth(text) <= width ? text : "♪ …";
		const remaining = Math.max(0, width - visibleWidth(clipped));
		const left = Math.floor(remaining / 2);
		return `${" ".repeat(left)}${clipped}${" ".repeat(remaining - left)}`;
	}

	private syncActivityTimer(): void {
		const shouldRun = this.activityTransition.isActive();
		if (shouldRun && this.activityTimer === undefined) {
			this.activityTimer = setInterval(() => {
				this.activityTransition.advance(Date.now());
				this.tui.requestRender();
				this.syncActivityTimer();
			}, STATUS_TRANSITION_FRAME_MS);
		} else if (!shouldRun && this.activityTimer !== undefined) {
			clearInterval(this.activityTimer);
			this.activityTimer = undefined;
		}
	}

	private terminalUsage(): string {
		const turn = formatTurnUsage(this.state.tokenContext?.facts ?? null).replace(/^turn /, "");
		return `${turn}${" ".repeat(Math.max(0, TOKEN_USAGE_SLOT_WIDTH - visibleWidth(turn)))}`;
	}

	private contextLabel(width: number): string {
		if (this.state.tokenContext) return formatContextRail(this.state.tokenContext, width, this.state.tokenContext.motionReduced);
		const slots = Math.max(1, width - visibleWidth("ctx "));
		const percent = this.state.contextPercent;
		const filled = percent === undefined ? 0 : Math.round(Math.max(0, Math.min(1, percent)) * slots);
		return `ctx ${"●".repeat(filled)}${"·".repeat(slots - filled)}`;
	}

	private fit(left: string, right: string, width: number): { left: string; right: string } | undefined {
		if (!right) return visibleWidth(left) <= width ? { left, right: "" } : undefined;
		if (!left) return visibleWidth(right) <= width ? { left: "", right } : undefined;
		const gap = 2;
		return visibleWidth(left) + gap + visibleWidth(right) <= width ? { left, right } : undefined;
	}

	private renderParts(left: string, right: string, width: number): string {
		const leftText = left;
		if (!right) return truncateToWidth(leftText, width);
		const rightText = this.renderRight(right);
		if (!left) return `${" ".repeat(Math.max(0, width - visibleWidth(right)))}${truncateToWidth(rightText, width)}`;
		const gap = " ".repeat(Math.max(2, width - visibleWidth(left) - visibleWidth(right)));
		return truncateToWidth(`${leftText}${gap}${rightText}`, width);
	}

	private renderRight(text: string): string {
		return this.noColor ? text : this.theme.fg("accent", text);
	}
}
