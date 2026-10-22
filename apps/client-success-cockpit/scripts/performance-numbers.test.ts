import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  bucketDays,
  completeDays,
  costJudge,
  delta,
  type Headline,
  pairedFromRecord,
  partialBucket,
  ratioHead,
  ratioHeadline,
  spanLabel,
  TrendChart,
  type TrendPoint,
} from "../src/components/TrendChart";
import { sheetCoverage } from "../src/lib/csmDiagnosis";
import { CPB_BAD, CPB_GATE } from "../src/lib/kpi";
import {
  byAdIn,
  periodNumbers,
  periodOf,
  withSheetMonth,
} from "../src/lib/reportPeriod";

const today = "2026-10-11";

test("This month keeps ad leads and spend, and takes only outcomes from the sheet tab", () => {
  const ads = periodNumbers(
    [],
    [{ date: "2026-10-02", leads: 40, spend: 400 }],
    "2026-10-01",
    "2026-10-31",
    today,
  );
  const sheetTab = {
    leads: 25,
    booked: 12,
    shows: 8,
    noshows: 2,
    closes: 3,
    showRate: 80,
  };
  const m = withSheetMonth(ads, sheetTab);
  expect(m?.leads).toBe(40);
  expect(m?.cpl).toBe(10);
  expect(m?.leadsFrom).toBe("ads");
  expect(m?.booked).toBe(12);
  expect(m?.sheetLeads).toBe(25);
});

test("a never-booked lead is not counted as an appointment with no outcome", () => {
  const appts = [
    { added: "2026-10-02", booked: false, ad: "A" },
    { added: "2026-10-02", booked: true, appAt: "2026-10-03", ad: "A" },
  ];
  const [a] = byAdIn(appts, "2026-10-01", "2026-10-10", today);
  expect(a.unknown).toBe(1);
  expect(
    periodNumbers(appts, [], "2026-10-01", "2026-10-10", today).unknownOutcome,
  ).toBe(1);
});

test("close rate counts closes among the people who came, so it cannot pass 100%", () => {
  const appts = [
    { added: "2026-10-02", booked: true, show: "y", closed: "y" },
    { added: "2026-10-02", booked: true, show: "", closed: "y" },
    { added: "2026-10-02", booked: true, show: "", closed: "y" },
  ];
  const n = periodNumbers(appts, [], "2026-10-01", "2026-10-10", today);
  expect(n.closes).toBe(3);
  expect(n.closeRate).toBe(100);
  expect(byAdIn(appts, "2026-10-01", "2026-10-10", today)[0].closeRate).toBe(
    100,
  );
});

test("a period before the first ad day uses the sheet count, not an ad zero", () => {
  const appts = [{ added: "2026-08-03", booked: true }];
  const adDays = [{ date: "2026-09-15", leads: 5, spend: 50 }];
  const before = periodNumbers(
    appts,
    adDays,
    "2026-08-01",
    "2026-08-31",
    today,
  );
  expect(before.leadsFrom).toBe("sheet");
  expect(before.leads).toBe(1);
  const quiet = periodNumbers([], adDays, "2026-09-20", "2026-09-30", today);
  expect(quiet.leadsFrom).toBe("ads");
  expect(quiet.leads).toBe(0);
});

test("the ad table limit is explicit, so the page can say how many it hides", () => {
  const appts = Array.from({ length: 15 }, (_, i) => ({
    added: "2026-10-02",
    ad: `Ad ${i}`,
  }));
  expect(byAdIn(appts, "2026-10-01", "2026-10-10", today)).toHaveLength(12);
  expect(
    byAdIn(appts, "2026-10-01", "2026-10-10", today, Number.POSITIVE_INFINITY),
  ).toHaveLength(15);
});

test("a ratio trend compares sum over sum, not the average of daily ratios", () => {
  // Thirds of nine days. Days 4-6: $10 for 1 lead each (CPL 10). Days 7-9:
  // one $100 day for 1 lead and two $0 days for 9 leads each. The daily
  // ratios average 33.3 (a 233% rise), but the real CPL is 100 / 19 = 5.26,
  // a 47% fall.
  const pts = [
    ...[1, 2, 3, 4, 5, 6].map(d => ({ x: `d${d}`, y: 10, num: 10, den: 1 })),
    { x: "d7", y: 100, num: 100, den: 1 },
    { x: "d8", y: 0, num: 0, den: 9 },
    { x: "d9", y: 0, num: 0, den: 9 },
  ];
  expect(delta(pts, "avg")).toBe(-47);
});

