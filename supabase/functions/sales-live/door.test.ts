// bun test supabase/functions/sales-live
import { describe, expect, test } from "bun:test";
import {
  allowedOrigin,
  clientIp,
  deviceIdOk,
  deviceOf,
  doorView,
  firstName,
  GO_COPY,
  ipHash,
  isPreviewBot,
  normalizeCode,
  OPEN_DEVICES,
  openText,
  osOf,
  RateLimiter,
  type RoomRow,
  roomIsOver,
  routeOf,
  safeJoinUrl,
  whatsappDigits,
} from "./door.ts";

const UA = {
  iphoneSafari:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  androidChrome:
    "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36",
  samsungInternet:
    "Mozilla/5.0 (Linux; Android 13; SAMSUNG SM-A546B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36",
  instagramInApp:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 341.0.0.0 (iPhone15,2; iOS 17_5; en_US)",
  facebookInApp:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/470.0.0.0;FBBV/1;FBDV/iPhone15,2;FBMD/iPhone;FBSN/iOS;FBSV/17.5;FBSS/3;FBID/phone;FBLC/en_US;FBOP/5]",
  cubotPhone:
    "Mozilla/5.0 (Linux; Android 10; CUBOT X30) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
  ipad: "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  androidTablet:
    "Mozilla/5.0 (Linux; Android 13; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
  macChrome:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
  windowsEdge:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0",
};

const BOTS = {
  whatsapp: "WhatsApp/2.24.20.80 A",
  whatsappIos: "WhatsApp/2.24.20.80 i",
  facebook: "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
  imessage: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_11_1) AppleWebKit/601.2.4 (KHTML, like Gecko) Version/9.0.1 Safari/601.2.4 facebookexternalhit/1.1 Facebot Twitterbot/1.0",
  telegram: "TelegramBot (like TwitterBot)",
  slack: "Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)",
  twitter: "Twitterbot/1.0",
  linkedin: "LinkedInBot/1.0 (compatible; Mozilla/5.0; Apache-HttpClient +http://www.linkedin.com)",
  discord: "Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)",
  google: "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
  skype: "Mozilla/5.0 (Windows NT 6.1; WOW64) SkypeUriPreview Preview/0.5",
  headless:
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/120.0.0.0 Safari/537.36",
  curl: "curl/8.4.0",
  python: "python-requests/2.31.0",
  okhttp: "okhttp/4.12.0",
  bare: "bot",
};

describe("codes", () => {
  test("six characters from the 32-letter alphabet, any case", () => {
    expect(normalizeCode("K7Q2MX")).toBe("K7Q2MX");
    expect(normalizeCode("k7q2mx")).toBe("K7Q2MX");
    expect(normalizeCode(" k7q 2mx/")).toBe("K7Q2MX");
  });

  test("I, O, 0 and 1 never appear, and lengths are exact", () => {
    for (const bad of ["K7Q2MO", "K7Q2M0", "K7Q2MI", "K7Q2M1", "K7Q2M", "K7Q2MXX", "", "K7Q2M!", "K7Q2MX2", "K7Q2MXa"])
      expect([bad, normalizeCode(bad)]).toEqual([bad, null]);
    expect(normalizeCode(undefined)).toBeNull();
    expect(normalizeCode(123456)).toBeNull();
  });

  test("punctuation and invisible marks a message leaves around the link are not part of the code", () => {
    for (const raw of [
      "K7Q2MX.", // "Join here: {link}." in the email body
      "K7Q2MX,",
      "K7Q2MX)",
      "K7Q2MX!",
      "K7Q2MX\u060C", // Arabic comma
      "K7Q2MX\u200F", // right-to-left mark
      "K7Q2MX\u200E",
      "\u200FK7Q2MX",
      "K7Q2MX\u200B",
      "K7Q2MX\u2069",
      "K7Q2MX\u061C",
      "K7Q2MX\uFEFF",
      "K7Q2MX\u200F.",
      "K7Q2MXهلا", // Arabic text glued on
    ])
      expect([raw, normalizeCode(raw)]).toEqual([raw, "K7Q2MX"]);
  });

  test("through the route, as the lead's browser sends it", () => {
    for (const tail of [".", "%D8%8C", "%E2%80%8F", ")", "%E2%80%8E%E2%80%8F"])
      expect(normalizeCode(routeOf(`/sales-live/open/K7Q2MX${tail}`).code)).toBe("K7Q2MX");
  });
});

