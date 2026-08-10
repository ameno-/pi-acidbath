/** Tests for the attributed lyric song selector and line cycle. */

import {
	WHIMSICAL_SONGS,
	WHIMSICAL_MAX_DISPLAY_CHARS,
	WhimsicalMessageCycle,
	buildWhimsicalPlaylist,
	countWhimsicalWords,
	isDisplayCompleteLyric,
	nextWhimsicalIndex,
	pickWhimsicalSong,
} from "../extensions/acidbath/ui-whimsical.ts";

let passed = 0;
let failed = 0;

function assert(name, condition, detail = "") {
	if (condition) passed++;
	else {
		failed++;
		console.log(`FAIL  ${name}${detail ? ` (${detail})` : ""}`);
	}
}

for (const song of WHIMSICAL_SONGS) {
	assert(`${song.song}: has multiple ordered lines`, song.lines.length >= 2);
	assert(`${song.song}: source`, song.sourceUrl.startsWith("https://genius.com/"));
	for (const line of song.lines) {
		const words = countWhimsicalWords(line);
		assert(`${song.song}: word count`, words >= 4 && words <= 10, `${words}: ${line}`);
	}
}

assert("next index starts at zero", nextWhimsicalIndex(-1, 3) === 0);
assert("next index wraps", nextWhimsicalIndex(2, 3) === 0);
assert("next index normalizes", nextWhimsicalIndex(1.9, 3) === 2);
assert("random zero picks first song", pickWhimsicalSong(0) === WHIMSICAL_SONGS[0]);
assert("random one clamps to last song", pickWhimsicalSong(1) === WHIMSICAL_SONGS.at(-1));
assert("random is session-level", pickWhimsicalSong(0.2) === pickWhimsicalSong(0.2));

const playlist = buildWhimsicalPlaylist(() => 0.42);
assert("playlist expands beyond a single song", playlist.length >= 12 && new Set(playlist.map((entry) => entry.song.song)).size >= 5);
assert("playlist contains no repeated lines", new Set(playlist.map((entry) => entry.line)).size === playlist.length);
const openingWords = playlist.map((entry) => entry.line.toLowerCase().match(/[a-z']+/)?.[0]);
assert("adjacent lyrics avoid the same opening word", openingWords.every((word, index) => word !== openingWords[(index + 1) % openingWords.length]));
assert("every displayed line is complete and fits", playlist.every((entry) => isDisplayCompleteLyric(entry.line) && entry.line.length <= WHIMSICAL_MAX_DISPLAY_CHARS));
assert("overlong phrase is excluded rather than chopped", !playlist.some((entry) => entry.line.startsWith("Jump out the Fisker")));

const selectedSong = WHIMSICAL_SONGS.find((song) => song.lines.length >= 3);
const seen = [];
const cycle = new WhimsicalMessageCycle((line, song) => seen.push({ line, song }), 1_000_000);
cycle.setSong(selectedSong);
cycle.start();
assert("cycle starts active", cycle.isActive());
assert("cycle emits first line immediately", seen.length === 1 && seen[0].line === selectedSong.lines[0]);
assert("cycle reports selected song", cycle.currentSong() === selectedSong && seen[0].song === selectedSong);
cycle.advance();
assert("cycle renders lines in order", seen[1].line === selectedSong.lines[1]);
for (let i = 2; i < selectedSong.lines.length; i++) cycle.advance();
assert("cycle loops selected song", seen.at(-1).line === selectedSong.lines.at(-1));
cycle.advance();
assert("cycle wraps to first line", seen.at(-1).line === selectedSong.lines[0]);
assert("cycle exposes current line", cycle.currentLine() === selectedSong.lines[0]);
const seenCountBeforeStop = seen.length;
cycle.stop();
assert("cycle stops", !cycle.isActive());
cycle.advance();
assert("stopped cycle does not emit", seen.length === seenCountBeforeStop);
cycle.start();
assert("cycle restarts from first line", seen.at(-1).line === selectedSong.lines[0]);
cycle.stop();

const replacementSeen = [];
const replacementCycle = new WhimsicalMessageCycle((line) => replacementSeen.push(line), 1_000_000);
replacementCycle.setSong(selectedSong);
replacementCycle.start();
replacementCycle.setSong(WHIMSICAL_SONGS[0]);
assert("active song replacement emits new first line", replacementSeen.at(-1) === WHIMSICAL_SONGS[0].lines[0]);
replacementCycle.stop();

const reducedSeen = [];
const reducedCycle = new WhimsicalMessageCycle((line) => reducedSeen.push(line), 1, true);
reducedCycle.setSong(selectedSong);
reducedCycle.start();
reducedCycle.advance();
assert("reduced motion stays on one line", reducedSeen.length === 1);
reducedCycle.stop();
reducedCycle.start();
assert("reduced motion restarts with first line", reducedSeen.length === 2 && reducedSeen[1] === selectedSong.lines[0]);
reducedCycle.stop();

const stateSeen = [];
const stateCycle = new WhimsicalMessageCycle((line) => stateSeen.push(line), 1, true, true);
stateCycle.setSong(selectedSong);
stateCycle.start();
stateCycle.trigger();
assert("state-driven reduced mode advances on semantic triggers", stateSeen.length === 2 && stateSeen[1] === selectedSong.lines[1]);
stateCycle.trigger();
assert("state-driven mode advances exactly once per trigger", stateSeen.length === 3 && stateSeen[2] === selectedSong.lines[2]);
stateCycle.stop();

const playlistSeen = [];
const playlistCycle = new WhimsicalMessageCycle((line) => playlistSeen.push(line), 1, false, true);
playlistCycle.setPlaylist(playlist);
playlistCycle.start();
for (let index = 1; index < playlist.length; index += 1) playlistCycle.trigger();
assert("state playlist uses every eligible line before repeating", new Set(playlistSeen).size === playlist.length);
playlistCycle.trigger();
assert("playlist repeats only after the full pool", playlistSeen.at(-1) === playlistSeen[0]);
playlistCycle.stop();

console.log(`\nui-whimsical.ts: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
