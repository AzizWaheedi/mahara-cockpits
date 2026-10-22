/**
 * What the results and speed screens work out from the database's reads (resultsReads.ts), in one place so a
 * test can hold it: the gap report's window, the speed chart's sums for any hour and country, the morning
 * list's groups, and the words for each state. Nothing here changes a number the database gave: it adds
 * counts the database already holds, and it never turns a missing value into 0.
 *
 * The same file sits in the media buyer and client success cockpits (results-screens.test.ts keeps the
 * two copies equal), like kpi.ts.
 */
import type { CallRow, SpeedCell, UncalledLead } from "./resultsReads";

// ---------------------------------------------------------------------------
// Days on Kuwait's calendar

/** Today in Kuwait, "YYYY-MM-DD" (UTC+3 all year). */
export function kuwaitToday(now: number = Date.now()): string {
  return new Date(now + 3 * 3600e3).toISOString().slice(0, 10);
}

export function shiftDay(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400e3)
    .toISOString()
    .slice(0, 10);
}

/** The gap report's window: the last 14 days, today included. */
export const GAP_DAYS = 14;
export function gapWindow(today: string = kuwaitToday()) {
  return { from: shiftDay(today, -(GAP_DAYS - 1)), to: today };
}

const DAY_FORMAT = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Kuwait",
  weekday: "short",
  day: "numeric",
  month: "short",
});
const CLOCK_FORMAT = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Kuwait",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** "Mon 12 Oct" from a day ("2026-10-12") or a moment. */
export function dayText(value: string): string {
  const at = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? Date.parse(`${value}T12:00:00Z`)
    : Date.parse(value);
  return Number.isFinite(at) ? DAY_FORMAT.format(at).replace(/,/g, "") : value;
}

/** "Tue 21 Oct, 14:05" in Kuwait time. */
export function stampText(iso: string): string {
  const at = Date.parse(iso);
  return Number.isFinite(at)
    ? `${DAY_FORMAT.format(at).replace(/,/g, "")}, ${CLOCK_FORMAT.format(at)}`
    : iso;
}

