/**
 * Acidbath harness — session-recap builder (PURE).
 *
 * Spec: docs/decisions/adr-0005.md ("Handoff creates a child session;
 *       recap stays in-session")
 * Beads: acidbath-9ih.5
 * Linear: MIGHT-494
 *
 * Design rules:
 *   - No Pi imports. This module is a pure function library that the
 *     Pi-coupled extension (extensions/harness/index.ts — NOT created
 *     by this module) imports to do its work.
 *   - No `as` assertions, no `any`. Strict TypeScript.
 *   - Functions never mutate the input array.
 *   - Recap is a session-persistent custom entry (type
 *     RECAP_ENTRY_TYPE) — it is NEVER injected into the LLM context by
 *     default, and NEVER written to ~/.pi/agent/notes/*. The renderer
 *     in the Pi-coupled extension decides when/whether to surface it.
 *   - The LLM-source for a recap is messages + compaction summaries
 *     only. Other custom entries (previous recaps, todo lists, etc.)
 *     are dropped from the LLM source so the recap summarises the
 *     user-facing conversation, not its own prior output.
 *   - Parsing empty / malformed markdown yields empty fields, never
 *     throws. Arrays are capped at 12 items, strings at 4000 chars.
 *   - Pure: no I/O, no globals, no time/random/dates.
 */

// ─── constants ──────────────────────────────────────────────────────────

/**
 * Custom entry type tag for a persisted recap. The renderer in the
 * Pi-coupled extension keys off this string. Treat it as the
 * wire-format version of the recap payload — change with care.
 */
export const RECAP_ENTRY_TYPE = "acidbath-recap";

/** Maximum items in any list-typed field of a parsed RecapNote. */
export const RECAP_MAX_ITEMS = 12;

/** Maximum characters of any string field of a parsed RecapNote. */
export const RECAP_MAX_STRING = 4000;

// ─── types ──────────────────────────────────────────────────────────────

export type RecapNote = {
	version: 1;
	generatedAt: string;
	sessionId: string;
	focus?: string;
	goal: string;
	decisions: string[];
	progress: string[];
	blockers: string[];
	nextSteps: string[];
	files: string[];
};

export type RecapSourceEntry =
	| { type: "message"; role: "user" | "assistant"; text: string }
	| { type: "compaction"; summary: string }
	| { type: "custom"; customType: string; data?: unknown };

// ─── selection ──────────────────────────────────────────────────────────

/**
 * Project a session's source entries down to the subset that should
 * feed a recap prompt. Custom entries (other `customType`s) are
 * excluded entirely — a recap summarises the user-facing conversation,
 * not prior recaps, todo lists, or other session-persistent custom
 * payloads. If one or more compaction entries exist, only the LAST
 * compaction summary is kept (earlier summaries are presumed subsumed
 * by it), plus any messages that appear after that last compaction;
 * otherwise all messages are kept. Compaction entries with no messages
 * after them reduce to the summary alone.
 *
 * Pure: never mutates `entries`; returns a fresh array.
 */
export function selectRecapEntries(entries: readonly RecapSourceEntry[]): RecapSourceEntry[] {
	// First, locate the latest compaction entry. Everything before it is
	// already represented in its summary.
	let lastCompactionIdx = -1;
	for (let i = 0; i < entries.length; i++) {
		const e = entries[i];
		if (e.type === "compaction") lastCompactionIdx = i;
	}

	const out: RecapSourceEntry[] = [];
	if (lastCompactionIdx === -1) {
		// No compaction: keep all messages, drop all custom entries.
		for (const e of entries) {
			if (e.type === "custom") continue;
			if (e.type === "compaction") continue; // no compaction entries exist
			out.push(e);
		}
		return out;
	}

	// Walk once: emit the latest compaction, then drop everything before
	// it (already summarised) and drop custom entries thereafter.
	let emittedLatest = false;
	const startIdx = lastCompactionIdx;
	for (let i = startIdx; i < entries.length; i++) {
		const e = entries[i];
		if (e.type === "custom") continue;
		if (e.type === "compaction") {
			if (emittedLatest) continue; // collapse older compactions
			out.push(e);
			emittedLatest = true;
			continue;
		}
		out.push(e);
	}
	return out;
}

// ─── serialization ──────────────────────────────────────────────────────

