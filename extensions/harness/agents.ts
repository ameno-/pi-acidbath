/**
 * Acidbath harness — pure agent registry, result envelope, and
 * profile discovery types (PURE).
 *
 * Spec: docs/decisions/adr-0003.md
 * Beads: acidbath-9ih.3
 * Linear: MIGHT-499
 *
 * Design rules:
 *   - No Pi imports. This module is a pure function library that the
 *     Pi-coupled extension (extensions/harness/index.ts — NOT created
 *     by this module) imports to do its work.
 *   - No `as` assertions, no `any`. Strict TypeScript.
 *   - Functions never mutate the input registry; redactEnvelope /
 *     truncateOutput produce fresh values.
 *   - Default max concurrency is 4 per ADR-0003. Nested fan-out is
 *     data-only here (`allowNested: false`); the runner that actually
 *     enforces it is the Pi-coupled layer.
 *   - Project-local profiles require TUI confirmation. This module
 *     exposes the predicate; the runner renders the prompt.
 */

// ─── types ───────────────────────────────────────────────────────────────

export type CwdPolicy = "session" | "profile" | "explicit";

export type AgentSource = "builtin" | "user" | "project";

export type AgentProfile = {
	name: string;
	description: string;
	/** Role alias from the role registry (extensions/harness/roles.ts). */
	role: string;
	instructions: string;
	tools?: string[];
	cwdPolicy: CwdPolicy;
	cwd?: string;
	timeoutMs: number;
	maxOutputChars: number;
	/** Data-only here: when true, this profile may spawn its own sub-agents. */
	allowNested: boolean;
	source: AgentSource;
};

export type ResultEnvelopeError = {
	code: string;
	message: string;
	retriable?: boolean;
};

export type ResultEnvelopeUsage = {
	input: number;
	output: number;
};

export type ResultEnvelope<T = string> = {
	ok: boolean;
	output?: T;
	error?: ResultEnvelopeError;
	usage?: ResultEnvelopeUsage;
	traceId: string;
	agent: string;
	durationMs: number;
};

export type AgentRegistry = {
	version: 1;
	maxConcurrency: number;
	profiles: AgentProfile[];
};

// ─── tiny predicates ─────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function isStringArray(value: unknown): value is string[] {
	if (!Array.isArray(value)) return false;
	for (const v of value) if (typeof v !== "string") return false;
	return true;
}

function isAgentSource(value: unknown): value is AgentSource {
	return value === "builtin" || value === "user" || value === "project";
}

function isCwdPolicy(value: unknown): value is CwdPolicy {
	return value === "session" || value === "profile" || value === "explicit";
}

function isFiniteNonNegativeInt(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value >= 0;
}

function isPositiveInt(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value > 0;
}

// ─── profile parsing ─────────────────────────────────────────────────────

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