test("today's half day is left out of the change", () => {
  const pts = [10, 10, 10, 10, 10, 10].map((y, i) => ({ x: `d${i}`, y }));
  pts.push({ x: "today", y: 1, partial: true } as never);
  expect(delta(pts, "sum")).toBe(0);
  expect(partialBucket("2026-10-11", false, today)).toBe(true);
  expect(partialBucket("2026-10-10", false, today)).toBe(false);
  expect(partialBucket("2026-10-06", true, today)).toBe(true);
  expect(partialBucket("2026-09-29", true, today)).toBe(false);
});

test("a quiet day between two days with data stays on the axis as a zero", () => {
  const rows = [
    { date: "2026-10-01", leads: 3 },
    { date: "2026-10-04", leads: 2 },
  ];
  const keys = bucketDays(rows, "2026-09-25", "2026-10-10").map(b => b.key);
  expect(keys).toEqual([
    "2026-10-01",
    "2026-10-02",
    "2026-10-03",
    "2026-10-04",
  ]);
});

/**
 * R9 (2026-10-21): the Results tab's ratio cards headlined the last complete
 * day's own ratio and named no day. City Wood, This month on 21 Oct, read
 * $11.59 (20 Oct: $34.78 for 3 bookings) against a month of $674.63 for 3,
 * $224.88. These are its rows from that day's profile.
 */
const CITY_WOOD_SPEND = [
  ["2026-10-01", 32.04],
  ["2026-10-02", 45.55],
  ["2026-10-03", 24.3],
  ["2026-10-04", 37.56],
  ["2026-10-05", 37.22],
  ["2026-10-06", 37.68],
  ["2026-10-07", 35.34],
  ["2026-10-08", 33.47],
  ["2026-10-09", 28.85],
  ["2026-10-13", 8.62],
  ["2026-10-14", 58.05],
  ["2026-10-15", 56.48],
  ["2026-10-16", 59.8],
  ["2026-10-17", 58.96],
  ["2026-10-18", 41.26],
  ["2026-10-19", 44.67],
  ["2026-10-20", 34.78],
].map(([date, spend]) => ({ date: String(date), spend: Number(spend) }));
const CITY_WOOD_BOOKED = [
  ...Array(3).fill("2026-10-20"),
  ...Array(4).fill("2026-10-21"),
].map(date => ({ date, booked: true }));

type Spend = { date: string; spend: number; leads?: number };
type Appt = { date: string; booked: boolean; show?: string };
const spendOf = (rows: Spend[]) => rows.reduce((s, r) => s + r.spend, 0);
const bookedOf = (rows: Appt[]) => rows.filter(r => r.booked).length;
const judge = costJudge(CPB_GATE, CPB_BAD);
const spent = (n: number) =>
  n ? `$${Math.round(n).toLocaleString("en-US")} spent` : "";

/**
 * The Results tab's Cost per booking card, wired as the page wires it: the
 * profile's every ad day, the sheet's rows, the range, today, and the days
 * the sheet holds.
 */
function cpbCard(
  spend: Spend[],
  appts: Appt[],
  from: string,
  to: string,
  today: string,
  sheet: { from?: string; to?: string } = {},
) {
  const pair = pairedFromRecord(
    spend,
    appts,
    from,
    to,
    today,
    spendOf,
    bookedOf,
    sheet,
  );
  const head = ratioHead(pair, {
    unit: "$",
    none: "No bookings yet",
    noTop: "No spend found",
    parts: (n, d) =>
      [spent(n), `${d} ${d === 1 ? "booking" : "bookings"}`]
        .filter(Boolean)
        .join(" · "),
    judge,
  });
  return { pair, head };
}
const render = (points: TrendPoint[], head?: Headline) =>
  renderToStaticMarkup(
    createElement(TrendChart, {
      title: "Cost per booking",
      points,
      unit: "$",
      mode: "avg",
      goodWhen: "down",
      head,
    }),
  );

