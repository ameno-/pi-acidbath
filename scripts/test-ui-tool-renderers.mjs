import assert from "node:assert/strict";
import { createJiti } from "../node_modules/@earendil-works/pi-coding-agent/node_modules/jiti/lib/jiti.mjs";

const jiti = createJiti(import.meta.url);
const { createCompactToolRenderers } = await jiti.import("../extensions/acidbath/ui-tool-renderers.ts");
const { subscriberCount, dispose } = await jiti.import("../extensions/acidbath/rendering/motion.ts");

const theme = {
	fg: (_color, text) => text,
	bg: (_color, text) => text,
	bold: (text) => text,
};
const nativeDetail = {
	render: () => ["# Acidbath", "structured detail"],
	invalidate() {},
};
const definition = { name: "read" };
let nativeRenderCalls = 0;
let nativeState;
const factory = () => ({
	...definition,
	renderResult: (_result, _options, _theme, context) => {
		nativeRenderCalls++;
		nativeState = context.state;
		return nativeDetail;
	},
});
const renderers = createCompactToolRenderers(definition, factory, { noColor: false, reducedMotion: true });
const state = {};
const baseContext = {
	args: { path: "/tmp/acidbath-operator/SKILL.md" },
	toolCallId: "tool-1",
	invalidate() {},
	lastComponent: undefined,
	state,
	cwd: "/tmp",
	executionStarted: true,
	argsComplete: true,
	isPartial: true,
	expanded: false,
	showImages: true,
	isError: false,
};

const call = renderers.renderCall(baseContext.args, theme, baseContext);
assert.match(call.render(100)[0], /skill acidbath-operator/);
assert.equal(subscriberCount(), 0, "reduced motion must not start the shared clock");

const raw = "---\nname: acidbath-operator\ndescription: noisy raw body\n---\n# Acidbath";
const resultContext = { ...baseContext, isPartial: false, lastComponent: undefined };
const result = renderers.renderResult(
	{ content: [{ type: "text", text: raw }], details: undefined },
	{ expanded: false, isPartial: false },
	theme,
	resultContext,
);
assert.deepEqual(call.render(100), [], "the call row must hide before the result frame renders");
const collapsed = result.render(100);
assert.equal(collapsed.length, 1, "collapsed read output must remain one semantic row");
assert.match(collapsed[0], /skill acidbath-operator/);
assert.match(collapsed[0], /5 lines/);
assert.doesNotMatch(collapsed.join("\n"), /description: noisy raw body/);
assert.equal(nativeRenderCalls, 0, "collapsed output must not construct native details");

const expanded = renderers.renderResult(
	{ content: [{ type: "text", text: raw }], details: undefined },
	{ expanded: true, isPartial: false },
	theme,
	{ ...resultContext, expanded: true, lastComponent: result },
);
assert.strictEqual(expanded, result, "result components should be reused in place");
assert.equal(nativeRenderCalls, 1);
assert.notStrictEqual(nativeState, state, "native renderers need isolated row-local state");
assert.deepEqual(expanded.render(100).slice(1), ["  # Acidbath", "  structured detail"]);

const animatedRenderers = createCompactToolRenderers(definition, factory, { noColor: false, reducedMotion: false });
const animatedContext = { ...baseContext, toolCallId: "tool-2", state: {}, lastComponent: undefined };
animatedRenderers.renderCall(animatedContext.args, theme, animatedContext);
assert.equal(subscriberCount(), 1, "a live pending row should share the motion clock");
animatedRenderers.renderResult(
	{ content: [{ type: "text", text: "streaming" }], details: undefined },
	{ expanded: true, isPartial: true },
	theme,
	{ ...animatedContext, expanded: true },
);
assert.equal(nativeRenderCalls, 1, "partial expansion must not start native renderer timers");
animatedRenderers.renderResult(
	{ content: [{ type: "text", text: "done" }], details: undefined },
	{ expanded: false, isPartial: false },
	theme,
	{ ...animatedContext, isPartial: false },
);
assert.equal(subscriberCount(), 0, "settlement must release the motion clock");

// Pi's current edit result renderer can render the final diff without its call
// renderer; lock that compatibility assumption down against the installed Pi.
const { createEditToolDefinition } = await import("@earendil-works/pi-coding-agent");
const { initTheme, theme: piTheme } = await import("../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js");
initTheme("dark", false);
const editDefinition = createEditToolDefinition("/tmp");
const editRenderers = createCompactToolRenderers(editDefinition, createEditToolDefinition, { noColor: true, reducedMotion: true });
const editArgs = { path: "x.ts", edits: [{ oldText: "a", newText: "b" }] };
const editContext = {
	...baseContext,
	args: editArgs,
	toolCallId: "tool-edit",
	state: {},
	isPartial: false,
	expanded: true,
};
editRenderers.renderCall(editArgs, piTheme, editContext);
const editResult = editRenderers.renderResult(
	{
		content: [{ type: "text", text: "Successfully replaced text in x.ts." }],
		details: { diff: "@@ -1 +1 @@\n-a\n+b", firstChangedLine: 1 },
	},
	{ expanded: true, isPartial: false },
	piTheme,
	editContext,
);
const editText = editResult.render(80).join("\n").replace(/\x1b\[[0-9;]*m/g, "");
assert.match(editText, /-a/);
assert.match(editText, /\+b/);

dispose();
console.log("tool renderer lifecycle: stable row, immediate dedupe, lazy native expansion pass");