function parseProfile(raw: unknown, idx: number): AgentProfile {
	if (!isRecord(raw)) {
		throw new RangeError(`registry.profiles[${idx}] must be an object`);
	}
	const obj = raw;
	const path = `profiles[${idx}]`;

	const name = requireString(obj, "name", path);
	const description = requireString(obj, "description", path);
	const role = requireString(obj, "role", path);
	const instructions = requireString(obj, "instructions", path);
	const tools = requireOptTools(obj, path);

	const cwdPolicyRaw = obj["cwdPolicy"];
	if (!isCwdPolicy(cwdPolicyRaw)) {
		throw new RangeError(`${path}.cwdPolicy must be one of "session" | "profile" | "explicit"`);
	}
	const cwdPolicy: CwdPolicy = cwdPolicyRaw;

	const cwd = requireOptString(obj, "cwd", path);
	if (cwdPolicy === "explicit" && !cwd) {
		throw new RangeError(`${path}.cwd is required when cwdPolicy is "explicit"`);
	}
	if (cwd && cwdPolicy !== "explicit" && cwdPolicy !== "profile") {
		throw new RangeError(`${path}.cwd must only be set when cwdPolicy is "profile" or "explicit"`);
	}

	const timeoutMs = obj["timeoutMs"];
	if (!isPositiveInt(timeoutMs)) {
		throw new RangeError(`${path}.timeoutMs must be a positive integer (got ${String(timeoutMs)})`);
	}

	const maxOutputChars = obj["maxOutputChars"];
	if (!isPositiveInt(maxOutputChars)) {
		throw new RangeError(`${path}.maxOutputChars must be a positive integer (got ${String(maxOutputChars)})`);
	}

	const allowNestedRaw = obj["allowNested"];
	if (typeof allowNestedRaw !== "boolean") {
		throw new RangeError(`${path}.allowNested must be a boolean (got ${String(allowNestedRaw)})`);
	}
	const allowNested: boolean = allowNestedRaw;

	const sourceRaw = obj["source"];
	if (!isAgentSource(sourceRaw)) {
		throw new RangeError(`${path}.source must be one of "builtin" | "user" | "project"`);
	}
	const source: AgentSource = sourceRaw;

	return {
		name,
		description,
		role,
		instructions,
		...(tools !== undefined ? { tools } : {}),
		cwdPolicy,
		...(cwd !== undefined ? { cwd } : {}),
		timeoutMs,
		maxOutputChars,
		allowNested,
		source,
	};
}

// ─── registry parsing ────────────────────────────────────────────────────

const DEFAULT_MAX_CONCURRENCY = 4;

function isValidMaxConcurrency(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value >= 1;
}

/**
 * Validate and parse an agent registry from unknown input (e.g. parsed
 * JSON). Throws RangeError on any structural problem; returns a
 * registry on success. The runner treats profiles as immutable.
 */
export function parseAgentRegistry(input: unknown): AgentRegistry {
	if (!isRecord(input)) {
		throw new RangeError("agent registry must be an object");
	}
	const obj = input;
	if (obj["version"] !== 1) {
		throw new RangeError(`agent registry version must be 1 (got ${String(obj["version"])})`);
	}

	let maxConcurrency: number;
	if (!("maxConcurrency" in obj) || obj["maxConcurrency"] === undefined || obj["maxConcurrency"] === null) {
		maxConcurrency = DEFAULT_MAX_CONCURRENCY;
	} else if (!isValidMaxConcurrency(obj["maxConcurrency"])) {
		throw new RangeError(
			`agent registry maxConcurrency must be a positive integer (got ${String(obj["maxConcurrency"])})`,
		);
	} else {
		maxConcurrency = obj["maxConcurrency"];
	}

	const rawProfiles = obj["profiles"];
	if (!Array.isArray(rawProfiles)) {
		throw new RangeError("agent registry profiles must be an array");
	}
	if (rawProfiles.length === 0) {
		throw new RangeError("agent registry must include at least one profile");
	}
	const profiles: AgentProfile[] = rawProfiles.map((p, i) => parseProfile(p, i));

	const seen = new Set<string>();
	for (const p of profiles) {
		if (seen.has(p.name)) throw new RangeError(`duplicate agent profile "${p.name}"`);
		seen.add(p.name);
	}

	return { version: 1, maxConcurrency, profiles };
}

// ─── defaults ────────────────────────────────────────────────────────────

/**
 * The shipped default registry. Mirrors config/agents.example.json —
 * keep these in sync if you change one. The example file is the
 * user-facing template; this is what runtime callers fall back to when
 * no PI_ACIDBATH_AGENTS_PATH is set.
 */
