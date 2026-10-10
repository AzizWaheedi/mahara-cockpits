import { describe, expect, test } from "bun:test";
import {
  arDigits,
  bookedDemo,
  bookingLine,
  closerLine,
  introToMark,
  leadZone,
  nextSlots,
  sayWhen,
  slotWords,
} from "./booking";
import { callWhen } from "./zoomLink";

// Sun 12 Oct 2026, 15:00 in Kuwait.
const NOW = Date.parse("2026-10-12T12:00:00Z");
const H = 3_600_000;
const at = (h: number) => new Date(NOW + h * H).toISOString();

describe("nextSlots", () => {
  test("the soonest four across days, in time order, none past", () => {
    const days = [
      {
        day: "2026-10-13",
        slots: ["2026-10-13T07:00:00Z", "2026-10-13T06:00:00Z"],
      },
      {
        day: "2026-10-12",
        slots: [
          "2026-10-12T11:00:00Z",
          "2026-10-12T15:00:00Z",
          "2026-10-12T16:00:00Z",
        ],
      },
      { day: "2026-10-14", slots: ["2026-10-14T06:00:00Z"] },
    ];
    expect(nextSlots(days, 4, NOW)).toEqual([
      "2026-10-12T15:00:00Z",
      "2026-10-12T16:00:00Z",
      "2026-10-13T06:00:00Z",
      "2026-10-13T07:00:00Z",
    ]);
  });
  test("a time listed twice counts once; nothing given is nothing", () => {
    expect(
      nextSlots(
        [
          {
            day: "d",
            slots: ["2026-10-12T15:00:00Z", "2026-10-12T18:00:00+03:00", "x"],
          },
        ],
        4,
        NOW,
      ),
    ).toEqual(["2026-10-12T15:00:00Z"]);
    expect(nextSlots(null)).toEqual([]);
  });
});

const appt = (over: Record<string, unknown>) => ({
  appointment_id: "a1",
  call_type: "intro",
  start_at: at(-0.5),
  status: "confirmed",
  marked_status: null,
  assigned_user_id: "u-sara",
  assigned_user_name: "Sara",
  ...over,
});

describe("introToMark", () => {
  const sara = { ghl_user_id: "u-sara" };
  test("today's intro, started in the last 3 hours, the setter's own", () => {
    expect(introToMark([appt({})], sara, NOW)?.appointment_id).toBe("a1");
    expect(
      introToMark([appt({ start_at: at(-2.9) })], sara, NOW),
    ).not.toBeNull();
  });
  test("about to start (10 minutes, as sales-api allows a showed mark)", () => {
    expect(
      introToMark([appt({ start_at: at(9 / 60) })], sara, NOW),
    ).not.toBeNull();
    expect(introToMark([appt({ start_at: at(0.5) })], sara, NOW)).toBeNull();
  });
  test("not an old one, not one already marked or cancelled, not a demo", () => {
    expect(introToMark([appt({ start_at: at(-3.1) })], sara, NOW)).toBeNull();
    expect(
      introToMark([appt({ marked_status: "showed" })], sara, NOW),
    ).toBeNull();
    expect(introToMark([appt({ status: "cancelled" })], sara, NOW)).toBeNull();
    expect(introToMark([appt({ call_type: "demo" })], sara, NOW)).toBeNull();
  });
  test("another rep's intro is theirs to mark; a manager may mark any", () => {
    expect(
      introToMark([appt({ assigned_user_id: "u-noor" })], sara, NOW),
    ).toBeNull();
    expect(
      introToMark(
        [appt({ assigned_user_id: "u-noor" })],
        { manager: true },
        NOW,
      ),
    ).not.toBeNull();
    expect(introToMark([appt({})], {}, NOW)).toBeNull();
  });
  test("of two, the one nearest now", () => {
    const got = introToMark(
      [
        appt({ appointment_id: "early", start_at: at(-2.5) }),
        appt({ appointment_id: "now", start_at: at(-0.2) }),
      ],
      sara,
      NOW,
    );
    expect(got?.appointment_id).toBe("now");
  });
});

describe("bookedDemo", () => {
  test("the next demo not cancelled; a demo that ended over an hour ago is not it", () => {
    const list = [
      appt({ appointment_id: "old", call_type: "demo", start_at: at(-2) }),
      appt({
        appointment_id: "gone",
        call_type: "demo",
        start_at: at(5),
        status: "cancelled",
      }),
      appt({ appointment_id: "next", call_type: "demo", start_at: at(26) }),
      appt({ appointment_id: "later", call_type: "demo", start_at: at(50) }),
    ];
    expect(bookedDemo(list, NOW)?.appointment_id).toBe("next");
    expect(bookedDemo([appt({})], NOW)).toBeNull();
  });
});

