/**
 * The transport-agnostic seam.
 *
 * Every trigger — the `:mega:` reaction now, `@mention` in Slice 3, other platforms
 * later — is normalized into a CaptureRequest before it reaches the core. The core
 * business logic depends only on this shape and has NO knowledge of how the event
 * arrived (Socket Mode, HTTP webhook, etc.).
 *
 * Adding a new trigger = produce a CaptureRequest with a new `triggerType` from a new
 * transport adapter. The core never changes.
 */
export type TriggerType = "mega_reaction" | "mention" | "live_gate";

export interface CaptureRequest {
  /** What kind of trigger produced this request. */
  triggerType: TriggerType;
  /** Slack channel ID where the flagged message lives. */
  channelId: string;
  /** Timestamp ("ts") of the flagged message — unique within the channel. */
  messageTs: string;
  /** User ID of whoever triggered the capture (the reactor / mentioner). */
  triggeredBy: string;
  /** Override the initial Notion status. Defaults to "New" when absent. */
  initialStatus?: "New" | "Needs Review";
}
