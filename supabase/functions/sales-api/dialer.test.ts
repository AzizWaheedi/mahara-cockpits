// bun test supabase/functions/sales-api
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  afterOutcome,
  appointmentEffect,
  type Appt,
  appointmentWork,
  BOOKING_CALENDARS,
  introWaiting,
  type Candidate,
  calendarFor,
  callSummary,
  dayStats,
  ghlTime,
  heat,
  isNoAnswer,
  kuwaitAt,
  kuwaitWords,
  matchCall,
  nextMorning,
  nextTry,
  parseSlots,
  rankForCloser,
  rankForSetter,
  readyOf,
  revenueOf,
  routePhone,
  slotOffered,
  stageRole,
  tagsFor,
  targetRoles,
  whenWords,
  nextWorkingNine,
  burstAnchor,
  CONFIRM_FROM,
  markWork,
  mergeMisses,
  quickRetryDue,
  secondTry,
  setterScope,
  speedToday,
  salesLineCall,
  lineAddress,
  stageConfirms,
  voiceFacts,
  voiceNoteDue,
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
  test("first miss after 16:00: the next working morning at 09:00 (Thursday: Saturday)", () => {
    const late = Date.parse("2026-09-24T13:30:00Z"); // Thursday 16:30 Kuwait
    expect(nextTry(0, late).due).toBe(kuwaitAt(late, 9, 0, 2));
  });
  test("second and third misses: the next working morning at 09:00; the fourth leaves the lead unreachable", () => {
    expect(nextTry(1, morning).due).toBe(kuwaitAt(morning, 9, 0, 2)); // Thursday: Saturday
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
  sales_lead: true,
  stage_role: null,
  revenue: null,
  readiness: null,
  misses: 0,
  hot: false,
  hot_owner: null,
  hot_next_at: null,
  appt: null,
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
  test("a number the dialer cannot call, and a contact who is no lead, stay out; a lead in a pipeline without a tag comes in", () => {
    const q = rankForSetter(
      [
        lead({ contact_id: "abroad", phone: "+919303802303", created_at: NOW - 60_000 }),
        lead({ contact_id: "nobody", lead_class: null, sales_lead: false, created_at: NOW - 10 * 86_400_000 }),
        lead({ contact_id: "tagged", lead_class: "unqualified", created_at: NOW - 10 * 86_400_000 }),
        lead({ contact_id: "piped", lead_class: null, stage_role: "new", created_at: NOW - 9 * 86_400_000 }),
      ],
      "me",
      NOW,
    );
    expect(q.map(r => r.contact_id)).toEqual(["tagged", "piped"]);
  });
  test("within a tier the hottest lead goes first", () => {
    const q = rankForSetter(
      [
        lead({ contact_id: "cold", lead_class: "unqualified", created_at: NOW - 12 * 86_400_000 }),
        lead({ contact_id: "hot", lead_class: "qualified", revenue: "$1M-$2M", readiness: "$8K - $12K", created_at: NOW - 20 * 86_400_000 }),
      ],
      "me",
      NOW,
    );
    expect(q.map(r => r.contact_id)).toEqual(["hot", "cold"]);
    expect(q[0].hot_reasons).toEqual(["Qualified", "$1M+ a year", "Ready to invest"]);
  });
  test("resting stages stay out unless the lead writes", () => {
    const resting = { stage_role: "nurture_long" as const, created_at: NOW - 12 * 86_400_000 };
    expect(rankForSetter([lead({ contact_id: "n", ...resting })], "me", NOW)).toEqual([]);
    const wrote = rankForSetter([lead({ contact_id: "n", ...resting, inbound_at: NOW - 3_600_000 })], "me", NOW);
    expect(wrote[0]?.why).toBe("Wrote back today");
  });
  test("a hot lead comes back at its planned follow-up, for its owner", () => {
    const h = lead({ contact_id: "h", hot: true, hot_owner: "me", hot_next_at: NOW - 60_000, closed: "not_interested" });
    expect(rankForSetter([h], "me", NOW)[0]).toMatchObject({ tier: 0, why: "Hot lead: the follow-up is due now" });
    expect(rankForSetter([{ ...h, hot_next_at: NOW - 3_600_000 }], "me", NOW)[0]?.tier).toBe(1);
    expect(rankForSetter([h], "someone-else", NOW)).toEqual([]);
    expect(rankForSetter([h], "boss", NOW, null, true)).toHaveLength(1);
  });
  test("calls from the softphone move the retry ladder too", () => {
    const tenAm = Date.parse("2026-09-24T07:00:00Z");
    const tried = lead({ contact_id: "t", created_at: tenAm - 3 * 86_400_000, misses: 1, last_dial_at: tenAm });
    expect(rankForSetter([tried], "me", tenAm + 2 * 3_600_000)).toEqual([]);
    const later = rankForSetter([tried], "me", Date.parse("2026-09-24T14:30:00Z"));
    expect(later[0]?.why).toBe("Next try is due (1 unanswered on Maqsam)");
    expect(rankForSetter([lead({ ...tried, misses: 4 })], "me", Date.parse("2026-09-26T14:30:00Z"))).toEqual([]);
  });
  test("a missed intro comes back to be rebooked: today's work for its first day, then due to day seven", () => {
    const ns = (ago: number) =>
      rankForSetter([lead({ contact_id: "ns", reached: true, last_dial_at: NOW - 9 * 86_400_000, last_call_type: "intro", last_call_status: "noshow", last_call_at: NOW - ago })], "me", NOW);
    expect(ns(3 * 3_600_000)[0]).toMatchObject({ tier: 1, code: "intro_noshow", why: "Missed the intro, rebook it" });
    expect(ns(86_400_000)[0]).toMatchObject({ tier: 2, code: "intro_noshow" });
    expect(ns(6 * 86_400_000)[0]?.tier).toBe(2);
    expect(ns(8 * 86_400_000)).toEqual([]);
  });
});

