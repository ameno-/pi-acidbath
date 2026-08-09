import { ToolActivityStore } from "../extensions/acidbath/ui-tool-activity.ts";

let passed = 0;
let failed = 0;
function assert(name, condition) {
  if (condition) passed += 1;
  else {
    failed += 1;
    console.error(`FAIL: ${name}`);
  }
}

const store = new ToolActivityStore();
for (let i = 0; i < 8; i += 1) {
  store.update({
    event: "update",
    toolCallId: `tool-${i}`,
    toolName: "read",
    target: `file-${i}.ts`,
    status: "success",
    metadata: ["done"],
  });
}

let view = store.visibleEntries();
assert("viewport is bounded", view.entries.length === 4);
assert("newest entries are pinned at bottom", view.entries.at(-1)?.target === "file-7.ts");
assert("older entries report hidden above", view.hiddenAbove === 4);

store.scroll(1);
view = store.visibleEntries();
assert("scrolling upward reveals older entries", view.entries[0]?.target === "file-3.ts");
assert("newer entries report hidden below", view.hiddenBelow === 1);

store.scrollToTop();
view = store.visibleEntries();
assert("top scroll reaches oldest visible entry", view.entries[0]?.target === "file-0.ts");

store.scrollToBottom();
view = store.visibleEntries();
assert("bottom scroll returns newest entry", view.entries.at(-1)?.target === "file-7.ts");

store.update({
  event: "start",
  toolCallId: "live",
  toolName: "bash",
  target: "sleep 2",
  status: "pending",
  metadata: ["running"],
});
view = store.visibleEntries();
assert("pending entries stay pinned", view.entries.at(-1)?.target === "sleep 2");
assert("pending count is exposed", view.activeCount === 1);

console.log(`tool activity: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
