// bun test supabase/functions/sales-api/reschedule.test.ts
//
// The rules a cockpit reschedule is judged by (reschedule.ts). Every lead,
// seat and time is invented.

import { describe, expect, test } from "bun:test";
import { checkSnippet } from "./lib.ts";
import {
  alreadyBookedMessage,
  bookedWords,
  canReschedule,
  clash,
  classifyGhl,
  confirmationCounts,
  firstName,
  followUpCalendar,
  ghlReason,
  type Hold,
  holdLapse,
  holdStart,
  holdsByCall,
  kindOfCalendar,
  kuwaitDay,
  kuwaitWords12,
  LATE_AFTER_MS,
  meetUrl,
  mergeTeamSlots,
  moveNoteText,
  openUntil,
  overInCrm,
  rescheduledMarkMessage,
  settle,
} from "./reschedule.ts";

const MIN = 60_000;
const HOUR = 60 * MIN;
/** Kuwait wall time on Sunday 11 October 2026. */
const kw = (hhmm: string, day = "2026-10-11") => Date.parse(`${day}T${hhmm}:00+03:00`);

const CALENDARS = {
  dsqmJ393Dwl9fDSbIVOI: { label: "Intro (qualified page)", type: "intro" },
  cFeDl0FY8iaXll61lus8: { label: "Intro (unqualified page)", type: "intro" },
  jQqXS1YuFnmGZKLkrE62: { label: "Demo", type: "demo" },
  NDBNz6Og4yfpdpWmHrue: { label: "Demo 2", type: "demo" },
  JTNg1Wd62qxuT8W8sroh: { label: "Follow up call", type: "follow_up" },
  Vo8Jh1EJQE3pzwsKebxK: { label: "Callback request", type: "callback" },
};

describe("which calendar holds which call", () => {
  test("Demo 2 is a demo, Follow up call a follow-up call, a callback calendar none of the three", () => {
    expect(kindOfCalendar("NDBNz6Og4yfpdpWmHrue", CALENDARS)).toBe("demo");
    expect(kindOfCalendar("jQqXS1YuFnmGZKLkrE62", CALENDARS)).toBe("demo");
    expect(kindOfCalendar("dsqmJ393Dwl9fDSbIVOI", CALENDARS)).toBe("intro");
    expect(kindOfCalendar("JTNg1Wd62qxuT8W8sroh", CALENDARS)).toBe("follow_up");
    expect(kindOfCalendar("Vo8Jh1EJQE3pzwsKebxK", CALENDARS)).toBeNull();
    // Never "anything that is not a demo is an intro".
    expect(kindOfCalendar("unknown-calendar", CALENDARS)).toBeNull();
    expect(kindOfCalendar("dsqmJ393Dwl9fDSbIVOI", null)).toBeNull();
  });

  test("the one follow-up calendar, or none when the setting has none or two", () => {
    expect(followUpCalendar(CALENDARS)).toBe("JTNg1Wd62qxuT8W8sroh");
    expect(followUpCalendar({ a: { type: "intro" } })).toBeNull();
    expect(followUpCalendar({ a: { type: "follow_up" }, b: { type: "follow_up" } })).toBeNull();
  });
});

