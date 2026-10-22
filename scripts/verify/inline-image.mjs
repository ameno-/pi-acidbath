/**
 * Inline image emitter for Rex.
 *
 * Terminals display images through escape protocols rather than by printing
 * bytes. macOS terminals understand the iTerm inline protocol (OSC 1337), so
 * this base64-encodes a PNG and hands it to the terminal as a display request.
 *
 * Whether the terminal honours it is observable: a terminal that understands
 * the sequence consumes it and draws an image, while one that does not prints
 * the payload as garbage. The live capture check uses that difference to tell
 * the two cases apart instead of guessing.
 *
 *   node scripts/verify/inline-image.mjs <file.png>
 */

import { readFileSync } from "node:fs";
import { basename } from "node:path";

const file = process.argv[2];
if (!file) {
	process.stderr.write("usage: inline-image.mjs <file.png>\n");
	process.exit(2);
}

const png = readFileSync(file);
const payload = png.toString("base64");
const name = basename(file);

// OSC 1337 ; File=inline=1;size=<bytes>:<base64> ST
process.stdout.write(`\u001b]1337;File=inline=1;preserveAspectRatio=1;size=${png.length}:${payload}\u0007`);
process.stdout.write("\r\n");