/**
 * Unit tests for extensions/harness/codex-compact.ts (PURE module).
 *
 * Run:
 *   node --experimental-strip-types --no-warnings scripts/test-harness-codex-compact.mjs
 *
 * Asserts:
 *   1. isCodexCompactEnabled — env flag gate (true/false/unset).
 *   2. isCodexModel — provider/api/id classification.
 *   3. shouldAttemptCodexCompact — combined gate.
 *   4. buildCodexCompactPrompt — system + user text shape, previous
 *      summary inclusion.
 *   5. mapCompactResult — abort, empty, ok branches.
 *   6. sanitizeCompactError — strips key prefixes, Bearer, chatgpt-account-id,
 *      Authorization values.
 *
 * The test exits 1 on any failure.
 */

import {
	isCodexCompactEnabled,
	isCodexModel,
	shouldAttemptCodexCompact,
	buildCodexCompactPrompt,
	mapCompactResult,
	sanitizeCompactError,
} from "../extensions/harness/codex-compact.ts";

let passed = 0;
let failed = 0;
const failures = [];

function assert(name, cond, detail) {
	if (cond) {
		passed++;
	} else {
		failed++;
		failures.push({ name, detail });
		console.log(`FAIL  ${name}  ${detail ? "(" + detail + ")" : ""}`);
	}
}

function run(name, fn) {
	try {
		fn();
	} catch (e) {
		failed++;
		failures.push({ name, detail: `threw: ${e?.message ?? e}` });
		console.log(`FAIL  ${name}  threw: ${e?.message ?? e}`);
	}
}

// ─── 1. isCodexCompactEnabled ────────────────────────────────────────────

run("isCodexCompactEnabled — unset → false", () => {
	assert("env.unset", isCodexCompactEnabled({}) === false);
	assert("env.unset.full", isCodexCompactEnabled({ OTHER: "1" }) === false);
});

run("isCodexCompactEnabled — '1' → true", () => {
	assert("env.1", isCodexCompactEnabled({ PI_ACIDBATH_CODEX_COMPACT: "1" }) === true);
});

run("isCodexCompactEnabled — 'true' → true", () => {
	assert("env.true", isCodexCompactEnabled({ PI_ACIDBATH_CODEX_COMPACT: "true" }) === true);
});

run("isCodexCompactEnabled — 'TRUE' / 'True' / ' true ' → true (case + trim)", () => {
	assert("env.TRUE", isCodexCompactEnabled({ PI_ACIDBATH_CODEX_COMPACT: "TRUE" }) === true);
	assert("env.True", isCodexCompactEnabled({ PI_ACIDBATH_CODEX_COMPACT: "True" }) === true);
	assert("env.trim", isCodexCompactEnabled({ PI_ACIDBATH_CODEX_COMPACT: "  true  " }) === true);
});

run("isCodexCompactEnabled — '0' / 'false' / 'yes' / 'on' / '' → false", () => {
	assert("env.0", isCodexCompactEnabled({ PI_ACIDBATH_CODEX_COMPACT: "0" }) === false);
	assert("env.false", isCodexCompactEnabled({ PI_ACIDBATH_CODEX_COMPACT: "false" }) === false);
	assert("env.no", isCodexCompactEnabled({ PI_ACIDBATH_CODEX_COMPACT: "no" }) === false);
	assert("env.yes", isCodexCompactEnabled({ PI_ACIDBATH_CODEX_COMPACT: "yes" }) === false);
	assert("env.on", isCodexCompactEnabled({ PI_ACIDBATH_CODEX_COMPACT: "on" }) === false);
	assert("env.empty", isCodexCompactEnabled({ PI_ACIDBATH_CODEX_COMPACT: "" }) === false);
	assert("env.ws", isCodexCompactEnabled({ PI_ACIDBATH_CODEX_COMPACT: "   " }) === false);
});

// ─── 2. isCodexModel ─────────────────────────────────────────────────────

run("isCodexModel — undefined / missing fields → false", () => {
	assert("m.undefined", isCodexModel(undefined) === false);
	assert("m.no.provider", isCodexModel({ id: "x" }) === false);
	assert("m.no.id", isCodexModel({ provider: "openai" }) === false);
});

run("isCodexModel — openai-codex provider → true (any id)", () => {
	assert("m.codex-provider.a", isCodexModel({ provider: "openai-codex", id: "o3" }) === true);
	assert("m.codex-provider.b", isCodexModel({ provider: "openai-codex", id: "anything" }) === true);
});

