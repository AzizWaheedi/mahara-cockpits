/**
 * Budget history from Meta's activity log (GET act_<id>/activities, explicit
 * since and until, cursor-paged), for the days no hourly read covers: the
 * nightly run rebuilds the 14 days before today, a backfill its days. The
 * database writes only the account days no hourly read holds
 * (cockpit_meta_budget_history_apply), so the history mostly fills the days
 * before budgets were first read.
 *
 * How (read-only check of 2026-10-17, 5 accounts, 14 days): the log names
 * every budget and status change with its old and new value, newest first.
 * Starting from the live budgets read a moment before (act_<id>/campaigns,
 * parse.ts readLiveCampaigns), each change is undone in turn, so each day's
 * end-of-day state, and every state the day went through, is known. A chain
 * is verified when each change's new value is what the live state (with the
 * later changes undone) holds: on that check all 23 budget chains of the 5
 * accounts ended at the live budget.
 *
 * The events used:
 *   update_campaign_budget, update_ad_set_budget    {old_value: {old_value: minor}, new_value: {new_value: minor, additional_value: "Per day"}}
 *   create_campaign_group, create_ad_set            before it, the object did not exist (a budget in new_value.new_value)
 *   update_campaign_run_status, update_ad_set_run_status  run_status {old_value, new_value}: 1 Active, 17 Pending process (on), 15 or 7 Inactive
 *   ad_account_update_status                        "Active", "In Grace Period", "Payment Needed"...
 *   ad_account_update_spend_limit                   named in the day's note only (amount spent is not in the log)
 * object_type CAMPAIGN_GROUP is a campaign, CAMPAIGN an ad set, ADGROUP an ad.
 *
 * What a day holds is the hourly read's rule (parse.ts budgetRows): a
 * campaign is switched on when it is on and inside its schedule and at least
 * one of its ad sets is too; its daily budget is the campaign's own (CBO) or
 * its switched-on ad sets' added up (ABO). A day gets a row when the campaign
 * was switched on at some moment of it; the day's budget for the board is the
 * highest daily budget it was switched on with (maxBudget). The ads are not
 * followed and nothing here says a campaign delivered: why_not gives only
 * what the log shows (the account's status, paused, ended).
 *
 * Not verified, and said so: a campaign whose chain does not lead to its
 * live state (on the days up to the break), a budget before a change whose
 * old side is 0 or not a daily budget (unknown, never $0), an ABO campaign on
 * the days up to a change of an ad set Meta no longer lists (its campaign is
 * unknown), every day when an event could not be read, and the account days
 * up to a change of a campaign gone since (archived or deleted: its days are
 * not rebuilt).
 */
import { addDays, zonedDay } from "./days.ts";
import type { Row } from "./graph.ts";
import { accountWhyNot, accountWords, type LiveCampaign } from "./parse.ts";

export const ACTIVITY_FIELDS = "event_type,event_time,object_id,object_type,extra_data";

const OBJECT_OF: Record<string, string | null> = {
  update_campaign_budget: "CAMPAIGN_GROUP",
  create_campaign_group: "CAMPAIGN_GROUP",
  update_campaign_run_status: "CAMPAIGN_GROUP",
  update_ad_set_budget: "CAMPAIGN",
  create_ad_set: "CAMPAIGN",
  update_ad_set_run_status: "CAMPAIGN",
  ad_account_update_status: null,
  ad_account_update_spend_limit: null,
};
export const HISTORY_EVENTS = new Set(Object.keys(OBJECT_OF));

export type Activity = { type: string; timeMs: number; objectId: string; extra: Row };

const isObj = (v: unknown): v is Row => typeof v === "object" && v !== null && !Array.isArray(v);

