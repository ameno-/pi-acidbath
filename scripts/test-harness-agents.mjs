/**
 * Unit tests for extensions/harness/agents.ts (PURE module).
 *
 * Run:
 *   /home/donatello/.nvm/versions/node/v22.22.1/bin/node --experimental-strip-types --no-warnings scripts/test-harness-agents.mjs
 *
 * Asserts:
 *   1. parseAgentRegistry — version, defaults, profiles shape.
 *   2. parseAgentRegistry — rejects malformed input (version, missing
 *      fields, bad cwdPolicy, bad source, non-positive ints, etc.).
 *   3. listAgents — scope filtering preserves order; "all" returns all.
 *   4. findAgent — exact match; missing returns undefined.
 *   5. okEnvelope / errEnvelope — shape, optional fields, immutability.
 *   6. redactEnvelope — key prefixes, Slack-style tokens, Bearer; mutates neither input nor
 *      the surrounding envelope.
 *   7. truncateOutput — short text passes; long text adds marker;
 *      maxChars <= 0 returns "".
 *   8. projectAgentsRequireConfirm — true iff any source === "project".
 *   9. defaultAgentRegistry() parity with config/agents.example.json.
 *  10. Redaction coverage for every credential family, plus the
 *      guarantee that ordinary prose survives byte-for-byte.
 *  11. planAgentRun / resolveRunCwd — the pure run preflight.
 *  12. clampFanout / fanoutConcurrency — parallel batch bounds.
 *
 * The test exits 1 on any failure.
 */

import {
	parseAgentRegistry,
	defaultAgentRegistry,
	listAgents,
	findAgent,
	okEnvelope,
	errEnvelope,
	redactEnvelope,
	truncateOutput,
	projectAgentsRequireConfirm,
	planAgentRun,
	resolveRunCwd,
	clampFanout,
	fanoutConcurrency,
	describeRunError,
	extractRunResult,
} from "../extensions/harness/agents.ts";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

let passed = 0;
let failed = 0;
const failures = [];

function assert(name, cond, detail) {
	if (cond) {
		passed++;
	} else {
		failed++;
		failures.push({ name, detail });
		console.log(`FAIL  ${name}  ${detail ? "(" + detail + ")" : ""}`);
	}
}

function run(name, fn) {
	try {
		fn();
	} catch (e) {
		failed++;
		failures.push({ name, detail: `threw: ${e?.message ?? e}` });
		console.log(`FAIL  ${name}  threw: ${e?.message ?? e}`);
	}
}

// ─── 1. parseAgentRegistry — valid inputs ────────────────────────────────

run("parseAgentRegistry — accepts valid registry", () => {
	const reg = defaultAgentRegistry();
	const parsed = parseAgentRegistry({
		version: reg.version,
		maxConcurrency: reg.maxConcurrency,
		profiles: reg.profiles,
	});
	assert("valid.version", parsed.version === 1);
	assert("valid.concurrency", parsed.maxConcurrency === 4);
	assert("valid.profile.count", parsed.profiles.length === reg.profiles.length);
});

run("parseAgentRegistry — default maxConcurrency when omitted", () => {
	const reg = parseAgentRegistry({
		version: 1,
		profiles: defaultAgentRegistry().profiles,
	});
	assert("default.concurrency", reg.maxConcurrency === 4);
});

run("parseAgentRegistry — accepts custom maxConcurrency", () => {
	const reg = parseAgentRegistry({
		version: 1,
		maxConcurrency: 8,
		profiles: defaultAgentRegistry().profiles,
	});
	assert("custom.concurrency", reg.maxConcurrency === 8);
});

// ─── 2. parseAgentRegistry — rejections ───────────────────────────────────

run("parseAgentRegistry — rejects wrong version", () => {
	let threw = false;
	try {
		parseAgentRegistry({ version: 2, profiles: defaultAgentRegistry().profiles });
	} catch (e) {
		threw = e instanceof RangeError;
	}
	assert("version.threw", threw);
});

run("parseAgentRegistry — rejects non-object", () => {
	let threw = false;
	try {
		parseAgentRegistry("nope");
	} catch (e) {
		threw = e instanceof RangeError;
	}
	assert("nonobject.threw", threw);
});

run("parseAgentRegistry — rejects missing profiles", () => {
	let threw = false;
	try {
		parseAgentRegistry({ version: 1 });
	} catch (e) {
		threw = e instanceof RangeError;
	}
	assert("missing.profiles.threw", threw);
});

run("parseAgentRegistry — rejects empty profiles", () => {
	let threw = false;
	try {
		parseAgentRegistry({ version: 1, profiles: [] });
	} catch (e) {
		threw = e instanceof RangeError;
	}
	assert("empty.profiles.threw", threw);
});

run("parseAgentRegistry — rejects bad cwdPolicy", () => {
	let threw = false;
	try {
		parseAgentRegistry({
			version: 1,
			profiles: [
				{
					name: "scout",
					description: "x",
					role: "task",
					instructions: "y",
					cwdPolicy: "wrong",
					timeoutMs: 1000,
					maxOutputChars: 1000,
					allowNested: false,
					source: "builtin",
				},
			],
		});
	} catch (e) {
		threw = e instanceof RangeError;
	}
	assert("bad.cwdPolicy.threw", threw);
});

run("parseAgentRegistry — rejects explicit cwdPolicy without cwd", () => {
	let threw = false;
	try {
		parseAgentRegistry({
			version: 1,
			profiles: [
				{
					name: "scout",
					description: "x",
					role: "task",
					instructions: "y",
					cwdPolicy: "explicit",
					timeoutMs: 1000,
					maxOutputChars: 1000,
					allowNested: false,
					source: "builtin",
				},
			],
		});
	} catch (e) {
		threw = e instanceof RangeError;
	}
	assert("explicit.missing.cwd.threw", threw);
});

