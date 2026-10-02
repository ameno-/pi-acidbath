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
	defaultAgentRegistry,
	errEnvelope,
	findAgent,
	type AgentProfile,
	type AgentRegistry,
	type ResultEnvelope,
	listAgents,
	okEnvelope,
	parseAgentRegistry,
	redactEnvelope,
	truncateOutput,
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
	defaultMagicRegistry,
	formatMagicHints,
	type MagicMatch,
	type MagicRegistry,
	matchMagicWords,
	parseMagicRegistry,
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
	defaultRoleRegistry,
	describeResolution,
	type RoleRegistry,
	type RoleResolution,
	type RoleSnapshot,
	type RoleSpec,
	type ThinkingLevel,
	parseRoleRegistry,
	resolveRole,
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

async function loadMagicRegistry(): Promise<MagicRegistry> {
	const filePath = resolveRegistryPath("PI_ACIDBATH_MAGIC_PATH", "config/magic.example.json");
	try {
		const raw = await readJsonFile(filePath);
		return parseMagicRegistry(raw);
	} catch {
		return defaultMagicRegistry();
	}
}

async function loadRoleRegistry(): Promise<RoleRegistry> {
	const filePath = resolveRegistryPath("PI_ACIDBATH_ROLES_PATH", "config/roles.example.json");
	try {
		const raw = await readJsonFile(filePath);
		return parseRoleRegistry(raw);
	} catch {
		return defaultRoleRegistry();
	}
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
): Promise<void> {
	if (resolution.kind === "error") {
		ctx.ui.notify(describeResolution(resolution), "warning");
		return;
	}
	const spec: RoleSpec = resolution.spec;
	if (!spec.provider || !spec.model) {
		ctx.ui.notify(`role "${spec.alias}" did not resolve to a provider/model`, "warning");
		return;
	}
	const target = findModelByPair(ctx.modelRegistry, spec.provider, spec.model);
	if (!target) {
		ctx.ui.notify(`model ${spec.provider}/${spec.model} not available`, "warning");
		return;
	}
	const modelObj = ctx.modelRegistry.find(target.provider, target.id);
	if (!modelObj) {
		ctx.ui.notify(`model ${target.provider}/${target.id} not registered`, "warning");
		return;
	}
	const ok = await pi.setModel(modelObj);
	if (!ok) {
		ctx.ui.notify(`setModel rejected ${target.provider}/${target.id}`, "warning");
		return;
	}
	if (spec.thinkingLevel) {
		pi.setThinkingLevel(spec.thinkingLevel);
	}
	if (Array.isArray(spec.tools) && spec.tools.length > 0) {
		pi.setActiveTools(spec.tools);
	}
	ctx.ui.notify(describeResolution(resolution), "info");
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

		// Restore the latest persisted magic registry override.
		try {
			const branch = getRawBranch(ctx);
			let latest: HarnessMagicState | undefined;
			for (let i = branch.length - 1; i >= 0; i--) {
				const entry = branch[i];
				if (entry.type === "custom" && entry.customType === MAGIC_STATE_ENTRY_TYPE) {
					if (isMagicState(entry.data)) latest = entry.data;
					break;
				}
			}
			if (latest) magicState = { registry: latest.registry, pendingMatches: [] };
		} catch {
			// Keep the config-backed registry when persisted state is malformed.
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
			if (roleState.selector && ctx.model) {
				const registry = await loadRoleRegistry();
				const scoped = buildScopedList(ctx);
				const resolution = resolveRole(roleState.selector, registry, ctx.modelRegistry.getAvailable(), { scoped });
				if (resolution.kind !== "error") {
					await applyRoleResolution(pi, resolution, ctx as ExtensionCommandContext);
				}
			}
		} catch {
			roleState = {};
		}
	});

	// ─── input: transform exact-prose magic matches ───────────────────
	pi.on("input", async (event, _ctx) => {
		const matches = matchMagicWords(event.text, magicState.registry);
		magicState.pendingMatches = matches;
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
	});

	// ─── /magic ───────────────────────────────────────────────────────
	pi.registerCommand("magic", {
		description: "Harness magic-word control (list|enable <id>|disable <id>)",
		handler: async (args, ctx) => {
			const text = args.trim();
			if (!text || text === "list") {
				const lines: string[] = [];
				lines.push(`magic registry: enabled=${magicState.registry.enabled}`);
				if (magicState.registry.keywords.length === 0) {
					lines.push("  (no keywords)");
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
			const id = parts[1];
			if ((verb === "enable" || verb === "disable") && (!id || !/^[\w-]+$/.test(id))) {
				ctx.ui.notify("usage: /magic enable <id> | /magic disable <id>", "warning");
				return;
			}
			const next: MagicRegistry = {
				enabled: magicState.registry.enabled,
				keywords: magicState.registry.keywords.map((k) => {
					if (k.id !== id) return { ...k };
					return { ...k, enabled: verb === "enable" };
				}),
			};
			magicState.registry = next;
			pi.appendEntry<HarnessMagicState>(MAGIC_STATE_ENTRY_TYPE, magicState);
			ctx.ui.notify(`magic: ${id} ${verb}d`, "info");
		},
	});

	// ─── /role ────────────────────────────────────────────────────────
	pi.registerCommand("role", {
		description: "Harness role routing (list|set <alias>|clear|resolve <alias>)",
		handler: async (args, ctx) => {
			const text = args.trim();
			if (!text || text === "list") {
				const registry = await loadRoleRegistry();
				const lines: string[] = [];
				lines.push(`roles (${registry.aliases.length}):`);
				for (const spec of registry.aliases) {
					lines.push(`  ${spec.alias} = ${spec.provider ?? "(ref " + (spec.ref ?? "?") + ")"} / ${spec.model ?? "?"}`);
				}
				lines.push(`fallback: ${registry.fallback.join(", ") || "(none)"}`);
				if (roleState.selector) lines.push(`active: ${roleState.selector}`);
				ctx.ui.notify(lines.join("\n"), "info");
				return;
			}
			const parts = text.split(/\s+/);
			const verb = parts[0];
			const selector = parts.slice(1).join(" ");

			if (verb === "resolve") {
				if (!selector) {
					ctx.ui.notify("usage: /role resolve <alias>", "warning");
					return;
				}
				const registry = await loadRoleRegistry();
				const scoped = buildScopedList(ctx);
				const available = ctx.modelRegistry.getAvailable();
				const resolution = resolveRole(selector, registry, available, { scoped });
				ctx.ui.notify(describeResolution(resolution), resolution.kind === "error" ? "warning" : "info");
				return;
			}

			if (verb === "clear") {
				if (roleState.snapshot) {
					await restoreSnapshot(pi, roleState.snapshot, ctx);
				}
				roleState = {};
				pi.appendEntry<HarnessRoleState>(ROLE_STATE_ENTRY_TYPE, roleState);
				ctx.ui.notify("role cleared", "info");
				return;
			}

			if (verb === "set") {
				if (!selector) {
					ctx.ui.notify("usage: /role set <alias[:thinking]>", "warning");
					return;
				}
				const registry = await loadRoleRegistry();
				const scoped = buildScopedList(ctx);
				const available = ctx.modelRegistry.getAvailable();
				const resolution = resolveRole(selector, registry, available, { scoped });

				if (resolution.kind === "error") {
					ctx.ui.notify(describeResolution(resolution), "warning");
					return;
				}

				if (!roleState.snapshot) {
					roleState.snapshot = captureRoleSnapshot(pi, ctx);
				}
				await applyRoleResolution(pi, resolution, ctx);
				roleState.selector = selector;
				pi.appendEntry<HarnessRoleState>(ROLE_STATE_ENTRY_TYPE, roleState);
				return;
			}

			ctx.ui.notify("usage: /role list|set <alias>|clear|resolve <alias>", "warning");
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

			const result = await ctx.newSession({
				parentSession: currentSessionFile,
				withSession: async (replacementCtx) => {
					replacementCtx.ui.setEditorText(edited);
					replacementCtx.ui.notify("handoff ready — review and submit when ready", "info");
				},
			});
			if (result.cancelled) {
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
			return {};
		}
		const compactModel = ctx.modelRegistry.find(compactResolution.spec.provider, compactResolution.spec.model);
		if (!compactModel) return {};

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
		if (!mapped.handled) return {};

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
		parallel: Type.Array(ParallelItem, { description: "Explicit parallel fan-out (respects registry maxConcurrency)" }),
		nested: Type.Optional(Type.Boolean({ description: "Whether this is a nested call (default false)", default: false })),
	});
	const SubagentParams = Type.Union([SubagentSingle, SubagentParallel]);

	return defineTool({
		name: "subagent",
		label: "Subagent",
		description: "Run an isolated Pi sub-session against a named agent profile. Single mode (agent + task) or explicit parallel mode (parallel[]). Nested fan-out requires the profile's allowNested=true.",
		parameters: SubagentParams,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx): Promise<AgentToolResult<{ envelopes: ResultEnvelope[] }>> {
			const envelopes: ResultEnvelope[] = [];
			if ("parallel" in params && Array.isArray(params.parallel)) {
				const registry = await loadAgentRegistry();
				const items = params.parallel;
				const concurrency = Math.max(1, Math.min(registry.maxConcurrency, items.length || 1));
				const results: ResultEnvelope[] = new Array(items.length);
				let next = 0;
				const workers = Array.from({ length: concurrency }, async () => {
					while (true) {
						const idx = next++;
						if (idx >= items.length) return;
						const item = items[idx];
						results[idx] = await runSubagent(pi, { agent: item.agent, task: item.task, cwd: item.cwd, nested: false }, ctx);
					}
				});
				await Promise.all(workers);
				envelopes.push(...results);
			} else if ("agent" in params && typeof params.agent === "string") {
				envelopes.push(await runSubagent(pi, params, ctx));
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
): Promise<ResultEnvelope> {
	const startedAt = Date.now();
	const traceId = `${args.agent}-${startedAt.toString(36)}`;

	const registry = await loadAgentRegistry();
	const profile = findAgent(registry, args.agent);
	if (!profile) {
		return redactEnvelope(errEnvelope({
			code: "unknown_agent",
			message: `agent "${args.agent}" is not registered`,
			traceId,
			agent: args.agent,
			durationMs: Date.now() - startedAt,
		}));
	}

	if (!profile.allowNested && args.nested === true) {
		return redactEnvelope(errEnvelope({
			code: "nested_not_allowed",
			message: `agent "${args.agent}" does not allow nested fan-out`,
			traceId,
			agent: args.agent,
			durationMs: Date.now() - startedAt,
		}));
	}

	if (profile.source === "project" && ctx.mode !== "tui") {
		return redactEnvelope(errEnvelope({
			code: "project_confirm_required",
			message: "project-sourced agents require TUI confirmation",
			traceId,
			agent: args.agent,
			durationMs: Date.now() - startedAt,
		}));
	}
	if (profile.source === "project" && ctx.mode === "tui") {
		const confirmed = await ctx.ui.confirm(
			"Run project agent?",
			`Profile "${args.agent}" is project-sourced. Continue?`,
		);
		if (!confirmed) {
			return redactEnvelope(errEnvelope({
				code: "cancelled",
				message: "user cancelled project agent run",
				traceId,
				agent: args.agent,
				durationMs: Date.now() - startedAt,
			}));
		}
	}

	const cwd = resolveCwd(profile, ctx.cwd, args.cwd);
	if (!cwd) {
		return redactEnvelope(errEnvelope({
			code: "no_cwd",
			message: `profile "${args.agent}" requires an explicit cwd`,
			traceId,
			agent: args.agent,
			durationMs: Date.now() - startedAt,
		}));
	}

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

		let timedOut = false;
		const timer = setTimeout(() => {
			timedOut = true;
			void session?.abort().catch(() => undefined);
		}, profile.timeoutMs);

		try {
			await session.prompt(args.task);
			await session.waitForIdle();
		} finally {
			clearTimeout(timer);
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

		const messages = session.messages;
		const final = [...messages].reverse().find((m) => m.role === "assistant");
		const textParts: string[] = [];
		if (final && final.role === "assistant" && Array.isArray(final.content)) {
			for (const part of final.content) {
				if (part.type === "text" && typeof part.text === "string") textParts.push(part.text);
			}
		}
		const output = truncateOutput(textParts.join("\n"), profile.maxOutputChars);

		let usage: { input: number; output: number } | undefined;
		if (final && final.role === "assistant" && final.usage) {
			usage = { input: final.usage.input, output: final.usage.output };
		}

		return redactEnvelope(okEnvelope({
			output,
			traceId,
			agent: args.agent,
			durationMs: Date.now() - startedAt,
			...(usage ? { usage } : {}),
		}));
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		return redactEnvelope(errEnvelope({
			code: "execution_failed",
			message: sanitizeCompactError(msg),
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

function resolveCwd(profile: AgentProfile, sessionCwd: string, explicit: string | undefined): string | undefined {
	if (profile.cwdPolicy === "explicit") {
		return explicit ?? profile.cwd;
	}
	if (profile.cwdPolicy === "profile") {
		return profile.cwd ?? explicit ?? sessionCwd;
	}
	// session
	return explicit ?? sessionCwd;
}

function formatEnvelope(env: ResultEnvelope): string {
	if (env.ok && env.output) {
		return `[${env.agent} ${env.traceId}] ${env.output}`;
	}
	const errMsg = env.error?.message ?? "(no error message)";
	return `[${env.agent} ${env.traceId} error] ${errMsg}`;
}
