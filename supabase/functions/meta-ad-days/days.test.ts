import { describe, expect, test } from "bun:test";
import { addDays, daysBetween, discoveryWindow, halves, knownZone, pieces, spansFor, zonedDay } from "./days.ts";
import { NOW } from "./fixtures.ts";

describe("each account's own calendar", () => {
  test("at 01:30 Kuwait on 16 Oct it is still 15 Oct in Los Angeles", () => {
    expect(zonedDay(NOW, "Asia/Kuwait")).toBe("2026-10-16");
    expect(zonedDay(NOW, "Asia/Riyadh")).toBe("2026-10-16");
    expect(zonedDay(NOW, "America/Los_Angeles")).toBe("2026-10-15");
    expect(zonedDay(NOW, "Not/AZone")).toBe("2026-10-16");
    expect(knownZone("Asia/Beirut")).toBe(true);
    expect(knownZone("Not/AZone")).toBe(false);
  });

  test("hourly reads yesterday and today of the account", () => {
    expect(spansFor("hourly", NOW, "Asia/Kuwait")).toEqual([{ since: "2026-10-15", until: "2026-10-16" }]);
    expect(spansFor("hourly", NOW, "America/Los_Angeles")).toEqual([{ since: "2026-10-14", until: "2026-10-15" }]);
  });

  test("nightly reads the 28 days before today in 7-day pieces", () => {
    const s = spansFor("nightly", NOW, "Asia/Kuwait");
    expect(s).toEqual([
      { since: "2026-09-18", until: "2026-09-24" },
      { since: "2026-09-25", until: "2026-10-01" },
      { since: "2026-10-02", until: "2026-10-08" },
      { since: "2026-10-09", until: "2026-10-15" },
    ]);
    expect(s.reduce((n, p) => n + daysBetween(p.since, p.until) + 1, 0)).toBe(28);
  });

  test("a backfill reads N days (90 at most) before today", () => {
    const s = spansFor("backfill", NOW, "Asia/Kuwait", 90);
    expect(s.length).toBe(13);
    expect(s[0].since).toBe("2026-07-18");
    expect(s[s.length - 1]).toEqual({ since: "2026-10-10", until: "2026-10-15" });
    expect(s.reduce((n, p) => n + daysBetween(p.since, p.until) + 1, 0)).toBe(90);
    expect(spansFor("backfill", NOW, "Asia/Kuwait", 500).reduce((n, p) => n + daysBetween(p.since, p.until) + 1, 0)).toBe(90);
    expect(spansFor("backfill", NOW, "Asia/Kuwait", 3)).toEqual([{ since: "2026-10-13", until: "2026-10-15" }]);
  });

  test("the accounts are looked for one day wider than any account's span; nightly from the 1st of last month", () => {
    expect(discoveryWindow("hourly", NOW)).toEqual({ since: "2026-10-14", until: "2026-10-17" });
    expect(discoveryWindow("nightly", NOW)).toEqual({ since: "2026-09-01", until: "2026-10-17" });
    expect(discoveryWindow("nightly", Date.parse("2026-10-31T12:00:00+03:00"))).toEqual({ since: "2026-09-01", until: "2026-11-01" });
    expect(discoveryWindow("backfill", NOW, 90)).toEqual({ since: "2026-07-17", until: "2026-10-17" });
  });

  test("pieces and halves", () => {
    expect(pieces("2026-10-01", "2026-10-03", 7)).toEqual([{ since: "2026-10-01", until: "2026-10-03" }]);
    expect(pieces("2026-10-03", "2026-10-01", 7)).toEqual([]);
    expect(halves({ since: "2026-10-01", until: "2026-10-07" })).toEqual([
      { since: "2026-10-01", until: "2026-10-03" },
      { since: "2026-10-04", until: "2026-10-07" },
    ]);
    expect(halves({ since: "2026-10-01", until: "2026-10-02" })).toEqual([
      { since: "2026-10-01", until: "2026-10-01" },
      { since: "2026-10-02", until: "2026-10-02" },
    ]);
    expect(halves({ since: "2026-10-01", until: "2026-10-01" })).toBeNull();
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
  });
});
