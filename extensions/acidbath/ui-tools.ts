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
): void {
	const definition = factory(process.cwd());
	const presentation = createCompactToolRenderers(definition, factory, { noColor });
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
	options: { noColor: boolean },
): void {
	registerWrappedTool(pi, createReadToolDefinition, options.noColor);
	registerWrappedTool(pi, createBashToolDefinition, options.noColor);
	registerWrappedTool(pi, createEditToolDefinition, options.noColor);
	registerWrappedTool(pi, createWriteToolDefinition, options.noColor);
	registerWrappedTool(pi, createGrepToolDefinition, options.noColor);
	registerWrappedTool(pi, createFindToolDefinition, options.noColor);
	registerWrappedTool(pi, createLsToolDefinition, options.noColor);
}
