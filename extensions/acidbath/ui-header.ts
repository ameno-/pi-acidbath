import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";

export class AcidbathHeader implements Component {
	private readonly theme: Theme;
	private readonly noColor: boolean;

	constructor(_tui: TUI, theme: Theme, _modelName: string | undefined, _cwd: string, noColor: boolean) {
		this.theme = theme;
		this.noColor = noColor;
	}

	public render(_width: number): string[] {
		const title = this.noColor
			? "acidbath"
			: this.theme.fg("borderAccent", this.theme.bold("acidbath"));
		return [title];
	}

	public invalidate(): void {
		// No render cache.
	}
}
