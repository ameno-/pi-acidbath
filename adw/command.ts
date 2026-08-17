import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type DipCommand =
  | { ok: true; action: "list" }
  | { ok: true; action: "status" }
  | { ok: true; action: "run"; name: string; prompt: string }
  | { ok: false; error: string };

export function defaultPipelinesDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "pipelines");
}

export function parseDipArgs(raw: string): DipCommand {
  const tokens = raw.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) {
    return { ok: false, error: "Usage: /dip list | /dip status | /dip run <name> [prompt]" };
  }

  const [action, name, ...rest] = tokens;
  if (action === "list" || action === "status") {
    if (name) return { ok: false, error: `Usage: /dip ${action}` };
    return { ok: true, action };
  }
  if (action === "run") {
    if (!name) return { ok: false, error: "Usage: /dip run <name> [prompt]" };
    return { ok: true, action: "run", name, prompt: rest.join(" ") };
  }
  return { ok: false, error: `Unknown /dip action: ${action}` };
}

export function listPipelines(dir: string = defaultPipelinesDir()): string[] {
  return readdirSync(dir)
    .filter((entry) => entry.endsWith(".dip"))
    .map((entry) => entry.replace(/\.dip$/, ""))
    .sort();
}

export function pipelinePath(name: string, dir: string = defaultPipelinesDir()): string {
  const basename = name.endsWith(".dip") ? name : `${name}.dip`;
  return join(dir, basename);
}

/** Presentation-only mapping from runtime events onto the activity rail. */
export function describeDipProgress(event: {
  type: string;
  name?: string;
  id?: string;
  status?: string;
  message?: string;
  gate?: string;
  passed?: boolean;
}): string | undefined {
  switch (event.type) {
    case "dip_start":
      return `dip: ${event.name ?? "pipeline"}`;
    case "phase_start":
      return `dip: ${event.id ?? "phase"}`;
    case "gate_check":
      return `dip: ${event.gate ?? "gate"} ${event.passed === false ? "fail" : "pass"}`;
    case "halt":
      return `dip halt: ${event.id ?? event.message ?? "review"}`;
    case "dip_end":
      return `dip ${event.status ?? "done"}`;
    case "dip_error":
      return `dip error: ${event.message ?? "failed"}`;
    default:
      return undefined;
  }
}
