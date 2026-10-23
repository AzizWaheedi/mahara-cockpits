import { kuwaitDay } from "./reportPeriod";

/**
 * The funnel sheet's numbers, counted by Meta ad id from the cockpit's daily
 * statistics and booked calls (`cockpit_media_statistics`, kind "range").
 *
 * A booked call counts as shown when it is marked showed, or confirmed or
 * invalid once its time has passed: Aziz's rule and the B2B cockpit's. The
 * show rate divides by the calls whose time has passed, cancelled and
 * no-show included. A call still to come is in neither.
 */

export type StatRow = {
  adId: string | null;
  spend: number;
  impressions: number;
  linkClicks: number;
  leads: number;
};

export type StatCall = {
  adId: string | null;
  status: string;
  /** When the call starts, when the calendar gave a time. */
  startTime: string | null;
  /** The call's day, YYYY-MM-DD in Kuwait. */
  appointmentDate: string | null;
};

export type FunnelStats = {
  rows: StatRow[];
  calls: StatCall[];
  /**
   * Calls are counted to this day, the last one with Meta's numbers, when
   * it falls inside the range: the sheet should say "Calls counted to
   * 21 Oct" beside its dates (2026-10-22).
   */
  callsThrough?: string;
  /**
   * The media data's last day, when the whole range comes after it (Today):
   * the calls are real and counted, their spend is not in yet, so a cost per
   * booking reads n/a with that reason, never $0.
   */
  spendNotIn?: string;
};

export type RangeTotals = {
  spend: number;
  impressions: number;
  linkClicks: number;
  leads: number;
  /** Calls booked in these dates, by the day they were made. */
  booked: number;
  /** Of those, the calls whose time has passed: what a show rate divides by. */
  due: number;
  /** Of those due, the calls that count as shown. */
  shown: number;
};

const SHOWN_ONCE_PAST = new Set(["confirmed", "invalid"]);
const MARKED = new Set(["showed", "noshow"]);

/**
 * Whether a call's time has passed. A call with only a day is due once that
 * day is over in Kuwait; a call already marked showed or no-show is due.
 */
export function isDue(call: StatCall, now: number): boolean {
  if (MARKED.has(call.status)) return true;
  if (call.startTime) {
    const at = Date.parse(call.startTime);
    if (Number.isFinite(at)) return at <= now;
  }
  return (
    Boolean(call.appointmentDate) &&
    String(call.appointmentDate) < kuwaitDay(now)
  );
}

export function isShown(call: StatCall, now: number): boolean {
  if (call.status === "showed") return true;
  return SHOWN_ONCE_PAST.has(call.status) && isDue(call, now);
}

const text = (v: unknown) =>
  v === null || v === undefined || v === "" ? null : String(v);
const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/**
 * The statistics function's range read, checked and reduced to what the
 * sheet counts. `through` is the paired day (mediaDataThrough), when it
 * falls inside the range: a call booked after it is not set against spend
 * that stops before it (2026-10-21), and no spend or lead after it is
 * counted either, so the two meet on one day (2026-10-22). `spendNotIn` is
 * that day when the whole range comes after it: every call is kept and no
 * spend row is (bookingsCap in mediaStatsClient.ts decides which applies).
 */
export function parseStats(
  data: unknown,
  through?: string | null,
  spendNotIn?: string | null,
): FunnelStats {
  const d = data as { rows?: unknown; bookings?: unknown } | null;
  if (!d || !Array.isArray(d.rows) || !Array.isArray(d.bookings))
    throw new Error(
      "The numbers came back in a shape this screen cannot read.",
    );
  const booked = (d.bookings as Record<string, unknown>[]).filter(
    b => !through || String(b.date ?? "") <= through,
  );
  const end = through || spendNotIn;
  return {
    rows: (d.rows as Record<string, unknown>[])
      .filter(r => !end || String(r.date ?? "") <= end)
      .map(r => ({
        adId: text(r.metaAdId),
        spend: num(r.spend),
        impressions: num(r.impressions),
        linkClicks: num(r.linkClicks),
        leads: num(r.leads),
      })),
    calls: booked.map(b => ({
      adId: text(b.adId),
      status: String(b.status ?? "").toLowerCase(),
      startTime: text(b.startTime),
      appointmentDate: text(b.appointmentDate)?.slice(0, 10) ?? null,
    })),
    ...(through ? { callsThrough: through } : {}),
    ...(spendNotIn ? { spendNotIn } : {}),
  };
}

/** The sum for one destination's ads, or null when none of them has a number or a call. */
export function totalsFor(
  stats: FunnelStats | undefined,
  ads: { id: string }[],
  now = Date.now(),
): RangeTotals | null {
  if (!stats) return null;
  const mine = new Set(ads.map(a => a.id));
  const sum: RangeTotals = {
    spend: 0,
    impressions: 0,
    linkClicks: 0,
    leads: 0,
    booked: 0,
    due: 0,
    shown: 0,
  };
  let found = false;
  for (const r of stats.rows) {
    if (!r.adId || !mine.has(r.adId)) continue;
    found = true;
    sum.spend += r.spend;
    sum.impressions += r.impressions;
    sum.linkClicks += r.linkClicks;
    sum.leads += r.leads;
  }
  for (const c of stats.calls) {
    if (!c.adId || !mine.has(c.adId)) continue;
    found = true;
    sum.booked += 1;
    if (isDue(c, now)) sum.due += 1;
    if (isShown(c, now)) sum.shown += 1;
  }
  return found ? sum : null;
}

/**
 * What the destinations leave out: spend and leads from ads that no longer
 * run, and calls the calendar could not tie to one of the ads shown.
 */
export function leftOut(
  stats: FunnelStats | undefined,
  ads: { id: string }[],
): { spend: number; leads: number; calls: number } {
  const shown = new Set(ads.map(a => a.id));
  const out = { spend: 0, leads: 0, calls: 0 };
  if (!stats) return out;
  for (const r of stats.rows)
    if (!r.adId || !shown.has(r.adId)) {
      out.spend += r.spend;
      out.leads += r.leads;
    }
  for (const c of stats.calls)
    if (!c.adId || !shown.has(c.adId)) out.calls += 1;
  return out;
}
