import type { WorkingHours } from "./payloads";

/**
 * The working clock for speed to lead (Aziz, 2026-09-21, item 10).
 *
 * The rule in one sentence: the clock starts at the later of the lead's
 * creation and the next working window, and only working minutes count. A
 * lead that lands Friday night is not late until Saturday 10:00; a lead that
 * lands at 17:50 gets ten minutes today and the rest the next working day.
 *
 * Two implementations of the same rule live here on purpose:
 * - the pure functions, unit-tested in scripts/working-hours.test.ts and
 *   usable on the screen;
 * - `workingMinutesSql`, the same arithmetic as a Postgres expression, so an
 *   adapter can take the median over every lead inside its own query.
 * The tests pin the pure functions; the SQL is checked against them by hand
 * on real leads (see the calls adapter's session note).
 *
 * The hours come from cockpit_settings (key working_hours) in Creative
 * Triage, read by convex/ceo/settings.ts, or the default below.
 */

/** When nothing is saved: 10:00 to 18:00 Kuwait, Saturday to Thursday. */
export const DEFAULT_WORKING_HOURS: WorkingHours = {
  start: "10:00",
  end: "18:00",
  days: [6, 7, 1, 2, 3, 4],
  timezone: "Asia/Kuwait",
  source: "default",
};

/** The row key in cockpit_settings. */
export const WORKING_HOURS_KEY = "working_hours";

/** The only zone the clock runs on today; the field exists so it can widen. */
export const TIMEZONES = ["Asia/Kuwait"] as const;

/** ISO weekdays in Kuwait's week order: Saturday first, Friday (the day off) last. */
export const WEEK_ORDER: readonly number[] = [6, 7, 1, 2, 3, 4, 5];

export const DAY_NAMES: Record<number, string> = {
  1: "Monday",
  2: "Tuesday",
  3: "Wednesday",
  4: "Thursday",
  5: "Friday",
  6: "Saturday",
  7: "Sunday",
};

export const DAY_SHORT: Record<number, string> = {
  1: "Mon",
  2: "Tue",
  3: "Wed",
  4: "Thu",
  5: "Fri",
  6: "Sat",
  7: "Sun",
};

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const MIN = 60_000;
const DAY = 24 * 60 * MIN;

/** "HH:MM" as minutes past midnight, or a plain sentence. */
export function parseTime(t: string, label = "A time"): number {
  const m = TIME_RE.exec(String(t ?? "").trim());
  if (!m) throw new Error(`${label} looks like 10:00 or 18:30 (24-hour).`);
  return Number(m[1]) * 60 + Number(m[2]);
}

export type WorkingHoursInput = {
  start: string;
  end: string;
  days: number[];
  timezone?: string;
};

/**
 * Checked and tidied hours, or a plain sentence saying what is wrong: times
 * are HH:MM with the end after the start, days are ISO weekdays 1 (Monday)
 * to 7 (Sunday) with no repeats and at least one, the zone is one of
 * TIMEZONES. Days come back in Kuwait's week order.
 */
export function normalizeWorkingHours(
  input: WorkingHoursInput,
  source: WorkingHours["source"],
  updatedAt: number | null = null,
): WorkingHours {
  const start = String(input.start ?? "").trim();
  const end = String(input.end ?? "").trim();
  const from = parseTime(start, "The start");
  const to = parseTime(end, "The end");
  if (to <= from)
    throw new Error("The end of the day must be after its start.");
  if (!Array.isArray(input.days) || input.days.length === 0)
    throw new Error("Pick at least one working day.");
  const days = [...new Set(input.days.map(d => Number(d)))];
  if (days.some(d => !Number.isInteger(d) || d < 1 || d > 7))
    throw new Error("Days are ISO weekdays: 1 (Monday) to 7 (Sunday).");
  days.sort((a, b) => WEEK_ORDER.indexOf(a) - WEEK_ORDER.indexOf(b));
  const timezone = String(
    input.timezone ?? DEFAULT_WORKING_HOURS.timezone,
  ).trim();
  if (!(TIMEZONES as readonly string[]).includes(timezone))
    throw new Error(`The clock runs on ${TIMEZONES.join(", ")} only for now.`);
  return { start, end, days, timezone, source, updatedAt };
}

/**
 * A stored jsonb value as hours, or null when it cannot be read; the caller
 * falls back to the default and says so.
 */
export function workingHoursFromStored(
  value: unknown,
  updatedAt: number | null = null,
): WorkingHours | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  try {
    return normalizeWorkingHours(
      {
        start: String(v.start ?? ""),
        end: String(v.end ?? ""),
        days: Array.isArray(v.days) ? v.days.map(Number) : [],
        timezone: v.timezone === undefined ? undefined : String(v.timezone),
      },
      "settings",
      updatedAt,
    );
  } catch {
    return null;
  }
}

