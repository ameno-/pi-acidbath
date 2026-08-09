/** Deterministic session-intent summaries for the Acidbath header. */

export const MAX_SUMMARY_WORDS = 10;
export const DEFAULT_SESSION_SUMMARY = "Ready for a new task";

const LOW_SIGNAL_PATTERNS = [
	/^(?:ok(?:ay)?|yes|no|thanks|thank you|agreed|sounds good|looks good|go ahead|do it|build it|ship it|continue)\b/i,
	/^(?:how would you summarize|what is the summary|give me a summary)\b/i,
	/\b(?:how would you summarize|current task|\d+[- ]word summary|nice label)\b/i,
	/\b(?:we got confused|we're aligned|we are aligned)\b/i,
];

function cleanPrompt(prompt: string): string {
	return prompt
		.replace(/https?:\/\/[^\s)]+/gi, (url) => {
			const match = url.match(/github\.com\/[^/]+\/([^/#?]+)/i);
			return match?.[1] ?? "linked project";
		})
		.replace(/\bto the top of\b/gi, "atop")
		.replace(/\bat the top of\b/gi, "atop")
		.replace(/\bon top of\b/gi, "atop")
		.replace(/[`*_#>]+/g, " ")
		.replace(/[\r\n\t]+/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

function stripLeadIn(text: string): string {
	return text
		.replace(/^(?:can you|could you|would you|please|help me|i want to|i'd like to|let's|lets)\s+/i, "")
		.replace(/\b(?:please|thanks|thank you|buddy)\b/gi, " ")
		.replace(/\s+/g, " ")
		.trim();
}

function sentenceCase(text: string): string {
	if (!text) return text;
	return `${text.slice(0, 1).toUpperCase()}${text.slice(1)}`;
}

function isLowSignal(text: string): boolean {
	return text.length < 12 || LOW_SIGNAL_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * Produce a compact, non-LLM summary from the user's task prompt.
 * Low-signal follow-ups intentionally preserve the previous task summary.
 */
export function summarizeTask(prompt: string, previous = DEFAULT_SESSION_SUMMARY): string {
	const cleaned = stripLeadIn(cleanPrompt(prompt));
	if (!cleaned || isLowSignal(cleaned)) return previous;

	const words = cleaned
		.split(/\s+/)
		.map((word) => word.replace(/^[.,:;!?]+|[.,:;!?]+$/g, ""))
		.filter(Boolean)
		.slice(0, MAX_SUMMARY_WORDS);
	if (words.length === 0) return previous;

	const summary = sentenceCase(words.join(" "));
	return /[.!?]$/.test(summary) ? summary.slice(0, -1) : summary;
}

export function countSummaryWords(summary: string): number {
	return summary.trim() ? summary.trim().split(/\s+/).length : 0;
}

export function formatSessionHeader(summary: string, contextPercent?: number): string {
	const context = contextPercent === undefined || contextPercent === null
		? ""
		: ` · ctx ${Math.round(Math.max(0, Math.min(1, contextPercent)) * 100)}%`;
	return `acidbath · ${summary}${context}`;
}
