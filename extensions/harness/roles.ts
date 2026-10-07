/**
 * Acidbath harness — explicit model-role registry and resolver (PURE).
 *
 * Spec: docs/decisions/adr-0002.md
 * Beads: acidbath-9ih.2
 * Linear: MIGHT-496
 *
 * Design rules:
 *   - No Pi imports. This module is a pure function library that the
 *     Pi-coupled extension (extensions/harness/index.ts — NOT created
 *     by this module) imports to do its work.
 *   - No `as` assertions, no `any`. Strict TypeScript.
 *   - Functions never mutate the input registry. Spec copies returned
 *     from applyThinkingOverride are fresh objects.
 *   - Resolution is total: every branch returns a `RoleResolution` so
 *     callers can render a notify string for every outcome.
 *
 * Algorithm (resolveRole):
 *   1. Parse selector (alias + optional thinking override).
 *   2. Resolve alias → spec via registry. Follow optional `ref` chain;
 *      detect cycles.
 *   3. If scoped list is non-empty and contains the spec's
 *      provider/id, prefer the scoped hit (kind="exact" with the
 *      original spec; scoped list is metadata, not a replacement).
 *   4. If alias resolved and provider/id is in available (or scoped),
 *      return kind="exact" with the spec (thinking override applied).
 *   5. Else walk registry.fallback in order. First alias whose
 *      provider/id is available (or scoped) returns kind="fallback".
 *   6. Else return kind="error".
 */

// ─── types ───────────────────────────────────────────────────────────────

export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export type RoleSpec = {
	alias: string;
	/** Required when no `ref`/`modelRef`; omitted (or left undefined) when inheriting. */
	provider?: string;
	/** Required when no `ref`/`modelRef`; omitted (or left undefined) when inheriting. */
	model?: string;
	/**
	 * Free-text reference to a provider-exposed model, resolved against
	 * the live catalog at use time — `"Opus"`, `"claude-haiku-4.5"`,
	 * `"5-nano"`. Use enough of the name or id to be unambiguous; Match
	 * against ids first, then human names. Exactly one of
	 * provider+model / modelRef / ref must be set.
	 */
	modelRef?: string;
	thinkingLevel?: ThinkingLevel;
	tools?: string[];
	/** Inherit model+thinking+tools from another alias in the same registry. */
	ref?: string;
	description: string;
};

/** RoleSpec narrowed to a resolvable form whichever way it resolves. */
export type ConcreteRoleSpec = RoleSpec & { provider: string; model: string };

function isConcrete(spec: RoleSpec): spec is ConcreteRoleSpec {
	return typeof spec.provider === "string" && spec.provider.length > 0 &&
		typeof spec.model === "string" && spec.model.length > 0;
}

/**
 * True when the spec does not itself pin provider+model but can still
 * resolve at use time (a `modelRef` or a `ref` chain).
 */
function isResolvableLater(spec: RoleSpec): boolean {
	return !isConcrete(spec) && ((typeof spec.modelRef === "string" && spec.modelRef.length > 0) || typeof spec.ref === "string");
}

/**
 * True when a spec has been bound far enough to test against the
 * catalog: pinned, or already carrying provider/model from a
 * successful modelRef match.
 */
function isConcreteResolvable(
	spec: RoleSpec,
): spec is RoleSpec & { provider: string; model: string } {
	return typeof spec.provider === "string" && spec.provider.length > 0 &&
		typeof spec.model === "string" && spec.model.length > 0;
}

export type RoleRegistry = {
	version: 1;
	aliases: RoleSpec[];
	/** Ordered fallback chain. Each entry must be an alias in `aliases`. */
	fallback: string[];
};

export type RoleSnapshot = {
	modelProvider?: string;
	modelId?: string;
	thinkingLevel: ThinkingLevel;
	tools: string[];
};

export type RoleResolution =
	| { kind: "exact"; spec: RoleSpec }
	| { kind: "inherited"; spec: RoleSpec; via: string }
	| { kind: "fallback"; spec: RoleSpec; missing: string }
	| {
			kind: "error";
			reason: "unknown-role" | "cycle" | "unavailable" | "no-fallback" | "ambiguous-model-ref" | "unresolvable-model-ref";
			missing: string;
			message: string;
	  };

// ─── selector parsing ────────────────────────────────────────────────────

const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
type ThinkingLevelTuple = typeof THINKING_LEVELS;

export type RoleSelector = { alias: string; thinkingLevel?: ThinkingLevel };

/**
 * Parse a role selector string. Accepted forms:
 *   "smol"           → { alias: "smol" }
 *   "@smol"          → { alias: "smol" }    (the "@" is stripped)
 *   "smol:high"      → { alias: "smol", thinkingLevel: "high" }
 *   "@default:low"   → { alias: "default", thinkingLevel: "low" }
 *
 * Invalid thinking suffix throws RangeError. Empty / whitespace input
 * throws RangeError.
 */
