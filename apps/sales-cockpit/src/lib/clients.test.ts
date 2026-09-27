import { describe, expect, test } from "bun:test";
import { isClient } from "./clients";

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
