import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  bookingLookbackStart, buildHubstaffDays, chunkDays, kuwaitDayOf, kuwaitStartUtc, normaliseAbsences, normaliseBookings,
  normaliseContact, normaliseLastActivities, normaliseLeaveTypes, normaliseMembers, normaliseTtUsers, workDaysOf,
} from "./normalise.ts";

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8")) as { _source: string; body: any };

describe("fixtures", () => {
  test("every fixture names its documented shape and says its values are invented", () => {
    for (const f of ["hubstaff-organizations.json", "hubstaff-members.json", "hubstaff-activities.json", "hubstaff-daily-activities.json",
      "hubstaff-last-activities.json", "hubstaff-errors.json", "hubstaff-users-me.json", "timetastic-users.json", "timetastic-user-detail.json", "timetastic-user-contact.json",
      "timetastic-leavetypes.json", "timetastic-holidays.json", "timetastic-absences.json"]) {
      const text = readFileSync(new URL(`./fixtures/${f}`, import.meta.url), "utf8");
      expect(fixture(f)._source).toMatch(/^shape from .+, 2026-10-09; values invented$/);
      expect(text).not.toContain("@maharamedia.com");
      expect(text).not.toMatch(/"pay_rate":\s*[1-9]/);
    }
  });
});

describe("Kuwait days", () => {
  test("a UTC instant lands on its Kuwait day", () => {
    expect(kuwaitDayOf("2026-10-07T20:59:00Z")).toBe("2026-10-07");
    expect(kuwaitDayOf("2026-10-07T21:00:00Z")).toBe("2026-10-08");
    expect(kuwaitStartUtc("2026-10-08")).toBe("2026-10-07T21:00:00Z");
  });
  test("31-day and 7-day chunks cover the window exactly", () => {
    expect(chunkDays("2026-09-01", "2026-10-09", 31)).toEqual([{ from: "2026-09-01", to: "2026-10-01" }, { from: "2026-10-02", to: "2026-10-09" }]);
    const weeks = chunkDays("2026-10-01", "2026-10-16", 7);
    expect(weeks).toEqual([{ from: "2026-10-01", to: "2026-10-07" }, { from: "2026-10-08", to: "2026-10-14" }, { from: "2026-10-15", to: "2026-10-16" }]);
  });
  test("the booking lookback is the earlier of 1 January and 120 days before the window", () => {
    expect(bookingLookbackStart("2026-10-01", "2026-10-09")).toBe("2026-01-01");
    expect(bookingLookbackStart("2026-02-01", "2026-02-10")).toBe("2025-10-04");
  });
});

describe("Hubstaff", () => {
  test("members keep only allowlisted fields: never pay, profile or IP", () => {
    const rows = normaliseMembers([fixture("hubstaff-members.json").body]);
    expect(rows.map(r => r.externalId)).toEqual(["5001", "5002", "5003", "5004"]);
    expect(rows[1]).toMatchObject({ email: "person1@example.test", name: "Person One", status: "active", membershipRole: "user", memberSince: "2026-05-01", lastClientActivityOn: "2026-10-08" });
    expect(rows[3]).toMatchObject({ status: "removed", removedOn: "2026-10-03" });
    const text = JSON.stringify(rows);
    for (const bad of ["pay_rate", "bill_rate", "profile", "phone", "Made-up Street", "192.0.2.1", "birthday", "project_members"]) expect(text).not.toContain(bad);
  });
  test("last activities give online state", () => {
    const m = normaliseLastActivities([fixture("hubstaff-last-activities.json").body]);
    expect(m.get("5003")).toMatchObject({ online: true, lastClientActivityOn: "2026-10-09" });
  });
  test("10-minute records sum into Kuwait days; dates that agree take daily fields as they are", () => {
    const rows = buildHubstaffDays(fixture("hubstaff-activities.json").body.activities, fixture("hubstaff-daily-activities.json").body.daily_activities, "2026-10-01", "2026-10-31");
    expect(rows.map(r => [r.day, r.trackedS, r.manualS, r.idleS, r.breakS, r.verified, r.zoneShifted, r.slots])).toEqual([
      ["2026-10-07", 25_200, 1_800, 600, 0, true, false, 42],
      ["2026-10-08", 24_000, 0, 0, 1_200, true, false, 40],
    ]);
    const text = JSON.stringify(rows);
    for (const bad of ["keyboard", "mouse", "project_id", "client"]) expect(text).not.toContain(bad);
  });
  test("a shifted zone shares daily fields by where the records land, and marks zone_shifted", () => {
    // Organisation zone UTC: org date 2026-10-07 runs 03:00 Kuwait on the 7th to 03:00 on the 8th.
    const records = [
      ...Array.from({ length: 30 }, (_, i) => ({ user_id: 1, date: "2026-10-07", time_slot: new Date(Date.parse("2026-10-07T16:00:00Z") + i * 600_000).toISOString(), tracked: 600 })),
    ];
    // 16:00Z to 21:00Z is the 7th in Kuwait until 21:00Z, then the 8th: the last 0 records cross; push 6 records past 21:00Z.
    for (let i = 0; i < 6; i++) records.push({ user_id: 1, date: "2026-10-07", time_slot: new Date(Date.parse("2026-10-07T21:00:00Z") + i * 600_000).toISOString(), tracked: 600 });
    const daily = [{ user_id: 1, date: "2026-10-07", tracked: 36 * 600, manual: 3600, idle: 0, work_break: 0, overall: 0, input_tracked: 36 * 600 }];
    const rows = buildHubstaffDays(records, daily, "2026-10-01", "2026-10-31");
    expect(rows.map(r => [r.day, r.trackedS, r.manualS, r.zoneShifted, r.verified])).toEqual([
      ["2026-10-07", 30 * 600, 3000, true, true],
      ["2026-10-08", 6 * 600, 600, true, true],
    ]);
    expect(rows.reduce((a, r) => a + r.manualS, 0)).toBe(3600);
  });
  test("a 2-minute disagreement with the daily total marks the day unverified", () => {
    const records = Array.from({ length: 6 }, (_, i) => ({ user_id: 2, date: "2026-10-07", time_slot: `2026-10-07T0${7 + Math.floor(i / 6)}:${String((i % 6) * 10).padStart(2, "0")}:00Z`, tracked: 600 }));
    const rows = buildHubstaffDays(records, [{ user_id: 2, date: "2026-10-07", tracked: 3600 + 120 }], "2026-10-01", "2026-10-31");
    expect(rows[0]).toMatchObject({ day: "2026-10-07", trackedS: 3600, dailyTrackedS: 3720, verified: false });
    const close = buildHubstaffDays(records, [{ user_id: 2, date: "2026-10-07", tracked: 3600 + 59 }], "2026-10-01", "2026-10-31");
    expect(close[0].verified).toBe(true);
  });
  test("only days inside the window come out", () => {
    const rows = buildHubstaffDays(fixture("hubstaff-activities.json").body.activities, fixture("hubstaff-daily-activities.json").body.daily_activities, "2026-10-08", "2026-10-08");
    expect(rows.map(r => r.day)).toEqual(["2026-10-08"]);
  });
});

