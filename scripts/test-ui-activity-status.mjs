import { visibleWidth } from "@earendil-works/pi-tui";
import {
	AcidbathActivityStatus,
	thinkingPreview,
	thinkingTextFromMessage,
} from "../extensions/acidbath/ui-activity-status.ts";

let passed = 0;
let failed = 0;
function assert(name, condition, detail = "") {
	if (condition) passed += 1;
	else {
		failed += 1;
		console.error(`FAIL ${name}${detail ? ` (${detail})` : ""}`);
	}
}

const message = {
	role: "assistant",
	content: [
		{ type: "thinking", thinking: "first thought" },
		{ type: "text", text: "intermediate" },
		{ type: "thinking", thinking: "latest thought\nwith detail" },
	],
};

assert("extracts latest thinking block", thinkingTextFromMessage(message) === "latest thought\nwith detail");
assert("ignores non-assistant messages", thinkingTextFromMessage({ ...message, role: "user" }) === undefined);
assert("ignores messages without thinking", thinkingTextFromMessage({ role: "assistant", content: [{ type: "text", text: "answer" }] }) === undefined);
assert("normalizes preview to one line", thinkingPreview(" alpha\n\tbeta  gamma ") === "alpha beta gamma");
assert("strips terminal control sequences", thinkingPreview("safe\x1b[31m red\x1b[0m\x07") === "safe red");
assert("keeps short preview intact", thinkingPreview("short thought", 20) === "short thought");
assert("tail-truncates long preview", thinkingPreview("0123456789", 6) === "…56789");
assert("handles empty preview", thinkingPreview(undefined) === "");
const boundedTail = thinkingPreview(`${"prefix ".repeat(100_000)}final thought`, 20);
assert("bounds work to the visible tail", boundedTail.endsWith("final thought") && boundedTail.length <= 20);

let renderRequests = 0;
const tui = { requestRender() { renderRequests += 1; } };
const theme = {
	fg(_color, text) { return text; },
	bold(text) { return text; },
};
const widget = new AcidbathActivityStatus(tui, theme, true, true);
widget.update({ visible: true, reasoningActive: true, reasoningPreview: "latest thought" });
const requestsAfterUpdate = renderRequests;
widget.update({ visible: true, reasoningActive: true, reasoningPreview: "latest thought" });
assert("same-state update does not request another render", renderRequests === requestsAfterUpdate);
const cachedReasoningLines = widget.render(80);
assert("same-state render reuses cached lines", widget.render(80) === cachedReasoningLines);
const reasoningRow = cachedReasoningLines.join("\n");
assert("renders reasoning in the shared activity rail", reasoningRow.startsWith("◇ reasoning  latest thought"));
assert("truncates reasoning row to width", visibleWidth(widget.render(12)[0]) <= 12);
widget.update({ kind: "listening", reasoningActive: false, message: "Listening…" });
assert("renders listening in the shared activity rail", widget.render(80)[0] === "◇ listening  Listening…");
widget.update({ kind: "editing", message: "Editing auth.ts" });
assert("renders tool status in the shared activity rail", widget.render(80)[0] === "◇ editing  Editing auth.ts");
widget.update({ kind: "settled", message: "settled" });
assert("hides settled status without reserving a row", widget.render(80).length === 0);
widget.update({ visible: false });
assert("hides without reserving a row", widget.render(80).length === 0);
widget.dispose();

console.log(`activity status: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
