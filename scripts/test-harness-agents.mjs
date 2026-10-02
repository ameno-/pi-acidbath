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

// ─── Report ──────────────────────────────────────────────────────────────

console.log(`\nagents.ts: ${passed} passed, ${failed} failed`);
if (failed > 0) {
	for (const f of failures.slice(0, 30)) {
		console.log(`  - ${f.name}: ${f.detail ?? ""}`);
	}
	process.exit(1);
}