describe("Timetastic", () => {
  test("users keep only allowlisted fields: never birthday or gravatar", () => {
    const rows = normaliseTtUsers(fixture("timetastic-users.json").body);
    expect(rows.find(r => r.externalId === "7004")?.status).toBe("archived");
    expect(rows.find(r => r.externalId === "7002")).toMatchObject({ email: "person1@example.test", name: "Person One", extra: { allowanceRemaining: 12.5, allowanceUnit: "Days", countryCode: "KW" } });
    const text = JSON.stringify(rows);
    for (const bad of ["birthday", "1990-01-01", "gravatar", "mfaEnabled"]) expect(text).not.toContain(bad);
  });
  test("contact details give only the payroll id and job title", () => {
    const c = normaliseContact(fixture("timetastic-user-contact.json").body);
    expect(c).toEqual({ payrollId: "1", jobTitle: "Call centre agent" });
  });
  test("the work schedule in force gives the working days", () => {
    expect(workDaysOf(fixture("timetastic-user-detail.json").body, "2026-10-09")?.sort()).toEqual(["mon", "sat", "sun", "thu", "tue", "wed"]);
  });
  test("bookings never keep a reason or decline reason", () => {
    const page = normaliseBookings(fixture("timetastic-holidays.json").body);
    expect(page.totalRecords).toBe(3);
    expect(page.rows[0]).toMatchObject({ bookingId: "9001", ttUserId: "7002", leaveTypeId: "801", status: "Approved", startAt: "2026-10-14T00:00:00", startType: "Morning", actionerId: "7001" });
    const text = JSON.stringify(page);
    for (const bad of ["reason", "private", "doctor", "fever", "decline note"]) expect(text.toLowerCase()).not.toContain(bad);
  });
  test("absences keep bookings, public holidays and non-working days; a booking's detail is never kept", () => {
    const rows = normaliseAbsences(fixture("timetastic-absences.json").body);
    expect(rows.map(r => [r.day, r.kind, r.entityKey, r.detail])).toEqual([
      ["2026-10-09", "non_working", "nwd", null],
      ["2026-10-14", "booking", "9001", null],
      ["2026-10-22", "public_holiday", "31", "Made-up holiday"],
    ]);
    expect(JSON.stringify(rows)).not.toContain("doctor");
  });
  test("leave types", () => {
    expect(normaliseLeaveTypes(fixture("timetastic-leavetypes.json").body).map(t => [t.externalId, t.name, t.deducted])).toEqual([
      ["801", "Holiday", true], ["802", "Sick", false], ["803", "Unpaid leave", false], ["804", "Working from home", false]]);
  });
});

describe("the shape recorder (scripts/dev/hours-record.ts)", () => {
  test("keeps keys and types, replaces every value", async () => {
    const { shapeOf } = await import("../../../scripts/dev/hours-record.ts");
    const shaped = shapeOf({ members: [{ user_id: 5002, pay_rate: 12.5, user: { name: "Person One", email: "person1@example.test" }, trackable: true }, {}, {}], next: null });
    expect(shaped).toEqual({ members: [{ user_id: 0, pay_rate: 0, user: { name: "<string>", email: "<string>" }, trackable: false }, {}], next: null });
    expect(JSON.stringify(shaped)).not.toContain("example.test");
  });
});