describe("routes", () => {
  test("Supabase's path, a local path and the gateway path", () => {
    expect(routeOf("/sales-live/zoom")).toEqual({ name: "zoom" });
    expect(routeOf("/functions/v1/sales-live/slack")).toEqual({ name: "slack" });
    expect(routeOf("/cron")).toEqual({ name: "cron" });
    expect(routeOf("/sales-live/open/K7Q2MX")).toEqual({ name: "open", code: "K7Q2MX" });
    expect(routeOf("/sales-live/go/k7q2mx")).toEqual({ name: "go", code: "k7q2mx" });
    expect(routeOf("/sales-live/open/K7Q2MX/extra")).toEqual({ name: "open", code: "K7Q2MX" });
    expect(routeOf("/sales-live/health")).toEqual({ name: "health" });
  });

  test("unknown routes, extra segments and broken escapes", () => {
    expect(routeOf("/sales-live")).toEqual({ name: null });
    expect(routeOf("/sales-live/admin")).toEqual({ name: null });
    expect(routeOf("/sales-live/zoom/extra")).toEqual({ name: null });
    expect(routeOf("/sales-live/open/%E0%A4%A")).toEqual({ name: "open", code: "%E0%A4%A" });
    expect(routeOf("/sales-live/open")).toEqual({ name: "open", code: "" });
  });
});

describe("the bot filter", () => {
  test("link previews, crawlers and scripts are bots", () => {
    for (const [name, ua] of Object.entries(BOTS)) expect([name, isPreviewBot(ua)]).toEqual([name, true]);
    expect(isPreviewBot("")).toBe(true);
    expect(isPreviewBot(null)).toBe(true);
  });

  test("people are never bots, in-app browsers and the CUBOT phone included", () => {
    for (const [name, ua] of Object.entries(UA)) expect([name, isPreviewBot(ua)]).toEqual([name, false]);
  });

  test("WhatsApp's preview fetcher only at the start of the agent, as roomlogic.ts reads it", () => {
    expect(isPreviewBot("WhatsApp/2.24.20.80 A")).toBe(true);
    expect(isPreviewBot("whatsapp/2.23.20.0")).toBe(true);
    expect(isPreviewBot("Mozilla/5.0 (Linux; Android 13; SM-A536B) Chrome/120 Mobile Safari/537.36 WhatsApp/2.24")).toBe(false);
  });
});

describe("devices", () => {
  test("phone, tablet or computer, the room logic's own names", () => {
    expect(OPEN_DEVICES).toEqual(["phone", "tablet", "computer"]);
    expect(deviceOf(UA.iphoneSafari)).toBe("phone");
    expect(deviceOf(UA.androidChrome)).toBe("phone");
    expect(deviceOf(UA.ipad)).toBe("tablet");
    expect(deviceOf(UA.androidTablet)).toBe("tablet");
    expect(deviceOf(UA.macChrome)).toBe("computer");
    expect(deviceOf(UA.windowsEdge)).toBe("computer");
    expect(deviceOf("Mozilla/5.0 (X11; Linux x86_64) Firefox/131.0")).toBe("computer");
  });

  test("a device that cannot be told apart is null, never a guess", () => {
    expect(deviceOf("")).toBeNull();
    expect(deviceOf(null)).toBeNull();
    expect(deviceOf("SomeSmartTV/3.1 (compatible)")).toBeNull();
  });

  test("only the values open_device allows", () => {
    for (const ua of [...Object.values(UA), "", "curl/8"]) {
      const d = deviceOf(ua);
      if (d !== null) expect(OPEN_DEVICES as readonly string[]).toContain(d);
    }
  });

  test("the timeline line for an open", () => {
    expect(openText("phone", false)).toBe("The lead opened the link on a phone.");
    expect(openText("computer", false)).toBe("The lead opened the link on a computer.");
    expect(openText(null, false)).toBe("The lead opened the link.");
    expect(openText("phone", true)).toBe("The lead opened the link after the room closed.");
  });

  test("the system, for the Meet hint", () => {
    expect(osOf(UA.iphoneSafari)).toBe("ios");
    expect(osOf(UA.ipad)).toBe("ios");
    expect(osOf(UA.androidChrome)).toBe("android");
    expect(osOf(UA.macChrome)).toBe("mac");
    expect(osOf(UA.windowsEdge)).toBe("windows");
    expect(osOf(null)).toBe("other");
  });

  test("device ids from the page are random tokens only", () => {
    expect(deviceIdOk("2b0c3f7e-5d1a-4c1b-9b7e-3a1f0d2c4e5f")).toBe(true);
    expect(deviceIdOk("short")).toBe(false);
    expect(deviceIdOk("has space here")).toBe(false);
    expect(deviceIdOk(null)).toBe(false);
  });
});

describe("addresses", () => {
  test("the first forwarded address, then the fallbacks", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": "203.0.113.9, 10.0.0.1" }))).toBe("203.0.113.9");
    expect(clientIp(new Headers({ "x-real-ip": "198.51.100.2" }))).toBe("198.51.100.2");
    expect(clientIp(new Headers())).toBe("unknown");
  });

  test("the IP hash is salted, stable and never the address", async () => {
    const a = await ipHash("salt-a", "203.0.113.9");
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(await ipHash("salt-a", "203.0.113.9")).toBe(a);
    expect(await ipHash("salt-b", "203.0.113.9")).not.toBe(a);
    expect(await ipHash("salt-a", "203.0.113.10")).not.toBe(a);
    expect(a).not.toContain("203");
  });
});

