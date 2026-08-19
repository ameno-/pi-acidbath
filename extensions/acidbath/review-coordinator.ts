/**
 * Coordinates Hunk (diff authority) and Sideshow (live review projection).
 *
 * This module never edits files and never launches an interactive Hunk TUI.
 * Hunk's `session *` CLI is the source of truth; Sideshow receives a bounded
 * summary card that can be updated in place.
 */

import { realpath } from "node:fs/promises";
import { basename, resolve } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	commentFingerprint,
	commentsFromHunk,
	formatCommentHandoff,
	formatReviewCard,
	reviewCardData,
	snapshotFromHunk,
	type HunkReviewSnapshot,
	type ReviewCommentSummary,
} from "./ui-review.ts";

const REVIEW_STATE_ENTRY = "acidbath-review-state";
const REVIEW_COMMENT_LIMIT = 100;
const REVIEW_START_TIMEOUT_MS = 12_000;
const REVIEW_POLL_MS = 250;
const SIDESHOW_DEFAULT_URL = "http://localhost:8228";

interface ReviewState {
	active: boolean;
	repo?: string;
	hunkSessionId?: string;
	sideshowSessionId?: string;
	sideshowPostId?: string;
	importedCommentFingerprints: string[];
}

interface CommandResult {
	stdout: string;
	stderr: string;
	code: number;
}

interface SideshowFeedback {
	text?: string;
	surfaceTitle?: string;
	postId?: string;
}

interface SideshowWriteResult {
	id?: string;
	sessionId?: string;
	userFeedback?: SideshowFeedback[];
}

interface SideshowReviewRef {
	sessionId: string;
	postId: string;
}

interface SideshowRequestOptions {
	method?: "POST" | "PUT";
	body?: unknown;
}

export interface ReviewCoordinatorOptions {
	onStatus?: (status: string | undefined) => void;
}

function emptyState(): ReviewState {
	return { active: false, importedCommentFingerprints: [] };
}

