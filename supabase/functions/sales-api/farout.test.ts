// bun test supabase/functions/sales-api/farout.test.ts
//
// The rules for booking past the lead's booking page and for a custom time
// (farout.ts), and the lead's own reschedule link (reschedule.ts). The first
// test runs the cockpit's rule on farout.fixtures.json, a read-only recording
// of Ahmed's five sales calendars made 2026-10-11 (GETs only; names, titles,
// notes and addresses removed): it must give exactly HighLevel's own free
// slots on every calendar-day. Every other time and person is invented.

import { describe, expect, test } from "bun:test";
import {
  addDays,
  busyMessage,
  busyOf,
  clock12,
  customCheck,
  dayStartMs,
  dayWords,
  daysBetween,
  extendedRanges,
  farDays,
  farNote,
  freeLine,
  freeStarts,
  hasHours,
  hostWeek,
  hostWindows,
  hoursWords,
  inFlightBusy,
  inFlightMessage,
  type Interval,
  openHoursOn,
  outsideMessage,
  ownDays,
  pageOf,
  placementOf,
  reachDaysOf,
  reachUntil,
  type Schedule,
  type SlotDay,
  slotString,
  unitMs,
  windowUntil,
  zoneOffsetMs,
} from "./farout.ts";
import { CUSTOM_STEP_MIN, kuwaitDay, rescheduleLink } from "./reschedule.ts";
import recorded from "./farout.fixtures.json";

type Row = Record<string, unknown>;

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const R = recorded as unknown as {
  recorded_at: number;
  host: string;
  calendars: Record<string, Row>;
  schedules: Schedule[];
  events: Row[];
  blocked: Row[];
  free_window: Record<string, Record<string, string[]>>;
  free_extended: Record<string, Record<string, string[]>>;
};
const NOW = R.recorded_at;
const AHMED = R.host;
const AZIZ = "Q4DIfzNbhg1BXJCsipwW";
const INTRO_Q = "dsqmJ393Dwl9fDSbIVOI";
const INTRO_U = "cFeDl0FY8iaXll61lus8";
const DEMO = "jQqXS1YuFnmGZKLkrE62";
const DEMO2 = "NDBNz6Og4yfpdpWmHrue";
const FOLLOW = "JTNg1Wd62qxuT8W8sroh";

/** A Kuwait wall time. */
const kw = (day: string, hm: string) => Date.parse(`${day}T${hm}:00+03:00`);
const days = (m: Record<string, string[]>): SlotDay[] =>
  Object.entries(m)
    .map(([day, slots]) => ({ day, slots }))
    .sort((a, b) => a.day.localeCompare(b.day));
const instants = (list: string[]) => list.map(s => Date.parse(s)).sort((a, b) => a - b);

describe("the cockpit's rule against HighLevel's own free slots (the recording)", () => {
  const busy = busyOf(R.events, R.blocked, R.calendars);

  test("90 of 90 calendar-days identical, every day past the public window included", () => {
    let total = 0;
    const different: string[] = [];
    for (const [c, cal] of Object.entries(R.calendars)) {
      for (const [day, theirs] of Object.entries(R.free_extended[c] ?? {})) {
        const mine = ownDays({ schedules: R.schedules, cal, calendarId: c, userId: AHMED, busy, days: [day], now: NOW });
        total++;
        if (JSON.stringify(instants(mine[0]?.slots ?? [])) !== JSON.stringify(instants(theirs))) different.push(`${c} ${day}`);
      }
    }
    expect(total).toBe(90);
    expect(different).toEqual([]);
  });

  test("the window ends where HighLevel's normal answer ends; the far days are HighLevel's extended days after it", () => {
    expect(windowUntil(days(R.free_window[INTRO_Q] ?? {}), R.calendars[INTRO_Q] as Row, NOW)).toBe("2026-10-12");
    expect(windowUntil(days(R.free_window[DEMO] ?? {}), R.calendars[DEMO] as Row, NOW)).toBe("2026-10-13");
    const reach = reachUntil(NOW, 60);
    expect(reach).toBe("2026-12-09");
    for (const c of [INTRO_Q, INTRO_U, DEMO, DEMO2]) {
      const cal = R.calendars[c] as Row;
      const end = windowUntil(days(R.free_window[c] ?? {}), cal, NOW);
      const far = daysBetween(addDays(end, 1), "2026-11-01");
      const own = ownDays({ schedules: R.schedules, cal, calendarId: c, userId: AHMED, busy, days: far, now: NOW });
      const got = farDays(own, days(R.free_extended[c] ?? {}), end, reach);
      const want = days(R.free_extended[c] ?? {}).filter(d => d.day > end);
      expect(got.agreed).toBe(true);
      expect(got.days.map(d => [d.day, instants(d.slots)])).toEqual(want.map(d => [d.day, instants(d.slots)]));
    }
  });

  test("the cockpit's slots come in HighLevel's own shape", () => {
    const own = ownDays({ schedules: R.schedules, cal: R.calendars[DEMO] as Row, calendarId: DEMO, userId: AHMED, busy, days: ["2026-10-21"], now: NOW });
    expect(own[0]?.slots[0]).toBe("2026-10-21T09:00:00+03:00");
    expect(slotString(kw("2026-10-21", "17:40"))).toBe("2026-10-21T17:40:00+03:00");
  });
});

