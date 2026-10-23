/**
 * clef — shared types.
 *
 * The extension is a *client* of the decision service. These types mirror
 * contract/decision-service.md; they hold no thresholds and no question sets.
 */

export type Verdict = "allow" | "warn" | "require_approval" | "block" | "undecided";

export interface Decision {
	verdict: Verdict;
	tier: Verdict;
	probabilities: Record<string, number>;
	reason: string;
	confidence: number;
	latency_ms: number;
	model: string;
	policy: string;
	thresholds: { block: number; approve: number };
	degraded: boolean;
}

export interface PolicyDescriptor {
	questions: Record<string, unknown>;
	thresholds: { block: number; approve: number };
	direction: string;
}

export type PromptSet = Record<string, PolicyDescriptor>;

export interface DecideRequest {
	policy: string;
	state: unknown;
	context?: Record<string, unknown>;
	thresholds?: { block?: number; approve?: number };
}

export interface DecideOutcome {
	/** null when the call failed, timed out or returned a malformed body. */
	decision: Decision | null;
	failed: boolean;
	error?: string;
	/** true when a failure was turned into "proceed as allow". */
	failOpenApplied: boolean;
	latencyMs: number;
}

export type HookName = "tool_call" | "tool_result" | "turn_end" | "ask_clef" | "should_i_compact";

export interface LedgerEntry {
	ts: number;
	hook: HookName;
	policy: string;
	verdict: Verdict;
	probability: number | null;
	action: string;
	reason: string;
}
