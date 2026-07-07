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
  const judgeCalls: Array<{ originalMessage: string; channelName: string; summary: string; category: FeedbackCategory }> = [];
  const downloadCalls: string[] = [];
  const visionCalls: Array<{ data: string; mimeType: string; channelName: string }> = [];
  const enrichCalls: string[] = [];
  const recentByCategoryCalls: Array<{ category: FeedbackCategory; sinceDateIso: string }> = [];
  const similarityCalls: Array<{ summary: string; category: FeedbackCategory; candidates: Array<{ pageId: string; summary: string }> }> = [];
  let recentCandidates: Array<{ pageId: string; summary: string }> = [];

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
      findRecentByCategory: async (category, sinceDateIso) => {
        recentByCategoryCalls.push({ category, sinceDateIso });
        return recentCandidates;
      },
    },
    slack: {
      getMessage: async () => ({ text: "Customers keep asking for SSO", authorUserId: "Uauthor" }),
      resolveUserName: async (id) => (id === "Uauthor" ? "Alice" : "Bob"),
      resolveChannelName: async () => "#general",
      getPermalink: async () => "https://spottedzebra.slack.com/archives/C123/p1719600000000100",
      addReaction: async () => {},
      postReply: async () => {},
      downloadImage: async (url) => {
        downloadCalls.push(url);
        return { data: "ZmFrZS1pbWFnZS1ieXRlcw==", mimeType: "image/png" };
      },
    },
    enricher: {
      enrich: async (text) => {
        enrichCalls.push(text);
        return {
          summary: "Customer wants SSO integration.",
          category: "Feature Request" as FeedbackCategory,
        };
      },
    },
    judge: {
      review: async (originalMessage, channelName, summary, category) => {
        judgeCalls.push({ originalMessage, channelName, summary, category });
        return { confidence: "High", rationale: "Category and summary both match the source message." };
      },
    },
    vision: {
      describe: async (image, channelName) => {
        visionCalls.push({ data: image.data, mimeType: image.mimeType, channelName });
        return { description: "A screenshot showing an error dialog on the export screen." };
      },
    },
    visionEnabledChannelIds: new Set(["C123"]),
    similarityDetector: {
      findSimilar: async (summary, category, candidates) => {
        similarityCalls.push({ summary, category, candidates });
        return null;
      },
    },
    similarityWindowDays: 30,
  };
  return {
    deps, writes, appendedFlaggers, store, judgeCalls, downloadCalls, visionCalls, enrichCalls,
    recentByCategoryCalls, similarityCalls,
    setRecentCandidates: (c: Array<{ pageId: string; summary: string }>) => { recentCandidates = c; },
  };
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

test("freezes a copy of the category into aiSuggestedCategory at write time", async () => {
  const { deps, writes } = makeDeps();
  await handleCapture(req, deps);
  assert.equal(writes[0].aiSuggestedCategory, "Feature Request");
  assert.equal(writes[0].aiSuggestedCategory, writes[0].category);
});

test("leaves aiSuggestedCategory undefined when enrichment is disabled or failed", async () => {
  const { deps, writes } = makeDeps();
  deps.enricher.enrich = async () => null;
  await handleCapture(req, deps);
  assert.equal(writes[0].aiSuggestedCategory, undefined);
});

test("freezes a copy of the summary into aiSuggestedSummary at write time", async () => {
  const { deps, writes } = makeDeps();
  await handleCapture(req, deps);
  assert.equal(writes[0].aiSuggestedSummary, "Customer wants SSO integration.");
  assert.equal(writes[0].aiSuggestedSummary, writes[0].summary);
});

test("leaves aiSuggestedSummary undefined when enrichment is disabled or failed", async () => {
  const { deps, writes } = makeDeps();
  deps.enricher.enrich = async () => null;
  await handleCapture(req, deps);
  assert.equal(writes[0].aiSuggestedSummary, undefined);
});

test("writes feedback without enrichment when enricher returns null", async () => {
  const { deps, writes } = makeDeps();
  deps.enricher.enrich = async () => null;
  const res = await handleCapture(req, deps);
  assert.equal(res.status, "captured");
  assert.equal(writes[0].summary, undefined);
  assert.equal(writes[0].category, undefined);
});

test("includes judge confidence and rationale in the feedback record", async () => {
  const { deps, writes } = makeDeps();
  await handleCapture(req, deps);
  assert.equal(writes[0].confidence, "High");
  assert.equal(writes[0].rationale, "Category and summary both match the source message.");
});