describe("words", () => {
  test("12-hour Kuwait time, noon and midnight said right", () => {
    expect(kuwaitWords12(kw("17:00", "2026-10-13"))).toBe("Tue 13 Oct, 5:00 pm");
    expect(kuwaitWords12(kw("12:00"))).toBe("Sun 11 Oct, 12:00 pm");
    expect(kuwaitWords12(kw("00:20", "2026-10-12"))).toBe("Mon 12 Oct, 12:20 am");
    expect(kuwaitWords12(kw("09:05"))).toBe("Sun 11 Oct, 9:05 am");
    expect(kuwaitDay(kw("00:20", "2026-10-12"))).toBe("2026-10-12");
  });

  test("the toasts and the already-booked answer", () => {
    expect(bookedWords("intro")).toBe("Intro booked");
    expect(bookedWords("follow_up")).toBe("Follow-up call booked");
    expect(alreadyBookedMessage("demo", kw("16:30", "2026-10-12"))).toBe(
      "They already have a demo on Mon 12 Oct, 4:30 pm (Kuwait time). Reschedule that one instead of booking a second.",
    );
    expect(alreadyBookedMessage("intro", kw("16:30", "2026-10-12"))).toContain("They already have an intro on");
    expect(rescheduledMarkMessage(kw("17:00", "2026-10-13"))).toBe("This call was rescheduled to Tue 13 Oct, 5:00 pm. Mark it after then.");
    expect(firstName("Ahmad Al Mutairi")).toBe("Ahmad");
    expect(firstName("  ")).toBeNull();
  });

  test("the HighLevel note names the new time once (D18)", () => {
    const line = moveNoteText({
      kind: "demo",
      from: kw("16:30", "2026-10-12"),
      to: kw("17:00", "2026-10-13"),
      hostName: "Ahmad Al Mutairi",
      repName: "Sara Khalil",
      reason: "they_asked",
      note: null,
    });
    expect(line).toBe(
      "Rescheduled the demo from Mon 12 Oct, 4:30 pm to Tue 13 Oct, 5:00 pm (Kuwait time), with Ahmad Al Mutairi. By Sara Khalil in the cockpit. Why: they asked.",
    );
    expect(line.match(/Tue 13 Oct, 5:00 pm/g)).toHaveLength(1);
    const cant = moveNoteText({
      kind: "follow_up",
      from: kw("10:00"),
      to: kw("11:00"),
      hostName: "Aziz Waheedi",
      previousHostName: "Ahmad Al Mutairi",
      hostChanged: true,
      repName: "Sara Khalil",
      reason: "host_cant",
      note: null,
      afterStart: true,
    });
    expect(cant).toContain("Rescheduled the follow-up call from");
    expect(cant).toContain("with Aziz Waheedi (instead of Ahmad Al Mutairi)");
    expect(cant).toContain("Why: Ahmad can't make it.");
    expect(cant).toContain("The call's start had passed.");
    const other = moveNoteText({ kind: "intro", from: kw("10:00"), to: kw("11:00"), hostName: null, repName: "Sara", reason: "other", note: "Travelling that day." });
    expect(other).toBe("Rescheduled the intro from Sun 11 Oct, 10:00 am to Sun 11 Oct, 11:00 am (Kuwait time). By Sara in the cockpit. Why: Travelling that day.");
  });
});

