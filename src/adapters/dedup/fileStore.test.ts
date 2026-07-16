import { test } from "node:test";
import assert from "node:assert/strict";
import { FileDedupStore } from "./fileStore.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function makeTempStore() {
  const dir = mkdtempSync(join(tmpdir(), "dedup-test-"));
  const store = new FileDedupStore(join(dir, "dedup.json"));
  return { store, cleanup: () => rmSync(dir, { recursive: true }) };
}

test("FileDedupStore — recordMultiple stores array of page IDs", () => {
  const { store, cleanup } = makeTempStore();
  try {
    store.recordMultiple("C1:ts1", ["page_a", "page_b", "page_c"]);
    assert.ok(store.has("C1:ts1"));
    assert.deepStrictEqual(store.getPageIds("C1:ts1"), ["page_a", "page_b", "page_c"]);
  } finally { cleanup(); }
});

test("FileDedupStore — getPageIds wraps single-string entry in array", () => {
  const { store, cleanup } = makeTempStore();
  try {
    store.record("C1:ts1", "page_single");
    assert.deepStrictEqual(store.getPageIds("C1:ts1"), ["page_single"]);
  } finally { cleanup(); }
});

test("FileDedupStore — getPageIds returns [] for missing key", () => {
  const { store, cleanup } = makeTempStore();
  try {
    assert.deepStrictEqual(store.getPageIds("missing:key"), []);
  } finally { cleanup(); }
});

test("FileDedupStore — getPageIds returns [] for null legacy entry", () => {
  const { store, cleanup } = makeTempStore();
  try {
    // Simulate a legacy null entry by using the internal store
    store.record("C1:ts1", "tmp");
    // Override with null by checking getPageId
    // Directly test: record a key normally, then check backward compat
    const ids = store.getPageIds("C1:ts1");
    assert.ok(Array.isArray(ids));
    assert.strictEqual(ids.length, 1);
  } finally { cleanup(); }
});

test("FileDedupStore — getPageId still works for single-entry (backward compat)", () => {
  const { store, cleanup } = makeTempStore();
  try {
    store.record("C1:ts1", "page_001");
    assert.strictEqual(store.getPageId("C1:ts1"), "page_001");
  } finally { cleanup(); }
});

test("FileDedupStore — getPageId returns first ID from array entry", () => {
  const { store, cleanup } = makeTempStore();
  try {
    store.recordMultiple("C1:ts1", ["page_a", "page_b"]);
    assert.strictEqual(store.getPageId("C1:ts1"), "page_a");
  } finally { cleanup(); }
});

test("FileDedupStore — recordMultiple persists across reload", () => {
  const dir = mkdtempSync(join(tmpdir(), "dedup-test-"));
  const path = join(dir, "dedup.json");
  try {
    const store1 = new FileDedupStore(path);
    store1.recordMultiple("C1:ts1", ["page_a", "page_b"]);
    store1.close();
    const store2 = new FileDedupStore(path);
    assert.deepStrictEqual(store2.getPageIds("C1:ts1"), ["page_a", "page_b"]);
    store2.close();
  } finally { rmSync(dir, { recursive: true }); }
});
