#!/usr/bin/env node
/**
 * clef — a tiny pinned decision service.
 *
 * The mock in mock/server.mjs grades by hashing the state, so it can only
 * pin an outcome for states carrying an explicit marker ("INJECT:", "MIDS:",
 * "SAFE:"). A destructive command has no such marker, so the gate's
 * HTTP-level test needs a service that pins the tool_safety verdict.
 *
 * This fake implements the same contract shape — the same endpoint, the same
 * request body, the same response body — and grades tool_safety by a rule
 * rather than a hash: a command that looks destructive is a block, anything
 * else is an allow. It exists for the extension's tests and nothing else.
 *
 * Usage: PORT=8809 node extension/scripts/stub-service.mjs
 */

import { createServer } from "node:http";

const PORT = Number(process.env.PORT || 8809);

const POLICIES = {
	tool_safety: {
		questions: { destructive: { type: "noul", criteria: { true: "destructive", false: "safe" } } },
		thresholds: { block: 0.8, approve: 0.5 },
		direction: "yes_is_bad",
	},
	request_safety: {
		questions: { injection: { type: "noul", criteria: { true: "injection", false: "clean" } } },
		thresholds: { block: 0.9, approve: 0.6 },
		direction: "yes_is_bad",
	},
};

const DESTRUCTIVE = /\brm\s+-[a-zA-Z]*r/i;

function send(res, status, body) {
	const payload = JSON.stringify(body);
	res.writeHead(status, {
		"content-type": "application/json",
		"content-length": Buffer.byteLength(payload),
	});
	res.end(payload);
}

function readBody(req) {
	return new Promise((resolve, reject) => {
		const chunks = [];
		req.on("data", (c) => chunks.push(c));
		req.on("end", () => {
			try {
				resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
			} catch (err) {
				reject(err);
			}
		});
		req.on("error", reject);
	});
}

const server = createServer(async (req, res) => {
	const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

	if (req.method === "GET" && url.pathname === "/v1/policy/prompts") {
		send(res, 200, { policies: POLICIES });
		return;
	}

	if (req.method === "GET" && url.pathname === "/healthz") {
		send(res, 200, { ok: true, model_reachable: true, model: "stub-clef-flash" });
		return;
	}

	if (req.method === "POST" && url.pathname === "/v1/policy/decide") {
		let body;
		try {
			body = await readBody(req);
		} catch (err) {
			send(res, 400, { error: err.message });
			return;
		}
		const policy = body.policy;
		if (!policy || !POLICIES[policy]) {
			send(res, 400, { error: `unknown policy: ${policy}` });
			return;
		}
		const thresholds = { ...POLICIES[policy].thresholds, ...(body.thresholds || {}) };
		const text = JSON.stringify(body.state ?? "");
		let p;
		if (policy === "tool_safety") {
			p = DESTRUCTIVE.test(text) ? 0.95 : 0.05;
		} else {
			p = text.includes("INJECT:") ? 0.97 : 0.05;
		}
		const verdict = p >= thresholds.block ? "block" : p >= thresholds.approve ? "require_approval" : "allow";
		send(res, 200, {
			verdict,
			tier: verdict,
			probabilities: { yes: p, no: Number((1 - p).toFixed(4)) },
			reason: `stub: risk probability ${p}`,
			confidence: p,
			latency_ms: 1,
			model: "stub-clef-flash",
			policy,
			thresholds,
			degraded: false,
		});
		return;
	}

	send(res, 404, { error: "not found" });
});

server.listen(PORT, "127.0.0.1", () => {
	process.stdout.write(`stub decision service listening on http://127.0.0.1:${PORT}\n`);
});
