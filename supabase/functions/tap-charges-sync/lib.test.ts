// bun test supabase/functions/tap-charges-sync
import { describe, expect, test } from "bun:test";
import { isNoChargesAnswer } from "./lib.ts";

describe("isNoChargesAnswer", () => {
  test("Tap's 'Charges not found' for an empty window is an empty page", () => {
    const body = JSON.stringify({
      errors: [{ code: "1249", description: "Charges not found" }],
      http_code: "404",
    });
    expect(isNoChargesAnswer(400, body)).toBe(true);
    expect(isNoChargesAnswer(404, body)).toBe(true);
  });

  test("other Tap errors still fail the run", () => {
    const auth = JSON.stringify({ errors: [{ code: "2107", description: "Invalid API key" }] });
    expect(isNoChargesAnswer(401, auth)).toBe(false);
    const mixed = JSON.stringify({
      errors: [
        { code: "1249", description: "Charges not found" },
        { code: "1100", description: "Invalid date" },
      ],
    });
    expect(isNoChargesAnswer(400, mixed)).toBe(false);
    expect(isNoChargesAnswer(400, JSON.stringify({ errors: [] }))).toBe(false);
    expect(isNoChargesAnswer(400, "<html>bad gateway</html>")).toBe(false);
  });

  test("server errors and success codes are never read as empty", () => {
    const body = JSON.stringify({ errors: [{ code: "1249", description: "Charges not found" }] });
    expect(isNoChargesAnswer(500, body)).toBe(false);
    expect(isNoChargesAnswer(200, body)).toBe(false);
  });
});
