/**
 * The Ads management filters follow the picked time frame (Aziz, 2026-10-21:
 * "the filters for cost per booking ... with the different time frames ...
 * are not showing that correctly"). A filter on spend, leads or bookings reads
 * the numbers its row shows for the range; the Call and the day average stay
 * on 7 days. Every figure here is made up.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { adsPageCampaignRows } from "../src/dev/adsPageFixture";
import {
  ADS_FILTERS,
  adsFilterPasses,
  boardNumbers,
  type RowNumbers,
} from "../src/lib/adsFilters";
import { cpbDisplay, shownMoney } from "../src/lib/costTone";
import { belowKpi, gridCell, noLeadLine } from "../src/lib/kpi";

const CPB = "Cost per booking over $60";

/** A campaign whose 7-day snapshot says one thing. */
const campaign = (over: Record<string, unknown> = {}) => ({
  campaignName: "EXAMPLE-ONE",
  verdict: "hold",
  spend7d: 280,
  leads7d: 20,
  cpl: 14,
  bookings7d: 7,
  bookingRate: 35,
  costPerBooking: 40,
  dayRate: 40,
  daysLive: 3,
  daysSinceTouch: 1,
  ...over,
});

/** A range read as api.stats.range returns it. */
const read = (spend: number, leads: number, bookings: number) => ({
  total: { spend, leads, bookings },
  bookingsTotal: bookings,
});

const ok = (n: ReturnType<typeof boardNumbers>): RowNumbers | undefined =>
  n.state === "ok" ? n : undefined;

describe("cost per booking over $60 follows the time frame", () => {
  test("on 7 days it reads the snapshot's cost per booking", () => {
    const c = campaign({ costPerBooking: 75 });
    expect(adsFilterPasses(CPB, c, ok(boardNumbers(c, false, undefined)))).toBe(
      true,
    );
    const fine = campaign({ costPerBooking: 40 });
    expect(
      adsFilterPasses(CPB, fine, ok(boardNumbers(fine, false, undefined))),
    ).toBe(false);
  });

  test("on another range it reads that range's cost per booking, not the 7-day one", () => {
    // 7 days: $40 a booking. Last 30 days: $900 for 9 bookings = $100.
    const c = campaign({ costPerBooking: 40 });
    const n = ok(boardNumbers(c, true, read(900, 60, 9)));
    expect(n?.costPerBooking).toBe(100);
    expect(adsFilterPasses(CPB, c, n)).toBe(true);
    // And the other way: $90 over 7 days, $30 over the month.
    const d = campaign({ costPerBooking: 90 });
    expect(
      adsFilterPasses(CPB, d, ok(boardNumbers(d, true, read(300, 30, 10)))),
    ).toBe(false);
  });

  test("today and yesterday too: no bookings in the range is not a cost per booking", () => {
    const c = campaign({ costPerBooking: 75 });
    expect(
      adsFilterPasses(CPB, c, ok(boardNumbers(c, true, read(45, 2, 0)))),
    ).toBe(false);
    expect(
      adsFilterPasses(CPB, c, ok(boardNumbers(c, true, read(130, 4, 2)))),
    ).toBe(true);
  });

  test("a row still being read, or not read, is not counted on the range's numbers", () => {
    const c = campaign({ costPerBooking: 75 });
    expect(boardNumbers(c, true, undefined).state).toBe("loading");
    expect(adsFilterPasses(CPB, c, ok(boardNumbers(c, true, undefined)))).toBe(
      false,
    );
    expect(
      adsFilterPasses(
        CPB,
        c,
        ok(boardNumbers(c, true, new Error("read failed"))),
      ),
    ).toBe(false);
  });
});

test("a cost per booking is judged as the cell shows it: $60 is not over $60, $60.40 is", () => {
  // Cents under $100 (2026-10-22). $1,800 for 30 bookings is "$60";
  // $1,800.12 is $60.004, also "$60"; $1,812 is $60.40, shown "$60.40".
  const c = campaign();
  const at = (spend: number) => ok(boardNumbers(c, true, read(spend, 90, 30)));
  expect(cpbDisplay(1800, 30).text).toBe("$60");
  expect(adsFilterPasses(CPB, c, at(1800))).toBe(false);
  expect(cpbDisplay(1800.12, 30)).toMatchObject({ text: "$60", tone: "good" });
  expect(adsFilterPasses(CPB, c, at(1800.12))).toBe(false);
  expect(cpbDisplay(1812, 30)).toMatchObject({
    text: "$60.40",
    tone: "warn",
  });
  expect(adsFilterPasses(CPB, c, at(1812))).toBe(true);
});

