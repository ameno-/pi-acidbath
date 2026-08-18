/**
 * Review the working-tree diff and report blocking findings only.
 *
 * The pipeline with the most real runs behind it (six dispatches across the run
 * log). One step, one schema — which is exactly why it never needed a DSL.
 */

import { REVIEWER } from "../agents.ts";
import { REVIEW_OUTPUT } from "../envelope.ts";
import { runPipeline, type Outcome, type RunContext, type Typed } from "../pipeline.ts";

export interface ReviewResult extends Outcome {
  review?: Typed<typeof REVIEW_OUTPUT>;
}

export async function review(ctx: RunContext, target: string): Promise<ReviewResult> {
  const verdict = await ctx.dispatch({
    agent: REVIEWER,
    phase: "review",
    output: REVIEW_OUTPUT,
    prompt: [
      `Review the working-tree diff for ${target}.`,
      `Report blocking findings only, each with a file path and line number.`,
      `A finding is blocking only if it causes wrong behaviour, not if it is a`,
      `style preference.`,
    ].join(" "),
  });
  if (verdict.status === "fail") return { status: "fail", review: verdict };
  return { status: "halted", review: verdict };
}

export const run = (target: string) =>
  runPipeline("review", (ctx) => review(ctx, target), { uses: [REVIEWER] });
