import type { GranolaGate, GranolaGateResult } from "../../core/ports.js";

/**
 * No-op Granola gate — always returns shouldCapture=true.
 * Used in tests and when the gate is disabled.
 */
export class NullGranolaGate implements GranolaGate {
  async classify(
    _title: string,
    _markdownContent: string,
    _participants: string[],
  ): Promise<GranolaGateResult> {
    return { shouldCapture: true, reason: "null gate — always capture" };
  }
}
