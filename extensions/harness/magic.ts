/**
 * harness magic-word matcher — pure module, no Pi API.
 *
 * Per ADR-0004: match enabled keywords as exact lowercase standalone
 * prose tokens. Ignore fenced code, inline code, HTML/XML tags, paths,
 * file extensions, and identifiers. Never mutate the prompt.
 *
 * Shared by:
 *   - Pi `input` transform (injects hidden notices)
 *   - any future harness-side UI / MCP tool that wants to preview matches
 *
 * Pure: no I/O, no globals, no time/random, no Pi imports. The only
 * external effect is the return value. Determinism is preserved across
 * calls so the same prompt → same matches every time.
 */

export type MagicKeyword = {
	id: string;
	word: string;
	hint: string;
	enabled: boolean;
	raiseThinking?: boolean;
};

export type MagicRegistry = {
	enabled: boolean;
	keywords: MagicKeyword[];
};

export type MagicMatch = {
	id: string;
	word: string;
	hint: string;
	raiseThinking: boolean;
};

export function defaultMagicRegistry(): MagicRegistry {
	return {
		enabled: false,
		keywords: [],
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

export function parseMagicRegistry(input: unknown): MagicRegistry {
	if (!isRecord(input)) {
		throw new Error("magic registry: expected object");
	}
	const obj = input;
	if (typeof obj.enabled !== "boolean") {
		throw new Error("magic registry: 'enabled' must be a boolean");
	}
	if (!Array.isArray(obj.keywords)) {
		throw new Error("magic registry: 'keywords' must be an array");
	}
	const keywords: MagicKeyword[] = [];
	for (const raw of obj.keywords) {
		if (!isRecord(raw)) {
			throw new Error("magic registry: each keyword must be an object");
		}
		const k = raw;
		if (typeof k.id !== "string" || !k.id) {
			throw new Error("magic registry: keyword.id must be a non-empty string");
		}
		if (typeof k.word !== "string" || !k.word) {
			throw new Error(`magic registry: keyword[${k.id}].word must be a non-empty string`);
		}
		if (typeof k.hint !== "string") {
			throw new Error(`magic registry: keyword[${k.id}].hint must be a string`);
		}
		if (typeof k.enabled !== "boolean") {
			throw new Error(`magic registry: keyword[${k.id}].enabled must be a boolean`);
		}
		const raise = k.raiseThinking;
		if (raise !== undefined && typeof raise !== "boolean") {
			throw new Error(`magic registry: keyword[${k.id}].raiseThinking must be a boolean when present`);
		}
		const out: MagicKeyword = {
			id: k.id,
			word: k.word,
			hint: k.hint,
			enabled: k.enabled,
		};
		if (typeof raise === "boolean") out.raiseThinking = raise;
		keywords.push(out);
	}
	return {
		enabled: obj.enabled,
		keywords,
	};
}

// ─── ignore masks ────────────────────────────────────────────────────────

// Fenced code: ``` ... ```
const FENCED_RE = /```[\s\S]*?```/g;
// Inline code: ` ... `
const INLINE_CODE_RE = /`[^`\n]*`/g;
// Path-like runs: starts with ./ ~/ file:// OR contains a `/` between
// non-space segments. Trailing capture stops at whitespace / punctuation
// / angle brackets / quotes.
const PATH_LIKE_RE = /(?:(?:\.{0,2}\/|~\/|file:\/\/)[^\s<>`'"]+|[A-Za-z0-9_.-]+\/[A-Za-z0-9_./-]+)/g;
// "name.<known-ext>" — mask the whole span so the leading "name" isn't
// picked up as a token.
const FILE_EXT_RE = /[A-Za-z0-9_]+(?:\.(?:ts|tsx|js|jsx|mjs|cjs|json|md|mdx|txt|yaml|yml|toml|ini|cfg|py|rb|rs|go|java|kt|swift|c|cc|cpp|h|hpp|css|scss|html|xml|svg|sh|bash|zsh|fish|ps1|sql|graphql|proto|lock))\b/gi;
// HTML/XML element open/close tags. Used to find tag positions so we
// can mask the whole span (tags + content) per the spec.
const HTML_OPEN_RE = /<([a-zA-Z][a-zA-Z0-9-]*)([^>]*)>/g;
const VOID_TAGS = new Set([
	"area", "base", "br", "col", "embed", "hr", "img", "input",
	"link", "meta", "param", "source", "track", "wbr",
]);

function maskWithLength(src: string, ch: string = " "): string {
	return ch.repeat(src.length);
}

/**
 * Mask the *content* of any HTML element on the scannable copy. Walks
 * the original prompt to find paired tag spans (open + close) and
 * replaces the whole span (tags + content) on the scannable with
 * spaces. Self-closing tags and void tags mask just themselves.
 */
function maskHtmlContents(prompt: string, scannable: string): string {
	const edits: Array<{ start: number; end: number }> = [];
	const opens: Array<{ tag: string; start: number; end: number; selfClose: boolean }> = [];
	let m: RegExpExecArray | null;
	while ((m = HTML_OPEN_RE.exec(prompt)) !== null) {
		const tag = m[1].toLowerCase();
		const attrs = m[2];
		const selfClose = /\/\s*$/.test(attrs);
		opens.push({ tag, start: m.index, end: m.index + m[0].length, selfClose });
	}
	for (const o of opens) {
		if (o.selfClose || VOID_TAGS.has(o.tag)) {
			edits.push({ start: o.start, end: o.end });
			continue;
		}
		const closeRe = new RegExp(`<\\/${o.tag}\\s*>`, "gi");
		closeRe.lastIndex = o.end;
		const cm = closeRe.exec(prompt);
		if (cm) {
			edits.push({ start: o.start, end: cm.index + cm[0].length });
		} else {
			edits.push({ start: o.start, end: prompt.length });
		}
	}
	if (edits.length === 0) return scannable;
	const chars = scannable.split("");
	for (let i = edits.length - 1; i >= 0; i--) {
		const e = edits[i];
		for (let j = e.start; j < e.end && j < chars.length; j++) {
			if (chars[j] !== "\n") chars[j] = " ";
		}
	}
	return chars.join("");
}

/**
 * Build a "scannable" copy of the prompt with everything that should
 * not be matched replaced by spaces (preserving offsets so token
 * boundaries stay correct). Order: fences → inline code → paths → file
 * extensions → HTML tag spans (covers content as well as delimiters).
 */
function buildScannable(prompt: string): string {
	let out = prompt;
	out = out.replace(FENCED_RE, (block) => maskWithLength(block));
	out = out.replace(INLINE_CODE_RE, (block) => maskWithLength(block));
	out = out.replace(PATH_LIKE_RE, (block) => maskWithLength(block));
	out = out.replace(FILE_EXT_RE, (block) => maskWithLength(block));
	out = maskHtmlContents(prompt, out);
	return out;
}

// ─── tokenization ─────────────────────────────────────────────────────────

/**
 * Walk the scannable text and emit candidate tokens. A token is a
 * contiguous run of [a-z0-9_-] characters. The runner is restricted to
 * lowercase + digits + underscore + hyphen — uppercase letters in the
 * original prompt won't match the regex at all, so case mismatch is
 * rejected naturally by the word lookup.
 */
function scanTokens(scannable: string): Array<{ start: number; end: number; token: string }> {
	const out: Array<{ start: number; end: number; token: string }> = [];
	const re = /[a-z0-9]+(?:[_-][a-z0-9]+)*/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(scannable)) !== null) {
		out.push({ start: m.index, end: m.index + m[0].length, token: m[0] });
	}
	return out;
}

