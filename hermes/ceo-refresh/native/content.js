import { B2B, num, sql } from "./sb.js";
import { NOT_VOIDED, VOIDED } from "./voids.js";
function day(d) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d))
        throw new Error(`content: bad day ${d}`);
    return `date '${d}'`;
}
const usd = (x) => Math.round(x * 100) / 100;
/** A closer who wrote "Meta ads" or "TikTok ads" named a paid source. */
function sourceIsPaid(source) {
    return /\bads?\b/i.test(source);
}
function windowSql(from, to) {
    const f = day(from);
    const t = day(to);
    return `with base as (
  select l.*,
    coalesce(l.raw_contact->'attributionSource'->>'medium','')       as m,
    coalesce(l.raw_contact->'attributionSource'->>'mediumId',
             l.raw_contact->'lastAttributionSource'->>'mediumId','') as mid,
    coalesce(l.raw_contact->'attributionSource'->>'sessionSource','') as ss,
    concat_ws(' ',
      l.raw_contact->'attributionSource'->>'referrer',
      l.raw_contact->'attributionSource'->>'utmSource',
      l.source,
      array_to_string(coalesce(l.tags,'{}'::text[]),' '))            as blob
  from public.leads l
  where (l.lead_created_at at time zone 'Asia/Riyadh')::date between ${f} and ${t}
),
tagged as (
  select b.*,
    ('roas-qualified' = any(coalesce(b.tags,'{}'::text[])) or 'roas-unqualified' = any(coalesce(b.tags,'{}'::text[]))) as roas_lead,
    (b.ad_id is not null or b.mid ~ '^[0-9]{10,}$' or b.blob ~* '\\mads?\\M') as paid,
    case
      when b.blob ~* 'reactivation'                     then 'Reactivation'
      when b.m ~* 'whatsapp' or b.blob ~* 'whatsapp'     then 'WhatsApp'
      when b.m ~* 'instagram' or b.blob ~* 'instagram'   then 'Instagram'
      when b.m ~* 'youtube'  or b.blob ~* 'youtu'        then 'YouTube'
      when b.m ~* 'tiktok'   or b.blob ~* 'tiktok'       then 'TikTok'
      when b.m ~* 'linkedin' or b.blob ~* 'linkedin'     then 'LinkedIn'
      when b.m ~* 'snapchat' or b.blob ~* 'snapchat'     then 'Snapchat'
      when b.blob ~* 'twitter|//x\\.com'                 then 'X'
      when b.m ~* 'facebook' or b.blob ~* 'facebook'     then 'Facebook'
      when b.ss = 'Organic Search' or b.blob ~* 'google\\.|bing\\.' then 'Search'
      when b.ss = 'Referral' or b.blob ~* 'referr'       then 'Referral'
      when b.ss = 'CRM UI' or b.m = 'manual'             then 'Added by hand'
      else 'Not named'
    end as platform
  from base b
),
per as (
  select platform,
    count(*)                        as contacts,
    count(*) filter (where roas_lead) as leads,
    count(*) filter (where exists (select 1 from public.calls c where c.contact_id = t.contact_id and c.call_type in ('intro','demo'))) as booked,
    count(*) filter (where exists (select 1 from public.calls c where c.contact_id = t.contact_id and c.call_type = 'demo' and (c.status='showed' or (c.status in ('confirmed','invalid') and c.start_at <= now())))) as demos_shown,
    count(*) filter (where exists (select 1 from public.closed_deals d where d.contact_id = t.contact_id and ${NOT_VOIDED("d")})) as closes,
    coalesce(sum((select coalesce(sum(d.contracted_revenue),0) from public.closed_deals d where d.contact_id = t.contact_id and ${NOT_VOIDED("d")})),0) as contracted,
    coalesce(sum((select coalesce(sum(d.cash_collected),0)     from public.closed_deals d where d.contact_id = t.contact_id and ${NOT_VOIDED("d")})),0) as cash
  from tagged t where not paid group by 1
),
totals as (
  select count(*) as contacts,
    count(*) filter (where roas_lead) as leads,
    count(*) filter (where roas_lead and paid) as paid_leads,
    count(*) filter (where roas_lead and not paid and platform not in ('Not named','Reactivation')) as organic_leads,
    count(*) filter (where roas_lead and not paid and platform = 'Reactivation') as reactivation_leads,
    count(*) filter (where roas_lead and not paid and platform = 'Not named') as unnamed_leads
  from tagged
),
deals as (
  select coalesce(nullif(btrim(d.lead_source),''),'Not answered') as source,
    count(*) as deals,
    coalesce(sum(d.contracted_revenue),0) as contracted,
    coalesce(sum(d.cash_collected),0) as cash,
    count(*) filter (where d.ad_id is not null) as with_ad
  from public.closed_deals d
  where (d.submitted_at at time zone 'Asia/Riyadh')::date between ${f} and ${t}
    and ${NOT_VOIDED("d")}
  group by 1
),
voided as (
  select count(*) as deals,
    coalesce(sum(d.contracted_revenue),0) as contracted,
    coalesce(sum(d.cash_collected),0) as cash
  from public.closed_deals d
  where (d.submitted_at at time zone 'Asia/Riyadh')::date between ${f} and ${t}
    and ${VOIDED("d")}
),
posts as (
  select case when asset_type = 'reel' then 'Instagram' else 'YouTube' end as platform,
    count(*) as posts, to_char(max(published_at), 'YYYY-MM-DD') as newest
  from public.assets
  where asset_type in ('youtube_video','reel')
    and published_at::date between ${f} and ${t}
  group by 1
)
select
  (select jsonb_agg(to_jsonb(p) order by p.contacts desc) from per p)      as platforms,
  (select jsonb_agg(to_jsonb(d) order by d.contracted desc) from deals d)  as deals,
  (select to_jsonb(x) from totals x)                                       as totals,
  (select jsonb_agg(to_jsonb(q)) from posts q)                             as posts,
  (select to_jsonb(v) from voided v)                                       as voided`;
}
export async function contentWindow(from, to) {
    const rows = await sql(B2B, windowSql(from, to));
    const r = (rows[0] ?? {});
    const postRows = Array.isArray(r.posts) ? r.posts : [];
    const posts = new Map(postRows.map(p => [String(p.platform), p]));
    const platforms = (Array.isArray(r.platforms) ? r.platforms : []).map((p) => {
        const name = String(p.platform);
        const post = posts.get(name);
        return {
            platform: name,
            contacts: num(p.contacts),
            leads: num(p.leads),
            booked: num(p.booked),
            demosShown: num(p.demos_shown),
            closes: num(p.closes),
            contracted: usd(num(p.contracted)),
            cash: usd(num(p.cash)),
            posts: post ? num(post.posts) : null,
            newestPost: post?.newest ? String(post.newest) : null,
        };
    });
    // A platform we published to but heard nothing from is still the truth
    // about that platform, and a missing row would read as "not tried".
    for (const [name, post] of posts)
        if (!platforms.some(p => p.platform === name))
            platforms.push({
                platform: name,
                contacts: 0,
                leads: 0,
                booked: 0,
                demosShown: 0,
                closes: 0,
                contracted: 0,
                cash: 0,
                posts: num(post.posts),
                newestPost: post?.newest ? String(post.newest) : null,
            });
    platforms.sort((a, b) => b.contacts - a.contacts || (b.posts ?? 0) - (a.posts ?? 0));
    const deals = (Array.isArray(r.deals) ? r.deals : []).map((d) => ({
        source: String(d.source),
        deals: num(d.deals),
        contracted: usd(num(d.contracted)),
        cash: usd(num(d.cash)),
        withAd: num(d.with_ad),
        paid: sourceIsPaid(String(d.source)),
    }));
    const add = (list) => ({
        deals: list.reduce((n, d) => n + d.deals, 0),
        contracted: usd(list.reduce((n, d) => n + d.contracted, 0)),
        cash: usd(list.reduce((n, d) => n + d.cash, 0)),
    });
    const t = (r.totals ?? {});
    const v = (r.voided ?? {});
    return {
        from,
        to,
        totals: {
            contacts: num(t.contacts),
            leads: num(t.leads),
            paidLeads: num(t.paid_leads),
            organicLeads: num(t.organic_leads),
            reactivationLeads: num(t.reactivation_leads),
            unnamedLeads: num(t.unnamed_leads),
        },
        platforms,
        deals,
        dealsAll: add(deals),
        dealsOrganic: add(deals.filter(d => !d.paid && d.source !== "Not answered")),
        voided: {
            deals: num(v.deals),
            contracted: usd(num(v.contracted)),
            cash: usd(num(v.cash)),
        },
    };
}
