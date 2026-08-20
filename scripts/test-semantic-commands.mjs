/**
 * Unit tests for ui-semantic-commands.ts — the conservative bash-row classifier
 * for `linear` and `ntn` invocations.
 *
 * Run:
 *   node --experimental-strip-types --no-warnings scripts/test-semantic-commands.mjs
 *
 * Asserts:
 *   1. Acceptance: plain direct invocations classify with subcommand + object.
 *   2. Rejection: pipes, chains, redirects, substitutions, globbing, multiline,
 *      unbalanced quotes, unknown tools, bare tool names, non-strings.
 *   3. Metadata: whitelisted flag values (--state/--project/--team/--cycle)
 *      surface; unknown flag values never leak into positionals.
 *   4. Bounds: target/metadata lengths stay bounded for huge input.
 *   5. Purity: same input → same output (1000x), no exceptions on junk.
 */

import { classifySemanticCommand } from "../extensions/acidbath/ui-semantic-commands.ts";

let passed = 0;
let failed = 0;

function run(name, fn) {
	try {
		fn();
		passed++;
	} catch (error) {
		failed++;
		console.log(`FAIL  ${name}  (${error?.message ?? error})`);
	}
}

function assert(cond, detail) {
	if (!cond) throw new Error(detail ?? "assertion failed");
}

function eq(actual, expected) {
	assert(actual === expected, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

// --- 1. Acceptance ---------------------------------------------------------

run("accepts linear issue view with key", () => {
	const r = classifySemanticCommand("linear issue view MIGHT-7");
	eq(r.tool, "linear");
	eq(r.target, "linear: issue view MIGHT-7");
	eq(r.metadata.length, 0);
});

run("accepts linear issue update with quoted state", () => {
	const r = classifySemanticCommand(`linear issue update MIGHT-473 --state "In Review"`);
	eq(r.target, "linear: issue update MIGHT-473");
	eq(r.metadata.join(","), "state: In Review");
});

run("accepts ntn pages edit with page id", () => {
	const r = classifySemanticCommand("ntn pages edit 3bfdcb48-9c71 --content x");
	eq(r.tool, "ntn");
	eq(r.target, "ntn: pages edit 3bfdcb48-9c71");
});

run("accepts single-subcommand invocation", () => {
	const r = classifySemanticCommand("linear auth whoami");
	eq(r.target, "linear: auth whoami");
});

run("long object ids stay bounded", () => {
	const r = classifySemanticCommand(`ntn pages get ${"abcdef12".repeat(16)}`);
	assert(r.target.length <= 64, `target too long: ${r.target.length}`);
	assert(r.target.endsWith("…"), "truncated target should end with ellipsis");
});

// --- 2. Rejection ----------------------------------------------------------

const REJECTED = [
	["pipe", "linear issue list | jq ."],
	["and-chain", "linear issue view MIGHT-1 && echo done"],
	["or-chain", "ntn doctor || true"],
	["semicolon", "linear team list; linear auth list"],
	["redirect", "ntn api /v1/search > out.json"],
	["stdin redirect", "ntn pages create < page.md"],
	["substitution", 'linear issue view $(cat /tmp/id)'],
	["backtick", "linear issue view `cat /tmp/id`"],
	["multiline", "linear issue view MIGHT-1\nlinear issue view MIGHT-2"],
	["env prefix", "LINEAR_DEBUG=1 linear issue list"],
	["unknown tool", "gh issue list"],
	["bare linear", "linear"],
	["bare ntn", "ntn"],
	["unbalanced quote", 'linear issue update MIGHT-1 --state "In Review'],
	["empty string", ""],
	["whitespace only", "   "],
];

for (const [name, command] of REJECTED) {
	run(`rejects ${name}`, () => {
		eq(classifySemanticCommand(command), undefined);
	});
}

run("rejects non-strings", () => {
	for (const junk of [undefined, null, 42, {}, []]) eq(classifySemanticCommand(junk), undefined);
});

// --- 3. Metadata ------------------------------------------------------------

run("whitelisted flags surface in order", () => {
	const r = classifySemanticCommand(`linear issue create --team MIGHT --title "x" --state Todo --project "Acidbath Omnibus"`);
	eq(r.metadata.join(" | "), "team: MIGHT | state: Todo | project: Acidbath Omnibus");
});

run("flag values never become positionals", () => {
	const r = classifySemanticCommand(`linear issue create --title "Add the thing" --team MIGHT`);
	eq(r.target, "linear: issue create");
});

run("--flag=value form works", () => {
	const r = classifySemanticCommand("linear issue update MIGHT-9 --state=Done");
	eq(r.metadata.join(","), "state: Done");
});

run("long flag values stay bounded", () => {
	const r = classifySemanticCommand(`linear issue update MIGHT-9 --state "${"x".repeat(80)}"`);
	assert(r.metadata[0].length <= 40, `metadata too long: ${r.metadata[0]}`);
});

// --- 4/5. Bounds + purity ---------------------------------------------------

run("deterministic across 1000 iterations", () => {
	const command = `linear issue update MIGHT-473 --state "In Review"`;
	const first = JSON.stringify(classifySemanticCommand(command));
	for (let i = 0; i < 1000; i++) {
		if (JSON.stringify(classifySemanticCommand(command)) !== first) throw new Error("nondeterministic");
	}
});

run("no throw on adversarial junk", () => {
	const junk = ["\0\0\0", "linear\0issue", "ntn \u{1F4A9} pages", "linear " + "x".repeat(100_000)];
	for (const command of junk) classifySemanticCommand(command);
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
