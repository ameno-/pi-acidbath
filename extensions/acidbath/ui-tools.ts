/** Built-in tool wrappers with static compact rows and native expanded details. */

import {
	createBashToolDefinition,
	createEditToolDefinition,
	createFindToolDefinition,
	createGrepToolDefinition,
	createLsToolDefinition,
	createReadToolDefinition,
	createWriteToolDefinition,
	type ExtensionAPI,
	type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { createCompactToolRenderers } from "./ui-tool-renderers.js";

function registerWrappedTool<TParams extends ToolDefinition["parameters"], TDetails, TState>(
	pi: ExtensionAPI,
	factory: (cwd: string) => ToolDefinition<TParams, TDetails, TState>,
	noColor: boolean,
	reducedMotion: boolean,
): void {
	const definition = factory(process.cwd());
	const presentation = createCompactToolRenderers(definition, factory, { noColor, reducedMotion });
	pi.registerTool({
		...definition,
		...presentation,
		async execute(toolCallId, params, signal, onUpdate, ctx) {
			return factory(ctx.cwd).execute(toolCallId, params, signal, onUpdate, ctx);
		},
	});
}

/** Install one static transcript policy for Acidbath-owned built-ins. */
export function registerToolRenderers(
	pi: ExtensionAPI,
	options: { noColor: boolean; reducedMotion: boolean },
): void {
	registerWrappedTool(pi, createReadToolDefinition, options.noColor, options.reducedMotion);
	registerWrappedTool(pi, createBashToolDefinition, options.noColor, options.reducedMotion);
	registerWrappedTool(pi, createEditToolDefinition, options.noColor, options.reducedMotion);
	registerWrappedTool(pi, createWriteToolDefinition, options.noColor, options.reducedMotion);
	registerWrappedTool(pi, createGrepToolDefinition, options.noColor, options.reducedMotion);
	registerWrappedTool(pi, createFindToolDefinition, options.noColor, options.reducedMotion);
	registerWrappedTool(pi, createLsToolDefinition, options.noColor, options.reducedMotion);
}
