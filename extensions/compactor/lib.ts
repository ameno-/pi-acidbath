/**
 * compactor core — pure compaction logic, no Pi API.
 *
 * Shared by:
 *   - extensions/compactor/index.ts  (Pi `tool_result` hook)
 *   - mcp/compactor-server.mjs       (MCP server for Claude Code et al.)
 *
 * The design decisions are documented in extensions/compactor/index.ts:
 *   - only structured data (JSON/CSV/TSV/NDJSON) over the threshold
 *   - never code or logs
 *   - full data saved to disk ("nushell as DB") before any compaction
 *   - compacting is skipped when it wouldn't actually save bytes
 */

import { execFileSync } from "node:child_process";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// ─── config ──────────────────────────────────────────────────────────────

const COMPACTION_THRESHOLD = envInt("PI_ACIDBATH_COMPACTOR_THRESHOLD", "COMPACTOR_THRESHOLD", 2048);
const PREVIEW_ROWS = envInt("PI_ACIDBATH_COMPACTOR_PREVIEW_ROWS", "COMPACTOR_PREVIEW_ROWS", 20);
const NU_TIMEOUT_MS = 15_000;
const COMPACT_DATA_DIR =
	process.env.PI_ACIDBATH_COMPACTOR_DATA_DIR || process.env.COMPACTOR_DATA_DIR || "/tmp/compact_data";
const DEBUG = process.env.PI_ACIDBATH_COMPACTOR_DEBUG === "1" || process.env.COMPACTOR_DEBUG === "1";
const DISABLED = process.env.PI_ACIDBATH_COMPACTOR_DISABLE === "1" || process.env.COMPACTOR_DISABLE === "1";

function envInt(primary: string, secondary: string, fallback: number): number {
	const raw = process.env[primary] ?? process.env[secondary];
	if (!raw) return fallback;
	const parsed = Number.parseInt(raw, 10);
	return Number.isFinite(parsed) ? parsed : fallback;
}

function debug(msg: string): void {
	if (DEBUG) process.stderr.write(`[compactor] ${msg}\n`);
}

const NU_BIN = resolveNuBin();

function resolveNuBin(): string | null {
	const override = process.env.PI_ACIDBATH_NU_BIN || process.env.COMPACTOR_NU_BIN;
	const candidates = [override, path.join(os.homedir(), ".local/bin/nu"), "nu"].filter(
		(p): p is string => !!p,
	);
	for (const candidate of candidates) {
		try {
			if (candidate === "nu") {
				execFileSync("which", ["nu"], { stdio: ["ignore", "ignore", "ignore"] });
				return "nu";
			}
			if (fs.existsSync(candidate)) return candidate;
		} catch {
			// try next candidate
		}
	}
	return null;
}

// Ensure the temp data directory exists
try {
	fs.mkdirSync(COMPACT_DATA_DIR, { recursive: true });
} catch {}

// ─── helpers ─────────────────────────────────────────────────────────────

function runNuWithInput(pipeline: string, input: string): { success: boolean; output: string } {
	if (!NU_BIN) return { success: false, output: "nushell not found" };
	try {
		const result = execFileSync(NU_BIN, ["--stdin", "-c", pipeline], {
			encoding: "utf-8",
			input,
			timeout: NU_TIMEOUT_MS,
			stdio: ["pipe", "pipe", "pipe"],
		});
		return { success: true, output: result.trim() };
	} catch (e: any) {
		return { success: false, output: e.stderr?.trim() || e.stdout?.trim() || e.message };
	}
}

/**
 * Run a pipeline against a file. The path is passed via env var
 * (COMPACTOR_FILE) rather than interpolated into the pipeline string, so
 * paths with quotes/spaces need no escaping.
 */
