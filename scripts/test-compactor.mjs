/**
 * Unit tests for the compactor core (extensions/compactor/lib.ts).
 *
 * Run:
 *   node --experimental-strip-types --no-warnings scripts/test-compactor.mjs
 *
 * Exercises tryCompact()/queryFile()/fileSchema() directly (no Pi runtime,
 * no MCP server). Requires nushell on PATH or PI_ACIDBATH_NU_BIN set —
 * compaction assertions are skipped with a warning if neither resolves,
 * since compaction is a no-op without nushell.
 */

import assert from "node:assert/strict";
import * as fs from "node:fs";
import { tryCompact, detectFormat, isCode, isLog, queryFile, fileSchema } from "../extensions/compactor/lib.ts";

function bigJsonArray(n) {
	const rows = [];
	for (let i = 0; i < n; i++) rows.push({ id: i, name: `item-${i}`, status: i % 2 === 0 ? "active" : "idle" });
	return JSON.stringify(rows);
}

function bigCsv(n) {
	const lines = ["id,name,status"];
	for (let i = 0; i < n; i++) lines.push(`${i},item-${i},${i % 2 === 0 ? "active" : "idle"}`);
	return lines.join("\n");
}

function bigCode(n) {
	const lines = [];
	for (let i = 0; i < n; i++) lines.push(`function handler${i}(req, res) {\n  return res.json({ id: ${i} });\n}`);
	return lines.join("\n\n");
}

// ─── pure guards (no nushell needed) ─────────────────────────────────────

// G1. Format detection (low threshold so small fixtures qualify)
const T = 20;
assert.equal(detectFormat(bigJsonArray(30), T), "json_array");
assert.equal(detectFormat(JSON.stringify({ items: Array.from({ length: 120 }, (_, i) => ({ id: i, value: `v${i}` })), meta: { source: "test" } }), T), "json_object");
assert.equal(detectFormat('{"id":1}\n{"id":2}\n{"id":3}\n{"id":4}\n{"id":5}\n{"id":6}', T), "ndjson");
assert.equal(detectFormat(bigCsv(30), T), "csv");
assert.equal(detectFormat("id\tname\n1\ta\n2\tb\n3\tc\n4\td\n5\te", T), "tsv");
assert.equal(detectFormat("Build succeeded.\n".repeat(200), T), null);

// G2. Code / log guards
assert.ok(isCode(bigCode(20)), "code-shaped output must be detected");
assert.ok(!isCode(bigJsonArray(30)), "json is not code");
assert.ok(isLog("[INFO] started\n[INFO] running\n[ERROR] failed\n[WARN] retrying\n[INFO] done\n[INFO] exit"), "log-shaped output must be detected");
assert.ok(!isLog(bigJsonArray(30)), "json is not a log");

// ─── compaction (needs nushell) ──────────────────────────────────────────

const sample = bigJsonArray(500);
const maybeNoNu = tryCompact(sample).reason?.startsWith("nushell not found");
if (maybeNoNu) {
	console.warn("compactor: nushell not available, skipping compaction assertions");
} else {
	// 1. Large JSON array gets compacted, keeps a full-data pointer and preview.
	{
		const result = tryCompact(sample);
		assert.ok(result.compacted, `expected compaction, got reason: ${result.reason}`);
		assert.match(result.text, /^\[compacted: json_array, 500 rows total/);
		assert.match(result.text, /Full data saved to: .+\.json/);
		assert.match(result.text, /Query with nushell:/);
		assert.ok(result.compactedBytes < result.originalBytes, "compacted output should be smaller than input");
		assert.ok(result.savingsPct > 0);

		// Full data on disk must be byte-identical (nushell-as-DB: nothing lost).
		assert.ok(fs.existsSync(result.fullDataPath), "full data file must exist");
		assert.equal(fs.readFileSync(result.fullDataPath, "utf-8"), sample, "full data must be byte-identical");
	}

	// 2. Large CSV gets compacted.
	{
		const input = bigCsv(500);
		const result = tryCompact(input);
		assert.ok(result.compacted, `expected CSV compaction, got reason: ${result.reason}`);
		assert.match(result.text, /^\[compacted: csv, 500 rows total/);
		assert.ok(result.compactedBytes < result.originalBytes);
	}

	// 3. Source code is NEVER compacted, regardless of size.
	{
		const input = bigCode(200);
		const result = tryCompact(input);
		assert.equal(result.compacted, false, "code-shaped output must pass through unchanged");
		assert.equal(result.reason, "looks like code");
	}

	// 4. Small structured data (under threshold) is left alone.
	{
		const input = JSON.stringify([{ id: 1 }, { id: 2 }]);
		const result = tryCompact(input);
		assert.equal(result.compacted, false);
		assert.equal(result.reason, "below threshold");
	}

	// 5. Plain prose / non-structured text is left alone.
	{
		const input = "Build succeeded.\n".repeat(200);
		const result = tryCompact(input);
		assert.equal(result.compacted, false);
		assert.match(result.reason, /not structured/);
	}

	// 6. queryFile: the saved data is queryable (the query half of nushell-as-DB).
	{
		const saved = tryCompact(sample).fullDataPath;
		const count = queryFile(saved, 'where status == "active" | length');
		assert.ok(count.success, `query failed: ${count.output}`);
		assert.equal(count.output.trim(), "250");

		const head = queryFile(saved, "first 3");
		assert.ok(head.success);
		assert.ok(head.output.includes("item-1"), `expected item-1 in head query, got: ${head.output}`);
		assert.equal(head.nuon, true, "table output should be re-rendered as NUON");

		const missing = queryFile("/tmp/definitely-not-here.json", "length");
		assert.equal(missing.success, false);
		assert.match(missing.output, /file not found/);
	}

	// 7. fileSchema: shape/columns/rows of a saved file.
	{
		const saved = tryCompact(sample).fullDataPath;
		const schema = fileSchema(saved);
		assert.ok(schema.success, `schema failed: ${schema.error}`);
		assert.deepEqual(schema.columns, ["id", "name", "status"]);
		assert.equal(schema.rows, 500);
		assert.ok(schema.shape.length > 0);
	}

	// 8. previewRows override: fewer rows in the preview.
	{
		const result = tryCompact(sample, { previewRows: 3 });
		assert.ok(result.compacted, `expected compaction with previewRows=3, got: ${result.reason}`);
		assert.match(result.text, /showing first 3/);
	}
}

console.log("compactor: guards, compaction, queryFile, fileSchema all pass");