describe("closerLine", () => {
  test("the setter's own line first, then the pain and the goal", () => {
    expect(
      closerLine({
        for_the_closer: "Partner decides money.",
        pain: "Not enough leads",
        goal: "Two villas a month ",
      }),
    ).toBe(
      "Partner decides money. The pain: Not enough leads. Goal: Two villas a month.",
    );
  });
  test("whatever there is; nothing captured is an empty line", () => {
    expect(closerLine({ pain: "Leads are the wrong fit" })).toBe(
      "The pain: Leads are the wrong fit.",
    );
    expect(closerLine({})).toBe("");
  });
  test("long lines are cut", () => {
    expect(closerLine({ for_the_closer: "x".repeat(900) }).length).toBe(600);
  });
});

describe("bookingLine", () => {
  test("the setter's own line for the closer when there is one", () => {
    expect(
      bookingLine({ for_the_closer: "Partner decides money" }, "Sara Ali"),
    ).toBe("Partner decides money.");
  });

  test("nothing captured still books in one press: who booked it", () => {
    expect(bookingLine({}, "Sara Ali")).toBe(
      "Booked on the intro call by Sara.",
    );
    expect(bookingLine({ pain: "  " }, null)).toBe(
      "Booked on the intro call by the setter.",
    );
    // book.create wants 3 characters at least.
    expect(bookingLine({}, "").length).toBeGreaterThanOrEqual(3);
  });
});

describe("times as they are said", () => {
  const six = "2026-10-12T15:00:00Z"; // 18:00 Kuwait
  test("a button: Kuwait's clock, and the lead's when it differs", () => {
    expect(slotWords(six, "KW")).toEqual({
      kuwait: "Mon 12 Oct, 6:00 pm",
      day: "Mon 12 Oct",
      time: "6:00 pm",
      theirs: null,
    });
    expect(slotWords(six, "SA").theirs).toBeNull();
    expect(slotWords(six, "AE").theirs).toBe("7:00 pm UAE time");
    expect(slotWords("2026-10-12T20:30:00Z", "AE").theirs).toBe(
      "Tue 12:30 am UAE time",
    );
  });
  test("the lead's clock from the phone when the country is not set", () => {
    expect(leadZone(null, "+971501234567")).toBe("Asia/Dubai");
    expect(leadZone("eg")).toBe("Asia/Kuwait");
  });
  test("English: short for the two free times, whole for the booked one", () => {
    expect(sayWhen(six, "en", { country: "KW" })).toBe("Mon 6:00 pm");
    expect(sayWhen(six, "en", { country: "SA", whole: true })).toBe(
      "Mon 12 Oct at 6:00 pm Saudi time",
    );
    expect(sayWhen("2026-10-13T07:30:00Z", "en", { country: "KW" })).toBe(
      "Tue 10:30 am",
    );
  });
  test("Arabic: Arabic-Indic digits, the confirmations' parts of the day, no dash or guillemets", () => {
    expect(sayWhen(six, "ar", { country: "KW" })).toBe(
      "الاثنين الساعة ٦ المغرب",
    );
    expect(sayWhen(six, "ar", { country: "KW", whole: true })).toBe(
      "الاثنين ١٢ أكتوبر الساعة ٦ المغرب بتوقيت الكويت",
    );
    expect(sayWhen("2026-10-13T07:30:00Z", "ar", { country: "AE" })).toBe(
      "الثلاثاء الساعة ١١:٣٠ الصبح",
    );
    for (const s of [
      sayWhen(six, "ar", { country: "SA", whole: true }),
      sayWhen("2026-10-13T07:30:00Z", "ar", { country: "QA", whole: true }),
    ]) {
      expect(s).not.toMatch(/[0-9—«»]/);
    }
    expect(arDigits("12:05")).toBe("١٢:٠٥");
  });
  test("Arabic: the setter says the same part of the day the lead then reads", () => {
    for (const [iso, said] of [
      ["2026-10-12T11:00:00Z", "٢ الظهر"],
      ["2026-10-12T13:30:00Z", "٤:٣٠ العصر"],
      ["2026-10-12T15:00:00Z", "٦ المغرب"],
      ["2026-10-12T18:00:00Z", "٩ بالليل"],
    ] as const) {
      expect(sayWhen(iso, "ar", { country: "KW" })).toEndWith(said);
      expect(callWhen(iso, "KW", "ar").time).toBe(said);
    }
  });
});
