import { basename } from "node:path";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { formatContextRail, formatTurnUsage, type TokenContextState } from "./ui-token-context.ts";
import { truncateToWidth, visibleWidth } from "./ui-gauge.ts";

export interface AcidbathFooterState {
	modelName?: string;
	/** Current Git branch; a dash is used while the async lookup is pending. */
	branchName?: string;
	contextPercent?: number;
	reviewStatus?: string;
	contextVisible: boolean;
	tokenContext?: TokenContextState;
}

const DEFAULT_STATE: AcidbathFooterState = {
	contextVisible: true,
	branchName: "—",
};

const CONTEXT_SLOT_WIDTH = 20;
const TOKEN_USAGE_SLOT_WIDTH = 16;

export class AcidbathFooter implements Component {
	private readonly theme: Theme;
	private readonly cwd: string;
	private readonly noColor: boolean;
	private readonly tui: TUI;
	private state: AcidbathFooterState = { ...DEFAULT_STATE };
	private cachedWidth: number | undefined;
	private cachedLines: string[] | undefined;

	constructor(tui: TUI, theme: Theme, cwd: string, noColor: boolean) {
		this.tui = tui;
		this.theme = theme;
		this.cwd = cwd;
		this.noColor = noColor;
	}

	public update(next: Partial<AcidbathFooterState>): void {
		const state = { ...this.state, ...next };
		if (sameFooterState(this.state, state)) return;
		this.state = state;
		this.invalidate();
		this.tui.requestRender();
	}

	public render(width: number): string[] {
		const safeWidth = Math.max(1, Math.trunc(width));
		if (this.cachedLines && this.cachedWidth === safeWidth) return this.cachedLines;
		const lines = [this.renderLine(safeWidth)];
		this.cachedWidth = safeWidth;
		this.cachedLines = lines;
		return lines;
	}

	public invalidate(): void {
		this.cachedWidth = undefined;
		this.cachedLines = undefined;
	}
	public dispose(): void {
		this.invalidate();
	}

	private renderLine(safeWidth: number): string {
		const model = this.state.modelName || "model";
		const location = basename(this.cwd) || this.cwd;
		const context = this.state.contextVisible ? this.contextLabel(CONTEXT_SLOT_WIDTH) : "";
		const usage = this.terminalUsage();
		const review = this.state.reviewStatus ?? "";
		const right = [review, context, usage].filter(Boolean).join(" ");
		const identity = this.fullIdentity(location, model);
		const full = this.fit(identity, right, safeWidth);
		if (full) return this.renderParts(full.left, full.right, safeWidth);
		const compact = this.fit(this.compactIdentity(location, model), right, safeWidth);
		if (compact) return this.renderParts(compact.left, compact.right, safeWidth);
		const dockOnly = this.fit("", right, safeWidth);
		if (dockOnly) return this.renderParts(dockOnly.left, dockOnly.right, safeWidth);
		const contextOnly = this.fit("acidbath", context, safeWidth);
		if (contextOnly) return this.renderParts(contextOnly.left, contextOnly.right, safeWidth);
		return truncateToWidth(this.leftColor("acidbath", "muted"), safeWidth);
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

	private terminalUsage(): string {
		const turn = formatTurnUsage(this.state.tokenContext?.facts ?? null).replace(/^turn /, "");
		return `${turn}${" ".repeat(Math.max(0, TOKEN_USAGE_SLOT_WIDTH - visibleWidth(turn)))}`;
	}

	private contextLabel(width: number): string {
		if (this.state.tokenContext) return formatContextRail(this.state.tokenContext, width);
		const slots = Math.max(1, width - visibleWidth("ctx "));
		const percent = this.state.contextPercent;
		const filled = percent === undefined ? 0 : Math.round(Math.max(0, Math.min(1, percent)) * slots);
		return `ctx ${"●".repeat(filled)}${"·".repeat(slots - filled)}`;
	}

	private fit(left: string, right: string, width: number): { left: string; right: string } | undefined {
		if (!right) return visibleWidth(left) <= width ? { left, right: "" } : undefined;
		if (!left) return visibleWidth(right) <= width ? { left: "", right } : undefined;
		return visibleWidth(left) + 2 + visibleWidth(right) <= width ? { left, right } : undefined;
	}

	private renderParts(left: string, right: string, width: number): string {
		if (!right) return truncateToWidth(left, width);
		const rightText = this.noColor ? right : this.theme.fg("accent", right);
		if (!left) return `${" ".repeat(Math.max(0, width - visibleWidth(right)))}${truncateToWidth(rightText, width)}`;
		const gap = " ".repeat(Math.max(2, width - visibleWidth(left) - visibleWidth(right)));
		return truncateToWidth(`${left}${gap}${rightText}`, width);
	}
}

function sameFooterState(left: AcidbathFooterState, right: AcidbathFooterState): boolean {
	return left.modelName === right.modelName
		&& left.branchName === right.branchName
		&& left.contextPercent === right.contextPercent
		&& left.reviewStatus === right.reviewStatus
		&& left.contextVisible === right.contextVisible
		&& left.tokenContext === right.tokenContext;
}