describe("the rate limiter", () => {
  test("30 a minute per key; the 31st waits for the next minute", () => {
    const rl = new RateLimiter(30, 60_000);
    const t0 = 1_000_000;
    for (let i = 0; i < 30; i++) expect(rl.hit("ip-a", t0 + i)).toBe(true);
    expect(rl.hit("ip-a", t0 + 31)).toBe(false);
    expect(rl.hit("ip-a", t0 + 59_999)).toBe(false);
    expect(rl.hit("ip-a", t0 + 60_000)).toBe(true);
  });

  test("one busy address does not block another", () => {
    const rl = new RateLimiter(30, 60_000);
    for (let i = 0; i < 100; i++) rl.hit("busy", 5);
    expect(rl.hit("busy", 6)).toBe(false);
    expect(rl.hit("quiet", 6)).toBe(true);
  });

  test("the map stays bounded under a flood of new addresses", () => {
    const rl = new RateLimiter(30, 60_000, 1000);
    for (let i = 0; i < 20_000; i++) rl.hit(`ip-${i}`, 10);
    expect(rl.size).toBeLessThanOrEqual(1000);
    // A key still counting keeps its count until it is evicted.
    const fresh = new RateLimiter(2, 60_000, 1000);
    fresh.hit("k", 0);
    fresh.hit("k", 1);
    expect(fresh.hit("k", 2)).toBe(false);
  });

  test("expired windows are evicted before live ones", () => {
    const rl = new RateLimiter(1, 60_000, 3);
    rl.hit("old", 0);
    rl.hit("live1", 70_000);
    rl.hit("live2", 70_000);
    rl.hit("new", 70_001); // full: "old" has expired and goes first
    expect(rl.hit("live1", 70_002)).toBe(false);
    expect(rl.hit("live2", 70_002)).toBe(false);
  });
});

describe("join links", () => {
  test("Zoom and Meet links pass", () => {
    expect(safeJoinUrl("https://us06web.zoom.us/j/85023456789?pwd=abc.1")).toBe(
      "https://us06web.zoom.us/j/85023456789?pwd=abc.1",
    );
    expect(safeJoinUrl("https://zoom.us/j/1")).toBe("https://zoom.us/j/1");
    expect(safeJoinUrl("https://meet.google.com/abc-defg-hij")).toBe("https://meet.google.com/abc-defg-hij");
    expect(safeJoinUrl("https://app.zoom.com/wc/join/1")).toBe("https://app.zoom.com/wc/join/1");
  });

  test("anything else is refused: other hosts, look-alikes, http, scripts, credentials, ports", () => {
    for (const bad of [
      "https://evil.example/j/1",
      "https://zoom.us.evil.example/j/1",
      "https://evilzoom.us/j/1",
      "https://meet.google.com.evil.example/x",
      "http://zoom.us/j/1",
      "javascript:alert(1)",
      "https://user:pw@zoom.us/j/1",
      "https://zoom.us:8443/j/1",
      "not a url",
      "",
      `https://zoom.us/j/${"1".repeat(2100)}`,
    ])
      expect([bad.slice(0, 40), safeJoinUrl(bad)]).toEqual([bad.slice(0, 40), null]);
    expect(safeJoinUrl(null)).toBeNull();
  });
});

describe("names and numbers", () => {
  test("first names", () => {
    expect(firstName("Sara Al Ali")).toBe("Sara");
    expect(firstName("  سارة العلي ")).toBe("سارة");
    expect(firstName("<b>Sara</b>")).toBe("bSara/b");
    expect(firstName("")).toBeNull();
    expect(firstName(null)).toBeNull();
  });

  test("WhatsApp numbers are digits only, 8 to 15", () => {
    expect(whatsappDigits("+965 9005 4963")).toBe("96590054963");
    expect(whatsappDigits(96590054963)).toBe("96590054963");
    expect(whatsappDigits("1234567")).toBeNull();
    expect(whatsappDigits("1".repeat(16))).toBeNull();
    expect(whatsappDigits(null)).toBeNull();
  });
});

