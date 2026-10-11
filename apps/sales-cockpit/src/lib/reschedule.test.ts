// bun test src/lib/reschedule.test.ts (in apps/sales-cockpit)
//
// The words, the row's buttons and the picker's lines of book and
// reschedule (2026-10-11), against the design's tables.
import { describe, expect, test } from "bun:test";
import {
  addDays,
  againLine,
  bookedAgain,
  callSubLine,
  clockLine,
  dayBook,
  dayChips,
  dayLine,
  dayWords,
  defaultWith,
  doneSub,
  doneTitle,
  farLine,
  groupCalls,
  holdWords,
  isFarDay,
  isWhen,
  kindOf,
  kwDay,
  latestMiss,
  linkLine,
  liveChip,
  noTimesLine,
  pickerKey,
  pickerLine,
  reasonChips,
  refusalLine,
  rowActions,
  rowPhase,
  type Slots,
  spanUntil,
  suggestedBook,
  theirTime,
  tiles,
  time12,
  timeParts,
  toastWords,
  untilWords,
  weekOf,
  weekRange,
  weekSpan,
  weekStartOf,
  weekTitle,
  weekToRead,
  whenWords,
} from "./reschedule";

/** Sun 11 Oct 2026, 14:43 in Kuwait. */
const NOW = Date.parse("2026-10-11T14:43:00+03:00");
const kw = (s: string) => new Date(`${s}+03:00`).toISOString();
const MIN = 60_000;

const mona = {
  contact_id: "c-mona",
  name: "Mona Al Harbi",
  company: "Harbi Interiors",
  country: "AE",
  phone: "+971504127781",
};
const faisal = {
  contact_id: "c-faisal",
  name: "Faisal Al Mutairi",
  company: "Mutairi Contracting",
  country: "KW",
  phone: "+96599812240",
};
const saudi = {
  ...faisal,
  contact_id: "c-sa",
  country: "SA",
  phone: "+966501234567",
};

function row(over: Record<string, unknown> = {}) {
  return {
    appointment_id: "a1",
    call_type: "demo",
    start_at: kw("2026-10-12T16:30:00"),
    status: "confirmed",
    marked_status: null,
    assigned_user_id: "u-ahmad",
    assigned_user_name: "Ahmad Al Mutairi",
    needs_mark: false,
    ...over,
  } as {
    appointment_id: string;
    call_type: string | null;
    start_at: string | null;
    status: string | null;
    marked_status: string | null;
    assigned_user_id: string | null;
    assigned_user_name: string | null;
    needs_mark: boolean;
    rescheduled_at?: string | null;
    crm_rescheduled_at?: string | null;
  };
}

describe("times are said on Kuwait's clock, 12-hour", () => {
  test("the digits and am or pm apart, and together", () => {
    expect(timeParts(kw("2026-10-12T16:30:00"))).toEqual({
      digits: "4:30",
      ap: "pm",
    });
    expect(time12(kw("2026-10-12T00:05:00"))).toBe("12:05 am");
    expect(time12(kw("2026-10-12T12:00:00"))).toBe("12:00 pm");
  });

  test("today, tomorrow, yesterday, else the date", () => {
    expect(dayWords(kw("2026-10-11T23:59:00"), NOW)).toBe("Today");
    expect(dayWords(kw("2026-10-12T00:00:00"), NOW)).toBe("Tomorrow");
    expect(dayWords(kw("2026-10-10T09:00:00"), NOW)).toBe("Yesterday");
    expect(dayWords(kw("2026-10-13T17:00:00"), NOW)).toBe("Tue 13 Oct");
    expect(dayLine(kw("2026-10-12T16:30:00"), NOW)).toBe(
      "Tomorrow, Mon 12 Oct",
    );
    expect(dayLine(kw("2026-10-13T17:00:00"), NOW)).toBe("Tue 13 Oct");
  });

  test("inside a sentence", () => {
    expect(whenWords(kw("2026-10-11T17:00:00"), NOW)).toBe("today, 5:00 pm");
    expect(whenWords(kw("2026-10-13T17:00:00"), NOW)).toBe(
      "Tue 13 Oct, 5:00 pm",
    );
    expect(isWhen(kw("2026-10-12T16:30:00"), NOW)).toBe("tomorrow, 4:30 pm");
    expect(isWhen(kw("2026-10-13T17:00:00"), NOW)).toBe(
      "on Tue 13 Oct, 5:00 pm",
    );
  });
});

