import { CPB_GATE } from "@/lib/kpi";

/**
 * Next month's plan worked out from a few inputs.
 *
 * Aziz, 2026-10-02: "the cost per lead automatically tells me how many leads
 * I get from that ad spend. It automatically calculates and helps me put the
 * projections and goals for the next month easily. Like backend, frontend,
 * and average order value from the frontend... call centers' main metric
 * should be lead to booking... depending on client results."
 *
 * A plan is a chain. Spend buys leads at a cost per lead, leads book at a
 * rate, bookings show, live demos close, a client is worth an average order,
 * and part of that is collected in the month. So the inputs are the spend,
 * the costs and the rates, and every count is worked out from them. Counts
 * typed one by one drift apart: September's plan had 583 leads against $6,600
 * at $10 a lead, which is 660.
 *
 * The client side is the same chain with the call centre in the middle: new
 * client leads book at the call centre's lead to booking, and a booking costs
 * the cost per lead over that rate. That is how the two gates meet: $15 a lead
 * at 25% is $60 a booking.
 *
 * An input left empty is not zero: whatever depends on it stays empty. The
 * only exceptions are lines that add up (upsells, retargeting, payroll,
 * overhead), where an empty box plans nothing and the screen shows the $0.
 */

export type DriverKey =
  | "spend"
  | "cpl"
  | "qualifiedShare"
  | "leadToBooked"
  | "introShowRate"
  | "introToDemo"
  | "demoShowRate"
  | "qualifiedDemoShare"
  | "closeRate"
  | "aov"
  | "cashShare"
  | "spendRetargeting"
  | "mrrDue"
  | "mrrCollectionRate"
  | "upsellCash"
  | "labour"
  | "overhead"
  | "feeRate"
  | "callLeads"
  | "callLeadToBooking"
  | "clientCpl";

export type Drivers = Record<DriverKey, number | null>;

export type DriverUnit = "usd" | "rate" | "count";

/**
 * What each input is. `better` says which way "a tenth better" moves it; a
 * budget (spend, payroll, MRR due, how many leads arrive) is a decision, not a
 * performance, so it has none.
 */
export const DRIVERS: Record<
  DriverKey,
  { unit: DriverUnit; better: "up" | "down" | null }
> = {
  spend: { unit: "usd", better: null },
  cpl: { unit: "usd", better: "down" },
  qualifiedShare: { unit: "rate", better: "up" },
  leadToBooked: { unit: "rate", better: "up" },
  introShowRate: { unit: "rate", better: "up" },
  introToDemo: { unit: "rate", better: "up" },
  demoShowRate: { unit: "rate", better: "up" },
  qualifiedDemoShare: { unit: "rate", better: "up" },
  closeRate: { unit: "rate", better: "up" },
  aov: { unit: "usd", better: "up" },
  cashShare: { unit: "rate", better: "up" },
  spendRetargeting: { unit: "usd", better: null },
  mrrDue: { unit: "usd", better: null },
  mrrCollectionRate: { unit: "rate", better: "up" },
  upsellCash: { unit: "usd", better: null },
  labour: { unit: "usd", better: null },
  overhead: { unit: "usd", better: null },
  feeRate: { unit: "rate", better: "down" },
  callLeads: { unit: "count", better: null },
  callLeadToBooking: { unit: "rate", better: "up" },
  clientCpl: { unit: "usd", better: "down" },
};

export const DRIVER_KEYS = Object.keys(DRIVERS) as DriverKey[];

const ok = (v: number | null | undefined): v is number =>
  typeof v === "number" && Number.isFinite(v);
const times = (...xs: (number | null | undefined)[]): number | null =>
  xs.every(ok) ? (xs as number[]).reduce((a, b) => a * b, 1) : null;
const over = (
  a: number | null | undefined,
  b: number | null | undefined,
): number | null => (ok(a) && ok(b) && b > 0 ? a / b : null);
/** A line that adds up: empty parts plan nothing; all empty is no number. */
const plus = (...xs: (number | null | undefined)[]): number | null =>
  xs.some(ok) ? xs.reduce<number>((n, x) => n + (ok(x) ? x : 0), 0) : null;