describe("the other filters on spend, leads and bookings follow it as well", () => {
  test("No bookings reads the range's bookings and spend", () => {
    const c = campaign({ bookings7d: 3 });
    expect(
      adsFilterPasses(
        "No bookings",
        c,
        ok(boardNumbers(c, true, read(60, 5, 0))),
      ),
    ).toBe(true);
    const booked = campaign({ bookings7d: 0, spend7d: 100 });
    expect(
      adsFilterPasses(
        "No bookings",
        booked,
        ok(boardNumbers(booked, true, read(60, 5, 2))),
      ),
    ).toBe(false);
  });

  test("a done-with-you campaign has no bookings to judge on any range", () => {
    const dwy = campaign({ bookings7d: undefined, costPerBooking: undefined });
    const n = ok(boardNumbers(dwy, true, read(500, 10, 0)));
    expect(n?.bookings).toBeUndefined();
    expect(adsFilterPasses("No bookings", dwy, n)).toBe(false);
    expect(adsFilterPasses(CPB, dwy, n)).toBe(false);
  });

  test("Critical: the Call stays on 7 days; no leads reads the range", () => {
    const kill = campaign({ verdict: "kill" });
    expect(adsFilterPasses("Critical", kill, undefined)).toBe(true);
    const c = campaign({ leads7d: 4 });
    expect(
      adsFilterPasses("Critical", c, ok(boardNumbers(c, true, read(50, 0, 0)))),
    ).toBe(true);
    const quiet = campaign({ leads7d: 0, spend7d: 60 });
    expect(
      adsFilterPasses(
        "Critical",
        quiet,
        ok(boardNumbers(quiet, true, read(60, 3, 0))),
      ),
    ).toBe(false);
  });

  test("Critical: no lead is critical from 2 x the $15 gate, not before (decision 4)", () => {
    const c = campaign({ verdict: "hold" });
    const critical = (spend: number, leads = 0) =>
      adsFilterPasses(
        "Critical",
        c,
        ok(boardNumbers(c, true, read(spend, leads, 0))),
      );
    expect(noLeadLine()).toBe(30);
    // Madana's $11.09, and anything under $30: not enough data yet.
    expect(critical(11.09)).toBe(false);
    expect(critical(20.01)).toBe(false);
    expect(critical(29.99)).toBe(false);
    // $29.994 shows as $29.99; $29.995 shows as $30.00.
    expect(critical(29.994)).toBe(false);
    expect(critical(29.995)).toBe(true);
    expect(critical(30)).toBe(true);
    expect(critical(41.65)).toBe(true);
    // A lead takes it off, whatever the spend.
    expect(critical(41.65, 1)).toBe(false);
    // Leads not in yet (Today, before Meta's numbers): never read as 0.
    const notIn = ok({ state: "ok", bookings: 0, spendNotIn: "2026-10-22" });
    expect(adsFilterPasses("Critical", c, notIn)).toBe(false);
    // The 7-day snapshot reads the same way (no booking, so the line alone
    // decides).
    const noBooking = { bookings7d: 0, costPerBooking: undefined };
    const week = campaign({
      verdict: "hold",
      leads7d: 0,
      spend7d: 29.99,
      ...noBooking,
    });
    expect(
      adsFilterPasses(
        "Critical",
        week,
        ok(boardNumbers(week, false, undefined)),
      ),
    ).toBe(false);
    const due = campaign({
      verdict: "hold",
      leads7d: 0,
      spend7d: 30,
      ...noBooking,
    });
    expect(
      adsFilterPasses("Critical", due, ok(boardNumbers(due, false, undefined))),
    ).toBe(true);
  });

  test("Critical: earlier leads that book within $60 hold a no-lead row (contract 1.4.7)", () => {
    const c = campaign({ verdict: "hold" });
    const critical = (spend: number, bookings: number) =>
      adsFilterPasses(
        "Critical",
        c,
        ok(boardNumbers(c, true, read(spend, 0, bookings))),
      );
    // $45 and one booking: $45 a booking, held as the worker holds it.
    expect(critical(45, 1)).toBe(false);
    // $60.004 a booking shows as $60: still held. $60.01 is not.
    expect(critical(60.004, 1)).toBe(false);
    expect(critical(60.01, 1)).toBe(true);
    // $70 a booking is over the gate: critical.
    expect(critical(70, 1)).toBe(true);
    // No booking: the line alone decides.
    expect(critical(45, 0)).toBe(true);
    // The 7-day snapshot reads the same way, on its own cost per booking.
    const held = campaign({
      verdict: "hold",
      leads7d: 0,
      spend7d: 45,
      bookings7d: 2,
      costPerBooking: 22.5,
    });
    expect(
      adsFilterPasses(
        "Critical",
        held,
        ok(boardNumbers(held, false, undefined)),
      ),
    ).toBe(false);
  });

  test("the Verdict Playbook says the no-lead line from kpi.ts, never typed", () => {
    const playbook = readFileSync(
      join(import.meta.dir, "../src/components/VerdictPlaybook.tsx"),
      "utf8",
    );
    // "No lead on $30 or more (2 x the $15 gate): Kill, or Hold when earlier
    // leads book within $60. Under $30: Hold, not enough data.", every
    // amount from kpi.ts.
    expect(playbook).toMatch(
      /`No lead on \$\$\{noLeadLine\(\)\} or more \(\$\{NO_LEAD_MULTIPLE\} x the \$\$\{CPL_GATE\} gate\): Kill, or Hold when earlier leads book within \$\$\{CPB_GATE\}\. Under \$\$\{noLeadLine\(\)\}: Hold, not enough data\.`/,
    );
    expect(playbook).not.toMatch(/\$(20|30)\b/);
    expect(playbook).not.toContain("—");
  });

  test("the harness's Lantern stays the too-early story: under the line, not Critical", () => {
    const lantern = adsPageCampaignRows().find(r =>
      String(r.campaign_name).startsWith("Lantern"),
    )?.raw_data as Record<string, unknown>;
    expect(lantern.leads7d).toBe(0);
    expect(lantern.spend7d as number).toBeGreaterThan(20);
    expect(lantern.spend7d as number).toBeLessThan(noLeadLine());
    expect(
      adsFilterPasses(
        "Critical",
        lantern,
        ok(boardNumbers(lantern, false, undefined)),
      ),
    ).toBe(false);
  });

  test("Below KPI: no lead under the line is too few to judge (decision 4)", () => {
    const c = campaign();
    const below = (spend: number, bookings: number) =>
      adsFilterPasses(
        "Below KPI",
        c,
        ok(boardNumbers(c, true, read(spend, 0, bookings))),
      );
    expect(below(11.09, 0)).toBe(false);
    expect(below(29.99, 0)).toBe(false);
    expect(below(30, 0)).toBe(true);
    // Earlier leads that booked within $60 hold it in; $70 a booking is out.
    expect(below(45, 1)).toBe(false);
    expect(below(70, 1)).toBe(true);
  });

  test("Below KPI: leads not read get no verdict, never no lead (contract 1.4.1)", () => {
    // A 7-day row with no lead count and $41.65 spent, bookings unknown.
    const unread = campaign({
      leads7d: undefined,
      cpl: undefined,
      spend7d: 41.65,
      bookings7d: undefined,
      costPerBooking: undefined,
    });
    expect(
      adsFilterPasses(
        "Below KPI",
        unread,
        ok(boardNumbers(unread, false, undefined)),
      ),
    ).toBe(false);
    // The same row with its count read as 0 is out of KPI.
    const none = campaign({
      leads7d: 0,
      cpl: undefined,
      spend7d: 41.65,
      bookings7d: undefined,
      costPerBooking: undefined,
    });
    expect(
      adsFilterPasses(
        "Below KPI",
        none,
        ok(boardNumbers(none, false, undefined)),
      ),
    ).toBe(true);
  });

  test("Below KPI judges the range's cost per lead and cost per booking", () => {
    // 7 days in KPI ($14 a lead, $40 a booking); the month is a kill: $25 a lead, $250 a booking.
    const c = campaign();
    expect(
      adsFilterPasses("Below KPI", c, ok(boardNumbers(c, false, undefined))),
    ).toBe(false);
    expect(
      adsFilterPasses(
        "Below KPI",
        c,
        ok(boardNumbers(c, true, read(1000, 40, 4))),
      ),
    ).toBe(true);
  });

  test("Under the floor stays on the 7-day day average its column shows", () => {
    const c = campaign({ dayRate: 20 });
    expect(
      adsFilterPasses(
        "Under the floor",
        c,
        ok(boardNumbers(c, true, read(3000, 90, 30))),
      ),
    ).toBe(true);
  });
});

