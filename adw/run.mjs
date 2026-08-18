#!/usr/bin/env node --experimental-strip-types --no-warnings
/**
 * Headless pipeline runner.
 *
 *   node --experimental-strip-types adw/run.mjs review "the last two commits"
 *   node --experimental-strip-types adw/run.mjs research "how should X work?"
 *   node --experimental-strip-types adw/run.mjs --list
 *   node --experimental-strip-types adw/run.mjs --preflight
 *
 * Exit codes: 0 success, 2 halted (expected — a halt is a decision point,
 * not a failure), 1 failure. Structured result to stdout, progress to stderr.
 */
import { ALL_AGENTS } from "./agents.ts";
import { checkAgentModels, defaultModelCatalog, formatModelProblems } from "./preflight.ts";

// A pipeline is a module exporting `run(input) => Promise<PipelineResult>`.
// Adding one is an import here, not a registry entry and a file format.
const PIPELINES = {
  review: () => import("./pipelines/review.ts"),
  research: () => import("./pipelines/research.ts"),
};

const args = process.argv.slice(2);

if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
  console.log("usage: run.mjs <pipeline> [input...]   |   run.mjs --list   |   run.mjs --preflight");
  console.log(`pipelines: ${Object.keys(PIPELINES).join(", ")}`);
  process.exit(args.length === 0 ? 1 : 0);
}

if (args[0] === "--list") {
  for (const name of Object.keys(PIPELINES)) console.log(name);
  process.exit(0);
}

if (args[0] === "--preflight") {
  const catalog = await defaultModelCatalog();
  const problems = checkAgentModels(ALL_AGENTS, catalog);
  if (problems.length === 0) {
    console.log(`${ALL_AGENTS.length} agents checked, every model resolves.`);
    process.exit(0);
  }
  console.error(formatModelProblems(problems, catalog));
  process.exit(1);
}

const [name, ...rest] = args;
const load = PIPELINES[name];
if (!load) {
  console.error(`Unknown pipeline: ${name}`);
  console.error(`Available: ${Object.keys(PIPELINES).join(", ")}`);
  process.exit(1);
}

const { run } = await load();
const outcome = await run(rest.join(" "));

console.error("");
console.error("─".repeat(60));
console.error(`status=${outcome.status}  ${Math.round(outcome.duration_ms / 1000)}s`);

// The structured result is the product; stdout stays machine-readable.
const { status, ...data } = outcome.result ?? {};
console.log(JSON.stringify(data, null, 2));

process.exit(outcome.status === "success" ? 0 : outcome.status === "halted" ? 2 : 1);
