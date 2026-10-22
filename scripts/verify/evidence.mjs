/**
 * Evidence bundle — the artifact a reviewer can re-derive.
 *
 * The bundle records what was verified, against which inputs, with which
 * checks, under which code and toolchain. It ends with a self-hash so the
 * whole claim is tamper-evident: change any assertion, input, or source
 * revision and the hash stops matching.
 */

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { CASES, WIDTHS, ROOT } from "./harness.mjs";

export const BUNDLE_VERSION = 1;

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function git(args, fallback = "unknown") {
	try {
		return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
	} catch {
		return fallback;
	}
}

/** Source digest: the exact bytes of every file the evidence depends on. */
function sourceDigest(files) {
	const parts = files.map((file) => `${sha256(file.bytes)}  ${file.path}`);
	return { digest: sha256(parts.join("\n")), files: parts };
}

export async function buildEvidence({ checks, mutations, corpus }) {
	const sourceFiles = [
		"extensions/acidbath/ui-tool-renderers.ts",
		"extensions/acidbath/ui-tool-rows.ts",
		"extensions/acidbath/rendering/kaomoji.ts",
		"scripts/verify/harness.mjs",
		"scripts/verify/checks.mjs",
		"scripts/verify/mutate.mjs",
		"scripts/verify/live-rex.mjs",
		"scripts/verify/emit-row.mjs",
		"scripts/verify/run.mjs",
	];

	const files = [];
	for (const path of sourceFiles) {
		const { readFile } = await import("node:fs/promises");
		files.push({ path, bytes: await readFile(join(ROOT, path)) });
	}

	const bundle = {
		bundleVersion: BUNDLE_VERSION,
		generatedAt: new Date().toISOString(),
		code: {
			revision: git(["rev-parse", "HEAD"]),
			branch: git(["rev-parse", "--abbrev-ref", "HEAD"]),
			dirty: git(["status", "--porcelain", "--untracked-files=no"], "") !== "",
		},
		toolchain: {
			node: process.version,
			platform: `${process.platform}-${process.arch}`,
		},
		scope: {
			note: "Structural claims about the compact tool row: width, determinism, glyph identity, escape hygiene, and in-place animation. Pi-native detail bodies and Rex host rendering are covered by the live capture check, not here.",
			corpus: {
				cases: CASES.map((c) => ({ id: c.id, frames: c.frames, settled: c.spec.settled, status: c.spec.status })),
				widths: WIDTHS,
				renders: corpus.length,
			},
			rendererSource: sourceDigest(files),
		},
		checks: checks.map((c) => ({
			id: c.id,
			claim: c.claim,
			detail: c.detail ?? null,
			result: c.pass ? "pass" : "fail",
			failures: c.failures,
		})),
		mutations: mutations.map((m) => ({
			id: m.id,
			bug: m.bug,
			expectedCheck: m.expect,
			caught: m.caught,
			checksThatFired: m.fired,
		})),
	};

	bundle.verdict = {
		checksPassed: checks.every((c) => c.pass),
		mutationsCaught: mutations.every((m) => m.caught),
	};
	bundle.verdict.overall = bundle.verdict.checksPassed && bundle.verdict.mutationsCaught ? "PASS" : "FAIL";

	// Digest scope: the verdict, not the diagnostics.
	//
	// What is hashed is what the evidence CLAIMS — revision, renderer digest,
	// corpus, each check's pass/fail, and whether each mutation was caught.
	// Timestamps, failure prose, and incidental details such as which other
	// checks happened to fire alongside a mutation are deliberately excluded:
	// they vary between identical runs and would make the digest lie about
	// whether anything actually changed.
	const claim = {
		bundleVersion: BUNDLE_VERSION,
		code: bundle.code,
		scope: {
			corpus: bundle.scope.corpus,
			rendererDigest: bundle.scope.rendererSource.digest,
		},
		checks: checks.map((c) => ({ id: c.id, result: c.pass ? "pass" : "fail" })),
		mutations: mutations.map((m) => ({ id: m.id, expectedCheck: m.expect, caught: m.caught })),
	};
	bundle.evidenceHash = sha256(JSON.stringify(claim, null, 2));
	bundle.digestScope =
		"revision + working-tree state, renderer source digest, corpus, every check pass/fail/skip, and every mutation caught/not. Excludes timestamps, failure prose, and incidental per-run detail.";
	return bundle;
}

/** Write the bundle plus a human-readable summary next to each other. */
export async function writeEvidence(bundle, outDir = join(ROOT, "evidence")) {
	await mkdir(outDir, { recursive: true });
	const jsonPath = join(outDir, "tui-verification.json");
	await writeFile(jsonPath, `${JSON.stringify(bundle, null, 2)}\n`, "utf8");

	const rows = bundle.checks
		.map((c) => {
			const badge = c.result === "pass" ? "✅ pass" : c.result === "skip" ? "⏭️ skip" : "❌ FAIL";
			const reason = c.result === "skip" && c.skipReason ? ` — ${c.skipReason}` : "";
			return `| \`${c.id}\` | ${badge} | ${c.claim}${reason} |`;
		})
		.join("\n");
	const mutants = bundle.mutations
		.map((m) => `| \`${m.id}\` | ${m.caught ? "✅ caught" : "❌ SURVIVED"} | \`${m.expectedCheck}\` | ${m.checksThatFired.join(", ") || "—"} |`)
		.join("\n");

	const md = `# TUI verification evidence

- **Verdict:** ${bundle.verdict.overall}
- **Revision:** \`${bundle.code.revision}\` on \`${bundle.code.branch}\`${bundle.code.dirty ? " *(dirty working tree)*" : ""}
- **Node:** ${bundle.toolchain.node} on ${bundle.toolchain.platform}
- **Corpus:** ${bundle.scope.corpus.renders} renders — ${bundle.scope.corpus.cases.length} cases × ${bundle.scope.corpus.widths.length} widths
- **Renderer digest:** \`${bundle.scope.rendererSource.digest.slice(0, 16)}\`
- **Evidence hash:** \`${bundle.evidenceHash}\`

${bundle.scope.note}

## Claims verified

| Check | Result | Claim |
| --- | --- | --- |
${rows}

## Checks proven able to fail

Each mutation is a realistic TUI regression applied to a copy of the real
renderer. A surviving mutation means the harness is not trustworthy.

| Mutation | Outcome | Required check | Checks that fired |
| --- | --- | --- | --- |
${mutants}

## Reproduce

\`\`\`bash
npm run verify
\`\`\`

A different \`evidenceHash\` on the same revision means something changed.
`;
	const mdPath = join(outDir, "tui-verification.md");
	await writeFile(mdPath, md, "utf8");
	return { jsonPath, mdPath };
}