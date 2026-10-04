/**
 * Acidbath harness — Codex-compaction gate, prompt builder, and result mapper (PURE).
 *
 * Spec: docs/decisions/adr-0006.md
 * Beads: acidbath-9ih.6
 * Linear: MIGHT-495
 *
 * Design rules:
 *   - No Pi imports. This module is a pure function library that a
 *     Pi-coupled extension (extensions/harness/index.ts — NOT created
 *     by this module) imports to do its work.
 *   - No `as` assertions, no `any`. Strict TypeScript.
 *   - No `fetch`, no `Authorization` headers, no network calls. The
 *     production caller invokes `ctx.modelRegistry.complete()`; this
 *     module only decides *whether* to attempt and shapes the prompt
 *     + fallback mapping.
 *   - Determinism: same inputs → same outputs.
 *
 * The gate is "openai-codex family" + opt-in flag:
 *   - provider === "openai-codex"
 *   - api === "openai-codex-responses"
 *   - provider === "openai" AND /codex/i.test(id)
 *
 * Failures (disabled, non-codex, empty, abort, error) collapse to a
 * `CompactAttempt.handled: false` so the caller can fall back to Pi's
 * native compaction — never to a thrown exception. The caller decides
 * whether the fallback is invoked; this module only reports.
 */

// ─── types ───────────────────────────────────────────────────────────────

export type CompactModelInfo = {
	provider: string;
	id: string;
	api?: string;
};

export type CompactPrep = {
	firstKeptEntryId: string;
	tokensBefore: number;
	previousSummary?: string;
	conversationText: string;
};

export type CompactAttempt =
	| {
			handled: false;
			reason: "disabled" | "non-codex" | "no-model" | "empty" | "aborted" | "error";
			message: string;
	  }
	| {
			handled: true;
			summary: string;
			firstKeptEntryId: string;
			tokensBefore: number;
	  };

// ─── env gate ────────────────────────────────────────────────────────────

/**
 * True only when PI_ACIDBATH_CODEX_COMPACT is "1" or "true" (case
 * insensitive). Any other value (unset, "0", "false", "yes", "on",
 * empty, …) returns false.
 */
export function isCodexCompactEnabled(env: Record<string, string | undefined>): boolean {
	if (!env) return false;
	const raw = env.PI_ACIDBATH_CODEX_COMPACT;
	if (typeof raw !== "string") return false;
	const v = raw.trim().toLowerCase();
	return v === "1" || v === "true";
}

// ─── model gate ──────────────────────────────────────────────────────────

/**
 * True when the model belongs to the OpenAI Codex family. The three
 * hit shapes per ADR-0006:
 *   1. provider === "openai-codex"
 *   2. api === "openai-codex-responses"
 *   3. provider === "openai" AND /codex/i.test(id)
 *
 * Undefined input returns false.
 */
export function isCodexModel(model: CompactModelInfo | undefined): boolean {
	if (!model) return false;
	if (typeof model.provider !== "string" || typeof model.id !== "string") return false;
	if (model.provider === "openai-codex") return true;
	if (model.api === "openai-codex-responses") return true;
	if (model.provider === "openai" && /codex/i.test(model.id)) return true;
	return false;
}

/**
 * Combined gate: flag enabled AND model is a Codex-family model.
 */
export function shouldAttemptCodexCompact(
	model: CompactModelInfo | undefined,
	env: Record<string, string | undefined>,
): boolean {
	if (!isCodexCompactEnabled(env)) return false;
	if (!isCodexModel(model)) return false;
	return true;
}

// ─── prompt builder ──────────────────────────────────────────────────────

const SYSTEM_PROMPT_LINES = [
	"You are summarizing a long coding-agent session so it can be reloaded into a smaller context window.",
	"Preserve every concrete decision, file path, identifier, command, error message, and code snippet that the next turn will need.",
	"Be concise but information-dense. Do not editorialize. Do not invent. Do not omit failures or partial work.",
	"Return Markdown with the following sections, in this order:",
	"## Goal",
	"## Progress",
	"## Decisions",
	"## Next steps",
	"## Files",
	"- `## Goal` — the user's objective as stated or inferred.",
	"- `## Progress` — what has been done so far, in order, with concrete outcomes.",
	"- `## Decisions` — choices made, alternatives rejected, and the reason for each.",
	"- `## Next steps` — what remains to do, in order, including any open questions.",
	"- `## Files` — every file path read, created, modified, or deleted (one bullet per path with a one-line note).",
];

function buildSystemPrompt(): string {
	return SYSTEM_PROMPT_LINES.join("\n");
}

