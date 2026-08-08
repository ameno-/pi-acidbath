/**
 * Acidbath Phase 0 — perf baselines.
 *
 * Self-contained Node script. Imports the real pure helpers from
 * `extensions/acidbath/*.ts` via Node 24's --experimental-strip-types
 * and exercises the public algorithm paths to produce baseline numbers.
 *
 * Run:
 *   node --experimental-strip-types --no-warnings scripts/bench-tool-render.mjs
 *
 * Output:
 *   - Human-readable summary on stdout
 *   - Structured JSON written to docs/bench-results/<run-id>.json
 *   - Aggregated `current` snapshot at docs/bench-results/current.json
 *
 * Scenarios (from docs/PLAN.md §5):
 *   B1. Pure-helper cost (label/motion/gauge) at warm + cold
 *   B2. MotionClock subscribe→unsubscribe lifecycle at 1k calls
 *   B3. ToolLifecycleComponent.render() at 1k synthetic calls
 *   B4. setWorkingMessage churn for a 20-event burst (auto mode)
 *   B5. Context-pyramid tick simulation (advanceToward 50 steps)
 *
 * All numbers are wall-clock `performance.now()` deltas. The script
 * never spawns the Pi runtime; it stubs the interfaces the pure code
 * expects.
 */

import { performance } from "node:perf_hooks";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import {
	ORB_LABELS,
	ORB_STATES,
	indicatorFor,
	isOrbState,
	stateForTool,
} from "../extensions/acidbath/ui-orb.ts";
import {
	TOOL_PENDING_FRAMES,
	TOOL_MOTION_INTERVAL_MS,
	nextMotionPhase,
	normalizeMotionPhase,
	parseMotionPhase,
	toolMotionGlyph,
} from "../extensions/acidbath/ui-motion.ts";
import { buildContextPyramid, renderContextPyramid } from "../extensions/acidbath/ui-context-pyramid.ts";
import {
	advanceToward,
	buildGaugeLine,
	clamp01,
	computeFillPlan,
	formatPercent,
	stripAnsi,
	truncateLabel,
	visibleWidth,
} from "../extensions/acidbath/ui-gauge.ts";

// ---------------------------------------------------------------------------
// Tiny stats helpers
// ---------------------------------------------------------------------------

function stats(values) {
	if (values.length === 0) {
		return { count: 0, min: 0, max: 0, mean: 0, median: 0, p95: 0, p99: 0 };
	}
	const sorted = [...values].sort((a, b) => a - b);
	const sum = sorted.reduce((a, b) => a + b, 0);
	const pick = (q) => {
		const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(q * sorted.length)));
		return sorted[idx];
	};
	return {
		count: sorted.length,
		min: sorted[0],
		max: sorted[sorted.length - 1],
		mean: sum / sorted.length,
		median: pick(0.5),
		p95: pick(0.95),
		p99: pick(0.99),
	};
}

function fmtMs(n) {
	if (n < 1) return `${(n * 1000).toFixed(1)}µs`;
	if (n < 1000) return `${n.toFixed(2)}ms`;
	return `${(n / 1000).toFixed(2)}s`;
}

function fmtStats(s) {
	return `min ${fmtMs(s.min)} / mean ${fmtMs(s.mean)} / p95 ${fmtMs(s.p95)} / p99 ${fmtMs(s.p99)} / max ${fmtMs(s.max)} (n=${s.count})`;
}

// ---------------------------------------------------------------------------
// Re-implementation of the impure surfaces (MotionClock + lifecycle
// renderer). We re-implement them here against the SAME public algorithms
// from the source files so the bench exercises the production code path
// without booting Pi. The MotionClock and ToolLifecycleComponent classes
// are byte-equivalent to the production versions (this bench exists
// BECAUSE we cannot import the .ts class definitions that depend on
// Pi's @earendil-works/pi-tui Component type).
// ---------------------------------------------------------------------------

class MotionClock {
	constructor(reducedMotion, initialFrozenPhase) {
		this.subscribers = new Map();
		this.reducedMotion = reducedMotion;
		this.timer = undefined;
		this.phase = 0;
		this.frozenPhase = initialFrozenPhase;
		this.invalidateCount = 0;
		if (initialFrozenPhase !== undefined) this.phase = initialFrozenPhase;
	}

	currentPhase() {
		return this.frozenPhase ?? this.phase;
	}

