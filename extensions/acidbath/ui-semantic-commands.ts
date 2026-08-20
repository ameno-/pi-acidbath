/**
 * Conservative semantic summaries for bash rows that invoke `linear` or `ntn`.
 *
 * Display-only: classification never alters execution, arguments, or output.
 * A command qualifies only when it is a single direct CLI invocation — no
 * pipes, chains, redirections, substitutions, or multiline input. Anything
 * ambiguous returns undefined and the default bash row rendering applies.
 *
 * Pure module: no Pi/TUI imports, no I/O, no timers.
 */

export interface SemanticCommandSummary {
	/** "linear" | "ntn" */
	tool: string;
	/** Short display target, e.g. "linear: issue update MIGHT-473". */
	target: string;
	/** Extra compact metadata derived from argv only, e.g. ["state: In Review"]. */
	metadata: string[];
}

const SUPPORTED_TOOLS = new Set(["linear", "ntn"]);

// Any shell metacharacter disqualifies the command: we only summarize simple,
// direct invocations so the row can never misrepresent a compound pipeline.
const SHELL_OPERATORS = /[|&;<>`$()\\]|\r|\n/;

// Flags whose values are worth surfacing in the compact row. Everything else
// is ignored deliberately; the expanded view keeps the full command + output.
const VALUE_FLAGS = new Set(["--state", "--project", "--team", "--cycle"]);

const MAX_TARGET_LENGTH = 64;
const MAX_FLAG_VALUE_LENGTH = 32;

export function classifySemanticCommand(command: unknown): SemanticCommandSummary | undefined {
	if (typeof command !== "string") return undefined;
	const trimmed = command.trim();
	if (trimmed === "" || SHELL_OPERATORS.test(trimmed)) return undefined;

	const tokens = tokenize(trimmed);
	if (!tokens) return undefined; // unbalanced quote — never guess
	const tool = tokens[0] ?? "";
	if (!SUPPORTED_TOOLS.has(tool)) return undefined;

	// Collect positional args (skip flag values) and whitelisted flag values.
	const positionals: string[] = [];
	const metadata: string[] = [];
	for (let i = 1; i < tokens.length; i++) {
		const token = tokens[i]!;
		if (token.startsWith("--")) {
			const eq = token.indexOf("=");
			const flag = eq === -1 ? token : token.slice(0, eq);
			if (VALUE_FLAGS.has(flag)) {
				const raw = eq === -1 ? tokens[++i] : token.slice(eq + 1);
				const value = cleanValue(raw);
				if (value) metadata.push(`${flag.slice(2)}: ${slice(value, MAX_FLAG_VALUE_LENGTH)}`);
			} else if (eq === -1 && FLAG_TAKES_VALUE.has(flag)) {
				i++; // skip unknown flag values so they are not misread as positionals
			}
			continue;
		}
		if (token.startsWith("-")) continue; // short flags: never consume a value
		positionals.push(token);
	}

	if (positionals.length === 0) return undefined;

	// Keep the subcommand path (up to 2 tokens) plus the first object argument.
	const subcommand = positionals.slice(0, 2).join(" ");
	const objectArg = positionals[2];
	const targetCore = objectArg === undefined ? subcommand : `${subcommand} ${objectArg}`;
	return {
		tool,
		target: slice(`${tool}: ${targetCore}`, MAX_TARGET_LENGTH),
		metadata,
	};
}

// Known flags that consume the next token; used only to avoid misclassifying
// a flag's value as a positional. Not exhaustive — conservative by design.
const FLAG_TAKES_VALUE = new Set([
	"--title", "--description", "--description-file", "--body", "--body-file",
	"--label", "--add-label", "--remove-label", "--assignee", "--priority",
	"--due-date", "--estimate", "--parent", "--milestone", "--initiative",
	"--project", "--team", "--cycle", "--state", "--sort", "--limit",
	"--workspace", "-w", "--method", "-X", "--data", "-d", "--file",
	"--content", "--notion-version", "--start-cursor", "--filter",
	"--filter-file", "--worker-id", "--interval", "--context", "--dotenv",
	"--name", "-n", "--lead", "--member",
]);

function cleanValue(value: string | undefined): string | undefined {
	if (value === undefined) return undefined;
	const unquoted = value.trim();
	return unquoted === "" ? undefined : unquoted;
}

/** Quote-aware tokenizer. Returns undefined on unbalanced quotes. */
function tokenize(input: string): string[] | undefined {
	const tokens: string[] = [];
	let current = "";
	let quote: string | undefined;
	for (const ch of input) {
		if (quote !== undefined) {
			if (ch === quote) quote = undefined;
			else current += ch;
		} else if (ch === '"' || ch === "'") {
			quote = ch;
		} else if (/\s/.test(ch)) {
			if (current !== "") {
				tokens.push(current);
				current = "";
			}
		} else {
			current += ch;
		}
	}
	if (quote !== undefined) return undefined;
	if (current !== "") tokens.push(current);
	return tokens;
}

function slice(value: string, max: number): string {
	return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}