test("cost per booking headlines the month's spend over its bookings, not the last day", () => {
  const { pair, head } = cpbCard(
    CITY_WOOD_SPEND,
    CITY_WOOD_BOOKED,
    "2026-10-01",
    "2026-10-21",
    "2026-10-21",
  );
  // Every day either side has: 1 to 9 Oct and 13 to 21 Oct, and the quiet
  // days between them, not just the sheet's two days.
  expect(pair.points[0].x).toBe("2026-10-01");
  expect(pair.points.at(-1)?.x).toBe("2026-10-21");
  expect(pair.points.find(p => p.x === "2026-10-20")?.y).toBe(11.59);
  expect(pair.days).toEqual({ from: "2026-10-01", to: "2026-10-20" });
  expect(pair.total?.den).toBe(3);
  expect(Math.round((pair.total?.num ?? 0) * 100) / 100).toBe(674.63);
  expect(head.text).toBe("$225");
  expect(head.tone).toBe("bad");
  // The seven complete days, as the truth table reads them.
  const week = cpbCard(
    CITY_WOOD_SPEND,
    CITY_WOOD_BOOKED,
    "2026-10-14",
    "2026-10-20",
    "2026-10-21",
  );
  expect(week.pair.total?.num ?? 0).toBeCloseTo(354, 2);
  expect(week.head.text).toBe("$118");
});

test("the card names the days it adds up, and today waits until it is over", () => {
  const { pair, head } = cpbCard(
    CITY_WOOD_SPEND,
    CITY_WOOD_BOOKED,
    "2026-10-01",
    "2026-10-21",
    "2026-10-21",
  );
  const html = render(
    pair.points.map(p => ({
      ...p,
      partial: partialBucket(p.x, false, "2026-10-21"),
    })),
    head,
  );
  expect(html).toContain(">$225<");
  expect(html).toContain("txt-bad");
  expect(html).toContain("1–20 Oct · $675 spent · 3 bookings");
  expect(html).not.toContain("$11.59");
});

/**
 * Atlantis on 21 Oct: its ad spend is on record only from 7 Oct (the
 * campaigns before are stopped and left the profile), while its sheet holds
 * bookings from 3 Sep. Paired over the whole of 21 Sep to 20 Oct, 12
 * bookings sat over 7-20 Oct's $336.11: $28.01, under the gate, against a
 * true $69.28 (review finding 1, 2026-10-21).
 */
const ATLANTIS_SPEND: Spend[] = [
  ["2026-10-07", 20.62],
  ["2026-10-08", 34.85],
  ["2026-10-09", 29.77],
  ["2026-10-10", 23.61],
  ["2026-10-11", 38.41],
  ["2026-10-12", 14.32],
  ["2026-10-15", 46.17],
  ["2026-10-16", 51.72],
  ["2026-10-17", 24.93],
  ["2026-10-19", 15.38],
  ["2026-10-20", 36.33],
  ["2026-10-21", 34.54],
].map(([date, spend]) => ({ date: String(date), spend: Number(spend) }));
const ATLANTIS_BOOKED: Appt[] = [
  ...["03", "03", "06", "07", "08", "09", "10", "15", "19"],
  ...["24", "24", "24", "24", "24", "29", "29"],
]
  .map(d => `2026-09-${d}`)
  .concat([
    "2026-10-12",
    "2026-10-18",
    "2026-10-20",
    "2026-10-20",
    "2026-10-20",
    "2026-10-21",
  ])
  .map(date => ({ date, booked: true }));

