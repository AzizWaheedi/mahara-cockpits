import { describe, expect, test } from "bun:test";
import { shouldSkipDraft } from "../convex/replyDraftRules";

// Regression: a declined WhatsApp draft was re-queued every 30 minutes forever
// (hermes-ask-ai incident, 4 Oct 2026). Fictional fixtures only.
const NOW = 1_800_000_000_000;
const MSG = 1_799_999_000_000;

describe("shouldSkipDraft", () => {
  test("no draft yet: queue it", () => {
    expect(shouldSkipDraft(undefined, MSG, NOW)).toBe(false);
  });
  test("done for this message: skip", () => {
    expect(shouldSkipDraft({ lastAt: MSG, status: "done", at: NOW - 86_400_000 }, MSG, NOW)).toBe(true);
  });
  test("declined for this message: skip, even hours later", () => {
    expect(shouldSkipDraft({ lastAt: MSG, status: "declined", at: NOW - 6 * 3_600_000 }, MSG, NOW)).toBe(true);
  });
  test("still queued under 30 min: skip", () => {
    expect(shouldSkipDraft({ lastAt: MSG, status: "queued", at: NOW - 10 * 60_000 }, MSG, NOW)).toBe(true);
  });
  test("queued and never came back after 30 min: ask again", () => {
    expect(shouldSkipDraft({ lastAt: MSG, status: "queued", at: NOW - 31 * 60_000 }, MSG, NOW)).toBe(false);
  });
  test("a new message after a decline: draft it", () => {
    expect(shouldSkipDraft({ lastAt: MSG, status: "declined", at: NOW }, MSG + 1, NOW)).toBe(false);
  });
});