describe("the lead's own clock", () => {
  test("the UAE reads an hour ahead; Kuwait and Saudi read the same", () => {
    expect(theirTime(kw("2026-10-12T16:30:00"), mona)).toBe("5:30 pm UAE");
    expect(theirTime(kw("2026-10-12T16:30:00"), faisal)).toBeNull();
    expect(theirTime(kw("2026-10-12T16:30:00"), saudi)).toBeNull();
    // Across midnight the day is named.
    expect(theirTime(kw("2026-10-12T23:30:00"), mona)).toBe("Tue 12:30 am UAE");
  });

  test("a Gulf number's clock wins over a stored country", () => {
    expect(
      theirTime(kw("2026-10-12T16:30:00"), {
        ...faisal,
        phone: "+971501112233",
      }),
    ).toBe("5:30 pm UAE");
  });

  test("the picker's clock line names the place, by the design's words", () => {
    expect(clockLine(mona, NOW)).toBe("Mona is in the UAE, an hour ahead.");
    expect(clockLine(saudi, NOW)).toBe("The same time in Saudi.");
    expect(clockLine(faisal, NOW)).toBeNull();
    // A business's name is never a greeting.
    expect(
      clockLine({ ...mona, name: "شركة الريم للتصميم", company: "الريم" }, NOW),
    ).toBe("They are in the UAE, an hour ahead.");
  });

  test("the row's line: the call, the host, and the lead's time", () => {
    expect(
      callSubLine("demo", "Ahmad Al Mutairi", kw("2026-10-12T16:30:00"), mona),
    ).toBe("Demo with Ahmad Al Mutairi. 5:30 pm for Mona, in the UAE.");
    expect(
      callSubLine("intro", "Sara Khalil", kw("2026-10-11T17:00:00"), faisal),
    ).toBe("Intro with Sara Khalil.");
    expect(callSubLine("follow_up", null, null, faisal)).toBe(
      "Follow-up call.",
    );
  });
});

