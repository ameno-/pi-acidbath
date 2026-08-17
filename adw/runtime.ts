import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { execSync } from "node:child_process";
import type {
  AgentDef,
  DipPipeline,
  Envelope,
  DipContext,
  DipResult,
  DipProgressEvent,
  Phase,
} from "./types.ts";
import type { TSchema } from "typebox";
import { mergeAgentCatalog } from "./agents.ts";
import { verifyGates } from "./gates.ts";
import { resolveOutputSchema } from "./envelope.ts";

export type ProgressCallback = (event: DipProgressEvent) => void;

/** The only boundary through which an agent phase can affect the runtime. */
export interface AgentPhaseRequest {
  agent: string;
  agentDef: AgentDef;
  prompt: string;
  cwd: string;
  runId: string;
  phaseId: string;
  /** Resolved from `phase.output`. Absent means the free-text handoff. */
  outputSchema?: TSchema;
}

export type AgentPhaseExecutor = (request: AgentPhaseRequest) => Promise<Envelope>;
export type CodePhaseExecutor = (command: string, cwd: string) => string;

/**
 * Injection seam only: the runtime never calls AGY or any provider. Production
 * AGY extension wiring for research phases is deferred to bd-acid009; tests and
 * consumers supply a `ResearchPhaseExecutor` (mirroring `dispatchAgent`). The
 * executor returns the free-text `Envelope` contract; bounded source URLs belong
 * in `Envelope.artifacts`.
 */
export interface ResearchPhaseRequest {
  prompt: string;
  cwd: string;
  runId: string;
  phaseId: string;
}

export type ResearchPhaseExecutor = (request: ResearchPhaseRequest) => Promise<Envelope>;

/** R1 contract: research envelopes carry a bounded, ordered source-artifact list. */
export const RESEARCH_MAX_ARTIFACTS = 20;

/**
 * Dependency injection makes a whole pipeline replayable in tests: no clock,
 * UUID, shell, or LLM/provider access is hidden inside orchestration logic.
 */
export interface DipRuntimeDependencies {
  cwd?: string;
  now?: () => number;
  runIdFactory?: () => string;
  executeCode?: CodePhaseExecutor;
  dispatchAgent?: AgentPhaseExecutor;
  dispatchResearch?: ResearchPhaseExecutor;
  catalog?: Record<string, AgentDef>;
}

export class DipRuntime {
  private readonly onProgress: ProgressCallback;
  private readonly cwd: string;
  private readonly now: () => number;
  private readonly newRunId: () => string;
  private readonly executeCode: CodePhaseExecutor;
  private readonly dispatchAgent?: AgentPhaseExecutor;
  private readonly dispatchResearch?: ResearchPhaseExecutor;
  private readonly catalog: Record<string, AgentDef>;

  constructor(onProgress: ProgressCallback = () => {}, dependencies: DipRuntimeDependencies = {}) {
    this.onProgress = onProgress;
    this.cwd = dependencies.cwd ?? process.cwd();
    this.now = dependencies.now ?? Date.now;
    this.newRunId = dependencies.runIdFactory ?? (() => `dip-${randomUUID().slice(0, 8)}`);
    this.executeCode = dependencies.executeCode ?? ((command, cwd) =>
      execSync(command, { cwd, encoding: "utf-8", timeout: 60_000 })
    );
    this.dispatchAgent = dependencies.dispatchAgent;
    this.dispatchResearch = dependencies.dispatchResearch;
    this.catalog = dependencies.catalog ?? {};
  }

  /** Load a .dip YAML file from disk. */
  loadPipeline(path: string): DipPipeline {
    return mergeAgentCatalog(this.parseDip(readFileSync(path, "utf-8")), this.catalog);
  }

