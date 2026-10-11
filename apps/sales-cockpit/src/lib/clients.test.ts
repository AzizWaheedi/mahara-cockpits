import { describe, expect, test } from "bun:test";
import { CLIENT_NOTE, isClient, isSignedClient } from "./clients";

describe("isClient", () => {
  test("the client tag, in any case", () => {
    expect(isClient({ tags: ["roas-qualified", "client"] })).toBe(true);
    expect(isClient({ tags: ["Client"] })).toBe(true);
  });
  test("a tag that only contains the word is not the tag", () => {
    expect(isClient({ tags: ["client-referral", "clients"] })).toBe(false);
  });
  test("no tags or no lead", () => {
    expect(isClient({ tags: [] })).toBe(false);
    expect(isClient({ tags: null })).toBe(false);
    expect(isClient(null)).toBe(false);
  });
});

describe("isSignedClient: the tag, or a deal that is not voided", () => {
  const lead = { contact_id: "lead-13", tags: ["roas-qualified"] };
  test("a live deal makes the lead a client without the tag", () => {
    expect(
      isSignedClient(lead, [{ contact_id: "lead-13", voided: false }]),
    ).toBe(true);
  });
  test("the tag alone", () => {
    expect(isSignedClient({ ...lead, tags: ["client"] }, [])).toBe(true);
  });
  test("a voided deal, or none: not a client", () => {
    expect(
      isSignedClient(lead, [{ contact_id: "lead-13", voided: true }]),
    ).toBe(false);
    expect(isSignedClient(lead, [])).toBe(false);
    expect(isSignedClient(lead, null)).toBe(false);
    expect(isSignedClient(null, undefined)).toBe(false);
  });
  test("a deal that names another lead is not this one's", () => {
    expect(
      isSignedClient(lead, [{ contact_id: "lead-14", voided: false }]),
    ).toBe(false);
  });
  test("a deal with no contact on it, read for this lead, counts", () => {
    expect(isSignedClient(lead, [{ contact_id: null, voided: false }])).toBe(
      true,
    );
  });
});

test("the note says where clients are now, with no dashes", () => {
  expect(CLIENT_NOTE).toBe(
    "An active client. They sit in Closed on the pipeline and stay out of the dialer, the follow-ups and the hot list. Client success looks after them.",
  );
  expect(CLIENT_NOTE).not.toMatch(/[–—]/);
});
