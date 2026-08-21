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
import { tryCompact } from "./lib.ts";

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
	pi.on("tool_result", (event) => {
		if (event.toolName !== "bash" || event.isError) return;

		const textParts = event.content.filter((c): c is { type: "text"; text: string } => c.type === "text");
		if (textParts.length !== 1) return; // leave multi-part/image results alone

		const compacted = tryCompactText(textParts[0].text);
		if (!compacted) return;

		return { content: [{ type: "text" as const, text: compacted }] };
	});
}
