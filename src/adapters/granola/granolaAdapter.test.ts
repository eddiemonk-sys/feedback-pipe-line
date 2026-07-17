import { test } from "node:test";
import assert from "node:assert/strict";
import { startGranolaPoller, type GranolaPollerDeps, type GranolaPollerOptions } from "./granolaAdapter.js";
import { NullGranolaGate } from "./nullGranolaGate.js";
import type {
  GranolaClient,
  GranolaNote,
  GranolaGate,
  GranolaGateResult,
  Enricher,
  EnrichmentResult,
  Judge,
  JudgeVerdict,
  NotionWriter,
  FeedbackRecord,
  DedupStore,
  SimilarityDetector,
  FeedbackCategory,
} from "../../core/ports.js";
import type { Logger } from "../../util/logger.js";

// ─── Stubs ────────────────────────────────────────────────────────────────────

function makeLogger(): Logger {
  return {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  };
}

function makeGranolaClient(notes: GranolaNote[], contentMap: Record<string, string>): GranolaClient {
  return {
    async listNotes(_folderId) {
      return notes;
    },
    async getNoteContent(noteId) {
      return contentMap[noteId] ?? "";
    },
  };
}

function makeEnricher(results: EnrichmentResult[] | null): Enricher {
  return {
    async enrich() {
      return results;
    },
  };
}

function makeJudge(verdict: JudgeVerdict | null): Judge {
  return {
    async review() {
      return verdict;
    },
  };
}

class StubNotionWriter implements NotionWriter {
  public created: FeedbackRecord[] = [];
  public siblingUpdates: Array<{ pageId: string; siblingPageIds: string[] }> = [];
  private idSeq = 0;

  async createFeedback(record: FeedbackRecord): Promise<string> {
    this.created.push(record);
    return `page-${++this.idSeq}`;
  }

  async appendFlagger(_pageId: string, _name: string): Promise<void> {}

  async findRecentByCategories(
    _categories: FeedbackCategory[],
    _since: string,
  ): Promise<Array<{ pageId: string; summary: string }>> {
    return [];
  }

  async updateSiblingLinks(pageId: string, siblingPageIds: string[]): Promise<void> {
    this.siblingUpdates.push({ pageId, siblingPageIds });
  }

  async updateSummaryAndLog(): Promise<void> {}

  async getPageSummaries(): Promise<Array<{ pageId: string; summary: string }>> {
    return [];
  }
}

class StubDedupStore implements DedupStore {
  private store: Map<string, string[]> = new Map();

  has(key: string): boolean {
    return this.store.has(key);
  }

  record(key: string, pageId: string): void {
    this.store.set(key, [pageId]);
  }

  recordMultiple(key: string, pageIds: string[]): void {
    this.store.set(key, pageIds);
  }

  getPageId(key: string): string | null {
    return this.store.get(key)?.[0] ?? null;
  }

