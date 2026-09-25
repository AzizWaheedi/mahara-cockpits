import { describe, expect, test } from "bun:test";
import { withoutWebinar } from "../convex/ceo/adapters/growth";
import { DEFINITIONS, extract } from "../convex/ceo/metricRegistry";
import { objectionStats, reminderStats } from "../convex/ceo/webinarFollowUp";
import { type PageVisitor, pageStats } from "../convex/ceo/webinarPage";
import { webinarReadiness } from "../convex/ceo/webinarReadiness";
import {
  merge,
  onesBurst,
  phoneKey,
  roomOf,
  type ZoomAttendance,
  type ZoomEngagement,
  type ZoomSession,
} from "../convex/ceo/webinarRoom";
import { webinarRoundFixture } from "./fixtures/webinarRound";

// The webinar room (convex/ceo/webinarRoom.ts): what Zoom's join and leave
// rows become on the Frontend tab. Wrong here is a pitch that looks like it
// lost the room when it did not, or a show rate that counts the team.

const MIN = 60_000;
const T0 = Date.parse("2026-09-30T17:00:00Z");
const at = (m: number) => T0 + m * MIN;

const session = (over: Partial<ZoomSession> = {}): ZoomSession => ({
  uuid: "s1",
  startedAt: T0,
  endedAt: at(60),
  pitch1At: null,
  pitch2At: null,
  complete: true,
  ...over,
});

const seg = (
  person: string,
  join: number,
  leave: number | null,
  over: Partial<ZoomAttendance> = {},
): ZoomAttendance => ({
  sessionUuid: "s1",
  personKey: person,
  email: null,
  contactId: null,
  internal: false,
  joinAt: at(join),
  leaveAt: leave === null ? null : at(leave),
  ...over,
});

const line = (
  person: string,
  minute: number,
  one = false,
  over: Partial<ZoomEngagement> = {},
): ZoomEngagement => ({
  sessionUuid: "s1",
  kind: "chat",
  at: at(minute),
  personKey: person,
  one,
  private: false,
  ...over,
});

const opts = { scheduledAt: T0, pollsReadable: true };

describe("people in the room", () => {
  test("a rejoin is one person, and the team is left out", () => {
    const room = roomOf(
      [session()],
      [
        seg("name:a", 0, 20),
        seg("name:a", 25, 60),
        seg("name:b", 10, 60),
        seg("email:aziz@maharamedia.com", 0, 60, { internal: true }),
      ],
      [],
      opts,
    );
    expect(room?.attendees).toBe(2);
    // a: 20 + 35 minutes; b: 50 minutes.
    expect(room?.watchAvgMin).toBe(52.5);
    expect(room?.watchMedianMin).toBe(52.5);
  });

  test("two devices at once do not double the watch time", () => {
    expect(
      merge([
        [0, 10],
        [5, 20],
        [30, 40],
      ]),
    ).toEqual([
      [0, 20],
      [30, 40],
    ]);
  });

  test("on time is within three minutes of the scheduled start", () => {
    const room = roomOf(
      [session()],
      [seg("name:a", 2, 60), seg("name:b", 4, 60), seg("name:c", 0, 60)],
      [],
      opts,
    );
    expect(room?.onTime).toBe(0.667);
  });

  test("a false start with only the host does not stretch the room", () => {
    const room = roomOf(
      [
        session({ uuid: "false", startedAt: at(-30), endedAt: at(-29) }),
        session(),
      ],
      [
        seg("zoom:host", -30, -29, { sessionUuid: "false", internal: true }),
        seg("name:a", 0, 60),
      ],
      [],
      opts,
    );
    expect(room?.startAt).toBe(T0);
    expect(room?.sessions).toBe(1);
  });
});

