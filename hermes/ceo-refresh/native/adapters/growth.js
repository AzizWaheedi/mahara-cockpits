import { withoutWebinar } from "../webinarAttribution.js";
import { B2B, num, sql, TRIAGE } from "../sb.js";
import { amountGap, dayGap, MATCH_DAYS, MATCH_GAP } from "../manualMatch.js";
import { marketingAdLink } from "../linkCtr.js";
import { workingHoursForAdapters } from "../settings.js";
import { addDays, daysInMonth, kuwaitDay, monthStart } from "../time.js";
import { dollars, NOT_VOIDED, VOIDED, voidedByDaySql, voidedDayOf, voidedDaysText, voidedDeals, voidedPartOf, voidedSums, withoutVoids, } from "../voids.js";
import { webbyCall, webbyCampaign, webbyDeal, webbyNewLead, } from "../webinarSql.js";
import { describeWorkingHours, workingMinutesSql } from "../workingHours.js";
/** A date literal for SQL. Days come from time.ts, never from user input. */
function day(d) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d))
        throw new Error(`growth: bad day ${d}`);
    return `'${d}'::date`;
}
/** Inclusive Kuwait-day ranges for each window. */
function windowRanges(today) {
    const yesterday = addDays(today, -1);
    const first = monthStart(today);
    const lastMonthEnd = addDays(first, -1);
    const lastMonthFirst = monthStart(lastMonthEnd);
    // Same day of last month, capped at its length (the 31st in a 30-day month).
    const sameDay = Math.min(Number(today.slice(8, 10)), daysInMonth(lastMonthFirst));
    return {
        yesterday: [yesterday, yesterday],
        last7: [addDays(today, -7), yesterday],
        prevLast7: [addDays(today, -14), addDays(today, -8)],
        mtd: [first, today],
        lastMonthToDate: [lastMonthFirst, addDays(lastMonthFirst, sameDay - 1)],
        lastMonth: [lastMonthFirst, lastMonthEnd],
    };
}
/**
 * A lead, since 2026-09-21, is what the setters tagged it in GoHighLevel
 * (Aziz: "the tags should be the ROAS tags"): `roas-qualified` or
 * `roas-unqualified` counts as a lead, dated by the day it was created;
 * `roas-unprepared` is "not ready" and is shown but never counted; a
 * contact with none of the three is "not yet tagged" and is shown, not
 * counted. When a contact carries more than one, qualified wins.
 */
const ROAS_Q = `'roas-qualified' = any(coalesce(l.tags, '{}'::text[]))`;
const ROAS_U = `'roas-qualified' <> all(coalesce(l.tags, '{}'::text[])) and 'roas-unqualified' = any(coalesce(l.tags, '{}'::text[]))`;
const ROAS_NR = `'roas-qualified' <> all(coalesce(l.tags, '{}'::text[])) and 'roas-unqualified' <> all(coalesce(l.tags, '{}'::text[])) and 'roas-unprepared' = any(coalesce(l.tags, '{}'::text[]))`;
const ROAS_NONE = `not ('roas-qualified' = any(coalesce(l.tags, '{}'::text[])) or 'roas-unqualified' = any(coalesce(l.tags, '{}'::text[])) or 'roas-unprepared' = any(coalesce(l.tags, '{}'::text[])))`;
/** A lead on this cockpit: a contact tagged roas-qualified or roas-unqualified (Aziz, 2026-09-21). */
export const IS_LEAD = `('roas-qualified' = any(coalesce(l.tags, '{}'::text[])) or 'roas-unqualified' = any(coalesce(l.tags, '{}'::text[])))`;
/**
 * Where a lead came from (Aziz, 2026-09-21): an ad id on the contact, or an
 * ad id inside GoHighLevel's attribution (a click-to-message ad carries it as
 * mediumId), means ads. No ad id and a source, tag or attribution medium
 * that says inbound WhatsApp, Instagram DM, YouTube, referral or organic
 * means organic. Neither means ads, and the screen labels it "assumed".
 */
const HAS_AD = `(l.ad_id is not null or coalesce(l.raw_contact->'attributionSource'->>'mediumId', l.raw_contact->'lastAttributionSource'->>'mediumId', '') <> '')`;
const SAYS_ORGANIC = `(concat_ws(' ', l.source, array_to_string(coalesce(l.tags, '{}'::text[]), ' '), l.raw_contact->'attributionSource'->>'medium', l.raw_contact->'lastAttributionSource'->>'medium') ~* '(whatsapp|instagram dm|insta dm|ig dm|\\mdm\\M|youtube|organic|inbound|referr)')`;
export const LEAD_SOURCE = {
    ads: HAS_AD,
    organic: `(not ${HAS_AD} and ${SAYS_ORGANIC})`,
    assumed: `(not ${HAS_AD} and not ${SAYS_ORGANIC})`,
};
/**
 * A Maqsam call made by somebody on the sales roster: a setter, a closer or
 * both (Aziz, 2026-09-21: "never a call-centre agent"). The sync stamps
 * `sales_rep_id` on every call it can tie to the roster.
 */
export const BY_SALES_REP = `exists (select 1 from public.sales_reps sr where sr.id = m.sales_rep_id and sr.role in ('setter', 'closer', 'both', 'rep'))`;
/** The phone digits of a lead, and whether a Maqsam call is with that lead. */
const LEAD_DIGITS = `regexp_replace(coalesce(l.phone, ''), '[^0-9]', '', 'g')`;
export const CALL_IS_WITH_LEAD = `(m.contact_id = l.contact_id
        or (length(${LEAD_DIGITS}) >= 8 and (regexp_replace(coalesce(m.lead_phone, ''), '[^0-9]', '', 'g') like '%' || right(${LEAD_DIGITS}, 8) or regexp_replace(coalesce(m.callee_number, ''), '[^0-9]', '', 'g') like '%' || right(${LEAD_DIGITS}, 8) or regexp_replace(coalesce(m.caller_number, ''), '[^0-9]', '', 'g') like '%' || right(${LEAD_DIGITS}, 8))))`;
/**
 * A closer-form deposit confirmed on a rail the database holds: a paid Whop
 * payment tied to the deal by response id or by the payer's email within
 * 60 days of signing, or a bank transfer tied to the deal or to the business
 * name. Tap is read from its API by the money section, not here, so a
 * deposit paid on Tap reads as unconfirmed on this tab.
 */
export const DEPOSIT_CONFIRMED = `(exists (
          select 1 from public.whop_payments wp
          where wp.status = 'paid'
            and (wp.deal_response_id = d.response_id
              or (nullif(lower(btrim(wp.user_email)), '') is not null and lower(btrim(wp.user_email)) = lower(btrim(d.email))))
            and wp.paid_on between (d.submitted_at at time zone 'Asia/Riyadh')::date - 7 and (d.submitted_at at time zone 'Asia/Riyadh')::date + 60)
        or exists (
          select 1 from public.transfers t
          where t.deal_response_id = d.response_id
             or (nullif(lower(btrim(t.client_name)), '') is not null and lower(btrim(t.client_name)) = lower(btrim(d.business_name)))))`;
/**
 * One statement for all six windows: b2b_window_metrics per window (the
 * Overview tiles), plus the ROAS lead classes, speed to lead on Maqsam,
 * and a count of past demos still marked confirmed. The show rate itself
 * is the dashboard's and is never worked out here.
 *
 * Speed to lead (Aziz, 2026-09-21): from the lead's creation to the first
 * Maqsam call with that lead made by a sales rep (the roster: setter, closer
 * or both, never a call-centre agent), matched by the CRM contact id or the
 * last eight digits of the phone. Median over the leads that were called;
 * the never-called are counted beside it.
 *
 * Lead to booked call: leads created in the window with at least one intro
 * or demo booked against their contact, ever, over leads. Per lead, never
 * per booking, so it cannot pass 100%.
 *
 * Front-end cash (`fe` here) is the deposit the closer typed on the form for
 * deals signed in the window, with the share a Whop payment or a bank
 * transfer confirms. Since 2026-10-18 that is the typed figure shown beside
 * the money, never the money: withPaid sets front-end cash from the deal
 * ledger (paid front-end money by payment day).
 *
 * Voided deals (../voids.ts): b2b_window_metrics counts them, so `vd` carries
 * the voided deals of each window, dated as the function dates a deal, for
 * toWindow to take off; every direct read of closed_deals leaves them out.
 */
