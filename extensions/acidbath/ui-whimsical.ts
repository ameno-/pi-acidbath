/**
 * Attributed lyric snippets grouped by source song.
 *
 * A session chooses one song once; its short lines then render in source order
 * and loop until the agent stops. The UI displays only the selected line.
 */

export interface WhimsicalSong {
	readonly artist: "Roc Marciano" | "Stove God Cooks";
	readonly song: string;
	readonly album: string;
	readonly sourceUrl: string;
	readonly lines: readonly string[];
}

export const WHIMSICAL_SONGS: readonly WhimsicalSong[] = [
	{
		artist: "Roc Marciano",
		song: "Emeralds",
		album: "Reloaded",
		sourceUrl: "https://genius.com/Roc-marciano-emeralds-lyrics",
		lines: [
			"Cock weapons and pop the specimen",
			"With elegance, metal wrench your wig",
		],
	},
	{
		artist: "Roc Marciano",
		song: "Nine Spray",
		album: "Reloaded",
		sourceUrl: "https://genius.com/Roc-marciano-nine-spray-lyrics",
		lines: [
			"You payin' layaway on a bracelet",
			"You repair, I replace shit",
			"You a chair, I'm a spaceship",
		],
	},
	{
		artist: "Roc Marciano",
		song: "Quantum Leap",
		album: "The Elephant Man's Bones",
		sourceUrl: "https://genius.com/Roc-marciano-and-the-alchemist-quantum-leap-lyrics",
		lines: [
			"Jump out the Fisker and come cook yo' ass, bird",
			"Your favorite rapper send fan mail to me",
			"Your little LP ain't worth twelve pennies",
		],
	},
	{
		artist: "Stove God Cooks",
		song: "Break the Pyrex",
		album: "Reasonable Drought",
		sourceUrl: "https://genius.com/Stove-god-cooks-and-roc-marciano-break-the-pyrex-lyrics",
		lines: [
			"The bricks came whiter than Jon B",
			"My young boy drummin' on 'em like he Tommy Lee",
		],
	},
	{
		artist: "Stove God Cooks",
		song: "Frank Murphy",
		album: "Who Made the Sunshine",
		sourceUrl: "https://genius.com/Westside-gunn-frank-murphy-lyrics",
		lines: [
			"Don't ever judge a book by the cover",
			"Judge a cook by how it bubble",
		],
	},
	{
		artist: "Stove God Cooks",
		song: "Cocaine Cologne",
		album: "Reasonable Drought",
		sourceUrl: "https://genius.com/Stove-god-cooks-cocaine-cologne-lyrics",
		lines: [
			"We made it to the top floor, to the clouds",
			"Still smelling like a brick right now",
		],
	},
	{
		artist: "Stove God Cooks",
		song: "Gloria Blemente",
		album: "Reasonable Drought",
		sourceUrl: "https://genius.com/Stove-god-cooks-gloria-blemente-lyrics",
		lines: [
			"Baby, I can't love you",
			"But I can't let you go",
		],
	},
] as const;

export const WHIMSICAL_MESSAGE_INTERVAL_MS = 3_200;
export const WHIMSICAL_MAX_DISPLAY_CHARS = 42;
export const WHIMSICAL_MIN_DISPLAY_WORDS = 4;

export interface WhimsicalLine {
	readonly line: string;
	readonly song: WhimsicalSong;
}

export function countWhimsicalWords(message: string): number {
	return message.trim() === "" ? 0 : message.trim().split(/\s+/u).length;
}

export function nextWhimsicalIndex(index: number, count: number): number {
	if (count <= 0) return 0;
	return ((Math.trunc(index) + 1) % count + count) % count;
}

/** Pick the session's one source song. Runtime callers use Math.random(). */
export function pickWhimsicalSong(
	random = Math.random(),
	songs: readonly WhimsicalSong[] = WHIMSICAL_SONGS,
): WhimsicalSong | undefined {
	if (songs.length === 0) return undefined;
	const normalized = Number.isFinite(random) ? Math.max(0, Math.min(random, 0.999999999)) : 0;
	return songs[Math.floor(normalized * songs.length)];
}