describe("what the page is told", () => {
  const NOW = Date.UTC(2026, 9, 3, 12, 0, 0);
  const room = (over: Partial<RoomRow> = {}): RoomRow => ({
    id: "r1",
    code: "K7Q2MX",
    state: "open",
    provider: "zoom",
    join_url: "https://us06web.zoom.us/j/85023456789?pwd=abc",
    host_email: "setter@maharamedia.com",
    replaced_by: null,
    ends_at: new Date(NOW + 30 * 60_000).toISOString(),
    first_open_at: null,
    ...over,
  });
  const rep = { en: "Sara", ar: "سارة" };

  test("an open, host_in or lead_in room gives the link", () => {
    for (const state of ["open", "host_in", "lead_in"])
      expect(doorView("K7Q2MX", room({ state }), rep, NOW)).toEqual({
        ok: true,
        state: "open",
        code: "K7Q2MX",
        provider: "zoom",
        join_url: "https://us06web.zoom.us/j/85023456789?pwd=abc",
        rep,
      });
  });

  test("a room still being made says so and asks again in 2 s", () => {
    expect(doorView("K7Q2MX", room({ state: "creating", join_url: null, provider: "meet" }), rep, NOW)).toEqual({
      ok: true,
      state: "preparing",
      code: "K7Q2MX",
      provider: "meet",
      rep,
      retry_ms: 2000,
    });
  });

  test("every final state is ended, with no link", () => {
    for (const state of ["ended", "expired", "failed", "cancelled"]) {
      const v = doorView("K7Q2MX", room({ state }), rep, NOW, "96590054963");
      expect(v).toEqual({ ok: true, state: "ended", code: "K7Q2MX", rep, whatsapp: "96590054963" });
      expect(JSON.stringify(v)).not.toContain("zoom.us");
    }
  });

  test("only a final state is over: the sweep owns every time rule", () => {
    // A long demo, or an adopted standby room still on the standby's ends_at.
    const late = room({ state: "lead_in", ends_at: new Date(NOW - 3 * 60 * 60_000).toISOString() });
    expect(roomIsOver(late, NOW)).toBe(false);
    expect(doorView("K7Q2MX", late, rep, NOW).state).toBe("open");
    for (const state of ["requested", "creating", "open", "host_in", "lead_in"])
      expect([state, roomIsOver(room({ state, ends_at: "2020-01-01T00:00:00Z" }), NOW)]).toEqual([state, false]);
    for (const state of ["ended", "expired", "failed", "cancelled"])
      expect([state, roomIsOver(room({ state }), NOW)]).toEqual([state, true]);
  });

  test("a link on a host the door does not trust is never handed out", () => {
    const v = doorView("K7Q2MX", room({ join_url: "https://evil.example/j/1" }), rep, NOW);
    expect(v.ok).toBe(false);
    expect(v.state).toBe("broken");
    expect(JSON.stringify(v)).not.toContain("evil.example");
  });

  test("the provider is read from the link when the row has none", () => {
    const v = doorView("K7Q2MX", room({ provider: null, join_url: "https://meet.google.com/abc-defg-hij" }), rep, NOW);
    expect(v).toMatchObject({ state: "open", provider: "meet" });
  });
});

describe("origins", () => {
  test("the live site, the one configured extra site and a local run may read /open", () => {
    expect(allowedOrigin("https://call.maharamedia.com")).toBe("https://call.maharamedia.com");
    expect(allowedOrigin("http://localhost:5173")).not.toBeNull();
    expect(allowedOrigin("http://127.0.0.1:8080")).not.toBeNull();
    expect(allowedOrigin("https://mahara-call-link.vercel.app", "https://mahara-call-link.vercel.app")).toBe(
      "https://mahara-call-link.vercel.app",
    );
  });

  test("names anyone can register on vercel.app may not", () => {
    for (const o of [
      "https://call-link-abc123-team.vercel.app",
      "https://mahara-call-link.vercel.app",
      "https://mahara-call-link-x1y2z3-anyone.vercel.app",
      "https://call-link.vercel.app",
    ])
      expect([o, allowedOrigin(o)]).toEqual([o, null]);
    expect(allowedOrigin("https://mahara-call-link-git-x.vercel.app", "https://mahara-call-link.vercel.app")).toBeNull();
  });

  test("other sites may not", () => {
    for (const o of [
      "https://evil.example",
      "http://call.maharamedia.com",
      "https://call.maharamedia.com.evil.example",
      "https://call.maharamedia.com/path",
      "https://other.vercel.app",
      "null",
      "",
    ])
      expect([o, allowedOrigin(o)]).toEqual([o, null]);
    expect(allowedOrigin(null)).toBeNull();
  });
});

describe("the no-script route's copy", () => {
  const core = require("../../../sites/call-link/core.js");

  test("preparing is the page's own line, in both languages", () => {
    expect(GO_COPY.preparing).toEqual(core.COPY.preparing);
  });

  test("every line has both languages and no em dash", () => {
    for (const pair of Object.values(GO_COPY)) {
      expect(pair.en.length).toBeGreaterThan(10);
      expect(pair.ar.length).toBeGreaterThan(10);
    }
    expect(JSON.stringify(GO_COPY)).not.toContain("—");
  });
});