export type Projection = {
  leads: number | null;
  bookableLeads: number | null;
  introsBooked: number | null;
  introsShown: number | null;
  demosBooked: number | null;
  demosShown: number | null;
  demosQualified: number | null;
  closes: number | null;
  contracted: number | null;
  newCash: number | null;
  costPerBookableLead: number | null;
  costPerIntroBooked: number | null;
  costPerIntroShown: number | null;
  costPerDemoBooked: number | null;
  costPerDemoShown: number | null;
  cac: number | null;
  roasContracted: number | null;
  backEndCash: number | null;
  totalCash: number | null;
  processingFees: number | null;
  moneyOut: number | null;
  profit: number | null;
  margin: number | null;
  callBookings: number | null;
  clientCpb: number | null;
  /** The lead to booking that holds the $60 booking at this cost per lead. */
  leadToBookingForGate: number | null;
};

export function project(d: Drivers): Projection {
  const leads = over(d.spend, d.cpl);
  const introsBooked = times(leads, d.leadToBooked);
  const introsShown = times(introsBooked, d.introShowRate);
  const demosBooked = times(introsShown, d.introToDemo);
  const demosShown = times(demosBooked, d.demoShowRate);
  const closes = times(demosShown, d.closeRate);
  const contracted = times(closes, d.aov);
  const newCash = times(contracted, d.cashShare);
  const backEndCash = times(d.mrrDue, d.mrrCollectionRate);
  const totalCash =
    newCash === null && backEndCash === null
      ? null
      : plus(newCash, backEndCash, d.upsellCash);
  const processingFees = times(totalCash, d.feeRate);
  const moneyOut = plus(
    d.spend,
    d.spendRetargeting,
    d.labour,
    d.overhead,
    processingFees,
  );
  const profit =
    totalCash !== null && moneyOut !== null ? totalCash - moneyOut : null;
  return {
    leads,
    bookableLeads: times(leads, d.qualifiedShare),
    introsBooked,
    introsShown,
    demosBooked,
    demosShown,
    demosQualified: times(demosShown, d.qualifiedDemoShare),
    closes,
    contracted,
    newCash,
    costPerBookableLead: over(d.spend, times(leads, d.qualifiedShare)),
    costPerIntroBooked: over(d.spend, introsBooked),
    costPerIntroShown: over(d.spend, introsShown),
    costPerDemoBooked: over(d.spend, demosBooked),
    costPerDemoShown: over(d.spend, demosShown),
    cac: over(d.spend, closes),
    roasContracted: over(contracted, d.spend),
    backEndCash,
    totalCash,
    processingFees,
    moneyOut,
    profit,
    margin: over(profit, totalCash),
    callBookings: times(d.callLeads, d.callLeadToBooking),
    clientCpb: over(d.clientCpl, d.callLeadToBooking),
    leadToBookingForGate: over(d.clientCpl, CPB_GATE),
  };
}

/** Numbers by metric key: a plan's targets, or what was measured. */
export type ByKey = Record<string, number | null | undefined>;

/**
 * The inputs a plan's own targets imply. A rate the plan names is taken as
 * it is; one it does not name is read off the counts around it, so last
 * month's 107 demos from 177 intros shown is a 60% intro-to-demo rate.
 */
export function driversFromTargets(t: ByKey): Drivers {
  return {
    spend: t.spend ?? null,
    cpl: t.cpl ?? over(t.spend, t.leads),
    qualifiedShare: over(t.bookableLeads, t.leads),
    leadToBooked: t.leadToBooked ?? over(t.introsBooked, t.leads),
    introShowRate: t.introShowRate ?? over(t.introsShown, t.introsBooked),
    introToDemo: over(t.demosBooked, t.introsShown),
    demoShowRate: t.demoShowRate ?? over(t.demosShown, t.demosBooked),
    qualifiedDemoShare: over(t.demosQualified, t.demosShown),
    closeRate: t.closeRate ?? over(t.closes, t.demosShown),
    aov: t.aov ?? over(t.contracted, t.closes),
    cashShare: over(t.newCash, t.contracted),
    spendRetargeting: t.spendRetargeting ?? null,
    mrrDue: t.mrrProjected ?? over(t.backEndCash, t.mrrCollectionRate),
    mrrCollectionRate: t.mrrCollectionRate ?? null,
    upsellCash: t.upsellCash ?? null,
    labour: t.labour ?? null,
    overhead: t.overhead ?? null,
    feeRate: over(t.processingFees, t.totalCash),
    callLeads: t.callLeads ?? null,
    // Combined: the typed client lead to booking is the same number, so a
    // plan from before the call centre's was measured hands its target on.
    callLeadToBooking: t.callLeadToBooking ?? t.clientLeadToBooking ?? null,
    clientCpl: t.clientCpl ?? null,
  };
}