export function isDisplayCompleteLyric(line: string): boolean {
	const trimmed = line.trim();
	if (trimmed.length === 0 || trimmed.length > WHIMSICAL_MAX_DISPLAY_CHARS) return false;
	if (countWhimsicalWords(trimmed) < WHIMSICAL_MIN_DISPLAY_WORDS) return false;
	const lastWord = trimmed.toLowerCase().match(/[a-z']+$/)?.[0];
	return lastWord !== undefined && !new Set(["a", "an", "and", "by", "for", "of", "or", "the", "to", "with"]).has(lastWord);
}

/** Build one session playlist across every source, without duplicate lines. */
export function buildWhimsicalPlaylist(
	random = Math.random,
	songs: readonly WhimsicalSong[] = WHIMSICAL_SONGS,
): WhimsicalLine[] {
	const entries = songs.flatMap((song) => song.lines
		.filter(isDisplayCompleteLyric)
		.map((line) => ({ line, song })));
	const unique = [...new Map(entries.map((entry) => [entry.line, entry])).values()];
	for (let index = unique.length - 1; index > 0; index -= 1) {
		const sample = random();
		const normalized = Number.isFinite(sample) ? Math.max(0, Math.min(sample, 0.999999999)) : 0;
		const target = Math.floor(normalized * (index + 1));
		[unique[index], unique[target]] = [unique[target]!, unique[index]!];
	}
	const remaining = [...unique];
	const ordered: WhimsicalLine[] = [];
	while (remaining.length > 0) {
		const previousWord = openingWord(ordered.at(-1)?.line);
		const candidateIndex = Math.max(0, remaining.findIndex((entry) => openingWord(entry.line) !== previousWord));
		ordered.push(remaining.splice(candidateIndex, 1)[0]!);
	}
	if (!hasDistinctOpeningWords(ordered)) {
		for (let index = 1; index < ordered.length - 1; index += 1) {
			const candidate = [...ordered];
			[candidate[index], candidate[candidate.length - 1]] = [candidate[candidate.length - 1]!, candidate[index]!];
			if (hasDistinctOpeningWords(candidate)) return candidate;
		}
	}
	return ordered;
}

function openingWord(line: string | undefined): string {
	return line?.toLowerCase().match(/[a-z']+/)?.[0] ?? "";
}

function hasDistinctOpeningWords(entries: readonly WhimsicalLine[]): boolean {
	if (entries.length <= 1) return true;
	return entries.every((entry, index) => openingWord(entry.line) !== openingWord(entries[(index + 1) % entries.length]?.line));
}

export type WhimsicalMessageListener = (line: string, song: WhimsicalSong) => void;

/**
 * A quiet, session-scoped message loop. It schedules only the next line and
 * has no timer while stopped, so idle sessions do not keep the event loop hot.
 */
export class WhimsicalMessageCycle {
	private active = false;
	private lineIndex = -1;
	private song: WhimsicalSong | undefined;
	private playlist: WhimsicalLine[] = [];
	private timer: ReturnType<typeof setTimeout> | undefined;
	private readonly onMessage: WhimsicalMessageListener;
	private readonly intervalMs: number;
	private readonly reducedMotion: boolean;
	private readonly stateDriven: boolean;

	constructor(
		onMessage: WhimsicalMessageListener,
		intervalMs = WHIMSICAL_MESSAGE_INTERVAL_MS,
		reducedMotion = false,
		stateDriven = false,
	) {
		this.onMessage = onMessage;
		this.intervalMs = intervalMs;
		this.reducedMotion = reducedMotion;
		this.stateDriven = stateDriven;
	}

	public setSong(song: WhimsicalSong | undefined): void {
		const wasActive = this.active;
		this.song = song;
		this.playlist = song ? song.lines.map((line) => ({ line, song })) : [];
		this.lineIndex = -1;
		this.clearTimer();
		if (wasActive) this.advance();
	}

	public setPlaylist(playlist: readonly WhimsicalLine[]): void {
		const wasActive = this.active;
		this.playlist = [...playlist];
		this.song = this.playlist[0]?.song;
		this.lineIndex = -1;
		this.clearTimer();
		if (wasActive) this.advance();
	}

	public start(): void {
		if (this.active) return;
		this.active = true;
		this.advance();
	}

	public advance(): void {
		if (!this.active || this.playlist.length === 0) return;
		if (this.reducedMotion && !this.stateDriven && this.lineIndex >= 0) return;
		this.clearTimer();
		this.lineIndex = nextWhimsicalIndex(this.lineIndex, this.playlist.length);
		const entry = this.playlist[this.lineIndex]!;
		this.song = entry.song;
		this.onMessage(entry.line, entry.song);
		if (!this.reducedMotion && !this.stateDriven) this.timer = setTimeout(() => this.advance(), this.intervalMs);
	}

	/** Advance exactly once for a semantic state change. */
	public trigger(): void {
		if (!this.active) this.start();
		else this.advance();
	}

	public stop(): void {
		this.active = false;
		this.clearTimer();
		this.lineIndex = -1;
	}

	public isActive(): boolean {
		return this.active;
	}

	public currentSong(): WhimsicalSong | undefined {
		return this.song;
	}

	public currentLine(): string | undefined {
		return this.lineIndex >= 0 ? this.playlist[this.lineIndex]?.line : undefined;
	}

	private clearTimer(): void {
		if (this.timer !== undefined) {
			clearTimeout(this.timer);
			this.timer = undefined;
		}
	}
}
