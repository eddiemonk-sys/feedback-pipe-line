import { test } from "node:test";
import assert from "node:assert/strict";
import { isScannable, type RawSlackMessage } from "./filter.js";

const opts = { botUserId: "UBOT", triggerEmoji: "mega" };
const base: RawSlackMessage = { ts: "1.1", user: "Ualice", text: "The export button is broken", hasImage: false };

test("keeps an ordinary user message with text", () => {
  assert.equal(isScannable(base, opts), true);
});

test("keeps a text-less message that has an image", () => {
  assert.equal(isScannable({ ts: "1.2", user: "Ualice", text: "", hasImage: true }, opts), true);
});

test("drops the bot's own messages", () => {
  assert.equal(isScannable({ ...base, user: "UBOT" }, opts), false);
});

test("drops system messages (any subtype)", () => {
  assert.equal(isScannable({ ...base, subtype: "channel_join" }, opts), false);
});

test("drops messages with no text and no image", () => {
  assert.equal(isScannable({ ts: "1.3", user: "Ualice", text: "   ", hasImage: false }, opts), false);
});

test("drops messages already carrying the trigger emoji", () => {
  assert.equal(isScannable({ ...base, reactions: ["mega"] }, opts), false);
});
