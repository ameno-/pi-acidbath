import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const researchSpec = packageJson.dependencies?.["pi-research"] ?? "";

assert.match(researchSpec, /^git\+https:\/\/github\.com\/ameno-\/pi-research\.git#/);
assert.deepEqual(packageJson.bundledDependencies, ["pi-research"]);
assert.ok(packageJson.pi.extensions.includes("./node_modules/pi-research/extension/index.ts"));

console.log("package manifest: pi-research bundled and enabled");
