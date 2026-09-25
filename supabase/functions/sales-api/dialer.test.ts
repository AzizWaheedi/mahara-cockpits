// bun test supabase/functions/sales-api
import { describe, expect, test } from "bun:test";
import {
  afterOutcome,
  BOOKING_CALENDARS,
  type Candidate,
  calendarFor,
  callSummary,
  dayStats,
  ghlTime,
  isNoAnswer,
  kuwaitAt,
  kuwaitWords,
  matchCall,
  nextTry,
  parseSlots,
  rankForCloser,
  rankForSetter,
  routePhone,
  slotOffered,
  speedToLead,
} from "./dialer.ts";

describe("phone routing", () => {
  test("each GCC line gets its own caller ID", () => {
    const sa = routePhone("+966 55 123 4567");
    expect(sa.ok && sa.route.caller).toBe("966115203895");
    const kw = routePhone("0096550012345");
    expect(kw.ok && kw.route.caller).toBe("96522209572");
    const bh = routePhone("+97336001122");
    expect(bh.ok && bh.route.flag).toBe("BH");
  });
  test("Arabic digits and a local Saudi mobile are understood", () => {
    const r = routePhone("٠٥٥١٢٣٤٥٦٧");
    expect(r.ok && r.route.digits).toBe("966551234567");
  });
  test("a number the dialer cannot call says what to do", () => {
    const r = routePhone("+44 7700 900123");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("Maqsam");
    expect(routePhone("").ok).toBe(false);
  });
});

describe("the retry ladder", () => {
  // 2026-09-24 10:00 Kuwait
  const morning = Date.parse("2026-09-24T07:00:00Z");
  test("first miss in the morning: try again at 17:00 the same day", () => {
    const n = nextTry(0, morning);
    expect(n.step).toBe(1);
    expect(n.due).toBe(kuwaitAt(morning, 17));
  });
  test("first miss after 16:00: tomorrow at 09:00", () => {
    const late = Date.parse("2026-09-24T13:30:00Z"); // 16:30 Kuwait
    expect(nextTry(0, late).due).toBe(kuwaitAt(late, 9, 0, 1));
  });
  test("second and third misses: next day at 09:00; the fourth leaves the lead unreachable", () => {
    expect(nextTry(1, morning).due).toBe(kuwaitAt(morning, 9, 0, 1));
    expect(nextTry(3, morning)).toEqual({ step: 3, due: null, unreachable: true });
    expect(afterOutcome("no_answer", 3, morning, null).closed).toBe("unreachable");
  });
  test("booked closes the lead in the queue; a callback is due when agreed", () => {
    expect(afterOutcome("booked", 2, morning, null).closed).toBe("booked");
    const cb = morning + 3_600_000;
    expect(afterOutcome("callback", 0, morning, cb)).toEqual({ step: 0, due: cb, closed: null, callback: cb });
  });
  test("handled keeps a call-back or retry still ahead, and otherwise takes the lead out", () => {
    const cb = morning + 3_600_000;
    expect(afterOutcome("handled", 1, morning, null, { due: null, callback: cb })).toEqual({ step: 1, due: cb, closed: null, callback: cb });
    expect(afterOutcome("handled", 2, morning, null, { due: cb, callback: null })).toEqual({ step: 2, due: cb, closed: null, callback: null });
    expect(afterOutcome("handled", 0, morning, null, { due: morning - 1, callback: null }).closed).toBe("handled");
    expect(afterOutcome("handled", 0, morning, null).closed).toBe("handled");
  });
});

const NOW = Date.parse("2026-09-24T09:00:00Z");
const lead = (over: Partial<Candidate>): Candidate => ({
  contact_id: "x",
  name: null,
  phone: "+966551234567",
  created_at: NOW - 3 * 86_400_000,
  stage: null,
  lead_class: "qualified",
  dnd: false,
  last_dial_at: null,
  reached: false,
  inbound_at: null,
  booked_at: null,
  last_call_status: null,
  last_call_type: null,
  last_call_at: null,
  due_at: null,
  callback_at: null,
  closed: null,
  claimed_by: null,
  ...over,
});

