import type { GranolaGate as GranolaGatePort, GranolaGateResult, LLMToolCall } from "../../core/ports.js";

const DEFAULT_SYSTEM_PROMPT = `You are triaging Granola meeting notes at a B2B SaaS company providing HR / talent-assessment software, to find notes that contain PRODUCT FEEDBACK from client-facing meetings.

Capture: any meeting with an external (non-Spotted Zebra) attendee discussing the product, QBRs, demos, CS check-ins, discovery calls, pilot debriefs, or meetings where a client describes pain points, gaps, or requests. Also capture urgent signals (outage, data/privacy issues, legal disputes).

Skip: purely internal Spotted Zebra meetings with no external attendees AND no client feedback, or purely logistical notes with zero product signal.

When in doubt, capture it. Bias toward RECALL.`;

/**
 * Claude-backed gate for Granola meeting notes. Decides whether a note contains
 * client-facing product feedback worth ingesting. Fails open (returns null) on any error.
 */
export class GranolaGate implements GranolaGatePort {
  private systemPrompt: string;

  constructor(private llmClient: LLMToolCall, systemPrompt?: string) {
    this.systemPrompt = systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
  }

  async classify(
    title: string,
    markdownContent: string,
    participants: string[],
  ): Promise<GranolaGateResult | null> {
    const userMessage = [
      `Title: ${title}`,
      participants.length > 0 ? `Participants: ${participants.join(", ")}` : "",
      `Content:\n${markdownContent.slice(0, 4000)}`,
    ]
      .filter(Boolean)
      .join("\n\n");

    const input = await this.llmClient.complete({
      system: this.systemPrompt,
      userMessage,
      tool: {
        name: "submit_granola_gate",
        description: "Submit whether this Granola meeting note contains client feedback worth capturing.",
        inputSchema: {
          type: "object",
          properties: {
            should_capture: {
              type: "boolean",
              description: "True if this note contains client-facing product feedback worth ingesting into the feedback pipeline.",
            },
            reason: {
              type: "string",
              description: "One short sentence explaining the decision.",
            },
          },
          required: ["should_capture", "reason"],
        },
      },
      maxTokens: 256,
    });

    if (!input) return null;

    const { should_capture, reason } = input as { should_capture: boolean; reason: string };
    if (typeof should_capture !== "boolean") return null;

    return {
      shouldCapture: should_capture,
      reason: reason ?? "",
    };
  }
}
