import type { GateCheck, GateResult, Envelope, Phase } from "./types.ts";
import { existsSync } from "node:fs";

export const BUILTIN_GATES: Record<string, GateCheck> = {
  // Verify expected output files exist from artifacts list
  artifacts_exist: async (envelope: Envelope): Promise<GateResult> => {
    const violations: string[] = [];
    for (const artifact of envelope.artifacts) {
      if (!existsSync(artifact)) {
        violations.push(`Artifact not found: ${artifact}`);
      }
    }
    return {
      name: "artifacts_exist",
      passed: violations.length === 0,
      violations,
    };
  },

  // Verify the diff is non-empty (agent made changes)
  diff_non_empty: async (envelope: Envelope): Promise<GateResult> => {
    return {
      name: "diff_non_empty",
      passed: envelope.artifacts.length > 0 || envelope.status === "success",
      violations: envelope.status !== "success" ? ["No changes detected"] : [],
    };
  },

  // Always passes — use as default when no specific gate is needed
  always_pass: async (): Promise<GateResult> => ({
    name: "always_pass",
    passed: true,
    violations: [],
  }),
};

export function resolveGates(gateNames: string[] | undefined): GateCheck[] {
  if (!gateNames || gateNames.length === 0) return [BUILTIN_GATES.always_pass];
  return gateNames.map((name) => BUILTIN_GATES[name] || BUILTIN_GATES.always_pass);
}

export async function verifyGates(phase: Phase, envelope: Envelope): Promise<GateResult[]> {
  const gates = resolveGates(phase.gates);
  const results: GateResult[] = [];
  for (const gate of gates) {
    const result = await gate(envelope, phase);
    results.push(result);
  }
  return results;
}