  getPageIds(key: string): string[] {
    return this.store.get(key) ?? [];
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  findKeyByPageId(pageId: string): string | null {
    for (const [key, ids] of this.store) {
      if (ids.includes(pageId)) return key;
    }
    return null;
  }

  close(): void {}
}

function makeNullSimilarityDetector(): SimilarityDetector {
  return {
    async findSimilar() {
      return null;
    },
  };
}

function makeDeps(overrides: Partial<GranolaPollerDeps> = {}): GranolaPollerDeps {
  return {
    granolaClient: makeGranolaClient([], {}),
    gate: new NullGranolaGate(),
    enricher: makeEnricher([{ summary: "Test summary.", categories: ["Feature Request"] }]),
    judge: makeJudge(null),
    notion: new StubNotionWriter(),
    dedup: new StubDedupStore(),
    similarityDetector: makeNullSimilarityDetector(),
    similarityWindowDays: 30,
    ...overrides,
  };
}

function makeOptions(overrides: Partial<GranolaPollerOptions> = {}): GranolaPollerOptions {
  return {
    folderId: "test-folder-id",
    pollIntervalMs: 999_999_999, // effectively never fires again after first tick
    ...overrides,
  };
}

// Helper: wait for the tick to complete (first tick fires synchronously via void tick())
function waitTick(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test("NullGranolaGate — always returns shouldCapture=true", async () => {
  const gate = new NullGranolaGate();
  const result = await gate.classify("Title", "Content", []);
  assert.strictEqual(result.shouldCapture, true);
});

test("GranolaAdapter — skips note already in dedup store", async () => {
  const note: GranolaNote = { id: "note-1", title: "Test", createdAt: "2026-07-17" };
  const notion = new StubNotionWriter();
  const dedup = new StubDedupStore();
  dedup.record("granola:note-1", "existing-page");

  const deps = makeDeps({
    granolaClient: makeGranolaClient([note], { "note-1": "Some content" }),
    notion,
    dedup,
  });

  startGranolaPoller(makeOptions(), deps, makeLogger());
  await waitTick();

  assert.strictEqual(notion.created.length, 0, "Should not create a new page for already-seen note");
});

test("GranolaAdapter — gate returns shouldCapture=false → note skipped", async () => {
  const note: GranolaNote = { id: "note-2", title: "Internal standup", createdAt: "2026-07-17" };
  const notion = new StubNotionWriter();
  const dedup = new StubDedupStore();

  const skipGate: GranolaGate = {
    async classify(): Promise<GranolaGateResult> {
      return { shouldCapture: false, reason: "Internal-only meeting" };
    },
  };

  const deps = makeDeps({
    granolaClient: makeGranolaClient([note], { "note-2": "Internal content" }),
    gate: skipGate,
    notion,
    dedup,
  });

  startGranolaPoller(makeOptions(), deps, makeLogger());
  await waitTick();

  assert.strictEqual(notion.created.length, 0, "Gate-skipped note must not be written to Notion");
  assert.strictEqual(dedup.has("granola:note-2"), false, "Gate-skipped note must not be recorded in dedup");
});

test("GranolaAdapter — single enrichment item → 1 page created, dedup recorded", async () => {
  const note: GranolaNote = { id: "note-3", title: "QBR with Client", createdAt: "2026-07-17" };
  const notion = new StubNotionWriter();
  const dedup = new StubDedupStore();

  const deps = makeDeps({
    granolaClient: makeGranolaClient([note], { "note-3": "Client asked for bulk download feature." }),
    enricher: makeEnricher([{ summary: "Client wants bulk download.", categories: ["Feature Request"] }]),
    notion,
    dedup,
  });

  startGranolaPoller(makeOptions(), deps, makeLogger());
  await waitTick();

  assert.strictEqual(notion.created.length, 1, "Should create 1 page");
  assert.strictEqual(notion.created[0]!.source, "Granola");
  assert.strictEqual(notion.created[0]!.sourceMessageKey, "granola:note-3");
  assert.strictEqual(dedup.has("granola:note-3"), true, "Should record note in dedup after write");
  assert.deepStrictEqual(dedup.getPageIds("granola:note-3"), ["page-1"]);
});

test("GranolaAdapter — multi-item enrichment → N pages created with sibling links", async () => {
  const note: GranolaNote = { id: "note-4", title: "Multi-item QBR", createdAt: "2026-07-17" };
  const notion = new StubNotionWriter();
  const dedup = new StubDedupStore();

  const enrichments: EnrichmentResult[] = [
    { summary: "Client wants bulk download.", categories: ["Feature Request"] },
    { summary: "Report language is too technical.", categories: ["UX / Usability"] },
  ];

  const deps = makeDeps({
    granolaClient: makeGranolaClient([note], { "note-4": "Content with two items." }),
    enricher: makeEnricher(enrichments),
    notion,
    dedup,
  });

  startGranolaPoller(makeOptions(), deps, makeLogger());
  await waitTick();

  assert.strictEqual(notion.created.length, 2, "Should create 2 pages");
  assert.deepStrictEqual(dedup.getPageIds("granola:note-4"), ["page-1", "page-2"]);

  // Sibling links: each page links to the other
  assert.strictEqual(notion.siblingUpdates.length, 2);
  const update1 = notion.siblingUpdates.find((u) => u.pageId === "page-1");
  const update2 = notion.siblingUpdates.find((u) => u.pageId === "page-2");
  assert.ok(update1, "page-1 should have sibling update");
  assert.ok(update2, "page-2 should have sibling update");
  assert.deepStrictEqual(update1!.siblingPageIds, ["page-2"]);
  assert.deepStrictEqual(update2!.siblingPageIds, ["page-1"]);
});

test("GranolaAdapter — enricher returns null → note skipped (fail-open)", async () => {
  const note: GranolaNote = { id: "note-5", title: "QBR", createdAt: "2026-07-17" };
  const notion = new StubNotionWriter();
  const dedup = new StubDedupStore();

  const deps = makeDeps({
    granolaClient: makeGranolaClient([note], { "note-5": "Some content" }),
    enricher: makeEnricher(null),
    notion,
    dedup,
  });

  startGranolaPoller(makeOptions(), deps, makeLogger());
  await waitTick();

  assert.strictEqual(notion.created.length, 0, "Null enrichment → no pages created");
  assert.strictEqual(dedup.has("granola:note-5"), false, "Null enrichment → not recorded in dedup");
});

test("GranolaAdapter — empty note content → note skipped", async () => {
  const note: GranolaNote = { id: "note-6", title: "Empty", createdAt: "2026-07-17" };
  const notion = new StubNotionWriter();
  const dedup = new StubDedupStore();

  const deps = makeDeps({
    granolaClient: makeGranolaClient([note], { "note-6": "   " }),
    notion,
    dedup,
  });

  startGranolaPoller(makeOptions(), deps, makeLogger());
  await waitTick();

  assert.strictEqual(notion.created.length, 0, "Empty content → no pages created");
});

test("GranolaAdapter — gate null (fail-open) → note captured", async () => {
  const note: GranolaNote = { id: "note-7", title: "QBR", createdAt: "2026-07-17" };
  const notion = new StubNotionWriter();
  const dedup = new StubDedupStore();

  const failingGate: GranolaGate = {
    async classify(): Promise<GranolaGateResult | null> {
      return null; // simulates LLM failure
    },
  };

  const deps = makeDeps({
    granolaClient: makeGranolaClient([note], { "note-7": "Client said the export is broken." }),
    gate: failingGate,
    notion,
    dedup,
  });

  startGranolaPoller(makeOptions(), deps, makeLogger());
  await waitTick();

  assert.strictEqual(notion.created.length, 1, "Gate null (fail-open) → note captured");
});

test("GranolaAdapter — record.source is 'Granola'", async () => {
  const note: GranolaNote = { id: "note-8", title: "QBR", createdAt: "2026-07-17" };
  const notion = new StubNotionWriter();

  const deps = makeDeps({
    granolaClient: makeGranolaClient([note], { "note-8": "Client feedback content." }),
    notion,
  });

  startGranolaPoller(makeOptions(), deps, makeLogger());
  await waitTick();

  assert.strictEqual(notion.created[0]!.source, "Granola");
  assert.strictEqual(notion.created[0]!.flaggedByName, "Granola (auto)");
  assert.strictEqual(notion.created[0]!.channelName, "Granola");
});

test("GranolaAdapter — audience defaults to Unknown", async () => {
  const note: GranolaNote = { id: "note-9", title: "QBR", createdAt: "2026-07-17" };
  const notion = new StubNotionWriter();

  const deps = makeDeps({
    granolaClient: makeGranolaClient([note], { "note-9": "Client feedback content." }),
    notion,
  });

  startGranolaPoller(makeOptions(), deps, makeLogger());
  await waitTick();

  assert.strictEqual(notion.created[0]!.audience, "Unknown");
});
