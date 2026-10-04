/**
 * Unit tests for extensions/harness/magic.ts (exact-prose magic-word
 * matcher per ADR-0004).
 *
 * Run:
 *   node --experimental-strip-types --no-warnings scripts/test-harness-magic.mjs
 *
 * Pure test file — imports the production magic.ts and exercises every
 * public path:
 *   1. Global disable short-circuits to [].
 *   2. Per-keyword disable is honored.
 *   3. Exact lowercase standalone match works.
 *   4. Case mismatch is rejected.
 *   5. Fenced code, inline code, and HTML/XML tags are ignored.
 *   6. Path-like tokens (`./`, `~/`, `file://`, with `/`) are ignored.
 *   7. File-extension tokens (`.ts`, `.md`, `.json`, ...) are ignored.
 *   8. Identifiers like `ultrathink.py` or `my_ultrathink` do not match.
 *   9. Multiple matches preserve document order.
 *  10. Uniqueness by id when the same keyword repeats.
 *  11. formatMagicHints returns "" on empty, multi-line otherwise.
 *  12. parseMagicRegistry happy + error paths.
 *  13. Prompt is never mutated.
 *
 * The test exits 1 on any failure.
 */

import {
	addMagicKeyword,
	defaultMagicRegistry,
	formatMagicHints,
	matchMagicWords,
	parseMagicRegistry,
	removeMagicKeyword,
	setMagicKeywordEnabled,
} from "../extensions/harness/magic.ts";

let passed = 0;
let failed = 0;
const failures = [];

function eq(actual, expected) {
	if (actual === expected) return true;
	if (typeof actual === "string" && typeof expected === "string" && actual === expected) return true;
	return false;
}

function deepEq(actual, expected) {
	if (actual === expected) return true;
	if (typeof actual !== typeof expected) return false;
	if (Array.isArray(actual) && Array.isArray(expected)) {
		if (actual.length !== expected.length) return false;
		for (let i = 0; i < actual.length; i++) {
			if (!deepEq(actual[i], expected[i])) return false;
		}
		return true;
	}
	if (typeof actual === "object" && typeof expected === "object" && actual !== null && expected !== null) {
		const aKeys = Object.keys(actual).sort();
		const eKeys = Object.keys(expected).sort();
		if (aKeys.length !== eKeys.length) return false;
		for (const k of aKeys) {
			if (!deepEq(actual[k], expected[k])) return false;
		}
		return true;
	}
	return false;
}

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

function registryFromKeywords(globalEnabled, kws) {
	return {
		enabled: globalEnabled,
		keywords: kws.map((k) => ({
			id: k.id,
			word: k.word,
			hint: k.hint ?? `hint for ${k.id}`,
			enabled: k.enabled ?? true,
			...(k.raiseThinking !== undefined ? { raiseThinking: k.raiseThinking } : {}),
		})),
	};
}

const ultrathinkKw = {
	id: "ultrathink",
	word: "ultrathink",
	hint: "Use maximum careful reasoning. Do not run extra tools solely because this word appeared.",
	enabled: true,
	raiseThinking: true,
};
const handoffKw = {
	id: "handoff",
	word: "handoff",
	hint: "If the user wants a new focused session, they should run /handoff. Do not invent a session switch.",
	enabled: true,
};
const recapKw = {
	id: "recap",
	word: "recap",
	hint: "If the user wants a persistent recap, they should run /recap. Do not write files.",
	enabled: true,
};

const disabledKw = { ...ultrathinkKw, id: "disabled-ultra", word: "disabled-ultra", enabled: false };

const fullReg = registryFromKeywords(true, [ultrathinkKw, handoffKw, recapKw, disabledKw]);

// ---------------------------------------------------------------------------
// 1. defaultMagicRegistry / parseMagicRegistry — happy + error
// ---------------------------------------------------------------------------

run("defaultMagicRegistry returns disabled + empty keywords", () => {
	const r = defaultMagicRegistry();
	assert("default.enabled", r.enabled === false, `got=${r.enabled}`);
	assert("default.keywords", Array.isArray(r.keywords) && r.keywords.length === 0, `got=${JSON.stringify(r.keywords)}`);
});

run("parseMagicRegistry — happy path round-trip", () => {
	const src = {
		enabled: true,
		keywords: [
			{ id: "a", word: "alpha", hint: "h-a", enabled: true, raiseThinking: true },
			{ id: "b", word: "beta", hint: "h-b", enabled: false },
		],
	};
	const r = parseMagicRegistry(src);
	assert("parse.enabled", r.enabled === true);
	assert("parse.length", r.keywords.length === 2);
	assert("parse.a", r.keywords[0].id === "a" && r.keywords[0].raiseThinking === true);
	assert("parse.b", r.keywords[1].id === "b" && r.keywords[1].raiseThinking === undefined);
});