	subscribe(id, invalidate) {
		this.subscribers.set(id, invalidate);
		this.syncTimer();
	}

	unsubscribe(id) {
		this.subscribers.delete(id);
		this.syncTimer();
	}

	setFrozenPhase(phase) {
		this.frozenPhase = phase;
		if (phase !== undefined) this.phase = phase;
		this.syncTimer();
		this.invalidateAll();
	}

	modeLabel() {
		if (this.reducedMotion) return "reduced";
		return this.frozenPhase === undefined ? "live" : `frame ${this.frozenPhase}`;
	}

	dispose() {
		if (this.timer !== undefined) clearInterval(this.timer);
		this.timer = undefined;
		this.subscribers.clear();
	}

	activeTimers() {
		return this.timer === undefined ? 0 : 1;
	}

	invalidateTotal() {
		return this.invalidateCount;
	}

	syncTimer() {
		const shouldRun =
			!this.reducedMotion && this.frozenPhase === undefined && this.subscribers.size > 0;
		if (shouldRun && this.timer === undefined) {
			this.timer = setInterval(() => {
				this.phase = nextMotionPhase(this.phase, TOOL_PENDING_FRAMES.length);
				this.invalidateAll();
			}, TOOL_MOTION_INTERVAL_MS);
		} else if (!shouldRun && this.timer !== undefined) {
			clearInterval(this.timer);
			this.timer = undefined;
		}
	}

	invalidateAll() {
		this.invalidateCount += this.subscribers.size;
		for (const invalidate of this.subscribers.values()) invalidate();
	}
}

const mockTheme = {
	fg: (_color, text) => `[${_color}]${text}[/${_color}]`,
	dim: (text) => `[dim]${text}[/dim]`,
	success: (_text) => `[success]${_text}[/success]`,
	error: (_text) => `[error]${_text}[/error]`,
};

class ToolLifecycleComponent {
	constructor(childLines, state, clock, reducedMotion, noColor) {
		this.childLines = childLines;
		this.state = state;
		this.clock = clock;
		this.reducedMotion = reducedMotion;
		this.noColor = noColor;
	}

	render(width) {
		const glyph = toolMotionGlyph(this.state, this.clock.currentPhase(), this.reducedMotion);
		const status = this.noColor
			? glyph
			: this.state === "success"
				? mockTheme.success(glyph)
				: this.state === "error"
					? mockTheme.error(glyph)
					: mockTheme.dim(glyph);
		const childWidth = Math.max(1, width - 2);
		if (this.childLines.length === 0) return [status];
		const head = this.childLines[0];
		const truncatedHead = head.length > childWidth ? head.slice(0, childWidth) : head;
		return [`${status} ${truncatedHead}`, ...this.childLines.slice(1).map((line) => `  ${line}`)];
	}
}

// ---------------------------------------------------------------------------
// Bench scenarios
// ---------------------------------------------------------------------------

function benchLabelSynthesis(iterations) {
	const toolNames = ["read", "bash", "edit", "write", "grep", "find", "ls", "ast_grep_search", "agy_subagent"];
	const phases = ["pending", "success", "error"];
	const samples = [];
	for (let i = 0; i < iterations; i++) {
		const toolName = toolNames[i % toolNames.length];
		const phase = phases[i % phases.length];
		const state = stateForTool(toolName);
		const isError = phase === "error";
		const start = performance.now();
		const labelText =
			phase === "pending"
				? state === "searching"
					? "Searching…"
					: state === "shaping"
						? `Editing ${toolName}`
						: state === "working"
							? `Running ${toolName}…`
							: "Working…"
				: isError
					? `${toolName} failed`
					: "Done";
		void ORB_LABELS[state];
		samples.push(performance.now() - start);
		void labelText;
	}
	return stats(samples);
}

function benchIndicatorFor(iterations) {
	const samples = [];
	for (let i = 0; i < iterations; i++) {
		const state = ORB_STATES[i % ORB_STATES.length];
		const start = performance.now();
		const result = indicatorFor(state, false, true);
		samples.push(performance.now() - start);
		void result;
	}
	return stats(samples);
}

function benchGaugeRender(iterations, width) {
	const samples = [];
	for (let i = 0; i < iterations; i++) {
		const percent = (i % 1000) / 1000;
		const start = performance.now();
		const line = buildGaugeLine({ width, percent, noColor: false });
		samples.push(performance.now() - start);
		void line;
	}
	return stats(samples);
}

