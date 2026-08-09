import { formatToolRow } from "../../../extensions/acidbath/ui-tool-rows.ts";
import { toolMotionGlyphForTool } from "../../../extensions/acidbath/ui-motion.ts";

const width = 72;
const rows = [
	formatToolRow({
		width,
		toolName: "read",
		target: "docs/plan.md",
		status: "success",
		metadata: ["214 lines"],
		expandable: true,
	}),
	formatToolRow({
		width,
		toolName: "bash",
		target: "pnpm test --filter acidbath",
		status: "pending",
		phase: 3,
		reducedMotion: true,
		metadata: ["running"],
		expandable: true,
	}),
	formatToolRow({
		width,
		toolName: "edit",
		target: "extensions/acidbath/ui-tool-renderers.ts",
		status: "error",
		metadata: ["old text not found"],
		expandable: true,
	}),
];

const lifecycleColor = {
	pending: "\x1b[38;2;52;231;209m",
	success: "\x1b[38;2;215;255;79m",
	error: "\x1b[38;2;255;79;179m",
};
const resetColor = "\x1b[39m";
const dimColor = "\x1b[38;5;240m";
const activityRow = (toolName, status, phase, target) => {
	const glyph = toolMotionGlyphForTool(toolName, status, phase, false);
	const rail = `${glyph}${" ".repeat(Math.max(0, 4 - [...glyph].length))}`;
	return `${lifecycleColor[status]}${rail}${toolName}${resetColor} ${dimColor}${target}${resetColor}`;
};
const activityRows = [
	activityRow("read", "pending", 1, "docs/plan.md"),
	activityRow("bash", "pending", 1, "pnpm test"),
	activityRow("ls", "pending", 1, "src"),
	activityRow("edit", "success", 0, "ui-tool-renderers.ts"),
	activityRow("write", "error", 0, "output.txt"),
];

// Keep the fixture a stable terminal surface: fixed lifecycle colors, no
// timestamps or provider/model output. The visual harness owns the PTY dimensions.
process.stdout.write("\x1b[2J\x1b[H\x1b[?25l");
process.stdout.write("ACIDBATH TOOL ROWS\n\n");
for (const row of rows) process.stdout.write(`${row}\n`);
process.stdout.write("\nACIDBATH BORDERLESS ACTIVITY\n\n");
for (const row of activityRows) process.stdout.write(`${row}\n`);

// Keep the PTY alive until the harness captures both text and PNG output.
setInterval(() => {}, 1_000);
