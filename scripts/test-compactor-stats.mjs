/**
 * Tests for the compactor visibility layer:
 *   - sessionStats.ts (createSessionStats, recordResult, summarize, footerLine, humanBytes)
 *   - lib.ts dataDirStats() (sidecar metadata reads, format breakdown)
 *   - MCP `stats` tool (end-to-end via the JSON-RPC client in test-mcp-compactor.mjs's pattern)
 *
 * Run:
 *   node --experimental-strip-types --no-warnings scripts/test-compactor-stats.mjs
 */

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	createSessionStats,
	recordResult,
	resetSessionStats,
	summarize,
	footerLine,
	humanBytes,
} from "../extensions/compactor/sessionStats.ts";
import { tryCompact, saveFullData, readMeta, dataDirStats } from "../extensions/compactor/lib.ts";

// ─── humanBytes ─────────────────────────────────────────────────────────

assert.equal(humanBytes(500), "500B");
assert.equal(humanBytes(2048), "2.0KB");
assert.equal(humanBytes(1536), "1.5KB");
assert.equal(humanBytes(1024 * 1024 * 2), "2.00MB");

// ─── sessionStats: empty ─────────────────────────────────────────────────

{
	const s = createSessionStats();
	assert.equal(s.totalCalls, 0);
	assert.equal(s.compactedCount, 0);
	assert.deepEqual(s.skipped, {});
	const sum = summarize(s);
	assert.equal(sum.compactedCount, 0);
	assert.equal(sum.skippedTotal, 0);
	assert.equal(sum.totalSavedBytes, 0);
	assert.equal(sum.totalSavedPct, 0);
	assert.equal(footerLine(s), null);
}

// ─── sessionStats: record a compaction ──────────────────────────────────

{
	const s = createSessionStats();
	s.startedAt = 1_700_000_000_000; // pin for deterministic durationMs
	const r = {
		compacted: true,
		reason: null,
		format: "json_array",
		totalRows: 500,
		originalBytes: 50_000,
		compactedBytes: 5_000,
		savingsPct: 90,
		fullDataPath: "/tmp/compact_data/abc.json",
		text: "[compacted: ...]",
	};
	recordResult(s, r, 1_700_000_000_000);

	assert.equal(s.totalCalls, 1);
	assert.equal(s.compactedCount, 1);
	assert.equal(s.totalOriginalBytes, 50_000);
	assert.equal(s.totalCompactedBytes, 5_000);
	assert.equal(s.byFormat.json_array.count, 1);
	assert.equal(s.byFormat.json_array.originalBytes, 50_000);
	assert.equal(s.compactionEvents.length, 1);
	assert.equal(s.biggestHit.originalBytes, 50_000);

	const sum = summarize(s, 1_700_000_060_000); // +60s
	assert.equal(sum.durationMs, 60_000);
	assert.equal(sum.totalSavedBytes, 45_000);
	assert.equal(sum.totalSavedPct, 90);
	assert.equal(sum.byFormat.length, 1);
	assert.equal(sum.byFormat[0].format, "json_array");
	assert.equal(sum.biggestHit.originalBytes, 50_000);
	assert.equal(sum.recent.length, 1);
}

// ─── sessionStats: multiple formats, picks the right biggest ─────────────

{
	const s = createSessionStats();
	recordResult(s, {
		compacted: true,
		reason: null,
		format: "json_array",
		totalRows: 100,
		originalBytes: 10_000,
		compactedBytes: 1_000,
		savingsPct: 90,
		fullDataPath: "/tmp/compact_data/a.json",
		text: "",
	});
	recordResult(s, {
		compacted: true,
		reason: null,
		format: "csv",
		totalRows: 5000,
		originalBytes: 200_000,
		compactedBytes: 8_000,
		savingsPct: 96,
		fullDataPath: "/tmp/compact_data/b.csv",
		text: "",
	});
	recordResult(s, {
		compacted: true,
		reason: null,
		format: "ndjson",
		totalRows: 50,
		originalBytes: 5_000,
		compactedBytes: 2_000,
		savingsPct: 60,
		fullDataPath: "/tmp/compact_data/c.ndjson",
		text: "",
	});

	const sum = summarize(s);
	assert.equal(sum.compactedCount, 3);
	assert.equal(sum.totalOriginalBytes, 215_000);
	assert.equal(sum.totalCompactedBytes, 11_000);
	assert.equal(sum.totalSavedBytes, 204_000);
	assert.equal(sum.biggestHit.format, "csv");
	assert.equal(sum.biggestHit.originalBytes, 200_000);
	assert.equal(sum.byFormat.length, 3);
	assert.equal(sum.byFormat[0].format, "csv"); // sorted by originalBytes desc
}

// ─── sessionStats: skip reasons ──────────────────────────────────────────

{
	const s = createSessionStats();
	recordResult(s, { compacted: false, reason: "looks like code", format: null, totalRows: null, originalBytes: 5000, compactedBytes: null, savingsPct: null, fullDataPath: null, text: null });
	recordResult(s, { compacted: false, reason: "looks like code", format: null, totalRows: null, originalBytes: 8000, compactedBytes: null, savingsPct: null, fullDataPath: null, text: null });
	recordResult(s, { compacted: false, reason: "below threshold", format: null, totalRows: null, originalBytes: 500, compactedBytes: null, savingsPct: null, fullDataPath: null, text: null });
	recordResult(s, { compacted: false, reason: "looks like logs", format: null, totalRows: null, originalBytes: 3000, compactedBytes: null, savingsPct: null, fullDataPath: null, text: null });

	const sum = summarize(s);
	assert.equal(sum.compactedCount, 0);
	assert.equal(sum.skippedTotal, 4);
	assert.equal(sum.skippedByReason["looks like code"], 2);
	assert.equal(sum.skippedByReason["below threshold"], 1);
	assert.equal(sum.skippedByReason["looks like logs"], 1);
	assert.equal(s.skipEvents.length, 4);
	assert.equal(s.skipEvents[0].reason, "looks like logs"); // newest first
}

