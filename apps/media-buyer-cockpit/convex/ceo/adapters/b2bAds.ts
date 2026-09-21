import { CPL_GATE } from "../../constants";
import { graph } from "../../tools";
import type {
  B2bAdNode,
  B2bAdsPayload,
  B2bPeople,
  B2bVerdict,
  Note,
} from "../payloads";
import { B2B, num, sql } from "../sb";
import { addDays, kuwaitDay } from "../time";
import type { Adapter, DailyPoint, SourceStamp } from "../types";

type Any = Record<string, any>;

/**
 * Mahara's own ad account, campaign by ad set by ad, with the whole funnel
 * under every row.
 *
 * The client Ads Management screen stops at leads, because that is where the
 * cockpit's knowledge of a client's funnel ends. This one does not have to.
 * Mahara's leads, intro calls, demos and signed deals all carry the ad, ad set
 * and campaign they came from (GHL writes the ids onto the contact at opt-in,
 * and the closing form inherits them), so every ad here can be followed from
 * the first impression to the contract. 68% of leads, 88% of calls and 64% of
 * deals carried an ad id on 2026-09-19; the rest are organic, WhatsApp or
 * typed in by hand, and are simply not on this screen.
 *
 * Two lead counts, on purpose. `metaLeads` is what Meta says the ad produced.
 * `leads` is what actually arrived in the CRM attributed to it and carries a
 * ROAS tag of qualified or unqualified (Aziz, 2026-09-21). They disagree
 * per ad, sometimes by a lot, and the gap is a diagnosis in itself: Meta
 * counted a form fill that never became a contact, or the contact arrived
 * without its attribution.
 *
 * Verdicts go deeper than the client version because the data does. An ad can
 * be killed for cost, but it can also be told apart from a landing page that
 * loses the lead, a setter who cannot book the intro, and a closer who cannot
 * close the demo. Those are three different people's problems, and the worst
 * thing this screen could do is blame the creative for all of them.
 *
 * Seven days judges freshness and cost. Thirty days judges the funnel, because
 * a demo takes a week to happen and a close takes longer.
 */

const ACCOUNT = "746108264865897";

/** Meta's account_status codes. Anything but 1 means the account is not delivering. */
const ACCOUNT_STATUS: Record<number, string> = {
  1: "active",
  2: "disabled",
  3: "unsettled",
  7: "pending risk review",
  8: "pending settlement",
  9: "in grace period",
  100: "pending closure",
  101: "closed",
  201: "any active",
  202: "any closed",
};

const DISABLE_REASON: Record<number, string> = {
  1: "ads integrity policy",
  2: "ads IP review",
  3: "risk payment",
  4: "gray account shut down",
  5: "ads AFC review",
  6: "business integrity RAR",
  7: "permanent close",
  8: "unused reseller account",
  9: "unused account",
  10: "umbrella ad account",
  11: "business manager integrity policy",
  12: "misrepresented ad account",
  13: "AOAB desmotivate unused account",
  14: "CTA review",
  15: "AWS account review",
  16: "AB review",
};

function day(d: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new Error(`b2bAds: bad day ${d}`);
  return `date '${d}'`;
}

const usd = (x: number) => Math.round(x * 100) / 100;
const rate = (a: number, b: number) => (b > 0 ? a / b : null);

/**
 * One row per ad with both windows side by side. Ads are the grain; ad sets
 * and campaigns are sums of their ads, so a number never disagrees with the
 * rows beneath it.
 */
