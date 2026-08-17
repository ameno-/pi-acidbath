/**
 * adw/envelope.ts — typed phase outputs.
 *
 * A phase's output contract is a TypeBox schema. When a phase declares one,
 * the agent is handed exactly one extra tool — `submit` — whose parameters
 * *are* that schema. The phase does not complete until `submit` is called,
 * so the handoff between phases has a known shape instead of a wall of prose.
 *
 * This needs no new dependency and no structured-output API. Pi already
 * converts TypeBox tool parameters to JSON Schema for the provider
 * (see pi-mono packages/ai/src/providers/anthropic.ts), which means
 * validation happens at the tool-call layer and the model retries itself
 * on a mismatch.
 *
 * The TypeScript types below are derived from the schemas with `Static<>`,
 * never hand-written alongside them, so the two cannot drift apart.
 */

import { Type, type Static, type TSchema } from "typebox";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";

// ─── Base fields ─────────────────────────────────────────────────────────────

/**
 * Present on every phase output. `artifacts` is load-bearing: the
 * `artifacts_exist` and `diff_non_empty` gates read it directly.
 */
const BASE_FIELDS = {
  status: Type.Union([Type.Literal("success"), Type.Literal("fail")], {
    description: "success if this phase met its objective, otherwise fail.",
  }),
  summary: Type.String({
    maxLength: 600,
    description:
      "What you did and what you concluded, under 600 characters. " +
      "Prose belongs here and nowhere else.",
  }),
  artifacts: Type.Array(Type.String(), {
    description:
      "File paths or URLs a later phase or gate can check. Empty array if none.",
  }),
  notes_for_next_agent: Type.String({
    description:
      "What the next phase needs that is not obvious from the summary. " +
      "Empty string if nothing.",
  }),
};

// ─── Per-phase schemas ───────────────────────────────────────────────────────

export const GENERIC_OUTPUT = Type.Object({ ...BASE_FIELDS });

export const RESEARCH_OUTPUT = Type.Object({
  ...BASE_FIELDS,
  findings: Type.Array(
    Type.Object({
      claim: Type.String({ description: "A single factual claim." }),
      source_url: Type.String({ description: "The URL this claim came from." }),
      confidence: Type.Union(
        [Type.Literal("high"), Type.Literal("medium"), Type.Literal("low")],
        { description: "How well the source supports the claim." },
      ),
    }),
    {
      description:
        "Sourced claims, one entry per claim. Never merge two claims into one entry.",
    },
  ),
  gaps: Type.Array(Type.String(), {
    description: "Questions this research did not answer. Empty array if none.",
  }),
});

export const BRAINSTORM_OUTPUT = Type.Object({
  ...BASE_FIELDS,
  options: Type.Array(
    Type.Object({
      approach: Type.String({ description: "The approach, in one or two sentences." }),
      tradeoff: Type.String({ description: "What this approach gives up." }),
      risk: Type.String({ description: "The most likely way this approach fails." }),
    }),
    {
      minItems: 2,
      maxItems: 4,
      description:
        "Two to four genuinely distinct approaches. Do not pad with variations of one idea.",
    },
  ),
  recommended: Type.Integer({
    minimum: 0,
    description: "Zero-based index into options: the one you would pick.",
  }),
});

export const BUILD_OUTPUT = Type.Object({
  ...BASE_FIELDS,
  changed_files: Type.Array(Type.String(), {
    description: "Every file this phase created or modified, as a repo-relative path.",
  }),
  checks_run: Type.Array(Type.String(), {
    description:
      "Commands actually executed to verify the change, verbatim. " +
      "Empty array if none were run — do not claim checks you did not run.",
  }),
  commit_message: Type.Optional(
    Type.String({ description: "A conventional-commit subject line for this change." }),
  ),
});

export const REVIEW_OUTPUT = Type.Object({
  ...BASE_FIELDS,
  verdict: Type.Union([Type.Literal("pass"), Type.Literal("block")], {
    description: "block if any blocking finding exists, otherwise pass.",
  }),
  blocking: Type.Array(
    Type.Object({
      file: Type.String({ description: "Repo-relative path." }),
      line: Type.Integer({ description: "1-indexed line the finding anchors to." }),
      why: Type.String({ description: "The defect, in one sentence." }),
    }),
    {
      description:
        "Findings that must be fixed before this ships. Empty array when the verdict is pass.",
    },
  ),
});

// ─── Registry ────────────────────────────────────────────────────────────────