  /**
   * Minimal, deliberately constrained parser for the supported `.dip` subset.
   * Pipeline validation belongs at the contract boundary; this parser preserves
   * source phase order and never executes values while parsing them.
   */
  parseDip(content: string): DipPipeline {
    const pipeline: DipPipeline = { name: "", description: "", agents: {}, phases: [] };
    let section: string | null = null;
    let agentName: string | null = null;
    let inPhase = false;

    for (const raw of content.split("\n")) {
      const trimmed = raw.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const indent = raw.search(/\S/);

      if (indent === 0 && trimmed.endsWith(":") && !trimmed.startsWith("-")) {
        section = trimmed.slice(0, -1);
        agentName = null;
        inPhase = false;
        continue;
      }

      if (indent === 0 && trimmed.includes(":") && !trimmed.startsWith("-")) {
        const [key, value] = splitProperty(trimmed);
        if (key === "name") pipeline.name = value;
        else if (key === "description") pipeline.description = value;
        continue;
      }

      if (section === "agents" && indent === 2 && trimmed.endsWith(":") && !trimmed.startsWith("-")) {
        agentName = trimmed.slice(0, -1);
        pipeline.agents[agentName] = {
          name: agentName,
          model: "",
          tools: [],
          system_prompts: [],
        };
        inPhase = false;
        continue;
      }

      if (section === "agents" && agentName && indent === 4 && trimmed.includes(":")) {
        const [key, value] = splitProperty(trimmed);
        const agent = pipeline.agents[agentName];
        if (key === "model") agent.model = value;
        else if (key === "thinking") agent.thinking = value;
        else if (key === "tools") agent.tools = parseInlineList(value);
        else if (key === "system_prompts") agent.system_prompts = parseInlineList(value);
        else if (key === "writes") agent.writes = parseInlineList(value);
        continue;
      }

      if (section === "phases" && trimmed.startsWith("- id:")) {
        pipeline.phases.push({ id: trimmed.slice("- id:".length).trim(), kind: "agent" });
        inPhase = true;
        continue;
      }

      if (section === "phases" && inPhase && indent >= 4 && trimmed.includes(":")) {
        const [key, value] = splitProperty(trimmed);
        const phase = pipeline.phases[pipeline.phases.length - 1];
        if (key === "kind") phase.kind = value as Phase["kind"];
        else if (key === "agent") phase.agent = value;
        else if (key === "prompt") phase.prompt = value;
        else if (key === "command") phase.command = value;
        else if (key === "halt") phase.halt = value === "true";
        else if (key === "gates") phase.gates = parseInlineList(value);
        else if (key === "output") phase.output = value;
      }
    }

    return pipeline;
  }

  /** Execute phases in source order, stopping on a gate, phase failure, or human halt. */
  async run(pipeline: DipPipeline, prompt: string): Promise<DipResult> {
    const runId = this.newRunId();
    const startTime = this.now();
    const envelopes: Record<string, Envelope> = {};
    const logs: string[] = [];
    let status: DipResult["status"] = "success";

    this.onProgress({ type: "dip_start", name: pipeline.name, run_id: runId });

    const resolved = mergeAgentCatalog(pipeline, this.catalog);
    const ctx: DipContext = {
      cwd: this.cwd,
      agents: resolved.agents,
      prompt,
      envelopes,
      run_id: runId,
    };

    for (const phase of pipeline.phases) {
      this.onProgress({ type: "phase_start", id: phase.id, kind: phase.kind, agent: phase.agent });
      logs.push(`[${phase.id}] Starting phase (kind=${phase.kind})`);

      const resolvedPrompt = this.resolveTemplate(phase.prompt ?? "", {
        prompt,
        run_id: runId,
        ...Object.fromEntries(Object.entries(envelopes).map(([id, envelope]) => [id, envelope.summary])),
      });
      const envelope = await this.executePhase(phase, ctx, resolvedPrompt, logs);

      const gateResults = await verifyGates(phase, envelope);
      for (const gate of gateResults) {
        this.onProgress({ type: "gate_check", id: phase.id, gate: gate.name, passed: gate.passed });
        logs.push(`[${phase.id}] Gate ${gate.name}: ${gate.passed ? "PASS" : `FAIL — ${gate.violations.join(", ")}`}`);
      }

      if (!gateResults.every((gate) => gate.passed)) {
        envelope.status = "fail";
        status = "fail";
        logs.push(`[${phase.id}] Gates failed, stopping pipeline`);
      }

      envelopes[phase.id] = envelope;
      this.onProgress({ type: "phase_end", id: phase.id, status: envelope.status, envelope });

      if (status === "fail" || envelope.status === "fail") {
        status = "fail";
        logs.push(`[${phase.id}] Phase failed, stopping pipeline`);
        break;
      }

      if (phase.kind === "halt" || phase.kind === "engineer" || phase.halt === true) {
        status = "halted";
        this.onProgress({ type: "halt", id: phase.id, message: resolvedPrompt });
        logs.push(`[${phase.id}] Awaiting human validation`);
        break;
      }
    }

    this.onProgress({ type: "dip_end", status, envelopes });
    return { status, envelopes, duration_ms: this.now() - startTime, logs };
  }

