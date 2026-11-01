import { month as monthName, pct1, shortDate } from "@/components/ceo/format";
import type { ChurnRegister, ChurnRegisterMonth } from "@/types/ceo/payloads";

/**
 * Churn on the Backend tab, read from the churn register (Aziz, 2026-09-20:
 * "backend revenue … churn percentage and LTV of clients as well, on
 * average"). The register is the client success Churn page's own record,
 * so the CEO cockpit and the CSM read one number. Pure, so it is tested
 * without a browser (scripts/ceo-fixes-screens.test.ts).
 */

/** Where the register is kept. */
export const CHURN_PAGE = "/client-success/churn";

/** The rows, oldest first, whether the worker sent the roll-up or an object around it. */
export function registerMonths(
  reg: ChurnRegister | ChurnRegisterMonth[] | null | undefined,
): ChurnRegisterMonth[] | null {
  if (!reg) return null;
  const rows = Array.isArray(reg) ? reg : reg.months;
  if (!Array.isArray(rows)) return null;
  return rows
    .filter(r => r && typeof r.month === "string")
    .slice()
    .sort((a, b) => a.month.localeCompare(b.month));
}

/** A month has something in the register: a start, new clients, a loss or a note. */
export function inRegister(r: ChurnRegisterMonth | null | undefined): boolean {
  if (!r) return false;
  return (
    r.activeAtStart !== null ||
    r.newClients !== null ||
    r.churned > 0 ||
    (r.completed ?? 0) > 0 ||
    Boolean(r.note)
  );
}

/**
 * One register row as the CEO reads its confirm (20261101o,
 * docs/forms/WAVE12-CONTRACT.md 4.5.3): the departure's columns
 * confirmed_at and the confirming seat's role, never an address.
 */
export type RegisterDeparture = {
  client: string;
  /** YYYY-MM-DD, the day they left. */
  leftOn: string;
  /** The confirm's time (ISO), or null while the row is logged, not confirmed. */
  confirmedAt: string | null;
  /** "the CSM", "the CEO". */
  confirmedRole: string | null;
};

/** The register payload with its departure rows, when the worker sends them. */
type WithRows = { departureRows?: RegisterDeparture[] | null };

/** "Confirmed 1 Nov by the CSM", or "Logged, not confirmed". */
export function departureState(
  d: Pick<RegisterDeparture, "confirmedAt" | "confirmedRole">,
): string {
  const at = d.confirmedAt ? Date.parse(d.confirmedAt) : Number.NaN;
  if (Number.isNaN(at)) return "Logged, not confirmed";
  return `Confirmed ${shortDate(at)}${d.confirmedRole ? ` by ${d.confirmedRole}` : ""}`;
}

/**
 * "4 of 6 confirmed · 2 logged, not confirmed" for the departures that left
 * in `month` (YYYY-MM), or every row when no month is given. Null when the
 * worker sent no rows (an older payload): the confirm is then not shown,
 * never counted as none.
 */
export function confirmSummary(
  rows: RegisterDeparture[] | null | undefined,
  month?: string,
): string | null {
  if (!Array.isArray(rows)) return null;
  const mine = rows.filter(
    r =>
      r &&
      typeof r.leftOn === "string" &&
      (!month || r.leftOn.startsWith(month)),
  );
  if (!mine.length) return null;
  const done = mine.filter(
    r => departureState(r) !== "Logged, not confirmed",
  ).length;
  const open = mine.length - done;
  return open
    ? `${done} of ${mine.length} confirmed · ${open} logged, not confirmed`
    : `All ${mine.length} confirmed`;
}

export type ChurnView = {
  /** "October". */
  thisName: string;
  lastName: string;
  /** This month's churn rate, 0..1, or null when it cannot be worked out. */
  rate: number | null;
  /** The tile's line under the value. */
  sub: string;
  /** Why the rate is n/a, when it is. */
  naHint: string | null;
  /** "1 of 22 (4.5%)" for last month, or null when the register has no such month. */
  last: string | null;
  /** "4.5%, Good" for the rolling three months through this month (or last month when this one has no start). */
  rolling: string | null;
  /** How many of this month's departures are confirmed (confirmSummary), or null when the payload has no rows. */
  confirmed: string | null;
};

const ofStart = (r: ChurnRegisterMonth) =>
  r.activeAtStart === null
    ? `${r.churned} lost, no start count`
    : `${r.churned} of ${r.activeAtStart}`;

/** What the Backend tile and its facts say, for the month `thisMonth` (YYYY-MM, Kuwait). */
export function churnView(
  reg: ChurnRegister | ChurnRegisterMonth[] | null | undefined,
  thisMonth: string,
): ChurnView | null {
  const rows = registerMonths(reg);
  if (!rows) return null;
  const thisName = monthName(thisMonth, { long: true });
  const [y, m] = thisMonth.split("-").map(Number);
  const prev = `${m === 1 ? y - 1 : y}-${String(m === 1 ? 12 : m - 1).padStart(2, "0")}`;
  const lastName = monthName(prev, { long: true });
  const now = rows.find(r => r.month === thisMonth) ?? null;
  const before = rows.find(r => r.month === prev) ?? null;
  const missing = `${thisName} is not in the churn register yet; log it on the client success Churn page.`;
  const typed = inRegister(now) || Boolean(now?.startCarried);
  const rate =
    typed && now && now.churnPct !== null ? now.churnPct / 100 : null;
  let sub: string;
  let naHint: string | null = null;
  if (!typed || !now) {
    sub = missing;
    naHint = missing;
  } else if (rate === null) {
    sub = `${ofStart(now)} so far`;
    naHint = `${thisName} has no start count in the register, so there is no rate; type it on the client success Churn page.`;
  } else {
    sub = `${ofStart(now)} at the start${now.startCarried ? " (carried from the month before)" : ""}`;
  }
  const last =
    before && inRegister(before)
      ? `${ofStart(before)}${before.churnPct !== null ? ` (${pct1(before.churnPct / 100)})` : ""}`
      : null;
  const roll = (rate !== null ? now : null) ?? before;
  const rolling =
    roll && roll.rolling3Pct !== null
      ? `${pct1(roll.rolling3Pct / 100)}${roll.band ? `, ${roll.band.label}` : ""}${roll === before ? ` (through ${lastName})` : ""}`
      : null;
  const confirmed = Array.isArray(reg)
    ? null
    : confirmSummary((reg as WithRows).departureRows, thisMonth);
  return { thisName, lastName, rate, sub, naHint, last, rolling, confirmed };
}