function runNuOnFile(file: string, pipeline: string): { success: boolean; output: string } {
	if (!NU_BIN) return { success: false, output: "nushell not found" };
	const openExpr = pipeline.startsWith("open ") || pipeline.startsWith("open\t")
		? pipeline
		: `open $env.COMPACTOR_FILE | ${pipeline}`;
	try {
		const result = execFileSync(NU_BIN, ["-c", openExpr], {
			encoding: "utf-8",
			timeout: NU_TIMEOUT_MS,
			stdio: ["pipe", "pipe", "pipe"],
			env: { ...process.env, COMPACTOR_FILE: file },
		});
		return { success: true, output: result.trim() };
	} catch (e: any) {
		return { success: false, output: e.stderr?.trim() || e.stdout?.trim() || e.message };
	}
}

// ─── content-type guards ─────────────────────────────────────────────────

const CODE_INDICATORS = [
	"import ", "from ", "def ", "class ", "function ", "const ", "var ",
	"let ", "#include", "package ", "public ", "private ", "func ",
	"async ", "await ", "return ", "=>", "->", "if (", "for (", "while (",
	"fn ", "void ", "int ", "char ", "struct ",
];

const LOG_INDICATORS = [
	"[INFO]", "[WARN]", "[WARNING]", "[ERROR]", "[DEBUG]", "[TRACE]",
	"INFO ", "WARN ", "ERROR ", "DEBUG ", "TRACE ", "request_id=", "trace_id=",
];

export function isCode(text: string): boolean {
	const stripped = text.trim();
	if (!stripped) return false;
	const lines = stripped.split("\n").filter((l) => l.trim()).slice(0, 5);
	if (lines.length === 0) return false;
	let codeHits = 0;
	for (const line of lines) {
		const prefix = line.trim().slice(0, 20);
		if (CODE_INDICATORS.some((p) => prefix.startsWith(p) || prefix.includes(p))) codeHits++;
	}
	return codeHits / lines.length > 0.4;
}

export function isLog(text: string): boolean {
	const stripped = text.trim();
	if (!stripped) return false;
	const lines = stripped.split("\n").filter((l) => l.trim()).slice(0, 10);
	if (lines.length < 3) return false;
	let logHits = 0;
	for (const line of lines) {
		if (LOG_INDICATORS.some((p) => line.includes(p))) logHits++;
	}
	return logHits / lines.length > 0.5;
}

// ─── format detection ────────────────────────────────────────────────────

export type CompactionFormat = "json_array" | "json_object" | "ndjson" | "csv" | "tsv";

export function detectFormat(text: string, threshold: number = COMPACTION_THRESHOLD): CompactionFormat | null {
	const trimmed = text.trim();
	if (!trimmed || trimmed.length < threshold) return null;

	if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
		try {
			const parsed = JSON.parse(trimmed);
			if (Array.isArray(parsed)) return "json_array";
			return "json_object";
		} catch {
			const lines = trimmed.split("\n").filter((l) => l.trim());
			if (lines.length >= 5) {
				let ndjsonCount = 0;
				for (const line of lines) {
					try {
						const obj = JSON.parse(line.trim());
						if (typeof obj === "object" && obj !== null) ndjsonCount++;
						else break;
					} catch {
						break;
					}
				}
				if (ndjsonCount / lines.length > 0.8) return "ndjson";
			}
		}
	}

	// CSV detection using simple comma counting
	if (trimmed.includes("\n") && trimmed.includes(",")) {
		const lines = trimmed.split("\n").filter((l) => l.trim());
		if (lines.length >= 5) {
			// Reject NDJSON
			if (lines[0].trim().startsWith("{") || lines[0].trim().startsWith("[")) {
				try {
					JSON.parse(lines[0].trim());
					return null;
				} catch {}
			}
			const firstCols = (lines[0].match(/,/g) || []).length + 1;
			if (firstCols >= 2) {
				let consistent = 0;
				for (const line of lines) {
					if ((line.match(/,/g) || []).length + 1 === firstCols) consistent++;
				}
				if (consistent / lines.length > 0.8) return "csv";
			}
		}
	}

	// TSV detection
	if (trimmed.includes("\n") && trimmed.includes("\t")) {
		const lines = trimmed.split("\n").filter((l) => l.trim());
		if (lines.length >= 5) {
			const firstCols = (lines[0].match(/\t/g) || []).length + 1;
			if (firstCols >= 2) {
				let consistent = 0;
				for (const line of lines) {
					if ((line.match(/\t/g) || []).length + 1 === firstCols) consistent++;
				}
				if (consistent / lines.length > 0.8) return "tsv";
			}
		}
	}

	return null;
}