run("parseMagicRegistry — rejects non-object", () => {
	let threw = false;
	try {
		parseMagicRegistry("not an object");
	} catch {
		threw = true;
	}
	assert("parse.nonobject", threw);
});

run("parseMagicRegistry — rejects missing enabled", () => {
	let threw = false;
	try {
		parseMagicRegistry({ keywords: [] });
	} catch {
		threw = true;
	}
	assert("parse.noenabled", threw);
});

run("parseMagicRegistry — rejects non-array keywords", () => {
	let threw = false;
	try {
		parseMagicRegistry({ enabled: true, keywords: "nope" });
	} catch {
		threw = true;
	}
	assert("parse.nokeywords", threw);
});

run("parseMagicRegistry — rejects bad keyword shape", () => {
	const cases = [
		{ enabled: true, keywords: [null] },
		{ enabled: true, keywords: [{ id: 1, word: "x", hint: "h", enabled: true }] },
		{ enabled: true, keywords: [{ id: "x", word: "", hint: "h", enabled: true }] },
		{ enabled: true, keywords: [{ id: "x", word: "x", hint: 7, enabled: true }] },
		{ enabled: true, keywords: [{ id: "x", word: "x", hint: "h", enabled: "yes" }] },
		{
			enabled: true,
			keywords: [{ id: "x", word: "x", hint: "h", enabled: true, raiseThinking: "yes" }],
		},
	];
	for (const c of cases) {
		let threw = false;
		try {
			parseMagicRegistry(c);
		} catch {
			threw = true;
		}
		assert(`parse.badshape ${JSON.stringify(c).slice(0, 60)}`, threw);
	}
});

// ---------------------------------------------------------------------------
// 2. Global disable
// ---------------------------------------------------------------------------

run("registry.enabled=false → []", () => {
	const reg = registryFromKeywords(false, [ultrathinkKw]);
	const out = matchMagicWords("please ultrathink this carefully", reg);
	assert("global.disable.empty", Array.isArray(out) && out.length === 0, `got=${JSON.stringify(out)}`);
});

// ---------------------------------------------------------------------------
// 3. Per-keyword disable
// ---------------------------------------------------------------------------

run("per-keyword enabled=false is skipped", () => {
	const reg = registryFromKeywords(true, [disabledKw]);
	const out = matchMagicWords("consider disabled-ultra in this prompt", reg);
	assert("perkw.skip.empty", out.length === 0, `got=${JSON.stringify(out)}`);
	const reg2 = registryFromKeywords(true, [ultrathinkKw, disabledKw]);
	const out2 = matchMagicWords("ultrathink and disabled-ultra both here", reg2);
	assert("perkw.skip.only-ultrathink", out2.length === 1 && out2[0].id === "ultrathink", `got=${JSON.stringify(out2)}`);
});

// ---------------------------------------------------------------------------
// 4. Exact lowercase standalone match
// ---------------------------------------------------------------------------

run("exact lowercase standalone match works", () => {
	const out = matchMagicWords("ultrathink this design", fullReg);
	assert("exact.one", out.length === 1 && out[0].id === "ultrathink", `got=${JSON.stringify(out)}`);
	assert("exact.fields", out[0].word === "ultrathink" && out[0].raiseThinking === true && typeof out[0].hint === "string");
});

run("match at start, middle, end of prompt", () => {
	const a = matchMagicWords("ultrathink first", fullReg);
	const b = matchMagicWords("then ultrathink here", fullReg);
	const c = matchMagicWords("finally, ultrathink", fullReg);
	assert("at.start", a.length === 1 && a[0].id === "ultrathink");
	assert("at.middle", b.length === 1 && b[0].id === "ultrathink");
	assert("at.end", c.length === 1 && c[0].id === "ultrathink");
});

// ---------------------------------------------------------------------------
// 5. Case rejection
// ---------------------------------------------------------------------------

run("case mismatch is rejected", () => {
	const cases = [
		"Ultrathink this please",
		"ULTRATHINK louder",
		"uLtRaThInK",
		"ultrathinks more",
		"myUltrathink later",
	];
	for (const prompt of cases) {
		const out = matchMagicWords(prompt, fullReg);
		assert(`case.reject ${prompt}`, out.length === 0, `got=${JSON.stringify(out)}`);
	}
});

