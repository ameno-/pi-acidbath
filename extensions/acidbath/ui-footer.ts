import { basename } from "node:path";
import type { Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { formatContextRail, formatTurnUsage, type TokenContextState } from "./ui-token-context.js";
import { truncateToWidth, visibleWidth } from "./ui-gauge.js";

export interface AcidbathFooterState {
	modelName?: string;
	thinkingLevel?: string;
	/** Legacy/widget-only normalized context value. The default footer uses a rail. */
	contextPercent?: number;
	contextVisible: boolean;
	workingState?: string;
	workingMessage?: string;
	tokenContext?: TokenContextState;
}

const DEFAULT_STATE: AcidbathFooterState = {
	contextVisible: true,
	thinkingLevel: "default",
};

export class AcidbathFooter implements Component {
	private readonly tui: TUI;
	private readonly theme: Theme;
	private readonly cwd: string;
	private readonly noColor: boolean;
	private state: AcidbathFooterState;

	constructor(tui: TUI, theme: Theme, cwd: string, noColor: boolean) {
		this.tui = tui;
		this.theme = theme;
		this.cwd = cwd;
		this.noColor = noColor;
		this.state = { ...DEFAULT_STATE };
	}

	public update(next: Partial<AcidbathFooterState>): void {
		this.state = { ...this.state, ...next };
		this.tui.requestRender();
	}

	public render(width: number): string[] {
		const safeWidth = Math.max(1, Math.trunc(width));
		const model = this.state.modelName || "model";
		const location = basename(this.cwd) || this.cwd;
		const locationPart = location === "acidbath" ? "" : ` · ${location}`;
		const thinking = `think:${this.state.thinkingLevel || "default"}`;
		const context = this.state.contextVisible ? this.contextLabel(safeWidth) : "";
		const lifecycle = this.lifecycleLabel();
		const usage = this.terminalUsage();
		const fullLeft = `acidbath${locationPart} · ${model} · ${thinking}`;
		const fullRight = [lifecycle, context, usage].filter(Boolean).join("  ");

		const full = this.fit(fullLeft, fullRight, safeWidth);
		if (full) return [this.renderParts(full.left, full.right, safeWidth)];
		const compact = this.fit(`acidbath · ${model}`, fullRight, safeWidth);
		if (compact) return [this.renderParts(compact.left, compact.right, safeWidth)];
		const contextOnly = this.fit("acidbath", context || lifecycle, safeWidth);
		if (contextOnly) return [this.renderParts(contextOnly.left, contextOnly.right, safeWidth)];

		return [this.noColor ? truncateToWidth("acidbath", safeWidth) : this.theme.fg("borderAccent", truncateToWidth("acidbath", safeWidth))];
	}

	public invalidate(): void {
		// The footer has no render cache.
	}

	public dispose(): void {}

	private lifecycleLabel(): string {
		const lifecycle = this.state.tokenContext?.lifecycle ?? this.state.workingState ?? "idle";
		if (lifecycle === "error") return "× error";
		if (lifecycle === "done" || lifecycle === "success") return "✓ done";
		if (lifecycle === "settled") return "✓ settled";
		return "";
	}

	private terminalUsage(): string {
		const lifecycle = this.state.tokenContext?.lifecycle ?? this.state.workingState;
		if (lifecycle !== "done" && lifecycle !== "settled" && lifecycle !== "error") return "";
		const turn = this.state.tokenContext ? formatTurnUsage(this.state.tokenContext.facts) : "tok ?";
		return turn.replace(/^turn /, "");
	}

	private contextLabel(width: number): string {
		if (this.state.tokenContext) return formatContextRail(this.state.tokenContext, Math.max(1, Math.min(width, 30)), this.state.tokenContext.motionReduced);
		if (this.state.contextPercent === undefined) return "ctx ?";
		const slots = width >= 120 ? 24 : width >= 80 ? 16 : width >= 60 ? 12 : Math.max(4, Math.floor(width / 2));
		const filled = Math.round(Math.max(0, Math.min(1, this.state.contextPercent)) * slots);
		return `ctx ${"●".repeat(filled)}${"·".repeat(slots - filled)}`;
	}

	private fit(left: string, right: string, width: number): { left: string; right: string } | undefined {
		if (!right) return visibleWidth(left) <= width ? { left, right: "" } : undefined;
		const gap = 2;
		return visibleWidth(left) + gap + visibleWidth(right) <= width ? { left, right } : undefined;
	}

	private renderParts(left: string, right: string, width: number): string {
		const leftText = this.noColor ? left : this.theme.fg("borderAccent", left);
		if (!right) return truncateToWidth(leftText, width);
		const gap = " ".repeat(Math.max(2, width - visibleWidth(left) - visibleWidth(right)));
		const rightText = this.renderRight(right);
		return truncateToWidth(`${leftText}${gap}${rightText}`, width);
	}

	private renderRight(text: string): string {
		if (this.noColor) return text;
		return text.split("  ").map((part) => {
			const color: ThemeColor = part.startsWith("ctx")
				? "accent"
				: part.startsWith("×")
					? "error"
					: part.startsWith("✓")
						? "success"
						: part.startsWith("turn") || /^\d/.test(part)
							? "dim"
							: "accent";
			return this.theme.fg(color, part);
		}).join(this.theme.fg("dim", "  "));
	}
}