export function defaultAgentRegistry(): AgentRegistry {
	return parseAgentRegistry({
		version: 1,
		maxConcurrency: 4,
		profiles: [
			{
				name: "scout",
				description: "Read-only reconnaissance agent. Finds files, grep, summarize.",
				role: "task",
				instructions:
					"You are scout. Inspect the repository with read/grep/find/ls only. Return a concise summary; no edits, no writes.",
				tools: ["read", "grep", "find", "ls"],
				cwdPolicy: "session",
				timeoutMs: 120000,
				maxOutputChars: 50000,
				allowNested: false,
				source: "builtin",
			},
			{
				name: "reviewer",
				description: "Second-opinion review agent. Read-only, advisory output.",
				role: "advisor",
				instructions:
					"You are reviewer. Read the provided context and emit a concise advisory verdict. Do not run side-effect tools.",
				tools: ["read", "grep"],
				cwdPolicy: "session",
				timeoutMs: 120000,
				maxOutputChars: 50000,
				allowNested: false,
				source: "builtin",
			},
		],
	});
}

// ─── listing / lookup ────────────────────────────────────────────────────

export type AgentScopeFilter = "builtin" | "user" | "project" | "all";

/**
 * Return the subset of profiles in `registry` whose `source` matches
 * `scope`. `"all"` returns every profile. The returned array preserves
 * the registry's original ordering. Never mutates the input.
 */
export function listAgents(
	registry: AgentRegistry,
	scope: AgentScopeFilter,
): AgentProfile[] {
	if (scope === "all") return [...registry.profiles];
	const out: AgentProfile[] = [];
	for (const p of registry.profiles) {
		if (p.source === scope) out.push(p);
	}
	return out;
}

/**
 * Look up a profile by name. Returns `undefined` when no profile with
 * that name is in the registry. Comparison is exact and case-sensitive.
 */
export function findAgent(registry: AgentRegistry, name: string): AgentProfile | undefined {
	for (const p of registry.profiles) {
		if (p.name === name) return p;
	}
	return undefined;
}

/**
 * Return true iff at least one profile in `profiles` has
 * `source === "project"`. Used by the runner to decide whether to
 * prompt for TUI confirmation before launching.
 */
export function projectAgentsRequireConfirm(profiles: readonly AgentProfile[]): boolean {
	for (const p of profiles) {
		if (p.source === "project") return true;
	}
	return false;
}

// ─── run preflight ───────────────────────────────────────────────────────

/**
 * Everything the Pi-coupled runner needs to decide *before* it touches
 * a model or a session. Keeping this pure makes the whole preflight path
 * unit-testable; the runner only performs I/O after this returns "ok".
 */
export type AgentRunPlan =
	| { ok: true; profile: AgentProfile; cwd: string }
	| { ok: false; code: RunErrorCode; message: string; needsConfirm: boolean };

export type RunErrorCode =
	| "unknown_agent"
	| "nested_not_allowed"
	| "project_confirm_required"
	| "cancelled"
	| "no_cwd";

export type RunRequest = {
	agent: string;
	cwd?: string;
	nested?: boolean;
	/** The runner's current working directory. */
	sessionCwd: string;
	/** True when the host can show a confirmation dialog. */
	canConfirm: boolean;
	/** Result of the project-source confirmation, when one was shown. */
	confirmed?: boolean;
};

/**
 * Resolve the working directory for a run under the profile's
 * `cwdPolicy`. `explicit` (a per-call override) always wins over the
 * profile's own cwd, which in turn wins over the session cwd for
 * `profile`/`session` policies. Returns `undefined` when an
 * `explicit`-policy profile has neither an override nor a configured
 * cwd — the caller must not fall back to the session cwd there, since
 * that would silently broaden the profile's blast radius.
 */
export function resolveRunCwd(
	profile: AgentProfile,
	sessionCwd: string,
	explicit: string | undefined,
): string | undefined {
	if (profile.cwdPolicy === "explicit") {
		return explicit ?? profile.cwd;
	}
	if (profile.cwdPolicy === "profile") {
		return profile.cwd ?? explicit ?? sessionCwd;
	}
	return explicit ?? sessionCwd;
}

/**
 * Pure preflight for a single agent run: unknown agent, nested-fanout
 * policy, project-source confirmation, and cwd resolution. Every
 * rejection carries a stable `code` so the runner can build an
 * envelope without duplicating the branch logic.
 */
