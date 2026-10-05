// bun test supabase/functions/sales-live/m1_security_r1_door.test.ts
//
// Milestone 1, video-link round 1, security angle at the door: a Zoom host
// link must never be handed to whoever holds a room's code, and never reach a
// log or a status row. Pure functions; no network.

import { describe, expect, test } from "bun:test";
import { safeJoinUrl } from "./door.ts";
import { redact } from "./util.ts";

describe("m1 security r1: a Zoom host link written with an escaped parameter name (door)", () => {
  // Zoom reads %7A as z in a query parameter's name, so ?%7Aak= is zak=: the
  // host's own sign-in on any Zoom link.
  const ESCAPED = "https://us06web.zoom.us/j/81234567890?pwd=abc&%7Aak=hosttoken123";

  test("control: the plain zak= form is refused and redacted (the fixture works)", () => {
    expect(safeJoinUrl("https://us06web.zoom.us/j/81234567890?pwd=abc&zak=hosttoken123")).toBeNull();
    expect(redact("https://us06web.zoom.us/j/81234567890?zak=hosttoken123")).not.toContain("hosttoken123");
    expect(safeJoinUrl("https://us06web.zoom.us/j/81234567890?pwd=abc")).toBe("https://us06web.zoom.us/j/81234567890?pwd=abc");
  });

  test("host-link-escaped-zak (door): a join link carrying %7Aak= is opened for the code's holder and kept whole by the door's redact", () => {
    expect(safeJoinUrl(ESCAPED)).toBeNull();
    expect(redact(`database 400: ${ESCAPED}`)).not.toContain("hosttoken123");
  });
});
