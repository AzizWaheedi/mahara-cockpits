/**
 * One reporting period for a client: what a pick means in dates, what came of
 * it on the client's sheet and from their ads, and the period it is compared
 * with.
 *
 * Aziz, 2026-10-06: "I want to also be able to control the timeframe of the
 * client reporting". The Client performance page, its printed one-pager and
 * the Google Doc report (media buyer convex/reportDocs.ts) all read this, so
 * the numbers a CSM looks at are the numbers the client is sent. Kept the
 * same in both apps by scripts/check-shared.sh.
 */

/** "7d", "month", "lastMonth", "all", "2026-09", or "custom:2026-09-01:2026-09-14". */
export type PeriodKey = string;

export type Period = {
  key: PeriodKey;
  from: string;
  to: string;
  /** "last 7 days", "September 2026", "1 Sep to 14 Sep". */
  label: string;
  /** The span it is compared with; none for all time. */
  prevFrom?: string;
  prevTo?: string;
  prevLabel?: string;
  /** A calendar month, which the sheet's own month figures can stand for. */
  month?: string;
};

const DAY = 86_400_000;

export function kuwaitDay(now = Date.now()): string {
  return new Date(now + 3 * 3_600_000).toISOString().slice(0, 10);
}

export function shiftDay(iso: string, n: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY)
    .toISOString()
    .slice(0, 10);
}

const spanDays = (from: string, to: string) =>
  Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY,
  ) + 1;