describe("hostWindows: whose hours apply", () => {
  const demo = R.calendars[DEMO] as Row;
  const introU = R.calendars[INTRO_U] as Row;
  const wed = "2026-10-21";
  const fri = "2026-10-23";

  test("the host's own schedule that lists the calendar (Ahmed, Wednesday 9 to 6)", () => {
    expect(hostWindows(R.schedules, demo, DEMO, AHMED, wed)).toEqual([[kw(wed, "09:00"), kw(wed, "18:00")]]);
    expect(hostWindows(R.schedules, demo, DEMO, AHMED, fri)).toEqual([]);
    expect(hostWindows(R.schedules, demo, DEMO, AHMED, "2026-10-25")).toEqual([[kw("2026-10-25", "08:00"), kw("2026-10-25", "17:00")]]);
  });

  test("not linked while another person's schedule lists the calendar: no hours (Aziz on the demo)", () => {
    const aziz: Schedule = { id: "s-aziz", userId: AZIZ, calendarIds: [], rules: [{ type: "wday", day: "wednesday", intervals: [{ from: "00:00", to: "23:55" }] }] };
    expect(hostWindows([...R.schedules, aziz], demo, DEMO, AZIZ, wed)).toEqual([]);
  });

  test("no schedule lists the calendar anywhere: the calendar's own open hours", () => {
    expect(hostWindows([], demo, DEMO, AZIZ, wed)).toEqual([[kw(wed, "00:00"), kw(wed, "23:55")]]);
    // A calendar with no open hours ({} as HighLevel stores it) and no schedule: nothing.
    expect(hostWindows([], introU, INTRO_U, AZIZ, wed)).toEqual([]);
  });

  test("a date rule replaces its weekday; an empty one is a day off", () => {
    const s = structuredClone(R.schedules[0]) as Schedule;
    s.rules = [...(s.rules ?? []), { type: "date", date: wed, intervals: [{ from: "12:00", to: "14:00" }] }, { type: "date", date: "2026-10-22", intervals: [] }];
    expect(hostWindows([s], demo, DEMO, AHMED, wed)).toEqual([[kw(wed, "12:00"), kw(wed, "14:00")]]);
    expect(hostWindows([s], demo, DEMO, AHMED, "2026-10-22")).toEqual([]);
    expect(hostWindows([s], demo, DEMO, AHMED, "2026-10-20")).toEqual([[kw("2026-10-20", "09:00"), kw("2026-10-20", "18:00")]]);
  });

  test("the calendar's open hours cut the schedule; a calendar with none adds no cut", () => {
    const narrow = { ...demo, openHours: [{ daysOfTheWeek: [3], hours: [{ openHour: 10, openMinute: 30, closeHour: 12, closeMinute: 0 }] }] };
    expect(hostWindows(R.schedules, narrow, DEMO, AHMED, wed)).toEqual([[kw(wed, "10:30"), kw(wed, "12:00")]]);
    // The calendar opens Wednesdays only: closed on Thursday whatever the schedule says.
    expect(hostWindows(R.schedules, narrow, DEMO, AHMED, "2026-10-22")).toEqual([]);
    expect(openHoursOn(introU, wed)).toBeNull();
    expect(openHoursOn({ openHours: [] }, wed)).toBeNull();
    expect(hostWindows(R.schedules, introU, INTRO_U, AHMED, wed)).toEqual([[kw(wed, "09:00"), kw(wed, "18:00")]]);
  });

  test("a schedule kept in another zone is read in that zone; a deleted one is ignored", () => {
    const dubai: Schedule = { userId: "u-dubai", calendarIds: [DEMO], timezone: "Asia/Dubai", rules: [{ type: "wday", day: "wednesday", intervals: [{ from: "10:00", to: "11:00" }] }] };
    expect(hostWindows([dubai], demo, DEMO, "u-dubai", wed)).toEqual([[kw(wed, "09:00"), kw(wed, "10:00")]]);
    expect(zoneOffsetMs("Asia/Kuwait", NOW)).toBe(3 * HOUR);
    expect(zoneOffsetMs("Not/AZone", NOW)).toBe(3 * HOUR);
    expect(hostWindows([{ ...dubai, deleted: true }], demo, DEMO, "u-dubai", wed)).toEqual([[kw(wed, "00:00"), kw(wed, "23:55")]]);
  });

  test("hasHours over a week, and the week's hours in words for Custom time", () => {
    const week = daysBetween("2026-10-18", "2026-10-24");
    expect(hasHours(R.schedules, demo, DEMO, AHMED, week)).toBe(true);
    expect(hasHours([...R.schedules, { userId: AZIZ, calendarIds: [] }], demo, DEMO, AZIZ, week)).toBe(false);
    const w = hostWeek({ schedules: R.schedules, cal: demo, calendarId: DEMO, userId: AHMED, now: NOW });
    expect(w.wed).toEqual([["09:00", "18:00"]]);
    expect(w.sun).toEqual([["08:00", "17:00"]]);
    expect(w.fri).toEqual([]);
    const allDay = hostWeek({ schedules: [], cal: { openHours: [{ daysOfTheWeek: [0, 1, 2, 3, 4, 5, 6], hours: [{ openHour: 0, openMinute: 0, closeHour: 24, closeMinute: 0 }] }] }, calendarId: DEMO, userId: AZIZ, now: NOW });
    expect(allDay.mon).toEqual([["00:00", "24:00"]]);
  });
});

