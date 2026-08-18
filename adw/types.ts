/**
 * The envelope — the one contract everything shares.
 *
 * Phase-specific shapes are derived from the TypeBox schemas in envelope.ts via
 * `Static<>`, so the schema an agent is validated against and the type this code
 * compiles against are the same declaration. They were hand-written here once
 * and drifted immediately, because nothing enforced them.
 */

export interface AgentDef {
  name: string;
  model: string;
  thinking?: string;
  tools: string[];
  system_prompts: string[];
}

export interface Envelope {
  status: "success" | "fail";
  summary: string;
  artifacts: string[];
  notes_for_next_agent: string;
  agent_name?: string;
  phase_id?: string;
  model_used?: string;
  duration_ms?: number;
  /**
   * Set only by a dispatch that declared a schema: true when the agent finished
   * without calling submit. The run log reads this rather than pattern-matching
   * the summary, which stopped being reliable the moment permissive mode let a
   * missing submit through as a success.
   */
  submit_missing?: boolean;
  usage?: {
    tokens: number;
    cost: number;
    input_tokens: number;
    output_tokens: number;
  };
}

export type {
  GenericOutput,
  ResearchOutput,
  BrainstormOutput,
  BuildOutput,
  ReviewOutput,
  OutputSchemaName as EnvelopeType,
} from "./envelope.ts";
