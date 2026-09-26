/**
 * The setter's rhythm, from Maqsam's calls, with the CEO cockpit's rules
 * (apps/media-buyer-cockpit/src/pages/ceo/SOURCES.md and convex/ceo/
 * adapters/growth.ts, workingHours.ts):
 *
 * - Speed to lead: for each lead (the ROAS-tagged contacts created in the
 *   window), the time from creation to the first Maqsam call with them by a
 *   sales rep, in either direction and whatever its outcome, matched on the
 *   phone's last eight digits. The median on the plain clock and in working
 *   minutes, the share within five minutes, and the leads never called
 *   counted beside it, never inside it.
 * - Gap between calls: from the end of one outbound call (ringing and talk)
 *   to the start of the same rep's next one, never below zero, inside the
 *   working window of the same day; any other call in between (an inbound
 *   one, or one with no timing) breaks the chain. The average and how many
 *   gaps were measured.
 *
 * Working hours are the company's default, 10:00 to 18:00 Kuwait time,
 * Saturday to Thursday, until a rep has a schedule of their own.
 */

export const WORKING = {
  start: 10,
  end: 18,
  days: [6, 0, 1, 2, 3, 4],
} as const;

export interface CallRow {
  occurred_at: string | null;
  agent_email: string | null;
  direction: string | null;
  state: string | null;
  duration_s: number | null;
  ringing_s: number | null;
  lead_phone8: string | null;
  sales_rep_id?: string | null;
}

export interface LeadRow {
  contact_id: string;
  phone8: string | null;
  lead_created_at: string | null;
}

const KUWAIT = 3 * 3_600_000;
const t = (iso: string | null) => {
  const v = iso ? Date.parse(iso) : Number.NaN;
  return Number.isFinite(v) ? v : null;
};
const kuwaitDay = (ms: number) => Math.floor((ms + KUWAIT) / 86_400_000);

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export interface SpeedToLead {
  /** Leads created in the window. */
  leads: number;
  called: number;
  never: number;
  /** Minutes, median over the leads called, on the plain clock. */
  medianMin: number | null;
  /** The same, counting working hours only. */
  medianWorkingMin: number | null;
  /** Called within five minutes of coming in. */
  within5: number;
}

/** Minutes of working time between two moments (Kuwait's working window). */
export function workingMinutes(from: number, to: number): number {
  if (to <= from) return 0;
  let total = 0;
  let day = kuwaitDay(from);
  const last = kuwaitDay(to);
  for (; day <= last; day++) {
    const dow = new Date(day * 86_400_000).getUTCDay();
    if (!(WORKING.days as readonly number[]).includes(dow)) continue;
    const open = day * 86_400_000 - KUWAIT + WORKING.start * 3_600_000;
    const close = day * 86_400_000 - KUWAIT + WORKING.end * 3_600_000;
    total += Math.max(0, Math.min(close, to) - Math.max(open, from));
  }
  return total / 60_000;
}

/**
 * Speed to lead over these leads. `firstBy`, when given, keeps only leads
 * whose first call was that rep's (the first caller's cohort), and leaves
 * the never-called out, since they are nobody's yet.
 */
export function speedToLead(
  leads: LeadRow[],
  calls: CallRow[],
  firstBy?: string | null,
): SpeedToLead {
  const byPhone = new Map<string, { at: number; agent: string }[]>();
  for (const c of calls) {
    if (c.sales_rep_id === null) continue; // a call-centre agent's call never counts
    const at = t(c.occurred_at);
    const k = String(c.lead_phone8 ?? "");
    if (!k || at === null) continue;
    byPhone.set(k, [
      ...(byPhone.get(k) ?? []),
      { at, agent: String(c.agent_email ?? "").toLowerCase() },
    ]);
  }
  const mins: number[] = [];
  const working: number[] = [];
  let never = 0;
  let counted = 0;
  for (const l of leads) {
    const created = t(l.lead_created_at);
    if (created === null) continue;
    const first = (byPhone.get(String(l.phone8 ?? "")) ?? [])
      .filter(c => c.at >= created)
      .sort((a, b) => a.at - b.at)[0];
    if (!first) {
      if (!firstBy) {
        never += 1;
        counted += 1;
      }
      continue;
    }
    if (firstBy && first.agent !== firstBy.toLowerCase()) continue;
    counted += 1;
    mins.push((first.at - created) / 60_000);
    working.push(workingMinutes(created, first.at));
  }
  return {
    leads: counted,
    called: mins.length,
    never,
    medianMin: median(mins),
    medianWorkingMin: median(working),
    within5: mins.filter(m => m <= 5).length,
  };
}

export interface CallGaps {
  /** Gaps measured. */
  samples: number;
  averageMin: number | null;
  medianMin: number | null;
}

const ENDED = new Set([
  "completed",
  "no_answer",
  "no-answer",
  "busy",
  "failed",
  "blocked",
  "timeout",
  "rejected",
  "cancelled",
  "abandoned",
]);

/** The gaps between one rep's (or each rep's) consecutive outbound calls in working hours. */
export function callGaps(calls: CallRow[]): CallGaps {
  const byAgent = new Map<string, { start: number; end: number | null }[]>();
  for (const c of calls) {
    const start = t(c.occurred_at);
    const agent = String(c.agent_email ?? "").toLowerCase();
    if (start === null || !agent) continue;
    // An outbound call with its timing is a link in the chain; anything else breaks it.
    const outbound = String(c.direction ?? "").toLowerCase() === "outbound";
    const timed =
      c.duration_s !== null &&
      c.duration_s !== undefined &&
      c.ringing_s !== null &&
      c.ringing_s !== undefined;
    const eligible =
      outbound && timed && ENDED.has(String(c.state ?? "").toLowerCase());
    const end = eligible
      ? start + (Number(c.ringing_s) + Number(c.duration_s)) * 1000
      : null;
    byAgent.set(agent, [...(byAgent.get(agent) ?? []), { start, end }]);
  }
  const inHours = (ms: number) => {
    const d = new Date(ms + KUWAIT);
    const h = d.getUTCHours() + d.getUTCMinutes() / 60;
    return (
      (WORKING.days as readonly number[]).includes(d.getUTCDay()) &&
      h >= WORKING.start &&
      h < WORKING.end
    );
  };
  const gaps: number[] = [];
  for (const list of byAgent.values()) {
    list.sort((a, b) => a.start - b.start);
    for (let i = 1; i < list.length; i++) {
      const prev = list[i - 1];
      const next = list[i];
      if (prev.end === null || next.end === null) continue;
      if (kuwaitDay(prev.start) !== kuwaitDay(next.start)) continue;
      if (!inHours(prev.start) || !inHours(next.start)) continue;
      gaps.push(Math.max(0, next.start - prev.end) / 60_000);
    }
  }
  return {
    samples: gaps.length,
    averageMin: gaps.length
      ? gaps.reduce((a, b) => a + b, 0) / gaps.length
      : null,
    medianMin: median(gaps),
  };
}

/** "45 s", "3.5 min", "2 h 10 min". */
export function minutesWords(min: number | null): string | null {
  if (min === null) return null;
  if (min < 1) return `${Math.round(min * 60)} s`;
  if (min < 60) return `${Math.round(min * 10) / 10} min`;
  const h = Math.floor(min / 60);
  return `${h} h ${Math.round(min - h * 60)} min`;
}