describe("busyOf and freeStarts", () => {
  const cals = R.calendars;
  const day = "2026-10-21";

  test("cancelled and invalid calls and deleted rows are left out; a no-show still held the slot", () => {
    const events = [
      { id: "a", calendarId: DEMO, startTime: `${day}T10:00:00+03:00`, endTime: `${day}T10:45:00+03:00`, appointmentStatus: "cancelled" },
      { id: "b", calendarId: DEMO, startTime: `${day}T11:00:00+03:00`, endTime: `${day}T11:45:00+03:00`, appointmentStatus: "invalid" },
      { id: "c", calendarId: DEMO, startTime: `${day}T12:00:00+03:00`, endTime: `${day}T12:45:00+03:00`, appointmentStatus: "noshow" },
      { id: "d", calendarId: DEMO, startTime: `${day}T13:00:00+03:00`, endTime: `${day}T13:45:00+03:00`, appointmentStatus: "confirmed", deleted: true },
    ];
    const blocks = [{ startTime: `${day}T16:00:00+03:00`, endTime: `${day}T16:30:00+03:00`, deleted: true }];
    expect(busyOf(events, blocks, cals).map(b => b.start)).toEqual([kw(day, "12:00")]);
  });

  test("a call widens by its own calendar's buffer: an intro at 14:00 on another calendar takes the 14:15 follow-up slot", () => {
    const events = [{ id: "i", calendarId: INTRO_Q, startTime: `${day} 14:00:00`, endTime: `${day} 14:15:00`, appointmentStatus: "confirmed" }];
    const busy = busyOf(events, [], cals);
    expect(busy[0]).toEqual({ start: kw(day, "14:00"), end: kw(day, "14:15"), from: kw(day, "14:00"), to: kw(day, "14:20"), what: "call" });
    const follow = cals[FOLLOW] as Row;
    const starts = freeStarts(follow, [[kw(day, "13:30"), kw(day, "15:00")]], busy, 0);
    expect(starts.map(clock12)).toEqual(["1:30 pm", "1:45 pm", "2:30 pm", "2:45 pm"]);
    // A calendar not in the map adds no buffer.
    expect(busyOf(events, [], {})[0]?.to).toBe(kw(day, "14:15"));
  });

  test("a block that started the day before still counts; the call being moved never blocks itself", () => {
    const blocks = [{ startTime: "2026-10-20T22:00:00+03:00", endTime: `${day}T10:00:00+03:00` }];
    const events = [{ id: "moving", calendarId: DEMO, startTime: `${day}T11:00:00+03:00`, endTime: `${day}T11:45:00+03:00`, appointmentStatus: "confirmed" }];
    const busy = busyOf(events, blocks, cals, "moving");
    expect(busy).toHaveLength(1);
    expect(busy[0]?.what).toBe("busy");
    const starts = freeStarts(cals[DEMO] as Row, [[kw(day, "09:00"), kw(day, "18:00")]], busy, 0);
    expect(starts[0]).toBe(kw(day, "10:00"));
    expect(starts).toContain(kw(day, "11:00"));
  });

  test("the step (20 minutes, an hour), the notice, and the call ending by the close", () => {
    const intro = cals[INTRO_Q] as Row;
    const win: Interval[] = [[kw(day, "09:00"), kw(day, "18:00")]];
    const s = freeStarts(intro, win, [], 0);
    expect(s[1]).toBe(kw(day, "09:20"));
    expect(s[s.length - 1]).toBe(kw(day, "17:40"));
    const d = freeStarts(cals[DEMO] as Row, win, [], 0);
    expect(d.length).toBe(9);
    expect(d[d.length - 1]).toBe(kw(day, "17:00"));
    expect(freeStarts(cals[DEMO] as Row, win, [], kw(day, "12:30"))[0]).toBe(kw(day, "13:00"));
    expect(freeStarts({ slotDuration: 0 }, win, [], 0)).toEqual([]);
  });

  test("units", () => {
    expect(unitMs(1, "hours")).toBe(HOUR);
    expect(unitMs(2, "days")).toBe(2 * DAY);
    expect(unitMs(15, undefined)).toBe(15 * MIN);
    expect(unitMs(null, "mins")).toBe(0);
    expect(unitMs("", "mins")).toBe(0);
  });
});

