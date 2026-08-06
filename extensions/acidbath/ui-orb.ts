/** Semantic working-indicator states for Pi UI Enhancements. */

import type { WorkingIndicatorOptions } from "@earendil-works/pi-coding-agent";

export type OrbState = "working" | "searching" | "solving" | "listening" | "composing" | "shaping";
export type OrbMode = OrbState | "auto" | "off" | "default";

export const ORB_STATES: OrbState[] = ["working", "searching", "solving", "listening", "composing", "shaping"];

const ORB_FRAMES: Record<OrbState, string[]> = {
	working: ["⠁⠈⠀", "⠀⠂⠐", "⠀⠄⠠", "⠀⡀⢀", "⠠⠄⠀", "⠐⠂⠀", "⠈⠁⠀"],
	searching: ["⡏⠉⢹", "⡇⠒⢸", "⡇⠤⢸", "⣇⣀⣸", "⡇⠤⢸", "⡇⠒⢸"],
	solving: ["⠮⠭⠵", "⠵⠮⠭", "⠭⠵⠮", "⠶⠶⠶", "⠿⠿⠿", "⠶⠶⠶"],
	listening: ["⡀⢀⠀", "⡄⢠⠀", "⡆⢰⠀", "⡇⢸⠀", "⡆⢰⠀", "⡄⢠⠀"],
	composing: ["⠤⠒⠉", "⠒⠉⠒", "⠉⠒⠤", "⠒⠤⣀", "⠤⣀⠤", "⣀⠤⠒"],
	shaping: ["⢎⡱⠀", "⢇⡸⠀", "⣇⣸⠀", "⣏⣹⠀", "⣇⣸⠀", "⢇⡸⠀"],
};

const ORB_INTERVALS: Record<OrbState, number> = {
	working: 110,
	searching: 95,
	solving: 105,
	listening: 130,
	composing: 100,
	shaping: 120,
};

export const ORB_LABELS: Record<OrbState, string> = {
	working: "Working",
	searching: "Searching",
	solving: "Solving",
	listening: "Listening",
	composing: "Composing",
	shaping: "Shaping",
};

const ORB_COLOR = "\x1b[38;2;181;190;178m";
const RESET_FOREGROUND = "\x1b[39m";

export function indicatorFor(state: OrbState, reducedMotion: boolean, colorEnabled: boolean): WorkingIndicatorOptions {
	const frames = reducedMotion ? [ORB_FRAMES[state][0]!] : ORB_FRAMES[state];
	return {
		frames: frames.map((frame) => (colorEnabled ? `${ORB_COLOR}${frame}${RESET_FOREGROUND}` : frame)),
		intervalMs: ORB_INTERVALS[state],
	};
}

export function isOrbState(value: string): value is OrbState {
	return ORB_STATES.includes(value as OrbState);
}

export function stateForTool(toolName: string): OrbState {
	if (["read", "grep", "find", "ls", "search", "web_search"].includes(toolName)) return "searching";
	if (["edit", "write", "apply_patch"].includes(toolName)) return "shaping";
	return "working";
}