// Spelled out here rather than by the locale: browsers and the server
// abbreviate September differently, and a report should read the same.
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function monthName(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

/** "6 Oct". */
export function dayLabel(iso: string): string {
  const [, m, d] = iso.slice(0, 10).split("-").map(Number);
  return `${d} ${MONTHS[m - 1].slice(0, 3)}`;
}

function monthPeriod(key: PeriodKey, ym: string): Period {
  const [y, m] = ym.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  const prevYm = shiftDay(`${ym}-01`, -1).slice(0, 7);
  const [py, pm] = prevYm.split("-").map(Number);
  return {
    key,
    from: `${ym}-01`,
    to: last,
    label: monthName(ym),
    prevFrom: `${prevYm}-01`,
    prevTo: new Date(Date.UTC(py, pm, 0)).toISOString().slice(0, 10),
    prevLabel: monthName(prevYm),
    month: ym,
  };
}

/** A rolling span ending on `to`, compared with the same number of days before it. */
function spanPeriod(key: PeriodKey, from: string, to: string, label: string) {
  const n = spanDays(from, to);
  return {
    key,
    from,
    to,
    label,
    prevFrom: shiftDay(from, -n),
    prevTo: shiftDay(from, -1),
    prevLabel: `the ${n} days before`,
  };
}

/** What a pick means in dates, on Kuwait's calendar. */
export function periodOf(
  key: PeriodKey,
  today = kuwaitDay(),
  earliest?: string,
): Period {
  const k = String(key || "month");
  if (k === "all")
    return {
      key: k,
      from: earliest ?? "2000-01-01",
      to: today,
      label: "all time",
    };
  const custom = /^custom:(\d{4}-\d{2}-\d{2}):(\d{4}-\d{2}-\d{2})$/.exec(k);
  if (custom) {
    const [from, to] =
      custom[1] <= custom[2] ? [custom[1], custom[2]] : [custom[2], custom[1]];
    return spanPeriod(k, from, to, `${dayLabel(from)} to ${dayLabel(to)}`);
  }
  // "Last N days" are the N complete days before today, as on the media
  // buyer's ranges (2026-10-21): the ad data runs to yesterday, so a span
  // that ended today held one day of ads fewer than its name (Ardon's "7
  // days" read 15-20 Oct, $162.47 / 2 = $81.24 a booking, against 14-20 Oct,
  // $201.90 / 5 = $40.38). "This month" still runs through today.
  const days = /^(\d+)d$/.exec(k);
  if (days) {
    const n = Math.max(1, Number(days[1]));
    return spanPeriod(
      k,
      shiftDay(today, -n),
      shiftDay(today, -1),
      `last ${n} days`,
    );
  }
  if (k === "lastMonth")
    return monthPeriod(k, shiftDay(`${today.slice(0, 7)}-01`, -1).slice(0, 7));
  if (/^\d{4}-\d{2}$/.test(k)) return monthPeriod(k, k);
  return monthPeriod("month", today.slice(0, 7));
}

/** One compact sheet row, as the profile stores it. */
export type Appt = {
  added?: string;
  appAt?: string;
  booked?: boolean;
  show?: string;
  quote?: string;
  closed?: string;
  ad?: string;
};

/** One day of the client's ads, from the media buyer. */
export type AdDay = { date: string; leads?: number; spend?: number };

export type PeriodNumbers = {
  /**
   * From the ads (Meta), as every screen and the report count leads; a
   * client with no ad rows at all keeps the sheet's count (`leadsFrom`).
   */
  leads: number;
  leadsFrom: "ads" | "sheet";
  spend: number;
  cpl: number | null;
  /** Rows on the sheet: the leads the client's team actually logged. */
  sheetLeads: number;
  booked: number;
  shows: number;
  noshows: number;
  quotes: number;
  closes: number;
  /** Booked, the appointment day has passed, and no outcome filled in. */
  unknownOutcome: number;
  showRate: number | null;
  closeRate: number | null;
};

const inPeriod = (day: string | undefined, from: string, to: string) =>
  Boolean(day) &&
  String(day).slice(0, 10) >= from &&
  String(day).slice(0, 10) <= to;

/** No outcome yet, for an appointment whose day has come. */
const unfilled = (r: Appt, today: string) =>
  !r.show && !r.closed && !(r.appAt && String(r.appAt).slice(0, 10) > today);

/** What the period holds: ad leads and spend, and the sheet's outcomes by the day a lead was added. */
export function periodNumbers(
  appts: Appt[],
  adDays: AdDay[],
  from: string,
  to: string,
  today = kuwaitDay(),
): PeriodNumbers {
  let leads = 0;
  let spend = 0;
  for (const d of adDays)
    if (inPeriod(d.date, from, to)) {
      leads += Number(d.leads ?? 0);
      spend += Number(d.spend ?? 0);
    }
  const rows = appts.filter(r => inPeriod(r.added, from, to));
  const shows = rows.filter(r => r.show === "y").length;
  const noshows = rows.filter(r => r.show === "n").length;
  const closes = rows.filter(r => r.closed === "y").length;
  // Close rate is of the people who came: a close logged without a show
  // still counts as a close, but not in the rate, so it never passes 100%.
  const closesShown = rows.filter(
    r => r.closed === "y" && r.show === "y",
  ).length;
  const decided = shows + noshows;
  // Ads count once the ad history reaches this period. A period entirely
  // before the first ad day has no ad record at all, so the sheet's count
  // stands instead of a zero.
  const firstAdDay = adDays.reduce<string | undefined>(
    (min, d) =>
      d.date && (!min || String(d.date).slice(0, 10) < min)
        ? String(d.date).slice(0, 10)
        : min,
    undefined,
  );
  const fromAds = firstAdDay !== undefined && firstAdDay <= to;
  return {
    leads: fromAds ? leads : rows.length,
    leadsFrom: fromAds ? "ads" : "sheet",
    spend: Math.round(spend * 100) / 100,
    cpl: fromAds && leads ? Math.round((spend / leads) * 100) / 100 : null,
    sheetLeads: rows.length,
    booked: rows.filter(r => r.booked).length,
    shows,
    noshows,
    quotes: rows.filter(r => r.quote === "y").length,
    closes,
    unknownOutcome: rows.filter(r => r.booked && unfilled(r, today)).length,
    showRate: decided ? Math.round((100 * shows) / decided) : null,
    closeRate: shows ? Math.round((100 * closesShown) / shows) : null,
  };
}

/** The sheet's own month tab: outcome counts only, never the lead count. */
const SHEET_KEYS = [
  "booked",
  "shows",
  "noshows",
  "quotes",
  "deposits",
  "closes",
  "unknownOutcome",
  "upcoming",
  "showRate",
  "closeRate",
  "csat",
] as const;

/**
 * "This month" reads the outcomes off the sheet's month tab, but leads,
 * spend and cost per lead stay from the ads, the same as every other
 * period. Spreading the whole tab replaced ad leads with the sheet's row
 * count, so cost per lead divided Meta spend by the sheet (2026-10-11).
 */
export function withSheetMonth<T extends Record<string, unknown>>(
  adBased: T | null | undefined,
  sheet: Record<string, unknown> | null | undefined,
): (T & Record<string, unknown>) | null {
  if (!sheet) return adBased ? { ...adBased } : null;
  const out: Record<string, unknown> = { ...(adBased ?? {}) };
  for (const k of SHEET_KEYS) if (k in sheet) out[k] = sheet[k];
  out.sheetLeads = sheet.leads;
  if (!adBased) {
    out.leads = sheet.leads;
    out.leadsFrom = "sheet";
  }
  if (
    typeof out.closeRate === "number" &&
    typeof out.closes === "number" &&
    typeof out.shows === "number" &&
    out.shows > 0
  )
    out.closeRate = Math.min(out.closeRate, 100);
  return out as T & Record<string, unknown>;
}

export type AdOutcome = {
  ad: string;
  leads: number;
  booked: number;
  shows: number;
  noshows: number;
  closes: number;
  unknown: number;
  showRate?: number;
  closeRate?: number;
};

/** How many ads byAdIn returns at most; the table says when there are more. */
export const AD_TABLE_LIMIT = 12;

/** Which ad brought the leads that turned up and bought, in the period. Best first, twelve at most. */
export function byAdIn(
  appts: Appt[],
  from: string,
  to: string,
  today = kuwaitDay(),
  limit = AD_TABLE_LIMIT,
): AdOutcome[] {
  const seen = new Map<string, AdOutcome & { closesShown: number }>();
  for (const r of appts) {
    if (!inPeriod(r.added, from, to)) continue;
    const key = r.ad || "not tagged";
    const a = seen.get(key) ?? {
      ad: key,
      leads: 0,
      booked: 0,
      shows: 0,
      noshows: 0,
      closes: 0,
      closesShown: 0,
      unknown: 0,
    };
    a.leads++;
    if (r.booked) a.booked++;
    if (r.show === "y") a.shows++;
    if (r.show === "n") a.noshows++;
    if (r.closed === "y") a.closes++;
    if (r.closed === "y" && r.show === "y") a.closesShown++;
    // Same rule as the totals: only a booked appointment can lack an outcome.
    if (r.booked && unfilled(r, today)) a.unknown++;
    seen.set(key, a);
  }
  return [...seen.values()]
    .map(({ closesShown, ...a }) => {
      const decided = a.shows + a.noshows;
      return {
        ...a,
        showRate: decided ? Math.round((100 * a.shows) / decided) : undefined,
        closeRate: a.shows
          ? Math.round((100 * closesShown) / a.shows)
          : undefined,
      };
    })
    .sort(
      (a, b) => b.closes - a.closes || b.shows - a.shows || b.leads - a.leads,
    )
    .slice(0, limit);
}

/** A media buyer change or decision, as the client's card carries it. */
export type CardChange = {
  subject: string;
  action: string;
  kind: string;
  evidence?: string;
  day: string;
  at?: number;
  taskUrl?: string;
};

/** The changes made in the period, newest first. */
export function changesIn(
  changes: CardChange[] | undefined,
  from: string,
  to: string,
): CardChange[] {
  return (changes ?? [])
    .filter(c => inPeriod(c.day, from, to))
    .sort((a, b) => (b.at ?? 0) - (a.at ?? 0) || (a.day < b.day ? 1 : -1));
}
