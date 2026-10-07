import { describe, expect, it } from "bun:test";
import { parseTapChargePage } from "./tapResponse";

describe("Tap captured-charge page", () => {
  it("treats Tap's 1249 empty window as a successful empty page", () => {
    expect(parseTapChargePage(400, JSON.stringify({ errors: [{ code: "1249", description: "Charges not found" }], http_code: "404" })))
      .toEqual({ charges: [], hasMore: false });
  });
  it("keeps real captured charges and pagination", () => {
    expect(parseTapChargePage(200, JSON.stringify({ charges: [{ id: "chg_1" }], has_more: true })))
      .toEqual({ charges: [{ id: "chg_1" }], hasMore: true });
  });
  it("does not mask authorization or mixed errors", () => {
    expect(() => parseTapChargePage(401, JSON.stringify({ errors: [{ code: "1249" }] }))).toThrow("HTTP 401");
    expect(() => parseTapChargePage(400, JSON.stringify({ errors: [{ code: "1249" }, { code: "400" }] }))).toThrow("codes: 1249,400");
    expect(() => parseTapChargePage(400, "not json")).toThrow("invalid JSON");
    expect(() => parseTapChargePage(200, JSON.stringify({ errors: [{ code: "1249" }] }))).toThrow("without a charges array");
  });
});
