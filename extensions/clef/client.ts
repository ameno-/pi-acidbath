/**
 * clef — the decision service client.
 *
 * The one place the extension talks to the service. Everything else in the
 * extension goes through `decide()`.
 *
 * Fail-open is a contract term (contract/decision-service.md): if the call
 * fails, times out, or returns a malformed body, the client proceeds as if the
 * verdict were `allow`, and records that it did. The client's timeout is
 * *shorter* than the service's: 1500ms by default for interactive clients.
 *
 * No thresholds are hardcoded here. The service owns the policy.
 */

import { baseUrl, type ClefConfig } from "./config.ts";
import type { DecideOutcome, DecideRequest, Decision, PromptSet } from "./types.ts";

/** Verdict used when the service could not be reached. */
export const FAIL_OPEN_DECISION: Decision = {
	verdict: "allow",
	tier: "allow",
	probabilities: {},
	reason: "decision service unreachable: failing open",
	confidence: 0,
	latency_ms: 0,
	model: "",
	policy: "",
	thresholds: { block: 0.9, approve: 0.6 },
	degraded: true,
};

function isVerdict(value: unknown): boolean {
	return (
		value === "allow" ||
		value === "warn" ||
		value === "require_approval" ||
		value === "block" ||
		value === "undecided"
	);
}

/**
 * A decision body is well-formed when it carries a verdict, a reason and
 * probabilities. Anything else is malformed and is treated as a failure.
 */
export function isValidDecision(body: unknown): body is Decision {
	if (typeof body !== "object" || body === null) return false;
	const b = body as Record<string, unknown>;
	if (!isVerdict(b.verdict)) return false;
	if (typeof b.reason !== "string") return false;
	if (typeof b.probabilities !== "object" || b.probabilities === null) return false;
	return true;
}

/** The risk probability for a decision, read per the policy's direction. */
export function riskProbability(decision: Decision, direction: string): number {
	const probs = decision.probabilities ?? {};
	if (direction === "choice_is_bad") {
		// The named option is the risk; without a named option, the max wins.
		let max = 0;
		for (const value of Object.values(probs)) {
			if (typeof value === "number" && value > max) max = value;
		}
		return max;
	}
	if (direction === "score_is_bad") {
		// Higher score is worse.
		let max = 0;
		for (const value of Object.values(probs)) {
			if (typeof value === "number" && value > max) max = value;
		}
		return max;
	}
	// yes_is_bad (the default): the probability of "yes" is the risk.
	const yes = probs.yes;
	return typeof yes === "number" ? yes : 0;
}

export interface ClientOptions {
	/** Injected for tests; defaults to global fetch. */
	fetchImpl?: typeof fetch;
}

export class ClefClient {
	private readonly config: ClefConfig;
	private readonly fetchImpl: typeof fetch;

	constructor(config: ClefConfig, options: ClientOptions = {}) {
		this.config = config;
		this.fetchImpl = options.fetchImpl ?? fetch;
	}

	/** The effective thresholds of a policy, read from the service. */
	async prompts(): Promise<PromptSet | null> {
		try {
			const res = await this.fetchImpl(`${baseUrl(this.config)}/v1/policy/prompts`, {
				signal: AbortSignal.timeout(this.config.timeoutMs),
			});
			if (!res.ok) return null;
			const body = (await res.json()) as { policies?: PromptSet };
			return body?.policies ?? null;
		} catch {
			return null;
		}
	}

	/**
	 * Ask the service for a decision. Never throws: a failure comes back as
	 * `failed: true` with `decision: null`, and the caller decides what to do
	 * (the extension always fails open unless configured otherwise).
	 */
	async decide(request: DecideRequest): Promise<DecideOutcome> {
		const started = Date.now();
		try {
			const res = await this.fetchImpl(`${baseUrl(this.config)}/v1/policy/decide`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(request),
				signal: AbortSignal.timeout(this.config.timeoutMs),
			});
			if (!res.ok) {
				return {
					decision: null,
					failed: true,
					error: `decision service returned HTTP ${res.status}`,
					failOpenApplied: false,
					latencyMs: Date.now() - started,
				};
			}
			const body = await res.json();
			if (!isValidDecision(body)) {
				return {
					decision: null,
					failed: true,
					error: "decision service returned a malformed body",
					failOpenApplied: false,
					latencyMs: Date.now() - started,
				};
			}
			return {
				decision: body,
				failed: false,
				failOpenApplied: false,
				latencyMs: Date.now() - started,
			};
		} catch (err) {
			return {
				decision: null,
				failed: true,
				error: err instanceof Error ? err.message : String(err),
				failOpenApplied: false,
				latencyMs: Date.now() - started,
			};
		}
	}

	/**
	 * Decide, and apply the fail-open rule on failure: the caller gets an
	 * `allow` verdict plus the record that it failed open.
	 */
	async decideFailingOpen(request: DecideRequest): Promise<DecideOutcome> {
		const outcome = await this.decide(request);
		if (!outcome.failed) return outcome;
		if (!this.config.failOpen) return outcome;
		return {
			...outcome,
			decision: { ...FAIL_OPEN_DECISION, policy: request.policy },
			failOpenApplied: true,
		};
	}
}
