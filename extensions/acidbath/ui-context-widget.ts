import type { Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { advanceToward } from "./ui-gauge.js";
import {
	buildContextPyramid,
	renderContextPyramid,
} from "./ui-context-pyramid.js";

export type ContextPlacement = "off" | "right" | "above" | "below";

export function parseContextPlacement(
	value: string | undefined,
	fallback: ContextPlacement = "right",
): ContextPlacement {
	const normalized = value?.trim().toLowerCase();
	return normalized === "above" || normalized === "below" || normalized === "off" || normalized === "right"
		? normalized
		: fallback;
}

const CONTEXT_TICK_MS = 80;
const CONTEXT_STEP_PER_TICK = 0.16;
const PYRAMID_MIN_WIDTH = 28;

export class ContextPyramidWidget implements Component {
	private readonly tui: TUI;
	private readonly theme: Theme;
	private readonly reducedMotion: boolean;
	private readonly noColor: boolean;
	private targetPercent: number | undefined;
	private renderedPercent: number | undefined;
	private timer: ReturnType<typeof setInterval> | undefined;

	constructor(tui: TUI, theme: Theme, reducedMotion: boolean, noColor: boolean) {
		this.tui = tui;
		this.theme = theme;
		this.reducedMotion = reducedMotion;
		this.noColor = noColor;
	}

	public updateTarget(percent: number | undefined): void {
		if (percent === undefined) {
			this.dispose();
			this.targetPercent = undefined;
			this.renderedPercent = undefined;
			this.tui.requestRender();
			return;
		}

		this.targetPercent = Math.max(0, Math.min(1, percent));
		if (this.renderedPercent === undefined || this.reducedMotion) {
			this.renderedPercent = this.targetPercent;
			this.disposeAnimation();
			this.tui.requestRender();
			return;
		}
		if (this.renderedPercent === this.targetPercent) return;
		if (this.timer === undefined) {
			this.timer = setInterval(() => this.tick(), CONTEXT_TICK_MS);
		}
		this.tui.requestRender();
	}

	public render(width: number): string[] {
		if (this.renderedPercent === undefined) return [];
		if (width < PYRAMID_MIN_WIDTH) return [this.renderNarrow(width)];

		const model = buildContextPyramid(this.renderedPercent, 3);
		return renderContextPyramid(model, {
			filledOrb: "●",
			emptyOrb: "·",
			showLabel: false,
			colorize: (text, token, _pressure, _row, _cell, fillIndex) => {
				if (this.noColor) return text;
				if (token === "empty") return this.theme.fg("dim", text);
				if (token === "label") return this.theme.fg("accent", text);
				const color = this.progressiveColor(fillIndex, model.totalCells);
				return this.theme.fg(color, text);
			},
		});
	}

	public invalidate(): void {
		// The widget has no render cache; the current theme is read on every render.
	}

	public dispose(): void {
		this.disposeAnimation();
		this.targetPercent = undefined;
		this.renderedPercent = undefined;
	}

	private renderNarrow(width: number): string {
		const percent = this.renderedPercent ?? 0;
		if (width < 8) return "ctx";
		const label = "ctx ";
		const available = Math.max(1, width - label.length);
		const slots = Math.min(18, available);
		const filled = Math.round(slots * percent);
		const cells = `${"●".repeat(filled)}${"·".repeat(slots - filled)}`;
		if (this.noColor) return `${label}${cells}`;
		return `${this.theme.fg("accent", label)}${this.theme.fg("accent", "●".repeat(filled))}${this.theme.fg("dim", "·".repeat(slots - filled))}`;
	}

	private progressiveColor(fillIndex: number, totalCells: number): ThemeColor {
		const ratio = totalCells <= 1 ? 1 : fillIndex / (totalCells - 1);
		if (ratio >= 0.85) return "error";
		if (ratio >= 0.62) return "warning";
		if (ratio >= 0.3) return "success";
		return "accent";
	}

	private tick(): void {
		if (this.renderedPercent === undefined || this.targetPercent === undefined) {
			this.disposeAnimation();
			return;
		}
		if (this.renderedPercent === this.targetPercent) {
			this.disposeAnimation();
			return;
		}
		this.renderedPercent = advanceToward(
			this.renderedPercent,
			this.targetPercent,
			CONTEXT_STEP_PER_TICK,
		);
		this.tui.requestRender();
	}

	private disposeAnimation(): void {
		if (this.timer !== undefined) clearInterval(this.timer);
		this.timer = undefined;
	}
}
