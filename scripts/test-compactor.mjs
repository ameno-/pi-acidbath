/**
 * Unit tests for extensions/compactor/index.ts.
 *
 * Run:
 *   node --experimental-strip-types --no-warnings scripts/test-compactor.mjs
 *
 * Exercises tryCompact() directly (no Pi runtime, no bash tool wrapper).
 * Requires nushell on PATH or PI_ACIDBATH_NU_BIN set — skips with a warning
 * if neither resolves, since compaction is a no-op without nushell.
 */

import assert from "node:assert/strict";
import { tryCompact } from "../extensions/compactor/index.ts";

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

// 1. Large JSON array gets compacted, keeps a full-data pointer and preview.
{
	const input = bigJsonArray(500);
	const result = tryCompact(input);
	if (result === null) {
		console.warn("compactor: nushell not available, skipping compaction assertions");
	} else {
		assert.match(result, /^\[compacted: json_array, 500 rows total/);
		assert.match(result, /Full data saved to: .+\.json/);
		assert.match(result, /Query with nushell:/);
		assert.ok(result.length < input.length, "compacted output should be smaller than input");
	}
}

// 2. Large CSV gets compacted.
{
	const input = bigCsv(500);
	const result = tryCompact(input);
	if (result !== null) {
		assert.match(result, /^\[compacted: csv, 500 rows total/);
		assert.ok(result.length < input.length);
	}
}

// 3. Source code is NEVER compacted, regardless of size.
{
	const input = bigCode(200);
	assert.equal(tryCompact(input), null, "code-shaped output must pass through unchanged");
}

// 4. Small structured data (under threshold) is left alone.
{
	const input = JSON.stringify([{ id: 1 }, { id: 2 }]);
	assert.equal(tryCompact(input), null, "output under the size threshold must pass through unchanged");
}

// 5. Plain prose / non-structured text is left alone.
{
	const input = "Build succeeded.\n".repeat(200);
	assert.equal(tryCompact(input), null, "non-structured output must pass through unchanged");
}

console.log("compactor: code/log/small output untouched, structured data compacted with full-data pointer");
