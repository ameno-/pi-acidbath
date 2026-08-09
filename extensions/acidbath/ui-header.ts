import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { truncateToWidth } from "./ui-gauge.js";
import { DEFAULT_SESSION_SUMMARY, formatSessionHeader } from "./ui-summary.js";

export interface AcidbathHeaderState {
	summary: string;
	contextPercent?: number;
}

export class AcidbathHeader implements Component {
	private readonly tui: TUI;
	private readonly theme: Theme;
	private readonly noColor: boolean;
	private state: AcidbathHeaderState;

	constructor(_tui: TUI, theme: Theme, _modelName: string | undefined, _cwd: string, noColor: boolean, summary = DEFAULT_SESSION_SUMMARY) {
		this.tui = _tui;
		this.theme = theme;
		this.noColor = noColor;
		this.state = { summary };
	}

	public update(next: Partial<AcidbathHeaderState>): void {
		this.state = { ...this.state, ...next };
		this.tui.requestRender();
	}

	public render(width: number): string[] {
		const title = this.noColor
			? "acidbath"
			: this.theme.fg("borderAccent", this.theme.bold("acidbath"));
		const plain = formatSessionHeader(this.state.summary, this.state.contextPercent);
		const context = plain.slice(`acidbath · ${this.state.summary}`.length);
		const styled = this.noColor
			? plain
			: `${title}${this.theme.fg("dim", " · ")}${this.theme.fg("text", this.state.summary)}${this.theme.fg("dim", context)}`;
		return [truncateToWidth(styled, Math.max(1, width))];
	}

	public invalidate(): void {
		// No render cache.
	}
}
