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
 *   9. Model catalog formatting — token counts, cost, model lines.
 *  10. searchModelInfos — ranking and filtering.
 *  11. supportedThinkingLevels — map handling.
 *  12. Direct model selectors — parse + detect.
 *  13. suggestRoleAliases — typo suggestions.
 *  14. Role cycling — normalizeCycle, defaultCycle, stepRoleCycle.
 *  15. Role rendering — list entries and picker labels.
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
	upsertRole,
	removeRole,
	formatTokenCount,
	formatCostPerMtok,
	formatModelLine,
	formatModelPickerLabel,
	searchModelInfos,
	supportedThinkingLevels,
	isDirectModelSelector,
	parseModelSelector,
	suggestRoleAliases,
	normalizeCycle,
	defaultCycle,
	stepRoleCycle,
	formatRoleEntry,
	formatRolePickerLabel,
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

run("upsertRole adds a concrete user role without mutating the input", () => {
	const before = defaultRoleRegistry();
	const next = upsertRole(before, {
		alias: "fast",
		provider: "ap-codex",
		model: "gpt-5.6-sol",
		description: "User role.",
		thinkingLevel: "low",
	});
	assert("upsert.added", next.aliases.some((spec) => spec.alias === "fast" && spec.model === "gpt-5.6-sol"));
	assert("upsert.input", !before.aliases.some((spec) => spec.alias === "fast"));
	assert("remove.added", !removeRole(next, "fast").aliases.some((spec) => spec.alias === "fast"));
});

// ─── 8. model catalog formatting ────────────────────────────────────────

run("formatTokenCount — human-readable counts", () => {
	assert("tok.500", formatTokenCount(500) === "500", `got=${formatTokenCount(500)}`);
	assert("tok.200K", formatTokenCount(200000) === "200K", `got=${formatTokenCount(200000)}`);
	assert("tok.256K", formatTokenCount(256000) === "256K", `got=${formatTokenCount(256000)}`);
	assert("tok.1M", formatTokenCount(1000000) === "1M", `got=${formatTokenCount(1000000)}`);
	assert("tok.1.5M", formatTokenCount(1500000) === "1.5M", `got=${formatTokenCount(1500000)}`);
	assert("tok.zero", formatTokenCount(0) === "?", `got=${formatTokenCount(0)}`);
});

run("formatCostPerMtok — dollar rates per million tokens", () => {
	assert("cost.3by15", formatCostPerMtok(3, 15) === "$3.00/$15.00 per Mtok", `got=${formatCostPerMtok(3, 15)}`);
	assert("cost.subdollar", formatCostPerMtok(0.3, 1.2) === "$0.30/$1.20 per Mtok", `got=${formatCostPerMtok(0.3, 1.2)}`);
	assert("cost.tiny", formatCostPerMtok(0.006, 1.2).startsWith("$0.006/"), `got=${formatCostPerMtok(0.006, 1.2)}`);
	assert("cost.unknown", formatCostPerMtok(0, 0) === "cost n/a", `got=${formatCostPerMtok(0, 0)}`);
});

run("formatModelLine — id, name, capabilities", () => {
	const line = formatModelLine({
		provider: "anthropic",
		id: "claude-sonnet-4-5",
		name: "Claude Sonnet 4.5",
		contextWindow: 200000,
		reasoning: true,
		vision: true,
		costIn: 3,
		costOut: 15,
	});
	assert("line.has.ref", line.includes("anthropic/claude-sonnet-4-5"), `got="${line}"`);
	assert("line.has.name", line.includes("Claude Sonnet 4.5"), `got="${line}"`);
	assert("line.has.ctx", line.includes("200K ctx"), `got="${line}"`);
	assert("line.has.cost", line.includes("$3.00/$15.00 per Mtok"), `got="${line}"`);
	assert("line.has.reasoning", line.includes("reasoning"), `got="${line}"`);
	assert("line.has.vision", line.includes("vision"), `got="${line}"`);
});

run("formatModelLine — name identical to id is not duplicated", () => {
	const line = formatModelLine({ provider: "p", id: "m", name: "m" });
	assert("line.nodup", line === "p/m", `got="${line}"`);
});

