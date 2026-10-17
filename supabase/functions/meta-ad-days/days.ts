/**
 * Days, the way Meta counts them: each ad account's own calendar
 * (account_timezone). On 2026-10-16 the spending accounts were on Riyadh,
 * Kuwait, Qatar, Bahrain, Beirut and Los Angeles time; the CRM is on Kuwait
 * time, so a Los Angeles account's "today" starts 11 hours after Kuwait's.
 *
 * What each job reads, per account:
 *   hourly    yesterday and today
 *   nightly   the 28 days before today, in 7-day pieces (attribution settles
 *             over the attribution window, so the last 4 weeks are read again)
 *   backfill  the N days before today (1 to 90), in 7-day pieces
 * Seven days at a time keeps the heaviest account's read near 11 seconds;
 * a 30-day ad-level read of it did not come back (code 2 after 32 seconds).
 */

export type JobKind = "hourly" | "nightly" | "backfill";
export type Span = { since: string; until: string };

const DAY_MS = 86_400_000;
const ISO = /^\d{4}-\d{2}-\d{2}$/;

export function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);
}

/** The calendar day at `nowMs` in the IANA zone `tz`; Kuwait when the zone is unknown. */
export function zonedDay(nowMs: number, tz: string): string {
  const fmt = (zone: string) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(nowMs));
  let out: string;
  try {
    out = fmt(tz || "Asia/Kuwait");
  } catch {
    out = fmt("Asia/Kuwait");
  }
  if (!ISO.test(out)) throw new Error(`The clock gave "${out}" for ${tz}.`);
  return out;
}

export function knownZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: tz });
    return Boolean(tz);
  } catch {
    return false;
  }
}

/** [since, until] in pieces of at most `size` days, oldest first. */
export function pieces(since: string, until: string, size: number): Span[] {
  if (!ISO.test(since) || !ISO.test(until) || since > until) return [];
  const out: Span[] = [];
  for (let start = since; start <= until; start = addDays(start, size)) {
    const end = addDays(start, size - 1);
    out.push({ since: start, until: end < until ? end : until });
  }
  return out;
}

/** The two halves of a span, for a read Meta could not build in one go. */
export function halves(span: Span): [Span, Span] | null {
  const n = daysBetween(span.since, span.until) + 1;
  if (n < 2) return null;
  const mid = addDays(span.since, Math.floor(n / 2) - 1);
  return [{ since: span.since, until: mid }, { since: addDays(mid, 1), until: span.until }];
}

export const PIECE_DAYS = 7;
export const NIGHTLY_DAYS = 28;
export const MAX_BACKFILL_DAYS = 90;

/** The spans one account reads for a job, on its own calendar. */
export function spansFor(job: JobKind, nowMs: number, tz: string, backfillDays = MAX_BACKFILL_DAYS): Span[] {
  const today = zonedDay(nowMs, tz);
  const yesterday = addDays(today, -1);
  if (job === "hourly") return [{ since: yesterday, until: today }];
  const n = job === "nightly" ? NIGHTLY_DAYS : Math.min(Math.max(1, Math.floor(backfillDays)), MAX_BACKFILL_DAYS);
  return pieces(addDays(today, -n), yesterday, PIECE_DAYS);
}

/**
 * The Kuwait days to ask the business edges for spend over, so every account
 * that delivered in a job's span is found whatever its time zone: one day
 * wider on each side than any account's span. Nightly also covers last month
 * from its first day, so the reach windows find every account that spent then.
 */
export function discoveryWindow(job: JobKind, nowMs: number, backfillDays = MAX_BACKFILL_DAYS): Span {
  const today = zonedDay(nowMs, "Asia/Kuwait");
  if (job === "hourly") return { since: addDays(today, -2), until: addDays(today, 1) };
  if (job === "nightly") {
    const lastMonthStart = `${addDays(`${today.slice(0, 7)}-01`, -1).slice(0, 7)}-01`;
    const since = addDays(today, -(NIGHTLY_DAYS + 1));
    return { since: since < lastMonthStart ? since : lastMonthStart, until: addDays(today, 1) };
  }
  const n = Math.min(Math.max(1, Math.floor(backfillDays)), MAX_BACKFILL_DAYS);
  return { since: addDays(today, -(n + 1)), until: addDays(today, 1) };
}

/** Days of budget history the nightly run rebuilds from Meta's activity log. */
export const HISTORY_NIGHTLY_DAYS = 14;

/**
 * The account days a budget history task rebuilds, on the account's own
 * clock: the 14 days before today on a nightly run, the N days before today
 * on a backfill. Today is left to the hourly reads.
 */
export function historySpan(job: JobKind, nowMs: number, tz: string, backfillDays = MAX_BACKFILL_DAYS): Span {
  const today = zonedDay(nowMs, tz);
  const n = job === "backfill" ? Math.min(Math.max(1, Math.floor(backfillDays)), MAX_BACKFILL_DAYS) : HISTORY_NIGHTLY_DAYS;
  return { since: addDays(today, -n), until: addDays(today, -1) };
}