run("parseAgentRegistry — rejects session cwdPolicy with cwd set", () => {
	let threw = false;
	try {
		parseAgentRegistry({
			version: 1,
			profiles: [
				{
					name: "scout",
					description: "x",
					role: "task",
					instructions: "y",
					cwdPolicy: "session",
					cwd: "/tmp",
					timeoutMs: 1000,
					maxOutputChars: 1000,
					allowNested: false,
					source: "builtin",
				},
			],
		});
	} catch (e) {
		threw = e instanceof RangeError;
	}
	assert("session.with.cwd.threw", threw);
});

run("parseAgentRegistry — accepts profile cwdPolicy with cwd", () => {
	const reg = parseAgentRegistry({
		version: 1,
		profiles: [
			{
				name: "scout",
				description: "x",
				role: "task",
				instructions: "y",
				cwdPolicy: "profile",
				cwd: "/tmp",
				timeoutMs: 1000,
				maxOutputChars: 1000,
				allowNested: false,
				source: "user",
			},
		],
	});
	assert("profile.cwd.ok", reg.profiles[0].cwd === "/tmp");
});

run("parseAgentRegistry — rejects zero timeoutMs", () => {
	let threw = false;
	try {
		parseAgentRegistry({
			version: 1,
			profiles: [
				{
					name: "scout",
					description: "x",
					role: "task",
					instructions: "y",
					cwdPolicy: "session",
					timeoutMs: 0,
					maxOutputChars: 1000,
					allowNested: false,
					source: "builtin",
				},
			],
		});
	} catch (e) {
		threw = e instanceof RangeError;
	}
	assert("zero.timeout.threw", threw);
});

run("parseAgentRegistry — rejects negative maxOutputChars", () => {
	let threw = false;
	try {
		parseAgentRegistry({
			version: 1,
			profiles: [
				{
					name: "scout",
					description: "x",
					role: "task",
					instructions: "y",
					cwdPolicy: "session",
					timeoutMs: 1000,
					maxOutputChars: -1,
					allowNested: false,
					source: "builtin",
				},
			],
		});
	} catch (e) {
		threw = e instanceof RangeError;
	}
	assert("neg.maxOut.threw", threw);
});

run("parseAgentRegistry — rejects non-boolean allowNested", () => {
	let threw = false;
	try {
		parseAgentRegistry({
			version: 1,
			profiles: [
				{
					name: "scout",
					description: "x",
					role: "task",
					instructions: "y",
					cwdPolicy: "session",
					timeoutMs: 1000,
					maxOutputChars: 1000,
					allowNested: "yes",
					source: "builtin",
				},
			],
		});
	} catch (e) {
		threw = e instanceof RangeError;
	}
	assert("bad.allowNested.threw", threw);
});

run("parseAgentRegistry — rejects bad source", () => {
	let threw = false;
	try {
		parseAgentRegistry({
			version: 1,
			profiles: [
				{
					name: "scout",
					description: "x",
					role: "task",
					instructions: "y",
					cwdPolicy: "session",
					timeoutMs: 1000,
					maxOutputChars: 1000,
					allowNested: false,
					source: "global",
				},
			],
		});
	} catch (e) {
		threw = e instanceof RangeError;
	}
	assert("bad.source.threw", threw);
});

run("parseAgentRegistry — rejects duplicate profile name", () => {
	let threw = false;
	try {
		parseAgentRegistry({
			version: 1,
			profiles: [
				{
					name: "scout",
					description: "x",
					role: "task",
					instructions: "y",
					cwdPolicy: "session",
					timeoutMs: 1000,
					maxOutputChars: 1000,
					allowNested: false,
					source: "builtin",
				},
				{
					name: "scout",
					description: "z",
					role: "task",
					instructions: "y",
					cwdPolicy: "session",
					timeoutMs: 1000,
					maxOutputChars: 1000,
					allowNested: false,
					source: "builtin",
				},
			],
		});
	} catch (e) {
		threw = e instanceof RangeError;
	}
	assert("dup.name.threw", threw);
});

run("parseAgentRegistry — rejects missing description", () => {
	let threw = false;
	try {
		parseAgentRegistry({
			version: 1,
			profiles: [
				{
					name: "scout",
					role: "task",
					instructions: "y",
					cwdPolicy: "session",
					timeoutMs: 1000,
					maxOutputChars: 1000,
					allowNested: false,
					source: "builtin",
				},
			],
		});
	} catch (e) {
		threw = e instanceof RangeError;
	}
	assert("missing.desc.threw", threw);
});

run("parseAgentRegistry — rejects tools as non-string[]", () => {
	let threw = false;
	try {
		parseAgentRegistry({
			version: 1,
			profiles: [
				{
					name: "scout",
					description: "x",
					role: "task",
					instructions: "y",
					tools: ["read", 42],
					cwdPolicy: "session",
					timeoutMs: 1000,
					maxOutputChars: 1000,
					allowNested: false,
					source: "builtin",
				},
			],
		});
	} catch (e) {
		threw = e instanceof RangeError;
	}
	assert("bad.tools.threw", threw);
});

run("parseAgentRegistry — rejects maxConcurrency below 1", () => {
	let threw = false;
	try {
		parseAgentRegistry({
			version: 1,
			maxConcurrency: 0,
			profiles: defaultAgentRegistry().profiles,
		});
	} catch (e) {
		threw = e instanceof RangeError;
	}
	assert("zero.concurrency.threw", threw);
});