describe("the window, the reach and the far days", () => {
  test("windowUntil from the calendar when HighLevel's answer is empty: today is day one; no limit is the days asked", () => {
    expect(windowUntil([], R.calendars[DEMO] as Row, NOW)).toBe("2026-10-13");
    expect(windowUntil([], { allowBookingFor: 2, allowBookingForUnit: "days" }, NOW)).toBe("2026-10-12");
    expect(windowUntil([], { allowBookingFor: 1, allowBookingForUnit: "weeks" }, NOW)).toBe("2026-10-17");
    expect(windowUntil([], R.calendars[FOLLOW] as Row, NOW)).toBe("2026-10-25");
    expect(windowUntil([{ day: "2026-10-12" }, { day: "2026-10-14" }], R.calendars[DEMO] as Row, NOW)).toBe("2026-10-14");
  });

  test("reach_days: absent 60, a whole number from 15 to 120, anything else 60", () => {
    expect(reachDaysOf(null)).toBe(60);
    expect(reachDaysOf({})).toBe(60);
    expect(reachDaysOf({ reach_days: 30 })).toBe(30);
    expect(reachDaysOf({ reach_days: 15 })).toBe(15);
    expect(reachDaysOf({ reach_days: 120 })).toBe(120);
    for (const bad of [14, 121, "30", 30.5, -1, null]) expect(reachDaysOf({ reach_days: bad })).toBe(60);
    expect(reachUntil(NOW, 15)).toBe("2026-10-25");
  });

  test("farDays: both sources, the cockpit's own when HighLevel's could not be read, only days after the window and up to the reach", () => {
    const own: SlotDay[] = [
      { day: "2026-10-13", slots: ["2026-10-13T09:00:00+03:00"] },
      { day: "2026-10-20", slots: ["2026-10-20T09:00:00+03:00", "2026-10-20T10:00:00+03:00"] },
      { day: "2026-10-21", slots: ["2026-10-21T09:00:00+03:00"] },
      { day: "2026-12-10", slots: ["2026-12-10T09:00:00+03:00"] },
    ];
    const ext: SlotDay[] = [{ day: "2026-10-20", slots: ["2026-10-20T06:00:00.000Z", "2026-10-20T13:00:00+03:00"] }];
    expect(farDays(own, ext, "2026-10-13", "2026-12-09")).toEqual({
      days: [{ day: "2026-10-20", slots: ["2026-10-20T09:00:00+03:00"] }],
      agreed: true,
    });
    expect(farDays(own, null, "2026-10-13", "2026-12-09")).toEqual({
      days: [own[1] as SlotDay, own[2] as SlotDay],
      agreed: false,
    });
  });

  test("placementOf", () => {
    const start = kw("2026-10-20", "10:00");
    expect(placementOf({ start, windowUntil: "2026-10-13", offeredInWindow: false, custom: false })).toBe("far_out");
    expect(placementOf({ start, windowUntil: "2026-10-21", offeredInWindow: false, custom: false })).toBe("window");
    expect(placementOf({ start, windowUntil: "2026-10-13", offeredInWindow: false, custom: true })).toBe("custom");
    expect(placementOf({ start, windowUntil: "2026-10-13", offeredInWindow: true, custom: true })).toBe("window");
  });

  test("the page: two weeks from today or from the asked day, never past the reach", () => {
    expect(pageOf(NOW, undefined, "2026-12-09")).toEqual({ from: "2026-10-11", to: "2026-10-24", prev: null, next: "2026-10-25" });
    expect(pageOf(NOW, "2026-10-25", "2026-12-09")).toEqual({ from: "2026-10-25", to: "2026-11-07", prev: "2026-10-11", next: "2026-11-08" });
    expect(pageOf(NOW, "2026-10-18", "2026-12-09").prev).toBe("2026-10-11");
    expect(pageOf(NOW, "2026-12-01", "2026-12-09")).toEqual({ from: "2026-12-01", to: "2026-12-09", prev: "2026-11-17", next: null });
    expect(pageOf(NOW, "2027-03-01", "2026-12-09").from).toBe("2026-12-09");
    expect(pageOf(NOW, "2026-01-01", "2026-12-09").from).toBe("2026-10-11");
    expect(pageOf(NOW, "not a day", "2026-12-09").from).toBe("2026-10-11");
  });

  test("HighLevel's extended answer is asked at most 31 days at a time", () => {
    const r = extendedRanges(NOW, NOW + 61 * DAY);
    expect(r.length).toBe(3);
    for (const [a, b] of r) expect(b - a).toBeLessThanOrEqual(31 * DAY);
    expect(r[0]?.[0]).toBe(NOW);
    expect(r[r.length - 1]?.[1]).toBe(NOW + 61 * DAY);
  });
});

