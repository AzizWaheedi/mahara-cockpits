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
  "clicks",
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
  /** Meta's clicks: all clicks (the creative dashboard's clicks), not link clicks. */
  clicks: number | null;
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
    clicks: count(raw.clicks, "clicks"),
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
    clicks: r.clicks,
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

// ---------------------------------------------------------------- budgets

/**
 * Meta's currency offsets (developers.facebook.com/docs/marketing-api/currencies,
 * read 2026-10-17). Every budget Meta writes (daily_budget, lifetime_budget,
 * budget_remaining, the account's spend_cap and amount_spent, every amount in
 * the activity log) is a whole number of the currency's smallest unit as Meta
 * counts it: divide by the offset. 100 for USD, SAR, QAR, AED and most others
 * (BHD too, though ISO gives it 3 decimals: Meta's 1000 is 10.00 BHD); 1 for
 * the currencies Meta counts without minor units. Exactly Meta's table (its
 * rows, read again 2026-10-17): KWD, OMR, LKR and MAD are not in it, VES is.
 * An account in a currency this table does not hold is refused with a
 * sentence, never assumed to be 100. Insights spend, by contrast, is already
 * in major units.
 */
const OFFSET_ONE = ["CLP", "COP", "CRC", "HUF", "IDR", "ISK", "JPY", "KRW", "PYG", "TWD", "VND"];
const OFFSET_HUNDRED = [
  "AED", "ARS", "AUD", "BDT", "BGN", "BHD", "BOB", "BRL", "CAD", "CHF", "CNY", "CZK", "DKK", "DZD", "EGP", "EUR", "GBP", "GTQ", "HKD", "HNL",
  "HRK", "ILS", "INR", "JOD", "KES", "MOP", "MXN", "MYR", "NGN", "NIO", "NOK", "NZD", "PEN", "PHP", "PKR", "PLN", "QAR", "RON", "RSD",
  "RUB", "SAR", "SEK", "SGD", "THB", "TRY", "UAH", "USD", "UYU", "VEF", "VES", "ZAR",
];
export const CURRENCY_OFFSETS: Readonly<Record<string, number>> = Object.freeze({
  ...Object.fromEntries(OFFSET_HUNDRED.map(c => [c, 100])),
  ...Object.fromEntries(OFFSET_ONE.map(c => [c, 1])),
});

/** Meta's offset for a currency code; null when the table does not hold it. */
export function currencyOffset(code: string | null | undefined): number | null {
  return typeof code === "string" && Object.hasOwn(CURRENCY_OFFSETS, code) ? CURRENCY_OFFSETS[code] : null;
}

/** The sentence for an account whose budgets cannot be converted. */
export function noOffsetSentence(accountId: string, currency: string | null): string {
  return currency
    ? `act_${accountId} is in ${currency}, which is not in Meta's currency table the cockpit holds (parse.ts CURRENCY_OFFSETS), so its budgets were not read. Add the currency with Meta's offset.`
    : `Meta's listing gave act_${accountId} no currency, so its budgets were not read.`;
}

/**
 * One read per account: its campaigns (archived and deleted left out, by
 * Meta's own filter), each with its ad sets and their ads' statuses nested.
 * At most 200 ad sets per campaign and 200 ads per ad set: a block with more
 * carries paging.next and the account is refused, never cut short.
 */
export const BUDGET_FIELDS = [
  "id",
  "name",
  "objective",
  "status",
  "effective_status",
  "daily_budget",
  "lifetime_budget",
  "budget_remaining",
  "start_time",
  "stop_time",
  "issues_info",
  "adsets.limit(200){id,name,status,effective_status,daily_budget,lifetime_budget,budget_remaining,start_time,end_time,ads.limit(200){effective_status}}",
].join(",");
/** Meta's campaign effective statuses but ARCHIVED and DELETED. */
export const CAMPAIGN_STATUSES = ["ACTIVE", "PAUSED", "IN_PROCESS", "WITH_ISSUES"];