test("judges against the original message text and the enricher's own output", async () => {
  const { deps, judgeCalls } = makeDeps();
  await handleCapture(req, deps);
  assert.equal(judgeCalls.length, 1);
  assert.equal(judgeCalls[0].originalMessage, "Customers keep asking for SSO");
  assert.equal(judgeCalls[0].channelName, "#general");
  assert.equal(judgeCalls[0].summary, "Customer wants SSO integration.");
  assert.equal(judgeCalls[0].category, "Feature Request");
});

test("does not call the judge when enrichment is disabled or failed", async () => {
  const { deps, writes, judgeCalls } = makeDeps();
  deps.enricher.enrich = async () => null;
  await handleCapture(req, deps);
  assert.equal(judgeCalls.length, 0);
  assert.equal(writes[0].confidence, undefined);
  assert.equal(writes[0].rationale, undefined);
});

test("writes feedback without confidence/rationale when the judge fails", async () => {
  const { deps, writes } = makeDeps();
  deps.judge.review = async () => { throw new Error("judge down"); };
  const res = await handleCapture(req, deps);
  assert.equal(res.status, "captured");
  assert.equal(writes[0].summary, "Customer wants SSO integration."); // enrichment still kept
  assert.equal(writes[0].confidence, undefined);
  assert.equal(writes[0].rationale, undefined);
});

test("writes feedback without confidence/rationale when the judge returns null", async () => {
  const { deps, writes } = makeDeps();
  deps.judge.review = async () => null;
  await handleCapture(req, deps);
  assert.equal(writes[0].confidence, undefined);
  assert.equal(writes[0].rationale, undefined);
});

test("describes an attached screenshot when the channel is vision-enabled", async () => {
  const { deps, writes, downloadCalls, visionCalls } = makeDeps();
  deps.slack.getMessage = async () => ({
    text: "Getting this error, see screenshot",
    authorUserId: "Uauthor",
    imageUrls: ["https://files.slack.com/private/abc123"],
  });
  await handleCapture(req, deps);
  assert.equal(writes[0].visualDescription, "A screenshot showing an error dialog on the export screen.");
  assert.deepEqual(downloadCalls, ["https://files.slack.com/private/abc123"]);
  assert.equal(visionCalls.length, 1);
  assert.equal(visionCalls[0].data, "ZmFrZS1pbWFnZS1ieXRlcw==");
  assert.equal(visionCalls[0].channelName, "#general");
});

test("does not attempt vision when the channel is not vision-enabled", async () => {
  const { deps, writes, downloadCalls, visionCalls } = makeDeps();
  deps.visionEnabledChannelIds = new Set(); // C123 (req.channelId) not included
  deps.slack.getMessage = async () => ({
    text: "Getting this error, see screenshot",
    authorUserId: "Uauthor",
    imageUrls: ["https://files.slack.com/private/abc123"],
  });
  await handleCapture(req, deps);
  assert.equal(downloadCalls.length, 0);
  assert.equal(visionCalls.length, 0);
  assert.equal(writes[0].visualDescription, undefined);
});

test("does not attempt vision when the message has no image attachments", async () => {
  const { deps, writes, downloadCalls, visionCalls } = makeDeps();
  await handleCapture(req, deps); // default getMessage has no imageUrls
  assert.equal(downloadCalls.length, 0);
  assert.equal(visionCalls.length, 0);
  assert.equal(writes[0].visualDescription, undefined);
});

test("writes feedback without visualDescription when the image download fails", async () => {
  const { deps, writes } = makeDeps();
  deps.slack.getMessage = async () => ({
    text: "Getting this error, see screenshot",
    authorUserId: "Uauthor",
    imageUrls: ["https://files.slack.com/private/abc123"],
  });
  deps.slack.downloadImage = async () => { throw new Error("download failed"); };
  const res = await handleCapture(req, deps);
  assert.equal(res.status, "captured");
  assert.equal(writes[0].visualDescription, undefined);
});

test("writes feedback without visualDescription when vision returns null", async () => {
  const { deps, writes } = makeDeps();
  deps.slack.getMessage = async () => ({
    text: "Getting this error, see screenshot",
    authorUserId: "Uauthor",
    imageUrls: ["https://files.slack.com/private/abc123"],
  });
  deps.vision.describe = async () => null;
  await handleCapture(req, deps);
  assert.equal(writes[0].visualDescription, undefined);
});