/** "Saturday to Thursday", "every day", or the days listed. */
export function daysLabel(days: number[]): string {
  const ordered = [...new Set(days)].sort(
    (a, b) => WEEK_ORDER.indexOf(a) - WEEK_ORDER.indexOf(b),
  );
  if (ordered.length === 0) return "no days";
  if (ordered.length === 7) return "every day";
  const idx = ordered.map(d => WEEK_ORDER.indexOf(d));
  const contiguous = idx.every((x, i) => i === 0 || x === idx[i - 1] + 1);
  if (contiguous && ordered.length >= 3)
    return `${DAY_NAMES[ordered[0]]} to ${DAY_NAMES[ordered[ordered.length - 1]]}`;
  const names = ordered.map(d => DAY_NAMES[d]);
  return names.length === 1
    ? names[0]
    : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** "10:00 to 18:00 Asia/Kuwait, Saturday to Thursday". */
export function describeWorkingHours(h: WorkingHours): string {
  return `${h.start} to ${h.end} ${h.timezone}, ${daysLabel(h.days)}`;
}

// --- The clock, in code --------------------------------------------------------

/** Zones without daylight saving, so the Convex runtime needs no Intl data. */
const FIXED_OFFSET_MIN: Record<string, number> = { "Asia/Kuwait": 180 };

/** Wall-clock offset of `timezone` at an instant, in ms. */
function offsetMs(timezone: string, atMs: number): number {
  const fixed = FIXED_OFFSET_MIN[timezone];
  if (fixed !== undefined) return fixed * MIN;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(atMs));
  const get = (type: string) =>
    Number(parts.find(p => p.type === type)?.value ?? 0);
  const wall = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  return wall - Math.floor(atMs / 1000) * 1000;
}

/** ISO weekday (1 Monday to 7 Sunday) of a local day counted from the epoch. */
function isoWeekday(localDay: number): number {
  const d = new Date(localDay * DAY).getUTCDay();
  return d === 0 ? 7 : d;
}

type Clock = { off: number; open: number; close: number; days: Set<number> };

function clock(hours: WorkingHours, atMs: number): Clock {
  return {
    off: offsetMs(hours.timezone, atMs),
    open: parseTime(hours.start) * MIN,
    close: parseTime(hours.end) * MIN,
    days: new Set(hours.days),
  };
}

/**
 * Working minutes between two instants: the overlap of [from, to] with each
 * working day's window, summed. 0 when `to` is not after `from`. Fractional.
 */
export function workingMinutesBetween(
  fromMs: number,
  toMs: number,
  hours: WorkingHours,
): number {
  if (!(toMs > fromMs)) return 0;
  const c = clock(hours, fromMs);
  const from = fromMs + c.off;
  const to = toMs + c.off;
  let total = 0;
  for (let day = Math.floor(from / DAY); day <= Math.floor(to / DAY); day++) {
    if (!c.days.has(isoWeekday(day))) continue;
    const open = day * DAY + c.open;
    const close = day * DAY + c.close;
    total += Math.max(0, Math.min(to, close) - Math.max(from, open));
  }
  return total / MIN;
}

/**
 * When the clock starts for a lead: its creation when that falls inside a
 * working window, otherwise the start of the next one. Epoch ms.
 */
export function clockStart(createdMs: number, hours: WorkingHours): number {
  const c = clock(hours, createdMs);
  const local = createdMs + c.off;
  const first = Math.floor(local / DAY);
  for (let day = first; day <= first + 7; day++) {
    if (!c.days.has(isoWeekday(day))) continue;
    const open = day * DAY + c.open;
    if (local < open) return open - c.off;
    if (local < day * DAY + c.close) return createdMs;
  }
  // No working day in a whole week: normalizeWorkingHours refuses that, so
  // the plain clock is the honest fallback rather than never.
  return createdMs;
}

// --- The clock, in SQL ---------------------------------------------------------

/**
 * The same rule as a Postgres expression, for an adapter's query.
 *
 * `createdExpr` and `callExpr` are timestamptz expressions (a column, or a
 * CTE column). The result is numeric working minutes, or null when either
 * side is null. It generates one row per calendar day in `timezone` between
 * the two instants, keeps the working weekdays, builds each day's window in
 * that zone, and sums the overlap of [created, call] with the windows. A
 * call before the clock starts overlaps nothing and reads 0, which is the
 * rule: the team was not late.
 *
 * The hours go through normalizeWorkingHours first, so only HH:MM literals,
 * weekday integers and a listed zone ever reach the query text.
 *
 * Use it in a CTE that already has both timestamps per lead:
 *
 *   clocked as (
 *     select f.*, ${workingMinutesSql("f.created_at", "f.first_call", hours)} as working_min
 *     from first_calls f
 *   )
 *
 * then aggregate over working_min (percentile_cont for the median, a filter
 * `working_min <= 5` for the share within five working minutes).
 */
export function workingMinutesSql(
  createdExpr: string,
  callExpr: string,
  hours: WorkingHours,
): string {
  const h = normalizeWorkingHours(hours, hours.source, hours.updatedAt ?? null);
  const days = h.days.join(", ");
  return `(case when (${createdExpr}) is null or (${callExpr}) is null then null else (
    select coalesce(sum(greatest(0, extract(epoch from
      least((${callExpr}), w.closes) - greatest((${createdExpr}), w.opens)))), 0) / 60
    from (
      select (d::date + time '${h.start}') at time zone '${h.timezone}' as opens,
        (d::date + time '${h.end}') at time zone '${h.timezone}' as closes
      from generate_series(
        date_trunc('day', (${createdExpr}) at time zone '${h.timezone}'),
        date_trunc('day', (${callExpr}) at time zone '${h.timezone}'),
        interval '1 day') as d
      where extract(isodow from d) in (${days})
    ) w) end)`;
}