function isWordBoundary(ch: string | undefined): boolean {
	if (ch === undefined) return true;
	return !/[a-zA-Z0-9]/.test(ch);
}

// ─── public matcher ──────────────────────────────────────────────────────

/**
 * Return the subset of registry keywords whose `word` appears as an
 * exact lowercase standalone prose token in `prompt`. Order is the
 * first-appearance order in the prompt; duplicates (by keyword id) are
 * removed.
 *
 * Pure: never mutates `prompt`.
 */
export function matchMagicWords(prompt: string, registry: MagicRegistry): MagicMatch[] {
	if (!registry.enabled) return [];
	const enabledKw = registry.keywords.filter((k) => k.enabled);
	if (enabledKw.length === 0) return [];

	const scannable = buildScannable(prompt);
	const tokens = scanTokens(scannable);

	// Build lookup from word → keyword. Words are lowercased once.
	const byWord = new Map<string, MagicKeyword[]>();
	for (const k of enabledKw) {
		const w = k.word.toLowerCase();
		const bucket = byWord.get(w);
		if (bucket) bucket.push(k);
		else byWord.set(w, [k]);
	}

	const seen = new Set<string>();
	const matches: MagicMatch[] = [];

	for (const t of tokens) {
		const candidates = byWord.get(t.token);
		if (!candidates) continue;
		// Confirm word boundaries on the original prompt so masked
		// characters (already turned into spaces) still count as
		// boundaries.
		const before = prompt.charAt(t.start - 1);
		const after = prompt.charAt(t.end);
		if (!isWordBoundary(before) || !isWordBoundary(after)) continue;

		for (const k of candidates) {
			if (seen.has(k.id)) continue;
			seen.add(k.id);
			matches.push({
				id: k.id,
				word: k.word,
				hint: k.hint,
				raiseThinking: k.raiseThinking === true,
			});
		}
	}

	return matches;
}

