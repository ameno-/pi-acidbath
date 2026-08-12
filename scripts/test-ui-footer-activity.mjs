import { visibleWidth } from "@earendil-works/pi-tui";
import { AgentOutputBanner, formatAgentTimestamp, normalizePromptPreview } from "../extensions/acidbath/ui-agent-output.ts";
import { AcidbathFooter } from "../extensions/acidbath/ui-footer.ts";

let passed = 0;
let failed = 0;
function assert(name, condition, detail = "") {
	if (condition) passed += 1;
	else { failed += 1; console.error(`FAIL ${name}${detail ? ` (${detail})` : ""}`); }
}

let renderRequests = 0;
const tui = { requestRender() { renderRequests += 1; } };
const theme = {
	fg(_color, text) { return text; },
	bg(_color, text) { return text; },
	bold(text) { return text; },
};

const footer = new AcidbathFooter(tui, theme, "/tmp/project", true);
footer.update({ modelName: "model", branchName: "feature/footer", contextVisible: true, contextPercent: 0.5 });
const requestsAfterUpdate = renderRequests;
footer.update({ modelName: "model", branchName: "feature/footer", contextVisible: true, contextPercent: 0.5 });
assert("same footer state does not request another render", renderRequests === requestsAfterUpdate);
const cachedWide = footer.render(120);
assert("same footer state reuses cached lines", footer.render(120) === cachedWide);
const wide = cachedWide[0];
const narrow = footer.render(60)[0];
assert("footer remains width-safe", visibleWidth(wide) <= 120 && visibleWidth(narrow) <= 60);
assert("footer shows the current branch", wide.includes("feature/footer"));
assert("footer reserves context and token fields", wide.includes("ctx ") && wide.includes("0 in /") && wide.includes("0 out"));
assert("footer has no legacy lyric rail", !wide.includes("♪"));
assert("footer remains useful when narrow", narrow.includes("ctx ") || narrow.includes("acidbath"));
footer.dispose();

assert("prompt preview is one line", normalizePromptPreview(" test\n prompt\tvalue ") === "test prompt value");
assert("timestamp has fixed width", /^\d{2}:\d{2}:\d{2}$/.test(formatAgentTimestamp(Date.now())));
const banner = new AgentOutputBanner({ timestamp: Date.now(), prompt: "Explain the current rendering behavior" }, theme, true);
const cachedBanner = banner.render(80);
assert("static banner reuses cached lines", banner.render(80) === cachedBanner);
const bannerLine = cachedBanner[0];
assert("agent output banner has definition", bannerLine.includes("AGENT OUTPUT") && bannerLine.includes("Explain the current"));
assert("agent output banner fills its background row", visibleWidth(bannerLine) === 80);

console.log(`footer/activity: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
