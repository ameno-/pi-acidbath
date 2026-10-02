/**
 * Unit tests for extensions/harness/roles.ts (PURE module).
 *
 * Run:
 *   node --experimental-strip-types --no-warnings scripts/test-harness-roles.mjs
 *
 * Asserts:
 *   1. parseRoleSelector — @alias, alias:thinking, invalid suffix.
 *   2. parseRoleRegistry — version, duplicates, refs, fallback.
 *   3. resolveRole — exact hit, scoped preference, fallback, no-fallback,
 *      unknown role, unavailable.
 *   4. applyThinkingOverride — returns a fresh copy (registry unchanged).
 *   5. ref/inherited chain via.
 *   6. Cycle detection.
 *   7. describeResolution strings for every kind.
 *   8. defaultRoleRegistry() parity with config/roles.example.json.
 *
 * The test exits 1 on any failure.
 */

import {
	parseRoleSelector,
	parseRoleRegistry,
	defaultRoleRegistry,
	resolveRole,
	applyThinkingOverride,
	describeResolution,
} from "../extensions/harness/roles.ts";

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

// ─── 1. parseRoleSelector ────────────────────────────────────────────────

run("parseRoleSelector — bare alias", () => {
	const r = parseRoleSelector("smol");
	assert("bare.alias", r.alias === "smol", `got=${r.alias}`);
	assert("bare.noThinking", r.thinkingLevel === undefined, `got=${r.thinkingLevel}`);
});

run("parseRoleSelector — @alias", () => {
	const r = parseRoleSelector("@default");
	assert("at.alias", r.alias === "default", `got=${r.alias}`);
	assert("at.noThinking", r.thinkingLevel === undefined, `got=${r.thinkingLevel}`);
});

run("parseRoleSelector — alias:thinking", () => {
	const r = parseRoleSelector("smol:high");
	assert("colon.alias", r.alias === "smol", `got=${r.alias}`);
	assert("colon.thinking", r.thinkingLevel === "high", `got=${r.thinkingLevel}`);
});

run("parseRoleSelector — @alias:thinking", () => {
	const r = parseRoleSelector("@default:low");
	assert("both.alias", r.alias === "default", `got=${r.alias}`);
	assert("both.thinking", r.thinkingLevel === "low", `got=${r.thinkingLevel}`);
});

run("parseRoleSelector — whitespace trimmed", () => {
	const r = parseRoleSelector("  smol  ");
	assert("trim.alias", r.alias === "smol");
});

run("parseRoleSelector — invalid suffix throws", () => {
	let threw = false;
	try {
		parseRoleSelector("smol:banana");
	} catch (e) {
		threw = e instanceof RangeError;
	}
	assert("invalid.threw", threw);
});

run("parseRoleSelector — empty alias throws", () => {
	let threw = false;
	try {
		parseRoleSelector("@:low");
	} catch (e) {
		threw = e instanceof RangeError;
	}
	assert("empty.alias.threw", threw);
});

run("parseRoleSelector — empty suffix throws", () => {
	let threw = false;
	try {
		parseRoleSelector("smol:");
	} catch (e) {
		threw = e instanceof RangeError;
	}
	assert("empty.suffix.threw", threw);
});

run("parseRoleSelector — only @ throws", () => {
	let threw = false;
	try {
		parseRoleSelector("@");
	} catch (e) {
		threw = e instanceof RangeError;
	}
	assert("only-at.threw", threw);
});

run("parseRoleSelector — empty input throws", () => {
	let threw = false;
	try {
		parseRoleSelector("   ");
	} catch (e) {
		threw = e instanceof RangeError;
	}
	assert("empty.input.threw", threw);
});

run("parseRoleSelector — every thinking level accepted", () => {
	const levels = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
	for (const lvl of levels) {
		const r = parseRoleSelector(`smol:${lvl}`);
		assert(`level.${lvl}`, r.thinkingLevel === lvl, `got=${r.thinkingLevel}`);
	}
});