// ─── compaction with nushell-as-DB ───────────────────────────────────────

/**
 * Save full data to a temp file and return a path that agents/clients can
 * query with nushell. This is the "nushell as DB" pattern: data is
 * persisted to disk, the client queries specific parts using nushell,
 * keeping context small.
 */
export function saveFullData(text: string, format: string): string | null {
	const hash = crypto.createHash("sha256").update(text).digest("hex").slice(0, 12);
	const ext = format === "csv" ? ".csv" : format === "tsv" ? ".tsv" : format === "ndjson" ? ".ndjson" : ".json";
	const filePath = path.join(COMPACT_DATA_DIR, `${hash}${ext}`);
	try {
		fs.writeFileSync(filePath, text);
		debug(`saveFullData: saved ${text.length} bytes to ${filePath}`);
		return filePath;
	} catch (e: any) {
		debug(`saveFullData: failed to save: ${e?.message}`);
		return null;
	}
}

function compactJsonArray(text: string, previewRows: number): { preview: string; totalRows: number } | null {
	const countResult = runNuWithInput("from json | length", text);
	if (!countResult.success) return null;
	const totalRows = parseInt(countResult.output, 10);
	if (isNaN(totalRows) || totalRows <= previewRows) return null;
	const previewResult = runNuWithInput(`from json | first ${previewRows} | to nuon --raw`, text);
	if (!previewResult.success) return null;
	return { preview: previewResult.output, totalRows };
}

function compactNdjson(text: string, previewRows: number): { preview: string; totalRows: number } | null {
	const lines = text.trim().split("\n").filter((l) => l.trim());
	const totalRows = lines.length;
	if (totalRows <= previewRows) return null;
	const previewItems: any[] = [];
	for (let i = 0; i < Math.min(previewRows, lines.length); i++) {
		try {
			previewItems.push(JSON.parse(lines[i].trim()));
		} catch {
			return null;
		}
	}
	const previewJson = JSON.stringify(previewItems);
	const previewResult = runNuWithInput("from json | to nuon --raw", previewJson);
	if (!previewResult.success) return null;
	return { preview: previewResult.output, totalRows };
}

function compactCsv(text: string, delimiter: "csv" | "tsv", previewRows: number): { preview: string; totalRows: number } | null {
	const fromCmd = delimiter === "tsv" ? "from tsv" : "from csv";
	const countResult = runNuWithInput(`${fromCmd} | length`, text);
	if (!countResult.success) return null;
	const totalRows = parseInt(countResult.output, 10);
	if (isNaN(totalRows) || totalRows <= previewRows) return null;
	const previewResult = runNuWithInput(`${fromCmd} | first ${previewRows} | to nuon --raw`, text);
	if (!previewResult.success) return null;
	return { preview: previewResult.output, totalRows };
}