/** The events the history uses, newest first (Meta's order kept between events of the same second); the others are dropped. */
export function parseActivities(rows: Row[]): { events: Activity[]; unreadable: number } {
  const kept: { e: Activity; i: number }[] = [];
  let unreadable = 0;
  rows.forEach((raw, i) => {
    const type = typeof raw.event_type === "string" ? raw.event_type : "";
    if (!HISTORY_EVENTS.has(type)) return;
    const time = typeof raw.event_time === "string" ? raw.event_time.replace(/([+-]\d{2})(\d{2})$/, "$1:$2") : "";
    const ms = /^\d{4}-\d{2}-\d{2}T/.test(time) ? Date.parse(time) : Number.NaN;
    const objectId = typeof raw.object_id === "string" ? raw.object_id : typeof raw.object_id === "number" ? String(raw.object_id) : "";
    let extra: unknown = null;
    try {
      extra = typeof raw.extra_data === "string" ? JSON.parse(raw.extra_data) : raw.extra_data;
    } catch {
      extra = null;
    }
    const objectType = OBJECT_OF[type];
    if (!Number.isFinite(ms) || !isObj(extra) || (objectType !== null && (raw.object_type !== objectType || !/^[0-9]{5,25}$/.test(objectId)))) {
      unreadable += 1;
      return;
    }
    kept.push({ e: { type, timeMs: ms, objectId, extra }, i });
  });
  kept.sort((a, b) => b.e.timeMs - a.e.timeMs || a.i - b.i);
  return { events: kept.map(x => x.e), unreadable };
}

export type HistoryRow = {
  campaignId: string;
  day: string;
  budgetLevel: "campaign" | "adset";
  budgetType: "daily" | "lifetime" | null;
  /** Major units of the account currency, at the end of the day. */
  dailyBudget: number | null;
  /** The highest daily budget it was switched on with during the day; null when never on a daily budget. */
  maxBudget: number | null;
  /** Switched on at the end of the day, and at any moment of it. */
  switchedOn: boolean;
  switchedOnAny: boolean;
  /** What the log shows at the end of the day: the account's status, paused, ended. Never a claim that it delivered. */
  whyNot: string | null;
  changedDuringDay: boolean;
  verified: boolean;
};
export type HistoryDay = { day: string; campaigns: number; verified: boolean; note: string | null };
export type History = { rows: HistoryRow[]; days: HistoryDay[]; broken: string[]; unlisted: string[]; note: string | null };

export type HistoryInput = {
  live: LiveCampaign[];
  /** Meta's account_status now (the business listing of this run). */
  accountStatus: number | null;
  events: Activity[];
  unreadable: number;
  timezone: string;
  offset: number;
  since: string;
  until: string;
};

type St = { exists: boolean; on: boolean; daily: number | null };
type AdsetS = { id: string; lifetime: boolean; st: St; startDay: string | null; endDay: string | null; campaign: CampS };
type CampS = { id: string; cbo: boolean; lifetime: boolean; level: "campaign" | "adset"; st: St; startDay: string | null; endDay: string | null; adsets: AdsetS[]; brokenThrough: string | null };
type Ev = { switchedOn: boolean; budgetType: "daily" | "lifetime" | null; daily: number | null; whyNot: string | null };

/** Run statuses that let an object deliver: 1 Active, 17 Pending process (seconds, while Meta applies an edit). */
const ON_CODES = new Set([1, 17]);

function runCode(extra: Row, side: "old_value" | "new_value"): number | null {
  const rs = isObj(extra.run_status) ? extra.run_status : null;
  if (rs && typeof rs[side] === "number") return rs[side] as number;
  const word = typeof extra[side] === "string" ? (extra[side] as string) : null;
  if (word === null) return null;
  return word === "Active" ? 1 : word === "Pending process" ? 17 : 0;
}

/** A budget in minor units; null when absent or 0 (Meta's 0 is no budget, as in the hourly read: unknown, never a $0 budget). */
function amountOf(extra: Row, side: "old_value" | "new_value"): number | null {
  const box = isObj(extra[side]) ? (extra[side] as Row) : null;
  const v = box ? box[side] : null;
  if (typeof v === "number" && Number.isSafeInteger(v) && v > 0) return v;
  if (typeof v === "string" && /^[0-9]{1,15}$/.test(v) && Number(v) > 0) return Number(v);
  return null;
}