describe("who may reschedule, and when (D41 to D43)", () => {
  const appt = { start_at: new Date(kw("16:30")).toISOString(), status: "confirmed", assigned_user_id: "G-closer" };
  const base = {
    appt,
    mark: null as string | null,
    joined: false,
    who: { manager: false, email: "setter@stress.invalid", ghl_user_id: "G-setter" },
    owner: null as string | null,
    bookerEmail: null as string | null,
    client: false,
    clientMessage: "An active client.",
    now: kw("14:00"),
    hostName: "Ahmad Al Mutairi",
    leadName: "Mona Al Harbi",
  };

  test("a manager, the host, the owner or the seat that booked it may; anyone else is told whose it is", () => {
    expect(canReschedule({ ...base })?.code).toBe("not_yours");
    expect(canReschedule({ ...base })?.status).toBe(403);
    expect(canReschedule({ ...base })?.message).toBe("This call is Ahmad's. Ask Ahmad or a manager to reschedule it.");
    expect(canReschedule({ ...base, hostName: null })?.message).toBe("This call is another rep's. Ask them or a manager to reschedule it.");
    expect(canReschedule({ ...base, who: { ...base.who, manager: true } })).toBeNull();
    expect(canReschedule({ ...base, who: { ...base.who, ghl_user_id: "G-closer" } })).toBeNull();
    expect(canReschedule({ ...base, owner: "G-setter" })).toBeNull();
    expect(canReschedule({ ...base, bookerEmail: "Setter@Stress.invalid" })).toBeNull();
    // A seat with no HighLevel user is never "the host" of an unassigned call.
    expect(canReschedule({ ...base, appt: { ...appt, assigned_user_id: null }, who: { email: "x@stress.invalid", ghl_user_id: null } })?.code).toBe(
      "not_yours",
    );
  });

  const ok = { ...base, owner: "G-setter" };

  test("an active client, then a call over, held on video, or late", () => {
    expect(canReschedule({ ...ok, client: true })).toEqual({ code: "client", status: 409, message: "An active client." });
    expect(canReschedule({ ...ok, mark: "noshow" })?.message).toBe("This call is already marked no-show. Book a new one instead.");
    expect(canReschedule({ ...ok, mark: "cancelled" })?.message).toBe("This call was cancelled. Book a new one instead.");
    expect(canReschedule({ ...ok, appt: { ...appt, status: "showed" } })?.code).toBe("over");
    expect(canReschedule({ ...ok, joined: true })?.message).toBe("Mona joined the video call for this one, so it happened. Mark it instead.");
    const start = kw("16:30");
    expect(canReschedule({ ...ok, now: start + LATE_AFTER_MS })).toBeNull();
    expect(canReschedule({ ...ok, now: start + LATE_AFTER_MS + 1000 })?.code).toBe("late");
    // In order: not yours before client before over.
    expect(canReschedule({ ...base, client: true, mark: "noshow" })?.code).toBe("not_yours");
    expect(canReschedule({ ...ok, client: true, mark: "noshow" })?.code).toBe("client");
    expect(canReschedule({ ...ok, mark: "showed", joined: true })?.code).toBe("over");
  });
});

describe("HighLevel's own status before a move (D46)", () => {
  test("cancelled, no-show, held or disqualified in HighLevel is over, whatever the cockpit's copy says", () => {
    expect(overInCrm("cancelled")).toEqual({ code: "over", status: 409, message: "This call was cancelled in HighLevel. Book a new one instead." });
    expect(overInCrm("noshow")?.message).toBe("This call is already marked no-show in HighLevel. Book a new one instead.");
    expect(overInCrm("showed")?.message).toBe("This call is already marked held in HighLevel. Book a new one instead.");
    expect(overInCrm(" Invalid ")?.message).toBe("This call is already marked disqualified in HighLevel. Book a new one instead.");
  });
  test("a live status, or none read, lets it move", () => {
    for (const s of ["new", "confirmed", "booked", "", null, undefined]) expect(overInCrm(s)).toBeNull();
  });
});

describe("clash, HighLevel's answers, the read-back", () => {
  test("another live call of the lead overlapping the new time", () => {
    const others = [{ id: "d1", start: kw("17:00"), end: kw("17:45"), kind: "demo" as const }];
    expect(clash(kw("16:30"), kw("16:45"), others)).toBeNull();
    expect(clash(kw("16:50"), kw("17:05"), others)?.id).toBe("d1");
    expect(clash(kw("17:45"), kw("18:00"), others)).toBeNull();
    // No end known: taken as 45 minutes.
    expect(clash(kw("17:30"), kw("17:45"), [{ id: "x", start: kw("17:00"), end: null }])?.id).toBe("x");
  });

  test("an HTTP refusal is refused; no answer is unknown", () => {
    expect(classifyGhl(Object.assign(new Error("HighLevel said 422: The slot you have selected is no longer available"), { status: 422 }))).toBe("refused");
    expect(classifyGhl(Object.assign(new Error("HighLevel did not answer within 25 seconds"), { status: 0 }))).toBe("unknown");
    expect(classifyGhl(Object.assign(new Error("HighLevel said 502: bad gateway"), { status: 502 }))).toBe("unknown");
    expect(classifyGhl(new Error("socket hang up"))).toBe("unknown");
    expect(ghlReason(new Error("HighLevel said 422: The slot you have selected is no longer available"))).toBe(
      "The slot you have selected is no longer available",
    );
  });

  test("the read-back: new time moved, old time not moved, a third time unverified, unread null", () => {
    const from = kw("16:30");
    const to = kw("17:00", "2026-10-13");
    expect(settle(to, from, to)).toBe("moved");
    expect(settle(to + 30_000, from, to)).toBe("moved");
    expect(settle(from, from, to)).toBe("not_moved");
    expect(settle(kw("18:00"), from, to)).toBe("unverified");
    expect(settle(null, from, to)).toBeNull();
  });
});