describe("no booking after spend is judged, not n/a (2026-10-21)", () => {
  test("the cell: n/a when bookings are unknown, None yet to $60, None on the spend past it", () => {
    expect(cpbDisplay(500, undefined)).toMatchObject({
      text: "n/a",
      tone: undefined,
    });
    expect(cpbDisplay(500, null)).toMatchObject({ text: "n/a" });
    expect(cpbDisplay(45, 0)).toMatchObject({
      text: "None yet",
      tone: undefined,
      judged: undefined,
      noneOnSpend: false,
    });
    expect(cpbDisplay(60, 0).text).toBe("None yet");
    // Alkhalil 'ALKHALIL- MAHRA-15\9', 14-20 Oct: $233.36, 17 leads, no booking.
    expect(cpbDisplay(233.36, 0)).toMatchObject({
      text: "None on $233",
      tone: "bad",
      judged: 233,
      noneOnSpend: true,
    });
    // $61 to $80 with no booking is the grid's watch row: a warning colour.
    expect(cpbDisplay(70, 0)).toMatchObject({
      text: "None on $70",
      tone: "warn",
    });
    expect(gridCell(70, 10, 0).row).toBe("watch");
    expect(gridCell(233.36, 17, 0).row).toBe("bad");
    // Booked: the cost, in the grid's colour; the caller's own cost wins.
    expect(cpbDisplay(354, 3)).toMatchObject({ text: "$118", tone: "bad" });
    expect(cpbDisplay(1000, 3, { cost: 40 })).toMatchObject({
      text: "$40",
      tone: "good",
    });
    // A booking from an ad that spent before the range is no $0 booking.
    expect(cpbDisplay(0, 2)).toMatchObject({ text: "n/a", tone: undefined });
    expect(cpbDisplay(1234.5, 0).text).toBe("None on $1,235");
  });

  test("Cost per booking over $60 lists no booking on more than $60, judged on the shown dollars", () => {
    const c = campaign({ costPerBooking: 40 });
    expect(
      adsFilterPasses(CPB, c, ok(boardNumbers(c, true, read(233.36, 17, 0)))),
    ).toBe(true);
    // "None on $60.40" is over $60; "$60" spent ($60.004) is still None yet.
    expect(
      adsFilterPasses(CPB, c, ok(boardNumbers(c, true, read(60.4, 3, 0)))),
    ).toBe(true);
    expect(
      adsFilterPasses(CPB, c, ok(boardNumbers(c, true, read(60.004, 3, 0)))),
    ).toBe(false);
    expect(
      adsFilterPasses(CPB, c, ok(boardNumbers(c, true, read(60.5, 3, 0)))),
    ).toBe(true);
    expect(
      adsFilterPasses(CPB, c, ok(boardNumbers(c, true, read(59, 3, 0)))),
    ).toBe(false);
    // The 7-day snapshot too.
    const none = campaign({
      spend7d: 233.36,
      leads7d: 17,
      bookings7d: 0,
      costPerBooking: undefined,
    });
    expect(
      adsFilterPasses(CPB, none, ok(boardNumbers(none, false, undefined))),
    ).toBe(true);
    // No bookings keeps its own rule.
    expect(
      adsFilterPasses(
        "No bookings",
        none,
        ok(boardNumbers(none, false, undefined)),
      ),
    ).toBe(true);
  });
});