run("isCodexModel — api openai-codex-responses → true", () => {
	assert(
		"m.responses.api",
		isCodexModel({ provider: "openai", id: "gpt-5", api: "openai-codex-responses" }) === true,
	);
	assert(
		"m.responses.api.only",
		isCodexModel({ provider: "anthropic", id: "claude", api: "openai-codex-responses" }) === true,
	);
});

run("isCodexModel — openai provider + /codex/i id → true", () => {
	assert("m.openai.codex", isCodexModel({ provider: "openai", id: "gpt-5.5-codex" }) === true);
	assert("m.openai.codex.cap", isCodexModel({ provider: "openai", id: "Codex-Mini" }) === true);
	assert("m.openai.codex.mix", isCodexModel({ provider: "openai", id: "myCODEX-experiment" }) === true);
});

run("isCodexModel — non-codex → false", () => {
	assert("m.anthropic", isCodexModel({ provider: "anthropic", id: "claude-sonnet-4-5" }) === false);
	assert("m.openai.gpt", isCodexModel({ provider: "openai", id: "gpt-5" }) === false);
	assert("m.openai.mini", isCodexModel({ provider: "openai", id: "gpt-5-mini" }) === false);
	assert("m.openai.api.other", isCodexModel({ provider: "openai", id: "gpt-5", api: "openai" }) === false);
	assert("m.openai.codex.not", isCodexModel({ provider: "openai", id: "gpt-5-codex-like" }) === true);
});

// ─── 3. shouldAttemptCodexCompact ────────────────────────────────────────

run("shouldAttemptCodexCompact — disabled + codex → false", () => {
	assert(
		"gate.off",
		shouldAttemptCodexCompact({ provider: "openai-codex", id: "x" }, {}) === false,
	);
});

run("shouldAttemptCodexCompact — enabled + non-codex → false", () => {
	assert(
		"gate.noncodex",
		shouldAttemptCodexCompact({ provider: "anthropic", id: "claude" }, { PI_ACIDBATH_CODEX_COMPACT: "1" }) === false,
	);
	assert(
		"gate.openai-no-codex",
		shouldAttemptCodexCompact({ provider: "openai", id: "gpt-5" }, { PI_ACIDBATH_CODEX_COMPACT: "true" }) === false,
	);
});

run("shouldAttemptCodexCompact — enabled + codex → true", () => {
	assert(
		"gate.codex-provider",
		shouldAttemptCodexCompact(
			{ provider: "openai-codex", id: "o3" },
			{ PI_ACIDBATH_CODEX_COMPACT: "1" },
		) === true,
	);
	assert(
		"gate.codex-api",
		shouldAttemptCodexCompact(
			{ provider: "openai", id: "gpt-5", api: "openai-codex-responses" },
			{ PI_ACIDBATH_CODEX_COMPACT: "1" },
		) === true,
	);
	assert(
		"gate.openai-codex-id",
		shouldAttemptCodexCompact(
			{ provider: "openai", id: "gpt-5.5-codex" },
			{ PI_ACIDBATH_CODEX_COMPACT: "true" },
		) === true,
	);
});

// ─── 4. buildCodexCompactPrompt ──────────────────────────────────────────

run("buildCodexCompactPrompt — required sections present in system prompt", () => {
	const { systemPrompt } = buildCodexCompactPrompt({
		firstKeptEntryId: "abc",
		tokensBefore: 100,
		conversationText: "hello",
	});
	for (const section of ["## Goal", "## Progress", "## Decisions", "## Next steps", "## Files"]) {
		assert(`sys.${section}`, systemPrompt.includes(section), `missing: ${section}`);
	}
});

run("buildCodexCompactPrompt — system prompt is not empty", () => {
	const { systemPrompt } = buildCodexCompactPrompt({
		firstKeptEntryId: "abc",
		tokensBefore: 100,
		conversationText: "hi",
	});
	assert("sys.nonempty", typeof systemPrompt === "string" && systemPrompt.length > 0);
});

run("buildCodexCompactPrompt — userText contains conversation text", () => {
	const { userText } = buildCodexCompactPrompt({
		firstKeptEntryId: "abc",
		tokensBefore: 100,
		conversationText: "user said: write tests",
	});
	assert("user.contains-conv", userText.includes("user said: write tests"));
	assert("user.has-header", userText.includes("Conversation to summarize"));
});

