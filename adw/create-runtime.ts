import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadAgentCatalog } from "./agents.ts";
import { DelegateSystem } from "./delegate.ts";
import { livePreflight } from "./preflight.ts";
import { DipRuntime, type DipRuntimeDependencies, type ProgressCallback } from "./runtime.ts";
import type { DipProgressEvent } from "./types.ts";

const RUNS_DIR = join(dirname(fileURLToPath(import.meta.url)), "runs");

/**
 * Append one line per finished run to adw/runs/runs.jsonl.
 *
 * This exists so "did the model actually call submit?" is a query rather than a
 * memory. It lives here, in the production wiring, rather than in DipRuntime:
 * the runtime's determinism tests construct DipRuntime directly and must stay
 * free of filesystem side effects.
 *
 * Never throws. A logging failure must not fail a run that otherwise succeeded.
 */
function recordRun(
  event: Extract<DipProgressEvent, { type: "dip_end" }>,
  error?: string,
): void {
  try {
    mkdirSync(RUNS_DIR, { recursive: true });
    const phases = Object.entries(event.envelopes).map(([id, envelope]) => ({
      id,
      status: envelope.status,
      agent: envelope.agent_name,
      model: envelope.model_used,
      duration_ms: envelope.duration_ms,
      tokens: envelope.usage?.tokens,
      cost: envelope.usage?.cost,
      // The question slice 1 exists to answer. Read from the flag the
      // dispatcher sets, not from the summary text: permissive mode returns a
      // missing submit as a success whose summary says nothing about it.
      // undefined means the phase declared no schema, so the question does not apply.
      missing_submit: envelope.submit_missing,
      summary: envelope.summary.slice(0, 300),
    }));
    appendFileSync(
      join(RUNS_DIR, "runs.jsonl"),
      `${JSON.stringify({
        at: new Date().toISOString(),
        status: event.status,
        // A run refused before phase 1 has no phases. Without the reason, that
        // line reads as an unexplained failure to whoever queries this later.
        ...(error ? { error: error.slice(0, 300) } : {}),
        phases,
      })}\n`,
      "utf8",
    );
  } catch {
    // Best-effort only.
  }
}

/** Production runtime: catalog agents + live Pi delegate. Tests construct DipRuntime directly. */
export function createDipRuntime(
  onProgress: ProgressCallback = () => {},
  dependencies: DipRuntimeDependencies = {},
): DipRuntime {
  const catalog = dependencies.catalog ?? loadAgentCatalog();

  // Tee dip_end to the run log without changing what callers observe. The last
  // dip_error is held so the run line can say why, since one runtime can run
  // several pipelines, dip_start clears it.
  let lastError: string | undefined;
  const observe: ProgressCallback = (event) => {
    if (event.type === "dip_start") lastError = undefined;
    if (event.type === "dip_error") lastError = event.error;
    if (event.type === "dip_end") recordRun(event, lastError);
    onProgress(event);
  };

  const delegate = new DelegateSystem((event) => {
    observe({
      type: "phase_progress",
      id: event.phaseId ?? "agent",
      message: event.type,
    });
  });
  return new DipRuntime(observe, {
    ...dependencies,
    catalog,
    checkModels: dependencies.checkModels ?? livePreflight,
    dispatchAgent: dependencies.dispatchAgent ?? (async (request) =>
      delegate.dispatchPi({
        agent: request.agentDef,
        prompt: request.prompt,
        cwd: request.cwd,
        runId: request.runId,
        phaseId: request.phaseId,
        outputSchema: request.outputSchema,
        submitMode: request.submitMode,
      })
    ),
  });
}
