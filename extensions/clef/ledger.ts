/**
 * clef — the session ledger.
 *
 * A per-session record of every decision the extension made: which hook, which
 * policy, what verdict, what probability, what was done about it. `/clef`
 * shows it. It is pure and holds no Pi types, so it is unit-testable.
 */

import type { HookName, Verdict } from "./types.ts";

/** A ledger verdict: a decision verdict, or a compaction tier for turn_end. */
export type LedgerVerdict = Verdict | "silent" | "notice" | "recommend" | "request";

export interface LedgerEntry {
	ts: number;
	hook: HookName;
	policy: string;
	verdict: LedgerVerdict;
	probability: number | null;
	action: string;
	reason: string;
	/** The thresholds in force at the time of the decision. */
	thresholds?: { block: number; approve: number };
}

export interface Ledger {
	record(entry: LedgerEntry): void;
	entries(): LedgerEntry[];
	/** The most recent thresholds seen for a policy, if any. */
	thresholdsFor(policy: string): { block: number; approve: number } | null;
	/** Every policy the ledger has seen, with its last thresholds. */
	effectiveThresholds(): Record<string, { block: number; approve: number }>;
	size(): number;
}

const MAX_ENTRIES = 200;

export function createLedger(): Ledger {
	const entries: LedgerEntry[] = [];
	const thresholds = new Map<string, { block: number; approve: number }>();

	return {
		record(entry) {
			entries.push(entry);
			while (entries.length > MAX_ENTRIES) entries.shift();
			if (entry.policy && entry.thresholds) {
				thresholds.set(entry.policy, entry.thresholds);
			}
		},
		entries() {
			return [...entries];
		},
		thresholdsFor(policy) {
			return thresholds.get(policy) ?? null;
		},
		effectiveThresholds() {
			const out: Record<string, { block: number; approve: number }> = {};
			for (const [policy, value] of thresholds) out[policy] = { ...value };
			return out;
		},
		size() {
			return entries.length;
		},
	};
}

/** Render the ledger as plain lines for `/clef`. */
export function renderLedger(ledger: Ledger): string {
	const entries = ledger.entries();
	if (entries.length === 0) return "(no decisions yet)";
	return entries
		.map((e) => {
			const p = e.probability === null ? "-" : e.probability.toFixed(3);
			const when = new Date(e.ts).toISOString().replace("T", " ").replace("Z", "");
			return `${when}  ${e.hook.padEnd(12)} ${e.policy.padEnd(16)} ${e.verdict.padEnd(16)} p=${p.padEnd(6)} ${e.action}`;
		})
		.join("\n");
}
