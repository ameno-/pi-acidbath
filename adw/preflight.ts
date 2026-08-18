/**
 * adw/preflight.ts — resolve every model a run needs before it dispatches one.
 *
 * The defect this exists for: `parseModelSpec` defaults the provider to
 * `ap-openai`, so a bare `copilot-claude-opus-4.8` silently becomes
 * `ap-openai/copilot-claude-opus-4.8` and misses. Three of six agents shipped
 * that way, and each one was found the slow way — one phase at a time, after a
 * dispatch had already been paid for.
 *
 * Resolution here goes through the same `parseModelSpec` + `getModel` pair the
 * dispatcher uses, so the check cannot disagree with what a dispatch would do.
 * A separate reimplementation reading `models.json` would be a second opinion,
 * and a second opinion is exactly what a preflight must not be.
 */

import { join } from "node:path";
import { ModelRuntime, getAgentDir } from "@earendil-works/pi-coding-agent";
import type { AgentDef } from "./types.ts";
import { parseModelSpec } from "./delegate.ts";

/**
 * The slice of `ModelRuntime` a preflight needs, kept structural so tests can
 * supply a fixture catalog without credentials or a gateway.
 */
export interface ModelCatalog {
  getModel(providerId: string, modelId: string): unknown;
  getModels(providerId?: string): readonly { id: string; provider: string }[];
}

export interface ModelProblem {
  agent: string;
  /** The spec exactly as written in the agent file. */
  spec: string;
  /** What `parseModelSpec` made of it — the pair a dispatch would actually ask for. */
  provider: string;
  model: string;
  reason: "no-model" | "unknown-provider" | "unknown-model";
  /** Fully-qualified specs that do resolve, ranked most-likely first. */
  suggestions: string[];
}

const MAX_SUGGESTIONS = 3;

/** Check a set of agent definitions against a catalog. Never throws. */
export function checkAgentModels(agents: AgentDef[], catalog: ModelCatalog): ModelProblem[] {
  const problems: ModelProblem[] = [];
  const all = catalog.getModels();
  const providers = new Set(all.map((model) => model.provider));

  // Providers the healthy agents in this same set already resolve through.
  // When one agent of six is broken, the fix nearly always lives among the
  // providers the other five use, so those suggestions are ranked first.
  const inUse = new Set<string>();
  for (const agent of agents) {
    if (!agent.model) continue;
    const { provider, modelId } = parseModelSpec(agent.model);
    if (catalog.getModel(provider, modelId)) inUse.add(provider);
  }

  for (const agent of agents) {
    if (!agent.model) {
      problems.push({
        agent: agent.name,
        spec: "",
        provider: "",
        model: "",
        reason: "no-model",
        suggestions: [],
      });
      continue;
    }

    const { provider, modelId } = parseModelSpec(agent.model);
    if (catalog.getModel(provider, modelId)) continue;

    problems.push({
      agent: agent.name,
      spec: agent.model,
      provider,
      model: modelId,
      reason: providers.has(provider) ? "unknown-model" : "unknown-provider",
      suggestions: suggestFor(modelId, all, inUse),
    });
  }

  return problems;
}

/**
 * Rank candidates: the same id under a different provider first — that is the
 * missing-prefix case, and it is nearly always the answer — then ids that
 * contain the requested one, then ids contained by it.
 */
function suggestFor(
  modelId: string,
  all: readonly { id: string; provider: string }[],
  inUse: ReadonlySet<string>,
): string[] {
  const wanted = modelId.toLowerCase();
  const exact: { spec: string; provider: string }[] = [];
  const contains: { spec: string; provider: string }[] = [];
  const containedBy: { spec: string; provider: string }[] = [];

  for (const model of all) {
    const id = model.id.toLowerCase();
    const entry = { spec: `${model.provider}/${model.id}`, provider: model.provider };
    if (id === wanted) exact.push(entry);
    else if (id.includes(wanted)) contains.push(entry);
    else if (wanted.includes(id)) containedBy.push(entry);
  }

  const preferInUse = (entries: { spec: string; provider: string }[]) => [
    ...entries.filter((entry) => inUse.has(entry.provider)),
    ...entries.filter((entry) => !inUse.has(entry.provider)),
  ];

  return [...preferInUse(exact), ...preferInUse(contains), ...preferInUse(containedBy)]
    .map((entry) => entry.spec)
    .slice(0, MAX_SUGGESTIONS);
}

/** Render problems as an operator-facing block. One agent per stanza. */
export function formatModelProblems(problems: ModelProblem[], catalog?: ModelCatalog): string {
  const lines = [
    `${problems.length} agent${problems.length === 1 ? "" : "s"} named a model that does not resolve — nothing was dispatched.`,
    "",
  ];

  for (const problem of problems) {
    if (problem.reason === "no-model") {
      lines.push(`  ${problem.agent}: no model configured.`);
      lines.push("");
      continue;
    }
    lines.push(`  ${problem.agent}: ${problem.spec}`);
    lines.push(
      problem.reason === "unknown-provider"
        ? `    resolved to ${problem.provider}/${problem.model}; provider "${problem.provider}" is not registered.`
        : `    resolved to ${problem.provider}/${problem.model}; that provider serves no such model.`,
    );
    if (problem.suggestions.length > 0) {
      lines.push(`    did you mean: ${problem.suggestions.join(", ")}`);
    }
    lines.push("");
  }

  lines.push(
    "A spec without a provider prefix defaults to ap-openai, which is how a bare",
    "copilot-* model ends up unresolvable. Always write provider/model.",
    "A suggestion only means the registry can resolve it — not that the gateway",
    "serves it, or that this machine holds credentials for that provider.",
  );

  // The full provider list is 40-odd entries, most of them built-ins nobody
  // here uses. It earns its space only when there is no concrete suggestion.
  if (catalog && problems.every((problem) => problem.suggestions.length === 0)) {
    const providers = [...new Set(catalog.getModels().map((model) => model.provider))].sort();
    if (providers.length > 0) lines.push(`Known providers: ${providers.join(", ")}`);
  }

  return lines.join("\n");
}

/** The live catalog: the same agent dir, auth, and models file a dispatch reads. */
export async function defaultModelCatalog(): Promise<ModelCatalog> {
  const agentDir = getAgentDir();
  return (await ModelRuntime.create({
    authPath: join(agentDir, "auth.json"),
    modelsPath: join(agentDir, "models.json"),
  })) as unknown as ModelCatalog;
}

/**
 * Production preflight. Returns the reason a run must not start, or undefined
 * to proceed — the shape `DipRuntime` consumes, which keeps the runtime itself
 * ignorant of models, providers, and this SDK.
 */
export const livePreflight = async (agents: AgentDef[]): Promise<string | undefined> => {
  const catalog = await defaultModelCatalog();
  const problems = checkAgentModels(agents, catalog);
  return problems.length === 0 ? undefined : formatModelProblems(problems, catalog);
};