/**
 * Serialize a list of source entries into a single text string capped
 * at `maxChars`. Each entry contributes a labelled block. Tail-first
 * truncation: when the full set of entries can't fit, earlier entries
 * are dropped and the most recent entries are kept — a recap is more
 * interested in current state than in the deep past, and the
 * compaction summary already represents older history. Within an
 * entry whose own body exceeds the remaining budget, the head is
 * truncated and a `[…truncated…]` marker appended so the reader
 * knows content was dropped.
 *
 * Pure: never mutates `entries`.
 */
export function serializeRecapSource(entries: readonly RecapSourceEntry[], maxChars: number): string {
	if (maxChars <= 0) return "";
	if (entries.length === 0) return "";

	const blocks: string[] = entries.map(renderSourceBlock);

	// Fast path: everything fits.
	const totalLen = blocks.reduce((sum, b, i) => sum + b.length + (i > 0 ? 1 : 0), 0);
	if (totalLen <= maxChars) return blocks.join("\n");

	// Tail-preserving fit: walk from the end, accumulating blocks
	// until adding another would exceed the budget. The result is the
	// contiguous tail of `blocks` (in original order) that fits.
	let keptLen = 0;
	let firstKept = blocks.length; // exclusive
	for (let i = blocks.length - 1; i >= 0; i--) {
		const block = blocks[i];
		const cost = block.length + (keptLen > 0 ? 1 : 0); // joining "\n"
		if (keptLen + cost > maxChars) break;
		keptLen += cost;
		firstKept = i;
	}

	if (firstKept >= blocks.length) {
		// Nothing fit at native size. Hard-truncate the LAST block so
		// the reader still gets the most recent context.
		return truncateBlockBody(entries[entries.length - 1], maxChars);
	}

	// Sanity: firstKept may be > 0 even when blocks[firstKept] alone
	// won't fit (because keptLen starts at 0 + cost > maxChars).
	// The check above guarantees at least the last block fits, so
	// firstKept <= blocks.length - 1 and we always emit something.
	const tail = blocks.slice(firstKept);
	return tail.join("\n");
}

function renderSourceBlock(entry: RecapSourceEntry): string {
	switch (entry.type) {
		case "message":
			return `[${entry.role}]\n${entry.text}`;
		case "compaction":
			return `[compaction]\n${entry.summary}`;
		case "custom":
			// Should not appear in selectRecapEntries output, but
			// serializeRecapSource is part of the public surface, so
			// handle the case defensively.
			return `[custom:${entry.customType}]\n${formatUnknown(entry.data)}`;
	}
}

function formatUnknown(value: unknown): string {
	if (value === undefined) return "";
	if (value === null) return "null";
	if (typeof value === "string") return value;
	try {
		return JSON.stringify(value);
	} catch {
		return String(value);
	}
}

function truncateBlockBody(entry: RecapSourceEntry, maxChars: number): string {
	const marker = "\n[…truncated…]";
	const header = renderSourceBlock(entry).split("\n", 1)[0] ?? "";
	const prefix = `${header}\n`;
	const budget = Math.max(0, maxChars - prefix.length - marker.length);
	let body: string;
	if (entry.type === "message") body = entry.text;
	else if (entry.type === "compaction") body = entry.summary;
	else if (entry.type === "custom") body = formatUnknown(entry.data);
	else body = "";
	if (body.length <= budget) return `${prefix}${body}`;
	return `${prefix}${body.slice(0, budget)}${marker}`;
}

// ─── prompt builder ─────────────────────────────────────────────────────

/**
 * Build the LLM prompt that asks a model to summarise a conversation
 * into a structured RecapNote. The prompt carries the optional focus
 * and the pre-serialized conversation text. No privacy/PII scrubbing,
 * no per-user styling — recap is the model's job, this module just
 * shapes the request.
 *
 * Pure.
 */
export function buildRecapPrompt(focus: string | undefined, conversationText: string): string {
	const focusLine = focus && focus.length > 0
		? `\nFocus for this recap: ${focus}\n`
		: "\nNo specific focus was supplied. Summarise whatever you think will help the next session resume cleanly.\n";
	return [
		"Produce a session recap as Markdown with these sections, in this order:",
		"",
		"## Goal",
		"(one or two sentences — what the user is trying to achieve in this session)",
		"",
		"## Decisions",
		"(bullet list — meaningful design / implementation choices that were settled)",
		"",
		"## Progress",
		"(bullet list — concrete steps completed, files touched, runs executed)",
		"",
		"## Blockers",
		"(bullet list — open questions, errors, or things the next session should know to avoid)",
		"",
		"## Next Steps",
		"(bullet list — what should happen first when the conversation resumes)",
		"",
		"## Files",
		"(bullet list — distinct file paths touched or proposed; omit if none)",
		"",
		`Keep the recap terse. Each bullet is one short line. If a section is empty, write "None." in its body.`,
		focusLine,
		"---",
		"Conversation so far:",
		conversationText,
	].join("\n");
}