test("bookings before the first day of spend on record are not bought for $0", () => {
  // "30 days" on 21 Oct: 21 Sep to 20 Oct, the snapshot's rows to 20 Oct.
  const snapshot = ATLANTIS_SPEND.filter(r => r.date <= "2026-10-20");
  const { pair, head } = cpbCard(
    snapshot,
    ATLANTIS_BOOKED.filter(r => r.date <= "2026-10-20"),
    "2026-09-21",
    "2026-10-20",
    "2026-10-21",
  );
  expect(pair.since).toBe("2026-10-07");
  expect(pair.days).toEqual({ from: "2026-10-07", to: "2026-10-20" });
  expect(head.text).toBe("$67.22");
  expect(head.text).not.toBe("$28.01");
  expect(head.tone).toBe("warn");
  expect(head.basis).toBe("7–20 Oct · $336 spent · 5 bookings");
  // The chart pairs from the same day: the September bookings are off it.
  expect(pair.points.some(p => p.x < "2026-10-07" && p.den)).toBe(false);
  // Last month, wholly before the record: spend not found, never $0.
  const sep = periodOf("lastMonth", "2026-10-21");
  const before = cpbCard(
    snapshot,
    ATLANTIS_BOOKED,
    sep.from,
    sep.to,
    "2026-10-21",
  );
  expect(before.pair.noTop).toBe(true);
  expect(before.head.text).toBe("No spend found");
  expect(before.head.basis).toBe("1–30 Sep · 16 bookings");
  const html = render(before.pair.points, before.head);
  expect(html).not.toContain("$0");
});

test("a range charted by week still counts this week's days that are over", () => {
  // Thursday 22 Oct, All time from Atlantis's first sheet day: charted by
  // week, so the headline once stopped at Sunday 18 Oct ($142.20, 2
  // bookings). The days are what count: 7-21 Oct, $370.65 for 6.
  const all = periodOf("all", "2026-10-22", "2026-09-03");
  const weekly = (Date.parse(all.to) - Date.parse(all.from)) / 86400_000 > 45;
  expect(weekly).toBe(true);
  const atlantis = cpbCard(
    ATLANTIS_SPEND,
    ATLANTIS_BOOKED,
    all.from,
    all.to,
    "2026-10-22",
  );
  expect(atlantis.pair.days).toEqual({ from: "2026-10-07", to: "2026-10-21" });
  expect(atlantis.head.text).toBe("$61.78");
  expect(atlantis.head.basis).toBe("7–21 Oct · $371 spent · 6 bookings");
  // Khalida, All time from 28 Jul: she booked on 20 Oct. Cut at the Sunday
  // she read "No bookings yet" on $80.
  const khalidaSpend: Spend[] = [
    ["2026-10-14", 15.65],
    ["2026-10-15", 32.63],
    ["2026-10-16", 0.91],
    ["2026-10-17", 19.43],
    ["2026-10-18", 11.65],
    ["2026-10-20", 11.35],
    ["2026-10-21", 34.63],
  ].map(([date, spend]) => ({ date: String(date), spend: Number(spend) }));
  const khalidaBooked: Appt[] = [
    "2026-07-28",
    "2026-07-28",
    "2026-08-02",
    "2026-08-02",
    "2026-08-03",
    "2026-08-10",
    "2026-08-18",
    "2026-09-01",
    "2026-10-20",
  ].map(date => ({ date, booked: true }));
  const kAll = periodOf("all", "2026-10-22", "2026-07-28");
  const khalida = cpbCard(
    khalidaSpend,
    khalidaBooked,
    kAll.from,
    kAll.to,
    "2026-10-22",
  );
  // $126.25: whole dollars from $100, as the card always showed them.
  expect(khalida.head.text).toBe("$126");
  expect(khalida.head.tone).toBe("bad");
  expect(khalida.head.basis).toBe("14–21 Oct · $126 spent · 1 booking");
});

