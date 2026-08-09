import { access, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Theme } from "@earendil-works/pi-coding-agent";
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

export interface WelcomeState {
	cwd: string;
	model: string;
	skills: string[];
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
];

export function messageForSession(sequence: number): StoicMessage {
	return STOIC_MESSAGES[Math.abs(Math.trunc(sequence)) % STOIC_MESSAGES.length]!;
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
			lines.push(this.color("accent", this.fit(`ACIDBATH · ${this.state.model}`, safeWidth)));
			lines.push(this.fit(`${this.statusSummary()} · ${shortPath(this.state.cwd)}`, safeWidth));
		} else {
			lines.push(this.fit(this.color("accent", `cwd ${shortPath(this.state.cwd)}`), safeWidth));
			lines.push(this.fit(this.color("text", `model ${this.state.model}`), safeWidth));
			lines.push(this.fit(this.color("muted", `skills ${formatSkills(this.state.skills, safeWidth)}`), safeWidth));
			lines.push(this.fit(this.formatChecks(safeWidth), safeWidth));
		}

		if (spacious) {
			lines.push(this.fit(this.color("muted", `maintenance ${this.state.updateHint}`), safeWidth));
		}

		const attribution = `— ${this.state.message.author} · ${this.state.message.source}`;
		const quote = safeWidth >= 90
			? `${this.state.message.text} ${attribution}`
			: this.state.message.text;
		lines.push(this.fit(this.color("mdQuote", quote), safeWidth));
		return lines.map((line) => truncateToWidth(line, safeWidth));
	}

	public invalidate(): void {}

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

	private fit(text: string, width: number): string {
		const left = Math.max(0, Math.floor((width - visibleWidth(text)) / 2));
		return `${" ".repeat(left)}${text}`;
	}
}

export function initialWelcomeState(cwd: string, model: string, sequence: number): WelcomeState {
	return {
		cwd,
		model: model || "no model",
		skills: [],
		checks: [
			{ label: "runtime", status: "pending", detail: "" },
			{ label: "model", status: "pending", detail: "" },
			{ label: "tools", status: "pending", detail: "" },
			{ label: "skills", status: "pending", detail: "" },
		],
		message: messageForSession(sequence),
		updateHint: "/acidbath-update",
	};
}

export async function discoverSkillNames(cwd: string, agentDir = join(homedir(), ".pi", "agent")): Promise<string[]> {
	const roots = [
		join(agentDir, "skills"),
		join(cwd, ".pi", "skills"),
		join(cwd, ".agents", "skills"),
		join(agentDir, "npm"),
	];
	const found = new Set<string>();
	for (const root of roots) await collectSkillNames(root, found, 0, root === join(agentDir, "npm") ? 5 : 3);
	return [...found].sort((a, b) => a.localeCompare(b));
}

async function collectSkillNames(directory: string, found: Set<string>, depth: number, maxDepth: number): Promise<void> {
	if (depth > maxDepth) return;
	try {
		await access(directory);
		const entries = await readdir(directory, { withFileTypes: true });
		if (entries.some((entry) => entry.isFile() && entry.name.toLowerCase() === "skill.md")) {
			found.add(directoryName(directory));
		}
		await Promise.all(entries
			.filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
			.map((entry) => collectSkillNames(join(directory, entry.name), found, depth + 1, maxDepth)));
	} catch {
		// Missing or unreadable skill roots should not prevent startup.
	}
}

function directoryName(directory: string): string {
	const normalized = directory.replace(/[\\/]$/, "");
	return normalized.slice(normalized.lastIndexOf("/") + 1) || normalized;
}

function shortPath(path: string): string {
	const home = homedir();
	const display = path === home ? "~" : path.startsWith(`${home}/`) ? `~/${path.slice(home.length + 1)}` : path;
	return display.length <= 54 ? display : `…${display.slice(-51)}`;
}

function formatSkills(skills: string[], width: number): string {
	if (skills.length === 0) return "none detected";
	const budget = Math.max(18, Math.min(72, Math.floor(width * 0.55)));
	let output = "";
	for (const skill of skills) {
		const next = output ? `${output}, ${skill}` : skill;
		if (next.length > budget) break;
		output = next;
	}
	const remaining = skills.length - (output ? output.split(", ").length : 0);
	return `${output || skills[0]}${remaining > 0 ? ` +${remaining}` : ""}`;
}
