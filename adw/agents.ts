import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentDef, DipPipeline } from "./types.ts";

export function defaultAgentsDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "agents");
}

/** Load every `*.yaml` agent file from a directory into a name → definition map. */
export function loadAgentCatalog(dir: string = defaultAgentsDir()): Record<string, AgentDef> {
  const catalog: Record<string, AgentDef> = {};
  for (const entry of readdirSync(dir).sort()) {
    if (!entry.endsWith(".yaml") && !entry.endsWith(".yml")) continue;
    const agent = parseAgentYaml(readFileSync(join(dir, entry), "utf-8"), dir);
    if (agent.name) catalog[agent.name] = agent;
  }
  return catalog;
}

/**
 * Catalog agents are the defaults. A `.dip` may omit `agents`, stub a name, or
 * override individual fields. Empty inline fields do not wipe catalog values.
 */
export function mergeAgentCatalog(
  pipeline: DipPipeline,
  catalog: Record<string, AgentDef>,
): DipPipeline {
  const agents: Record<string, AgentDef> = { ...catalog };
  for (const [name, inline] of Object.entries(pipeline.agents)) {
    const base = catalog[name] ?? { name, model: "", tools: [], system_prompts: [] };
    agents[name] = {
      ...base,
      name,
      ...(inline.model ? { model: inline.model } : {}),
      ...(inline.thinking ? { thinking: inline.thinking } : {}),
      ...(inline.tools.length > 0 ? { tools: inline.tools } : {}),
      ...(inline.system_prompts.length > 0 ? { system_prompts: inline.system_prompts } : {}),
      ...(inline.writes ? { writes: inline.writes } : {}),
    };
  }
  return { ...pipeline, agents };
}

export function parseAgentYaml(content: string, sourceDir: string): AgentDef {
  const agent: AgentDef = { name: "", model: "", tools: [], system_prompts: [] };
  let listKey: "tools" | "system_prompts" | "writes" | null = null;

  for (const raw of content.split("\n")) {
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    if (trimmed.startsWith("- ") && listKey) {
      pushListValue(agent, listKey, trimmed.slice(2).trim(), sourceDir);
      continue;
    }

    const colon = trimmed.indexOf(":");
    if (colon < 0) continue;
    const key = trimmed.slice(0, colon).trim();
    const value = trimmed.slice(colon + 1).trim().replace(/^["']|["']$/g, "");

    if (key === "name") agent.name = value;
    else if (key === "model") agent.model = value;
    else if (key === "thinking") agent.thinking = value;
    else if (key === "tools" || key === "system_prompts" || key === "writes") {
      listKey = key;
      if (value) {
        for (const item of parseInlineList(value)) pushListValue(agent, key, item, sourceDir);
        listKey = null;
      }
    } else {
      listKey = null;
    }
  }

  return agent;
}

function pushListValue(
  agent: AgentDef,
  key: "tools" | "system_prompts" | "writes",
  item: string,
  sourceDir: string,
): void {
  if (key === "tools") agent.tools.push(item);
  else if (key === "writes") (agent.writes ??= []).push(item);
  else agent.system_prompts.push(resolvePrompt(item, sourceDir));
}

function resolvePrompt(item: string, sourceDir: string): string {
  const relative = item.replace(/^@/, "");
  try {
    return readFileSync(resolve(sourceDir, relative), "utf-8");
  } catch {
    return item;
  }
}

function parseInlineList(value: string): string[] {
  return value
    .replace(/^\[|\]$/g, "")
    .split(",")
    .map((item) => item.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);
}