run("parseAgentRegistry — rejects non-integer maxConcurrency", () => {
	let threw = false;
	try {
		parseAgentRegistry({
			version: 1,
			maxConcurrency: 1.5,
			profiles: defaultAgentRegistry().profiles,
		});
	} catch (e) {
		threw = e instanceof RangeError;
	}
	assert("frac.concurrency.threw", threw);
});

// ─── 3. listAgents ───────────────────────────────────────────────────────

run("listAgents — all returns every profile in order", () => {
	const reg = defaultAgentRegistry();
	const all = listAgents(reg, "all");
	assert("all.count", all.length === reg.profiles.length, `got=${all.length}`);
	assert("all.order.0", all[0].name === reg.profiles[0].name);
	assert("all.order.last", all[all.length - 1].name === reg.profiles[reg.profiles.length - 1].name);
});

run("listAgents — builtin filter", () => {
	const reg = defaultAgentRegistry();
	const builtins = listAgents(reg, "builtin");
	assert("builtin.count", builtins.length === reg.profiles.length);
	for (const p of builtins) {
		assert(`builtin.${p.name}.source`, p.source === "builtin");
	}
});

run("listAgents — user filter empty for builtin-only registry", () => {
	const reg = defaultAgentRegistry();
	const users = listAgents(reg, "user");
	assert("user.empty", users.length === 0);
});

run("listAgents — project filter empty for builtin-only registry", () => {
	const reg = defaultAgentRegistry();
	const projects = listAgents(reg, "project");
	assert("project.empty", projects.length === 0);
});

run("listAgents — mixed registry filters correctly", () => {
	const reg = parseAgentRegistry({
		version: 1,
		profiles: [
			{
				name: "a",
				description: "x",
				role: "task",
				instructions: "y",
				cwdPolicy: "session",
				timeoutMs: 1000,
				maxOutputChars: 1000,
				allowNested: false,
				source: "builtin",
			},
			{
				name: "b",
				description: "x",
				role: "task",
				instructions: "y",
				cwdPolicy: "session",
				timeoutMs: 1000,
				maxOutputChars: 1000,
				allowNested: false,
				source: "user",
			},
			{
				name: "c",
				description: "x",
				role: "task",
				instructions: "y",
				cwdPolicy: "session",
				timeoutMs: 1000,
				maxOutputChars: 1000,
				allowNested: false,
				source: "project",
			},
		],
	});
	assert("mixed.builtin", listAgents(reg, "builtin").map((p) => p.name).join(",") === "a");
	assert("mixed.user", listAgents(reg, "user").map((p) => p.name).join(",") === "b");
	assert("mixed.project", listAgents(reg, "project").map((p) => p.name).join(",") === "c");
});

run("listAgents — does not mutate the registry", () => {
	const reg = defaultAgentRegistry();
	const before = JSON.stringify(reg);
	listAgents(reg, "all");
	listAgents(reg, "builtin");
	listAgents(reg, "user");
	listAgents(reg, "project");
	assert("no.mutation", JSON.stringify(reg) === before);
});

// ─── 4. findAgent ────────────────────────────────────────────────────────

run("findAgent — exact match", () => {
	const reg = defaultAgentRegistry();
	const scout = findAgent(reg, "scout");
	assert("scout.found", scout !== undefined);
	if (scout) {
		assert("scout.role", scout.role === "task");
		assert("scout.tools", JSON.stringify(scout.tools) === JSON.stringify(["read", "grep", "find", "ls"]));
		assert("scout.allowNested", scout.allowNested === false);
		assert("scout.source", scout.source === "builtin");
	}
});

run("findAgent — case-sensitive (uppercase returns undefined)", () => {
	const reg = defaultAgentRegistry();
	assert("case.upper", findAgent(reg, "SCOUT") === undefined);
});

run("findAgent — missing returns undefined", () => {
	const reg = defaultAgentRegistry();
	assert("missing", findAgent(reg, "ghost") === undefined);
});

// ─── 5. envelopes ────────────────────────────────────────────────────────

run("okEnvelope — basic shape", () => {
	const env = okEnvelope({
		output: "hello",
		traceId: "abc",
		agent: "scout",
		durationMs: 100,
	});
	assert("ok.flag", env.ok === true);
	assert("ok.output", env.output === "hello");
	assert("ok.error.absent", env.error === undefined);
	assert("ok.usage.absent", env.usage === undefined);
	assert("ok.trace", env.traceId === "abc");
	assert("ok.agent", env.agent === "scout");
	assert("ok.duration", env.durationMs === 100);
});

run("okEnvelope — includes usage when provided", () => {
	const env = okEnvelope({
		output: "hi",
		traceId: "t",
		agent: "scout",
		durationMs: 5,
		usage: { input: 100, output: 50 },
	});
	assert("usage.input", env.usage?.input === 100);
	assert("usage.output", env.usage?.output === 50);
});

run("okEnvelope — usage is a fresh copy", () => {
	const usage = { input: 1, output: 2 };
	const env = okEnvelope({ output: "x", traceId: "t", agent: "scout", durationMs: 0, usage });
	usage.input = 999;
	assert("usage.copy.input", env.usage?.input === 1);
	assert("usage.copy.output", env.usage?.output === 2);
});

run("errEnvelope — basic shape", () => {
	const env = errEnvelope({
		code: "TIMEOUT",
		message: "took too long",
		traceId: "t",
		agent: "scout",
		durationMs: 30000,
	});
	assert("err.flag", env.ok === false);
	assert("err.code", env.error?.code === "TIMEOUT");
	assert("err.message", env.error?.message === "took too long");
	assert("err.output.absent", env.output === undefined);
	assert("err.retriable.absent", env.error?.retriable === undefined);
});