// ─── markdown parser ────────────────────────────────────────────────────

const SECTION_HEADERS = [
	"Goal",
	"Decisions",
	"Progress",
	"Blockers",
	"Next Steps",
	"Files",
] as const;
type SectionHeader = typeof SECTION_HEADERS[number];

function parseSectionHeader(label: string): SectionHeader | undefined {
	for (const header of SECTION_HEADERS) {
		if (header === label) return header;
	}
	return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

/**
 * Cap a string to `max` characters. Negative `max` → "". Strings
 * already within budget return unchanged (no allocation).
 */
function capString(value: string, max: number): string {
	if (max < 0) return "";
	if (value.length <= max) return value;
	return value.slice(0, max);
}

/**
 * Cap a string array to `maxCount` items and each item to `maxItem`
 * characters. Filters out empty / whitespace-only items so the parsed
 * note never contains spurious bullets.
 */
function capStringArray(value: readonly string[], maxCount: number, maxItem: number): string[] {
	const out: string[] = [];
	for (const raw of value) {
		if (typeof raw !== "string") continue;
		const trimmed = raw.trim();
		if (!trimmed) continue;
		out.push(capString(trimmed, maxItem));
		if (out.length >= maxCount) break;
	}
	return out;
}

/**
 * Parse a recap-shaped Markdown document into a RecapNote. Tolerant:
 * unknown sections are ignored, missing sections yield empty
 * strings/arrays, malformed headers don't throw. Empty / whitespace-
 * only input yields a RecapNote with empty fields and the provided
 * metadata.
 */
export function parseRecapMarkdown(
	markdown: string,
	meta: { generatedAt: string; sessionId: string; focus?: string },
): RecapNote {
	const sections = extractSections(markdown);

	const goalRaw = sections["Goal"] ?? "";
	const note: RecapNote = {
		version: 1,
		generatedAt: meta.generatedAt,
		sessionId: meta.sessionId,
		goal: capString(goalRaw.replace(/\s+/g, " ").trim(), RECAP_MAX_STRING),
		decisions: capStringArray(parseListSection(sections["Decisions"] ?? ""), RECAP_MAX_ITEMS, RECAP_MAX_STRING),
		progress: capStringArray(parseListSection(sections["Progress"] ?? ""), RECAP_MAX_ITEMS, RECAP_MAX_STRING),
		blockers: capStringArray(parseListSection(sections["Blockers"] ?? ""), RECAP_MAX_ITEMS, RECAP_MAX_STRING),
		nextSteps: capStringArray(parseListSection(sections["Next Steps"] ?? ""), RECAP_MAX_ITEMS, RECAP_MAX_STRING),
		files: capStringArray(parseListSection(sections["Files"] ?? ""), RECAP_MAX_ITEMS, RECAP_MAX_STRING),
	};
	if (typeof meta.focus === "string" && meta.focus.length > 0) {
		note.focus = capString(meta.focus, RECAP_MAX_STRING);
	}
	return note;
}

/**
 * Split a Markdown document into sections keyed by the recognised
 * `## Header` lines. Anything before the first recognised header is
 * discarded (recap markdown has no preamble). Unknown headers are
 * skipped. Header matching is case-insensitive on the label, exact on
 * the leading `## ` prefix.
 */
function extractSections(markdown: string): Record<SectionHeader, string> {
	const out: Record<SectionHeader, string> = {
		"Goal": "",
		"Decisions": "",
		"Progress": "",
		"Blockers": "",
		"Next Steps": "",
		"Files": "",
	};

	if (typeof markdown !== "string" || markdown.length === 0) return out;

	const lines = markdown.split(/\r?\n/);
	let current: SectionHeader | undefined;
	for (const line of lines) {
		const m = /^##\s+(.+?)\s*$/.exec(line);
		if (m) {
			const label = m[1].trim();
			const header = parseSectionHeader(label);
			if (header) {
				current = header;
				continue;
			}
			// Unrecognised header: ignore everything that follows
			// until the next recognised header.
			current = undefined;
			continue;
		}
		if (current === undefined) continue;
		out[current] += (out[current] === "" ? "" : "\n") + line;
	}
	return out;
}

/**
 * Parse a section body into list items. Each top-level bullet (`-` or
 * `*`) becomes one item. Lines that are not bullets are joined with
 * the previous item as a continuation (handles wrapped bullets).
 * The literal token "None." yields an empty array.
 */
function parseListSection(body: string): string[] {
	if (typeof body !== "string") return [];
	const trimmed = body.trim();
	if (!trimmed) return [];
	if (/^none\.?$/i.test(trimmed)) return [];

	const items: string[] = [];
	const lines = trimmed.split(/\r?\n/);
	let current: string | undefined;
	let sawBullet = false;
	const flush = () => {
		if (current !== undefined) {
			const final = current.replace(/\s+/g, " ").trim();
			if (final) items.push(final);
			current = undefined;
		}
	};
	for (const line of lines) {
		const bullet = parseBulletLine(line);
		if (bullet !== null) {
			flush();
			current = bullet;
			sawBullet = true;
			continue;
		}
		if (!sawBullet) {
			// No bullet seen yet — treat non-blank content as a single
			// free-form item.
			if (line.trim()) {
				current = (current ?? "") + (current ? " " : "") + line.trim();
			}
			continue;
		}
		// Continuation of the current bullet: ignore blank lines (they
		// terminate the bullet in plain prose).
		if (!line.trim()) {
			flush();
			continue;
		}
		current = (current ?? "") + " " + line.trim();
	}
	flush();
	return items;
}

/**
 * Match a single bullet line. Returns the (possibly empty) body of the
 * bullet, or null if the line is not a bullet. A bullet is `-` or `*`
 * with optional leading whitespace and at least one optional
 * whitespace separator. This intentionally allows empty bullets so
 * "list of blank items" doesn't accidentally fall into the
 * continuation branch.
 */
function parseBulletLine(line: string): string | null {
	// Two patterns: bullet with non-empty body, bullet with empty body.
	const withBody = /^\s*[-*]\s+(.*)$/.exec(line);
	if (withBody) return withBody[1];
	const bare = /^\s*[-*]\s*$/.exec(line);
	if (bare) return "";
	return null;
}

// ─── type guard ─────────────────────────────────────────────────────────

/**
 * Narrow `value` to RecapNote if it has the right shape. Use this when
 * re-hydrating a recap from the session store, where the payload
 * crosses a serialization boundary (JSON round-trip) and unknown
 * shapes must be rejected without throwing.
 */
export function isRecapNote(value: unknown): value is RecapNote {
	if (!isRecord(value)) return false;
	if (value["version"] !== 1) return false;
	if (typeof value["generatedAt"] !== "string") return false;
	const sessionId = value["sessionId"];
	if (typeof sessionId !== "string" || sessionId.length === 0) return false;
	if (value["focus"] !== undefined && typeof value["focus"] !== "string") return false;
	if (typeof value["goal"] !== "string") return false;
	const listFields = ["decisions", "progress", "blockers", "nextSteps", "files"] as const;
	for (const f of listFields) {
		const arr = value[f];
		if (!Array.isArray(arr)) return false;
		for (const item of arr) {
			if (typeof item !== "string") return false;
		}
	}
	return true;
}

// ─── renderer ───────────────────────────────────────────────────────────

/**
 * Format a RecapNote as a human-readable multi-line string. The output
 * is for renderers / notifications only — it's NOT a stable wire
 * format and may grow new sections without warning. Wire format is the
 * `version: 1` RecapNote object itself.
 */
export function formatRecapNote(note: RecapNote): string {
	const lines: string[] = [];
	lines.push(`Recap (${note.sessionId}, ${note.generatedAt})`);
	if (typeof note.focus === "string" && note.focus.length > 0) {
		lines.push(`Focus: ${note.focus}`);
	}
	const sections: Array<[SectionHeader, string | string[]]> = [
		["Goal", note.goal],
		["Decisions", note.decisions],
		["Progress", note.progress],
		["Blockers", note.blockers],
		["Next Steps", note.nextSteps],
		["Files", note.files],
	];
	for (const [header, body] of sections) {
		lines.push("");
		lines.push(`## ${header}`);
		if (Array.isArray(body)) {
			if (body.length === 0) {
				lines.push("None.");
			} else {
				for (const item of body) lines.push(`- ${item}`);
			}
		} else {
			const txt = typeof body === "string" ? body.trim() : "";
			lines.push(txt === "" ? "None." : txt);
		}
	}
	return lines.join("\n");
}
