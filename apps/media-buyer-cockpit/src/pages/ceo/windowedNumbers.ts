import { inWindow, startsLate, sumIn } from "@/components/ceo/tabWindow";
import type {
  ChurnRegister,
  ChurnRegisterMonth,
  ClientRow,
  ClientsPayload,
  TeamPerson,
  Transaction,
} from "@/types/ceo/payloads";
import { registerMonths } from "./churnRegister";

/**
 * The numbers the timeframe bar drives on Client success, Today, Management
 * and Recruiting (A127/A170), each rebuilt from the per-day series the worker
 * keeps. Where a series is not kept, the answer is null with the reason,
 * never a zero. Pure, so it is tested without a browser
 * (scripts/ceo-fixes-screens.test.ts).
 */

type Win = { range: string; from: string; to: string };

/** What a card says when the worker has not sent the per-day series yet. */
export const NOT_PER_DAY =
  "Not kept per day yet: this number shows for its own fixed window until the next refresh brings the per-day series.";

// --- Client success: per-client spend, leads, cost per lead, bookings ---

export type ClientNumbers = {
  spend: number | null;
  leads: number | null;
  cpl: number | null;
  bookings: number | null;
  /** Why the numbers are n/a, when they are. */
  why: string | null;
  /** Where they came from: the server's own 7 days, or a sum of days. */
  from: "fixed7" | "daily" | null;
};

/**
 * One client's numbers for the window. The 7-day preset keeps the server's
 * own 7-day columns (bookings there are the client's whole GoHighLevel
 * count); any other window is a sum of the client's days (bookings tied to
 * the client's campaigns, future appointments left out).
 */
export function clientNumbers(
  row: Pick<ClientRow, "leads7d" | "cpl7d" | "bookings7d" | "daily">,
  w: Win | null,
  dailyFrom: string | null | undefined,
  noCampaign: string,
): ClientNumbers {
  if (!w || w.range === "7d")
    return {
      spend: null,
      leads: row.leads7d,
      cpl: row.cpl7d,
      bookings: row.bookings7d,
      why: null,
      from: "fixed7",
    };
  if (row.daily === undefined)
    return {
      spend: null,
      leads: null,
      cpl: null,
      bookings: null,
      why: NOT_PER_DAY,
      from: null,
    };
  if (row.daily === null)
    return {
      spend: null,
      leads: null,
      cpl: null,
      bookings: null,
      why:
        dailyFrom === null
          ? "The per-day media history could not be read this run."
          : noCampaign,
      from: null,
    };
  const spend = sumIn(row.daily, w, d => d.spend) ?? 0;
  const leads = sumIn(row.daily, w, d => d.leads) ?? 0;
  const bookings = sumIn(row.daily, w, d => d.bookings) ?? 0;
  return {
    spend,
    leads,
    bookings,
    cpl: leads > 0 ? Math.round((spend / leads) * 100) / 100 : null,
    why: leads > 0 ? null : "No leads in these days, so no cost per lead.",
    from: "daily",
  };
}

// --- Client success: extensions granted ---

type Ext = NonNullable<ClientsPayload["extensions"]>;

export type ExtensionsView = {
  totalWeeks: number | null;
  grants: number | null;
  perClient: Ext["perClient"];
  /** Why the window's numbers are n/a. */
  why: string | null;
};

/**
 * Weeks granted in the window and each client's grants, plus any cover still
 * running today. Built from the grant rows; without them only the server's
 * own month to date (or last month) can be shown.
 */
export function extensionsIn(
  ext: Ext | null | undefined,
  w: Win | null,
  today: string,
): ExtensionsView {
  if (!ext)
    return {
      totalWeeks: null,
      grants: null,
      perClient: [],
      why: "The Client Extension Form was not read this run.",
    };
  if (!w || (w.from === ext.from && w.to === ext.to))
    return {
      totalWeeks: ext.totalWeeks,
      grants: ext.grants,
      perClient: ext.perClient,
      why: null,
    };
  const rows = ext.grantRows;
  if (!Array.isArray(rows)) {
    const lm = ext.lastMonth;
    if (lm && w.from === lm.from && w.to === lm.to)
      return {
        totalWeeks: lm.totalWeeks,
        grants: lm.grants,
        perClient: [],
        why: null,
      };
    return { totalWeeks: null, grants: null, perClient: [], why: NOT_PER_DAY };
  }
  const key = (r: { taskId: string | null; client: string }) =>
    r.taskId ?? `name:${r.client}`;
  const latest = new Map<string, (typeof rows)[number]>();
  for (const r of rows) {
    const k = key(r);
    const prev = latest.get(k);
    if (!prev || r.until > prev.until) latest.set(k, r);
  }
  const inside = rows.filter(r => inWindow(r.day, w));
  const weeks = new Map<string, number>();
  for (const r of inside) weeks.set(key(r), (weeks.get(key(r)) ?? 0) + r.weeks);
  const perClient: Ext["perClient"] = [...latest.entries()]
    .filter(([k, r]) => weeks.has(k) || r.until >= today)
    .map(([k, r]) => ({
      client: r.client,
      clickupTaskId: r.taskId,
      weeks: weeks.get(k) ?? 0,
      until: r.until,
      live: r.until >= today,
    }))
    .sort((a, b) => b.weeks - a.weeks || a.client.localeCompare(b.client));
  return {
    totalWeeks: inside.reduce((t, r) => t + r.weeks, 0),
    grants: inside.length,
    perClient,
    why: null,
  };
}