describe("the curve", () => {
  const people = [
    ...Array.from({ length: 10 }, (_, i) => seg(`name:p${i}`, 0, 60)),
    ...Array.from({ length: 6 }, (_, i) => seg(`name:q${i}`, 0, 30)),
    ...Array.from({ length: 4 }, (_, i) => seg(`name:r${i}`, 5, 45)),
  ];
  const room = roomOf([session()], people, [], opts);

  test("people present at the middle of each minute", () => {
    expect(room?.curve.length).toBe(60);
    expect(room?.curve[0]).toBe(16);
    expect(room?.curve[10]).toBe(20);
    expect(room?.curve[30]).toBe(14);
    expect(room?.curve[50]).toBe(10);
    expect(room?.peak).toBe(20);
    expect(room?.peakMinute).toBe(5);
  });

  test("the biggest drop-offs, largest first", () => {
    expect(room?.drops).toEqual([
      { minute: 30, lost: 6 },
      { minute: 45, lost: 4 },
    ]);
  });

  test("stay to end counts who is there two minutes before it ends", () => {
    expect(room?.stayToEnd).toBe(0.5);
  });

  test("the curve ends with the last minute anybody was in the room", () => {
    const hostStays = roomOf(
      [session({ endedAt: at(75) })],
      [
        seg("name:a", 0, 50),
        seg("email:aziz@maharamedia.com", 0, 75, { internal: true }),
      ],
      [],
      opts,
    );
    expect(hostStays?.curve.length).toBe(50);
    expect(hostStays?.curve.at(-1)).toBe(1);
  });
});

describe("pitches", () => {
  const people = [
    ...Array.from({ length: 10 }, (_, i) => seg(`name:p${i}`, 0, 60)),
    ...Array.from({ length: 10 }, (_, i) => seg(`name:q${i}`, 0, 35)),
  ];

  test("pitch 1 is found from the burst of 1s in the chat", () => {
    const chat = [
      line("name:p0", 12),
      line("name:p1", 40, true),
      line("name:p2", 40, true),
      line("name:p3", 41, true),
      line("name:p4", 42, true),
      line("name:p5", 20, true),
    ];
    const room = roomOf([session()], people, chat, opts);
    const p1 = room?.pitches.find(p => p.n === 1);
    expect(p1?.source).toBe("chat");
    expect(p1?.minute).toBe(40);
    expect(p1?.present).toBe(10);
    expect(p1?.retention).toBe(0.5);
    expect(room?.chat.onesAtPitch1).toBe(4);
    expect(room?.chat.messages).toBe(6);
  });

  test("two stray 1s are not a pitch", () => {
    expect(onesBurst([at(5), at(30)])).toBeNull();
    expect(onesBurst([at(5), at(6), at(7)])).toBe(at(5));
    expect(onesBurst([at(5), at(6), at(9)])).toBeNull();
  });

  test("a time set in the cockpit wins over the chat", () => {
    const room = roomOf(
      [session({ pitch1At: at(25), pitch2At: at(50) })],
      people,
      [
        line("name:p1", 40, true),
        line("name:p2", 40, true),
        line("name:p3", 41, true),
      ],
      opts,
    );
    expect(
      room?.pitches.map(p => [p.n, p.minute, p.source, p.retention]),
    ).toEqual([
      [1, 25, "set", 1],
      [2, 50, "set", 0.5],
    ]);
  });

  test("the team's chat and direct messages are not the room's", () => {
    const room = roomOf(
      [session()],
      [...people, seg("email:nada@maharamedia.com", 0, 60, { internal: true })],
      [
        line("email:nada@maharamedia.com", 3),
        line("name:p1", 4, false, { private: true }),
        line("name:p2", 5),
      ],
      opts,
    );
    expect(room?.chat.messages).toBe(1);
    expect(room?.chat.people).toBe(1);
  });
});

describe("what Zoom cannot say", () => {
  test("polls and Q&A are unknown, not zero, when they cannot be read", () => {
    const room = roomOf([session()], [seg("name:a", 0, 60)], [], {
      scheduledAt: T0,
      pollsReadable: false,
    });
    expect(room?.polls).toBeNull();
    expect(room?.qa).toBeNull();
  });

  test("only emails and contact ids leave the room for matching, never names", () => {
    const room = roomOf(
      [session()],
      [
        seg("email:k@firm.com", 0, 60, { email: "k@firm.com" }),
        seg("name:guest", 0, 60),
        seg("reg:r1", 0, 60, {
          contactId: "abc123def456ghi789jk",
          email: "x@y.com",
        }),
      ],
      [],
      opts,
    );
    expect(room?.emails.sort()).toEqual(["k@firm.com", "x@y.com"]);
    expect(room?.contactIds).toEqual(["abc123def456ghi789jk"]);
  });

  test("no session, no room", () => {
    expect(roomOf([], [], [], opts)).toBeNull();
  });
});