function windowsSql(ranges, hours) {
    const workingMin = workingMinutesSql("l.lead_created_at", "fc.first_call", hours);
    const values = Object.entries(ranges)
        .map(([k, [f, t]]) => `('${k}', ${day(f)}, ${day(t)})`)
        .join(",\n    ");
    return `with w(k, f, t) as (
  values
    ${values}
),
still_confirmed as (
  select w.k,
    count(*) filter (where c.status = 'confirmed' and c.start_at <= now()) as demos_still_confirmed
  from w
  join public.calls c on c.call_type = 'demo'
    and (c.start_at at time zone 'Asia/Riyadh')::date between w.f and w.t
    and not ${webbyCall("c")}
  group by w.k
),
roas as (
  select w.k,
    count(*) filter (where ${ROAS_Q}) as q,
    count(*) filter (where ${ROAS_U}) as u,
    count(*) filter (where ${ROAS_NR}) as nr,
    count(*) filter (where ${ROAS_NONE}) as untagged
  from w
  join public.leads l on (l.lead_created_at at time zone 'Asia/Riyadh')::date between w.f and w.t
    and not ${webbyNewLead("l")}
  group by w.k
),
speed as (
  select w.k,
    count(*) as sp_leads,
    count(fc.first_call) as sp_called,
    percentile_cont(0.5) within group (order by extract(epoch from (fc.first_call - l.lead_created_at)) / 60.0) filter (where fc.first_call is not null) as sp_median_min,
    count(*) filter (where fc.first_call is not null and fc.first_call - l.lead_created_at <= interval '5 minutes') as sp_within_5,
    percentile_cont(0.5) within group (order by (${workingMin})) filter (where fc.first_call is not null) as sp_working_median_min,
    count(*) filter (where fc.first_call is not null and (${workingMin}) <= 5) as sp_working_within_5,
    count(*) filter (where exists (
      select 1 from public.calls c
      where c.contact_id is not null and c.contact_id = l.contact_id and c.call_type in ('intro', 'demo'))) as booked_leads,
    count(*) filter (where ${LEAD_SOURCE.ads}) as src_ads,
    count(*) filter (where ${LEAD_SOURCE.organic}) as src_organic,
    count(*) filter (where ${LEAD_SOURCE.assumed}) as src_assumed
  from w
  join public.leads l on ${IS_LEAD} and (l.lead_created_at at time zone 'Asia/Riyadh')::date between w.f and w.t
    and not ${webbyNewLead("l")}
  cross join lateral (
    select min(m.occurred_at) as first_call from public.maqsam_calls m
    where m.occurred_at >= l.lead_created_at
      and ${BY_SALES_REP}
      and ${CALL_IS_WITH_LEAD}
  ) fc
  group by w.k
),
fe as (
  select w.k,
    count(*) as fe_deals,
    coalesce(sum(d.cash_collected), 0) as fe_deposit,
    count(*) filter (where coalesce(d.cash_collected, 0) > 0 and ${DEPOSIT_CONFIRMED}) as fe_deals_confirmed,
    coalesce(sum(d.cash_collected) filter (where ${DEPOSIT_CONFIRMED}), 0) as fe_confirmed
  from w
  join public.closed_deals d on (d.submitted_at at time zone 'Asia/Riyadh')::date between w.f and w.t
    and not ${webbyDeal("d")}
    and ${NOT_VOIDED("d")}
  group by w.k
),
-- The voided deals b2b_window_metrics counts, dated as it dates a deal.
vd_signed as (
  select w.k, ${voidedSums("d")}
  from w
  join public.closed_deals d on (d.submitted_at at time zone 'Asia/Riyadh')::date between w.f and w.t
    and ${VOIDED("d")}
  group by w.k
),
-- The webinar's share of what b2b_window_metrics counts, with its exact
-- rules, so the call funnel is the dashboard's total less the webinar.
wb_meta as (
  select w.k,
    coalesce(sum(s.spend) filter (where public.b2b_campaign_type(s.campaign_name) = 'lead_gen'), 0) as spend,
    coalesce(sum(s.spend) filter (where public.b2b_campaign_type(s.campaign_name) = 'retargeting'), 0) as spend_retargeting,
    coalesce(sum(s.impressions) filter (where public.b2b_campaign_type(s.campaign_name) = 'lead_gen'), 0) as impressions,
    coalesce(sum(s.clicks) filter (where public.b2b_campaign_type(s.campaign_name) = 'lead_gen'), 0) as clicks,
    coalesce(sum(s.inline_link_clicks) filter (where public.b2b_campaign_type(s.campaign_name) = 'lead_gen'), 0) as link_clicks
  from w
  join public.meta_ad_snapshots s on s.date between w.f and w.t
    and public.b2b_campaign_type(s.campaign_name) in ('lead_gen', 'retargeting')
    and ${webbyCampaign("s")}
  group by w.k
),
wb_leads as (
  select w.k, count(*) as leads
  from w
  join public.leads l on l.is_lead
    and (l.lead_created_at at time zone 'Asia/Riyadh')::date between w.f and w.t
    and ${webbyNewLead("l")}
  group by w.k
),
wb_calls as (
  select w.k,
    count(*) filter (where c.call_type='intro' and (c.booked_at at time zone 'Asia/Riyadh')::date between w.f and w.t) as intros_booked,
    count(*) filter (where c.call_type='intro' and (c.status='showed' or (c.status in ('confirmed','invalid') and c.start_at <= now())) and (c.start_at at time zone 'Asia/Riyadh')::date between w.f and w.t) as intros_shown,
    count(*) filter (where c.call_type='intro' and (c.status='showed' or (c.status='confirmed' and c.start_at <= now())) and (c.start_at at time zone 'Asia/Riyadh')::date between w.f and w.t) as intros_qualified,
    count(*) filter (where c.call_type='intro' and c.status='invalid' and c.start_at <= now() and (c.start_at at time zone 'Asia/Riyadh')::date between w.f and w.t) as intros_disqualified,
    count(*) filter (where c.call_type='intro' and c.status='cancelled' and (c.start_at at time zone 'Asia/Riyadh')::date between w.f and w.t) as intros_cancelled,
    count(*) filter (where c.call_type='intro' and c.start_at <= now() and (c.start_at at time zone 'Asia/Riyadh')::date between w.f and w.t) as intros_due,
    count(*) filter (where c.call_type='intro' and (c.start_at at time zone 'Asia/Riyadh')::date between w.f and w.t) as intros_scheduled,
    count(*) filter (where c.call_type='demo' and (c.booked_at at time zone 'Asia/Riyadh')::date between w.f and w.t) as demos_booked,
    count(*) filter (where c.call_type='demo' and (c.status='showed' or (c.status in ('confirmed','invalid') and c.start_at <= now())) and (c.start_at at time zone 'Asia/Riyadh')::date between w.f and w.t) as demos_shown,
    count(*) filter (where c.call_type='demo' and (c.status='showed' or (c.status='confirmed' and c.start_at <= now())) and (c.start_at at time zone 'Asia/Riyadh')::date between w.f and w.t) as demos_qualified,
    count(*) filter (where c.call_type='demo' and c.status='invalid' and c.start_at <= now() and (c.start_at at time zone 'Asia/Riyadh')::date between w.f and w.t) as demos_disqualified,
    count(*) filter (where c.call_type='demo' and c.status='cancelled' and (c.start_at at time zone 'Asia/Riyadh')::date between w.f and w.t) as demos_cancelled,
    count(*) filter (where c.call_type='demo' and c.start_at <= now() and (c.start_at at time zone 'Asia/Riyadh')::date between w.f and w.t) as demos_due,
    count(*) filter (where c.call_type='demo' and (c.start_at at time zone 'Asia/Riyadh')::date between w.f and w.t) as demos_scheduled
  from w
  join public.calls c on ${webbyCall("c")}
  group by w.k
),
wb_handoff as (
  select w.k,
    count(*) as shown_intros,
    count(*) filter (where exists (
      select 1 from public.calls d2
      where d2.contact_id = i.contact_id and d2.call_type = 'demo' and d2.booked_at >= i.start_at
    )) as intros_advanced
  from w
  join public.calls i on i.call_type = 'intro'
    and (i.status = 'showed' or (i.status in ('confirmed','invalid') and i.start_at <= now()))
    and (i.start_at at time zone 'Asia/Riyadh')::date between w.f and w.t
    and ${webbyCall("i")}
  group by w.k
),
wb_signed as (
  select w.k,
    count(*) as signed,
    coalesce(sum(d.contracted_revenue), 0) as revenue,
    coalesce(sum(d.cash_collected), 0) as cash_collected,
    coalesce(sum(d.new_mrr), 0) as new_mrr
  from w
  join public.closed_deals d on (d.submitted_at at time zone 'Asia/Riyadh')::date between w.f and w.t
    and ${webbyDeal("d")}
    and ${NOT_VOIDED("d")}
  group by w.k
)
select w.k, w.f::text as d_from, w.t::text as d_to,
  public.b2b_window_metrics(w.f, w.t, null::text[]) as m,
  coalesce(sc.demos_still_confirmed, 0) as demos_still_confirmed,
  coalesce(r.q, 0) as roas_q, coalesce(r.u, 0) as roas_u, coalesce(r.nr, 0) as roas_nr, coalesce(r.untagged, 0) as roas_untagged,
  coalesce(sp.sp_leads, 0) as sp_leads, coalesce(sp.sp_called, 0) as sp_called, sp.sp_median_min, coalesce(sp.sp_within_5, 0) as sp_within_5,
  sp.sp_working_median_min, coalesce(sp.sp_working_within_5, 0) as sp_working_within_5,
  coalesce(sp.booked_leads, 0) as booked_leads,
  coalesce(sp.src_ads, 0) as src_ads, coalesce(sp.src_organic, 0) as src_organic, coalesce(sp.src_assumed, 0) as src_assumed,
  coalesce(fe.fe_deals, 0) as fe_deals, coalesce(fe.fe_deposit, 0) as fe_deposit,
  coalesce(fe.fe_deals_confirmed, 0) as fe_deals_confirmed, coalesce(fe.fe_confirmed, 0) as fe_confirmed,
  json_build_object(
    'spend', coalesce(wm.spend, 0), 'spend_retargeting', coalesce(wm.spend_retargeting, 0), 'impressions', coalesce(wm.impressions, 0),
    'clicks', coalesce(wm.clicks, 0), 'link_clicks', coalesce(wm.link_clicks, 0),
    'leads', coalesce(wl.leads, 0),
    'intros_booked', coalesce(wc.intros_booked, 0), 'intros_shown', coalesce(wc.intros_shown, 0),
    'intros_qualified', coalesce(wc.intros_qualified, 0), 'intros_disqualified', coalesce(wc.intros_disqualified, 0),
    'intros_cancelled', coalesce(wc.intros_cancelled, 0), 'intros_due', coalesce(wc.intros_due, 0),
    'intros_scheduled', coalesce(wc.intros_scheduled, 0),
    'demos_booked', coalesce(wc.demos_booked, 0), 'demos_shown', coalesce(wc.demos_shown, 0),
    'demos_qualified', coalesce(wc.demos_qualified, 0), 'demos_disqualified', coalesce(wc.demos_disqualified, 0),
    'demos_cancelled', coalesce(wc.demos_cancelled, 0), 'demos_due', coalesce(wc.demos_due, 0),
    'demos_scheduled', coalesce(wc.demos_scheduled, 0),
    'shown_intros', coalesce(wh.shown_intros, 0), 'intros_advanced', coalesce(wh.intros_advanced, 0),
    'signed', coalesce(ws.signed, 0), 'revenue', coalesce(ws.revenue, 0),
    'cash_collected', coalesce(ws.cash_collected, 0), 'new_mrr', coalesce(ws.new_mrr, 0)
  ) as wb,
  json_build_object(
    'signed', coalesce(vd.signed, 0), 'revenue', coalesce(vd.revenue, 0),
    'cash_collected', coalesce(vd.cash_collected, 0), 'new_mrr', coalesce(vd.new_mrr, 0)
  ) as vd
from w
left join still_confirmed sc on sc.k = w.k
left join roas r on r.k = w.k
left join speed sp on sp.k = w.k
left join fe fe on fe.k = w.k
left join wb_meta wm on wm.k = w.k
left join wb_leads wl on wl.k = w.k
left join wb_calls wc on wc.k = w.k
left join wb_handoff wh on wh.k = w.k
left join wb_signed ws on ws.k = w.k
left join vd_signed vd on vd.k = w.k`;
}
/**
 * Daily funnel with the Overview's rules, so the days add up to the windows:
 * lead-gen spend by Meta day, leads by creation day, intro and demo calls by
 * booking day, closes by form day. b2b_marketing_daily is not used because it
 * adds retargeting spend and counts demos only.
 */