run("formatModelLine — no cost data is omitted", () => {
	const line = formatModelLine({ provider: "p", id: "m", costIn: 0, costOut: 0 });
	assert("line.nocost", !line.includes("Mtok") && !line.includes("cost"), `got="${line}"`);
});

run("formatModelPickerLabel — truncates at maxLen without newlines", () => {
	const label = formatModelPickerLabel({
		provider: "p",
		id: "some-very-long-model-identifier",
		name: "A very long human readable model name that goes on",
		contextWindow: 200000,
	}, 40);
	assert("picker.len", label.length <= 40, `got=${label.length}`);
	assert("picker.ellipsis", label.endsWith("…"), `got="${label}"`);
	assert("picker.nonewline", !label.includes("\n"));
});

// ─── 9. model search ────────────────────────────────────────────────────

const CATALOG = [
	{ provider: "anthropic", id: "claude-sonnet-4-5", name: "Claude Sonnet 4.5", contextWindow: 200000 },
	{ provider: "anthropic", id: "claude-haiku-4-5", name: "Claude Haiku 4.5", contextWindow: 200000 },
	{ provider: "ap-codex", id: "gpt-5.6-sol", name: "GPT-5.6 Sol", contextWindow: 400000 },
	{ provider: "openai", id: "gpt-5-mini", name: "GPT-5 mini", contextWindow: 400000 },
];

run("searchModelInfos — empty query returns everything", () => {
	const r = searchModelInfos(CATALOG, "");
	assert("search.all.matches", r.matches.length === 4, `got=${r.matches.length}`);
	assert("search.all.total", r.total === 4);
});

run("searchModelInfos — exact reference ranks first", () => {
	const r = searchModelInfos(CATALOG, "anthropic/claude-sonnet-4-5");
	assert("search.exact.first", r.matches[0].id === "claude-sonnet-4-5", `got=${r.matches[0]?.id}`);
});

run("searchModelInfos — id prefix beats substring", () => {
	const r = searchModelInfos(CATALOG, "gpt-5-m");
	const ids = r.matches.map((m) => `${m.provider}/${m.id}`);
	assert("search.prefix.order", ids[0] === "openai/gpt-5-mini", `got=${ids.join(",")}`);
});

run("searchModelInfos — exact reference outranks substring", () => {
	const r = searchModelInfos(CATALOG, "anthropic/claude-haiku-4-5");
	assert("search.exact.first", r.matches[0].id === "claude-haiku-4-5", `got=${r.matches[0]?.id}`);
	assert("search.exact.count", r.matches.length === 1, `got=${r.matches.length}`);
});

run("searchModelInfos — matches human names", () => {
	const r = searchModelInfos(CATALOG, "sonnet");
	assert("search.name", r.matches.some((m) => m.id === "claude-sonnet-4-5"), `got=${r.matches.length}`);
});

run("searchModelInfos — no matches keeps total", () => {
	const r = searchModelInfos(CATALOG, "does-not-exist");
	assert("search.none", r.matches.length === 0 && r.total === 4);
});

run("supportedThinkingLevels — absent map means all levels", () => {
	const all = supportedThinkingLevels(undefined);
	assert("levels.all", all.length === 7, `got=${all.length}`);
	assert("levels.includes.max", all.includes("max"));
});

run("supportedThinkingLevels — null drops a level", () => {
	const levels = supportedThinkingLevels({ off: null, minimal: "1", low: "2", medium: "3", high: "4", xhigh: "5", max: "6" });
	assert("levels.nulldrop", !levels.includes("off"), `got=${levels.join(",")}`);
	assert("levels.kept", levels.length === 6);
});

run("supportedThinkingLevels — all-null map falls back to all", () => {
	const levels = supportedThinkingLevels({ off: null, minimal: null, low: null, medium: null, high: null, xhigh: null, max: null });
	assert("levels.allnull", levels.length === 7, `got=${levels.length}`);
});

// ─── 10. direct model selectors ─────────────────────────────────────────

run("isDirectModelSelector — slash marks a direct ref", () => {
	assert("direct.yes", isDirectModelSelector("anthropic/claude-sonnet-4-5"));
	assert("direct.yes.thinking", isDirectModelSelector("anthropic/claude-sonnet-4-5:high"));
	assert("direct.yes.at", isDirectModelSelector("@anthropic/claude-sonnet-4-5"));
	assert("direct.no.alias", !isDirectModelSelector("smol"));
	assert("direct.no.spaces", !isDirectModelSelector("anthropic / claude"));
	assert("direct.no.empty", !isDirectModelSelector("  "));
});