/**
 * The inputs what really happened implies. `share` is how much of the
 * period's working days the numbers cover: a budget or an arrival count
 * measured over part of a month is grown to the whole month, a rate is not.
 * Where nothing was measured, the plan's own input stands.
 */
export function driversFromActuals(
  m: ByKey,
  share: number,
  fallback: Drivers,
): Drivers {
  const whole = (v: number | null | undefined) =>
    ok(v) && share > 0 ? v / Math.min(1, share) : null;
  const pick = (v: number | null | undefined, key: DriverKey) =>
    ok(v) ? v : fallback[key];
  return {
    spend: pick(whole(m.spend), "spend"),
    cpl: pick(m.cpl, "cpl"),
    qualifiedShare: pick(over(m.bookableLeads, m.leads), "qualifiedShare"),
    leadToBooked: pick(m.leadToBooked, "leadToBooked"),
    introShowRate: pick(m.introShowRate, "introShowRate"),
    introToDemo: pick(over(m.demosBooked, m.introsShown), "introToDemo"),
    demoShowRate: pick(m.demoShowRate, "demoShowRate"),
    qualifiedDemoShare: pick(
      over(m.demosQualified, m.demosShown),
      "qualifiedDemoShare",
    ),
    closeRate: pick(m.closeRate, "closeRate"),
    aov: pick(m.aov, "aov"),
    cashShare: pick(over(m.newCash, m.contracted), "cashShare"),
    spendRetargeting: pick(whole(m.spendRetargeting), "spendRetargeting"),
    mrrDue: pick(m.mrrProjected, "mrrDue"),
    mrrCollectionRate: pick(m.mrrCollectionRate, "mrrCollectionRate"),
    upsellCash: fallback.upsellCash,
    labour: fallback.labour,
    overhead: fallback.overhead,
    feeRate: fallback.feeRate,
    callLeads: pick(whole(m.callLeads), "callLeads"),
    callLeadToBooking: pick(m.callLeadToBooking, "callLeadToBooking"),
    clientCpl: pick(m.clientCpl, "clientCpl"),
  };
}

/** Every performance input moved a tenth the right way; budgets stay put. */
export function aTenthBetter(d: Drivers): Drivers {
  const out = { ...d };
  for (const key of DRIVER_KEYS) {
    const v = d[key];
    const { better, unit } = DRIVERS[key];
    if (!ok(v) || !better) continue;
    const moved = better === "up" ? v * 1.1 : v * 0.9;
    out[key] = unit === "rate" && better === "up" ? Math.min(1, moved) : moved;
  }
  return out;
}

/** How a target is written: counts whole, dollars to the cent under $100, rates to a tenth of a point. */
export function tidy(v: number, unit: string): number {
  if (unit === "rate") return Math.round(v * 1000) / 1000;
  if (unit === "usd")
    return Math.abs(v) < 100 ? Math.round(v * 100) / 100 : Math.round(v);
  if (unit === "x") return Math.round(v * 10) / 10;
  return Math.round(v);
}

/** The plan's targets the model sets, by metric key, with how each came about. */
export type ModelTarget = { key: string; value: number; how: string | null };

/**
 * Metrics the model always writes into a new plan, whether or not the last
 * plan had them: lead to booking on both sides, the call centre's leads and
 * bookings, a client booking's cost, and the MRR the back end is collecting.
 */
export const ALWAYS = new Set([
  "leadToBooked",
  "callLeads",
  "callLeadToBooking",
  "callBookings",
  "clientCpb",
  "mrrProjected",
]);

/** Replaced by a measured number the model writes instead. */
export const REPLACED: Record<string, string> = {
  clientLeadToBooking: "callLeadToBooking",
};

type Say = {
  money: (v: number) => string;
  count: (v: number) => string;
  pct: (v: number) => string;
};

/**
 * The targets, each with a short sentence saying how it was worked out, so
 * the plan explains its own numbers on the board.
 */