function dailySql(from, to) {
    const f = day(from);
    const t = day(to);
    // Every tile on the growth tabs can be rebuilt for any timeframe from these
    // days (Aziz, 2026-09-21: "any number with a time dimension gets the same
    // timeframe control as the charts"): each stage carries its own counts by
    // its own day, so a window is a sum and a rate is a quotient of sums.
    return `with days as (
  select generate_series(${f}, ${t}, interval '1 day')::date as d
),
meta as (
  select s.date as d,
    sum(s.spend) filter (where public.b2b_campaign_type(s.campaign_name) = 'lead_gen' and not ${webbyCampaign("s")}) as spend,
    sum(s.spend) filter (where public.b2b_campaign_type(s.campaign_name) = 'retargeting' and not ${webbyCampaign("s")}) as spend_rt
  from public.meta_ad_snapshots s
  where s.date between ${f} and ${t}
  group by 1
),
ld as (
  select (l.lead_created_at at time zone 'Asia/Riyadh')::date as d,
    count(*) filter (where ${IS_LEAD}) as n,
    count(*) filter (where ${ROAS_Q}) as q,
    count(*) filter (where ${ROAS_U}) as u,
    count(*) filter (where ${ROAS_NR}) as nr,
    count(*) filter (where ${ROAS_NONE}) as untagged,
    count(*) filter (where ${IS_LEAD} and exists (
      select 1 from public.calls c where c.contact_id is not null and c.contact_id = l.contact_id and c.call_type in ('intro', 'demo'))) as booked_leads,
    count(*) filter (where ${IS_LEAD} and ${LEAD_SOURCE.ads}) as src_ads,
    count(*) filter (where ${IS_LEAD} and ${LEAD_SOURCE.organic}) as src_organic,
    count(*) filter (where ${IS_LEAD} and ${LEAD_SOURCE.assumed}) as src_assumed,
    count(fc.first_call) filter (where ${IS_LEAD}) as sp_called,
    coalesce(sum(extract(epoch from (fc.first_call - l.lead_created_at)) / 60.0) filter (where ${IS_LEAD} and fc.first_call is not null), 0) as sp_minutes,
    count(*) filter (where ${IS_LEAD} and fc.first_call is not null and fc.first_call - l.lead_created_at <= interval '5 minutes') as sp_within_5
  from public.leads l
  cross join lateral (
    select min(m.occurred_at) as first_call from public.maqsam_calls m
    where m.occurred_at >= l.lead_created_at
      and ${BY_SALES_REP}
      and ${CALL_IS_WITH_LEAD}
  ) fc
  where (l.lead_created_at at time zone 'Asia/Riyadh')::date between ${f} and ${t}
    and not ${webbyNewLead("l")}
  group by 1
),
bk as (
  select (c.booked_at at time zone 'Asia/Riyadh')::date as d,
    count(*) as n,
    count(*) filter (where c.call_type = 'intro') as intros_booked,
    count(*) filter (where c.call_type = 'demo') as demos_booked
  from public.calls c
  where c.call_type in ('intro', 'demo')
    and (c.booked_at at time zone 'Asia/Riyadh')::date between ${f} and ${t}
    and not ${webbyCall("c")}
  group by 1
),
held as (
  select (start_at at time zone 'Asia/Riyadh')::date as d,
    count(*) filter (where call_type = 'intro') as intros_scheduled,
    count(*) filter (where call_type = 'demo') as demos_scheduled,
    count(*) filter (where call_type = 'intro' and start_at <= now()) as intros_due,
    count(*) filter (where call_type = 'demo' and start_at <= now()) as demos_due,
    count(*) filter (where call_type = 'intro' and (status = 'showed' or (status in ('confirmed', 'invalid') and start_at <= now()))) as intros_shown,
    count(*) filter (where call_type = 'demo' and (status = 'showed' or (status in ('confirmed', 'invalid') and start_at <= now()))) as demos_shown,
    count(*) filter (where call_type = 'demo' and (status = 'showed' or (status = 'confirmed' and start_at <= now()))) as demos_qualified,
    count(*) filter (where call_type = 'intro' and status = 'cancelled') as intros_cancelled,
    count(*) filter (where call_type = 'demo' and status = 'cancelled') as demos_cancelled
  from public.calls c
  where call_type in ('intro', 'demo')
    and (start_at at time zone 'Asia/Riyadh')::date between ${f} and ${t}
    and not ${webbyCall("c")}
  group by 1
),
cl as (
  select (d.submitted_at at time zone 'Asia/Riyadh')::date as d,
    count(*) as n,
    coalesce(sum(d.contracted_revenue), 0) as contracted,
    coalesce(sum(d.cash_collected), 0) as deposit
  from public.closed_deals d
  where (d.submitted_at at time zone 'Asia/Riyadh')::date between ${f} and ${t}
    and not ${webbyDeal("d")}
    and ${NOT_VOIDED("d")}
  group by 1
)
select days.d::text as date,
  round(coalesce(meta.spend, 0)::numeric, 2) as spend,
  round(coalesce(meta.spend_rt, 0)::numeric, 2) as spend_rt,
  coalesce(ld.n, 0) as leads,
  coalesce(ld.q, 0) as qualified, coalesce(ld.u, 0) as unqualified, coalesce(ld.nr, 0) as not_ready, coalesce(ld.untagged, 0) as untagged,
  coalesce(ld.booked_leads, 0) as booked_leads,
  coalesce(ld.src_ads, 0) as src_ads, coalesce(ld.src_organic, 0) as src_organic, coalesce(ld.src_assumed, 0) as src_assumed,
  coalesce(ld.sp_called, 0) as sp_called, round(coalesce(ld.sp_minutes, 0)::numeric, 1) as sp_minutes, coalesce(ld.sp_within_5, 0) as sp_within_5,
  coalesce(bk.n, 0) as booked,
  coalesce(bk.intros_booked, 0) as intros_booked, coalesce(bk.demos_booked, 0) as demos_booked,
  coalesce(held.intros_scheduled, 0) as intros_scheduled, coalesce(held.demos_scheduled, 0) as demos_scheduled,
  coalesce(held.intros_due, 0) as intros_due, coalesce(held.demos_due, 0) as demos_due,
  coalesce(held.intros_shown, 0) as intros_shown, coalesce(held.demos_shown, 0) as demos_shown,
  coalesce(held.demos_qualified, 0) as demos_qualified,
  coalesce(held.intros_cancelled, 0) as intros_cancelled, coalesce(held.demos_cancelled, 0) as demos_cancelled,
  coalesce(cl.n, 0) as closes,
  round(coalesce(cl.contracted, 0)::numeric, 2) as contracted,
  round(coalesce(cl.deposit, 0)::numeric, 2) as deposit
from days
left join meta on meta.d = days.d
left join ld on ld.d = days.d
left join bk on bk.d = days.d
left join held on held.d = days.d
left join cl on cl.d = days.d
order by days.d`;
}
/**
 * b2b_rep_scorecard, trimmed to first names and the payload's columns, less
 * the voided deals it counts. A voided deal comes off the row the scorecard
 * gives it (read 2026-09-27): the Riyadh day of the form, and every rep whose
 * closer_aliases hold its closer name, else "unattributed". Close rate is
 * worked out again with the scorecard's formula, a row that was there only
 * for voided deals goes, and the order is the scorecard's own (revenue, then
 * calls scheduled) on what is left.
 */
function repsSql(from, to) {
    return `with sc as (
  select e.value as v, e.ordinality as ord
  from json_array_elements(public.b2b_rep_scorecard(${day(from)}, ${day(to)})) with ordinality e
),
vd as (
  select coalesce(sr.id::text, 'unattributed') as person_key,
    count(*) as closes,
    coalesce(sum(cd.contracted_revenue), 0) as revenue,
    coalesce(sum(cd.cash_collected), 0) as cash
  from public.closed_deals cd
  left join public.sales_reps sr on exists (
    select 1 from unnest(sr.closer_aliases) al where lower(btrim(al)) = lower(btrim(cd.closer)))
  where (cd.submitted_at at time zone 'Asia/Riyadh')::date between ${day(from)} and ${day(to)}
    and ${VOIDED("cd")}
  group by 1
),
r as (
  select sc.v, sc.ord,
    coalesce((sc.v->>'closes')::numeric, 0) - coalesce(vd.closes, 0) as closes,
    round(coalesce((sc.v->>'revenue')::numeric, 0) - coalesce(vd.revenue, 0), 2) as revenue,
    round(coalesce((sc.v->>'cash_collected')::numeric, 0) - coalesce(vd.cash, 0), 2) as cash,
    coalesce(vd.closes, 0) as v_closes,
    coalesce(vd.revenue, 0) as v_revenue,
    coalesce(vd.cash, 0) as v_cash,
    coalesce((sc.v->>'calls_scheduled')::int, 0) as calls
  from sc
  left join vd on vd.person_key = sc.v->>'person_key'
)
select
  case when (r.v->>'is_known')::boolean
    then split_part(btrim(r.v->>'display_name'), ' ', 1)
    else r.v->>'display_name' end as name,
  coalesce(r.v->>'role', sr.role) as role,
  r.v->>'calls_scheduled' as booked,
  r.v->>'calls_shown' as shown,
  r.closes,
  case when r.v_closes > 0
    then round((100.0 * r.closes / nullif((r.v->>'demos_qualified')::numeric, 0))::numeric, 1)::text
    else r.v->>'close_rate' end as close_rate,
  r.revenue as contracted,
  r.cash,
  r.v_closes, r.v_revenue, r.v_cash
from r
left join public.sales_reps sr on sr.id::text = r.v->>'person_key'
where not (r.v_closes > 0 and r.closes <= 0 and r.calls = 0)
order by r.revenue desc, r.calls desc, r.ord`;
}
/** The Marketing tab's per-ad table, top 6 by spend. */
function topAdsSql(from, to) {
    return `select
  coalesce(nullif(btrim(e.value->>'ad_name'), ''), 'Ad ' || (e.value->>'ad_id')) as name,
  e.value->>'spend' as spend,
  e.value->>'leads' as leads,
  e.value->>'cpl' as cpl
from json_array_elements(public.b2b_marketing_ads(${day(from)}, ${day(to)}, null::text[])) with ordinality e
where (e.value->>'spend')::numeric > 0
  and not exists (
    select 1 from public.meta_ad_snapshots ws
    where ws.ad_id = e.value->>'ad_id' and ${webbyCampaign("ws")})
order by (e.value->>'spend')::numeric desc, e.ordinality
limit 6`;
}
/**
 * Every ad with something to show for itself, over a long enough window that a
 * close can be attributed. Ranked by outcome, not by spend.
 *
 * b2b_marketing_ads counts voided deals as sales, so the voided deals of each
 * ad (dated as it dates a sale) come off sales, revenue and cash, and cost per
 * sale and revenue ROAS are worked out again with its formulas (read
 * 2026-09-27) on the rows that had any. `v_sales` says how many came off.
 */
