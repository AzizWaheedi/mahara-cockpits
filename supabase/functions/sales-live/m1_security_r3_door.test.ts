// bun test supabase/functions/sales-live/m1_security_r3_door.test.ts
//
// Milestone 1, video-link round 3, security angle (the door): a Zoom host
// token whose parameter name is escaped as capital letters.

import { describe, expect, test } from "bun:test";
import { safeJoinUrl } from "./door.ts";
import { redact } from "./util.ts";

describe("m1 security r3: a Zoom host token escaped as capital letters (door)", () => {
  test("control: zak=, ZAK= and %7Aak= are refused by /open and /go and redacted (the fixture works)", () => {
    for (const n of ["zak", "ZAK", "%7Aak"]) {
      const url = `https://us06web.zoom.us/j/81234567890?pwd=abc&${n}=hosttoken123`;
      expect([n, safeJoinUrl(url)]).toEqual([n, null]);
      expect([n, redact(url).includes("hosttoken123")]).toEqual([n, false]);
    }
  });

  test("host-link-escaped-zak-capitals (door): ?%5A%41%4B= (ZAK once decoded) is opened for the code's holder and kept whole by the door's redact", () => {
    expect(decodeURIComponent("%5A%41%4B").toLowerCase()).toBe("zak");
    const url = "https://us06web.zoom.us/j/81234567890?pwd=abc&%5A%41%4B=hosttoken123";
    expect(safeJoinUrl(url)).toBeNull();
    expect(redact(url)).not.toContain("hosttoken123");
  });
});