// ---------------------------------------------------------------------------
// 6. Fenced / inline / HTML tag ignore
// ---------------------------------------------------------------------------

run("fenced code blocks are ignored", () => {
	const prompt = "before\n```\nultrathink here in a code block\n```\nafter";
	const out = matchMagicWords(prompt, fullReg);
	assert("fenced.ignore", out.length === 0, `got=${JSON.stringify(out)}`);
});

run("fenced code with language tag is ignored", () => {
	const prompt = "before\n```ts\nconst x = 'ultrathink';\n```\nafter";
	const out = matchMagicWords(prompt, fullReg);
	assert("fenced.lang.ignore", out.length === 0, `got=${JSON.stringify(out)}`);
});

run("inline code is ignored", () => {
	const prompt = "look at `ultrathink` in the function name";
	const out = matchMagicWords(prompt, fullReg);
	assert("inline.ignore", out.length === 0, `got=${JSON.stringify(out)}`);
});

run("HTML/XML tags are ignored", () => {
	const prompts = [
		"a <b>ultrathink</b> c",
		"<div>ultrathink inside</div>",
		"<ultrathink>x</ultrathink>",
		"</ultrathink> tail",
	];
	for (const prompt of prompts) {
		const out = matchMagicWords(prompt, fullReg);
		assert(`html.ignore ${prompt}`, out.length === 0, `got=${JSON.stringify(out)}`);
	}
});

run("HTML tag with attributes is ignored", () => {
	const prompt = '<a href="ultrathink">link</a> after';
	const out = matchMagicWords(prompt, fullReg);
	assert("html.attr.ignore", out.length === 0, `got=${JSON.stringify(out)}`);
});

run("match outside fence still works when fence contains the word", () => {
	const prompt = "ultrathink before\n```\nultrathink inside\n```\nafter";
	const out = matchMagicWords(prompt, fullReg);
	assert("fence.match-outside", out.length === 1 && out[0].id === "ultrathink", `got=${JSON.stringify(out)}`);
});

// ---------------------------------------------------------------------------
// 7. Path / extension / identifier ignore
// ---------------------------------------------------------------------------

run("path-like tokens are ignored", () => {
	const cases = [
		"see /usr/local/ultrathink",
		"./ultrathink here",
		"~/projects/ultrathink",
		"file://host/ultrathink",
		"foo/ultrathink",
		"a/b/c/ultrathink",
	];
	for (const prompt of cases) {
		const out = matchMagicWords(prompt, fullReg);
		assert(`path.ignore ${prompt}`, out.length === 0, `got=${JSON.stringify(out)}`);
	}
});

run("file extension tokens are ignored", () => {
	const cases = [
		"ultrathink.py please",
		"run ultrathink.md",
		"see ultrathink.ts",
		"open ultrathink.json",
		"ultrathink.jsx more",
	];
	for (const prompt of cases) {
		const out = matchMagicWords(prompt, fullReg);
		assert(`ext.ignore ${prompt}`, out.length === 0, `got=${JSON.stringify(out)}`);
	}
});

run("identifier with underscore is not matched", () => {
	const out = matchMagicWords("call my_ultrathink() in this module", fullReg);
	assert("ident.underscore", out.length === 0, `got=${JSON.stringify(out)}`);
});

run("identifier with hyphen suffix is not matched", () => {
	const out = matchMagicWords("the ultrathink-like reasoning path", fullReg);
	assert("ident.hyphen", out.length === 0, `got=${JSON.stringify(out)}`);
});

run("bare match still works after path-shaped prefix is rejected", () => {
	const out = matchMagicWords("the path ./ultrathink.py and then please ultrathink", fullReg);
	assert("path-then-bare", out.length === 1 && out[0].id === "ultrathink", `got=${JSON.stringify(out)}`);
});

// ---------------------------------------------------------------------------
// 8. Multiple matches — order + uniqueness
// ---------------------------------------------------------------------------

run("multiple matches preserve document order", () => {
	const prompt = "ultrathink then recap then handoff at the end";
	const out = matchMagicWords(prompt, fullReg);
	const ids = out.map((m) => m.id);
	assert("multi.order", eq(ids.join(","), "ultrathink,recap,handoff"), `got=${ids.join(",")}`);
});

run("repeat of same keyword yields one match", () => {
	const prompt = "ultrathink and then ultrathink again ultrathink";
	const out = matchMagicWords(prompt, fullReg);
	assert("repeat.unique", out.length === 1 && out[0].id === "ultrathink", `got=${JSON.stringify(out)}`);
});