describe("a row's buttons follow the design's table", () => {
  const ctx = { client: false, dnd: false };
  test("ahead by more than five minutes: Reschedule, Tell them", () => {
    expect(rowActions(row(), NOW, ctx)).toEqual(["reschedule", "tell"]);
  });
  test("in its window: Showed, Didn't happen, Reschedule", () => {
    const start = new Date(NOW + 4 * MIN).toISOString();
    expect(rowActions(row({ start_at: start }), NOW, ctx)).toEqual([
      "showed",
      "didnt",
      "reschedule",
    ]);
    const late = new Date(NOW - 20 * MIN).toISOString();
    expect(rowActions(row({ start_at: late }), NOW, ctx)).toEqual([
      "showed",
      "didnt",
      "reschedule",
    ]);
  });
  test("past its window and not marked: Showed, Didn't happen, Disqualify; never Reschedule", () => {
    const past = new Date(NOW - 20 * MIN - 1000).toISOString();
    expect(rowPhase(row({ start_at: past }), NOW)).toBe("owed");
    expect(rowActions(row({ start_at: past }), NOW, ctx)).toEqual([
      "showed",
      "didnt",
      "disqualify",
    ]);
  });
  test("marked: nothing, except Tell them on the latest no-show or cancelled call", () => {
    const past = kw("2026-10-11T12:00:00");
    const r = row({
      start_at: past,
      marked_status: "noshow",
      status: "noshow",
    });
    expect(rowActions(r, NOW, ctx)).toEqual([]);
    expect(rowActions(r, NOW, { ...ctx, latestMiss: true })).toEqual(["tell"]);
    const held = row({ start_at: past, status: "showed" });
    expect(rowActions(held, NOW, { ...ctx, latestMiss: true })).toEqual([]);
  });
  test("a follow-up call has no marks", () => {
    const fu = row({ call_type: "follow_up" });
    expect(rowActions(fu, NOW, ctx)).toEqual(["reschedule", "tell"]);
    const soon = row({
      call_type: "follow_up",
      start_at: new Date(NOW + 2 * MIN).toISOString(),
    });
    expect(rowActions(soon, NOW, ctx)).toEqual(["reschedule", "tell"]);
    const gone = row({
      call_type: "callback",
      start_at: new Date(NOW - 2 * 3_600_000).toISOString(),
    });
    expect(rowPhase(gone, NOW)).toBe("done");
    expect(rowActions(gone, NOW, ctx)).toEqual([]);
  });
  test("a callback request is never rescheduled here (sales-api answers 409 calendar)", () => {
    const cb = row({ call_type: "callback" });
    expect(rowActions(cb, NOW, ctx)).toEqual(["tell"]);
    const unknown = row({ call_type: null });
    expect(rowActions(unknown, NOW, ctx)).toEqual(["tell"]);
  });
  test("an active client: nothing; do not disturb: no Tell them", () => {
    expect(rowActions(row(), NOW, { client: true, dnd: false })).toEqual([]);
    expect(rowActions(row(), NOW, { client: false, dnd: true })).toEqual([
      "reschedule",
    ]);
  });
  test("a just-moved call is read at its new time", () => {
    const old = new Date(NOW - 30 * MIN).toISOString();
    const moved = new Date(NOW + 2 * 3_600_000).toISOString();
    expect(
      rowActions(row({ start_at: old }), NOW, { ...ctx, start: moved }),
    ).toEqual(["reschedule", "tell"]);
  });
});

describe("the Calls card's groups", () => {
  test("next, coming up, owed, before, each in its order", () => {
    const rows = [
      row({
        appointment_id: "before-1",
        start_at: kw("2026-10-08T11:00:00"),
        status: "showed",
      }),
      row({ appointment_id: "later", start_at: kw("2026-10-14T10:00:00") }),
      row({ appointment_id: "next", start_at: kw("2026-10-12T16:30:00") }),
      row({
        appointment_id: "owed",
        start_at: kw("2026-10-11T12:00:00"),
        call_type: "intro",
      }),
      row({
        appointment_id: "before-2",
        start_at: kw("2026-10-07T18:00:00"),
        status: "noshow",
      }),
    ];
    const g = groupCalls(rows, NOW);
    expect(g.next?.appointment_id).toBe("next");
    expect(g.coming.map(r => r.appointment_id)).toEqual(["later"]);
    expect(g.owed.map(r => r.appointment_id)).toEqual(["owed"]);
    expect(g.before.map(r => r.appointment_id)).toEqual([
      "before-1",
      "before-2",
    ]);
  });
  test("a call rescheduled here moves group at once", () => {
    const rows = [
      row({ appointment_id: "x", start_at: kw("2026-10-12T16:30:00") }),
      row({ appointment_id: "y", start_at: kw("2026-10-13T10:00:00") }),
    ];
    const moved: Record<string, string> = { x: kw("2026-10-14T10:00:00") };
    const g = groupCalls(rows, NOW, r => moved[r.appointment_id] ?? r.start_at);
    expect(g.next?.appointment_id).toBe("y");
  });
});

