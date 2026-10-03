// TIME stress for the send hours (sendrules.ts): every minute of a week on a
// fake clock, for leads in UTC+3 and UTC+4 and outside the Gulf, across
// Kuwait's midnight and the Friday day off, checked against the lead's real
// clock (the IANA zone of their country, through Intl). The desk's own copy
// of these rules is tests/test_stress_time.py in hermes/sales-desk.
//
//     bun test supabase/functions/sales-api/stress_time_sendrules.test.ts

import { describe, expect, test } from "bun:test";
import { firstHours, hoursRefusal, kuwaitMonthStart, laterHours, leadHour, leadWeekday } from "./sendrules.ts";

const S = 1000;
const MIN = 60 * S;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const FOLLOWUPS = { quiet: { from: 21, to: 9 }, first_hours: [9, 18], quiet_days: ["friday"] };

/** The lead's real hour and weekday (0 Sunday) in an IANA zone. */
function local(zone: string, t: number): { hour: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", hourCycle: "h23", weekday: "short" }).formatToParts(t);
  const hour = Number(parts.find(p => p.type === "hour")?.value);
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(String(parts.find(p => p.type === "weekday")?.value));
  return { hour, day };
}

/** Every minute from a Kuwait Thursday 00:00 for 8 days (two Fridays' edges, seven midnights). */
function week(fromIso: string): number[] {
  const t0 = Date.parse(fromIso);
  return Array.from({ length: 8 * 24 * 60 }, (_, i) => t0 + i * MIN);
}

const opener = (country: unknown, now: number, followups: unknown = FOLLOWUPS) =>
  hoursRefusal({ segment: "reactivate", touch: 1, country, now, followups, dayOff: true });
const later = (country: unknown, now: number) =>
  hoursRefusal({ segment: "no_show", touch: 2, country, now, followups: FOLLOWUPS, dayOff: true });

describe("a week of openers in the Gulf, minute by minute, on each lead's own clock", () => {
  const minutes = week("2026-10-07T21:00:00.000Z"); // Thursday 8 October 00:00 Kuwait
  const gulf: [string, string][] = [
    ["KW", "Asia/Kuwait"],
    ["SA", "Asia/Riyadh"],
    ["QA", "Asia/Qatar"],
    ["BH", "Asia/Bahrain"],
    ["AE", "Asia/Dubai"],
    ["OM", "Asia/Muscat"],
    ["United Arab Emirates", "Asia/Dubai"],
    ["مسقط", "Asia/Muscat"],
  ];
  for (const [country, zone] of gulf)
    test(`${country}: an opener goes only 09:00 to 18:00 their time and never on their Friday`, () => {
      const wrong: string[] = [];
      for (const t of minutes) {
        const { hour, day } = local(zone, t);
        const want = hour >= 9 && hour < 18 && day !== 5;
        if ((opener(country, t) === null) !== want) wrong.push(new Date(t).toISOString());
        if (leadHour(country, t) !== hour || leadWeekday(country, t) !== day) wrong.push(`clock ${new Date(t).toISOString()}`);
      }
      expect(wrong.slice(0, 5)).toEqual([]);
    });

  test("one second either side of each edge, for a UTC+4 lead (Friday starts at 20:00 UTC on Thursday)", () => {
    const at = (s: string) => Date.parse(s);
    expect(opener("AE", at("2026-10-08T04:59:59Z"))).not.toBeNull(); // 08:59:59 Dubai
    expect(opener("AE", at("2026-10-08T05:00:00Z"))).toBeNull(); // 09:00 Dubai
    expect(opener("AE", at("2026-10-08T13:59:59Z"))).toBeNull(); // 17:59:59 Dubai
    expect(opener("AE", at("2026-10-08T14:00:00Z"))).not.toBeNull(); // 18:00 Dubai
    expect(later("AE", at("2026-10-08T16:59:59Z"))).toBeNull(); // 20:59:59 Dubai, a later step
    expect(later("AE", at("2026-10-08T17:00:00Z"))).not.toBeNull(); // 21:00 Dubai
    // Friday 09:00 Dubai is Friday 08:00 Kuwait: the day off on the lead's clock.
    expect(opener("AE", at("2026-10-09T05:00:00Z"))).toMatch(/Friday/);
    // Saturday 00:00 Dubai is Friday 23:00 Kuwait; Saturday 09:00 Dubai goes.
    expect(opener("AE", at("2026-10-10T05:00:00Z"))).toBeNull();
    // A reply to a lead who wrote goes any time, Friday midnight included.
    expect(hoursRefusal({ segment: "reply", touch: 1, country: "AE", now: at("2026-10-08T20:00:00Z"), followups: FOLLOWUPS, dayOff: true })).toBeNull();
  });
});