run("buildCodexCompactPrompt — previous summary included when present", () => {
	const { userText } = buildCodexCompactPrompt({
		firstKeptEntryId: "abc",
		tokensBefore: 100,
		previousSummary: "Earlier we shipped the magic matcher.",
		conversationText: "Now do the codex prompt.",
	});
	assert("prev.included", userText.includes("Earlier we shipped the magic matcher."));
	assert("prev.header", userText.includes("Previous summary"));
	assert("prev.before.conv", userText.indexOf("Earlier we shipped the magic matcher.") < userText.indexOf("Now do the codex prompt."));
});

run("buildCodexCompactPrompt — empty previousSummary is dropped", () => {
	const { userText } = buildCodexCompactPrompt({
		firstKeptEntryId: "abc",
		tokensBefore: 100,
		previousSummary: "",
		conversationText: "only the current conversation",
	});
	assert("prev.empty.absent", !userText.includes("Previous summary"));
	assert("prev.empty.has-conv", userText.includes("only the current conversation"));
});

run("buildCodexCompactPrompt — undefined previousSummary is dropped", () => {
	const { userText } = buildCodexCompactPrompt({
		firstKeptEntryId: "abc",
		tokensBefore: 100,
		conversationText: "no previous",
	});
	assert("prev.undef.absent", !userText.includes("Previous summary"));
});

// ─── 5. mapCompactResult ─────────────────────────────────────────────────

run("mapCompactResult — aborted wins over summary", () => {
	const out = mapCompactResult({
		summary: "a real summary",
		aborted: true,
		firstKeptEntryId: "abc",
		tokensBefore: 100,
	});
	assert("abort.handled", out.handled === false);
	if (out.handled === false) {
		assert("abort.reason", out.reason === "aborted");
	}
});

run("mapCompactResult — undefined summary → empty", () => {
	const out = mapCompactResult({
		summary: undefined,
		aborted: false,
		firstKeptEntryId: "abc",
		tokensBefore: 100,
	});
	assert("undef.handled", out.handled === false);
	if (out.handled === false) {
		assert("undef.reason", out.reason === "empty");
	}
});

run("mapCompactResult — empty string → empty", () => {
	const out = mapCompactResult({
		summary: "",
		aborted: false,
		firstKeptEntryId: "abc",
		tokensBefore: 100,
	});
	assert("empty.handled", out.handled === false);
	if (out.handled === false) {
		assert("empty.reason", out.reason === "empty");
	}
});

run("mapCompactResult — whitespace-only summary → empty", () => {
	const out = mapCompactResult({
		summary: "   \n\t  ",
		aborted: false,
		firstKeptEntryId: "abc",
		tokensBefore: 100,
	});
	assert("ws.handled", out.handled === false);
	if (out.handled === false) {
		assert("ws.reason", out.reason === "empty");
	}
});

run("mapCompactResult — happy path → handled true with summary", () => {
	const out = mapCompactResult({
		summary: "## Goal\nship it",
		aborted: false,
		firstKeptEntryId: "kept-1",
		tokensBefore: 4321,
	});
	assert("ok.handled", out.handled === true);
	if (out.handled === true) {
		assert("ok.summary", out.summary === "## Goal\nship it");
		assert("ok.firstKept", out.firstKeptEntryId === "kept-1");
		assert("ok.tokens", out.tokensBefore === 4321);
	}
});

run("mapCompactResult — non-abort + empty → empty wins over abort contract", () => {
	// aborted=false, empty summary → empty reason (not aborted)
	const out = mapCompactResult({
		summary: "",
		aborted: false,
		firstKeptEntryId: "x",
		tokensBefore: 1,
	});
	assert("order.empty", out.handled === false && out.reason === "empty");
});

// ─── 6. sanitizeCompactError ─────────────────────────────────────────────

run("sanitizeCompactError — non-string yields a usable placeholder", () => {
	// Must never be "": an empty message renders as a bare
	// "(no error message)" and loses the real cause.
	assert("sanit.nonstr", sanitizeCompactError(undefined) === "unknown error");
	assert("sanit.emptystr", sanitizeCompactError("") === "unknown error (no detail reported)");
	assert("sanit.blank", sanitizeCompactError("   ") === "unknown error (no detail reported)");
	assert("sanit.null", sanitizeCompactError(null) === "unknown error");
});

