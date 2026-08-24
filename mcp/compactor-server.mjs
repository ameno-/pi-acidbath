#!/usr/bin/env node
/**
 * compactor MCP server — expose the validated compaction core to any
 * MCP client (Claude Code, Droids, Codex, Aider, ...).
 *
 * Zero dependencies: hand-rolled JSON-RPC 2.0 over stdio (newline-
 * delimited, the framing used by most stdio MCP transports). The
 * compaction logic itself lives in ../extensions/compactor/lib.ts
 * (nushell-powered; validated at 37.2% token savings on SWE-bench
 * Lite, 100% pass rate).
 *
 * Tools:
 *   compact { text, previewRows? }
 *     Compact structured data (JSON/NDJSON/CSV/TSV). The full input is
 *     always saved to disk first (nushell-as-DB); the result contains
 *     the compacted preview, savings stats, and the path to the full
 *     data.
 *   query { file, pipeline }
 *     Run a nushell pipeline against a saved data file (e.g.
 *     'where status == "active" | length'). This is the query half of
 *     nushell-as-DB — drill into compacted data without re-loading it
 *     into context.
 *   schema { file }
 *     Describe a saved data file: nushell shape, columns, row count.
 *
 * Run:
 *   node mcp/compactor-server.mjs
 *
 * Claude Code registration (~/.claude/mcp.json):
 *   {
 *     "mcpServers": {
 *       "acidbath-compactor": {
 *         "command": "node",
 *         "args": ["/home/donatello/dev/pi-acidbath/mcp/compactor-server.mjs"]
 *       }
 *     }
 *   }
 *
 * Requires nushell on PATH (or PI_ACIDBATH_NU_BIN set). Without nushell
 * the server still starts and reports the unavailability in results.
 */

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { tryCompact, queryFile, fileSchema, dataDirStats } from "../extensions/compactor/lib.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VERSION = JSON.parse(readFileSync(path.join(__dirname, "..", "package.json"), "utf-8")).version;
const MAX_QUERY_CHARS = 100_000; // bound tool results for context safety
const MAX_TEXT_CHARS = 500_000; // bound compact input size

const SERVER_INFO = { name: "acidbath-compactor", version: VERSION };

const TOOLS = [
	{
		name: "compact",
		description:
			"Compact large structured data (JSON array/object, NDJSON, CSV, TSV) into a small preview with " +
			"savings stats. The full input is always saved to disk first — the result includes the file path " +
			"so you can retrieve the complete data via the query tool. Use this when you have a large data dump " +
			"and only need to reason about a sample. Never use it on source code or logs.",
		inputSchema: {
			type: "object",
			properties: {
				text: { type: "string", description: "The structured data to compact (JSON/NDJSON/CSV/TSV)." },
				previewRows: {
					type: "number",
					description: "Number of preview rows to show (default 20).",
					minimum: 1,
					maximum: 100,
				},
			},
			required: ["text"],
		},
	},
	{
		name: "query",
		description:
			"Run a nushell pipeline against a saved data file (JSON/NDJSON/CSV/TSV, e.g. from the compact tool's " +
			"full_data_path). The pipeline is applied to `open <file>`, e.g. 'where status == \"active\" | length', " +
			"'group-by status | items { |k,v| {status: $k, count: ($v | length)} }', 'first 5'. Use this to drill " +
			"into compacted data without loading it into context.",
		inputSchema: {
			type: "object",
			properties: {
				file: { type: "string", description: "Path to the data file (from compact's full_data_path or any JSON/NDJSON/CSV/TSV file)." },
				pipeline: { type: "string", description: "Nushell pipeline applied to the opened data." },
			},
			required: ["file", "pipeline"],
		},
	},
	{
		name: "schema",
		description:
			"Describe a saved data file: nushell type shape, column names, and row count. Use before querying to " +
			"learn the structure of a file produced by the compact tool.",
		inputSchema: {
			type: "object",
			properties: {
				file: { type: "string", description: "Path to the data file." },
			},
			required: ["file"],
		},
	},
	{
		name: "stats",
		description:
			"Aggregate stats over the saved-data directory (default /tmp/compact_data/): file count, " +
			"total bytes on disk, breakdown by format (json/csv/tsv/ndjson), oldest/newest timestamps, and " +
			"the top 10 largest saved files. Reads each file's sidecar metadata — no nushell required and no " +
			"data is loaded. Use this to see what the compactor has saved so far and how much disk space it uses.",
		inputSchema: {
			type: "object",
			properties: {
				dir: { type: "string", description: "Directory to scan (default /tmp/compact_data/)." },
				sinceTs: {
					type: "number",
					description: "Only include files saved at or after this unix-ms timestamp (for /compactor today style filters).",
				},
				top: {
					type: "number",
					description: "Number of top-by-size entries to return (default 10, max 50).",
					minimum: 1,
					maximum: 50,
				},
			},
		},
	},
];