function winningAdsSql(from, to) {
    return `with ads as (
  select e.value as v, e.ordinality as ord
  from json_array_elements(public.b2b_marketing_ads(${day(from)}, ${day(to)}, null::text[])) with ordinality e
),
vd as (
  select d.ad_id, count(*) as sales,
    coalesce(sum(d.contracted_revenue), 0) as revenue,
    coalesce(sum(d.cash_collected), 0) as cash
  from public.closed_deals d
  where d.ad_id is not null
    and (d.submitted_at at time zone 'Asia/Riyadh')::date between ${day(from)} and ${day(to)}
    and ${VOIDED("d")}
  group by 1
),
r as (
  select a.v, a.ord,
    coalesce((a.v->>'sales')::numeric, 0) - coalesce(vd.sales, 0) as sales,
    coalesce((a.v->>'revenue')::numeric, 0) - coalesce(vd.revenue, 0) as revenue,
    coalesce((a.v->>'cash')::numeric, 0) - coalesce(vd.cash, 0) as cash,
    coalesce(vd.sales, 0) as v_sales
  from ads a
  left join vd on vd.ad_id = a.v->>'ad_id'
)
select
  r.v->>'ad_id' as ad_id,
  coalesce(nullif(btrim(r.v->>'ad_name'), ''), 'Ad ' || (r.v->>'ad_id')) as name,
  r.v->>'thumbnail_url' as thumbnail,
  r.v->>'status' as status,
  r.v->>'in_meta' as in_meta,
  r.v->>'spend' as spend,
  r.v->>'impressions' as impressions,
  r.v->>'clicks' as clicks,
  r.v->>'link_clicks' as link_clicks,
  r.v->>'leads' as leads,
  r.v->>'cpl' as cpl,
  r.v->>'qualified_leads' as qualified,
  r.v->>'qualified_pct' as qualified_pct,
  r.v->>'demos_booked' as demos,
  r.v->>'cost_per_demo' as cost_per_demo,
  r.sales,
  r.revenue,
  r.cash,
  case when r.v_sales = 0 then r.v->>'cpa'
    when r.sales <= 0 or r.v->>'cpa' is null then null
    else round(((r.v->>'spend')::numeric / r.sales)::numeric, 2)::text end as cpa,
  case when r.v_sales = 0 then r.v->>'rev_roas'
    when r.sales <= 0 or r.v->>'rev_roas' is null then null
    else round((r.revenue / (r.v->>'spend')::numeric)::numeric, 2)::text end as rev_roas,
  r.v_sales
from r
where (coalesce((r.v->>'leads')::numeric, 0) > 0
   or coalesce((r.v->>'spend')::numeric, 0) > 0)
  and not exists (
    select 1 from public.meta_ad_snapshots ws
    where ws.ad_id = r.v->>'ad_id' and ${webbyCampaign("ws")})
order by r.sales desc,
         coalesce((r.v->>'demos_booked')::numeric, 0) desc,
         coalesce((r.v->>'leads')::numeric, 0) desc,
         r.ord
limit 24`;
}
/** Lead sources with the same rule as b2b_cockpit's sources list. */
function leadSourcesSql(from, to) {
    return `select coalesce(nullif(btrim(source), ''), '(none)') as source, count(*) as leads
from public.leads
where is_lead
  and (lead_created_at at time zone 'Asia/Riyadh')::date between ${day(from)} and ${day(to)}
  and not ${webbyNewLead("leads")}
group by 1
order by leads desc, source
limit 10`;
}
/**
 * Latest run per feed (sync_state has duplicate rows, so take the newest
 * non-null one), the newest row each feed has written, and whether any
 * lead-gen campaign is still live in Meta.
 */