function workingUi(ctx: ExtensionContext): { notify(message: string, type?: "info" | "warning" | "error"): void } {
	return ctx.ui as unknown as { notify(message: string, type?: "info" | "warning" | "error"): void };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function bounded(value: string, max: number): string {
	return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

function sideshowUrl(): string {
	return (process.env.SIDESHOW_URL ?? SIDESHOW_DEFAULT_URL).replace(/\/$/, "");
}

function commandError(result: CommandResult): string {
	return (result.stderr || result.stdout || "command failed").trim();
}

function samePath(left: string, right: string): boolean {
	return resolve(left) === resolve(right);
}

async function normalizedPath(path: string): Promise<string> {
	try {
		return await realpath(path);
	} catch {
		return resolve(path);
	}
}

async function canonicalRepo(pi: ExtensionAPI, requested: string, cwd: string): Promise<string> {
	const candidate = await normalizedPath(resolve(cwd, requested || "."));
	const result = await pi.exec("git", ["-C", candidate, "rev-parse", "--show-toplevel"], { timeout: 2_000 });
	if (result.code !== 0 || !result.stdout.trim()) return candidate;
	return normalizedPath(result.stdout.trim());
}

async function run(pi: ExtensionAPI, command: string, args: string[], cwd: string, timeout: number): Promise<CommandResult> {
	return pi.exec(command, args, { cwd, timeout }) as Promise<CommandResult>;
}

async function hunkSessions(pi: ExtensionAPI, cwd: string): Promise<Record<string, unknown>[]> {
	const result = await run(pi, "hunk", ["session", "list", "--json"], cwd, 4_000);
	if (result.code !== 0) throw new Error(commandError(result));
	try {
		const payload = JSON.parse(result.stdout) as { sessions?: unknown[] };
		return Array.isArray(payload.sessions) ? payload.sessions.map(asRecord).filter((item): item is Record<string, unknown> => Boolean(item)) : [];
	} catch {
		throw new Error("Hunk returned invalid JSON while listing sessions");
	}
}

async function hunkSessionForRepo(pi: ExtensionAPI, repo: string): Promise<Record<string, unknown> | undefined> {
	const sessions = await hunkSessions(pi, repo);
	for (const session of sessions) {
		const root = typeof session.repoRoot === "string" ? await normalizedPath(session.repoRoot) : "";
		if (root && samePath(root, repo)) return session;
	}
	return undefined;
}

async function waitForHunkSession(pi: ExtensionAPI, repo: string): Promise<Record<string, unknown> | undefined> {
	const deadline = Date.now() + REVIEW_START_TIMEOUT_MS;
	while (Date.now() < deadline) {
		const session = await hunkSessionForRepo(pi, repo);
		if (session) return session;
		await new Promise((resolvePromise) => setTimeout(resolvePromise, REVIEW_POLL_MS));
	}
	return hunkSessionForRepo(pi, repo);
}

async function readHunkReview(pi: ExtensionAPI, repo: string): Promise<HunkReviewSnapshot> {
	const result = await run(pi, "hunk", ["session", "review", "--repo", repo, "--include-notes", "--json"], repo, 5_000);
	if (result.code !== 0) {
		if (result.stderr.includes("No active session matches repoRoot")) {
			throw new Error(`No active Hunk session is open for ${repo}. Start one with /review start.`);
		}
		throw new Error(commandError(result));
	}
	try {
		return snapshotFromHunk(JSON.parse(result.stdout), repo);
	} catch (error) {
		throw new Error(error instanceof Error ? error.message : "Hunk returned invalid review JSON");
	}
}

async function readHumanComments(pi: ExtensionAPI, repo: string): Promise<ReviewCommentSummary[]> {
	const result = await run(pi, "hunk", ["session", "comment", "list", "--repo", repo, "--type", "user", "--json"], repo, 5_000);
	if (result.code !== 0) {
		if (result.stderr.includes("No active session matches repoRoot")) {
			throw new Error(`No active Hunk session is open for ${repo}. Start one with /review start.`);
		}
		throw new Error(commandError(result));
	}
	try {
		return commentsFromHunk(JSON.parse(result.stdout)).slice(0, REVIEW_COMMENT_LIMIT);
	} catch {
		throw new Error("Hunk returned invalid comment JSON");
	}
}

async function sideshowRequest(path: string, options: SideshowRequestOptions = {}): Promise<SideshowWriteResult> {
	const response = await fetch(`${sideshowUrl()}${path}`, {
		method: options.method ?? "POST",
		headers: {
			"content-type": "application/json",
			...(process.env.SIDESHOW_TOKEN ? { authorization: `Bearer ${process.env.SIDESHOW_TOKEN}` } : {}),
		},
		body: options.body === undefined ? undefined : JSON.stringify(options.body),
	});
	const text = await response.text();
	let payload: unknown = {};
	try {
		payload = text ? JSON.parse(text) : {};
	} catch {
		payload = { error: text };
	}
	if (!response.ok) {
		const error = asRecord(payload)?.error;
		throw new Error(`Sideshow ${path} failed: ${typeof error === "string" ? error : `${response.status} ${response.statusText}`}`);
	}
	return (asRecord(payload) as SideshowWriteResult | undefined) ?? {};
}

async function discoverSideshowReview(repo: string): Promise<SideshowReviewRef | undefined> {
	const headers = process.env.SIDESHOW_TOKEN ? { authorization: `Bearer ${process.env.SIDESHOW_TOKEN}` } : undefined;
	const sessionsResponse = await fetch(`${sideshowUrl()}/api/sessions`, { headers });
	if (!sessionsResponse.ok) return undefined;
	const sessionsPayload = await sessionsResponse.json() as unknown;
	if (!Array.isArray(sessionsPayload)) return undefined;

	const candidates = sessionsPayload
		.map((item) => asRecord(item))
		.filter((item): item is Record<string, unknown> => Boolean(item))
		.filter((item) => item.agent === (process.env.SIDESHOW_AGENT ?? "acidbath") && item.cwd === repo)
		.sort((left, right) => String(right.lastActiveAt ?? right.createdAt ?? "").localeCompare(String(left.lastActiveAt ?? left.createdAt ?? "")));

	for (const session of candidates) {
		const sessionId = typeof session.id === "string" ? session.id : undefined;
		if (!sessionId) continue;
		const postsResponse = await fetch(`${sideshowUrl()}/api/sessions/${encodeURIComponent(sessionId)}/posts`, { headers });
		if (!postsResponse.ok) continue;
		const postsPayload = await postsResponse.json() as unknown;
		if (!Array.isArray(postsPayload)) continue;
		const post = postsPayload
			.map((item) => asRecord(item))
			.filter((item): item is Record<string, unknown> => Boolean(item))
			.filter((item) => typeof item.title === "string" && item.title.startsWith("Hunk review ·"))
			.sort((left, right) => String(right.updatedAt ?? right.createdAt ?? "").localeCompare(String(left.updatedAt ?? left.createdAt ?? "")))[0];
		if (post && typeof post.id === "string") return { sessionId, postId: post.id };
	}
	return undefined;
}

async function ensureSideshowRef(repo: string, state: ReviewState): Promise<void> {
	if (state.sideshowPostId && state.sideshowSessionId) return;
	const existing = await discoverSideshowReview(repo);
	if (!existing) return;
	state.sideshowSessionId = existing.sessionId;
	state.sideshowPostId = existing.postId;
}

async function readSideshowFeedback(sessionId: string, postId?: string): Promise<SideshowFeedback[]> {
	const query = new URLSearchParams({ session: sessionId, author: "user", wait: "0" });
	if (postId) query.set("surface", postId);
	const response = await fetch(`${sideshowUrl()}/api/comments?${query.toString()}`, {
		headers: process.env.SIDESHOW_TOKEN ? { authorization: `Bearer ${process.env.SIDESHOW_TOKEN}` } : undefined,
	});
	const text = await response.text();
	let payload: unknown = {};
	try {
		payload = text ? JSON.parse(text) : {};
	} catch {
		payload = { error: text };
	}
	if (!response.ok) {
		const error = asRecord(payload)?.error;
		throw new Error(`Sideshow feedback failed: ${typeof error === "string" ? error : `${response.status} ${response.statusText}`}`);
	}
	const comments = asRecord(payload)?.comments;
	if (!Array.isArray(comments)) return [];
	return comments
		.map((item) => asRecord(item))
		.filter((item): item is Record<string, unknown> => Boolean(item))
		.slice(0, REVIEW_COMMENT_LIMIT)
		.map((item) => ({
			text: typeof item.text === "string" ? item.text : "",
			surfaceTitle: typeof item.surfaceTitle === "string" ? item.surfaceTitle : undefined,
			postId: typeof item.postId === "string" ? item.postId : undefined,
		}));
}

function feedbackText(feedback: readonly SideshowFeedback[]): string {
	const lines = [
		"## Sideshow review feedback",
		"",
		"Treat this as review guidance, not an automatic edit instruction. Inspect the current code and ask for clarification when needed.",
		"",
	];
	for (const item of feedback) {
		const title = item.surfaceTitle ? ` (${item.surfaceTitle})` : "";
		lines.push(`-${title} ${bounded(String(item.text ?? ""), 2_000)}`);
	}
	return lines.join("\n");
}

function restoreState(ctx: ExtensionContext): ReviewState {
	const entries = ctx.sessionManager.getEntries();
	for (let index = entries.length - 1; index >= 0; index -= 1) {
		const entry = entries[index];
		if (!entry || entry.type !== "custom" || entry.customType !== REVIEW_STATE_ENTRY) continue;
		const data = asRecord(entry.data);
		if (!data) continue;
		return {
			active: data.active === true,
			repo: typeof data.repo === "string" ? data.repo : undefined,
			hunkSessionId: typeof data.hunkSessionId === "string" ? data.hunkSessionId : undefined,
			sideshowSessionId: typeof data.sideshowSessionId === "string" ? data.sideshowSessionId : undefined,
			sideshowPostId: typeof data.sideshowPostId === "string" ? data.sideshowPostId : undefined,
			importedCommentFingerprints: Array.isArray(data.importedCommentFingerprints)
				? data.importedCommentFingerprints.filter((item): item is string => typeof item === "string").slice(-REVIEW_COMMENT_LIMIT)
				: [],
		};
	}
	return emptyState();
}

function pendingHumanComments(snapshot: HunkReviewSnapshot, state: ReviewState): ReviewCommentSummary[] {
	const seen = new Set(state.importedCommentFingerprints);
	return snapshot.comments
		.filter((comment) => comment.source === "user")
		.filter((comment) => !seen.has(commentFingerprint(comment)));
}

function stateData(state: ReviewState): Record<string, unknown> {
	return {
		active: state.active,
		repo: state.repo,
		hunkSessionId: state.hunkSessionId,
		sideshowSessionId: state.sideshowSessionId,
		sideshowPostId: state.sideshowPostId,
		importedCommentFingerprints: state.importedCommentFingerprints.slice(-REVIEW_COMMENT_LIMIT),
	};
}

function persistState(pi: ExtensionAPI, state: ReviewState): void {
	pi.appendEntry(REVIEW_STATE_ENTRY, stateData(state));
}

function parseReviewArgs(raw: string): { action: string; repo?: string } {
	const tokens = raw.trim().split(/\s+/).filter(Boolean);
	const action = tokens.shift()?.toLowerCase() || "status";
	const repo = tokens.length > 0 ? tokens.join(" ") : undefined;
	return { action, repo };
}

function statusText(snapshot: HunkReviewSnapshot, state: ReviewState): string {
	const additions = snapshot.files.reduce((total, file) => total + file.additions, 0);
	const deletions = snapshot.files.reduce((total, file) => total + file.deletions, 0);
	return [
		`Review: ${snapshot.title}`,
		`Hunk: ${snapshot.files.length} files · +${additions} / -${deletions} · ${snapshot.humanCommentCount} human comments`,
		`Sideshow: ${state.sideshowPostId ? "card synced" : "not published"}`,
	].join("\n");
}

function reviewStatusLine(snapshot: HunkReviewSnapshot, state: ReviewState): string {
	const pending = pendingHumanComments(snapshot, state).length;
	return pending > 0 ? `review · ${pending} comments` : `review · ${snapshot.files.length} files`;
}

function setReviewStatus(
	ctx: ExtensionContext,
	snapshot: HunkReviewSnapshot | undefined,
	state: ReviewState,
	onStatus?: (status: string | undefined) => void,
): void {
	if (!state.active) {
		ctx.ui.setStatus("review", undefined);
		onStatus?.(undefined);
		return;
	}
	const status = snapshot ? reviewStatusLine(snapshot, state) : "review · active";
	ctx.ui.setStatus("review", status);
	onStatus?.(status);
}

export function installReviewCoordinator(pi: ExtensionAPI, options: ReviewCoordinatorOptions = {}): void {
	let state = emptyState();
	let syncInFlight: Promise<void> | undefined;

	const notifyError = (ctx: ExtensionContext, error: unknown): void => {
		workingUi(ctx).notify(error instanceof Error ? error.message : String(error), "error");
	};

	const queueSideshowFeedback = (feedback: SideshowFeedback[]): void => {
		if (feedback.length === 0) return;
		pi.sendMessage(
			{
				customType: "acidbath-review-feedback",
				content: feedbackText(feedback),
				display: true,
				details: { count: feedback.length },
			},
			{ deliverAs: "nextTurn", triggerTurn: false },
		);
	};

	const publishOrUpdateCard = async (snapshot: HunkReviewSnapshot, reason: string): Promise<void> => {
		const title = `Hunk review · ${basename(snapshot.repo) || snapshot.repo}`;
		const pending = pendingHumanComments(snapshot, state);
		const surfaces = [
			{ kind: "markdown", markdown: formatReviewCard(snapshot, pending.length) },
			{ kind: "json", data: reviewCardData(snapshot, pending.length) },
		];
		const body = { title, surfaces, agent: process.env.SIDESHOW_AGENT ?? "acidbath", cwd: snapshot.repo };
		let result: SideshowWriteResult;
		if (state.sideshowPostId && state.sideshowSessionId) {
			try {
				result = await sideshowRequest(`/api/posts/${encodeURIComponent(state.sideshowPostId)}`, { method: "PUT", body: { title, surfaces } });
			} catch (error) {
				if (!String(error).includes("post not found")) throw error;
				state.sideshowPostId = undefined;
				result = await sideshowRequest("/api/posts", { body: { ...body, sessionTitle: `Acidbath review · ${basename(snapshot.repo) || snapshot.repo}` } });
			}
		} else {
			result = await sideshowRequest("/api/posts", { body: { ...body, sessionTitle: `Acidbath review · ${basename(snapshot.repo) || snapshot.repo}` } });
		}
		if (typeof result.id === "string") state.sideshowPostId = result.id;
		if (typeof result.sessionId === "string") state.sideshowSessionId = result.sessionId;
		if (Array.isArray(result.userFeedback)) queueSideshowFeedback(result.userFeedback);
		if (!state.sideshowPostId) throw new Error(`Sideshow did not return a post id while ${reason}`);
	};

	const syncReview = async (repo: string, ctx: ExtensionContext, syncOptions: { reload: boolean; reason: string; notify: boolean }): Promise<HunkReviewSnapshot | undefined> => {
		if (syncOptions.reload) {
			const reload = await run(pi, "hunk", ["session", "reload", "--repo", repo, "--", "diff"], repo, 8_000);
			if (reload.code !== 0) throw new Error(commandError(reload));
		}
		const session = await hunkSessionForRepo(pi, repo);
		if (!session) throw new Error(`No active Hunk session is open for ${repo}. Start one with /review start.`);
		const snapshot = await readHunkReview(pi, repo);
		state.active = true;
		state.repo = repo;
		state.hunkSessionId = typeof session.sessionId === "string" ? session.sessionId : snapshot.sessionId;
		try {
			await ensureSideshowRef(repo, state);
			await publishOrUpdateCard(snapshot, syncOptions.reason);
		} catch (error) {
			workingUi(ctx).notify(`Hunk synced, but Sideshow was unavailable: ${error instanceof Error ? error.message : String(error)}`, "warning");
		}
		setReviewStatus(ctx, snapshot, state, options.onStatus);
		if (syncOptions.notify) workingUi(ctx).notify(statusText(snapshot, state), "info");
		return snapshot;
	};

	const enqueueSync = (ctx: ExtensionContext): void => {
		if (!state.active || !state.repo || syncInFlight) return;
		const previousPost = state.sideshowPostId;
		const previousSession = state.sideshowSessionId;
		syncInFlight = syncReview(state.repo, ctx, { reload: false, reason: "agent turn complete", notify: false })
			.then(() => {
				if (state.sideshowPostId !== previousPost || state.sideshowSessionId !== previousSession) persistState(pi, state);
			})
			.catch(() => undefined)
			.finally(() => {
				syncInFlight = undefined;
			});
	};

	pi.on("session_start", async (_event, ctx) => {
		state = restoreState(ctx);
		setReviewStatus(ctx, undefined, state, options.onStatus);
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		ctx.ui.setStatus("review", undefined);
		options.onStatus?.(undefined);
	});

	pi.on("agent_settled", async (_event, ctx) => {
		enqueueSync(ctx);
	});

	pi.registerCommand("review", {
		description: "Coordinate Hunk review and its Sideshow summary: /review start|status|comments|sync|stop",
		handler: async (rawArgs, ctx) => {
			const { action, repo: requestedRepo } = parseReviewArgs(rawArgs);
			const repo = await canonicalRepo(pi, requestedRepo ?? state.repo ?? ".", ctx.cwd);
			try {
				if (action === "start") {
					const existing = await hunkSessionForRepo(pi, repo);
					if (!existing) {
						const launch = await run(pi, "hunk-review-start", [repo], ctx.cwd, 15_000);
						if (launch.code !== 0) throw new Error(commandError(launch));
					}
					const session = await waitForHunkSession(pi, repo);
					if (!session) throw new Error(`Hunk did not expose a session for ${repo}. Run hunk-review-start manually.`);
					state.active = true;
					state.repo = repo;
					state.hunkSessionId = typeof session.sessionId === "string" ? session.sessionId : undefined;
					if (!state.sideshowPostId || !state.sideshowSessionId) {
						try {
							const existingCard = await discoverSideshowReview(repo);
							if (existingCard) {
								state.sideshowSessionId = existingCard.sessionId;
								state.sideshowPostId = existingCard.postId;
							}
						} catch {
							// Sideshow discovery is best-effort; syncReview reports a bounded warning if it is unavailable.
						}
					}
					persistState(pi, state);
					await syncReview(repo, ctx, { reload: false, reason: "review start", notify: true });
					persistState(pi, state);
					return;
				}

				if (action === "status") {
					const session = await hunkSessionForRepo(pi, repo);
					if (!session) {
						workingUi(ctx).notify(`No active Hunk session for ${repo}. Start one with /review start.`, "warning");
						return;
					}
					const snapshot = await readHunkReview(pi, repo);
					try {
						await ensureSideshowRef(repo, state);
					} catch {
						// Status remains useful when Sideshow is unavailable.
					}
					setReviewStatus(ctx, snapshot, state, options.onStatus);
					workingUi(ctx).notify(statusText(snapshot, state), "info");
					return;
				}

				if (action === "comments" || action === "feedback") {
					try {
						await ensureSideshowRef(repo, state);
					} catch {
						// Feedback discovery is best-effort; Hunk comments remain usable alone.
					}
					let hunkComments: ReviewCommentSummary[] = [];
					if (action !== "feedback") {
						const comments = await readHumanComments(pi, repo);
						const seen = new Set(state.importedCommentFingerprints);
					hunkComments = comments.filter((comment) => !seen.has(commentFingerprint(comment)));
					}

					let sideshowFeedback: SideshowFeedback[] = [];
					if (state.sideshowSessionId) {
						try {
							sideshowFeedback = await readSideshowFeedback(state.sideshowSessionId, state.sideshowPostId);
						} catch (error) {
							workingUi(ctx).notify(`Hunk comments are available, but Sideshow feedback could not be read: ${error instanceof Error ? error.message : String(error)}`, "warning");
						}
					}

					if (hunkComments.length === 0 && sideshowFeedback.length === 0) {
						workingUi(ctx).notify("No new Hunk comments or Sideshow feedback.", "info");
						return;
					}

					state.active = true;
					state.repo = repo;
					if (hunkComments.length > 0) {
						state.importedCommentFingerprints = [...state.importedCommentFingerprints, ...hunkComments.map(commentFingerprint)].slice(-REVIEW_COMMENT_LIMIT);
						pi.sendMessage(
							{
								customType: "acidbath-review-comments",
								content: formatCommentHandoff(repo, hunkComments),
								display: true,
								details: { repo, count: hunkComments.length, noteIds: hunkComments.map((comment) => comment.noteId).filter(Boolean) },
							},
							{ deliverAs: "nextTurn", triggerTurn: false },
						);
					}
					if (sideshowFeedback.length > 0) queueSideshowFeedback(sideshowFeedback);
					persistState(pi, state);
					await syncReview(repo, ctx, { reload: false, reason: "comment import", notify: false });
					const totals = [
						hunkComments.length ? `${hunkComments.length} Hunk comment${hunkComments.length === 1 ? "" : "s"}` : "",
						sideshowFeedback.length ? `${sideshowFeedback.length} Sideshow feedback item${sideshowFeedback.length === 1 ? "" : "s"}` : "",
					].filter(Boolean).join(" and ");
					workingUi(ctx).notify(`Queued ${totals} for the next Pi turn.`, "info");
					return;
				}

				if (action === "sync") {
					await syncReview(repo, ctx, { reload: true, reason: "manual sync", notify: true });
					persistState(pi, state);
					return;
				}

				if (action === "stop") {
					state.active = false;
					setReviewStatus(ctx, undefined, state, options.onStatus);
					persistState(pi, state);
					workingUi(ctx).notify(`Stopped Acidbath review tracking for ${repo}. Hunk remains open and user-owned.`, "info");
					return;
				}

				workingUi(ctx).notify("Usage: /review [start|status|comments|feedback|sync|stop] [repo]", "error");
			} catch (error) {
				notifyError(ctx, error);
			}
		},
	});
}
