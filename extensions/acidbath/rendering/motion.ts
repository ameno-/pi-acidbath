/**
 * One shared clock for pending kaomoji animation.
 *
 * - One setInterval while at least one pending tool exists.
 * - Subscribers are invalidate() callbacks from ToolRowComponent.
 * - Each tick advances the shared frame counter.
 * - Zero idle timers: timer is cleared when subscriber count reaches 0.
 */

type InvalidateFn = () => void;

const TICK_MS = 800;
let frame = 0;
let timer: ReturnType<typeof setInterval> | null = null;
const subscribers = new Map<string, InvalidateFn>();

/** Subscribe an invalidate callback keyed by toolCallId. Returns unsubscribe. */
export function subscribe(toolCallId: string, invalidate: InvalidateFn): () => void {
  subscribers.set(toolCallId, invalidate);
  if (!timer) timer = setInterval(tick, TICK_MS);
  return () => {
    subscribers.delete(toolCallId);
    if (subscribers.size === 0) stop();
  };
}

function tick(): void {
  frame++;
  for (const invalidate of subscribers.values()) {
    try { invalidate(); } catch { /* guard against disposed components */ }
  }
}

function stop(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

/** Current animation frame counter (monotonically increasing). */
export function currentFrame(): number {
  return frame;
}

/** Reset frame counter (e.g. on session start). */
export function reset(): void {
  frame = 0;
}

/** Number of active pending subscribers. */
export function subscriberCount(): number {
  return subscribers.size;
}

/** Clean up all subscribers and stop the timer. */
export function dispose(): void {
  subscribers.clear();
  stop();
}
