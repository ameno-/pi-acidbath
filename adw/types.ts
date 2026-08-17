// Phase types
export type PhaseKind = "agent" | "code" | "halt" | "engineer" | "research";

export interface Phase {
  id: string;
  kind: PhaseKind;
  agent?: string;          // for agent phases
  prompt?: string;         // template with {{placeholders}}
  command?: string;        // for code phases
  halt?: boolean;          // stop for human validation
  gates?: string[];        // gate names to run after
  output?: string;         // output schema name; see envelope.ts OUTPUT_SCHEMAS
  submit_mode?: string;    // strict (default) | permissive; see envelope.ts SUBMIT_MODES
}

// Agent definitions
export interface AgentDef {
  name: string;
  model: string;
  thinking?: string;
  tools: string[];
  system_prompts: string[];
  writes?: string[];
}

// Pipeline structure
export interface DipPipeline {
  name: string;
  description: string;
  agents: Record<string, AgentDef>;
  phases: Phase[];
}

// Envelope — the typed handoff between phases
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
   * Set only by a phase that declared an output schema: true when the agent
   * finished without calling submit. The run log reads this rather than
   * pattern-matching the summary, which stopped being reliable the moment
   * permissive mode let a missing submit through as a success.
   */
  submit_missing?: boolean;
  usage?: {
    tokens: number;
    cost: number;
    input_tokens: number;
    output_tokens: number;
  };
}

// Phase-specific output shapes are derived from the TypeBox schemas in
// envelope.ts via `Static<>`, so the schema an agent is validated against and
// the type this code compiles against are the same declaration. They were
// previously hand-written here and drifted immediately: nothing populated
// them, because nothing enforced them.
export type {
  GenericOutput,
  ResearchOutput,
  BrainstormOutput,
  BuildOutput,
  ReviewOutput,
  OutputSchemaName as EnvelopeType,
} from "./envelope.ts";

// Gate types
export interface GateResult {
  name: string;
  passed: boolean;
  violations: string[];
}

export type GateCheck = (envelope: Envelope, phase: Phase) => Promise<GateResult>;

// Progress events (streamed for UI)
export type DipProgressEvent =
  | { type: "dip_start"; name: string; run_id: string }
  | { type: "phase_start"; id: string; kind: PhaseKind; agent?: string }
  | { type: "phase_progress"; id: string; message: string }
  | { type: "phase_end"; id: string; status: string; envelope?: Envelope }
  | { type: "gate_check"; id: string; gate: string; passed: boolean }
  | { type: "halt"; id: string; message: string }
  | { type: "dip_end"; status: string; envelopes: Record<string, Envelope> }
  | { type: "dip_error"; error: string };

// Context passed through the pipeline
export interface DipContext {
  cwd: string;
  agents: Record<string, AgentDef>;
  prompt: string;
  envelopes: Record<string, Envelope>;
  run_id: string;
}

export interface DipResult {
  status: "success" | "fail" | "halted";
  envelopes: Record<string, Envelope>;
  duration_ms: number;
  logs: string[];
}
