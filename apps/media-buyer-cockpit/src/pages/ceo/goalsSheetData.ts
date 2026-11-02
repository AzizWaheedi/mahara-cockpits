import { money, shortDate } from "@/components/ceo/format";
import type { SheetContext } from "@/lib/ceoGoalSheetClient";
import type { DriverKey } from "./goalsModel";
import { modelTargets, REPLACED, tidy } from "./goalsModel";
import {
  addDays,
  allColumns,
  boardLabelOf,
  COLUMN_BY_KEY,
  type CustomMetric,
  type DayParts,
  dayRow,
  daysOfMonth,
  isWorkingDay,
  lifecycleDayParts,
  lifecycleOf,
  type PlanInputs,
  paceFor,
  partsOf,
  planNumbers,
  type Revenue,
  revenueOf,
  rollUp,
  SHEET_COLUMNS,
  SHEET_SECTIONS,
  type SheetColumn,
  sectionOf,
  shiftMonth,
  unknownFlag,
  unknownOn,
  withComputed,
  writesTarget,
} from "./goalsSheetModel";

/**
 * From the server's answer to what one tab of the sheet draws: the measured
 * parts of each day, the typed cells, and the month-level numbers that do not
 * divide by day. Pure, so the rows can be tested against real numbers.
 *
 * Round 2 (2026-11-02, hw-notes/goals-sheet/SPEC-ROUND2.md): every number
 * from its system of record. The CEO: "leads, I would get them from the CRM
 * ... make this one the main source of truth so everything else ties into
 * it." So the wins ledger, the refunds, the closer's EOD, the billing log, the
 * month's software point, the back-end book, front-end cash by month and the
 * clients' CRM ad leads fill the columns that were typed or read loosely.
 * Each of those reads is new on the server (migration 20261102m and the CEO
 * refresh release goal1102): absent on an older server, null when its store
 * was not read. Absent, a column reads as it did, or reads missing with the
 * reason beside it; never a zero it did not read.
 */

const num = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
};

const isObj = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const dayOf = (v: unknown): string | null =>
  typeof v === "string" && DAY.test(v.slice(0, 10)) ? v.slice(0, 10) : null;