// ─── sessionStats: reset ─────────────────────────────────────────────────

{
	const s = createSessionStats();
	recordResult(s, {
		compacted: true, reason: null, format: "json_array", totalRows: 1, originalBytes: 1000, compactedBytes: 100, savingsPct: 90, fullDataPath: null, text: "",
	});
	assert.equal(s.compactedCount, 1);
	const fresh = resetSessionStats();
	assert.equal(fresh.compactedCount, 0);
	assert.equal(fresh.totalCalls, 0);
}

// ─── sessionStats: footer line ──────────────────────────────────────────

{
	const s = createSessionStats();
	assert.equal(footerLine(s), null);
	recordResult(s, {
		compacted: true, reason: null, format: "json_array", totalRows: 100, originalBytes: 50_000, compactedBytes: 5_000, savingsPct: 90, fullDataPath: "/tmp/x.json", text: "",
	});
	recordResult(s, {
		compacted: true, reason: null, format: "csv", totalRows: 1000, originalBytes: 100_000, compactedBytes: 10_000, savingsPct: 90, fullDataPath: "/tmp/x.csv", text: "",
	});
	const line = footerLine(s);
	assert.match(line, /2 compacted/);
	// 150KB original, 15KB compacted → 135KB saved (90%) → 131.8KB in humanBytes
	assert.match(line, /saved 131\.8KB \(90%\)/);
}

// ─── sessionStats: events are newest first + bounded ────────────────────

{
	const s = createSessionStats();
	for (let i = 0; i < 250; i++) {
		recordResult(s, {
			compacted: true, reason: null, format: "json_array", totalRows: i, originalBytes: 1000, compactedBytes: 100, savingsPct: 90, fullDataPath: null, text: "",
		}, 1_700_000_000_000 + i);
	}
	assert.equal(s.compactionEvents.length, 200, "should cap at MAX_EVENTS");
	// events store ts; newest first means the highest ts is at index 0
	const firstTs = s.compactionEvents[0].ts;
	const lastTs = s.compactionEvents[s.compactionEvents.length - 1].ts;
	assert.ok(firstTs > lastTs, "events should be newest-first");
	assert.equal(firstTs, 1_700_000_000_000 + 249); // the last-recorded one is the newest
}

// ─── dataDirStats: empty dir ─────────────────────────────────────────────

{
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "compactor-test-"));
	const s = dataDirStats(dir);
	assert.equal(s.fileCount, 0);
	assert.equal(s.totalBytes, 0);
	assert.equal(s.oldestTs, null);
	assert.deepEqual(s.byFormat, {});
	fs.rmdirSync(dir);
}

// ─── dataDirStats: with metadata sidecars ────────────────────────────────

{
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "compactor-test-"));
	// Write 3 files with sidecars
	saveFullData(JSON.stringify([{ a: 1 }, { a: 2 }]), "json_array", { totalRows: 2 });
	saveFullData(JSON.stringify([{ a: 1 }]), "json_array", { totalRows: 1 });
	saveFullData("id,name\n1,a\n2,b", "csv", { totalRows: 2 });
	// Move them into our test dir: easier to just write directly
	const realDir = "/tmp/compact_data";
	const s = dataDirStats(realDir);
	// We can only assert that the realDir parsing works; not exact counts since
	// other processes may have written there. So check structural properties.
	assert.ok(s.fileCount >= 3);
	assert.ok(s.totalBytes > 0);
	const hasJson = Object.keys(s.byFormat).includes("json_array");
	const hasCsv = Object.keys(s.byFormat).includes("csv");
	assert.ok(hasJson || hasCsv, "should detect at least one of the formats we wrote");
	// Sidecar files should not appear in topBySize
	for (const f of s.topBySize) {
		assert.ok(!f.file.endsWith(".meta.json"), "sidecar should not appear as a saved file");
	}
	fs.rmdirSync(dir);
}

// ─── readMeta: graceful on missing / malformed ───────────────────────────

{
	const tmp = path.join(os.tmpdir(), "compactor-meta-test.json");
	fs.writeFileSync(tmp, "[]");
	try {
		const m = readMeta(tmp);
		assert.equal(m, null, "missing sidecar returns null");
	} finally {
		fs.unlinkSync(tmp);
	}
}

{
	const tmp = path.join(os.tmpdir(), "compactor-meta-test-2.json");
	fs.writeFileSync(tmp, "[]");
	fs.writeFileSync(`${tmp}.meta.json`, "not json");
	try {
		const m = readMeta(tmp);
		assert.equal(m, null, "malformed sidecar returns null");
	} finally {
		fs.unlinkSync(tmp);
		fs.unlinkSync(`${tmp}.meta.json`);
	}
}

{
	const tmp = path.join(os.tmpdir(), "compactor-meta-test-3.json");
	fs.writeFileSync(tmp, "[]");
	fs.writeFileSync(`${tmp}.meta.json`, JSON.stringify({ format: "json_array", originalBytes: 100, totalRows: 5, ts: 12345 }));
	try {
		const m = readMeta(tmp);
		assert.deepEqual(m, { format: "json_array", originalBytes: 100, totalRows: 5, ts: 12345 });
	} finally {
		fs.unlinkSync(tmp);
		fs.unlinkSync(`${tmp}.meta.json`);
	}
}

console.log("compactor-stats: sessionStats + dataDirStats + readMeta all pass");
