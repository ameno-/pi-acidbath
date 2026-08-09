import assert from "node:assert/strict";
import { AcidbathWelcome, initialWelcomeState, messageForSession, STOIC_MESSAGES } from "../extensions/acidbath/ui-welcome.ts";
import { visibleWidth } from "../extensions/acidbath/ui-gauge.ts";

const theme = {
	fg: (_token, text) => text,
};
const tui = { requestRender() {} };
const state = initialWelcomeState("/Users/example/project", "GPT-5.6", 3);
const widget = new AcidbathWelcome(tui, theme, state);

assert.equal(STOIC_MESSAGES.length >= 4, true);
assert.equal(messageForSession(0).author, "Seneca");
assert.equal(messageForSession(STOIC_MESSAGES.length).text, messageForSession(0).text);
assert.ok(widget.render(120).some((line) => line.includes("cwd")));
assert.ok(widget.render(120).some((line) => line.includes("model GPT-5.6")));
assert.ok(widget.render(40).every((line) => visibleWidth(line) <= 40));
widget.updateCheck("runtime", "ok", "v1");
assert.ok(widget.render(120).some((line) => line.includes("✓ runtime v1")));

console.log("welcome widget: metadata, quote rotation, and width safety pass");