function treeSql(from7: string, from30: string, to: string): string {
  const funnel = (from: string, alias: string) => `
  ${alias}_ads as (
    select campaign_id, adset_id, ad_id,
           sum(spend) as spend, sum(impressions) as impressions,
           sum(clicks) as clicks,
           sum(inline_link_clicks) as link_clicks, sum(leads) as meta_leads,
           max(frequency) as freq
    from public.meta_ad_snapshots
    where date between ${day(from)} and ${day(to)}
    group by 1,2,3),
  ${alias}_leads as (
    -- Leads by the setters' ROAS tags (Aziz, 2026-09-21): qualified plus
    -- unqualified count; unprepared is "not ready" and is shown apart.
    select l.ad_id,
      count(*) filter (where ('roas-qualified' = any(coalesce(l.tags, '{}'::text[])) or 'roas-unqualified' = any(coalesce(l.tags, '{}'::text[])))) as leads,
      count(*) filter (where 'roas-qualified' = any(coalesce(l.tags, '{}'::text[]))) as qualified_leads,
      count(*) filter (where 'roas-qualified' <> all(coalesce(l.tags, '{}'::text[])) and 'roas-unqualified' <> all(coalesce(l.tags, '{}'::text[])) and 'roas-unprepared' = any(coalesce(l.tags, '{}'::text[]))) as not_ready_leads
    from public.leads l
    where l.ad_id is not null
      and (l.lead_created_at at time zone 'Asia/Riyadh')::date between ${day(from)} and ${day(to)}
    group by 1),
  ${alias}_calls as (
    -- The dashboard's dating (b2b_window_metrics): a booking counts on the
    -- day it was booked; due, shown, qualified and cancelled count on the
    -- day the call was for, and only once that day has passed.
    select c.ad_id,
      count(*) filter (where c.call_type='intro' and (c.booked_at at time zone 'Asia/Riyadh')::date between ${day(from)} and ${day(to)}) as intros_booked,
      count(*) filter (where c.call_type='intro' and (c.start_at at time zone 'Asia/Riyadh')::date between ${day(from)} and ${day(to)} and c.start_at <= now()) as intros_due,
      count(*) filter (where c.call_type='intro' and (c.start_at at time zone 'Asia/Riyadh')::date between ${day(from)} and ${day(to)} and (c.status='showed' or (c.status in ('confirmed','invalid') and c.start_at <= now()))) as intros_shown,
      count(*) filter (where c.call_type='intro' and (c.start_at at time zone 'Asia/Riyadh')::date between ${day(from)} and ${day(to)} and (c.status='showed' or (c.status='confirmed' and c.start_at <= now()))) as intros_qualified,
      count(*) filter (where c.call_type='intro' and (c.start_at at time zone 'Asia/Riyadh')::date between ${day(from)} and ${day(to)} and c.status='cancelled') as intros_cancelled,
      count(*) filter (where c.call_type='intro' and (c.start_at at time zone 'Asia/Riyadh')::date between ${day(from)} and ${day(to)} and (c.status='showed' or (c.status in ('confirmed','invalid') and c.start_at <= now()))
        and exists (select 1 from public.calls d where d.contact_id = c.contact_id and d.call_type='demo' and d.booked_at >= c.start_at)) as intros_advanced,
      count(*) filter (where c.call_type='demo' and (c.booked_at at time zone 'Asia/Riyadh')::date between ${day(from)} and ${day(to)}) as demos_booked,
      count(*) filter (where c.call_type='demo' and (c.start_at at time zone 'Asia/Riyadh')::date between ${day(from)} and ${day(to)} and c.start_at <= now()) as demos_due,
      count(*) filter (where c.call_type='demo' and (c.start_at at time zone 'Asia/Riyadh')::date between ${day(from)} and ${day(to)} and (c.status='showed' or (c.status in ('confirmed','invalid') and c.start_at <= now()))) as demos_shown,
      count(*) filter (where c.call_type='demo' and (c.start_at at time zone 'Asia/Riyadh')::date between ${day(from)} and ${day(to)} and (c.status='showed' or (c.status='confirmed' and c.start_at <= now()))) as demos_qualified,
      count(*) filter (where c.call_type='demo' and (c.start_at at time zone 'Asia/Riyadh')::date between ${day(from)} and ${day(to)} and c.status='cancelled') as demos_cancelled
    from public.calls c
    where c.ad_id is not null
      and ((c.booked_at at time zone 'Asia/Riyadh')::date between ${day(from)} and ${day(to)}
        or (c.start_at at time zone 'Asia/Riyadh')::date between ${day(from)} and ${day(to)})
    group by 1),
  ${alias}_deals as (
    select ad_id, count(*) as closes,
           coalesce(sum(contracted_revenue),0) as contracted,
           coalesce(sum(cash_collected),0) as cash
    from public.closed_deals
    where ad_id is not null
      and (submitted_at at time zone 'Asia/Riyadh')::date between ${day(from)} and ${day(to)}
    group by 1)`;

  const cols = (a: string) => `
    coalesce(${a}_ads.spend,0) as ${a}_spend,
    coalesce(${a}_ads.impressions,0) as ${a}_impressions,
    coalesce(${a}_ads.clicks,0) as ${a}_clicks,
    coalesce(${a}_ads.link_clicks,0) as ${a}_link_clicks,
    coalesce(${a}_ads.meta_leads,0) as ${a}_meta_leads,
    ${a}_ads.freq as ${a}_freq,
    coalesce(${a}_leads.leads,0) as ${a}_leads,
    coalesce(${a}_leads.qualified_leads,0) as ${a}_qualified_leads,
    coalesce(${a}_leads.not_ready_leads,0) as ${a}_not_ready_leads,
    coalesce(${a}_calls.intros_booked,0) as ${a}_intros_booked,
    coalesce(${a}_calls.intros_due,0) as ${a}_intros_due,
    coalesce(${a}_calls.intros_shown,0) as ${a}_intros_shown,
    coalesce(${a}_calls.intros_qualified,0) as ${a}_intros_qualified,
    coalesce(${a}_calls.intros_cancelled,0) as ${a}_intros_cancelled,
    coalesce(${a}_calls.intros_advanced,0) as ${a}_intros_advanced,
    coalesce(${a}_calls.demos_booked,0) as ${a}_demos_booked,
    coalesce(${a}_calls.demos_due,0) as ${a}_demos_due,
    coalesce(${a}_calls.demos_shown,0) as ${a}_demos_shown,
    coalesce(${a}_calls.demos_qualified,0) as ${a}_demos_qualified,
    coalesce(${a}_calls.demos_cancelled,0) as ${a}_demos_cancelled,
    coalesce(${a}_deals.closes,0) as ${a}_closes,
    coalesce(${a}_deals.contracted,0) as ${a}_contracted,
    coalesce(${a}_deals.cash,0) as ${a}_cash`;

  return `with
  ident as (
    select distinct on (ad_id) ad_id, adset_id, campaign_id,
           ad_name, adset_name, campaign_name, campaign_status, effective_status, thumbnail_url
    from public.meta_ad_snapshots
    where date between ${day(from30)} and ${day(to)}
    order by ad_id, date desc),
  ${funnel(from7, "w7")},
  ${funnel(from30, "w30")},
  setters as (
    select distinct on (c.ad_id) c.ad_id,
      coalesce(sr.display_name, 'Unknown setter') as setter_name,
      count(*) filter (where c.status in ('showed','confirmed','invalid') and c.start_at < now()) as setter_shown,
      count(*) filter (where c.start_at < now()) as setter_due
    from public.calls c
    left join public.sales_reps sr on sr.ghl_user_id = c.assigned_user_id
    where c.ad_id is not null and c.call_type = 'intro' and c.assigned_user_id is not null
      and (c.booked_at at time zone 'Asia/Riyadh')::date between ${day(from30)} and ${day(to)}
    group by c.ad_id, c.assigned_user_id, sr.display_name
    order by c.ad_id, count(*) desc),
  closers as (
    select distinct on (ad_id) ad_id, closer as closer_name, count(*) as closer_closes
    from public.closed_deals
    where ad_id is not null and closer is not null and btrim(closer) <> ''
      and (submitted_at at time zone 'Asia/Riyadh')::date between ${day(from30)} and ${day(to)}
    group by ad_id, closer
    order by ad_id, count(*) desc)
select ident.*, public.b2b_campaign_type(ident.campaign_name) as campaign_type,
  setters.setter_name, setters.setter_shown, setters.setter_due,
  closers.closer_name, closers.closer_closes,
  ${cols("w7")},
  ${cols("w30")}
from ident
left join w7_ads on w7_ads.ad_id = ident.ad_id
left join w7_leads on w7_leads.ad_id = ident.ad_id
left join w7_calls on w7_calls.ad_id = ident.ad_id
left join w7_deals on w7_deals.ad_id = ident.ad_id
left join w30_ads on w30_ads.ad_id = ident.ad_id
left join w30_leads on w30_leads.ad_id = ident.ad_id
left join w30_calls on w30_calls.ad_id = ident.ad_id
left join w30_deals on w30_deals.ad_id = ident.ad_id
left join setters on setters.ad_id = ident.ad_id
left join closers on closers.ad_id = ident.ad_id
order by ident.campaign_name, ident.adset_name, w30_ads.spend desc nulls last`;
}