describe("Book's suggestion, the misses and the chip", () => {
  test("no intro held: Intro; intro held: Demo; demo held: Follow-up call; booked or signed: none", () => {
    const intro = row({
      call_type: "intro",
      start_at: kw("2026-10-08T11:00:00"),
      status: "showed",
    });
    const demo = row({
      call_type: "demo",
      start_at: kw("2026-10-10T11:00:00"),
      status: "showed",
    });
    expect(suggestedBook([], false, NOW)).toBe("intro");
    expect(suggestedBook([intro], false, NOW)).toBe("demo");
    expect(suggestedBook([intro, demo], false, NOW)).toBe("follow_up");
    expect(suggestedBook([intro, demo], true, NOW)).toBeNull();
    expect(suggestedBook([intro, row()], false, NOW)).toBeNull();
    // A no-show intro is not held.
    expect(
      suggestedBook(
        [{ ...intro, status: "noshow", marked_status: "noshow" }],
        false,
        NOW,
      ),
    ).toBe("intro");
  });
  test("the latest miss, and whether it was booked again", () => {
    const miss = row({
      appointment_id: "m",
      call_type: "intro",
      start_at: kw("2026-10-11T12:00:00"),
      status: "noshow",
    });
    const again = row({
      appointment_id: "b",
      call_type: "intro",
      start_at: kw("2026-10-11T17:00:00"),
    });
    expect(latestMiss([miss], NOW)?.appointment_id).toBe("m");
    expect(bookedAgain(miss, [miss], NOW)).toBeNull();
    expect(bookedAgain(miss, [miss, again], NOW)?.appointment_id).toBe("b");
    // A demo booked after a missed intro is not the intro booked again.
    expect(
      bookedAgain(miss, [miss, row({ appointment_id: "d" })], NOW),
    ).toBeNull();
  });
  test("Rescheduled shows for a day after a move, from the cockpit or HighLevel", () => {
    expect(liveChip(row(), NOW)).toEqual({
      tone: "neutral",
      label: "Confirmed",
    });
    expect(liveChip(row({ status: "new" }), NOW).label).toBe("Booked");
    expect(
      liveChip(
        row({ rescheduled_at: new Date(NOW - 3_600_000).toISOString() }),
        NOW,
      ).label,
    ).toBe("Rescheduled");
    expect(
      liveChip(
        row({
          crm_rescheduled_at: new Date(NOW - 25 * 3_600_000).toISOString(),
        }),
        NOW,
      ).label,
    ).toBe("Confirmed");
    expect(liveChip(row(), NOW, true).label).toBe("Rescheduled");
  });
  test("a callback is booked and moved as a follow-up call", () => {
    expect(kindOf("callback")).toBe("follow_up");
    expect(kindOf("demo")).toBe("demo");
    expect(kindOf(null)).toBe("intro");
  });
});

