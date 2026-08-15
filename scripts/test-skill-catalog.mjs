import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const catalog = JSON.parse(await readFile(new URL("../config/skill-catalog.json", import.meta.url), "utf8"));
assert.equal(catalog.version, 1);
assert.ok(Array.isArray(catalog.default) && catalog.default.length >= 8);
assert.ok(catalog.on_demand.some((e) => e.name === "wrangler"));
assert.ok(catalog.on_demand.some((e) => e.name === "workers-best-practices"));
assert.ok(catalog.on_demand.some((e) => e.name === "cloudflare-one"));
assert.ok(!catalog.default.some((e) => e.name === "wrangler"));
assert.ok(catalog.archived?.names.includes("qmd-knowledge"));
console.log(`skill catalog: ${catalog.default.length} default, ${catalog.on_demand.length} on-demand`);
