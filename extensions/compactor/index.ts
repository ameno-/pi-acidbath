/**
 * compactor — context-aware result compaction for coding agents.
 *
 * Validated separately in nushell-agent-runtime: 37.2% token savings on
 * SWE-bench real coding tasks, 100% pass rate, no quality degradation.
 *
 * KEY DESIGN DECISIONS (why this differs from a naive "compact everything"
 * extension):
 *   1. Hooks the `tool_result` event rather than overriding `registerTool`
 *      for "bash". Pi's built-in bash tool still does the actual execution
 *      (permission gating, live streaming, PI_* session env vars, native
 *      tool-row rendering) — this extension only rewrites the text handed
 *      back to the model afterward.
 *   2. NEVER touches `read` or `ls` results — source code must stay intact
 *      for editing. Only `bash` results are considered.
 *   3. Only compacts `bash` output that is structured data (JSON/CSV/TSV/
 *      NDJSON) over the size threshold. Code and log output pass through
 *      unchanged — compacting them was measured to be counterproductive
 *      (models re-request the data, net token usage goes up).
 *   4. Saves the full output to a temp file before compacting — "nushell as
 *      DB". The compacted result tells the agent where the full data lives
 *      and how to query it with nushell, so nothing is actually lost.
 *
 * Example compacted output:
 *   "[compacted: json_array, 500 rows total → showing first 20.
 *    41000 → 3200 bytes (92% smaller)]
 *
 *    Full data saved to: /tmp/compact_data/abc123.json
 *    Query with nushell: nu -c 'open /tmp/compact_data/abc123.json | first 5'
 *    Or filter: nu -c 'open /tmp/compact_data/abc123.json | where status == "active" | length'
 *    ..."
 *
 * All compaction logic lives in ./lib.ts (pure, no Pi API) so the MCP
 * server (mcp/compactor-server.mjs) can share it. This file is only the
 * Pi `tool_result` hook.
 *
 * Config (env):
 *   PI_ACIDBATH_COMPACTOR_DISABLE=1      disable entirely
 *   PI_ACIDBATH_COMPACTOR_THRESHOLD      bytes (default 2048)
 *   PI_ACIDBATH_COMPACTOR_PREVIEW_ROWS   rows (default 20)
 *   PI_ACIDBATH_COMPACTOR_DATA_DIR       full-data dir (default /tmp/compact_data)
 *   PI_ACIDBATH_NU_BIN                   nushell binary override
 *   PI_ACIDBATH_COMPACTOR_DEBUG=1        debug to stderr
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { tryCompact, dataDirStats, dataDirStatsSince } from "./lib.ts";
import {
	createSessionStats,
	recordResult,
	resetSessionStats,
	summarize,
	humanBytes,
	type CompactorSessionStats,
} from "./sessionStats.ts";

// ─── tool_result hook ────────────────────────────────────────────────────
//
// Post-processes `bash` results after Pi's built-in tool has already run.
// This is deliberately NOT a registerTool({ name: "bash", ... }) override:
// that would replace Pi's own execution path (permission gating, live
// streaming, PI_* session env vars, native tool-row rendering) with a
// reimplementation. Hooking `tool_result` keeps all of that and only
// rewrites the text handed back to the model. `read` and `ls` results are
// never touched — in coding agent workflows those are source files and
// listings the agent needs in full to make edits.

export function tryCompactText(text: string): string | null {
	return tryCompact(text).text;
}

export default function compactorExtension(pi: ExtensionAPI) {
	let stats = createSessionStats();

	pi.on("session_start", () => {
		stats = createSessionStats();
	});

	pi.on("tool_result", (event) => {
		if (event.toolName !== "bash" || event.isError) return;

		const textParts = event.content.filter((c): c is { type: "text"; text: string } => c.type === "text");
		if (textParts.length !== 1) return; // leave multi-part/image results alone

		const originalText = textParts[0].text;
		const result = tryCompact(originalText);
		recordResult(stats, result);

		if (!result.compacted || !result.text) return;
		if (!result.format || result.compactedBytes === null || result.savingsPct === null) return;

		// Append a one-line compact marker so the user sees, on the bash
		// tool row itself, that compaction happened and what it saved.
		// Keeps the preview body intact; the marker sits at the end of
		// the same text block.
		const marker = result.fullDataPath
			? `\n\n[compactor: ${result.format} ${humanBytes(result.originalBytes)} → ${humanBytes(result.compactedBytes)} (-${result.savingsPct}%); full → ${result.fullDataPath}]`
			: "";
		const newText = result.text + marker;

		return { content: [{ type: "text" as const, text: newText }] };
	});

	// ─── /compactor slash command ──────────────────────────────────────
	//
	// Usage:
	//   /compactor              show this session's savings (default)
	//   /compactor show         same
	//   /compactor today        aggregate /tmp/compact_data/ from today
	//   /compactor reset        clear session stats
	//   /compactor help         usage
	pi.registerCommand("compactor", {
		description: "Show result-compaction stats for this session and saved data dir.",
		handler: async (args, ctx) => {
			const action = (args.trim().split(/\s+/)[0] || "show").toLowerCase();
			switch (action) {
				case "reset":
					stats = resetSessionStats();
					ctx.ui.notify("Compactor session stats reset.", "info");
					return;
				case "help":
					ctx.ui.notify(
						[
							"/compactor         — show this session's savings",
							"/compactor today   — aggregate /tmp/compact_data/ from today",
							"/compactor reset   — clear session stats",
							"/compactor help    — this message",
						].join("\n"),
						"info",
					);
					return;
				case "today":
					renderDirSummary(ctx, dataDirStatsSince(process.env.PI_ACIDBATH_COMPACTOR_DATA_DIR || "/tmp/compact_data", startOfTodayTs()));
					return;
				case "show":
				case "":
					renderSessionSummary(ctx, stats);
					return;
				default:
					ctx.ui.notify(`Unknown subcommand: ${action}. Try /compactor help`, "error");
			}
		},
	});
}

// ─── helpers ─────────────────────────────────────────────────────────────

function startOfTodayTs(): number {
	const d = new Date();
	d.setHours(0, 0, 0, 0);
	return d.getTime();
}

function renderSessionSummary(ctx: any, stats: CompactorSessionStats): void {
	const s = summarize(stats);
	if (s.compactedCount === 0 && s.totalCalls === 0) {
		ctx.ui.notify("Compactor: no bash results seen yet this session.", "info");
		return;
	}
	const lines: string[] = [];
	lines.push(`Compactor — session ${humanDuration(s.durationMs)}`);
	lines.push(
		`compacted ${s.compactedCount}/${s.totalCalls} bash calls · ` +
		`saved ${humanBytes(s.totalSavedBytes)} (${s.totalSavedPct}%)`,
	);
	if (s.byFormat.length > 0) {
		lines.push("");
		lines.push("by format:");
		for (const f of s.byFormat) {
			lines.push(`  ${f.format.padEnd(12)} ${String(f.count).padStart(4)} ×  ${humanBytes(f.originalBytes)} → ${humanBytes(f.compactedBytes)} (-${f.savingsPct}%)`);
		}
	}
	if (s.biggestHit) {
		const h = s.biggestHit;
		lines.push("");
		lines.push(`biggest: ${h.format} ${humanBytes(h.originalBytes)} → ${humanBytes(h.compactedBytes)} (-${h.savingsPct}%)  ${h.fullDataPath ?? ""}`);
	}
	if (s.skippedTotal > 0) {
		lines.push("");
		lines.push(`skipped (${s.skippedTotal}):`);
		const reasons = Object.entries(s.skippedByReason).sort((a, b) => b[1] - a[1]);
		for (const [reason, n] of reasons) {
			lines.push(`  ${String(n).padStart(4)} ×  ${reason}`);
		}
	}
	if (s.recent.length > 0) {
		lines.push("");
		lines.push("recent (newest first):");
		for (const e of s.recent.slice(0, 5)) {
			lines.push(`  ${timeAgo(e.ts)}  ${e.format.padEnd(12)} ${humanBytes(e.originalBytes)} → ${humanBytes(e.compactedBytes)} (-${e.savingsPct}%)`);
		}
	}
	ctx.ui.notify(lines.join("\n"), "info");
}

function renderDirSummary(ctx: any, dirStats: ReturnType<typeof dataDirStats>): void {
	if (dirStats.fileCount === 0) {
		ctx.ui.notify("Compactor today: no saved files in the data dir yet.", "info");
		return;
	}
	const lines: string[] = [];
	lines.push(`Compactor today — ${dirStats.dir}`);
	lines.push(`files: ${dirStats.fileCount} · disk: ${humanBytes(dirStats.totalBytes)}` +
		(dirStats.noMetaCount > 0 ? ` (${dirStats.noMetaCount} pre-stats, no metadata)` : ""));
	if (dirStats.oldestTs && dirStats.newestTs) {
		lines.push(`range: ${new Date(dirStats.oldestTs).toLocaleString()} → ${new Date(dirStats.newestTs).toLocaleString()}`);
	}
	const formats = Object.entries(dirStats.byFormat).sort((a, b) => b[1].bytes - a[1].bytes);
	if (formats.length > 0) {
		lines.push("");
		lines.push("by format:");
		for (const [fmt, agg] of formats) {
			const origPct = agg.originalBytes > 0 ? ` (orig ${humanBytes(agg.originalBytes)})` : "";
			lines.push(`  ${fmt.padEnd(12)} ${String(agg.count).padStart(4)} files  ${humanBytes(agg.bytes)}${origPct}`);
		}
	}
	if (dirStats.topBySize.length > 0) {
		lines.push("");
		lines.push("top by size:");
		for (const f of dirStats.topBySize.slice(0, 5)) {
			lines.push(`  ${humanBytes(f.bytes).padStart(8)}  ${f.format.padEnd(8)}  ${shortPath(f.file)}`);
		}
	}
	ctx.ui.notify(lines.join("\n"), "info");
}

function humanDuration(ms: number): string {
	if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
	if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
	return `${(ms / 3_600_000).toFixed(1)}h`;
}

function shortPath(p: string): string {
	const base = p.split("/").pop() || p;
	return base.length > 40 ? `…${base.slice(-37)}` : base;
}

function timeAgo(ts: number, now: number = Date.now()): string {
	const ms = Math.max(0, now - ts);
	if (ms < 60_000) return `${Math.round(ms / 1000)}s ago`;
	if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
	return `${(ms / 3_600_000).toFixed(1)}h ago`;
}
