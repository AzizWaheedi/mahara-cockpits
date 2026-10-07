// bun test supabase/functions/sales-api/stress2_time_r3_weekend.test.ts
//
// TIME stress, second series, round 3: a week of a UAE lead's days.
//
// followups.quiet_days (Friday as shipped) is "the lead's day off": a backlog
// opener never goes then (sendrules.ts hoursRefusal with dayOff, the
// desk's lead_days_off). Since fix round 4 a lead whose weekend is not Friday
// gets their own Saturday and Sunday off instead (zoneDaysOff), for every zone
// outside FRIDAY_WEEKEND_ZONES. Asia/Dubai is in that list. The UAE's
// working week has been Monday to Friday (Friday a half day) with Saturday and
// Sunday the weekend since 1 January 2022.
//
// A test that fails here is a finding.
import { describe, expect, test } from "bun:test";
import { hoursRefusal } from "./sendrules.ts";

/** A moment on the UAE's clock (UTC+4), week of Thursday 8 October 2026. */
const uae = (day: string, hhmm: string) => Date.parse(`2026-10-${day}T${hhmm}:00+04:00`);
const opener = (country: string, now: number) =>
  hoursRefusal({ segment: "reactivate", touch: 1, country, now, followups: {}, dayOff: true });

describe("a backlog opener to a lead in Dubai (country AE), each day at 11:00 their time", () => {
  test("Saturday 10 October, their weekend: it waits", () => {
    // Found: null (it goes): the opener lands on the lead's Saturday off.
    expect(opener("AE", uae("10", "11:00"))).not.toBeNull();
  });

  test("Sunday 11 October, their weekend: it waits", () => {
    // Found: null (it goes) on the lead's Sunday off.
    expect(opener("AE", uae("11", "11:00"))).not.toBeNull();
  });

  test("Friday 9 October, a working morning in the UAE: it is not refused as 'their day off'", () => {
    // Found: "It is Friday where the lead is, their day off. It goes on Saturday."
    expect(opener("AE", uae("09", "11:00")) ?? "").not.toContain("day off");
  });

  test("the same by name ('United Arab Emirates', 'Dubai'), as the cockpit stores some countries", () => {
    expect(opener("United Arab Emirates", uae("10", "11:00"))).not.toBeNull();
    expect(opener("Dubai", uae("11", "11:00"))).not.toBeNull();
  });

  test("control: a lead in Kuwait on Friday waits, and on Saturday and Sunday it goes", () => {
    const kw = (day: string, hhmm: string) => Date.parse(`2026-10-${day}T${hhmm}:00+03:00`);
    expect(opener("KW", kw("09", "11:00"))).toContain("Friday");
    expect(opener("KW", kw("10", "11:00"))).toBeNull();
    expect(opener("KW", kw("11", "11:00"))).toBeNull();
  });
});

describe("quiet_days set to Friday and Saturday (the Gulf's whole weekend): a Kuwait lead's opener on Friday 11:00", () => {
  const kw = (day: string, hhmm: string) => Date.parse(`2026-10-${day}T${hhmm}:00+03:00`);
  const both = { quiet_days: ["friday", "saturday"] };
  test("the refusal does not promise Saturday, itself a day off", () => {
    const said = hoursRefusal({ segment: "reactivate", touch: 1, country: "KW", now: kw("09", "11:00"), followups: both, dayOff: true });
    // Found: "It is Friday where the lead is, their day off. It goes on
    // Saturday." while Saturday is a quiet day too: the opener goes Sunday.
    expect(said).not.toBeNull();
    expect(String(said)).not.toContain("Saturday");
  });
  test("control: on Saturday it waits as well", () => {
    expect(hoursRefusal({ segment: "reactivate", touch: 1, country: "KW", now: kw("10", "11:00"), followups: both, dayOff: true })).not.toBeNull();
  });
});