/** true "Per day", false a lifetime budget, null when Meta does not say (the old side often reads ""). */
function perDay(extra: Row, side: "old_value" | "new_value" = "new_value"): boolean | null {
  const box = isObj(extra[side]) ? (extra[side] as Row) : null;
  const v = box && typeof box.additional_value === "string" ? box.additional_value : "";
  return v === "Per day" ? true : v === "" ? null : false;
}

/** The daily budget before a change: unknown (null) when it was 0 or not a daily budget. */
function oldDaily(extra: Row): number | null {
  return perDay(extra, "old_value") === false ? null : amountOf(extra, "old_value");
}

/** The log's account status label in the words of parse.ts accountWords; null when the account can deliver. */
function accountLabelWhyNot(label: string): string | null {
  if (label === "Active" || label === "In Grace Period") return null;
  if (label === "Payment Needed" || label === "Unsettled") return accountWords(3);
  if (label === "Disabled") return accountWords(2);
  if (label === "Pending Risk Review") return accountWords(7);
  if (label === "Pending Settlement") return accountWords(8);
  if (label === "Pending Closure") return accountWords(100);
  if (label === "Closed") return accountWords(101);
  // Meta's own words, as Meta wrote them.
  return `Meta account status "${label.slice(0, 60)}"`;
}