export function planAgentRun(registry: AgentRegistry, req: RunRequest): AgentRunPlan {
	const profile = findAgent(registry, req.agent);
	if (!profile) {
		return {
			ok: false,
			code: "unknown_agent",
			message: `agent "${req.agent}" is not registered`,
			needsConfirm: false,
		};
	}

	if (!profile.allowNested && req.nested === true) {
		return {
			ok: false,
			code: "nested_not_allowed",
			message: `agent "${req.agent}" does not allow nested fan-out`,
			needsConfirm: false,
		};
	}

	// Project-sourced profiles are the one case that can still proceed,
	// but only after an explicit confirmation when the host supports it.
	let confirmed = true;
	if (profile.source === "project") {
		if (!req.canConfirm) {
			return {
				ok: false,
				code: "project_confirm_required",
				message: "project-sourced agents require TUI confirmation",
				needsConfirm: true,
			};
		}
		confirmed = req.confirmed === true;
		if (!confirmed) {
			return {
				ok: false,
				code: "cancelled",
				message: "user cancelled project agent run",
				needsConfirm: false,
			};
		}
	}

	const cwd = resolveRunCwd(profile, req.sessionCwd, req.cwd);
	if (!cwd) {
		return {
			ok: false,
			code: "no_cwd",
			message: `profile "${req.agent}" requires an explicit cwd`,
			needsConfirm: false,
		};
	}

	return { ok: true, profile, cwd };
}

/**
 * Clamp a requested `parallel[]` batch to the hard fan-out ceiling.
 * Returns the items to run plus the number that were dropped, so the
 * caller can report the truncation instead of silently shrinking the
 * batch.
 */
export function clampFanout<T>(items: readonly T[], max: number): { items: T[]; dropped: number } {
	const limit = Math.max(1, Math.floor(max));
	return { items: items.slice(0, limit), dropped: Math.max(0, items.length - limit) };
}

/**
 * Effective worker count for a parallel batch: the registry ceiling,
 * never more than the number of items, never less than one.
 */
export function fanoutConcurrency(registryMaxConcurrency: number, itemCount: number): number {
	return Math.max(1, Math.min(registryMaxConcurrency, itemCount || 1));
}

/**
 * Describe an unknown thrown value as a non-empty message.
 *
 * Several SDK rejections carry an `Error` whose `message` is an empty
 * string. Turning that into an envelope message yields a bare
 * "(no error message)" and discards the only diagnostic the runtime
 * gave us, so prefer the name/code first and only then the message.
 */
export function describeRunError(err: unknown): string {
	if (err instanceof Error) {
		const name = err.name && err.name !== "Error" ? err.name : "";
		const message = typeof err.message === "string" ? err.message.trim() : "";
		const code = "code" in err && typeof (err as { code?: unknown }).code === "string"
			? String((err as { code: string }).code).trim()
			: "";
		const parts = [name, code, message].filter((p) => p.length > 0);
		if (parts.length > 0) return parts.join(": ");
		// A genuine Error subclass with no name, code, or message. Prefer a
		// stable placeholder over "" so the envelope stays diagnosable.
		return "unknown error (Error with no message)";
	}
	if (typeof err === "string") return err.trim().length > 0 ? err.trim() : "unknown error (empty string)";
	if (err === null || err === undefined) return "unknown error (null)";
	return "unknown error (non-Error throw)";
}

// ─── run result extraction ───────────────────────────────────────────────

/** Minimal structural view of a Pi assistant message. */
export type AssistantMessageLike = {
	role: string;
	content?: unknown;
	usage?: { input?: number; output?: number };
	stopReason?: unknown;
	errorMessage?: unknown;
};

export type RunExtraction =
	| { ok: true; output: string; usage?: { input: number; output: number } }
	| { ok: false; code: string; message: string };

/**
 * Turn a finished sub-session's messages into a run result.
 *
 * A provider-side failure (expired OAuth refresh, rate limit, 5xx) does
 * not throw out of `session.prompt`: the turn lands as an assistant
 * message with `stopReason: "error"`, empty `content`, and the reason in
 * `errorMessage`. Treating that as success yields an envelope with no
 * output, which renders as an unexplained empty run. Promote it to a
 * real error envelope here so the cause reaches the caller.
 */