/**
 * The account as the business listing gave it, Meta's minor units. On a
 * prepaid account (prepay, Meta's is_prepay_account) spend_cap is the funds
 * added, not a limit: what is left under it is the prepaid balance
 * (mergestudio.kw, 17 Oct: 351.77 - 340.96 = "Available balance ($10.81
 * USD)"), and the fix is to add funds, never to raise a limit.
 */
export type AccountSnapshot = {
  status: number | null;
  disableReason: number | null;
  spendCap: number | null;
  amountSpent: number | null;
  prepay?: boolean | null;
};

export type LiveAdset = {
  id: string;
  name: string | null;
  status: string | null;
  effectiveStatus: string | null;
  dailyMinor: number | null;
  lifetimeMinor: number | null;
  remainingMinor: number | null;
  start: MetaTime | null;
  end: MetaTime | null;
  ads: string[];
};
export type LiveCampaign = {
  id: string;
  name: string | null;
  objective: string | null;
  status: string | null;
  effectiveStatus: string | null;
  dailyMinor: number | null;
  lifetimeMinor: number | null;
  remainingMinor: number | null;
  start: MetaTime | null;
  end: MetaTime | null;
  issues: { level: string | null; code: number | null; summary: string | null }[];
  adsets: LiveAdset[];
  /** campaign = CBO (its own budget); adset = ABO. */
  budgetLevel: "campaign" | "adset";
};
/** A Meta time: the moment, and the day as Meta wrote it (the account's own clock). */
export type MetaTime = { ms: number; iso: string; day: string };

export type BudgetRow = {
  level: "campaign" | "adset";
  objectId: string;
  campaignId: string;
  name: string | null;
  objective: string | null;
  status: string | null;
  effectiveStatus: string | null;
  budgetLevel: "campaign" | "adset";
  budgetType: "daily" | "lifetime" | null;
  /** Major units of the account currency. */
  dailyBudget: number | null;
  lifetimeBudget: number | null;
  budgetRemaining: number | null;
  startTime: string | null;
  endTime: string | null;
  adsActive: number;
  adsWithIssues: number;
  issues: { level: string | null; code: number | null; summary: string | null }[] | null;
  switchedOn: boolean;
  /** Switched on but waiting for its start (the campaign's, or every ad set switched on starts later): when. */
  startsAt: string | null;
  delivering: boolean;
  whyNot: string | null;
};

const isObj = (v: unknown): v is Row => typeof v === "object" && v !== null && !Array.isArray(v);
const STATUS = /^[A-Z_]{1,40}$/;

/** Meta's minor units ("12000"): the number, NULL when absent or "0" (no budget). */
export function minorUnits(v: unknown, what: string, zeroIsNone = true): number | null {
  if (v === undefined || v === null || v === "") return null;
  const s = typeof v === "number" ? String(v) : typeof v === "string" ? v.trim() : "";
  if (!/^[0-9]{1,15}$/.test(s)) throw new ParseError(`Meta returned ${what} "${String(v).slice(0, 30)}", which is not an amount in minor units.`);
  const n = Number(s);
  return n === 0 && zeroIsNone ? null : n;
}