describe("the queue order", () => {
  test("a lead who arrived five minutes ago comes before everything", () => {
    const q = rankForSetter(
      [
        lead({ contact_id: "old-new", created_at: NOW - 20 * 3_600_000 }),
        lead({ contact_id: "fresh", created_at: NOW - 5 * 60_000 }),
        lead({ contact_id: "retry", due_at: NOW - 60_000, last_dial_at: NOW - 86_400_000 }),
      ],
      "me",
      NOW,
    );
    expect(q.map(r => r.contact_id)).toEqual(["fresh", "old-new", "retry"]);
    expect(q[0].tier).toBe(0);
  });
  test("a reply in the last ten minutes is tier 0 even for an old lead", () => {
    const q = rankForSetter([lead({ contact_id: "r", inbound_at: NOW - 60_000, last_dial_at: NOW - 86_400_000, reached: true })], "me", NOW);
    expect(q[0].tier).toBe(0);
  });
  test("leads that must not be called are left out", () => {
    const q = rankForSetter(
      [
        lead({ contact_id: "dnd", dnd: true }),
        lead({ contact_id: "taken", claimed_by: "someone-else" }),
        lead({ contact_id: "booked", booked_at: NOW + 86_400_000 }),
        lead({ contact_id: "later", due_at: NOW + 3_600_000, last_dial_at: NOW - 3_600_000 }),
        lead({ contact_id: "closed", closed: "not_interested" }),
      ],
      "me",
      NOW,
    );
    expect(q).toEqual([]);
  });
  test("a number the dialer cannot call, and an untagged lead nobody called, stay out", () => {
    const q = rankForSetter(
      [
        lead({ contact_id: "abroad", phone: "+919303802303", created_at: NOW - 60_000 }),
        lead({ contact_id: "untagged", lead_class: null, created_at: NOW - 10 * 86_400_000 }),
        lead({ contact_id: "tagged", lead_class: "unqualified", created_at: NOW - 10 * 86_400_000 }),
      ],
      "me",
      NOW,
    );
    expect(q.map(r => r.contact_id)).toEqual(["tagged"]);
  });
  test("a missed intro comes back to be rebooked", () => {
    const q = rankForSetter([lead({ contact_id: "ns", reached: true, last_dial_at: NOW - 2 * 86_400_000, last_call_type: "intro", last_call_status: "noshow", last_call_at: NOW - 86_400_000 })], "me", NOW);
    expect(q[0].tier).toBe(2);
  });
});

test("speed to lead is minutes to the first outbound call", () => {
  expect(speedToLead(NOW, NOW + 150_000)).toBe(3);
  expect(speedToLead(NOW, null)).toBeNull();
  expect(speedToLead(NOW, NOW - 1)).toBeNull();
});

describe("the closer's queue", () => {
  const facts = { demo_at: null as number | null, demo_status: null as string | null, signed: false };
  test("an unconfirmed demo in the next two hours comes first", () => {
    const q = rankForCloser(
      [
        { ...lead({ contact_id: "fu" }), ...facts, demo_at: NOW - 86_400_000, demo_status: "showed" },
        { ...lead({ contact_id: "soon" }), ...facts, demo_at: NOW + 3_600_000, demo_status: "new" },
      ],
      "me",
      NOW,
    );
    expect(q.map(r => r.contact_id)).toEqual(["soon", "fu"]);
  });
  test("a lead who signed is never in the queue", () => {
    const q = rankForCloser([{ ...lead({ contact_id: "s" }), ...facts, demo_at: NOW - 86_400_000, demo_status: "showed", signed: true }], "me", NOW);
    expect(q).toEqual([]);
  });
  test("a missed demo from last week comes back to be rebooked", () => {
    const q = rankForCloser([{ ...lead({ contact_id: "m" }), ...facts, demo_at: NOW - 3 * 86_400_000, demo_status: "noshow" }], "me", NOW);
    expect(q[0]?.tier).toBe(2);
  });
});

describe("Maqsam's record of a call", () => {
  const start = Date.parse("2026-09-25T07:00:00Z");
  const a = { phone: "96550012345", started_at: start, maqsam_email: "tahreer@maharamedia.com", maqsam_ref: "ref-1" };
  const call = (over: Record<string, unknown> = {}) => ({
    id: 901,
    referenceId: "ref-1",
    type: "outbound",
    state: "no_answer",
    duration: 0,
    timestamp: Math.floor((start + 3_000) / 1000),
    calleeNumber: "+965 5001 2345",
    agents: [{ email: "Tahreer@maharamedia.com" }],
    ...over,
  });
  test("the same number, seat and moment is the call", () => {
    expect(matchCall(a, [call()])?.id).toBe(901);
  });
  test("another seat, another number, or a call from before the attempt is not", () => {
    expect(matchCall(a, [call({ agents: [{ email: "aziz@maharamedia.com" }] })])).toBeNull();
    expect(matchCall(a, [call({ calleeNumber: "96550099999" })])).toBeNull();
    expect(matchCall(a, [call({ timestamp: Math.floor((start - 60_000) / 1000) })])).toBeNull();
    expect(matchCall(a, [call({ referenceId: "ref-2" })])).toBeNull();
  });
  test("two calls that could both be it are no match: the outcome is never guessed", () => {
    expect(matchCall({ ...a, maqsam_ref: null }, [call({ id: 1, referenceId: null }), call({ id: 2, referenceId: null })])).toBeNull();
  });
  test("once the call id is known only that call matches", () => {
    expect(matchCall({ ...a, maqsam_call_id: "902" }, [call(), call({ id: 902 })])?.id).toBe(902);
  });
  test("only an explicit no answer with no seconds saves itself", () => {
    expect(isNoAnswer(call())).toBe(true);
    expect(isNoAnswer(call({ duration: 4 }))).toBe(false);
    expect(isNoAnswer(call({ state: "completed", duration: 0 }))).toBe(false);
    expect(isNoAnswer(call({ state: "busy" }))).toBe(false);
    expect(isNoAnswer(null)).toBe(false);
  });
  test("the words the dialer shows", () => {
    expect(callSummary(call({ state: "completed", duration: 131 }))).toEqual({ final: true, answered: true, seconds: 131, words: "Answered" });
    expect(callSummary(call({ state: "busy" }))?.words).toBe("Busy");
    expect(callSummary(call({ state: "in_progress" }))?.final).toBe(false);
    expect(callSummary(null)).toBeNull();
  });
});

