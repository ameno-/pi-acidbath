/**
 * adw/command.ts — the `/dip` slash command's thin adapter.
 *
 * Argument parsing and pipeline lookup, so the TUI extension does not import
 * the library's internals. Progress arrives as plain strings; the extension
 * never sees an event union it has to keep in sync.
 */

import type { PipelineResult } from "./pipeline.ts";

export const PIPELINES = ["review", "research"] as const;
export type PipelineName = (typeof PIPELINES)[number];

export type DipArgs =
  | { ok: true; action: "list" }
  | { ok: true; action: "status" }
  | { ok: true; action: "run"; name: PipelineName; prompt: string }
  | { ok: false; error: string };

export function parseDipArgs(args: string): DipArgs {
  const trimmed = args.trim();
  if (!trimmed || trimmed === "list") return { ok: true, action: "list" };
  if (trimmed === "status") return { ok: true, action: "status" };

  const [name, ...rest] = trimmed.split(/\s+/);
  if (!(PIPELINES as readonly string[]).includes(name)) {
    return { ok: false, error: `Unknown pipeline: ${name}. Known: ${PIPELINES.join(", ")}` };
  }
  const prompt = rest.join(" ");
  if (!prompt) return { ok: false, error: `${name} needs an input: /dip ${name} <what>` };
  return { ok: true, action: "run", name: name as PipelineName, prompt };
}

/** Run a pipeline by name, forwarding progress lines to the caller. */
export async function runDipPipeline(
  name: PipelineName,
  input: string,
  onProgress: (message: string) => void = () => {},
): Promise<PipelineResult<{ status: "success" | "fail" | "halted" }>> {
  const module = name === "review"
    ? await import("./pipelines/review.ts")
    : await import("./pipelines/research.ts");
  const original = console.error;
  console.error = (...parts: unknown[]) => onProgress(parts.map(String).join(" ").trim());
  try {
    return await module.run(input);
  } finally {
    console.error = original;
  }
}