const FRESHNESS_SQL = `with sync as (
  select distinct on (source) source, last_sync_status as status,
    (extract(epoch from last_synced_at) * 1000)::bigint as synced_ms,
    floor(extract(epoch from now() - last_synced_at) / 60)::int as age_min
  from public.sync_state
  where last_synced_at is not null
    and source in ('meta', 'leads', 'ghl_calls', 'typeform')
  order by source, last_synced_at desc
),
camp as (
  select distinct on (campaign_id) campaign_name, campaign_status
  from public.meta_ad_snapshots
  order by campaign_id, date desc
)
select s.source, s.status, s.synced_ms, s.age_min,
  (extract(epoch from case s.source
    when 'leads' then (select max(lead_created_at) from public.leads where is_lead)
    when 'ghl_calls' then (select max(booked_at) from public.calls)
    when 'typeform' then (select max(d.submitted_at) from public.closed_deals d where ${NOT_VOIDED("d")})
  end) * 1000)::bigint as newest_ms,
  (select max(date)::text from public.meta_ad_snapshots
     where spend > 0 and public.b2b_campaign_type(campaign_name) = 'lead_gen') as last_spend_day,
  (select count(*) from camp where campaign_status = 'ACTIVE'
     and public.b2b_campaign_type(campaign_name) = 'lead_gen') as active_leadgen
from sync s
order by s.source`;
const FEEDS = [
    { source: "meta", name: "B2B Meta ad spend" },
    { source: "leads", name: "B2B GHL leads" },
    { source: "ghl_calls", name: "B2B GHL calls" },
    { source: "typeform", name: "B2B closed-deal form" },
];
// A feed's row reads "running" while a sync is in progress and keeps the last
// finished time, so running is healthy; a stuck run shows up as stale by age.
const HEALTHY = new Set([
    "success",
    "partial",
    "success_no_attribution",
    "running",
]);
/** Feeds run every 15 minutes; an hour without a run is stale. */
const STALE_MIN = 60;
const orNull = (x) => x === null || x === undefined ? null : num(x);
/** The dashboard's percents (one decimal) as fractions 0..1. */
const pct = (x) => x === null || x === undefined ? null : Math.round(num(x) * 10) / 1000;
const round2 = (x) => Math.round(x * 100) / 100;
function usd(x) {
    return `$${x.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
}
/**
 * A record-keeping fact, at info level so Today leaves it off its growth
 * card: how many of this month's past demos are still marked confirmed. The
 * dashboard's rule counts each of them as shown, which is correct, so a demo
 * that did not happen has to be marked no-show in GHL for the rate to see it.
 */
function stillConfirmedNote(w) {
    const n = w.demosStillConfirmed;
    if (n <= 0)
        return null;
    const due = num(w.raw.demos_due);
    return {
        level: "info",
        text: `${n} of the ${due} demos due this month are still marked confirmed. The dashboard counts a past confirmed demo as shown, so a demo that did not happen should be marked no-show in GHL.`,
    };
}
/** Every numeric key of the function's JSON, as is (percents stay x100). */
function rawNumbers(m) {
    const raw = {};
    for (const [k, x] of Object.entries(m)) {
        if (x === null)
            raw[k] = null;
        else if (typeof x === "number")
            raw[k] = x;
        else if (typeof x === "string" &&
            x.trim() !== "" &&
            Number.isFinite(Number(x)))
            raw[k] = Number(x);
    }
    return raw;
}
function metricsOf(r) {
    const m = typeof r.m === "string" ? JSON.parse(r.m) : r.m;
    if (!m || m.leads === undefined)
        throw new Error(`growth: b2b_window_metrics gave no data for ${r.k}`);
    return m;
}
function partOf(r) {
    const raw = typeof r.wb === "string" ? JSON.parse(r.wb) : (r.wb ?? {});
    const out = {};
    for (const [k, x] of Object.entries(raw))
        out[k] = num(x);
    return out;
}
/**
 * The dashboard's window less the webinar's share, every rate worked out
 * again with b2b_window_metrics' own formulas (read 2026-09-23), so the call
 * funnel is the dashboard's rule applied to the calls that are not the
 * webinar's. A window the webinar has nothing in is returned untouched.
 */
export { withoutWebinar } from "../webinarAttribution.js";
function toWindow(r) {
    const wb = partOf(r);
    const b2b = metricsOf(r);
    // The voided deals come off first, then the webinar's share (which leaves
    // voided deals out too), so each deal is taken off once.
    const vd = voidedPartOf(r.vd);
    const m = withoutWebinar(withoutVoids(b2b, vd), wb);
    const spend = num(m.spend);
    const qualified = num(r.roas_q);
    const unqualified = num(r.roas_u);
    const leads = qualified + unqualified;
    const called = num(r.sp_called);
    const medianMin = orNull(r.sp_median_min);
    const spLeads = num(r.sp_leads);
    const bookedLeads = num(r.booked_leads);
    const deposit = round2(num(r.fe_deposit));
    const confirmed = round2(num(r.fe_confirmed));
    const contracted = num(m.revenue);
    const ratio = (a, b, places = 2) => b > 0 ? Math.round((a / b) * 10 ** places) / 10 ** places : null;
    return {
        from: String(r.d_from),
        to: String(r.d_to),
        spend,
        leads,
        cpl: ratio(spend, leads),
        leadClasses: {
            qualified,
            unqualified,
            notReady: num(r.roas_nr),
            untagged: num(r.roas_untagged),
        },
        sources: {
            ads: num(r.src_ads),
            organic: num(r.src_organic),
            assumedAds: num(r.src_assumed),
        },
        speedToLead: {
            leads: spLeads,
            called,
            neverCalled: Math.max(0, spLeads - called),
            medianMin: medianMin === null ? null : Math.round(medianMin * 10) / 10,
            within5Share: ratio(num(r.sp_within_5), called, 3),
            workingMedianMin: orNull(r.sp_working_median_min) === null
                ? null
                : Math.round(num(r.sp_working_median_min) * 10) / 10,
            workingWithin5Share: ratio(num(r.sp_working_within_5), called, 3),
        },
        leadToBooked: {
            bookedLeads,
            rate: ratio(bookedLeads, leads, 3),
        },
        introsBooked: num(m.intros_booked),
        introsShown: num(m.intros_shown),
        introsDue: num(m.intros_due),
        demosBooked: num(m.demos_booked),
        demosShown: num(m.demos_shown),
        demosDue: num(m.demos_due),
        demoShowRate: pct(m.demo_show_rate),
        introShowRate: pct(m.intro_show_rate),
        introToDemo: pct(m.intro_to_demo),
        demosStillConfirmed: num(r.demos_still_confirmed),
        cancel: {
            intro: pct(m.intro_cancel_rate),
            demo: pct(m.demo_cancel_rate),
            total: pct(m.cancel_rate),
            introsCancelled: num(m.intros_cancelled),
            introsScheduled: num(m.intros_scheduled),
            demosCancelled: num(m.demos_cancelled),
            demosScheduled: num(m.demos_scheduled),
        },
        costPerDemo: orNull(m.cost_per_demo),
        costPerDemoBooked: orNull(m.cost_per_demo_booked),
        closes: num(m.signed),
        closeRate: pct(m.close_rate_all),
        qualifiedCloseRate: pct(m.close_rate),
        contracted,
        cash: num(m.cash_collected),
        // Typed on the forms; withKickoff adds the kickoff form and withPaid
        // the money (total, paid, roasCash), never the typed amounts.
        frontEndCash: {
            deposit,
            kickoff: null,
            total: null,
            deals: num(r.fe_deals),
            dealsConfirmed: num(r.fe_deals_confirmed),
            confirmed,
            confirmedShare: ratio(confirmed, deposit, 3),
        },
        cac: orNull(m.cac),
        roas: orNull(m.roas),
        roasCash: null,
        roasContracted: ratio(contracted, spend),
        raw: rawNumbers(m),
        webinarOut: {
            spend: round2(wb.spend ?? 0),
            leads: wb.leads ?? 0,
            callsBooked: (wb.intros_booked ?? 0) + (wb.demos_booked ?? 0),
            demosShown: wb.demos_shown ?? 0,
            closes: wb.signed ?? 0,
            contracted: round2(wb.revenue ?? 0),
            cash: round2(wb.cash_collected ?? 0),
        },
        voidedOut: {
            closes: vd.signed,
            contracted: round2(vd.revenue),
            cash: round2(vd.cash_collected),
            newMrr: round2(vd.new_mrr),
            b2b: {
                closes: num(b2b.signed),
                contracted: round2(num(b2b.revenue)),
                cash: round2(num(b2b.cash_collected)),
            },
        },
    };
}
/** The six windows in words, for notes. */
const WINDOW_WORDS = {
    yesterday: "yesterday",
    last7: "the last 7 days",
    prevLast7: "the 7 days before",
    mtd: "this month",
    lastMonthToDate: "last month to date",
    lastMonth: "last month",
};
/**
 * Voided deals are left out, said once: which days in the last 365 had any,
 * and which of the six windows read lower than the B2B dashboard for them.
 * Null when there were none. It names the closed-deal form and close rates,
 * so the Sales tab puts it on its closing card and the Frontend tab on the
 * funnel.
 */
export function voidedNote(days, windows) {
    const which = voidedDaysText(days);
    const lower = Object.keys(WINDOW_WORDS)
        .map(k => ({ k, v: windows[k]?.voidedOut }))
        .filter(x => (x.v?.closes ?? 0) > 0)
        .map(({ k, v }) => `${WINDOW_WORDS[k]} by ${v?.closes} ${v?.closes === 1 ? "close" : "closes"}, ${dollars(v?.contracted ?? 0)} contracted and ${dollars(v?.cash ?? 0)} cash`);
    if (!which && !lower.length)
        return null;
    return {
        level: "info",
        text: `Voided deals are left out of every close, contracted and cash figure here, and of the close rates, cost to win and ROAS built on them. B2B keeps a voided closed-deal form in its table and its own dashboard still counts it.${which ? ` In the last 365 days: ${which}.` : ""}${lower.length ? ` So this reads lower than the B2B dashboard for ${lower.join("; ")}.` : ""}`,
    };
}
/**
 * Kickoff cash (A087; Aziz, 2026-09-21: "At the end of the kickoff form, the
 * CSM also fills in if they collected the rest of the cash, and then you can
 * add it up there. And then we can use Tap Payments and WAP, or the bank
 * transfer, just to confirm."). Since 2026-10-18 (MONEY-ATTRIBUTION.md rule
 * 6) the typed amount is shown beside front-end cash as typed, not money, and
 * never added: front-end cash is the money itself (withPaid).
 *
 * The amount is the kickoff Typeform's (tG7dnxBn) "Payment Amount" field
 * (ref 75e97e7d-4c19-437a-b4b8-67570c29344f), which the onboarding sync
 * copies to cockpit_client_onboarding.forms.kickoff.payment. It is dated by
 * the day the form was submitted (Kuwait) and read as USD: the field carries
 * no currency and every cockpit money figure is USD. The form carries the
 * amount from 4 Oct 2026 (the first response with it), so a day before that
 * reads as not read, never zero.
 *
 * Confirmed: a payment the Money section attributed to the same client card
 * on Whop, Tap or a bank transfer (a transfer row or a bank statement line),
 * within MATCH_DAYS days and MATCH_GAP of the amount (./manualMatch.js), one
 * payment per kickoff. A payment only logged by hand is not a rail. An
 * unconfirmed kickoff is listed under typedNotSeen.
 */
export const KICKOFF_FORM = "tG7dnxBn";
export const KICKOFF_READ_FROM = "2026-10-04";
const KICKOFF_RAILS = new Set(["whop", "tap", "transfer"]);
export const KICKOFF_SQL = `select clickup_task_id, client_name,
    to_char(((forms->'kickoff'->>'submitted_at')::timestamptz at time zone 'Asia/Kuwait')::date, 'YYYY-MM-DD') as day,
    forms->'kickoff'->>'payment' as payment,
    floor(extract(epoch from synced_at) * 1000)::bigint as synced_ms
  from public.cockpit_client_onboarding
  where forms->'kickoff'->>'form_id' = '${KICKOFF_FORM}' and forms->'kickoff'->>'submitted_at' is not null`;
/** A typed amount as a number: "1500", "1,500", "$1500.50". Null when blank or not a number. */
export function kickoffAmount(raw) {
    if (raw === null || raw === undefined)
        return null;
    const text = String(raw).replace(/[,$\s]/g, "").replace(/usd$/i, "");
    if (!text || !/^\d+(\.\d+)?$/.test(text))
        return null;
    const n = Number(text);
    return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}
/**
 * The kickoff forms from KICKOFF_READ_FROM with an amount, each with what
 * confirms it, plus the forms that left the amount blank (named, not zero).
 * Pure, for the tests.
 */
export function readKickoffs(formRows, paymentRows) {
    const kickoffs = [];
    const blank = [];
    const used = new Set();
    const rails = paymentRows
        .filter(p => KICKOFF_RAILS.has(String(p.rail)) && num(p.usd) > 0 && /^\d{4}-\d{2}-\d{2}$/.test(String(p.day)))
        .map(p => ({ id: String(p.payment_id), taskId: String(p.clickup_task_id), day: String(p.day), usd: num(p.usd), rail: String(p.rail) }));
    const forms = formRows
        .filter(r => /^\d{4}-\d{2}-\d{2}$/.test(String(r.day)) && String(r.day) >= KICKOFF_READ_FROM)
        .sort((a, b) => String(a.day).localeCompare(String(b.day)) || String(a.clickup_task_id).localeCompare(String(b.clickup_task_id)));
    for (const r of forms) {
        const amount = kickoffAmount(r.payment);
        const taskId = String(r.clickup_task_id ?? "");
        const client = String(r.client_name ?? "a client");
        if (amount === null) {
            blank.push({ day: String(r.day), client });
            continue;
        }
        let match = null;
        if (amount > 0)
            match = rails
                .filter(p => !used.has(p.id) && p.taskId === taskId && dayGap(p.day, String(r.day)) <= MATCH_DAYS && amountGap(p.usd, amount) <= MATCH_GAP)
                .sort((a, b) => dayGap(a.day, String(r.day)) - dayGap(b.day, String(r.day)) || amountGap(a.usd, amount) - amountGap(b.usd, amount))[0] ?? null;
        if (match)
            used.add(match.id);
        kickoffs.push({ day: String(r.day), taskId, client, amount, confirmed: match ? amount : 0, rail: match?.rail ?? null });
    }
    return { kickoffs, blank, railPayments: rails.length };
}
/** Kickoff money in an inclusive window: null when no day of it is read. */
export function kickoffIn(kickoffs, from, to) {
    if (!kickoffs || to < KICKOFF_READ_FROM)
        return null;
    const start = from > KICKOFF_READ_FROM ? from : KICKOFF_READ_FROM;
    const mine = kickoffs.filter(k => k.day >= start && k.day <= to);
    const amount = round2(mine.reduce((sum, k) => sum + k.amount, 0));
    const confirmed = round2(mine.reduce((sum, k) => sum + k.confirmed, 0));
    return { amount, confirmed, forms: mine.length, from: start, partial: from < KICKOFF_READ_FROM };
}
/** The kickoff form's typed amount beside the deposit: typed, not money, so total and front-end ROAS are left to withPaid. */
export function withKickoff(window, kickoffs) {
    const k = kickoffIn(kickoffs, window.from, window.to);
    const ratio = (a, b, places = 2) => b > 0 ? Math.round((a / b) * 10 ** places) / 10 ** places : null;
    if (!k)
        return { ...window, frontEndCash: { ...window.frontEndCash, kickoff: null, kickoffConfirmedShare: null } };
    return {
        ...window,
        frontEndCash: {
            ...window.frontEndCash,
            kickoff: k.amount,
            kickoffConfirmed: k.confirmed,
            kickoffConfirmedShare: ratio(k.confirmed, k.amount, 3),
            kickoffForms: k.forms,
            kickoffFrom: k.from,
        },
    };
}
/**
 * Front-end cash on the Sales tab (Aziz, 2026-10-18; contract
 * docs/money/MONEY-ATTRIBUTION.md rule 6): paid front-end money (the
 * closer's deal money, rule 1) by the day it arrived, from every rail, webinar
 * and voided deals left out. The typed deposit and the kickoff form's amount
 * stay beside it as typed, not money, and are never added.
 *
 * Source: the deal ledger, public.cockpit_deal_payments (active rows), which
 * the finance refresh writes in the same transaction as the Money section
 * from the same attribution. Chosen over the Money section's published
 * transactions because the ledger is every front-end payment of the twelve
 * months (the section's list is capped at 1,500 rows, money out included),
 * it is what payroll reads, and it carries the deal for the webinar
 * exclusion. Either way growth runs beside money, not after it, so the figure
 * is the last published attribution: `attributedAt` says when, and a note says
 * when that is over 2 hours old. A ledger not yet written is not read, never
 * zero.
 */
export const LEDGER_STALE_MS = 2 * 60 * 60_000;
/** A deal's money is the closer's this many days after signing (money.js DEAL_TERM_DAYS), so the ledger points at deals this far back. */
const DEAL_TERM_DAYS = 120;
/** The ledger's rail in the tile's words: a bank transfer (B2B transfers and statement lines) is bank. */
const LEDGER_RAIL = { whop: "whop", tap: "tap", manual: "manual", transfer: "bank", bank: "bank" };
/** The deal ledger and the Money section's own count of it, in one statement so both are one publish. */
export function dealLedgerSql(from) {
    return `with m as (
  select floor(extract(epoch from computed_at) * 1000)::bigint as computed_ms,
    payload->'attribution'->'dealLedger' as ledger
  from public.cockpit_sections
  where key = 'money'
)
select m.computed_ms, m.ledger::text as ledger, p.payment_id, p.deal_response_id,
  to_char(p.day, 'YYYY-MM-DD') as day, p.usd::float8 as usd, p.rail, p.kind, p.deposit_usd::float8 as deposit_usd, p.matched_by
from m
left join public.cockpit_deal_payments p on p.active and p.day >= ${day(from)}
order by p.day, p.payment_id`;
}
/** The deals the ledger can point at (signed up to DEAL_TERM_DAYS before its first day), with the webinar and void flags. */
export function ledgerDealsSql(from) {
    return `select d.response_id,
    to_char((d.submitted_at at time zone 'Asia/Riyadh')::date, 'YYYY-MM-DD') as day,
    left(nullif(btrim(d.business_name), ''), 80) as business,
    nullif(btrim(d.closer), '') as closer,
    coalesce(d.cash_collected, 0) as deposit,
    ${webbyDeal("d")} as webinar,
    ${VOIDED("d")} as voided
  from public.closed_deals d
  where d.submitted_at >= ${day(addDays(from, -DEAL_TERM_DAYS))}`;
}
/**
 * The ledger rows as growth uses them: each payment with its deal's closer and
 * business, webinar and voided deals set aside and counted. Not ready (with
 * why) when the Money section has not published the ledger yet. `agree` says
 * whether the ledger's active rows over the section's months match the count
 * and sum the section published with it. Pure, for the tests.
 */
export function readDealLedger(sqlRows, dealRows) {
    const head = sqlRows[0];
    if (!head)
        return { ready: false, why: "the Money section has not been published", attributedAt: null };
    const attributedAt = num(head.computed_ms) || null;
    let section = null;
    try {
        section = head.ledger ? JSON.parse(String(head.ledger)) : null;
    }
    catch {
        section = null;
    }
    if (!section || typeof section.from !== "string")
        return { ready: false, why: "the Money section was published before the deal ledger existed; it fills on the next money refresh", attributedAt };
    const deals = new Map(dealRows.map(d => [String(d.response_id), d]));
    const rows = [];
    const set = { webinar: { payments: 0, usd: 0 }, voided: { payments: 0, usd: 0 }, unknownDeal: 0 };
    let ledgerRows = 0;
    let ledgerUsd = 0;
    for (const r of sqlRows) {
        if (!r.payment_id)
            continue;
        const usd = num(r.usd);
        const dayText = String(r.day);
        if (dayText >= section.from) {
            ledgerRows += 1;
            ledgerUsd += usd;
        }
        const deal = deals.get(String(r.deal_response_id));
        if (!deal)
            set.unknownDeal += 1;
        const out = deal && String(deal.webinar) === "true" ? set.webinar : deal && String(deal.voided) === "true" ? set.voided : null;
        if (out) {
            out.payments += 1;
            out.usd = round2(out.usd + usd);
            continue;
        }
        // The part of the payment up to the deal's typed deposit; a row without it is all deposit or all remainder by its kind.
        const depositUsd = r.deposit_usd === null || r.deposit_usd === undefined ? (String(r.kind) === "deposit" ? usd : 0) : num(r.deposit_usd);
        rows.push({
            paymentId: String(r.payment_id), dealId: String(r.deal_response_id), day: dayText, usd,
            rail: LEDGER_RAIL[String(r.rail)] ?? "bank", kind: String(r.kind), depositUsd, matchedBy: r.matched_by ? String(r.matched_by) : null,
            closer: deal?.closer ? String(deal.closer) : null, business: deal?.business ? String(deal.business) : null,
        });
    }
    const agree = ledgerRows === num(section.rows) && Math.abs(round2(ledgerUsd) - num(section.usd)) < 0.01;
    return { ready: true, attributedAt, from: section.from, rows, set, agree, ledgerRows, ledgerUsd: round2(ledgerUsd), sectionRows: num(section.rows), sectionUsd: num(section.usd) };
}
/** Paid front-end money in an inclusive window, from readDealLedger's rows. */
export function paidIn(rows, from, to) {
    const mine = rows.filter(r => r.day >= from && r.day <= to);
    const sum = list => round2(list.reduce((n, r) => n + r.usd, 0));
    const byRail = {};
    for (const rail of ["whop", "tap", "bank", "manual"])
        byRail[rail] = sum(mine.filter(r => r.rail === rail));
    const closers = new Map();
    for (const r of mine) {
        const name = r.closer ?? "Closer not on the form";
        const c = closers.get(name.toLowerCase()) ?? { name, usd: 0, payments: 0 };
        c.usd += r.usd;
        c.payments += 1;
        closers.set(name.toLowerCase(), c);
    }
    // The deposit is the part of each payment up to the typed deposit (contract rule 1); the rest is the remainder.
    const paidDeposit = round2(mine.reduce((n, r) => n + (r.depositUsd ?? (r.kind === "deposit" ? r.usd : 0)), 0));
    return {
        paid: sum(mine),
        paidDeposit,
        paidRemainder: round2(sum(mine) - paidDeposit),
        payments: mine.length,
        paidDeals: new Set(mine.map(r => r.dealId)).size,
        byRail,
        byCloser: [...closers.values()].map(c => ({ ...c, usd: round2(c.usd) })).sort((a, b) => b.usd - a.usd || a.name.localeCompare(b.name)),
    };
}
/**
 * Typed amounts in the window that no money matches, listed and never added:
 * a deal signed in the window whose ledger money (any day) is short of the
 * deposit typed on its form by more than MATCH_GAP, and a kickoff form with
 * an amount no rail payment on its card confirmed.
 */
export function typedNotSeen(window, ledger, deals, kickoffs) {
    const paidByDeal = new Map();
    for (const r of ledger.rows)
        paidByDeal.set(r.dealId, (paidByDeal.get(r.dealId) ?? 0) + r.usd);
    const items = [];
    for (const d of deals) {
        const signed = String(d.day);
        const typed = num(d.deposit);
        if (signed < window.from || signed > window.to || typed <= 0 || String(d.webinar) === "true" || String(d.voided) === "true")
            continue;
        const seen = round2(paidByDeal.get(String(d.response_id)) ?? 0);
        if (seen + 0.01 < typed * (1 - MATCH_GAP))
            items.push({ kind: "deposit", day: signed, business: d.business ? String(d.business) : null, typed: round2(typed), seen, usd: round2(typed - seen) });
    }
    for (const k of kickoffs ?? []) {
        if (k.day < window.from || k.day > window.to || k.amount <= 0 || k.confirmed > 0)
            continue;
        items.push({ kind: "kickoff", day: k.day, business: k.client, typed: k.amount, seen: 0, usd: k.amount });
    }
    items.sort((a, b) => a.day.localeCompare(b.day) || String(a.business).localeCompare(String(b.business)));
    return { usd: round2(items.reduce((n, i) => n + i.usd, 0)), count: items.length, items: items.slice(0, 20) };
}
/** Front-end cash = paid front-end money (rule 6), with the typed amounts beside it. Not read leaves the money null, never zero. */
export function withPaid(window, ledger, deals, kickoffs) {
    const ratio = (a, b, places = 2) => b > 0 ? Math.round((a / b) * 10 ** places) / 10 ** places : null;
    const fe = window.frontEndCash;
    const typed = { deposit: fe.deposit, kickoff: fe.kickoff ?? null };
    if (!ledger?.ready)
        return {
            ...window,
            frontEndCash: { ...fe, total: null, paid: null, paidDeposit: null, paidRemainder: null, payments: null, paidDeals: null, byRail: null, byCloser: null, typed, typedNotSeen: null, attributedAt: ledger?.attributedAt ?? null },
            roasCash: null,
        };
    const p = paidIn(ledger.rows, window.from, window.to);
    return {
        ...window,
        frontEndCash: { ...fe, ...p, total: p.paid, typed, typedNotSeen: typedNotSeen(window, ledger, deals, kickoffs), attributedAt: ledger.attributedAt },
        roasCash: ratio(p.paid, window.spend),
    };
}
/** Run a secondary read; on failure keep going with a fallback and a warning. */
async function attempt(what, notes, fallback, run) {
    try {
        return await run();
    }
    catch (e) {
        const why = String(e instanceof Error ? e.message : e).slice(0, 140);
        notes.push({
            level: "warn",
            text: `${what} could not be read this run (${why}).`,
        });
        return fallback;
    }
}
export const growth = {
    key: "growth",
    label: "Marketing and sales",
    compute: async () => {
        const today = kuwaitDay();
        const ranges = windowRanges(today);
        const notes = [];
        // The working hours the speed-to-lead clock uses (cockpit_settings, or the default).
        const wh = await workingHoursForAdapters();
        // Core read. No fallback: a failure keeps the last good payload.
        const windowRows = await sql(B2B, windowsSql(ranges, wh.hours));
        const byKey = new Map(windowRows.map(r => [String(r.k), r]));
        const rowOf = (k) => {
            const r = byKey.get(k);
            if (!r)
                throw new Error(`growth: no ${k} window returned`);
            return r;
        };
        // Kickoff cash from the CSM's kickoff form, confirmed on the rails
        // (A087). A failed read leaves kickoff as not read in every window.
        const kickoffRead = await attempt("The kickoff form's cash", notes, null, async () => {
            const [formRows, paymentRows] = await Promise.all([
                sql(TRIAGE, KICKOFF_SQL),
                sql(TRIAGE, `select payment_id, clickup_task_id, to_char(day, 'YYYY-MM-DD') as day, usd::float8 as usd, rail
           from public.cockpit_client_payments
           where active and day >= ${day(addDays(KICKOFF_READ_FROM, -MATCH_DAYS))}`),
            ]);
            return { ...readKickoffs(formRows, paymentRows), syncedAt: Math.max(0, ...formRows.map(r => num(r.synced_ms))) || undefined };
        });
        const kickoffs = kickoffRead?.kickoffs ?? null;
        // Front-end cash from the paid deal ledger (MONEY-ATTRIBUTION.md rule
        // 6). A failed read leaves the money not read in every window.
        const ledgerFrom = addDays(today, -364);
        const ledgerRead = await attempt("Front-end cash from the deal ledger", notes, null, async () => {
            const [ledgerRows, dealRows] = await Promise.all([
                sql(TRIAGE, dealLedgerSql(ledgerFrom)),
                sql(B2B, ledgerDealsSql(ledgerFrom)),
            ]);
            return { ledger: readDealLedger(ledgerRows, dealRows), deals: dealRows };
        });
        const ledger = ledgerRead?.ledger ?? null;
        const ledgerDeals = ledgerRead?.deals ?? [];
        const frontEnd = (k) => withPaid(withKickoff(toWindow(rowOf(k)), kickoffs), ledger, ledgerDeals, kickoffs);
        const paidByDay = new Map();
        for (const r of ledger?.ready ? ledger.rows : [])
            paidByDay.set(r.day, (paidByDay.get(r.day) ?? 0) + r.usd);
        const windows = {
            yesterday: frontEnd("yesterday"),
            last7: frontEnd("last7"),
            prevLast7: frontEnd("prevLast7"),
            mtd: frontEnd("mtd"),
            lastMonthToDate: frontEnd("lastMonthToDate"),
            lastMonth: frontEnd("lastMonth"),
        };
        const mtd = windows.mtd;
        // How much of this month's leads carry any first-touch attribution at all
        // (GoHighLevel's attributionSource is `{}` on most contacts), so the
        // organic split can say how much of it is a guess.
        const organicEmptyShare = await attempt("The attribution coverage", notes, "an unknown share", async () => {
            const [row] = await sql(B2B, `select count(*) as n,
                  count(*) filter (where coalesce(l.raw_contact->'attributionSource'->>'medium', '') = '') as empty
           from public.leads l
           where ${IS_LEAD}
             and (l.lead_created_at at time zone 'Asia/Riyadh')::date between ${day(ranges.mtd[0])} and ${day(ranges.mtd[1])}`);
            const n = num(row?.n);
            return n > 0 ? `${Math.round((num(row?.empty) / n) * 100)}%` : "all";
        });
        const daily = await attempt("The 365-day daily series", notes, [], async () => (await sql(B2B, dailySql(addDays(today, -364), today))).map(r => ({
            date: String(r.date),
            spend: num(r.spend),
            spendRetargeting: num(r.spend_rt),
            leads: num(r.leads),
            qualified: num(r.qualified),
            unqualified: num(r.unqualified),
            notReady: num(r.not_ready),
            untagged: num(r.untagged),
            bookedLeads: num(r.booked_leads),
            srcAds: num(r.src_ads),
            srcOrganic: num(r.src_organic),
            srcAssumed: num(r.src_assumed),
            spCalled: num(r.sp_called),
            spMinutes: num(r.sp_minutes),
            spWithin5: num(r.sp_within_5),
            booked: num(r.booked),
            introsBooked: num(r.intros_booked),
            demosBooked: num(r.demos_booked),
            introsScheduled: num(r.intros_scheduled),
            demosScheduled: num(r.demos_scheduled),
            introsDue: num(r.intros_due),
            demosDue: num(r.demos_due),
            introsShown: num(r.intros_shown),
            demosShown: num(r.demos_shown),
            demosQualified: num(r.demos_qualified),
            introsCancelled: num(r.intros_cancelled),
            demosCancelled: num(r.demos_cancelled),
            closes: num(r.closes),
            contracted: num(r.contracted),
            deposit: num(r.deposit),
            // Kickoff cash by the day its form was submitted; null before the
            // form was read (KICKOFF_READ_FROM) or when the read failed.
            ...(() => {
                const k = kickoffs ? kickoffIn(kickoffs, String(r.date), String(r.date)) : null;
                return k ? { kickoff: k.amount, kickoffConfirmed: k.confirmed } : { kickoff: null };
            })(),
            // Paid front-end money by the day it arrived; null before the
            // ledger's first month or when the ledger is not read.
            frontEndPaid: ledger?.ready && String(r.date) >= ledger.from ? round2(paidByDay.get(String(r.date)) ?? 0) : null,
        })));
        const reps = await attempt("The rep scorecard", notes, [], async () => (await sql(B2B, repsSql(ranges.mtd[0], ranges.mtd[1]))).map(r => ({
            name: String(r.name ?? "Unknown"),
            role: r.role ? String(r.role) : null,
            booked: num(r.booked),
            shown: num(r.shown),
            closes: num(r.closes),
            closeRate: pct(r.close_rate),
            contracted: num(r.contracted),
            cash: num(r.cash),
            ...(num(r.v_closes) > 0
                ? {
                    voided: {
                        closes: num(r.v_closes),
                        contracted: round2(num(r.v_revenue)),
                        cash: round2(num(r.v_cash)),
                    },
                }
                : {}),
        })));
        // Deals, not rows: a row that held only voided deals is gone, and the
        // scorecard is read for the month to date, the same days as `mtd`.
        const repVoids = mtd.voidedOut?.closes ?? 0;
        // Voided deals over the daily series' reach, for the note that says so.
        const voidedDays = await attempt("The voided deals", notes, [], async () => (await sql(B2B, voidedByDaySql(addDays(today, -364), today))).map(voidedDayOf));
        const topAds = await attempt("Top ads", notes, [], async () => (await sql(B2B, topAdsSql(ranges.last7[0], ranges.last7[1]))).map(r => ({
            name: String(r.name),
            spend: num(r.spend),
            leads: num(r.leads),
            cpl: orNull(r.cpl),
        })));
        const leadSources = await attempt("Lead sources", notes, [], async () => (await sql(B2B, leadSourcesSql(ranges.mtd[0], ranges.mtd[1]))).map(r => ({ source: String(r.source), leads: num(r.leads) })));
        const feedRows = await attempt("Feed freshness", notes, null, () => sql(B2B, FRESHNESS_SQL));
        // Caveats, most important first.
        const stillConfirmed = stillConfirmedNote(mtd);
        if (stillConfirmed)
            notes.push(stillConfirmed);
        const voided = voidedNote(voidedDays, windows);
        if (voided)
            notes.push(voided);
        notes.push({
            level: "info",
            text: "Show rate is the B2B dashboard's: calls shown over calls due. A call counts as shown when it is marked showed, or marked confirmed or invalid once its time has passed. Calls due are every call whose time has passed in the window, cancelled and no-show included. A future call is in neither count.",
        }, {
            level: "info",
            text: `Spend is lead-gen campaigns only, as on the dashboard overview. Retargeting adds ${usd(num(mtd.raw.spend_retargeting))} this month. Spend days are the Meta ad account's reporting day.`,
        }, {
            level: "info",
            text: "Each stage is dated by its own event: leads by creation day, bookings by booking day, shows by call day, closes by form day. Rates are not cohort conversion, and close rate can pass 100% in a short window.",
        }, {
            level: "info",
            text: "Leads are the contacts the setters tagged roas-qualified or roas-unqualified in GoHighLevel, dated by creation. Not ready (roas-unprepared) and contacts with no ROAS tag are shown beside the count and never in it.",
        }, {
            level: "info",
            text: `Where leads come from is judged by the ad id on the contact: with one, ads; without one, organic when the source, a tag or the attribution medium says inbound WhatsApp, Instagram DM, YouTube, referral or organic; otherwise ads, assumed. GoHighLevel's first-touch attribution is empty on ${organicEmptyShare} of this month's leads, so a true first click needs UTMs on the forms and the WhatsApp link, or a "how did you find us" answer.`,
        }, {
            level: "info",
            text: `Speed to lead runs from the lead's creation to the first Maqsam call with it by a sales rep on the roster (setter, closer or both), never a call-centre agent. The median is over the leads that were called; the never-called are counted beside it. The working-hours figure starts the clock at the later of the lead's creation and the next working window and counts working minutes only (${describeWorkingHours(wh.hours)}${wh.ready ? "" : ", the default"}).`,
        }, {
            level: "info",
            text: `Contracted comes from the closed-deal form. Front-end cash is money paid: every payment the Money tab credited to a signed deal's closer (from 7 days before the form until the deal's tied cash reaches its contract, at most ${DEAL_TERM_DAYS} days after signing), on Whop, Tap, a bank transfer or logged by hand, counted on the day it arrived, webinar deals left out. It is the last published money attribution, so it can be up to one refresh behind the Money tab. The deposit the closer typed on the form and the Payment Amount the CSM types on the kickoff form (read as USD, from ${KICKOFF_READ_FROM}) are shown beside it as typed, not money, and never added; a typed amount no payment matches is listed as typed, not seen. The deposit's confirmed share is what a Whop payment or a bank transfer on record backs (Tap is not checked for the deposit). A kickoff is confirmed by a Whop, Tap or bank transfer payment the Money tab attributed to the same client card within ${MATCH_DAYS} days and ${Math.round(MATCH_GAP * 100)}% of the amount; a payment only logged by hand does not confirm it.${kickoffRead
                ? ` Since ${KICKOFF_READ_FROM}: ${kickoffRead.kickoffs.length} kickoff ${kickoffRead.kickoffs.length === 1 ? "form" : "forms"} with an amount, ${usd(kickoffRead.kickoffs.reduce((n, k) => n + k.amount, 0))} in all, ${usd(kickoffRead.kickoffs.reduce((n, k) => n + k.confirmed, 0))} of it confirmed on a rail${kickoffRead.blank.length ? `; ${kickoffRead.blank.length} ${kickoffRead.blank.length === 1 ? "form leaves" : "forms leave"} the amount blank (${kickoffRead.blank.map(b => b.client).slice(0, 4).join(", ")}), missing rather than zero` : ""}. Rail payments are the Money tab's last published attribution.`
                : ""}`,
        }, {
            level: "info",
            text: `Reps: booked and shown are calls on each person's GHL calendar by call day. A close goes to the closer named on the form.${repVoids > 0
                ? ` ${voidedDeals(repVoids)} this month ${repVoids === 1 ? "is" : "are"} taken off the closer ${repVoids === 1 ? "it names" : "they name"}, which the B2B dashboard still counts.`
                : ""} Top ads include retargeting spend and only leads tied to an ad.`,
        });
        const sources = FEEDS.map(f => {
            if (!feedRows)
                return { name: f.name, ok: true, note: "Sync time not read this run" };
            const r = feedRows.find(x => x.source === f.source);
            if (!r) {
                notes.push({
                    level: "warn",
                    text: `${f.name} has no sync run recorded.`,
                });
                return { name: f.name, ok: false, note: "No sync run recorded" };
            }
            const status = String(r.status);
            const ageMin = num(r.age_min);
            const healthy = HEALTHY.has(status);
            const ok = healthy && ageMin <= STALE_MIN;
            const newest = f.source === "meta"
                ? `last day with lead-gen spend ${r.last_spend_day ?? "none"}`
                : r.newest_ms
                    ? `newest row ${kuwaitDay(num(r.newest_ms))}`
                    : "no rows";
            if (!ok)
                notes.push({
                    level: "warn",
                    text: healthy
                        ? `${f.name} has not synced for ${ageMin} minutes.`
                        : `${f.name} sync last ended with status ${status}, ${ageMin} minutes ago.`,
                });
            return {
                name: f.name,
                freshestAt: num(r.synced_ms) || undefined,
                ok,
                note: status === "success" ? newest : `${status}, ${newest}`,
            };
        });
        if (ledger?.ready) {
            sources.push({
                name: "Front-end payments (deal ledger, cockpit_deal_payments)",
                freshestAt: ledger.attributedAt ?? undefined,
                ok: true,
                note: `${ledger.ledgerRows} front-end payments, ${usd(ledger.ledgerUsd)} since ${ledger.from}, as the Money section attributed them${ledger.agree ? ", the same count and sum the section published" : ""}`,
            });
            if (!ledger.agree)
                notes.push({
                    level: "warn",
                    text: `The deal ledger holds ${ledger.ledgerRows} front-end payments (${usd(ledger.ledgerUsd)}) since ${ledger.from}, but the Money section that wrote it counted ${ledger.sectionRows} (${usd(ledger.sectionUsd)}). Front-end cash reads the ledger; refresh Money and check the two agree.`,
                });
            if (ledger.attributedAt !== null && Date.now() - ledger.attributedAt > LEDGER_STALE_MS)
                notes.push({
                    level: "warn",
                    text: `Front-end cash is the money attributed at ${new Date(ledger.attributedAt + 3 * 3600_000).toISOString().slice(0, 16).replace("T", " ")} Kuwait, over 2 hours ago, so it may be behind. The Money refresh has not published since.`,
                });
            const out = [ledger.set.webinar.payments ? `${ledger.set.webinar.payments} on webinar deals (${usd(ledger.set.webinar.usd)})` : null, ledger.set.voided.payments ? `${ledger.set.voided.payments} on deals voided since (${usd(ledger.set.voided.usd)})` : null].filter(Boolean);
            if (out.length)
                notes.push({ level: "info", text: `Front-end cash leaves out ${out.join(" and ")} of the deal ledger's payments.` });
        }
        else if (ledger)
            notes.push({
                level: "warn",
                text: `Front-end cash is not read this run: ${ledger.why}. The typed deposit and kickoff are shown beside it, never in its place.`,
            });
        if (kickoffRead)
            sources.push({
                name: "Kickoff form cash (client onboarding, Typeform tG7dnxBn)",
                freshestAt: kickoffRead.syncedAt,
                ok: true,
                note: `${kickoffRead.kickoffs.length} kickoff amounts since ${KICKOFF_READ_FROM}, checked against ${kickoffRead.railPayments} Whop, Tap and transfer payments the Money tab attributed to a card`,
            });
        const meta = feedRows?.find(x => x.source === "meta");
        if (meta) {
            const lastSpend = meta.last_spend_day
                ? String(meta.last_spend_day)
                : null;
            if (num(meta.active_leadgen) === 0)
                notes.unshift({
                    level: "warn",
                    text: `No lead-gen campaign is active in Meta. The last day with lead-gen spend was ${lastSpend ?? "never"}.`,
                });
            else if (!lastSpend || lastSpend < addDays(today, -2))
                notes.unshift({
                    level: "warn",
                    text: `Lead-gen campaigns are active but there has been no lead-gen spend since ${lastSpend ?? "the start"}.`,
                });
        }
        // --- What the sales system is waiting on -----------------------------
        // Counts only. Every row these return carries a contact's name, email and
        // phone, and none of it comes into the payload: the CEO screens carry
        // client business names and team first names, never a lead's identity.
        const actionQueue = await attempt("The action queue", notes, undefined, async () => {
            // The queue lists every closed deal without an ad id as a signed deal
            // waiting to be matched, voided ones too; they are nobody's to fix.
            const rows = await sql(B2B, `select (public.b2b_action_queue(1)::jsonb) as q,
             (select count(*) from public.closed_deals d
               where d.ad_id is null and ${VOIDED("d")}) as voided_no_ad`);
            const q = (rows[0]?.q ?? {});
            const voidedNoAd = num(rows[0]?.voided_no_ad);
            let taken = 0;
            const buckets = (q.buckets ?? []).map(b => {
                const key = String(b.key ?? "");
                let count = num(b.count);
                if (key === "closes_no_ad") {
                    taken = Math.min(count, voidedNoAd);
                    count -= taken;
                }
                return {
                    key,
                    label: String(b.label ?? b.key ?? ""),
                    hint: String(b.hint ?? ""),
                    count,
                };
            });
            return { total: Math.max(0, num(q.total) - taken), buckets };
        });
        if (actionQueue && actionQueue.total > 0) {
            const worst = [...actionQueue.buckets].sort((a, b) => b.count - a.count)[0];
            notes.push({
                level: "warn",
                text: `${actionQueue.total.toLocaleString("en-US")} records are waiting on somebody${worst
                    ? `, ${worst.count.toLocaleString("en-US")} of them ${worst.label.toLowerCase()}. ${worst.hint}`
                    : "."} Every rate on this tab is computed over those records, so they are soft until the backlog is cleared.`,
            });
        }
        const stalled = await attempt("Stalled deals", notes, undefined, async () => {
            const rows = await sql(B2B, `select (public.b2b_stalled_deals(${day(addDays(today, -120))}, ${day(today)}, 14)::jsonb) as s`);
            const q = (rows[0]?.s ?? {});
            const byOwner = new Map();
            for (const r of (q.rows ?? [])) {
                const owner = String(r.owner ?? "unassigned");
                const o = byOwner.get(owner) ?? { deals: 0, value: 0 };
                o.deals += 1;
                o.value += num(r.deal_value);
                byOwner.set(owner, o);
            }
            return {
                staleDays: num(q.stale_days) || 14,
                total: num(q.total),
                stale: num(q.stale_total),
                buckets: (q.buckets ?? []).map(b => ({
                    age: String(b.age ?? ""),
                    deals: num(b.n),
                })),
                byOwner: [...byOwner.entries()]
                    .map(([owner, o]) => ({ owner, ...o }))
                    .sort((a, b) => b.deals - a.deals)
                    .slice(0, 8),
            };
        });
        if (stalled && stalled.stale > 0)
            notes.push({
                level: "warn",
                text: `${stalled.stale} of ${stalled.total} open deals have not been touched in ${stalled.staleDays} days${stalled.buckets.find(b => b.age === ">30d")
                    ? `, ${stalled.buckets.find(b => b.age === ">30d")?.deals} of them for over a month`
                    : ""}. Owner counts come from the deals the function returns, which is a capped sample, so read them as a shape rather than a total.`,
            });
        const WINNING_DAYS = 90;
        const winningAds = await attempt("The ad breakdown", notes, undefined, async () => {
            const rows = await sql(B2B, winningAdsSql(addDays(today, -WINNING_DAYS), today));
            const opt = (x) => x === null || x === undefined || x === "" ? null : num(x);
            return {
                windowDays: WINNING_DAYS,
                voided: rows.reduce((n, r) => n + num(r.v_sales), 0),
                rows: rows.map(r => ({
                    adId: String(r.ad_id),
                    name: String(r.name),
                    thumbnail: r.thumbnail ? String(r.thumbnail) : null,
                    status: r.status ? String(r.status) : null,
                    inMeta: String(r.in_meta) === "true",
                    spend: num(r.spend),
                    impressions: num(r.impressions),
                    clicks: num(r.clicks),
                    // Link clicks and link CTR (../linkCtr.js), never the
                    // dashboard's ctr, which is CTR (all) in percent.
                    ...marketingAdLink(r),
                    leads: num(r.leads),
                    cpl: opt(r.cpl),
                    qualified: num(r.qualified),
                    qualifiedPct: opt(r.qualified_pct),
                    demos: num(r.demos),
                    costPerDemo: opt(r.cost_per_demo),
                    sales: num(r.sales),
                    revenue: num(r.revenue),
                    cash: num(r.cash),
                    cpa: opt(r.cpa),
                    revRoas: opt(r.rev_roas),
                })),
            };
        });
        if (winningAds?.rows.length)
            notes.push({
                level: "info",
                text: `Ads are ranked by what they produced over ${WINNING_DAYS} days, closes first, then demos, then leads, because the biggest spender is rarely the winner.${winningAds.voided
                    ? ` ${voidedDeals(winningAds.voided)} tied to these ads ${winningAds.voided === 1 ? "is" : "are"} left out of their sales, revenue and cash, though the B2B dashboard still counts ${winningAds.voided === 1 ? "it" : "them"}.`
                    : ""} An ad Meta no longer has a snapshot for still appears when leads or demos are attributed to it, with its spend shown as unknown rather than zero. Thumbnails come from Facebook on an expiring link, so one that stops loading is not a fault in the data.`,
            });
        const pacing = await attempt("Pacing", notes, undefined, async () => {
            // b2b_pacing_pipeline's close rate (every deal ever over every
            // qualified demo ever) and average deal (90 days) count voided deals,
            // so both are worked out again with its formulas (read 2026-09-27)
            // whenever a voided deal is in their reach.
            const rows = await sql(B2B, `select (public.b2b_pacing_pipeline(${day(monthStart(today))}, ${day(today)})::jsonb) as p,
             (select count(*) from public.closed_deals d where ${VOIDED("d")}) as voided_all,
             (select count(*) from public.closed_deals d
               where d.contracted_revenue is not null
                 and (d.submitted_at at time zone 'Asia/Riyadh')::date > (now() at time zone 'Asia/Riyadh')::date - 90
                 and ${VOIDED("d")}) as voided_90,
             round(100.0 * (select count(*) from public.closed_deals d where ${NOT_VOIDED("d")})
               / nullif((select count(*) from public.calls
                   where call_type = 'demo'
                     and (status = 'showed' or (status = 'confirmed' and start_at <= now()))), 0), 1) as close_rate,
             (select round(avg(d.contracted_revenue)) from public.closed_deals d
               where d.contracted_revenue is not null
                 and (d.submitted_at at time zone 'Asia/Riyadh')::date > (now() at time zone 'Asia/Riyadh')::date - 90
                 and ${NOT_VOIDED("d")}) as avg_deal_value`);
            const r = rows[0] ?? {};
            const q = (r.p ?? {});
            const n = (x) => x === null || x === undefined ? null : num(x);
            return {
                openDemosLeft: n(q.open_demos_left),
                closeRate: num(r.voided_all) > 0 ? n(r.close_rate) : n(q.close_rate),
                avgDealValue: num(r.voided_90) > 0 ? n(r.avg_deal_value) : n(q.avg_deal_value),
            };
        });
        const payload = {
            windows,
            daily,
            reps,
            topAds,
            leadSources,
            ...(actionQueue ? { actionQueue } : {}),
            ...(stalled ? { stalled } : {}),
            ...(pacing ? { pacing } : {}),
            ...(winningAds ? { winningAds } : {}),
            notes,
        };
        // Call statuses are overwritten in place at the source, so keep today's
        // month-to-date show rate and past demos still marked confirmed here to
        // see how they settle.
        const points = [];
        const keep = (metric, value) => {
            if (value !== null)
                points.push({ date: today, metric, scope: "company", value });
        };
        keep("growth.demoShowRate.mtd", mtd.demoShowRate);
        // The key keeps its old name so the history stays one continuous series.
        keep("growth.demosUnmarked.mtd", mtd.demosStillConfirmed);
        return { payload, daily: points, sources };
    },
};