/** Each campaign's effective daily budget per day from since to until, rebuilt backwards from the live state. */
export function rebuildBudgetHistory(input: HistoryInput): History {
  const { timezone, offset, since, until } = input;
  const camps = new Map<string, CampS>();
  const sets = new Map<string, AdsetS>();
  // Days on the account's clock. An end at midnight ends the day before: the
  // last moment it runs is a millisecond earlier (Arcturus' 1 Sep stops).
  const startDayOf = (t: { ms: number } | null) => (t === null ? null : zonedDay(t.ms, timezone));
  const endDayOf = (t: { ms: number } | null) => (t === null ? null : zonedDay(t.ms - 1, timezone));
  for (const c of input.live) {
    const cbo = c.budgetLevel === "campaign";
    const cs: CampS = {
      id: c.id,
      cbo,
      lifetime: cbo && c.dailyMinor === null && c.lifetimeMinor !== null,
      level: c.budgetLevel,
      st: { exists: true, on: c.status === "ACTIVE", daily: cbo ? c.dailyMinor : null },
      startDay: startDayOf(c.start),
      endDay: endDayOf(c.end),
      adsets: [],
      brokenThrough: null,
    };
    for (const a of c.adsets) {
      const as: AdsetS = {
        id: a.id,
        lifetime: a.dailyMinor === null && a.lifetimeMinor !== null,
        st: { exists: true, on: a.status === "ACTIVE", daily: a.dailyMinor },
        startDay: startDayOf(a.start),
        endDay: endDayOf(a.end),
        campaign: cs,
      };
      cs.adsets.push(as);
      sets.set(a.id, as);
    }
    camps.set(c.id, cs);
  }
  const account = { why: accountWhyNot(input.accountStatus) };
  // Set inside undo(); `as` keeps TypeScript from narrowing them to null here.
  let strayThrough = null as string | null;
  let unlistedThrough = null as string | null;
  const unlisted = new Set<string>();
  const brokenIds = new Set<string>();
  const later = (a: string | null, b: string) => (a === null || b > a ? b : a);
  const broke = (c: CampS, day: string) => {
    c.brokenThrough = later(c.brokenThrough, day);
    brokenIds.add(c.id);
  };

  /** Undo one change: the state before it. */
  const undo = (e: Activity, day: string) => {
    const x = e.extra;
    switch (e.type) {
      case "update_campaign_budget":
      case "create_campaign_group":
      case "update_campaign_run_status": {
        const c = camps.get(e.objectId);
        if (!c) {
          unlisted.add(e.objectId);
          unlistedThrough = later(unlistedThrough, day);
          return;
        }
        if (e.type === "update_campaign_run_status") {
          const nv = runCode(x, "new_value");
          const ov = runCode(x, "old_value");
          if (nv === null || ov === null || ON_CODES.has(nv) !== c.st.on) broke(c, day);
          if (ov !== null) c.st.on = ON_CODES.has(ov);
          return;
        }
        const nv = amountOf(x, "new_value");
        if (e.type === "create_campaign_group") {
          if (nv !== null && c.cbo && !c.lifetime && perDay(x) !== false && nv !== c.st.daily) broke(c, day);
          c.st.exists = false;
          return;
        }
        if (!c.cbo) return broke(c, day);
        if (c.lifetime || perDay(x) === false) return;
        const ov = oldDaily(x);
        if (nv === null || ov === null || nv !== c.st.daily) broke(c, day);
        // Unknown before (0, or not a daily budget): no daily figure, never a $0 one.
        c.st.daily = ov;
        return;
      }
      case "update_ad_set_budget":
      case "create_ad_set":
      case "update_ad_set_run_status": {
        const a = sets.get(e.objectId);
        if (!a) {
          strayThrough = later(strayThrough, day);
          return;
        }
        if (e.type === "update_ad_set_run_status") {
          const nv = runCode(x, "new_value");
          const ov = runCode(x, "old_value");
          if (nv === null || ov === null || ON_CODES.has(nv) !== a.st.on) broke(a.campaign, day);
          if (ov !== null) a.st.on = ON_CODES.has(ov);
          return;
        }
        const nv = amountOf(x, "new_value");
        if (e.type === "create_ad_set") {
          if (nv !== null && !a.lifetime && perDay(x) !== false && nv !== a.st.daily) broke(a.campaign, day);
          a.st.exists = false;
          return;
        }
        if (a.lifetime || perDay(x) === false) return;
        const ov = oldDaily(x);
        if (nv === null || ov === null || nv !== a.st.daily) broke(a.campaign, day);
        a.st.daily = ov;
        return;
      }
      case "ad_account_update_status": {
        if (typeof x.old_value === "string") account.why = accountLabelWhyNot(x.old_value);
        return;
      }
      default:
        return;
    }
  };

  /** The campaign's state on day D as it stands (the changes after it undone): the hourly read's rule. */
  const evaluate = (c: CampS, D: string): Ev | null => {
    if (!c.st.exists) return null;
    const sched = (o: { startDay: string | null; endDay: string | null }) => (o.startDay === null || o.startDay <= D) && (o.endDay === null || o.endDay >= D);
    const live = c.adsets.filter(a => a.st.exists);
    const on = live.filter(a => a.st.on && sched(a));
    const cSched = sched(c);
    const switchedOn = c.st.on && cSched && on.length > 0;
    let budgetType: Ev["budgetType"];
    let daily: number | null;
    if (c.cbo) {
      budgetType = c.lifetime ? "lifetime" : c.st.daily !== null ? "daily" : null;
      daily = c.lifetime ? null : c.st.daily;
    } else {
      // The ad sets switched on, as the hourly read counts them.
      const ds = on.filter(a => !a.lifetime && a.st.daily !== null);
      daily = ds.length ? ds.reduce((n, a) => n + (a.st.daily ?? 0), 0) : null;
      budgetType = ds.length ? "daily" : on.some(a => a.lifetime) ? "lifetime" : null;
    }
    const whyNot = switchedOn
      ? account.why
      : !c.st.on
        ? "Paused"
        : !cSched
          ? c.startDay !== null && c.startDay > D ? "Not started" : "Ended"
          : live.length === 0
            ? "No ad sets"
            : live.every(a => a.endDay !== null && a.endDay < D)
              ? "Ended"
              : "Ad sets paused";
    return { switchedOn, budgetType, daily, whyNot };
  };

  const events = input.events;
  const dayOfEvent = events.map(e => zonedDay(e.timeMs, timezone));
  let i = 0;
  // The changes after the last day rebuilt (today's) are undone first.
  while (i < events.length && dayOfEvent[i] > until) {
    undo(events[i], dayOfEvent[i]);
    i += 1;
  }
  const rows: HistoryRow[] = [];
  const days: HistoryDay[] = [];
  const major = (n: number | null) => (n === null ? null : n / offset);
  for (let D = until; D >= since; D = addDays(D, -1)) {
    const all = [...camps.values()];
    const seq: Map<string, Ev | null>[] = [new Map(all.map(c => [c.id, evaluate(c, D)]))];
    let spendLimit = false;
    while (i < events.length && dayOfEvent[i] === D) {
      if (events[i].type === "ad_account_update_spend_limit") spendLimit = true;
      undo(events[i], D);
      seq.push(new Map(all.map(c => [c.id, evaluate(c, D)])));
      i += 1;
    }
    const dayRows: HistoryRow[] = [];
    const brokenToday: string[] = [];
    for (const c of all) {
      const states = seq.map(m => m.get(c.id)).filter((s): s is Ev => Boolean(s));
      if (!states.some(s => s.switchedOn)) continue;
      const end = states[0];
      const onDaily = states.filter(s => s.switchedOn && s.budgetType === "daily" && s.daily !== null);
      const budgets = new Set(states.map(s => `${s.budgetType}|${s.daily}`));
      const broken = c.brokenThrough !== null && D <= c.brokenThrough;
      if (broken) brokenToday.push(c.id);
      dayRows.push({
        campaignId: c.id,
        day: D,
        budgetLevel: c.level,
        budgetType: end.budgetType,
        dailyBudget: end.budgetType === "daily" ? major(end.daily) : null,
        maxBudget: onDaily.length ? major(Math.max(...onDaily.map(s => s.daily as number))) : null,
        switchedOn: end.switchedOn,
        switchedOnAny: true,
        whyNot: end.whyNot,
        changedDuringDay: budgets.size > 1,
        verified: input.unreadable === 0 && !broken && !(!c.cbo && strayThrough !== null && D <= strayThrough),
      });
    }
    dayRows.sort((a, b) => (a.campaignId < b.campaignId ? -1 : 1));
    // Only the campaigns whose own chain broke: a stray ad set has its own sentence.
    brokenToday.sort();
    const unlistedToday = unlistedThrough !== null && D <= unlistedThrough;
    const strayToday = strayThrough !== null && D <= strayThrough;
    const note = [
      input.unreadable ? `${input.unreadable} activity events could not be read.` : "",
      brokenToday.length ? `The activity log does not lead to the live budget for campaign ${brokenToday.join(", ")}.` : "",
      unlistedToday ? "A campaign archived or deleted since changed on or after this day; it is not rebuilt." : "",
      strayToday ? "An ad set Meta no longer lists changed on or after this day." : "",
      spendLimit ? "The account spending limit changed this day." : "",
    ]
      .filter(Boolean)
      .join(" ")
      .slice(0, 300);
    days.push({
      day: D,
      campaigns: dayRows.length,
      verified: input.unreadable === 0 && brokenToday.length === 0 && !unlistedToday && !strayToday,
      note: note || null,
    });
    rows.push(...dayRows);
  }
  rows.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : a.campaignId < b.campaignId ? -1 : 1));
  days.reverse();
  const unverified = days.filter(d => !d.verified).length;
  const note = unverified
    ? `${unverified} of ${days.length} days not verified${brokenIds.size ? `: the log does not lead to the live budget for ${brokenIds.size} campaign${brokenIds.size > 1 ? "s" : ""}` : ""}${unlisted.size ? `${brokenIds.size ? "," : ":"} ${unlisted.size} campaign${unlisted.size > 1 ? "s" : ""} gone since` : ""}${input.unreadable ? `${brokenIds.size || unlisted.size ? "," : ":"} ${input.unreadable} events unreadable` : ""}.`
    : null;
  return { rows, days, broken: [...brokenIds].sort(), unlisted: [...unlisted].sort(), note };
}

/** A history row as cockpit_meta_budget_history_apply takes it, with the account it belongs to (the database checks it). */
export function toHistoryApplyRow(r: HistoryRow, accountId: string): Record<string, unknown> {
  return {
    campaign_id: r.campaignId,
    account_id: accountId,
    day: r.day,
    budget_level: r.budgetLevel,
    budget_type: r.budgetType,
    daily_budget: r.dailyBudget,
    max_budget: r.maxBudget,
    switched_on: r.switchedOn,
    switched_on_any: r.switchedOnAny,
    why_not: r.whyNot,
    changed_during_day: r.changedDuringDay,
    verified: r.verified,
  };
}