type Win = B2bAdNode["w7"];

/** Every count on a window, in one place, so the builders never drift apart. */
const COUNTS = [
  "impressions",
  "clicks",
  "linkClicks",
  "metaLeads",
  "leads",
  "qualifiedLeads",
  "notReadyLeads",
  "introsBooked",
  "introsDue",
  "introsShown",
  "introsQualified",
  "introsCancelled",
  "introsAdvanced",
  "demosBooked",
  "demosDue",
  "demosShown",
  "demosQualified",
  "demosCancelled",
  "closes",
] as const;

const COLUMN: Record<(typeof COUNTS)[number], string> = {
  impressions: "impressions",
  clicks: "clicks",
  linkClicks: "link_clicks",
  metaLeads: "meta_leads",
  leads: "leads",
  qualifiedLeads: "qualified_leads",
  notReadyLeads: "not_ready_leads",
  introsBooked: "intros_booked",
  introsDue: "intros_due",
  introsShown: "intros_shown",
  introsQualified: "intros_qualified",
  introsCancelled: "intros_cancelled",
  introsAdvanced: "intros_advanced",
  demosBooked: "demos_booked",
  demosDue: "demos_due",
  demosShown: "demos_shown",
  demosQualified: "demos_qualified",
  demosCancelled: "demos_cancelled",
  closes: "closes",
};

const emptyWin = (): Win => {
  const w = {
    spend: 0,
    contracted: 0,
    cash: 0,
    frequency: null,
  } as Win;
  for (const k of COUNTS) w[k] = 0;
  return finish(w);
};

