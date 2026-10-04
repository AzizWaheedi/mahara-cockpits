// Adversarial review of the live-call screens (lc-ui lane), 2026-10-03.
//
// Each test states what the specs, the glossary or the other lanes need.
// They began as `test.failing` (open findings); every one is fixed now and
// runs as a plain test. rooms.review.test.tsx holds the tests added with
// the fixes. Numbers match the review's findings list.

import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { RoomView } from "./rooms";

// The Supabase client needs the build's settings; nothing here reaches it.
mock.module("./supabase", () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: null } }) },
  },
  SUPABASE_URL: "https://example.invalid",
  PROPOSALS_BUCKET: "sales-proposals",
}));

const R = await import("./rooms");
const F = await import("../dev/roomFixtures");
const { SalesBannerView } = await import("../components/SalesBanner");
const { Countdown } = await import("../components/RoomLine");

/** 14:12:00 in Kuwait on 3 October 2026. */
const NOW = Date.parse("2026-10-03T11:12:00.000Z");
const S = 1000;
const MIN = 60 * S;
const iso = (ms: number) => new Date(ms).toISOString();

const sentRoom = (over: Partial<RoomView> = {}) =>
  F.baseRoom(NOW, {
    link_channels: ["whatsapp_text"],
    link_sent_at: iso(NOW - 48 * S),
    lead_by: iso(NOW + 552 * S),
    ...over,
  });
const joined = (over: Partial<RoomView> = {}) =>
  sentRoom({
    state: "lead_in",
    host_in_at: iso(NOW - 45 * S),
    lead_in_at: iso(NOW - 25 * S),
    ...over,
  });
const say = (r: RoomView) => R.sentenceText(R.roomSentence(r, { now: NOW }));
const me = (over = {}) => ({
  email: "omar@example.com",
  state: "away" as const,
  until: null,
  room_id: null,
  zoom_status: "licensed" as const,
  default_provider: "zoom" as const,
  ...over,
});
const strip = (over: Partial<Parameters<typeof R.stripLine>[0]> = {}) =>
  R.stripLine({
    me: me(),
    rooms: [],
    offers: [],
    health: F.healthFixture(NOW),
    now: NOW,
    flash: null,
    ...over,
  });

/** cockpit_sales_rooms.link_channels check (20261003a_sales_rooms.sql, as merged). */
const DB_CHANNELS = ["whatsapp_text", "whatsapp_template", "email"];
/** roomlogic.ts LINK_CHANNELS (lc-logic), the glossary's rooms.send keys. */
const API_CHANNELS = ["whatsapp_text", "whatsapp_template", "email"];

// ---------------------------------------------------------------------------

describe("1. link channel names match the database, sales-api and the glossary", () => {
  test("a template link from sales-api reads as WhatsApp, with P1's wait", () => {
    expect(say(sentRoom({ link_channels: ["whatsapp_template"] }))).toBe(
      "Link sent on WhatsApp at 14:11. Waiting for Faisal (9:12 left).",
    );
  });

  test("free text as sales-api names it (whatsapp_text) reads as WhatsApp", () => {
    expect(say(sentRoom({ link_channels: ["whatsapp_text"] }))).toBe(
      "Link sent on WhatsApp at 14:11. Waiting for Faisal (9:12 left).",
    );
  });

  test("a template plus email is not reported as email only", () => {
    expect(
      say(sentRoom({ link_channels: ["whatsapp_template", "email"] })),
    ).toContain("WhatsApp");
  });

  test("the not-confirmed fixture uses only values the database accepts", () => {
    const room = F.roomFixture("not_confirmed", NOW).feed.room;
    for (const c of room.link_channels) expect(DB_CHANNELS).toContain(c);
  });

  test("'not confirmed' comes from link_unconfirmed_at, never from a channel value", () => {
    const values = [...new Set([...DB_CHANNELS, ...API_CHANNELS])];
    const reached = values.flatMap(a =>
      values.filter(
        b =>
          R.roomMoment(sentRoom({ link_channels: [a, b] }), NOW) ===
          "not_confirmed",
      ),
    );
    expect(reached).toEqual([]);
    expect(
      R.roomMoment(
        sentRoom({
          link_channels: ["whatsapp_template", "email"],
          link_unconfirmed_at: iso(NOW - 20 * S),
        }),
        NOW,
      ),
    ).toBe("not_confirmed");
  });
});

