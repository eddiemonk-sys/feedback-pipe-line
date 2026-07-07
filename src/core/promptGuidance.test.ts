import { test } from "node:test";
import assert from "node:assert/strict";
import { appendGuidance } from "./promptGuidance.js";

const BASE = "You are a classifier. Do the thing.";

test("returns the base prompt unchanged when the guide is empty", () => {
  assert.equal(appendGuidance(BASE, ""), BASE);
});

test("returns the base prompt unchanged when the guide is only whitespace", () => {
  assert.equal(appendGuidance(BASE, "   \n  \t "), BASE);
});

test("returns the base prompt unchanged when the guide is undefined", () => {
  assert.equal(appendGuidance(BASE), BASE);
});

test("appends the guide under a header, after the base, when non-empty", () => {
  const guide = "P1 — Separate distinct points.";
  const out = appendGuidance(BASE, guide);
  assert.ok(out.startsWith(BASE), "base prompt should come first");
  assert.ok(
    out.includes("## Additional guidance (learned from human review)"),
    "should include the guidance header",
  );
  assert.ok(out.includes(guide), "should include the guide text");
});

test("trims surrounding whitespace off the guide before appending", () => {
  const out = appendGuidance(BASE, "\n\n  P1 — Separate distinct points.  \n");
  assert.ok(out.includes("P1 — Separate distinct points."));
  assert.ok(!out.includes("  P1"), "leading padding should be trimmed");
});
