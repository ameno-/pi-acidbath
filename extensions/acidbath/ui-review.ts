/** Pure Hunk review parsing and Sideshow-card formatting. */

export type ReviewStatus = "ready" | "needs-attention" | "clean";

export interface ReviewFileSummary {
	path: string;
	additions: number;
	deletions: number;
	hunkCount: number;
}

export interface ReviewCommentSummary {
	noteId?: string;
	source: string;
	filePath: string;
	range: string;
	body: string;
	author?: string;
}

export interface HunkReviewSnapshot {
	repo: string;
	sessionId: string;
	title: string;
	files: ReviewFileSummary[];
	comments: ReviewCommentSummary[];
	humanCommentCount: number;
	liveCommentCount: number;
	reviewNoteCount: number;
	updatedAt: string;
}

interface RecordLike {
	[key: string]: unknown;
}

function record(value: unknown): RecordLike | undefined {
	return value && typeof value === "object" && !Array.isArray(value) ? value as RecordLike : undefined;
}

function stringValue(value: unknown, fallback = ""): string {
	return typeof value === "string" ? value : fallback;
}

function numberValue(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function rangeValue(value: unknown): string {
	if (!Array.isArray(value) || value.length === 0) return "line ?";
	const numbers = value.filter((item): item is number => typeof item === "number" && Number.isFinite(item));
	if (numbers.length === 0) return "line ?";
	if (numbers.length === 1 || numbers[0] === numbers[1]) return `line ${numbers[0]}`;
	return `lines ${numbers[0]}-${numbers[1]}`;
}

function bounded(value: string, max: number): string {
	const normalized = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ").trim();
	return normalized.length <= max ? normalized : `${normalized.slice(0, max - 1)}…`;
}

export function commentsFromHunk(payload: unknown): ReviewCommentSummary[] {
	const root = record(payload);
	const comments = Array.isArray(root?.comments) ? root.comments : [];
	return comments.map((item): ReviewCommentSummary => {
		const comment = record(item) ?? {};
		const range = Array.isArray(comment.newRange) ? comment.newRange : comment.oldRange;
		return {
			noteId: typeof comment.noteId === "string" ? comment.noteId : undefined,
			source: stringValue(comment.source, "user"),
			filePath: bounded(stringValue(comment.filePath, "<unknown file>"), 180),
			range: rangeValue(range),
			body: bounded(stringValue(comment.body, ""), 600),
			author: typeof comment.author === "string" ? bounded(comment.author, 80) : undefined,
		};
	});
}

export function commentFingerprint(comment: ReviewCommentSummary): string {
	return `${comment.noteId ?? ""}\u0000${comment.filePath}\u0000${comment.range}\u0000${comment.body}`;
}

export function formatCommentHandoff(repo: string, comments: readonly ReviewCommentSummary[]): string {
	const lines = [
		"## Hunk review comments",
		`Repository: ${repo}`,
		"Scope: human-authored notes",
		"",
		"Treat these as review feedback, not automatic edit instructions. Positive notes are acknowledgement only. Inspect the current code before proposing a change, and ask for clarification when a note is ambiguous.",
		"",
	];
	for (const comment of comments) {
		lines.push(`- ${comment.filePath} (${comment.range}, ${comment.author ?? comment.source})`);
		if (comment.noteId) lines.push(`  note: ${comment.noteId}`);
		lines.push(`  ${comment.body.replace(/\n/g, "\n  ")}`);
	}
	return lines.join("\n");
}

export function snapshotFromHunk(payload: unknown, repo: string): HunkReviewSnapshot {
	const root = record(payload);
	const review = record(root?.review) ?? root ?? {};
	const files = Array.isArray(review.files) ? review.files : [];
	const notes = Array.isArray(review.reviewNotes) ? review.reviewNotes : [];
	const liveComments = numberValue(review.liveCommentCount);
	const sessionId = stringValue(review.sessionId, "unknown");

	return {
		repo,
		sessionId,
		title: stringValue(review.title, "Hunk review"),
		files: files.map((item): ReviewFileSummary => {
			const file = record(item) ?? {};
			return {
				path: bounded(stringValue(file.path, "<unknown file>"), 180),
				additions: numberValue(file.additions),
				deletions: numberValue(file.deletions),
				hunkCount: numberValue(file.hunkCount),
			};
		}),
		comments: notes.map((item): ReviewCommentSummary => {
			const note = record(item) ?? {};
			const body = bounded(stringValue(note.body, ""), 600);
			const range = Array.isArray(note.newRange) ? note.newRange : note.oldRange;
			return {
				noteId: typeof note.noteId === "string" ? note.noteId : undefined,
				source: stringValue(note.source, "unknown"),
				filePath: bounded(stringValue(note.filePath, "<unknown file>"), 180),
				range: rangeValue(range),
				body,
				author: typeof note.author === "string" ? bounded(note.author, 80) : undefined,
			};
		}),
		humanCommentCount: notes.filter((item) => record(item)?.source === "user").length,
		liveCommentCount: liveComments,
		reviewNoteCount: numberValue(review.reviewNoteCount) || notes.length,
		updatedAt: new Date().toISOString(),
	};
}

export function reviewStatus(snapshot: HunkReviewSnapshot, pendingHumanCommentCount = snapshot.humanCommentCount): ReviewStatus {
	if (pendingHumanCommentCount > 0) return "needs-attention";
	if (snapshot.files.length === 0) return "clean";
	return "ready";
}

export function reviewStatusLabel(status: ReviewStatus): string {
	if (status === "needs-attention") return "Needs attention";
	if (status === "clean") return "Clean";
	return "Ready for review";
}

export function formatReviewCard(snapshot: HunkReviewSnapshot, pendingHumanCommentCount = snapshot.humanCommentCount): string {
	const status = reviewStatus(snapshot, pendingHumanCommentCount);
	const additions = snapshot.files.reduce((total, file) => total + file.additions, 0);
	const deletions = snapshot.files.reduce((total, file) => total + file.deletions, 0);
	const lines = [
		`## Hunk review · ${snapshot.title}`,
		`**Status:** ${reviewStatusLabel(status)}  `,
		`**Repository:** \`${snapshot.repo}\`  `,
		`**Hunk session:** \`${snapshot.sessionId}\`  `,
		`**Changes:** ${snapshot.files.length} files · +${additions} / -${deletions} · ${snapshot.files.reduce((total, file) => total + file.hunkCount, 0)} hunks  `,
		`**Comments:** ${snapshot.humanCommentCount} human (${pendingHumanCommentCount} pending) · ${snapshot.liveCommentCount} live agent · ${snapshot.reviewNoteCount} total  `,
		"",
		"Hunk owns the diff, navigation, highlights, and comments. Sideshow is the live summary; Acidbath coordinates the handoff.",
		"",
		"### Files",
	];

	if (snapshot.files.length === 0) {
		lines.push("No changed files in the active Hunk review.");
	} else {
		for (const file of snapshot.files.slice(0, 40)) {
			lines.push(`- \`${file.path}\` · +${file.additions} / -${file.deletions} · ${file.hunkCount} ${file.hunkCount === 1 ? "hunk" : "hunks"}`);
		}
		if (snapshot.files.length > 40) lines.push(`- … ${snapshot.files.length - 40} more files`);
	}

	if (snapshot.comments.length > 0) {
		lines.push("", "### Review notes");
		for (const comment of snapshot.comments.slice(0, 20)) {
			const author = comment.author ?? comment.source;
			lines.push(`- **${comment.filePath} · ${comment.range} · ${author}** — ${comment.body || "(empty note)"}`);
		}
		if (snapshot.comments.length > 20) lines.push(`- … ${snapshot.comments.length - 20} more notes`);
	}

	lines.push(
		"",
		"### Next actions",
		"- Add or edit comments in Hunk.",
		"- Run `/hunk-comments` or `/review comments` to queue new human notes for Pi.",
		"- After implementation and tests, run `/review sync` to refresh Hunk and this card.",
	);
	return lines.join("\n");
}

export function reviewCardData(snapshot: HunkReviewSnapshot, pendingHumanCommentCount = snapshot.humanCommentCount): Record<string, unknown> {
	return {
		repo: snapshot.repo,
		hunkSessionId: snapshot.sessionId,
		status: reviewStatus(snapshot, pendingHumanCommentCount),
		files: snapshot.files,
		comments: snapshot.comments,
		counts: {
			files: snapshot.files.length,
			humanComments: snapshot.humanCommentCount,
			pendingHumanComments: pendingHumanCommentCount,
			liveComments: snapshot.liveCommentCount,
			totalNotes: snapshot.reviewNoteCount,
		},
		updatedAt: snapshot.updatedAt,
	};
}

export function formatNotionCheckpoint(
	snapshot: HunkReviewSnapshot,
	pendingHumanCommentCount = snapshot.humanCommentCount,
	sideshowUrl?: string,
): string {
	const status = reviewStatusLabel(reviewStatus(snapshot, pendingHumanCommentCount));
	const additions = snapshot.files.reduce((total, file) => total + file.additions, 0);
	const deletions = snapshot.files.reduce((total, file) => total + file.deletions, 0);
	const lines = [
		`## Review checkpoint · ${snapshot.sessionId}`,
		`**Status:** ${status}`,
		`**Recorded:** ${new Date().toISOString()}`,
		`**Repository:** \`${snapshot.repo}\``,
		`**Hunk session:** \`${snapshot.sessionId}\``,
		`**Changes:** ${snapshot.files.length} files · +${additions} / -${deletions} · ${snapshot.files.reduce((total, file) => total + file.hunkCount, 0)} hunks`,
		`**Comments:** ${snapshot.humanCommentCount} human · ${pendingHumanCommentCount} pending · ${snapshot.reviewNoteCount} total`,
	];
	if (sideshowUrl) lines.push(`**Live Sideshow card:** ${sideshowUrl}`);
	lines.push("", "### Files");
	for (const file of snapshot.files.slice(0, 40)) {
		lines.push(`- \`${file.path}\` · +${file.additions} / -${file.deletions} · ${file.hunkCount} ${file.hunkCount === 1 ? "hunk" : "hunks"}`);
	}
	if (snapshot.files.length > 40) lines.push(`- … ${snapshot.files.length - 40} more files`);
	if (snapshot.comments.length > 0) {
		lines.push("", "### Notes");
		for (const comment of snapshot.comments.slice(0, 20)) {
			lines.push(`- **${comment.filePath} · ${comment.range} · ${comment.author ?? comment.source}** — ${comment.body || "(empty note)"}`);
		}
		if (snapshot.comments.length > 20) lines.push(`- … ${snapshot.comments.length - 20} more notes`);
	}
	lines.push("", "Archive generated by Acidbath; Hunk remains the review source of truth.", `## End review checkpoint · ${snapshot.sessionId}`);
	return lines.join("\n");
}

export function upsertNotionCheckpoint(markdown: string, sessionId: string, section: string): string {
	const start = `## Review checkpoint · ${sessionId}`;
	const end = `## End review checkpoint · ${sessionId}`;
	const startIndex = markdown.indexOf(start);
	if (startIndex === -1) return `${markdown.trimEnd()}\n\n${section}\n`;
	const endIndex = markdown.indexOf(end, startIndex);
	if (endIndex === -1) return `${markdown.slice(0, startIndex).trimEnd()}\n\n${section}\n`;
	return `${markdown.slice(0, startIndex).trimEnd()}\n\n${section}\n${markdown.slice(endIndex + end.length).replace(/^\s*/, "")}`;
}
