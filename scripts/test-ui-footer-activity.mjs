import { visibleWidth } from "@earendil-works/pi-tui";
import { AgentOutputBanner, formatAgentTimestamp, normalizePromptPreview } from "../extensions/acidbath/ui-agent-output.ts";
import { AcidbathFooter } from "../extensions/acidbath/ui-footer.ts";

let passed = 0;
let failed = 0;
function assert(name, condition, detail = "") {
	if (condition) passed += 1;
	else {
		failed += 1;
		console.error(`FAIL ${name}${detail ? ` (${detail})` : ""}`);
	}
}

process.env.PI_ACIDBATH_REDUCED_MOTION = "1";
const tui = { requestRender() {} };
const theme = {
	fg(_color, text) { return text; },
	bg(_color, text) { return text; },
	bold(text) { return text; },
};

const footer = new AcidbathFooter(tui, theme, "/tmp/project", true);
footer.update({ modelName: "model", branchName: "feature/footer", thinkingLevel: "high", contextVisible: true, contextPercent: 0.5, activityText: "Short lyric" });
const shortLine = footer.render(120)[0];
footer.update({ activityText: "A substantially longer lyric that must be clipped to the same fixed slot width" });
const longLine = footer.render(120)[0];
assert("footer remains width-safe", visibleWidth(shortLine) <= 120 && visibleWidth(longLine) <= 120);
assert("context position is fixed across lyric lengths", shortLine.indexOf("ctx ") === longLine.indexOf("ctx "));
assert("unknown context has no question mark", !shortLine.includes("ctx ?"));
assert("footer shows the current branch", shortLine.includes("feature/footer"));
assert("footer always reserves token fields", shortLine.includes("0 in /") && shortLine.includes("0 out"));
assert("short lyric is visible", shortLine.includes("♪ Short lyric"));
assert("overlong lyric is rejected instead of chopped", longLine.includes("♪ …") && !longLine.includes("same fixed slot width"));
assert("lyric is centered within its fixed slot", Math.abs(shortLine.indexOf("♪ Short lyric") - longLine.indexOf("♪ …")) <= 20);
footer.update({ activityText: "Short lyric" });
const detailedDock = footer.render(80)[0];
assert("footer keeps activity on the right", detailedDock.includes("♪") && detailedDock.includes("ctx "));
const narrowDock = footer.render(60)[0];
assert("narrow dock keeps complete lyric and ctx", narrowDock.includes("♪ Short lyric") && narrowDock.includes("ctx "));
footer.dispose();

assert("prompt preview is one line", normalizePromptPreview(" test\n prompt\tvalue ") === "test prompt value");
assert("timestamp has fixed width", /^\d{2}:\d{2}:\d{2}$/.test(formatAgentTimestamp(Date.now())));
const banner = new AgentOutputBanner({ timestamp: Date.now(), prompt: "Explain the current rendering behavior" }, theme, true);
const bannerLine = banner.render(80)[0];
assert("agent output banner has definition", bannerLine.includes("AGENT OUTPUT") && bannerLine.includes("Explain the current"));
assert("agent output banner fills its background row", visibleWidth(bannerLine) === 80);

console.log(`footer/activity: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