describe("Below KPI follows the golden rule (2026-10-21)", () => {
  test("bookings within $60 make a high cost per lead a watch, not out of KPI", () => {
    // $122.82, 2 leads, 5 bookings: $61.41 a lead, $24.56 a booking.
    expect(gridCell(122.82, 2, 5)).toEqual({
      row: "good",
      column: 2,
      verdict: "hold",
    });
    expect(
      belowKpi({ spend7d: 122.82, leads7d: 2, cpl: 61.41, bookings7d: 5 }),
    ).toBe(false);
    // Atlantis, 14-20 Oct: $34.91 a lead, $43.63 a booking.
    expect(
      belowKpi({ spend7d: 174.53, leads7d: 5, cpl: 34.91, bookings7d: 4 }),
    ).toBe(false);
    const c = campaign();
    expect(
      adsFilterPasses(
        "Below KPI",
        c,
        ok(boardNumbers(c, true, read(122.82, 2, 5))),
      ),
    ).toBe(false);
  });

  test("a hold over $60 a booking is out of KPI, and so is every kill", () => {
    // Arcturus, 14-20 Oct: $242.48, 39 leads, 4 bookings = $60.62.
    expect(gridCell(242.48, 39, 4)).toEqual({
      row: "watch",
      column: 0,
      verdict: "hold",
    });
    expect(
      belowKpi({ spend7d: 242.48, leads7d: 39, cpl: 6.22, bookings7d: 4 }),
    ).toBe(true);
    // No booking on $233.36 is a kill.
    expect(
      belowKpi({ spend7d: 233.36, leads7d: 17, cpl: 13.73, bookings7d: 0 }),
    ).toBe(true);
    // Too early on bookings, a fair cost per lead: not out of KPI.
    expect(
      belowKpi({ spend7d: 45, leads7d: 2, cpl: 22.5, bookings7d: 0 }),
    ).toBe(false);
    // No booking data: the cost per lead gate alone.
    expect(belowKpi({ spend7d: 400, leads7d: 20, cpl: 20 })).toBe(true);
  });
});

