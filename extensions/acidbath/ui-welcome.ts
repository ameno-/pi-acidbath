import { homedir } from "node:os";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { ModelCost } from "@earendil-works/pi-ai";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { truncateToWidth, visibleWidth } from "./ui-gauge.ts";

export type PreflightStatus = "pending" | "ok" | "warn" | "error";

export interface PreflightCheck {
	label: string;
	status: PreflightStatus;
	detail: string;
}

export interface StoicMessage {
	text: string;
	author: string;
	source: string;
}

export type SpendTier = "low" | "default" | "high";

export interface ModelCard {
	modelName: string;
	cost: ModelCost | null;
	spendTier: SpendTier;
	thinkingLevel: string;
}

export interface WelcomeState {
	cwd: string;
	model: string;
	modelCard: ModelCard;
	checks: PreflightCheck[];
	message: StoicMessage;
	updateHint: string;
}

export const WELCOME_WIDGET_KEY = "acidbath-welcome";

// These are deliberately short, attributed translations/adaptations rather than
// a large quotation dump. Keep the source visible so the message is honest.
export const STOIC_MESSAGES: readonly StoicMessage[] = [
	{ text: "We suffer more often in imagination than in reality.", author: "Seneca", source: "Letters, adapted" },
	{ text: "You have power over your mind—not outside events.", author: "Marcus Aurelius", source: "Meditations, adapted" },
	{ text: "No one can live happily who has regard to himself alone.", author: "Seneca", source: "Letters, adapted" },
	{ text: "First say what you would be; then do what you have to do.", author: "Epictetus", source: "Discourses, adapted" },
	{ text: "The best revenge is not to be like your enemy.", author: "Marcus Aurelius", source: "Meditations, adapted" },
	{ text: "We are made for cooperation, like feet and hands.", author: "Marcus Aurelius", source: "Meditations, adapted" },
	{ text: "If it is not right, do not do it; if it is not true, do not say it.", author: "Marcus Aurelius", source: "Meditations, adapted" },
	{ text: "No man is more unhappy than he who never faces adversity.", author: "Seneca", source: "Letters, adapted" },
	{ text: "It is not things that disturb us, but our judgments about things.", author: "Epictetus", source: "Enchiridion, adapted" },
	{ text: "Luck is what happens when preparation meets opportunity.", author: "Seneca, attributed", source: "Fragments, adapted" },
	{ text: "The whole future lies in uncertainty: live immediately.", author: "Seneca", source: "Letters, adapted" },
	{ text: "Waste no more time arguing what a good person should be.", author: "Marcus Aurelius", source: "Meditations, adapted" },
	{ text: "The happiness of your life depends upon the quality of your thoughts.", author: "Marcus Aurelius", source: "Meditations, adapted" },
	{ text: "Difficulties show what men are.", author: "Epictetus", source: "Discourses, adapted" },
	{ text: "He who fears death will never do anything worthy of a living man.", author: "Seneca", source: "Letters, adapted" },
	{ text: "No great thing is created suddenly.", author: "Epictetus", source: "Discourses, adapted" },
	{ text: "Begin at once to live, and count each separate day as a separate life.", author: "Seneca", source: "Letters, adapted" },
	{ text: "The key is to keep company only with people who uplift you.", author: "Epictetus", source: "Discourses, adapted" },
	{ text: "Do every act of your life as though it were the very last act of your life.", author: "Marcus Aurelius", source: "Meditations, adapted" },
	{ text: "A gem cannot be polished without friction.", author: "Seneca, attributed", source: "Fragments, adapted" },
	{ text: "The mind adapts and converts to its purposes the obstacle to our acting.", author: "Marcus Aurelius", source: "Meditations, adapted" },
	{ text: "It is the power of the mind to be unconquerable.", author: "Seneca", source: "Letters, adapted" },
	{ text: "Freedom is the only worthy goal in life.", author: "Epictetus", source: "Discourses, adapted" },
	{ text: "The wise man is content with his lot, whatever it may be.", author: "Seneca", source: "Letters, adapted" },
];

export function modelCardFor(modelName: string, cost: ModelCost | null | undefined, thinkingLevel = "default"): ModelCard {
	const normalizedCost = cost && Number.isFinite(cost.input) && Number.isFinite(cost.output) ? cost : null;
	const score = normalizedCost === null
		? 0
		: normalizedCost.input + normalizedCost.output * 2 + normalizedCost.cacheRead * 0.25;
	const spendTier: SpendTier = normalizedCost === null ? "default" : score <= 2 ? "low" : score >= 10 ? "high" : "default";
	return { modelName: modelName || "no model", cost: normalizedCost, spendTier, thinkingLevel: thinkingLevel || "default" };
}

export function messageForSession(sequence: number): StoicMessage {
	return STOIC_MESSAGES[Math.abs(Math.trunc(sequence)) % STOIC_MESSAGES.length]!;
}

export function randomStoicMessage(random = Math.random): StoicMessage {
	const sample = random();
	const normalized = Number.isFinite(sample) ? Math.max(0, Math.min(sample, 0.999999999)) : 0;
	return STOIC_MESSAGES[Math.floor(normalized * STOIC_MESSAGES.length)]!;
}

export class AcidbathWelcome implements Component {
	private readonly tui: TUI;
	private readonly theme: Theme;
	private state: WelcomeState;

	constructor(tui: TUI, theme: Theme, state: WelcomeState) {
		this.tui = tui;
		this.theme = theme;
		this.state = state;
	}

	public update(next: Partial<WelcomeState>): void {
		this.state = { ...this.state, ...next };
		this.tui.requestRender();
	}