test("no booking after more than $60 of spend is bad, with the spend named", () => {
  // Alkhalil, 14 to 20 Oct: $233.36 spent and nothing booked. The CEO's rule,
  // the board and the diagnosis read it as bad: "None on $233" (R15).
  const alkhalil: Spend[] = [
    ["2026-10-14", 22.33],
    ["2026-10-15", 39.81],
    ["2026-10-16", 51.71],
    ["2026-10-17", 28.14],
    ["2026-10-18", 29.4],
    ["2026-10-19", 20.32],
    ["2026-10-20", 41.65],
  ].map(([date, spend]) => ({ date: String(date), spend: Number(spend) }));
  const booked: Appt[] = [{ date: "2026-10-11", booked: true }];
  const bad = cpbCard(
    alkhalil,
    booked,
    "2026-10-14",
    "2026-10-20",
    "2026-10-21",
  );
  expect(bad.head).toEqual({
    text: "None on $233",
    tone: "bad",
    basis: "14–20 Oct · $233 spent · 0 bookings",
  });
  const html = render(bad.pair.points, bad.head);
  expect(html).toContain("None on $233");
  expect(html).toContain("txt-bad");
  expect(html).not.toContain("No bookings yet");
  // $60 to $80 with nothing booked is a warning, as on the grid's watch row.
  const day = (spend: number): Spend[] => [{ date: "2026-10-15", spend }];
  const watch = cpbCard(day(70), [], "2026-10-14", "2026-10-20", "2026-10-21");
  expect(watch.head.text).toBe("None on $70");
  expect(watch.head.tone).toBe("warn");
  // Cents under $100, judged on the cents shown, as the media buyer's cell.
  const cents = cpbCard(
    day(60.4),
    [],
    "2026-10-14",
    "2026-10-20",
    "2026-10-21",
  );
  expect(cents.head.text).toBe("None on $60.40");
  expect(cents.head.tone).toBe("warn");
  const hair = cpbCard(
    day(60.004),
    [],
    "2026-10-14",
    "2026-10-20",
    "2026-10-21",
  );
  expect(hair.head.text).toBe("No bookings yet");
  expect(hair.head.tone).toBeUndefined();
  // Up to $60 it is too early to judge: no colour.
  const early = cpbCard(day(50), [], "2026-10-14", "2026-10-20", "2026-10-21");
  expect(early.head.text).toBe("No bookings yet");
  expect(early.head.tone).toBeUndefined();
  expect(render(early.pair.points, early.head)).not.toContain("txt-");
  // A figure takes the same bands: $60 is good, $60.62 a warning.
  const one = (spend: number, n: number) =>
    cpbCard(
      day(spend),
      Array(n).fill({ date: "2026-10-15", booked: true }),
      "2026-10-14",
      "2026-10-20",
      "2026-10-21",
    ).head;
  expect(one(120, 2)).toMatchObject({ text: "$60", tone: "good" });
  expect(one(242.48, 4)).toMatchObject({ text: "$60.62", tone: "warn" });
  expect(one(581.1, 1)).toMatchObject({ text: "$581", tone: "bad" });
});

test("no spend found is never $0, and only today names no days", () => {
  // Bookings on the sheet and no ad spend on record: unknown, not $0.
  const unspent = cpbCard(
    [],
    [{ date: "2026-10-15", booked: true }],
    "2026-10-01",
    "2026-10-20",
    "2026-10-21",
  );
  expect(unspent.head.text).toBe("No spend found");
  expect(unspent.head.tone).toBeUndefined();
  expect(render(unspent.pair.points, unspent.head)).not.toContain("$0");
  // Only today so far: nothing complete, so no figure and no days named.
  const today = cpbCard(
    [{ date: "2026-10-21", spend: 20 }],
    [{ date: "2026-10-21", booked: true }],
    "2026-10-21",
    "2026-10-21",
    "2026-10-21",
  );
  expect(today.head).toEqual({ text: "" });
  const html = render(
    today.pair.points.map(p => ({ ...p, partial: true })),
    today.head,
  );
  expect(html).not.toContain("No bookings yet");
  expect(html).not.toContain("21 Oct");
});