// ─── 2. applyThinkingOverride (purity) ───────────────────────────────────

run("applyThinkingOverride — returns new object (no mutation)", () => {
	const reg = defaultRoleRegistry();
	const smol = reg.aliases.find((s) => s.alias === "smol");
	if (!smol) throw new Error("smol alias missing from default registry");
	const before = JSON.stringify(smol);
	const overridden = applyThinkingOverride(smol, "high");
	assert("purity.registry.unchanged", JSON.stringify(smol) === before, "registry alias mutated");
	assert("purity.new.object", overridden !== smol);
	assert("purity.thinking.applied", overridden.thinkingLevel === "high", `got=${overridden.thinkingLevel}`);
	assert("purity.original.thinking.unchanged", smol.thinkingLevel === "minimal", `got=${smol.thinkingLevel}`);
});

run("applyThinkingOverride — undefined → same thinking level", () => {
	const reg = defaultRoleRegistry();
	const smol = reg.aliases.find((s) => s.alias === "smol");
	if (!smol) throw new Error("smol alias missing from default registry");
	const out = applyThinkingOverride(smol);
	assert("undef.thinking.kept", out.thinkingLevel === smol.thinkingLevel);
	assert("undef.new.object", out !== smol);
});

run("applyThinkingOverride — tools array copied (no alias)", () => {
	const reg = defaultRoleRegistry();
	const vision = reg.aliases.find((s) => s.alias === "vision");
	if (!vision) throw new Error("vision alias missing");
	const out = applyThinkingOverride(vision, "high");
	assert("tools.copied", out.tools && vision.tools && out.tools !== vision.tools);
	assert("tools.same.contents", JSON.stringify(out.tools) === JSON.stringify(vision.tools));
});

// ─── 3. parseRoleRegistry ────────────────────────────────────────────────

run("parseRoleRegistry — accepts valid registry", () => {
	const reg = defaultRoleRegistry();
	const parsed = parseRoleRegistry({
		version: reg.version,
		aliases: reg.aliases,
		fallback: reg.fallback,
	});
	assert("valid.version", parsed.version === 1);
	assert("valid.aliases", parsed.aliases.length === reg.aliases.length);
	assert("valid.fallback", JSON.stringify(parsed.fallback) === JSON.stringify(reg.fallback));
});

run("parseRoleRegistry — rejects wrong version", () => {
	let threw = false;
	try {
		parseRoleRegistry({ version: 2, aliases: defaultRoleRegistry().aliases, fallback: [] });
	} catch (e) {
		threw = e instanceof RangeError;
	}
	assert("version.threw", threw);
});

run("parseRoleRegistry — rejects empty aliases", () => {
	let threw = false;
	try {
		parseRoleRegistry({ version: 1, aliases: [], fallback: [] });
	} catch (e) {
		threw = e instanceof RangeError;
	}
	assert("empty.aliases.threw", threw);
});

run("parseRoleRegistry — rejects duplicate alias", () => {
	let threw = false;
	try {
		parseRoleRegistry({
			version: 1,
			aliases: [
				{ alias: "smol", provider: "openai", model: "gpt-5-mini", description: "x" },
				{ alias: "smol", provider: "openai", model: "gpt-5-nano", description: "y" },
			],
			fallback: [],
		});
	} catch (e) {
		threw = e instanceof RangeError;
	}
	assert("dup.threw", threw);
});

run("parseRoleRegistry — rejects ref pointing to unknown alias", () => {
	let threw = false;
	try {
		parseRoleRegistry({
			version: 1,
			aliases: [
				{ alias: "smol", provider: "openai", model: "gpt-5-mini", description: "x" },
				{ alias: "twin", ref: "ghost", description: "y" },
			],
			fallback: [],
		});
	} catch (e) {
		threw = e instanceof RangeError;
	}
	assert("unknown.ref.threw", threw);
});

