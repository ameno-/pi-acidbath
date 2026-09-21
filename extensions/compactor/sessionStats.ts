/**
 * Session-level metrics for the compactor.
 *
 * Lives in extension closure (one instance per Pi session). The
 * `tool_result` hook calls `recordResult()` for every bash output, and
 * the `/compactor` slash command reads `summarize()` to render.
 *
 * Pure module, no Pi API, no nushell — fully unit-testable.
 */

import type { CompactResult } from "./lib.ts";

export interface FormatBucket {
	count: number;
	originalBytes: number;
	compactedBytes: number;
}

export interface CompactionEvent {
	ts: number;
	/** Always non-null for events pushed via recordResult — the type is
	 * left as-is for forward compatibility, but `summarize` consumers can
	 * assume non-null in practice. */
	format: string;
	originalBytes: number;
	compactedBytes: number;
	savingsPct: number;
	fullDataPath: string | null;
}

export interface SkipEvent {
	ts: number;
	reason: string;
	originalBytes: number;
}

export interface CompactorSessionStats {
	/** Wall-clock session start (ms). */
	startedAt: number;
	/** Number of bash results the compactor has been asked about. */
	totalCalls: number;
	/** How many of those got compacted. */
	compactedCount: number;
	/** How many were left alone, with the reason. */
	skipped: Record<string, number>;
	/** Sum of bytes that would have gone to the model if not compacted. */
	totalOriginalBytes: number;
	/** Sum of bytes actually handed to the model after compaction. */
	totalCompactedBytes: number;
	/** Per-format breakdown (only counts compacted calls). */
	byFormat: Record<string, FormatBucket>;
	/** Every compaction, newest first. Capped at MAX_EVENTS to bound memory. */
	compactionEvents: CompactionEvent[];
	/** Recent skips with reasons, newest first. Capped. */
	skipEvents: SkipEvent[];
	/** Largest single compaction by originalBytes. */
	biggestHit: CompactionEvent | null;
}

const MAX_EVENTS = 200;
const MAX_SKIPS = 50;

export function createSessionStats(): CompactorSessionStats {
	return {
		startedAt: Date.now(),
		totalCalls: 0,
		compactedCount: 0,
		skipped: {},
		totalOriginalBytes: 0,
		totalCompactedBytes: 0,
		byFormat: {},
		compactionEvents: [],
		skipEvents: [],
		biggestHit: null,
	};
}

/**
 * Classify a CompactResult into the session stats. Never throws. The
 * `ts` is passed in (rather than read from Date.now) so tests can pin
 * timestamps deterministically.
 */
export function recordResult(stats: CompactorSessionStats, result: CompactResult, ts: number = Date.now()): void {
	stats.totalCalls++;

	if (result.compacted && result.format && result.compactedBytes !== null && result.savingsPct !== null) {
		stats.compactedCount++;
		stats.totalOriginalBytes += result.originalBytes;
		stats.totalCompactedBytes += result.compactedBytes;

		const bucket = stats.byFormat[result.format] ?? (stats.byFormat[result.format] = {
			count: 0,
			originalBytes: 0,
			compactedBytes: 0,
		});
		bucket.count++;
		bucket.originalBytes += result.originalBytes;
		bucket.compactedBytes += result.compactedBytes;

		const event: CompactionEvent = {
			ts,
			format: result.format,
			originalBytes: result.originalBytes,
			compactedBytes: result.compactedBytes,
			savingsPct: result.savingsPct,
			fullDataPath: result.fullDataPath,
		};
		stats.compactionEvents.unshift(event);
		if (stats.compactionEvents.length > MAX_EVENTS) stats.compactionEvents.length = MAX_EVENTS;

		if (!stats.biggestHit || event.originalBytes > stats.biggestHit.originalBytes) {
			stats.biggestHit = event;
		}
		return;
	}

	const reason = result.reason ?? "unknown";
	stats.skipped[reason] = (stats.skipped[reason] ?? 0) + 1;
	stats.skipEvents.unshift({ ts, reason, originalBytes: result.originalBytes });
	if (stats.skipEvents.length > MAX_SKIPS) stats.skipEvents.length = MAX_SKIPS;
}

/** Reset to a fresh stats object — used by `/compactor reset`. */
export function resetSessionStats(): CompactorSessionStats {
	return createSessionStats();
}

export interface StatsSummary {
	startedAt: number;
	durationMs: number;
	totalCalls: number;
	compactedCount: number;
	skippedTotal: number;
	skippedByReason: Record<string, number>;
	totalOriginalBytes: number;
	totalCompactedBytes: number;
	totalSavedBytes: number;
	totalSavedPct: number;
	byFormat: Array<{ format: string; count: number; originalBytes: number; compactedBytes: number; savingsPct: number }>;
	biggestHit: CompactionEvent | null;
	recent: CompactionEvent[];
}

export function summarize(stats: CompactorSessionStats, now: number = Date.now()): StatsSummary {
	const totalSaved = Math.max(0, stats.totalOriginalBytes - stats.totalCompactedBytes);
	const totalSavedPct = stats.totalOriginalBytes > 0
		? Math.round((totalSaved / stats.totalOriginalBytes) * 100)
		: 0;
	const skippedTotal = Object.values(stats.skipped).reduce((a, b) => a + b, 0);
	const byFormat = Object.entries(stats.byFormat)
		.map(([format, b]) => ({
			format,
			count: b.count,
			originalBytes: b.originalBytes,
			compactedBytes: b.compactedBytes,
			savingsPct: b.originalBytes > 0 ? Math.round((1 - b.compactedBytes / b.originalBytes) * 100) : 0,
		}))
		.sort((a, b) => b.originalBytes - a.originalBytes);
	return {
		startedAt: stats.startedAt,
		durationMs: Math.max(0, now - stats.startedAt),
		totalCalls: stats.totalCalls,
		compactedCount: stats.compactedCount,
		skippedTotal,
		skippedByReason: { ...stats.skipped },
		totalOriginalBytes: stats.totalOriginalBytes,
		totalCompactedBytes: stats.totalCompactedBytes,
		totalSavedBytes: totalSaved,
		totalSavedPct,
		byFormat,
		biggestHit: stats.biggestHit,
		recent: stats.compactionEvents.slice(0, 10),
	};
}

/** Render a one-line footer-style summary. Designed to fit in the Pi status line. */
export function footerLine(stats: CompactorSessionStats): string | null {
	if (stats.compactedCount === 0) return null;
	const saved = stats.totalOriginalBytes - stats.totalCompactedBytes;
	const pct = stats.totalOriginalBytes > 0
		? Math.round((saved / stats.totalOriginalBytes) * 100)
		: 0;
	return `📦 ${stats.compactedCount} compacted · saved ${humanBytes(saved)} (${pct}%)`;
}

export function humanBytes(n: number): string {
	if (n < 1024) return `${n}B`;
	if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
	return `${(n / (1024 * 1024)).toFixed(2)}MB`;
}