run("parseModelSelector — provider/model", () => {
	const r = parseModelSelector("anthropic/claude-sonnet-4-5");
	assert("parse.ref.provider", r.provider === "anthropic");
	assert("parse.ref.model", r.model === "claude-sonnet-4-5");
	assert("parse.ref.nothinking", r.thinkingLevel === undefined);
});

run("parseModelSelector — provider/model:thinking", () => {
	const r = parseModelSelector("anthropic/claude-opus-4-1:high");
	assert("parse.th.provider", r.provider === "anthropic");
	assert("parse.th.model", r.model === "claude-opus-4-1");
	assert("parse.th.level", r.thinkingLevel === "high");
});

run("parseModelSelector — @-prefixed and whitespace", () => {
	const r = parseModelSelector("  @ap-codex/gpt-5.6-sol:low ");
	assert("parse.at.provider", r.provider === "ap-codex");
	assert("parse.at.level", r.thinkingLevel === "low");
});

run("parseModelSelector — malformed inputs throw", () => {
	const bad = ["", "smol", "anthropic/", "/claude", "anthropic/claude:x", "anthropic/claude:", "a b/c"];
	for (const input of bad) {
		let threw = false;
		try {
			parseModelSelector(input);
		} catch {
			threw = true;
		}
		assert(`parse.bad.${JSON.stringify(input)}`, threw, `expected throw for "${input}"`);
	}
});

// ─── 11. alias suggestions ─────────────────────────────────────────────

run("suggestRoleAliases — typo suggests closest role", () => {
	const aliases = defaultRoleRegistry().aliases.map((s) => s.alias);
	const s = suggestRoleAliases("defualt", aliases);
	assert("suggest.typo", s.includes("default"), `got=${s.join(",")}`);
});

run("suggestRoleAliases — case-insensitive match", () => {
	const aliases = defaultRoleRegistry().aliases.map((s) => s.alias);
	const s = suggestRoleAliases("SMOL", aliases);
	assert("suggest.case", s.includes("smol"), `got=${s.join(",")}`);
});

run("suggestRoleAliases — distant input yields nothing", () => {
	const aliases = defaultRoleRegistry().aliases.map((s) => s.alias);
	assert("suggest.none", suggestRoleAliases("zzzzzzzz", aliases).length === 0);
	assert("suggest.empty", suggestRoleAliases("", aliases).length === 0);
});

// ─── 12. role cycling ───────────────────────────────────────────────────

run("normalizeCycle — keeps order, drops unknowns and duplicates", () => {
	const { cycle, dropped } = normalizeCycle(["slow", "ghost", "default", "slow", ""], ["smol", "default", "slow"]);
	assert("cycle.order", JSON.stringify(cycle) === JSON.stringify(["slow", "default"]), `got=${cycle.join(",")}`);
	assert("cycle.dropped", JSON.stringify(dropped) === JSON.stringify(["ghost", "slow"]), `got=${dropped.join(",")}`);
});

run("defaultCycle — OMP parity filtered to known aliases", () => {
	const aliases = defaultRoleRegistry().aliases.map((s) => s.alias);
	const cycle = defaultCycle(aliases);
	assert("cycle.default", JSON.stringify(cycle) === JSON.stringify(["smol", "default", "slow"]), `got=${cycle.join(",")}`);
	assert("cycle.filtered", defaultCycle(["default", "slow"]).length === 2);
});

run("stepRoleCycle — advances one resolvable step", () => {
	const step = stepRoleCycle(["smol", "default", "slow"], "default", REG, ALL_AVAILABLE);
	assert("step.ok", step.kind === "ok", `got=${JSON.stringify(step)}`);
	if (step.kind === "ok") {
		assert("step.selector", step.selector === "slow", `got=${step.selector}`);
	}
});

run("stepRoleCycle — wraps around the end", () => {
	const step = stepRoleCycle(["smol", "default", "slow"], "slow", REG, ALL_AVAILABLE);
	assert("wrap.ok", step.kind === "ok");
	if (step.kind === "ok") {
		assert("wrap.selector", step.selector === "smol", `got=${step.selector}`);
	}
});