export const OUTPUT_SCHEMAS = {
  generic: GENERIC_OUTPUT,
  research: RESEARCH_OUTPUT,
  brainstorm: BRAINSTORM_OUTPUT,
  build: BUILD_OUTPUT,
  review: REVIEW_OUTPUT,
} as const;

export type OutputSchemaName = keyof typeof OUTPUT_SCHEMAS;

export const OUTPUT_SCHEMA_NAMES = Object.keys(OUTPUT_SCHEMAS) as OutputSchemaName[];

/**
 * Resolve a schema by name. Returns undefined for an absent name so a phase
 * without an `output` declaration keeps the free-text path; throws on an
 * unknown name so a typo in a `.dip` file fails loudly instead of silently
 * downgrading that phase to unstructured output.
 */
export function resolveOutputSchema(name: string | undefined): TSchema | undefined {
  if (name === undefined) return undefined;
  const schema = OUTPUT_SCHEMAS[name as OutputSchemaName];
  if (!schema) {
    throw new Error(
      `Unknown output schema: ${name}. Known schemas: ${OUTPUT_SCHEMA_NAMES.join(", ")}`,
    );
  }
  return schema;
}

// Derived types — never hand-write these alongside the schemas.
export type GenericOutput = Static<typeof GENERIC_OUTPUT>;
export type ResearchOutput = Static<typeof RESEARCH_OUTPUT>;
export type BrainstormOutput = Static<typeof BRAINSTORM_OUTPUT>;
export type BuildOutput = Static<typeof BUILD_OUTPUT>;
export type ReviewOutput = Static<typeof REVIEW_OUTPUT>;

// ─── The submit tool ─────────────────────────────────────────────────────────

/**
 * Replaces the prose handoff when a phase declares an output schema. The two
 * are mutually exclusive on purpose: asking for a prose report *and* a
 * structured submission gets you both, which defeats the point.
 */
export const SUBMIT_INSTRUCTION = `
Call the \`submit\` tool exactly once, as your final action. The phase does not
complete until you do. Put your prose in submit's \`summary\` field rather than
in a message, and do not restate the submitted content afterwards.
`.trim();

// ─── Submit modes ────────────────────────────────────────────────────────────

/**
 * What a phase does when its agent finishes without calling `submit`.
 *
 * `strict` fails the phase — the default, because a declared schema that no
 * one honoured is a broken handoff and the next phase would consume prose it
 * was not written for. `permissive` accepts the final assistant message as an
 * unstructured summary, flagged as such. Ported from oh-my-pi's `yield`
 * (MIT © Mario Zechner and Can Bölük), which is the only part of its recovery
 * machinery the run log currently justifies: five runs, zero contract refusals.
 */
export type SubmitMode = "strict" | "permissive";

export const SUBMIT_MODES: SubmitMode[] = ["strict", "permissive"];

/**
 * Resolve a `submit_mode:` value. Absent means strict; an unrecognized value
 * throws, so `permisive` fails the phase it was written on instead of quietly
 * granting the opposite of what it asked for.
 */
export function resolveSubmitMode(value: string | undefined): SubmitMode {
  if (value === undefined) return "strict";
  if ((SUBMIT_MODES as string[]).includes(value)) return value as SubmitMode;
  throw new Error(`Unknown submit_mode: ${value}. Known modes: ${SUBMIT_MODES.join(", ")}`);
}

/** Mutable sink the submit tool writes into. One per dispatch. */
export interface SubmitCapture {
  /** The validated arguments, or undefined if submit was never called. */
  value?: Record<string, unknown>;
}

/**
 * Build the `submit` tool for a phase. Pi validates the arguments against
 * `schema` before `execute` runs, so anything reaching `capture` already
 * conforms — there is no second validation pass to keep in sync here.
 */
export function createSubmitTool(schema: TSchema, capture: SubmitCapture): ToolDefinition {
  return {
    name: "submit",
    label: "Submit",
    description:
      "Submit the final, structured result for this phase. Call exactly once, " +
      "as your last action. The phase does not complete until you do.",
    promptSnippet: "submit — record this phase's final, structured result",
    promptGuidelines: [
      "You MUST call submit exactly once before finishing.",
      "Do not restate submitted content as prose afterwards.",
    ],
    parameters: schema,
    async execute(_toolCallId: string, params: Record<string, unknown>) {
      capture.value = params;
      return {
        content: [{ type: "text", text: "Recorded." }],
        details: undefined,
      };
    },
  } as unknown as ToolDefinition;
}