	public updateCheck(label: string, status: PreflightStatus, detail: string): void {
		this.update({
			checks: this.state.checks.map((check) => check.label === label ? { ...check, status, detail } : check),
		});
	}

	public render(width: number): string[] {
		const safeWidth = Math.max(1, Math.trunc(width));
		const lines: string[] = [];
		const compact = safeWidth < 72;
		const spacious = safeWidth >= 110;

		if (compact) {
			lines.push(this.color("accent", this.fit("ACIDBATH", safeWidth)));
			lines.push(this.fit(`${this.statusSummary()} · ${shortPath(this.state.cwd)}`, safeWidth));
			lines.push(this.fit(this.formatModelCard(true), safeWidth));
		} else {
			lines.push(this.fit(this.color("accent", `cwd ${shortPath(this.state.cwd)}`), safeWidth));
			lines.push(this.fit(this.formatModelCard(false), safeWidth));
			lines.push(this.fit(this.formatChecks(safeWidth), safeWidth));
		}

		if (spacious) {
			lines.push(this.fit(this.color("muted", `maintenance ${this.state.updateHint}`), safeWidth));
		}

		const quoteWidth = Math.max(12, safeWidth - 2);
		for (const quoteLine of wrapWords(this.state.message.text, quoteWidth - 2)) {
			lines.push(this.fit(this.emphasis(this.color("warning", `“${quoteLine}”`)), safeWidth));
		}
		lines.push(this.fit(this.color("warning", `— ${this.state.message.author}`), safeWidth));
		return lines.map((line) => truncateToWidth(line, safeWidth));
	}

	public invalidate(): void {}

	public dispose(): void {}

	private formatModelCard(compact: boolean): string {
		const card = this.state.modelCard;
		const cost = formatModelCost(card.cost, compact);
		const content = `${card.modelName} · ${cost} · thinking:${card.thinkingLevel}`;
		return this.color(card.spendTier === "low" ? "success" : card.spendTier === "high" ? "error" : "syntaxPunctuation", `◈ ${content}`);
	}


	private formatChecks(width: number): string {
		const parts = this.state.checks.map((check) => {
			const symbol = check.status === "ok" ? "✓" : check.status === "error" ? "×" : check.status === "warn" ? "!" : "·";
			const token = check.status === "ok" ? "success" : check.status === "error" ? "error" : check.status === "warn" ? "warning" : "dim";
			return this.color(token, `${symbol} ${check.label}${check.detail ? ` ${check.detail}` : ""}`);
		});
		const joined = parts.join(this.color("dim", "  "));
		return visibleWidth(joined) <= width ? joined : this.color("muted", this.statusSummary());
	}

	private statusSummary(): string {
		const complete = this.state.checks.filter((check) => check.status === "ok").length;
		const pending = this.state.checks.filter((check) => check.status === "pending").length;
		const problems = this.state.checks.filter((check) => check.status === "warn" || check.status === "error").length;
		if (pending > 0) return `preflight ${complete}/${this.state.checks.length}`;
		if (problems > 0) return `preflight ${complete}/${this.state.checks.length} · ${problems} notice`;
		return `preflight ${complete}/${this.state.checks.length} ready`;
	}

	private color(token: string, text: string): string {
		return this.theme.fg(token as Parameters<Theme["fg"]>[0], text);
	}

	private emphasis(text: string): string {
		return typeof this.theme.bold === "function" ? this.theme.bold(text) : text;
	}

	private fit(text: string, width: number): string {
		const left = Math.max(0, Math.floor((width - visibleWidth(text)) / 2));
		return `${" ".repeat(left)}${text}`;
	}
}

export function initialWelcomeState(cwd: string, model: string, sequence: number, cost: ModelCost | null | undefined = null, thinkingLevel = "default"): WelcomeState {
	const selectedModel = model || "no model";
	return {
		cwd,
		model: selectedModel,
		modelCard: modelCardFor(selectedModel, cost, thinkingLevel),
		checks: [
			{ label: "runtime", status: "pending", detail: "" },
			{ label: "model", status: "pending", detail: "" },
			{ label: "tools", status: "pending", detail: "" },
		],
		message: randomStoicMessage(),
		updateHint: "/acidbath-update",
	};
}

function formatModelCost(cost: ModelCost | null, compact: boolean): string {
	if (!cost) return compact ? "cost unknown" : "cost unavailable";
	const input = formatRate(cost.input);
	const output = formatRate(cost.output);
	return compact ? `in ${input}/M · out ${output}/M` : `in ${input}/1M · out ${output}/1M`;
}

function formatRate(value: number): string {
	if (!Number.isFinite(value)) return "?";
	if (value === 0) return "$0";
	if (value < 0.01) return `$${value.toFixed(4)}`;
	if (value < 1) return `$${value.toFixed(2)}`;
	if (value < 10) return `$${value.toFixed(2).replace(/\.?0+$/, "")}`;
	return `$${Math.round(value * 100) / 100}`;
}

function wrapWords(text: string, width: number): string[] {
	const lines: string[] = [];
	let line = "";
	for (const word of text.split(/\s+/)) {
		const next = line ? `${line} ${word}` : word;
		if (line && next.length > width) {
			lines.push(line);
			line = word;
		} else {
			line = next;
		}
	}
	if (line) lines.push(line);
	return lines.length > 0 ? lines : [""];
}

function shortPath(path: string): string {
	const home = homedir();
	const display = path === home ? "~" : path.startsWith(`${home}/`) ? `~/${path.slice(home.length + 1)}` : path;
	return display.length <= 54 ? display : `…${display.slice(-51)}`;
}