describe("confirmations count per time (D37)", () => {
  const call = { start_at: "2026-10-13T14:00:00.000Z" };
  test("a confirmation of the old time does not confirm the new one", () => {
    expect(confirmationCounts({ result: "confirmed", start_at: "2026-10-13T14:00:00+00:00" }, call)).toBe(true);
    expect(confirmationCounts({ result: "reschedule", start_at: "2026-10-13 14:00:00+00" }, call)).toBe(true);
    expect(confirmationCounts({ result: "confirmed", start_at: "2026-10-12T13:30:00.000Z" }, call)).toBe(false);
    // A row with no start keeps counting, as today.
    expect(confirmationCounts({ result: "confirmed", start_at: null }, call)).toBe(true);
    expect(confirmationCounts({ result: "no_answer", start_at: call.start_at }, call)).toBe(false);
  });
});

describe("the Zoom address", () => {
  test("a demo's Zoom link is kept; a phone number in the address is not", () => {
    expect(meetUrl("https://us06web.zoom.us/j/81001879864?pwd=abc.1")).toBe("https://us06web.zoom.us/j/81001879864?pwd=abc.1");
    expect(meetUrl(" https://zoom.us/j/1 ")).toBe("https://zoom.us/j/1");
    expect(meetUrl(" 055 445 5823")).toBeNull();
    expect(meetUrl("https://evil.example/zoom.us/j/1")).toBeNull();
    expect(meetUrl(null)).toBeNull();
  });
});

