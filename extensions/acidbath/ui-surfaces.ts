/**
 * Three-surface health report: Sideshow (live board), Notion (design space),
 * Linear (execution ledger). Pure formatting lives here so it is testable
 * without a Pi runtime; the command handler in index.ts owns the exec calls.
 *
 * Read-only and on-demand: this module never runs in event hot paths.
 */

export type SurfaceStatus = "ok" | "warn" | "error";

export interface SurfaceCheck {
	name: string;
	status: SurfaceStatus;
	detail: string;
}

const STATUS_MARK: Record<SurfaceStatus, string> = { ok: "✓", warn: "!", error: "✗" };

/** Deterministic, width-bounded, color-free report (notify() renders text). */
export function formatSurfaceReport(checks: readonly SurfaceCheck[], maxWidth = 78): string {
	const lines = [truncatePlain("Three surfaces · Sideshow live · Notion durable · Linear ledger", maxWidth)];
	for (const check of checks) {
		const mark = STATUS_MARK[check.status];
		const name = check.name.padEnd(9);
		lines.push(truncatePlain(`${mark} ${name}${check.detail}`, maxWidth));
	}
	return lines.join("\n");
}

export function surfaceStatusFromCounts(passed: number, warned: number, failed: number): SurfaceStatus {
	if (failed > 0) return "error";
	if (warned > 0) return "warn";
	return passed > 0 ? "ok" : "warn";
}

function truncatePlain(value: string, width: number): string {
	if (value.length <= width) return value;
	if (width <= 1) return "…";
	return `${value.slice(0, width - 1)}…`;
}
