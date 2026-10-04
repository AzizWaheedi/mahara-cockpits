// bun test supabase/functions/tap-charges-sync
import { describe, expect, test } from "bun:test";
import { isEmptyChargesAnswer } from "./lib.ts";

// Regression for guardian incident tap-charges (4 Oct 2026). Made-up bodies only.
const EMPTY = JSON.stringify({ errors: [{ code: "1249", description: "Charges not found" }], http_code: "404" });

describe("isEmptyChargesAnswer", () => {
  test("Tap's 400 + 1249 'Charges not found' is an empty page", () => {
    expect(isEmptyChargesAnswer(400, EMPTY)).toBe(true);
  });
  test("the same as a plain 404 is an empty page", () => {
    expect(isEmptyChargesAnswer(404, EMPTY)).toBe(true);
  });
  test("an auth error is still a failure", () => {
    expect(isEmptyChargesAnswer(401, JSON.stringify({ errors: [{ code: "2107", description: "Invalid key" }] }))).toBe(false);
  });
  test("a 400 with another code is still a failure", () => {
    expect(isEmptyChargesAnswer(400, JSON.stringify({ errors: [{ code: "1108", description: "Invalid date" }] }))).toBe(false);
  });
  test("1249 mixed with a real error is still a failure", () => {
    expect(isEmptyChargesAnswer(400, JSON.stringify({ errors: [{ code: "1249" }, { code: "1108" }] }))).toBe(false);
  });
  test("a body that is not JSON is still a failure", () => {
    expect(isEmptyChargesAnswer(400, "<html>bad gateway</html>")).toBe(false);
  });
  test("a 500 is still a failure", () => {
    expect(isEmptyChargesAnswer(500, EMPTY)).toBe(false);
  });
});