test("every filter on the range's numbers says so, and the page applies the module's rule", () => {
  const ranged = ADS_FILTERS.filter(f => f.ranged).map(f => f.label);
  expect(ranged).toEqual(["Critical", "Below KPI", CPB, "No bookings"]);
  const page = readFileSync(
    join(import.meta.dir, "../src/pages/CockpitPage.tsx"),
    "utf8",
  );
  // The page has no filter list of its own any more.
  expect(page).not.toContain("const FILTERS");
  expect(page).toContain("adsFilterPasses(label, c, rowNumbers(c))");
});

describe("the cost per booking cell never reads $0, and agrees with its filter (2026-10-22)", () => {
  test("bookings with nothing spent read n/a, whatever cost the caller passes", () => {
    // The worker's 7-day row divides spend by bookings with no spend guard,
    // so a $0 week with one booking arrives as a cost of 0.
    expect(cpbDisplay(0, 1, { cost: 0 })).toMatchObject({
      text: "n/a",
      tone: undefined,
      judged: undefined,
    });
    expect(cpbDisplay(0, 1, { cost: 0 }).why).toContain("Nothing was spent");
    expect(cpbDisplay(0, 2, { cost: 25 }).text).toBe("n/a");
    const held = campaign({
      spend7d: 0,
      leads7d: 0,
      bookings7d: 1,
      costPerBooking: 0,
    });
    const n = ok(boardNumbers(held, false, undefined));
    expect(
      cpbDisplay(n?.spend, n?.bookings, { cost: n?.costPerBooking }).text,
    ).toBe("n/a");
    expect(adsFilterPasses(CPB, held, n)).toBe(false);
  });

  test("cents under $100, coloured on what the cell reads", () => {
    // Arcturus, 14-20 Oct: $242.48 for 4 bookings.
    expect(cpbDisplay(242.48, 4)).toMatchObject({
      text: "$60.62",
      tone: "warn",
      judged: 60.62,
    });
    // Khalida 14\10: $80.27 a booking is over the $80 line: red "$80.27",
    // never a red "$80".
    expect(cpbDisplay(80.27, 1)).toMatchObject({
      text: "$80.27",
      tone: "bad",
    });
    expect(cpbDisplay(80.004, 1)).toMatchObject({ text: "$80", tone: "warn" });
    expect(cpbDisplay(354, 3)).toMatchObject({ text: "$118", tone: "bad" });
    expect(shownMoney(60.004)).toBe(60);
    expect(shownMoney(60.4)).toBe(60.4);
    expect(shownMoney(99.996)).toBe(100);
    expect(shownMoney(233.36)).toBe(233);
  });

  test("None yet up to $60 as shown; None on $60.40 is amber and over $60", () => {
    expect(cpbDisplay(60.004, 0)).toMatchObject({
      text: "None yet",
      tone: undefined,
    });
    expect(cpbDisplay(60.4, 0)).toMatchObject({
      text: "None on $60.40",
      tone: "warn",
      judged: 60.4,
      noneOnSpend: true,
    });
  });

  test("the colour, the text and the over-$60 filter agree on every amount near the gates", () => {
    const c = campaign();
    const amount = (text: string) =>
      Number(/\$([\d,]+(?:\.\d+)?)/.exec(text)?.[1]?.replace(/,/g, ""));
    for (const bookings of [0, 1]) {
      for (let cents = 5950; cents <= 8050; cents += 1) {
        for (const spend of [
          cents / 100,
          cents / 100 + 0.004,
          cents / 100 + 0.006,
        ]) {
          const shown = cpbDisplay(spend, bookings);
          const listed = adsFilterPasses(
            CPB,
            c,
            ok(boardNumbers(c, true, read(spend, 10, bookings))),
          );
          const coloured = shown.tone === "warn" || shown.tone === "bad";
          if (listed !== coloured)
            throw new Error(`${spend} / ${bookings}: ${shown.text}`);
          // Listed exactly when the amount the cell reads is over $60.
          const reads = shown.text === "None yet" ? 0 : amount(shown.text);
          if (listed !== reads > 60)
            throw new Error(`${spend} / ${bookings}: ${shown.text}`);
          // The grid (Below KPI, the EOD's out-of-KPI list) judges the same
          // cents: its watch and bad rows are exactly the coloured cells
          // (2026-10-22; the worker's judge rounds the same way).
          const row = gridCell(spend, 10, bookings).row;
          if ((row === "watch" || row === "bad") !== coloured)
            throw new Error(
              `grid ${spend} / ${bookings}: ${row}, ${shown.text}`,
            );
          if ((row === "bad") !== (shown.tone === "bad"))
            throw new Error(
              `grid ${spend} / ${bookings}: ${row}, ${shown.text}`,
            );
        }
      }
    }
  });
});