describe("4. P1's joined lines", () => {
  test("a booked intro moved to now says the intro is marked shown", () => {
    expect(say(joined({ count_result: "moved" }))).toBe(
      "Faisal joined at 14:11. The intro is marked shown.",
    );
  });

  test("a new live intro says it was booked as one", () => {
    expect(say(joined({ count_result: "booked" }))).toBe(
      "Faisal joined. Booked as a live intro and marked shown.",
    );
  });
});

describe("5. 'That was not the lead' and the server's 300 s", () => {
  test("the button is gone before a held press would land after 300 s", () => {
    // 296 s after the join: pressed now, sent after the 5 s Undo, it reaches
    // sales-api at 301 s, which refuses it (roomlogic not_lead_late), and the
    // stranger's live booking stays counted as shown.
    const r = joined({
      lead_in_at: iso(NOW - (300 * S - R.UNDO_MS + 1 * S)),
    });
    expect(R.needsUndo("not_lead")).toBe(true);
    expect(R.canSayNotLead(r, NOW)).toBe(false);
  });
});

describe("6. a late poll and a press", () => {
  test("a poll that left before End room does not bring the ended room back", () => {
    const before = F.liveFixture("away", NOW, "host_in").live;
    const own = before.rooms[0];
    const afterPress = R.withRoom(before, {
      ...own,
      version: own.version + 1,
      state: "ended",
    });
    expect(afterPress.rooms).toHaveLength(0);
    // The read that left before the press lands now, carrying host_in.
    const merged = R.mergeLive(afterPress, before);
    expect(merged.rooms.map(r => r.id)).not.toContain(own.id);
  });

  test("a room still in the list keeps the press's newer copy (sound)", () => {
    const before = F.liveFixture("away", NOW, "sent").live;
    const own = before.rooms[0];
    const afterPress = R.withRoom(before, {
      ...own,
      version: own.version + 1,
      state: "host_in",
    });
    expect(R.mergeLive(afterPress, before).rooms[0].state).toBe("host_in");
  });
});

describe("7. a flash never hides a live offer", () => {
  test("a new offer shows through the last offer's 'closed' line", () => {
    const line = strip({
      me: me({ state: "ready" }),
      offers: [F.offerFixture(NOW, { id: "live-2" })],
      flash: { kind: "closed", at: NOW - 2 * S },
    });
    expect(line.moment).toBe("offer");
  });

  test("after a Take that may not have landed, the open offer can be pressed again", () => {
    const line = strip({
      me: me({ state: "ready" }),
      offers: [F.offerFixture(NOW)],
      flash: {
        kind: "error",
        at: NOW - S,
        text: "The cockpit did not answer within 45 seconds. It may still go through, so check before you try again.",
      },
    });
    expect(line.primary?.key).toBe("take");
  });
});

describe("8. a booked call's room in the banner", () => {
  const start = NOW + 15 * MIN;
  const booked = F.baseRoom(NOW, {
    purpose: "booked",
    call_kind: "demo",
    provider: "zoom",
    host_by: iso(start + 15 * MIN),
    lead_by: iso(start + 20 * MIN),
    ends_at: iso(start + 45 * MIN),
  });

  test("it says when the call is, not how long its room waits", () => {
    expect(R.sentenceText(R.bannerRoomSentence(booked, NOW))).toBe(
      "Booked demo with Faisal at 14:27.",
    );
  });

  test("from the call's start it takes the banner", () => {
    expect(R.myRoom([booked], start)?.id).toBe(booked.id);
  });

  test("a call wrapped 15 minutes ahead does not take the banner yet", () => {
    expect(R.myRoom([booked], NOW)).toBeNull();
  });
});

describe("11. a handover's failed Zoom room", () => {
  const r = F.baseRoom(NOW, {
    purpose: "handover",
    provider: "zoom",
    state: "failed",
    error: "the host was not found",
  });
  test("the sentence is P2's (sound)", () => {
    expect(say(r)).toBe(
      "Zoom did not open your room: the host was not found. Use Meet.",
    );
  });
  test("the button is P2's [Use Meet]", () => {
    expect(R.roomActions(r, { now: NOW }).primary?.label).toBe("Use Meet");
  });
});

