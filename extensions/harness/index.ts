/**
 * Acidbath harness extension — non-visual Pi glue.
 *
 * Wires the pure modules in this directory to Pi's ExtensionAPI:
 *   - /magic list|enable|disable    (extensions/harness/magic.ts)
 *   - /role list|set|clear|resolve  (extensions/harness/roles.ts)
 *   - /handoff [goal]               (extensions/harness/handoff.ts)
 *   - /recap [focus]                (extensions/harness/recap.ts)
 *   - /agents list|run              (extensions/harness/agents.ts)
 *   - subagent tool                 (extensions/harness/agents.ts)
 *   - session_before_compact        (extensions/harness/codex-compact.ts)
 *
 * Specs: docs/decisions/adr-0001.md … adr-0006.md
 * Beads:  acidbath-9ih integration glue
 *
 * ADR-0001: this file MUST NOT call setHeader/setFooter/setEditorComponent
 * or wrap built-in tools. Acidbath keeps UI ownership. Compactor stays
 * independent under extensions/compactor/.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { Usage } from "@earendil-works/pi-ai";
import {
	type AgentToolResult,
	type ExtensionAPI,
	type ExtensionCommandContext,
	type ExtensionContext,
	SessionManager,
	createAgentSession,
	defineTool,
	DefaultResourceLoader,
	getAgentDir,
} from "@earendil-works/pi-coding-agent";
import { Box, Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";

import {
	clampFanout,
	defaultAgentRegistry,
	describeRunError,
	errEnvelope,
	extractRunResult,
	fanoutConcurrency,
	findAgent,
	type AgentProfile,
	type AgentRegistry,
	type ResultEnvelope,
	listAgents,
	okEnvelope,
	parseAgentRegistry,
	planAgentRun,
	redactEnvelope,
} from "./agents.ts";
import {
	buildCodexCompactPrompt,
	mapCompactResult,
	sanitizeCompactError,
	shouldAttemptCodexCompact,
} from "./codex-compact.ts";
import {
	buildHandoffPrompt,
	formatHandoffDoc,
	parseHandoffMarkdown,
	selectHandoffEntries,
	serializeHandoffSource,
} from "./handoff.ts";
import {
	addMagicKeyword,
	defaultMagicRegistry,
	formatMagicHints,
	type MagicMatch,
	type MagicRegistry,
	matchMagicWords,
	parseMagicRegistry,
	removeMagicKeyword,
	setMagicKeywordEnabled,
} from "./magic.ts";
import {
	RECAP_ENTRY_TYPE,
	type RecapNote,
	buildRecapPrompt,
	formatRecapNote,
	isRecapNote,
	parseRecapMarkdown,
	selectRecapEntries,
	serializeRecapSource,
} from "./recap.ts";
import {
	type DirectModelSelector,
	defaultCycle,
	defaultRoleRegistry,
	describeResolution,
	formatModelLine,
	formatModelPickerLabel,
	formatRoleEntry,
	formatRolePickerLabel,
	isDirectModelSelector,
	isThinkingLevel,
	type ModelInfo,
	normalizeCycle,
	parseModelSelector,
	parseRoleRegistry,
	parseRoleSelector,
	removeRole,
	resolveRole,
	type RoleRegistry,
	type RoleResolution,
	type RoleSnapshot,
	type RoleSpec,
	searchModelInfos,
	stepRoleCycle,
	suggestRoleAliases,
	supportedThinkingLevels,
	type ThinkingLevel,
	upsertRole,
} from "./roles.ts";
import {
	assistantTextFromComplete,
	mapMessagesToHandoffEntries,
	mapToHandoffEntries,
	mapToRecapEntries,
} from "./session-map.ts";

// ─── constants ──────────────────────────────────────────────────────────

const MAGIC_STATE_ENTRY_TYPE = "harness-magic-state";
const ROLE_STATE_ENTRY_TYPE = "harness-role-state";
const ROLE_PICKER_MAX = 24;
const MODELS_SHOWN_MAX = 25;
/** Hard ceiling on `parallel[]` fan-out, independent of registry concurrency. */
const SUBAGENT_MAX_FANOUT = 8;
/** Extra slack after the profile timeout before a run is abandoned outright. */
const SUBAGENT_ABORT_GRACE_MS = 5_000;
const DEFAULT_HANDOFF_MAX_CHARS = 12000;
const DEFAULT_RECAP_MAX_CHARS = 12000;
const DEFAULT_HANDOFF_TIMEOUT_MS = 120_000;
const DEFAULT_RECAP_TIMEOUT_MS = 120_000;
const HANDOFF_SYSTEM_PROMPT = "You are drafting a focused session-handoff recap. Return only the requested markdown document.";
const RECAP_SYSTEM_PROMPT = "You are producing a concise session recap. Return only the requested markdown document.";

// ─── small helpers ──────────────────────────────────────────────────────

function readJsonFile(filePath: string): Promise<unknown> {
	return fs.readFile(filePath, "utf8").then((text) => JSON.parse(text));
}

function resolveRegistryPath(envName: string, defaultRelPath: string): string {
	const override = process.env[envName];
	if (typeof override === "string" && override.length > 0) return override;
	return path.resolve(process.cwd(), defaultRelPath);
}

function userConfigPath(envName: string, fileName: string): string {
	const override = process.env[envName];
	if (typeof override === "string" && override.length > 0) return override;
	return path.join(getAgentDir(), "acidbath", fileName);
}

async function fileExists(filePath: string): Promise<boolean> {
	try {
		await fs.access(filePath);
		return true;
	} catch {
		return false;
	}
}

async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
	await fs.mkdir(path.dirname(filePath), { recursive: true });
	await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function loadMagicRegistry(): Promise<MagicRegistry> {
	const userPath = userConfigPath("PI_ACIDBATH_MAGIC_PATH", "magic.json");
	if (process.env.PI_ACIDBATH_MAGIC_PATH || await fileExists(userPath)) {
		try {
			return parseMagicRegistry(await readJsonFile(userPath));
		} catch {
			if (process.env.PI_ACIDBATH_MAGIC_PATH) return defaultMagicRegistry();
		}
	}
	const filePath = resolveRegistryPath("PI_ACIDBATH_MAGIC_PATH", "config/magic.example.json");
	try {
		const raw = await readJsonFile(filePath);
		return parseMagicRegistry(raw);
	} catch {
		return defaultMagicRegistry();
	}
}

async function saveMagicRegistry(registry: MagicRegistry): Promise<string> {
	const filePath = userConfigPath("PI_ACIDBATH_MAGIC_PATH", "magic.json");
	await writeJsonFile(filePath, registry);
	return filePath;
}

type StoredRoleFile = { registry: RoleRegistry; active?: string; cycle: string[] };

function isStringArrayValue(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((v) => typeof v === "string");
}

/** Read the optional `cycle` key next to a parsed registry, defaulting to the OMP-parity cycle. */
function cycleFromFile(raw: unknown, registry: RoleRegistry): string[] {
	const aliasNames = registry.aliases.map((a) => a.alias);
	if (isRecord(raw) && isStringArrayValue(raw.cycle)) {
		return normalizeCycle(raw.cycle, aliasNames).cycle;
	}
	return defaultCycle(aliasNames);
}

/**
 * Last registry load failure, keyed by "roles" | "magic" | "agents".
 * Set when a user-edited config fails to parse so the command that
 * triggered the load can tell the user instead of quietly reverting to
 * built-in defaults.
 */
const registryLoadErrors = new Map<string, string>();

function noteRegistryLoadError(which: string, filePath: string, err: unknown): void {
	const reason = err instanceof Error ? err.message : String(err);
	registryLoadErrors.set(which, `${filePath}: ${reason}`);
}

function takeRegistryLoadError(which: string): string | undefined {
	const message = registryLoadErrors.get(which);
	if (message !== undefined) registryLoadErrors.delete(which);
	return message;
}