function buildUserText(prep: CompactPrep): string {
	const parts: string[] = [];
	if (typeof prep.previousSummary === "string" && prep.previousSummary.length > 0) {
		parts.push("## Previous summary (to be merged/updated)");
		parts.push(prep.previousSummary);
		parts.push("");
	}
	parts.push("## Conversation to summarize");
	parts.push(prep.conversationText);
	return parts.join("\n");
}

/**
 * Build the system + user prompts to send to a Codex-family model for
 * a session-summary compaction. The caller has already serialized the
 * conversation to a bounded text blob — this module does not touch
 * messages, headers, or transport.
 */
export function buildCodexCompactPrompt(prep: CompactPrep): { systemPrompt: string; userText: string } {
	return {
		systemPrompt: buildSystemPrompt(),
		userText: buildUserText(prep),
	};
}

// ─── result mapper ───────────────────────────────────────────────────────

/**
 * Collapse a raw summarization outcome into a `CompactAttempt`. The
 * ordering of checks matters and matches the ADR-0006 fallback
 * contract:
 *   1. aborted → handled=false reason="aborted"
 *   2. empty / whitespace-only summary → handled=false reason="empty"
 *   3. else → handled=true with summary, firstKeptEntryId, tokensBefore
 *
 * Any thrown / non-Ok shape is the caller's responsibility — this
 * mapper only sees the values.
 */
export function mapCompactResult(args: {
	summary: string | undefined;
	aborted: boolean;
	firstKeptEntryId: string;
	tokensBefore: number;
}): CompactAttempt {
	if (args.aborted) {
		return {
			handled: false,
			reason: "aborted",
			message: "codex compaction aborted by caller",
		};
	}
	const summary = args.summary;
	if (typeof summary !== "string" || summary.trim().length === 0) {
		return {
			handled: false,
			reason: "empty",
			message: "codex compaction returned an empty summary",
		};
	}
	return {
		handled: true,
		summary,
		firstKeptEntryId: args.firstKeptEntryId,
		tokensBefore: args.tokensBefore,
	};
}

// ─── error sanitization ──────────────────────────────────────────────────

// Patterns that could leak credentials or session identifiers. The
// sanitizer replaces the entire match with a fixed redaction token so
// partial fragments ("Bearer xyz" → "Bearer [REDACTED]") can't be
// reconstructed.
//
// Order matters — patterns that anchor on a value (sk-, Bearer token,
// chatgpt-account-id value, Authorization header value) must run before
// the generic JSON-shape patterns so the value is caught whole.

const PATTERNS: Array<{ re: RegExp; replacement: string }> = [
	// OpenAI project / user keys (sk-..., sk-proj-..., sk-svcacct-...)
	{ re: /sk-(?:proj-|svcacct-|live-|test-)?[A-Za-z0-9_\-]+/g, replacement: "[REDACTED]" },
	// Bearer <token> (optionally single- or double-quoted; the quotes are
	// consumed so the replacement is always "Bearer [REDACTED]").
	{ re: /Bearer\s+(?:"[^"]*"|'[^']*'|[A-Za-z0-9._\-+/=]+)/gi, replacement: "Bearer [REDACTED]" },
	// chatgpt-account-id: <value> (optionally single- or double-quoted).
	{ re: /chatgpt-account-id\s*[:=]\s*(?:"[^"]*"|'[^']*'|[A-Za-z0-9._\-+/=]+)/gi, replacement: "chatgpt-account-id: [REDACTED]" },
	// Authorization header value (any header name followed by the value,
	// optionally single- or double-quoted). The match swallows the
	// surrounding quotes so the replacement is always
	// "Authorization: [REDACTED]".
	{ re: /Authorization\s*[:=]\s*(?:"[^"]*"|'[^']*'|[A-Za-z0-9._\-+/=]+)/gi, replacement: "Authorization: [REDACTED]" },
];

/**
 * Strip secrets from a message string before it is logged or surfaced.
 * Replaces every match with a fixed `[REDACTED]` token. Returns the
 * input unchanged when it is not a string.
 */
export function sanitizeCompactError(message: string): string {
	if (typeof message !== "string") return "unknown error";
	let out = message;
	for (const { re, replacement } of PATTERNS) {
		out = out.replace(re, replacement);
	}
	// A rejection with an empty or whitespace-only message is common (some
	// SDK errors carry no message at all). Without this the caller renders a
	// bare "(no error message)" and the real cause is unrecoverable, so fall
	// back to a stable placeholder instead of returning "".
	const trimmed = out.trim();
	if (trimmed.length === 0) return "unknown error (no detail reported)";
	return trimmed;
}
