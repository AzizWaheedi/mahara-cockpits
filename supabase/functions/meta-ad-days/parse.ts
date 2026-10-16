/**
 * Meta's insights rows, read into the shape of public.cockpit_meta_ad_days.
 *
 * The rules (each one is in parse.test.ts):
 *   - A field Meta did not return is NULL, never 0. Meta leaves out an action
 *     type that has no actions, so a zero is written only where the absence
 *     itself means zero:
 *       leads         lead-form leads. On a lead campaign (objective
 *                     OUTCOME_LEADS or the old LEAD_GENERATION) Meta's `lead`
 *                     count less its messaging leads
 *                     (onsite_conversion.lead), 0 when Meta lists none. NULL
 *                     on any other objective, and NULL on an ad set whose
 *                     destination is a chat (WhatsApp, Messenger, Instagram
 *                     Direct: withDestinations below), because neither has a
 *                     lead form. Engagement campaigns and WhatsApp lead ad
 *                     sets report `lead` for messaging leads too (Pidco's
 *                     WhatsApp lead ad sets: 4 in 30 days, 2026-10-16), so
 *                     they never count as leads, and their spend stays out
 *                     of cost per lead.
 *       lead_actions  Meta's `lead` action on any objective, 0 when none, so
 *                     the account-level lead count can be checked against it.
 *       destination_type  the ad set's destination as Meta lists it (ON_AD
 *                     for an instant form, WEBSITE, WHATSAPP...), looked up
 *                     for lead-campaign ad sets only; NULL elsewhere and on a
 *                     deleted ad set Meta no longer lists.
 *       video fields  a row with video_play_actions is a video row: its
 *                     3-second plays (actions[video_view]), p25 to p100 and
 *                     ThruPlays are the value or 0 (Meta drops a quartile
 *                     nobody reached). A row without it is not a video (an
 *                     image or a carousel): every video field is NULL.
 *   - 3-second plays are actions[video_view]. video_play_actions counts every
 *     start (90 to 94% of impressions), so it is stored as video_plays and
 *     never used as a hook.
 *   - `lead` when present, else onsite_conversion.lead_grouped plus
 *     offsite_conversion.fb_pixel_lead: the rule of
 *     hermes/lead-sync-watch/rules.ts leadsOf, so both read Meta's leads alike.
 *   - Messaging leads are onsite_conversion.lead. Read-only, 2026-10-16, 28
 *     spending accounts over 30 days: it was on WhatsApp ad sets only (49 on
 *     lead and engagement campaigns, plus 22 on a deleted engagement ad set),
 *     never on an instant-form (835 leads), website or older lead ad set.
 *   - landing_page_views is actions[landing_page_view], NULL when Meta lists
 *     none (an instant-form ad has no landing page).
 *   - A number that is not a finite, non-negative number stops the account's
 *     read with a sentence; nothing is guessed.
 */
import type { Row } from "./graph.ts";

export const LEAD_OBJECTIVES = new Set(["OUTCOME_LEADS", "LEAD_GENERATION"]);

/** Meta's action type for a lead marked in a chat (WhatsApp, Messenger, Instagram Direct). */
export const MESSAGING_LEAD = "onsite_conversion.lead";

/**
 * Ad set destinations where the lead happens in a chat, not on a form. The
 * table's CHECK holds the same list (parse.test.ts pins the two together).
 * LEAD_FROM_MESSENGER and LEAD_FROM_IG_DIRECT are Meta's chat lead flows; none
 * was in use on 2026-10-16.
 */
export const MESSAGING_DESTINATIONS = ["WHATSAPP", "MESSENGER", "INSTAGRAM_DIRECT", "LEAD_FROM_MESSENGER", "LEAD_FROM_IG_DIRECT"];

export function isMessagingDestination(d: string | null | undefined): boolean {
  return typeof d === "string" && (MESSAGING_DESTINATIONS.includes(d) || d.startsWith("MESSAGING_"));
}

/** The fields of one ad-level, one-day insights read. */
export const DAY_FIELDS = [
  "campaign_id",
  "campaign_name",
  "objective",
  "adset_id",
  "adset_name",
  "ad_id",
  "ad_name",
  "date_start",
  "date_stop",
  "spend",
  "impressions",
  "reach",
  "frequency",
  "inline_link_clicks",
  "actions",
  "video_play_actions",
  "video_p25_watched_actions",
  "video_p50_watched_actions",
  "video_p75_watched_actions",
  "video_p100_watched_actions",
  "video_thruplay_watched_actions",
].join(",");