test("feeds the vision description into what the enricher and judge see", async () => {
  const { deps, enrichCalls, judgeCalls } = makeDeps();
  deps.slack.getMessage = async () => ({
    text: "Getting this error, see screenshot",
    authorUserId: "Uauthor",
    imageUrls: ["https://files.slack.com/private/abc123"],
  });
  await handleCapture(req, deps);
  assert.equal(enrichCalls.length, 1);
  assert.match(enrichCalls[0], /Getting this error, see screenshot/);
  assert.match(enrichCalls[0], /A screenshot showing an error dialog on the export screen\./);
  assert.match(judgeCalls[0].originalMessage, /A screenshot showing an error dialog on the export screen\./);
});

test("builds a clean enrichment input when there is no real text, only a screenshot", async () => {
  const { deps, enrichCalls } = makeDeps();
  deps.slack.getMessage = async () => ({
    text: "",
    authorUserId: "Uauthor",
    imageUrls: ["https://files.slack.com/private/abc123"],
  });
  await handleCapture(req, deps);
  assert.match(enrichCalls[0], /A screenshot showing an error dialog on the export screen\./);
  assert.doesNotMatch(enrichCalls[0], /no text — attachment or file/);
});

test("the raw Notion Message field is unaffected by the vision description", async () => {
  const { deps, writes } = makeDeps();
  deps.slack.getMessage = async () => ({
    text: "Getting this error, see screenshot",
    authorUserId: "Uauthor",
    imageUrls: ["https://files.slack.com/private/abc123"],
  });
  await handleCapture(req, deps);
  assert.equal(writes[0].message, "Getting this error, see screenshot");
});

test("checks recent same-category candidates against the new summary", async () => {
  const { deps, recentByCategoryCalls, similarityCalls, setRecentCandidates } = makeDeps();
  setRecentCandidates([{ pageId: "page_old", summary: "An older, unrelated report." }]);
  await handleCapture(req, deps);
  assert.equal(recentByCategoryCalls.length, 1);
  assert.equal(recentByCategoryCalls[0].category, "Feature Request");
  assert.match(recentByCategoryCalls[0].sinceDateIso, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(similarityCalls.length, 1);
  assert.equal(similarityCalls[0].summary, "Customer wants SSO integration.");
  assert.equal(similarityCalls[0].category, "Feature Request");
  assert.deepEqual(similarityCalls[0].candidates, [{ pageId: "page_old", summary: "An older, unrelated report." }]);
});

test("links to the matched page when a similarity match is found", async () => {
  const { deps, writes, setRecentCandidates } = makeDeps();
  setRecentCandidates([{ pageId: "page_old", summary: "SSO login is broken for our team." }]);
  deps.similarityDetector.findSimilar = async () => ({
    matchedPageId: "page_old",
    rationale: "Both describe SSO login being unavailable.",
  });
  await handleCapture(req, deps);
  assert.equal(writes[0].relatedFeedbackPageId, "page_old");
  assert.equal(writes[0].relatedFeedbackRationale, "Both describe SSO login being unavailable.");
});

test("leaves related feedback fields undefined when no match is found", async () => {
  const { deps, writes } = makeDeps();
  await handleCapture(req, deps); // default findSimilar returns null
  assert.equal(writes[0].relatedFeedbackPageId, undefined);
  assert.equal(writes[0].relatedFeedbackRationale, undefined);
});

test("does not check for similarity when enrichment is disabled or failed", async () => {
  const { deps, writes, recentByCategoryCalls, similarityCalls } = makeDeps();
  deps.enricher.enrich = async () => null;
  await handleCapture(req, deps);
  assert.equal(recentByCategoryCalls.length, 0);
  assert.equal(similarityCalls.length, 0);
  assert.equal(writes[0].relatedFeedbackPageId, undefined);
});

test("writes feedback without a related link when fetching recent candidates fails", async () => {
  const { deps, writes } = makeDeps();
  deps.notion.findRecentByCategory = async () => { throw new Error("Notion query failed"); };
  const res = await handleCapture(req, deps);
  assert.equal(res.status, "captured");
  assert.equal(writes[0].relatedFeedbackPageId, undefined);
});

test("writes feedback without a related link when the similarity detector fails", async () => {
  const { deps, writes, setRecentCandidates } = makeDeps();
  setRecentCandidates([{ pageId: "page_old", summary: "An older report." }]); // non-empty, so findSimilar actually gets called
  deps.similarityDetector.findSimilar = async () => { throw new Error("detector down"); };
  const res = await handleCapture(req, deps);
  assert.equal(res.status, "captured");
  assert.equal(writes[0].relatedFeedbackPageId, undefined);
});