async function loadStoredRoles(): Promise<StoredRoleFile> {
	const userPath = userConfigPath("PI_ACIDBATH_ROLES_PATH", "roles.json");
	if (process.env.PI_ACIDBATH_ROLES_PATH || await fileExists(userPath)) {
		try {
			const raw = await readJsonFile(userPath);
			const active = isRecord(raw) && typeof raw.active === "string" ? raw.active : undefined;
			const registry = parseRoleRegistry(raw);
			return { registry, cycle: cycleFromFile(raw, registry), ...(active ? { active } : {}) };
		} catch (err) {
			// A user-edited registry that fails to parse must not be
			// swallowed: silently reverting to the defaults makes their
			// edits look ignored. Remember the reason and surface it the
			// next time the roles UI renders.
			noteRegistryLoadError("roles", userPath, err);
			const registry = defaultRoleRegistry();
			return { registry, cycle: defaultCycle(registry.aliases.map((a) => a.alias)) };
		}
	}
	const filePath = resolveRegistryPath("PI_ACIDBATH_ROLES_PATH", "config/roles.example.json");
	try {
		const raw = await readJsonFile(filePath);
		const registry = parseRoleRegistry(raw);
		return { registry, cycle: cycleFromFile(raw, registry) };
	} catch {
		const registry = defaultRoleRegistry();
		return { registry, cycle: defaultCycle(registry.aliases.map((a) => a.alias)) };
	}
}

async function loadRoleRegistry(): Promise<RoleRegistry> {
	return (await loadStoredRoles()).registry;
}