export const plural = (n: number, one: string, many = `${one}s`) =>
  `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

/** A share of 0 to 1 as a whole percent, never from nothing. */
export function percent(share: number | null | undefined): string | null {
  return typeof share === "number" && Number.isFinite(share)
    ? `${Math.round(share * 100)}%`
    : null;
}

// ---------------------------------------------------------------------------
// The gap report

export const SHEET_STATE_TEXT: Record<string, string> = {
  blank: "Blank in sheet",
  missing: "Not in sheet",
  unclear: "Sheet unclear",
};

/** What a client's row says is wrong besides the two columns: rows the sheet does not have, rows that disagree. */
export function gapAside(row: {
  sheetMissing: number;
  sheetUnclear: number;
}): string | null {
  const bits = [
    row.sheetMissing > 0 ? `${row.sheetMissing} not in the sheet` : null,
    row.sheetUnclear > 0 ? `${row.sheetUnclear} unclear in the sheet` : null,
  ].filter(Boolean);
  return bits.length ? bits.join(", ") : null;
}

// ---------------------------------------------------------------------------
// Speed chart

/** A band needs this many paid leads before its rate is shown: under it, the screen says too few. */
export const MIN_LEADS = 30;

export const BANDS = [
  { key: "up_to_30m", label: "Within 30 min" },
  { key: "30m_to_4h", label: "30 min to 4 h" },
  { key: "4h_to_24h", label: "4 to 24 h" },
  { key: "over_24h", label: "After 24 h" },
  { key: "no_call", label: "Never called" },
  { key: "clock_unknown", label: "Call time unknown" },
] as const;
export type BandKey = (typeof BANDS)[number]["key"];

export const COUNTRY_TEXT: Record<string, string> = {
  KW: "Kuwait",
  SA: "Saudi Arabia",
  AE: "UAE",
  QA: "Qatar",
  BH: "Bahrain",
  OM: "Oman",
  unknown: "Other or unknown",
};

export const hourText = (h: number) => `${String(h).padStart(2, "0")}:00`;

export type SpeedFilter = { hour: number | null; country: string | null };

const matches = (c: SpeedCell, f: SpeedFilter) =>
  (f.hour === null || c[0] === f.hour) &&
  (f.country === null || c[1] === f.country);

export type SpeedBand = {
  key: BandKey | "all";
  label: string;
  leads: number;
  bookings: number;
  /** Bookings per 100 paid leads, one decimal; null when there are too few leads to say. */
  per100: number | null;
  tooFew: boolean;
};

/** A rate per 100 with one decimal, so 18 reads 18.0 beside 18.5. */
export const rateText = (value: number) => value.toFixed(1);

const per100 = (bookings: number, leads: number) =>
  leads > 0 ? Math.round((1000 * bookings) / leads) / 10 : null;

/** The bands for one filter, in speed order, with every lead counted once, and the total. Empty bands are left out. */
export function speedBands(
  cells: SpeedCell[],
  filter: SpeedFilter = { hour: null, country: null },
): { bands: SpeedBand[]; total: SpeedBand } {
  const sums = new Map<string, [number, number]>();
  let leads = 0;
  let bookings = 0;
  for (const c of cells) {
    if (!matches(c, filter)) continue;
    const s = sums.get(c[2]) ?? [0, 0];
    s[0] += c[3];
    s[1] += c[4];
    sums.set(c[2], s);
    leads += c[3];
    bookings += c[4];
  }
  const band = (
    key: BandKey | "all",
    label: string,
    n: number,
    b: number,
  ): SpeedBand => ({
    key,
    label,
    leads: n,
    bookings: b,
    per100: n >= MIN_LEADS ? per100(b, n) : null,
    tooFew: n < MIN_LEADS,
  });
  const bands = BANDS.filter(b => (sums.get(b.key)?.[0] ?? 0) > 0).map(b =>
    band(b.key, b.label, sums.get(b.key)?.[0] ?? 0, sums.get(b.key)?.[1] ?? 0),
  );
  return { bands, total: band("all", "All paid leads", leads, bookings) };
}

/** The hours that have leads under the country filter, with their lead counts, for the picker. */
export function speedHours(
  cells: SpeedCell[],
  country: string | null = null,
): { hour: number; leads: number }[] {
  const by = new Map<number, number>();
  for (const c of cells)
    if (country === null || c[1] === country)
      by.set(c[0], (by.get(c[0]) ?? 0) + c[3]);
  return [...by]
    .map(([hour, leads]) => ({ hour, leads }))
    .sort((a, b) => a.hour - b.hour);
}

/** The countries that have leads under the hour filter, most leads first, for the picker. */
export function speedCountries(
  cells: SpeedCell[],
  hour: number | null = null,
): { country: string; leads: number }[] {
  const by = new Map<string, number>();
  for (const c of cells)
    if (hour === null || c[0] === hour)
      by.set(c[1], (by.get(c[1]) ?? 0) + c[3]);
  return [...by]
    .map(([country, leads]) => ({ country, leads }))
    .sort((a, b) => b.leads - a.leads || a.country.localeCompare(b.country));
}

export const SPEED_WINDOWS = [
  { key: "30", label: "30 days", days: 30 },
  { key: "60", label: "60 days", days: 60 },
  { key: "90", label: "90 days", days: 90 },
] as const;
export type SpeedWindowKey = (typeof SPEED_WINDOWS)[number]["key"];

/** The days a speed read asks for: the window's days up to today. Leads of the last 3 days are not counted yet. */
export function speedWindow(
  key: SpeedWindowKey,
  today: string = kuwaitToday(),
) {
  const days = SPEED_WINDOWS.find(w => w.key === key)?.days ?? 60;
  return { from: shiftDay(today, -(days - 1)), to: today };
}

// ---------------------------------------------------------------------------
// The morning list

export const MORNING_GROUPS = [
  {
    key: "never_called",
    title: "Never called",
    hint: "No call and no saved result. Call these first.",
  },
  {
    key: "outcome_only",
    title: "Result saved, no call",
    hint: "The caller saved a result, but no call is linked to the lead.",
  },
  {
    key: "phone_only",
    title: "Probably called",
    hint: "A call to the same phone number exists. None is linked to the lead.",
  },
] as const;
export type MorningGroupKey = (typeof MORNING_GROUPS)[number]["key"];

export type MorningFilter = { paidOnly: boolean; location: string | null };

/** The leads of each group under a filter, longest waiting first. */
export function morningGroups(
  leads: UncalledLead[],
  filter: MorningFilter = { paidOnly: false, location: null },
): Record<MorningGroupKey, UncalledLead[]> {
  const out: Record<MorningGroupKey, UncalledLead[]> = {
    never_called: [],
    outcome_only: [],
    phone_only: [],
  };
  for (const l of leads) {
    if (filter.paidOnly && !l.paid) continue;
    if (filter.location && l.locationId !== filter.location) continue;
    out[l.group].push(l);
  }
  for (const k of Object.keys(out) as MorningGroupKey[])
    out[k].sort(
      (a, b) =>
        (b.hoursWaiting ?? 0) - (a.hoursWaiting ?? 0) ||
        a.createdAt.localeCompare(b.createdAt) ||
        a.contactId.localeCompare(b.contactId),
    );
  return out;
}

/** How long a lead has waited: hours under two days, then days. Nothing when the database gave no time. */
export function waitingText(hours: number | null | undefined): string | null {
  if (typeof hours !== "number" || !Number.isFinite(hours)) return null;
  if (hours < 1) return "under 1 h";
  if (hours < 48) return `${Math.round(hours)} h`;
  return `${Math.round(hours / 24)} days`;
}

// ---------------------------------------------------------------------------
// The CSM call list

/** The clients waiting for next week, as one line: "MOFAG (2), Rising Najd (1)". */
export function queuedText(rows: CallRow[]): string | null {
  const queued = rows.filter(r => r.status === "queued");
  return queued.length
    ? queued.map(r => `${r.clientName} (${r.missing})`).join(", ")
    : null;
}

/** Who called and when, for a row that has been called: "Sara Csm, Tue 21 Oct, 14:05". */
export function calledText(row: CallRow): string | null {
  if (!row.calledAt) return null;
  const who =
    row.calledByName?.trim() || row.calledBy?.split("@")[0] || "A teammate";
  return `${who}, ${stampText(row.calledAt)}`;
}