describe("a custom time", () => {
  const demo = R.calendars[DEMO] as Row;
  const day = "2026-10-21";
  const windows: Interval[] = [[kw(day, "09:00"), kw(day, "18:00")]];
  const busy = busyOf(
    [{ id: "x", calendarId: INTRO_Q, startTime: `${day}T14:00:00+03:00`, endTime: `${day}T14:15:00+03:00`, appointmentStatus: "confirmed" }],
    [{ startTime: `${day}T16:00:00+03:00`, endTime: `${day}T16:30:00+03:00` }],
    R.calendars,
  );
  const check = (hm: string, now = NOW) => customCheck({ cal: demo, windows, busy, start: kw(day, hm), now, reachUntil: "2026-12-09" });

  test("free, on the 5-minute mark, inside the hours", () => {
    expect(check("10:05")).toEqual({ past: false, step: false, beyond: false, clash: null, outside: false });
    expect(CUSTOM_STEP_MIN).toBe(5);
  });

  test("each refusal: past, step, beyond, a clash with a call or busy time (with the buffers)", () => {
    expect(check("10:05", kw(day, "10:01")).past).toBe(true);
    expect(check("10:03").step).toBe(true);
    expect(customCheck({ cal: demo, windows, busy, start: kw("2026-12-10", "10:00"), now: NOW, reachUntil: "2026-12-09" }).beyond).toBe(true);
    // A 45-minute demo at 13:20 runs into the intro at 14:00; one at 14:20 starts right after its 5-minute buffer.
    expect(check("13:20").clash).toEqual({ start: kw(day, "14:00"), end: kw(day, "14:15"), what: "call" });
    expect(check("14:20").clash).toBeNull();
    // The demo's own 10-minute buffer after it: 15:10 ends 15:55, plus 10 is 16:05, into the 16:00 block.
    expect(check("15:10").clash).toEqual({ start: kw(day, "16:00"), end: kw(day, "16:30"), what: "busy" });
    expect(check("15:05").clash).toBeNull();
  });

  test("outside the hours is allowed but said: before, after, and running past the close", () => {
    expect(check("20:00").outside).toBe(true);
    expect(check("08:30").outside).toBe(true);
    expect(check("17:30").outside).toBe(true);
    expect(check("17:15").outside).toBe(false);
  });
});

