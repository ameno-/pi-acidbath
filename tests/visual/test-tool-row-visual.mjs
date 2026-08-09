import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const baselineDir = join(here, "baselines");
const baselineText = join(baselineDir, "tool-row.txt");
const baselinePng = join(baselineDir, "tool-row.png");
const runDir = `/tmp/acidbath-tool-row-visual-${process.pid}`;
const actualText = join(runDir, "tool-row.txt");
const actualPng = join(runDir, "tool-row.png");
const session = `acidbath-tool-row-${process.pid}`;
const update = process.argv.includes("--update");

function run(command, args, options = {}) {
	const result = spawnSync(command, args, {
		cwd: root,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
		...options,
	});
	if (result.error) throw result.error;
	return result;
}

function requireCommand(command) {
	const result = spawnSync("sh", ["-lc", `command -v ${command}`], { encoding: "utf8" });
	if (result.status !== 0) throw new Error(`required visual test command is unavailable: ${command}`);
}

function fail(message) {
	throw new Error(message);
}

async function main() {
	for (const command of ["tuistory", "ffmpeg"]) requireCommand(command);
	await mkdir(runDir, { recursive: true });
	await mkdir(baselineDir, { recursive: true });

	try {
		const fixture = "node --experimental-strip-types --no-warnings tests/visual/fixtures/tool-row-fixture.mjs";
		const launched = run("tuistory", [
			"launch",
			fixture,
			"--session",
			session,
			"--cwd",
			root,
			"--cols",
			"80",
			"--rows",
			"12",
			"--background",
			"--timeout",
			"5000",
		]);
		if (launched.status !== 0) fail(`tuistory launch failed:\n${launched.stderr}`);

		const waited = run("tuistory", ["wait", "ACIDBATH TOOL ROWS", "--session", session, "--timeout", "5000"]);
		if (waited.status !== 0) fail(`fixture did not become ready:\n${waited.stderr}`);

		const snapshot = run("tuistory", ["snapshot", "--session", session, "--trim", "--no-cursor"]);
		if (snapshot.status !== 0) fail(`tuistory snapshot failed:\n${snapshot.stderr}`);
		await writeFile(actualText, snapshot.stdout);

		const screenshot = run("tuistory", [
			"screenshot",
			"--session",
			session,
			"--output",
			actualPng,
			"--font-size",
			"14",
			"--pixel-ratio",
			"1",
			"--padding",
			"0",
			"--frame-color",
			"#1a1b26",
		]);
		if (screenshot.status !== 0) fail(`tuistory screenshot failed:\n${screenshot.stderr}`);

		if (update || !existsSync(baselineText) || !existsSync(baselinePng)) {
			if (!update) fail("visual baseline is missing; run `npm run test:visual -- --update` once");
			await copyFile(actualText, baselineText);
			await copyFile(actualPng, baselinePng);
			console.log(`created visual baseline: ${baselineText}`);
			console.log(`created visual baseline: ${baselinePng}`);
			return;
		}

		const expected = await readFile(baselineText, "utf8");
		const actual = await readFile(actualText, "utf8");
		if (actual !== expected) {
			console.error("FAIL tool-row text snapshot differs");
			console.error(`expected: ${baselineText}`);
			console.error(`actual:   ${actualText}`);
			process.exitCode = 1;
		}

		const diffPath = join(runDir, "tool-row-diff.png");
		const visual = run("ffmpeg", [
			"-v", "error",
			"-i", baselinePng,
			"-i", actualPng,
			"-filter_complex", `[0:v][1:v]ssim=stats_file=-`,
			"-f", "null", "-",
		]);
		const match = `${visual.stdout}\n${visual.stderr}`.match(/All:([0-9.]+)/);
		const ssim = match ? Number(match[1]) : NaN;
		if (!Number.isFinite(ssim)) fail(`could not read PNG SSIM from ffmpeg:\n${visual.stderr}`);
		if (ssim < 0.9999) {
			const diff = run("ffmpeg", [
				"-v", "error",
				"-i", baselinePng,
				"-i", actualPng,
				"-filter_complex", "[0:v][1:v]blend=all_mode=difference,eq=contrast=8:brightness=0.05",
				"-y", diffPath,
			]);
			if (diff.status !== 0) console.error(`could not write visual diff: ${diff.stderr}`);
			console.error(`FAIL tool-row PNG differs (SSIM ${ssim.toFixed(6)} < 0.9999)`);
			console.error(`expected: ${baselinePng}`);
			console.error(`actual:   ${actualPng}`);
			console.error(`diff:     ${diffPath}`);
			process.exitCode = 1;
		}
		console.log(`tool-row visual: text=${actual === expected ? "match" : "DIFF"}, ssim=${ssim.toFixed(6)}`);
	} finally {
		run("tuistory", ["close", "--session", session]);
		if (process.exitCode === 0 || process.exitCode === undefined) await rm(runDir, { recursive: true, force: true });
	}
}

main().catch((error) => {
	console.error(`visual test error: ${error?.message ?? error}`);
	process.exitCode = 1;
});
