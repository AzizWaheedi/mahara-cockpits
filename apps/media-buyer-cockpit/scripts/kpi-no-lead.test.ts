/**
 * Spend with no lead (Aziz, 23 Oct 2026, cost per booking decisions, 4):
 * "Depends on how much spend if 2x target cpl then yes bad if below that then
 * not enough data". The line is NO_LEAD_MULTIPLE x the cost per lead target,
 * 2 x the $15 gate unless a surface reads the client's own line, compared on
 * the cents a screen shows. Under it a client or campaign with no lead is too
 * few to judge, never out of KPI; at or over it, it is out of KPI unless known
 * bookings within $60 hold it in (the golden rule). Madana, 14 to 20 Oct:
 * $11.09 and no lead, too few.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  belowKpi,
  CPB_GATE,
  CPL_BAD,
  CPL_GATE,
  gridCell,
  NO_LEAD_MULTIPLE,
  noLeadLine,
} from "../src/lib/kpi";

describe("the no-lead line", () => {
  test("2 x the cost per lead target, the $15 gate when none is given", () => {
    expect(NO_LEAD_MULTIPLE).toBe(2);
    expect(noLeadLine()).toBe(NO_LEAD_MULTIPLE * CPL_GATE);
    expect(noLeadLine()).toBe(30);
    // A client whose own line is $20: the verdict comes at $40.
    expect(noLeadLine(20)).toBe(40);
  });

  test("both kpi.ts copies carry it, byte for byte, and type no 30", () => {
    const root = join(import.meta.dir, "..", "..");
    const mb = readFileSync(
      join(root, "media-buyer-cockpit/src/lib/kpi.ts"),
      "utf8",
    );
    const cs = readFileSync(
      join(root, "client-success-cockpit/src/lib/kpi.ts"),
      "utf8",
    );
    expect(cs).toBe(mb);
    expect(mb).toContain("export const NO_LEAD_MULTIPLE = 2;");
    expect(mb).toContain(
      "export function noLeadLine(cplTarget: number = CPL_GATE): number {\n  return NO_LEAD_MULTIPLE * cplTarget;\n}",
    );
    expect(mb).not.toMatch(/\b30\b/);
  });
});

describe("belowKpi with no lead", () => {
  const noLead = (spend: number, bookings7d?: number | null) =>
    belowKpi({ spend7d: spend, leads7d: 0, bookings7d });

  test("$0, $11.09 and $29.99 are too few to judge, whatever the bookings", () => {
    for (const spend of [0, 11.09, 29.99])
      for (const bookings of [undefined, null, 0, 1])
        expect([spend, bookings, noLead(spend, bookings)]).toEqual([
          spend,
          bookings,
          false,
        ]);
  });

  test("$30.00 and $41.65 with no booking, or bookings not read, are out of KPI", () => {
    for (const spend of [30, 41.65])
      for (const bookings of [undefined, null, 0])
        expect([spend, bookings, noLead(spend, bookings)]).toEqual([
          spend,
          bookings,
          true,
        ]);
  });

  test("the line judges the cents a screen shows", () => {
    // $29.994 reads $29.99; $29.995 reads $30.00.
    expect(noLead(29.994, 0)).toBe(false);
    expect(noLead(29.995, 0)).toBe(true);
  });

  test("leadSpend7d is the spend judged, never the spend set against bookings", () => {
    // The EOD passes the client's whole spend: $41.65 with only $11.09 of it
    // set against read bookings is still out of KPI.
    expect(
      belowKpi({
        spend7d: 11.09,
        leads7d: 0,
        bookings7d: 0,
        leadSpend7d: 41.65,
      }),
    ).toBe(true);
    expect(
      belowKpi({
        spend7d: 41.65,
        leads7d: 0,
        bookings7d: 0,
        leadSpend7d: 11.09,
      }),
    ).toBe(false);
  });

  test("at or over the line, bookings judge it with the cost per lead counted over $22.50", () => {
    // No lead counts as the third column, over CPL_BAD.
    expect(gridCell(45, 0, 1).column).toBe(2);
    expect(CPL_BAD).toBe(22.5);
    // Earlier leads that booked within $60: a hold on the good row, not out of KPI.
    expect(gridCell(45, 0, 1)).toEqual({
      row: "good",
      column: 2,
      verdict: "hold",
    });
    expect(noLead(45, 1)).toBe(false);
    expect(noLead(CPB_GATE, 1)).toBe(false);
    // $60 to $80 a booking: a kill. Over $80: a kill.
    expect(gridCell(70, 0, 1).verdict).toBe("kill");
    expect(noLead(70, 1)).toBe(true);
    expect(noLead(170, 2)).toBe(true);
    expect(noLead(170, 1)).toBe(true);
  });
});

describe("leads above 0 are judged as before", () => {
  test("the grid and the cost per lead gate, unchanged", () => {
    // Arcturus, 14 to 20 Oct: $242.48, 39 leads, 4 bookings = $60.62.
    expect(
      belowKpi({ spend7d: 242.48, leads7d: 39, cpl: 6.22, bookings7d: 4 }),
    ).toBe(true);
    // Alkhalil: no booking on $233.36.
    expect(
      belowKpi({ spend7d: 233.36, leads7d: 17, cpl: 13.73, bookings7d: 0 }),
    ).toBe(true);
    // Too early on bookings with a fair cost per lead.
    expect(
      belowKpi({ spend7d: 45, leads7d: 2, cpl: 22.5, bookings7d: 0 }),
    ).toBe(false);
    // Atlantis: $34.91 a lead, $43.63 a booking: the golden rule.
    expect(
      belowKpi({ spend7d: 174.53, leads7d: 5, cpl: 34.91, bookings7d: 4 }),
    ).toBe(false);
    // Bookings not read: the cost per lead gate alone.
    expect(belowKpi({ spend7d: 400, leads7d: 20, cpl: 20 })).toBe(true);
    expect(belowKpi({ spend7d: 140, leads7d: 10, cpl: 14 })).toBe(false);
    // leadSpend7d changes nothing once there are leads.
    expect(
      belowKpi({
        spend7d: 242.48,
        leads7d: 39,
        cpl: 6.22,
        bookings7d: 4,
        leadSpend7d: 1,
      }),
    ).toBe(true);
  });
});