describe("phones", () => {
  test("compared on the last eight digits", () => {
    expect(phoneKey("+965 9999 1234")).toBe("99991234");
    expect(phoneKey("99991234")).toBe("99991234");
    expect(phoneKey("1234")).toBeNull();
    expect(phoneKey(null)).toBeNull();
  });
});

// The landing page (convex/ceo/webinarPage.ts): page events per visitor.
describe("the landing page", () => {
  const visitor = (over: Partial<PageVisitor> = {}): PageVisitor => ({
    visitorId: "v",
    firstAt: T0 - 86_400_000,
    firstLanding: T0 - 86_400_000,
    landingViews: 1,
    landingSessions: 1,
    formView: false,
    formFocus: false,
    formSubmit: false,
    cta: false,
    maxScroll: 25,
    landingSeconds: 30,
    thankYouAt: null,
    calendarAdd: false,
    whatsapp: false,
    whatsappPlaceholder: false,
    surveyStart: false,
    surveySubmit: false,
    landingVideo: false,
    thankYouVideo: false,
    thankYouVideo75: false,
    utmContent: null,
    utmSource: null,
    fbclid: false,
    device: "mobile",
    ...over,
  });

  test("visitors, the form's steps and the thank-you page", () => {
    const s = pageStats(
      [
        visitor({
          visitorId: "a",
          formView: true,
          formFocus: true,
          formSubmit: true,
          thankYouAt: T0,
          maxScroll: 100,
          landingSeconds: 120,
          utmContent: "120200000000001",
        }),
        visitor({
          visitorId: "b",
          formView: true,
          formFocus: true,
          maxScroll: 75,
          landingSeconds: 60,
          utmContent: "120200000000001",
        }),
        visitor({
          visitorId: "c",
          maxScroll: 50,
          landingSeconds: 10,
          device: "desktop",
          utmContent: "not-an-ad",
        }),
        visitor({
          visitorId: "d",
          firstLanding: null,
          thankYouAt: T0,
          landingSeconds: null,
        }),
      ],
      [],
      T0,
    );
    expect([
      s.visitors,
      s.formView,
      s.formStart,
      s.formSubmit,
      s.thankYou,
    ]).toEqual([3, 2, 2, 1, 2]);
    expect([s.scroll50, s.scroll75, s.scroll100]).toEqual([3, 2, 1]);
    expect(s.secondsMedian).toBe(60);
    expect(s.mobile).toBe(2);
    expect(s.withAd).toBe(2);
    expect(s.byAd).toEqual([
      { adId: "120200000000001", visitors: 2, thankYou: 1 },
    ]);
  });

  test("join-link clicks: each person once before and once after the start", () => {
    const s = pageStats(
      [],
      [
        { visitorId: "x", at: at(-10) },
        { visitorId: "x", at: at(-5) },
        { visitorId: "x", at: at(20) },
        { visitorId: "y", at: at(2) },
        { visitorId: "z", at: at(-60 * 30) },
      ],
      T0,
    );
    expect([s.joinBefore, s.joinAfter]).toEqual([1, 2]);
  });

  test("pitch link clicks: each person once per pitch, around the session", () => {
    const s = pageStats([], [], T0, [
      { visitorId: "a", at: at(40), pitch: 1 },
      { visitorId: "a", at: at(41), pitch: 1 },
      { visitorId: "b", at: at(42), pitch: 1 },
      { visitorId: "a", at: at(75), pitch: 2 },
      { visitorId: "c", at: at(-120), pitch: 2 },
      { visitorId: "d", at: at(60 * 30), pitch: 2 },
    ]);
    expect([s.pitch1Clicks, s.pitch2Clicks]).toEqual([2, 2]);
  });

  test("no session time, no join-link split", () => {
    const s = pageStats([], [{ visitorId: "x", at: at(1) }], null);
    expect([s.joinBefore, s.joinAfter]).toEqual([0, 0]);
  });
});