export function extractRunResult(
	messages: readonly AssistantMessageLike[],
	maxOutputChars: number,
): RunExtraction {
	let final: AssistantMessageLike | undefined;
	for (let i = messages.length - 1; i >= 0; i--) {
		if (messages[i]?.role === "assistant") {
			final = messages[i];
			break;
		}
	}
	if (!final) {
		return {
			ok: false,
			code: "execution_failed",
			message: "agent run produced no assistant message",
		};
	}

	const errorMessage = typeof final.errorMessage === "string" ? final.errorMessage.trim() : "";
	if (errorMessage.length > 0 || final.stopReason === "error") {
		return {
			ok: false,
			code: "execution_failed",
			message: describeRunError(
				errorMessage.length > 0 ? new Error(errorMessage) : new Error("model reported stopReason=error"),
			),
		};
	}

	const parts: string[] = [];
	if (Array.isArray(final.content)) {
		for (const part of final.content as Array<{ type?: string; text?: unknown }>) {
			if (part?.type === "text" && typeof part.text === "string") parts.push(part.text);
		}
	}
	const output = truncateOutput(parts.join("\n"), maxOutputChars);
	const input = final.usage?.input;
	const outputTokens = final.usage?.output;
	const usage =
		typeof input === "number" && typeof outputTokens === "number"
			? { input, output: outputTokens }
			: undefined;
	return usage ? { ok: true, output, usage } : { ok: true, output };
}

// ─── envelope builders ───────────────────────────────────────────────────

/**
 * Build a successful result envelope. `usage` is optional; when
 * omitted it is left undefined. Returns a fresh object — no aliasing
 * of the input.
 */
export function okEnvelope(input: {
	output: string;
	traceId: string;
	agent: string;
	durationMs: number;
	usage?: ResultEnvelopeUsage;
}): ResultEnvelope {
	const env: ResultEnvelope = {
		ok: true,
		output: input.output,
		traceId: input.traceId,
		agent: input.agent,
		durationMs: input.durationMs,
	};
	if (input.usage !== undefined) env.usage = { input: input.usage.input, output: input.usage.output };
	return env;
}

/**
 * Build a failed result envelope. `retriable` is optional. The error
 * shape is always present; `output` is left undefined. Returns a fresh
 * object.
 */
export function errEnvelope(input: {
	code: string;
	message: string;
	traceId: string;
	agent: string;
	durationMs: number;
	retriable?: boolean;
}): ResultEnvelope {
	const error: ResultEnvelopeError = { code: input.code, message: input.message };
	if (input.retriable !== undefined) error.retriable = input.retriable;
	const env: ResultEnvelope = {
		ok: false,
		error,
		traceId: input.traceId,
		agent: input.agent,
		durationMs: input.durationMs,
	};
	return env;
}

// ─── secret redaction ────────────────────────────────────────────────────

/**
 * Redact well-known secret patterns from a string:
 *   - OpenAI-style `sk-...` keys, including `sk-ant-api03-...`
 *   - Anthropic OAuth access tokens (`sk-ant-oat01-...`)
 *   - AWS access key ids (`AKIA` / `ASIA` + 16 uppercase alphanumerics)
 *   - GitHub tokens (`ghp_`, `gho_`, `ghu_`, `ghs_`, `ghr_`, `github_pat_`)
 *   - Google API keys (`AIza` + 35 characters)
 *   - Slack tokens `xox[bpars]-...`
 *   - HTTP `Authorization: Bearer ...` values
 *   - `key`/`token`/`secret`/`password` assignments in `name=value`,
 *     `name: value`, and JSON `"name": "value"` shapes
 *
 * Each match is replaced by `***REDACTED***`. The surrounding text is
 * preserved so log readers keep the original structure, and every
 * pattern is anchored so ordinary prose is not corrupted (`task-item`
 * must survive; only a real `sk-` key is redacted).
 */