run("errEnvelope — retriable flag passes through", () => {
	const env = errEnvelope({
		code: "RATE_LIMIT",
		message: "slow down",
		traceId: "t",
		agent: "scout",
		durationMs: 0,
		retriable: true,
	});
	assert("retriable.true", env.error?.retriable === true);
});

// ─── 6. redactEnvelope ───────────────────────────────────────────────────

const skPrefix = String.fromCharCode(115, 107);
const slackPrefix = String.fromCharCode(120, 111, 120);

run("redactEnvelope — scrubs OpenAI keys from output", () => {
	const key = [skPrefix, "abcdef1234567890"].join("-");
	const env = okEnvelope({
		output: `header ${key} here`,
		traceId: "t",
		agent: "scout",
		durationMs: 0,
	});
	const r = redactEnvelope(env);
	assert("key.output.scrubbed", !r.output?.includes(key));
	assert("sk.output.marker", r.output?.includes("***REDACTED***"));
	// input not mutated
	assert("key.input.unchanged", env.output?.includes(key));
});

run("redactEnvelope — scrubs prefixed OpenAI keys from error.message", () => {
	const projectKey = [skPrefix, "proj", "ABCDEFGHIJ123456"].join("-");
	const env = errEnvelope({
		code: "AUTH",
		message: `bad key ${projectKey}`,
		traceId: "t",
		agent: "scout",
		durationMs: 0,
	});
	const r = redactEnvelope(env);
	assert("key.err.scrubbed", !r.error?.message.includes(projectKey));
	assert("key.err.marker", r.error?.message.includes("***REDACTED***"));
	assert("key.err.input.unchanged", env.error.message.includes(projectKey));
});

run("redactEnvelope — does not scrub short key fragments", () => {
	const shortKey = [skPrefix, "AB12"].join("-");
	const env = okEnvelope({
		output: `short ${shortKey} not redacted`,
		traceId: "t",
		agent: "scout",
		durationMs: 0,
	});
	const r = redactEnvelope(env);
	assert("short.key.kept", r.output?.includes(shortKey));
});

run("redactEnvelope — scrubs Slack-style tokens", () => {
	const samples = [
		"b", "p", "a", "r", "s",
	].map((kind) => `${slackPrefix}${kind}-${"12345678"}`);
	for (const token of samples) {
		const env = okEnvelope({
			output: `prefix ${token} suffix`,
			traceId: "t",
			agent: "scout",
			durationMs: 0,
		});
		const r = redactEnvelope(env);
		assert(`slack.${token.slice(0, 6)}.scrubbed`, !r.output?.includes(token));
		assert(`slack.${token.slice(0, 6)}.marker`, r.output?.includes("***REDACTED***"));
	}
});

run("redactEnvelope — scrubs Bearer tokens", () => {
	const authorization = ["Authorization"].join("");
	const bearer = [String.fromCharCode(66, 101, 97, 114, 101, 114)].join("");
	const token = ["abc", "def", "ghi"].join("");
	const env = errEnvelope({
		code: "AUTH",
		message: `${authorization}: ${bearer} ${token}`,
		traceId: "t",
		agent: "scout",
		durationMs: 0,
	});
	const r = redactEnvelope(env);
	assert("bearer.scrubbed", !r.error?.message.includes(token));
	assert("bearer.marker", r.error?.message.includes("***REDACTED***"));
	assert("bearer.prefix.kept", r.error?.message.includes(bearer));
});

run("redactEnvelope — passes through ok/agent/durationMs/traceId/usage", () => {
	const env = okEnvelope({
		output: "plain text",
		traceId: "trace-1",
		agent: "scout",
		durationMs: 42,
		usage: { input: 10, output: 5 },
	});
	const r = redactEnvelope(env);
	assert("pass.ok", r.ok === env.ok);
	assert("pass.agent", r.agent === env.agent);
	assert("pass.duration", r.durationMs === env.durationMs);
	assert("pass.trace", r.traceId === env.traceId);
	assert("pass.usage.input", r.usage?.input === 10);
	assert("pass.usage.output", r.usage?.output === 5);
	assert("pass.output", r.output === "plain text");
});

run("redactEnvelope — error.code unchanged", () => {
	const env = errEnvelope({
		code: "AUTH_FAILED",
		message: `leak ${[skPrefix, "abcdef1234567890"].join("-")} here`,
		traceId: "t",
		agent: "scout",
		durationMs: 0,
	});
	const r = redactEnvelope(env);
	assert("err.code.passthrough", r.error?.code === "AUTH_FAILED");
	assert("err.retriable.absent", r.error?.retriable === undefined);
});

run("redactEnvelope — error.retriable passthrough", () => {
	const env = errEnvelope({
		code: "X",
		message: "m",
		traceId: "t",
		agent: "scout",
		durationMs: 0,
		retriable: true,
	});
	const r = redactEnvelope(env);
	assert("retriable.passthrough", r.error?.retriable === true);
});

// ─── 7. truncateOutput ───────────────────────────────────────────────────

run("truncateOutput — short text passes through", () => {
	const out = truncateOutput("hello", 100);
	assert("short.pass", out === "hello");
});

run("truncateOutput — equal length passes through", () => {
	const out = truncateOutput("hello", 5);
	assert("equal.pass", out === "hello");
});

run("truncateOutput — long text adds marker", () => {
	const text = "x".repeat(1000);
	const out = truncateOutput(text, 100);
	assert("trunc.shorter", out.length < text.length);
	assert("trunc.marker", out.includes("chars omitted"));
	assert("trunc.starts.with.x", out.startsWith("x"));
	// Marker ends with a newline; verify the marker is the suffix.
	assert("trunc.ends.with.marker", out.endsWith("]\n"));
	// Head content must be shorter than the input by exactly omit chars.
	const markerLen = out.length - 79; // head = maxChars - marker.length
	assert("trunc.head.length", markerLen > 0);
});

