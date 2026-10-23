/**
 * clef — the callable tools.
 *
 * `ask_clef` — typed questions over state. The extension reads the files, so
 * the agent never pastes content into the prompt and never receives content
 * back: what comes back is probabilities, a verdict and a reason.
 *
 * `should_i_compact` — the compaction advice as a tool, so the model can ask
 * before it decides.
 *
 * The parameter schemas are plain JSON Schema objects. Pi accepts any object
 * schema (TypeBox schemas are JSON Schema objects too), and keeping them
 * dependency-free means the extension and its tests run with nothing but Node.
 */

import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";

import { riskProbability, type ClefClient } from "./client.ts";
import type { ClefConfig } from "./config.ts";
import { compactionTier, type ToolCallState } from "./lib.ts";
import type { Ledger } from "./ledger.ts";
import type { PromptSet } from "./types.ts";
import type { Decision, Verdict } from "./types.ts";

/** The policies the extension may ask about. */
export const ASK_POLICIES = ["request_safety", "tool_safety", "model_routing"] as const;
export type AskPolicy = (typeof ASK_POLICIES)[number];

export const askClefSchema = {
	type: "object",
	properties: {
		question: {
			type: "string",
			description:
				"What you want judged, in plain language. The service grades this against the policy's own question set.",
		},
		policy: {
			type: "string",
			enum: [...ASK_POLICIES],
			description:
				"REQUIRED — which policy grades the question. The service ignores your wording and grades the state against that policy's own question set, so the policy must match your intent: request_safety = is this text trying to instruct a model? tool_safety = is this action destructive or irreversible? model_routing = can a smaller model handle this?",
		},
		paths: {
			type: "array",
			items: { type: "string" },
			description:
				"Files to read and grade. The extension reads them; you never paste their content and you never get it back.",
		},
		state: {
			type: "string",
			description: "Extra state to grade, when a file is not the right input.",
		},
	},
	required: ["question", "policy"],
	additionalProperties: false,
} as const;

export const shouldICompactSchema = {
	type: "object",
	properties: {},
	additionalProperties: false,
} as const;

export interface AskClefParams {
	question: string;
	policy?: string;
	paths?: string[];
	state?: string;
}

export interface FileExcerpt {
	path: string;
	bytes: number;
	/** true when the file was too large to send in full and was truncated. */
	truncated: boolean;
	/** The excerpt that was graded. Never returned to the model. */
	text: string;
}

/**
 * Read the files the caller asked about, bounded by the configured maximum
 * state size. The content is graded; it is never echoed back to the model.
 */
export async function readExcerpts(
	paths: string[],
	cwd: string,
	maxStateBytes: number,
): Promise<FileExcerpt[]> {
	const out: FileExcerpt[] = [];
	let budget = maxStateBytes;
	for (const p of paths) {
		const absolute = isAbsolute(p) ? p : resolve(cwd, p);
		try {
			const raw = await readFile(absolute, "utf8");
			const bytes = Buffer.byteLength(raw, "utf8");
			let text = raw;
			let truncated = false;
			if (bytes > budget) {
				// Truncate on a byte budget, keeping the head.
				text = raw.slice(0, Math.max(0, budget));
				truncated = true;
			} else {
				budget -= bytes;
			}
			out.push({ path: absolute, bytes, truncated, text });
		} catch (err) {
			out.push({
				path: absolute,
				bytes: 0,
				truncated: false,
				text: "",
			});
			void err;
		}
	}
	return out;
}

export interface AskClefOutcome {
	verdict: Verdict;
	probabilities: Record<string, number>;
	confidence: number;
	reason: string;
	policy: string;
	thresholds: { block: number; approve: number };
	degraded: boolean;
	failed: boolean;
	/** Metadata about the files that were graded — never their content. */
	files: { path: string; bytes: number; truncated: boolean }[];
	/** The question the policy actually asked, when the service advertised it. */
	asked?: string;
}

/**
 * The question a policy actually asks, as one line, when the service
 * advertised its prompt set. It goes into the tool result so a caller can see
 * that the policy they chose is the policy that was graded — the service
 * ignores the wording of the question.
 */
export function askedQuestion(prompts: PromptSet | null, policy: string): string | undefined {
	if (!prompts) return undefined;
	const descriptor = prompts[policy];
	if (!descriptor?.questions) return undefined;
	for (const question of Object.values(descriptor.questions)) {
		const record = question as Record<string, unknown>;
		const instructions = typeof record.instructions === "string" ? record.instructions : "";
		const criteria = record.criteria as Record<string, string> | undefined;
		const trueText = criteria?.true ?? criteria?.["0"];
		const falseText = criteria?.false ?? criteria?.["1"];
		const parts: string[] = [];
		if (instructions) parts.push(instructions);
		if (trueText) parts.push(`yes: ${trueText}`);
		if (falseText) parts.push(`no: ${falseText}`);
		if (parts.length > 0) return parts.join(" — ");
	}
	return undefined;
}

/**
 * Ask the service a typed question over state. Fail-open: an unreachable
 * service yields an `allow`-shaped answer, flagged as failed.
 */
