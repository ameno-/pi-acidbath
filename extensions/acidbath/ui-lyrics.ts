/**
 * Short themed lyrics for the activity status glow.
 *
 * Each lifecycle kind has a small playlist. The lyric replaces the old
 * generic label ("composing") so the glow and the message never duplicate.
 * The muted detail line is reserved for specific information (file paths,
 * command names, result stats) and suppressed when it would just echo
 * the lyric's state.
 */

export type LyricKind =
	| "preparing"
	| "listening"
	| "reasoning"
	| "composing"
	| "editing"
	| "tool"
	| "error"
	| "done"
	| "working";

const LYRICS: Record<LyricKind, readonly string[]> = {
	preparing: ["gathering context…", "setting up…", "loading…", "preparing…"],
	listening: ["listening to the model…", "awaiting response…", "thinking…", "processing…"],
	reasoning: ["weighing options…", "working through it…", "analyzing…", "considering…"],
	composing: ["finding the right words…", "crafting response…", "composing answer…", "writing…"],
	editing:   ["shaping the code…", "applying changes…", "editing files…", "making it right…"],
	tool:      ["running commands…", "working on it…", "one moment…", "executing…"],
	error:     ["something went wrong…", "that didn't work…", "unexpected issue…"],
	done:      ["finished…", "complete…", "all set…", "done…"],
	working:   ["working on it…", "processing…", "one moment…", "running…"],
};

/** Maps lifecycle kind strings (including aliases) to LyricKind. */
const KIND_MAP: Record<string, LyricKind> = {
	preparing: "preparing",
	listening: "listening",
	reasoning: "reasoning",
	composing: "composing",
	editing: "editing",
	shaping: "editing",
	searching: "listening",
	tool: "tool",
	compacting: "working",
	error: "error",
	done: "done",
	settled: "done",
	working: "working",
};

/** Resolve a lifecycle kind string to its lyric set. Falls back to "working". */
export function lyricKind(raw: string): LyricKind {
	return KIND_MAP[raw] ?? "working";
}

/** Fixed lyric display width (in visible cells). Keeps layout stable across cycles. */
export const LYRIC_MAX_VISIBLE_WIDTH = 30;

/** Select a lyric for the given kind and glow phase index. */
export function lyricFor(kind: LyricKind, phase: number): string {
	const set = LYRICS[kind] ?? LYRICS.working;
	return set[Math.abs(phase) % set.length];
}

/** Messages that only echo the state and add no information beyond the lyric. */
const GENERIC_MESSAGES = new Set([
	"",
	"settled",
	"done",
	"turn complete",
	"context compacted",
	"preparing",
	"listening",
	"composing",
	"working",
	"starting",
	"running tool",
	"tool complete",
	"tool error",
	"response error",
	"turn end",
]);

/** True when the message adds nothing beyond what the lyric already conveys. */
export function isGenericMessage(message: string): boolean {
	const trimmed = message.trim().toLowerCase();
	if (trimmed.length === 0) return true;
	const words = trimmed.split(/\s+/);
	if (words.length > 2) return false;
	return GENERIC_MESSAGES.has(trimmed);
}
