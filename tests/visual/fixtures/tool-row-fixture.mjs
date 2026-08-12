import { formatToolRow } from "../../../extensions/acidbath/ui-tool-rows.ts";
import { STATUS_SWAG, STATUS_TOLDYOU, STATUS_LUMPY, TOOL_READ, TOOL_BASH, TOOL_EDIT } from "../../../extensions/acidbath/rendering/kaomoji.ts";

const width = 72;
const rows = [
	formatToolRow({
		width,
		statusGlyph: STATUS_SWAG,
		toolGlyph: TOOL_READ,
		toolName: "read",
		target: "docs/plan.md",
		status: "success",
		metadata: ["214 lines"],
		expandable: true,
	}),
	formatToolRow({
		width,
		statusGlyph: STATUS_LUMPY,
		toolGlyph: TOOL_BASH,
		toolName: "bash",
		target: "pnpm test --filter acidbath",
		status: "pending",
		metadata: ["running"],
		expandable: true,
	}),
	formatToolRow({
		width,
		statusGlyph: STATUS_TOLDYOU,
		toolGlyph: TOOL_EDIT,
		toolName: "edit",
		target: "extensions/acidbath/ui-tool-renderers.ts",
		status: "error",
		metadata: ["old text not found"],
		expandable: true,
	}),
];

process.stdout.write("\x1b[2J\x1b[H\x1b[?25l");
process.stdout.write("ACIDBATH TOOL ROWS\n\n");
for (const row of rows) process.stdout.write(`${row}\n`);
process.stdout.write("\nSTATIC NATIVE TRANSCRIPT ROWS\n");
process.stdout.write(`${"─".repeat(72)}\n`);
for (const row of rows) process.stdout.write(`${row}\n`);
process.stdout.write(`${"─".repeat(72)}\n`);

setInterval(() => {}, 1_000);
