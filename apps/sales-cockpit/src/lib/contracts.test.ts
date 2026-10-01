import { describe, expect, test } from "bun:test";
import { endedNote, isOpen, shareLine, stepOf } from "./contracts";

describe("stepOf", () => {
  test("follows HighLevel's statuses", () => {
    expect(stepOf({ status: "draft", viewed_at: null, signed_at: null })).toBe(
      0,
    );
    expect(stepOf({ status: "sent", viewed_at: null, signed_at: null })).toBe(
      1,
    );
    expect(stepOf({ status: "viewed", viewed_at: null, signed_at: null })).toBe(
      2,
    );
    expect(
      stepOf({ status: "completed", viewed_at: null, signed_at: null }),
    ).toBe(3);
  });
  test("a signed date wins over a lagging status", () => {
    expect(
      stepOf({
        status: "viewed",
        viewed_at: "2026-10-01",
        signed_at: "2026-10-01",
      }),
    ).toBe(3);
  });
});

describe("isOpen", () => {
  test("drafts and unsigned contracts are open; signed and declined are not", () => {
    expect(isOpen({ status: "draft", viewed_at: null, signed_at: null })).toBe(
      true,
    );
    expect(isOpen({ status: "viewed", viewed_at: "x", signed_at: null })).toBe(
      true,
    );
    expect(
      isOpen({ status: "completed", viewed_at: null, signed_at: "x" }),
    ).toBe(false);
    expect(
      isOpen({ status: "declined", viewed_at: null, signed_at: null }),
    ).toBe(false);
  });
});

describe("shareLine", () => {
  test("the link in the lead's language", () => {
    expect(shareLine("https://l/x", "en")).toBe(
      "Here is the contract. You can review and sign it here: https://l/x",
    );
    expect(shareLine("https://l/x", "ar")).toContain("https://l/x");
    expect(shareLine("https://l/x", "ar")).not.toContain("—");
  });
});

describe("ended contracts", () => {
  const deleted = {
    status: "deleted",
    viewed_at: null,
    signed_at: null,
    sent_at: "2026-10-01T14:24:00Z",
  };
  test("a contract deleted in HighLevel is no longer open, and keeps how far it got", () => {
    expect(isOpen(deleted)).toBe(false);
    expect(stepOf(deleted)).toBe(1);
  });
  test("says what happened and what to do", () => {
    expect(endedNote(deleted)).toBe(
      "Deleted in HighLevel. Make a new contract if they still want to sign.",
    );
    expect(
      endedNote({ status: "declined", viewed_at: "x", signed_at: null }),
    ).toBe(
      "HighLevel marks it declined. Make a new contract if they still want to sign.",
    );
  });
  test("open and signed contracts have no note", () => {
    expect(
      endedNote({ status: "sent", viewed_at: null, signed_at: null }),
    ).toBeNull();
    expect(
      endedNote({ status: "completed", viewed_at: null, signed_at: "x" }),
    ).toBeNull();
  });
});