async function saveRoleRegistry(registry: RoleRegistry, active?: string, cycle?: string[]): Promise<string> {
	const filePath = userConfigPath("PI_ACIDBATH_ROLES_PATH", "roles.json");
	await writeJsonFile(filePath, {
		version: registry.version,
		aliases: registry.aliases,
		fallback: registry.fallback,
		...(cycle && cycle.length > 0 ? { cycle } : {}),
		...(active ? { active } : {}),
	});
	return filePath;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

async function loadAgentRegistry(): Promise<AgentRegistry> {
	const filePath = resolveRegistryPath("PI_ACIDBATH_AGENTS_PATH", "config/agents.example.json");
	try {
		const raw = await readJsonFile(filePath);
		return parseAgentRegistry(raw);
	} catch {
		return defaultAgentRegistry();
	}
}

// ─── state persistence ─────────────────────────────────────────────────

type HarnessMagicState = {
	registry: MagicRegistry;
	pendingMatches: MagicMatch[];
	/** Prior thinking level when magic raised it (undefined = no raise in flight). */
	priorThinkingLevel?: ThinkingLevel;
};

function isMagicState(value: unknown): value is HarnessMagicState {
	if (!value || typeof value !== "object") return false;
	const v = value as { registry?: unknown; pendingMatches?: unknown };
	if (!v.registry || typeof v.registry !== "object") return false;
	const reg = v.registry as { enabled?: unknown; keywords?: unknown };
	if (typeof reg.enabled !== "boolean") return false;
	if (!Array.isArray(reg.keywords)) return false;
	if (!Array.isArray(v.pendingMatches)) return false;
	return true;
}

type HarnessRoleState = {
	selector?: string;
	snapshot?: RoleSnapshot;
};

function isRoleState(value: unknown): value is HarnessRoleState {
	if (!value || typeof value !== "object") return false;
	const v = value as { selector?: unknown; snapshot?: unknown };
	if (v.selector !== undefined && typeof v.selector !== "string") return false;
	if (v.snapshot !== undefined) {
		const s = v.snapshot;
		if (!s || typeof s !== "object") return false;
		const ss = s as { thinkingLevel?: unknown; tools?: unknown };
		if (typeof ss.thinkingLevel !== "string") return false;
		if (!Array.isArray(ss.tools)) return false;
	}
	return true;
}

// ─── roles: model find + apply ──────────────────────────────────────────

function buildScopedList(ctx: ExtensionContext): Array<{ provider: string; id: string }> {
	const scoped = ctx.scopedModels;
	const out: Array<{ provider: string; id: string }> = [];
	for (const m of scoped) {
		if (m && m.model) {
			out.push({ provider: m.model.provider, id: m.model.id });
		}
	}
	return out;
}

function findModelByPair(
	registry: ExtensionContext["modelRegistry"],
	provider: string,
	modelId: string,
): { provider: string; id: string } | undefined {
	const available = registry.getAvailable();
	for (const m of available) {
		if (m.provider === provider && m.id === modelId) {
			return { provider: m.provider, id: m.id };
		}
	}
	return undefined;
}

/** Extract pure ModelInfo from a Pi registry model. */
function modelInfoFromModel(m: { provider: string; id: string; name?: string; contextWindow?: number; maxTokens?: number; reasoning?: boolean; input?: ReadonlyArray<string>; cost?: { input?: number; output?: number } }): ModelInfo {
	return {
		provider: m.provider,
		id: m.id,
		name: m.name,
		contextWindow: m.contextWindow,
		maxTokens: m.maxTokens,
		reasoning: m.reasoning,
		vision: Array.isArray(m.input) && m.input.includes("image"),
		costIn: m.cost?.input,
		costOut: m.cost?.output,
	};
}

function availableModelInfos(ctx: ExtensionContext): ModelInfo[] {
	return ctx.modelRegistry.getAvailable().map((m) => modelInfoFromModel(m));
}

/**
 * Switch the live session model and verify it actually changed.
 * Returns the "before → after" pair on success, undefined on failure
 * (already notified).
 */
async function setVerifiedModel(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	provider: string,
	modelId: string,
): Promise<{ before: string; after: string } | undefined> {
	const modelObj = ctx.modelRegistry.find(provider, modelId);
	if (!modelObj) {
		ctx.ui.notify(`model ${provider}/${modelId} is not registered`, "warning");
		return undefined;
	}
	const before = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "(none)";
	const expected = `${provider}/${modelId}`;
	const ok = await pi.setModel(modelObj);
	const after = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "(none)";
	if (!ok || after !== expected) {
		ctx.ui.notify(`model did not change (still ${after}; wanted ${expected})`, "warning");
		return undefined;
	}
	return { before, after };
}

function applyThinkingAndTools(pi: ExtensionAPI, spec: { thinkingLevel?: ThinkingLevel; tools?: string[] }): void {
	if (spec.thinkingLevel) {
		pi.setThinkingLevel(spec.thinkingLevel);
	}
	if (Array.isArray(spec.tools) && spec.tools.length > 0) {
		pi.setActiveTools(spec.tools);
	}
}

function captureRoleSnapshot(pi: ExtensionAPI, ctx: ExtensionCommandContext): RoleSnapshot {
	const snap: RoleSnapshot = {
		thinkingLevel: ctx.thinkingLevel ?? "off",
		tools: [...pi.getActiveTools()],
	};
	if (ctx.model) {
		snap.modelProvider = ctx.model.provider;
		snap.modelId = ctx.model.id;
	}
	return snap;
}

async function applyRoleResolution(
	pi: ExtensionAPI,
	resolution: RoleResolution,
	ctx: ExtensionCommandContext,
): Promise<boolean> {
	if (resolution.kind === "error") {
		ctx.ui.notify(describeResolution(resolution), "warning");
		return false;
	}
	const spec: RoleSpec = resolution.spec;
	if (!spec.provider || !spec.model) {
		ctx.ui.notify(`role "${spec.alias}" did not resolve to a provider/model`, "warning");
		return false;
	}
	if (!findModelByPair(ctx.modelRegistry, spec.provider, spec.model)) {
		ctx.ui.notify(`model ${spec.provider}/${spec.model} is not available`, "warning");
		return false;
	}
	const switched = await setVerifiedModel(pi, ctx, spec.provider, spec.model);
	if (!switched) return false;
	applyThinkingAndTools(pi, spec);
	ctx.ui.notify(`${describeResolution(resolution)}\nmodel ${switched.before} → ${switched.after}`, "info");
	return true;
}

/**
 * Apply a direct `provider/model[:thinking]` selector (no registry
 * alias involved). Returns false on failure (already notified).
 */
async function applyDirectSelector(
	pi: ExtensionAPI,
	selector: DirectModelSelector,
	ctx: ExtensionCommandContext,
): Promise<boolean> {
	if (!findModelByPair(ctx.modelRegistry, selector.provider, selector.model)) {
		const search = searchModelInfos(
			availableModelInfos(ctx),
			`${selector.provider}/${selector.model}`,
		);
		const suggestion = search.matches.length > 0
			? `\nclosest matches:\n${search.matches.slice(0, 5).map((m) => `  ${formatModelLine(m)}`).join("\n")}`
			: "\nuse /role models <query> to see what is available";
		ctx.ui.notify(`model ${selector.provider}/${selector.model} is not available${suggestion}`, "warning");
		return false;
	}
	const switched = await setVerifiedModel(pi, ctx, selector.provider, selector.model);
	if (!switched) return false;
	applyThinkingAndTools(pi, selector);
	ctx.ui.notify(
		`model ${switched.before} → ${switched.after}${selector.thinkingLevel ? ` (thinking=${selector.thinkingLevel})` : ""}`,
		"info",
	);
	return true;
}

async function restoreSnapshot(
	pi: ExtensionAPI,
	snapshot: RoleSnapshot,
	ctx: ExtensionCommandContext,
): Promise<void> {
	if (snapshot.modelProvider && snapshot.modelId) {
		const modelObj = ctx.modelRegistry.find(snapshot.modelProvider, snapshot.modelId);
		if (modelObj) {
			await pi.setModel(modelObj);
		}
	}
	pi.setThinkingLevel(snapshot.thinkingLevel);
	if (Array.isArray(snapshot.tools)) {
		pi.setActiveTools(snapshot.tools);
	}
	ctx.ui.notify("role cleared, restored prior model/thinking/tools", "info");
}

// ─── session helpers ───────────────────────────────────────────────────

function getRawBranch(ctx: ExtensionContext): Array<{
	type: string;
	id?: string;
	message?: unknown;
	summary?: unknown;
	customType?: unknown;
	data?: unknown;
	firstKeptEntryId?: string;
	tokensBefore?: number;
}> {
	const mgr = ctx.sessionManager;
	if (typeof (mgr as { getBranch?: unknown }).getBranch === "function") {
		const branch = mgr.getBranch();
		return branch as Array<{
			type: string;
			id?: string;
			message?: unknown;
			summary?: unknown;
			customType?: unknown;
			data?: unknown;
		}>;
	}
	return [];
}

// ─── extension ─────────────────────────────────────────────────────────

export default function harness(pi: ExtensionAPI): void {
	let magicState: HarnessMagicState = {
		registry: defaultMagicRegistry(),
		pendingMatches: [],
	};
	let roleState: HarnessRoleState = {};

	// ─── session_start: restore persisted state ──────────────────────
	pi.on("session_start", async (_event, ctx) => {
		try {
			const registry = await loadMagicRegistry();
			magicState = { registry, pendingMatches: [] };
		} catch {
			magicState = { registry: defaultMagicRegistry(), pendingMatches: [] };
		}

		// Restore role state from the latest harness-role-state custom entry.
		try {
			const branch = getRawBranch(ctx);
			let latest: HarnessRoleState | undefined;
			for (let i = branch.length - 1; i >= 0; i--) {
				const entry = branch[i];
				if (entry.type === "custom" && entry.customType === ROLE_STATE_ENTRY_TYPE) {
					if (isRoleState(entry.data)) {
						latest = entry.data;
					}
					break;
				}
			}
			roleState = latest ?? {};
			if (!roleState.selector) {
				const stored = await loadStoredRoles();
				if (stored.active) roleState = { ...roleState, selector: stored.active };
			}
			if (roleState.selector && ctx.model) {
				if (isDirectModelSelector(roleState.selector)) {
					try {
						const direct = parseModelSelector(roleState.selector);
						const applied = await applyDirectSelector(pi, direct, ctx as ExtensionCommandContext);
						if (!applied) roleState = { ...roleState, selector: undefined };
					} catch {
						roleState = { ...roleState, selector: undefined };
					}
				} else {
					const registry = await loadRoleRegistry();
					const scoped = buildScopedList(ctx);
					const resolution = resolveRole(roleState.selector, registry, ctx.modelRegistry.getAvailable(), { scoped });
					if (resolution.kind !== "error") {
						const applied = await applyRoleResolution(pi, resolution, ctx as ExtensionCommandContext);
						if (!applied) roleState = { ...roleState, selector: undefined };
					}
				}
			}
		} catch {
			roleState = {};
		}
	});

	// ─── input: transform exact-prose magic matches ───────────────────
	pi.on("input", async (event, _ctx) => {
		// Every turn begins with an `input` event, so this is the one place
		// guaranteed to run between turns. Assigning (rather than
		// accumulating) also drops anything a previous turn left behind: if
		// that turn was aborted before `before_agent_start` consumed it, its
		// hints would otherwise be injected into an unrelated later prompt.
		magicState.pendingMatches = matchMagicWords(event.text, magicState.registry);
		// Unchanged text per ADR-0004 — hints are appended in before_agent_start.
		return { action: "transform", text: event.text, images: event.images };
	});

	// ─── before_agent_start: append hints, optionally raise thinking ─
	pi.on("before_agent_start", async (event, ctx) => {
		const matches = magicState.pendingMatches;
		if (matches.length === 0) {
			magicState.pendingMatches = [];
			return {};
		}
		const hints = formatMagicHints(matches);
		magicState.pendingMatches = [];

		let prompt = event.systemPrompt;
		if (hints.length > 0) {
			prompt = prompt.length > 0 ? `${prompt}\n\n${hints}` : hints;
		}

		const wantRaise = matches.some((m) => m.raiseThinking);
		const currentLevel = ctx.thinkingLevel ?? "off";
		if (wantRaise && currentLevel !== "high" && currentLevel !== "xhigh" && currentLevel !== "max") {
			magicState.priorThinkingLevel = currentLevel;
			pi.setThinkingLevel("high");
		}

		return { systemPrompt: prompt };
	});

	// ─── agent_settled: restore prior thinking level if magic raised it
	pi.on("agent_settled", async () => {
		const prior = magicState.priorThinkingLevel;
		if (prior !== undefined) {
			pi.setThinkingLevel(prior);
			magicState.priorThinkingLevel = undefined;
		}
		// A turn can settle without `before_agent_start` ever consuming its
		// matches (aborted input). Drop the leftovers here too, so they
		// cannot reach the next turn.
		magicState.pendingMatches = [];
	});

	// ─── /magic ───────────────────────────────────────────────────────
	pi.registerCommand("magic", {
		description: "Harness magic words (list|add <word>|remove <id>|enable <id>|disable <id>)",
		handler: async (args, ctx) => {
			const text = args.trim();
			const filePath = userConfigPath("PI_ACIDBATH_MAGIC_PATH", "magic.json");
			if (!text || text === "list") {
				const lines: string[] = [];
				lines.push(`magic matching: ${magicState.registry.enabled ? "on" : "off"}`);
				lines.push(`file: ${filePath}`);
				if (magicState.registry.keywords.length === 0) {
					lines.push("  (no keywords — /magic add <word> [hint])");
				} else {
					for (const k of magicState.registry.keywords) {
						lines.push(`  ${k.enabled ? "[x]" : "[ ]"} ${k.id} = ${k.word}${k.raiseThinking ? " (raise)" : ""}`);
					}
				}
				ctx.ui.notify(lines.join("\n"), "info");
				return;
			}
			const parts = text.split(/\s+/);
			const verb = parts[0];
			try {
				if (verb === "add") {
					const word = parts[1];
					if (!word) {
						ctx.ui.notify("usage: /magic add <word> [--raise] [hint]", "warning");
						return;
					}
					const raise = parts.includes("--raise");
					const hint = parts.slice(2).filter((part) => part !== "--raise").join(" ");
					magicState.registry = addMagicKeyword(magicState.registry, {
						word,
						...(hint ? { hint } : {}),
						...(raise ? { raiseThinking: true } : {}),
					});
					const saved = await saveMagicRegistry(magicState.registry);
					pi.appendEntry<HarnessMagicState>(MAGIC_STATE_ENTRY_TYPE, magicState);
					ctx.ui.notify(`added magic keyword ${word}; matching is on\nfile: ${saved}`, "info");
					return;
				}
				if (verb === "remove") {
					const id = parts[1];
					if (!id) {
						ctx.ui.notify("usage: /magic remove <id>", "warning");
						return;
					}
					magicState.registry = removeMagicKeyword(magicState.registry, id);
					await saveMagicRegistry(magicState.registry);
					pi.appendEntry<HarnessMagicState>(MAGIC_STATE_ENTRY_TYPE, magicState);
					ctx.ui.notify(`removed magic keyword ${id}`, "info");
					return;
				}
				if (verb === "enable" || verb === "disable") {
					const id = parts[1];
					if (!id || !/^[\w-]+$/.test(id)) {
						ctx.ui.notify("usage: /magic enable <id> | /magic disable <id>", "warning");
						return;
					}
					magicState.registry = setMagicKeywordEnabled(magicState.registry, id, verb === "enable");
					await saveMagicRegistry(magicState.registry);
					pi.appendEntry<HarnessMagicState>(MAGIC_STATE_ENTRY_TYPE, magicState);
					ctx.ui.notify(`magic: ${id} ${verb}d; matching ${magicState.registry.enabled ? "on" : "off"}`, "info");
					return;
				}
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				ctx.ui.notify(message, "warning");
				return;
			}
			ctx.ui.notify("usage: /magic list|add <word>|remove <id>|enable <id>|disable <id>", "warning");
		},
	});

	// ─── /role helpers (closure state) ─────────────────────────────────

	/** Active role alias from the live or saved selector, if any. */
	function activeRoleAlias(stored: StoredRoleFile): { selector: string | undefined; alias: string | undefined } {
		const selector = roleState.selector ?? stored.active;
		if (!selector) return { selector: undefined, alias: undefined };
		if (isDirectModelSelector(selector)) return { selector, alias: undefined };
		try {
			return { selector, alias: parseRoleSelector(selector).alias };
		} catch {
			return { selector, alias: undefined };
		}
	}

	/**
	 * Shared switch path for /role set, /role next, and the guided add
	 * flow. Accepts registry aliases (with optional :thinking) and
	 * direct provider/model[:thinking] selectors. Persists the selector
	 * and records the role-state entry on success.
	 */
	const applyRoleSelector = async (
		selector: string,
		stored: StoredRoleFile,
		ctx: ExtensionCommandContext,
	): Promise<boolean> => {
		if (!roleState.snapshot) {
			roleState.snapshot = captureRoleSnapshot(pi, ctx);
		}
		let applied: boolean;
		if (isDirectModelSelector(selector)) {
			try {
				const direct = parseModelSelector(selector);
				applied = await applyDirectSelector(pi, direct, ctx);
			} catch (err) {
				ctx.ui.notify(err instanceof Error ? err.message : String(err), "warning");
				return false;
			}
		} else {
			const resolution = resolveRole(
				selector,
				stored.registry,
				ctx.modelRegistry.getAvailable(),
				{ scoped: buildScopedList(ctx) },
			);
			if (resolution.kind === "error") {
				const lines = [describeResolution(resolution)];
				if (resolution.reason === "unknown-role") {
					const suggestions = suggestRoleAliases(resolution.missing, stored.registry.aliases.map((a) => a.alias));
					if (suggestions.length > 0) lines.push(`did you mean: ${suggestions.join(", ")}?`);
					lines.push(`known roles: ${stored.registry.aliases.map((a) => a.alias).join(", ")}`);
				}
				ctx.ui.notify(lines.join("\n"), "warning");
				return false;
			}
			applied = await applyRoleResolution(pi, resolution, ctx);
		}
		if (!applied) return false;
		roleState.selector = selector;
		await saveRoleRegistry(stored.registry, selector, stored.cycle);
		pi.appendEntry<HarnessRoleState>(ROLE_STATE_ENTRY_TYPE, roleState);
		return true;
	};

	/** Interactive /role add flow (TUI/RPC only). Each step can be cancelled. */
	const guidedRoleAdd = async (ctx: ExtensionCommandContext): Promise<void> => {
		const alias = (await ctx.ui.input("New role name", "single word, e.g. fast"))?.trim();
		if (alias === undefined) return;
		if (!alias || alias.includes(" ")) {
			ctx.ui.notify("role name must be a single word without spaces", "warning");
			return;
		}
		const query = (await ctx.ui.input("Filter models", "provider, id, or name (empty = all)"))?.trim();
		if (query === undefined) return;

		const infos = availableModelInfos(ctx);
		const search = searchModelInfos(infos, query);
		if (search.matches.length === 0) {
			const ids = suggestRoleAliases(query, infos.map((m) => m.id), 5);
			ctx.ui.notify(
				`no models match "${query}"${ids.length ? `\ndid you mean: ${ids.join(", ")}?` : ""}`,
				"warning",
			);
			return;
		}
		const shown = search.matches.slice(0, ROLE_PICKER_MAX);
		const labels = shown.map((m) => formatModelPickerLabel(m));
		const pickedLabel = await ctx.ui.select(
			`Select model (${shown.length} of ${search.matches.length}${query ? ` matching "${query}"` : ""})`,
			labels,
		);
		if (pickedLabel === undefined) {
			ctx.ui.notify("role add cancelled", "info");
			return;
		}
		const pickedIdx = labels.indexOf(pickedLabel);
		const picked = pickedIdx >= 0 ? shown[pickedIdx] : undefined;
		if (!picked) {
			ctx.ui.notify("role add cancelled", "info");
			return;
		}

		let thinkingLevel: ThinkingLevel | undefined;
		const modelObj = ctx.modelRegistry.find(picked.provider, picked.id);
		if (modelObj && modelObj.reasoning) {
			const levels = supportedThinkingLevels(modelObj.thinkingLevelMap);
			const levelLabels = ["(provider default)", ...levels];
			const levelPicked = await ctx.ui.select("Thinking level", levelLabels);
			if (levelPicked === undefined) {
				ctx.ui.notify("role add cancelled", "info");
				return;
			}
			const levelIdx = levelLabels.indexOf(levelPicked);
			if (levelIdx > 0) {
				const level = levels[levelIdx - 1];
				if (level) thinkingLevel = level;
			}
		}

		const descriptionInput = (await ctx.ui.input("Description (optional)", `what "${alias}" is for`))?.trim();
		if (descriptionInput === undefined) return;
		const description = descriptionInput || `User role for ${picked.provider}/${picked.id}.`;

		const stored = await loadStoredRoles();
		const existed = stored.registry.aliases.some((a) => a.alias === alias);
		const next = upsertRole(stored.registry, {
			alias,
			provider: picked.provider,
			model: picked.id,
			description,
			...(thinkingLevel ? { thinkingLevel } : {}),
		});
		const cycle = normalizeCycle(stored.cycle, next.aliases.map((a) => a.alias)).cycle;
		const saved = await saveRoleRegistry(next, stored.active, cycle);
		ctx.ui.notify(
			`${existed ? "updated" : "added"} role ${alias} = ${picked.provider}/${picked.id}\nfile: ${saved}`,
			"info",
		);

		const switchNow = await ctx.ui.confirm(
			"Switch to it now?",
			`Set the session model to ${alias} (${picked.provider}/${picked.id})?`,
		);
		if (switchNow) {
			await applyRoleSelector(alias, { registry: next, cycle, active: stored.active }, ctx);
		}
	};

	// ─── /role ────────────────────────────────────────────────────────
	pi.registerCommand("role", {
		description: "Harness roles (list|models|add|remove|set|next|cycle|info|clear|resolve)",
		handler: async (args, ctx) => {
			const text = args.trim();
			const filePath = userConfigPath("PI_ACIDBATH_ROLES_PATH", "roles.json");
			const current = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "(none)";
			const parts = text.split(/\s+/);
			const verb = parts[0];
			const selector = parts.slice(1).join(" ").trim();

			if (!text || text === "list") {
				const stored = await loadStoredRoles();
				const available = ctx.modelRegistry.getAvailable();
				const active = activeRoleAlias(stored);
				const lines: string[] = [];
				lines.push(`model: ${current}${ctx.model?.name ? ` (${ctx.model.name})` : ""}`);
				lines.push(`active role: ${active.selector ?? "(none)"}`);
				lines.push(`file: ${filePath}`);
				lines.push(`roles (${stored.registry.aliases.length}):`);
				for (const spec of stored.registry.aliases) {
					const modelName = spec.provider && spec.model
						? available.find((m) => m.provider === spec.provider && m.id === spec.model)?.name
						: undefined;
					const present = spec.provider && spec.model
						? available.some((m) => m.provider === spec.provider && m.id === spec.model)
						: false;
					lines.push(formatRoleEntry(spec, { available: present, active: active.alias === spec.alias, modelName }));
				}
				lines.push(`fallback: ${stored.registry.fallback.join(", ") || "(none)"}`);
				lines.push(`cycle (/role next): ${stored.cycle.join(" → ") || "(none)"}`);
				const loadError = takeRegistryLoadError("roles");
				if (loadError) {
					lines.push(`WARNING: registry failed to load, showing built-in defaults — ${loadError}`);
				}
				lines.push('tips: "/role set" opens a picker · "/role next" cycles · "/role models <query>" browses the catalog');
				ctx.ui.notify(lines.join("\n"), loadError ? "warning" : "info");
				return;
			}

			if (verb === "models") {
				const query = parts.slice(1).join(" ").trim();
				const infos = availableModelInfos(ctx);
				const search = searchModelInfos(infos, query);
				if (search.matches.length === 0) {
					const ids = suggestRoleAliases(query, infos.map((m) => m.id), 5);
					ctx.ui.notify(
						`no models match "${query}"${ids.length ? `\ndid you mean: ${ids.join(", ")}?` : ""}`,
						"warning",
					);
					return;
				}
				const shown = search.matches.slice(0, MODELS_SHOWN_MAX);
				const lines: string[] = [];
				lines.push(
					`models (${shown.length} of ${search.matches.length}${query ? ` matching "${query}"` : ""}; ${search.total} total):`,
				);
				for (const m of shown) lines.push(`  ${formatModelLine(m)}`);
				if (search.matches.length > shown.length) {
					lines.push(`  … and ${search.matches.length - shown.length} more — refine the query`);
				}
				lines.push("bind one with /role add <alias> <provider/model>");
				ctx.ui.notify(lines.join("\n"), "info");
				return;
			}

			if (verb === "add") {
				const alias = parts[1];
				const modelRef = parts[2];
				const thinking = parts[3];
				if (!alias || !modelRef) {
					if (ctx.hasUI) {
						await guidedRoleAdd(ctx);
					} else {
						ctx.ui.notify("usage: /role add <alias> <provider/model> [thinking] [description]", "warning");
					}
					return;
				}
				if (!modelRef.includes("/") || modelRef.includes(" ")) {
					ctx.ui.notify("usage: /role add <alias> <provider/model> [thinking] [description]", "warning");
					return;
				}
				const slash = modelRef.indexOf("/");
				const provider = modelRef.slice(0, slash);
				const model = modelRef.slice(slash + 1);
				if (thinking && !isThinkingLevel(thinking)) {
					ctx.ui.notify("thinking must be off, minimal, low, medium, high, xhigh, or max", "warning");
					return;
				}
				const infos = availableModelInfos(ctx);
				if (!infos.some((m) => m.provider === provider && m.id === model)) {
					const search = searchModelInfos(infos, `${provider}/${model}`);
					const suggestion = search.matches.length > 0
						? `\nclosest matches:\n${search.matches.slice(0, 5).map((m) => `  ${formatModelLine(m)}`).join("\n")}`
						: "\nuse /role models <query> to browse the catalog";
					ctx.ui.notify(`model ${provider}/${model} is not available${suggestion}`, "warning");
					return;
				}
				const hasThinking = thinking !== undefined && isThinkingLevel(thinking);
				const description = parts.slice(hasThinking ? 4 : 3).join(" ").trim();
				const stored = await loadStoredRoles();
				const existed = stored.registry.aliases.some((a) => a.alias === alias);
				const next = upsertRole(stored.registry, {
					alias,
					provider,
					model,
					description: description || `User role for ${provider}/${model}.`,
					...(hasThinking && thinking !== undefined ? { thinkingLevel: thinking } : {}),
				});
				const cycle = normalizeCycle(stored.cycle, next.aliases.map((a) => a.alias)).cycle;
				const saved = await saveRoleRegistry(next, stored.active, cycle);
				ctx.ui.notify(
					`${existed ? "updated" : "added"} role ${alias} = ${provider}/${model}\nfile: ${saved}\nuse /role set ${alias} to switch`,
					"info",
				);
				return;
			}

			if (verb === "remove") {
				const alias = parts[1];
				if (!alias) {
					ctx.ui.notify("usage: /role remove <alias>", "warning");
					return;
				}
				try {
					const stored = await loadStoredRoles();
					const next = removeRole(stored.registry, alias);
					const cycle = stored.cycle.filter((name) => name !== alias);
					const active = stored.active === alias ? undefined : stored.active;
					await saveRoleRegistry(next, active, cycle);
					const live = activeRoleAlias(stored);
					if (live.alias === alias) roleState = { ...roleState, selector: undefined };
					ctx.ui.notify(
						`removed role ${alias}${active === undefined && stored.active === alias ? " (was the saved active role)" : ""}`,
						"info",
					);
				} catch (err) {
					ctx.ui.notify(err instanceof Error ? err.message : String(err), "warning");
				}
				return;
			}

			if (verb === "info") {
				const alias = parts[1];
				if (!alias) {
					ctx.ui.notify("usage: /role info <alias>", "warning");
					return;
				}
				const stored = await loadStoredRoles();
				const spec = stored.registry.aliases.find((a) => a.alias === alias);
				if (!spec) {
					const suggestions = suggestRoleAliases(alias, stored.registry.aliases.map((a) => a.alias));
					ctx.ui.notify(
						`role "${alias}" is not in the registry${suggestions.length ? `\ndid you mean: ${suggestions.join(", ")}?` : ""}`,
						"warning",
					);
					return;
				}
				const available = ctx.modelRegistry.getAvailable();
				const live = available.find((m) => m.provider === spec.provider && m.id === spec.model);
				const active = activeRoleAlias(stored);
				const lines = [formatRoleEntry(spec, {
					available: live !== undefined,
					active: active.alias === spec.alias,
					modelName: live?.name,
				})];
				if (live) {
					lines.push(`      ${formatModelLine(modelInfoFromModel(live))}`);
				} else if (spec.provider && spec.model) {
					lines.push(`      model ${spec.provider}/${spec.model} is not currently available`);
				}
				lines.push(`      in fallback chain: ${stored.registry.fallback.includes(alias) ? "yes" : "no"}`);
				lines.push(`      in cycle: ${stored.cycle.includes(alias) ? "yes" : "no"}`);
				ctx.ui.notify(lines.join("\n"), "info");
				return;
			}

			if (verb === "cycle") {
				const stored = await loadStoredRoles();
				const arg = parts.slice(1).join(" ").trim();
				if (!arg) {
					ctx.ui.notify(
						`cycle: ${stored.cycle.join(" → ") || "(none)"}\nset with: /role cycle <alias,alias,...> — order matters, /role next walks it`,
						"info",
					);
					return;
				}
				const entries = arg.split(/[,\s]+/).map((s) => s.trim()).filter((s) => s.length > 0);
				const { cycle, dropped } = normalizeCycle(entries, stored.registry.aliases.map((a) => a.alias));
				if (cycle.length === 0 || dropped.length > 0) {
					ctx.ui.notify(
						`invalid cycle${dropped.length ? ` — unknown roles: ${dropped.join(", ")}` : ""}\nknown roles: ${stored.registry.aliases.map((a) => a.alias).join(", ")}`,
						"warning",
					);
					return;
				}
				await saveRoleRegistry(stored.registry, stored.active, cycle);
				ctx.ui.notify(`cycle set: ${cycle.join(" → ")}\nuse /role next to step through it`, "info");
				return;
			}

			if (verb === "next") {
				const stored = await loadStoredRoles();
				if (stored.cycle.length === 0) {
					ctx.ui.notify("no cycle configured; set one with /role cycle <alias,alias,...>", "warning");
					return;
				}
				const step = stepRoleCycle(
					stored.cycle,
					roleState.selector ?? stored.active,
					stored.registry,
					ctx.modelRegistry.getAvailable(),
					{ scoped: buildScopedList(ctx) },
				);
				if (step.kind === "exhausted") {
					ctx.ui.notify(
						`no role in the cycle (${stored.cycle.join(", ")}) is available${step.tried.length ? ` — tried: ${step.tried.join(", ")}` : ""}`,
						"warning",
					);
					return;
				}
				const ok = await applyRoleSelector(step.selector, stored, ctx);
				if (ok && step.skipped.length > 0) {
					ctx.ui.notify(`skipped unavailable roles: ${step.skipped.join(", ")}`, "warning");
				}
				return;
			}

			if (verb === "resolve") {
				if (!selector) {
					ctx.ui.notify("usage: /role resolve <alias>", "warning");
					return;
				}
				const stored = await loadStoredRoles();
				const resolution = resolveRole(
					selector,
					stored.registry,
					ctx.modelRegistry.getAvailable(),
					{ scoped: buildScopedList(ctx) },
				);
				if (resolution.kind === "error" && resolution.reason === "unknown-role") {
					const suggestions = suggestRoleAliases(selector, stored.registry.aliases.map((a) => a.alias));
					if (suggestions.length > 0) {
						ctx.ui.notify(`${describeResolution(resolution)}\ndid you mean: ${suggestions.join(", ")}?`, "warning");
						return;
					}
				}
				ctx.ui.notify(describeResolution(resolution), resolution.kind === "error" ? "warning" : "info");
				return;
			}

			if (verb === "clear") {
				if (roleState.snapshot) {
					await restoreSnapshot(pi, roleState.snapshot, ctx);
				}
				roleState = {};
				const stored = await loadStoredRoles();
				await saveRoleRegistry(stored.registry, undefined, stored.cycle);
				pi.appendEntry<HarnessRoleState>(ROLE_STATE_ENTRY_TYPE, roleState);
				ctx.ui.notify(`role cleared; session model is ${ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "(none)"}`, "info");
				return;
			}

			if (verb === "set") {
				const stored = await loadStoredRoles();
				let target = selector;
				if (!target) {
					if (!ctx.hasUI) {
						ctx.ui.notify("no dialog UI in this mode; pass a role alias or provider/model selector", "warning");
						return;
					}
					const available = ctx.modelRegistry.getAvailable();
					const active = activeRoleAlias(stored);
					const choices = stored.registry.aliases.map((spec) => {
						const match = spec.provider && spec.model
							? available.find((m) => m.provider === spec.provider && m.id === spec.model)
							: undefined;
						const isActive = active.alias === spec.alias;
						const label = formatRolePickerLabel(spec, match?.name);
						const state = match ? "" : "  · unavailable";
						return isActive ? `${label}${state}  ◂ active` : `${label}${state}`;
					});
					const picked = await ctx.ui.select("Switch role", choices);
					if (picked === undefined) {
						ctx.ui.notify("role switch cancelled", "info");
						return;
					}
					const pickedIdx = choices.indexOf(picked);
					const pickedSpec = pickedIdx >= 0 ? stored.registry.aliases[pickedIdx] : undefined;
					if (!pickedSpec) {
						ctx.ui.notify("role switch cancelled", "info");
						return;
					}
					target = pickedSpec.alias;
				}
				await applyRoleSelector(target, stored, ctx);
				return;
			}

			ctx.ui.notify(
				"usage: /role list|models [query]|add|remove <alias>|set [alias|provider/model[:thinking]]|next|cycle [aliases]|info <alias>|clear|resolve <alias>",
				"warning",
			);
		},
	});

	// ─── /handoff ─────────────────────────────────────────────────────
	pi.registerCommand("handoff", {
		description: "Transfer current session context into a new focused session",
		handler: async (args, ctx) => {
			if (ctx.mode !== "tui") {
				ctx.ui.notify("handoff requires interactive mode", "error");
				return;
			}
			if (!ctx.model) {
				ctx.ui.notify("no model selected", "error");
				return;
			}
			const goal = args.trim();
			if (!goal) {
				ctx.ui.notify("usage: /handoff <goal for new thread>", "error");
				return;
			}

			const branchRaw = getRawBranch(ctx);
			const mapped = mapToHandoffEntries(branchRaw);
			const entries = selectHandoffEntries(mapped);
			if (entries.length === 0) {
				ctx.ui.notify("no conversation to hand off", "warning");
				return;
			}
			const conversationText = serializeHandoffSource(entries, DEFAULT_HANDOFF_MAX_CHARS);
			const prompt = buildHandoffPrompt(goal, conversationText);
			const currentSessionFile = ctx.sessionManager.getSessionFile();

			let generated: string | undefined;
			try {
				const response = await Promise.race([
					ctx.modelRegistry.complete(
						ctx.model,
						{
							systemPrompt: HANDOFF_SYSTEM_PROMPT,
							messages: [
								{ role: "user", content: [{ type: "text", text: prompt }], timestamp: Date.now() },
							],
						},
						{ cacheRetention: "none", signal: AbortSignal.timeout(DEFAULT_HANDOFF_TIMEOUT_MS) },
					),
					new Promise<never>((_, reject) =>
						setTimeout(() => reject(new Error("handoff generation timed out")), DEFAULT_HANDOFF_TIMEOUT_MS),
					),
				]);
				if (response.stopReason === "aborted") {
					ctx.ui.notify("handoff generation aborted", "info");
					return;
				}
				generated = assistantTextFromComplete(response.content);
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				ctx.ui.notify(`handoff generation failed: ${sanitizeCompactError(msg)}`, "error");
				return;
			}

			if (!generated) {
				ctx.ui.notify("handoff generation returned empty content", "warning");
				return;
			}
			const parsed = parseHandoffMarkdown(generated, {
				generatedAt: new Date().toISOString(),
				sourceSessionId: ctx.sessionManager.getSessionId(),
				goal,
			});
			const prefilled = formatHandoffDoc(parsed);

			const edited = await ctx.ui.editor("Edit handoff prompt", prefilled);
			if (edited === undefined) {
				ctx.ui.notify("handoff cancelled", "info");
				return;
			}

			// Child-session creation can fail (disk, a reload racing the
			// call, a provider switch mid-flight). Surface it instead of
			// letting the rejection escape the command handler, which
			// would leave the user with a failed handoff and no reason.
			let result: { cancelled?: boolean } | undefined;
			try {
				result = await ctx.newSession({
					parentSession: currentSessionFile,
					withSession: async (replacementCtx) => {
						replacementCtx.ui.setEditorText(edited);
						replacementCtx.ui.notify("handoff ready — review and submit when ready", "info");
					},
				});
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				ctx.ui.notify(`handoff failed to start new session: ${sanitizeCompactError(msg)}`, "error");
				return;
			}
			if (result?.cancelled) {
				ctx.ui.notify("new session cancelled", "info");
			}
		},
	});

	// ─── /recap ───────────────────────────────────────────────────────
	pi.registerCommand("recap", {
		description: "Persist a session recap entry (not sent to LLM)",
		handler: async (args, ctx) => {
			if (!ctx.model) {
				ctx.ui.notify("no model selected", "error");
				return;
			}
			const focus = args.trim();

			const branchRaw = getRawBranch(ctx);
			const entries = selectRecapEntries(mapToRecapEntries(branchRaw));

			const conversationText = serializeRecapSource(entries, DEFAULT_RECAP_MAX_CHARS);
			if (conversationText.length === 0) {
				ctx.ui.notify("no conversation to recap", "warning");
				return;
			}

			const promptBody = buildRecapPrompt(focus || undefined, conversationText);
			let generated: string | undefined;
			try {
				const response = await Promise.race([
					ctx.modelRegistry.complete(
						ctx.model,
						{
							systemPrompt: RECAP_SYSTEM_PROMPT,
							messages: [{ role: "user", content: [{ type: "text", text: promptBody }], timestamp: Date.now() }],
						},
						{ cacheRetention: "none", signal: AbortSignal.timeout(DEFAULT_RECAP_TIMEOUT_MS) },
					),
					new Promise<never>((_, reject) =>
						setTimeout(() => reject(new Error("recap generation timed out")), DEFAULT_RECAP_TIMEOUT_MS),
					),
				]);
				if (response.stopReason === "aborted") {
					ctx.ui.notify("recap aborted", "info");
					return;
				}
				generated = assistantTextFromComplete(response.content);
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				ctx.ui.notify(`recap generation failed: ${sanitizeCompactError(msg)}`, "error");
				return;
			}
			if (!generated) {
				ctx.ui.notify("recap generation returned empty content", "warning");
				return;
			}

			const note: RecapNote = parseRecapMarkdown(generated, {
				generatedAt: new Date().toISOString(),
				sessionId: ctx.sessionManager.getSessionId(),
				...(focus ? { focus } : {}),
			});

			pi.appendEntry<RecapNote>(RECAP_ENTRY_TYPE, note);
			ctx.ui.notify(formatRecapNote(note), "info");
		},
	});

	// Register entry renderer for recap so users see a one-line + expandable view.
	pi.registerEntryRenderer<RecapNote>(RECAP_ENTRY_TYPE, (entry, options, theme) => {
		const note = entry.data;
		if (!isRecapNote(note)) return undefined;
		const box = new Box(1, 0);
		const collapsed = `${theme.fg("customMessageLabel", "[recap]")} ${theme.fg("dim", note.sessionId)} — ${theme.fg("text", note.goal || "(no goal)")}`;
		box.addChild(new Text(collapsed, 0, 0));
		if (options.expanded) {
			box.addChild(new Text("", 0, 0));
			box.addChild(new Text(theme.fg("dim", formatRecapNote(note)), 0, 0));
		}
		return box;
	});

	// ─── /agents ──────────────────────────────────────────────────────
	pi.registerCommand("agents", {
		description: "Harness agent core (list|run <name> <task>)",
		handler: async (args, ctx) => {
			const text = args.trim();
			if (!text || text === "list") {
				const registry = await loadAgentRegistry();
				const profiles = listAgents(registry, "all");
				if (profiles.length === 0) {
					ctx.ui.notify("agents: no profiles", "info");
					return;
				}
				const lines: string[] = [];
				lines.push(`agents (${profiles.length}):`);
				for (const p of profiles) {
					lines.push(`  ${p.name} [${p.source}] — ${p.description} (role=${p.role})`);
				}
				ctx.ui.notify(lines.join("\n"), "info");
				return;
			}
			const parts = text.split(/\s+/);
			const verb = parts[0];
			if (verb !== "run") {
				ctx.ui.notify("usage: /agents list | /agents run <name> <task>", "warning");
				return;
			}
			const agentName = parts[1];
			if (!agentName) {
				ctx.ui.notify("usage: /agents run <name> <task>", "warning");
				return;
			}
			const task = parts.slice(2).join(" ").trim();
			if (!task) {
				ctx.ui.notify("usage: /agents run <name> <task>", "warning");
				return;
			}
			const envelope = await runSubagent(
				pi,
				{ agent: agentName, task, nested: false },
				ctx,
				ctx.signal,
			);
			ctx.ui.notify(formatEnvelope(envelope), envelope.ok ? "info" : "warning");
		},
	});

	// ─── subagent tool ────────────────────────────────────────────────
	pi.registerTool(subagentTool(pi));

	// ─── session_before_compact ───────────────────────────────────────
	pi.on("session_before_compact", async (event, ctx) => {
		const model = ctx.model;
		if (!model) return {};
		if (!shouldAttemptCodexCompact({ provider: model.provider, id: model.id, api: model.api }, process.env as Record<string, string | undefined>)) {
			return {};
		}

		const entries = selectHandoffEntries(mapMessagesToHandoffEntries(event.preparation.messagesToSummarize));
		if (entries.length === 0) return {};
		const conversationText = serializeHandoffSource(entries, DEFAULT_HANDOFF_MAX_CHARS);
		if (conversationText.length === 0) return {};

		const compactRegistry = await loadRoleRegistry();
		const compactResolution = resolveRole("compact", compactRegistry, ctx.modelRegistry.getAvailable(), {
			scoped: buildScopedList(ctx),
		});
		if (compactResolution.kind === "error" || !compactResolution.spec.provider || !compactResolution.spec.model) {
			// The user explicitly enabled this path and configured a
			// "compact" role, so a broken one is worth reporting rather
			// than falling through unnoticed.
			ctx.ui.notify('acidbath codex compaction skipped: the "compact" role is not available — using native compaction', "warning");
			return {};
		}
		const compactModel = ctx.modelRegistry.find(compactResolution.spec.provider, compactResolution.spec.model);
		if (!compactModel) {
			ctx.ui.notify(
				`acidbath codex compaction skipped: model ${compactResolution.spec.provider}/${compactResolution.spec.model} is not available — using native compaction`,
				"warning",
			);
			return {};
		}

		const previousSummary = typeof event.preparation?.previousSummary === "string"
			? event.preparation.previousSummary
			: undefined;
		const prompts = buildCodexCompactPrompt({
			firstKeptEntryId: event.preparation.firstKeptEntryId,
			tokensBefore: event.preparation?.tokensBefore ?? 0,
			...(previousSummary ? { previousSummary } : {}),
			conversationText,
		});

		let summary: string | undefined;
		let usage: Usage | undefined;
		let aborted = false;
		try {
			const response = await ctx.modelRegistry.complete(
				compactModel,
				{
					systemPrompt: prompts.systemPrompt,
					messages: [
						{ role: "user", content: [{ type: "text", text: prompts.userText }], timestamp: Date.now() },
					],
				},
				{ signal: event.signal, cacheRetention: "none" },
			);
			if (response.stopReason === "aborted") {
				aborted = true;
			} else {
				summary = assistantTextFromComplete(response.content);
				usage = response.usage;
			}
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			console.warn("codex-compact failed:", sanitizeCompactError(msg));
			return {};
		}

		const firstKeptEntryId = event.preparation?.firstKeptEntryId ?? "";
		const tokensBefore = event.preparation?.tokensBefore ?? 0;
		const mapped = mapCompactResult({ summary, aborted, firstKeptEntryId, tokensBefore });
		if (!mapped.handled) {
			// Silently returning {} here falls back to Pi's native
			// compaction, so the session still works — but the user has no
			// way to learn that their configured compaction path was skipped
			// (expired credentials, quota, a missing "compact" role). Say
			// so, then let the native path run.
			ctx.ui.notify(`acidbath codex compaction skipped: ${mapped.reason} — using native compaction`, "warning");
			return {};
		}

		return {
			compaction: {
				summary: mapped.summary,
				firstKeptEntryId: mapped.firstKeptEntryId,
				tokensBefore: mapped.tokensBefore,
				...(usage ? { usage } : {}),
				details: { strategy: "acidbath-codex" },
			},
		};
	});
}

// ─── subagent tool ─────────────────────────────────────────────────────

function subagentTool(pi: ExtensionAPI) {
	const SubagentSingle = Type.Object({
		agent: Type.String({ description: "Name of the agent profile to invoke" }),
		task: Type.String({ description: "Task description handed to the agent" }),
		cwd: Type.Optional(Type.String({ description: "Override working directory" })),
		nested: Type.Optional(Type.Boolean({ description: "Whether this is a nested call (default false)", default: false })),
	});
	const ParallelItem = Type.Object({
		agent: Type.String({ description: "Name of the agent profile to invoke" }),
		task: Type.String({ description: "Task description handed to the agent" }),
		cwd: Type.Optional(Type.String({ description: "Override working directory" })),
	});
	const SubagentParallel = Type.Object({
		parallel: Type.Array(ParallelItem, {
			description: `Explicit parallel fan-out (respects registry maxConcurrency; at most ${SUBAGENT_MAX_FANOUT} items)`,
			maxItems: SUBAGENT_MAX_FANOUT,
		}),
		nested: Type.Optional(Type.Boolean({ description: "Whether this is a nested call (default false)", default: false })),
	});
	const SubagentParams = Type.Union([SubagentSingle, SubagentParallel]);

	return defineTool({
		name: "subagent",
		label: "Subagent",
		description: "Run an isolated Pi sub-session against a named agent profile. Single mode (agent + task) or explicit parallel mode (parallel[]). Nested fan-out requires the profile's allowNested=true.",
		parameters: SubagentParams,
		async execute(_toolCallId, params, signal, _onUpdate, ctx): Promise<AgentToolResult<{ envelopes: ResultEnvelope[] }>> {
			const envelopes: ResultEnvelope[] = [];
			if ("parallel" in params && Array.isArray(params.parallel)) {
				const registry = await loadAgentRegistry();
				const { items, dropped } = clampFanout(params.parallel, SUBAGENT_MAX_FANOUT);
				if (dropped > 0) {
					envelopes.push(
						errEnvelope({
							code: "invalid_args",
							message: `parallel[] had ${dropped + items.length} items; only the first ${items.length} were run`,
							traceId: "subagent",
							agent: "<unknown>",
							durationMs: 0,
						}),
					);
				}
				const concurrency = fanoutConcurrency(registry.maxConcurrency, items.length);
				const results: ResultEnvelope[] = new Array(items.length);
				let next = 0;
				const workers = Array.from({ length: concurrency }, async () => {
					while (true) {
						if (signal?.aborted) return;
						const idx = next++;
						if (idx >= items.length) return;
						const item = items[idx];
						if (!item) continue;
						results[idx] = await runSubagent(pi, { agent: item.agent, task: item.task, cwd: item.cwd, nested: false }, ctx, signal);
					}
				});
				await Promise.all(workers);
				for (let i = 0; i < results.length; i++) {
					const env = results[i];
					if (env) envelopes.push(env);
				}
			} else if ("agent" in params && typeof params.agent === "string") {
				envelopes.push(await runSubagent(pi, params, ctx, signal));
			} else {
				envelopes.push(
					errEnvelope({
						code: "invalid_args",
						message: "subagent requires either { agent, task } or { parallel: [...] }",
						traceId: "subagent",
						agent: "<unknown>",
						durationMs: 0,
					}),
				);
			}
			const text = envelopes.map((e) => formatEnvelope(e)).join("\n\n");
			return {
				content: [{ type: "text", text }],
				details: { envelopes },
			};
		},
	});
}

async function runSubagent(
	_pi: ExtensionAPI,
	args: { agent: string; task: string; cwd?: string; nested?: boolean },
	ctx: ExtensionContext,
	signal?: AbortSignal,
): Promise<ResultEnvelope> {
	const startedAt = Date.now();
	const traceId = `${args.agent}-${startedAt.toString(36)}`;

	const registry = await loadAgentRegistry();

	// Pure preflight (unit-tested in agents.ts): unknown agent, nested
	// policy, project confirmation, cwd resolution.
	let confirmed: boolean | undefined;
	let plan = planAgentRun(registry, {
		agent: args.agent,
		sessionCwd: ctx.cwd,
		canConfirm: ctx.mode === "tui",
		...(args.cwd !== undefined ? { cwd: args.cwd } : {}),
		...(args.nested !== undefined ? { nested: args.nested } : {}),
	});
	if (!plan.ok && plan.code === "project_confirm_required") {
		const approved = await ctx.ui.confirm(
			"Run project agent?",
			`Profile "${args.agent}" is project-sourced. Continue?`,
		);
		confirmed = approved;
		plan = planAgentRun(registry, {
			agent: args.agent,
			sessionCwd: ctx.cwd,
			canConfirm: ctx.mode === "tui",
			confirmed,
			...(args.cwd !== undefined ? { cwd: args.cwd } : {}),
			...(args.nested !== undefined ? { nested: args.nested } : {}),
		});
	}
	if (!plan.ok) {
		return redactEnvelope(errEnvelope({
			code: plan.code,
			message: plan.message,
			traceId,
			agent: args.agent,
			durationMs: Date.now() - startedAt,
		}));
	}
	const { profile, cwd } = plan;

	const roleRegistry = await loadRoleRegistry();
	const roleResolution = resolveRole(profile.role, roleRegistry, ctx.modelRegistry.getAvailable(), {
		scoped: buildScopedList(ctx),
	});
	if (roleResolution.kind === "error" || !roleResolution.spec.provider || !roleResolution.spec.model) {
		return redactEnvelope(errEnvelope({
			code: "role_unavailable",
			message: `role "${profile.role}" is not available for agent "${args.agent}"`,
			traceId,
			agent: args.agent,
			durationMs: Date.now() - startedAt,
		}));
	}
	const profileModel = ctx.modelRegistry.find(roleResolution.spec.provider, roleResolution.spec.model);
	if (!profileModel) {
		return redactEnvelope(errEnvelope({
			code: "model_unavailable",
			message: `model ${roleResolution.spec.provider}/${roleResolution.spec.model} is not available for agent "${args.agent}"`,
			traceId,
			agent: args.agent,
			durationMs: Date.now() - startedAt,
		}));
	}

	let session: Awaited<ReturnType<typeof createAgentSession>>["session"] | undefined;
	try {
		const agentDir = getAgentDir();
		const loader = new DefaultResourceLoader({
			cwd,
			agentDir,
			noExtensions: true,
			noSkills: true,
			noPromptTemplates: true,
			noThemes: true,
			additionalExtensionPaths: [],
			appendSystemPromptOverride: () => [profile.instructions],
		});
		await loader.reload();
		const sessionManager = SessionManager.inMemory(cwd);
		const tools = Array.isArray(profile.tools) && profile.tools.length > 0 ? profile.tools : undefined;
		const created = await createAgentSession({
			cwd,
			agentDir,
			resourceLoader: loader,
			sessionManager,
			model: profileModel,
			...(roleResolution.spec.thinkingLevel ? { thinkingLevel: roleResolution.spec.thinkingLevel } : {}),
			...(tools ? { tools } : {}),
		});
		session = created.session;

		// Two independent stop conditions: the profile timeout, and the
		// caller's AbortSignal (tool cancellation / session teardown).
		// `raceOutcome` also bounds the wait itself, so a session whose
		// abort never settles still resolves instead of hanging forever.
		let timedOut = false;
		let cancelled = false;
		const timer = setTimeout(() => {
			timedOut = true;
			void session?.abort().catch(() => undefined);
		}, profile.timeoutMs);
		const onExternalAbort = () => {
			cancelled = true;
			void session?.abort().catch(() => undefined);
		};
		if (signal) {
			if (signal.aborted) onExternalAbort();
			else signal.addEventListener("abort", onExternalAbort, { once: true });
		}

		try {
			await Promise.race([
				(async () => {
					await session?.prompt(args.task);
					await session?.waitForIdle();
				})(),
				// Hard upper bound slightly above the profile timeout so
				// a stuck abort path can never outlive the caller.
				new Promise<void>((resolve) => setTimeout(resolve, profile.timeoutMs + SUBAGENT_ABORT_GRACE_MS)),
			]);
		} finally {
			clearTimeout(timer);
			if (signal) signal.removeEventListener("abort", onExternalAbort);
		}

		if (cancelled) {
			return redactEnvelope(errEnvelope({
				code: "cancelled",
				message: `agent "${args.agent}" was cancelled by the caller`,
				traceId,
				agent: args.agent,
				durationMs: Date.now() - startedAt,
			}));
		}

		if (timedOut) {
			return redactEnvelope(errEnvelope({
				code: "timeout",
				message: `agent "${args.agent}" exceeded timeout of ${profile.timeoutMs}ms`,
				traceId,
				agent: args.agent,
				durationMs: Date.now() - startedAt,
			}));
		}

		const extraction = extractRunResult(session.messages, profile.maxOutputChars);
		if (!extraction.ok) {
			return redactEnvelope(errEnvelope({
				code: extraction.code,
				message: sanitizeCompactError(extraction.message),
				traceId,
				agent: args.agent,
				durationMs: Date.now() - startedAt,
			}));
		}

		return redactEnvelope(okEnvelope({
			output: extraction.output,
			traceId,
			agent: args.agent,
			durationMs: Date.now() - startedAt,
			...(extraction.usage ? { usage: extraction.usage } : {}),
		}));
	} catch (err) {
		return redactEnvelope(errEnvelope({
			code: "execution_failed",
			message: sanitizeCompactError(describeRunError(err)),
			traceId,
			agent: args.agent,
			durationMs: Date.now() - startedAt,
		}));
	} finally {
		try {
			session?.dispose();
		} catch {
			// ignore dispose failures
		}
	}
}

function formatEnvelope(env: ResultEnvelope): string {
	if (env.ok) {
		// A successful run can legitimately return empty output — an
		// assistant turn with no text part, or output truncated away to
		// nothing. Guarding on `env.output` alone made that fall through
		// to the error branch and render "(no error message)", which
		// reported a successful run as an unexplained failure.
		const output = env.output && env.output.length > 0 ? env.output : "(no output)";
		return `[${env.agent} ${env.traceId}] ${output}`;
	}
	// Surface the stable error code. Without it the user sees only prose,
	// and a message that fails to render leaves no way to tell a timeout
	// from a cancelled run from a missing role.
	const code = env.error?.code ? ` ${env.error.code}:` : "";
	const errMsg = env.error?.message ? env.error.message : "(no error message)";
	return `[${env.agent} ${env.traceId} error]${code} ${errMsg}`;
}