function compactJsonObject(text: string, previewRows: number): { preview: string; totalRows: number } | null {
	let parsed: any;
	try {
		parsed = JSON.parse(text);
	} catch {
		return null;
	}
	if (typeof parsed !== "object" || parsed === null) return null;

	const keys = Object.keys(parsed);
	let largestArrayKey: string | null = null;
	let largestArrayLen = 0;
	for (const key of keys) {
		if (Array.isArray(parsed[key]) && parsed[key].length > largestArrayLen) {
			largestArrayKey = key;
			largestArrayLen = parsed[key].length;
		}
	}

	if (largestArrayKey && largestArrayLen > previewRows) {
		const arrayData = parsed[largestArrayKey];
		const previewItems = arrayData.slice(0, previewRows);
		const previewJson = JSON.stringify(previewItems);
		const previewResult = runNuWithInput("from json | to nuon --raw", previewJson);
		if (!previewResult.success) return null;
		const otherKeys = keys.filter((k) => k !== largestArrayKey);
		const keyInfo = otherKeys.length > 0 ? `other keys: {${otherKeys.join(", ")}}` : "no other keys";
		const summary = `{${largestArrayKey}: [${largestArrayLen} items], ${keyInfo}}\n\nFirst ${previewRows} items of "${largestArrayKey}":\n${previewResult.output}`;
		if (summary.length >= text.length) return null;
		return { preview: summary, totalRows: largestArrayLen };
	}

	const result = runNuWithInput("from json | to nuon --raw", text);
	if (!result.success) return null;
	if (result.output.length >= text.length) return null;
	return { preview: result.output, totalRows: keys.length };
}

function buildCompactedOutput(
	format: string,
	preview: string,
	totalRows: number,
	originalBytes: number,
	fullDataPath: string | null,
	previewRows: number,
): string {
	const savings = Math.round((1 - (preview.length + 300) / originalBytes) * 100);
	const lines = [
		`[compacted: ${format}, ${totalRows} rows total → showing first ${previewRows}.`,
		` ${originalBytes} → ${preview.length + 300} bytes (${savings}% smaller)]`,
	];
	if (fullDataPath) {
		lines.push("");
		lines.push(`Full data saved to: ${fullDataPath}`);
		lines.push(`Query with nushell: nu -c 'open ${fullDataPath} | first 5'`);
		lines.push(`Or filter: nu -c 'open ${fullDataPath} | where status == "active" | length'`);
	}
	lines.push("");
	lines.push(preview);
	return lines.join("\n");
}

export interface CompactResult {
	compacted: boolean;
	/** null when not compactable */
	reason: string | null;
	format: CompactionFormat | null;
	totalRows: number | null;
	originalBytes: number;
	compactedBytes: number | null;
	savingsPct: number | null;
	/** path of the full (uncompacted) data, saved even when compaction was attempted */
	fullDataPath: string | null;
	/** compacted text (header + preview) when compacted=true */
	text: string | null;
}

export interface TryCompactOptions {
	/** override preview row count for this call */
	previewRows?: number;
	/** override compaction threshold for this call */
	threshold?: number;
}

/**
 * Attempt to compact structured data. Returns a result describing what
 * happened; `text` is the compacted output (header + preview) when
 * compactable, otherwise null. Never throws.
 */