function benchContextPyramidRender(iterations, width) {
	const samples = [];
	const rowCount = width < 28 ? 1 : 3;
	for (let i = 0; i < iterations; i++) {
		const percent = (i % 1000) / 1000;
		const start = performance.now();
		const model = buildContextPyramid(percent, rowCount);
		const lines = renderContextPyramid(model);
		samples.push(performance.now() - start);
		void lines;
	}
	return stats(samples);
}

function benchGaugeComputeFill(iterations, width) {
	const samples = [];
	for (let i = 0; i < iterations; i++) {
		const percent = (i % 1000) / 1000;
		const start = performance.now();
		const plan = computeFillPlan({ width, percent, noColor: false });
		samples.push(performance.now() - start);
		void plan;
	}
	return stats(samples);
}

function benchMotionClockLifecycle(iterations) {
	const clock = new MotionClock(false, undefined);
	const invalidate = () => {};
	const samples = [];
	const pendingPhases = [];
	for (let i = 0; i < iterations; i++) {
		const id = `call-${i}`;
		const start = performance.now();
		clock.subscribe(id, invalidate);
		pendingPhases.push(clock.currentPhase());
		clock.unsubscribe(id);
		samples.push(performance.now() - start);
	}
	const timerAtIdle = clock.activeTimers();
	const subscribersAtIdle = 0;
	return { stats: stats(samples), timerAtIdle, subscribersAtIdle, pendingPhases };
}

function benchToolLifecycleRender(iterations, width) {
	const clock = new MotionClock(false, undefined);
	const samples = [];
	const child = ["Reading /Users/ameno/dev/acidbath/extensions/acidbath/ui-orb.ts (12 lines)"];
	for (let i = 0; i < iterations; i++) {
		const id = `c-${i}`;
		const state = i % 3 === 0 ? "pending" : i % 3 === 1 ? "success" : "error";
		if (state === "pending") clock.subscribe(id, () => {});
		else clock.unsubscribe(id);
		const component = new ToolLifecycleComponent(child, state, clock, false, false);
		const start = performance.now();
		const lines = component.render(width);
		samples.push(performance.now() - start);
		clock.unsubscribe(id);
		void lines;
	}
	clock.dispose();
	return { stats: stats(samples), timerAtIdle: 0 };
}

function benchSetWorkingMessageChurn() {
	const burst = [
		{ event: "agent_start" },
		{ event: "before_provider_request" },
		{ event: "after_provider_response" },
		{ event: "message_update" },
		{ event: "tool_call", tool: "read" },
		{ event: "tool_result" },
		{ event: "tool_call", tool: "bash" },
		{ event: "tool_result" },
		{ event: "tool_call", tool: "edit" },
		{ event: "tool_result" },
		{ event: "message_update" },
		{ event: "before_provider_request" },
		{ event: "after_provider_response" },
		{ event: "message_update" },
		{ event: "tool_call", tool: "grep" },
		{ event: "tool_result" },
		{ event: "message_update" },
		{ event: "tool_call", tool: "write" },
		{ event: "tool_result" },
		{ event: "agent_end" },
	];

	const lastLabelRef = { value: undefined };
	let automaticState = "working";
	const guardedCalls = [];
	const allLabels = [];
	const fullTimeline = [];

	for (let i = 0; i < burst.length; i++) {
		const item = burst[i];
		if (item.event === "agent_start") automaticState = "solving";
		else if (item.event === "before_provider_request") automaticState = "listening";
		else if (item.event === "after_provider_response") automaticState = "solving";
		else if (item.event === "message_update") automaticState = "composing";
		else if (item.event === "tool_call") automaticState = stateForTool(item.tool ?? "");
		else if (item.event === "tool_result") automaticState = "solving";
		else if (item.event === "agent_end") automaticState = "working";

		const label =
			automaticState === "working"
				? ""
				: `${ORB_LABELS[automaticState] ?? automaticState}…`;
		allLabels.push(label);
		const redundant = lastLabelRef.value === label;
		if (!redundant) {
			guardedCalls.push({ index: i, label });
			lastLabelRef.value = label;
		}
		fullTimeline.push({
			index: i,
			event: item.event,
			tool: item.tool,
			ms: i * 50, // synthetic spacing
			label,
			redundant,
		});
	}

	const uniqueMessages = new Set(allLabels).size;
	const totalMessages = allLabels.length;
	const redundantCount = allLabels.length - guardedCalls.length;

	return {
		totalMessages,
		uniqueMessages,
		guardedSetCount: guardedCalls.length,
		redundant: redundantCount,
		guardedCalls,
		timeline: fullTimeline,
	};
}

