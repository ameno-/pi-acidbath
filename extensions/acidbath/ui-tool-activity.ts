/**
 * A bounded, transcript-ordered activity block for tool calls.
 *
 * It is appended as a TUI-only entry at agent start, so it stays above the
 * final assistant output while tool execution remains owned by ui-tools.ts
 * and the native tool renderers.
 */

import { truncateToWidth, visibleWidth, type Component } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { toolMotionGlyphForTool, type ToolMotionState } from "./ui-motion.ts";

export function activityTarget(toolName: string, args: Record<string, unknown> | undefined): string {
	const value = toolName === "bash"
		? args?.command
		: args?.path ?? args?.file_path ?? args?.pattern ?? args?.directory ?? args?.query ?? args?.topic ?? args?.url;
	if (typeof value !== "string") return "";
	return value.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
}

export function activityPreview(result: unknown): { lines: string[]; hidden: number } {
	if (!result || typeof result !== "object") return { lines: [], hidden: 0 };
	const value = result as Record<string, unknown>;
	const content = Array.isArray(value.content)
		? value.content
			.filter((part): part is Record<string, unknown> => typeof part === "object" && part !== null && (part as Record<string, unknown>).type === "text" && typeof (part as Record<string, unknown>).text === "string")
			.map((part) => part.text as string)
			.join("\n")
		: "";
	if (!content.trim()) return { lines: [], hidden: 0 };
	const all = content.replace(/\r\n?/g, "\n").split("\n").map((line) => line.trimEnd());
	while (all.length > 0 && !all[0]!.trim()) all.shift();
	while (all.length > 0 && !all[all.length - 1]!.trim()) all.pop();
	const lines = all.slice(0, 3);
	return { lines, hidden: Math.max(0, all.length - lines.length) };
}

export interface ToolActivityUpdate {
	event: "start" | "update";
	toolCallId: string;
	toolName: string;
	target: string;
	status: ToolMotionState;
	metadata: readonly string[];
	previewLines?: readonly string[];
	previewHidden?: number;
}

interface ToolActivityEntry {
	toolCallId: string;
	toolName: string;
	target: string;
	status: ToolMotionState;
	metadata: string[];
	previewLines: string[];
	previewHidden: number;
}

const ACTIVITY_VIEWPORT_ROWS = 4;
const ACTIVITY_RAIL_WIDTH = 4;

export class ToolActivityStore {
	private readonly entries = new Map<string, ToolActivityEntry>();
	private readonly listeners = new Set<() => void>();
	private scrollOffset = 0;
	private visible = true;
	private expanded = false;

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	update(update: ToolActivityUpdate): void {
		const existing = this.entries.get(update.toolCallId);
		const next: ToolActivityEntry = existing
			? {
				...existing,
				toolName: update.toolName,
				target: update.target,
				status: update.status,
				metadata: [...update.metadata],
				previewLines: [...(update.previewLines ?? existing.previewLines)],
				previewHidden: update.previewHidden ?? existing.previewHidden,
			}
			: {
				toolCallId: update.toolCallId,
				toolName: update.toolName,
				target: update.target,
				status: update.status,
				metadata: [...update.metadata],
				previewLines: [...(update.previewLines ?? [])],
				previewHidden: update.previewHidden ?? 0,
			};
		if (existing && sameEntry(existing, next)) return;
		this.entries.set(update.toolCallId, next);
		this.emit();
	}

	beginRun(): void {
		this.entries.clear();
		this.scrollOffset = 0;
		this.visible = true;
		this.expanded = false;
		this.emit();
	}

	clear(): void {
		this.entries.clear();
		this.scrollOffset = 0;
		this.emit();
	}

	setExpanded(expanded: boolean): void {
		if (this.expanded === expanded) return;
		this.expanded = expanded;
		this.emit();
	}

	isExpanded(): boolean {
		return this.expanded;
	}

	toggleExpanded(): void {
		this.setExpanded(!this.expanded);
	}

	setVisible(visible: boolean): void {
		if (this.visible === visible) return;
		this.visible = visible;
		this.emit();
	}

	toggleVisible(): void {
		this.setVisible(!this.visible);
	}

	isVisible(): boolean {
		return this.visible;
	}

	scroll(delta: number): void {
		const next = Math.max(0, Math.min(this.maxScrollOffset(), this.scrollOffset + Math.trunc(delta)));
		if (next === this.scrollOffset) return;
		this.scrollOffset = next;
		this.emit();
	}

	scrollToTop(): void {
		const top = this.maxScrollOffset();
		if (this.scrollOffset === top) return;
		this.scrollOffset = top;
		this.emit();
	}

	scrollToBottom(): void {
		if (this.scrollOffset === 0) return;
		this.scrollOffset = 0;
		this.emit();
	}

	hasPending(): boolean {
		return [...this.entries.values()].some((entry) => entry.status === "pending");
	}

	entryCount(): number {
		return this.entries.size;
	}

	targetFor(toolCallId: string): string {
		return this.entries.get(toolCallId)?.target ?? "";
	}

	visibleEntries(): { entries: readonly ToolActivityEntry[]; hiddenAbove: number; hiddenBelow: number; activeCount: number } {
		const completed = this.completedEntries();
		const active = [...this.entries.values()].filter((entry) => entry.status === "pending");
		const activeRows = Math.min(active.length, ACTIVITY_VIEWPORT_ROWS);
		const historyRows = Math.max(0, ACTIVITY_VIEWPORT_ROWS - activeRows);
		const end = Math.max(0, completed.length - this.scrollOffset);
		const start = Math.max(0, end - historyRows);
		const history = completed.slice(start, end);
		const pinned = active.slice(-activeRows);
		return {
			entries: [...history, ...pinned],
			hiddenAbove: start,
			hiddenBelow: Math.max(0, completed.length - end),
			activeCount: active.length,
		};
	}

