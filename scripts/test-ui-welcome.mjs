import assert from "node:assert/strict";
import { AcidbathWelcome, initialWelcomeState, messageForSession, modelCardFor, randomStoicMessage, STOIC_MESSAGES } from "../extensions/acidbath/ui-welcome.ts";
import { visibleWidth } from "../extensions/acidbath/ui-gauge.ts";

const theme = {
	fg: (_token, text) => text,
};
const tui = { requestRender() {} };
const state = initialWelcomeState("/Users/example/project", "GPT-5.6", 3);
const widget = new AcidbathWelcome(tui, theme, state);

assert.equal(STOIC_MESSAGES.length, 24);
assert.equal(randomStoicMessage(() => 0).text, STOIC_MESSAGES[0].text);
assert.equal(randomStoicMessage(() => 0.999).text, STOIC_MESSAGES.at(-1).text);
assert.equal(messageForSession(0).author, "Seneca");
assert.equal(messageForSession(STOIC_MESSAGES.length).text, messageForSession(0).text);
assert.equal(state.modelCard.spendTier, "default");
assert.equal(modelCardFor("cheap", { input: 0.5, output: 0.5, cacheRead: 0, cacheWrite: 0 }, "low").spendTier, "low");
assert.equal(modelCardFor("balanced", { input: 2, output: 3, cacheRead: 0, cacheWrite: 0 }, "medium").spendTier, "default");
assert.equal(modelCardFor("expensive", { input: 8, output: 12, cacheRead: 0, cacheWrite: 0 }, "high").spendTier, "high");
assert.ok(state.modelCard.modelName === "GPT-5.6");
assert.ok(state.modelCard.cost === null);
assert.ok(widget.render(120).some((line) => line.includes("cwd")));
assert.ok(widget.render(120).some((line) => line.includes("GPT-5.6") && line.includes("cost unavailable") && line.includes("thinking:default")));
assert.ok(widget.render(40).every((line) => visibleWidth(line) <= 40));
widget.updateCheck("runtime", "ok", "v1");
assert.ok(widget.render(120).some((line) => line.includes("✓ runtime v1")));
assert.ok(!widget.render(120).some((line) => line.includes("╭─ STOIC") || line.includes("╰─")));
assert.ok(widget.render(120).some((line) => line.includes(`— ${state.message.author}`)));
widget.update({ modelCard: modelCardFor("priced-model", { input: 1.25, output: 8, cacheRead: 0, cacheWrite: 0 }, "high") });
assert.ok(widget.render(120).some((line) => line.includes("$1.25/1M") && line.includes("$8/1M") && line.includes("thinking:high")));
assert.ok(widget.render(120).some((line) => line.includes(state.message.text.split(" ").slice(0, 3).join(" "))));
widget.dispose();

console.log("welcome widget: metadata, single-session quote, model card, and width safety pass");
