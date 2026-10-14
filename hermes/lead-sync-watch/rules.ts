/**
 * The rules of the lead sync watch, with no I/O, so every case is a unit test.
 *
 * Meta's lead count for a client is compared with the leads that reached its
 * CRM (GoHighLevel) over the same window. Aziz's rule (2026-10-14):
 *   - gap:     over the last 24 hours the CRM is 30% or more below Meta AND at
 *              least 3 leads are missing;
 *   - stalled: the CRM got 0 leads in the last 6 hours while Meta reported 3+.
 * A condition must hold on 2 runs in a row before it alerts (one bad read is
 * not an incident), and must stay clear on 3 runs in a row before the alert
 * is closed (no flapping). A count that could not be read is null and the
 * client is "unknown": it never alerts on missing data.
 */

export type State = "ok" | "gap" | "stalled" | "watch" | "quiet" | "unknown" | "unlinked";

export const RULES = {
  gapRatio: 0.7, // CRM at or below 70% of Meta = 30%+ below
  gapMin: 3, // and at least 3 leads missing
  stallMeta: 3, // Meta 3+ in 6h while the CRM has 0
  confirmRuns: 2,
  clearRuns: 3,
  minToJudge: 3, // under 3 Meta leads in 24h there is nothing to compare
  crmStaleMin: 90, // the cockpit's copy of the CRM must be this fresh to judge
} as const;

export type Counts = {
  meta24: number | null;
  crm24: number | null;
  crmMeta24: number | null;
  meta6: number | null;
  crm6: number | null;
};

export type Prior = {
  strikes: number;
  clears: number;
  episodeId: string | null;
  gapSince: string | null;
  alertTs: string | null;
};

export type Verdict = {
  state: State;
  reason: string;
  missing: number | null;
  strikes: number;
  clears: number;
  episodeId: string | null;
  gapSince: string | null;
  /** Post the alert for this episode (once; the ledger makes it idempotent). */
  sendAlert: boolean;
  /** Post the "fixed" reply for this episode. */
  sendResolved: boolean;
};

const n = (x: number | null) => (x === null ? "?" : String(x));

/** Is the raw condition present in this one reading? */
export function condition(c: Counts): { hit: "gap" | "stalled" | null; why: string } {
  if (c.meta6 !== null && c.crm6 !== null && c.crm6 === 0 && c.meta6 >= RULES.stallMeta)
    return { hit: "stalled", why: `Meta reported ${c.meta6} leads in the last 6 hours and none reached the CRM.` };
  if (c.meta24 !== null && c.crm24 !== null) {
    const missing = c.meta24 - c.crm24;
    if (missing >= RULES.gapMin && c.crm24 <= c.meta24 * RULES.gapRatio)
      return {
        hit: "gap",
        why: `Meta reported ${c.meta24} leads in the last 24 hours, the CRM has ${c.crm24}: ${missing} missing (${Math.round((missing / c.meta24) * 100)}%).`,
      };
  }
  return { hit: null, why: "" };
}

/** "Counts match again": the bar to close an episode is stricter than the bar to stay quiet. */
export function matched(c: Counts): boolean {
  if (c.meta24 === null || c.crm24 === null) return false;
  if (c.meta6 !== null && c.crm6 !== null && c.meta6 >= RULES.stallMeta && c.crm6 === 0) return false;
  return c.meta24 - c.crm24 <= 1 || c.crm24 >= c.meta24 * 0.9;
}

