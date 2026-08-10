import { formatToolRow } from "../../../extensions/acidbath/ui-tool-rows.ts";

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

process.stdout.write("\x1b[2J\x1b[H\x1b[?25l");
process.stdout.write("ACIDBATH TOOL ROWS\n\n");
for (const row of rows) process.stdout.write(`${row}\n`);
process.stdout.write("\nSTATIC NATIVE TRANSCRIPT ROWS\n");
process.stdout.write(`${"─".repeat(72)}\n`);
for (const row of rows) process.stdout.write(`${row}\n`);
process.stdout.write(`${"─".repeat(72)}\n`);

setInterval(() => {}, 1_000);
