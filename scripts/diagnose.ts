import "dotenv/config";
import { WebClient } from "@slack/web-api";

/** Diagnostic: reports the bot token's identity, granted scopes, and channel access. */
async function main(): Promise<void> {
  const token = process.env.SLACK_BOT_TOKEN;
  const channel = (process.env.TARGET_CHANNEL_IDS ?? "").split(",")[0]?.trim();
  if (!token) throw new Error("SLACK_BOT_TOKEN missing");
  const client = new WebClient(token);

  const auth: any = await client.auth.test();
  console.log("auth.test ok:", { bot_user: auth.user, user_id: auth.user_id, team: auth.team });

  console.log("\n--- conversations.info (needs channels:read / groups:read) ---");
  try {
    const r: any = await client.conversations.info({ channel });
    console.log("OK:", {
      name: r.channel?.name,
      is_private: r.channel?.is_private,
      is_member: r.channel?.is_member,
    });
  } catch (e: any) {
    console.log("FAIL:", { error: e?.data?.error, needed: e?.data?.needed, provided: e?.data?.provided });
  }

  console.log("\n--- conversations.history (needs channels:history / groups:history) ---");
  try {
    const h: any = await client.conversations.history({ channel, limit: 1 });
    console.log("OK: messages returned =", h.messages?.length);
  } catch (e: any) {
    console.log("FAIL:", { error: e?.data?.error, needed: e?.data?.needed, provided: e?.data?.provided });
  }
}

main().catch((err) => {
  console.error("diagnose failed:", err?.data ?? err);
  process.exit(1);
});