export function modelTargets(
  d: Drivers,
  p: Projection,
  say: Say,
): ModelTarget[] {
  const $ = (v: number | null) => (ok(v) ? say.money(v) : "?");
  const n = (v: number | null) => (ok(v) ? say.count(v) : "?");
  const r = (v: number | null) => (ok(v) ? say.pct(v) : "?");
  const rows: [string, number | null, string | null][] = [
    ["spend", d.spend, null],
    ["spendRetargeting", d.spendRetargeting, null],
    ["leads", p.leads, `${$(d.spend)} at ${$(d.cpl)} a lead.`],
    ["cpl", d.cpl, null],
    [
      "bookableLeads",
      p.bookableLeads,
      `${r(d.qualifiedShare)} of ${n(p.leads)} leads.`,
    ],
    ["costPerBookableLead", p.costPerBookableLead, null],
    ["leadToBooked", d.leadToBooked, null],
    [
      "introsBooked",
      p.introsBooked,
      `${n(p.leads)} leads booking at ${r(d.leadToBooked)}.`,
    ],
    ["costPerIntroBooked", p.costPerIntroBooked, null],
    ["introShowRate", d.introShowRate, null],
    [
      "introsShown",
      p.introsShown,
      `${n(p.introsBooked)} intros showing at ${r(d.introShowRate)}.`,
    ],
    ["costPerIntroShown", p.costPerIntroShown, null],
    [
      "demosBooked",
      p.demosBooked,
      `${r(d.introToDemo)} of ${n(p.introsShown)} intros held book a demo.`,
    ],
    ["costPerDemoBooked", p.costPerDemoBooked, null],
    ["demoShowRate", d.demoShowRate, null],
    [
      "demosShown",
      p.demosShown,
      `${n(p.demosBooked)} demos showing at ${r(d.demoShowRate)}.`,
    ],
    ["costPerDemoShown", p.costPerDemoShown, null],
    [
      "demosQualified",
      p.demosQualified,
      `${r(d.qualifiedDemoShare)} of ${n(p.demosShown)} live demos.`,
    ],
    ["closeRate", d.closeRate, null],
    [
      "closes",
      p.closes,
      `${n(p.demosShown)} live demos closing at ${r(d.closeRate)}.`,
    ],
    ["cac", p.cac, null],
    ["contracted", p.contracted, `${n(p.closes)} clients at ${$(d.aov)}.`],
    ["aov", d.aov, null],
    [
      "newCash",
      p.newCash,
      `${r(d.cashShare)} of ${$(p.contracted)} contracted, collected in the month.`,
    ],
    ["roasContracted", p.roasContracted, null],
    ["mrrProjected", d.mrrDue, null],
    ["mrrCollectionRate", d.mrrCollectionRate, null],
    [
      "backEndCash",
      p.backEndCash,
      `${r(d.mrrCollectionRate)} of ${$(d.mrrDue)} MRR due.`,
    ],
    [
      "mrrCollected",
      p.backEndCash,
      `${r(d.mrrCollectionRate)} of ${$(d.mrrDue)} MRR due.`,
    ],
    ["upsellCash", d.upsellCash, null],
    ["totalCash", p.totalCash, "New-client cash, back-end cash and upsells."],
    ["labour", d.labour, null],
    ["overhead", d.overhead, null],
    [
      "processingFees",
      p.processingFees,
      `${r(d.feeRate)} of ${$(p.totalCash)} collected.`,
    ],
    [
      "moneyOut",
      p.moneyOut,
      "Ad spend, retargeting, payroll, overhead and processing fees.",
    ],
    ["profit", p.profit, `${$(p.totalCash)} in, ${$(p.moneyOut)} out.`],
    ["margin", p.margin, null],
    ["callLeads", d.callLeads, null],
    ["callLeadToBooking", d.callLeadToBooking, null],
    [
      "callBookings",
      p.callBookings,
      `${n(d.callLeads)} client leads booking at ${r(d.callLeadToBooking)}.`,
    ],
    ["clientCpl", d.clientCpl, null],
    [
      "clientCpb",
      p.clientCpb,
      `${$(d.clientCpl)} a lead over ${r(d.callLeadToBooking)} lead to booking.`,
    ],
  ];
  return rows
    .filter((x): x is [string, number, string | null] => ok(x[1]))
    .map(([key, value, how]) => ({ key, value, how }));
}

/** The metric keys the model can set; a plan row with one of these is the model's. */
export const MODEL_KEYS = new Set(
  modelTargets(
    Object.fromEntries(DRIVER_KEYS.map(k => [k, 1])) as Drivers,
    project(Object.fromEntries(DRIVER_KEYS.map(k => [k, 1])) as Drivers),
    { money: String, count: String, pct: String },
  ).map(t => t.key),
);