run("parseRoleRegistry — rejects ref + provider combo", () => {
	let threw = false;
	try {
		parseRoleRegistry({
			version: 1,
			aliases: [
				{ alias: "smol", provider: "openai", model: "gpt-5-mini", description: "x" },
				{ alias: "twin", ref: "smol", provider: "openai", description: "y" },
			],
			fallback: [],
		});
	} catch (e) {
		threw = e instanceof RangeError;
	}
	assert("ref.plus.provider.threw", threw);
});

run("parseRoleRegistry — rejects invalid thinkingLevel", () => {
	let threw = false;
	try {
		parseRoleRegistry({
			version: 1,
			aliases: [
				{
					alias: "smol",
					provider: "openai",
					model: "gpt-5-mini",
					thinkingLevel: "banana",
					description: "x",
				},
			],
			fallback: [],
		});
	} catch (e) {
		threw = e instanceof RangeError;
	}
	assert("invalid.thinking.threw", threw);
});

run("parseRoleRegistry — rejects fallback pointing to unknown alias", () => {
	let threw = false;
	try {
		parseRoleRegistry({
			version: 1,
			aliases: [{ alias: "smol", provider: "openai", model: "gpt-5-mini", description: "x" }],
			fallback: ["ghost"],
		});
	} catch (e) {
		threw = e instanceof RangeError;
	}
	assert("unknown.fallback.threw", threw);
});

// ─── 4. resolveRole ──────────────────────────────────────────────────────

const REG = defaultRoleRegistry();
const ALL_AVAILABLE = REG.aliases.map((s) => ({ provider: s.provider, id: s.model }));

run("resolveRole — exact hit", () => {
	const r = resolveRole("default", REG, ALL_AVAILABLE);
	assert("exact.kind", r.kind === "exact", `got=${r.kind}`);
	if (r.kind === "exact") {
		assert("exact.alias", r.spec.alias === "default");
		assert("exact.model", r.spec.model === "claude-sonnet-4-5");
	}
});

run("resolveRole — exact hit with @alias", () => {
	const r = resolveRole("@default", REG, ALL_AVAILABLE);
	assert("at.kind", r.kind === "exact");
});

run("resolveRole — thinking override applies", () => {
	const r = resolveRole("default:high", REG, ALL_AVAILABLE);
	assert("ov.kind", r.kind === "exact", `got=${r.kind}`);
	if (r.kind === "exact") {
		assert("ov.thinking", r.spec.thinkingLevel === "high", `got=${r.spec.thinkingLevel}`);
	}
});

run("resolveRole — scoped list prefers scoped hit", () => {
	// scoped contains the requested model even though ALL_AVAILABLE does not.
	const only = REG.aliases.find((s) => s.alias === "smol");
	if (!only) throw new Error("smol missing");
	const r = resolveRole(
		"smol",
		REG,
		// available list excludes gpt-5-mini
		ALL_AVAILABLE.filter((m) => m.id !== only.model),
		{ scoped: [{ provider: only.provider, id: only.model }] },
	);
	assert("scoped.kind", r.kind === "exact", `got=${r.kind}`);
});

run("resolveRole — scoped hit without scoped → falls back", () => {
	const only = REG.aliases.find((s) => s.alias === "smol");
	if (!only) throw new Error("smol missing");
	const r = resolveRole(
		"smol",
		REG,
		// available list excludes gpt-5-mini
		ALL_AVAILABLE.filter((m) => m.id !== only.model),
	);
	// default fallback chain has default first, which IS available.
	assert("noscope.kind", r.kind === "fallback", `got=${r.kind}`);
	if (r.kind === "fallback") {
		assert("noscope.missing", r.missing === "smol");
	}
});

