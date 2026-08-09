import {
  toolMotionGlyphForTool,
  toolMotionStyle,
} from "../extensions/acidbath/ui-motion.ts";

let passed = 0;
let failed = 0;
function assert(name, condition, detail = "") {
  if (condition) passed += 1;
  else {
    failed += 1;
    console.error(`FAIL ${name}${detail ? ` (${detail})` : ""}`);
  }
}

assert("read uses search motion", toolMotionStyle("read") === "search");
assert("edit uses shape motion", toolMotionStyle("edit") === "shape");
assert("bash uses command motion", toolMotionStyle("bash") === "command");
assert("ls opts out of motion", toolMotionStyle("ls") === "none");
assert("search and shape frames differ", toolMotionGlyphForTool("read", "pending", 1, false) !== toolMotionGlyphForTool("edit", "pending", 1, false));
assert("none keeps the four-cell rail", toolMotionGlyphForTool("ls", "pending", 1, false) === "    ");
assert("success uses a check glyph", toolMotionGlyphForTool("write", "success", 0, false) === "✓");
assert("error uses a cross glyph", toolMotionGlyphForTool("write", "error", 0, false) === "×");

console.log(`tool motion: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