describe("the picker", () => {
  const days = [
    {
      day: "2026-10-11",
      slots: [
        kw("2026-10-11T14:00:00"),
        kw("2026-10-11T18:20:00"),
        kw("2026-10-11T18:40:00"),
      ],
    },
    {
      day: "2026-10-12",
      slots: [kw("2026-10-12T10:00:00"), kw("2026-10-12T18:00:00")],
    },
    {
      day: "2026-10-13",
      slots: [kw("2026-10-13T11:20:00"), kw("2026-10-13T17:00:00")],
    },
    { day: "2026-10-14", slots: [] },
  ];

  test("the soonest four still ahead, with the lead's clock and the host when offered", () => {
    const t = tiles(
      {
        days,
        slot_hosts: {
          [kw("2026-10-11T18:20:00")]: { user_id: "u-o", name: "Omar Haddad" },
        },
      },
      mona,
      4,
      NOW,
    );
    expect(t.map(x => `${x.day} ${x.digits} ${x.ap} ${x.theirs}`)).toEqual([
      "Today 6:20 pm 7:20 pm UAE",
      "Today 6:40 pm 7:40 pm UAE",
      "Tomorrow 10:00 am 11:00 am UAE",
      "Tomorrow 6:00 pm 7:00 pm UAE",
    ]);
    expect(t[0].host).toBe("Omar");
    expect(t[0].hostId).toBe("u-o");
    expect(t[1].host).toBeNull();
  });

  test("Another day's chips count the times ahead; how far the calendar opens", () => {
    expect(dayChips({ days }, NOW).map(c => `${c.label} ${c.count}`)).toEqual([
      "Today 2",
      "Tomorrow 2",
      "Tue 13 Oct 2",
    ]);
    expect(untilWords({ days, until: "2026-10-14" })).toBe("up to Wed 14 Oct");
    expect(untilWords({ days })).toBe("up to Tue 13 Oct");
    expect(untilWords({ days: [] })).toBeNull();
  });

  test("its lines, by the design's copy", () => {
    expect(
      pickerLine({
        mode: "reschedule",
        start: kw("2026-10-12T16:30:00"),
        host: "Ahmad Al Mutairi",
        minutes: 45,
        now: NOW,
      }),
    ).toBe(
      "Now tomorrow, 4:30 pm, with Ahmad (the same person). Kuwait time, 45 minutes.",
    );
    expect(pickerLine({ mode: "book", minutes: 15 })).toBe(
      "Kuwait time, 15 minutes.",
    );
    expect(
      holdWords("reschedule", "demo", kw("2026-10-13T17:00:00"), NOW),
    ).toBe("Rescheduling to Tue 13 Oct, 5:00 pm");
    expect(holdWords("book", "follow_up", kw("2026-10-11T17:00:00"), NOW)).toBe(
      "Booking the follow-up call for today, 5:00 pm",
    );
    expect(
      doneTitle("reschedule", "demo", kw("2026-10-13T17:00:00"), NOW),
    ).toBe("Rescheduled to Tue 13 Oct, 5:00 pm");
    expect(doneTitle("book", "intro", kw("2026-10-11T17:00:00"), NOW)).toBe(
      "Intro booked for today, 5:00 pm",
    );
    expect(toastWords("book", "demo", kw("2026-10-13T17:00:00"), NOW)).toBe(
      "Demo booked for Tue 13 Oct, 5:00 pm.",
    );
  });

  test("the done state's second line: host, the lead's clock, HighLevel's reminders", () => {
    expect(
      doneSub({
        mode: "reschedule",
        iso: kw("2026-10-13T17:00:00"),
        lead: mona,
        host: "Ahmad Al Mutairi",
      }),
    ).toBe(
      "Kuwait time, with Ahmad; 6:00 pm for Mona in the UAE. HighLevel's reminders now follow the new time.",
    );
    expect(
      doneSub({
        mode: "reschedule",
        iso: kw("2026-10-13T17:00:00"),
        lead: faisal,
        host: "Omar Haddad",
        wasHost: "Ahmad Al Mutairi",
      }),
    ).toBe(
      "Kuwait time, now with Omar instead of Ahmad. HighLevel's reminders now follow the new time.",
    );
    expect(
      doneSub({
        mode: "book",
        iso: kw("2026-10-11T17:00:00"),
        lead: faisal,
        host: "Sara Khalil",
        missed: true,
      }),
    ).toBe(
      "Kuwait time, with Sara. The missed call is marked, and HighLevel sends them its confirmation.",
    );
  });

  test("booking again after a miss starts with a line that says so", () => {
    expect(againLine(kw("2026-10-11T12:00:00"), "intro", "Sara Khalil")).toBe(
      "Missed the 12:00 pm intro. Booked again by Sara.",
    );
  });

  test("no free times, for a booking and a reschedule", () => {
    expect(
      noTimesLine({
        mode: "reschedule",
        host: "Ahmad",
        until: "up to Wed 14 Oct",
        withWho: "same",
      }),
    ).toBe(
      "Ahmad has no free time up to Wed 14 Oct. Show anyone free, or reschedule it in HighLevel.",
    );
    expect(
      noTimesLine({
        mode: "book",
        host: "Sara Khalil",
        until: "up to Tue 13 Oct",
        withWho: "me",
        onTeam: true,
      }),
    ).toBe("Sara has no free time up to Tue 13 Oct. Try Anyone free.");
  });

  test("refusals stay in the picker: taken reads the times again; a call that can't move loses its tiles", () => {
    expect(refusalLine("taken", "That time was just taken.")).toEqual({
      text: "That time was just taken.",
      tone: "warn",
      reread: true,
      blocked: false,
    });
    expect(refusalLine("late", "Mark it, then book it again.").blocked).toBe(
      true,
    );
    expect(refusalLine("not_yours", "This call is Ahmad's.").blocked).toBe(
      true,
    );
    expect(
      refusalLine("refused", "HighLevel did not reschedule it.").tone,
    ).toBe("bad");
    expect(refusalLine(null, "  ").text).toBe(
      "HighLevel refused it. Try again.",
    );
    // sales-api's own codes: a call off the intro, demo and follow-up
    // calendars loses its tiles; an unread time or host reads them again.
    expect(refusalLine("calendar", "Reschedule it in HighLevel.").blocked).toBe(
      true,
    );
    expect(refusalLine("time", "Pick a time from the list.").reread).toBe(true);
    expect(refusalLine("host", "Pick a time from the list.").reread).toBe(true);
  });

  test("the Why chips name the host; They asked comes first", () => {
    expect(reasonChips("Ahmad Al Mutairi")).toEqual([
      ["they_asked", "They asked"],
      ["host_cant", "Ahmad can't make it"],
      ["other", "Other"],
    ]);
    expect(reasonChips(null)[1][1]).toBe("The host can't make it");
  });

  test("keys: 1 to 4, A, Esc; never with a modifier, never while typing (but Esc)", () => {
    const k = (
      key: string,
      mod: Partial<Record<"altKey" | "ctrlKey" | "metaKey", boolean>> = {},
    ) => ({
      key,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      ...mod,
    });
    expect(pickerKey(k("1"), false)).toBe("1");
    expect(pickerKey(k("4"), false)).toBe("4");
    expect(pickerKey(k("5"), false)).toBeNull();
    expect(pickerKey(k("a"), false)).toBe("a");
    expect(pickerKey(k("1"), true)).toBeNull();
    expect(pickerKey(k("Escape"), true)).toBe("esc");
    expect(pickerKey(k("1", { metaKey: true }), false)).toBeNull();
  });

  test("who a new booking is with by default", () => {
    expect(defaultWith("intro", "setter")).toBe("me");
    expect(defaultWith("demo", "setter")).toBe("anyone");
    expect(defaultWith("demo", "closer")).toBe("me");
    expect(defaultWith("intro", "closer")).toBe("anyone");
    expect(defaultWith("follow_up", "manager")).toBe("me");
  });
});

