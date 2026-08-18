/**
 * research → brainstorm, halting for a human to choose.
 *
 * Compare `research.dip`, which this replaces. The DSL version needed a parser,
 * a template engine, and path resolution to write `{{gather.findings}}` into
 * the second prompt. Here it is an interpolation the compiler checks: rename a
 * field in RESEARCH_OUTPUT and this stops building, rather than shipping the
 * literal text `{{gather.findings}}` to a model.
 */

import { THINKER, SCOUT } from "../agents.ts";
import { BRAINSTORM_OUTPUT, RESEARCH_OUTPUT } from "../envelope.ts";
import { research } from "../research.ts";
import { runPipeline, type Outcome, type RunContext, type Typed } from "../pipeline.ts";

export interface ResearchResult extends Outcome {
  gather?: Typed<typeof RESEARCH_OUTPUT>;
  brainstorm?: Typed<typeof BRAINSTORM_OUTPUT>;
}

export async function researchAndBrainstorm(ctx: RunContext, question: string): Promise<ResearchResult> {
  const gather = await research(ctx, question, "gather");
  if (gather.status === "fail") return { status: "fail", gather };

  const brainstorm = await ctx.dispatch({
    agent: THINKER,
    phase: "brainstorm",
    output: BRAINSTORM_OUTPUT,
    prompt: [
      `Question: ${question}`,
      ``,
      `Research found these sourced claims:`,
      JSON.stringify(gather.findings, null, 2),
      ``,
      `It could not answer: ${gather.gaps.join("; ") || "(nothing flagged)"}`,
      ``,
      `Propose genuinely distinct approaches grounded in those findings, and say`,
      `which you would pick. Treat a low-confidence finding as a claim to verify,`,
      `not as a fact.`,
    ].join("\n"),
  });
  if (brainstorm.status === "fail") return { status: "fail", gather, brainstorm };

  // Halting is returning. There is no `halt: true` to declare.
  return { status: "halted", gather, brainstorm };
}

export const run = (question: string) =>
  runPipeline("research", (ctx) => researchAndBrainstorm(ctx, question), { uses: [SCOUT, THINKER] });