describe("the words", () => {
  const day = "2026-10-21";
  test("a clash with a call, with busy time, across days, and with no name", () => {
    expect(busyMessage({ start: kw(day, "14:00"), end: kw(day, "14:15"), what: "call" }, "Ahmed Al Mutairi")).toBe(
      "Ahmed has another call from 2:00 pm to 2:15 pm (Kuwait time). Pick another time.",
    );
    expect(busyMessage({ start: kw(day, "14:00"), end: kw(day, "14:30"), what: "busy" }, "Ahmed")).toBe(
      "Ahmed's calendar is busy from 2:00 pm to 2:30 pm (Kuwait time). Pick another time.",
    );
    expect(busyMessage({ start: kw(day, "14:00"), end: kw(day, "14:30"), what: "busy" }, "Abbas")).toBe(
      "Abbas' calendar is busy from 2:00 pm to 2:30 pm (Kuwait time). Pick another time.",
    );
    expect(busyMessage({ start: kw(day, "00:00"), end: kw("2026-10-23", "00:00"), what: "busy" }, null)).toBe(
      "The host's calendar is busy from Wed 21 Oct, 12:00 am to Fri 23 Oct, 12:00 am (Kuwait time). Pick another time.",
    );
  });

  test("outside the working hours, a day off, and the free line", () => {
    expect(outsideMessage("Ahmed", [[kw(day, "09:00"), kw(day, "18:00")]], day)).toBe(
      "That's outside Ahmed's working hours (9:00 am to 6:00 pm on Wednesdays). Press Book anyway to keep it, or pick another time.",
    );
    expect(outsideMessage("Ahmed", [], "2026-10-23")).toBe(
      "Ahmed has no working hours on Fridays in HighLevel. Press Book anyway to keep it, or pick another time.",
    );
    expect(freeLine("Ahmed Al Mutairi")).toBe("Free for Ahmed, inside working hours.");
    expect(hoursWords([])).toBe("no working hours that day");
    expect(hoursWords([[kw(day, "08:00"), kw(day, "12:00")], [kw(day, "13:00"), kw(day, "17:00")]])).toBe(
      "8:00 am to 12:00 pm and 1:00 pm to 5:00 pm",
    );
    expect(dayWords("2026-12-09")).toBe("Wed 9 Dec");
  });

  test("the far note: none, unread (the calendar, the setting), and nothing when the far times show", () => {
    expect(farNote("ok", "Ahmed", "2026-10-13")).toBeNull();
    expect(farNote("none", "Aziz Waheedi", "2026-10-13")).toBe(
      "Aziz has no working hours on this calendar in HighLevel, so only the booking page's days are offered.",
    );
    expect(farNote("none", null, "2026-10-13")).toBe(
      "Nobody on this calendar has working hours in HighLevel past the booking page, so only the booking page's days are offered.",
    );
    expect(farNote("unread", "Ahmed", "2026-10-13")).toBe(
      "Times past Tue 13 Oct could not be checked just now: Ahmed's calendar did not answer. The booking page's days are below.",
    );
    expect(farNote("unread", "Ahmed", "2026-10-13", "setting")).toBe(
      "Times past Tue 13 Oct could not be checked just now: the cockpit's booking setting did not answer. The booking page's days are below.",
    );
  });

  test("days and Kuwait midnight", () => {
    expect(dayStartMs("2026-10-21")).toBe(Date.parse("2026-10-20T21:00:00Z"));
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(daysBetween("2026-10-30", "2026-11-02")).toEqual(["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"]);
    expect(daysBetween("2026-11-02", "2026-10-30")).toEqual([]);
    expect(kuwaitDay(kw("2026-10-21", "23:59"))).toBe("2026-10-21");
  });
});