export function tryCompact(text: string, opts: TryCompactOptions = {}): CompactResult {
	const base: CompactResult = {
		compacted: false,
		reason: null,
		format: null,
		totalRows: null,
		originalBytes: text?.length ?? 0,
		compactedBytes: null,
		savingsPct: null,
		fullDataPath: null,
		text: null,
	};

	if (DISABLED) return { ...base, reason: "disabled" };
	if (!NU_BIN) return { ...base, reason: "nushell not found on PATH (set PI_ACIDBATH_NU_BIN or COMPACTOR_NU_BIN)" };
	if (!text || !text.length) return { ...base, reason: "empty input" };
	if (text.length < (opts.threshold ?? COMPACTION_THRESHOLD)) return { ...base, reason: "below threshold" };
	if (isCode(text)) return { ...base, reason: "looks like code" };
	if (isLog(text)) return { ...base, reason: "looks like logs" };

	const format = detectFormat(text, opts.threshold ?? COMPACTION_THRESHOLD);
	if (!format) return { ...base, reason: "not structured data (json/ndjson/csv/tsv)" };
	base.format = format;

	const previewRows = opts.previewRows ?? PREVIEW_ROWS;

	debug(`detected ${format} (${text.length} bytes), compacting...`);

	// Save full data to temp file (nushell-as-DB)
	const fullDataPath = saveFullData(text, format);
	base.fullDataPath = fullDataPath;

	let result: { preview: string; totalRows: number } | null = null;

	switch (format) {
		case "json_array":
			result = compactJsonArray(text, previewRows);
			break;
		case "json_object":
			result = compactJsonObject(text, previewRows);
			break;
		case "ndjson":
			result = compactNdjson(text, previewRows);
			break;
		case "csv":
			result = compactCsv(text, "csv", previewRows);
			break;
		case "tsv":
			result = compactCsv(text, "tsv", previewRows);
			break;
	}

	if (!result) {
		return { ...base, reason: `no savings for format ${format}` };
	}

	const compactedText = buildCompactedOutput(
		format,
		result.preview,
		result.totalRows,
		text.length,
		fullDataPath,
		previewRows,
	);

	if (compactedText.length >= text.length) {
		return { ...base, reason: "compacted output not smaller than input" };
	}

	debug(`compacted ${text.length} → ${compactedText.length} bytes (${format})`);
	return {
		compacted: true,
		reason: null,
		format,
		totalRows: result.totalRows,
		originalBytes: text.length,
		compactedBytes: compactedText.length,
		savingsPct: Math.max(0, Math.round((1 - compactedText.length / text.length) * 100)),
		fullDataPath,
		text: compactedText,
	};
}

// ─── querying saved data (the other half of nushell-as-DB) ───────────────

export interface FileQueryResult {
	success: boolean;
	output: string;
	/** true when the nushell table was re-rendered as NUON for LLM readability */
	nuon: boolean;
}

/**
 * Run a nushell pipeline against a saved data file.
 *
 * The pipeline is applied to the result of `open <file>` (format inferred
 * from the extension), e.g. `where status == "active" | length`.
 * Table/record results are re-rendered as NUON for LLM readability when
 * the raw rendering comes back as a bordered nushell table.
 */
export function queryFile(file: string, pipeline: string): FileQueryResult {
	if (!fs.existsSync(file)) return { success: false, output: `file not found: ${file}`, nuon: false };
	const trimmed = pipeline.trim().replace(/^\|\s*/, "");
	const expr = trimmed ? `open $env.COMPACTOR_FILE | ${trimmed}` : "open $env.COMPACTOR_FILE";
	const result = runNuOnFile(file, expr);
	if (!result.success) return { success: false, output: result.output, nuon: false };
	// Re-render nushell table borders as NUON (much more token-efficient
	// and unambiguous for LLMs) when that's what we got back.
	if (result.output.includes("╭") || result.output.includes("│")) {
		const nuon = runNuOnFile(file, `${expr} | to nuon --raw`);
		if (nuon.success) return { success: true, output: nuon.output, nuon: true };
	}
	return { success: true, output: result.output, nuon: false };
}

export interface FileSchema {
	success: boolean;
	shape: string | null;
	columns: string[] | null;
	rows: number | null;
	error: string | null;
}

/**
 * Describe a saved data file: nushell shape, columns, and row count.
 */
export function fileSchema(file: string): FileSchema {
	if (!fs.existsSync(file)) return { success: false, shape: null, columns: null, rows: null, error: `file not found: ${file}` };
	const describe = runNuOnFile(file, "describe");
	if (!describe.success) return { success: false, shape: null, columns: null, rows: null, error: describe.output };
	const shape = describe.output;
	const columns = runNuOnFile(file, "columns | to json --raw");
	const rows = runNuOnFile(file, "length");
	let columnList: string[] | null = null;
	if (columns.success) {
		try {
			const parsed = JSON.parse(columns.output);
			if (Array.isArray(parsed)) columnList = parsed.map(String);
		} catch {
			columnList = null;
		}
	}
	return {
		success: true,
		shape,
		columns: columnList,
		rows: rows.success ? parseInt(rows.output, 10) : null,
		error: null,
	};
}