  resolveTemplate(template: string, vars: Record<string, string>): string {
    return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? `{{${key}}}`);
  }

  private async executePhase(
    phase: Phase,
    ctx: DipContext,
    resolvedPrompt: string,
    logs: string[],
  ): Promise<Envelope> {
    switch (phase.kind) {
      case "agent": {
        if (!phase.agent || !ctx.agents[phase.agent]) {
          return failedEnvelope(phase, `Unknown agent: ${phase.agent ?? "(missing)"}`);
        }
        if (!this.dispatchAgent) {
          return failedEnvelope(phase, "No agent executor configured");
        }
        logs.push(`[${phase.id}] Dispatching agent=${phase.agent}`);
        // An unknown schema name throws rather than silently downgrading the
        // phase to an untyped handoff, so a typo in a .dip fails at the phase
        // it was written on.
        let outputSchema: TSchema | undefined;
        try {
          outputSchema = resolveOutputSchema(phase.output);
        } catch (error) {
          return failedEnvelope(
            phase,
            error instanceof Error ? error.message : String(error),
          );
        }
        const envelope = await this.dispatchAgent({
          agent: phase.agent,
          agentDef: ctx.agents[phase.agent],
          prompt: resolvedPrompt,
          cwd: ctx.cwd,
          runId: ctx.run_id,
          phaseId: phase.id,
          outputSchema,
        });
        return { ...envelope, agent_name: envelope.agent_name ?? phase.agent, phase_id: phase.id };
      }

      case "code":
        if (!phase.command) return failedEnvelope(phase, "No command specified for code phase");
        try {
          const output = this.executeCode(phase.command, ctx.cwd);
          logs.push(`[${phase.id}] Command executed: ${output.slice(0, 200)}`);
          return successEnvelope(phase, `Command: ${phase.command}`);
        } catch (error) {
          return failedEnvelope(phase, `Command failed: ${error instanceof Error ? error.message : String(error)}`);
        }

      case "halt":
        return successEnvelope(phase, "Awaiting human validation");

      case "research": {
        if (!this.dispatchResearch) {
          return failedEnvelope(phase, "No research executor configured");
        }
        logs.push(`[${phase.id}] Dispatching research`);
        const envelope = await this.dispatchResearch({
          prompt: resolvedPrompt,
          cwd: ctx.cwd,
          runId: ctx.run_id,
          phaseId: phase.id,
        });
        return { ...envelope, phase_id: phase.id, artifacts: envelope.artifacts.slice(0, RESEARCH_MAX_ARTIFACTS) };
      }

      case "engineer":
        return successEnvelope(phase, "Awaiting human input");

      default:
        return failedEnvelope(phase, `Unknown phase kind: ${(phase as Phase).kind}`);
    }
  }
}

function successEnvelope(phase: Phase, summary: string): Envelope {
  return { status: "success", summary, artifacts: [], notes_for_next_agent: "", phase_id: phase.id };
}

function failedEnvelope(phase: Phase, summary: string): Envelope {
  return { status: "fail", summary, artifacts: [], notes_for_next_agent: "", phase_id: phase.id };
}

function splitProperty(value: string): [string, string] {
  const index = value.indexOf(":");
  const key = value.slice(0, index).trim();
  const raw = value.slice(index + 1).trim();
  return [key, raw.replace(/^["']|["']$/g, "")];
}

function parseInlineList(value: string): string[] {
  return value
    .replace(/^\[|\]$/g, "")
    .split(",")
    .map((item) => item.trim().replace(/^["'@]|["']$/g, ""))
    .filter(Boolean);
}
