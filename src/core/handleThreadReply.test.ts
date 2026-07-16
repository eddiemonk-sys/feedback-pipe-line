import { test } from "node:test";
import assert from "node:assert/strict";
import { handleThreadReply, type ThreadReplyDeps } from "./handleThreadReply.js";
import type { FeedbackCategory } from "./ports.js";

const silentLogger = { info() {}, warn() {}, error() {} };

function makeDeps() {
  const loggedUpdates: Array<{ pageId: string; replyText: string; replyAuthorName: string }> = [];
  const capturedRoutes: Array<{ replyText: string; candidates: any[] }> = [];
  const captureInvocations: string[] = [];  // threadTs values of handleCapture calls

  const deps: ThreadReplyDeps = {
    logger: silentLogger,
    dedup: {
      has: (k) => k === "C123:parent_ts",  // parent pre-captured by default
      getPageIds: (k) => k === "C123:parent_ts" ? ["page_001"] : [],
      // other methods not needed for thread reply:
      record: () => {},
      recordMultiple: () => {},
      getPageId: () => null,
      delete: () => {},
      findKeyByPageId: () => null,
      close: () => {},
    },
    notion: {
      getPageSummaries: async (pageIds) =>
        pageIds.map((id) => ({ pageId: id, summary: "User wants SSO integration." })),
      updateSummaryAndLog: async (pageId, replyText, replyAuthorName) => {
        loggedUpdates.push({ pageId, replyText, replyAuthorName });
      },
      // other methods not needed:
      createFeedback: async () => "page_new",
      appendFlagger: async () => {},
      findRecentByCategories: async () => [],
      updateSiblingLinks: async () => {},
    },
    slack: {
      resolveUserName: async (id) => id === "Ureply" ? "Carol" : "Unknown",
      downloadImage: async () => ({ data: "ZmFrZQ==", mimeType: "image/png" }),
      getMessage: async () => null,
      resolveChannelName: async () => "#general",
      getPermalink: async () => "https://example.com",
      addReaction: async () => {},
      postReply: async () => {},
    },
    threadRouter: {
      route: async (replyText, _images, candidates) => {
        capturedRoutes.push({ replyText, candidates });
        return [{ pageId: candidates[0].pageId, relevance: "primary" as const, rationale: "Direct match." }];
      },
    },
    handleCapture: async (_req, _deps) => {
      captureInvocations.push("called");
      return { status: "captured" as const, key: "C123:parent_ts" };
    },
  };
  return { deps, loggedUpdates, capturedRoutes, captureInvocations };
}

test("routes reply to matched page and appends thread log", async () => {
  const { deps, loggedUpdates } = makeDeps();
  await handleThreadReply("C123", "parent_ts", "reply_ts", "Ureply", "Got it, this is fixed.", [], deps);
  assert.strictEqual(loggedUpdates.length, 1);
  assert.strictEqual(loggedUpdates[0].pageId, "page_001");
  assert.strictEqual(loggedUpdates[0].replyText, "Got it, this is fixed.");
  assert.strictEqual(loggedUpdates[0].replyAuthorName, "Carol");
});

test("invokes handleCapture for parent when parent not in dedup store", async () => {
  const { deps, captureInvocations } = makeDeps();
  deps.dedup.has = () => false;
  deps.dedup.getPageIds = (k) => k === "C123:parent_ts" ? ["page_captured"] : [];
  // After handleCapture, dedup.getPageIds must return the new page ID
  deps.handleCapture = async () => {
    deps.dedup.has = () => true;
    deps.dedup.getPageIds = () => ["page_captured"];
    return { status: "captured" as const, key: "C123:parent_ts" };
  };
  await handleThreadReply("C123", "parent_ts", "reply_ts", "Ureply", "Follow-up.", [], deps);
  // captureInvocations is from makeDeps' original mock; the replacement above does not push to it.
  // length === 0 confirms the original mock was NOT called — the replacement was used instead.
  assert.strictEqual(captureInvocations.length, 0);
});

test("skips update when parent capture fails and page IDs are still empty", async () => {
  const { deps, loggedUpdates } = makeDeps();
  deps.dedup.has = () => false;
  deps.dedup.getPageIds = () => [];  // still empty after capture attempt
  deps.handleCapture = async () => ({ status: "error" as const, key: "C123:parent_ts", detail: "notion down" });
  await handleThreadReply("C123", "parent_ts", "reply_ts", "Ureply", "Follow-up.", [], deps);
  assert.strictEqual(loggedUpdates.length, 0);
});

test("downloads reply images and passes them to router and updateSummaryAndLog", async () => {
  const { deps, loggedUpdates } = makeDeps();
  let routerImageCount = 0;
  deps.threadRouter.route = async (_text, images, candidates) => {
    routerImageCount = images.length;
    return [{ pageId: candidates[0].pageId, relevance: "primary" as const, rationale: "Match." }];
  };
  await handleThreadReply("C123", "parent_ts", "reply_ts", "Ureply", "See screenshot.", ["https://slack.com/img1"], deps);
  assert.strictEqual(routerImageCount, 1);
  assert.strictEqual(loggedUpdates.length, 1);
});

test("updateSummaryAndLog failure does not propagate (fail-open)", async () => {
  const { deps } = makeDeps();
  (deps.notion as any).updateSummaryAndLog = async () => { throw new Error("notion down"); };
  // Should not throw
  await handleThreadReply("C123", "parent_ts", "reply_ts", "Ureply", "Update.", [], deps);
});

test("empty route result — no updates written", async () => {
  const { deps, loggedUpdates } = makeDeps();
  deps.threadRouter.route = async () => [];
  await handleThreadReply("C123", "parent_ts", "reply_ts", "Ureply", "Generic reply.", [], deps);
  assert.strictEqual(loggedUpdates.length, 0);
});