export type AdDayRow = {
  accountId: string;
  day: string;
  campaignId: string | null;
  campaignName: string | null;
  objective: string | null;
  adsetId: string | null;
  adsetName: string | null;
  adId: string;
  adName: string | null;
  spend: number | null;
  impressions: number | null;
  reach: number | null;
  frequency: number | null;
  linkClicks: number | null;
  leads: number | null;
  leadActions: number | null;
  landingPageViews: number | null;
  videoPlays: number | null;
  video3s: number | null;
  videoP25: number | null;
  videoP50: number | null;
  videoP75: number | null;
  videoP100: number | null;
  thruplays: number | null;
  destinationType: string | null;
};

export class ParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ParseError";
  }
}

const ID = /^[0-9]{5,25}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

function text(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim().slice(0, 400) : null;
}

function id(v: unknown, what: string, required: boolean): string | null {
  const s = typeof v === "number" ? String(v) : typeof v === "string" ? v.trim() : "";
  if (!s) {
    if (required) throw new ParseError(`Meta returned a row without ${what}.`);
    return null;
  }
  if (!ID.test(s)) throw new ParseError(`Meta returned ${what} "${s.slice(0, 30)}", which is not an id.`);
  return s;
}

/** A Meta number ("6.87", 12): the number, NULL when absent, an error when it is not a finite non-negative number. */
export function amount(v: unknown, what: string): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.trim()) : Number.NaN;
  if (!Number.isFinite(n) || n < 0) throw new ParseError(`Meta returned ${what} "${String(v).slice(0, 30)}", which is not a count or an amount.`);
  return n;
}

/** A Meta count: a whole number or NULL. */
export function count(v: unknown, what: string): number | null {
  const n = amount(v, what);
  if (n === null) return null;
  if (!Number.isSafeInteger(n)) throw new ParseError(`Meta returned ${what} "${String(v).slice(0, 30)}", which is not a whole number.`);
  return n;
}

/** The sum of one action type in an action list; NULL when the type is not listed. */
export function actionValue(list: unknown, type: string, what: string): number | null {
  if (list === undefined || list === null) return null;
  if (!Array.isArray(list)) throw new ParseError(`Meta returned ${what} that is not a list.`);
  let total: number | null = null;
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const a = item as Row;
    if (a.action_type !== type) continue;
    const n = count(a.value, `${what} ${type}`);
    if (n !== null) total = (total ?? 0) + n;
  }
  return total;
}

/** A video watch field (video_p25_watched_actions and its kin): one entry, action type video_view. */
function watched(list: unknown, what: string): number | null {
  return actionValue(list, "video_view", what);
}

/** Meta's lead count from an action list: `lead`, else the two parts it is made of (hermes/lead-sync-watch leadsOf). */
export function leadActions(actions: unknown): number {
  const lead = actionValue(actions, "lead", "actions");
  if (lead !== null) return lead;
  return (actionValue(actions, "onsite_conversion.lead_grouped", "actions") ?? 0) + (actionValue(actions, "offsite_conversion.fb_pixel_lead", "actions") ?? 0);
}

/** Lead-form leads in an action list: Meta's lead count less the leads marked in a chat, never below 0. */
export function formLeads(actions: unknown): number {
  return Math.max(0, leadActions(actions) - (actionValue(actions, MESSAGING_LEAD, "actions") ?? 0));
}

