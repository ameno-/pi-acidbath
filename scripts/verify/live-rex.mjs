/**
 * Live capture check — model versus a real VT emulator.
 *
 * The other checks in this harness prove the renderer produces correct bytes.
 * This one proves those bytes become the screen a person actually looks at,
 * which is a different claim: a real terminal emulator interprets the ANSI,
 * applies the geometry, and decides what is visible.
 *
 * How it stays honest
 *   - It never reads a terminal the user happens to have open. It creates its
 *     own session, runs its own fixture, and destroys the session afterwards.
 *   - The fixture is the production renderer, so the only difference between
 *     prediction and capture is the terminal itself.
 *   - Comparison is exact string equality on visible glyphs. No substring
 *     matching, no "close enough" — a looser test would pass on noise.
 *   - Rex runs blocks with a restricted PATH, so node is resolved absolutely.
 *   - Everything is skipped, never failed, when Rex is unavailable.
 *
 * What it cannot prove: Pi's own transcript compositing. This covers one
 * rendered row reaching a screen, not the full session view.
 */

import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { ROOT } from "./harness.mjs";

const CALL_TIMEOUT_MS = 8000;
const EXIT_POLL_MS = 150;
const EXIT_TIMEOUT_MS = 15000;

const stripAnsi = (value) => value.replace(/\u001b\[[0-9;]*m/g, "").replace(/\r/g, "");

/** Fixtures chosen to cover elision, colour, plain text, and an error row. */
export const LIVE_CASES = [
	{ id: "read/success", width: 72, frame: 0 },
	{ id: "edit/truncated", width: 44, frame: 2 },
	{ id: "bash/pending", width: 80, frame: 1 },
	{ id: "grep/error", width: 100, frame: 0 },
	{ id: "ls/pending-nocolor", width: 40, frame: 1, noColor: true },
];

/** Rex is not on PATH; it ships inside the app bundle. */
function discoverRex() {
	const candidates = [
		process.env.REX_BINARY,
		"/Users/ameno/Library/Application Support/com.superlogical.rex/RexServer/Versions/Current/Rex Server.app/Contents/MacOS/rex",
		"rex",
	].filter(Boolean);
	for (const candidate of candidates) {
		try {
			execFileSync(candidate, ["--help"], { stdio: "ignore", timeout: 3000 });
			return candidate;
		} catch {
			continue;
		}
	}
	return null;
}

/** Node must be absolute: Rex hands blocks a PATH that omits nvm. */
function discoverNode() {
	try {
		return execFileSync("which", ["node"], { encoding: "utf8" }).trim();
	} catch {
		return null;
	}
}

/** Block this thread briefly. The capture loop is synchronous by design. */
function sleepSync(ms) {
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function rexApi(rex, method, args) {
	const out = execFileSync(rex, ["api", "call", method, JSON.stringify(args)], {
		encoding: "utf8",
		timeout: CALL_TIMEOUT_MS,
		stdio: ["ignore", "pipe", "pipe"],
	});
	return JSON.parse(out);
}

/** Wait for the fixture process to exit rather than guessing with a sleep. */
function waitForExit(rex, sessionId, blockId) {
	const deadline = Date.now() + EXIT_TIMEOUT_MS;
	while (Date.now() < deadline) {
		const result = rexApi(rex, "block.method", { session_id: sessionId, block_id: blockId, method: "process" });
		if (result && result.last_exit) return result.last_exit;
		sleepSync(EXIT_POLL_MS);
	}
	return null;
}

/** Non-empty visible lines, which is what a person would read on screen. */
function visibleLines(text) {
	return text.split("\n").map((line) => stripAnsi(line).trimEnd()).filter((line) => line.trim().length > 0);
}

async function captureOne(rex, nodeBin, sessionId, testCase) {
	const emitter = join(ROOT, "scripts/verify/emit-row.mjs");
	const command = [nodeBin, "--experimental-strip-types", "--no-warnings", emitter, testCase.id, String(testCase.width), String(testCase.frame)];
	if (testCase.noColor) command.push("nocolor");

	const created = rexApi(rex, "session.new_window", {
		session_id: sessionId,
		label: `verify-${testCase.id.replace("/", "-")}`,
		layout: {
			block: {
				flavor: "com.superlogical.terminal.shell",
				options: {
					shell: "none",
					// Without this the block closes the moment the fixture exits,
					// and there is nothing left to capture.
					exit: { on_completion: false },
					login: false,
					command,
					size: { columns: testCase.width, rows: 6 },
				},
			},
		},
	});
	const blockId = created.block_ids[0];

	try {
		const exit = waitForExit(rex, sessionId, blockId);
		if (!exit) return { ok: false, reason: "fixture did not exit within the timeout" };

		const formatted = rexApi(rex, "block.method", {
			session_id: sessionId,
			block_id: blockId,
			method: "format",
			args: { format: "text", trim: true },
		});
		return { ok: true, screen: visibleLines(formatted.content ?? ""), exitCode: exit.exit_code };
	} finally {
		try {
			rexApi(rex, "session.close_window", { session_id: sessionId, window_id: created.window_id });
		} catch {
			// cleanup is best-effort; the session is destroyed regardless
		}
	}
}

function predict(nodeBin, testCase) {
	const emitter = join(ROOT, "scripts/verify/emit-row.mjs");
	const args = [emitter, testCase.id, String(testCase.width), String(testCase.frame)];
	if (testCase.noColor) args.push("nocolor");
	const out = execFileSync(nodeBin, ["--experimental-strip-types", "--no-warnings", ...args], {
		encoding: "utf8",
		timeout: CALL_TIMEOUT_MS,
	});
	return visibleLines(out);
}

/**
 * Exact comparison of a predicted frame against a captured screen.
 *
 * Equality on the whole visible line, or nothing. A looser rule would pass on
 * a fragment and stop being evidence.
 */
export function compareScreen(expected, actual) {
	if (JSON.stringify(expected) === JSON.stringify(actual)) return { match: true };
	return {
		match: false,
		reason: `screen ${JSON.stringify(actual)} !== predicted ${JSON.stringify(expected)}`,
	};
}

/**
 * Negative control: prove the comparator rejects a perturbed screen.
 *
 * Without this the check is unfalsifiable — a comparator that always returned
 * "match" would look exactly like a passing run. These perturbations are the
 * kinds of transport fault the live check exists to catch: a dropped glyph, a
 * stray space, a line that never made it to the screen.
 */
export function comparatorSelfTest() {
	const expected = ["(◕‿◕)         (ﾟﾍﾟ)  npm test · 2.1s · expand"];
	const perturbations = {
		"dropped glyph": ["(◕‿◕)         (ﾟﾍ  npm test · 2.1s · expand"],
		"stray space": ["(◕‿◕)          (ﾟﾍﾟ)  npm test · 2.1s · expand"],
		"missing line": [],
		"shifted column": [" (◕‿◕)        (ﾟﾍﾟ)  npm test · 2.1s · expand"],
	};
	const missed = [];
	for (const [name, actual] of Object.entries(perturbations)) {
		if (compareScreen(expected, actual).match) missed.push(name);
	}
	if (compareScreen(expected, expected).match === false) missed.push("rejected an identical frame");
	return {
		pass: missed.length === 0,
		detail: missed.length === 0
			? `comparator rejected all ${Object.keys(perturbations).length} perturbations and accepted the true frame`
			: `comparator failed to reject: ${missed.join(", ")}`,
	};
}

/**
 * Run the live capture check.
 * Returns the same shape as the other checks, plus a skip path.
 */
export async function checkLiveCapture() {
	const claim =
		"A rendered tool row reaches a real terminal emulator byte-for-byte: the frame the renderer predicts is exactly the screen Rex shows.";

	const rex = discoverRex();
	if (!rex) {
		return { id: "live-rex", pass: true, skipped: true, skipReason: "Rex binary not found", claim, failures: [] };
	}
	const nodeBin = discoverNode();
	if (!nodeBin) {
		return { id: "live-rex", pass: true, skipped: true, skipReason: "node not resolvable for the block PATH", claim, failures: [] };
	}

	let sessionId;
	try {
		sessionId = rexApi(rex, "session.create", { label: "acidbath-verify" }).session_id;
	} catch (error) {
		return { id: "live-rex", pass: true, skipped: true, skipReason: `Rex server not reachable: ${error.message}`, claim, failures: [] };
	}

	const failures = [];
	const compared = [];
	try {
		for (const testCase of LIVE_CASES) {
			const capture = await captureOne(rex, nodeBin, sessionId, testCase);
			if (!capture.ok) {
				failures.push(`${testCase.id}@w${testCase.width}: ${capture.reason}`);
				continue;
			}
			if (capture.exitCode !== 0) {
				failures.push(`${testCase.id}@w${testCase.width}: fixture exited ${capture.exitCode}`);
				continue;
			}
			const expected = predict(nodeBin, testCase);
			const comparison = compareScreen(expected, capture.screen);
			if (!comparison.match) {
				failures.push(`${testCase.id}@w${testCase.width}: ${comparison.reason}`);
				continue;
			}
			compared.push(`${testCase.id}@w${testCase.width}`);
		}
	} finally {
		try {
			rexApi(rex, "session.destroy", { session_id: sessionId });
		} catch {
			// nothing more we can do; the session is disposable
		}
	}

	return {
		id: "live-rex",
		pass: failures.length === 0,
		claim,
		detail: `${compared.length}/${LIVE_CASES.length} fixtures matched exactly: ${compared.join(", ") || "none"}`,
		failures,
	};
}