/**
 * clef — test helpers shared by the extension's test scripts.
 *
 * A fake ExtensionAPI that records what the extension registers: enough to
 * prove the extension is inert when it is off, and to drive its hooks and
 * its `/clef` command.
 */

export function fakePi() {
	const registered = { events: {}, tools: [], commands: [] };
	return {
		registered,
		on(event, handler) {
			registered.events[event] = handler;
			return () => {};
		},
		registerTool(tool) {
			registered.tools.push(tool);
		},
		registerCommand(name, options) {
			registered.commands.push({ name, options });
		},
	};
}

/** Run `fn` with the given environment variables set, then put it back. */
export async function withEnv(env, fn) {
	const saved = {};
	for (const key of Object.keys(env)) saved[key] = process.env[key];
	try {
		for (const [key, value] of Object.entries(env)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
		return await fn();
	} finally {
		for (const [key, value] of Object.entries(saved)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	}
}

/** Escape a string for use inside a RegExp. */
export function escapeRegExp(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
