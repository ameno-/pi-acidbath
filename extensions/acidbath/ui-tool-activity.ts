/**
 * A bounded, above-editor activity viewport for tool calls.
 *
 * It deliberately owns presentation only: tool execution and model-visible
 * results stay in ui-tools.ts and the native tool renderers.
 */

import { truncateToWidth, visibleWidth, type Component, type TUI } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { MotionClock, toolMotionGlyphForTool, type ToolMotionState } from "./ui-motion.ts";

export interface ToolActivityUpdate {
	event: "start" | "update";
	toolCallId: string;
	toolName: string;
	target: string;
	status: ToolMotionState;
	metadata: readonly string[];
}

interface ToolActivityEntry {
	toolCallId: string;
	toolName: string;
	target: string;
	status: ToolMotionState;
	metadata: string[];
}

const ACTIVITY_VIEWPORT_ROWS = 6;
const ACTIVITY_RAIL_WIDTH = 4;

export class ToolActivityStore {
	private readonly entries = new Map<string, ToolActivityEntry>();
	private readonly listeners = new Set<() => void>();
	private scrollOffset = 0;
	private visible = true;

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
			}
			: {
				toolCallId: update.toolCallId,
				toolName: update.toolName,
				target: update.target,
				status: update.status,
				metadata: [...update.metadata],
			};
		if (existing && sameEntry(existing, next)) return;
		this.entries.set(update.toolCallId, next);
		this.emit();
	}

	beginRun(): void {
		this.entries.clear();
		this.scrollOffset = 0;
		this.visible = true;
		this.emit();
	}

	clear(): void {
		this.entries.clear();
		this.scrollOffset = 0;
		this.emit();
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

export class ToolActivityPanel implements Component {
	private readonly tui: TUI;
	private readonly theme: Theme;
	private readonly store: ToolActivityStore;
	private readonly clock: MotionClock;
	private readonly reducedMotion: boolean;
	private readonly noColor: boolean;
	private readonly unsubscribe: () => void;
	private readonly clockId = "acidbath-tool-activity";

	constructor(
		tui: TUI,
		theme: Theme,
		store: ToolActivityStore,
		clock: MotionClock,
		reducedMotion: boolean,
		noColor: boolean,
	) {
		this.tui = tui;
		this.theme = theme;
		this.store = store;
		this.clock = clock;
		this.reducedMotion = reducedMotion;
		this.noColor = noColor;
		this.unsubscribe = store.subscribe(() => {
			this.syncMotion();
			tui.requestRender();
		});
		this.syncMotion();
	}

	render(width: number): string[] {
		if (!this.store.isVisible() || this.store.entryCount() === 0) return [];
		const snapshot = this.store.visibleEntries();
		const activeLabel = snapshot.activeCount > 0 ? `${snapshot.activeCount} running` : "settled";
		const heading = `◇ tools  ${activeLabel}`;
		const lines: string[] = [this.noColor ? heading : this.theme.fg(snapshot.activeCount > 0 ? "accent" : "success", heading)];

		if (snapshot.hiddenAbove > 0) {
			const hint = `↑ ${snapshot.hiddenAbove} earlier · /tools up`;
			lines.push(this.noColor ? hint : this.theme.fg("dim", hint));
		}
		for (const entry of snapshot.entries) lines.push(this.renderEntry(entry, width));
		if (snapshot.hiddenBelow > 0) {
			const hint = `↓ ${snapshot.hiddenBelow} more · /tools down`;
			lines.push(this.noColor ? hint : this.theme.fg("dim", hint));
		}
		return lines.map((line) => truncateToWidth(line, Math.max(1, Math.trunc(width))));
	}

	invalidate(): void {
		// Entries are small and intentionally rendered from the current store.
	}

	dispose(): void {
		this.unsubscribe();
		this.clock.unsubscribe(this.clockId);
	}

	private renderEntry(entry: ToolActivityEntry, width: number): string {
		const glyph = toolMotionGlyphForTool(entry.toolName, entry.status, this.clock.currentPhase(), this.reducedMotion);
		const color = colorForStatus(entry.status);
		const rail = fixedCell(this.noColor ? glyph : this.theme.fg(color, glyph), ACTIVITY_RAIL_WIDTH);
		const target = entry.target ? ` ${this.noColor ? entry.target : this.theme.fg("dim", entry.target)}` : "";
		const meta = entry.metadata.filter((value) => value && value !== "running").join(" · ");
		const styledMeta = meta ? ` ${this.noColor ? `· ${meta}` : this.theme.fg("dim", `· ${meta}`)}` : "";
		const tool = this.noColor ? entry.toolName : this.theme.fg(color, this.theme.bold(entry.toolName));
		return truncateToWidth(`${rail}${tool}${target}${styledMeta}`, Math.max(1, Math.trunc(width)));
	}

	private syncMotion(): void {
		if (this.store.hasPending()) this.clock.subscribe(this.clockId, () => this.tui.requestRender());
		else this.clock.unsubscribe(this.clockId);
	}
}

function sameEntry(left: ToolActivityEntry, right: ToolActivityEntry): boolean {
	return left.toolCallId === right.toolCallId
		&& left.toolName === right.toolName
		&& left.target === right.target
		&& left.status === right.status
		&& left.metadata.length === right.metadata.length
		&& left.metadata.every((value, index) => value === right.metadata[index]);
}

function colorForStatus(status: ToolMotionState): "accent" | "success" | "error" {
	return status === "pending" ? "accent" : status === "error" ? "error" : "success";
}

function fixedCell(value: string, width: number): string {
	const safe = truncateToWidth(value, width);
	return `${safe}${" ".repeat(Math.max(0, width - visibleWidth(safe)))}`;
}