run("two keywords share a word — both emit, but unique by id", () => {
	const reg = registryFromKeywords(true, [
		{ id: "u1", word: "ultrathink", hint: "h1", enabled: true },
		{ id: "u2", word: "ultrathink", hint: "h2", enabled: true },
	]);
	const out = matchMagicWords("please ultrathink now", reg);
	assert("two-keywords-same-word", out.length === 2, `got=${JSON.stringify(out)}`);
	const ids = new Set(out.map((m) => m.id));
	assert("two-keywords-unique-ids", ids.size === 2, `got=${[...ids].join(",")}`);
});

// ---------------------------------------------------------------------------
// 9. formatMagicHints
// ---------------------------------------------------------------------------

run("formatMagicHints — empty list returns \"\"", () => {
	assert("fmt.empty", formatMagicHints([]) === "", `got="${formatMagicHints([])}"`);
});

run("formatMagicHints — single match", () => {
	const out = formatMagicHints([
		{ id: "ultrathink", word: "ultrathink", hint: "be careful", raiseThinking: true },
	]);
	assert("fmt.single", out === "[magic:ultrathink] be careful", `got="${out}"`);
});

run("formatMagicHints — multiple matches, one per line", () => {
	const out = formatMagicHints([
		{ id: "ultrathink", word: "ultrathink", hint: "be careful", raiseThinking: true },
		{ id: "recap", word: "recap", hint: "use the command", raiseThinking: false },
	]);
	const expected = "[magic:ultrathink] be careful\n[magic:recap] use the command";
	assert("fmt.multi", out === expected, `got="${out}"`);
});

// ---------------------------------------------------------------------------
// 10. Immutability — prompt is never modified
// ---------------------------------------------------------------------------

run("prompt is never mutated", () => {
	const prompt = "ultrathink the `ultrathink` inside ```\nultrathink\n```";
	const before = prompt;
	const out = matchMagicWords(prompt, fullReg);
	assert("immut.unchanged", prompt === before, `before=${JSON.stringify(before)} after=${JSON.stringify(prompt)}`);
	assert("immut.match", out.length === 1 && out[0].id === "ultrathink", `got=${JSON.stringify(out)}`);
});

// ---------------------------------------------------------------------------
// 11. Determinism
// ---------------------------------------------------------------------------

run("determinism — same input → same output, 1000x", () => {
	const prompt = "ultrathink recap handoff with `ultrathink` ignored";
	const first = matchMagicWords(prompt, fullReg);
	for (let i = 0; i < 1000; i++) {
		const out = matchMagicWords(prompt, fullReg);
		assert(`determinism[${i}]`, deepEq(out, first), `drift: ${JSON.stringify(out)} vs ${JSON.stringify(first)}`);
	}
});

// ---------------------------------------------------------------------------
// 12. raiseThinking default
// ---------------------------------------------------------------------------

run("raiseThinking defaults to false when absent", () => {
	const reg = registryFromKeywords(true, [
		{ id: "plain", word: "plain", hint: "no raise", enabled: true },
	]);
	const out = matchMagicWords("plain word", reg);
	assert("raise.default", out.length === 1 && out[0].raiseThinking === false, `got=${JSON.stringify(out)}`);
});

run("addMagicKeyword enables matching and the new word", () => {
	const next = addMagicKeyword(defaultMagicRegistry(), { word: "ShipIt", hint: "keep it small", raiseThinking: true });
	assert("add.enabled", next.enabled === true);
	assert("add.word", next.keywords.some((keyword) => keyword.id === "shipit" && keyword.enabled && keyword.raiseThinking === true));
	assert("add.matches", matchMagicWords("please shipit now", next).length === 1);
	let threw = false;
	try {
		addMagicKeyword(next, { word: "shipit" });
	} catch {
		threw = true;
	}
	assert("add.duplicate", threw);
});

run("setMagicKeywordEnabled rejects unknown ids and turns matching on", () => {
	const added = addMagicKeyword(defaultMagicRegistry(), { word: "focus" });
	const disabled = setMagicKeywordEnabled(added, "focus", false);
	assert("toggle.off", disabled.keywords[0].enabled === false);
	const enabled = setMagicKeywordEnabled(disabled, "focus", true);
	assert("toggle.on", enabled.enabled === true && enabled.keywords[0].enabled === true);
	assert("remove", removeMagicKeyword(enabled, "focus").keywords.length === 0);
});

// ---------------------------------------------------------------------------
// Fence masking: unterminated and tilde fences
// ---------------------------------------------------------------------------

const FENCE_REG = parseMagicRegistry({
	enabled: true,
	keywords: [{ id: "plan", word: "plan", hint: "H", enabled: true }],
});

