/**
 * Quick smoke test: load all the new modules and render sample tool rows.
 * Run: node --experimental-strip-types --no-warnings scripts/smoke-test-tool-rows.mjs
 */

import { formatToolRow, toolRowVisibleWidth } from "../extensions/acidbath/ui-tool-rows.ts";
import {
  STATUS_SWAG, STATUS_TOLDYOU, STATUS_GTFO, STATUS_LUMPY,
  TOOL_READ, TOOL_BASH, TOOL_EDIT, TOOL_WRITE, TOOL_GREP, TOOL_LS, TOOL_FIND,
  toolGlyph, statusGlyph, animFrame,
} from "../extensions/acidbath/rendering/kaomoji.ts";
import { subscribe, currentFrame, subscriberCount, reset } from "../extensions/acidbath/rendering/motion.ts";

const W = 72;

// ── Settled rows ───────────────────────────────────────────────────
console.log("=== SETTLED SUCCESS ===");
for (const [glyph, name, target, meta] of [
  [TOOL_READ,  "read",  "extensions/acidbath/index.ts",              "214 lines"],
  [TOOL_BASH,  "bash",  "npm test",                                  "exit 0 · 8.4s"],
  [TOOL_EDIT,  "edit",  "extensions/acidbath/index.ts",              "+24 −11"],
  [TOOL_WRITE, "write", "extensions/acidbath/new-file.ts",           "created · +47"],
  [TOOL_GREP,  "grep",  "renderResult · extensions/acidbath",        "12 matches · 3 files"],
  [TOOL_LS,    "ls",    "extensions/acidbath",                       "14 entries"],
  [TOOL_FIND,  "find",  "*.ts · src",                                "47 results"],
]) {
  const row = formatToolRow({ width: W, statusGlyph: STATUS_SWAG, toolGlyph: glyph, toolName: name, target, status: "success", metadata: [meta], expandable: true });
  const ok = toolRowVisibleWidth(row) <= W;
  console.log(`  ${ok ? "✓" : "✗"} [${row}]`);
}

console.log("\n=== SETTLED ERROR ===");
for (const [glyph, name, target, meta] of [
  [TOOL_READ, "read", "no-such-file.ts",                    "file not found"],
  [TOOL_BASH, "bash", "npm test",                           "exit 1 · 2.3s"],
  [TOOL_EDIT, "edit", "extensions/acidbath/index.ts",        "old text not found"],
]) {
  const row = formatToolRow({ width: W, statusGlyph: STATUS_TOLDYOU, toolGlyph: glyph, toolName: name, target, status: "error", metadata: [meta], expandable: true });
  const ok = toolRowVisibleWidth(row) <= W;
  console.log(`  ${ok ? "✓" : "✗"} [${row}]`);
}

console.log("\n=== WARNING ===");
const warn = formatToolRow({ width: W, statusGlyph: STATUS_GTFO, toolGlyph: TOOL_BASH, toolName: "bash", target: "rm -rf node_modules", status: "error", metadata: ["risky"], expandable: true });
console.log(`  ${toolRowVisibleWidth(warn) <= W ? "✓" : "✗"} [${warn}]`);

// ── Pending rows with animation frames ─────────────────────────────
console.log("\n=== PENDING (animation frames) ===");
for (const toolName of ["bash", "grep", "edit", "write", "ls", "find", "read"]) {
  const glyph = toolGlyph(toolName);
  const frames = [];
  for (let t = 0; t < 6; t++) {
    const animated = animFrame(toolName, t);
    frames.push(animated);
  }
  const row = formatToolRow({ width: W, statusGlyph: STATUS_LUMPY, toolGlyph: glyph, toolName, target: `${toolName} target`, status: "pending", metadata: ["running"], expandable: false });
  const ok = toolRowVisibleWidth(row) <= W;
  console.log(`  ${ok ? "✓" : "✗"} [${row}]  frames: ${frames.join(" → ")}`);
}

// ── NO_COLOR fallback ──────────────────────────────────────────────
console.log("\n=== NO_COLOR FALLBACK (empty statusGlyph/toolGlyph) ===");
const ncRow = formatToolRow({ width: W, statusGlyph: "", toolGlyph: "", toolName: "edit", target: "src/app.ts", status: "success", metadata: ["+3 -1"], expandable: true });
console.log(`  [${ncRow}]`);
console.log(`  startsWith "ok  edit"? ${ncRow.startsWith("ok  edit") ? "✓" : "✗"}`);

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
  const row = formatToolRow({ width: w, statusGlyph: STATUS_SWAG, toolGlyph: TOOL_READ, toolName: "read", target: "extensions/acidbath/very-long-directory-name/index.ts", status: "success", metadata: ["214 lines"], expandable: true });
  const vw = toolRowVisibleWidth(row);
  const ok = vw <= w;
  console.log(`  w=${w}: vw=${vw} ${ok ? "✓" : "✗"} [${row}]`);
}

console.log("\n=== ALL CHECKS DONE ===");