// Reminders and objections (convex/ceo/webinarFollowUp.ts).
describe("reminders", () => {
  test("read counts as delivered, failures apart, steps in send order", () => {
    const s = reminderStats(
      [
        {
          contactId: "a",
          channel: "whatsapp",
          step: "webby_05_one_hour",
          status: "read",
          n: 1,
        },
        {
          contactId: "a",
          channel: "whatsapp",
          step: "webby_03_calendar_nudge",
          status: "delivered",
          n: 1,
        },
        {
          contactId: "b",
          channel: "whatsapp",
          step: "webby_05_one_hour",
          status: "failed",
          n: 1,
        },
        {
          contactId: "b",
          channel: "sms",
          step: "webby_05_one_hour",
          status: "delivered",
          n: 1,
        },
        { contactId: "b", channel: "email", step: null, status: null, n: 2 },
        {
          contactId: "z",
          channel: "whatsapp",
          step: null,
          status: "read",
          n: 5,
        },
      ],
      new Set(["a", "b"]),
    );
    expect(s?.whatsapp).toEqual({ sent: 3, delivered: 2, read: 1, failed: 1 });
    expect(s?.sms).toEqual({ sent: 1, delivered: 1, read: 0, failed: 0 });
    expect(s?.email.sent).toBe(2);
    expect([s?.reached, s?.readAny]).toEqual([2, 1]);
    expect(s?.steps.map(x => [x.key, x.sent, x.read])).toEqual([
      ["webby_03_calendar_nudge", 1, 0],
      ["webby_05_one_hour", 3, 1],
    ]);
  });

  test("nobody messaged, nothing to show", () => {
    expect(reminderStats([], new Set(["a"]))).toBeNull();
  });
});

describe("objections", () => {
  test("calls per category, raised and answered", () => {
    const s = objectionStats(
      [
        {
          callId: "1",
          contactId: "a",
          categories: ["price", "proof"],
          objections: [
            { category: "price", handled: "handled" },
            { category: "price", handled: "not" },
            { category: "proof", handled: "partly" },
          ],
        },
        {
          callId: "2",
          contactId: "b",
          categories: ["price"],
          objections: [{ category: "price", handled: "handled" }],
        },
        { callId: "3", contactId: "c", categories: [], objections: [] },
        {
          callId: "4",
          contactId: "x",
          categories: ["fit"],
          objections: [{ category: "fit", handled: null }],
        },
      ],
      new Set(["a", "b", "c"]),
    );
    expect([s?.calls, s?.none]).toEqual([3, 1]);
    expect(
      s?.categories.map(c => [c.key, c.calls, c.raised, c.handled]),
    ).toEqual([
      ["price", 2, 3, 2],
      ["proof", 1, 1, 0],
    ]);
    expect(s?.categories[0].label).toBe("Price or budget");
  });
});

