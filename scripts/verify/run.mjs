/**
 * Entry point for TUI verification.
 *
 *   node --experimental-strip-types scripts/verify/run.mjs
 *
 * Runs the claims, proves the claims can fail, and writes a tamper-evident
 * evidence bundle. Exit code is non-zero if any claim fails or any mutation
 * survives, so CI cannot go green on an unverified change.
 */

import { join } from "node:path";
import { loadRenderer, renderCorpus, ROOT } from "./harness.mjs";
import { runChecks } from "./checks.mjs";
import { runMutationSuite } from "./mutate.mjs";
import { buildEvidence, writeEvidence } from "./evidence.mjs";

const mark = (pass) => (pass ? "PASS" : "FAIL");
const tick = (pass) => (pass ? "✓" : "✗");

async function main() {
	const sourceDir = join(ROOT, "extensions/acidbath");
	const loaded = await loadRenderer(sourceDir);
	const corpus = renderCorpus(loaded.render);

	const checks = runChecks(loaded);

	console.log("\nTUI verification — compact tool row\n");
	for (const check of checks) {
		console.log(`  ${tick(check.pass)} ${check.id.padEnd(22)} ${mark(check.pass)}`);
		if (check.detail) console.log(`      ${check.detail}`);
		for (const failure of check.failures.slice(0, 4)) console.log(`      ${failure}`);
		if (check.failures.length > 4) console.log(`      …and ${check.failures.length - 4} more`);
	}

	console.log(`\nCorpus: ${corpus.length} renders across ${loaded.extensionDir.replace(ROOT, ".")}\n`);

	console.log("Mutation suite — proving the checks bite\n");
	const mutations = await runMutationSuite(sourceDir);
	for (const mutation of mutations) {
		console.log(`  ${tick(mutation.caught)} ${mutation.id.padEnd(18)} ${mutation.expect.padEnd(20)} ${mutation.caughtBy}`);
	}
	console.log("");

	const bundle = await buildEvidence({ checks, mutations, corpus });
	const { mdPath, jsonPath } = await writeEvidence(bundle);

	console.log(`Verdict: ${bundle.verdict.overall}`);
	console.log(`Evidence: ${mdPath.replace(ROOT, ".")}  (hash ${bundle.evidenceHash.slice(0, 16)})`);
	console.log(`          ${jsonPath.replace(ROOT, ".")}\n`);

	if (bundle.verdict.overall !== "PASS") process.exit(1);
}

main().catch((error) => {
	console.error("verification harness failed to run:", error);
	process.exit(2);
});