import { test } from "node:test";
import assert from "node:assert/strict";
import { FileDedupStore } from "./fileStore.js";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
  const dir = mkdtempSync(join(tmpdir(), "dedup-test-"));
  const path = join(dir, "dedup.json");
  try {
    // Write a raw JSON file with a null entry to simulate legacy data
    writeFileSync(path, JSON.stringify({ "C1:ts1": null }), "utf8");
    const store = new FileDedupStore(path);
    assert.deepStrictEqual(store.getPageIds("C1:ts1"), []);
  } finally { rmSync(dir, { recursive: true }); }
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