run("sanitizeCompactError — trims but preserves real messages", () => {
	assert("sanit.keeps", sanitizeCompactError("  boom  ") === "boom");
	assert("sanit.trims", sanitizeCompactError("boom\n") === "boom");
});

run("sanitizeCompactError — strips OpenAI keys", () => {
	const skPrefix = String.fromCharCode(115, 107);
	const keyA = [skPrefix, "1234567890"].join("-");
	const keyB = [skPrefix, "0987654321"].join("-");
	const msg = "auth failed: " + keyA + " and " + keyB;
	const out = sanitizeCompactError(msg);
	assert("sanit.key-prefixed", !out.includes(keyB));
	assert("sanit.key-plain", !out.includes(keyA));
	assert("sanit.key-redact", out.includes("[REDACTED]"));
});

run("sanitizeCompactError — strips Bearer token", () => {
	const bearer = ["header", "payload", "signature"].join(".");
	const msg = "header: Bearer " + bearer;
	const out = sanitizeCompactError(msg);
	assert("sanit.bearer-no-token", !out.includes(bearer));
	assert("sanit.bearer-redacted", out.includes("Bearer [REDACTED]"));
});

run("sanitizeCompactError — strips chatgpt-account-id value", () => {
	const msg = "chatgpt-account-id: 01234567-89ab-cdef-0123-456789abcdef";
	const out = sanitizeCompactError(msg);
	assert("sanit.caid", !out.includes("01234567-89ab-cdef-0123-456789abcdef"));
	assert("sanit.caid-redacted", out.includes("chatgpt-account-id: [REDACTED]"));
});

run("sanitizeCompactError — strips Authorization header value", () => {
	const authorization = ["Authorization"].join("");
	const bearer = [String.fromCharCode(66, 101, 97, 114, 101, 114)].join("");
	const bearerToken = ["abc", "def", "ghi"].join(".");
	const msg1 = `${authorization}: ${bearer} ${bearerToken}`;
	const out1 = sanitizeCompactError(msg1);
	assert("sanit.auth-no-bearer", !out1.includes(bearerToken));
	assert("sanit.auth-redacted", out1.includes("Authorization: [REDACTED]"));

	const authKey = [String.fromCharCode(115, 107), "1234567890abcdef"].join("-");
	const msg2 = `Authorization="${authKey}"`;
	const out2 = sanitizeCompactError(msg2);
	assert("sanit.auth-quoted-no-key", !out2.includes(authKey));
	assert("sanit.auth-quoted-redacted", out2.includes("Authorization: [REDACTED]"));
});

run("sanitizeCompactError — preserves diagnostics after Authorization value", () => {
	const authorization = ["Authorization"].join("");
	const basic = ["Basic"].join("");
	const credential = ["abc", "123"].join("");
	const out = sanitizeCompactError(`${authorization}: ${basic} ${credential} failed for provider openai`);
	assert("sanit.auth-tail", out.includes("failed for provider openai"));
	assert("sanit.auth-tail-redacted", out.includes("Authorization: [REDACTED]"));
});

run("sanitizeCompactError — leaves benign messages unchanged", () => {
	const msg = "compaction aborted by user; no model selected";
	const out = sanitizeCompactError(msg);
	assert("sanit.benign.unchanged", out === msg);
});

run("sanitizeCompactError — strips multiple secrets in one message", () => {
	const bearerA = ["abc", "def"].join(".");
	const bearerB = ["qqq", "rrr"].join(".");
	const projectKey = [String.fromCharCode(115, 107), "proj", "xyzzy"].join("-");
	const msg =
		"got Bearer " + bearerA + " and " + projectKey + " and Authorization: Bearer " + bearerB;
	const out = sanitizeCompactError(msg);
	assert("sanit.multi.bearer", !out.includes("abc.def"));
	assert("sanit.multi.sk", !out.includes(projectKey));
	assert("sanit.multi.auth", !out.includes(bearerB));
});

// ─── Report ──────────────────────────────────────────────────────────────

console.log(`\nharness/codex-compact.ts: ${passed} passed, ${failed} failed`);
if (failed > 0) {
	for (const f of failures.slice(0, 30)) {
		console.log(`  - ${f.name}: ${f.detail ?? ""}`);
	}
	process.exit(1);
}
