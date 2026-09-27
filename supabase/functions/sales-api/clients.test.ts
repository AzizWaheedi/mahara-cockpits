import { describe, expect, test } from "bun:test";
import { isClient } from "./clients.ts";

describe("isClient", () => {
  test("the client tag, as HighLevel keeps it", () => {
    expect(isClient({ tags: ["roas-qualified", "client"] })).toBe(true);
  });
  test("any case or stray spaces", () => {
    expect(isClient({ tags: [" Client "] })).toBe(true);
  });
  test("a tag that only contains the word is not the tag", () => {
    expect(isClient({ tags: ["client-referral", "ex client", "clients"] })).toBe(false);
  });
  test("no tags, no lead, tags not a list", () => {
    expect(isClient({ tags: null })).toBe(false);
    expect(isClient({})).toBe(false);
    expect(isClient(null)).toBe(false);
    expect(isClient(undefined)).toBe(false);
    expect(isClient({ tags: "client" })).toBe(false);
  });
});