/**
 * Render a list of matches as hint lines. Returns "" when `matches` is
 * empty; otherwise one line per match, formatted as
 *   `[magic:<id>] <hint>`
 */
export function formatMagicHints(matches: MagicMatch[]): string {
	if (matches.length === 0) return "";
	const lines: string[] = [];
	for (const m of matches) {
		lines.push(`[magic:${m.id}] ${m.hint}`);
	}
	return lines.join("\n");
}

const MAGIC_WORD_RE = /^[a-z][a-z0-9]*([_-][a-z0-9]+)*$/;

function copyKeyword(keyword: MagicKeyword): MagicKeyword {
	const copy: MagicKeyword = {
		id: keyword.id,
		word: keyword.word,
		hint: keyword.hint,
		enabled: keyword.enabled,
	};
	if (keyword.raiseThinking !== undefined) copy.raiseThinking = keyword.raiseThinking;
	return copy;
}

/** Normalize a user-entered magic word. Throws RangeError when it cannot match as prose. */
export function normalizeMagicWord(input: string): string {
	const word = input.trim().toLowerCase();
	if (!MAGIC_WORD_RE.test(word)) {
		throw new RangeError("magic word must be lowercase prose: letters, digits, and single _ or - separators");
	}
	return word;
}

/** Add an enabled keyword and turn matching on. Does not mutate the input registry. */
export function addMagicKeyword(
	registry: MagicRegistry,
	input: { word: string; hint?: string; raiseThinking?: boolean },
): MagicRegistry {
	const word = normalizeMagicWord(input.word);
	if (registry.keywords.some((keyword) => keyword.id === word || keyword.word.toLowerCase() === word)) {
		throw new RangeError(`magic keyword "${word}" already exists`);
	}
	const hint = input.hint?.trim() || `Notice for ${word}.`;
	const keyword: MagicKeyword = {
		id: word,
		word,
		hint,
		enabled: true,
		...(input.raiseThinking ? { raiseThinking: true } : {}),
	};
	return {
		enabled: true,
		keywords: [...registry.keywords.map(copyKeyword), keyword],
	};
}

/** Remove a keyword by id. Does not mutate the input registry. */
export function removeMagicKeyword(registry: MagicRegistry, id: string): MagicRegistry {
	if (!registry.keywords.some((keyword) => keyword.id === id)) {
		throw new RangeError(`magic keyword "${id}" does not exist`);
	}
	return {
		enabled: registry.enabled,
		keywords: registry.keywords.filter((keyword) => keyword.id !== id).map(copyKeyword),
	};
}

/**
 * Enable or disable one existing keyword. Enabling a keyword also turns
 * registry matching on; otherwise the keyword would still never match.
 */
export function setMagicKeywordEnabled(registry: MagicRegistry, id: string, enabled: boolean): MagicRegistry {
	if (!registry.keywords.some((keyword) => keyword.id === id)) {
		throw new RangeError(`magic keyword "${id}" does not exist`);
	}
	return {
		enabled: enabled ? true : registry.enabled,
		keywords: registry.keywords.map((keyword) => keyword.id === id ? { ...copyKeyword(keyword), enabled } : copyKeyword(keyword)),
	};
}