test("a sheet that was not read is unknown, never 0 bookings", () => {
  // Never read: a 403 kept no rows (Ideal Elite), or no sheet at all.
  const failed = sheetCoverage(
    { error: "Performance sheet unavailable (403)." },
    undefined,
    "2026-10-22",
  );
  expect(failed.read).toBe(false);
  expect(failed.why).toContain("unknown, not zero");
  expect(sheetCoverage(undefined, undefined, "2026-10-22").read).toBe(false);
  expect(
    sheetCoverage({ appointments: [], error: "x" }, 1, "2026-10-22").read,
  ).toBe(false);
  // Read today: the sheet holds every complete day.
  const fresh = sheetCoverage(
    { appointments: [], source: "Appointments tab" },
    Date.parse("2026-10-22T11:05:58Z"),
    "2026-10-22",
  );
  expect(fresh).toEqual({
    read: true,
    from: undefined,
    to: "2026-10-21",
    lastRead: undefined,
  });
  // A read now failing after a good one keeps the old rows with staleAt:
  // bookings after it are unknown. The day of the read was read only in part.
  const stale = sheetCoverage(
    { appointments: [], staleAt: "2026-10-10", staleReason: "403" },
    Date.parse("2026-10-10T09:00:00Z"),
    "2026-10-21",
  );
  expect(stale).toMatchObject({
    read: true,
    to: "2026-10-09",
    lastRead: "2026-10-10",
  });
  // This month: spend to 20 Oct, bookings only to 9 Oct. Both sides stop
  // there, so the spend after it is not divided by no bookings.
  const daily = (from: string, days: number, each: number): Spend[] =>
    Array.from({ length: days }, (_, i) => ({
      date: new Date(Date.parse(`${from}T00:00:00Z`) + i * 86400_000)
        .toISOString()
        .slice(0, 10),
      spend: each,
    }));
  const month = cpbCard(
    daily("2026-10-01", 20, 30),
    [
      { date: "2026-10-03", booked: true },
      { date: "2026-10-08", booked: true },
    ],
    "2026-10-01",
    "2026-10-21",
    "2026-10-21",
    stale,
  );
  expect(month.pair.days).toEqual({ from: "2026-10-01", to: "2026-10-09" });
  expect(month.head.text).toBe("$135");
  expect(month.pair.points.some(p => p.x > "2026-10-09")).toBe(false);
  // A range wholly after the last read: nothing to pair, never "0 bookings".
  const after = cpbCard(
    daily("2026-10-14", 7, 30),
    [],
    "2026-10-14",
    "2026-10-20",
    "2026-10-21",
    stale,
  );
  expect(after.pair.noBottom).toBe(true);
  expect(after.pair.days).toBeUndefined();
  expect(after.head.text).toBe("");
  // Month tabs hold this month's and last month's tabs only, counted from
  // the day of the read: bookings before 1 Sep are not on record.
  const tabs = sheetCoverage(
    { appointments: [], source: "month tabs" },
    Date.parse("2026-10-22T11:05:58Z"),
    "2026-10-22",
  );
  expect(tabs.from).toBe("2026-09-01");
  const summer = cpbCard(
    daily("2026-07-01", 100, 30),
    [],
    "2026-07-01",
    "2026-08-31",
    "2026-10-22",
    tabs,
  );
  expect(summer.pair.noBottom).toBe(true);
  expect(summer.head.text).not.toBe("No bookings yet");
});

test("the show rate headline is the span's attended over decided, as a percentage", () => {
  const appts: Appt[] = [
    { date: "2026-10-01", booked: true, show: "y" },
    { date: "2026-10-02", booked: true, show: "n" },
    ...Array(4).fill({ date: "2026-10-03", booked: true, show: "y" }),
    ...Array(4).fill({ date: "2026-10-03", booked: true, show: "n" }),
    { date: "2026-10-04", booked: true, show: "y" },
  ];
  const pair = pairedFromRecord(
    appts,
    appts,
    "2026-10-01",
    "2026-10-04",
    "2026-10-04",
    rows => rows.filter(r => r.show === "y").length,
    rows => rows.filter(r => r.show === "y" || r.show === "n").length,
  );
  const head = ratioHead(pair, {
    unit: "%",
    none: "No outcomes yet",
    parts: (n, d) => `${n} of ${d} with an outcome attended`,
  });
  expect(head.text).toBe("50%");
  expect(head.basis).toBe("1–3 Oct · 5 of 10 with an outcome attended");
  expect(ratioHeadline(pair.points, 100)?.value).toBeCloseTo(54.5, 1);
  expect(ratioHeadline([{ x: "a", y: null, num: 0, den: 0 }], 100)?.value).toBe(
    null,
  );
  // Not a ratio: no parts on the points.
  expect(ratioHeadline([{ x: "a", y: 3 }])).toBeNull();
});

