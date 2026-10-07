import { describe, expect, test } from "bun:test";
import { hasGhlCredential, sourceGhlLink } from "../convex/ghlCredential";

describe("GHL credential compatibility", () => {
  test.each([
    "pit-00000000-0000-4000-8000-000000000000",
    "opaque_OAuth-location-token-1234567890",
    "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJmaXh0dXJlIn0.signature",
  ])("accepts supported bearer format without a PIT-only gate: %s", token => {
    expect(hasGhlCredential(token)).toBe(true);
  });

  test.each([
    undefined,
    null,
    123,
    "",
    "pit-short",
    "=A1",
    '=IMPORTDATA("https://example.test")',
    "https://example.test/not-a-credential",
    `${"a".repeat(20)}\n`,
    `${"a".repeat(20)} token`,
    "a".repeat(8193),
  ])("rejects absent, malformed or formula values", value => {
    expect(hasGhlCredential(value)).toBe(false);
  });
});

describe("GHL source location link", () => {
  const row = {
    clickupId: "fixtureTask1",
    ghlLocationId: "fixtureLocation12345",
  };
  test("keeps a known account visible independently of token renewal", () => {
    expect(sourceGhlLink(row, "fixtureTask1")).toBe(
      "https://app.maharamedia.com/v2/location/fixtureLocation12345/dashboard",
    );
  });
  test("does not use a row belonging to another client", () => {
    expect(sourceGhlLink(row, "otherTask")).toBeUndefined();
    expect(sourceGhlLink(row, "")).toBeUndefined();
    expect(sourceGhlLink(undefined, "fixtureTask1")).toBeUndefined();
  });
  test("rejects a malformed location rather than building an unsafe link", () => {
    expect(
      sourceGhlLink(
        { ...row, ghlLocationId: "../../settings" },
        "fixtureTask1",
      ),
    ).toBeUndefined();
  });
});
