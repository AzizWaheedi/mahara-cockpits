// TIME stress, second series, round 6: the words the dialer puts in the
// WhatsApp box after the evening-before confirmation call rings out.
//
// bun test src/lib/stress2_time_r6_call_words.test.ts   (from apps/sales-cockpit)
//
// The dialer's confirmation item ("Confirm the intro tomorrow at 17:20 (it is
// 10:20 there)", sales-api dialer.ts theirClock since stress2 round 5) that
// rings out sets the miss moment "confirm" (DialerPage missMoment), and the
// Conversation box is prefilled with the "confirm" snippet (migration
// 20260926h: "Hi {name}, {rep} from Mahara Media. Just checking we are still
// on for {day} at {time}?"; Arabic "... موعدنا {day} الساعة {time} ..."),
// {day} and {time} from callWords(callAt, language, now,
// leadOffsetHours(country)). leadOffsetHours knows two clocks: UTC+4 for the
// UAE and Oman, UTC+3 for everyone else. The cockpit's other doors read the
// lead's own zone (sales-api sendrules.ts leadZones, the desk's call_words).
// The real calendar (read-only, 5 October 2026) holds booked calls for leads
// in Canada, the UK, France, Spain, Italy, the Netherlands, Norway, Egypt,
// Lebanon, Singapore, Australia and the US.
//
// A test that fails here is a finding: the time the lead is told is not the
// time on their clock.
import { describe, expect, test } from "bun:test";
import { leadClock } from "./leadClock";
import { callWords, fillSnippet } from "./whatsapp";

// Fix round 6: leadOffsetHours (UTC+4 or UTC+3) is gone; the words are
// written on the lead's own zone (leadClock), as the desk's call_words does.
const leadOffsetHours = (country: string): string =>
  leadClock(country) ?? "Asia/Kuwait";

const kw = (s: string) => Date.parse(`${s}+03:00`);
const CONFIRM_EN =
  "Hi {name}, {rep} from Mahara Media. Just checking we are still on for {day} at {time}?";

/** "10:20 am" / "9 am" on the lead's own clock, as callWords writes a time. */
function theirTime(zone: string, t: number): string {
  const p = new Intl.DateTimeFormat("en-GB", {
    timeZone: zone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  })
    .format(t)
    .split(":")
    .map(Number);
  const h = p[0] as number;
  const m = p[1] as number;
  const h12 = h % 12 || 12;
  return `${m ? `${h12}:${String(m).padStart(2, "0")}` : `${h12}`} ${h < 12 ? "am" : "pm"}`;
}

function prefill(start: number, now: number, country: string): string {
  const w = callWords(
    new Date(start).toISOString(),
    "en",
    now,
    leadOffsetHours(country),
  );
  return fillSnippet(CONFIRM_EN, {
    name: "Sam",
    rep: "Tara",
    day: w.day,
    time: w.time,
  });
}

describe("Monday 12 October 16:30 Kuwait (09:30 in Halifax): the setter picks the confirm message on the lead page for today's 17:20 intro (a lead in Canada)", () => {
  const start = kw("2026-10-12T17:20:00");
  const now = kw("2026-10-12T16:30:00");
  test("the message names the call's time on the lead's clock (11:20 am in Halifax, their first zone)", () => {
    // Found: "Just checking we are still on for today at 5:20 pm?": Kuwait's
    // hour, to a lead whose call is at 11:20 in the morning (10:20 in Toronto).
    // (The dialer's own confirmation item never comes up for this lead since
    // round 5: Vancouver is at night before the call; the lead page's box
    // fills the same snippet the same way.)
    expect(prefill(start, now, "CA")).toBe(
      `Hi Sam, Tara from Mahara Media. Just checking we are still on for today at ${theirTime("America/Halifax", start)}?`,
    );
  });
});

describe("Wednesday 7 October 18:05 Kuwait (16:05 in London): the dialer's 'Confirm the intro tomorrow at 11:00 (it is 16:05 there)' rings out; the confirm message is prefilled", () => {
  test("the time is 9 am, London's", () => {
    const start = kw("2026-10-08T11:00:00");
    // Found: "tomorrow at 11 am".
    expect(prefill(start, kw("2026-10-07T18:05:00"), "GB")).toBe(
      "Hi Sam, Tara from Mahara Media. Just checking we are still on for tomorrow at 9 am?",
    );
  });
});

describe("after the clocks change: Lebanon (25 October) and Egypt (29 October) go back to UTC+2", () => {
  test("a Lebanese lead's Tuesday 27 October 11:00 Kuwait intro is at 10 am in Beirut", () => {
    const start = kw("2026-10-27T11:00:00");
    // Found: "tomorrow at 11 am" (the Arabic snippet says الساعة ١١ الصبح).
    expect(
      callWords(
        new Date(start).toISOString(),
        "en",
        kw("2026-10-26T18:05:00"),
        leadOffsetHours("LB"),
      ).time,
    ).toBe(theirTime("Asia/Beirut", start));
  });
  test("control: a Kuwait lead's time is Kuwait's", () => {
    const start = kw("2026-10-27T11:00:00");
    expect(
      callWords(
        new Date(start).toISOString(),
        "en",
        kw("2026-10-26T18:05:00"),
        leadOffsetHours("KW"),
      ).time,
    ).toBe("11 am");
  });
  test("control: a Dubai lead's time is an hour ahead", () => {
    const start = kw("2026-10-27T11:00:00");
    expect(
      callWords(
        new Date(start).toISOString(),
        "en",
        kw("2026-10-26T18:05:00"),
        leadOffsetHours("AE"),
      ).time,
    ).toBe("12 pm");
  });
});