run("stepRoleCycle — no current selector starts at the first entry", () => {
	const step = stepRoleCycle(["smol", "default", "slow"], undefined, REG, ALL_AVAILABLE);
	assert("start.ok", step.kind === "ok");
	if (step.kind === "ok") {
		assert("start.selector", step.selector === "smol", `got=${step.selector}`);
	}
});

run("stepRoleCycle — skips unavailable entries and reports them", () => {
	const onlyAnthropic = ALL_AVAILABLE.filter((m) => m.provider === "anthropic");
	const step = stepRoleCycle(["smol", "default", "slow"], "slow", REG, onlyAnthropic);
	assert("skip.ok", step.kind === "ok", `got=${JSON.stringify(step)}`);
	if (step.kind === "ok") {
		assert("skip.selector", step.selector === "default", `got=${step.selector}`);
		assert("skip.skipped", JSON.stringify(step.skipped) === JSON.stringify(["smol"]), `got=${step.skipped.join(",")}`);
	}
});

run("stepRoleCycle — single-entry cycle on itself is exhausted", () => {
	const step = stepRoleCycle(["default"], "default", REG, ALL_AVAILABLE);
	assert("self.exhausted", step.kind === "exhausted", `got=${JSON.stringify(step)}`);
});

run("stepRoleCycle — empty cycle is exhausted", () => {
	const step = stepRoleCycle([], "default", REG, ALL_AVAILABLE);
	assert("empty.exhausted", step.kind === "exhausted");
});

// ─── 13. role rendering ─────────────────────────────────────────────────

run("formatRoleEntry — active marker, thinking, tools, description", () => {
	const reg = defaultRoleRegistry();
	const vision = reg.aliases.find((s) => s.alias === "vision");
	if (!vision) throw new Error("vision missing");
	const entry = formatRoleEntry(vision, { available: true, active: true, modelName: "Claude Sonnet 4.5" });
	assert("entry.marker", entry.startsWith("▸ vision"), `got="${entry}"`);
	assert("entry.target", entry.includes("anthropic/claude-sonnet-4-5"), `got="${entry}"`);
	assert("entry.name", entry.includes("(Claude Sonnet 4.5)"), `got="${entry}"`);
	assert("entry.tools", entry.includes("tools=[read]"), `got="${entry}"`);
	assert("entry.description", entry.split("\n")[1].trim().startsWith("Sonnet restricted"), `got="${entry}"`);
});

run("formatRoleEntry — unavailable tag and inactive marker", () => {
	const reg = defaultRoleRegistry();
	const smol = reg.aliases.find((s) => s.alias === "smol");
	if (!smol) throw new Error("smol missing");
	const entry = formatRoleEntry(smol, { available: false, active: false });
	assert("entry.inactive", entry.startsWith("  smol"), `got="${entry}"`);
	assert("entry.unavailable", entry.includes("unavailable"), `got="${entry}"`);
});

run("formatRolePickerLabel — one line with description and thinking", () => {
	const reg = defaultRoleRegistry();
	const slow = reg.aliases.find((s) => s.alias === "slow");
	if (!slow) throw new Error("slow missing");
	const label = formatRolePickerLabel(slow, "Claude Opus 4.1");
	assert("label.parts", label.includes("slow") && label.includes("anthropic/claude-opus-4-1"), `got="${label}"`);
	assert("label.name", label.includes("Claude Opus 4.1"), `got="${label}"`);
	assert("label.thinking", label.includes("thinking=high"), `got="${label}"`);
	assert("label.desc", label.includes("Deep Opus"), `got="${label}"`);
	assert("label.oneline", !label.includes("\n"));
});

run("formatRolePickerLabel — truncation at maxLen", () => {
	const label = formatRolePickerLabel(
		{ alias: "a".repeat(60), provider: "p", model: "m", description: "d".repeat(80) },
		undefined,
		40,
	);
	assert("label.trunc", label.length <= 40 && label.endsWith("…"), `got=${label.length}`);
});

// ─── Report ──────────────────────────────────────────────────────────────

console.log(`\nroles.ts: ${passed} passed, ${failed} failed`);
if (failed > 0) {
	for (const f of failures.slice(0, 30)) {
		console.log(`  - ${f.name}: ${f.detail ?? ""}`);
	}
	process.exit(1);
}