/** One ad-level, one-day insights row for the ad account `accountId`. */
export function parseAdDay(raw: Row, accountId: string): AdDayRow {
  const day = text(raw.date_start);
  if (!day || !DAY.test(day)) throw new ParseError("Meta returned a row without its day.");
  if (raw.date_stop !== undefined && raw.date_stop !== day) {
    throw new ParseError(`Meta returned a row for ${day} to ${String(raw.date_stop)}; a day at a time was asked for.`);
  }
  const objective = text(raw.objective);
  const isVideo = raw.video_play_actions !== undefined && raw.video_play_actions !== null;
  const actions = raw.actions;
  const zeroIfVideo = (n: number | null) => (n !== null ? n : isVideo ? 0 : null);
  return {
    accountId,
    day,
    campaignId: id(raw.campaign_id, "a campaign id", false),
    campaignName: text(raw.campaign_name),
    objective,
    adsetId: id(raw.adset_id, "an ad set id", false),
    adsetName: text(raw.adset_name),
    adId: id(raw.ad_id, "an ad id", true) as string,
    adName: text(raw.ad_name),
    spend: amount(raw.spend, "spend"),
    impressions: count(raw.impressions, "impressions"),
    reach: count(raw.reach, "reach"),
    frequency: amount(raw.frequency, "frequency"),
    linkClicks: count(raw.inline_link_clicks, "link clicks"),
    leads: objective !== null && LEAD_OBJECTIVES.has(objective) ? formLeads(actions) : null,
    leadActions: leadActions(actions),
    landingPageViews: actionValue(actions, "landing_page_view", "actions"),
    videoPlays: isVideo ? (watched(raw.video_play_actions, "video plays") ?? 0) : null,
    video3s: zeroIfVideo(actionValue(actions, "video_view", "actions")),
    videoP25: zeroIfVideo(watched(raw.video_p25_watched_actions, "25% views")),
    videoP50: zeroIfVideo(watched(raw.video_p50_watched_actions, "50% views")),
    videoP75: zeroIfVideo(watched(raw.video_p75_watched_actions, "75% views")),
    videoP100: zeroIfVideo(watched(raw.video_p100_watched_actions, "100% views")),
    thruplays: zeroIfVideo(watched(raw.video_thruplay_watched_actions, "ThruPlays")),
    destinationType: null,
  };
}

/** The ad sets whose destination decides their leads: those of lead-campaign rows. */
export function leadAdsetIds(rows: AdDayRow[]): string[] {
  const ids = new Set<string>();
  for (const r of rows) if (r.adsetId && r.objective !== null && LEAD_OBJECTIVES.has(r.objective)) ids.add(r.adsetId);
  return [...ids].sort();
}

/**
 * Meta's answer to act_<id>/adsets?fields=id,destination_type for the ids
 * asked: id to destination. An ad set not asked for, listed twice, or with a
 * destination that is not Meta's kind of name stops the read.
 */
export function parseDestinations(rows: Row[], asked: string[]): Map<string, string | null> {
  const want = new Set(asked);
  const out = new Map<string, string | null>();
  for (const raw of rows) {
    const adset = id(raw.id, "an ad set id", true) as string;
    if (!want.has(adset)) throw new ParseError(`Meta listed ad set ${adset}, which was not asked for.`);
    if (out.has(adset)) throw new ParseError(`Meta listed ad set ${adset} twice.`);
    const d = raw.destination_type === undefined || raw.destination_type === null ? null : text(raw.destination_type);
    if (d !== null && !/^[A-Z_]{1,60}$/.test(d)) throw new ParseError(`Meta gave ad set ${adset} the destination "${d.slice(0, 30)}", which is not one of its names.`);
    out.set(adset, d);
  }
  return out;
}

/**
 * Each lead-campaign row with its ad set's destination; a chat destination
 * makes its leads NULL (they are messaging leads, and its spend is not spent
 * on a form). `unknown` counts the lead ad sets Meta no longer lists (deleted):
 * their destination stays NULL and their leads keep the action-type rule.
 */
export function withDestinations(rows: AdDayRow[], destinations: Map<string, string | null>): { rows: AdDayRow[]; unknown: string[] } {
  const unknown = new Set<string>();
  const out = rows.map(r => {
    if (!r.adsetId || r.objective === null || !LEAD_OBJECTIVES.has(r.objective)) return r;
    if (!destinations.has(r.adsetId)) {
      unknown.add(r.adsetId);
      return r;
    }
    const destinationType = destinations.get(r.adsetId) ?? null;
    return { ...r, destinationType, leads: isMessagingDestination(destinationType) ? null : r.leads };
  });
  return { rows: out, unknown: [...unknown].sort() };
}

/** The rows the apply RPC takes (snake case, the table's own names). */
export function toApplyRow(r: AdDayRow): Record<string, unknown> {
  return {
    account_id: r.accountId,
    day: r.day,
    campaign_id: r.campaignId,
    campaign_name: r.campaignName,
    objective: r.objective,
    adset_id: r.adsetId,
    adset_name: r.adsetName,
    ad_id: r.adId,
    ad_name: r.adName,
    spend: r.spend,
    impressions: r.impressions,
    reach: r.reach,
    frequency: r.frequency,
    link_clicks: r.linkClicks,
    leads: r.leads,
    lead_actions: r.leadActions,
    landing_page_views: r.landingPageViews,
    video_plays: r.videoPlays,
    video_3s: r.video3s,
    video_p25: r.videoP25,
    video_p50: r.videoP50,
    video_p75: r.videoP75,
    video_p100: r.videoP100,
    thruplays: r.thruplays,
    destination_type: r.destinationType,
  };
}