describe("leads outside the Gulf (about 250 leads, 60 of them roas-tagged, are not in UTC+3)", () => {
  // Winter, so no summer time hides the gap.
  const minutes = week("2027-01-13T21:00:00.000Z");
  const away: [string, string][] = [
    ["US", "America/New_York"],
    ["GB", "Europe/London"],
    ["EG", "Africa/Cairo"],
    ["SG", "Asia/Singapore"],
  ];
  for (const [country, zone] of away)
    test(`${country}: an opener never reaches them at night their time`, () => {
      const night: string[] = [];
      for (const t of minutes) {
        const { hour } = local(zone, t);
        if (opener(country, t) === null && (hour < 9 || hour >= 18)) night.push(`${new Date(t).toISOString()} = ${hour}:00 local`);
      }
      expect(night.slice(0, 3)).toEqual([]);
    });
});

describe("the day off is one setting, read by both doors", () => {
  const sat10 = Date.parse("2026-10-10T07:00:00Z"); // Saturday 10:00 Kuwait
  const fri10 = Date.parse("2026-10-09T07:00:00Z"); // Friday 10:00 Kuwait

  test("a manager's quiet_days of Friday and Saturday holds a Saturday opener in sales-api too (the desk holds it)", () => {
    expect(opener("KW", sat10, { ...FOLLOWUPS, quiet_days: ["friday", "saturday"] })).not.toBeNull();
  });

  test("quiet_days with no Friday lets a Friday opener go in sales-api too (the desk sends it, then waits an hour a try)", () => {
    expect(opener("KW", fri10, { ...FOLLOWUPS, quiet_days: [] })).toBeNull();
  });
});

describe("the hours settings themselves", () => {
  test("first_hours and the quiet hours read back as set, and bad values fall back to the safe default", () => {
    expect(firstHours({ first_hours: [9, 18] })).toEqual([9, 18]);
    expect(firstHours({ first_hours: [18, 9] })).toEqual([9, 18]);
    expect(firstHours({ first_hours: [9.5, 18] })).toEqual([9, 18]);
    expect(laterHours({ quiet: { from: 21, to: 9 } })).toEqual([9, 21]);
    expect(laterHours({})).toEqual([9, 21]);
  });

  test("the month's budget starts at Kuwait midnight on the 1st (21:00 UTC the day before)", () => {
    expect(kuwaitMonthStart(Date.parse("2026-10-31T20:59:59.999Z"))).toBe("2026-09-30T21:00:00.000Z");
    expect(kuwaitMonthStart(Date.parse("2026-10-31T21:00:00.000Z"))).toBe("2026-10-31T21:00:00.000Z");
    expect(kuwaitMonthStart(Date.parse("2026-12-31T21:00:00.000Z"))).toBe("2026-12-31T21:00:00.000Z");
    expect(kuwaitMonthStart(Date.parse("2027-01-01T00:00:00.000Z"))).toBe("2026-12-31T21:00:00.000Z");
  });

  test("Kuwait's midnight does not move a UTC+3 lead's day early or late", () => {
    for (let d = 0; d < 7; d++) {
      const midnight = Date.parse("2026-10-07T21:00:00.000Z") + d * DAY;
      expect(leadWeekday("KW", midnight - 1)).toBe((4 + d - 1 + 7) % 7);
      expect(leadWeekday("KW", midnight)).toBe((4 + d) % 7);
    }
  });
});