export function decide(input: {
  linked: boolean;
  metaReadOk: boolean;
  crmFresh: boolean;
  counts: Counts;
  prior: Prior;
  nowIso: string;
  clientKey: string;
}): Verdict {
  const { counts: c, prior } = input;
  const missing = c.meta24 !== null && c.crm24 !== null ? c.meta24 - c.crm24 : null;
  const keep = { strikes: prior.strikes, clears: prior.clears, episodeId: prior.episodeId, gapSince: prior.gapSince };
  const base = { missing, sendAlert: false, sendResolved: false };

  if (!input.linked)
    return { ...base, ...keep, state: "unlinked", reason: "No GoHighLevel sub-account is linked to this ad account, so there is nothing to compare with." };
  if (!input.metaReadOk)
    return { ...base, ...keep, state: "unknown", reason: "Meta did not return this account's leads on this run. Nothing is judged until it does." };
  if (!input.crmFresh)
    return { ...base, ...keep, state: "unknown", reason: "The cockpit's copy of the CRM is out of date (the GoHighLevel lead sync has not run recently), so a gap here could be ours. Nothing is judged until it catches up." };

  const cond = condition(c);
  const open = prior.episodeId !== null;

  if (cond.hit) {
    const strikes = prior.strikes + 1;
    const confirmed = strikes >= RULES.confirmRuns;
    const episodeId = open ? prior.episodeId : confirmed ? `${input.clientKey}:${input.nowIso}` : null;
    return {
      ...base,
      state: confirmed || open ? cond.hit : "watch",
      reason: confirmed || open ? cond.why : `${cond.why} Seen once; it alerts if the next check agrees.`,
      strikes,
      clears: 0,
      episodeId,
      gapSince: prior.gapSince ?? input.nowIso,
      sendAlert: Boolean(episodeId) && !prior.alertTs,
    };
  }

  // No condition on this reading.
  if (open) {
    const clears = matched(c) ? prior.clears + 1 : 0;
    if (clears >= RULES.clearRuns)
      return {
        ...base,
        state: c.meta24 !== null && c.meta24 < RULES.minToJudge ? "quiet" : "ok",
        reason: `Counts match again: Meta ${n(c.meta24)}, CRM ${n(c.crm24)} in the last 24 hours.`,
        strikes: 0,
        clears: 0,
        episodeId: prior.episodeId,
        gapSince: null,
        sendResolved: true,
      };
    return {
      ...base,
      state: "watch",
      reason: matched(c)
        ? `Recovering: counts match (${clears} of ${RULES.clearRuns} checks). Meta ${n(c.meta24)}, CRM ${n(c.crm24)}.`
        : `Below the alert line but not matching yet: Meta ${n(c.meta24)}, CRM ${n(c.crm24)} in the last 24 hours.`,
      strikes: 0,
      clears,
      episodeId: prior.episodeId,
      gapSince: prior.gapSince,
    };
  }

  const quiet = c.meta24 !== null && c.meta24 < RULES.minToJudge;
  return {
    ...base,
    state: quiet ? "quiet" : "ok",
    reason: quiet
      ? `Too few Meta leads to compare (${n(c.meta24)} in 24 hours). CRM ${n(c.crm24)}.`
      : `In line: Meta ${n(c.meta24)}, CRM ${n(c.crm24)} in the last 24 hours.`,
    strikes: 0,
    clears: 0,
    episodeId: null,
    gapSince: null,
  };
}

// ------------------------------------------------------------------ time

/** Minutes east of UTC for a time zone at an instant. */
export function tzOffsetMin(tz: string, atMs: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(atMs));
  const g = (t: string) => Number(parts.find(p => p.type === t)?.value);
  const asUtc = Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"), g("second"));
  return Math.round((asUtc - Math.floor(atMs / 1000) * 1000) / 60000);
}

/** The UTC instant of a wall-clock hour in a time zone ("2026-10-14", 13, "Asia/Kuwait"). */
export function zonedHourToUtc(day: string, hour: number, tz: string): number {
  const [y, m, d] = day.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d, hour);
  const first = guess - tzOffsetMin(tz, guess) * 60000;
  return guess - tzOffsetMin(tz, first) * 60000;
}

/** The calendar day of an instant in a time zone, YYYY-MM-DD. */
export function zonedDay(atMs: number, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(atMs));
}

/** Meta's hourly bucket label "13:00:00 - 13:59:59" to 13. */
export function bucketHour(label: string): number | null {
  const m = /^(\d{2}):00:00/.exec(String(label ?? ""));
  return m ? Number(m[1]) : null;
}

/** Leads from one Meta insights row. "lead" is Meta's total; older rows fall back to its parts. */
export function leadsOf(actions: { action_type: string; value: string }[] | undefined): number {
  const a = actions ?? [];
  const get = (t: string) => Number(a.find(x => x.action_type === t)?.value ?? 0) || 0;
  if (a.some(x => x.action_type === "lead")) return get("lead");
  return get("onsite_conversion.lead_grouped") + get("offsite_conversion.fb_pixel_lead");
}

// ------------------------------------------------------------------ slack text

export function alertText(x: {
  client: string;
  state: State;
  reason: string;
  meta24: number | null;
  crm24: number | null;
  crmMeta24: number | null;
  meta6: number | null;
  crm6: number | null;
  mentions: string[];
  cockpitUrl: string;
}): string {
  const who = x.mentions.length ? `${x.mentions.map(m => `<@${m}>`).join(" ")} ` : "";
  const title = x.state === "stalled" ? "Facebook leads have stopped reaching the CRM" : "Facebook leads are not all reaching the CRM";
  return [
    `:rotating_light: *${title}: ${x.client}*`,
    x.reason,
    `• Last 24h: Meta *${n(x.meta24)}* · CRM *${n(x.crm24)}* (${n(x.crmMeta24)} tagged Meta)`,
    `• Last 6h: Meta *${n(x.meta6)}* · CRM *${n(x.crm6)}*`,
    `${who}Check the lead form ↔ GoHighLevel connection (Meta lead access, the Facebook integration in the sub-account, and the form mapping). I'll reply here when the counts match again.`,
    `<${x.cockpitUrl}|Open in the cockpit>`,
  ].join("\n");
}

export function resolvedText(x: { meta24: number | null; crm24: number | null; since: string | null }): string {
  const mins = x.since ? Math.max(1, Math.round((Date.now() - Date.parse(x.since)) / 60000)) : null;
  const dur = mins === null ? "" : mins < 120 ? ` after ${mins} min` : ` after ${Math.round(mins / 60)} h`;
  return `:white_check_mark: Fixed${dur}: the counts match again. Last 24h Meta ${n(x.meta24)} · CRM ${n(x.crm24)}.`;
}