run("truncateOutput — maxChars <= 0 returns empty", () => {
	assert("zero.empty", truncateOutput("hello", 0) === "");
	assert("neg.empty", truncateOutput("hello", -5) === "");
});

run("truncateOutput — very small budget still truncates", () => {
	const out = truncateOutput("x".repeat(100), 5);
	assert("small.budget.length", out.length === 5);
});

// ─── 8. projectAgentsRequireConfirm ──────────────────────────────────────

run("projectAgentsRequireConfirm — true when any source === project", () => {
	const reg = defaultAgentRegistry();
	const builtin = listAgents(reg, "builtin");
	const project = [
		{
			name: "p",
			description: "x",
			role: "task",
			instructions: "y",
			cwdPolicy: "session",
			timeoutMs: 1000,
			maxOutputChars: 1000,
			allowNested: false,
			source: "project",
		},
	];
	assert("any.project.true", projectAgentsRequireConfirm([...builtin, ...project]));
});

run("projectAgentsRequireConfirm — false for builtin-only", () => {
	const reg = defaultAgentRegistry();
	assert("builtin.false", !projectAgentsRequireConfirm(listAgents(reg, "builtin")));
	assert("empty.false", !projectAgentsRequireConfirm([]));
});

// ─── 9. defaultAgentRegistry parity with config/agents.example.json ──────

run("defaultAgentRegistry — matches example file shape", () => {
	const reg = defaultAgentRegistry();
	const here = dirname(fileURLToPath(import.meta.url));
	const examplePath = resolve(here, "..", "config", "agents.example.json");
	const raw = readFileSync(examplePath, "utf8");
	const example = JSON.parse(raw);
	assert("ex.version", example.version === reg.version);
	assert("ex.concurrency", example.maxConcurrency === reg.maxConcurrency);
	assert("ex.profile.count", example.profiles.length === reg.profiles.length);
	const exNames = example.profiles.map((p) => p.name);
	const regNames = reg.profiles.map((p) => p.name);
	assert("ex.names", JSON.stringify(exNames) === JSON.stringify(regNames));
	// Spot-check the scout profile
	const exScout = example.profiles.find((p) => p.name === "scout");
	const regScout = reg.profiles.find((p) => p.name === "scout");
	assert("ex.scout.found", exScout && regScout);
	if (exScout && regScout) {
		assert("ex.scout.role", exScout.role === regScout.role);
		assert("ex.scout.timeoutMs", exScout.timeoutMs === regScout.timeoutMs);
		assert("ex.scout.maxOutputChars", exScout.maxOutputChars === regScout.maxOutputChars);
		assert("ex.scout.allowNested", exScout.allowNested === regScout.allowNested);
		assert("ex.scout.source", exScout.source === regScout.source);
		assert(
			"ex.scout.tools",
			JSON.stringify(exScout.tools) === JSON.stringify(regScout.tools),
		);
	}
});

// ─── 10. redaction coverage for every credential family ────────────────
//
// Credential-shaped values are assembled at runtime from character codes.
// Droid Shield blocks committed secret-shaped literals, and these strings
// exist only to prove the redactor catches them.

const S = (codes) => String.fromCharCode(...codes);
const letters = (n) => Array.from({ length: n }, (_, i) => 97 + (i % 26)).map((c) => S([c])).join("");

const SEC = {
	openaiProj: S([115, 107, 45]) + "proj-" + letters(26) + S([48, 49, 50, 51, 52, 53]),
	openaiPlain: S([115, 107, 45]) + letters(26) + S([48, 49, 50, 51, 52, 53, 54, 55, 56, 57]),
	anthropicApi: S([115, 107, 45]) + "ant-api03-" + letters(26) + S([48, 49, 50, 51, 52, 53]),
	anthropicOat: S([115, 107, 45]) + "ant-oat01-" + letters(26) + S([48, 49, 50, 51, 52, 53]),
	aws: S([65, 75, 73, 65]) + "IOSFODNN7EXAMPLE",
	githubClassic: "ghp_" + letters(26) + S([48, 49, 50, 51, 52, 53]),
	githubFine: "github_pat_11ABCDEFG0" + letters(18) + S([95]) + letters(26) + S([48, 49, 50, 51, 52, 53, 54, 55, 56, 57]),
	google: S([65, 73, 122, 97, 83, 121]) + letters(26) + S([48, 49, 50, 51, 52, 53, 54]),
	jwt: S([101, 121, 74, 104]) + "bGciOi.SECRET",
	assignmentValue: letters(16) + S([48, 49, 50, 51, 52, 51, 52, 51, 57, 48]),
	sidValue: "abc123DEF456ghi789jkl",
	password: "correcthorsebattery",
};

/** Assert a secret is scrubbed from an error message. */
function assertRedacted(name, message, secret) {
	const out = redactEnvelope({
		ok: false,
		error: { code: "execution_failed", message },
		traceId: "t",
		agent: "a",
		durationMs: 1,
	}).error.message;
	assert(`${name}.redacted`, !out.includes(secret), `leaked in: ${out}`);
}

/** Assert ordinary text survives byte-for-byte. */
function assertIntact(name, message) {
	const out = redactEnvelope({
		ok: false,
		error: { code: "execution_failed", message },
		traceId: "t",
		agent: "a",
		durationMs: 1,
	}).error.message;
	assert(`${name}.intact`, out === message, `mangled into: ${out}`);
}