describe("a range after the media data's last day keeps its bookings (2026-10-22)", () => {
  // Today on 22 Oct: Meta's numbers run to 21 Oct; Ocean Home has booked 2.
  const today = {
    total: { spend: 0, leads: 0, bookings: 2 },
    bookingsTotal: 2,
    hasData: false,
    spendNotIn: "2026-10-21",
  };

  test("spend and leads read n/a, the bookings stay, the cost says why it waits", () => {
    const c = campaign();
    const n = ok(boardNumbers(c, true, today));
    expect(n).toMatchObject({ bookings: 2, spendNotIn: "2026-10-21" });
    expect(n?.spend).toBeUndefined();
    expect(n?.leads).toBeUndefined();
    const cell = cpbDisplay(n?.spend, n?.bookings, {
      cost: n?.costPerBooking,
      spendNotIn: n?.spendNotIn,
    });
    expect(cell).toMatchObject({ text: "n/a", tone: undefined });
    expect(cell.why).toBe(
      "Meta's numbers after 21 Oct are not in yet, so these 2 bookings have no spend to set against yet.",
    );
    for (const label of ["Critical", "Below KPI", CPB, "No bookings"])
      expect(adsFilterPasses(label, c, n)).toBe(false);
  });

  test("no booking yet today reads None yet with the reason, never $0 of spend", () => {
    const quiet = cpbDisplay(undefined, 0, { spendNotIn: "2026-10-21" });
    expect(quiet).toMatchObject({ text: "None yet", tone: undefined });
    expect(quiet.why).toBe(
      "No booking yet. Meta's numbers after 21 Oct are not in yet.",
    );
    expect(cpbDisplay(0, 1, { spendNotIn: "2026-10-21" }).why).toBe(
      "Meta's numbers after 21 Oct are not in yet, so this booking has no spend to set against yet.",
    );
  });
});
