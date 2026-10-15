// bun test src/lib/farout_ui.test.ts (in apps/sales-cockpit)
//
// The picker's decisions for booking further out and custom times
// (2026-10-11, the far-out plan's sections 4 and 5): which tile Custom time
// shows for each book.check answer, what each press adds to book.create and
// book.move, and the lead's own link to pick a time in both languages.
import { describe, expect, test } from "bun:test";
import {
  checkView,
  customIso,
  customPrecheck,
  customTile,
  doneLink,
  pressExtras,
  type TimeCheck,
} from "./reschedule";
import { tellMessage } from "./tellThem";

/** Sun 11 Oct 2026, 14:43 in Kuwait. */
const NOW = Date.parse("2026-10-11T14:43:00+03:00");
const kw = (s: string) => new Date(`${s}+03:00`).toISOString();

const layla = {
  contact_id: "c-layla",
  name: "Layla Al Sabah",
  company: "Sabah Design Studio",
  country: "KW",
  phone: "+96550071190",
};
const mona = {
  contact_id: "c-mona",
  name: "Mona Al Harbi",
  company: "Harbi Interiors",
  country: "AE",
  phone: "+971504127781",
};
const ahmad = { user_id: "u-ahmad", name: "Ahmad Al Mutairi" };

function answer(over: Partial<TimeCheck> = {}): TimeCheck {
  return {
    start: kw("2026-11-04T11:00:00"),
    words: "Wed 4 Nov, 11:00 am",
    host: ahmad,
    placement: "custom",
    clash: null,
    outside_hours: false,
    hours_words: "9:00 am to 6:00 pm on Wednesdays",
    beyond_reach: false,
    past: false,
    step: false,
    line: "Free for Ahmad, inside working hours.",
    ...over,
  };
}

describe("Custom time: the day and the time typed, in Kuwait time", () => {
  test("both whole, read as Kuwait's clock", () => {
    expect(customIso("2026-11-04", "20:00")).toBe("2026-11-04T17:00:00.000Z");
    expect(customIso("2026-11-04", "")).toBeNull();
    expect(customIso("", "20:00")).toBeNull();
    expect(customIso("2026-11-04", "24:10")).toBeNull();
    expect(customIso("04/11/2026", "20:00")).toBeNull();
  });

  test("what is said before asking the server", () => {
    const o = { now: NOW, reachUntil: "2026-12-09", stepMin: 5 };
    expect(customPrecheck("", "", o)).toEqual({
      line: "Pick a day and a time (Kuwait time).",
      tone: "muted",
    });
    expect(customPrecheck("2026-10-11", "14:45", o)?.line).toBe(
      "That time has passed or starts in under 5 minutes. Pick a later one.",
    );
    expect(customPrecheck("2026-12-10", "10:00", o)?.line).toBe(
      "Pick a day up to Wed 9 Dec.",
    );
    expect(customPrecheck("2026-11-04", "10:03", o)?.line).toBe(
      "Pick a time on the 5-minute mark.",
    );
    expect(customPrecheck("2026-11-04", "20:05", o)).toBeNull();
    expect(customPrecheck("2026-12-09", "10:00", o)).toBeNull();
  });
});

describe("Custom time: what book.check's answer shows", () => {
  test("free: the time to press, the line in the quiet tone", () => {
    expect(checkView(answer())).toEqual({
      tile: "book",
      tone: "muted",
      line: "Free for Ahmad, inside working hours.",
    });
  });

  test("outside the host's working hours: Book anyway, said plainly", () => {
    const v = checkView(
      answer({
        outside_hours: true,
        line: "That's outside Ahmad's working hours (9:00 am to 6:00 pm on Wednesdays). Press Book anyway to keep it, or pick another time.",
      }),
    );
    expect(v?.tile).toBe("anyway");
    expect(v?.tone).toBe("warn");
    expect(v?.line).toContain("Press Book anyway");
  });

  test("a clash: no time to press, and whose call is there", () => {
    const v = checkView(
      answer({
        clash: {
          start: kw("2026-11-04T11:00:00"),
          end: kw("2026-11-04T11:45:00"),
          what: "call",
        },
        // A clash outside hours is still a clash: nothing to press.
        outside_hours: true,
        line: "Ahmad has another call from 11:00 am to 11:45 am (Kuwait time). Pick another time.",
      }),
    );
    expect(v).toEqual({
      tile: null,
      tone: "warn",
      line: "Ahmad has another call from 11:00 am to 11:45 am (Kuwait time). Pick another time.",
    });
  });

  test("gone, past the reach or off the step: nothing to press", () => {
    for (const over of [
      { past: true },
      { beyond_reach: true },
      { step: true },
    ] as Partial<TimeCheck>[]) {
      const v = checkView(answer({ ...over, line: "" }));
      expect(v?.tile).toBeNull();
      expect(v?.tone).toBe("warn");
      expect(v?.line).toBe("That time can't be booked. Pick another.");
    }
    expect(checkView(null)).toBeNull();
  });

  test("nobody named to take it: the server's line, nothing to press", () => {
    expect(
      checkView(answer({ host: null, line: "Pick who takes the call." })),
    ).toEqual({ tile: null, tone: "muted", line: "Pick who takes the call." });
  });

  test("the typed time as a tile: the day, both clocks, who takes it", () => {
    const t = customTile(kw("2026-11-04T20:00:00"), mona, ahmad, NOW, true);
    expect(t).toEqual({
      iso: kw("2026-11-04T20:00:00"),
      day: "Wed 4 Nov",
      digits: "8:00",
      ap: "pm",
      theirs: "9:00 pm UAE",
      host: "Ahmad",
      hostId: "u-ahmad",
      far: true,
    });
    expect(customTile(kw("2026-11-04T20:00:00"), layla, null, NOW).host).toBe(
      null,
    );
  });
});

