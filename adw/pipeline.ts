/**
 * adw/pipeline.ts — the whole orchestration layer.
 *
 * There used to be a `.dip` file format, a hand-rolled parser for it, a
 * `{{template}}` engine with path resolution, a phase table, and a gate
 * registry: about 1,200 lines expressing what a TypeScript function expresses
 * natively, minus the type checking. A pipeline is now just an async function.
 *
 * What that buys, concretely:
 *   - `gather.findings[0].claim` is checked by the compiler. The DSL could only
 *     fail at runtime, and its failure mode was leaving the text `{{...}}` in a
 *     prompt for a model to puzzle over.
 *   - Control flow is `if` / `for` / `return`, not `halt: true` plus a phase
 *     table. Halting is returning.
 *   - A typo is a compile error rather than a silently dropped key.
 *
 * What is deliberately kept from the runtime it replaces: *code decides the
 * order, agents only reason inside a step*. That property never came from the
 * `.dip` file — it comes from the orchestrator not being a model. A plain
 * function has it just as completely.
 */

import { randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Static, TSchema } from "typebox";
import { DelegateSystem } from "./delegate.ts";
import { livePreflight } from "./preflight.ts";
import type { SubmitMode } from "./envelope.ts";
import type { AgentDef, Envelope } from "./types.ts";

const RUNS_DIR = join(dirname(fileURLToPath(import.meta.url)), "runs");

/** An envelope plus the fields its schema promised. This is the payoff. */
export type Typed<S extends TSchema> = Envelope & Static<S>;

export interface DispatchRequest<S extends TSchema> {
  agent: AgentDef;
  /** Label for the run log and progress output. */
  phase: string;
  prompt: string;
  output: S;
  submitMode?: SubmitMode;
  /**
   * Replaces the agent's own tool list. A scoped dispatch uses this to make a
   * capability out of an agent: given one tool, it cannot elect another job.
   */
  tools?: string[];
  systemPrompts?: string[];
  timeoutMs?: number;
}

export interface RunContext {
  cwd: string;
  runId: string;
  dispatch<S extends TSchema>(request: DispatchRequest<S>): Promise<Typed<S>>;
  /** Progress line to stderr; structured results go to stdout. */
  note(message: string): void;
}

/** One row per dispatch, appended to adw/runs/runs.jsonl. */
interface PhaseRecord {
  id: string;
  status: string;
  agent?: string;
  model?: string;
  duration_ms?: number;
  tokens?: number;
  missing_submit?: boolean;
  summary: string;
}

export interface PipelineResult<T> {
  status: "success" | "fail" | "halted";
  result?: T;
  phases: PhaseRecord[];
  duration_ms: number;
}

/** What a pipeline body returns. Anything else it wants to say rides alongside. */
export interface Outcome {
  status: "success" | "fail" | "halted";
}

export interface RunOptions {
  cwd?: string;
  runIdFactory?: () => string;
  now?: () => number;
  /** Injected whole in tests, so no test needs credentials or a provider. */
  dispatch?: <S extends TSchema>(request: DispatchRequest<S>, ctx: { cwd: string; runId: string }) => Promise<Typed<S>>;
  /** Returns the reason to refuse the run, or undefined. Pass null to skip. */
  preflight?: ((agents: AgentDef[]) => Promise<string | undefined>) | null;
  /** Agents to preflight before the first dispatch. */
  uses?: AgentDef[];
  onNote?: (message: string) => void;
  recordRun?: boolean;
}

/**
 * Run a pipeline body with a dispatcher, a run id, and the run log attached.
 *
 * The preflight stays because it is the one check with a measured hit rate:
 * five of the first nine runs died on a model spec that did not resolve, each
 * discovered after a dispatch had been paid for. It refuses in ~30ms instead.
 */
export async function runPipeline<T extends Outcome>(
  name: string,
  body: (ctx: RunContext) => Promise<T>,
  options: RunOptions = {},
): Promise<PipelineResult<T>> {
  const cwd = options.cwd ?? process.cwd();
  const runId = (options.runIdFactory ?? (() => `dip-${randomUUID().slice(0, 8)}`))();
  const now = options.now ?? Date.now;
  const note = options.onNote ?? ((message: string) => console.error(message));
  const started = now();
  const phases: PhaseRecord[] = [];

  note(`▸ ${name}  run=${runId}`);

  const finish = (status: PipelineResult<T>["status"], result?: T, error?: string) => {
    const outcome: PipelineResult<T> = { status, result, phases, duration_ms: now() - started };
    if (options.recordRun !== false) recordRun(name, status, phases, error);
    return outcome;
  };

  // Preflight before the first dispatch.
  const preflight = options.preflight === null ? undefined : options.preflight ?? livePreflight;
  if (preflight && options.uses?.length) {
    let refusal: string | undefined;
    try {
      refusal = await preflight(options.uses);
    } catch (error) {
      // A check that cannot run must not be the thing that decides.
      note(`  preflight skipped — the check itself failed: ${message(error)}`);
    }
    if (refusal) {
      note(refusal);
      return finish("fail", undefined, refusal);
    }
  }

  const delegate = new DelegateSystem();
  const dispatch = async <S extends TSchema>(request: DispatchRequest<S>): Promise<Typed<S>> => {
    if (options.dispatch) {
      const injected = await options.dispatch(request, { cwd, runId });
      phases.push(record(request, injected));
      return injected;
    }
    note(`  ├ ${request.phase} (${request.agent.name})`);
    const envelope = (await delegate.dispatchPi({
      agent: request.tools ? { ...request.agent, tools: request.tools } : request.agent,
      prompt: request.prompt,
      cwd,
      runId,
      phaseId: request.phase,
      outputSchema: request.output,
      submitMode: request.submitMode ?? "strict",
      systemPromptOverrides: request.systemPrompts,
      timeoutMs: request.timeoutMs,
    })) as Typed<S>;
    phases.push(record(request, envelope));
    note(`  ├ ${request.phase}: ${envelope.status} (${Math.round((envelope.duration_ms ?? 0) / 1000)}s)`);
    return envelope;
  };

  try {
    const result = await body({ cwd, runId, dispatch, note });
    return finish(result.status, result);
  } catch (error) {
    note(`  ✗ ${message(error)}`);
    return finish("fail", undefined, message(error));
  }
}

function record(request: DispatchRequest<TSchema>, envelope: Envelope): PhaseRecord {
  return {
    id: request.phase,
    status: envelope.status,
    agent: envelope.agent_name ?? request.agent.name,
    model: envelope.model_used,
    duration_ms: envelope.duration_ms,
    tokens: envelope.usage?.tokens,
    missing_submit: envelope.submit_missing,
    summary: String(envelope.summary ?? "").slice(0, 300),
  };
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The evidence base. "Did the model actually call submit?" must be a query, not
 * a memory — rule 3. Never throws: a logging failure must not fail a good run.
 */
function recordRun(name: string, status: string, phases: PhaseRecord[], error?: string): void {
  try {
    mkdirSync(RUNS_DIR, { recursive: true });
    appendFileSync(
      join(RUNS_DIR, "runs.jsonl"),
      `${JSON.stringify({
        at: new Date().toISOString(),
        pipeline: name,
        status,
        ...(error ? { error: error.slice(0, 300) } : {}),
        phases,
      })}\n`,
      "utf8",
    );
  } catch {
    // Best-effort only.
  }
}