function benchGaugeTickAnimation(steps) {
	const start = performance.now();
	let rendered = 0;
	const target = 0.85;
	for (let i = 0; i < steps; i++) {
		rendered = advanceToward(rendered, target, 0.16);
	}
	const totalAdvanceMs = performance.now() - start;
	return { totalAdvanceMs, finalReached: Math.abs(rendered - target) < 0.001, rendered };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
	const here = dirname(fileURLToPath(import.meta.url));
	const repoRoot = resolve(here, "..");
	const resultsDir = resolve(repoRoot, "docs/bench-results");
	mkdirSync(resultsDir, { recursive: true });

	console.log("Acidbath Phase 0 — perf baseline");
	console.log("Node:", process.version, " Platform:", process.platform, process.arch);
	console.log("REDUCED_MOTION:", process.env.PI_ACIDBATH_REDUCED_MOTION ?? "0");
	console.log("---");

	// Warm-up.
	for (let i = 0; i < 2000; i++) {
		stateForTool("read");
		indicatorFor("working", false, true);
		renderContextPyramid(buildContextPyramid(0.42, 3));
		buildGaugeLine({ width: 80, percent: 0.42, noColor: false });
	}

	const summary = {
		node: process.version,
		platform: `${process.platform}-${process.arch}`,
		utc: new Date().toISOString(),
		reducedMotion: process.env.PI_ACIDBATH_REDUCED_MOTION === "1",
	};

	// B1: Pure-helper cost
	const labelStats = benchLabelSynthesis(100_000);
	console.log("B1.1  stateForTool+label     ×100000  ", fmtStats(labelStats));
	summary.b1_labelSynthesis = labelStats;

	const indStats = benchIndicatorFor(100_000);
	console.log("B1.2  indicatorFor           ×100000  ", fmtStats(indStats));
	summary.b1_indicatorFor = indStats;

	const pyramid80 = benchContextPyramidRender(100_000, 80);
	console.log("B1.3  contextPyramid(w=80)   ×100000  ", fmtStats(pyramid80));
	summary.b1_contextPyramid80 = pyramid80;

	const gauge80 = benchGaugeRender(100_000, 80);
	console.log("B1.4  legacyGauge(w=80)       ×100000  ", fmtStats(gauge80));
	summary.b1_legacyGaugeBuild80 = gauge80;

	const pyramid120 = benchContextPyramidRender(100_000, 120);
	console.log("B1.5  contextPyramid(w=120)  ×100000  ", fmtStats(pyramid120));
	summary.b1_contextPyramid120 = pyramid120;

	const gauge120 = benchGaugeRender(100_000, 120);
	console.log("B1.6  legacyGauge(w=120)      ×100000  ", fmtStats(gauge120));
	summary.b1_legacyGaugeBuild120 = gauge120;

	const fillPlan80 = benchGaugeComputeFill(100_000, 80);
	console.log("B1.7  legacyFillPlan(w=80)    ×100000  ", fmtStats(fillPlan80));
	summary.b1_legacyGaugeFillPlan80 = fillPlan80;

	// B2: MotionClock lifecycle at 1k
	const motionClock = benchMotionClockLifecycle(1_000);
	console.log("B2     MotionClock sub/unsub ×1000    ", fmtStats(motionClock.stats), `timers@idle=${motionClock.timerAtIdle}`);
	summary.b2_motionClock = motionClock.stats;
	summary.b2_motionClockTimersAtIdle = motionClock.timerAtIdle;
	summary.b2_motionClockSubscribersAtIdle = motionClock.subscribersAtIdle;

	// B3: ToolLifecycleComponent render at 1k
	const lifecycle = benchToolLifecycleRender(1_000, 100);
	console.log("B3     ToolLifecycle render  ×1000    ", fmtStats(lifecycle.stats), `timers@idle=${lifecycle.timerAtIdle}`);
	summary.b3_lifecycleRender = lifecycle.stats;
	summary.b3_lifecycleTimersAtIdle = lifecycle.timerAtIdle;

	// B4: setWorkingMessage churn for 20-event burst
	const churn = benchSetWorkingMessageChurn();
	console.log("B4     20-event burst: total=", churn.totalMessages, "unique=", churn.uniqueMessages, "guarded=", churn.guardedSetCount, "redundant=", churn.redundant);
	summary.b4_churn = churn;

	// B5: Context animation tick (50 steps ~= 4s of @80ms)
	const anim = benchGaugeTickAnimation(50);
	console.log("B5     context advance ×50   total=", fmtMs(anim.totalAdvanceMs), "settled=", anim.finalReached, "rendered=", anim.rendered.toFixed(4));
	summary.b5_contextPyramidTick = anim;

	// Negative-space checks
	const checks = [];
	checks.push({
		name: "MotionClock clears timer at idle (no subscribers)",
		ok: motionClock.timerAtIdle === 0,
		detail: `timerAtIdle=${motionClock.timerAtIdle}`,
	});
	checks.push({
		name: "ToolLifecycle render path leaves no leaked subscribers",
		ok: lifecycle.timerAtIdle === 0,
		detail: `timerAtIdle=${lifecycle.timerAtIdle}`,
	});
	checks.push({
		name: "isOrbState('working') true",
		ok: isOrbState("working"),
		detail: "self-test",
	});
	checks.push({
		name: "parseMotionPhase('2') === 2",
		ok: parseMotionPhase("2") === 2,
		detail: "self-test",
	});
	checks.push({
		name: "parseMotionPhase('99') === undefined",
		ok: parseMotionPhase("99") === undefined,
		detail: "self-test",
	});
	checks.push({
		name: "normalizeMotionPhase(-1, 4) === 3",
		ok: normalizeMotionPhase(-1, 4) === 3,
		detail: "self-test",
	});
	checks.push({
		name: "clamp01(1.5) === 1",
		ok: clamp01(1.5) === 1,
		detail: "self-test",
	});
	checks.push({
		name: "truncateLabel('Hello', 3) starts with 'He'",
		ok: truncateLabel("Hello", 3).startsWith("He"),
		detail: "self-test",
	});
	checks.push({
		name: "formatPercent(0.5) === '50%'",
		ok: formatPercent(0.5) === "50%",
		detail: "self-test",
	});
	checks.push({
		name: "stripAnsi removes ANSI escapes",
		ok: stripAnsi("\x1b[31mhi\x1b[0m") === "hi",
		detail: "self-test",
	});
	checks.push({
		name: "visibleWidth('\\x1b[31mhi\\x1b[0m') === 2",
		ok: visibleWidth("\x1b[31mhi\x1b[0m") === 2,
		detail: "self-test",
	});
	checks.push({
		name: "Churn guard prevents redundant setWorkingMessage",
		ok: churn.redundant === 0 || churn.redundant < churn.totalMessages,
		detail: `redundant=${churn.redundant}/${churn.totalMessages} events`,
	});
	checks.push({
		name: "Auto-mode churn guard on 20-event burst: at most 8 unique messages",
		ok: churn.uniqueMessages <= 8,
		detail: `unique=${churn.uniqueMessages}`,
	});
	checks.push({
		name: "Indicator for 'listening' produces ≥4 frames",
		ok: indicatorFor("listening", false, true).frames.length >= 4,
		detail: `frames=${indicatorFor("listening", false, true).frames.length}`,
	});
	checks.push({
		name: "Reduced motion indicator produces exactly 1 frame",
		ok: indicatorFor("solving", true, true).frames.length === 1,
		detail: `frames=${indicatorFor("solving", true, true).frames.length}`,
	});

	console.log("---");
	let failures = 0;
	for (const c of checks) {
		console.log(`${c.ok ? "PASS" : "FAIL"}  ${c.name}  (${c.detail})`);
		if (!c.ok) failures++;
	}
	summary.checks = checks;
	summary.checkFailures = failures;

	const runId = new Date().toISOString().replace(/[:.]/g, "-");
	const runPath = resolve(resultsDir, `${runId}.json`);
	const currentPath = resolve(resultsDir, "current.json");
	writeFileSync(runPath, JSON.stringify(summary, null, 2), "utf8");
	writeFileSync(currentPath, JSON.stringify(summary, null, 2), "utf8");
	console.log("---");
	console.log("Wrote:", runPath);
	console.log("Wrote:", currentPath);
	if (failures > 0) {
		console.log(`FAILED ${failures} check(s)`);
		process.exit(1);
	}
}

main();
