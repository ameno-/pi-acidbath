import assert from "node:assert/strict";
import { buildGradientPalette, fitLineToWidth, HEADER_TAGLINE, parseForegroundRgbFromAnsi, renderHeaderLines, WORDMARK_LINES, WORDMARK_TEXT } from "../extensions/acidbath/ui-header.ts";
import { visibleWidth, stripAnsi } from "../extensions/acidbath/ui-gauge.ts";

const theme = {
	getFgAnsi: () => "\x1b[38;2;64;180;220m",
	fg: (_color, text) => `\x1b[38;5;117m${text}\x1b[39m`,
	bold: (text) => `\x1b[1m${text}\x1b[22m`,
};

const plain = renderHeaderLines(80, theme, true);
assert.equal(WORDMARK_TEXT, "ACIDBATH");
assert.equal(WORDMARK_LINES.length, 5);
assert.ok(stripAnsi(plain[1]).trim().length > 20);
assert.match(plain.join("\n"), new RegExp(HEADER_TAGLINE));

for (const width of [1, 8, 17, 40, 80]) {
	for (const line of renderHeaderLines(width, theme, false)) {
		assert.ok(visibleWidth(line) <= width, `line exceeds width ${width}: ${stripAnsi(line)}`);
	}
}

const colored = renderHeaderLines(80, theme, false).join("\n");
assert.match(colored, /\x1b\[38;2;/);
assert.match(colored, /honest tools/);
assert.doesNotMatch(renderHeaderLines(80, theme, true).join("\n"), /\x1b\[/);

assert.deepEqual(parseForegroundRgbFromAnsi("\x1b[38;2;1;2;3m"), { r: 1, g: 2, b: 3 });
assert.deepEqual(parseForegroundRgbFromAnsi("\x1b[38;5;196m"), { r: 255, g: 0, b: 0 });
assert.ok(buildGradientPalette({ r: 64, g: 180, b: 220 }).some((color) => color.r !== 64));
assert.equal(visibleWidth(fitLineToWidth("hello", 11)), 8);

console.log("startup header: gradient, clipping, and no-color rendering pass");
