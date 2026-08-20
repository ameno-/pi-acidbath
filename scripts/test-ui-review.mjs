import assert from "node:assert/strict";
import {
  commentFingerprint,
  commentsFromHunk,
  formatCommentHandoff,
  formatNotionCheckpoint,
  formatReviewCard,
  reviewCardData,
  reviewStatus,
  snapshotFromHunk,
  upsertNotionCheckpoint,
} from "../extensions/acidbath/ui-review.ts";

const payload = {
  review: {
    sessionId: "session-1",
    title: "acidbath working tree",
    files: [
      { path: "src/index.ts", additions: 4, deletions: 2, hunkCount: 1 },
      { path: "tests/index.test.ts", additions: 8, deletions: 0, hunkCount: 1 },
    ],
    liveCommentCount: 2,
    reviewNoteCount: 3,
    reviewNotes: [
      { noteId: "user:1", source: "user", filePath: "src/index.ts", newRange: [12, 12], body: "Try a smaller helper." },
      { noteId: "agent:1", source: "agent", filePath: "tests/index.test.ts", newRange: [4, 5], body: "Coverage added." },
    ],
  },
};

const snapshot = snapshotFromHunk(payload, "/repo");
assert.equal(snapshot.files.length, 2);
assert.equal(snapshot.humanCommentCount, 1);
assert.equal(reviewStatus(snapshot), "needs-attention");
assert.match(formatReviewCard(snapshot), /Try a smaller helper/);
assert.equal(reviewCardData(snapshot).counts.humanComments, 1);

const comments = commentsFromHunk({ comments: [{ noteId: "user:1", source: "user", filePath: "src/index.ts", newRange: [12, 12], body: "Try a smaller helper." }] });
assert.equal(comments.length, 1);
assert.equal(commentFingerprint(comments[0]), "user:1\u0000src/index.ts\u0000line 12\u0000Try a smaller helper.");
assert.match(formatCommentHandoff("/repo", comments), /human-authored notes/);

const checkpoint = formatNotionCheckpoint(snapshot, 1, "https://sideshow.example/review");
assert.match(checkpoint, /Live Sideshow card/);
const pageWithCheckpoint = upsertNotionCheckpoint("# Task\n\n" + checkpoint, snapshot.sessionId, checkpoint);
assert.equal(pageWithCheckpoint.split(`## Review checkpoint · ${snapshot.sessionId}`).length - 1, 1);
const replaced = upsertNotionCheckpoint(pageWithCheckpoint, snapshot.sessionId, checkpoint.replace("Ready for review", "Needs attention"));
assert.equal(replaced.split(`## Review checkpoint · ${snapshot.sessionId}`).length - 1, 1);
assert.match(replaced, /Needs attention/);

console.log("ui-review: ok");