export function parseRoleSelector(input: string): RoleSelector {
	if (typeof input !== "string") throw new RangeError("role selector must be a string");
	const trimmed = input.trim();
	if (!trimmed) throw new RangeError("role selector must be non-empty");

	const body = trimmed.startsWith("@") ? trimmed.slice(1) : trimmed;
	if (!body) throw new RangeError("role selector must include an alias after '@'");

	const colonIdx = body.indexOf(":");
	if (colonIdx === -1) {
		return { alias: body };
	}
	const alias = body.slice(0, colonIdx);
	const suffix = body.slice(colonIdx + 1);
	if (!alias) throw new RangeError(`role selector "${input}" missing alias before ':'`);
	if (!suffix) throw new RangeError(`role selector "${input}" missing thinking suffix after ':'`);
	if (suffix.includes(":")) throw new RangeError(`role selector "${input}" has multiple ':' suffixes`);
	const level = parseThinkingSuffix(suffix, input);
	return { alias, thinkingLevel: level };
}

/** Look up a thinking-level suffix string; throws on invalid. Narrows to ThinkingLevel. */
function parseThinkingSuffix(suffix: string, original: string): ThinkingLevel {
	for (const lvl of THINKING_LEVELS) {
		if (lvl === suffix) return lvl;
	}
	throw new RangeError(
		`role selector "${original}" has invalid thinking level "${suffix}"; expected one of ${THINKING_LEVELS.join(", ")}`,
	);
}

// ─── registry parsing + validation ───────────────────────────────────────

export function isThinkingLevel(value: unknown): value is ThinkingLevel {
	if (typeof value !== "string") return false;
	for (const lvl of THINKING_LEVELS) {
		if (lvl === value) return true;
	}
	return false;
}

