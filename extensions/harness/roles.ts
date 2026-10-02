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
	/** Required when no `ref`; omitted (or left undefined) when inheriting. */
	provider?: string;
	/** Required when no `ref`; omitted (or left undefined) when inheriting. */
	model?: string;
	thinkingLevel?: ThinkingLevel;
	tools?: string[];
	/** Inherit model+thinking+tools from another alias in the same registry. */
	ref?: string;
	description: string;
};

/** RoleSpec narrowed so provider + model are present (no ref-only). */
export type ConcreteRoleSpec = RoleSpec & { provider: string; model: string };

function isConcrete(spec: RoleSpec): spec is ConcreteRoleSpec {
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
			reason: "unknown-role" | "cycle" | "unavailable" | "no-fallback";
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

function isThinkingLevel(value: unknown): value is ThinkingLevel {
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

	if (ref && (provider || model)) {
		throw new RangeError(`${path}: ref roles must not set provider or model`);
	}
	if (!ref && (!provider || !model)) {
		throw new RangeError(`${path}: non-ref roles must set both provider and model`);
	}

	return { alias, description, ref, provider, model, thinkingLevel, tools };
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
export function defaultRoleRegistry(): RoleRegistry {
	return parseRoleRegistry({
		version: 1,
		aliases: [
			{
				alias: "default",
				provider: "anthropic",
				model: "claude-sonnet-4-5",
				thinkingLevel: "medium",
				description: "Default Sonnet with balanced thinking.",
			},
			{
				alias: "compact",
				provider: "anthropic",
				model: "claude-haiku-4-5",
				thinkingLevel: "low",
				description: "Compact Haiku for low-stakes turns.",
			},
			{
				alias: "smol",
				provider: "openai",
				model: "gpt-5-mini",
				thinkingLevel: "minimal",
				description: "Cheap, fast GPT-5 mini for trivial turns.",
			},
			{
				alias: "slow",
				provider: "anthropic",
				model: "claude-opus-4-1",
				thinkingLevel: "high",
				description: "Deep Opus for hard problems.",
			},
			{
				alias: "vision",
				provider: "anthropic",
				model: "claude-sonnet-4-5",
				tools: ["read"],
				description: "Sonnet restricted to read-only tools.",
			},
			{
				alias: "plan",
				provider: "anthropic",
				model: "claude-sonnet-4-5",
				thinkingLevel: "high",
				description: "Sonnet with high thinking for planning.",
			},
			{
				alias: "commit",
				provider: "openai",
				model: "gpt-5-mini",
				thinkingLevel: "low",
				description: "Small model for commit-message drafting.",
			},
			{
				alias: "task",
				provider: "anthropic",
				model: "claude-haiku-4-5",
				thinkingLevel: "low",
				description: "Haiku for subagent task runs.",
			},
			{
				alias: "advisor",
				provider: "anthropic",
				model: "claude-opus-4-1",
				thinkingLevel: "high",
				description: "Opus for advisory / second-opinion prompts.",
			},
			{
				alias: "tiny",
				provider: "openai",
				model: "gpt-5-nano",
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
	if (thinkingLevel === undefined) {
		return {
			alias: spec.alias,
			provider: spec.provider,
			model: spec.model,
			thinkingLevel: spec.thinkingLevel,
			tools: spec.tools === undefined ? undefined : [...spec.tools],
			ref: spec.ref,
			description: spec.description,
		};
	}
	return {
		alias: spec.alias,
		provider: spec.provider,
		model: spec.model,
		thinkingLevel,
		tools: spec.tools === undefined ? undefined : [...spec.tools],
		ref: spec.ref,
		description: spec.description,
	};
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
	available: ReadonlyArray<{ provider: string; id: string }>,
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
	const concrete = walked.spec;
	const via = walked.via;

	// Thinking override applies to the resolved spec.
	const withOverride = applyThinkingOverride(concrete, parsed.thinkingLevel);

	const scoped = options?.scoped ?? [];
	const scopedOk = scoped.length > 0 && isAvailable(concrete.provider, concrete.model, scoped);
	const availOk = isAvailable(concrete.provider, concrete.model, available);

	if (scopedOk || availOk) {
		if (via.length > 0) {
			return { kind: "inherited", spec: withOverride, via: via.join(" → ") };
		}
		return { kind: "exact", spec: withOverride };
	}

	// Fallback walk
	for (const fallbackAlias of registry.fallback) {
		if (fallbackAlias === parsed.alias) continue; // skip self
		const fbSpec = index.get(fallbackAlias);
		if (!fbSpec) continue;
		const fbWalked = walkRef(fallbackAlias, registry, index);
		if (fbWalked.kind === "cycle") continue;
		const fbConcrete = fbWalked.spec;
		const fbScopedOk = scoped.length > 0 && isAvailable(fbConcrete.provider, fbConcrete.model, scoped);
		const fbAvailOk = isAvailable(fbConcrete.provider, fbConcrete.model, available);
		if (fbScopedOk || fbAvailOk) {
			const fbSpecOut = fbWalked.via.length > 0 ? { ...fbConcrete } : fbConcrete;
			const fbWithOverride = applyThinkingOverride(fbSpecOut, parsed.thinkingLevel);
			return { kind: "fallback", spec: fbWithOverride, missing: parsed.alias };
		}
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
	| { kind: "ok"; spec: ConcreteRoleSpec; via: string[] }
	| { kind: "cycle" };

/**
 * Walk the optional `ref` chain starting at `alias`. Returns the first
 * concrete spec encountered, plus the ordered list of intermediate
 * aliases (empty when the alias itself is concrete). A chain that ends
 * at a ref-only spec, or one whose final spec lacks provider/model, is
 * reported as a cycle — it's malformed and can't be resolved.
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
			// Concrete (no ref) — provider+model must be set (parseRoleRegistry
			// enforces this on parse).
			if (isConcrete(spec)) return { kind: "ok", spec, via };
			return { kind: "cycle" };
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