describe("the mirror's hold (D34)", () => {
  const from = "2026-10-12T13:30:00.000Z";
  const to = "2026-10-13T14:00:00.000Z";
  const made = "2026-10-11T11:00:00.000Z";
  const h: Hold = { id: "r1", appointment_id: "a1", from_start: from, to_start: to, from_user_id: "G-a", to_user_id: "G-a", created_at: made };
  const now = Date.parse("2026-10-11T11:10:00Z");

  test("B2B still showing the old time keeps the cockpit's new time", () => {
    const v = holdStart({ start_at: "2026-10-12 13:30:00+00", assigned_user_id: "G-a" }, [h], now);
    expect(v).toEqual({ kind: "hold", start_at: to, assigned_user_id: null, ids: ["r1"], since: Date.parse(made) });
  });

  test("the host follows when the move changed it, unless B2B already shows someone else", () => {
    const moved = { ...h, to_user_id: "G-b" };
    const v = holdStart({ start_at: from, assigned_user_id: "G-a" }, [moved], now);
    expect(v.kind === "hold" && v.assigned_user_id).toBe("G-b");
    const other = holdStart({ start_at: from, assigned_user_id: "G-c" }, [moved], now);
    expect(other.kind === "hold" && other.assigned_user_id).toBeNull();
  });

  test("B2B showing the new time ends the hold; a third time releases it", () => {
    expect(holdStart({ start_at: "2026-10-13 14:00:00+00" }, [h], now)).toEqual({ kind: "caught", ids: ["r1"] });
    expect(holdStart({ start_at: "2026-10-14T10:00:00Z" }, [h], now)).toEqual({ kind: "released", ids: ["r1"], why: "moved again in HighLevel" });
  });

  test("a hold lapses at the later of a day or an hour after the new start", () => {
    expect(holdLapse(h)).toBe(Date.parse(to) + HOUR);
    const soon = { ...h, to_start: "2026-10-11T12:00:00.000Z" };
    expect(holdLapse(soon)).toBe(Date.parse(made) + 24 * HOUR);
    const v = holdStart({ start_at: from }, [h], Date.parse(to) + HOUR + 1000);
    expect(v).toEqual({ kind: "released", ids: ["r1"], why: "lapsed: B2B never showed the new time" });
  });

  test("moved twice in the cockpit: either old time is held to the newest", () => {
    const second: Hold = { ...h, id: "r2", from_start: to, to_start: "2026-10-14T09:00:00.000Z", created_at: "2026-10-11T11:05:00.000Z" };
    const v = holdStart({ start_at: from }, [second, h], now);
    expect(v.kind).toBe("hold");
    expect(v.kind === "hold" && v.start_at).toBe("2026-10-14T09:00:00.000Z");
    expect(v.kind === "hold" && v.ids).toEqual(["r1", "r2"]);
    expect(holdStart({ start_at: to }, [second, h], now).kind).toBe("hold");
    expect(holdStart({ start_at: "2026-10-14T09:00:00Z" }, [second, h], now)).toEqual({ kind: "caught", ids: ["r1", "r2"] });
  });

  test("no holds, nothing to do; rows group by call", () => {
    expect(holdStart({ start_at: from }, [], now)).toEqual({ kind: "none" });
    const g = holdsByCall([
      { id: "r1", appointment_id: "a1", from_start: from, to_start: to, created_at: made },
      { id: "r2", appointment_id: "a2", from_start: from, to_start: to, created_at: made },
      { id: "r3", appointment_id: "a1", from_start: to, to_start: from, created_at: made },
      { id: "r4", appointment_id: "", from_start: from, to_start: to, created_at: made },
    ]);
    expect([...g.keys()]).toEqual(["a1", "a2"]);
    expect(g.get("a1")?.map(x => x.id)).toEqual(["r1", "r3"]);
  });
});

describe("the free times", () => {
  test("up to the last day the calendar opens, or the last day with a time", () => {
    const now = kw("14:43");
    expect(openUntil({ allowBookingFor: 3, allowBookingForUnit: "days" }, [], now)).toBe("2026-10-14");
    expect(openUntil({ allowBookingFor: 2, allowBookingForUnit: "days" }, [{ day: "2026-10-15" }], now)).toBe("2026-10-15");
    expect(openUntil({}, [{ day: "2026-10-12" }, { day: "2026-10-16" }], now)).toBe("2026-10-16");
    expect(openUntil({}, [], now)).toBeNull();
  });

  test("anyone free: each time with the first teammate who has it", () => {
    const a = "2026-10-12T07:00:00+03:00";
    const b = "2026-10-12T08:00:00+03:00";
    const c = "2026-10-13T09:00:00+03:00";
    const out = mergeTeamSlots([
      { user_id: "G-a", name: "Ahmad", days: [{ day: "2026-10-12", slots: [b] }] },
      { user_id: "G-z", name: "Aziz", days: [{ day: "2026-10-12", slots: [a, b] }, { day: "2026-10-13", slots: [c] }] },
    ]);
    expect(out.days).toEqual([
      { day: "2026-10-12", slots: [a, b] },
      { day: "2026-10-13", slots: [c] },
    ]);
    expect(out.slot_hosts[b]).toEqual({ user_id: "G-a", name: "Ahmad" });
    expect(out.slot_hosts[a]).toEqual({ user_id: "G-z", name: "Aziz" });
  });
});

describe("the message library", () => {
  test("a Rescheduled message can be saved (D26)", () => {
    expect(checkSnippet({ moment: "rescheduled", language: "ar", body: "هلا {name}، غيرنا موعد المكالمة. صار {day} الساعة {time}." }).ok).toBe(true);
  });
});
