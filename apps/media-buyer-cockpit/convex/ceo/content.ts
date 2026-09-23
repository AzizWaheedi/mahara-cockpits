import { B2B, num, sql } from "./sb";

/**
 * What the content brings in, as against what the ads bring in.
 *
 * Aziz, 2026-09-22: "for the content space, I should be able to see how many
 * leads our content has gotten, specifically from organic content and from
 * each platform. And closed deals and revenue as well, the same way the
 * marketing paid ads is."
 *
 * Three things had to be settled before a number here could be honest.
 *
 * 1. Paid is wider than an ad id. A contact counts as paid when it carries an
 *    ad id, OR when GoHighLevel's attribution carries a Meta ad id, OR when
 *    the source text says "ads" ("instagram ads", "facebook ads", "youtube
 *    ads"). That last one matters: 65 contacts a year say "facebook ads" in
 *    their source and carry no ad id, and calling them organic Facebook would
 *    have credited the content with the ads' work.
 *
 * 2. An attribution id is not always an ad id. GoHighLevel puts the form,
 *    survey or calendar id in the same `mediumId` field it puts a Meta ad id
 *    in. Only a run of ten or more digits is an ad; a twenty-character
 *    alphanumeric is a form. Reading any non-empty value as an ad marked 206
 *    form fills and 16 calendar bookings a year as paid traffic.
 *
 * 3. The cockpit's lead definition is a setter's ROAS tag, and organic
 *    contacts almost never get one, because the ROAS form is a step in the
 *    paid funnel. So this screen counts contacts and the calls they booked,
 *    not leads: in the year to 2026-09-22 the content brought 396 WhatsApp
 *    contacts who booked 40 calls and showed at 38 demos, and not one of them
 *    is a "lead" anywhere else in the cockpit.
 *
 * Revenue is the one number the CRM cannot attribute: 18 of 50 signed deals
 * carry no contact at all, and every deal that does carry one traces back to
 * a paid ad. So deals and revenue here are read from the closer's own answer
 * on the closing form, which is the only place a non-paid origin is ever
 * named, and the screen says that is what it is.
 */

export type ContentPlatform = {
  platform: string;
  /** Contacts that arrived with no evidence of a paid ad. */
  contacts: number;
  /** Of those, the ones a setter tagged, which is what the rest of the cockpit calls a lead. */
  leads: number;
  booked: number;
  demosShown: number;
  /** Signed deals traced to one of these contacts by contact id. */
  closes: number;
  contracted: number;
  cash: number;
  /** Posts published to this platform in the window, from the asset library. */
  posts: number | null;
  newestPost: string | null;
};

export type ContentDealSource = {
  source: string;
  deals: number;
  contracted: number;
  cash: number;
  withAd: number;
  paid: boolean;
};

export type ContentWindow = {
  from: string;
  to: string;
  totals: {
    contacts: number;
    leads: number;
    paidLeads: number;
    organicLeads: number;
    reactivationLeads: number;
    unnamedLeads: number;
  };
  platforms: ContentPlatform[];
  deals: ContentDealSource[];
  /** Every deal signed in the window, whatever it came from. */
  dealsAll: { deals: number; contracted: number; cash: number };
  /** The deals whose closer did not say "ads". */
  dealsOrganic: { deals: number; contracted: number; cash: number };
};

function day(d: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new Error(`content: bad day ${d}`);
  return `date '${d}'`;
}

const usd = (x: number) => Math.round(x * 100) / 100;

/** A closer who wrote "Meta ads" or "TikTok ads" named a paid source. */
function sourceIsPaid(source: string): boolean {
  return /\bads?\b/i.test(source);
}

function windowSql(from: string, to: string): string {
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
    count(*) filter (where exists (select 1 from public.closed_deals d where d.contact_id = t.contact_id)) as closes,
    coalesce(sum((select coalesce(sum(d.contracted_revenue),0) from public.closed_deals d where d.contact_id = t.contact_id)),0) as contracted,
    coalesce(sum((select coalesce(sum(d.cash_collected),0)     from public.closed_deals d where d.contact_id = t.contact_id)),0) as cash
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
  select coalesce(nullif(btrim(lead_source),''),'Not answered') as source,
    count(*) as deals,
    coalesce(sum(contracted_revenue),0) as contracted,
    coalesce(sum(cash_collected),0) as cash,
    count(*) filter (where ad_id is not null) as with_ad
  from public.closed_deals
  where (submitted_at at time zone 'Asia/Riyadh')::date between ${f} and ${t}
  group by 1
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
  (select jsonb_agg(to_jsonb(q)) from posts q)                             as posts`;
}

// biome-ignore lint/suspicious/noExplicitAny: jsonb rows are untyped
type Any = Record<string, any>;

export async function contentWindow(
  from: string,
  to: string,
): Promise<ContentWindow> {
  const rows = await sql(B2B, windowSql(from, to));
  const r = (rows[0] ?? {}) as Any;
  const postRows: Any[] = Array.isArray(r.posts) ? r.posts : [];
  const posts = new Map(postRows.map(p => [String(p.platform), p]));

  const platforms: ContentPlatform[] = (
    Array.isArray(r.platforms) ? r.platforms : []
  ).map((p: Any) => {
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
  platforms.sort(
    (a, b) => b.contacts - a.contacts || (b.posts ?? 0) - (a.posts ?? 0),
  );

  const deals: ContentDealSource[] = (
    Array.isArray(r.deals) ? r.deals : []
  ).map((d: Any) => ({
    source: String(d.source),
    deals: num(d.deals),
    contracted: usd(num(d.contracted)),
    cash: usd(num(d.cash)),
    withAd: num(d.with_ad),
    paid: sourceIsPaid(String(d.source)),
  }));
  const add = (list: ContentDealSource[]) => ({
    deals: list.reduce((n, d) => n + d.deals, 0),
    contracted: usd(list.reduce((n, d) => n + d.contracted, 0)),
    cash: usd(list.reduce((n, d) => n + d.cash, 0)),
  });

  const t = (r.totals ?? {}) as Any;
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
    dealsOrganic: add(
      deals.filter(d => !d.paid && d.source !== "Not answered"),
    ),
  };
}
