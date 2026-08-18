/**
 * adw/research.ts — research as a capability, not a role.
 *
 * A scoped dispatch: the same Pi session machinery every agent uses, but with
 * an allowlist of exactly two tools — `agy_research` and `submit` — and a fixed
 * output schema. The agent has no way to elect a different job: it cannot read,
 * write, or run anything.
 *
 * This deliberately does not shell out to the `agy` binary. Subprocessing it
 * would buy determinism we do not have anyway (the search is itself an LLM) and
 * cost a reimplementation of the stream-json handling, the usage accounting,
 * and the envelope contract that already work here.
 *
 * The tool comes from the `pi-research` extension, which Pi discovers from
 * `cwd` (acidbath declares it under `pi.extensions`). There is no wiring step.
 * There is also no announcement when it is absent — an unknown tool name is
 * silently ignored — which is why `dispatchPi` fails a dispatch whose tools did
 * not all activate.
 */

import { SCOUT } from "./agents.ts";
import { RESEARCH_OUTPUT } from "./envelope.ts";
import type { RunContext, Typed } from "./pipeline.ts";

/** The extension tool a research dispatch is scoped to. */
export const RESEARCH_TOOL = "agy_research";

/**
 * The contract, in code rather than in a config file. The model is
 * configurable; whether claims carry real sources is not, because a research
 * envelope with invented `source_url`s is worse than no research at all.
 */
export const RESEARCH_BRIEF = `
You are a research capability, not a general agent. Your only tool is ${RESEARCH_TOOL}.

- Use ${RESEARCH_TOOL} to answer the question. You cannot read files, run commands,
  or edit anything, so do not plan to.
- Every entry in \`findings\` needs a real \`source_url\` that the search returned.
  Never write a plausible-looking URL you did not receive, and never merge two
  claims into one entry.
- Set \`confidence\` from how well the source actually supports the claim, not
  from how confident you feel.
- Put what you could not answer in \`gaps\`. An honest gap is worth more to the
  next step than a low-confidence guess presented as a finding.
`.trim();

/** R1 contract: a research envelope carries a bounded, ordered source list. */
export const MAX_SOURCE_ARTIFACTS = 20;

/**
 * Research a question. Returns the typed envelope, with each finding's
 * `source_url` promoted into `artifacts` (deduplicated, submitted ones first)
 * and bounded — large payloads are the failure mode every durable-execution
 * engine warns about.
 */
export async function research(
  ctx: RunContext,
  question: string,
  phase = "research",
): Promise<Typed<typeof RESEARCH_OUTPUT>> {
  const envelope = await ctx.dispatch({
    agent: SCOUT,
    phase,
    prompt: question,
    output: RESEARCH_OUTPUT,
    // Forced here, not read from SCOUT: the roster decides the model, this
    // decides the job. An edited agent constant cannot hand research a shell.
    tools: [RESEARCH_TOOL],
    systemPrompts: [...SCOUT.system_prompts, RESEARCH_BRIEF],
    submitMode: "strict",
  });

  const artifacts = [...(envelope.artifacts ?? [])];
  for (const finding of envelope.findings ?? []) {
    if (finding.source_url && !artifacts.includes(finding.source_url)) {
      artifacts.push(finding.source_url);
    }
  }
  return { ...envelope, artifacts: artifacts.slice(0, MAX_SOURCE_ARTIFACTS) };
}
