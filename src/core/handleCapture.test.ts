import { test } from "node:test";
import assert from "node:assert/strict";
import { handleCapture, dedupKey, type CaptureDeps } from "./handleCapture.js";
import type { CaptureRequest } from "./events.js";
import type { FeedbackRecord, FeedbackCategory } from "./ports.js";

const req: CaptureRequest = {
  triggerType: "mega_reaction",
  channelId: "C123",
  messageTs: "1719600000.000100",
  triggeredBy: "Ureactor",
};

const silentLogger = { info() {}, warn() {}, error() {} };

function makeDeps() {
  const writes: FeedbackRecord[] = [];
  const appendedFlaggers: Array<{ pageId: string; name: string }> = [];
  const store = new Map<string, string>(); // key → pageId

  const deps: CaptureDeps = {
    logger: silentLogger,
    source: "Slack",
    dedup: {
      has: (k) => store.has(k),
      record: (k, pageId) => { store.set(k, pageId); },
      getPageId: (k) => store.get(k) ?? null,
      close: () => {},
    },
    notion: {
      createFeedback: async (r) => {
        writes.push(r);
        return "page_001";
      },
      appendFlagger: async (pageId, name) => {
        appendedFlaggers.push({ pageId, name });
      },
    },
    slack: {
      getMessage: async () => ({ text: "Customers keep asking for SSO", authorUserId: "Uauthor" }),
      resolveUserName: async (id) => (id === "Uauthor" ? "Alice" : "Bob"),
      resolveChannelName: async () => "#general",
      getPermalink: async () => "https://spottedzebra.slack.com/archives/C123/p1719600000000100",
      addReaction: async () => {},
      postReply: async () => {},
    },
    enricher: {
      enrich: async () => ({
        summary: "Customer wants SSO integration.",
        category: "Feature Request" as FeedbackCategory,
      }),
    },
  };
  return { deps, writes, appendedFlaggers, store };
}

test("captures a new message and records the dedup key with page ID", async () => {
  const { deps, writes, store } = makeDeps();
  const res = await handleCapture(req, deps);
  assert.equal(res.status, "captured");
  assert.equal(writes.length, 1);
  assert.equal(writes[0].message, "Customers keep asking for SSO");
  assert.equal(writes[0].authorName, "Alice");
  assert.equal(writes[0].flaggedByName, "Bob");
  assert.equal(writes[0].channelName, "#general");
  assert.equal(writes[0].source, "Slack");
  assert.equal(writes[0].customerAccount, "");
  assert.match(writes[0].dateIso, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(store.get(dedupKey(req)), "page_001");
});

test("appends flagger when the same message is flagged again (flagger_added)", async () => {
  const { deps, writes, appendedFlaggers } = makeDeps();
  await handleCapture(req, deps);
  const res2 = await handleCapture(req, deps);
  assert.equal(res2.status, "flagger_added");
  assert.equal(writes.length, 1); // no second Notion row
  assert.equal(appendedFlaggers.length, 1);
  assert.equal(appendedFlaggers[0].pageId, "page_001");
  assert.equal(appendedFlaggers[0].name, "Bob"); // triggeredBy resolved to "Bob"
});

test("returns duplicate when dedup key exists but no page ID stored (legacy)", async () => {
  const { deps } = makeDeps();
  // Simulate a legacy entry with null pageId by overriding getPageId.
  deps.dedup.has = () => true;
  deps.dedup.getPageId = () => null;
  const res = await handleCapture(req, deps);
  assert.equal(res.status, "duplicate");
});

test("empty message text falls back to a placeholder title", async () => {
  const { deps, writes } = makeDeps();
  deps.slack.getMessage = async () => ({ text: "   ", authorUserId: "Uauthor" });
  await handleCapture(req, deps);
  assert.equal(writes[0].message, "(no text — attachment or file)");
});

test("strips bot mention from text on @mention trigger", async () => {
  const mentionReq: CaptureRequest = { ...req, triggerType: "mention" };
  const { deps, writes } = makeDeps();
  deps.slack.getMessage = async () => ({
    text: "<@UBOTID> this is the real feedback",
    authorUserId: "Uauthor",
  });
  deps.botUserId = "UBOTID";
  await handleCapture(mentionReq, deps);
  assert.equal(writes[0].message, "this is the real feedback");
});

test("does not record the dedup key when the Notion write fails", async () => {
  const { deps, store } = makeDeps();
  deps.notion.createFeedback = async () => { throw new Error("notion down"); };
  const res = await handleCapture(req, deps);
  assert.equal(res.status, "error");
  assert.ok(!store.has(dedupKey(req)));
});

test("returns no_message when the message can't be fetched", async () => {
  const { deps, writes } = makeDeps();
  deps.slack.getMessage = async () => null;
  const res = await handleCapture(req, deps);
  assert.equal(res.status, "no_message");
  assert.equal(writes.length, 0);
});

test("includes enriched summary and category in the feedback record", async () => {
  const { deps, writes } = makeDeps();
  await handleCapture(req, deps);
  assert.equal(writes[0].summary, "Customer wants SSO integration.");
  assert.equal(writes[0].category, "Feature Request");
});

test("writes feedback without enrichment when enricher returns null", async () => {
  const { deps, writes } = makeDeps();
  deps.enricher.enrich = async () => null;
  const res = await handleCapture(req, deps);
  assert.equal(res.status, "captured");
  assert.equal(writes[0].summary, undefined);
  assert.equal(writes[0].category, undefined);
});