// ------------------------------------------------------------ booking further out (2026-10-11)

/** A book.slots answer past the booking page: the demo's window ends Wed 14 Oct, the reach Tue 8 Dec. */
function farSlots(over: Partial<Slots> = {}): Slots {
  const at = (day: string, hm: string) => kw(`${day}T${hm}:00`);
  return {
    kind: "demo",
    calendar_id: "jQqXS1YuFnmGZKLkrE62",
    calendar: "Demo",
    minutes: 45,
    with: "same",
    fallback: false,
    on_team: true,
    host: { user_id: "u-ahmad", name: "Ahmad Al Mutairi" },
    notice: "",
    until: "2026-12-08",
    window_until: "2026-10-14",
    reach_until: "2026-12-08",
    page: {
      from: "2026-10-11",
      to: "2026-10-24",
      prev: null,
      next: "2026-10-25",
    },
    days: [
      {
        day: "2026-10-12",
        slots: [at("2026-10-12", "10:00"), at("2026-10-12", "16:00")],
      },
      { day: "2026-10-14", slots: [at("2026-10-14", "11:00")] },
      { day: "2026-10-15", slots: [at("2026-10-15", "09:00")], far: true },
      {
        day: "2026-10-18",
        slots: [at("2026-10-18", "08:00"), at("2026-10-18", "09:00")],
        far: true,
      },
    ],
    far: { state: "ok", agreed: true, note: null },
    existing: null,
    moving: null,
    ...over,
  };
}