/** "October 2026". */
function monthWords(m: string): string {
  return new Date(`${m}-01T00:00:00Z`).toLocaleString("en", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export type SheetData = {
  month: string;
  days: string[];
  columns: SheetColumn[];
  measured: Record<string, DayParts>;
  typed: Record<string, Record<string, number>>;
  plan: Record<string, Record<string, number>>;
  facts: DayParts;
  prevFacts: DayParts;
  through: string | null;
  workingDays: number;
  workedSoFar: number;
  /** Kuwait's today, as the server said it. */
  today: string;
  /** Why a part has no number for a whole month, by month ("YYYY-MM") and part. */
  monthWhy: Record<string, Record<string, string>>;
  /** Why a part is empty, or not known, on a day: by day and part. */
  dayWhy: Record<string, Record<string, string>>;
  /** The server's sentences for reads that are not live or failed; null from a server older than 20261102m. */
  readsMissing: string[] | null;
  /** Money in the CEO left out of the daily cash in, by day, for revenue's note. */
  cashExcluded: { date: string; usd: number; what: string }[];
};

/** Whether any measured day of the month carries a number for this part. */
function daysCarry(
  measured: Record<string, DayParts>,
  month: string,
  part: string,
): boolean {
  return Object.entries(measured).some(
    ([day, p]) => day.startsWith(month) && num(p[part]) !== null,
  );
}

/** A store read over a run of days (20261102m): a day inside from..through with no row is 0, a day outside is not known. */
type Ranged = {
  from: string | null;
  through: string | null;
  rows: Record<string, unknown>[];
};

/** The store as the server sent it: undefined from an older server, null when not read, else its days and rows. */
function rangedOf(v: unknown): Ranged | null | undefined {
  if (v === undefined) return undefined;
  if (!isObj(v)) return null;
  return {
    from: dayOf(v.from),
    through: dayOf(v.through),
    rows: Array.isArray(v.rows) ? v.rows.filter(isObj) : [],
  };
}

const inside = (r: Ranged, day: string) =>
  r.from !== null && r.through !== null && day >= r.from && day <= r.through;

/** The worker release that adds a field to the growth series' days, as a reason a day lacks it. */
const RELEASE = "the CEO refresh release of 2 Nov 2026";
const MIGRATION = "the sheet's server update of 2 Nov 2026 (20261102m)";

/**
 * A part the growth series' days gained in the 2 Nov release, with why a day
 * lacks it or holds null. A null day is not known (the contract: "read null
 * as missing, never 0"), so a run over it reads missing with this sentence;
 * before the 2026-11-02 repair it only said so, and the run kept that day's
 * spend over fewer clicks (CPC read high, Unique link clicks low).
 */
const LATE_GROWTH: Record<string, { absent: string; nulled: string }> = {
  uniqueLinkClicks: {
    absent: `Unique link clicks by day wait on ${RELEASE}.`,
    nulled:
      "Meta gave no unique count for an ad that spent that day, so the day is not known, not 0, and any run of days over it reads missing.",
  },
  introsAdvanced: {
    absent: `Intro to demo by day waits on ${RELEASE}.`,
    nulled:
      "That day's intros advanced were not read, so any run of days over it reads missing.",
  },
};

const GROWTH_PARTS = [
  "spend",
  "spendRetargeting",
  "leads",
  "bookedLeads",
  "introsBooked",
  "introsShown",
  "introsDue",
  "demosBooked",
  "demosShown",
  "demosDue",
  "closes",
  "contracted",
];

/** The wins ledger's kinds, as the columns they count in. */
function winPart(kind: string): string | null {
  if (kind.startsWith("upsell_")) return "upsells";
  if (kind === "referral") return "referrals";
  if (kind === "video_testimonial") return "testimonials";
  if (kind === "review") return "googleReviews";
  return null;
}
const WIN_PARTS = ["upsells", "referrals", "testimonials", "googleReviews"];

/** A part a typed day never overrides: its record is the only source (2026-11-02). */
const READ_ONLY_PARTS: ReadonlySet<string> = new Set(["clientsChurned"]);

/** The CEO's reason for leaving a payment out, as a few words for revenue's note. */
function excludedWhat(e: Record<string, unknown>): string {
  if (e.reason === "website") return "a website payment";
  const note = String(e.note ?? "")
    .split(/ \(|: |\. /)[0]
    .trim();
  if (!note) return "a payment the CEO left out";
  return note.charAt(0).toLowerCase() + note.slice(1);
}

/**
 * Builds one tab. Every store is read the same way: inside the days it was
 * read a day with no row is 0; outside them, up to today, the day carries the
 * part's unknown flag and a sentence saying why, so a run over it is missing.
 */
export function buildSheet(ctx: SheetContext): SheetData {
  const month = ctx.month;
  const days = daysOfMonth(month);
  const prev = shiftMonth(month, -1);
  // The context's days: the month before (the rolling rows reach into it) and the month.
  const tabDays = [...daysOfMonth(prev), ...days];
  const today = String(ctx.today);
  const thisMonth = today.slice(0, 7);
  const known = tabDays.filter(d => d <= today);
  const measured: Record<string, DayParts> = {};
  const at = (day: string) => (measured[day] ??= {});
  const dayWhy: Record<string, Record<string, string>> = {};
  const sayDay = (day: string, part: string, why: string) => {
    dayWhy[day] ??= {};
    dayWhy[day][part] = why;
  };
  const notKnown = (day: string, part: string, why: string) => {
    at(day)[unknownFlag(part)] = 1;
    sayDay(day, part, why);
  };
  const raw = ctx as unknown as Record<string, unknown>;

  /** Seeds a ranged store's parts: its rows inside the days read, 0 on a read day with none, not known outside. */
  const seed = (
    store: Ranged | null,
    parts: string[],
    add: (row: Record<string, unknown>) => [string, number][],
    why: (day: string) => string,
  ) => {
    const byDay = new Map<string, Record<string, number>>();
    for (const row of store?.rows ?? []) {
      const day = dayOf(row.date);
      // A row dated outside the days read is not counted: that day is not known (20261102m's rule).
      if (!day || !store || !inside(store, day)) continue;
      const into = byDay.get(day) ?? {};
      for (const [part, v] of add(row)) into[part] = (into[part] ?? 0) + v;
      byDay.set(day, into);
    }
    for (const day of known) {
      if (store && inside(store, day)) {
        const p = at(day);
        for (const part of parts) p[part] = round2(byDay.get(day)?.[part] ?? 0);
      } else for (const part of parts) notKnown(day, part, why(day));
    }
  };

  // --- The growth series: the funnel, the deal ledger's new cash. ---
  for (const d of ctx.growthDaily) {
    const day = dayOf(d.date);
    if (!day) continue;
    const p = at(day);
    for (const k of GROWTH_PARTS) p[k] = num(d[k]);
    p.newCash = num(d.frontEndPaid);
    // Kept apart from a typed Cash collected, so revenue moves only by what was typed.
    p.newCashMeasured = p.newCash;
    for (const [k, why] of Object.entries(LATE_GROWTH)) {
      if (!(k in d)) {
        notKnown(day, k, why.absent);
        continue;
      }
      p[k] = num(d[k]);
      // Not known, never a smaller total (repair 2026-11-02): with only a
      // sentence, a month over a null day kept its spend and dropped its
      // clicks, so CPC read high against its target.
      if (p[k] === null) notKnown(day, k, why.nulled);
    }
  }

  // --- Money in, the base of Total revenue (fix 1). ---
  const refundsStore = rangedOf(raw.refundsDaily);
  const lastKnown = [days[days.length - 1], today].sort()[0];
  const cashRead: Ranged | null =
    refundsStore !== undefined
      ? // 20261102m: the money refresh's rows were read over the refunds' days (the same rows).
        refundsStore?.from
        ? { ...refundsStore, rows: [] }
        : null
      : ctx.book
        ? // An older server: the money was read when the book is there, over the context's days.
          { from: tabDays[0], through: lastKnown, rows: [] }
        : null;
  const cashByDay = new Map<string, number>();
  for (const c of ctx.cashDaily ?? []) {
    const day = dayOf(c.date);
    const usd = num(c.usd);
    if (day && usd !== null)
      cashByDay.set(day, (cashByDay.get(day) ?? 0) + usd);
  }
  seed(
    cashRead === null
      ? null
      : {
          ...cashRead,
          rows: [...cashByDay].map(([date, usd]) => ({ date, usd })),
        },
    ["cashIn"],
    row => [["cashIn", num(row.usd) ?? 0]],
    () =>
      cashRead === null
        ? "Money in was not read: the money refresh has no rows."
        : `Money in was read from ${shortDate(cashRead.from)} to ${shortDate(cashRead.through)}; this day is outside it.`,
  );
  const cashExcluded = Array.isArray(raw.cashExcluded)
    ? (raw.cashExcluded as unknown[]).filter(isObj).flatMap(e => {
        const date = dayOf(e.date);
        const usd = num(e.usd);
        return date && usd !== null
          ? [{ date, usd, what: excludedWhat(e) }]
          : [];
      })
    : [];

  // --- Refunds (fix 5): count, amount, and the hand-logged part revenue takes off. ---
  const refundParts = ["refunds", "refundAmount", "refundsManual"];
  if (refundsStore !== undefined)
    seed(
      refundsStore,
      refundParts,
      row => [
        ["refunds", num(row.count) ?? 0],
        ["refundAmount", num(row.usd) ?? 0],
        ["refundsManual", num(row.manualUsd) ?? 0],
      ],
      () =>
        refundsStore === null || !refundsStore.from
          ? "Refunds were not read this time."
          : `Refunds were read from ${shortDate(refundsStore.from)} to ${shortDate(refundsStore.through)} (the money refresh's window); this day is outside it.`,
    );
  else
    for (const day of known)
      notKnown(
        day,
        "refundsManual",
        `Refunds logged by hand, by day, wait on ${MIGRATION}, so revenue is not known yet.`,
      );

  // --- The wins ledger (fix 5): wins, upsell cash, upsells contracted. ---
  const ledgerWhy = (day: string, what: string, todo: string) =>
    day < "2026-11-02"
      ? `The wins ledger opened on 2 Nov 2026, so ${what} on a day before it are not known. ${todo}`
      : `The wins ledger was not read for this day, so ${what} are not known.`;
  const wins = rangedOf(raw.winsDaily);
  if (wins !== undefined)
    seed(
      wins,
      WIN_PARTS,
      row => {
        const part = winPart(String(row.kind ?? ""));
        return part ? [[part, num(row.count) ?? 0]] : [];
      },
      day =>
        ledgerWhy(day, "wins", "Type the day's count to complete the month."),
    );
  const upsellCash = rangedOf(raw.upsellCashDaily);
  if (upsellCash !== undefined)
    seed(
      upsellCash,
      ["upsellCash"],
      row => [["upsellCash", num(row.usd) ?? 0]],
      day =>
        ledgerWhy(
          day,
          "upsell payments",
          "Type the day's upsell cash to complete the month.",
        ),
    );
  const upsellContracted = rangedOf(raw.upsellContracted);
  if (upsellContracted !== undefined)
    seed(
      upsellContracted,
      ["upsellContracted"],
      row => [["upsellContracted", num(row.usd) ?? 0]],
      day =>
        ledgerWhy(
          day,
          "upsells contracted",
          "Type 0 in Upsells for a day with none and its upsells contracted are 0 too.",
        ),
    );
  else
    for (const day of known)
      notKnown(
        day,
        "upsellContracted",
        `Upsells contracted (their quoted price) wait on ${MIGRATION}, so Total contracted is not known yet.`,
      );

  // --- Extensions (fix 4): the billing log by day; a typed day replaces it. ---
  const extensions = rangedOf(raw.extensionsDaily);
  const logFrom = "2026-09-23";
  if (extensions !== undefined)
    seed(
      extensions,
      ["extensionsGiven"],
      row => [["extensionsGiven", num(row.count) ?? 0]],
      day =>
        day < logFrom
          ? "The billing log began on 23 Sep 2026, so extensions on a day before it are not known. Type the day's count if you know it."
          : "Extensions were not read for this day.",
    );
  else {
    // An older server: the month's grants only (20261101q), read from the
    // billing log's first day on; the month before is not in that list.
    const life = lifecycleOf(ctx);
    if (life?.extensions) {
      const grants = lifecycleDayParts(life);
      for (const day of known) {
        if (day.startsWith(month) && day >= logFrom)
          at(day).extensionsGiven = num(grants[day]?.extensionsGiven) ?? 0;
        else
          notKnown(
            day,
            "extensionsGiven",
            day < logFrom
              ? "The billing log began on 23 Sep 2026, so extensions on a day before it are not known."
              : `Extensions in the month before wait on ${MIGRATION}.`,
          );
      }
    }
  }

  // --- Offers made (fix 10): the closer's EOD fills each day; a typed day wins. ---
  const eods = raw.salesEodDaily;
  if (isObj(eods) && Array.isArray(eods.rows)) {
    const filed = new Map<string, number | null>();
    for (const row of eods.rows.filter(isObj)) {
      const day = dayOf(row.date);
      if (!day) continue;
      const offers = num(row.offers);
      const was = filed.get(day);
      filed.set(day, offers === null ? (was ?? null) : (was ?? 0) + offers);
    }
    for (const day of known) {
      if (!filed.has(day)) {
        sayDay(day, "offersMade", "No closer EOD was filed that day.");
        continue;
      }
      const offers = filed.get(day) ?? null;
      if (offers === null)
        sayDay(
          day,
          "offersMade",
          "The closer's EOD that day has no offers number.",
        );
      else at(day).offersMade = offers;
    }
  }

  // --- Client media buying: the media sync, and client CPL on the CRM (fix 9). ---
  const crm = ctx.deliveryDaily.some(d => isObj(d) && "crmAdLeads" in d);
  for (const d of ctx.deliveryDaily) {
    const day = dayOf(d.date);
    if (!day) continue;
    const p = at(day);
    p.clientSpend = num(d.spend);
    p.clientLeads = num(d.leads);
    p.clientSpendMeasured = num(d.spendMeasured);
    p.clientConfirmed = num(d.confirmed);
    if (!crm) {
      // Before the release: Meta's form leads, and the label says so.
      p.clientCplSpend = p.clientSpend;
      p.clientCplLeads = p.clientLeads;
      continue;
    }
    const leads = num(d.crmAdLeads);
    const spend = num(d.crmSpend);
    if (leads === null || spend === null) {
      sayDay(
        day,
        "clientCplLeads",
        "No client paired with its CRM that day, so it is in neither side.",
      );
      p.clientCplLeftOut = p.clientSpend ?? null;
      continue;
    }
    p.clientCplSpend = spend;
    p.clientCplLeads = leads;
    // Spend that day with no CRM count stored beside it: said, never divided.
    if (p.clientSpend !== null && p.clientSpend !== undefined)
      p.clientCplLeftOut = round2(Math.max(0, p.clientSpend - spend));
  }
  for (const d of ctx.mediaDaily) {
    const day = dayOf(d.date);
    if (!day) continue;
    const p = at(day);
    p.clientSyncSpend = num(d.spend);
    p.clientImpressions = num(d.impressions);
    p.clientLinkClicks = num(d.clicks);
    p.clientSyncLeads = num(d.leads);
  }
  for (const d of ctx.clientDaily) {
    const day = dayOf(d.date);
    if (!day) continue;
    const p = at(day);
    p.leadQualitySum = num(d.qualitySum);
    p.leadQualityCount = num(d.qualityCount);
  }
  for (const d of ctx.callDaily ?? []) {
    const p = at(d.day);
    p.callLeads = d.leads;
    p.callBookings = d.confirmedBookings;
    p.callShows = d.shows;
    p.callNoShows = d.noShow;
    // The report's own closed (fix 12): one system for both sides of the rate.
    p.callCloses = num((d as { closed?: unknown }).closed);
  }

  // --- The churn register: read whole, so a day with nobody leaving is 0. ---
  if (Array.isArray(ctx.churned)) {
    for (const day of known) at(day).clientsChurned = 0;
    for (const d of ctx.churned) {
      const day = dayOf(d.leftOn);
      if (!day) continue;
      const p = at(day);
      p.clientsChurned = (num(p.clientsChurned) ?? 0) + 1;
    }
  }

  const typed: Record<string, Record<string, number>> = {};
  const plan: Record<string, Record<string, number>> = {};
  for (const c of ctx.cells) {
    const into = c.kind === "plan" ? plan : typed;
    if (c.kind !== "plan" && READ_ONLY_PARTS.has(c.key)) continue;
    const day = String(c.day);
    into[day] ??= {};
    into[day][c.key] = Number(c.value);
  }

  const custom: CustomMetric[] = ctx.metrics.map(m => ({
    key: String(m.key),
    label: String(m.label),
    // A metric stored under a section key from before 2026-11-02 keeps its place.
    section: sectionOf(m.section),
    unit: m.unit,
    direction: m.direction,
    rollup: m.rollup,
    note: m.note ?? null,
  }));

  // Numbers run to the newest complete day, as on the Goals board.
  const yesterday = addDays(today, -1);
  const last = days[days.length - 1];
  const through =
    yesterday < days[0] ? null : yesterday < last ? yesterday : last;
  const workingDays = days.filter(isWorkingDay).length;
  const workedSoFar = through
    ? days.filter(d => d <= through && isWorkingDay(d)).length
    : 0;

  const monthWhy: Record<string, Record<string, string>> = {};
  const onDeals: Record<string, number | null> = {};
  const softwareSource: Record<string, string> = {};
  const factsOf = (m: string) =>
    factsFor(ctx, m, measured, typed, {
      thisMonth,
      today,
      why: (part, text) => {
        monthWhy[m] ??= {};
        monthWhy[m][part] = text;
      },
      onDeals: v => {
        onDeals[m] = v;
      },
      software: text => {
        softwareSource[m] = text;
      },
    });
  const facts = factsOf(month);
  const prevFacts = factsOf(prev);

  const columns = allColumns(custom).map(c =>
    tabColumn(c, {
      crm,
      onDeals: onDeals[month],
      software: softwareSource[month],
    }),
  );

  return {
    month,
    days,
    columns,
    measured,
    typed,
    plan,
    facts,
    prevFacts,
    through,
    workingDays,
    workedSoFar,
    today,
    monthWhy,
    dayWhy,
    readsMissing: Array.isArray(raw.readsMissing)
      ? (raw.readsMissing as unknown[]).filter(
          (t): t is string => typeof t === "string" && t.trim() !== "",
        )
      : null,
    cashExcluded,
  };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** A column as this tab reads it: client CPL's leads before the release, the month's left-out MRR and software point. */
function tabColumn(
  c: SheetColumn,
  t: { crm: boolean; onDeals?: number | null; software?: string },
): SheetColumn {
  if (c.custom) return c;
  if (c.key === "clientCpl" && !t.crm)
    return {
      ...c,
      label: "CPL (Meta form leads)",
      source: `Spend on client ad accounts over Meta's form leads, CEO Delivery's number, until ${RELEASE} sends the clients' CRM ad leads; then it reads CRM ad leads, paired by client and day.`,
    };
  if (
    (c.key === "mrrProjected" ||
      c.key === "mrrCollected" ||
      c.key === "mrrCollectionRate") &&
    typeof t.onDeals === "number"
  )
    return {
      ...c,
      source: `${c.source} Left out as new this month or still on their closer-form deal (front end): ${money(t.onDeals)} of MRR.`,
    };
  if (c.key === "software" && t.software)
    return { ...c, source: `${c.source} This month: ${t.software}` };
  return c;
}

/** The days of a month a fact covers: to its last day, or to today in the month in progress. */
function monthDaysTo(m: string, today: string): string[] {
  return daysOfMonth(m).filter(d => d <= today);
}

/**
 * The month-level numbers of one month that do not divide by day, each with
 * a sentence when it is missing (2026-11-02).
 */
function factsFor(
  ctx: SheetContext,
  m: string,
  measured: Record<string, DayParts>,
  typed: Record<string, Record<string, number>>,
  say: {
    thisMonth: string;
    today: string;
    why: (part: string, text: string) => void;
    onDeals: (v: number | null) => void;
    software: (text: string) => void;
  },
): DayParts {
  const raw = ctx as unknown as Record<string, unknown>;
  const ended = m < say.thisMonth;
  const started = m <= say.thisMonth;
  const name = monthWords(m);
  const facts: DayParts = {};
  const w = ctx.windows.find(x => x.from === `${m}-01`);

  // Unique link clicks and intros advanced come by day since the release. B2B's
  // whole-month window stands in only for an ended month whose days lack them:
  // in the month in progress the window runs to today and the days to
  // yesterday, so CPC read $0.40 against $0.59 on 2 Nov (round 1's defect).
  for (const [part, rawKey] of [
    ["uniqueLinkClicks", "link_clicks"],
    ["introsAdvanced", "intros_advanced"],
  ] as const) {
    if (daysCarry(measured, m, part) || !started) continue;
    const fact = ended && w?.raw ? num(w.raw[rawKey]) : null;
    if (fact !== null) facts[part] = fact;
    else
      say.why(
        part,
        // Days that hold the field, all null, came from the release: they
        // were not read, they do not wait on it (repair 2026-11-02).
        Object.entries(measured).some(
          ([day, p]) => day.startsWith(m) && part in p,
        )
          ? LATE_GROWTH[part].nulled
          : LATE_GROWTH[part].absent,
      );
  }

  // MRR (fix 8, back end only): clients who were clients before the month.
  const book = ctx.book as Record<string, unknown> | null;
  if (started) {
    const entry: Record<string, unknown> | undefined = !book
      ? undefined
      : book.month === m
        ? book
        : (Array.isArray(book.history) ? book.history : [])
            .filter(isObj)
            .find(h => h.month === m);
    const mrrWhy = (text: string) => {
      say.why("mrrProjected", text);
      say.why("mrrCollected", text);
    };
    if (!book)
      mrrWhy(
        "The money refresh has not published its book, so MRR is not read.",
      );
    else if (!entry) mrrWhy(`The Money tab's book holds no ${name}.`);
    else if (
      !("collectedBackEnd" in entry) &&
      !("projectedExisting" in entry)
    ) {
      // An older worker: the book mixes new clients' first payments in, so it
      // is said beside the gap, not shown as the back end.
      const collected = num(entry.collected);
      const projected = num(entry.projectedMrr ?? entry.projected);
      mrrWhy(
        `Back-end MRR waits on ${RELEASE}. The Money tab's book reads ${money(collected)} collected of ${money(projected)}, which holds new clients' first payments, so it is not used here.`,
      );
    } else {
      facts.mrrProjected = num(entry.projectedExisting);
      facts.mrrCollected = num(entry.collectedBackEnd);
      say.onDeals(num(entry.projectedOnDeals));
      if (facts.mrrProjected === null || facts.mrrCollected === null)
        mrrWhy(
          `Back-end MRR for ${name} needs that month's last billing snapshot, which is not there, so it reads missing, not 0.`,
        );
    }
  }

  // UF cash % (fix 11): the month's deals' cash over the month's contracted, both to the newest refresh.
  if (started) {
    const list = raw.frontEndMonths;
    const listed = Array.isArray(list)
      ? (list as unknown[]).filter(isObj).find(x => x.month === m)
      : undefined;
    const fromWindow = isObj(w)
      ? (w as Record<string, unknown>).frontEndCash
      : null;
    const paid = listed
      ? num(listed.paidOnWindowDeals)
      : isObj(fromWindow)
        ? num(fromWindow.paidOnWindowDeals)
        : null;
    if (paid !== null) {
      let contracted: number | null = null;
      for (const d of monthDaysTo(m, say.today)) {
        const v = dayRow(measured[d], typed[d]).contracted;
        if (typeof v === "number" && Number.isFinite(v))
          contracted = (contracted ?? 0) + v;
      }
      facts.paidOnWindowDeals = paid;
      if (contracted !== null) facts.monthContracted = contracted;
    } else
      say.why(
        "paidOnWindowDeals",
        listed
          ? `Front-end cash on ${name}'s own deals was not read, so its UF cash % is not known.`
          : Array.isArray(list)
            ? `Front-end cash for ${name} is not in the growth refresh's months, so its UF cash % is not known.`
            : // Absent: the server is older than 20261102m, the only way the
              // list and the windows' frontEndCash reach the sheet; the
              // release that publishes them was live on 2 Nov while the
              // migration was not. Null: the migration is live and growth
              // does not publish the list yet (repair 2026-11-02).
              list === undefined
              ? `UF cash % on the month's own deals waits on ${MIGRATION}, which passes the growth refresh's front-end cash by month to the sheet.`
              : `UF cash % on the month's own deals waits on ${RELEASE}, which publishes front-end cash by month.`,
      );
  }

  const churnRow = ctx.churnMonths.find(x => x.month === m);
  if (churnRow) {
    facts.clientsAtStart = num(churnRow.activeAtStart);
    // A month from before the register holds only a count.
    facts.clientsChurned =
      ctx.churned.filter(d => String(d.leftOn).startsWith(m)).length +
      (num(churnRow.lostBefore) ?? 0);
  }

  // Refunds on an older server: the month's number, as before the release.
  if (raw.refundsDaily === undefined) {
    const refunds = ctx.refundsMonthly.find(x => x.month === m) as
      | Record<string, unknown>
      | undefined;
    if (refunds) {
      facts.refundAmount = num(refunds.refunds);
      // The hand-logged part, once the money refresh writes it: revenue's.
      const manual = num(refunds.refundsManual);
      if (manual !== null) facts.refundsManual = manual;
    }
  }

  // Overhead (fix 6): the month's own software point for a past month, today's lines for this one.
  const byMonth = raw.softwareByMonth;
  const lines = num(ctx.softwareMonthly);
  if (Array.isArray(byMonth)) {
    const e = (byMonth as unknown[]).filter(isObj).find(x => x.month === m);
    const usd = e ? num(e.usd) : null;
    if (e && (e.basis === "point" || e.basis === "lines") && usd !== null) {
      facts.software = usd;
      if (typeof e.source === "string") say.software(e.source);
    } else if (started)
      say.why(
        "software",
        e && typeof e.source === "string" && e.source
          ? e.source
          : `Overhead for ${name} was not read.`,
      );
  } else if (m === say.thisMonth && lines !== null) facts.software = lines;
  else if (started)
    say.why(
      "software",
      byMonth === null
        ? "Overhead by month was not read this time."
        : `What software ran at in ${name} waits on ${MIGRATION}: a point kept when the month closed. Today's lines (${money(lines)}) were repriced on 1 Nov, so they are not used for a past month.`,
    );
  return facts;
}

/** One day as a column reads it: what was measured, with anything typed over it. */
export function rowsOf(
  sheet: SheetData,
  days: string[],
  kind: "actual" | "plan" = "actual",
): DayParts[] {
  return days.map(d =>
    kind === "plan"
      ? dayRow(undefined, sheet.plan[d])
      : dayRow(sheet.measured[d], sheet.typed[d]),
  );
}

/**
 * The cell a typed day is stored under: a per-day column stores the day's
 * count. A mirror's rollup is its source's part, so Total new cash types
 * Cash collected's `newCash` cell.
 */
export function cellKey(c: SheetColumn): string {
  const r = c.rollup;
  return r.kind === "ratio" ? c.key : r.part;
}

// --- Reading a run of days: one rule for the grid, the phone and the board ---

/** A run of days as the sheet reads it, with the month's facts when it is a whole month. */
export type SheetRange = {
  from: string;
  through: string;
  days: string[];
  rows: DayParts[];
  /** Working days in the run: a per-day metric divides by them. */
  worked: number;
  /** The month's facts, only when the run is the tab's month so far or the whole month before. */
  facts?: DayParts;
  /** The month the facts are, when there are any. */
  month?: string;
};

/**
 * The days `from`..`through` (inclusive). The month's facts apply when the
 * run is the tab's month from its 1st to the sheet's newest complete day (or
 * its last day), or the whole month before: the only runs a month-level
 * number describes.
 */
export function rangeOf(
  sheet: SheetData,
  from: string,
  through: string | null,
): SheetRange {
  const days: string[] = [];
  if (through !== null)
    for (let d = from; d <= through; d = addDays(d, 1)) days.push(d);
  const prev = shiftMonth(sheet.month, -1);
  const prevDays = daysOfMonth(prev);
  const isMonth =
    from === `${sheet.month}-01` &&
    (through === null ||
      through === sheet.through ||
      through === sheet.days[sheet.days.length - 1]);
  const isPrev =
    from === prevDays[0] && through === prevDays[prevDays.length - 1];
  return {
    from,
    through: through ?? from,
    days,
    rows: rowsOf(sheet, days),
    worked: days.filter(isWorkingDay).length,
    ...(isMonth
      ? { facts: withComputed(sheet.facts), month: sheet.month }
      : isPrev
        ? { facts: withComputed(sheet.prevFacts), month: prev }
        : {}),
  };
}

/** The tab's month so far: the 1st to the newest complete day. */
export function monthSoFar(sheet: SheetData): SheetRange {
  return rangeOf(sheet, `${sheet.month}-01`, sheet.through);
}

/** The whole month before the tab's. */
export function monthBefore(sheet: SheetData): SheetRange {
  const d = daysOfMonth(shiftMonth(sheet.month, -1));
  return rangeOf(sheet, d[0], d[d.length - 1]);
}

/** Revenue over a run, with the money the CEO left out of those days named (fix 1). */
export function revenueFor(sheet: SheetData, range: SheetRange): Revenue {
  const rev = revenueOf(range.rows, range.worked, range.facts);
  const inRun = new Set(range.days);
  return {
    ...rev,
    leftOut: sheet.cashExcluded
      .filter(e => inRun.has(e.date))
      .map(e => `${e.what} ${money(e.usd)} (${shortDate(e.date)})`),
  };
}

/** Parts that only a whole month has: a day or a rolling run says so instead of a number. */
const MONTH_ONLY: Record<string, string> = {
  paidOnWindowDeals:
    "UF cash % is a month measure: the month's deals' cash is read for whole months only.",
  mrrProjected:
    "A whole-month number: a day or a run of days has none of its own.",
  mrrCollected:
    "A whole-month number: a day or a run of days has none of its own.",
};

/**
 * What a column's number over a run waits on (`waits`, when it is missing)
 * and what it leaves out (`leaves`, when it is there), in plain words, from
 * the sheet's own reasons: the month's, each day's, and a whole-month measure
 * asked of fewer days (2026-11-02).
 */
export function notesFor(
  sheet: SheetData,
  c: SheetColumn,
  range: SheetRange,
  value: number | null,
): { waits: string[]; leaves: string[] } {
  const parts = partsOf(c);
  const waits = new Set<string>();
  const gaps = new Map<string, number>();
  if (value === null && range.month)
    for (const p of parts) {
      const w = sheet.monthWhy[range.month]?.[p];
      if (w && typeof range.facts?.[p] !== "number") waits.add(w);
    }
  if (
    value === null &&
    !c.custom &&
    (c.key === "profit" || c.key === "margin")
  ) {
    // Profit waits on revenue and the three costs: say which.
    const cost = (k: string) =>
      rollUp(COLUMN_BY_KEY[k], range.rows, range.worked, range.facts);
    if (cost("labour") === null)
      waits.add(
        "Labour expenses are typed: type the month's labour on any day of it.",
      );
    if (
      cost("software") === null &&
      !sheet.monthWhy[range.month ?? ""]?.software
    )
      waits.add("Overhead expenses are not read for these days.");
  }
  if (value === null && !range.month)
    for (const p of parts) if (MONTH_ONLY[p]) waits.add(MONTH_ONLY[p]);
  range.days.forEach((d, i) => {
    const row = range.rows[i];
    for (const p of parts) {
      const why = sheet.dayWhy[d]?.[p];
      if (!why || typeof row[p] === "number") continue;
      // A month's fact stands in for its days: their gaps are not the number's.
      if (typeof range.facts?.[p] === "number") continue;
      if (value === null || !unknownOn(row, p))
        gaps.set(why, (gaps.get(why) ?? 0) + 1);
    }
  });
  const leaves: string[] = [];
  for (const [why, n] of gaps) {
    if (value === null) waits.add(why);
    else
      leaves.push(
        range.days.length > 1
          ? `${why.replace(/\.$/, "")} (${n} ${n === 1 ? "day" : "days"}).`
          : why,
      );
  }
  if (value !== null && !c.custom) {
    if (c.key === "clientCpl") {
      const left = range.rows.reduce(
        (n, r) =>
          n + (typeof r.clientCplLeftOut === "number" ? r.clientCplLeftOut : 0),
        0,
      );
      if (left > 0.005)
        leaves.push(
          `Leaves out ${money(left)} of client spend with no CRM count stored beside it.`,
        );
    }
    if (c.key === "callCloseRate" && value === 0)
      leaves.push(
        "0 recorded: no client marked a deal won over these days in the portal.",
      );
  }
  return { waits: [...waits], leaves };
}

/** One column over a run, as the board and the sheet read it. */
export type RangeRead = {
  column: SheetColumn;
  value: number | null;
  /** Where the month ends at this rate: only for the tab's month so far. */
  pace: number | null;
  waits: string[];
  leaves: string[];
  /** Revenue's parts, for Total revenue, profit and margin. */
  revenue: Revenue | null;
};

const FROM_REVENUE = new Set(["totalCash", "profit", "margin"]);

/**
 * The sheet's roll-up of one metric over `from`..`through`, the one rule the
 * Goals board reads instead of its own (truth/SYNTHESIS.md fix 3). Null when
 * the sheet has no such column.
 */
export function readRange(
  sheet: SheetData,
  key: string,
  from: string,
  through: string | null,
): RangeRead | null {
  const column =
    sheet.columns.find(c => c.key === key) ?? COLUMN_BY_KEY[key] ?? null;
  if (!column) return null;
  const range = rangeOf(sheet, from, through);
  const value = rollUp(column, range.rows, range.worked, range.facts);
  const whole = range.month === sheet.month;
  const pace = whole
    ? paceFor(
        column,
        range.rows,
        sheet.workedSoFar,
        sheet.workingDays,
        range.facts,
      )
    : null;
  return {
    column,
    value,
    pace,
    ...notesFor(sheet, column, range, value),
    revenue: FROM_REVENUE.has(column.key) ? revenueFor(sheet, range) : null,
  };
}

// --- Targets ---------------------------------------------------------------

export type TargetMap = Record<
  string,
  { value: number; note: string | null; id: number }
>;

/**
 * Older plan keys for a target the sheet holds under another key: October's
 * "Client lead to booking" is the call centre's lead to booking, and its
 * "Software and overhead" is Overhead expenses. The board reads the same map.
 */
export const SHEET_TARGET_ALIASES: Readonly<Record<string, string>> = {
  ...REPLACED,
  overhead: "software",
};

export function targetsOf(ctx: SheetContext): TargetMap {
  const out: TargetMap = {};
  for (const t of ctx.targets) {
    const v = num(t.target);
    if (v === null) continue;
    out[String(t.metric_key)] = {
      value: v,
      note: t.note ? String(t.note) : null,
      id: Number(t.id),
    };
  }
  // A plan that stores only the older key shows its target on the sheet's
  // column too (2026-11-02), so the sheet and the board judge alike.
  for (const [older, key] of Object.entries(SHEET_TARGET_ALIASES))
    if (!(key in out) && older in out) out[key] = out[older];
  return out;
}

/** The plan's inputs, read back from its targets. */
export function inputsFromTargets(t: TargetMap): PlanInputs {
  const v = (k: string) => t[k]?.value ?? null;
  const spend = v("spend");
  const hammer = v("spendRetargeting");
  return {
    spend,
    cpl: v("cpl"),
    qualifiedShare: null,
    leadToBooked: v("leadToBooked"),
    introShowRate: v("introShowRate"),
    introToDemo: v("introToDemo"),
    directDemos: v("directDemos"),
    demoShowRate: v("demoShowRate"),
    qualifiedDemoShare: null,
    closeRate: v("closeRate"),
    aov: v("aov"),
    cashShare: v("cashShare"),
    spendRetargeting: hammer,
    mrrDue: v("mrrProjected"),
    mrrCollectionRate: v("mrrCollectionRate"),
    upsellCash: v("upsellCash"),
    labour: v("labour"),
    overhead: v("software") ?? v("overhead"),
    otherMarketing: null,
    feeRate: null,
    callLeads: v("callLeads"),
    callLeadToBooking: v("callLeadToBooking"),
    clientCpl: v("clientCpl"),
    goalCash: v("totalCash"),
    hammerShare: spend && hammer !== null ? hammer / spend : null,
    cpc: v("cpc"),
    offerRate: v("offerRate"),
    // Revenue takes refunds off (2026-11-02), so the plan's refunds are an input.
    refundAmount: v("refundAmount"),
  };
}

/**
 * Which plan input a column's target sets, for the ones outside the Goals
 * model. directDemos is off the sheet since 2026-11-02 but stays here, as it
 * stays an input of the plan's chain.
 */
const SHEET_INPUTS: Record<string, keyof PlanInputs> = {
  totalCash: "goalCash",
  cpc: "cpc",
  offerRate: "offerRate",
  directDemos: "directDemos",
};

/** A target that sets something and is not worked out from anything else. */
export function isPlanInput(c: SheetColumn): boolean {
  if (c.targetKey) return false;
  return Boolean(c.driver || SHEET_INPUTS[c.key]);
}

/** Worked out by the plan, or a mirror of another column: its target cannot be typed here. */
export function isWorkedOut(c: SheetColumn, inputs: PlanInputs): boolean {
  if (c.targetKey) return true;
  if (isPlanInput(c)) return false;
  return planNumbers(inputs).byColumn[c.key] !== undefined;
}

/** The column's input key on the plan, when typing its target changes the chain. */
export function inputKeyOf(c: SheetColumn): keyof PlanInputs | null {
  if (c.targetKey) return null;
  return (c.driver as DriverKey | undefined) ?? SHEET_INPUTS[c.key] ?? null;
}

const SECTION_GROUP = Object.fromEntries(
  SHEET_SECTIONS.map(s => [s.key, s.group]),
);

/**
 * Every target row a plan's inputs imply, ready for saveTargets. Each worked-out
 * row carries the sentence the Goals model writes, so the board and the formula
 * bar explain a number the same way. A mirror, a retired metric and one he
 * added never get a row here: the mirror's target is its source's, and a
 * retired metric's stored target (AOV, direct demos) is left as it is.
 */
export function targetRows(
  inputs: PlanInputs,
  keptNotes: Record<string, string | null>,
  say: {
    money: (v: number) => string;
    count: (v: number) => string;
    pct: (v: number) => string;
  },
) {
  const { drivers, p, byColumn } = planNumbers(inputs);
  const how: Record<string, string | null> = Object.fromEntries(
    modelTargets(drivers, p, say).map(t => [t.key, t.how]),
  );
  // The Goals model's revenue has no refunds and its profit carries fees, so
  // these say the sheet's own rule (2026-11-02).
  const $ = (v: number | null | undefined) =>
    typeof v === "number" && Number.isFinite(v) ? say.money(v) : "?";
  const n = (v: number | null | undefined) =>
    typeof v === "number" && Number.isFinite(v) ? say.count(v) : "?";
  how.totalCash = `${$(byColumn.newCash)} new cash, ${$(byColumn.upsellCash ?? 0)} upsell cash and ${$(byColumn.mrrCollected)} MRR collected, less ${$(byColumn.refundAmount ?? 0)} refunds.`;
  how.profit = `${$(byColumn.totalCash)} revenue less ${$(byColumn.software ?? 0)} overhead, ${$(byColumn.labour ?? 0)} labour and ${$(byColumn.marketingExpenses ?? 0)} marketing.`;
  how.introsDue = `The ${n(byColumn.introsBooked)} intros booked: each falls due once.`;
  how.demosDue = `The ${n(byColumn.demosBooked)} demos booked: each falls due once.`;
  const rows: Record<string, unknown>[] = [];
  SHEET_COLUMNS.forEach((c, sort) => {
    if (!writesTarget(c)) return;
    const value = byColumn[c.key];
    if (value === null || value === undefined || !Number.isFinite(value))
      return;
    rows.push({
      groupKey: SECTION_GROUP[c.section],
      metricKey: c.key,
      // Said with no section header beside it on the board (2026-11-02).
      label: boardLabelOf(c),
      unit: c.unit,
      direction: c.direction,
      target: tidy(value, c.unit),
      note: keptNotes[c.key] ?? how[c.key] ?? null,
      sort: 1000 + sort,
    });
  });
  return rows;
}
