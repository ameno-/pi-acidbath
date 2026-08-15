import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";

const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const researchSpec = packageJson.dependencies?.["pi-research"] ?? "";

assert.match(researchSpec, /^git\+https:\/\/github\.com\/ameno-\/pi-research\.git#/);
assert.deepEqual(packageJson.bundledDependencies, ["pi-research"]);
assert.equal(packageJson.dependencies?.["pi-web-access"], "0.20.0");
assert.ok(packageJson.pi.extensions.includes("./node_modules/pi-research/extension/index.ts"));
assert.ok(packageJson.pi.extensions.includes("./node_modules/pi-web-access/index.ts"));
assert.ok(packageJson.pi.skills.includes("./skills/hunk-review"));
assert.ok(packageJson.pi.skills.includes("./skills/acidbath-operator"));
assert.ok(packageJson.files.includes("skills"));
assert.ok(existsSync(new URL("../node_modules/pi-web-access/index.ts", import.meta.url)));

console.log("package manifest: pi-research and pi-web-access enabled");