// --- Client success and Backend: churn from the register over the window ---

export type RegisterWindow = {
  /** Months the window touches, oldest first ("2026-09"). */
  months: string[];
  churned: number;
  /** Clients active at the start of those months, added up; null when none has a start. */
  starts: number | null;
  /** churned over starts, 0..1. */
  rate: number | null;
  /** Months the window touches that the register has nothing for. */
  missing: string[];
};

/** Churn is kept by month, so a window counts every month it touches. */
export function registerIn(
  reg: ChurnRegister | ChurnRegisterMonth[] | null | undefined,
  w: Win | null,
): RegisterWindow | null {
  const rows = registerMonths(reg);
  if (!rows || !w) return null;
  const months: string[] = [];
  for (let m = w.from.slice(0, 7); m <= w.to.slice(0, 7); m = nextMonth(m))
    months.push(m);
  const byMonth = new Map(rows.map(r => [r.month, r]));
  let churned = 0;
  let starts = 0;
  let withStart = 0;
  const missing: string[] = [];
  for (const m of months) {
    const r = byMonth.get(m);
    if (!r || (r.activeAtStart === null && r.churned === 0 && !r.newClients)) {
      missing.push(m);
      continue;
    }
    churned += r.churned;
    if (r.activeAtStart !== null) {
      starts += r.activeAtStart;
      withStart += 1;
    }
  }
  return {
    months,
    churned,
    starts: withStart ? starts : null,
    rate:
      withStart && starts > 0
        ? Math.round((churned / starts) * 1000) / 1000
        : null,
    missing,
  };
}

function nextMonth(m: string): string {
  const [y, mo] = m.split("-").map(Number);
  return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, "0")}`;
}

// --- Client success: portal seen ---

/**
 * Clients whose portal was opened in the window. Only the last visit is
 * kept, so a window that ends before the newest day cannot be answered.
 */
export function seenIn(
  rows: Pick<ClientRow, "portalLastSeenAt">[],
  w: Win | null,
  last: string,
  dayStartMs: (day: string) => number,
): { seen: number; why: string | null } | null {
  if (!w) return null;
  if (w.to < last)
    return {
      seen: 0,
      why: "The portal keeps only each client's last visit, not visits per day, so a window that ends before today cannot be counted.",
    };
  const since = dayStartMs(w.from);
  return {
    seen: rows.filter(
      r =>
        typeof r.portalLastSeenAt === "number" && r.portalLastSeenAt >= since,
    ).length,
    why: null,
  };
}

// --- Management and Today: EODs ---

export type EodCount = {
  due: number;
  filed: number;
  late: number;
  missed: number;
};

/** One person's EODs in the window, from their days; null when the days are not kept. */
export function eodIn(
  p: Pick<TeamPerson, "eodDays">,
  w: Win | null,
): EodCount | null {
  if (!w || !Array.isArray(p.eodDays)) return null;
  let due = 0;
  let filed = 0;
  let late = 0;
  for (const d of p.eodDays) {
    if (!inWindow(d.date, w) || !d.due) continue;
    due += 1;
    if (d.filed) filed += 1;
    if (d.filed && d.late) late += 1;
  }
  return { due, filed, late, missed: due - filed };
}

/**
 * The team with every person's `eod14` replaced by the window's count, so
 * each card that reads `eod14` follows the bar. Without per-day EODs the
 * people stay as they are (the last 14 working days) and `kept` is false.
 */
export function teamInWindow<T extends Pick<TeamPerson, "eod14" | "eodDays">>(
  people: T[],
  w: Win | null,
): { people: T[]; kept: boolean } {
  if (!w || !people.some(p => Array.isArray(p.eodDays)))
    return { people, kept: false };
  return {
    people: people.map(p => {
      const c = eodIn(p, w);
      return c ? { ...p, eod14: c } : p;
    }),
    kept: true,
  };
}

// --- Recruiting: applied and hired ---

/** Applications or hires in the window; null when the series is not kept. */
export function countIn(
  series: { date: string; count: number }[] | null | undefined,
  w: Win | null,
): number | null {
  if (!w) return null;
  return sumIn(series, w, r => r.count);
}

// --- Today: refunds over the window ---

/**
 * Refunds in the window from the Transactions ledger (Whop refunds and
 * refunds logged by hand). null when the window starts before the ledger.
 */
export function refundsIn(
  tx: Pick<Transaction, "day" | "kind" | "usd">[] | null | undefined,
  ledgerFrom: string | null | undefined,
  w: Win | null,
): number | null {
  if (!w || !Array.isArray(tx) || startsLate(ledgerFrom, w)) return null;
  return (
    Math.round(
      tx
        .filter(t => t.kind === "refund" && inWindow(t.day, w))
        .reduce((s, t) => s + Math.abs(t.usd), 0) * 100,
    ) / 100
  );
}