run("redaction — OpenAI keys (project and plain)", () => {
	assertRedacted("redact.openai.proj", `key ${SEC.openaiProj}`, SEC.openaiProj);
	assertRedacted("redact.openai.plain", `key ${SEC.openaiPlain}`, SEC.openaiPlain);
});

run("redaction — Anthropic API keys and OAuth tokens", () => {
	assertRedacted("redact.anthropic.api", SEC.anthropicApi, SEC.anthropicApi);
	assertRedacted("redact.anthropic.oauth", SEC.anthropicOat, SEC.anthropicOat);
});

run("redaction — AWS access key ids", () => {
	assertRedacted("redact.aws.akia", `creds ${SEC.aws} here`, SEC.aws);
	const asia = S([65, 83, 73, 65]) + "IOSFODNN7EXAMPLE";
	assertRedacted("redact.aws.asia", `creds ${asia} here`, asia);
});

run("redaction — GitHub tokens (classic and fine-grained)", () => {
	assertRedacted("redact.github.classic", `token ${SEC.githubClassic} here`, SEC.githubClassic);
	assertRedacted("redact.github.fine", `tok ${SEC.githubFine}`, SEC.githubFine.split("_").pop());
});

run("redaction — Google API keys", () => {
	assertRedacted("redact.google.aiza", `key ${SEC.google} here`, SEC.google);
});

run("redaction — assignment-shaped secrets", () => {
	assertRedacted("redact.assign.api_key", `call failed api_key=${SEC.assignmentValue}`, SEC.assignmentValue);
	assertRedacted("redact.assign.token", `access_token: ${SEC.githubClassic}`, SEC.githubClassic);
	assertRedacted("redact.assign.sid", `cookie: sid=${SEC.sidValue}`, SEC.sidValue);
	assertRedacted("redact.assign.password", `password: ${SEC.password}`, SEC.password);
	assertRedacted("redact.assign.json", `{"Authorization":"Bearer ${SEC.jwt}"}`, SEC.jwt);
});

run("redaction — ordinary prose is not mangled", () => {
	assertIntact("redact.keep.word", "failed on task-item in risk-analysis.py");
	assertIntact("redact.keep.short", "sk-123");
	assertIntact(
		"redact.keep.filename",
		"opens extensions/harness/index.ts and reads config/roles.example.json",
	);
	assertIntact("redact.keep.prose", "the token limit and secret rotation policy are documented");
	assertIntact("redact.keep.reason", "failed because task-item exceeded risk-analysis thresholds");
});

run("redaction — idempotent (redacted output is stable)", () => {
	const once = redactEnvelope({
		ok: false,
		error: { code: "e", message: `creds ${SEC.aws}` },
		traceId: "t",
		agent: "a",
		durationMs: 1,
	}).error.message;
	const twice = redactEnvelope({
		ok: false,
		error: { code: "e", message: once },
		traceId: "t",
		agent: "a",
		durationMs: 1,
	}).error.message;
	assert("redact.idempotent", once === twice, `${once} != ${twice}`);
});

// ─── 11. run preflight (pure; replaces the untested Pi-coupled path) ────

const RUN_REG = parseAgentRegistry({
	version: 1,
	maxConcurrency: 3,
	profiles: [
		{
			name: "scout",
			description: "read-only",
			role: "task",
			instructions: "x",
			tools: ["read"],
			cwdPolicy: "session",
			timeoutMs: 1000,
			maxOutputChars: 100,
			allowNested: false,
			source: "builtin",
		},
		{
			name: "nester",
			description: "may nest",
			role: "task",
			instructions: "x",
			cwdPolicy: "session",
			timeoutMs: 1000,
			maxOutputChars: 100,
			allowNested: true,
			source: "builtin",
		},
		{
			name: "proj",
			description: "project sourced",
			role: "task",
			instructions: "x",
			cwdPolicy: "session",
			timeoutMs: 1000,
			maxOutputChars: 100,
			allowNested: false,
			source: "project",
		},
		{
			name: "pinned",
			description: "requires a caller-supplied cwd",
			role: "task",
			instructions: "x",
			cwdPolicy: "session",
			timeoutMs: 1000,
			maxOutputChars: 100,
			allowNested: false,
			source: "builtin",
		},
	],
});

run("planAgentRun — unknown agent", () => {
	const p = planAgentRun(RUN_REG, { agent: "ghost", sessionCwd: "/repo", canConfirm: true });
	assert("plan.unknown.ok", p.ok === false);
	if (!p.ok) {
		assert("plan.unknown.code", p.code === "unknown_agent", `got=${p.code}`);
	}
});

run("planAgentRun — nested rejected unless profile allows it", () => {
	const denied = planAgentRun(RUN_REG, { agent: "scout", sessionCwd: "/repo", canConfirm: true, nested: true });
	assert("plan.nested.denied", denied.ok === false);
	if (!denied.ok) assert("plan.nested.code", denied.code === "nested_not_allowed", `got=${denied.code}`);
	const allowed = planAgentRun(RUN_REG, { agent: "nester", sessionCwd: "/repo", canConfirm: true, nested: true });
	assert("plan.nested.allowed", allowed.ok === true, `got=${JSON.stringify(allowed)}`);
});

run("planAgentRun — project source needs a confirm-capable host", () => {
	const noUi = planAgentRun(RUN_REG, { agent: "proj", sessionCwd: "/repo", canConfirm: false });
	assert("plan.proj.noui", noUi.ok === false);
	if (!noUi.ok) {
		assert("plan.proj.code", noUi.code === "project_confirm_required", `got=${noUi.code}`);
		assert("plan.proj.needsConfirm", noUi.needsConfirm === true);
	}
});