// ─── tool execution ──────────────────────────────────────────────────────

function toolText(parts) {
	const text = typeof parts === "string" ? parts : parts.map((p) => p.text).join("\n");
	return { content: [{ type: "text", text }] };
}

function handleTool(name, args) {
	try {
		switch (name) {
			case "compact": {
				const text = String(args?.text ?? "");
				if (!text) return { content: [{ type: "text", text: "error: text is required" }], isError: true };
				if (text.length > MAX_TEXT_CHARS)
					return { content: [{ type: "text", text: `error: input too large (${text.length} > ${MAX_TEXT_CHARS} chars)` }], isError: true };

				const previewRows = typeof args.previewRows === "number" ? args.previewRows : undefined;
				const result = tryCompact(text, previewRows ? { previewRows } : {});

				if (!result.compacted) {
					return toolText(
						`not compacted: ${result.reason}\n` +
						(inputNote(result.originalBytes)),
					);
				}
				return toolText(
					[
						result.text,
						"",
						`stats: format=${result.format} rows=${result.totalRows} ` +
						`original=${result.originalBytes}B compacted=${result.compactedBytes}B savings=${result.savingsPct}%`,
						`full_data_path: ${result.fullDataPath ?? "(not saved)"}`,
						`To inspect the full data use the "schema" tool, then "query" (nushell pipelines).`,
					].join("\n"),
				);
			}

			case "query": {
				const file = String(args?.file ?? "");
				const pipeline = String(args?.pipeline ?? "");
				if (!file) return { content: [{ type: "text", text: "error: file is required" }], isError: true };
				if (!pipeline.trim()) return { content: [{ type: "text", text: "error: pipeline is required" }], isError: true };

				const result = queryFile(file, pipeline);
				if (!result.success) return { content: [{ type: "text", text: result.output }], isError: true };
				const bounded = boundOutput(result.output);
				return toolText(bounded.text);
			}

			case "schema": {
				const file = String(args?.file ?? "");
				if (!file) return { content: [{ type: "text", text: "error: file is required" }], isError: true };
				const result = fileSchema(file);
				if (!result.success) return { content: [{ type: "text", text: result.error }], isError: true };
				return toolText(
					[
						`file: ${file}`,
						`shape: ${result.shape}`,
						`rows: ${result.rows ?? "?"}`,
						`columns: ${result.columns ? result.columns.join(", ") : "?"}`,
					].join("\n"),
				);
			}

			case "stats": {
				const dir = String(args?.dir ?? "/tmp/compact_data/");
				const sinceTs = typeof args?.sinceTs === "number" ? args.sinceTs : null;
				const top = typeof args?.top === "number" ? Math.max(1, Math.min(50, args.top)) : 10;
				const full = dataDirStats(dir);
				const filtered = sinceTs !== null ? filterSince(full, sinceTs) : full;
				return toolText(renderStats(filtered, top));
			}

			default:
				return { content: [{ type: "text", text: `error: unknown tool ${name}` }], isError: true };
		}
	} catch (e) {
		return { content: [{ type: "text", text: `error: ${e?.message ?? e}` }], isError: true };
	}
}

function inputNote(originalBytes) {
	if (originalBytes > 0) return `(input was ${originalBytes} bytes)`;
	return "";
}

function boundOutput(output) {
	if (output.length <= MAX_QUERY_CHARS) return { text: output };
	return {
		text:
			output.slice(0, MAX_QUERY_CHARS) +
			`\n[truncated: ${output.length - MAX_QUERY_CHARS} more chars — refine the pipeline to narrow the result]`,
	};
}

// ─── stats tool helpers ─────────────────────────────────────────────────

function humanBytes(n) {
	if (!Number.isFinite(n)) return "?B";
	if (n < 1024) return `${n}B`;
	if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
	return `${(n / (1024 * 1024)).toFixed(2)}MB`;
}