describe("booking from the dialer", () => {
  test("the intro goes on the page of the lead's class; the demo on Demo", () => {
    expect(calendarFor("intro", "qualified")).toBe(BOOKING_CALENDARS.intro_qualified);
    expect(calendarFor("intro", "unqualified")).toBe(BOOKING_CALENDARS.intro_unqualified);
    expect(calendarFor("intro", null)).toBe(BOOKING_CALENDARS.intro_unqualified);
    expect(calendarFor("demo", "qualified")).toBe(BOOKING_CALENDARS.demo);
  });
  test("free slots come back as days in order, past slots dropped", () => {
    const now = Date.parse("2026-09-26T07:10:00Z"); // 10:10 Kuwait
    const days = parseSlots(
      {
        "2026-09-27": { slots: ["2026-09-27T10:00:00+03:00"] },
        "2026-09-26": { slots: ["2026-09-26T10:20:00+03:00", "2026-09-26T10:00:00+03:00"] },
        traceId: "x",
      },
      now,
    );
    expect(days).toEqual([
      { day: "2026-09-26", slots: ["2026-09-26T10:20:00+03:00"] },
      { day: "2026-09-27", slots: ["2026-09-27T10:00:00+03:00"] },
    ]);
    expect(slotOffered("2026-09-26T07:20:00.000Z", days)).toBe(true);
    expect(slotOffered("2026-09-26T07:30:00.000Z", days)).toBe(false);
    expect(slotOffered("not a time", days)).toBe(false);
  });
  test("a time in Kuwait words", () => {
    expect(kuwaitWords(Date.parse("2026-09-26T07:20:00Z"))).toBe("Sat 26 Sep, 10:20");
  });
});

describe("the rep's day", () => {
  const dayStart = Date.parse("2026-09-24T21:00:00Z"); // midnight Kuwait, 25 Sept
  const at = (h: number) => new Date(dayStart + h * 3_600_000).toISOString();
  test("saved outcomes, calls, answered and talk time, from today only", () => {
    const s = dayStats(
      [
        { state: "saved", saved_at: at(10), started_at: at(10), outcome: "no_answer", auto_saved: true, call_state: "no_answer", call_duration_s: 0, maqsam_call_id: "1" },
        { state: "saved", saved_at: at(11), started_at: at(11), outcome: "booked", call_state: "completed", call_duration_s: 300, maqsam_call_id: "2" },
        { state: "saved", saved_at: at(12), started_at: at(12), outcome: "callback", manual: true },
        { state: "placed", started_at: at(13) },
        { state: "failed", started_at: at(13) },
        { state: "saved", saved_at: at(-2), started_at: at(-2), outcome: "booked", call_state: "completed", call_duration_s: 90, maqsam_call_id: "0" },
      ],
      dayStart,
    );
    expect(s).toEqual({ saved: 3, calls: 3, answered: 1, unmatched: 1, talk_s: 300, booked: 1, auto_no_answer: 1 });
  });
});

describe("HighLevel's times", () => {
  test("a wall time with no zone is Kuwait time; an offset is kept", () => {
    expect(ghlTime("2026-09-24 16:00:00")).toBe(Date.parse("2026-09-24T13:00:00Z"));
    expect(ghlTime("2026-09-24T16:00:00+03:00")).toBe(Date.parse("2026-09-24T13:00:00Z"));
    expect(ghlTime("2026-09-24T13:00:00.000Z")).toBe(Date.parse("2026-09-24T13:00:00Z"));
    expect(Number.isNaN(ghlTime(""))).toBe(true);
    expect(Number.isNaN(ghlTime("soon"))).toBe(true);
  });
});