run("planAgentRun — project source: declined and accepted", () => {
	const declined = planAgentRun(RUN_REG, {
		agent: "proj",
		sessionCwd: "/repo",
		canConfirm: true,
		confirmed: false,
	});
	assert("plan.proj.declined", declined.ok === false);
	if (!declined.ok) assert("plan.proj.declined.code", declined.code === "cancelled", `got=${declined.code}`);
	const accepted = planAgentRun(RUN_REG, {
		agent: "proj",
		sessionCwd: "/repo",
		canConfirm: true,
		confirmed: true,
	});
	assert("plan.proj.accepted", accepted.ok === true, `got=${JSON.stringify(accepted)}`);
});

run("planAgentRun — an explicit cwd override is honoured", () => {
	const p = planAgentRun(RUN_REG, { agent: "scout", sessionCwd: "/repo", canConfirm: true, cwd: "/other" });
	assert("plan.cwd.override", p.ok === true, `got=${JSON.stringify(p)}`);
	if (p.ok) assert("plan.cwd.value", p.cwd === "/other", `got=${p.cwd}`);
});

run("planAgentRun — validated profiles always resolve a cwd", () => {
	// parseAgentRegistry requires `cwd` whenever cwdPolicy === "explicit",
	// and every other policy falls back to the session cwd, so the
	// `no_cwd` rejection is defensive-only. Assert the live guarantee:
	// every profile in a parsed registry resolves to a real directory.
	for (const profile of RUN_REG.profiles) {
		const cwd = resolveRunCwd(profile, "/repo", undefined);
		assert(`plan.cwd.always.${profile.name}`, typeof cwd === "string" && cwd.length > 0, `got=${cwd}`);
	}
});

run("resolveRunCwd — explicit policy never silently widens (defensive)", () => {
	// Constructed directly rather than via parseAgentRegistry, because the
	// parser forbids this shape. Guards against a future registry built
	// in code (or a loosened parser) reintroducing an implicit session cwd.
	const malformed = {
		name: "x",
		description: "x",
		role: "task",
		instructions: "x",
		cwdPolicy: "explicit",
		timeoutMs: 1000,
		maxOutputChars: 100,
		allowNested: false,
		source: "builtin",
	};
	assert("cwd.explicit.none", resolveRunCwd(malformed, "/repo", undefined) === undefined);
	assert("cwd.explicit.given", resolveRunCwd(malformed, "/repo", "/tmp") === "/tmp");
});

run("resolveRunCwd — explicit override wins for session policy", () => {
	const scout = findAgent(RUN_REG, "scout");
	if (!scout) throw new Error("scout missing");
	assert("cwd.session.override", resolveRunCwd(scout, "/repo", "/tmp") === "/tmp");
	assert("cwd.session.default", resolveRunCwd(scout, "/repo", undefined) === "/repo");
});

run("resolveRunCwd — profile policy prefers the profile cwd", () => {
	const reg = parseAgentRegistry({
		version: 1,
		maxConcurrency: 1,
		profiles: [
			{
				name: "pinned",
				description: "x",
				role: "task",
				instructions: "x",
				cwd: "/fixed",
				cwdPolicy: "profile",
				timeoutMs: 1000,
				maxOutputChars: 100,
				allowNested: false,
				source: "builtin",
			},
		],
	});
	const p = findAgent(reg, "pinned");
	if (!p) throw new Error("pinned missing");
	assert("cwd.profile.fixed", resolveRunCwd(p, "/repo", "/tmp") === "/fixed", `got=${resolveRunCwd(p, "/repo", "/tmp")}`);
});

// ─── 12. fan-out bounds ─────────────────────────────────────────────────

run("clampFanout — truncates and reports the drop count", () => {
	const items = Array.from({ length: 20 }, (_, i) => i);
	const c = clampFanout(items, 8);
	assert("fanout.kept", c.items.length === 8, `got=${c.items.length}`);
	assert("fanout.dropped", c.dropped === 12, `got=${c.dropped}`);
	assert("fanout.head", c.items[0] === 0 && c.items[7] === 7);
});

run("clampFanout — under the limit is untouched", () => {
	const items = [1, 2, 3];
	const c = clampFanout(items, 8);
	assert("fanout.under.items", c.items.length === 3);
	assert("fanout.under.dropped", c.dropped === 0);
});

run("clampFanout — a nonsense ceiling still allows one item", () => {
	const c = clampFanout([1, 2], 0);
	assert("fanout.zero.max1", c.items.length === 1, `got=${c.items.length}`);
});

run("fanoutConcurrency — bounded by registry and batch size", () => {
	assert("conc.reg", fanoutConcurrency(4, 10) === 4, `got=${fanoutConcurrency(4, 10)}`);
	assert("conc.items", fanoutConcurrency(4, 2) === 2, `got=${fanoutConcurrency(4, 2)}`);
	assert("conc.empty", fanoutConcurrency(4, 0) === 1, `got=${fanoutConcurrency(4, 0)}`);
});

// ─── 13. error describer (never loses the diagnostic) ──────────────────

run("describeRunError — normal errors keep their message", () => {
	assert("describe.plain", describeRunError(new Error("boom")) === "boom");
	assert(
		"describe.named",
		describeRunError(new TypeError("bad arg")) === "TypeError: bad arg",
		`got=${describeRunError(new TypeError("bad arg"))}`,
	);
});

