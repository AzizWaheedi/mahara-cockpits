// Preserves the original CEO people.ts shaping and fixed-rate arithmetic.
import {COMMISSION_BASES, type CommissionBasis} from "../types/ceo/commission";
import {parseSchedule} from "../types/ceo/schedule";
import type {Person,Roster} from "../types/ceo/people";
type Row = Record<string, unknown>;
// Same fixed rates as convex/ceo/data/tap.ts; migration tests pin parity.
const USD_PER: Record<string,number> = {USD:1,KWD:3.26,AED:0.2723,SAR:0.2666,QAR:0.2747};
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
    commission: {
      basis: (COMMISSION_BASES as readonly string[]).includes(
        String(r.commission_basis ?? ""),
      )
        ? (String(r.commission_basis) as CommissionBasis)
        : "none",
      rate:
        r.commission_rate === null || r.commission_rate === undefined
          ? null
          : Number(r.commission_rate),
    },
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
 const people=rows.map(shape);
 const working=people.filter(p=>p.working);
 const paused=people.filter(p=>p.active && p.pausedOn && p.engagement!=="bot");
 const cost=(list:Person[])=>round2(list.reduce((n,p)=>n+(p.monthlyUsd??0),0));
 return {people,ready:true,activeCount:working.length,activeMonthlyUsd:cost(working),
 pausedCount:paused.length,pausedMonthlyUsd:cost(paused),botCount:people.filter(p=>p.engagement==="bot").length,
 salesMonthlyUsd:cost(working.filter(p=>p.isSales)),missingCost:working.filter(p=>p.monthlyUsd===null).map(p=>p.name)};
}
export function peopleRoles(rows: Row[]): string[] {
 const custom=new Set(rows.map(r=>String(r.role??"").trim()).filter(Boolean)
 .filter(r=>!TEAM_ROLES.some(t=>t.toLowerCase()===r.toLowerCase())));
 return [...TEAM_ROLES,...[...custom].sort()];
}