/**
 * Meta lists one row per ad per day. Two rows for the same ad and day would
 * mean the read overlapped itself (a split window read twice); they are the
 * same numbers, so the later one is kept, and any difference stops the read.
 */
export function dedupe(rows: AdDayRow[]): AdDayRow[] {
  const byKey = new Map<string, AdDayRow>();
  for (const r of rows) {
    const key = `${r.adId}|${r.day}`;
    const prev = byKey.get(key);
    if (prev && JSON.stringify(prev) !== JSON.stringify(r)) {
      throw new ParseError(`Meta returned two different rows for ad ${r.adId} on ${r.day}; nothing was written for this account.`);
    }
    byKey.set(key, r);
  }
  return [...byKey.values()];
}

// ---------------------------------------------------------------- reach

export type Level = "account" | "campaign" | "adset" | "ad";
export type Window = { key: string; from: string; to: string };
export type ReachRow = { key: string; windowKey: string; reach: number | null; impressions: number | null };

export const REACH_LEVELS: Level[] = ["account", "campaign", "adset", "ad"];

/**
 * The distinct spans of the windows, in order: two windows can hold the same
 * days (last_7 and this_month on the 7th of a month, last_30 and this_month on
 * the 30th), and Meta is asked for each span once.
 */
export function windowSpans(windows: Window[]): { since: string; until: string }[] {
  const out = new Map<string, { since: string; until: string }>();
  for (const w of windows) out.set(`${w.from}|${w.to}`, { since: w.from, until: w.to });
  return [...out.values()];
}

/**
 * Reach and impressions per window for one level, from one time_ranges read.
 * A span shared by two windows gives the same row to both (before 2026-10-16
 * the second window's row was refused as a repeat, or written as 0).
 */
export function parseReach(rows: Row[], level: Level, windows: Window[], accountId: string): ReachRow[] {
  const byRange = new Map<string, string[]>();
  for (const w of windows) byRange.set(`${w.from}|${w.to}`, [...(byRange.get(`${w.from}|${w.to}`) ?? []), w.key]);
  const idField = `${level}_id`;
  const out: ReachRow[] = [];
  const seen = new Set<string>();
  for (const raw of rows) {
    const windowKeys = byRange.get(`${text(raw.date_start)}|${text(raw.date_stop)}`);
    if (!windowKeys) throw new ParseError(`Meta returned reach for ${String(raw.date_start)} to ${String(raw.date_stop)}, a span that was not asked for.`);
    const key = level === "account" ? (id(raw.account_id, "an account id", false) ?? accountId) : (id(raw[idField], `a ${level} id`, true) as string);
    if (level === "account" && key !== accountId) throw new ParseError(`Meta returned reach for ad account ${key} inside ${accountId}.`);
    for (const windowKey of windowKeys) {
      const k = `${key}|${windowKey}`;
      if (seen.has(k)) throw new ParseError(`Meta returned two reach rows for ${level} ${key} over ${windowKey}.`);
      seen.add(k);
      out.push({ key, windowKey, reach: count(raw.reach, "reach"), impressions: count(raw.impressions, "impressions") });
    }
  }
  // The account was read: a window with no row had no delivery, which is a true zero.
  if (level === "account") {
    for (const w of windows) {
      if (!seen.has(`${accountId}|${w.key}`)) out.push({ key: accountId, windowKey: w.key, reach: 0, impressions: 0 });
    }
  }
  return out;
}

// ---------------------------------------------------------------- lead ids

export type LeadIdRow = { lead_id: string; ad_id: string; created_time: string };

/**
 * One ad's leads as ids and times: never a name, phone or answer (the read
 * asks for id and created_time only, and nothing else is kept). Meta writes
 * times as 2026-10-15T10:21:33+0000.
 */
export function parseLeadIds(rows: Row[], adId: string): LeadIdRow[] {
  return rows.map(raw => {
    const leadId = id(raw.id, "a lead id", true) as string;
    const t = (text(raw.created_time) ?? "").replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
    const ms = Date.parse(t);
    if (!t || !Number.isFinite(ms)) throw new ParseError(`Meta returned lead ${leadId} on ad ${adId} without a time.`);
    return { lead_id: leadId, ad_id: adId, created_time: new Date(ms).toISOString() };
  });
}