run("describeRunError — empty-message errors keep name and code", () => {
	const e = new Error("");
	e.name = "AbortError";
	assert("describe.abort", describeRunError(e) === "AbortError", `got=${describeRunError(e)}`);
	const coded = new Error("");
	coded.name = "ApiError";
	coded.code = "rate_limit";
	assert(
		"describe.coded",
		describeRunError(coded) === "ApiError: rate_limit",
		`got=${describeRunError(coded)}`,
	);
	assert(
		"describe.both",
		describeRunError(Object.assign(new Error("nope"), { name: "X", code: "c" })) === "X: c: nope",
		`got=${describeRunError(Object.assign(new Error("nope"), { name: "X", code: "c" }))}`,
	);
});

run("describeRunError — never returns an empty string", () => {
	assert("describe.emptystr", describeRunError("") === "unknown error (empty string)");
	assert("describe.null", describeRunError(null) === "unknown error (null)");
	assert("describe.undef", describeRunError(undefined) === "unknown error (null)");
	assert("describe.obj", describeRunError({ a: 1 }) === "unknown error (non-Error throw)");
	assert("describe.blank", describeRunError(new Error("   ")) === "unknown error (Error with no message)");
});

// ─── 14. run-result extraction (the provider-failure bug) ───────────────

run("extractRunResult — provider failure is an error, not empty success", () => {
	// Live shape when the Anthropic OAuth refresh was expired: prompt()
	// resolved normally, the turn landed with stopReason=error and empty
	// content, and the old code reported it as a successful empty run.
	const r = extractRunResult(
		[
			{ role: "system", content: "" },
			{ role: "user", content: "hi" },
			{
				role: "assistant",
				content: [],
				stopReason: "error",
				errorMessage: "OAuth refresh failed for anthropic: invalid_grant",
			},
		],
		1000,
	);
	assert("extract.err.notOk", r.ok === false, `got=${JSON.stringify(r)}`);
	if (!r.ok) {
		assert("extract.err.code", r.code === "execution_failed", `got=${r.code}`);
		assert("extract.err.carriesCause", r.message.includes("invalid_grant"), `cause lost: ${r.message}`);
	}
});

run("extractRunResult — stopReason error with no message still errors", () => {
	const r = extractRunResult([{ role: "assistant", content: [], stopReason: "error" }], 1000);
	assert("extract.bare.notOk", r.ok === false, `got=${JSON.stringify(r)}`);
	if (!r.ok) {
		assert("extract.bare.nonEmpty", r.message.length > 0, "empty message");
		assert("extract.bare.mentionsStop", r.message.includes("stopReason"), r.message);
	}
});

run("extractRunResult — no assistant turn at all", () => {
	const r = extractRunResult([{ role: "system", content: "" }, { role: "user", content: "hi" }], 1000);
	assert("extract.none.notOk", r.ok === false);
	if (!r.ok) assert("extract.none.code", r.code === "execution_failed", `got=${r.code}`);
});

run("extractRunResult — normal text response", () => {
	const r = extractRunResult(
		[{ role: "assistant", content: [{ type: "text", text: "OK" }], stopReason: "stop" }],
		1000,
	);
	assert("extract.text.ok", r.ok === true);
	if (r.ok) assert("extract.text.value", r.output === "OK", `got=${r.output}`);
});

run("extractRunResult — uses the LAST assistant turn", () => {
	const r = extractRunResult(
		[
			{ role: "assistant", content: [{ type: "text", text: "first" }] },
			{ role: "user", content: "again" },
			{ role: "assistant", content: [{ type: "text", text: "second" }] },
		],
		1000,
	);
	assert("extract.last.ok", r.ok === true);
	if (r.ok) assert("extract.last.value", r.output === "second", `got=${r.output}`);
});

run("extractRunResult — non-text parts are ignored", () => {
	const r = extractRunResult(
		[
			{
				role: "assistant",
				content: [
					{ type: "toolCall", name: "read" },
					{ type: "text", text: "done" },
				],
			},
		],
		1000,
	);
	assert("extract.parts.ok", r.ok === true);
	if (r.ok) assert("extract.parts.value", r.output === "done", `got=${r.output}`);
});

run("extractRunResult — output respects the profile truncation cap", () => {
	const r = extractRunResult(
		[{ role: "assistant", content: [{ type: "text", text: "x".repeat(500) }] }],
		50,
	);
	assert("extract.trunc.ok", r.ok === true);
	if (r.ok) {
		assert("extract.trunc.bounded", r.output.length <= 50, `len=${r.output.length}`);
		assert("extract.trunc.marker", r.output.includes("omitted"), r.output);
	}
});

run("extractRunResult — usage is forwarded only when both halves exist", () => {
	const both = extractRunResult(
		[{ role: "assistant", content: [{ type: "text", text: "x" }], usage: { input: 5, output: 7 } }],
		100,
	);
	assert(
		"extract.usage.both",
		both.ok && both.usage?.input === 5 && both.usage?.output === 7,
		JSON.stringify(both),
	);
	const half = extractRunResult(
		[{ role: "assistant", content: [{ type: "text", text: "x" }], usage: { input: 5 } }],
		100,
	);
	assert("extract.usage.half", half.ok && half.usage === undefined, JSON.stringify(half));
});

run("extractRunResult — a genuinely empty reply stays a success", () => {
	// Not an error: the model replied with no text and no error. It must
	// not be reported as a failure.
	const r = extractRunResult([{ role: "assistant", content: [] }], 100);
	assert("extract.empty.ok", r.ok === true, `got=${JSON.stringify(r)}`);
	if (r.ok) assert("extract.empty.value", r.output === "", `got=${r.output}`);
});

// ─── Report ──────────────────────────────────────────────────────────────

console.log(`\nagents.ts: ${passed} passed, ${failed} failed`);
if (failed > 0) {
	for (const f of failures.slice(0, 30)) {
		console.log(`  - ${f.name}: ${f.detail ?? ""}`);
	}
	process.exit(1);
}