run("resolveRole — fallback chain walks in order", () => {
	// want unavailable; fb1 is unavailable (gpt-5-mini, same as want);
	// fb2 (gpt-5-nano) is available → expect fb2.
	const regWithOrder = {
		version: 1,
		aliases: [
			{ alias: "want", provider: "openai", model: "gpt-5-mini", description: "x" },
			{ alias: "fb1", provider: "openai", model: "gpt-5-mini", description: "x" },
			{ alias: "fb2", provider: "openai", model: "gpt-5-nano", description: "x" },
		],
		fallback: ["fb1", "fb2"],
	};
	const r = resolveRole("want", regWithOrder, [{ provider: "openai", id: "gpt-5-nano" }]);
	assert("order.kind", r.kind === "fallback");
	if (r.kind === "fallback") {
		assert("order.picked", r.spec.alias === "fb2", `picked=${r.spec.alias}`);
	}
});

run("resolveRole — unavailable + empty fallback → no-fallback error", () => {
	const reg = {
		version: 1,
		aliases: [{ alias: "want", provider: "openai", model: "gpt-5-mini", description: "x" }],
		fallback: [],
	};
	const r = resolveRole("want", reg, [{ provider: "openai", id: "gpt-5-nano" }]);
	assert("nofb.kind", r.kind === "error" && r.reason === "no-fallback", `got=${JSON.stringify(r)}`);
});

run("resolveRole — unavailable + populated but unreachable fallback → unavailable error", () => {
	const reg = {
		version: 1,
		aliases: [
			{ alias: "want", provider: "openai", model: "gpt-5-mini", description: "x" },
			{ alias: "fb", provider: "openai", model: "gpt-5-nano", description: "x" },
		],
		fallback: ["fb"],
	};
	const r = resolveRole("want", reg, [{ provider: "anthropic", id: "claude-sonnet-4-5" }]);
	assert("unavail.kind", r.kind === "error" && r.reason === "unavailable", `got=${JSON.stringify(r)}`);
});

run("resolveRole — unknown role → error", () => {
	const r = resolveRole("ghost", REG, ALL_AVAILABLE);
	assert("unknown.kind", r.kind === "error" && r.reason === "unknown-role", `got=${JSON.stringify(r)}`);
	if (r.kind === "error") {
		assert("unknown.missing", r.missing === "ghost");
	}
});

run("resolveRole — unknown role via thinking override still errors as unknown-role", () => {
	const r = resolveRole("ghost:high", REG, ALL_AVAILABLE);
	assert("unknown.ov.kind", r.kind === "error" && r.reason === "unknown-role", `got=${JSON.stringify(r)}`);
});

// ─── 5. ref / inherited ──────────────────────────────────────────────────

run("resolveRole — ref → inherited with via chain", () => {
	const reg = {
		version: 1,
		aliases: [
			{ alias: "base", provider: "anthropic", model: "claude-sonnet-4-5", thinkingLevel: "medium", description: "x" },
			{ alias: "mirror", ref: "base", description: "inherits base" },
		],
		fallback: [],
	};
	const r = resolveRole("mirror", reg, ALL_AVAILABLE);
	assert("inherit.kind", r.kind === "inherited", `got=${r.kind}`);
	if (r.kind === "inherited") {
		assert("inherit.via", r.via === "mirror", `via=${r.via}`);
		assert("inherit.model", r.spec.model === "claude-sonnet-4-5");
	}
});

run("resolveRole — multi-hop ref → via chain joined", () => {
	const reg = {
		version: 1,
		aliases: [
			{ alias: "base", provider: "anthropic", model: "claude-sonnet-4-5", thinkingLevel: "medium", description: "x" },
			{ alias: "mid", ref: "base", description: "x" },
			{ alias: "leaf", ref: "mid", description: "x" },
		],
		fallback: [],
	};
	const r = resolveRole("leaf", reg, ALL_AVAILABLE);
	assert("multihop.kind", r.kind === "inherited", `got=${r.kind}`);
	if (r.kind === "inherited") {
		assert("multihop.via", r.via === "leaf → mid", `via=${r.via}`);
	}
});

