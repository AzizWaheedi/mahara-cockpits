import { describe, expect, test } from "bun:test";
import {
  byAdIn,
  changesIn,
  periodNumbers,
  periodOf,
} from "../src/lib/reportPeriod";

const TODAY = "2026-10-06";

describe("what a pick means", () => {
  test("a rolling span ends today and is compared with the same span before", () => {
    const p = periodOf("7d", TODAY);
    expect([p.from, p.to, p.label]).toEqual([
      "2026-09-30",
      "2026-10-06",
      "last 7 days",
    ]);
    expect([p.prevFrom, p.prevTo, p.prevLabel]).toEqual([
      "2026-09-23",
      "2026-09-29",
      "the 7 days before",
    ]);
  });

  test("a month is compared with the month before it", () => {
    const now = periodOf("month", TODAY);
    expect([now.from, now.to, now.label, now.prevLabel]).toEqual([
      "2026-10-01",
      "2026-10-31",
      "October 2026",
      "September 2026",
    ]);
    const last = periodOf("lastMonth", TODAY);
    expect([last.from, last.to, last.prevFrom, last.prevTo]).toEqual([
      "2026-09-01",
      "2026-09-30",
      "2026-08-01",
      "2026-08-31",
    ]);
    // January's month before is the last December.
    expect(periodOf("2026-01", TODAY).prevLabel).toBe("December 2025");
  });

  test("a custom span keeps its days, in order, and all time has nothing before it", () => {
    const c = periodOf("custom:2026-09-14:2026-09-01", TODAY);
    expect([c.from, c.to, c.label]).toEqual([
      "2026-09-01",
      "2026-09-14",
      "1 Sep to 14 Sep",
    ]);
    expect([c.prevFrom, c.prevTo]).toEqual(["2026-08-18", "2026-08-31"]);
    const all = periodOf("all", TODAY, "2026-07-20");
    expect([all.from, all.to, all.prevFrom]).toEqual([
      "2026-07-20",
      TODAY,
      undefined,
    ]);
  });
});

describe("what a period holds", () => {
  const appts = [
    { added: "2026-10-01", booked: true, show: "y", closed: "y", ad: "Ad 1" },
    { added: "2026-10-02", booked: true, show: "n", ad: "Ad 1" },
    { added: "2026-10-03", booked: true, appAt: "2026-10-04", ad: "Ad 2" },
    { added: "2026-10-05", booked: true, appAt: "2026-10-09", ad: "Ad 2" },
    { added: "2026-09-20", booked: true, show: "y", ad: "Ad 1" },
  ];
  const ads = [
    { date: "2026-10-01", leads: 3, spend: 30 },
    { date: "2026-10-04", leads: 2, spend: 20 },
    { date: "2026-09-20", leads: 9, spend: 90 },
  ];

  test("leads and spend come from the ads, outcomes from the sheet", () => {
    const n = periodNumbers(appts, ads, "2026-10-01", "2026-10-06", TODAY);
    expect(n).toMatchObject({
      leads: 5,
      leadsFrom: "ads",
      spend: 50,
      cpl: 10,
      sheetLeads: 4,
      booked: 4,
      shows: 1,
      noshows: 1,
      closes: 1,
      showRate: 50,
      closeRate: 100,
    });
    // Booked for the 4th with no outcome is unfilled; the 9th has not come.
    expect(n.unknownOutcome).toBe(1);
  });

  test("a client with no ad rows keeps the sheet's count", () => {
    const n = periodNumbers(appts, [], "2026-10-01", "2026-10-06", TODAY);
    expect(n.leads).toBe(4);
    expect(n.leadsFrom).toBe("sheet");
    expect(n.cpl).toBeNull();
  });

  test("ads are judged on what their leads did in the period", () => {
    const rows = byAdIn(appts, "2026-10-01", "2026-10-06", TODAY);
    expect(rows.map(r => r.ad)).toEqual(["Ad 1", "Ad 2"]);
    expect(rows[0]).toMatchObject({
      leads: 2,
      shows: 1,
      closes: 1,
      showRate: 50,
    });
    expect(rows[1]).toMatchObject({ leads: 2, unknown: 1 });
  });

  test("the period's changes, newest first", () => {
    const changes = [
      { subject: "x", action: "a", kind: "change", day: "2026-09-29", at: 1 },
      { subject: "x", action: "b", kind: "change", day: "2026-10-04", at: 3 },
      { subject: "x", action: "c", kind: "touch", day: "2026-10-02", at: 2 },
    ];
    expect(
      changesIn(changes, "2026-10-01", "2026-10-06").map(c => c.action),
    ).toEqual(["b", "c"]);
    expect(changesIn(undefined, "2026-10-01", "2026-10-06")).toEqual([]);
  });
});