function filterSince(stats, sinceTs) {
	const recent = stats.topBySize.filter((e) => e.ts >= sinceTs);
	const byFormat = {};
	let totalBytes = 0;
	let oldestTs = null;
	let newestTs = null;
	for (const e of recent) {
		const b = byFormat[e.format] ?? (byFormat[e.format] = { count: 0, bytes: 0, originalBytes: 0 });
		b.count++;
		b.bytes += e.bytes;
		totalBytes += e.bytes;
		if (oldestTs === null || e.ts < oldestTs) oldestTs = e.ts;
		if (newestTs === null || e.ts > newestTs) newestTs = e.ts;
	}
	return {
		dir: stats.dir,
		fileCount: recent.length,
		totalBytes,
		oldestTs,
		newestTs,
		byFormat,
		topBySize: recent,
		noMetaCount: 0,
	};
}

function renderStats(s, top) {
	if (s.fileCount === 0) {
		return `stats: ${s.dir}\nfiles: 0\ndisk: 0B`;
	}
	const lines = [];
	lines.push(`stats: ${s.dir}`);
	lines.push(`files: ${s.fileCount} · disk: ${humanBytes(s.totalBytes)}`);
	if (s.noMetaCount > 0) lines.push(`(${s.noMetaCount} files predate metadata — counts only)`);
	if (s.oldestTs && s.newestTs) {
		lines.push(`range: ${new Date(s.oldestTs).toISOString()} → ${new Date(s.newestTs).toISOString()}`);
	}
	const formats = Object.entries(s.byFormat).sort((a, b) => b[1].bytes - a[1].bytes);
	if (formats.length > 0) {
		lines.push("");
		lines.push("by format:");
		for (const [fmt, agg] of formats) {
			const orig = agg.originalBytes > 0 ? `  (orig ${humanBytes(agg.originalBytes)})` : "";
			lines.push(`  ${fmt.padEnd(12)} ${String(agg.count).padStart(4)} files  ${humanBytes(agg.bytes)}${orig}`);
		}
	}
	if (s.topBySize.length > 0) {
		lines.push("");
		lines.push(`top by size (${Math.min(top, s.topBySize.length)}):`);
		for (const f of s.topBySize.slice(0, top)) {
			lines.push(`  ${humanBytes(f.bytes).padStart(8)}  ${f.format.padEnd(8)}  ${path.basename(f.file)}`);
		}
	}
	return lines.join("\n");
}

// ─── JSON-RPC 2.0 over stdio ─────────────────────────────────────────────

function send(msg) {
	process.stdout.write(JSON.stringify(msg) + "\n");
}

function reply(id, result) {
	send({ jsonrpc: "2.0", id, result });
}

function replyError(id, code, message, data) {
	const err = { code, message };
	if (data !== undefined) err.data = data;
	send({ jsonrpc: "2.0", id, error: err });
}

function handleRequest(msg) {
	const { id, method, params } = msg;

	switch (method) {
		case "initialize":
			reply(id, {
				protocolVersion: params?.protocolVersion ?? "2025-06-18",
				capabilities: { tools: {} },
				serverInfo: SERVER_INFO,
				instructions:
					"Compaction tools backed by the validated nushell compactor (37.2% token savings on SWE-bench). " +
					"Use compact on large structured data dumps, then schema + query to drill into the saved full data. " +
					"Never use compact on source code or logs.",
			});
			break;

		case "tools/list":
			reply(id, { tools: TOOLS });
			break;

		case "tools/call": {
			const name = params?.name;
			const args = params?.arguments ?? {};
			if (!TOOLS.some((t) => t.name === name)) {
				replyError(id, -32602, `unknown tool: ${name}`);
				break;
			}
			reply(id, handleTool(name, args));
			break;
		}

		case "ping":
			reply(id, {});
			break;

		default:
			// Unknown method with an id → method-not-found; without an id it
			// was a notification → ignore (clients send initialized as one).
			if (id !== undefined) replyError(id, -32601, `method not found: ${method}`);
	}
}

// Notifications (no id) like "notifications/initialized" are handled by
// falling through to the default case above.

function main() {
	let buffer = "";
	process.stdin.setEncoding("utf-8");
	process.stdin.on("data", (chunk) => {
		buffer += chunk;
		let idx;
		while ((idx = buffer.indexOf("\n")) >= 0) {
			const line = buffer.slice(0, idx).trim();
			buffer = buffer.slice(idx + 1);
			if (!line) continue;
			let msg;
			try {
				msg = JSON.parse(line);
			} catch {
				// malformed line — report if it looked like it had an id
				continue;
			}
			try {
				handleRequest(msg);
			} catch (e) {
				if (msg.id !== undefined) replyError(msg.id, -32603, `internal error: ${e?.message ?? e}`);
			}
		}
	});
	process.stdin.on("end", () => process.exit(0));
	process.on("SIGINT", () => process.exit(0));
	process.on("SIGTERM", () => process.exit(0));
}

main();
