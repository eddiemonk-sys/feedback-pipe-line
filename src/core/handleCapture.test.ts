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
  const judgeCalls: Array<{ originalMessage: string; channelName: string; summary: string; categories: FeedbackCategory[] }> = [];
  const downloadCalls: string[] = [];
  const enrichCalls: string[] = [];
  const recentByCategoryCalls: Array<{ categories: FeedbackCategory[]; sinceDateIso: string }> = [];
  const similarityCalls: Array<{ summary: string; categories: FeedbackCategory[]; candidates: Array<{ pageId: string; summary: string }> }> = [];
  let recentCandidates: Array<{ pageId: string; summary: string }> = [];

  const deps: CaptureDeps = {
    logger: silentLogger,
    source: "Slack",
    dedup: {
      has: (k) => store.has(k),
      record: (k, pageId) => { store.set(k, pageId); },
      getPageId: (k) => store.get(k) ?? null,
      delete: (k) => { store.delete(k); },
      findKeyByPageId: (pageId) => {
        for (const [k, v] of store) { if (v === pageId) return k; }
        return null;
      },
      recordMultiple: (k: string, pageIds: string[]) => {
        // Store all page IDs (simple representation for tests)
        for (const id of pageIds) store.set(k, id); // simplified for existing tests
      },
      getPageIds: (k: string) => {
        const v = store.get(k);
        if (!v) return [];
        return [v];
      },
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
      findRecentByCategories: async (categories, sinceDateIso) => {
        recentByCategoryCalls.push({ categories, sinceDateIso });
        return recentCandidates;
      },
      updateSiblingLinks: async (_pageId: string, _siblingPageIds: string[]) => {},
      updateSummaryAndLog: async () => {},
      getPageSummaries: async () => [],
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
      enrich: async (text, _channelName, _images) => {
        enrichCalls.push(text);
        return [{
          summary: "Customer wants SSO integration.",
          categories: ["Feature Request" as FeedbackCategory],
        }];
      },
    },
    judge: {
      review: async (originalMessage, channelName, summary, categories) => {
        judgeCalls.push({ originalMessage, channelName, summary, categories });
        return { confidence: "High", rationale: "Category and summary both match the source message." };
      },
    },
    similarityDetector: {
      findSimilar: async (summary, categories, candidates) => {
        similarityCalls.push({ summary, categories, candidates });
        return null;
      },
    },
    similarityWindowDays: 30,
  };
  return {
    deps, writes, appendedFlaggers, store, judgeCalls, downloadCalls, enrichCalls,
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

test("includes enriched summary and categories in the feedback record", async () => {
  const { deps, writes } = makeDeps();
  await handleCapture(req, deps);
  assert.equal(writes[0].summary, "Customer wants SSO integration.");
  assert.deepEqual(writes[0].categories, ["Feature Request"]);
});

test("freezes a copy of the categories into aiSuggestedCategories at write time", async () => {
  const { deps, writes } = makeDeps();
  await handleCapture(req, deps);
  assert.deepEqual(writes[0].aiSuggestedCategories, ["Feature Request"]);
  assert.deepEqual(writes[0].aiSuggestedCategories, writes[0].categories);
});

test("leaves aiSuggestedCategories undefined when enrichment is disabled or failed", async () => {
  const { deps, writes } = makeDeps();
  deps.enricher.enrich = async () => null;
  await handleCapture(req, deps);
  assert.equal(writes[0].aiSuggestedCategories, undefined);
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
  assert.equal(writes[0].categories, undefined);
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
  assert.deepEqual(judgeCalls[0].categories, ["Feature Request"]);
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

test("downloads all imageUrls and passes them to enricher", async () => {
  const { deps, enrichCalls } = makeDeps();
  // Track images passed to enrich
  const enrichImageArgs: any[] = [];
  deps.enricher = {
    async enrich(text, channelName, images) {
      enrichCalls.push(text);
      enrichImageArgs.push(images);
      return [{ summary: "Summary.", categories: ["Feature Request" as FeedbackCategory] }];
    },
  };
  deps.slack.getMessage = async () => ({
    text: "See this screenshot",
    authorUserId: "Uauthor",
    imageUrls: ["https://files.slack.com/private/img1", "https://files.slack.com/private/img2"],
  });
  await handleCapture(req, deps);
  assert.ok(Array.isArray(enrichImageArgs[0]));
  assert.strictEqual(enrichImageArgs[0].length, 2);
});

test("passes undefined images to enricher when message has no imageUrls", async () => {
  const { deps } = makeDeps();
  let capturedImages: any = "not-checked";
  deps.enricher = {
    async enrich(_text, _chan, images) {
      capturedImages = images;
      return [{ summary: "Summary.", categories: ["Feature Request" as FeedbackCategory] }];
    },
  };
  await handleCapture(req, deps); // default getMessage has no imageUrls
  assert.strictEqual(capturedImages, undefined);
});

test("sets image on feedback record from first downloaded image", async () => {
  const { deps, writes } = makeDeps();
  deps.slack.getMessage = async () => ({
    text: "See screenshot",
    authorUserId: "Uauthor",
    imageUrls: ["https://files.slack.com/private/img1"],
  });
  await handleCapture(req, deps);
  assert.deepStrictEqual(writes[0].image, { data: "ZmFrZS1pbWFnZS1ieXRlcw==", mimeType: "image/png" });
});

test("captures without image when download fails (fail-open)", async () => {
  const { deps, writes } = makeDeps();
  deps.slack.getMessage = async () => ({
    text: "See screenshot",
    authorUserId: "Uauthor",
    imageUrls: ["https://files.slack.com/private/img1"],
  });
  deps.slack.downloadImage = async () => { throw new Error("network error"); };
  const res = await handleCapture(req, deps);
  assert.strictEqual(res.status, "captured");
  assert.strictEqual(writes[0].image, undefined);
});

test("the raw Notion Message field contains only the original Slack text", async () => {
  const { deps, writes } = makeDeps();
  deps.slack.getMessage = async () => ({
    text: "Getting this error, see screenshot",
    authorUserId: "Uauthor",
    imageUrls: ["https://files.slack.com/private/abc123"],
  });
  await handleCapture(req, deps);
  assert.strictEqual(writes[0].message, "Getting this error, see screenshot");
});

test("checks recent same-category candidates against the new summary", async () => {
  const { deps, recentByCategoryCalls, similarityCalls, setRecentCandidates } = makeDeps();
  setRecentCandidates([{ pageId: "page_old", summary: "An older, unrelated report." }]);
  await handleCapture(req, deps);
  assert.equal(recentByCategoryCalls.length, 1);
  assert.deepEqual(recentByCategoryCalls[0].categories, ["Feature Request"]);
  assert.match(recentByCategoryCalls[0].sinceDateIso, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(similarityCalls.length, 1);
  assert.equal(similarityCalls[0].summary, "Customer wants SSO integration.");
  assert.deepEqual(similarityCalls[0].categories, ["Feature Request"]);
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
  deps.notion.findRecentByCategories = async () => { throw new Error("Notion query failed"); };
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

test("handleCapture — retries enrichment when judge returns Low confidence", async () => {
  const { deps, writes, judgeCalls, enrichCalls } = makeDeps();
  let judgeCallCount = 0;
  deps.judge = {
    review: async (_msg, _ch, _sum, _cats) => {
      judgeCallCount++;
      // First call returns Low; second (retry) returns Medium
      return judgeCallCount === 1
        ? { confidence: "Low", rationale: "Category mismatch — Other does not fit." }
        : { confidence: "Medium", rationale: "Plausible but uncertain." };
    },
  };
  let enrichCallCount = 0;
  deps.enricher = {
    enrich: async (text) => {
      enrichCalls.push(text);
      enrichCallCount++;
      return [{
        summary: enrichCallCount === 1 ? "Original summary." : "Retry summary.",
        categories: ["Feature Request" as FeedbackCategory],
      }];
    },
  };

  await handleCapture(req, deps);

  // enricher called twice: original + retry
  assert.strictEqual(enrichCalls.length, 2);
  // retry input contains judge rationale note
  assert.ok(enrichCalls[1].includes("Category mismatch — Other does not fit."));
  // judge called twice: original + retry
  assert.strictEqual(judgeCallCount, 2);
  // final write uses retry enrichment
  assert.strictEqual(writes[0].summary, "Retry summary.");
  assert.strictEqual(writes[0].confidence, "Medium");
});

test("handleCapture — keeps original enrichment when retry enrichment fails", async () => {
  const { deps, writes } = makeDeps();
  deps.judge = {
    review: async () => ({ confidence: "Low", rationale: "Wrong category." }),
  };
  let enrichCallCount = 0;
  deps.enricher = {
    enrich: async () => {
      enrichCallCount++;
      if (enrichCallCount === 1) return [{ summary: "Original.", categories: ["Feature Request" as FeedbackCategory] }];
      return null; // retry fails
    },
  };

  await handleCapture(req, deps);

  // Still captured with original enrichment
  assert.strictEqual(writes[0].summary, "Original.");
  assert.strictEqual(writes[0].confidence, "Low");
});

test("handleCapture — does NOT retry when judge returns Medium", async () => {
  const { deps, enrichCalls } = makeDeps();
  deps.judge = {
    review: async () => ({ confidence: "Medium", rationale: "Plausible." }),
  };
  let enrichCallCount = 0;
  deps.enricher = {
    enrich: async (text) => {
      enrichCalls.push(text);
      enrichCallCount++;
      return [{ summary: "Summary.", categories: ["Feature Request" as FeedbackCategory] }];
    },
  };

  await handleCapture(req, deps);

  // enricher called only once — no retry for Medium
  assert.strictEqual(enrichCalls.length, 1);
});

test("batch split — creates one Notion row per enrichment result", async () => {
  const { deps, writes } = makeDeps();
  deps.enricher = {
    async enrich() {
      return [
        { summary: "Item 1: bug.", categories: ["Bug / Broken" as FeedbackCategory], clientName: "DTG", preambleContext: "DTG call:" },
        { summary: "Item 2: feature.", categories: ["Feature Request" as FeedbackCategory], clientName: "DTG", preambleContext: "DTG call:" },
      ];
    },
  };
  await handleCapture(req, deps);
  assert.strictEqual(writes.length, 2);
  assert.strictEqual(writes[0].summary, "Item 1: bug.");
  assert.strictEqual(writes[1].summary, "Item 2: feature.");
});

test("batch split — sets customerAccount from clientName on each row", async () => {
  const { deps, writes } = makeDeps();
  deps.enricher = {
    async enrich() {
      return [
        { summary: "Bug.", categories: ["Bug / Broken" as FeedbackCategory], clientName: "Acme" },
        { summary: "Feature.", categories: ["Feature Request" as FeedbackCategory], clientName: "Acme" },
      ];
    },
  };
  await handleCapture(req, deps);
  assert.strictEqual(writes[0].customerAccount, "Acme");
  assert.strictEqual(writes[1].customerAccount, "Acme");
});

test("batch split — sets sourceMessageKey on each row", async () => {
  const { deps, writes } = makeDeps();
  deps.enricher = {
    async enrich() {
      return [
        { summary: "Bug.", categories: ["Bug / Broken" as FeedbackCategory] },
        { summary: "Feature.", categories: ["Feature Request" as FeedbackCategory] },
      ];
    },
  };
  await handleCapture(req, deps);
  const expectedKey = `${req.channelId}:${req.messageTs}`;
  assert.strictEqual(writes[0].sourceMessageKey, expectedKey);
  assert.strictEqual(writes[1].sourceMessageKey, expectedKey);
});

test("batch split — recordMultiple called with all page IDs", async () => {
  const { deps } = makeDeps();
  const recordedMultiple: Array<{ key: string; pageIds: string[] }> = [];
  let pageSeq = 0;
  deps.notion.createFeedback = async () => `page_${++pageSeq}`;
  deps.dedup.recordMultiple = (key, pageIds) => { recordedMultiple.push({ key, pageIds }); };
  deps.enricher = {
    async enrich() {
      return [
        { summary: "Bug.", categories: ["Bug / Broken" as FeedbackCategory] },
        { summary: "Feature.", categories: ["Feature Request" as FeedbackCategory] },
      ];
    },
  };
  await handleCapture(req, deps);
  assert.strictEqual(recordedMultiple.length, 1);
  assert.deepStrictEqual(recordedMultiple[0].pageIds, ["page_1", "page_2"]);
});

test("batch split — sibling links written for each row (pass 2)", async () => {
  const { deps } = makeDeps();
  const siblingUpdates: Array<{ pageId: string; siblingPageIds: string[] }> = [];
  let pageSeq = 0;
  deps.notion.createFeedback = async () => `page_${++pageSeq}`;
  (deps.notion as any).updateSiblingLinks = async (pageId: string, siblingPageIds: string[]) => {
    siblingUpdates.push({ pageId, siblingPageIds });
  };
  deps.enricher = {
    async enrich() {
      return [
        { summary: "Bug.", categories: ["Bug / Broken" as FeedbackCategory] },
        { summary: "Feature.", categories: ["Feature Request" as FeedbackCategory] },
        { summary: "UX issue.", categories: ["UX / Usability" as FeedbackCategory] },
      ];
    },
  };
  await handleCapture(req, deps);
  assert.strictEqual(siblingUpdates.length, 3);
  assert.deepStrictEqual(siblingUpdates[0], { pageId: "page_1", siblingPageIds: ["page_2", "page_3"] });
  assert.deepStrictEqual(siblingUpdates[1], { pageId: "page_2", siblingPageIds: ["page_1", "page_3"] });
  assert.deepStrictEqual(siblingUpdates[2], { pageId: "page_3", siblingPageIds: ["page_1", "page_2"] });
});

test("batch split — sibling link failure does not roll back rows (fail-open)", async () => {
  const { deps, writes } = makeDeps();
  let pageSeq = 0;
  deps.notion.createFeedback = async (r) => { writes.push(r); return `page_${++pageSeq}`; };
  (deps.notion as any).updateSiblingLinks = async () => { throw new Error("notion down"); };
  deps.enricher = {
    async enrich() {
      return [
        { summary: "Bug.", categories: ["Bug / Broken" as FeedbackCategory] },
        { summary: "Feature.", categories: ["Feature Request" as FeedbackCategory] },
      ];
    },
  };
  const res = await handleCapture(req, deps);
  assert.strictEqual(res.status, "captured");
  assert.strictEqual(writes.length, 2);
});

test("single result — still works with array return (non-split path)", async () => {
  const { deps, writes } = makeDeps();
  deps.enricher = {
    async enrich() {
      return [{ summary: "SSO feature request.", categories: ["Feature Request" as FeedbackCategory] }];
    },
  };
  await handleCapture(req, deps);
  assert.strictEqual(writes.length, 1);
  assert.strictEqual(writes[0].summary, "SSO feature request.");
  // Single-item should NOT set sourceMessageKey
  assert.strictEqual(writes[0].sourceMessageKey, undefined);
});

test("re-reaction on a batch key appends flagger to all stored page IDs", async () => {
  const { deps, appendedFlaggers } = makeDeps();
  const store = new Map<string, string | string[]>();
  const key = `${req.channelId}:${req.messageTs}`;
  store.set(key, ["page_1", "page_2", "page_3"]);
  deps.dedup.has = (k) => store.has(k);
  deps.dedup.getPageIds = (k) => {
    const v = store.get(k);
    if (!v) return [];
    if (Array.isArray(v)) return v;
    return [v];
  };
  deps.dedup.getPageId = (k) => {
    const v = store.get(k);
    if (!v) return null;
    if (Array.isArray(v)) return v[0] ?? null;
    return v as string;
  };
  const res = await handleCapture(req, deps);
  assert.strictEqual(res.status, "flagger_added");
  assert.strictEqual(appendedFlaggers.length, 3);
  assert.deepStrictEqual(appendedFlaggers.map(f => f.pageId), ["page_1", "page_2", "page_3"]);
});
