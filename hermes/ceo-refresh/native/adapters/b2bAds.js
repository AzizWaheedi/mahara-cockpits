import { ACCOUNT_TIME_ZONE_FALLBACK, campaignKind, liveOnlyAds, liveState, metaUntil, offReason, readInsights, readLevelFrequency, readLiveStatus, } from "../../../../supabase/functions/cockpit-ceo-api/frequency.ts";
import { CPL_GATE, NO_LEAD_MULTIPLE } from "../constants.js";
import { addKnown, knownCount, LINK_CLICKS_SQL, linkCtr } from "../linkCtr.js";
import { graph, withOptionalReads } from "../tools.js";
import { B2B, num, sql } from "../sb.js";
import { addDays, kuwaitDay } from "../time.js";
import { NOT_VOIDED, VOIDED, voidedDeals } from "../voids.js";
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
 * loses the lead and a setter who cannot book or confirm the intro. Those are
 * different people's problems, and the worst thing this screen could do is
 * blame the creative for all of them.
 *
 * Per ad, the funnel stops at the intro (the CEO, 2026-10-18: "the link to
 * intro, that's it"): intros and confirmed intros, each lead once. Demos and
 * closes per appointment stay in the payload and are judged on the Sales tab.
 *
 * Seven days judges freshness and cost. Thirty days judges the funnel, because
 * an intro takes days to be held.
 */
const ACCOUNT = "746108264865897";
/** Meta's account_status codes. Anything but 1 means the account is not delivering. */
const ACCOUNT_STATUS = {
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
const DISABLE_REASON = {
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
function day(d) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d))
        throw new Error(`b2bAds: bad day ${d}`);
    return `date '${d}'`;
}
const usd = (x) => Math.round(x * 100) / 100;
/**
 * Seven days at this spend with no lead is a kill; under it, not enough data
 * (the CEO, 23 Oct 2026, cost per booking decisions, 4: "Depends on how much
 * spend if 2x target cpl then yes bad if below that then not enough data").
 * Computed from the gate, never typed; compared on the cent.
 */
export const KILL_FLOOR = NO_LEAD_MULTIPLE * CPL_GATE;
// A count that is not known (null link clicks) gives no rate, never 0.
const rate = (a, b) => (a !== null && b > 0 ? a / b : null);
/**
 * One row per ad with both windows side by side. Ads are the grain; ad sets
 * and campaigns are sums of their ads, so a number never disagrees with the
 * rows beneath it. Frequency is the exception and is not read here: it is
 * Meta's own at each level (readWindowFrequency).
 */
