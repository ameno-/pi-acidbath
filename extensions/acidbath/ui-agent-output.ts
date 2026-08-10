/** TUI-only provenance banner placed immediately before an agent run. */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth, type Component } from "@earendil-works/pi-tui";

export const AGENT_OUTPUT_ENTRY_TYPE = "acidbath-agent-output";

export interface AgentOutputEntryData {
	timestamp: number;
	prompt: string;
}

export function formatAgentTimestamp(timestamp: number): string {
	const date = new Date(Number.isFinite(timestamp) ? timestamp : 0);
	return [date.getHours(), date.getMinutes(), date.getSeconds()]
		.map((value) => String(value).padStart(2, "0"))
		.join(":");
}

export function normalizePromptPreview(prompt: string): string {
	return prompt
		.replace(/\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1b\\))/g, "")
		.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "")
		.replace(/[\r\n\t]+/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

export class AgentOutputBanner implements Component {
	private readonly data: AgentOutputEntryData;
	private readonly theme: Theme;
	private readonly noColor: boolean;

	constructor(data: AgentOutputEntryData, theme: Theme, noColor: boolean) {
		this.data = data;
		this.theme = theme;
		this.noColor = noColor;
	}

	render(width: number): string[] {
		if (width <= 0) return [];
		const safeWidth = Math.max(1, Math.trunc(width));
		const timestamp = formatAgentTimestamp(this.data.timestamp);
		const prompt = normalizePromptPreview(this.data.prompt) || "(empty prompt)";
		const prefix = ` AGENT OUTPUT · ${timestamp} · `;
		const available = Math.max(1, safeWidth - visibleWidth(prefix) - 1);
		const promptText = truncateToWidth(prompt, available);
		const raw = truncateToWidth(`${prefix}${promptText}`, safeWidth, "");
		const padded = `${raw}${" ".repeat(Math.max(0, safeWidth - visibleWidth(raw)))}`;
		if (this.noColor) return [padded];
		return [this.theme.bg("customMessageBg", this.theme.fg("customMessageText", padded))];
	}

	invalidate(): void {}
}
