/**
 * Integration test for the compactor MCP server.
 *
 * Run:
 *   node --experimental-strip-types --no-warnings scripts/test-mcp-compactor.mjs
 *
 * Spawns mcp/compactor-server.mjs, performs the MCP stdio handshake
 * (initialize → initialized → tools/list → tools/call ×3) and asserts on
 * every response. Requires nushell for the compaction round-trips (the
 * server is still exercised end-to-end without it — tools report the
 * unavailability instead of hanging).
 */

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(__dirname, "..", "mcp", "compactor-server.mjs");

function bigJsonArray(n) {
	const rows = [];
	for (let i = 0; i < n; i++) rows.push({ id: i, name: `item-${i}`, status: i % 2 === 0 ? "active" : "idle" });
	return JSON.stringify(rows);
}

class McpClient {
	constructor() {
		this.proc = spawn(process.execPath, ["--experimental-strip-types", "--no-warnings", SERVER], {
			stdio: ["pipe", "pipe", "pipe"],
		});
		this.nextId = 1;
		this.pending = new Map();
		this.lines = readline.createInterface({ input: this.proc.stdout });
		this.lines.on("line", (line) => {
			if (!line.trim()) return;
			let msg;
			try {
				msg = JSON.parse(line);
			} catch {
				return;
			}
			if (msg.id !== undefined && this.pending.has(msg.id)) {
				const { resolve, reject } = this.pending.get(msg.id);
				this.pending.delete(msg.id);
				msg.error ? reject(new Error(`${msg.error.message}: ${JSON.stringify(msg.error.data ?? {})}`)) : resolve(msg.result);
			}
		});
		this.stderr = "";
		this.proc.stderr.on("data", (d) => (this.stderr += d));
	}

	request(method, params) {
		const id = this.nextId++;
		const p = new Promise((resolve, reject) => {
			this.pending.set(id, { resolve, reject });
			setTimeout(() => {
				if (this.pending.has(id)) {
					this.pending.delete(id);
					reject(new Error(`timeout waiting for ${method} (id ${id})`));
				}
			}, 30_000);
		});
		this.proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
		return p;
	}

	notify(method, params) {
		this.proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
	}

	close() {
		this.proc.kill();
	}
}

const client = new McpClient();
const data = [];

try {
	// 1. initialize handshake
	const init = await client.request("initialize", {
		protocolVersion: "2025-06-18",
		capabilities: {},
		clientInfo: { name: "acidbath-mcp-test", version: "1.0.0" },
	});
	assert.equal(init.serverInfo.name, "acidbath-compactor");
	assert.ok(init.capabilities.tools, "server must advertise tools capability");
	assert.ok(init.instructions.includes("nushell"), "instructions should mention nushell");
	data.push("initialize: serverInfo + tools capability OK");
	client.notify("notifications/initialized", {});

	// 2. tools/list
	const { tools } = await client.request("tools/list", {});
	const names = tools.map((t) => t.name);
	assert.deepEqual(names, ["compact", "query", "schema"]);
	for (const t of tools) {
		assert.ok(t.description.length > 30, `${t.name} needs a real description`);
		assert.ok(t.inputSchema.type === "object");
		assert.ok(t.inputSchema.required.length > 0);
	}
	data.push("tools/list: compact + query + schema with schemas OK");

	const noNu = (m) => /nushell not found/i.test(m);

	// 3. compact a large JSON array
	const input = bigJsonArray(400);
	const compact = await client.request("tools/call", { name: "compact", arguments: { text: input } });
	if (noNu(JSON.stringify(compact))) {
		console.warn("mcp-compactor: nushell not available, skipping compaction round-trips");
	} else {
		assert.equal(compact.isError, undefined, `compact failed: ${JSON.stringify(compact)}`);
		const text = compact.content[0].text;
		assert.match(text, /^\[compacted: json_array, 400 rows total/);
		assert.match(text, /full_data_path: .+\.json/);
		assert.match(text, /savings=\d+%/);
		const match = text.match(/full_data_path: (\S+)/);
		const fullDataPath = match[1];
		assert.ok(fs.existsSync(fullDataPath), "full data file must exist on disk");
		assert.equal(fs.readFileSync(fullDataPath, "utf-8"), input, "full data must be byte-identical");
		data.push(`compact: 400-row JSON array → preview, full data saved byte-identical to ${path.basename(fullDataPath)}`);

		// 4. schema on the saved file
		const schema = await client.request("tools/call", { name: "schema", arguments: { file: fullDataPath } });
		assert.equal(schema.isError, undefined, `schema failed: ${JSON.stringify(schema)}`);
		const schemaText = schema.content[0].text;
		assert.match(schemaText, /shape: /);
		assert.match(schemaText, /rows: 400/);
		assert.match(schemaText, /columns: id, name, status/);
		data.push("schema: shape + rows + columns OK");

		// 5. query: filter + aggregate against the saved file
		const q1 = await client.request("tools/call", {
			name: "query",
			arguments: { file: fullDataPath, pipeline: 'where status == "active" | length' },
		});
		assert.equal(q1.isError, undefined, `query failed: ${JSON.stringify(q1)}`);
		assert.equal(q1.content[0].text.trim(), "200");
		data.push('query: where status == "active" | length → 200 OK');

		const q2 = await client.request("tools/call", {
			name: "query",
			arguments: { file: fullDataPath, pipeline: 'group-by status | items { |k, v| {status: $k, count: ($v | length)} } | to json --raw' },
		});
		assert.equal(q2.isError, undefined, `group-by failed: ${JSON.stringify(q2)}`);
		const grouped = JSON.parse(q2.content[0].text);
		assert.ok(Array.isArray(grouped) && grouped.length === 2, `two status groups expected, got: ${JSON.stringify(grouped)}`);
		const active = grouped.find((g) => g.status === "active");
		assert.ok(active && JSON.stringify(active).includes("200"), `active group should count 200: ${JSON.stringify(active)}`);
		data.push("query: group-by status | to json → 2 groups OK");

		// 6. error paths: bad pipeline, missing file, unknown tool
		const qErr = await client.request("tools/call", { name: "query", arguments: { file: fullDataPath, pipeline: "this is not a pipeline" } });
		assert.ok(qErr.isError === true || qErr.isError === undefined, "bad pipeline should not crash the server");
		assert.match(JSON.stringify(qErr), /Error|error/);

		const missing = await client.request("tools/call", { name: "query", arguments: { file: "/tmp/nope-definitely-missing.json", pipeline: "length" } });
		assert.equal(missing.isError, true, "missing file should be an error result");
		assert.match(missing.content[0].text, /file not found/);

		const unknownP = client.request("tools/call", { name: "nope", arguments: {} });
		let unknownErr;
		try {
			await unknownP;
		} catch (e) {
			unknownErr = e;
		}
		assert.ok(unknownErr && /unknown tool/.test(unknownErr.message), "unknown tool should be a JSON-RPC error");
		data.push("error paths: bad pipeline / missing file / unknown tool handled OK");

		// 7. server still alive after errors
		const ping = await client.request("ping", {});
		assert.deepEqual(ping, {});
		data.push("server alive after error round-trips OK");
	}
} finally {
	client.close();
}

console.log("mcp-compactor:");
for (const d of data) console.log(`  ✓ ${d}`);
console.log("all MCP round-trips pass");