	private completedEntries(): ToolActivityEntry[] {
		return [...this.entries.values()].filter((entry) => entry.status !== "pending");
	}

	private maxScrollOffset(): number {
		const activeCount = [...this.entries.values()].filter((entry) => entry.status === "pending").length;
		const historyRows = Math.max(0, ACTIVITY_VIEWPORT_ROWS - Math.min(activeCount, ACTIVITY_VIEWPORT_ROWS));
		return Math.max(0, this.completedEntries().length - historyRows);
	}

	private emit(): void {
		for (const listener of this.listeners) listener();
	}
}

export class ToolActivityTranscript implements Component {
	private readonly theme: Theme;
	private readonly store: ToolActivityStore;
	private readonly reducedMotion: boolean;
	private readonly noColor: boolean;

	constructor(store: ToolActivityStore, theme: Theme, reducedMotion: boolean, noColor: boolean) {
		this.store = store;
		this.theme = theme;
		this.reducedMotion = reducedMotion;
		this.noColor = noColor;
	}

	render(width: number): string[] {
		if (!this.store.isVisible() || this.store.entryCount() === 0) return [];
		const safeWidth = Math.max(1, Math.trunc(width));
		const snapshot = this.store.visibleEntries();
		const activeLabel = snapshot.activeCount > 0 ? `${snapshot.activeCount} running` : "settled";
		const heading = `◇ tools  ${activeLabel}`;
		const lines: string[] = [this.border(safeWidth), this.noColor ? heading : this.theme.fg(snapshot.activeCount > 0 ? "accent" : "success", heading)];

		if (snapshot.hiddenAbove > 0) {
			const hint = `↑ ${snapshot.hiddenAbove} earlier · /tools up`;
			lines.push(this.noColor ? hint : this.theme.fg("dim", hint));
		}
		for (const entry of snapshot.entries) lines.push(...this.renderEntry(entry, safeWidth));
		if (snapshot.hiddenBelow > 0) {
			const hint = `↓ ${snapshot.hiddenBelow} more · /tools down`;
			lines.push(this.noColor ? hint : this.theme.fg("dim", hint));
		}
		lines.push(this.border(safeWidth));
		return lines.map((line) => truncateToWidth(line, safeWidth));
	}

	invalidate(): void {}
	dispose(): void {}

	private renderEntry(entry: ToolActivityEntry, width: number): string[] {
		const glyph = toolMotionGlyphForTool(entry.toolName, entry.status, 0, this.reducedMotion);
		const color = colorForStatus(entry.status);
		const rail = fixedCell(this.noColor ? glyph : this.theme.fg(color, glyph), ACTIVITY_RAIL_WIDTH);
		const target = entry.target ? ` ${this.noColor ? entry.target : this.theme.fg("dim", entry.target)}` : "";
		const meta = entry.metadata.filter((value) => value && value !== "running").join(" · ");
		const styledMeta = meta ? ` ${this.noColor ? `· ${meta}` : this.theme.fg("dim", `· ${meta}`)}` : "";
		const tool = this.noColor ? entry.toolName : this.theme.fg(color, this.theme.bold(entry.toolName));
		const lines = [`${rail}${tool}${target}${styledMeta}`];
		const previewLimit = this.store.isExpanded() ? 12 : 3;
		for (let index = 0; index < Math.min(previewLimit, entry.previewLines.length); index++) {
			const lastVisible = index === Math.min(previewLimit, entry.previewLines.length) - 1 && entry.previewHidden === 0;
			const branch = lastVisible ? "└ " : "├ ";
			const output = this.noColor ? entry.previewLines[index]! : this.theme.fg(entry.status === "error" ? "error" : "toolOutput", entry.previewLines[index]!);
			const styledBranch = this.noColor ? branch : this.theme.fg("dim", branch);
			lines.push(`${" ".repeat(ACTIVITY_RAIL_WIDTH)}${styledBranch}${output}`);
		}
		const hidden = Math.max(entry.previewHidden, entry.previewLines.length - previewLimit);
		if (hidden > 0) {
			const hint = `${" ".repeat(ACTIVITY_RAIL_WIDTH)}└ … ${hidden} more ${hidden === 1 ? "line" : "lines"} · expand`;
			lines.push(this.noColor ? hint : this.theme.fg("dim", hint));
		}
		return lines.map((line) => truncateToWidth(line, width));
	}

	private border(width: number): string {
		const line = "─".repeat(width);
		return this.noColor ? line : this.theme.fg("border", line);
	}
}

function sameEntry(left: ToolActivityEntry, right: ToolActivityEntry): boolean {
	return left.toolCallId === right.toolCallId
		&& left.toolName === right.toolName
		&& left.target === right.target
		&& left.status === right.status
		&& left.metadata.length === right.metadata.length
		&& left.metadata.every((value, index) => value === right.metadata[index])
		&& left.previewHidden === right.previewHidden
		&& left.previewLines.length === right.previewLines.length
		&& left.previewLines.every((value, index) => value === right.previewLines[index]);
}

function colorForStatus(status: ToolMotionState): "accent" | "success" | "error" {
	return status === "pending" ? "accent" : status === "error" ? "error" : "success";
}

function fixedCell(value: string, width: number): string {
	const safe = truncateToWidth(value, width);
	return `${safe}${" ".repeat(Math.max(0, width - visibleWidth(safe)))}`;
}