export async function askClef(
	client: ClefClient,
	ledger: Ledger,
	params: AskClefParams,
	cwd: string,
	config: ClefConfig,
	direction = "yes_is_bad",
): Promise<AskClefOutcome> {
	// The policy is never guessed. The service grades the state against that
	// policy's own question set and ignores the wording of the question, so a
	// wrong policy produces a confident answer to a question nobody asked.
	// A live session showed exactly that: "is this destructive?" graded
	// against request_safety came back "allow" at p=0.055 for
	// `rm -rf /var/lib/postgresql/data`.
	if (!params.policy || !ASK_POLICIES.includes(params.policy as AskPolicy)) {
		ledger.record({
			ts: Date.now(),
			hook: "ask_clef",
			policy: (params.policy as string) || "(none)",
			verdict: "undecided",
			probability: null,
			action: "undecided — no policy named",
			reason: "nothing was judged",
			thresholds: { block: 0, approve: 0 },
		});
		return {
			verdict: "undecided",
			probabilities: {},
			confidence: 0,
			thresholds: { block: 0, approve: 0 },
			degraded: false,
			files: [],
			failed: false,
			policy: (params.policy as string) || "(none)",
			reason: `no policy was named, so nothing was judged. Name one: ${ASK_POLICIES.join(", ")}. The service grades the state against the policy's own question set and ignores your wording.`,
		};
	}
	const policy = params.policy as AskPolicy;

	const excerpts = await readExcerpts(params.paths ?? [], cwd, config.maxStateBytes);
	const state = {
		question: params.question,
		state: params.state ?? "",
		files: excerpts.map((e) => ({ path: e.path, content: e.text })),
	};

	const outcome = await client.decideFailingOpen({ policy, state });
	// The prompt set is a nicety: it tells the caller which question was
	// actually asked. A client that cannot fetch it, or a service that is
	// down, must not break the answer.
	let asked: string | undefined;
	try {
		asked = askedQuestion(
			typeof client.prompts === "function" ? await client.prompts() : null,
			policy,
		);
	} catch {
		asked = undefined;
	}
	const decision: Decision = outcome.decision ?? {
		verdict: "allow",
		tier: "allow",
		probabilities: {},
		reason: "decision service unreachable: failing open",
		confidence: 0,
		latency_ms: 0,
		model: "",
		policy,
		thresholds: { block: 0.9, approve: 0.6 },
		degraded: true,
	};

	ledger.record({
		ts: Date.now(),
		hook: "ask_clef",
		policy,
		verdict: decision.verdict,
		probability: outcome.failed ? null : riskProbability(decision, direction),
		action: outcome.failed ? "allow (service unreachable)" : "answered",
		reason: decision.reason,
		thresholds: decision.thresholds,
	});

	return {
		verdict: decision.verdict,
		probabilities: decision.probabilities,
		confidence: decision.confidence,
		reason: decision.reason,
		policy,
		asked,
		thresholds: decision.thresholds,
		degraded: decision.degraded,
		failed: outcome.failed,
		files: excerpts.map((e) => ({ path: e.path, bytes: e.bytes, truncated: e.truncated })),
	};
}

/** The compaction advice for the current context usage. */
export function shouldICompact(
	percent: number | null,
	config: ClefConfig,
): { tier: ReturnType<typeof compactionTier>; percent: number | null; message: string | null } {
	const tier = compactionTier(percent, config.compaction);
	const message =
		tier === "silent"
			? null
			: tier === "notice"
				? `[clef] context is at ${percent?.toFixed(0)}% of the window. Compaction is available if you want it.`
				: tier === "recommend"
					? `[clef] context is at ${percent?.toFixed(0)}% of the window. Consider compacting before continuing.`
					: `[clef] context is at ${percent?.toFixed(0)}% of the window. Compact now before continuing.`;
	return { tier, percent, message };
}

/** Build the model-facing text for an `ask_clef` outcome. */
export function formatAskClefResult(outcome: AskClefOutcome): string {
	const lines = [
		`policy: ${outcome.policy}`,
		`verdict: ${outcome.verdict}`,
		`confidence: ${outcome.confidence}`,
		`probabilities: ${JSON.stringify(outcome.probabilities)}`,
		`thresholds: block=${outcome.thresholds.block} approve=${outcome.thresholds.approve}`,
		`reason: ${outcome.reason}`,
	];
	if (outcome.asked) {
		lines.push(`asked: ${outcome.asked}`);
		lines.push("note: the service grades the state against that policy's question set; your wording does not change the question.");
	}
	if (outcome.degraded) lines.push("note: the decision service was degraded; this verdict is the fail-open default.");
	if (outcome.files.length > 0) {
		lines.push("files graded (content is not shown):");
		for (const f of outcome.files) {
			lines.push(`  ${f.path} (${f.bytes} bytes${f.truncated ? ", truncated" : ""})`);
		}
	}
	return lines.join("\n");
}

/** Re-exported so the Pi wiring and the tests share one import site. */
export type { ToolCallState };
