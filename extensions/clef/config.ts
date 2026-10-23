/**
 * clef — configuration for the Pi extension.
 *
 * Env-driven, off by default, exactly like the acidbath compactor. The
 * extension is a *client* of the decision service: it holds no threshold, no
 * question set and no model detail. The only thing it configures is where the
 * service is, how long to wait for it, and which hooks are armed.
 *
 * Environment:
 *   PI_CLEF_ENABLED=1          arm the extension at all (default: off)
 *   PI_CLEF_ENDPOINT           base URL of the decision service
 *                              (default: http://100.88.51.44:8802)
 *   PI_CLEF_MODEL              model name to record in the ledger
 *                              (default: clef-flash)
 *   PI_CLEF_TIMEOUT_MS         client timeout in ms (default: 1500 — the
 *                              contract says a client timeout is shorter than
 *                              the service's)
 *   PI_CLEF_FAIL_OPEN=0        when the service is unreachable, block instead
 *                              of allowing (default: on — fail open)
 *   PI_CLEF_HOOKS              comma list of armed hooks:
 *                              tool_call,tool_result,turn_end
 *                              (default: all three; "off" arms none)
 *   PI_CLEF_MAX_STATE_BYTES    hard cap on the state we send (default: 65536)
 *   PI_CLEF_COMPACT_NOTICE_PCT context usage % that triggers a notice (default 50)
 *   PI_CLEF_COMPACT_RECOMMEND_PCT context usage % that triggers a
 *                              recommendation (default 70)
 *   PI_CLEF_COMPACT_REQUEST_PCT context usage % that requests compaction
 *                              (default 85)
 *
 * No threshold lives here. The thresholds in force belong to the service and
 * are read from its reviewable prompt set, never hardcoded in a client.
 */

export interface HookConfig {
	toolCall: boolean;
	toolResult: boolean;
	turnEnd: boolean;
}

export interface CompactionConfig {
	noticePct: number;
	recommendPct: number;
	requestPct: number;
}

export interface ClefConfig {
	/** The extension is inert unless this is true. */
	enabled: boolean;
	endpoint: string;
	model: string;
	timeoutMs: number;
	failOpen: boolean;
	maxStateBytes: number;
	hooks: HookConfig;
	compaction: CompactionConfig;
}

// The decision service, not the model. The model is behind it and is never
// spoken to directly by a client (contract/decision-service.md).
export const DEFAULT_ENDPOINT = "http://100.88.51.44:8802";
export const DEFAULT_MODEL = "clef-flash";
export const DEFAULT_TIMEOUT_MS = 1500;
export const DEFAULT_MAX_STATE_BYTES = 64 * 1024;

export const ALL_HOOKS: HookConfig = { toolCall: true, toolResult: true, turnEnd: true };

export function parseBool(value: string | undefined, fallback: boolean): boolean {
	if (value === undefined) return fallback;
	const v = value.trim().toLowerCase();
	if (v === "") return fallback;
	if (["1", "true", "yes", "on"].includes(v)) return true;
	if (["0", "false", "no", "off"].includes(v)) return false;
	return fallback;
}

export function parseNumber(value: string | undefined, fallback: number): number {
	if (value === undefined) return fallback;
	const v = value.trim();
	if (v === "") return fallback;
	const n = Number(v);
	return Number.isFinite(n) ? n : fallback;
}

export function parseHooks(value: string | undefined): HookConfig {
	if (value === undefined) return { ...ALL_HOOKS };
	const raw = value.trim().toLowerCase();
	if (raw === "") return { toolCall: false, toolResult: false, turnEnd: false };
	if (raw === "off" || raw === "none") return { toolCall: false, toolResult: false, turnEnd: false };
	const parts = raw.split(",").map((p) => p.trim()).filter(Boolean);
	const hooks: HookConfig = { toolCall: false, toolResult: false, turnEnd: false };
	for (const part of parts) {
		if (part === "tool_call") hooks.toolCall = true;
		else if (part === "tool_result") hooks.toolResult = true;
		else if (part === "turn_end") hooks.turnEnd = true;
	}
	return hooks;
}

/**
 * Build the configuration from an environment map. Pure: no network, no
 * filesystem, no side effects — so a test can call it with any map.
 */
export function loadConfig(env: Record<string, string | undefined> = process.env): ClefConfig {
	return {
		enabled: parseBool(env.PI_CLEF_ENABLED, false),
		endpoint: (env.PI_CLEF_ENDPOINT && env.PI_CLEF_ENDPOINT.trim()) || DEFAULT_ENDPOINT,
		model: (env.PI_CLEF_MODEL && env.PI_CLEF_MODEL.trim()) || DEFAULT_MODEL,
		timeoutMs: parseNumber(env.PI_CLEF_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
		failOpen: parseBool(env.PI_CLEF_FAIL_OPEN, true),
		maxStateBytes: parseNumber(env.PI_CLEF_MAX_STATE_BYTES, DEFAULT_MAX_STATE_BYTES),
		hooks: parseHooks(env.PI_CLEF_HOOKS),
		compaction: {
			noticePct: parseNumber(env.PI_CLEF_COMPACT_NOTICE_PCT, 50),
			recommendPct: parseNumber(env.PI_CLEF_COMPACT_RECOMMEND_PCT, 70),
			requestPct: parseNumber(env.PI_CLEF_COMPACT_REQUEST_PCT, 85),
		},
	};
}

/** The base URL without a trailing slash, so path joining is predictable. */
export function baseUrl(config: ClefConfig): string {
	return config.endpoint.replace(/\/+$/, "");
}