describe("13. the countdown can be read in light mode", () => {
  // OKLCH and sRGB as CSS Color 4 defines them, to work out what
  // color-mix(in oklch, A 55%, B) paints and how it reads on white.
  type Lch = [number, number, number];
  const toLinear = (v: number) =>
    v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  const hexLch = (hex: string): Lch => {
    const [r, g, b] = [1, 3, 5].map(i =>
      toLinear(Number.parseInt(hex.slice(i, i + 2), 16) / 255),
    );
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
    const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
    const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
    return [
      L,
      Math.hypot(A, B),
      ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360,
    ];
  };
  const mix = (a: Lch, b: Lch, wa: number): Lch => {
    let d = b[2] - a[2];
    if (d > 180) d -= 360;
    if (d < -180) d += 360;
    return [
      a[0] * wa + b[0] * (1 - wa),
      a[1] * wa + b[1] * (1 - wa),
      a[2] + d * (1 - wa),
    ];
  };
  /** Relative luminance of an OKLCH colour, clipped into sRGB. */
  const lum = ([L, C, h]: Lch) => {
    const A = C * Math.cos((h * Math.PI) / 180);
    const B = C * Math.sin((h * Math.PI) / 180);
    const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
    const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
    const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
    const clip = (v: number) => Math.min(1, Math.max(0, v));
    const r = clip(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s);
    const g = clip(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s);
    const b = clip(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const onWhite = (c: Lch) => 1.05 / (lum(c) + 0.05);
  // index.css, light theme.
  const TEAL = hexLch("#00cfc8");
  const FOREGROUND: Lch = [0.2, 0.045, 270];
  const OWED: Lch = [0.7, 0.17, 55];

  test("pure teal and the owed orange fail on white (why the mix exists)", () => {
    expect(onWhite(TEAL)).toBeLessThan(3);
    expect(onWhite(OWED)).toBeLessThan(3);
  });

  test("the digits are drawn in the 55% mix in light mode, pure only on dark", () => {
    const html = renderToStaticMarkup(<Countdown ms={552_000} />);
    expect(html).toContain(
      "text-[color:color-mix(in_oklch,var(--now)_55%,var(--foreground))]",
    );
    expect(html).toContain("dark:text-[color:var(--now)]");
    expect(html).not.toContain("style=");
    const last = renderToStaticMarkup(<Countdown ms={40_000} />);
    expect(last).toContain(
      "text-[color:color-mix(in_oklch,var(--owed)_55%,var(--foreground))]",
    );
  });

  test("that mix meets 4.5:1 on the white card, for both colours", () => {
    expect(onWhite(mix(TEAL, FOREGROUND, 0.55))).toBeGreaterThanOrEqual(4.5);
    expect(onWhite(mix(OWED, FOREGROUND, 0.55))).toBeGreaterThanOrEqual(4.5);
  });
});

describe("19. an offer whose time is up", () => {
  test("is not offered for Take", () => {
    const line = strip({
      me: me({ state: "ready" }),
      offers: [F.offerFixture(NOW, { offer_until: iso(NOW - 2 * S) })],
    });
    expect(line.moment).not.toBe("offer");
  });
});

describe("20. the booked-call line", () => {
  test("does not offer the button it says to press after the call", () => {
    const line = strip({
      me: me({ reason: "booked_call", booked_at: iso(NOW + 38 * MIN) }),
    });
    const keys = [line.primary, ...line.quiet].map(a => a?.key);
    expect(keys).not.toContain("available");
  });
});

describe("21. the banner's handover slot", () => {
  test("a handover strip that renders nothing does not hide the seat's strip", () => {
    const Idle = () => null;
    const html = renderToStaticMarkup(
      <SalesBannerView
        data={F.liveFixture("away", NOW).live}
        now={NOW}
        handover={<Idle />}
      />,
    );
    expect(html).toContain("I&#x27;m available");
  });

  test("with no handover the Away strip shows (sound)", () => {
    const html = renderToStaticMarkup(
      <SalesBannerView data={F.liveFixture("away", NOW).live} now={NOW} />,
    );
    expect(html).toContain("I&#x27;m available");
  });
});

describe("23. a reason after a colon", () => {
  test("keeps a person's name capitalised", () => {
    expect(R.reasonWords("Sara has the only Zoom seat.")).toBe(
      "Sara has the only Zoom seat",
    );
  });
});

describe("24. reading a link out", () => {
  test("a Zoom room with no short link is never read out; the rep is told to copy it", () => {
    const url =
      "https://us06web.zoom.us/j/81234567890?pwd=aBcD3fGhIjKlMnOpQrStUvWxYz012345.1";
    const r = F.baseRoom(NOW, {
      provider: "zoom",
      short_url: url,
      join_url: url,
      refusal: "No message can reach this lead.",
    });
    expect(R.readOut(r)).toBeNull();
    // A Zoom link nobody can say: copy it, or move to Meet, whose link can be.
    expect(say(r)).toBe(
      "Not sent: no message can reach this lead. Copy the link and send it another way, or end this room and use Meet, whose link can be read out.",
    );
    expect(say(r)).not.toContain("zoom.us");
    expect(R.roomSteps(r)[0].note).toBe("not sent");
    // The short link and a Meet link can be said.
    expect(R.readOut(F.baseRoom(NOW))).toBe("call.maharamedia.com/K7Q2MX");
    expect(R.readOut(F.baseRoom(NOW, { short_url: null }))).toBe(
      "meet.google.com/abc-defg-hij",
    );
  });
});

describe("27. the spoken banner line", () => {
  test("has no dangling comma once the countdown is left out", () => {
    const s = R.bannerRoomSentence(sentRoom(), NOW);
    expect(R.sentenceText(s, true)).toBe("Video room: Faisal.");
  });
});

describe("2. a malformed live.status never takes the whole cockpit down", () => {
  // The banner renders above the routes' PageBoundary (App.tsx:247 vs 254),
  // so a throw here reaches main.tsx's boundary and replaces every page.
  const draw = (data: unknown) => () =>
    renderToStaticMarkup(
      <SalesBannerView
        data={data as Parameters<typeof SalesBannerView>[0]["data"]}
        now={NOW}
      />,
    );
  const base = F.liveFixture("ready", NOW, "sent").live;

  test("an answer before project 2 with no offers list", () => {
    const { offers: _drop, ...noOffers } = base;
    expect(draw(noOffers)).not.toThrow();
  });

  test("a room with no link_channels", () => {
    const rooms = base.rooms.map(r => ({ ...r, link_channels: null }));
    expect(draw({ ...base, rooms })).not.toThrow();
  });
});

describe("checked and sound", () => {
  test("after a timeout, fifty parallel retries share one id and one send", async () => {
    R.forgetRequests();
    const { ApiError } = await import("./apiErrors");
    const ids: string[] = [];
    await expect(
      R.once(
        "adv",
        async id => {
          ids.push(id);
          throw new ApiError("maybe", "timeout");
        },
        NOW,
      ),
    ).rejects.toThrow();
    const all = await Promise.all(
      Array.from({ length: 50 }, () =>
        R.once(
          "adv",
          async id => {
            ids.push(id);
            return id;
          },
          NOW + 10 * S,
        ),
      ),
    );
    expect(ids).toHaveLength(2);
    expect(ids[0]).toBe(ids[1]);
    expect(new Set(all).size).toBe(1);
    R.forgetRequests();
  });

  test("the harness never hands a host link to a room read", () => {
    const out = F.answerRoomsAction("room.status", {}, { room: "joined" }, NOW);
    expect(JSON.stringify(out)).not.toContain("start_url");
    expect(JSON.stringify(out)).not.toContain("zak=");
  });

  test("an older room read never replaces a press's newer copy", () => {
    const pressed = { room: joined({ version: 9 }), events: [], health: null };
    const late = { room: sentRoom({ version: 8 }), events: [], health: null };
    expect(R.mergeRoomFeed(pressed, late).room.state).toBe("lead_in");
  });
});