describe("what each press sends besides the time (plan 4.3)", () => {
  test("a booking-page tile sends nothing new", () => {
    expect(pressExtras({ userId: null })).toEqual({});
  });
  test("a far-out tile names who takes it, with no custom flag", () => {
    expect(pressExtras({ userId: "u-omar" })).toEqual({ user_id: "u-omar" });
  });
  test("a custom time is marked custom and always names the host", () => {
    expect(pressExtras({ userId: "u-ahmad", custom: true })).toEqual({
      user_id: "u-ahmad",
      custom: true,
    });
  });
  test("Book anyway adds outside_hours_ok, and only to a custom time", () => {
    expect(
      pressExtras({ userId: "u-ahmad", custom: true, outsideOk: true }),
    ).toEqual({ user_id: "u-ahmad", custom: true, outside_hours_ok: true });
    expect(pressExtras({ userId: "u-ahmad", outsideOk: true })).toEqual({
      user_id: "u-ahmad",
    });
  });
});

describe("Send them the link to pick a time (the verified format)", () => {
  // sales-api reschedule.ts rescheduleLink, verified 2026-10-11 on a test
  // appointment: the calendar's booking page with the call's id.
  const link =
    "https://link.maharamedia.com/widget/booking/dsqmJ393Dwl9fDSbIVOI?event_id=a10";
  const base = {
    moment: "pick_time" as const,
    lead: layla,
    kind: "intro" as const,
    start: kw("2026-10-12T12:00:00"),
    link,
    now: NOW,
  };

  test("English", () => {
    expect(tellMessage({ ...base, lang: "en" }).text).toBe(
      `Hi Layla, if you'd like another time for your intro call, pick the one that suits you here:\n${link}`,
    );
  });

  test("Arabic", () => {
    expect(tellMessage({ ...base, lang: "ar" }).text).toBe(
      `هلا Layla، إذا تبي تغير موعد مكالمة التعارف، اختار الوقت اللي يناسبك من هني:\n${link}`,
    );
  });
});

describe("Tell them after a booking or a move: which link it offers", () => {
  // sales-api answers book.create, book.move and book.move.check with the
  // call's own reschedule_link (null where the calendar does not allow it).
  const answered =
    "https://link.maharamedia.com/widget/booking/JTNg1Wd62qxuT8W8sroh?event_id=bk-1";
  const read =
    "https://link.maharamedia.com/widget/booking/JTNg1Wd62qxuT8W8sroh?event_id=a10";

  test("the server's answer wins, a booking's included", () => {
    expect(doneLink("book", answered, null)).toBe(answered);
    expect(doneLink("reschedule", answered, read)).toBe(answered);
  });

  test("a demo: no link from either, so none", () => {
    expect(doneLink("reschedule", null, null)).toBeNull();
    expect(doneLink("book", null, null)).toBeNull();
  });

  test("no answer (an older server, or the calendar unread just then): a move keeps the read's, a booking has none", () => {
    expect(doneLink("reschedule", undefined, read)).toBe(read);
    expect(doneLink("reschedule", null, read)).toBe(read);
    expect(doneLink("book", undefined, read)).toBeNull();
    expect(doneLink("reschedule", undefined, null)).toBeNull();
  });
});
