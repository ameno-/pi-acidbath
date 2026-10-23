/**
 * Text reveal — hold the response, then lay it in smoothly.
 *
 * Streaming token by token makes a long answer read as jitter: the paragraph
 * is rewritten many times a second, so the eye never settles on it and the
 * block never looks like a block. The information is all there; it just never
 * gets a chance to look finished.
 *
 * So the response is held, then revealed on a clock of our own:
 *
 *   - A hold window where nothing is shown at all, so a fast reply does not
 *     strobe.
 *   - A reveal measured in lines, so what appears is a growing block of whole
 *     lines rather than a torn line that changes character by character.
 *   - The full text immediately once the turn is no longer streaming, so
 *     nothing is ever withheld from a reader who wants it.
 *
 * The reveal is driven by elapsed time, not by token arrival, and it is pure:
 * given the same text and elapsed time it always returns the same slice. That
 * is what lets the harness assert its guarantees instead of trusting them.
 */

export interface RevealOptions {
	/** Quiet period before anything appears, in ms. */
	holdMs: number;
	/** Time to reveal one full line, in ms. */
	msPerLine: number;
}

export const DEFAULT_REVEAL: RevealOptions = { holdMs: 260, msPerLine: 22 };

function intFromEnv(name: string, fallback: number): number {
	const raw = process.env[name];
	if (typeof raw !== "string" || raw.trim() === "") return fallback;
	const parsed = Number.parseInt(raw, 10);
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

/** Reveal settings, read once so every message in a turn agrees. */
export function revealOptions(): RevealOptions | null {
	if (process.env.PI_ACIDBATH_REVEAL === "off") return null;
	return {
		holdMs: intFromEnv("PI_ACIDBATH_REVEAL_HOLD_MS", DEFAULT_REVEAL.holdMs),
		msPerLine: intFromEnv("PI_ACIDBATH_REVEAL_MS_PER_LINE", DEFAULT_REVEAL.msPerLine),
	};
}

/**
 * How much of `text` should be visible `elapsedMs` after the reveal started.
 *
 * Returns a code-point count, never a UTF-16 index, so a reveal boundary can
 * never land inside a surrogate pair or a combining sequence. It only ever
 * grows with time and never exceeds the text.
 */
export function revealedChars(text: string, elapsedMs: number, options: RevealOptions = DEFAULT_REVEAL): number {
	if (elapsedMs <= options.holdMs) return 0;
	const points = Array.from(text);
	if (points.length === 0) return 0;

	const progress = elapsedMs - options.holdMs;
	const lines = text.split("\n");
	const fullLinesChars = lines.slice(0, -1).reduce((total, line) => total + Array.from(line).length + 1, 0);
	const lastLineChars = Array.from(lines[lines.length - 1]!).length;
	const total = fullLinesChars + lastLineChars;

	if (options.msPerLine <= 0) return total;
	if (progress >= options.msPerLine * lines.length) return total;

	const revealedLines = Math.floor(progress / options.msPerLine);
	const fraction = (progress % options.msPerLine) / options.msPerLine;
	const lineStarts = [0];
	let cursor = 0;
	for (let index = 0; index < lines.length - 1; index++) {
		cursor += Array.from(lines[index]!).length + 1;
		lineStarts.push(cursor);
	}

	const start = lineStarts[revealedLines] ?? 0;
	const nextLength = Array.from(lines[revealedLines] ?? "").length;
	return Math.min(total, start + Math.floor(fraction * nextLength));
}

/** The visible slice of `text` at `elapsedMs`. Never returns more than `text`. */
export function revealedText(text: string, elapsedMs: number, options: RevealOptions = DEFAULT_REVEAL): string {
	return Array.from(text).slice(0, revealedChars(text, elapsedMs, options)).join("");
}

/**
 * Tracks one in-flight reveal and drives repaints for it.
 *
 * The reveal advances on a timer rather than on token arrival, so the block
 * fills at an even rate even when the provider stalls or bursts. The timer
 * exists only while a reveal is running and is cleared the moment it lands,
 * so a settled session leaves no interval behind.
 */
export class TextReveal {
	private readonly requestRender: () => void;
	private readonly options: RevealOptions;
	private startedAt: number | null = null;
	private lastLength = 0;
	private timer: ReturnType<typeof setInterval> | null = null;

	constructor(requestRender: () => void, options: RevealOptions = DEFAULT_REVEAL) {
		this.requestRender = requestRender;
		this.options = options;
	}

	/** True while a reveal is in flight and still needs repaints. */
	get active(): boolean {
		return this.startedAt !== null;
	}

	/** Advance the reveal for the text arriving now. Returns what to display. */
	update(text: string, now: number, streaming: boolean): string {
		if (!streaming) {
			this.reset();
			return text;
		}
		// A new response restarts the reveal; the same one growing does not.
		if (this.startedAt === null || text.length < this.lastLength) {
			this.startedAt = now;
			this.lastLength = text.length;
		} else {
			this.lastLength = text.length;
		}
		this.ensureTimer();
		return revealedText(text, now - this.startedAt, this.options);
	}

	reset(): void {
		this.startedAt = null;
		this.lastLength = 0;
		this.stop();
	}

	dispose(): void {
		this.reset();
	}

	private ensureTimer(): void {
		if (this.timer) return;
		this.timer = setInterval(() => {
			if (this.startedAt === null) return this.stop();
			this.requestRender();
		}, this.options.msPerLine);
		// Never hold the process open for a reveal.
		(this.timer as unknown as { unref?: () => void }).unref?.();
	}

	private stop(): void {
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = null;
		}
	}
}