function isStringArray(value: unknown): value is string[] {
	if (!Array.isArray(value)) return false;
	for (const v of value) if (typeof v !== "string") return false;
	return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function requireString(obj: Record<string, unknown>, key: string, path: string): string {
	const v = obj[key];
	if (typeof v !== "string" || !v) throw new RangeError(`${path}.${key} must be a non-empty string`);
	return v;
}

function requireOptString(obj: Record<string, unknown>, key: string, path: string): string | undefined {
	if (!(key in obj)) return undefined;
	const v = obj[key];
	if (v === undefined || v === null) return undefined;
	if (typeof v !== "string" || !v) throw new RangeError(`${path}.${key} must be a non-empty string when present`);
	return v;
}

function requireOptTools(obj: Record<string, unknown>, path: string): string[] | undefined {
	if (!("tools" in obj)) return undefined;
	const v = obj["tools"];
	if (v === undefined || v === null) return undefined;
	if (!isStringArray(v)) throw new RangeError(`${path}.tools must be an array of strings when present`);
	return v;
}

function parseRoleSpec(raw: unknown, idx: number): RoleSpec {
	if (!isRecord(raw)) {
		throw new RangeError(`registry.aliases[${idx}] must be an object`);
	}
	const obj = raw;
	const path = `aliases[${idx}]`;
	const alias = requireString(obj, "alias", path);
	const description = requireString(obj, "description", path);
	const provider = requireOptString(obj, "provider", path);
	const model = requireOptString(obj, "model", path);
	const ref = requireOptString(obj, "ref", path);
	const modelRef = requireOptString(obj, "modelRef", path);
	const tools = requireOptTools(obj, path);

	let thinkingLevel: ThinkingLevel | undefined;
	if ("thinkingLevel" in obj) {
		const v = obj["thinkingLevel"];
		if (v === undefined || v === null) {
			thinkingLevel = undefined;
		} else if (!isThinkingLevel(v)) {
			throw new RangeError(
				`${path}.thinkingLevel must be one of ${THINKING_LEVELS.join(", ")} when present`,
			);
		} else {
			thinkingLevel = v;
		}
	}

	// Exactly one binding form.
	const forms = [
		Boolean(ref), // inherit from another alias
		Boolean(provider && model), // pin provider + model explicitly
		Boolean(modelRef), // resolve a provider-exposed model ref at use time
	];
	if (forms.filter(Boolean).length > 1) {
		throw new RangeError(`${path}: set exactly one of ref, provider+model, or modelRef`);
	}
	if (!ref && !modelRef && (!provider || !model)) {
		throw new RangeError(
			`${path}: non-ref roles must set provider+model or a modelRef (partial provider/model with neither is not accepted)`,
		);
	}
	if (ref && (provider || model)) {
		throw new RangeError(`${path}: ref roles must not also set provider or model`);
	}
	if (modelRef && (provider || model)) {
		throw new RangeError(`${path}: modelRef roles must not set provider or model`);
	}

	return { alias, description, ref, provider, model, modelRef, thinkingLevel, tools };
}

/**
 * Validate and parse a role registry from unknown input (e.g. parsed JSON).
 * Throws RangeError on any structural problem; returns a frozen-shape
 * registry on success.
 */
export function parseRoleRegistry(input: unknown): RoleRegistry {
	if (!isRecord(input)) {
		throw new RangeError("role registry must be an object");
	}
	const obj = input;
	if (obj["version"] !== 1) throw new RangeError(`role registry version must be 1 (got ${String(obj["version"])})`);

	const rawAliases = obj["aliases"];
	if (!Array.isArray(rawAliases) || rawAliases.length === 0) {
		throw new RangeError("role registry must include a non-empty aliases array");
	}
	const aliases: RoleSpec[] = rawAliases.map((a, i) => parseRoleSpec(a, i));

	const seen = new Set<string>();
	for (const spec of aliases) {
		if (seen.has(spec.alias)) throw new RangeError(`duplicate role alias "${spec.alias}"`);
		seen.add(spec.alias);
	}
	for (const spec of aliases) {
		if (spec.ref && !seen.has(spec.ref)) {
			throw new RangeError(`role "${spec.alias}" references unknown alias "${spec.ref}"`);
		}
	}

	const rawFallback = obj["fallback"];
	if (!Array.isArray(rawFallback)) throw new RangeError("role registry fallback must be an array");
	if (!isStringArray(rawFallback)) throw new RangeError("role registry fallback must be string[]");
	for (const f of rawFallback) {
		if (!seen.has(f)) throw new RangeError(`fallback entry "${f}" is not a known alias`);
	}

	return { version: 1, aliases, fallback: rawFallback };
}

// ─── defaults ────────────────────────────────────────────────────────────

/**
 * The shipped default registry. Mirrors config/roles.example.json — keep
 * these in sync if you change one. The example file is the user-facing
 * template; this is what runtime callers fall back to when no
 * PI_ACIDBATH_ROLES_PATH is set.
 */
/** Add or replace a concrete role. Does not mutate the input registry. */
export function upsertRole(registry: RoleRegistry, spec: RoleSpec): RoleRegistry {
	const aliases = registry.aliases.some((alias) => alias.alias === spec.alias)
		? registry.aliases.map((alias) => alias.alias === spec.alias ? spec : alias)
		: [...registry.aliases, spec];
	return parseRoleRegistry({ version: 1, aliases, fallback: registry.fallback });
}

/** Remove a role that is not referenced by another role. Does not mutate the input registry. */
export function removeRole(registry: RoleRegistry, alias: string): RoleRegistry {
	if (!registry.aliases.some((spec) => spec.alias === alias)) {
		throw new RangeError(`role "${alias}" does not exist`);
	}
	if (registry.aliases.some((spec) => spec.ref === alias)) {
		throw new RangeError(`role "${alias}" is referenced by another role`);
	}
	const aliases = registry.aliases.filter((spec) => spec.alias !== alias);
	if (aliases.length === 0) throw new RangeError("cannot remove the last role");
	return parseRoleRegistry({
		version: 1,
		aliases,
		fallback: registry.fallback.filter((name) => name !== alias),
	});
}

export function defaultRoleRegistry(): RoleRegistry {
	return parseRoleRegistry({
		version: 1,
		aliases: [
			{
				alias: "default",
				modelRef: "Sonnet",
				thinkingLevel: "medium",
				description: "Whichever Sonnet the provider catalog exposes.",
			},
			{
				alias: "compact",
				modelRef: "Haiku",
				thinkingLevel: "low",
				description: "Compact Haiku for low-stakes turns.",
			},
			{
				alias: "smol",
				modelRef: "GPT-5 mini",
				thinkingLevel: "minimal",
				description: "Cheap, fast mini model for trivial turns.",
			},
			{
				alias: "slow",
				modelRef: "Opus",
				thinkingLevel: "high",
				description: "Deep Opus for hard problems.",
			},
			{
				alias: "vision",
				modelRef: "Sonnet",
				tools: ["read"],
				description: "Sonnet restricted to read-only tools.",
			},
			{
				alias: "plan",
				modelRef: "Sonnet",
				thinkingLevel: "high",
				description: "Sonnet with high thinking for planning.",
			},
			{
				alias: "commit",
				modelRef: "GPT-5 mini",
				thinkingLevel: "low",
				description: "Small model for commit-message drafting.",
			},
			{
				alias: "task",
				modelRef: "Haiku",
				thinkingLevel: "low",
				description: "Haiku for subagent task runs.",
			},
			{
				alias: "advisor",
				modelRef: "Opus",
				thinkingLevel: "high",
				description: "Opus for advisory / second-opinion prompts.",
			},
			{
				alias: "tiny",
				modelRef: "nano",
				thinkingLevel: "off",
				description: "Cheapest possible model — last-resort fallback.",
			},
		],
		fallback: ["default", "tiny"],
	});
}

// ─── spec helpers ────────────────────────────────────────────────────────

/**
 * Return a copy of `spec` with the given thinking level applied. Never
 * mutates the input. Undefined override → copy unchanged.
 */
export function applyThinkingOverride(spec: RoleSpec, thinkingLevel?: ThinkingLevel): RoleSpec {
	const base = {
		alias: spec.alias,
		provider: spec.provider,
		model: spec.model,
		modelRef: spec.modelRef,
		thinkingLevel: spec.thinkingLevel,
		tools: spec.tools === undefined ? undefined : [...spec.tools],
		ref: spec.ref,
		description: spec.description,
	};
	if (thinkingLevel === undefined) return base;
	return { ...base, thinkingLevel };
}

function aliasIndex(registry: RoleRegistry): Map<string, RoleSpec> {
	const m = new Map<string, RoleSpec>();
	for (const spec of registry.aliases) m.set(spec.alias, spec);
	return m;
}

function isAvailable(
	provider: string,
	model: string,
	available: ReadonlyArray<{ provider: string; id: string }>,
): boolean {
	for (const m of available) if (m.provider === provider && m.id === model) return true;
	return false;
}

/**
 * Match a free-text `modelRef` against the live catalog.
 *
 * Search order mirrors the catalog browser (`searchModelInfos`), so
 * `"Opus"` behaves in a registry exactly as it does in `/role models
 * Opus`: exact id, then id-prefix, then full `provider/id` prefix, then
 * substring, then human-name hits.
 *
 * The ref intentionally has no provider component — `Opus` means
 * whatever model Pi currently calls "Opus" regardless of which provider
 * exposes it, which is what makes the reference survive provider swaps.
 *
 * Returns `undefined` when nothing matches. Returns `ambiguous` when
 * several distinct models match with equal strength: a registry role
 * must be deterministic, so the caller is asked to disambiguate rather
 * than silently getting whichever the catalog happened to list first.
 */
export type ModelRefMatch =
	| { kind: "ok"; provider: string; id: string }
	| { kind: "ambiguous"; candidates: Array<{ provider: string; id: string }>; message: string }
	| { kind: "missing"; message: string };

export function matchModelRef(
	query: string,
	catalog: ReadonlyArray<{ provider: string; id: string; name?: string }>,
): ModelRefMatch {
	const q = query.trim().toLowerCase();
	if (!q) return { kind: "missing", message: "modelRef must be a non-empty model name or id fragment" };

	let best = Number.POSITIVE_INFINITY;
	let hits: Array<{ provider: string; id: string; score: number }> = [];
	for (const m of catalog) {
		const id = m.id.toLowerCase();
		const name = (m.name ?? "").toLowerCase();
		let score: number;
		if (id === q) score = 0;
		else if (id.startsWith(q)) score = 1;
		else if (name === q) score = 2;
		else if (name.startsWith(q)) score = 3;
		else if (id.includes(q)) score = 4;
		else if (name.includes(q)) score = 5;
		else continue;
		if (score < best) {
			best = score;
			hits = [{ provider: m.provider, id: m.id, score }];
		} else if (score === best) {
			hits.push({ provider: m.provider, id: m.id, score });
		}
	}

	if (hits.length === 0) {
		return { kind: "missing", message: `no catalog model matches "${query}"` };
	}
	if (hits.length > 1) {
		const shown = hits.slice(0, 5).map((h) => `${h.provider}/${h.id}`);
		const more = hits.length > 5 ? ` (+${hits.length - 5} more)` : "";
		return {
			kind: "ambiguous",
			candidates: hits.map((h) => ({ provider: h.provider, id: h.id })),
			message: `modelRef "${query}" matches ${hits.length} models; name it more precisely: ${shown.join(", ")}${more}`,
		};
	}
	return { kind: "ok", provider: hits[0].provider, id: hits[0].id };
}

// ─── resolver ────────────────────────────────────────────────────────────

/**
 * Resolve a selector to a concrete model spec using the registry, the
 * list of currently-available models, and an optional scoped override.
 *
 * Behaviour:
 *   - If `scoped` is non-empty and contains (provider,id) matching the
 *     selected spec, resolution succeeds with kind="exact" (or
 *     "inherited"). The scoped list is a positive check; the original
 *     spec from the registry is returned (so `via` chains remain
 *     observable).
 *   - If the requested alias is known but its provider/id is not in
 *     `available` AND `scoped` is empty (or doesn't match), the
 *     resolver walks `registry.fallback` in order. First hit wins.
 *   - "no-fallback" fires when the alias is unavailable AND fallback
 *     is empty (or its entries are also unavailable).
 */
export function resolveRole(
	selector: string,
	registry: RoleRegistry,
	available: ReadonlyArray<{ provider: string; id: string; name?: string }>,
	options?: { scoped?: ReadonlyArray<{ provider: string; id: string }> },
): RoleResolution {
	const parsed = parseRoleSelector(selector);
	const index = aliasIndex(registry);
	const spec = index.get(parsed.alias);
	if (!spec) {
		return {
			kind: "error",
			reason: "unknown-role",
			missing: parsed.alias,
			message: `role alias "${parsed.alias}" is not in the registry`,
		};
	}

	// Cycle-safe ref walk. Returns the concrete (non-ref) spec plus the
	// chain of aliases traversed (for the "via" field).
	const walked = walkRef(parsed.alias, registry, index);
	if (walked.kind === "cycle") {
		return {
			kind: "error",
			reason: "cycle",
			missing: parsed.alias,
			message: `role chain through "${parsed.alias}" contains a cycle`,
		};
	}
	let concrete = walked.spec;
	const via = walked.via;

	// A modelRef role binds to a catalog model at use time. It needs the
	// catalog to resolve, and ambiguous or missing refs fail closed
	// rather than silently picking whichever model the catalog listed
	// first — a role named "Opus" that lands on random mid-tier models
	// would poison trust in the whole mechanism.
	//
	// A ref that fails to bind falls through to the fallback chain (same
	// as any other unavailable spec); if no fallback satisfies, the
	// resolution errors with the unresolvable-ref reason so the user
	// sees *why* the role is dead rather than a generic "unavailable".
	let refBind: { kind: "missing" | "ambiguous"; message: string } | undefined;
	if (!isConcrete(concrete) && typeof concrete.modelRef === "string" && concrete.modelRef.length > 0) {
		const m = matchModelRef(concrete.modelRef, available);
		if (m.kind === "missing") {
			refBind = { kind: "missing", message: `role "${parsed.alias}" modelRef "${concrete.modelRef}" unavailable: ${m.message}` };
		} else if (m.kind === "ambiguous") {
			refBind = { kind: "ambiguous", message: `role "${parsed.alias}" modelRef "${concrete.modelRef}": ${m.message}` };
		} else {
			concrete = { ...concrete, provider: m.provider, model: m.id };
		}
	}

	const scoped = options?.scoped ?? [];
	const availOk = isConcreteResolvable(concrete) &&
		isAvailable(concrete.provider, concrete.model, scoped.length > 0 ? scoped : available);

	if (availOk) {
		// isConcreteResolvable already proved provider+model are strings.
		const bound = concrete as RoleSpec & { provider: string; model: string };
		const specOut = applyThinkingOverride(bound, parsed.thinkingLevel);
		if (via.length > 0) {
			return { kind: "inherited", spec: specOut, via: via.join(" → ") };
		}
		return { kind: "exact", spec: specOut };
	}

	// Fallback walk
	for (const fallbackAlias of registry.fallback) {
		if (fallbackAlias === parsed.alias) continue; // skip self
		const fbSpec = index.get(fallbackAlias);
		if (!fbSpec) continue;
		const fbWalked = walkRef(fallbackAlias, registry, index);
		if (fbWalked.kind === "cycle") continue;
		let fbConcrete = fbWalked.spec;
		// A modelRef fallback binds against the catalog too; an ambiguous
		// or missing ref simply drops it from the chain rather than
		// rejecting the whole resolution.
		if (!isConcrete(fbConcrete) && typeof fbConcrete.modelRef === "string" && fbConcrete.modelRef.length > 0) {
			const fm = matchModelRef(fbConcrete.modelRef, available);
			if (fm.kind !== "ok") continue;
			fbConcrete = { ...fbConcrete, provider: fm.provider, model: fm.id };
		}
		const fbScopedOk = isConcreteResolvable(fbConcrete) &&
			isAvailable(fbConcrete.provider, fbConcrete.model, scoped.length > 0 ? scoped : available);
		if (fbScopedOk) {
			const fbBound = fbConcrete as RoleSpec & { provider: string; model: string };
			const fbSpecOut = fbWalked.via.length > 0 ? { ...fbBound } : fbBound;
			return { kind: "fallback", spec: applyThinkingOverride(fbSpecOut, parsed.thinkingLevel), missing: parsed.alias };
		}
	}

	// No fallback satisfied the run. Report the most precise reason:
	// a failed modelRef bind beats no-fallback/unavailable because it
	// explains WHY the role can't be used.
	if (refBind) {
		return {
			kind: "error",
			reason: refBind.kind === "ambiguous" ? "ambiguous-model-ref" : "unresolvable-model-ref",
			missing: parsed.alias,
			message: refBind.message,
		};
	}
	if (registry.fallback.length === 0) {
		return {
			kind: "error",
			reason: "no-fallback",
			missing: parsed.alias,
			message: `role "${parsed.alias}" is unavailable and registry defines no fallback`,
		};
	}

	return {
		kind: "error",
		reason: "unavailable",
		missing: parsed.alias,
		message: `role "${parsed.alias}" is unavailable and no fallback in [${registry.fallback.join(", ")}] is reachable`,
	};
}

type WalkResult =
	| { kind: "ok"; spec: RoleSpec; via: string[] }
	| { kind: "cycle" };

/**
 * Walk the optional `ref` chain starting at `alias`. Returns the
 * final non-ref spec (which may still carry a `modelRef` to bind
 * against the catalog), plus the ordered list of intermediate aliases
 * (empty when the alias itself is non-ref). A chain that ends at a
 * spec with no binding at all is a cycle — it can't resolve.
 */
function walkRef(alias: string, registry: RoleRegistry, index: Map<string, RoleSpec>): WalkResult {
	const visited = new Set<string>();
	const via: string[] = [];
	let current: string | undefined = alias;
	while (current !== undefined) {
		if (visited.has(current)) return { kind: "cycle" };
		visited.add(current);
		const spec = index.get(current);
		if (!spec) return { kind: "cycle" }; // unknown mid-chain; treat as cycle
		if (!spec.ref) {
			// No ref: a pinned provider/model or a modelRef — either way the
			// caller may still need to bind it against the catalog, so hand
			// the full spec back rather than demanding isConcrete().
			return { kind: "ok", spec, via };
		}
		via.push(current);
		current = spec.ref;
	}
	// Shouldn't reach here, but keep TS happy.
	return { kind: "cycle" };
}

// ─── describeResolution ──────────────────────────────────────────────────

/**
 * Human-readable description of a resolution. The Pi-coupled caller
 * passes this to its notify hook; every resolution branch has a string.
 */
export function describeResolution(resolution: RoleResolution): string {
	switch (resolution.kind) {
		case "exact":
			return `role ${resolution.spec.alias}: ${resolution.spec.provider}/${resolution.spec.model} (thinking=${resolution.spec.thinkingLevel ?? "default"})`;
		case "inherited":
			return `role ${resolution.spec.alias} (via ${resolution.via}): ${resolution.spec.provider}/${resolution.spec.model} (thinking=${resolution.spec.thinkingLevel ?? "default"})`;
		case "fallback":
			return `role "${resolution.missing}" unavailable, falling back to ${resolution.spec.alias}: ${resolution.spec.provider}/${resolution.spec.model}`;
		case "error":
			return `role error (${resolution.reason}): ${resolution.message}`;
	}
}

// ─── model catalog (PURE) ────────────────────────────────────────────────

/**
 * Metadata for one available model, decoupled from Pi's Model type so
 * this module stays import-free and unit-testable. The Pi-coupled glue
 * fills these from `ctx.modelRegistry`.
 */
export type ModelInfo = {
	provider: string;
	id: string;
	/** Human-readable model name; falls back to the id when absent. */
	name?: string;
	contextWindow?: number;
	maxTokens?: number;
	/** Whether the model supports reasoning/thinking levels. */
	reasoning?: boolean;
	/** Whether the model accepts image input. */
	vision?: boolean;
	/** USD per million input tokens. */
	costIn?: number;
	/** USD per million output tokens. */
	costOut?: number;
};

/** Format a token count the way `pi models` does (200000 → "200K"). */
export function formatTokenCount(count: number): string {
	if (!Number.isFinite(count) || count <= 0) return "?";
	if (count >= 1_000_000) {
		const millions = count / 1_000_000;
		return millions % 1 === 0 ? `${millions}M` : `${millions.toFixed(1)}M`;
	}
	if (count >= 1_000) {
		const thousands = count / 1_000;
		return thousands % 1 === 0 ? `${thousands}K` : `${thousands.toFixed(1)}K`;
	}
	return String(count);
}

function formatUsd(value: number): string {
	if (value <= 0) return "$0";
	if (value < 0.1) return `$${value.toFixed(4).replace(/0+$/, "")}`;
	return `$${value.toFixed(2)}`;
}

/**
 * Cost summary per million tokens. Zero/absent rates mean the catalog
 * has no pricing for the model (common for proxies and local servers),
 * so the summary says so rather than claiming "free".
 */
export function formatCostPerMtok(costIn: number, costOut: number): string {
	if (costIn <= 0 && costOut <= 0) return "cost n/a";
	return `${formatUsd(costIn)}/${formatUsd(costOut)} per Mtok`;
}

/** One-line catalog entry: `provider/id — Name — 200K ctx · $3/$15 per Mtok · reasoning · vision`. */
export function formatModelLine(info: ModelInfo): string {
	const segments: string[] = [`${info.provider}/${info.id}`];
	if (info.name && info.name !== info.id) segments.push(info.name);
	const caps: string[] = [];
	if (typeof info.contextWindow === "number" && info.contextWindow > 0) {
		caps.push(`${formatTokenCount(info.contextWindow)} ctx`);
	}
	const costIn = info.costIn ?? 0;
	const costOut = info.costOut ?? 0;
	if (costIn > 0 || costOut > 0) caps.push(formatCostPerMtok(costIn, costOut));
	if (info.reasoning) caps.push("reasoning");
	if (info.vision) caps.push("vision");
	if (caps.length > 0) segments.push(caps.join(" · "));
	return segments.join(" — ");
}

/**
 * Single-line picker label for a model (the Pi selector renders each
 * option as one line, so this must never contain newlines). Truncated
 * with an ellipsis at `maxLen`.
 */
export function formatModelPickerLabel(info: ModelInfo, maxLen = 100): string {
	const line = formatModelLine(info);
	return line.length > maxLen ? `${line.slice(0, maxLen - 1)}…` : line;
}

export type ModelSearch = { matches: ModelInfo[]; total: number };

/**
 * Case-insensitive search across provider/id/name. Exact references
 * rank first, then id-prefix hits, then full-reference prefix, then
 * substring, then name hits; ties fall back to provider/id
 * alphabetical order.
 */
export function searchModelInfos(models: ReadonlyArray<ModelInfo>, query: string): ModelSearch {
	const q = query.trim().toLowerCase();
	if (!q) return { matches: [...models], total: models.length };
	const scored: Array<{ info: ModelInfo; score: number; ref: string }> = [];
	for (const info of models) {
		const ref = `${info.provider}/${info.id}`.toLowerCase();
		const name = (info.name ?? "").toLowerCase();
		let score: number;
		if (ref === q || info.id.toLowerCase() === q) score = 0;
		else if (info.id.toLowerCase().startsWith(q)) score = 1;
		else if (ref.startsWith(q)) score = 2;
		else if (ref.includes(q)) score = 3;
		else if (name.includes(q)) score = 4;
		else continue;
		scored.push({ info, score, ref });
	}
	scored.sort((a, b) => a.score - b.score || a.ref.localeCompare(b.ref));
	return { matches: scored.map((s) => s.info), total: models.length };
}

/**
 * Thinking levels a model supports, from its optional provider-level
 * map (pi-ai `ThinkingLevelMap` shape). A `null` value marks an
 * unsupported level; absent keys and absent maps mean "all levels".
 * An all-null map is treated as unknown metadata, not an unusable
 * model.
 */
export function supportedThinkingLevels(
	map: Readonly<Partial<Record<ThinkingLevel, string | null>>> | undefined,
): ThinkingLevel[] {
	if (!map) return [...THINKING_LEVELS];
	const out: ThinkingLevel[] = [];
	for (const lvl of THINKING_LEVELS) {
		if (map[lvl] === null) continue;
		out.push(lvl);
	}
	return out.length > 0 ? out : [...THINKING_LEVELS];
}

// ─── direct model selectors ─────────────────────────────────────────────

export type DirectModelSelector = { provider: string; model: string; thinkingLevel?: ThinkingLevel };

/**
 * True when a `/role` selector is a direct `provider/model[:thinking]`
 * reference rather than a registry alias. Whitespace disqualifies: a
 * real alias never contains spaces and neither does a model ref.
 */
export function isDirectModelSelector(selector: string): boolean {
	const body = selector.trim().startsWith("@") ? selector.trim().slice(1) : selector.trim();
	return body.length > 0 && body.includes("/") && !body.includes(" ");
}

/**
 * Parse a direct model selector: `provider/model` or
 * `provider/model:thinking`. Throws RangeError on malformed input.
 */
export function parseModelSelector(input: string): DirectModelSelector {
	const trimmed = input.trim();
	const body = trimmed.startsWith("@") ? trimmed.slice(1) : trimmed;
	if (!body) throw new RangeError("model selector must be non-empty");
	if (body.includes(" ")) throw new RangeError(`model selector "${input}" must not contain spaces`);
	const colonIdx = body.indexOf(":");
	const ref = colonIdx === -1 ? body : body.slice(0, colonIdx);
	const suffix = colonIdx === -1 ? undefined : body.slice(colonIdx + 1);
	const slashIdx = ref.indexOf("/");
	if (slashIdx === -1) throw new RangeError(`model selector "${input}" must look like provider/model`);
	const provider = ref.slice(0, slashIdx);
	const model = ref.slice(slashIdx + 1);
	if (!provider) throw new RangeError(`model selector "${input}" missing provider before '/'`);
	if (!model) throw new RangeError(`model selector "${input}" missing model id after '/'`);
	if (suffix !== undefined) {
		if (!suffix) throw new RangeError(`model selector "${input}" missing thinking suffix after ':'`);
		if (suffix.includes(":")) throw new RangeError(`model selector "${input}" has multiple ':' suffixes`);
		if (!isThinkingLevel(suffix)) {
			throw new RangeError(
				`model selector "${input}" has invalid thinking level "${suffix}"; expected one of ${THINKING_LEVELS.join(", ")}`,
			);
		}
		return { provider, model, thinkingLevel: suffix };
	}
	return { provider, model };
}

// ─── alias suggestions ──────────────────────────────────────────────────

function editDistance(a: string, b: string): number {
	const aLower = a.toLowerCase();
	const bLower = b.toLowerCase();
	if (aLower === bLower) return 0;
	const prev = new Array<number>(bLower.length + 1);
	const curr = new Array<number>(bLower.length + 1);
	for (let j = 0; j <= bLower.length; j++) prev[j] = j;
	for (let i = 1; i <= aLower.length; i++) {
		curr[0] = i;
		for (let j = 1; j <= bLower.length; j++) {
			const cost = aLower[i - 1] === bLower[j - 1] ? 0 : 1;
			curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
		}
		for (let j = 0; j <= bLower.length; j++) prev[j] = curr[j];
	}
	return prev[bLower.length];
}

/** Up to `limit` closest known aliases to a mistyped name (case-insensitive). */
export function suggestRoleAliases(input: string, aliases: ReadonlyArray<string>, limit = 3): string[] {
	const target = input.trim().toLowerCase();
	if (!target) return [];
	const maxDistance = Math.max(2, Math.floor(target.length / 2));
	const scored: Array<{ alias: string; d: number }> = [];
	for (const alias of aliases) {
		const d = editDistance(target, alias.toLowerCase());
		if (d <= maxDistance) scored.push({ alias, d });
	}
	scored.sort((a, b) => a.d - b.d || a.alias.localeCompare(b.alias));
	return scored.slice(0, limit).map((s) => s.alias);
}

// ─── role cycling ───────────────────────────────────────────────────────

/** OMP-parity default cycle: cheap → balanced → deep. */
export const DEFAULT_CYCLE: readonly string[] = ["smol", "default", "slow"];

export type CycleNormalization = { cycle: string[]; dropped: string[] };

/**
 * Validate a role cycle: keep order, drop unknown and duplicate
 * aliases. Returns the kept cycle plus the dropped names (for a
 * warning notification in the glue).
 */
export function normalizeCycle(raw: ReadonlyArray<string>, aliases: ReadonlyArray<string>): CycleNormalization {
	const known = new Set<string>(aliases);
	const seen = new Set<string>();
	const cycle: string[] = [];
	const dropped: string[] = [];
	for (const entry of raw) {
		const name = entry.trim();
		if (!name) continue;
		if (!known.has(name) || seen.has(name)) {
			dropped.push(name);
			continue;
		}
		seen.add(name);
		cycle.push(name);
	}
	return { cycle, dropped };
}

/** DEFAULT_CYCLE filtered down to aliases that exist in the registry. */
export function defaultCycle(aliases: ReadonlyArray<string>): string[] {
	return normalizeCycle(DEFAULT_CYCLE, aliases).cycle;
}

export type CycleStep =
	| { kind: "ok"; selector: string; resolution: RoleResolution; skipped: string[] }
	| { kind: "exhausted"; tried: string[] };

/**
 * Advance the role cycle from the current selector to the next entry
 * whose own model resolves against the available models. Wraps around
 * the end of the cycle. Fallback resolutions do NOT count as hits:
 * cycling is a deliberate switch, and an entry whose model is down
 * would silently land somewhere the user did not ask for. Skipped
 * entries are collected so the glue can explain what happened.
 */
export function stepRoleCycle(
	cycle: ReadonlyArray<string>,
	currentSelector: string | undefined,
	registry: RoleRegistry,
	available: ReadonlyArray<{ provider: string; id: string; name?: string }>,
	options?: { scoped?: ReadonlyArray<{ provider: string; id: string }> },
): CycleStep {
	if (cycle.length === 0) return { kind: "exhausted", tried: [] };
	let currentAlias: string | undefined;
	if (currentSelector) {
		try {
			currentAlias = parseRoleSelector(currentSelector).alias;
		} catch {
			currentAlias = undefined;
		}
	}
	const startIdx = currentAlias !== undefined && cycle.includes(currentAlias) ? cycle.indexOf(currentAlias) : -1;
	const skipped: string[] = [];
	for (let offset = 1; offset <= cycle.length; offset++) {
		const idx = (startIdx + offset + cycle.length) % cycle.length;
		const alias = cycle[idx];
		if (alias === undefined) continue;
		if (alias === currentAlias) {
			if (cycle.length > 1) continue;
			skipped.push(alias);
			continue;
		}
		const resolution = resolveRole(alias, registry, available, options);
		if (resolution.kind === "exact" || resolution.kind === "inherited") {
			return { kind: "ok", selector: alias, resolution, skipped };
		}
		skipped.push(alias);
	}
	return { kind: "exhausted", tried: skipped };
}

// ─── role rendering ──────────────────────────────────────────────────────

/**
 * Two-line list entry for `/role list`. The marker prefixes the active
 * role; availability and thinking level make every entry self-describing.
 */
	/** Human target for list/picker display of a spec's binding. */
	function targetLabel(spec: RoleSpec): string {
		if (spec.provider && spec.model) return `${spec.provider}/${spec.model}`;
		if (spec.ref) return `→ ${spec.ref}`;
		if (spec.modelRef) return `~ "${spec.modelRef}" (resolved from catalog at use)`;
		return "unbound";
	}

export function formatRoleEntry(
	spec: RoleSpec,
	options: { available: boolean; active: boolean; modelName?: string },
): string {
	const marker = options.active ? "▸ " : "  ";
	const target = targetLabel(spec);
	const name = options.modelName && options.modelName !== spec.model ? ` (${options.modelName})` : "";
	const thinking = spec.thinkingLevel ? ` · thinking=${spec.thinkingLevel}` : "";
	const tools = spec.tools && spec.tools.length > 0 ? ` · tools=[${spec.tools.join(", ")}]` : "";
	const state = options.available ? "" : " · unavailable";
	return `${marker}${spec.alias} — ${target}${name}${thinking}${tools}${state}\n      ${spec.description}`;
}

/**
 * Single-line picker label for a role (Pi selector options render one
 * line each). Truncated with an ellipsis at `maxLen`.
 */
export function formatRolePickerLabel(spec: RoleSpec, modelName?: string, maxLen = 100): string {
	const bits = [spec.alias, targetLabel(spec)];
	if (modelName && modelName !== spec.model) bits.push(modelName);
	if (spec.thinkingLevel) bits.push(`thinking=${spec.thinkingLevel}`);
	const line = `${bits.join(" · ")} — ${spec.description}`;
	return line.length > maxLen ? `${line.slice(0, maxLen - 1)}…` : line;
}
