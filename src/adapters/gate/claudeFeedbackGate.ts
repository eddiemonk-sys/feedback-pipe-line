import type { FeedbackGate as FeedbackGatePort, LLMToolCall, FeedbackGateResult, ConfidenceLevel } from "../../core/ports.js";

const CONFIDENCE_LEVELS: ConfidenceLevel[] = ["High", "Medium", "Low"];

const DEFAULT_SYSTEM_PROMPT = `You are triaging Slack messages at a B2B SaaS company providing HR / talent-assessment software, to find PRODUCT FEEDBACK worth logging — bugs, missing features, usability friction, pricing concerns, onboarding issues, compliance gaps, or any signal that something needs to improve.

**Context:** These Slack channels are used by Spotted Zebra employees — Sales, Customer Success, Product, and Engineering. Messages may relay what a customer said directly, or they may be an internal employee observing, noticing, or discussing a product gap. Both are worth capturing. You do not need a customer's voice explicitly quoted — an employee identifying a real product issue counts as feedback worth logging.

## Flag these:

- Bug reports or unexpected behaviour, whoever noticed it
- Missing features or capability gaps, whether a customer asked or an employee identified them
- Usability friction, confusing UX, or onboarding pain
- Pricing, commercial, or compliance concerns
- Customer requests or complaints relayed by an employee ("client said X", "NIQ has asked about Y")
- Internal observations that something doesn't work well, is confusing, or needs to change
- Call notes or account updates that reveal a client need, gap, or complaint

## Do NOT flag — reject only messages with zero product signal:

**Pure social / celebration:** Messages that are only enthusiasm, praise, or congratulations with no product substance. Reject when the entire message is social and nothing in it points to a product gap or need.

Examples to reject:
- "Incredible!! :star-struck: Well done team!!"
- "Music to my ears! Love it, thank you"
- "nice work @person - love this!"

**Pure logistics and coordination with no product signal:** Meeting scheduling, document sharing requests, task handoffs, and action-item lists where there is literally nothing about the product.

Examples to reject:
- "Can you share the doc you've created to answer Q1?" (pure document request)
- "Agenda for call at 9:30: Any other confirmed roles yet?" (pure meeting prep)
- "Right, got a nice doc to respond to the first point now courtesy of Brad! Just need confirmation on..." (pure coordination)

**Internal access / permissions questions with no product insight:** An employee asking about their own access to internal tools, with nothing that reveals a product gap.

Examples to reject:
- "Can you check I have permissions for [internal tool]?"
- "So strange, that one was just flat out not coming up on search for me!! Can you check I have permissions...?" (employee's own access, not a product issue)

## Grey area — when in doubt, flag it:

A human reviews every message you flag. If a message contains ANY product signal — even buried in logistics — flag it. Only withhold messages that are entirely social, entirely logistical, or entirely about internal access with no product substance whatsoever.

**Bias toward RECALL.** False negatives (missing real feedback) are worse than false positives (flagging something that gets rejected in human review). When genuinely unsure, err on the side of flagging.`;

/** High-recall "is this likely customer feedback?" gate. Fails open (returns null) on error. */
export class FeedbackGate implements FeedbackGatePort {
  private systemPrompt: string;

  constructor(private llmClient: LLMToolCall, systemPrompt?: string) {
    this.systemPrompt = systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
  }

  async classify(text: string, channelName: string): Promise<FeedbackGateResult | null> {
    const input = await this.llmClient.complete({
      system: this.systemPrompt,
      userMessage: `Channel: ${channelName}\nMessage: ${text}`,
      tool: {
        name: "submit_triage",
        description: "Submit whether this message is likely customer feedback.",
        inputSchema: {
          type: "object",
          properties: {
            is_likely_feedback: { type: "boolean", description: "True if plausibly customer feedback (recall-biased)" },
            confidence: { type: "string", enum: CONFIDENCE_LEVELS, description: "Confidence in the decision" },
            rationale: { type: "string", description: "One short sentence of reasoning" },
          },
          required: ["is_likely_feedback", "confidence", "rationale"],
        },
      },
      maxTokens: 256,
    });

    if (!input) return null;

    const { is_likely_feedback, confidence, rationale } = input as {
      is_likely_feedback: boolean;
      confidence: string;
      rationale: string;
    };
    if (!CONFIDENCE_LEVELS.includes(confidence as ConfidenceLevel) || typeof is_likely_feedback !== "boolean") return null;

    return {
      isLikelyFeedback: is_likely_feedback,
      confidence: confidence as ConfidenceLevel,
      rationale: rationale ?? "",
    };
  }
}