function winOf(r: Record<string, unknown>, a: string): Win {
  const g = (k: string) => num(r[`${a}_${k}`]);
  const w = {
    spend: usd(g("spend")),
    contracted: usd(g("contracted")),
    cash: usd(g("cash")),
    frequency:
      r[`${a}_freq`] === null || r[`${a}_freq`] === undefined
        ? null
        : Math.round(num(r[`${a}_freq`]) * 100) / 100,
  } as Win;
  for (const k of COUNTS) w[k] = g(COLUMN[k]);
  return finish(w);
}

function addWin(into: Win, w: Win): void {
  into.spend = usd(into.spend + w.spend);
  into.contracted = usd(into.contracted + w.contracted);
  into.cash = usd(into.cash + w.cash);
  for (const k of COUNTS) into[k] += w[k];
  // Frequency does not sum: a person reached by two ads is one person. The
  // parent shows the highest of its children, which is the ad most at risk.
  if (w.frequency !== null)
    into.frequency =
      into.frequency === null
        ? w.frequency
        : Math.max(into.frequency, w.frequency);
}

const per = (a: number, b: number) => (b > 0 ? usd(a / b) : null);
const ratio = (a: number, b: number) =>
  b > 0 ? Math.round((a / b) * 10000) / 10000 : null;

/** The derived numbers, exactly as the B2B dashboard defines them. */
function finish(w: Win): Win {
  w.cpm = w.impressions > 0 ? usd((w.spend / w.impressions) * 1000) : null;
  w.ctr = ratio(w.clicks, w.impressions);
  w.ctrLink = ratio(w.linkClicks, w.impressions);
  w.cpc = per(w.spend, w.linkClicks);
  w.cpl = per(w.spend, w.leads);
  w.qualifiedPct = ratio(w.qualifiedLeads, w.leads);
  w.costPerQualified = per(w.spend, w.qualifiedLeads);
  w.bookRate = ratio(w.introsBooked, w.leads);
  w.costPerIntroBooked = per(w.spend, w.introsBooked);
  w.introShowRate = ratio(w.introsShown, w.introsDue);
  w.costPerIntroShown = per(w.spend, w.introsShown);
  w.introToDemo = ratio(w.introsAdvanced, w.introsShown);
  w.demoShowRate = ratio(w.demosShown, w.demosDue);
  w.costPerDemoBooked = per(w.spend, w.demosBooked);
  w.costPerDemo = per(w.spend, w.demosShown);
  w.closeRate = ratio(w.closes, w.demosShown);
  w.closeRateQualified = ratio(w.closes, w.demosQualified);
  w.cac = per(w.spend, w.closes);
  w.roas =
    w.spend > 0 ? Math.round((w.contracted / w.spend) * 100) / 100 : null;
  w.cashRoas = w.spend > 0 ? Math.round((w.cash / w.spend) * 100) / 100 : null;
  w.leadToDemo = ratio(w.demosBooked, w.leads);
  return w;
}

const noPeople = (): B2bPeople => ({ setter: null, closer: null });

/** The setter with the most intros shown and the closer with the most closes across a group of ads. */
function peopleOf(ads: B2bAdNode[]): B2bPeople {
  const setters = new Map<string, { shown: number; due: number }>();
  const closers = new Map<string, number>();
  for (const a of ads) {
    if (a.people.setter) {
      const s = setters.get(a.people.setter.name) ?? { shown: 0, due: 0 };
      s.shown += a.people.setter.shown;
      s.due += a.people.setter.due;
      setters.set(a.people.setter.name, s);
    }
    if (a.people.closer)
      closers.set(
        a.people.closer.name,
        (closers.get(a.people.closer.name) ?? 0) + a.people.closer.closes,
      );
  }
  const setter = [...setters.entries()].sort(
    (x, y) => y[1].shown - x[1].shown || y[1].due - x[1].due,
  )[0];
  const closer = [...closers.entries()].sort((x, y) => y[1] - x[1])[0];
  return {
    setter: setter ? { name: setter[0], ...setter[1] } : null,
    closer: closer ? { name: closer[0], closes: closer[1] } : null,
  };
}

/**
 * What to do about this ad, and whose problem it is.
 *
 * Money is judged on seven days against Aziz's cost per lead gate. The funnel
 * is judged on thirty, because a demo takes a week to happen. And the funnel
 * verdicts name a stage rather than the ad, because an ad that fills the
 * calendar with intros nobody converts is a setter problem, and switching the
 * ad off would be the one thing that makes it worse.
 */