describe("the closer's queue", () => {
  const facts = { demo_at: null as number | null, demo_status: null as string | null, signed: false };
  test("an unconfirmed demo booked days ahead comes first in its last three hours", () => {
    const appt: Appt = { id: "d1", type: "demo", start: NOW + 2 * 3_600_000, booked: NOW - 2 * 86_400_000, status: "confirmed", assigned: "ghl-me", confirmed: false, last_try: null };
    const q = rankForCloser(
      [
        { ...lead({ contact_id: "fu" }), ...facts, demo_at: NOW - 86_400_000, demo_status: "showed" },
        { ...lead({ contact_id: "soon", booked_at: appt.start, appt }), ...facts },
      ],
      "me",
      NOW,
      "ghl-me",
    );
    expect(q.map(r => [r.contact_id, r.kind, r.tier])).toEqual([["soon", "confirm", 0], ["fu", "lead", 1]]);
    expect(rankForCloser([{ ...lead({ contact_id: "other", appt }), ...facts }], "me", NOW, "ghl-other")).toEqual([]);
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

describe("heat, from the form's answers", () => {
  test("revenue bands in English and Arabic", () => {
    expect(revenueOf("$500k-$1M")).toBe(500_000);
    expect(revenueOf("$1M- $2.5M")).toBe(1_000_000);
    expect(revenueOf("$2.5M+")).toBe(2_500_000);
    expect(revenueOf("اكثر من $5M")).toBe(5_000_000);
    expect(revenueOf("أقل من $100,000")).toBe(40_000);
    expect(revenueOf("")).toBeNull();
  });
  test("money ready to invest", () => {
    expect(readyOf("$4K - $8K")).toEqual({ ready: true, floor: 4_000 });
    expect(readyOf("$12K أكثر من")).toEqual({ ready: true, floor: 12_000 });
    expect(readyOf("عندي ما بين 2000$ إلى 5000$ جاهز للاستثمار")).toEqual({ ready: true, floor: 2_000 });
    expect(readyOf("مو مستعد للاستثمار حالياً")).toEqual({ ready: false, floor: null });
    expect(readyOf(null)).toBeNull();
  });
  test("a lead that wrote today and came in this hour is hot", () => {
    const h = heat(lead({ lead_class: "qualified", created_at: NOW - 600_000, inbound_at: NOW - 300_000 }), NOW);
    expect(h.score).toBe(7);
    expect(h.reasons).toEqual(["Qualified", "Wrote to us", "Came in this hour"]);
  });
});

describe("what a stage means", () => {
  test("the sales pipelines' own stage names", () => {
    const names: [string, string][] = [
      ["🚨New Lead", "new"],
      ["👀Intro Call REQUESTED", "intro_booked"],
      ["📞Intro Call CONFIRMED", "intro_confirmed"],
      ["👎Intro No Show", "intro_noshow"],
      ["Cancelled Intro Call", "intro_cancelled"],
      ["Intro Taken Didn't Convert", "no_progress"],
      ["📅Demo Booked (Qualified)", "demo_booked"],
      ["Demo Cancelled", "demo_cancelled"],
      ["Demo No Show", "demo_noshow"],
      ["Showed - Didn't Close", "no_progress"],
      ["🔥Hot Leads", "hot"],
      ["⏳Short Term Nurture", "nurture_short"],
      ["⏰Long Term Nurture", "nurture_long"],
      ["🛑DISQUALIFIED", "disqualified"],
      ["⏯️Paused", "paused"],
      ["💰Deposit / FU Booked", "deposit"],
      ["👎No Show", "demo_noshow"],
      [" 📞Call CONFIRMED", "demo_booked"],
      ["🎉Closed ", "won"],
      ["Offboarded", "won"],
    ];
    for (const [name, role] of names) expect([name, stageRole(name)]).toEqual([name, role]);
    expect(stageRole(null)).toBeNull();
  });
});

describe("appointment work", () => {
  const base: Appt = { id: "a1", type: "intro", start: NOW + 3 * 60_000, booked: NOW - 86_400_000, status: "confirmed", assigned: "ghl-tahrir", confirmed: false, last_try: null };
  test("the intro call comes up for its setter at the booked minute", () => {
    expect(appointmentWork(base, NOW, "setter", "ghl-tahrir")).toMatchObject({ tier: 0, kind: "intro" });
    expect(appointmentWork(base, NOW, "setter", "ghl-other")).toBeNull();
    expect(appointmentWork({ ...base, start: NOW - 25 * 60_000 }, NOW, "setter", "ghl-tahrir")).toBeNull();
    expect(appointmentWork({ ...base, status: "showed" }, NOW, "setter", "ghl-tahrir")).toBeNull();
  });
  test("an intro that rang out waits five minutes, then comes back inside its window", () => {
    const start = NOW - 60_000;
    const rang = { ...base, start, last_try: NOW - 2 * 60_000 };
    expect(introWaiting(rang, NOW)).toBe(true);
    expect(appointmentWork(rang, NOW, "setter", "ghl-tahrir")).toBeNull();
    const later = NOW + 4 * 60_000;
    expect(introWaiting(rang, later)).toBe(false);
    expect(appointmentWork(rang, later, "setter", "ghl-tahrir")).toMatchObject({ tier: 0, kind: "intro" });
    // A confirmation try the evening before is not a try at the intro.
    expect(introWaiting({ ...base, start, last_try: NOW - 14 * 3_600_000 }, NOW)).toBe(false);
    // Past its twenty minutes it is not the setter's call any more.
    expect(introWaiting({ ...rang, start: NOW - 25 * 60_000 }, NOW)).toBe(false);
    // While it waits, the lead is not in the setter's list at all.
    const booked = lead({ contact_id: "c-intro", appt: rang });
    expect(rankForSetter([booked], "tahreer@maharamedia.com", NOW, "ghl-tahrir").map(r => r.contact_id)).toEqual([]);
    expect(rankForSetter([booked], "tahreer@maharamedia.com", later, "ghl-tahrir")[0]).toMatchObject({ contact_id: "c-intro", kind: "intro" });
  });
  test("a call booked more than a day ahead is confirmed the evening before (morning calls) or that morning", () => {
    const eve = Date.parse("2026-09-24T15:30:00Z"); // Thursday 18:30 Kuwait
    // Saturday 10:00 Kuwait, booked three days before: due from Friday 18:00.
    // The closer confirms their own demo (2026-11-05: a demo on the
    // closer's calendar is no longer the setter's to confirm).
    const demo: Appt = { ...base, type: "demo", start: Date.parse("2026-09-26T07:00:00Z"), booked: eve - 2 * 86_400_000, assigned: "ghl-ahmed" };
    expect(appointmentWork(demo, eve, "closer", "ghl-ahmed")).toBeNull();
    const friEve = Date.parse("2026-09-25T15:10:00Z"); // Friday 18:10
    expect(appointmentWork(demo, friEve, "closer", "ghl-ahmed")).toMatchObject({ tier: 1, kind: "confirm", code: "confirm_early", why: "Confirm the demo tomorrow at 10:00" });
    expect(appointmentWork(demo, friEve, "setter", "ghl-tahrir")).toBeNull();
    expect(appointmentWork(demo, demo.start - 2 * 3_600_000, "closer", "ghl-ahmed")).toMatchObject({ tier: 0 });
    // A 16:00 call is confirmed from 09:00 that day.
    const pm: Appt = { ...demo, start: Date.parse("2026-09-26T13:00:00Z") };
    expect(appointmentWork(pm, Date.parse("2026-09-26T05:30:00Z"), "closer", "ghl-ahmed")).toBeNull();
    expect(appointmentWork(pm, Date.parse("2026-09-26T06:30:00Z"), "closer", "ghl-ahmed")).toMatchObject({ kind: "confirm" });
    expect(appointmentWork({ ...demo, booked: demo.start - 3 * 3_600_000 }, friEve, "closer", "ghl-ahmed")).toBeNull();
    expect(appointmentWork({ ...demo, confirmed: true }, friEve, "closer", "ghl-ahmed")).toBeNull();
    expect(appointmentWork({ ...demo, last_try: friEve - 3_600_000 }, friEve, "closer", "ghl-ahmed")).toBeNull();
  });
  test("times are said as a rep says them", () => {
    const at = Date.parse("2026-09-24T13:00:00Z"); // 16:00 Kuwait, a Thursday
    expect(whenWords(at, at - 3_600_000)).toBe("today at 16:00");
    expect(whenWords(at + 86_400_000, at)).toBe("tomorrow at 16:00");
    expect(whenWords(at + 3 * 86_400_000, at)).toBe("on Sunday at 16:00");
  });
});

describe("outcomes on appointment work", () => {
  test("each kind takes its own outcomes", () => {
    expect(appointmentEffect("lead", "no_answer")).toEqual({ mark: null, confirmation: null, ladder: true, rebook: false });
    expect(appointmentEffect("lead", "confirmed")).toBeNull();
    expect(appointmentEffect("intro", "showed")?.mark).toBe("showed");
    expect(appointmentEffect("intro", "no_answer")).toEqual({ mark: null, confirmation: null, ladder: false, rebook: false });
    expect(appointmentEffect("intro", "disqualified")).toMatchObject({ mark: "invalid", ladder: true });
    expect(appointmentEffect("intro", "confirmed")).toBeNull();
    expect(appointmentEffect("confirm", "confirmed")?.confirmation).toBe("confirmed");
    expect(appointmentEffect("confirm", "cancelled")).toEqual({ mark: "cancelled", confirmation: "cancelled", ladder: false, rebook: true });
    expect(appointmentEffect("confirm", "not_interested")).toMatchObject({ mark: "cancelled", ladder: true });
    // m1 round 6: the intro had on video in the confirmation call's room is marked held.
    expect(appointmentEffect("confirm", "showed")).toEqual({ mark: "showed", confirmation: "confirmed", ladder: false, rebook: false });
  });
  test("a cancelled call comes back the next working morning", () => {
    const thu = Date.parse("2026-09-24T13:00:00Z"); // Thursday 16:00 Kuwait
    expect(nextMorning(thu)).toBe(Date.parse("2026-09-26T07:00:00Z")); // Saturday 10:00
    const sat = Date.parse("2026-09-26T13:00:00Z");
    expect(nextMorning(sat)).toBe(Date.parse("2026-09-27T07:00:00Z"));
  });
});

describe("where an outcome moves the lead in the pipeline", () => {
  test("the moves HighLevel leaves undone are made; its own are not repeated", () => {
    expect(targetRoles("lead", "booked", "booked", "intro")).toEqual(["intro_booked"]);
    expect(targetRoles("intro", "booked", "booked", "demo")).toEqual(["demo_booked"]);
    expect(targetRoles("confirm", "confirmed", null, null, "intro")).toEqual(["intro_confirmed"]);
    expect(targetRoles("confirm", "confirmed", null, null, "demo")).toEqual([]);
    expect(targetRoles("confirm", "cancelled", null, null, "demo")).toEqual(["demo_cancelled"]);
    expect(targetRoles("confirm", "cancelled", null, null, "intro")).toEqual(["intro_cancelled"]);
    expect(targetRoles("intro", "noshow", null)).toEqual([]);
    expect(targetRoles("intro", "disqualified", "disqualified")).toEqual([]);
    expect(targetRoles("lead", "disqualified", "disqualified")).toEqual(["disqualified"]);
    expect(targetRoles("confirm", "not_interested", "not_interested")).toEqual(["nurture_long"]);
    expect(targetRoles("lead", "no_answer", "unreachable", null, null, "new")).toEqual(["nurture_short"]);
    expect(targetRoles("lead", "no_answer", "unreachable", null, null, "nurture_short")).toEqual(["nurture_long"]);
    expect(targetRoles("lead", "no_answer", null)).toEqual([]);
    expect(targetRoles("lead", "callback", null)).toEqual([]);
    expect(tagsFor("wrong_number")).toEqual(["wrong-number"]);
    expect(tagsFor("callback")).toEqual([]);
  });
});

describe("the retry ladder's times (Kuwait)", () => {
  const at = (iso: string) => Date.parse(iso);
  test("a morning miss comes back at 17:00, an afternoon or evening miss the next working morning", () => {
    expect(nextTry(0, at("2026-09-24T07:00:00Z")).due).toBe(at("2026-09-24T14:00:00Z")); // 10:00 -> 17:00
    expect(nextTry(0, at("2026-09-24T13:30:00Z")).due).toBe(at("2026-09-26T06:00:00Z")); // Thu 16:30 -> Sat 09:00
    expect(nextTry(0, at("2026-09-23T15:30:00Z")).due).toBe(at("2026-09-24T06:00:00Z")); // Wed 18:30 -> Thu 09:00
  });
  test("later tries skip Friday, and the fourth leaves the lead unreachable", () => {
    expect(nextTry(1, at("2026-09-24T14:00:00Z")).due).toBe(at("2026-09-26T06:00:00Z")); // Thu -> Sat
    expect(nextTry(3, at("2026-09-24T07:00:00Z")).unreachable).toBe(true);
    expect(nextWorkingNine(at("2026-09-26T07:00:00Z"))).toBe(at("2026-09-27T06:00:00Z")); // Sat -> Sun
  });
});

describe("whose lead it is (Aziz, 2026-09-27)", () => {
  // A fresh lead nobody called: in the shared queue unless another rep owns it.
  const fresh = { created_at: NOW - 2 * 86_400_000, last_dial_at: null };
  test("a lead another rep booked is theirs, and out of my queue", () => {
    expect(rankForSetter([lead({ contact_id: "a", ...fresh, owner: "other@maharamedia.com" })], "me", NOW)).toEqual([]);
  });
  test("my own lead and a lead nobody owns stay in my queue", () => {
    const q = rankForSetter(
      [lead({ contact_id: "b", ...fresh, owner: "me" }), lead({ contact_id: "c", ...fresh, owner: null })],
      "me",
      NOW,
    );
    expect(q.map(x => x.contact_id).sort()).toEqual(["b", "c"]);
  });
  test("a manager still sees another rep's lead", () => {
    const q = rankForSetter([lead({ contact_id: "d", ...fresh, owner: "other@maharamedia.com" })], "boss", NOW, null, true);
    expect(q.map(x => x.contact_id)).toEqual(["d"]);
  });
});

describe("a rep with no HighLevel user yet (2026-11-04)", () => {
  const intro: Appt = { id: "i1", type: "intro", start: NOW + 60_000, booked: NOW - 3_600_000, status: "confirmed", assigned: "ghl-ahmed", confirmed: false, last_try: null };
  const demo: Appt = { id: "d1", type: "demo", start: NOW + 2 * 3_600_000, booked: NOW - 2 * 86_400_000, status: "confirmed", assigned: "ghl-ahmed", confirmed: false, last_try: null };
  test("another rep's live intro is not on a setter's queue, and is on a manager's", () => {
    const c = lead({ contact_id: "i", appt: intro });
    expect(rankForSetter([c], "new", NOW, null, false).filter(x => x.kind === "intro")).toEqual([]);
    expect(rankForSetter([c], "boss", NOW, null, true).filter(x => x.kind === "intro")).toHaveLength(1);
  });
  test("an intro with no host is still anyone's", () => {
    const c = lead({ contact_id: "i", appt: { ...intro, assigned: null } });
    expect(rankForSetter([c], "new", NOW, null, false).filter(x => x.kind === "intro")).toHaveLength(1);
  });
  test("another closer's demo is not a closer's to confirm", () => {
    const c = lead({ contact_id: "d", appt: demo });
    expect(rankForCloser([c], "new", NOW, null, false).filter(x => x.kind === "confirm")).toEqual([]);
    expect(rankForCloser([c], "boss", NOW, null, true).filter(x => x.kind === "confirm")).toHaveLength(1);
  });
});

describe("the call centre's rules: missed calls and early call-backs (2026-09-27)", () => {
  test("a lead who called in the last ten minutes, and nobody answered, is called first", () => {
    const q = rankForSetter([lead({ contact_id: "m", inbound_call_at: NOW - 3 * 60_000, last_dial_at: NOW - 86_400_000, reached: true })], "me", NOW);
    expect(q[0]).toMatchObject({ contact_id: "m", tier: 0, why: "Called us, missed it" });
  });
  test("earlier today it is today's work, even with a retry not yet due", () => {
    const q = rankForSetter(
      [lead({ contact_id: "m", inbound_call_at: NOW - 3 * 3_600_000, last_dial_at: NOW - 86_400_000, due_at: NOW + 3_600_000 })],
      "me",
      NOW,
    );
    expect(q[0]).toMatchObject({ tier: 1, why: "Called us, missed it" });
  });
  test("a call back since, or a missed call over a day old, is not a missed call", () => {
    const since = rankForSetter([lead({ contact_id: "m", inbound_call_at: NOW - 3 * 60_000, last_dial_at: NOW - 60_000, reached: true, closed: "handled" })], "me", NOW);
    expect(since).toEqual([]);
    const old = rankForSetter([lead({ contact_id: "m", inbound_call_at: NOW - 2 * 86_400_000, closed: "handled" })], "me", NOW);
    expect(old).toEqual([]);
  });
  test("a closer sees their own lead's missed call first", () => {
    const q = rankForCloser(
      [{ ...lead({ contact_id: "c", inbound_call_at: NOW - 60_000, last_dial_at: NOW - 86_400_000 }), demo_at: NOW - 86_400_000, demo_status: "showed", signed: false }],
      "me",
      NOW,
    );
    expect(q[0]).toMatchObject({ tier: 0, why: "Called us, missed it" });
  });
  test("a call-back shows five minutes early, with its time, and not before", () => {
    // NOW is 12:00 in Kuwait; the call-back is at 12:04.
    const early = rankForSetter([lead({ contact_id: "b", callback_at: NOW + 4 * 60_000, due_at: NOW + 4 * 60_000, last_dial_at: NOW - 3_600_000 })], "me", NOW);
    expect(early[0]).toMatchObject({ tier: 0, why: "Call back at 12:04, as agreed" });
    const tooEarly = rankForSetter([lead({ contact_id: "b", callback_at: NOW + 20 * 60_000, due_at: NOW + 20 * 60_000, last_dial_at: NOW - 3_600_000 })], "me", NOW);
    expect(tooEarly).toEqual([]);
  });
});

describe("reschedule and book from the lead (2026-10-11)", () => {
  const CAL = {
    JTNg1Wd62qxuT8W8sroh: { type: "follow_up" },
    NDBNz6Og4yfpdpWmHrue: { type: "demo" },
    Vo8Jh1EJQE3pzwsKebxK: { type: "callback" },
  };
  test("a follow-up call goes on the one Follow up call calendar, or nowhere", () => {
    expect(calendarFor("follow_up", "qualified", CAL)).toBe("JTNg1Wd62qxuT8W8sroh");
    expect(calendarFor("follow_up", null, {})).toBe("");
    expect(calendarFor("follow_up", null)).toBe("");
    // New demos keep booking on Demo, never Demo 2.
    expect(calendarFor("demo", null, CAL)).toBe(BOOKING_CALENDARS.demo);
  });
  test("a follow-up call booked moves no stage; a moved call says Rescheduled", () => {
    expect(targetRoles("lead", "booked", "booked", "follow_up")).toEqual([]);
    expect(targetRoles("lead", "booked", "booked", "demo")).toEqual(["demo_booked"]);
    expect(targetRoles("lead", "booked", "booked", "intro")).toEqual(["intro_booked"]);
    expect(appointmentEffect("confirm", "rescheduled")).toEqual({ mark: null, confirmation: null, ladder: false, rebook: false });
  });
  test("a signed client or a won stage never comes up for a setter, even when they write", () => {
    const wrote = { inbound_at: NOW - 60_000, last_dial_at: NOW - 86_400_000, reached: true };
    expect(rankForSetter([lead({ contact_id: "s", signed: true, ...wrote })], "me", NOW)).toEqual([]);
    expect(rankForSetter([lead({ contact_id: "w", stage_role: "won", ...wrote })], "me", NOW)).toEqual([]);
    expect(rankForSetter([lead({ contact_id: "o", ...wrote })], "me", NOW).map(r => r.contact_id)).toEqual(["o"]);
  });
});

// ---------------------------------------------------------------------------
// The setter's one queue (Aziz, 2026-11-05): one queue all day instead of
// four Slack channels. NOW is Thursday 12:00 Kuwait.
// ---------------------------------------------------------------------------

const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

describe("1. his intro is on top at its minute (an explicit rule, not deadline order)", () => {
  const intro: Appt = { id: "i1", type: "intro", start: NOW + 2 * MIN, booked: NOW - 2 * DAY, status: "confirmed", assigned: "ghl-me", confirmed: false, last_try: null };
  const other: Appt = { id: "i2", type: "intro", start: NOW + 40 * MIN, booked: NOW - 2 * DAY, status: "confirmed", assigned: "ghl-me", confirmed: false, last_try: null };
  test("before a new lead, a reply, a missed call, a call-back and a confirmation", () => {
    const q = rankForSetter(
      [
        lead({ contact_id: "new", created_at: NOW - MIN }),
        lead({ contact_id: "wrote", inbound_at: NOW - 30_000, last_dial_at: NOW - DAY, reached: true }),
        lead({ contact_id: "rang", inbound_call_at: NOW - MIN, last_dial_at: NOW - DAY, reached: true }),
        lead({ contact_id: "back", callback_at: NOW + MIN, due_at: NOW + MIN, last_dial_at: NOW - HOUR }),
        lead({ contact_id: "confirm", appt: other, booked_at: other.start }),
        lead({ contact_id: "intro", appt: intro, booked_at: intro.start }),
      ],
      "me",
      NOW,
      "ghl-me",
    );
    expect(q[0]).toMatchObject({ contact_id: "intro", kind: "intro", code: "intro_now", tier: 0 });
    expect(q.every(r => r.tier === 0)).toBe(true);
  });
  test("from five minutes before to twenty after; a closer's intro is not the setter's", () => {
    const at = (t: number) => rankForSetter([lead({ contact_id: "intro", appt: intro })], "me", t, "ghl-me")[0]?.code;
    expect(at(intro.start - 5 * MIN)).toBe("intro_now");
    expect(at(intro.start + 20 * MIN)).toBe("intro_now");
    expect(rankForSetter([lead({ contact_id: "intro", appt: { ...intro, assigned: "ghl-closer" } })], "me", NOW, "ghl-me").filter(r => r.kind === "intro")).toEqual([]);
  });
});

describe("2. a new lead or a fresh booking: call now, twice", () => {
  test("(a) a new lead who booked an intro on the form is called now, with the booking in the words", () => {
    const q = rankForSetter(
      [lead({ contact_id: "n", created_at: NOW - 2 * MIN, just_booked: { id: "b1", start: NOW + DAY, booked: NOW - MIN }, booked_at: NOW + DAY })],
      "me",
      NOW,
    );
    expect(q[0]).toMatchObject({ tier: 0, code: "new_lead", why: "New lead, booked an intro for tomorrow at 12:00, call now", due_since: NOW - 2 * MIN });
  });
  test("(b) an older lead who booked an intro in the last half hour is called now, until someone calls", () => {
    const booked = { id: "b1", start: NOW + 2 * DAY, booked: NOW - 5 * MIN };
    const c = lead({ contact_id: "jb", created_at: NOW - 20 * DAY, last_dial_at: NOW - 10 * DAY, reached: true, just_booked: booked, booked_at: booked.start });
    expect(rankForSetter([c], "me", NOW)[0]).toMatchObject({ tier: 0, code: "just_booked", why: "Booked an intro for Saturday at 12:00, call now" });
    // Called since the booking (or an outcome saved): done.
    expect(rankForSetter([{ ...c, last_dial_at: NOW - MIN }], "me", NOW)).toEqual([]);
    // Thirty minutes on, nobody called: it waits for its confirmation and its minute.
    expect(rankForSetter([c], "me", booked.booked + 31 * MIN)).toEqual([]);
    // A booking that reopens a closed lead is the lead's own news (index.ts reopens it).
    expect(rankForSetter([{ ...c, closed: "not_interested" }], "me", NOW)).toEqual([]);
  });
  test("(c) the first no-answer comes back two minutes later as the second try; after the second, the ladder", () => {
    const created = NOW - 8 * MIN;
    const miss = NOW - 3 * MIN;
    const c = lead({ contact_id: "s", created_at: created, last_dial_at: miss, miss_times: [miss], due_at: miss + 2 * MIN, voice_note_at: miss + 30_000 });
    expect(rankForSetter([c], "me", NOW)[0]).toMatchObject({ tier: 0, code: "second_try", why: "Second try now", due_since: miss + 2 * MIN });
    // Inside the two minutes it waits out of sight (the voice note went).
    expect(rankForSetter([c], "me", miss + MIN)).toEqual([]);
    expect(secondTry(c, miss + MIN)).toBe("wait");
    // The second no-answer: the ladder's (17:00 today), not another quick try.
    const twice = { ...c, miss_times: [miss, NOW - 30_000], last_dial_at: NOW - 30_000, due_at: kuwaitAt(NOW, 17) };
    expect(secondTry(twice, NOW)).toBeNull();
    expect(rankForSetter([twice], "me", NOW)).toEqual([]);
    // An hour after the lead came in the burst is over.
    expect(secondTry(c, created + 61 * MIN)).toBeNull();
    // An answered call since the miss ends it.
    expect(secondTry({ ...c, last_dial_at: NOW - MIN }, NOW)).toBeNull();
  });
  test("a lead who just booked gets the same second try, then waits for the confirmations and the intro", () => {
    const booked = { id: "b1", start: NOW + DAY, booked: NOW - 10 * MIN };
    const base = { contact_id: "jb", created_at: NOW - 20 * DAY, reached: true, just_booked: booked, booked_at: booked.start, voice_note_at: NOW - 4 * MIN };
    const once = lead({ ...base, last_dial_at: NOW - 5 * MIN, miss_times: [NOW - 5 * MIN] });
    expect(rankForSetter([once], "me", NOW)[0]).toMatchObject({ code: "second_try", why: "Second try now (booked an intro for tomorrow at 12:00)" });
    const twice = lead({ ...base, last_dial_at: NOW - MIN, miss_times: [NOW - 5 * MIN, NOW - MIN] });
    expect(rankForSetter([twice], "me", NOW)).toEqual([]);
  });
  test("the burst's anchor, the quick retry a save sets, and one count per call", () => {
    expect(burstAnchor({ created_at: NOW - 10 * MIN, just_booked: null }, NOW)).toEqual({ at: NOW - 10 * MIN, step: "new" });
    expect(burstAnchor({ created_at: NOW - 10 * MIN, just_booked: { id: "b", start: NOW + DAY, booked: NOW - 2 * MIN } }, NOW)?.step).toBe("booked");
    expect(burstAnchor({ created_at: NOW - 61 * MIN, just_booked: null }, NOW)).toBeNull();
    expect(quickRetryDue({ at: NOW - 10 * MIN }, 0, NOW)).toBe(NOW + 2 * MIN);
    expect(quickRetryDue({ at: NOW - 10 * MIN }, 1, NOW)).toBeNull();
    expect(quickRetryDue({ at: NOW - 61 * MIN }, 0, NOW)).toBeNull();
    expect(quickRetryDue(null, 0, NOW)).toBeNull();
    // The dialer's save 40 s after Maqsam's call is that call; a softphone call ten minutes before is another.
    expect(mergeMisses([NOW], [NOW - 40_000, NOW - 10 * MIN])).toEqual([NOW - 10 * MIN, NOW]);
  });
});

describe("3. the voice note is the next step after a call nobody answered", () => {
  test("after a burst miss with no voice note since, it is an item of its own (Today, first)", () => {
    const miss = NOW - MIN;
    const c = lead({ contact_id: "v", created_at: NOW - 6 * MIN, last_dial_at: miss, miss_times: [miss], due_at: miss + 2 * MIN });
    expect(voiceNoteDue(c, NOW)).toBe("new");
    expect(rankForSetter([c], "me", NOW)[0]).toMatchObject({ tier: 1, pin: 0, code: "voice_note", voice_step: "new", why: "No answer: send a voice note" });
    // Recorded: not asked again; the second try still comes at its two minutes.
    const sent = { ...c, voice_note_at: NOW - 30_000 };
    expect(voiceNoteDue(sent, NOW)).toBeNull();
    expect(rankForSetter([sent], "me", miss + 2 * MIN)[0]).toMatchObject({ code: "second_try", voice_step: null });
  });
  test("after a confirmation call nobody answered, until the call or a voice note", () => {
    const appt: Appt = { id: "c1", type: "intro", start: NOW + 2 * HOUR, booked: NOW - 2 * DAY, status: "confirmed", assigned: "ghl-me", confirmed: false, last_try: NOW - 5 * MIN };
    const c = lead({ contact_id: "cv", appt, booked_at: appt.start, reached: true, last_dial_at: NOW - 5 * MIN });
    expect(voiceNoteDue(c, NOW)).toBe("confirm");
    expect(rankForSetter([c], "me", NOW, "ghl-me")[0]).toMatchObject({ code: "voice_note", voice_step: "confirm", why: "No answer to the confirmation: send a voice note" });
    expect(voiceNoteDue({ ...c, voice_note_at: NOW - MIN }, NOW)).toBeNull();
  });
  test("the script's facts: the form's answers, the call in both clocks, the rep's first name, what is not known", () => {
    const f = voiceFacts(
      "booked",
      {
        name: "Huda Salem",
        company: null,
        country: "AE",
        services: "Yes",
        revenue: "$500k - $1M",
        revenue_goal: "$3M+",
        readiness: "$12K أكثر من",
        decision_maker: "نعم، أنا صاحب القرار الوحيد",
        challenge: "ما يوصلنا عملاء كفاية",
      },
      { type: "intro", start: Date.parse("2026-09-26T07:00:00Z") },
      { name: "Sami Rep", name_ar: "سامي" },
    );
    expect(f).toMatchObject({
      step: "booked",
      first_name: "Huda",
      company: null,
      country: "United Arab Emirates",
      services: null,
      revenue: "$500k - $1M",
      goal: "$3M+",
      ready_to_invest: "$12K أكثر من",
      projects_12m: null,
      language: "ar",
      rep: { first_name: "Sami", first_name_ar: "سامي" },
      call: { type: "intro", start_at: "2026-09-26T07:00:00.000Z", kuwait: "Sat 26 Sep, 10:00", theirs: "11:00 their time" },
    });
    expect(f.missing).toEqual(["company", "what they do", "projects signed in the last 12 months (the form does not ask)"]);
    const en = voiceFacts("new", { name: "Omar", country: "KW", challenge: "Not enough clients" }, null, { name: null });
    expect([en.language, en.call, en.rep.first_name]).toEqual(["en", null, null]);
  });
});

describe("4. every intro and demo nobody confirmed is called from 2.5 hours before", () => {
  const start = NOW + 2 * HOUR;
  const intro: Appt = { id: "c1", type: "intro", start, booked: NOW - 5 * HOUR, status: "confirmed", assigned: "ghl-me", confirmed: false, last_try: null };
  test("booked the same day, more than three hours ahead: Call now from 2.5 hours before (it got nothing before)", () => {
    expect(appointmentWork({ ...intro, start: NOW + 3 * HOUR }, NOW, "setter", "ghl-me")).toBeNull();
    expect(appointmentWork(intro, NOW, "setter", "ghl-me")).toMatchObject({ tier: 0, kind: "confirm", code: "confirm", why: "Confirm the intro today at 14:00" });
    expect(appointmentWork(intro, start - CONFIRM_FROM, "setter", "ghl-me")?.code).toBe("confirm");
  });
  test("a try nobody answered brings it back sixty minutes before; one in the last hour leaves it to the call", () => {
    const tried = { ...intro, last_try: NOW - 5 * MIN };
    expect(appointmentWork(tried, NOW, "setter", "ghl-me")).toBeNull();
    expect(appointmentWork(tried, start - 60 * MIN, "setter", "ghl-me")).toMatchObject({ tier: 0, code: "confirm_last", why: "Confirm the intro today at 14:00, second try" });
    expect(appointmentWork({ ...intro, last_try: start - 55 * MIN }, start - 50 * MIN, "setter", "ghl-me")).toBeNull();
    // Never tried until the last hour: called then.
    expect(appointmentWork(intro, start - 30 * MIN, "setter", "ghl-me")?.code).toBe("confirm_last");
  });
  test("booked less than three hours before it starts: the just-booked call, no confirmation", () => {
    expect(appointmentWork({ ...intro, booked: start - 2 * HOUR }, NOW, "setter", "ghl-me")).toBeNull();
  });
  test("confirmed is the lead's own yes, never HighLevel's status", () => {
    expect(appointmentWork({ ...intro, confirmed: true }, NOW, "setter", "ghl-me")).toBeNull();
    // status "confirmed" alone (every calendar confirms on booking) still asks.
    expect(appointmentWork({ ...intro, status: "confirmed" }, NOW, "setter", "ghl-me")?.kind).toBe("confirm");
    expect(stageConfirms("intro_confirmed", "📞Intro Call CONFIRMED", NOW - HOUR, { type: "intro", booked: NOW - 2 * HOUR })).toBe(true);
    // The stage from an earlier booking does not confirm this one.
    expect(stageConfirms("intro_confirmed", "📞Intro Call CONFIRMED", NOW - 3 * HOUR, { type: "intro", booked: NOW - 2 * HOUR })).toBe(false);
    expect(stageConfirms("intro_confirmed", "📞Intro Call CONFIRMED", NOW, { type: "demo", booked: NOW - HOUR })).toBe(false);
    expect(stageConfirms("intro_confirmed", "📞Call CONFIRMED", NOW, { type: "demo", booked: NOW - HOUR })).toBe(true);
    expect(stageConfirms("intro_booked", "👀Intro Call REQUESTED", NOW, { type: "intro", booked: NOW - HOUR })).toBe(false);
  });
  test("the closer confirms their demos the same way; the setter leaves them alone", () => {
    const demo: Appt = { ...intro, type: "demo", assigned: "ghl-closer" };
    expect(appointmentWork(demo, NOW, "closer", "ghl-closer")).toMatchObject({ tier: 0, code: "confirm" });
    expect(appointmentWork(demo, NOW, "setter", "ghl-me")).toBeNull();
    expect(appointmentWork({ ...demo, assigned: null }, NOW, "setter", "ghl-me")?.kind).toBe("confirm");
  });
});

describe("5. replies: from both copies, kept with a booked call, and still waiting after a day", () => {
  test("a reply from a lead with their intro booked is Today's, confirmed in one tap", () => {
    const appt: Appt = { id: "i9", type: "intro", start: NOW + DAY, booked: NOW - DAY, status: "confirmed", assigned: "ghl-me", confirmed: false, last_try: null };
    const c = lead({ contact_id: "r", inbound_at: NOW - 3 * HOUR, last_dial_at: NOW - DAY, reached: true, appt, booked_at: appt.start });
    expect(rankForSetter([c], "me", NOW, "ghl-me")[0]).toMatchObject({ tier: 1, kind: "confirm", code: "reply_booked", why: "Wrote back, has an intro tomorrow at 12:00" });
    // A dial (or a saved outcome) after the reply clears it.
    expect(rankForSetter([{ ...c, last_dial_at: NOW - HOUR }], "me", NOW, "ghl-me")).toEqual([]);
  });
  test("a reply with a retry still ahead is not hidden behind it", () => {
    const c = lead({ contact_id: "r", inbound_at: NOW - 2 * HOUR, last_dial_at: NOW - 5 * HOUR, due_at: NOW + 5 * HOUR, reached: true });
    expect(rankForSetter([c], "me", NOW)[0]).toMatchObject({ tier: 1, code: "reply_today", why: "Wrote back today" });
  });
  test("older than a day and up to seven: 'Still waiting on you', lower down", () => {
    const at = (ago: number) => rankForSetter([lead({ contact_id: "r", inbound_at: NOW - ago, last_dial_at: NOW - 9 * DAY, reached: true })], "me", NOW)[0];
    expect(at(3 * DAY)).toMatchObject({ tier: 2, code: "reply_waiting", why: "Still waiting on you" });
    expect(at(8 * DAY)).toBeUndefined();
  });
});

describe("6. whose lead it is (the critic's correction, 2026-11-05)", () => {
  const fresh = { created_at: NOW - 3 * MIN, last_dial_at: null };
  test("a lead the closer owns at the intro stage is the setter's work", () => {
    const c = lead({ contact_id: "a", ...fresh, owner: "closer@x", owner_role: "closer" });
    expect(rankForSetter([c], "me", NOW).map(r => r.code)).toEqual(["new_lead"]);
    expect(setterScope(c, "me", "ghl-me", false)).toBe(true);
  });
  test("past the intro (a demo on the closer's calendar), the closer's", () => {
    const c = lead({ contact_id: "a", ...fresh, owner: "closer@x", owner_role: "closer", demo_rep: "ghl-closer" });
    expect(rankForSetter([c], "me", NOW, "ghl-me")).toEqual([]);
    // Unowned too: the demo's host has it.
    expect(rankForSetter([{ ...c, owner: null, owner_role: null }], "me", NOW, "ghl-me")).toEqual([]);
  });
  test("another setter's lead stays hidden; a call-back on another rep's calendar stays theirs", () => {
    expect(rankForSetter([lead({ contact_id: "a", ...fresh, owner: "setter2@x", owner_role: "setter" })], "me", NOW)).toEqual([]);
    const back = lead({ contact_id: "b", callback_at: NOW + MIN, due_at: NOW + MIN, last_dial_at: NOW - HOUR, callback_owner: "closer@x" });
    expect(rankForSetter([back], "me", NOW)).toEqual([]);
    expect(rankForSetter([{ ...back, callback_owner: "me" }], "me", NOW)[0]?.code).toBe("callback_now");
    expect(rankForSetter([back], "boss", NOW, null, true)).toHaveLength(1);
  });
  test("an intro no-show and a cancelled intro of a closer-owned lead come to the setter", () => {
    const ns = lead({ contact_id: "n", reached: true, last_dial_at: NOW - 9 * DAY, last_call_type: "intro", last_call_status: "noshow", last_call_at: NOW - 2 * HOUR, owner: "closer@x", owner_role: "closer" });
    expect(rankForSetter([ns], "me", NOW)[0]?.code).toBe("intro_noshow");
  });
});

describe("7. marking his intro in the queue", () => {
  const past: Appt = { id: "m1", type: "intro", start: NOW - HOUR, booked: NOW - DAY, status: "confirmed", assigned: "ghl-me", confirmed: false, last_try: null };
  test("his own intro past its twenty minutes with no mark is Today's 'Mark the intro'", () => {
    const q = rankForSetter([lead({ contact_id: "m", unmarked: past, reached: true, last_dial_at: NOW - 2 * DAY })], "me", NOW, "ghl-me");
    expect(q[0]).toMatchObject({ tier: 1, kind: "lead", code: "mark_call", why: "Mark the intro booked for today at 11:00" });
    expect(q[0]?.mark?.id).toBe("m1");
    expect(markWork(past, past.start + 19 * MIN, "setter", "ghl-me")).toBeNull();
    expect(markWork({ ...past, status: "showed" }, NOW, "setter", "ghl-me")).toBeNull();
    expect(markWork({ ...past, assigned: "ghl-closer" }, NOW, "setter", "ghl-me")).toBeNull();
    expect(markWork({ ...past, assigned: null }, NOW, "setter", "ghl-me")).toBeNull();
    expect(markWork({ ...past, assigned: null }, NOW, "setter", null)?.code).toBe("mark_call");
  });
  test("a lead with something as urgent keeps that item, the call to mark riding on it", () => {
    const q = rankForSetter([lead({ contact_id: "m", unmarked: past, inbound_at: NOW - MIN, last_dial_at: NOW - DAY, reached: true })], "me", NOW, "ghl-me");
    expect(q[0]).toMatchObject({ code: "reply_now" });
    expect(q[0]?.mark?.id).toBe("m1");
  });
  test("a closer marks their own demo", () => {
    const demo = { ...past, type: "demo" as const, assigned: "ghl-closer" };
    const q = rankForCloser([{ ...lead({ contact_id: "d", unmarked: demo }), demo_at: demo.start, demo_status: "confirmed", signed: false }], "c", NOW, "ghl-closer");
    expect(q[0]).toMatchObject({ code: "mark_call", why: "Mark the demo booked for today at 11:00" });
  });
});

describe("8. the smaller rules", () => {
  test("an intro the lead cancelled: rebook it, due, for a week", () => {
    const c = lead({ contact_id: "x", reached: true, last_dial_at: NOW - 9 * DAY, cancelled_intro_at: NOW - 2 * DAY });
    expect(rankForSetter([c], "me", NOW)[0]).toMatchObject({ tier: 2, code: "intro_cancelled", why: "Cancelled the intro, rebook it" });
    expect(rankForSetter([{ ...c, cancelled_intro_at: NOW - 8 * DAY }], "me", NOW)).toEqual([]);
    // Rebooked: nothing to rebook.
    expect(rankForSetter([{ ...c, booked_at: NOW + DAY }], "me", NOW)).toEqual([]);
  });
  test("a call-back missed today is Today's; an older one is overdue", () => {
    const at = (t: number) => rankForSetter([lead({ contact_id: "b", callback_at: t, due_at: t, last_dial_at: t - HOUR, reached: true })], "me", NOW)[0];
    expect(at(NOW - 2 * HOUR)).toMatchObject({ tier: 1, code: "callback_today", why: "Call back, missed at 10:00 today" });
    expect(at(NOW - DAY)).toMatchObject({ tier: 2, code: "callback_late", why: "Callback is overdue" });
  });
  test("new leads not reached: under an hour old first (newest first), then the rest by heat", () => {
    const q = rankForSetter(
      [
        lead({ contact_id: "old-hot", created_at: NOW - 5 * HOUR, revenue: "$1M-$2M", readiness: "$8K - $12K" }),
        lead({ contact_id: "young-cold", created_at: NOW - 50 * MIN, lead_class: "unqualified" }),
        lead({ contact_id: "younger", created_at: NOW - 20 * MIN, lead_class: "unqualified" }),
        lead({ contact_id: "old-cold", created_at: NOW - 6 * HOUR, lead_class: "unqualified" }),
      ],
      "me",
      NOW,
    );
    expect(q.map(r => r.contact_id)).toEqual(["younger", "young-cold", "old-hot", "old-cold"]);
  });
});

describe("9. not ready yet: long-term nurture, no tag, no disqualification", () => {
  test("on a lead, on the intro held, on a confirmation", () => {
    expect(appointmentEffect("lead", "not_ready")).toEqual({ mark: null, confirmation: null, ladder: true, rebook: false });
    expect(afterOutcome("not_ready", 1, NOW, null).closed).toBe("not_ready");
    expect(appointmentEffect("intro", "not_ready")).toEqual({ mark: "showed", confirmation: null, ladder: true, rebook: false });
    expect(appointmentEffect("confirm", "not_ready")).toMatchObject({ mark: "cancelled", confirmation: "cancelled", ladder: true });
    expect(targetRoles("lead", "not_ready", "not_ready")).toEqual(["nurture_long"]);
    expect(tagsFor("not_ready")).toEqual([]);
    expect(tagsFor("not_interested")).toEqual(["not interested"]);
  });
  test("a lead left not ready is out of the queue until they write", () => {
    expect(rankForSetter([lead({ contact_id: "nr", closed: "not_ready", created_at: NOW - 5 * DAY })], "me", NOW)).toEqual([]);
  });
});

describe("10. today's speed to lead for the strip", () => {
  const today = kuwaitAt(NOW, 0);
  test("the Numbers page's leads, any sales-line call, the never-called beside the median", () => {
    const leads = [
      { contact_id: "a", name: "A", phone8: "11111111", lead_created_at: new Date(today + HOUR).toISOString(), lead_class: "qualified" },
      { contact_id: "b", name: "B", phone8: "22222222", lead_created_at: new Date(today + 2 * HOUR).toISOString(), lead_class: "unqualified" },
      { contact_id: "c", name: "C", phone8: "33333333", lead_created_at: new Date(today + 3 * HOUR).toISOString(), lead_class: "qualified" },
      { contact_id: "d", name: "D", phone8: null, lead_created_at: new Date(today + 4 * HOUR).toISOString(), lead_class: "qualified" },
      // Not counted: no ROAS class, or yesterday's.
      { contact_id: "e", name: "E", phone8: null, lead_created_at: new Date(today + HOUR).toISOString(), lead_class: "unprepared" },
      { contact_id: "f", name: "F", phone8: null, lead_created_at: new Date(today - HOUR).toISOString(), lead_class: "qualified" },
    ];
    const calls = [
      { contact_id: "a", occurred_at: new Date(today + HOUR + 3 * MIN).toISOString(), sales_rep_id: "rep-closer" },
      // Not linked yet: found by its last eight digits.
      { contact_id: null, lead_phone8: "22222222", occurred_at: new Date(today + 2 * HOUR + 20 * MIN).toISOString(), sales_rep_id: "rep-closer" },
      // Before the lead came in: not their first call.
      { contact_id: "c", occurred_at: new Date(today + HOUR).toISOString(), sales_rep_id: "rep-closer" },
    ];
    expect(speedToday(leads, calls, NOW)).toEqual({
      leads: 4,
      called: 2,
      within5: 1,
      median_min: 11.5,
      not_called: 2,
      oldest_waiting: { contact_id: "c", name: "C", minutes: 9 * 60 },
    });
  });
  test("no leads yet today: nothing to measure, said as none rather than zero minutes", () => {
    expect(speedToday([], [], NOW)).toEqual({ leads: 0, called: 0, within5: 0, median_min: null, not_called: 0, oldest_waiting: null });
  });

  describe("the Numbers page's call rule (2026-11-05): a sales seat's call, by rep id or by the seat's Maqsam address", () => {
    const one = [{ contact_id: "s", name: "S", phone8: "88888888", lead_created_at: new Date(today + HOUR).toISOString(), lead_class: "qualified" }];
    const line = new Set(["setter@seat.test", "closer@seat.test"]);
    const at2 = new Date(today + HOUR + 2 * MIN).toISOString();
    test("the setter's Maqsam call, with no rep id, counts by his seat's address", () => {
      const calls = [{ contact_id: "s", occurred_at: at2, agent_email: " SETTER@seat.test", sales_rep_id: null }];
      expect(speedToday(one, calls, NOW, line)).toMatchObject({ called: 1, within5: 1, median_min: 2 });
      // Without the seats' addresses it would not.
      expect(speedToday(one, calls, NOW)).toMatchObject({ called: 0, not_called: 1 });
    });
    test("a call-centre agent's call never counts", () => {
      const calls = [{ contact_id: "s", occurred_at: at2, agent_email: "agent@callcentre.test", sales_rep_id: null }];
      expect(speedToday(one, calls, NOW, line)).toMatchObject({ called: 0, not_called: 1 });
    });
    test("a call the dialer placed counts before Maqsam's copy has it: a seat placed it", () => {
      const calls = [{ contact_id: "s", occurred_at: at2, seat: true }];
      expect(speedToday(one, calls, NOW, line)).toMatchObject({ called: 1, median_min: 2 });
    });
    test("the strip and the Numbers page share one rule (calls.ts salesLineCall)", () => {
      expect(salesLineCall({ sales_rep_id: "r" }, line)).toBe(true);
      expect(salesLineCall({ sales_rep_id: null, agent_email: "Closer@Seat.test " }, line)).toBe(true);
      expect(salesLineCall({ sales_rep_id: null, agent_email: null }, line)).toBe(false);
      expect(salesLineCall({ sales_rep_id: null, agent_email: "" }, new Set([""]))).toBe(false);
      expect(lineAddress("  A@B.test ")).toBe("a@b.test");
      // The app's copy says the same, word for word in its rule.
      const app = readFileSync(new URL("../../../apps/sales-cockpit/src/lib/calls.ts", import.meta.url), "utf8");
      expect(app).toContain("if (c.sales_rep_id) return true;\n  const a = lineAddress(c.agent_email);\n  return a.includes(\"@\") && line.has(a);");
      const server = readFileSync(new URL("./dialer.ts", import.meta.url), "utf8");
      expect(server).toContain("if (c.sales_rep_id) return true;\n  const a = lineAddress(c.agent_email);\n  return a.includes(\"@\") && line.has(a);");
    });
  });
});
