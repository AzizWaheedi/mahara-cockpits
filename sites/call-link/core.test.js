// bun test sites/call-link
import { describe, expect, test } from "bun:test";

const C = require("./core.js");

describe("the code in the path", () => {
  test("upper or lower case, with or without a trailing slash", () => {
    expect(C.codeFromPath("/K7Q2MX")).toBe("K7Q2MX");
    expect(C.codeFromPath("/k7q2mx")).toBe("K7Q2MX");
    expect(C.codeFromPath("/K7Q2MX/")).toBe("K7Q2MX");
    expect(C.codeFromPath("/k7q%202mx")).toBe("K7Q2MX");
  });

  test("anything else is no code", () => {
    for (const p of ["/", "", "/ended", "/K7Q2M0", "/K7Q2MXX", "/%E0%A4%A", "/index.html"])
      expect([p, C.codeFromPath(p)]).toEqual([p, null]);
  });
});

describe("language order", () => {
  test("Arabic leads on an Arabic phone, English otherwise, Arabic when unknown", () => {
    expect(C.langOrder(["ar-KW", "en-US"])).toEqual(["ar", "en"]);
    expect(C.langOrder(["ar"])).toEqual(["ar", "en"]);
    expect(C.langOrder(["en-GB", "ar"])).toEqual(["en", "ar"]);
    expect(C.langOrder(["fr-FR"])).toEqual(["en", "ar"]);
    expect(C.langOrder([])).toEqual(["ar", "en"]);
    expect(C.langOrder(undefined)).toEqual(["ar", "en"]);
  });
});

describe("what /open answered", () => {
  const rep = { en: "Sara", ar: "سارة" };

  test("an open room opens, on its provider", () => {
    expect(
      C.viewFor(200, { state: "open", provider: "meet", join_url: "https://meet.google.com/abc-defg-hij", rep }),
    ).toEqual({ state: "opening", provider: "meet", joinUrl: "https://meet.google.com/abc-defg-hij", rep });
  });

  test("a link on any other host is never opened", () => {
    for (const join_url of ["https://evil.example/j/1", "javascript:alert(1)", "http://zoom.us/j/1", null])
      expect(C.viewFor(200, { state: "open", provider: "zoom", join_url, rep }).state).toBe("error");
  });

  test("preparing asks again, within sane bounds", () => {
    expect(C.viewFor(200, { state: "preparing", provider: "zoom", rep, retry_ms: 2000 })).toMatchObject({
      state: "preparing",
      retryMs: 2000,
    });
    expect(C.viewFor(200, { state: "preparing", retry_ms: 5 }).retryMs).toBe(2000);
    expect(C.viewFor(200, { state: "preparing", retry_ms: 99999 }).retryMs).toBe(2000);
  });

  test("ended keeps a WhatsApp link only when the number is real", () => {
    expect(C.viewFor(200, { state: "ended", rep, whatsapp: "96590054963" })).toEqual({
      state: "ended",
      rep,
      whatsapp: "https://wa.me/96590054963",
    });
    expect(C.viewFor(200, { state: "ended", whatsapp: "12" }).whatsapp).toBeNull();
  });

  test("404 is unknown, 429 is busy, anything else is an error", () => {
    expect(C.viewFor(404, { state: "unknown" }).state).toBe("unknown");
    expect(C.viewFor(429, {}).state).toBe("busy");
    expect(C.viewFor(503, { state: "error" }).state).toBe("error");
    expect(C.viewFor(502, { state: "broken" }).state).toBe("error");
    expect(C.viewFor(200, null).state).toBe("error");
    expect(C.viewFor(200, "nonsense").state).toBe("error");
  });
});

describe("the lines", () => {
  test("the opening line names the host in both languages", () => {
    expect(C.linesFor({ state: "opening", rep: { en: "Sara", ar: "سارة" } })).toEqual({
      en: "Opening your call with Sara...",
      ar: "لحظة.. قاعدين نفتح لك مكالمتك مع سارة",
    });
  });

  test("with no names it falls back to the team", () => {
    expect(C.linesFor({ state: "opening", rep: { en: null, ar: null } })).toEqual({
      en: "Opening your call with the Mahara Media team...",
      ar: "لحظة.. قاعدين نفتح لك مكالمتك مع فريق المبيعات",
    });
  });

  test("ended mentions WhatsApp only when there is a button for it", () => {
    expect(C.linesFor({ state: "ended", whatsapp: "https://wa.me/1" }).en).toContain("message us on WhatsApp");
    expect(C.linesFor({ state: "ended", whatsapp: null }).en).not.toContain("WhatsApp");
  });

  test("every state has both languages, and no line has an em dash", () => {
    for (const state of ["loading", "opening", "opened", "preparing", "ended", "unknown", "busy", "error"]) {
      const pair = C.linesFor({ state, rep: { en: "Sara", ar: "سارة" } });
      expect(pair.en.length).toBeGreaterThan(5);
      expect(pair.ar.length).toBeGreaterThan(5);
    }
    const all = JSON.stringify(C.COPY);
    expect(all).not.toContain("—");
    expect(all).not.toContain("«");
  });

  test("the Zoom hint everywhere, the Meet hint only on iOS", () => {
    expect(C.hintFor("zoom", false)).toBe(C.COPY.zoomHint);
    expect(C.hintFor("meet", true)).toBe(C.COPY.meetHint);
    expect(C.hintFor("meet", false)).toBeNull();
    expect(C.hintFor(null, true)).toBeNull();
  });

  test("iPads that say they are Macs count as iOS", () => {
    expect(C.isIos("Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X)", 5)).toBe(true);
    expect(C.isIos("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 5)).toBe(true);
    expect(C.isIos("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 0)).toBe(false);
    expect(C.isIos("Mozilla/5.0 (Linux; Android 14)", 5)).toBe(false);
  });

  test("the ring's letter comes from the leading language", () => {
    expect(C.initialFor({ en: "sara", ar: "سارة" }, "en")).toBe("S");
    expect(C.initialFor({ en: "Sara", ar: "سارة" }, "ar")).toBe("س");
    expect(C.initialFor({ en: "Sara", ar: null }, "ar")).toBe("S");
    expect(C.initialFor({ en: null, ar: null }, "en")).toBeNull();
  });
});
