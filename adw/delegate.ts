/**
 * adw/delegate.ts — Pi subagent dispatcher
 *
 * Uses Pi's SDK `createAgentSession()` to create in-process Pi sub-sessions,
 * mirroring the WorkflowAgent pattern from pi-dynamic-workflows.
 */

import { join } from "node:path";
import {
  createAgentSession,
  createCodingTools,
  createReadOnlyTools,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  getAgentDir,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { TSchema } from "typebox";
import type { AgentDef, Envelope } from "./types.ts";
import { createSubmitTool, SUBMIT_INSTRUCTION, type SubmitCapture } from "./envelope.ts";

// ─── Public types ────────────────────────────────────────────────────────────

export interface PiDispatchRequest {
  agent: AgentDef;
  prompt: string;
  cwd: string;
  systemPromptOverrides?: string[];
  runId?: string;
  phaseId?: string;
  timeoutMs?: number;
  /**
   * When set, the agent gets a `submit` tool whose parameters are this schema
   * and the phase fails unless it is called. When absent, the final assistant
   * message becomes the summary — the original free-text behaviour.
   */
  outputSchema?: TSchema;
}

export interface PiDispatchResult extends Envelope {
  session_id?: string;
  model_used?: string;
  usage?: {
    tokens: number;
    cost: number;
    input_tokens: number;
    output_tokens: number;
  };
}

export type DelegateProgressCallback = (event: {
  type: "agent_event" | "tool_call" | "tool_result" | "message";
  phaseId?: string;
  data: any;
}) => void;

/**
 * The parent, not a worker, owns Sideshow publication. This gives every
 * delegate result a small, structured handoff that an orchestrator can render
 * into its task card without exposing private reasoning or raw transcripts.
 */
export const SIDESHOW_HANDOFF_PROMPT = `
End your report with a compact "Board handoff" section:
- Status: success, failure, or blocked.
- Evidence: the most relevant artifact paths, findings, or validation fact.
- Risk/blocker: only if one remains.
- Next action: one concrete recommendation.
Do not include private chain-of-thought or an unbounded tool transcript.
`.trim();

// ─── Parsed model spec ───────────────────────────────────────────────────────

interface ModelSpec {
  provider: string;
  modelId: string;
  thinking?: string;
}

/**
 * Parse a model spec string such as:
 *   "gemini-3.6-flash"               → { provider: "ap-openai", modelId: "gemini-3.6-flash" }
 *   "anthropic/claude-opus-4-5"      → { provider: "anthropic",  modelId: "claude-opus-4-5" }
 *   "anthropic/claude-opus-4-5:high" → { provider: "anthropic",  modelId: "claude-opus-4-5", thinking: "high" }
 *   "claude-opus-4-5:medium"         → { provider: "ap-openai",  modelId: "claude-opus-4-5", thinking: "medium" }
 */
export function parseModelSpec(spec: string): ModelSpec {
  let rest = spec;
  let thinking: string | undefined;

  // Strip optional :thinkingLevel suffix (last colon-delimited token if it's a word)
  const thinkingMatch = rest.match(/^(.*):([a-z]+)$/);
  if (thinkingMatch) {
    rest = thinkingMatch[1];
    thinking = thinkingMatch[2];
  }

  // Strip optional provider/ prefix
  let provider = "ap-openai";
  const providerMatch = rest.match(/^([^/]+)\/(.+)$/);
  if (providerMatch) {
    provider = providerMatch[1];
    rest = providerMatch[2];
  }

  return { provider, modelId: rest, thinking };
}

// ─── Tool resolution ─────────────────────────────────────────────────────────

/**
 * Build a ToolDefinition list from an allowlist of tool names.
 * Draws from both coding tools (read/write/edit/bash/grep/find/ls)
 * and read-only tools for the given cwd.
 */
export function resolveTools(toolNames: string[], cwd: string): ToolDefinition[] {
  const all: ToolDefinition[] = [
    ...createReadOnlyTools(cwd),
    ...createCodingTools(cwd),
  ];

  // Deduplicate by name (coding tools is a superset; keep last occurrence)
  const byName = new Map<string, ToolDefinition>();
  for (const t of all) byName.set(t.name, t);

  if (toolNames.length === 0) return [];

  return toolNames
    .map((name) => byName.get(name))
    .filter((t): t is ToolDefinition => t !== undefined);
}

// ─── DelegateSystem ──────────────────────────────────────────────────────────

export interface DelegateDependencies {
  createSession?: typeof createAgentSession;
  createModelRuntime?: (agentDir: string) => Promise<ModelRuntime>;
  now?: () => number;
}

export class DelegateSystem {
  private readonly onProgress?: DelegateProgressCallback;
  private readonly createSession: typeof createAgentSession;
  private readonly createModelRuntime: (agentDir: string) => Promise<ModelRuntime>;
  private readonly now: () => number;

  constructor(onProgress?: DelegateProgressCallback, dependencies: DelegateDependencies = {}) {
    this.onProgress = onProgress;
    this.createSession = dependencies.createSession ?? createAgentSession;
    this.createModelRuntime = dependencies.createModelRuntime ?? ((agentDir) =>
      ModelRuntime.create({
        authPath: join(agentDir, "auth.json"),
        modelsPath: join(agentDir, "models.json"),
      })
    );
    this.now = dependencies.now ?? Date.now;
  }

  /**
   * Dispatch a prompt to a Pi headless sub-session.
   *
   * Creates an in-process AgentSession with the agent's tool allowlist and
   * model, sends the prompt, waits for the session to become idle, then
   * extracts the final assistant text and wraps it in a typed Envelope.
   *
   * Never throws — all errors are returned as Envelopes with status "fail".
   */
  async dispatchPi(request: PiDispatchRequest): Promise<PiDispatchResult> {
    const {
      agent,
      prompt,
      cwd,
      runId,
      phaseId,
      timeoutMs = 120_000,
      outputSchema,
    } = request;

    const startTime = this.now();
    const capture: SubmitCapture = {};

    try {
      // ── Model resolution ────────────────────────────────────────────────
      const modelSpec = parseModelSpec(agent.model);
      const thinkingLevel = (
        modelSpec.thinking ?? agent.thinking ?? "medium"
      ) as "low" | "medium" | "high" | "max" | undefined;

      const agentDir = getAgentDir();
      const modelRuntime = await this.createModelRuntime(agentDir);
      const model = modelRuntime.getModel(modelSpec.provider, modelSpec.modelId);
      if (!model) {
        throw new Error(`Configured model not found: ${modelSpec.provider}/${modelSpec.modelId}`);
      }

      // ── Tool setup ──────────────────────────────────────────────────────
      // `submit` is appended to both lists: `customTools` registers it and
      // `tools` is the allowlist that actually decides what the agent can call.
      const customTools = resolveTools(agent.tools, cwd);
      const toolNames = [...agent.tools];
      if (outputSchema) {
        customTools.push(createSubmitTool(outputSchema, capture));
        toolNames.push("submit");
      }

      // ── Session creation ────────────────────────────────────────────────
      const { session } = await this.createSession({
        cwd,
        agentDir,
        modelRuntime,
        model,
        thinkingLevel,
        customTools,
        // `customTools` only registers tools; `tools` is the actual allowlist.
        // An empty list therefore means no tools, rather than the SDK defaults.
        tools: toolNames,
        noTools: "all",
        sessionManager: SessionManager.inMemory(),
        settingsManager: SettingsManager.create(cwd, agentDir),
        // Subagents must not be able to spawn recursive orchestration tools.
        excludeTools: ["workflow", "workflow_control"],
      });

      // ── Progress forwarding ─────────────────────────────────────────────
      const unsubscribe = session.subscribe((event) => {
        this.onProgress?.({
          type: "agent_event",
          phaseId,
          data: event,
        });
      });

      try {
        // ── Timeout wrapper ───────────────────────────────────────────────
        const timeoutController = new AbortController();
      const timeoutHandle = setTimeout(
        () => timeoutController.abort(),
        timeoutMs,
      );

      try {
        // Build the full prompt, incorporating any system-prompt overrides as
        // a preamble so the subagent inherits dip-level instructions.
        // The prose handoff and the submit tool are mutually exclusive: asking
        // for a written report *and* a structured submission reliably produces
        // both, which is the duplication the schema exists to remove.
        const fullPrompt = [
          ...(request.systemPromptOverrides ?? agent.system_prompts ?? []),
          outputSchema ? SUBMIT_INSTRUCTION : SIDESHOW_HANDOFF_PROMPT,
          prompt,
        ]
          .filter(Boolean)
          .join("\n\n");

        // Send the prompt; this resolves once the agent is fully idle.
        await Promise.race([
          session.prompt(fullPrompt),
          new Promise<never>((_, reject) =>
            timeoutController.signal.addEventListener("abort", () =>
              reject(new Error(`Agent ${agent.name} timed out after ${timeoutMs}ms`)),
            ),
          ),
        ]);

        // Wait for the session to reach the fully idle state (covers any
        // auto-retry / compaction the session might trigger internally).
        await Promise.race([
          session.waitForIdle(),
          new Promise<never>((_, reject) =>
            timeoutController.signal.addEventListener("abort", () =>
              reject(new Error(`Agent ${agent.name} idle wait timed out`)),
            ),
          ),
        ]);
      } finally {
        clearTimeout(timeoutHandle);
      }

      // ── Extract final answer ────────────────────────────────────────────
      const finalText = session.getLastAssistantText() ?? "";

      // ── Usage stats ─────────────────────────────────────────────────────
      let usage: PiDispatchResult["usage"] | undefined;
      try {
        const stats = session.getSessionStats();
        if (stats.tokens.total > 0 || stats.cost > 0) {
          usage = {
            tokens: stats.tokens.total,
            cost: stats.cost,
            input_tokens: stats.tokens.input,
            output_tokens: stats.tokens.output,
          };
        }
      } catch {
        // Usage is best-effort; never let a stats failure mask the result.
      }

      const duration = this.now() - startTime;
      const resolvedModelSpec = `${modelSpec.provider}/${modelSpec.modelId}:${thinkingLevel}`;

      // ── Structured path ─────────────────────────────────────────────────
      // A phase that declared a schema is only complete when submit was
      // called. Falling back to the final message here would reintroduce the
      // untyped handoff the schema exists to prevent, so this fails instead.
      if (outputSchema) {
        if (!capture.value) {
          return {
            status: "fail",
            summary: `Agent ${agent.name} finished without calling submit`,
            artifacts: [],
            notes_for_next_agent:
              "The phase declared an output schema but the agent never submitted one.",
            agent_name: agent.name,
            phase_id: phaseId,
            model_used: resolvedModelSpec,
            duration_ms: duration,
            session_id: runId,
            usage,
          };
        }

        // Submitted fields spread first so run metadata below always wins.
        return {
          ...(capture.value as unknown as Envelope),
          agent_name: agent.name,
          phase_id: phaseId,
          model_used: resolvedModelSpec,
          duration_ms: duration,
          session_id: runId,
          usage,
        };
      }

      if (!finalText.trim()) {
        return {
          status: "fail",
          summary: `Agent ${agent.name} produced no output`,
          artifacts: [],
          notes_for_next_agent: "The agent completed its run but returned no text.",
          agent_name: agent.name,
          phase_id: phaseId,
          model_used: resolvedModelSpec,
          duration_ms: duration,
          session_id: runId,
          usage,
        };
      }

      return {
        status: "success",
        summary: finalText,
        artifacts: [],
        notes_for_next_agent: "",
        agent_name: agent.name,
        phase_id: phaseId,
        model_used: resolvedModelSpec,
        duration_ms: duration,
        session_id: runId,
        usage,
      };
      } finally {
        unsubscribe();
        session.dispose();
      }
    } catch (error: any) {
      return {
        status: "fail",
        summary: `Agent ${agent.name} failed: ${error?.message ?? String(error)}`,
        artifacts: [],
        notes_for_next_agent: `Error: ${error?.message ?? String(error)}`,
        agent_name: agent.name,
        phase_id: phaseId,
        duration_ms: this.now() - startTime,
      };
    }
  }
}