function metaTime(v: unknown, what: string): MetaTime | null {
  const t = text(v);
  if (!t) return null;
  const ms = Date.parse(t.replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
  if (!Number.isFinite(ms) || !/^\d{4}-\d{2}-\d{2}/.test(t)) throw new ParseError(`Meta returned ${what} "${t.slice(0, 30)}", which is not a time.`);
  return { ms, iso: new Date(ms).toISOString(), day: t.slice(0, 10) };
}

function status(v: unknown, what: string): string | null {
  const s = text(v);
  if (s !== null && !STATUS.test(s)) throw new ParseError(`Meta returned ${what} "${s.slice(0, 30)}", which is not one of its statuses.`);
  return s;
}

/** A nested list (adsets, ads): its rows; [] when Meta left it out; refused when it has another page. */
function nested(v: unknown, what: string): Row[] {
  if (v === undefined || v === null) return [];
  if (!isObj(v) || !Array.isArray(v.data)) throw new ParseError(`Meta returned ${what} without a data list.`);
  if (isObj(v.paging) && v.paging.next) throw new ParseError(`${what} has more than 200 on one page; nothing was kept for the account rather than a part of it.`);
  return v.data.map(x => {
    if (!isObj(x)) throw new ParseError(`Meta returned ${what} with a row that is not an object.`);
    return x;
  });
}

/** Meta's act_<id>/campaigns answer, read and checked. */
export function readLiveCampaigns(rows: Row[]): LiveCampaign[] {
  const seen = new Set<string>();
  return rows.map(raw => {
    const id = idOf(raw.id, "a campaign id");
    if (seen.has(id)) throw new ParseError(`Meta listed campaign ${id} twice.`);
    seen.add(id);
    const dailyMinor = minorUnits(raw.daily_budget, `campaign ${id}'s daily budget`);
    const lifetimeMinor = minorUnits(raw.lifetime_budget, `campaign ${id}'s lifetime budget`);
    const adsets = nested(raw.adsets, `Campaign ${id}'s ad sets`).map(a => {
      const adsetId = idOf(a.id, "an ad set id");
      const own = minorUnits(a.daily_budget, `ad set ${adsetId}'s daily budget`) !== null || minorUnits(a.lifetime_budget, `ad set ${adsetId}'s lifetime budget`) !== null;
      return {
        id: adsetId,
        name: text(a.name),
        status: status(a.status, `ad set ${adsetId}'s status`),
        effectiveStatus: status(a.effective_status, `ad set ${adsetId}'s effective status`),
        dailyMinor: minorUnits(a.daily_budget, `ad set ${adsetId}'s daily budget`),
        lifetimeMinor: minorUnits(a.lifetime_budget, `ad set ${adsetId}'s lifetime budget`),
        remainingMinor: own ? minorUnits(a.budget_remaining, `ad set ${adsetId}'s budget remaining`, false) : null,
        start: metaTime(a.start_time, `ad set ${adsetId}'s start`),
        end: metaTime(a.end_time, `ad set ${adsetId}'s end`),
        ads: nested(a.ads, `Ad set ${adsetId}'s ads`).map((ad, i) => status(ad.effective_status, `ad ${i + 1} of ad set ${adsetId}`) ?? "UNKNOWN"),
      };
    });
    const issues = Array.isArray(raw.issues_info)
      ? raw.issues_info.filter(isObj).slice(0, 5).map(x => ({
          level: text(x.level)?.slice(0, 40) ?? null,
          code: typeof x.error_code === "number" ? x.error_code : null,
          summary: text(x.error_summary)?.slice(0, 200) ?? null,
        }))
      : [];
    return {
      id,
      name: text(raw.name),
      objective: text(raw.objective)?.slice(0, 60) ?? null,
      status: status(raw.status, `campaign ${id}'s status`),
      effectiveStatus: status(raw.effective_status, `campaign ${id}'s effective status`),
      dailyMinor,
      lifetimeMinor,
      // Read on a CBO campaign only: on an ABO one Meta's campaign-level figure is not
      // its ad sets' (Khalda, 17 Oct: "110400" over two ad sets at "0"); budgetRows adds the ad sets' own.
      remainingMinor: dailyMinor !== null || lifetimeMinor !== null ? minorUnits(raw.budget_remaining, `campaign ${id}'s budget remaining`, false) : null,
      start: metaTime(raw.start_time, `campaign ${id}'s start`),
      end: metaTime(raw.stop_time, `campaign ${id}'s stop`),
      issues,
      adsets,
      budgetLevel: dailyMinor !== null || lifetimeMinor !== null ? "campaign" : "adset",
    };
  });
}

function idOf(v: unknown, what: string): string {
  return id(v, what, true) as string;
}

const words = (s: string) => s.toLowerCase().replace(/_/g, " ");

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2026-10-20" as the cockpit writes a day (format.ts shortDate): "20 Oct". */
export function dayWords(day: string | null | undefined): string {
  const m = typeof day === "string" ? day.match(/^\d{4}-(\d{2})-(\d{2})/) : null;
  return m ? `${Number(m[2])} ${MONTHS[Number(m[1]) - 1]}` : "later";
}

/**
 * Meta's ad account status in a few words (cockpit_board_account_words in
 * 20261017100100_board_budgets.sql says the same): null for 1, active.
 */
export function accountWords(statusCode: number | null): string | null {
  switch (statusCode) {
    case 1:
      return null;
    case 2:
    case 201:
      return "Account disabled";
    case 3:
      return "Account unsettled: payment needed";
    case 7:
      return "Account under risk review";
    case 8:
      return "Payment being settled";
    case 9:
      return "In grace period: payment due";
    case 100:
      return "Account closing";
    case 101:
      return "Account closed";
    case null:
      return "Account status not known";
    default:
      return `Meta account status ${statusCode}`;
  }
}

/** Why an account cannot deliver, in those words; null when it can (Meta status 1 active, 9 grace period). */
export function accountWhyNot(statusCode: number | null): string | null {
  return statusCode === 9 ? null : accountWords(statusCode);
}

function adsWhyNot(ads: string[]): string {
  if (!ads.length) return "No ads";
  if (ads.some(s => s === "WITH_ISSUES" || s === "DISAPPROVED")) return "Ads with issues";
  if (ads.some(s => s === "PENDING_REVIEW" || s === "IN_PROCESS" || s === "PREAPPROVED")) return "Ads not approved yet";
  if (ads.some(s => s === "PENDING_BILLING_INFO")) return "Ads waiting for payment details";
  return "Ads paused";
}

/** The order a campaign names its ad sets' reasons in, most telling first. */
const ADSET_REASONS = ["Ads with issues", "Ads not approved yet", "Ads waiting for payment details", "Ad set", "No ads", "Ads paused"];

/**
 * Every campaign and ad set as cockpit_meta_budgets rows, judged at `nowMs`.
 *
 * Switched on (the board's budgets count these, 2026-10-17): the buyer has
 * it set to spend. An ad set: status ACTIVE, its start passed and its end
 * not. A campaign: status ACTIVE, its start passed and its end not, and at
 * least one ad set switched on. A campaign waiting for its start (its own,
 * or every ad set switched on starts later) is not switched on yet: startsAt
 * says when, and why_not "Starts 20 Oct".
 *
 * The budget: CBO the campaign's own; ABO the sum of the ad sets switched
 * on, delivering or not, so a campaign blocked by its ads, its account or a
 * spending limit shows the budget it is set to spend (a campaign waiting for
 * its start: the ad sets that will run then, shown, not counted). A paused or ended ad
 * set never counts (hermes/cockpit-sync calculator.ts sums every ad set when
 * none is active: not here). Lifetime budgets stay lifetime: no daily figure.
 *
 * Delivering (an explanation, not a filter): the account is active or in
 * its grace period and its spending limit (or prepaid balance) not used up,
 * the campaign and the ad set are ACTIVE and running, and at least one ad is
 * ACTIVE. Otherwise why_not says why, in plain words.
 */
export function budgetRows(live: LiveCampaign[], account: AccountSnapshot, offset: number, nowMs: number): BudgetRow[] {
  const major = (n: number | null) => (n === null ? null : n / offset);
  const accountNo = accountWhyNot(account.status);
  const capReached = account.spendCap !== null && account.spendCap > 0 && account.amountSpent !== null && account.amountSpent >= account.spendCap;
  // On a prepaid account the "limit" is the funds added: the fix is to add funds.
  const blocked = accountNo ?? (capReached ? (account.prepay === true ? "Prepaid balance used up: add funds" : "Spending limit reached") : null);
  const ended = (t: MetaTime | null) => t !== null && t.ms <= nowMs;
  const started = (t: MetaTime | null) => t === null || t.ms <= nowMs;
  const out: BudgetRow[] = [];
  for (const c of live) {
    const campaignOwn =
      c.status !== "ACTIVE"
        ? c.status === "PAUSED" ? "Paused" : `Campaign ${words(c.status ?? "unknown")}`
        : ended(c.end)
          ? "Ended"
          : !started(c.start)
            ? `Starts ${dayWords(c.start?.day)}`
            : c.effectiveStatus !== "ACTIVE"
              ? c.effectiveStatus === "PAUSED"
                ? "Paused"
                : c.effectiveStatus === "IN_PROCESS"
                  ? "Meta is processing a change"
                  : c.effectiveStatus === "WITH_ISSUES"
                    ? `Campaign has issues${c.issues[0]?.summary ? `: ${c.issues[0].summary}` : ""}`
                    : `Campaign ${words(c.effectiveStatus ?? "unknown")}`
              : null;
    const campaignOk = blocked === null && campaignOwn === null;
    const sets = c.adsets.map(a => {
      const own =
        a.status !== "ACTIVE"
          ? a.status === "PAUSED" ? "Paused" : `Ad set ${words(a.status ?? "unknown")}`
          : ended(a.end)
            ? "Ended"
            : !started(a.start)
              ? `Starts ${dayWords(a.start?.day)}`
              : a.effectiveStatus !== "ACTIVE" && a.effectiveStatus !== "CAMPAIGN_PAUSED"
                ? a.effectiveStatus === "ADSET_PAUSED" ? "Paused" : `Ad set ${words(a.effectiveStatus ?? "unknown")}`
                : !a.ads.includes("ACTIVE")
                  ? adsWhyNot(a.ads)
                  : null;
      const switchedOn = a.status === "ACTIVE" && started(a.start) && !ended(a.end);
      const waiting = a.status === "ACTIVE" && !started(a.start) && !ended(a.end);
      const delivering = campaignOk && own === null && a.effectiveStatus === "ACTIVE";
      const whyNot = delivering
        ? null
        : (blocked ?? (c.effectiveStatus === "PAUSED" || c.status === "PAUSED" ? "Campaign paused" : campaignOwn) ?? own ?? "Not delivering");
      return { a, own, switchedOn, waiting, delivering, whyNot };
    });
    const on = sets.filter(s => s.switchedOn);
    const campaignLive = c.status === "ACTIVE" && started(c.start) && !ended(c.end);
    const campaignSwitchedOn = campaignLive && on.length > 0;
    // Waiting for its start: the campaign's own, or (running) every ad set switched on starts later.
    const firstWait = sets
      .filter(s => s.waiting)
      .map(s => s.a.start as MetaTime)
      .sort((x, y) => x.ms - y.ms)[0];
    const startsAt =
      c.status === "ACTIVE" && !ended(c.end) && !started(c.start)
        ? (c.start as MetaTime)
        : campaignLive && !on.length && firstWait
          ? firstWait
          : null;
    const delivering = campaignOk && sets.some(s => s.delivering);
    let whyNot: string | null = null;
    if (!delivering) {
      whyNot = startsAt ? `Starts ${dayWords(startsAt.day)}` : (blocked ?? campaignOwn);
      if (whyNot === null) {
        if (!sets.length) whyNot = "No ad sets";
        else if (!on.length) whyNot = sets.every(s => ended(s.a.end)) ? "Ended" : "Ad sets paused";
        else {
          const reasons = on.map(s => s.own ?? "Not delivering");
          whyNot = ADSET_REASONS.map(r => reasons.find(x => x.startsWith(r))).find(Boolean) ?? reasons[0];
        }
      }
    }
    let budgetType: "daily" | "lifetime" | null;
    let dailyMinor: number | null;
    let lifetimeMinor: number | null;
    let remainingMinor: number | null;
    if (c.budgetLevel === "campaign") {
      dailyMinor = c.dailyMinor;
      lifetimeMinor = dailyMinor === null ? c.lifetimeMinor : null;
      budgetType = dailyMinor !== null ? "daily" : "lifetime";
      remainingMinor = c.remainingMinor;
    } else {
      // The ad sets switched on, delivering or not (a paused ABO campaign keeps
      // what its ad sets are set to, like a paused CBO one keeps its budget).
      // A campaign waiting for its start shows the ad sets that will run then
      // (switched on or waiting), as a waiting CBO one shows its own budget;
      // not switched on, so it counts only from its start.
      const counted = (startsAt ? sets.filter(s => s.switchedOn || s.waiting) : on).map(s => s.a);
      const daily = counted.filter(a => a.dailyMinor !== null);
      const lifetime = counted.filter(a => a.lifetimeMinor !== null);
      dailyMinor = daily.length ? daily.reduce((n, a) => n + (a.dailyMinor ?? 0), 0) : null;
      lifetimeMinor = lifetime.length ? lifetime.reduce((n, a) => n + (a.lifetimeMinor ?? 0), 0) : null;
      budgetType = dailyMinor !== null ? "daily" : lifetimeMinor !== null ? "lifetime" : null;
      if (budgetType === "lifetime") dailyMinor = null;
      // What is left today is the counted ad sets' own: Meta's campaign-level figure is not their sum.
      const holding = (budgetType === "daily" ? daily : budgetType === "lifetime" ? lifetime : []).filter(a => a.remainingMinor !== null);
      remainingMinor = holding.length ? holding.reduce((n, a) => n + (a.remainingMinor ?? 0), 0) : null;
    }
    const allAds = c.adsets.flatMap(a => a.ads);
    out.push({
      level: "campaign",
      objectId: c.id,
      campaignId: c.id,
      name: c.name,
      objective: c.objective,
      status: c.status,
      effectiveStatus: c.effectiveStatus,
      budgetLevel: c.budgetLevel,
      budgetType,
      dailyBudget: major(dailyMinor),
      lifetimeBudget: major(lifetimeMinor),
      budgetRemaining: budgetType === null ? null : major(remainingMinor),
      startTime: c.start?.iso ?? null,
      endTime: c.end?.iso ?? null,
      adsActive: allAds.filter(s => s === "ACTIVE").length,
      adsWithIssues: allAds.filter(s => s === "WITH_ISSUES" || s === "DISAPPROVED").length,
      issues: c.issues.length ? c.issues : null,
      switchedOn: campaignSwitchedOn,
      startsAt: startsAt?.iso ?? null,
      delivering,
      whyNot,
    });
    for (const s of sets) {
      const a = s.a;
      const type = a.dailyMinor !== null ? "daily" : a.lifetimeMinor !== null ? "lifetime" : null;
      out.push({
        level: "adset",
        objectId: a.id,
        campaignId: c.id,
        name: a.name,
        objective: c.objective,
        status: a.status,
        effectiveStatus: a.effectiveStatus,
        budgetLevel: c.budgetLevel,
        budgetType: type,
        dailyBudget: type === "daily" ? major(a.dailyMinor) : null,
        lifetimeBudget: major(a.lifetimeMinor),
        budgetRemaining: type === null ? null : major(a.remainingMinor),
        startTime: a.start?.iso ?? null,
        endTime: a.end?.iso ?? null,
        adsActive: a.ads.filter(x => x === "ACTIVE").length,
        adsWithIssues: a.ads.filter(x => x === "WITH_ISSUES" || x === "DISAPPROVED").length,
        issues: null,
        switchedOn: s.switchedOn,
        startsAt: s.waiting ? (a.start?.iso ?? null) : null,
        delivering: s.delivering,
        whyNot: s.whyNot,
      });
    }
  }
  return out;
}

/** The read and the rows: what workBudgets and the history both start from. */
export function parseBudgets(raw: Row[], ctx: { account: AccountSnapshot; offset: number; nowMs: number }): { live: LiveCampaign[]; rows: BudgetRow[] } {
  const live = readLiveCampaigns(raw);
  return { live, rows: budgetRows(live, ctx.account, ctx.offset, ctx.nowMs) };
}

/** A budgets row as cockpit_meta_budgets_apply takes it (the table's own names). */
export function toBudgetApplyRow(r: BudgetRow, accountId: string): Record<string, unknown> {
  return {
    level: r.level,
    object_id: r.objectId,
    account_id: accountId,
    campaign_id: r.campaignId,
    name: r.name,
    objective: r.objective,
    status: r.status,
    effective_status: r.effectiveStatus,
    budget_level: r.budgetLevel,
    budget_type: r.budgetType,
    daily_budget: r.dailyBudget,
    lifetime_budget: r.lifetimeBudget,
    budget_remaining: r.budgetRemaining,
    start_time: r.startTime,
    end_time: r.endTime,
    ads_active: r.adsActive,
    ads_with_issues: r.adsWithIssues,
    issues: r.issues,
    switched_on: r.switchedOn,
    starts_at: r.startsAt,
    delivering: r.delivering,
    why_not: r.whyNot,
  };
}