function judge(
  running: boolean,
  w7: Win,
  w30: Win,
  staleSince: string | null,
): B2bVerdict {
  if (!running)
    return {
      verdict: "off",
      reason: "Not delivering: switched off in Meta.",
      owner: null,
    };
  // A stale snapshot is not the same as an ad that stopped. Say which.
  if (staleSince && w7.spend < 1)
    return {
      verdict: "no delivery",
      reason: `Meta has reported no delivery since ${staleSince}. Either it has been off since then or Meta is late; this week cannot be judged yet.`,
      owner: "ads",
    };
  if (w7.spend < 1)
    return {
      verdict: "no delivery",
      reason: "On, but nothing spent in seven days.",
      owner: "ads",
    };
  if (w7.leads === 0 && w7.spend >= 30)
    return {
      verdict: "kill",
      reason: `$${w7.spend.toFixed(0)} in seven days and not one lead reached the CRM${w7.metaLeads > 0 ? `, though Meta counts ${w7.metaLeads}` : ""}.`,
      owner: "ads",
    };
  if (w7.cpl !== null && w7.cpl > CPL_GATE * 1.5)
    return {
      verdict: "kill",
      reason: `$${w7.cpl.toFixed(2)} a lead, more than half again over the $${CPL_GATE} gate.`,
      owner: "ads",
    };
  if (w7.frequency !== null && w7.frequency >= 2.5)
    return {
      verdict: "fatiguing",
      reason: `Frequency ${w7.frequency.toFixed(2)}: the same people keep seeing it. Refresh the creative before the cost moves.`,
      owner: "ads",
    };
  if (w30.leads >= 8 && w30.introsBooked === 0)
    return {
      verdict: "leads do not book",
      reason: `${w30.leads} leads in thirty days and no intro booked. The ad is doing its job; the follow-up is not.`,
      owner: "setter",
    };
  if (w30.introsShown >= 5 && w30.demosBooked === 0)
    return {
      verdict: "intros do not convert",
      reason: `${w30.introsShown} intros shown and no demo booked. That is the intro call, not the ad.`,
      owner: "setter",
    };
  if (w30.demosShown >= 3 && w30.closes === 0)
    return {
      verdict: "demos do not close",
      reason: `${w30.demosShown} demos shown and nothing signed. That is the closing call, not the ad.`,
      owner: "closer",
    };
  if (w7.cpl !== null && w7.cpl > CPL_GATE)
    return {
      verdict: "hold",
      reason: `$${w7.cpl.toFixed(2)} a lead is over the $${CPL_GATE} gate but within half again. Watch it; do not scale it.`,
      owner: "ads",
    };
  return {
    verdict: "scale",
    reason: `$${(w7.cpl ?? 0).toFixed(2)} a lead under the $${CPL_GATE} gate on $${w7.spend.toFixed(0)}${w30.closes ? `, and ${w30.closes} ${w30.closes === 1 ? "close" : "closes"} in thirty days` : ""}.`,
    owner: "ads",
  };
}

/**
 * The weakest stage of a campaign's funnel against the account as a whole.
 * Named so the fix is a person, not a guess: creative, landing page, setter
 * or closer.
 */
function constraintOf(
  c: Win,
  account: Win,
): B2bAdsPayload["campaigns"][number]["constraint"] {
  const stages: {
    key: string;
    label: string;
    owner: "ads" | "landing" | "setter" | "closer";
    mine: number | null;
    all: number | null;
    floor: number;
  }[] = [
    {
      key: "click",
      label: "impressions to link clicks",
      owner: "ads",
      mine: rate(c.linkClicks, c.impressions),
      all: rate(account.linkClicks, account.impressions),
      floor: 500,
    },
    {
      key: "optin",
      label: "clicks to leads",
      owner: "landing",
      mine: rate(c.leads, c.linkClicks),
      all: rate(account.leads, account.linkClicks),
      floor: 30,
    },
    {
      key: "book",
      label: "leads to intros booked",
      owner: "setter",
      mine: rate(c.introsBooked, c.leads),
      all: rate(account.introsBooked, account.leads),
      floor: 8,
    },
    {
      key: "show",
      label: "intros booked to shown",
      owner: "setter",
      mine: rate(c.introsShown, c.introsBooked),
      all: rate(account.introsShown, account.introsBooked),
      floor: 5,
    },
    {
      key: "demo",
      label: "intros shown to demos booked",
      owner: "setter",
      mine: rate(c.demosBooked, c.introsShown),
      all: rate(account.demosBooked, account.introsShown),
      floor: 5,
    },
    {
      key: "close",
      label: "demos shown to closes",
      owner: "closer",
      mine: rate(c.closes, c.demosShown),
      all: rate(account.closes, account.demosShown),
      floor: 3,
    },
  ];
  const denom: Record<string, number> = {
    click: c.impressions,
    optin: c.linkClicks,
    book: c.leads,
    show: c.introsBooked,
    demo: c.introsShown,
    close: c.demosShown,
  };
  // Calls carry their ad id more reliably than leads do (88% against 68% on
  // 2026-09-19), so a campaign can show more intros booked than leads. When
  // that happens the lead count is provably incomplete and "clicks to leads"
  // would blame a landing page for an attribution gap. Skip it.
  const leadsUnderCounted = c.introsBooked > c.leads;
  let worst: (typeof stages)[number] | null = null;
  let worstGap = 0;
  for (const s of stages) {
    if (s.mine === null || s.all === null || s.all === 0) continue;
    if (denom[s.key] < s.floor) continue; // too few to judge
    if (leadsUnderCounted && (s.key === "optin" || s.key === "book")) continue;
    const gap = (s.all - s.mine) / s.all;
    if (gap > worstGap) {
      worstGap = gap;
      worst = s;
    }
  }
  if (!worst || worstGap < 0.2) return null;
  return {
    stage: worst.label,
    owner: worst.owner,
    mine: Math.round((worst.mine ?? 0) * 1000) / 1000,
    account: Math.round((worst.all ?? 0) * 1000) / 1000,
  };
}

