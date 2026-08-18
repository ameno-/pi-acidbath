/**
 * adw/agents.ts — the agent roster, as constants.
 *
 * This was a 106-line hand-rolled YAML parser reading eight `.yaml` files, of
 * which the run log shows five were never dispatched once. The parser existed
 * so agents could be edited without touching code; nobody ever did, and it
 * cost a whole class of silent failure — an unknown key parsed to nothing.
 *
 * Prompt files are still files: they are prose, they are long, and they are the
 * one part genuinely worth editing without a rebuild.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentDef } from "./types.ts";

const PROMPTS_DIR = join(dirname(fileURLToPath(import.meta.url)), "prompts");

/** Read a prompt file; fall back to the name so a missing file is visible, not fatal. */
export function prompt(file: string): string {
  try {
    return readFileSync(join(PROMPTS_DIR, file), "utf-8");
  } catch {
    return `(missing prompt: ${file})`;
  }
}

/**
 * Every model spec carries its provider prefix. `parseModelSpec` defaults to
 * `ap-openai`, so a bare `copilot-*` name resolves to the wrong provider and
 * 400s — the single most expensive mistake in this project's run log.
 */
export const REVIEWER: AgentDef = {
  name: "reviewer",
  model: "ap-openai/glm-5p2-fw",
  thinking: "high",
  tools: ["read", "grep", "find", "ls", "bash"],
  system_prompts: [prompt("context-budget.md")],
};

/** Brainstorming reads to stay grounded, and writes nothing: choosing is not doing. */
export const THINKER: AgentDef = {
  name: "thinker",
  model: "ap-openai/glm-5p2-fw",
  thinking: "high",
  tools: ["read", "grep", "find", "ls"],
  system_prompts: [prompt("context-budget.md")],
};

/**
 * The research capability's model. Its tools are forced at the dispatch site
 * (see research.ts), not read from here — this decides which model runs and
 * nothing about what it is allowed to do.
 */
export const SCOUT: AgentDef = {
  name: "scout",
  model: "ap-openai/glm-5p2-fw",
  thinking: "medium",
  tools: [],
  system_prompts: [],
};

/** Everything the preflight should check. */
export const ALL_AGENTS: AgentDef[] = [REVIEWER, THINKER, SCOUT];
