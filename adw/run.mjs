#!/usr/bin/env node --experimental-strip-types --no-warnings
/**
 * Headless pipeline runner.
 *
 * The /dip command drives the runtime from inside the TUI, which makes the
 * pipeline awkward to validate and impossible to script. This is the same
 * in-process path with a terminal front end, so a pipeline can be exercised
 * from a shell, a test, or a CI step.
 *
 *   node --experimental-strip-types adw/run.mjs review "the last two commits"
 *   node --experimental-strip-types adw/run.mjs --list
 *
 * Exit codes: 0 success, 2 halted (expected for review gates), 1 failure.
 */
import { createDipRuntime } from "./create-runtime.ts";
import { listPipelines, pipelinePath } from "./command.ts";

const args = process.argv.slice(2);

if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
  console.log("usage: run.mjs <pipeline> [prompt...]   |   run.mjs --list");
  process.exit(args.length === 0 ? 1 : 0);
}

if (args[0] === "--list") {
  for (const name of listPipelines()) console.log(name);
  process.exit(0);
}

const [name, ...promptParts] = args;
const prompt = promptParts.join(" ");

const started = Date.now();
const runtime = createDipRuntime((event) => {
  switch (event.type) {
    case "dip_start":
      console.error(`▸ ${event.name}  run=${event.run_id}`);
      break;
    case "phase_start":
      console.error(`  ├ ${event.id} (${event.kind}${event.agent ? ` → ${event.agent}` : ""})`);
      break;
    case "gate_check":
      console.error(`  │   gate ${event.gate}: ${event.passed ? "pass" : "FAIL"}`);
      break;
    case "phase_end":
      console.error(
        `  ├ ${event.id}: ${event.status}` +
          (event.envelope?.duration_ms ? ` (${Math.round(event.envelope.duration_ms / 1000)}s)` : ""),
      );
      break;
    case "halt":
      console.error(`  └ halted at ${event.id} — awaiting human review`);
      break;
    case "dip_error":
      console.error(`  ✗ ${event.error}`);
      break;
  }
});

let pipeline;
try {
  pipeline = runtime.loadPipeline(pipelinePath(name));
} catch (error) {
  console.error(`Could not load pipeline "${name}": ${error?.message ?? error}`);
  console.error(`Available: ${listPipelines().join(", ")}`);
  process.exit(1);
}

const result = await runtime.run(pipeline, prompt);

console.error(`\n${"─".repeat(60)}`);
console.error(`status=${result.status}  ${Math.round((Date.now() - started) / 1000)}s`);
console.log(JSON.stringify(result.envelopes, null, 2));

process.exit(result.status === "success" ? 0 : result.status === "halted" ? 2 : 1);