describe("Another day, a week at a time, past the booking page", () => {
  test("the week starts on Sunday; its title and its days", () => {
    expect(kwDay(NOW)).toBe("2026-10-11");
    expect(weekStartOf("2026-10-15")).toBe("2026-10-11");
    expect(weekStartOf("2026-10-11")).toBe("2026-10-11");
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(weekTitle("2026-10-11", NOW)).toBe("This week");
    expect(weekTitle("2026-10-18", NOW)).toBe("Next week");
    expect(weekTitle("2026-10-25", NOW)).toBe("Week of 25 Oct");
    expect(weekRange("2026-10-11")).toBe("11–17 Oct");
    expect(weekRange("2026-10-25")).toBe("25–31 Oct");
    expect(weekRange("2026-11-29")).toBe("29 Nov – 5 Dec");
  });

  test("each day's count of times ahead; the edge before the first day past the booking page", () => {
    const cells = weekOf(dayBook(farSlots()), "2026-10-11", NOW);
    expect(cells.map(c => `${c.wd} ${c.num} ${c.count}`)).toEqual([
      "Sun 11 0",
      "Mon 12 2",
      "Tue 13 0",
      "Wed 14 1",
      "Thu 15 1",
      "Fri 16 0",
      "Sat 17 0",
    ]);
    expect(cells.filter(c => c.edgeBefore).map(c => c.day)).toEqual([
      "2026-10-15",
    ]);
    expect(cells.filter(c => c.far).map(c => c.day)).toEqual([
      "2026-10-15",
      "2026-10-16",
      "2026-10-17",
    ]);
    expect(cells[0].today).toBe(true);
    // A day with no time cannot be pressed; one with times can.
    expect(cells[0].disabled).toBe(true);
    expect(cells[1].disabled).toBe(false);
    expect(cells[1].label).toBe("Mon 12 Oct");
  });

  test("a day before today or past the reach is not offered; a day not read yet says so", () => {
    const book = dayBook(farSlots());
    const back = weekOf(book, "2026-10-04", NOW);
    expect(back.every(c => c.count === null && c.disabled)).toBe(true);
    const later = weekOf(book, "2026-10-25", NOW);
    expect(later.every(c => c.reading && c.count === null)).toBe(true);
    expect(weekToRead(book, "2026-10-25", NOW)).toBe("2026-10-25");
    expect(weekToRead(book, "2026-10-18", NOW)).toBeNull();
    const last = weekOf(book, "2026-12-06", NOW);
    expect(last.map(c => c.reading)).toEqual([
      true,
      true,
      true,
      false,
      false,
      false,
      false,
    ]);
    expect(weekSpan(book, NOW)).toEqual({
      first: "2026-10-11",
      last: "2026-12-06",
    });
  });

  test("a later page answers for every day it covers", () => {
    const later = farSlots({
      page: {
        from: "2026-10-25",
        to: "2026-11-07",
        prev: "2026-10-11",
        next: "2026-11-08",
      },
      days: [
        { day: "2026-10-26", slots: [kw("2026-10-26T10:00:00")], far: true },
      ],
      slot_hosts: {
        [kw("2026-10-26T10:00:00")]: { user_id: "u-o", name: "Omar Haddad" },
      },
    });
    const book = dayBook(farSlots(), [later]);
    expect(book.read).toEqual([
      ["2026-10-11", "2026-10-24"],
      ["2026-10-25", "2026-11-07"],
    ]);
    expect(weekToRead(book, "2026-10-25", NOW)).toBeNull();
    const cells = weekOf(book, "2026-10-25", NOW);
    expect(cells.map(c => c.count)).toEqual([0, 1, 0, 0, 0, 0, 0]);
    expect(book.slot_hosts[kw("2026-10-26T10:00:00")].name).toBe("Omar Haddad");
  });

  test("an answer from before the far-out build (no page): everything it sent, up to its own last day", () => {
    const old = farSlots({
      page: undefined,
      window_until: undefined,
      reach_until: undefined,
      far: undefined,
      until: "2026-10-14",
      days: farSlots().days.filter(d => !d.far),
    });
    const book = dayBook(old);
    expect(book.read).toBeNull();
    const cells = weekOf(book, "2026-10-11", NOW);
    expect(cells.map(c => c.count)).toEqual([0, 2, 0, 1, null, null, null]);
    expect(cells.some(c => c.edgeBefore || c.far || c.reading)).toBe(false);
    expect(weekSpan(book, NOW).last).toBe("2026-10-11");
  });

  test("tiles past the booking page are marked far; the hold says so", () => {
    const s = farSlots({
      days: [
        { day: "2026-10-15", slots: [kw("2026-10-15T09:00:00")], far: true },
      ],
    });
    expect(isFarDay("2026-10-15", s)).toBe(true);
    expect(isFarDay("2026-10-14", s)).toBe(false);
    // After window_until even without the mark.
    expect(isFarDay("2026-10-20", s)).toBe(true);
    expect(tiles(s, faisal, 4, NOW)[0].far).toBe(true);
    expect(
      holdWords("reschedule", "demo", kw("2026-10-15T09:00:00"), NOW, {
        far: true,
      }),
    ).toBe("Rescheduling to Thu 15 Oct, 9:00 am · past the booking page");
    expect(
      holdWords("book", "intro", kw("2026-11-04T20:00:00"), NOW, {
        far: true,
        outside: true,
        host: "Ahmad Al Mutairi",
      }),
    ).toBe("Booking the intro for Wed 4 Nov, 8:00 pm · outside Ahmad's hours");
  });

  test("the lines: where the booking page stops, what the lead's link shows, how far 'no free time' reaches", () => {
    expect(farLine({ windowUntil: "2026-10-14", who: "Ahmad" })).toBe(
      "The lead's booking page stops at Wed 14 Oct. Later times come from Ahmad's working hours and calendar.",
    );
    expect(farLine({ windowUntil: "2026-10-14", who: "you" })).toBe(
      "The lead's booking page stops at Wed 14 Oct. Later times come from your working hours and calendar.",
    );
    expect(farLine({ windowUntil: "2026-10-14", who: null })).toContain(
      "each person's working hours",
    );
    expect(farLine({ windowUntil: null, who: "Ahmad" })).toBeNull();
    expect(linkLine("2026-10-13")).toBe(
      "They'll see the booking page's own days, up to Tue 13 Oct.",
    );
    expect(linkLine(null)).toBe("They'll see the booking page's own days.");
    // "Another day" names the reach; "no free time" only what was read.
    expect(untilWords(farSlots())).toBe("up to Tue 8 Dec");
    expect(spanUntil(farSlots())).toBe("up to Sat 24 Oct");
    expect(
      spanUntil(
        farSlots({
          far: { state: "unread", agreed: null, note: "x" },
          until: "2026-10-14",
        }),
      ),
    ).toBe("up to Wed 14 Oct");
  });

  test("the new refusals: Book anyway outside hours; a busy host or an unread calendar reads again", () => {
    expect(
      refusalLine("outside_hours", "That's outside Ahmad's working hours."),
    ).toEqual({
      text: "That's outside Ahmad's working hours.",
      tone: "warn",
      reread: false,
      blocked: false,
      anyway: true,
    });
    expect(refusalLine("host_busy", "Ahmad has another call.").reread).toBe(
      true,
    );
    expect(refusalLine("far_unread", "Could not check.").reread).toBe(true);
    for (const code of ["beyond_reach", "step", "host_needed"]) {
      const a = refusalLine(code, "Pick another.");
      expect(a).toEqual({
        text: "Pick another.",
        tone: "warn",
        reread: false,
        blocked: false,
      });
    }
  });

  test("the done state says a custom time sits outside the host's hours", () => {
    expect(
      doneSub({
        mode: "reschedule",
        iso: kw("2026-11-04T20:00:00"),
        lead: faisal,
        host: "Ahmad Al Mutairi",
        outside: true,
      }),
    ).toBe(
      "Kuwait time, with Ahmad. Outside Ahmad's working hours. HighLevel's reminders now follow the new time.",
    );
  });
});