describe("the lead's own reschedule link (D17, verified 2026-10-11)", () => {
  test("the exact verified link for the test appointment", () => {
    expect(rescheduleLink(INTRO_U, R.calendars[INTRO_U], "hAl3lnR1WDbwru7wiSKw")).toBe(
      "https://link.maharamedia.com/widget/booking/cFeDl0FY8iaXll61lus8?event_id=hAl3lnR1WDbwru7wiSKw",
    );
  });

  test("intros and Follow up call allow it; demos do not; a switched-off calendar or a bad id never", () => {
    expect(rescheduleLink(INTRO_Q, R.calendars[INTRO_Q], "appt_1-x")).toBe("https://link.maharamedia.com/widget/booking/dsqmJ393Dwl9fDSbIVOI?event_id=appt_1-x");
    expect(rescheduleLink(FOLLOW, R.calendars[FOLLOW], "a1")).toBe("https://link.maharamedia.com/widget/booking/JTNg1Wd62qxuT8W8sroh?event_id=a1");
    expect(rescheduleLink(DEMO, R.calendars[DEMO], "a1")).toBeNull();
    expect(rescheduleLink(DEMO2, R.calendars[DEMO2], "a1")).toBeNull();
    expect(rescheduleLink(INTRO_Q, { ...R.calendars[INTRO_Q], isActive: false }, "a1")).toBeNull();
    expect(rescheduleLink(INTRO_Q, { isActive: true }, "a1")).toBeNull();
    expect(rescheduleLink(INTRO_Q, null, "a1")).toBeNull();
    expect(rescheduleLink(INTRO_Q, R.calendars[INTRO_Q], "a1&x=1")).toBeNull();
    expect(rescheduleLink("../x", R.calendars[INTRO_Q], "a1")).toBeNull();
    expect(rescheduleLink(INTRO_Q, R.calendars[INTRO_Q], "")).toBeNull();
  });
});

// Review (setter and closer lens), 2026-10-11: a custom time goes with
// HighLevel's own slot check off, so the cockpit's own calls on their way
// to HighLevel count as taken.
describe("the host's calls on their way to HighLevel", () => {
  const t = (hm: string) => Date.parse(`2026-11-04T${hm}:00+03:00`);
  test("a booking keeps its own end and its calendar's buffers; a move takes its calendar's length, else an hour", () => {
    const cal = { slotDuration: 45, slotDurationUnit: "mins", slotBuffer: 10, slotBufferUnit: "mins" };
    const rows = inFlightBusy(
      [{ id: "b1", calendar_id: "C1", start_at: "2026-11-04T07:00:00+00:00", end_at: "2026-11-04T07:15:00+00:00" }],
      [
        { id: "m1", calendar_id: "C1", to_start: "2026-11-04T09:00:00+00:00" },
        { id: "m2", calendar_id: "unread", to_start: "2026-11-04T12:00:00Z" },
        { id: "m3", calendar_id: "C1", to_start: null },
      ],
      { C1: cal },
    );
    expect(rows.map(r => [r.start, r.end, r.from, r.to, r.what])).toEqual([
      [t("10:00"), t("10:15"), t("10:00"), t("10:25"), "call"],
      [t("12:00"), t("12:45"), t("12:00"), t("12:55"), "call"],
      [t("15:00"), t("16:00"), t("15:00"), t("16:00"), "call"],
    ]);
  });

  test("the sentence names the host and the time, on one day or across two", () => {
    expect(inFlightMessage({ start: t("10:00"), end: t("10:15") }, "Sami Closer")).toBe(
      "Someone is booking Sami from 10:00 am to 10:15 am (Kuwait time) right now. Pick another time.",
    );
    expect(inFlightMessage({ start: t("23:30"), end: t("23:30") + 60 * 60_000 }, null)).toBe(
      "Someone is booking the host from Wed 4 Nov, 11:30 pm to Thu 5 Nov, 12:30 am (Kuwait time) right now. Pick another time.",
    );
  });
});
