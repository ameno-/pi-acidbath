/** Pure context-pressure pyramid model and renderer. */

export type PyramidPressure = "healthy" | "warning" | "high" | "critical";
export type PyramidToken = "filled" | "empty" | "label";

export interface PyramidRow {
	indent: number;
	cells: boolean[];
}

export interface ContextPyramid {
	percent: number;
	pressure: PyramidPressure;
	filledCells: number;
	totalCells: number;
	rows: PyramidRow[];
}

export interface PyramidRenderOptions {
	filledOrb?: string;
	emptyOrb?: string;
	/** Keep the numeric pressure label opt-in for compact production surfaces. */
	showLabel?: boolean;
	colorize?: (
		text: string,
		token: PyramidToken,
		pressure: PyramidPressure,
		rowIndex: number,
		cellIndex: number,
		fillIndex: number,
	) => string;
}

export function clampContextPercent(percent: number): number {
	if (!Number.isFinite(percent)) return 0;
	return Math.max(0, Math.min(1, percent));
}

export function pressureForContext(percent: number): PyramidPressure {
	const value = clampContextPercent(percent);
	if (value >= 0.95) return "critical";
	if (value >= 0.8) return "high";
	if (value >= 0.6) return "warning";
	return "healthy";
}

function rowWidths(rowCount: number): number[] {
	const count = Math.max(1, Math.trunc(rowCount));
	return Array.from({ length: count }, (_, index) => index * 2 + 1);
}

export function buildContextPyramid(percent: number, rowCount = 3): ContextPyramid {
	const widths = rowWidths(rowCount);
	const totalCells = widths.reduce((sum, width) => sum + width, 0);
	const filledCells = Math.round(clampContextPercent(percent) * totalCells);
	let remaining = filledCells;
	const rows: PyramidRow[] = widths.map((width, index) => ({
		indent: (widths.length - index - 1) * 2,
		cells: Array.from({ length: width }, () => false),
	}));

	// Fill from the base upward, left-to-right within each row.
	for (let rowIndex = rows.length - 1; rowIndex >= 0 && remaining > 0; rowIndex -= 1) {
		const row = rows[rowIndex]!;
		for (let cellIndex = 0; cellIndex < row.cells.length && remaining > 0; cellIndex += 1) {
			row.cells[cellIndex] = true;
			remaining -= 1;
		}
	}

	return {
		percent: clampContextPercent(percent),
		pressure: pressureForContext(percent),
		filledCells,
		totalCells,
		rows,
	};
}

export function formatContextPercent(percent: number): string {
	return `${Math.round(clampContextPercent(percent) * 100)}%`;
}

export function renderContextPyramid(
	model: ContextPyramid,
	options: PyramidRenderOptions = {},
): string[] {
	const filledOrb = options.filledOrb ?? "●";
	const emptyOrb = options.emptyOrb ?? "·";
	const colorize = options.colorize ?? ((text: string) => text);
	const lines = model.rows.map((row, rowIndex) => {
		const cellsBelow = model.rows
			.slice(rowIndex + 1)
			.reduce((sum, lowerRow) => sum + lowerRow.cells.length, 0);
		const cells = row.cells
			.map((filled, cellIndex) => {
				const token: PyramidToken = filled ? "filled" : "empty";
				const currentFillIndex = filled ? cellsBelow + cellIndex : -1;
				return colorize(
					filled ? filledOrb : emptyOrb,
					token,
					model.pressure,
					rowIndex,
					cellIndex,
					currentFillIndex,
				);
			})
			.join(" ");
		return `${" ".repeat(row.indent)}${cells}`;
	});

	const lastIndex = lines.length - 1;
	if (lastIndex >= 0 && options.showLabel !== false) {
		lines[lastIndex] = `${lines[lastIndex]}  ${colorize(formatContextPercent(model.percent), "label", model.pressure, lastIndex, -1, -1)}`;
	}
	return lines;
}
