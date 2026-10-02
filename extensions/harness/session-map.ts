/**
 * Acidbath harness — map opaque session entries onto pure handoff/recap
 * source shapes. No Pi imports.
 */

import type { RecapSourceEntry } from "./recap.ts";
import type { SessionLikeEntry } from "./handoff.ts";

export type RawSessionEntry = {
	type: string;
	id?: string;
	message?: unknown;
	summary?: unknown;
	customType?: unknown;
	data?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function extractMessageText(message: unknown): { role: "user" | "assistant"; text: string } | undefined {
	if (!isRecord(message)) return undefined;
	const role = message.role;
	if (role !== "user" && role !== "assistant") return undefined;
	const content = message.content;
	if (typeof content === "string") return { role, text: content };
	if (!Array.isArray(content)) return { role, text: "" };
	const parts: string[] = [];
	for (const part of content) {
		if (!isRecord(part)) continue;
		if (part.type === "text" && typeof part.text === "string") parts.push(part.text);
	}
	return { role, text: parts.join("\n") };
}

export function mapToHandoffEntries(entries: readonly RawSessionEntry[]): SessionLikeEntry[] {
	const out: SessionLikeEntry[] = [];
	for (const entry of entries) {
		if (entry.type === "compaction" && typeof entry.summary === "string") {
			out.push({ type: "compaction", summary: entry.summary });
			continue;
		}
		if (entry.type === "message") {
			const mapped = extractMessageText(entry.message);
			if (mapped) out.push({ type: "message", role: mapped.role, text: mapped.text });
			else out.push({ type: "other" });
			continue;
		}
		out.push({ type: "other" });
	}
	return out;
}

export function mapMessagesToHandoffEntries(messages: readonly unknown[]): SessionLikeEntry[] {
	const out: SessionLikeEntry[] = [];
	for (const message of messages) {
		const mapped = extractMessageText(message);
		if (mapped) out.push({ type: "message", role: mapped.role, text: mapped.text });
		else out.push({ type: "other" });
	}
	return out;
}

export function mapToRecapEntries(entries: readonly RawSessionEntry[]): RecapSourceEntry[] {
	const out: RecapSourceEntry[] = [];
	for (const entry of entries) {
		if (entry.type === "compaction" && typeof entry.summary === "string") {
			out.push({ type: "compaction", summary: entry.summary });
			continue;
		}
		if (entry.type === "message") {
			const mapped = extractMessageText(entry.message);
			if (mapped) out.push({ type: "message", role: mapped.role, text: mapped.text });
			continue;
		}
		if (entry.type === "custom" && typeof entry.customType === "string") {
			out.push({ type: "custom", customType: entry.customType, data: entry.data });
		}
	}
	return out;
}

export function assistantTextFromComplete(content: unknown): string {
	if (!Array.isArray(content)) return "";
	const parts: string[] = [];
	for (const part of content) {
		if (!isRecord(part)) continue;
		if (part.type === "text" && typeof part.text === "string") parts.push(part.text);
	}
	return parts.join("\n");
}
