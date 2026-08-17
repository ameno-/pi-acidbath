import { loadAgentCatalog } from "./agents.ts";
import { DelegateSystem } from "./delegate.ts";
import { DipRuntime, type DipRuntimeDependencies, type ProgressCallback } from "./runtime.ts";

/** Production runtime: catalog agents + live Pi delegate. Tests construct DipRuntime directly. */
export function createDipRuntime(
  onProgress: ProgressCallback = () => {},
  dependencies: DipRuntimeDependencies = {},
): DipRuntime {
  const catalog = dependencies.catalog ?? loadAgentCatalog();
  const delegate = new DelegateSystem((event) => {
    onProgress({
      type: "phase_progress",
      id: event.phaseId ?? "agent",
      message: event.type,
    });
  });
  return new DipRuntime(onProgress, {
    ...dependencies,
    catalog,
    dispatchAgent: dependencies.dispatchAgent ?? (async (request) =>
      delegate.dispatchPi({
        agent: request.agentDef,
        prompt: request.prompt,
        cwd: request.cwd,
        runId: request.runId,
        phaseId: request.phaseId,
        outputSchema: request.outputSchema,
      })
    ),
  });
}
