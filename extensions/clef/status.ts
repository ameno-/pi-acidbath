/**
 * clef — the /clef status view.
 *
 * Pure rendering: it takes the configuration, the thresholds the service is
 * advertising and the session ledger, and returns the lines `/clef` shows.
 * Nothing here touches the network or Pi, so the values can be asserted
 * exactly in a test.
 *
 * The thresholds shown are *values*, not labels. `/clef` answers the question
 * "which thresholds are in force, right now?" — so each policy is rendered
 * with the numbers the service is actually using. A heading with no numbers
 * answers nothing.
 */

import type { ClefConfig } from "./config.ts";
import { renderLedger, type Ledger } from "./ledger.ts";
import type { PromptSet } from "./types.ts";

export interface ThresholdPair {
	block: number;
	approve: number;
}

export type ThresholdSet = Record<string, ThresholdPair>;

/** A threshold pair is only usable when both numbers are real numbers. */
function isThresholdPair(value: unknown): value is ThresholdPair {
	if (typeof value !== "object" || value === null) return false;
	const t = value as Record<string, unknown>;
	return typeof t.block === "number" && Number.isFinite(t.block) && typeof t.approve === "number" && Number.isFinite(t.approve);
}

/**
 * The thresholds the service is advertising, per policy.
 *
 * A policy with no usable thresholds in the prompt set is dropped rather
 * than shown with a placeholder: a placeholder is a number that lies.
 */
export function thresholdsFromPrompts(policies: PromptSet | null): ThresholdSet {
	const out: ThresholdSet = {};
	if (!policies) return out;
	for (const [policy, descriptor] of Object.entries(policies)) {
		if (!descriptor || !isThresholdPair(descriptor.thresholds)) continue;
		out[policy] = { block: descriptor.thresholds.block, approve: descriptor.thresholds.approve };
	}
	return out;
}

/** One line per policy: the policy id and the two numbers. */
export function renderThresholds(
	service: ThresholdSet,
	observed: ThresholdSet,
): string[] {
	const policies = [...new Set([...Object.keys(service), ...Object.keys(observed)])].sort();
	if (policies.length === 0) {
		return ["  (the decision service advertised no thresholds)"];
	}
	const lines: string[] = [];
	for (const policy of policies) {
		const effective = observed[policy] ?? service[policy];
		if (!effective) continue;
		let line = `  ${policy}: block=${effective.block} approve=${effective.approve}`;
		const base = service[policy];
		if (base && (base.block !== effective.block || base.approve !== effective.approve)) {
			line += ` (service default: block=${base.block} approve=${base.approve})`;
		}
		lines.push(line);
	}
	return lines;
}

/**
 * The whole `/clef` output: the endpoint, the thresholds in force and the
 * session ledger.
 */
export function renderStatus(options: {
	config: ClefConfig;
	service: ThresholdSet;
	observed: ThresholdSet;
	ledger: Ledger;
	/** true when the decision service could not be reached for the prompts. */
	serviceReachable: boolean;
}): string[] {
	const { config, service, observed, ledger, serviceReachable } = options;
	const lines: string[] = [
		`clef: ${config.enabled ? "enabled" : "disabled"}`,
		`endpoint: ${config.endpoint}`,
		`model: ${config.model}`,
		`timeout: ${config.timeoutMs}ms`,
		`fail-open: ${config.failOpen ? "on" : "off"}`,
		`hooks: tool_call=${config.hooks.toolCall} tool_result=${config.hooks.toolResult} turn_end=${config.hooks.turnEnd}`,
		`max state: ${config.maxStateBytes} bytes`,
		"",
		"effective thresholds:",
	];
	if (!serviceReachable) {
		if (Object.keys(observed).length === 0) {
			lines.push("  (none observed yet — the decision service could not be reached and no decision has been made this session)");
		} else {
			lines.push("  (the decision service could not be reached — these are the ones this session saw)");
			lines.push(...renderThresholds({}, observed));
		}
	} else {
		lines.push(...renderThresholds(service, observed));
	}
	lines.push("");
	lines.push("session ledger:");
	lines.push(renderLedger(ledger));
	return lines;
}
