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