describe("launch readiness is separate from data collection", () => {
  const now = Date.parse("2026-09-25T12:00:00Z");
  const at = "2026-09-30T17:00:00Z";
  const snapshot = () => ({
    checked_at: new Date(now).toISOString(),
    api: { start: at, ghl_token_set: true },
    page: { start: at },
    zoom: { start: at, registration: false, cloud_recording: true },
    join_link_ok: true,
    workflows: Object.fromEntries(
      ["W1", "W2", "W4a", "W4b", "W5", "W6"].map(k => [k, "published"]),
    ),
  });
  test("old workers and missing evidence never pass", () => {
    for (const s of [null, {}, { checked_at: "bad" }, []]) {
      const r = webinarReadiness(s, now);
      expect(r.status).toBe("unknown");
      expect(r.checks.every(c => c.status === "unknown")).toBe(true);
    }
  });
  test("fresh dates agree, but identity without registration is blocked", () => {
    const r = webinarReadiness(snapshot(), now);
    expect(r.checks.find(c => c.key === "schedule")?.status).toBe("ready");
    expect(r.checks.find(c => c.key === "identity")?.status).toBe("blocked");
  });
  test("registration on is not proof of matched people", () => {
    const s = snapshot();
    s.zoom.registration = true;
    expect(
      webinarReadiness(s, now).checks.find(c => c.key === "identity")?.status,
    ).toBe("unknown");
  });
  test("draft workflows and absent registration credential block", () => {
    const s = snapshot();
    s.workflows.W1 = "draft";
    s.api.ghl_token_set = false;
    const r = webinarReadiness(s, now);
    expect(
      r.checks.filter(c => c.status === "blocked").map(c => c.key),
    ).toEqual(["registration", "workflows", "identity"]);
  });
  test("disagreeing, expired, or nonstandard session times block", () => {
    const mismatch = snapshot();
    mismatch.api.start = "2026-09-29T17:00:00Z";
    const otherHour = snapshot();
    otherHour.api.start =
      otherHour.page.start =
      otherHour.zoom.start =
        "2026-09-30T18:00:00Z";
    for (const s of [mismatch, otherHour])
      expect(webinarReadiness(s, now).checks[0].status).toBe("blocked");
    const past = snapshot();
    past.api.start = past.page.start = past.zoom.start = "2026-09-20T17:00:00Z";
    expect(webinarReadiness(past, now).checks[0].status).toBe("blocked");
  });
  test("stale and future-dated evidence is unknown", () => {
    for (const offset of [-4 * 3600_000, 60_000]) {
      const s = snapshot();
      s.checked_at = new Date(now + offset).toISOString();
      expect(
        webinarReadiness(s, now).checks.every(c => c.status === "unknown"),
      ).toBe(true);
    }
  });
  test("partial or duplicate workflow evidence cannot pass", () => {
    const s = snapshot();
    s.workflows.W2 = "ambiguous";
    expect(
      webinarReadiness(s, now).checks.find(c => c.key === "workflows")?.status,
    ).toBe("unknown");
  });
});

// The shared metrics table must agree with the CEO screen, including unknowns.
describe("webinar metrics projection", () => {
  test("each round has its own scope and missing identity stays null", () => {
    const rows = extract("webinar", { rounds: [webinarRoundFixture] });
    expect(rows.length).toBe(27);
    expect(
      rows.every(
        r => r.scope === "webinar:synthetic-sep-2026" && r.window === "round",
      ),
    ).toBe(true);
    expect(rows.find(r => r.metric === "webinar.spend")?.value).toBe(2000);
    expect(
      rows.find(r => r.metric === "webinar.attendee_to_booked")?.value,
    ).toBeNull();
    expect(rows.find(r => r.metric === "webinar.cash_confirmed")?.value).toBe(
      3500,
    );
    expect(rows.find(r => r.metric === "webinar.cash")?.value).toBe(5000);
    expect(rows.every(r => DEFINITIONS.some(d => d.metric === r.metric))).toBe(
      true,
    );
  });
  test("no rounds means no invented zero-valued metrics", () => {
    expect(extract("webinar", { rounds: [] })).toEqual([]);
  });
  test("attendance is unavailable until there is evidence", () => {
    const r = {
      ...webinarRoundFixture,
      showUp: {
        ...webinarRoundFixture.showUp,
        attendanceRecorded: false,
        attended: 0,
        showRate: null,
      },
    };
    const rows = extract("webinar", { rounds: [r] });
    expect(rows.find(v => v.metric === "webinar.attended")?.value).toBeNull();
    expect(rows.find(v => v.metric === "webinar.show_rate")?.value).toBeNull();
  });
  test("lead-gen and retargeting leave the call funnel separately", () => {
    const r = withoutWebinar(
      { spend: 1000, spend_leadgen: 1000, spend_retargeting: 400 },
      { spend: 200, spend_retargeting: 100 },
    );
    expect(r.spend).toBe(800);
    expect(r.spend_leadgen).toBe(800);
    expect(r.spend_retargeting).toBe(300);
    expect(r.retargeting_share).toBe(27.3);
  });
});