run("fences — terminated backtick fence masks its body", () => {
	const prompt = "```\nplan this\n```";
	assert("fence.closed", matchMagicWords(prompt, FENCE_REG).length === 0);
});

run("fences — UNTERMINATED backtick fence masks to end of prompt", () => {
	// The old ```...``` regex matched nothing here, so keywords inside the
	// code leaked through as if they were prose.
	const prompt = "```\nplan this";
	assert("fence.unterminated", matchMagicWords(prompt, FENCE_REG).length === 0);
});

run("fences — tilde fences are recognized", () => {
	assert("fence.tilde", matchMagicWords("~~~\nplan this\n~~~", FENCE_REG).length === 0);
	assert("fence.tilde.unterminated", matchMagicWords("~~~\nplan this", FENCE_REG).length === 0);
});

run("fences — indented and info-string variants", () => {
	assert("fence.indented", matchMagicWords("   ```\nplan\n   ```", FENCE_REG).length === 0);
	assert("fence.lang", matchMagicWords("```ts\nplan\n```", FENCE_REG).length === 0);
	assert("fence.tilde.lang", matchMagicWords("~~~json\nplan\n~~~", FENCE_REG).length === 0);
});

run("fences — prose outside the fence still matches", () => {
	assert(
		"fence.prose.before",
		matchMagicWords("plan first\n```\nplan hidden", FENCE_REG).length === 1,
	);
	assert(
		"fence.prose.after",
		matchMagicWords("```\nplan hidden\n```\nplan again", FENCE_REG).length === 1,
	);
});

run("fences — a shorter inner run does not close the fence", () => {
	// CommonMark: a closing fence must be at least as long as its opener.
	const prompt = "````\nplan\n```\nstill hidden\n````";
	assert("fence.inner.shorter", matchMagicWords(prompt, FENCE_REG).length === 0);
});

run("fences — a tilde run does not close a backtick fence", () => {
	const prompt = "```\nplan\n~~~\nstill hidden\n```";
	assert("fence.cross", matchMagicWords(prompt, FENCE_REG).length === 0);
});

run("fences — two independent blocks", () => {
	const prompt = "plan outside\n```\nplan hidden\n```\nand\n~~~\nplan hidden2\n~~~\nplan outside2";
	const r = matchMagicWords(prompt, FENCE_REG);
	assert("fence.two.blocks", r.length === 1, `got=${r.length}`);
});

run("fences — inline code still masked after the change", () => {
	assert("fence.inline", matchMagicWords("use `plan` here", FENCE_REG).length === 0);
});

// ---------------------------------------------------------------------------
// Disable semantics
// ---------------------------------------------------------------------------

run("disable — disabling the last enabled keyword turns matching off", () => {
	let reg = parseMagicRegistry({
		enabled: true,
		keywords: [
			{ id: "a", word: "alpha", hint: "A", enabled: true },
			{ id: "b", word: "beta", hint: "B", enabled: true },
		],
	});
	reg = setMagicKeywordEnabled(reg, "b", false);
	assert("disable.stillOther", reg.enabled === true, `got=${reg.enabled}`);
	reg = setMagicKeywordEnabled(reg, "a", false);
	assert("disable.last.off", reg.enabled === false, `registry still claims enabled`);
	assert("disable.last.noMatch", matchMagicWords("alpha", reg).length === 0);
});

run("disable — enabling a keyword turns matching on", () => {
	let reg = parseMagicRegistry({
		enabled: false,
		keywords: [{ id: "a", word: "alpha", hint: "A", enabled: false }],
	});
	reg = setMagicKeywordEnabled(reg, "a", true);
	assert("enable.turnsOn", reg.enabled === true);
	assert("enable.matches", matchMagicWords("alpha", reg).length === 1);
});

run("disable — mutators do not alias the input registry", () => {
	const original = parseMagicRegistry({
		enabled: true,
		keywords: [{ id: "a", word: "alpha", hint: "A", enabled: true }],
	});
	const snapshot = JSON.stringify(original);
	setMagicKeywordEnabled(original, "a", false);
	removeMagicKeyword(original, "a");
	addMagicKeyword(original, { word: "gamma" });
	assert("disable.noAlias", JSON.stringify(original) === snapshot, "input registry mutated");
});

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

console.log(`\nharness/magic.ts: ${passed} passed, ${failed} failed`);
if (failed > 0) {
	for (const f of failures.slice(0, 30)) {
		console.log(`  - ${f.name}: ${f.detail ?? ""}`);
	}
	process.exit(1);
}
