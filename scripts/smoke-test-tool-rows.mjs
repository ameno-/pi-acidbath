/**
 * Quick smoke test: load the tool-row formatter and render sample rows.
 * Run: node --experimental-strip-types --no-warnings scripts/smoke-test-tool-rows.mjs
 */

import { formatToolRow, toolRowVisibleWidth } from "../extensions/acidbath/ui-tool-rows.ts";
import { STATUS_LUMPY } from "../extensions/acidbath/rendering/kaomoji.ts";
import { subscribe, subscriberCount, reset } from "../extensions/acidbath/rendering/motion.ts";

const W = 72;

// ── Settled rows: one mark, the tool name, no face ────────────────
console.log("=== SETTLED SUCCESS ===");
for (const [name, target, meta] of [
  ["read",  "extensions/acidbath/index.ts",       "214 lines"],
  ["bash",  "npm test",                           "exit 0 · 8.4s"],
  ["edit",  "extensions/acidbath/index.ts",       "+24 −11"],
  ["write", "extensions/acidbath/new-file.ts",    "created · +47"],
  ["grep",  "renderResult · extensions/acidbath", "12 matches · 3 files"],
  ["ls",    "extensions/acidbath",                "14 entries"],
  ["find",  "*.ts · src",                         "47 results"],
]) {
  const row = formatToolRow({ width: W, statusGlyph: "·", toolGlyph: "", toolName: name, target, status: "success", metadata: [meta], expandable: true });
  const ok = toolRowVisibleWidth(row) <= W && row.startsWith(`· ${name}`) && !row.includes("(");
  console.log(`  ${ok ? "✓" : "✗"} [${row}]`);
}

console.log("\n=== SETTLED ERROR ===");
for (const [name, target, meta] of [
  ["read", "no-such-file.ts",              "file not found"],
  ["bash", "npm test",                     "exit 1 · 2.3s"],
  ["edit", "extensions/acidbath/index.ts", "old text not found"],
]) {
  const row = formatToolRow({ width: W, statusGlyph: "×", toolGlyph: "", toolName: name, target, status: "error", metadata: [meta], expandable: true });
  const ok = toolRowVisibleWidth(row) <= W && !row.includes("expand") && !row.includes("(");
  console.log(`  ${ok ? "✓" : "✗"} [${row}]`);
}

console.log("\n=== COLLAPSED DOES NOT ADVERTISE EXPAND ===");
const collapsed = formatToolRow({ width: W, statusGlyph: "·", toolGlyph: "", toolName: "read", target: "src/app.ts", status: "success", metadata: ["12 lines"], expandable: true, expanded: false });
console.log(`  ${collapsed.includes("expand") ? "✗" : "✓"} [${collapsed}]`);

// ── Pending rows stay one quiet line ───────────────────────────────
console.log("\n=== PENDING ===");
for (const toolName of ["bash", "grep", "edit", "write", "ls", "find", "read"]) {
  const row = formatToolRow({ width: W, statusGlyph: "◦", toolGlyph: "", toolName, target: `${toolName} target`, status: "pending", metadata: ["running"], expandable: false });
  const ok = toolRowVisibleWidth(row) <= W && row.startsWith(`◦ ${toolName}`);
  console.log(`  ${ok ? "✓" : "✗"} [${row}]`);
}

// ── NO_COLOR fallback ──────────────────────────────────────────────
console.log("\n=== NO_COLOR FALLBACK (empty statusGlyph/toolGlyph) ===");
const ncRow = formatToolRow({ width: W, statusGlyph: "", toolGlyph: "", toolName: "edit", target: "src/app.ts", status: "success", metadata: ["+3 -1"], expandable: true });
console.log(`  [${ncRow}]`);
console.log(`  startsWith "ok  edit"? ${ncRow.startsWith("ok  edit") ? "✓" : "✗"}`);
console.log(`  face reserved for the rail? ${STATUS_LUMPY.startsWith("(") ? "✓" : "✗"}`);

// ── Motion clock ───────────────────────────────────────────────────
console.log("\n=== MOTION CLOCK ===");
reset();
console.log(`  initial subscribers: ${subscriberCount()} (0 = ✓)`);

const unsubs = [];
for (let i = 0; i < 3; i++) {
  unsubs.push(subscribe(`tool-${i}`, () => {}));
}
console.log(`  after 3 subscribes: ${subscriberCount()} (3 = ✓)`);

unsubs.forEach(u => u());
console.log(`  after all unsub: ${subscriberCount()} (0 = ✓, no idle timer)`);

// ── Width safety ───────────────────────────────────────────────────
console.log("\n=== WIDTH SAFETY (40, 60, 80) ===");
for (const w of [40, 60, 80]) {
  const row = formatToolRow({ width: w, statusGlyph: "·", toolGlyph: "", toolName: "read", target: "extensions/acidbath/very-long-directory-name/index.ts", status: "success", metadata: ["214 lines"], expandable: true });
  const vw = toolRowVisibleWidth(row);
  const ok = vw <= w;
  console.log(`  w=${w}: vw=${vw} ${ok ? "✓" : "✗"} [${row}]`);
}

console.log("\n=== ALL CHECKS DONE ===");