const REDACTED = "***REDACTED***";

const SK_RE = /\bsk-(?:ant-(?:api|oat)\d{2}-)?(?:(?:proj|svcacct|live|test)-)?[A-Za-z0-9_-]{12,}\b/g;
const AWS_RE = /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g;
const GITHUB_RE = /\b(?:gh[pousr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{20,})\b/g;
const GOOGLE_RE = /\bAIza[A-Za-z0-9_-]{35}\b/g;
const XOX_RE = /\bxox[bpars]-[A-Za-z0-9-]{8,}\b/g;
const BEARER_RE = /(Bearer\s+)[A-Za-z0-9._\-+/=]{8,}/gi;
// Assignment-shaped secrets: name (optional quotes) [:=] (optional quotes) value.
// The name must contain a secret-ish token (key/token/secret/…) OR be a
// declared credential-name prefix (`sid`, `sig`, `auth`, …), so ordinary
// prose ("the token limit") is never rewritten.
const SECRET_NAME_RE = "[A-Za-z0-9_.-]*(?:key|token|secret|password|passwd|credential|auth|session|signature|sid|sig|sessionid)[A-Za-z0-9_.-]*";
const ASSIGN_RE =
	new RegExp(`(${SECRET_NAME_RE}"?\\s*[:=]\\s*"?)((?![A-Za-z0-9_]*REDACTED)[A-Za-z0-9._\\-+/=]{8,})`, "gi");

function redactString(input: string): string {
	let out = input.replace(SK_RE, () => REDACTED);
	out = out.replace(AWS_RE, () => REDACTED);
	out = out.replace(GITHUB_RE, () => REDACTED);
	out = out.replace(GOOGLE_RE, () => REDACTED);
	out = out.replace(XOX_RE, () => REDACTED);
	out = out.replace(ASSIGN_RE, (_match, prefix: string) => `${prefix}${REDACTED}`);
	out = out.replace(BEARER_RE, (_match, prefix: string) => `${prefix}${REDACTED}`);
	return out;
}

/**
 * Return a fresh envelope with secrets redacted from `error.message`
 * (when present) and `output` (when present). The envelope's `ok`,
 * `agent`, `durationMs`, `traceId`, `error.code`, `error.retriable`,
 * and `usage` are passed through unchanged. The input envelope is not
 * mutated.
 */
export function redactEnvelope(env: ResultEnvelope): ResultEnvelope {
	const out: ResultEnvelope = {
		ok: env.ok,
		traceId: env.traceId,
		agent: env.agent,
		durationMs: env.durationMs,
	};
	if (env.output !== undefined) out.output = redactString(env.output);
	if (env.error !== undefined) {
		out.error = {
			code: env.error.code,
			message: redactString(env.error.message),
		};
		if (env.error.retriable !== undefined) out.error.retriable = env.error.retriable;
	}
	if (env.usage !== undefined) out.usage = { input: env.usage.input, output: env.usage.output };
	return out;
}

// ─── output truncation ───────────────────────────────────────────────────

/**
 * Truncate `text` so its UTF-16 code-unit length is at most `maxChars`.
 * When truncation occurs, the omitted portion is summarized as
 * `\n\n[...<N> chars omitted...]\n` where `<N>` is the number of code
 * units removed. The summary marker itself is always shorter than the
 * available budget. `maxChars <= 0` returns "" (defensive).
 */
export function truncateOutput(text: string, maxChars: number): string {
	if (maxChars <= 0) return "";
	if (text.length <= maxChars) return text;
	const omit = text.length - maxChars;
	// Reserve room for the marker; if maxChars is absurdly small, fall
	// back to a hard cut so the marker always fits.
	const marker = `\n\n[...${omit} chars omitted...]\n`;
	if (maxChars <= marker.length) return text.slice(0, maxChars);
	const head = maxChars - marker.length;
	return text.slice(0, head) + marker;
}