export function treeSql(from7, from30, to) {
    const ROAS_LEAD = `('roas-qualified' = any(coalesce(l.tags, '{}'::text[])) or 'roas-unqualified' = any(coalesce(l.tags, '{}'::text[])))`;
    // `status` narrows which of the lead's calls count; null counts every call.
    const leadsBooked = (type, as, status = null) => `count(*) filter (where ${ROAS_LEAD} and exists (select 1 from public.calls b where b.contact_id = l.contact_id and b.call_type = '${type}'${status ? ` and ${status}` : ""} and b.booked_at >= l.lead_created_at and (b.booked_at at time zone 'Asia/Riyadh')::date <= ${day(to)})) as ${as}`;
    const funnel = (from, alias) => `
  ${alias}_ads as (
    select campaign_id, adset_id, ad_id,
           sum(spend) as spend, sum(impressions) as impressions,
           sum(clicks) as clicks,
           ${LINK_CLICKS_SQL()} as link_clicks, sum(leads) as meta_leads
    from public.meta_ad_snapshots
    where date between ${day(from)} and ${day(to)}
    group by 1,2,3),
  ${alias}_leads as (
    -- Leads by the setters' ROAS tags (Aziz, 2026-09-21): qualified plus
    -- unqualified count; unprepared is "not ready" and is shown apart.
    select l.ad_id,
      count(*) filter (where ('roas-qualified' = any(coalesce(l.tags, '{}'::text[])) or 'roas-unqualified' = any(coalesce(l.tags, '{}'::text[])))) as leads,
      count(*) filter (where 'roas-qualified' = any(coalesce(l.tags, '{}'::text[]))) as qualified_leads,
      count(*) filter (where 'roas-qualified' <> all(coalesce(l.tags, '{}'::text[])) and 'roas-unqualified' <> all(coalesce(l.tags, '{}'::text[])) and 'roas-unprepared' = any(coalesce(l.tags, '{}'::text[]))) as not_ready_leads,
      -- Per lead, never per appointment (the CEO, 2026-10-18: "it should just
      -- count once"): a lead with a no-show and a rebooked intro is one intro.
      -- Booked at or after the lead arrived, by the window's last day, on the
      -- lead's own ad. An intro leaves out a lead whose every intro was
      -- cancelled; one marked invalid was held, so it stays (B2B's show rule
      -- counts invalid as shown). A confirmed intro showed, or is still
      -- confirmed once its time has passed (the CEO's rule, B2B's intros_qualified).
      ${leadsBooked("intro", "leads_to_intro", "coalesce(b.status, '') <> 'cancelled'")},
      ${leadsBooked("intro", "leads_to_confirmed_intro", "(b.status = 'showed' or (b.status = 'confirmed' and b.start_at <= now()))")},
      ${leadsBooked("demo", "leads_to_demo")}
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
      -- Shown at least seven days before the window's last day: old enough for
      -- a close to have happened. Kept in the payload; no verdict reads it since 2026-10-18.
      count(*) filter (where c.call_type='demo' and (c.start_at at time zone 'Asia/Riyadh')::date between ${day(from)} and ${day(to)} and (c.start_at at time zone 'Asia/Riyadh')::date <= ${day(to)} - 7 and (c.status='showed' or (c.status in ('confirmed','invalid') and c.start_at <= now()))) as demos_shown_mature,
      count(*) filter (where c.call_type='demo' and (c.start_at at time zone 'Asia/Riyadh')::date between ${day(from)} and ${day(to)} and c.status='cancelled') as demos_cancelled
    from credited_calls c
    where c.ad_id is not null
      and ((c.booked_at at time zone 'Asia/Riyadh')::date between ${day(from)} and ${day(to)}
        or (c.start_at at time zone 'Asia/Riyadh')::date between ${day(from)} and ${day(to)})
    group by 1),
  ${alias}_deals as (
    -- Voided deals are left out (../voids.ts).
    select d.ad_id, count(*) as closes,
           coalesce(sum(d.contracted_revenue),0) as contracted,
           coalesce(sum(d.cash_collected),0) as cash
    from credited_deals d
    where d.ad_id is not null
      and (d.submitted_at at time zone 'Asia/Riyadh')::date between ${day(from)} and ${day(to)}
      and ${NOT_VOIDED("d")}
    group by 1)`;
    const cols = (a) => `
    coalesce(${a}_ads.spend,0) as ${a}_spend,
    coalesce(${a}_ads.impressions,0) as ${a}_impressions,
    coalesce(${a}_ads.clicks,0) as ${a}_clicks,
    -- No delivery is 0 link clicks; delivery without a count stays null.
    case when ${a}_ads.ad_id is null then 0 else ${a}_ads.link_clicks end as ${a}_link_clicks,
    coalesce(${a}_ads.meta_leads,0) as ${a}_meta_leads,
    coalesce(${a}_leads.leads,0) as ${a}_leads,
    coalesce(${a}_leads.qualified_leads,0) as ${a}_qualified_leads,
    coalesce(${a}_leads.not_ready_leads,0) as ${a}_not_ready_leads,
    coalesce(${a}_leads.leads_to_intro,0) as ${a}_leads_to_intro,
    coalesce(${a}_leads.leads_to_confirmed_intro,0) as ${a}_leads_to_confirmed_intro,
    coalesce(${a}_leads.leads_to_demo,0) as ${a}_leads_to_demo,
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
    coalesce(${a}_calls.demos_shown_mature,0) as ${a}_demos_shown_mature,
    coalesce(${a}_calls.demos_cancelled,0) as ${a}_demos_cancelled,
    coalesce(${a}_deals.closes,0) as ${a}_closes,
    coalesce(${a}_deals.contracted,0) as ${a}_contracted,
    coalesce(${a}_deals.cash,0) as ${a}_cash`;
    // The tree is every ad with anything in the thirty days: spend, a lead, a
    // call or a signed deal. An ad paused before the window still carries the
    // calls and deals it produced (the CEO, 2026-10-16: a $6,000 deal on an ad
    // last spent in August was missing). Its names and status are its newest
    // snapshot on or before the last day. The seven days sit inside the thirty.
    //
    // Calls and deals are credited to the ad on the contact's lead (the CEO,
    // 2026-10-16, on the $6,000 Makers deal: "put it in seen first"): the ad on
    // the contact's lead (one row per contact) when it is one of this account's
    // ads; otherwise the ad on the call or deal itself. Leads keep their own ad.
    const first = from7 < from30 ? from7 : from30;
    return `with
  lead_ad as (
    -- The lead row holds the contact's newest opt-in ad, which can be newer
    -- than an older call or deal: it is used only from the ad's first delivery.
    select l.contact_id, l.ad_id, f.first_day
    from public.leads l
    join (select s.ad_id, min(s.date) as first_day from public.meta_ad_snapshots s group by s.ad_id) f
      on f.ad_id = l.ad_id),
  credited_calls as (
    select c.contact_id,
           coalesce(case when lead_ad.first_day <= (c.booked_at at time zone 'Asia/Riyadh')::date then lead_ad.ad_id end, c.ad_id) as ad_id,
           c.call_type, c.booked_at, c.start_at, c.status, c.assigned_user_id
    from public.calls c
    left join lead_ad on lead_ad.contact_id = c.contact_id
    where (c.booked_at at time zone 'Asia/Riyadh')::date between ${day(first)} and ${day(to)}
       or (c.start_at at time zone 'Asia/Riyadh')::date between ${day(first)} and ${day(to)}),
  credited_deals as (
    select d.response_id,
           coalesce(case when lead_ad.first_day <= (d.submitted_at at time zone 'Asia/Riyadh')::date then lead_ad.ad_id end, d.ad_id) as ad_id,
           d.submitted_at, d.contracted_revenue, d.cash_collected, d.closer
    from public.closed_deals d
    left join lead_ad on lead_ad.contact_id = d.contact_id
    where (d.submitted_at at time zone 'Asia/Riyadh')::date between ${day(first)} and ${day(to)}),
  ${funnel(from7, "w7")},
  ${funnel(from30, "w30")},
  ident as (
    select distinct on (s.ad_id) s.ad_id, s.adset_id, s.campaign_id,
           s.ad_name, s.adset_name, s.campaign_name, s.campaign_status, s.effective_status, s.thumbnail_url,
           to_char(s.date, 'YYYY-MM-DD') as last_seen
    from public.meta_ad_snapshots s
    where s.date <= ${day(to)}
      and s.ad_id in (select ad_id from w30_ads union select ad_id from w30_leads
                      union select ad_id from w30_calls union select ad_id from w30_deals)
    order by s.ad_id, s.date desc),
  setters as (
    -- Each lead once (the CEO, 2026-10-18): a no-show and its rebooking are one lead, shown if either showed.
    select distinct on (c.ad_id) c.ad_id,
      coalesce(sr.display_name, 'Unknown setter') as setter_name,
      count(distinct c.contact_id) filter (where c.status in ('showed','confirmed','invalid') and c.start_at < now()) as setter_shown,
      count(distinct c.contact_id) filter (where c.start_at < now()) as setter_due
    from credited_calls c
    left join public.sales_reps sr on sr.ghl_user_id = c.assigned_user_id
    where c.ad_id is not null and c.call_type = 'intro' and c.assigned_user_id is not null
      and (c.booked_at at time zone 'Asia/Riyadh')::date between ${day(from30)} and ${day(to)}
    group by c.ad_id, c.assigned_user_id, sr.display_name
    order by c.ad_id, count(distinct c.contact_id) desc),
  closers as (
    select distinct on (d.ad_id) d.ad_id, d.closer as closer_name, count(*) as closer_closes
    from credited_deals d
    where d.ad_id is not null and d.closer is not null and btrim(d.closer) <> ''
      and (d.submitted_at at time zone 'Asia/Riyadh')::date between ${day(from30)} and ${day(to)}
      and ${NOT_VOIDED("d")}
    group by d.ad_id, d.closer
    order by d.ad_id, count(*) desc)
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
/**
 * Every count on a window, in one place, so the builders never drift apart.
 * Link clicks are kept apart: a day Meta sent without them makes them not
 * known (null), and the sums and rates over them have to carry that.
 */
const COUNTS = [
    "impressions",
    "clicks",
    "metaLeads",
    "leads",
    "qualifiedLeads",
    "notReadyLeads",
    "leadsToIntro",
    "leadsToConfirmedIntro",
    "leadsToDemo",
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
    "demosShownMature",
    "demosCancelled",
    "closes",
];
const COLUMN = {
    impressions: "impressions",
    clicks: "clicks",
    metaLeads: "meta_leads",
    leads: "leads",
    qualifiedLeads: "qualified_leads",
    notReadyLeads: "not_ready_leads",
    leadsToIntro: "leads_to_intro",
    leadsToConfirmedIntro: "leads_to_confirmed_intro",
    leadsToDemo: "leads_to_demo",
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
    demosShownMature: "demos_shown_mature",
    demosCancelled: "demos_cancelled",
    closes: "closes",
};
const emptyWin = () => {
    const w = {
        spend: 0,
        contracted: 0,
        cash: 0,
        frequency: null,
        linkClicks: 0,
    };
    for (const k of COUNTS)
        w[k] = 0;
    return finish(w);
};
function winOf(r, a) {
    const g = (k) => num(r[`${a}_${k}`]);
    const w = {
        spend: usd(g("spend")),
        contracted: usd(g("contracted")),
        cash: usd(g("cash")),
        // Meta's own, read per level for the whole window (metaFrequency).
        frequency: null,
        linkClicks: knownCount(r[`${a}_link_clicks`]),
    };
    for (const k of COUNTS)
        w[k] = g(COLUMN[k]);
    return finish(w);
}
function addWin(into, w) {
    into.spend = usd(into.spend + w.spend);
    into.contracted = usd(into.contracted + w.contracted);
    into.cash = usd(into.cash + w.cash);
    for (const k of COUNTS)
        into[k] += w[k];
    into.linkClicks = addKnown(into.linkClicks, w.linkClicks);
    // Frequency is never added up or taken from the children: a person reached
    // by two ads, or on two days, is one person. Each level reads Meta's own.
}
/**
 * Meta's own frequency for one window at every level the screen shows:
 * impressions divided by the distinct people reached over the whole window,
 * the number Ads Manager shows for those dates (the CEO, 2026-10-16). The
 * daily snapshots cannot give it: a person seen on two days, or by two ads,
 * is one person. Any failed read fails the section; there is no fallback.
 */
async function readWindowFrequency(from, until, leadGenIds) {
    // A window whose first day has not started on Meta's clock has no rows.
    if (until < from)
        return { ad: new Map(), adset: new Map(), campaign: new Map(), account: null };
    const ad = await readLevelFrequency(graph, "ad", from, until);
    const adset = await readLevelFrequency(graph, "adset", from, until);
    const campaign = await readLevelFrequency(graph, "campaign", from, until);
    // The account row is lead gen only, so its people are counted over those campaigns.
    const account = await readInsights(graph, leadGenIds, from, until);
    return { ad, adset, campaign, account };
}
const metaFrequency = (level, id) => level.get(id)?.frequency ?? null;
// A cost needs money spent: an ad with $0 in the window (one that joined the
// tab through a call or deal) has no cost per anything, never $0.
const per = (a, b) => (a > 0 && b > 0 ? usd(a / b) : null);
const ratio = (a, b) => b > 0 ? Math.round((a / b) * 10000) / 10000 : null;
/** The derived numbers, exactly as the B2B dashboard defines them. */
function finish(w) {
    w.cpm = w.impressions > 0 ? usd((w.spend / w.impressions) * 1000) : null;
    // CTR (all), every click; kept in the payload, never shown.
    w.ctr = ratio(w.clicks, w.impressions);
    // Link CTR, the CTR the screen shows (the CEO, 2026-10-08); null when
    // the link clicks are not known.
    w.ctrLink = linkCtr(w.linkClicks, w.impressions);
    w.cpc = per(w.spend, w.linkClicks);
    w.cpl = per(w.spend, w.leads);
    w.qualifiedPct = ratio(w.qualifiedLeads, w.leads);
    w.costPerQualified = per(w.spend, w.qualifiedLeads);
    // Per lead (SOURCES.md): the leads that booked an intro, out of the leads.
    // Appointments (introsBooked) can outnumber leads; this never can.
    w.bookRate = ratio(w.leadsToIntro, w.leads);
    // Intros and confirmed intros, each lead once (the CEO, 2026-10-18): what
    // the Ads tab shows. The appointment counts below stay in the payload only.
    w.costPerIntro = per(w.spend, w.leadsToIntro);
    w.costPerConfirmedIntro = per(w.spend, w.leadsToConfirmedIntro);
    w.confirmedIntroRate = ratio(w.leadsToConfirmedIntro, w.leadsToIntro);
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
    w.leadToDemo = ratio(w.leadsToDemo, w.leads);
    return w;
}
const noPeople = () => ({ setter: null, closer: null });
/**
 * An ad set row: running is Meta's word when read live, else set by its ads.
 * Read live it also carries its own switch (switchOn), which the cockpit's
 * switch shows and sets.
 */
function newAdset(live, id, name) {
    const state = live ? liveState(live, "adsets", id) : null;
    return {
        id,
        name,
        ...(state ? { status: state.status, switchOn: state.switchOn } : {}),
        running: state ? state.running : false,
        delivered: false,
        w7: emptyWin(),
        w30: emptyWin(),
        people: noPeople(),
        ads: [],
    };
}
/**
 * The tree against the CRM: leads and deals on this account's ads that no ad
 * row holds. Empty when every record landed on an ad.
 */
export function unplacedNote(coverage, all7, all30) {
    const gaps = [];
    for (const [label, crm, tree] of [
        ["thirty days", coverage.w30, all30],
        ["seven days", coverage.w7, all7],
    ]) {
        const leads = crm.adLeads - tree.leads;
        const closes = crm.adCloses - tree.closes;
        const money = usd(crm.adContracted - tree.contracted);
        if (leads === 0 && closes === 0 && money === 0)
            continue;
        gaps.push(`in the last ${label} the CRM holds ${crm.adLeads} ${crm.adLeads === 1 ? "lead" : "leads"} and ${crm.adCloses} signed ${crm.adCloses === 1 ? "deal" : "deals"} ($${crm.adContracted.toLocaleString("en-US")}) on this account's ads, and the ad rows add up to ${tree.leads} and ${tree.closes} ($${tree.contracted.toLocaleString("en-US")})`);
    }
    if (!gaps.length)
        return null;
    const text = gaps.join("; ");
    return `${text[0].toUpperCase()}${text.slice(1)}. The difference is records the cockpit could not place on an ad, usually an ad with no Meta snapshot on or before the last day. The coverage figures count them; the rows do not.`;
}
/** The setter with the most intros shown and the closer with the most closes across a group of ads. */
function peopleOf(ads) {
    const setters = new Map();
    const closers = new Map();
    for (const a of ads) {
        if (a.people.setter) {
            const s = setters.get(a.people.setter.name) ?? { shown: 0, due: 0 };
            s.shown += a.people.setter.shown;
            s.due += a.people.setter.due;
            setters.set(a.people.setter.name, s);
        }
        if (a.people.closer)
            closers.set(a.people.closer.name, (closers.get(a.people.closer.name) ?? 0) + a.people.closer.closes);
    }
    const setter = [...setters.entries()].sort((x, y) => y[1].shown - x[1].shown || y[1].due - x[1].due)[0];
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
 * is judged on thirty, because an intro takes days to be held. And the funnel
 * verdicts name a stage rather than the ad, because an ad that fills the
 * calendar with intros nobody confirms is a setter problem, and switching the
 * ad off would be the one thing that makes it worse.
 */
function judge(running, w7, w30, staleSince, kind) {
    if (!running)
        return {
            verdict: "off",
            reason: "Not delivering: switched off in Meta.",
            owner: null,
        };
    // A stale snapshot is not the same as an ad that stopped. Say which.
    if (staleSince && w7.spend === 0)
        return {
            verdict: "no delivery",
            reason: `Meta has reported no delivery since ${staleSince}. Either it has been off since then or Meta is late; this week cannot be judged yet.`,
            owner: "ads",
        };
    if (w7.spend === 0)
        return {
            verdict: "no delivery",
            reason: "On, but nothing spent in seven days.",
            owner: "ads",
        };
    // The $15 gate is a lead-gen gate. Retargeting warms people who already
    // know Mahara, and the account row and the constraint leave it out too.
    if (kind !== "lead_gen")
        return {
            verdict: "not_judged",
            reason: kind === "retargeting"
                ? "Retargeting is not judged on cost per lead."
                : "Not a lead-gen campaign, so it is not judged on cost per lead.",
            owner: null,
        };
    if (w7.spend < 1)
        return {
            verdict: "hold",
            reason: `Delivering, but only $${w7.spend.toFixed(2)} and ${w7.impressions} ${w7.impressions === 1 ? "impression" : "impressions"} in seven days: too little to judge.`,
            owner: "ads",
        };
    if (w7.leads === 0 && usd(w7.spend) >= KILL_FLOOR)
        return {
            verdict: "kill",
            reason: `$${w7.spend.toFixed(0)} in seven days and not one lead reached the CRM${w7.metaLeads > 0 ? `, though Meta counts ${w7.metaLeads}` : ""}.`,
            owner: "ads",
        };
    // No lead yet on less than the kill floor: no cost per lead exists to judge.
    if (w7.leads === 0 || w7.cpl === null)
        return {
            verdict: "hold",
            reason: `$${w7.spend.toFixed(2)} in seven days and no lead yet: not enough data. The verdict comes at $${KILL_FLOOR} (${NO_LEAD_MULTIPLE} x the $${CPL_GATE} gate).`,
            owner: "ads",
        };
    if (w7.cpl > CPL_GATE * 1.5)
        return {
            verdict: "kill",
            reason: `$${w7.cpl.toFixed(2)} a lead in seven days, more than half again over the $${CPL_GATE} gate.`,
            owner: "ads",
        };
    if (w7.frequency !== null && w7.frequency >= 2.5)
        return {
            verdict: "fatiguing",
            reason: `Frequency ${w7.frequency.toFixed(2)}: the same people keep seeing it. Refresh the creative before the cost moves.`,
            owner: "ads",
        };
    // Per lead, as the screen counts intros (the CEO, 2026-10-18): demos and
    // closes are the Sales tab's to judge, never an ad's.
    if (w30.leads >= 8 && w30.leadsToIntro === 0)
        return {
            verdict: "leads do not book",
            reason: `${w30.leads} leads in thirty days and no intro booked. The ad is doing its job; the follow-up is not.`,
            owner: "setter",
        };
    if (w30.leadsToIntro >= 5 && w30.leadsToConfirmedIntro === 0)
        return {
            verdict: "intros do not confirm",
            reason: `${w30.leadsToIntro} leads booked an intro in thirty days and none of them showed or stayed confirmed. That is the setter's confirming, not the ad.`,
            owner: "setter",
        };
    if (w7.cpl > CPL_GATE)
        return {
            verdict: "hold",
            reason: `$${w7.cpl.toFixed(2)} a lead in seven days is over the $${CPL_GATE} gate but within half again. Watch it; do not scale it.`,
            owner: "ads",
        };
    return {
        verdict: "scale",
        reason: `$${w7.cpl.toFixed(2)} a lead in seven days, under the $${CPL_GATE} gate, on $${w7.spend.toFixed(0)}${w30.closes ? `, and ${w30.closes} ${w30.closes === 1 ? "close" : "closes"} in thirty days` : ""}.`,
        owner: "ads",
    };
}
/**
 * An ad's verdict. With Meta's live status (the CEO, 2026-10-19) on and off
 * is Meta's word, and delivery only decides whether there are numbers to
 * judge: an ad switched on that has not spent says so, and is never "off".
 * On the snapshot rule, the fallback, an ad with no delivery in the thirty
 * days is off, because its newest snapshot's status can be stale.
 */
function adVerdict(live, running, status, delivered, lastSeen, w7, w30, staleSince, kind) {
    const since = `No Meta delivery since ${lastSeen ?? "before the thirty days"}.`;
    if (!live)
        return delivered
            ? judge(running, w7, w30, staleSince, kind)
            : { verdict: "off", reason: since, owner: null };
    if (!running)
        return {
            verdict: "off",
            reason: delivered ? offReason(status) : `${offReason(status)} ${since}`,
            owner: null,
        };
    if (!delivered)
        return {
            verdict: "no delivery",
            reason: lastSeen
                ? `On in Meta, but no delivery since ${lastSeen}.`
                : "On in Meta, with no delivery in the thirty days: its numbers start when it spends.",
            owner: "ads",
        };
    return judge(true, w7, w30, staleSince, kind);
}
/**
 * The weakest stage of a campaign's funnel against the account as a whole.
 * Named so the fix is a person, not a guess: creative, landing page, setter
 * or closer.
 */
function constraintOf(c, account) {
    // Every stage is a share of the stage before it, so it can never pass 100%:
    // leads that booked an intro, and of those the ones whose intro was
    // confirmed, each lead once (the CEO, 2026-10-18). Demos and closes are
    // not an ad's stages; the Sales tab judges them.
    const share = (a, b) => {
        const r = rate(a, b);
        return r === null ? null : Math.min(1, r);
    };
    const stages = [
        {
            key: "click",
            label: "impressions to link clicks",
            owner: "ads",
            mine: share(c.linkClicks, c.impressions),
            all: share(account.linkClicks, account.impressions),
            floor: 500,
        },
        {
            key: "optin",
            label: "clicks to leads",
            owner: "landing",
            mine: share(c.leads, c.linkClicks),
            all: share(account.leads, account.linkClicks),
            floor: 30,
        },
        {
            key: "book",
            label: "leads to intros",
            owner: "setter",
            mine: share(c.leadsToIntro, c.leads),
            all: share(account.leadsToIntro, account.leads),
            floor: 8,
        },
        {
            key: "confirm",
            label: "intros to confirmed intros",
            owner: "setter",
            mine: share(c.leadsToConfirmedIntro, c.leadsToIntro),
            all: share(account.leadsToConfirmedIntro, account.leadsToIntro),
            floor: 5,
        },
    ];
    const denom = {
        click: c.impressions,
        optin: c.linkClicks,
        book: c.leads,
        confirm: c.leadsToIntro,
    };
    // More intro appointments than leads means leads lost their ad on the way
    // in, so the stages over leads would blame the wrong person.
    const leadsUnderCounted = c.introsBooked > c.leads;
    let worst = null;
    let worstGap = 0;
    for (const s of stages) {
        if (s.mine === null || s.all === null || s.all === 0)
            continue;
        if (denom[s.key] < s.floor)
            continue; // too few to judge
        if (leadsUnderCounted && (s.key === "optin" || s.key === "book"))
            continue;
        const gap = (s.all - s.mine) / s.all;
        if (gap > worstGap) {
            worstGap = gap;
            worst = s;
        }
    }
    if (!worst || worstGap < 0.2)
        return null;
    return {
        stage: worst.label,
        owner: worst.owner,
        mine: Math.round((worst.mine ?? 0) * 1000) / 1000,
        account: Math.round((worst.all ?? 0) * 1000) / 1000,
    };
}
/**
 * The whole account read for a pair of windows.
 *
 * The scheduled adapter asks for seven days and thirty. A custom timeframe
 * (Aziz, 2026-09-22: "I should be able to see the metrics on a custom
 * timeframe, not just 7 days or 30 days") asks for the same run of days
 * twice, so the screen reads one window and every verdict judges it against
 * itself. One query, one set of rules, no second definition of a number.
 */
export async function adsPayload(from7, from30, today, nowMs = Date.now()) {
    {
        const notes = [];
        // Freshness first, because every verdict below needs to know it.
        const freshRows = await sql(B2B, `select max(extract(epoch from last_synced_at) * 1000) as ms,
              to_char(max(date), 'YYYY-MM-DD') as last_day,
              to_char(min(date), 'YYYY-MM-DD') as first_day
       from public.meta_ad_snapshots`);
        const freshestAt = num(freshRows[0]?.ms) || undefined;
        const lastDay = freshRows[0]?.last_day
            ? String(freshRows[0].last_day)
            : null;
        const firstDay = freshRows[0]?.first_day
            ? String(freshRows[0].first_day)
            : null;
        // Yesterday is the newest day Meta can reasonably have closed out.
        const staleSince = lastDay && lastDay < addDays(today, -1) ? lastDay : null;
        // The account itself, from Meta: a disabled or unsettled account explains
        // an empty week better than any verdict can, and nothing can be created
        // on it until it is fixed.
        let accountStatus = null;
        let accountNote;
        // Meta dates every insight by the account's own days.
        let timeZone = ACCOUNT_TIME_ZONE_FALLBACK;
        try {
            const acct = await graph(`act_${ACCOUNT}`, {
                fields: "account_status,disable_reason,balance,currency,amount_spent,spend_cap,timezone_name",
            });
            if (typeof acct.timezone_name === "string" && acct.timezone_name)
                timeZone = acct.timezone_name;
            const code = num(acct.account_status);
            const reason = num(acct.disable_reason);
            accountStatus = {
                code,
                label: ACCOUNT_STATUS[code] ?? `status ${code}`,
                disableReason: reason
                    ? (DISABLE_REASON[reason] ?? `reason ${reason}`)
                    : null,
                balance: acct.balance !== undefined && acct.balance !== null
                    ? num(acct.balance) / 100
                    : null,
                currency: acct.currency ? String(acct.currency) : null,
            };
        }
        catch (e) {
            accountNote = String(e instanceof Error ? e.message : e).slice(0, 160);
        }
        const rows = await sql(B2B, treeSql(from7, from30, today));
        // On and off is Meta's own, read live (the CEO, 2026-10-19: "Ads
        // turning on and off in the CEO cockpit isn't working"). The snapshots
        // hold a row only for a day an ad delivered, so on them an ad switched
        // on read off until it spent and the sync caught up, and a stale ACTIVE
        // row could outrank a switch-off. The numbers stay the snapshots'.
        // A failed read never fails the section: the switches fall back to the
        // snapshot rule and a note says they show delivery, not Meta's setting.
        // Its receipts go under "b2bAds:optional" (providerTools.ts), so a
        // rate limit or a retried 5xx on these three lists reaches the health
        // ledger without failing the section the way its own reads would.
        let live = null;
        let liveError = null;
        try {
            live = await withOptionalReads(() => readLiveStatus(graph));
        }
        catch (e) {
            liveError = String(e instanceof Error ? e.message : e).slice(0, 160);
        }
        const statusFrom = live ? "meta" : "snapshots";
        // The whole CRM in the same windows, so the screen can say how much of
        // it carries an ad. Without this the ad-attributed totals would read as
        // the business, and they are not: 310 leads and 8 signed deals in the
        // thirty days to 2026-09-20 against 224 and 2 with an ad on them.
        // Voided deals are left out, and counted apart for the note.
        const inWindow = (from) => `(d.submitted_at at time zone 'Asia/Riyadh')::date between ${day(from)} and ${day(today)}`;
        // Straight from the CRM: every record whose ad is one of this account's
        // ads (Meta has a snapshot of it), whether or not the tree placed it.
        const ours = (alias) => `exists (select 1 from public.meta_ad_snapshots s where s.ad_id = ${alias}.ad_id)`;
        // A deal is credited to its lead's ad when that is one of ours, else to
        // its own (treeSql's lead_ad): either way it is on one of our ads.
        const oursDeal = `(${ours("d")} or exists (select 1 from public.leads la where la.contact_id = d.contact_id and (select min(s.date) from public.meta_ad_snapshots s where s.ad_id = la.ad_id) <= (d.submitted_at at time zone 'Asia/Riyadh')::date))`;
        const adCoverage = (w, from) => `(select count(*) from public.leads l where ('roas-qualified' = any(coalesce(l.tags, '{}'::text[])) or 'roas-unqualified' = any(coalesce(l.tags, '{}'::text[]))) and (l.lead_created_at at time zone 'Asia/Riyadh')::date between ${day(from)} and ${day(today)} and ${ours("l")}) as ${w}_ad_leads,
        (select count(*) from public.closed_deals d where ${inWindow(from)} and ${NOT_VOIDED("d")} and ${oursDeal}) as ${w}_ad_closes,
        (select coalesce(sum(d.contracted_revenue),0) from public.closed_deals d where ${inWindow(from)} and ${NOT_VOIDED("d")} and ${oursDeal}) as ${w}_ad_contracted`;
        const totals = await sql(B2B, `select
        (select count(*) from public.leads l where ('roas-qualified' = any(coalesce(l.tags, '{}'::text[])) or 'roas-unqualified' = any(coalesce(l.tags, '{}'::text[]))) and (l.lead_created_at at time zone 'Asia/Riyadh')::date between ${day(from7)} and ${day(today)}) as w7_leads,
        (select count(*) from public.leads l where ('roas-qualified' = any(coalesce(l.tags, '{}'::text[])) or 'roas-unqualified' = any(coalesce(l.tags, '{}'::text[]))) and (l.lead_created_at at time zone 'Asia/Riyadh')::date between ${day(from30)} and ${day(today)}) as w30_leads,
        (select count(*) from public.closed_deals d where ${inWindow(from7)} and ${NOT_VOIDED("d")}) as w7_closes,
        (select count(*) from public.closed_deals d where ${inWindow(from30)} and ${NOT_VOIDED("d")}) as w30_closes,
        (select coalesce(sum(d.contracted_revenue),0) from public.closed_deals d where ${inWindow(from7)} and ${NOT_VOIDED("d")}) as w7_contracted,
        (select coalesce(sum(d.contracted_revenue),0) from public.closed_deals d where ${inWindow(from30)} and ${NOT_VOIDED("d")}) as w30_contracted,
        (select count(*) from public.closed_deals d where ${inWindow(from30)} and ${VOIDED("d")}) as w30_voided,
        ${adCoverage("w7", from7)},
        ${adCoverage("w30", from30)}`);
        const t = totals[0] ?? {};
        // Frequency is Meta's, per level, for each whole window, ending on the
        // newest day Meta has started in the account's time zone.
        const until = metaUntil(today, nowMs, timeZone);
        const leadGenIds = [
            ...new Set(rows
                .filter(r => String(r.campaign_type ?? "") === "lead_gen")
                .map(r => String(r.campaign_id))),
        ];
        const meta7 = await readWindowFrequency(from7, until, leadGenIds);
        const meta30 = await readWindowFrequency(from30, until, leadGenIds);
        const account7 = emptyWin();
        const account30 = emptyWin();
        const all7 = emptyWin();
        const all30 = emptyWin();
        let retargeting7 = 0;
        let retargeting30 = 0;
        const campaigns = new Map();
        for (const r of rows) {
            const w7 = winOf(r, "w7");
            const w30 = winOf(r, "w30");
            // Before judge(): "fatiguing" reads the ad's real seven-day frequency.
            w7.frequency = metaFrequency(meta7.ad, String(r.ad_id));
            w30.frequency = metaFrequency(meta30.ad, String(r.ad_id));
            // Delivery is the numbers' signal: a snapshot row in the thirty days.
            const lastSeen = r.last_seen ? String(r.last_seen).slice(0, 10) : null;
            const delivered = lastSeen !== null && lastSeen >= from30;
            // On and off: Meta's live effective_status. On the fallback,
            // snapshots stop when an ad stops delivering, so an old snapshot's
            // status can be stale: an ad counts as running only with Meta
            // delivery in the thirty days (one that joined the tab through a
            // call or deal on an old click is off, with its last delivery day).
            const snapshotStatus = String(r.effective_status ?? "");
            const own = live ? liveState(live, "ads", String(r.ad_id)) : null;
            const status = own ? own.status : snapshotStatus;
            const running = own ? own.running : snapshotStatus === "ACTIVE" && delivered;
            const kind = String(r.campaign_type ?? "unknown");
            const ad = {
                id: String(r.ad_id),
                name: String(r.ad_name ?? `Ad ${r.ad_id}`),
                status,
                running,
                // Its own switch in Meta, read live (frequency.ts liveState):
                // what the cockpit's switch shows and sets. Absent on the fallback.
                ...(own ? { switchOn: own.switchOn } : {}),
                delivered,
                lastDelivery: lastSeen,
                thumbnail: r.thumbnail_url ? String(r.thumbnail_url) : null,
                w7,
                w30,
                verdict: adVerdict(live, running, status, delivered, lastSeen, w7, w30, staleSince, kind),
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
            // The account row is lead gen only, as the B2B dashboard defines it:
            // retargeting warms an audience it never gets credit for, and hiring
            // is not sales at all.
            if (kind === "lead_gen") {
                addWin(account7, w7);
                addWin(account30, w30);
            }
            else if (kind === "retargeting") {
                retargeting7 = usd(retargeting7 + w7.spend);
                retargeting30 = usd(retargeting30 + w30.spend);
            }
            const cid = String(r.campaign_id);
            // A campaign or ad set is running when Meta says so; on the
            // fallback, when one of its ads is.
            const campaignState = live ? liveState(live, "campaigns", cid) : null;
            const campaign = campaigns.get(cid) ?? {
                id: cid,
                name: String(r.campaign_name ?? cid),
                type: String(r.campaign_type ?? "unknown"),
                status: campaignState ? campaignState.status : String(r.campaign_status ?? ""),
                running: campaignState ? campaignState.running : false,
                ...(campaignState ? { switchOn: campaignState.switchOn } : {}),
                delivered: false,
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
                adset = newAdset(live, sid, String(r.adset_name ?? sid));
                campaign.adsets.push(adset);
            }
            adset.ads.push(ad);
            addWin(adset.w7, w7);
            addWin(adset.w30, w30);
            addWin(campaign.w7, w7);
            addWin(campaign.w30, w30);
            if (!live && running) {
                adset.running = true;
                campaign.running = true;
            }
            if (delivered) {
                adset.delivered = true;
                campaign.delivered = true;
            }
        }
        // Ads Meta has running with no snapshot in the thirty days (switched
        // on, not delivered yet) join the tab at $0, so they can be switched.
        let added = 0;
        if (live) {
            const held = new Set(rows.map(r => String(r.ad_id)));
            for (const a of liveOnlyAds(live, held)) {
                const cid = String(a.campaignId);
                let campaign = campaigns.get(cid);
                if (!campaign) {
                    const name = live.campaigns.get(cid)?.name || cid;
                    const state = liveState(live, "campaigns", cid);
                    campaign = {
                        id: cid,
                        name,
                        // b2b_campaign_type's rule, in Graph's names (frequency.ts).
                        type: campaignKind(name),
                        status: state.status,
                        running: state.running,
                        switchOn: state.switchOn,
                        delivered: false,
                        w7: emptyWin(),
                        w30: emptyWin(),
                        people: noPeople(),
                        constraint: null,
                        adsets: [],
                    };
                    campaigns.set(cid, campaign);
                }
                const sid = String(a.adsetId);
                let adset = campaign.adsets.find(s => s.id === sid);
                if (!adset) {
                    adset = newAdset(live, sid, live.adsets.get(sid)?.name || sid);
                    campaign.adsets.push(adset);
                }
                const w7 = emptyWin();
                const w30 = emptyWin();
                w7.frequency = metaFrequency(meta7.ad, a.id);
                w30.frequency = metaFrequency(meta30.ad, a.id);
                adset.ads.push({
                    id: a.id,
                    name: a.name || `Ad ${a.id}`,
                    status: a.effectiveStatus,
                    running: true,
                    switchOn: liveState(live, "ads", a.id).switchOn,
                    delivered: false,
                    lastDelivery: null,
                    thumbnail: null,
                    w7,
                    w30,
                    verdict: adVerdict(live, true, a.effectiveStatus, false, null, w7, w30, staleSince, campaign.type),
                    people: noPeople(),
                });
                added += 1;
            }
        }
        account7.frequency = meta7.account?.frequency ?? null;
        account30.frequency = meta30.account?.frequency ?? null;
        finish(account7);
        finish(account30);
        finish(all7);
        finish(all30);
        const coverage = {
            w7: {
                leads: num(t.w7_leads),
                adLeads: num(t.w7_ad_leads),
                closes: num(t.w7_closes),
                adCloses: num(t.w7_ad_closes),
                contracted: usd(num(t.w7_contracted)),
                adContracted: usd(num(t.w7_ad_contracted)),
            },
            w30: {
                leads: num(t.w30_leads),
                adLeads: num(t.w30_ad_leads),
                closes: num(t.w30_closes),
                adCloses: num(t.w30_ad_closes),
                contracted: usd(num(t.w30_contracted)),
                adContracted: usd(num(t.w30_ad_contracted)),
            },
        };
        const list = [...campaigns.values()];
        for (const c of list) {
            c.w7.frequency = metaFrequency(meta7.campaign, c.id);
            c.w30.frequency = metaFrequency(meta30.campaign, c.id);
            finish(c.w7);
            finish(c.w30);
            for (const a of c.adsets) {
                a.w7.frequency = metaFrequency(meta7.adset, a.id);
                a.w30.frequency = metaFrequency(meta30.adset, a.id);
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
        list.sort((a, b) => Number(b.type === "lead_gen") - Number(a.type === "lead_gen") ||
            Number(b.running) - Number(a.running) ||
            b.w30.spend - a.w30.spend);
        const ads = list.flatMap(c => c.adsets.flatMap(a => a.ads));
        const running = ads.filter(a => a.running).length;
        const verdicts = {};
        for (const a of ads)
            if (a.running)
                verdicts[a.verdict.verdict] = (verdicts[a.verdict.verdict] ?? 0) + 1;
        if (accountStatus && accountStatus.code !== 1)
            notes.push({
                level: "warn",
                text: `Meta reports the ad account as ${accountStatus.label}${accountStatus.disableReason ? ` (${accountStatus.disableReason})` : ""}${accountStatus.balance ? `, with a balance of ${accountStatus.currency ?? ""} ${accountStatus.balance.toFixed(2)} outstanding` : ""}. Nothing delivers and nothing can be created or edited on the account until that is resolved in Ads Manager. It is the first thing to fix; every verdict below is about the past.`,
            });
        if (!live)
            notes.push({
                level: "warn",
                text: `Meta's own on and off could not be read (${liveError ?? "no answer"}), so the switches show delivery, not Meta's setting: an ad counts as on only when its newest snapshot says active and it delivered in the thirty days. A change made in Meta shows here once the ad delivers and the snapshot sync catches up.`,
            });
        if (staleSince && !live)
            notes.push({
                level: "warn",
                text: `"Running" here means switched on as of ${staleSince}, the newest day Meta has reported. Whether those ads are still on today is not known until the sync catches up.`,
            });
        if (added > 0)
            notes.push({
                level: "info",
                text: `${added} ${added === 1 ? "ad is" : "ads are"} on in Meta with no delivery in the thirty days, so ${added === 1 ? "it shows" : "they show"} at $0 until ${added === 1 ? "it spends" : "they spend"}, and can be switched from here.`,
            });
        if (running === 0)
            notes.push({
                level: "warn",
                text: `Nothing on the account is delivering. Every ad is switched off, so the seven-day column reads spend from before the pause and the verdicts are about what was running, not what is.`,
            });
        const gapAds = ads.filter(a => a.w30.metaLeads >= 5 && a.w30.leads < a.w30.metaLeads * 0.5);
        if (gapAds.length)
            notes.push({
                level: "warn",
                text: `On ${gapAds.length} ${gapAds.length === 1 ? "ad" : "ads"} the CRM received fewer than half the leads Meta counts. Meta counts a form fill; the CRM counts a contact that arrived with its attribution. The gap is either forms that never became contacts or contacts that lost the ad on the way in, and it is the first thing to check before believing any cost per lead here.`,
            });
        const unplaced = unplacedNote(coverage, all7, all30);
        if (unplaced)
            notes.push({ level: "warn", text: unplaced });
        const cov = coverage.w30;
        const voided30 = num(t.w30_voided);
        notes.push({
            level: "info",
            text: `In the last thirty days the CRM holds ${cov.leads} leads and ${cov.closes} signed deals worth $${cov.contracted.toLocaleString("en-US")}; ${cov.adLeads} leads and ${cov.adCloses} deals ($${cov.adContracted.toLocaleString("en-US")}) carry one of this account's ads and are what this screen attributes. The rest came in organically, on WhatsApp or by hand.${voided30 > 0
                ? ` ${voidedDeals(voided30)} in these days ${voided30 === 1 ? "is" : "are"} left out of every count here, though B2B keeps ${voided30 === 1 ? "it" : "them"} in its table.`
                : ""} The account row is lead-gen campaigns only, the way the B2B dashboard reads it; retargeting spend is shown beside it and never inside a cost per lead.`,
        });
        notes.push({
            level: "info",
            text: `Every row follows an ad from the first impression to the signed contract, through its leads, their intros and the deals credited to it. Intros are counted once per lead, however often the intro was rebooked: the leads from these days, on their own ad, with an intro booked at or after they came in that was not cancelled. An intro marked invalid was held, so it counts. A confirmed intro is one of those whose intro showed, or is still marked confirmed after its time. A lead that went straight to a demo is not an intro. Calls and deals are credited to the ad on the contact's lead record when it is one of this account's ads and was already running when the call was booked or the deal signed; otherwise they keep the ad on the call or deal. An ad switched off before these thirty days still shows here, at $0 spend, when its leads, calls or deals fall inside them. Seven days judges cost and freshness; thirty days judges the funnel, because an intro takes days to be held. Meta leads are what Meta claims; leads are what reached the CRM. Cost per lead is against Aziz's $${CPL_GATE} gate. Cost per intro and per confirmed intro have no gate set, so they are shown and never judged. Frequency is Meta's own: impressions ÷ people reached over the window at each level, on Meta's account days (${timeZone}, through ${until}).`,
        });
        notes.push({
            level: "info",
            text: `A verdict names whose problem it is. "Kill", "hold", "scale" and "fatiguing" are the ad. "Leads do not book" and "intros do not confirm" are the setter. Switching an ad off never fixes those two; it just stops the calendar filling. Demos and closes are judged on the Sales tab, not per ad. Retargeting and other campaigns that are not lead gen are not judged on cost per lead.`,
        });
        if (live)
            notes.push({
                level: "info",
                text: `On and off is Meta's own setting, read from the ad account when this was built. Each switch shows that campaign's, ad set's or ad's own setting, the one it changes; an ad runs only when it, its ad set and its campaign are all on, so an ad switched on under a paused campaign shows on, is not counted as running, and its verdict says why. Spend and every other number still come from the snapshots, so an ad switched on shows $0 until it delivers.`,
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
                text: `Meta has reported no delivery since ${staleSince}.${ranAt
                    ? ` The sync itself last ran at ${ranAt} Kuwait time and succeeded, so this is not a dead feed:`
                    : ""} either nothing on the account has delivered since then, which fits every campaign being paused, or Meta is late. Until a newer day lands, every seven-day figure is that one day and the verdicts read from it.`,
            });
        }
        const payload = {
            accountId: ACCOUNT,
            windows: { from7, from30, to: today, metaUntil: until, metaTimeZone: timeZone },
            account: { w7: account7, w30: account30 },
            retargetingSpend: { w7: retargeting7, w30: retargeting30 },
            coverage,
            running,
            total: ads.length,
            verdicts,
            campaigns: list,
            lastSnapshotDay: lastDay,
            firstSnapshotDay: firstDay,
            accountStatus,
            // Where on and off came from, and when Meta was read for it: the
            // browser ends a held switch change on a read after the change.
            statusFrom,
            statusReadAt: live ? live.readAt : null,
            notes,
        };
        const sources = [
            { name: "B2B Meta ad snapshots", freshestAt, ok: true },
            { name: "B2B leads, calls and closed deals (ad attribution)", ok: true },
            { name: "Meta frequency by level (Graph API insights)", ok: true, freshestAt: nowMs },
            // Only a read that worked is a source: the fallback is a note, never
            // a failed source, which would stop the whole section.
            ...(live
                ? [{ name: "Meta on and off by campaign, ad set and ad (Graph API)", ok: true, freshestAt: live.readAt }]
                : []),
            accountStatus
                ? {
                    name: "Meta ad account (Graph API)",
                    ok: true,
                    freshestAt: Date.now(),
                }
                : { name: "Meta ad account (Graph API)", ok: false, note: accountNote },
        ];
        return { payload, sources };
    }
}
export const b2bAds = {
    key: "b2bAds",
    label: "Our ads",
    compute: async (ctx) => {
        void ctx;
        const now = Date.now();
        const today = kuwaitDay(now);
        const { payload, sources } = await adsPayload(addDays(today, -6), addDays(today, -29), today, now);
        const a7 = payload.account.w7;
        const daily = [
            {
                date: today,
                metric: "b2bAds.running",
                scope: "company",
                value: payload.running,
            },
            {
                date: today,
                metric: "b2bAds.spend7",
                scope: "company",
                value: a7.spend,
            },
            {
                date: today,
                metric: "b2bAds.leads7",
                scope: "company",
                value: a7.leads,
            },
            {
                date: today,
                metric: "b2bAds.metaLeads7",
                scope: "company",
                value: a7.metaLeads,
            },
        ];
        for (const c of payload.campaigns)
            daily.push({
                date: today,
                metric: "b2bAds.campaign.spend7",
                scope: `campaign:${c.id}`,
                value: c.w7.spend,
            });
        return { payload, daily, sources };
    },
};
