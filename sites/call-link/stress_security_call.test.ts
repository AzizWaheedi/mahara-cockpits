// bun test sites/call-link/stress_security_call.test.ts
//
// Security stress of the short page's own rules (core.js), round 1,
// 3 October 2026: whatever the address bar or a tampered /open answer holds,
// the page only ever opens Zoom's or Meet's own https links, never shows
// markup, and reads nothing but the code from the address. call.js writes
// every line with textContent, and the site's CSP allows scripts from 'self'
// only, so these rules are the page's last gate.

import { describe, expect, test } from "bun:test";

const C = require("./core.js");

describe("security: the page's address", () => {
  test("only a six-letter code is ever read from the path or ?c=, whatever else is there", () => {
    for (const p of [
      "/K7Q2MX<script>alert(1)</script>",
      "/K7Q2MX%3Cimg%20src%3Dx%20onerror%3Dalert(1)%3E",
      "/javascript:alert(1)",
      "/%2e%2e/%2e%2e/etc/passwd",
      "/K7Q2MX%00",
      `/${"K".repeat(5000)}`,
    ]) {
      const c = C.codeFromPath(p);
      expect([p, c === null || /^[A-HJ-NP-Z2-9]{6}$/.test(c)]).toEqual([p, true]);
    }
    for (const s of ["?c=K7Q2MX&c=EVIL22", "?c=<b>K7Q2MX</b>", "?c=K7Q2MX%22onmouseover%3D", "?c=javascript:alert(1)"]) {
      const c = C.endedCode(s);
      expect([s, c === null || /^[A-HJ-NP-Z2-9]{6}$/.test(c)]).toEqual([s, true]);
    }
  });
});

describe("security: a tampered /open answer", () => {
  test("a join link that is not Zoom's or Meet's own https host is an error, never a link to open", () => {
    for (const join_url of [
      "javascript:alert(document.cookie)",
      "data:text/html,<script>alert(1)</script>",
      "https://zoom.us.evil.example/j/1",
      "https://evil.example/#https://zoom.us/j/1",
      "https://zoom.us@evil.example/j/1",
      "http://zoom.us/j/1",
      "https://meet.google.com.evil.example/abc-defg-hij",
      "//evil.example",
      "https://evil.example\\@zoom.us/",
    ]) {
      const v = C.viewFor(200, { state: "open", join_url, provider: "zoom", rep: { en: "A", ar: null } });
      expect([join_url, v.state]).toEqual([join_url, "error"]);
    }
  });

  test("the WhatsApp button only ever goes to wa.me with digits", () => {
    for (const whatsapp of ["javascript:alert(1)", "+965 9005 4963\"><script>", "https://evil.example/96590054963", "12"]) {
      const v = C.viewFor(200, { state: "ended", whatsapp, rep: {} });
      expect([whatsapp, v.whatsapp === null || /^https:\/\/wa\.me\/\d{8,15}$/.test(v.whatsapp)]).toEqual([whatsapp, true]);
    }
  });

  test("a rep name with markup stays text: the lines are strings, written with textContent", () => {
    const v = C.viewFor(200, { state: "preparing", rep: { en: "<img src=x onerror=alert(1)>", ar: null }, retry_ms: 10 });
    const lines = C.linesFor({ ...v, state: "opening" });
    expect(typeof lines.en).toBe("string");
    // The wait is bounded whatever the door says, so a tampered answer cannot make the page hammer the door.
    expect(v.retryMs).toBeGreaterThanOrEqual(500);
    expect(C.viewFor(200, { state: "preparing", retry_ms: 1 }).retryMs).toBe(2000);
  });
});