export const b2bAds: Adapter = {
  key: "b2bAds",
  label: "Our ads",
  compute: async ctx => {
    void ctx;
    const now = Date.now();
    const today = kuwaitDay(now);
    const from7 = addDays(today, -6);
    const from30 = addDays(today, -29);
    const notes: Note[] = [];

    // Freshness first, because every verdict below needs to know it.
    const freshRows = await sql(
      B2B,
      `select max(extract(epoch from last_synced_at) * 1000) as ms,
              to_char(max(date), 'YYYY-MM-DD') as last_day
       from public.meta_ad_snapshots`,
    );
    const freshestAt = num(freshRows[0]?.ms) || undefined;
    const lastDay = freshRows[0]?.last_day
      ? String(freshRows[0].last_day)
      : null;
    // Yesterday is the newest day Meta can reasonably have closed out.
    const staleSince = lastDay && lastDay < addDays(today, -1) ? lastDay : null;

    // The account itself, from Meta: a disabled or unsettled account explains
    // an empty week better than any verdict can, and nothing can be created
    // on it until it is fixed.
    let accountStatus: B2bAdsPayload["accountStatus"] = null;
    let accountNote: string | undefined;
    try {
      const acct: Any = await graph(`act_${ACCOUNT}`, {
        fields:
          "account_status,disable_reason,balance,currency,amount_spent,spend_cap",
      });
      const code = num(acct.account_status);
      const reason = num(acct.disable_reason);
      accountStatus = {
        code,
        label: ACCOUNT_STATUS[code] ?? `status ${code}`,
        disableReason: reason
          ? (DISABLE_REASON[reason] ?? `reason ${reason}`)
          : null,
        balance:
          acct.balance !== undefined && acct.balance !== null
            ? num(acct.balance) / 100
            : null,
        currency: acct.currency ? String(acct.currency) : null,
      };
    } catch (e) {
      accountNote = String(e instanceof Error ? e.message : e).slice(0, 160);
    }

    const rows = await sql(B2B, treeSql(from7, from30, today));
    // The whole CRM in the same windows, so the screen can say how much of
    // it carries an ad. Without this the ad-attributed totals would read as
    // the business, and they are not: 310 leads and 8 signed deals in the
    // thirty days to 2026-09-20 against 224 and 2 with an ad on them.
    const totals = await sql(
      B2B,
      `select
        (select count(*) from public.leads l where ('roas-qualified' = any(coalesce(l.tags, '{}'::text[])) or 'roas-unqualified' = any(coalesce(l.tags, '{}'::text[]))) and (l.lead_created_at at time zone 'Asia/Riyadh')::date between ${day(from7)} and ${day(today)}) as w7_leads,
        (select count(*) from public.leads l where ('roas-qualified' = any(coalesce(l.tags, '{}'::text[])) or 'roas-unqualified' = any(coalesce(l.tags, '{}'::text[]))) and (l.lead_created_at at time zone 'Asia/Riyadh')::date between ${day(from30)} and ${day(today)}) as w30_leads,
        (select count(*) from public.closed_deals where (submitted_at at time zone 'Asia/Riyadh')::date between ${day(from7)} and ${day(today)}) as w7_closes,
        (select count(*) from public.closed_deals where (submitted_at at time zone 'Asia/Riyadh')::date between ${day(from30)} and ${day(today)}) as w30_closes,
        (select coalesce(sum(contracted_revenue),0) from public.closed_deals where (submitted_at at time zone 'Asia/Riyadh')::date between ${day(from7)} and ${day(today)}) as w7_contracted,
        (select coalesce(sum(contracted_revenue),0) from public.closed_deals where (submitted_at at time zone 'Asia/Riyadh')::date between ${day(from30)} and ${day(today)}) as w30_contracted`,
    );
    const t = totals[0] ?? {};

    const account7 = emptyWin();
    const account30 = emptyWin();
    const all7 = emptyWin();
    const all30 = emptyWin();
    let retargeting7 = 0;
    let retargeting30 = 0;
    const campaigns = new Map<string, B2bAdsPayload["campaigns"][number]>();

    for (const r of rows) {
      const w7 = winOf(r, "w7");
      const w30 = winOf(r, "w30");
      const status = String(r.effective_status ?? "");
      const running = status === "ACTIVE";
      const ad: B2bAdNode = {
        id: String(r.ad_id),
        name: String(r.ad_name ?? `Ad ${r.ad_id}`),
        status,
        running,
        thumbnail: r.thumbnail_url ? String(r.thumbnail_url) : null,
        w7,
        w30,
        verdict: judge(running, w7, w30, staleSince),
        people: {
          setter: r.setter_name
            ? {
                name: String(r.setter_name),
                shown: num(r.setter_shown),
                due: num(r.setter_due),
              }
            : null,
          closer: r.closer_name
            ? { name: String(r.closer_name), closes: num(r.closer_closes) }
            : null,
        },
      };
      addWin(all7, w7);
      addWin(all30, w30);
      const kind = String(r.campaign_type ?? "unknown");
      // The account row is lead gen only, as the B2B dashboard defines it:
      // retargeting warms an audience it never gets credit for, and hiring
      // is not sales at all.
      if (kind === "lead_gen") {
        addWin(account7, w7);
        addWin(account30, w30);
      } else if (kind === "retargeting") {
        retargeting7 = usd(retargeting7 + w7.spend);
        retargeting30 = usd(retargeting30 + w30.spend);
      }

      const cid = String(r.campaign_id);
      const campaign = campaigns.get(cid) ?? {
        id: cid,
        name: String(r.campaign_name ?? cid),
        type: String(r.campaign_type ?? "unknown"),
        status: String(r.campaign_status ?? ""),
        running: false,
        w7: emptyWin(),
        w30: emptyWin(),
        people: noPeople(),
        constraint: null,
        adsets: [],
      };
      campaigns.set(cid, campaign);
      const sid = String(r.adset_id);
      let adset = campaign.adsets.find(a => a.id === sid);
      if (!adset) {
        adset = {
          id: sid,
          name: String(r.adset_name ?? sid),
          running: false,
          w7: emptyWin(),
          w30: emptyWin(),
          people: noPeople(),
          ads: [],
        };
        campaign.adsets.push(adset);
      }
      adset.ads.push(ad);
      addWin(adset.w7, w7);
      addWin(adset.w30, w30);
      addWin(campaign.w7, w7);
      addWin(campaign.w30, w30);
      if (running) {
        adset.running = true;
        campaign.running = true;
      }
    }

    finish(account7);
    finish(account30);
    finish(all7);
    finish(all30);
    const coverage = {
      w7: {
        leads: num(t.w7_leads),
        adLeads: all7.leads,
        closes: num(t.w7_closes),
        adCloses: all7.closes,
        contracted: usd(num(t.w7_contracted)),
        adContracted: all7.contracted,
      },
      w30: {
        leads: num(t.w30_leads),
        adLeads: all30.leads,
        closes: num(t.w30_closes),
        adCloses: all30.closes,
        contracted: usd(num(t.w30_contracted)),
        adContracted: all30.contracted,
      },
    };
    const list = [...campaigns.values()];
    for (const c of list) {
      finish(c.w7);
      finish(c.w30);
      for (const a of c.adsets) {
        finish(a.w7);
        finish(a.w30);
        a.ads.sort((x, y) => y.w30.spend - x.w30.spend);
        a.people = peopleOf(a.ads);
      }
      c.adsets.sort((x, y) => y.w30.spend - x.w30.spend);
      c.people = peopleOf(c.adsets.flatMap(a => a.ads));
      // A constraint is a funnel diagnosis, and only lead-gen campaigns run the
      // funnel. Retargeting warms an audience and the hiring campaign is not
      // sales at all, so judging either on clicks-to-leads blames them for a
      // job they were never given.
      c.constraint =
        c.type === "lead_gen" ? constraintOf(c.w30, account30) : null;
    }
    // Lead gen first, running first, then by spend.
    list.sort(
      (a, b) =>
        Number(b.type === "lead_gen") - Number(a.type === "lead_gen") ||
        Number(b.running) - Number(a.running) ||
        b.w30.spend - a.w30.spend,
    );

    const ads = list.flatMap(c => c.adsets.flatMap(a => a.ads));
    const running = ads.filter(a => a.running).length;
    const verdicts: Record<string, number> = {};
    for (const a of ads)
      if (a.running)
        verdicts[a.verdict.verdict] = (verdicts[a.verdict.verdict] ?? 0) + 1;

    if (accountStatus && accountStatus.code !== 1)
      notes.push({
        level: "warn",
        text: `Meta reports the ad account as ${accountStatus.label}${accountStatus.disableReason ? ` (${accountStatus.disableReason})` : ""}${accountStatus.balance ? `, with a balance of ${accountStatus.currency ?? ""} ${accountStatus.balance.toFixed(2)} outstanding` : ""}. Nothing delivers and nothing can be created or edited on the account until that is resolved in Ads Manager. It is the first thing to fix; every verdict below is about the past.`,
      });
    if (staleSince)
      notes.push({
        level: "warn",
        text: `"Running" here means switched on as of ${staleSince}, the newest day Meta has reported. Whether those ads are still on today is not known until the sync catches up.`,
      });
    if (running === 0)
      notes.push({
        level: "warn",
        text: `Nothing on the account is delivering. Every ad is switched off, so the seven-day column reads spend from before the pause and the verdicts are about what was running, not what is.`,
      });
    const gapAds = ads.filter(
      a => a.w30.metaLeads >= 5 && a.w30.leads < a.w30.metaLeads * 0.5,
    );
    if (gapAds.length)
      notes.push({
        level: "warn",
        text: `On ${gapAds.length} ${gapAds.length === 1 ? "ad" : "ads"} the CRM received fewer than half the leads Meta counts. Meta counts a form fill; the CRM counts a contact that arrived with its attribution. The gap is either forms that never became contacts or contacts that lost the ad on the way in, and it is the first thing to check before believing any cost per lead here.`,
      });
    const cov = coverage.w30;
    notes.push({
      level: "info",
      text: `In the last thirty days the CRM holds ${cov.leads} leads and ${cov.closes} signed deals worth $${cov.contracted.toLocaleString("en-US")}; ${cov.adLeads} leads and ${cov.adCloses} deals ($${cov.adContracted.toLocaleString("en-US")}) carry an ad id and are what this screen attributes. The rest came in organically, on WhatsApp or by hand. The account row is lead-gen campaigns only, the way the B2B dashboard reads it; retargeting spend is shown beside it and never inside a cost per lead.`,
    });
    notes.push({
      level: "info",
      text: `Every row follows an ad from the first impression to the signed contract, through leads, intro calls, demos and closes that carry the ad's id. Seven days judges cost and freshness; thirty days judges the funnel, because a demo takes a week to happen. Meta leads are what Meta claims; leads are what reached the CRM. Cost per lead is against Aziz's $${CPL_GATE} gate. Cost per demo has no gate set, so it is shown and never judged. Frequency on a parent is the highest of its ads, never a sum.`,
    });
    notes.push({
      level: "info",
      text: `A verdict names whose problem it is. "Kill", "hold", "scale" and "fatiguing" are the ad. "Leads do not book" and "intros do not convert" are the setter. "Demos do not close" is the closer. Switching an ad off never fixes the last three; it just stops the calendar filling.`,
    });
    if (staleSince) {
      const ranAt = freshestAt
        ? new Date(freshestAt + 3 * 3600_000)
            .toISOString()
            .slice(0, 16)
            .replace("T", " ")
        : null;
      notes.push({
        level: "warn",
        text: `Meta has reported no delivery since ${staleSince}.${
          ranAt
            ? ` The sync itself last ran at ${ranAt} Kuwait time and succeeded, so this is not a dead feed:`
            : ""
        } either nothing on the account has delivered since then, which fits every campaign being paused, or Meta is late. Until a newer day lands, every seven-day figure is that one day and the verdicts read from it.`,
      });
    }

    const payload: B2bAdsPayload = {
      accountId: ACCOUNT,
      windows: { from7, from30, to: today },
      account: { w7: account7, w30: account30 },
      retargetingSpend: { w7: retargeting7, w30: retargeting30 },
      coverage,
      running,
      total: ads.length,
      verdicts,
      campaigns: list,
      lastSnapshotDay: lastDay,
      accountStatus,
      notes,
    };

    const sources: SourceStamp[] = [
      { name: "B2B Meta ad snapshots", freshestAt, ok: true },
      { name: "B2B leads, calls and closed deals (ad attribution)", ok: true },
      accountStatus
        ? {
            name: "Meta ad account (Graph API)",
            ok: true,
            freshestAt: Date.now(),
          }
        : { name: "Meta ad account (Graph API)", ok: false, note: accountNote },
    ];

    const daily: DailyPoint[] = [
      {
        date: today,
        metric: "b2bAds.running",
        scope: "company",
        value: running,
      },
      {
        date: today,
        metric: "b2bAds.spend7",
        scope: "company",
        value: account7.spend,
      },
      {
        date: today,
        metric: "b2bAds.leads7",
        scope: "company",
        value: account7.leads,
      },
      {
        date: today,
        metric: "b2bAds.metaLeads7",
        scope: "company",
        value: account7.metaLeads,
      },
    ];
    for (const c of list)
      daily.push({
        date: today,
        metric: "b2bAds.campaign.spend7",
        scope: `campaign:${c.id}`,
        value: c.w7.spend,
      });

    return { payload, daily, sources };
  },
};