test("a card pools its points only when its caller names the days", () => {
  // The overview's "Cost per lead, last 90 days" once pooled 90 days with no
  // days named, so a CSM read the pool as the last day (review finding 4).
  const points: TrendPoint[] = [
    { x: "2026-10-19", y: 12, num: 120, den: 10 },
    { x: "2026-10-20", y: 9.2, num: 46, den: 5 },
    { x: "2026-10-21", y: 5, num: 10, den: 2, partial: true },
  ];
  const card = (head?: Headline) =>
    renderToStaticMarkup(
      createElement(TrendChart, {
        title: "Cost per lead, last 90 days",
        points,
        unit: "$",
        mode: "avg",
        head,
      }),
    );
  const bare = card();
  expect(bare).toContain(">$9.20<");
  expect(bare).not.toContain("$11.07");
  const pool = ratioHeadline(points);
  const named = card(
    ratioHead(
      {
        days: { from: "2026-10-19", to: "2026-10-20" },
        total: pool ? { num: pool.num, den: pool.den } : undefined,
      },
      {
        unit: "$",
        none: "No leads yet",
        parts: (n, d) => `$${Math.round(n)} spent · ${d} leads`,
      },
    ),
  );
  expect(named).toContain(">$11.07<");
  expect(named).toContain("19–20 Oct · $166 spent · 15 leads");
});

test("spans read as days, and complete days end yesterday whatever the buckets", () => {
  expect(spanLabel("2026-10-01", "2026-10-20")).toBe("1–20 Oct");
  expect(spanLabel("2026-09-28", "2026-10-04")).toBe("28 Sep – 4 Oct");
  expect(spanLabel("2026-10-20", "2026-10-20")).toBe("20 Oct");
  expect(spanLabel("2025-12-24", "2026-01-03")).toBe(
    "24 Dec 2025 – 3 Jan 2026",
  );
  // Wednesday 21 Oct: to yesterday, even on a range charted by week.
  expect(completeDays("2026-10-01", "2026-10-21", "2026-10-21")).toEqual({
    from: "2026-10-01",
    to: "2026-10-20",
  });
  expect(completeDays("2026-07-24", "2026-10-21", "2026-10-21")).toEqual({
    from: "2026-07-24",
    to: "2026-10-20",
  });
  // A period that is over keeps its own end; one that is only today has none.
  expect(completeDays("2026-09-01", "2026-09-30", "2026-10-21")).toEqual({
    from: "2026-09-01",
    to: "2026-09-30",
  });
  expect(
    completeDays("2026-10-21", "2026-10-21", "2026-10-21"),
  ).toBeUndefined();
});

test("half a cent rounds up, and thousands carry a comma", () => {
  // SAFAD, 14 to 20 Oct: $15.71 for 2 bookings, summed from two days.
  const safad = cpbCard(
    [
      { date: "2026-10-14", spend: 8.62 },
      { date: "2026-10-15", spend: 7.09 },
    ],
    [
      { date: "2026-10-15", booked: true },
      { date: "2026-10-15", booked: true },
    ],
    "2026-10-14",
    "2026-10-20",
    "2026-10-21",
  );
  expect(safad.head.text).toBe("$7.86");
  // Atlantis's true 90 days: $1,591.50 for one booking reads with a comma.
  const big = cpbCard(
    [{ date: "2026-10-15", spend: 1591.5 }],
    [{ date: "2026-10-15", booked: true }],
    "2026-10-14",
    "2026-10-20",
    "2026-10-21",
  );
  expect(big.head.text).toBe("$1,592");
});

test("the cost per booking card names both of its sources", async () => {
  // The sheet's bookings and the listed campaigns' spend can differ from the
  // Client Performance board (GoHighLevel bookings, whole ad account): the
  // card says so, so the gap reads as two sources, not an error (2026-10-22).
  const { readFileSync } = await import("node:fs");
  const page = readFileSync(
    new URL("../src/pages/ClientPerformancePage.tsx", import.meta.url),
    "utf8",
  );
  expect(page).toContain(
    "Bookings are from the client's own sheet and spend is from the campaigns the cockpit still lists for them",
  );
  expect(page).toContain(
    "which counts GoHighLevel bookings against the whole ad account.",
  );
});
