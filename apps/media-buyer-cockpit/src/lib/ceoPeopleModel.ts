// Preserves the original CEO people.ts shaping and fixed-rate arithmetic.
import {
  COMMISSION_BASES,
  type CommissionBasis,
  type CommissionLine,
} from "../types/ceo/commission";
import type { Person, Roster } from "../types/ceo/people";
import { parseSchedule } from "../types/ceo/schedule";

type Row = Record<string, unknown>;
// Same fixed rates as convex/ceo/data/tap.ts; migration tests pin parity.
const USD_PER: Record<string, number> = {
  USD: 1,
  KWD: 3.26,
  AED: 0.2723,
  SAR: 0.2666,
  QAR: 0.2747,
};
export const TEAM_ROLES = [
  "CEO",
  "Systems manager",
  "General VA",
  "Creative strategist",
  "Media buyer",
  "Call centre agent",
  "B2B setter",
  "Closer",
  "Client success manager",
  "Video editor",
  "Bot",
] as const;
const round2 = (x: number) => Math.round(x * 100) / 100;

/**
 * A basis as stored. Empty is no commission (a roster from before the
 * two-line migration has no second line). A value this code does not know
 * is kept as an explicit unknown, never read as "none": that would count a
 * real commission as $0 and a save would wipe it (the database learns a
 * basis before the installed app does). It reads as "other", which Costs
 * never prices and always names, and carries the raw value for the screen's
 * "Unknown rule: <value>".
 */
export function basisOf(v: unknown): {
  basis: CommissionBasis;
  unknown?: string;
} {
  const raw = String(v ?? "").trim();
  if (!raw) return { basis: "none" };
  return (COMMISSION_BASES as readonly string[]).includes(raw)
    ? { basis: raw as CommissionBasis }
    : { basis: "other", unknown: raw };
}
const rateOf = (v: unknown) =>
  v === null || v === undefined ? null : Number(v);
/** A roster line: line 1 keeps its rate as stored; line 2 has none without a basis. */
function lineOf(
  basis: unknown,
  rate: unknown,
  second: boolean,
): CommissionLine {
  const b = basisOf(basis);
  return {
    ...b,
    rate: second && b.basis === "none" ? null : rateOf(rate),
  };
}

function shape(r: Row): Person {
  const cost = r.monthly_cost === null ? null : Number(r.monthly_cost);
  const currency = String(r.currency ?? "USD").toUpperCase();
  const rate = USD_PER[currency];
  return {
    id: Number(r.id),
    name: String(r.name),
    email: r.email ? String(r.email) : null,
    role: r.role ? String(r.role) : null,
    engagement: String(r.engagement ?? "staff") as Person["engagement"],
    active: Boolean(r.active),
    pausedOn: r.paused_on ? String(r.paused_on) : null,
    pausedWhy: r.paused_why ? String(r.paused_why) : null,
    working:
      Boolean(r.active) &&
      !r.paused_on &&
      String(r.engagement ?? "staff") !== "bot",
    monthlyCost: cost,
    currency,
    monthlyUsd:
      cost === null || rate === undefined ? null : round2(cost * rate),
    commission: lineOf(r.commission_basis, r.commission_rate, false),
    // Absent before the two-line migration (20261011d): no second line.
    commission2: lineOf(r.commission2_basis, r.commission2_rate, true),
    commissionPct:
      r.commission_pct === null || r.commission_pct === undefined
        ? null
        : Number(r.commission_pct),
    commissionNote: r.commission_note ? String(r.commission_note) : null,
    isSales: Boolean(r.is_sales),
    startedOn: r.started_on ? String(r.started_on) : null,
    endedOn: r.ended_on ? String(r.ended_on) : null,
    note: r.note ? String(r.note) : null,
    schedule: parseSchedule(r.schedule),
    source: String(r.source ?? "manual"),
  };
}

export function peopleRoster(rows: Row[]): Roster {
  const people = rows.map(shape);
  const working = people.filter(p => p.working);
  const paused = people.filter(
    p => p.active && p.pausedOn && p.engagement !== "bot",
  );
  const cost = (list: Person[]) =>
    round2(list.reduce((n, p) => n + (p.monthlyUsd ?? 0), 0));
  return {
    people,
    ready: true,
    activeCount: working.length,
    activeMonthlyUsd: cost(working),
    pausedCount: paused.length,
    pausedMonthlyUsd: cost(paused),
    botCount: people.filter(p => p.engagement === "bot").length,
    salesMonthlyUsd: cost(working.filter(p => p.isSales)),
    missingCost: working.filter(p => p.monthlyUsd === null).map(p => p.name),
  };
}
export function peopleRoles(rows: Row[]): string[] {
  const custom = new Set(
    rows
      .map(r => String(r.role ?? "").trim())
      .filter(Boolean)
      .filter(r => !TEAM_ROLES.some(t => t.toLowerCase() === r.toLowerCase())),
  );
  return [...TEAM_ROLES, ...[...custom].sort()];
}
