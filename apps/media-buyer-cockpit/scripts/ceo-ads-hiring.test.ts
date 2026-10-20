import { expect, test } from "bun:test";
import { isHiringCampaign, roleOf } from "../src/pages/ceo/hiringRoles";

// The live hiring campaigns on 2026-10-20, and the form role each one feeds.
test("hiring campaigns map to the role whose form counts the applications", () => {
  expect(isHiringCampaign("CSR Hiring | MaharaMedia | 5-3-26")).toBe(true);
  expect(roleOf("CSR Hiring | MaharaMedia | 5-3-26")?.key).toBe("call-centre");
  expect(roleOf("CSM Hiring | 13-7-26")?.key).toBe("csm");
  expect(roleOf("Closer Hiring | 8-3-26")?.key).toBe("sales-closer");
  expect(isHiringCampaign("[MhM] Hammer Them Strategy [SFC] | 24-5-26")).toBe(
    false,
  );
  expect(isHiringCampaign("MaharaMedia | Lead Gen")).toBe(false);
  // A hiring campaign that names no role gets no guessed count.
  expect(roleOf("Hiring | Oct")).toBe(null);
});