run("resolveRole — self-cycle → cycle error", () => {
	const reg = {
		version: 1,
		aliases: [{ alias: "loop", ref: "loop", description: "x" }],
		fallback: [],
	};
	const r = resolveRole("loop", reg, ALL_AVAILABLE);
	assert("cycle.kind", r.kind === "error" && r.reason === "cycle", `got=${JSON.stringify(r)}`);
});

run("resolveRole — two-step cycle → cycle error", () => {
	const reg = {
		version: 1,
		aliases: [
			{ alias: "a", ref: "b", description: "x" },
			{ alias: "b", ref: "a", description: "y" },
		],
		fallback: [],
	};
	const r = resolveRole("a", reg, ALL_AVAILABLE);
	assert("cycle2.kind", r.kind === "error" && r.reason === "cycle", `got=${JSON.stringify(r)}`);
});

// ─── 6. describeResolution strings ───────────────────────────────────────

run("describeResolution — exact", () => {
	const r = resolveRole("default", REG, ALL_AVAILABLE);
	const s = describeResolution(r);
	assert("desc.exact.has.alias", s.includes("default"), `got="${s}"`);
	assert("desc.exact.has.model", s.includes("claude-sonnet-4-5"), `got="${s}"`);
});

run("describeResolution — inherited", () => {
	const reg = {
		version: 1,
		aliases: [
			{ alias: "base", provider: "anthropic", model: "claude-sonnet-4-5", thinkingLevel: "medium", description: "x" },
			{ alias: "leaf", ref: "base", description: "x" },
		],
		fallback: [],
	};
	const r = resolveRole("leaf", reg, ALL_AVAILABLE);
	const s = describeResolution(r);
	assert("desc.inherit.has.via", s.includes("via leaf"), `got="${s}"`);
	assert("desc.inherit.has.model", s.includes("claude-sonnet-4-5"));
});

run("describeResolution — fallback mentions missing alias", () => {
	const smol = REG.aliases.find((s) => s.alias === "smol");
	if (!smol) throw new Error("smol missing");
	const r = resolveRole("smol", REG, ALL_AVAILABLE.filter((m) => m.id !== smol.model));
	const s = describeResolution(r);
	assert("desc.fallback.has.missing", s.includes("smol"), `got="${s}"`);
	assert("desc.fallback.has.falling", s.toLowerCase().includes("fallback") || s.toLowerCase().includes("falling"), `got="${s}"`);
});

run("describeResolution — error mentions reason", () => {
	const r = resolveRole("ghost", REG, ALL_AVAILABLE);
	const s = describeResolution(r);
	assert("desc.error.has.reason", s.includes("unknown-role"), `got="${s}"`);
});

// ─── 7. defaultRoleRegistry() parity with config/roles.example.json ──────

run("defaultRoleRegistry — matches example file shape", () => {
	const reg = defaultRoleRegistry();
	assert("def.version", reg.version === 1);
	const expectedAliases = ["default", "compact", "smol", "slow", "vision", "plan", "commit", "task", "advisor", "tiny"];
	for (const name of expectedAliases) {
		assert(`def.has.${name}`, reg.aliases.some((s) => s.alias === name));
	}
	assert("def.fallback", JSON.stringify(reg.fallback) === JSON.stringify(["default", "tiny"]));
});

run("defaultRoleRegistry — vision role has read tool", () => {
	const reg = defaultRoleRegistry();
	const vision = reg.aliases.find((s) => s.alias === "vision");
	if (!vision) throw new Error("vision missing");
	assert("def.vision.tools", JSON.stringify(vision.tools) === JSON.stringify(["read"]));
});

// ─── Report ──────────────────────────────────────────────────────────────

console.log(`\nroles.ts: ${passed} passed, ${failed} failed`);
if (failed > 0) {
	for (const f of failures.slice(0, 30)) {
		console.log(`  - ${f.name}: ${f.detail ?? ""}`);
	}
	process.exit(1);
}
