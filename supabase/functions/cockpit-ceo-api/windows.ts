import { CPL_GATE } from '../../../apps/media-buyer-cockpit/src/lib/kpi.ts';
import { B2B } from './finance/sb.ts';
import { num } from './finance/numbers.ts';
import { NOT_VOIDED, VOIDED, voidedDeals } from './finance/voids.ts';

type Row = Record<string, unknown>;
type SqlRead = (project: string, query: string) => Promise<Row[]>;
type GraphRead = (path: string, params?: Record<string, string | number>) => Promise<Row>;
type WindowSources = { readSql: SqlRead; readMeta: GraphRead };
const ACCOUNT = '746108264865897';
const EARLIEST = '2025-01-01';
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const ACCOUNT_STATUS: Record<number, string> = {
  1: 'active', 2: 'disabled', 3: 'unsettled', 7: 'pending risk review', 8: 'pending settlement',
  9: 'in grace period', 100: 'pending closure', 101: 'closed', 201: 'any active', 202: 'any closed',
};
const DISABLE_REASON: Record<number, string> = {
  1: 'ads integrity policy', 2: 'ads IP review', 3: 'risk payment', 4: 'gray account shut down',
  5: 'ads AFC review', 6: 'business integrity RAR', 7: 'permanent close', 8: 'unused reseller account',
  9: 'unused account', 10: 'umbrella ad account', 11: 'business manager integrity policy',
  12: 'misrepresented ad account', 13: 'AOAB desmotivate unused account', 14: 'CTA review',
  15: 'AWS account review', 16: 'AB review',
};
// Link clicks are kept out of COUNTS: a day Meta sent without them makes them
// not known (null), and the sums and rates over them have to carry that.
const COUNTS = [
  'impressions', 'clicks', 'metaLeads', 'leads', 'qualifiedLeads', 'notReadyLeads',
  'introsBooked', 'introsDue', 'introsShown', 'introsQualified', 'introsCancelled', 'introsAdvanced',
  'demosBooked', 'demosDue', 'demosShown', 'demosQualified', 'demosCancelled', 'closes',
] as const;
type CountKey = (typeof COUNTS)[number];
const COLUMN: Record<CountKey, string> = {
  impressions: 'impressions', clicks: 'clicks', metaLeads: 'meta_leads',
  leads: 'leads', qualifiedLeads: 'qualified_leads', notReadyLeads: 'not_ready_leads',
  introsBooked: 'intros_booked', introsDue: 'intros_due', introsShown: 'intros_shown',
  introsQualified: 'intros_qualified', introsCancelled: 'intros_cancelled', introsAdvanced: 'intros_advanced',
  demosBooked: 'demos_booked', demosDue: 'demos_due', demosShown: 'demos_shown',
  demosQualified: 'demos_qualified', demosCancelled: 'demos_cancelled', closes: 'closes',
};

export type B2bAdWindow = {
  /** `linkClicks` is null when Meta sent a delivered day without a link-click count: not known, never 0. */
  spend: number; impressions: number; clicks: number; linkClicks: number | null; metaLeads: number; leads: number;
  qualifiedLeads: number; notReadyLeads: number; introsBooked: number; introsDue: number; introsShown: number;
  introsQualified: number; introsCancelled: number; introsAdvanced: number; demosBooked: number; demosDue: number;
  demosShown: number; demosQualified: number; demosCancelled: number; closes: number; contracted: number; cash: number;
  /** `ctr` is CTR (all), every click, never shown. `ctrLink` is the Link CTR the screen shows (the CEO, 2026-10-08). */
  frequency: number | null; cpm: number | null; ctr: number | null; ctrLink: number | null; cpc: number | null;
  cpl: number | null; qualifiedPct: number | null; costPerQualified: number | null; bookRate: number | null;
  costPerIntroBooked: number | null; introShowRate: number | null; costPerIntroShown: number | null;
  introToDemo: number | null; demoShowRate: number | null; costPerDemoBooked: number | null; costPerDemo: number | null;
  closeRate: number | null; closeRateQualified: number | null; cac: number | null; roas: number | null;
  cashRoas: number | null; leadToDemo: number | null;
};
export type B2bPeople = { setter: { name: string; shown: number; due: number } | null; closer: { name: string; closes: number } | null };
export type B2bVerdict = {
  verdict: 'off' | 'no delivery' | 'kill' | 'hold' | 'scale' | 'fatiguing' | 'leads do not book' | 'intros do not convert' | 'demos do not close';
  reason: string;
  owner: 'ads' | 'setter' | 'closer' | null;
};
export type B2bAdNode = {
  id: string; name: string; status: string; running: boolean; thumbnail: string | null;
  w7: B2bAdWindow; w30: B2bAdWindow; verdict: B2bVerdict; people: B2bPeople;
};
export type B2bAdsPayload = {
  accountId: string;
  windows: { from7: string; from30: string; to: string };
  account: { w7: B2bAdWindow; w30: B2bAdWindow };
  retargetingSpend: { w7: number; w30: number };
  coverage: { w7: CoverageWindow; w30: CoverageWindow };
  running: number; total: number; verdicts: Record<string, number>;
  campaigns: {
    id: string; name: string; type: string; status: string; running: boolean; w7: B2bAdWindow; w30: B2bAdWindow;
    people: B2bPeople;
    constraint: { stage: string; owner: 'ads' | 'landing' | 'setter' | 'closer'; mine: number; account: number } | null;
    adsets: { id: string; name: string; running: boolean; w7: B2bAdWindow; w30: B2bAdWindow; people: B2bPeople; ads: B2bAdNode[] }[];
  }[];
  lastSnapshotDay: string | null; firstSnapshotDay: string | null;
  accountStatus: { code: number; label: string; disableReason: string | null; balance: number | null; currency: string | null } | null;
  notes: { level: 'info' | 'warn'; text: string }[];
};
type CoverageWindow = { leads: number; adLeads: number; closes: number; adCloses: number; contracted: number; adContracted: number };

function dateLiteral(day: string): string {
  const timestamp = DAY.test(day) ? Date.parse(`${day}T00:00:00.000Z`) : NaN;
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== day) {
    throw new Error(`CEO window contains an invalid day: ${day}`);
  }
  return `date '${day}'`;
}

function checkWindow(from: string, to: string): void {
  dateLiteral(from);
  dateLiteral(to);
  if (from > to) throw new Error('The first date has to come before the last.');
  if (from < EARLIEST) throw new Error(`There is nothing recorded before ${EARLIEST}.`);
  const days = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
  if (days > 730) throw new Error('Two years is the longest window this can read at once.');
}

function requiredNumber(value: unknown, field: string): number {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  if (!Number.isFinite(parsed)) throw new Error(`B2B source did not confirm ${field}.`);
  return num(parsed);
}

function roundUsd(value: number): number {
  return Math.round(value * 100) / 100;
}

function optionalNumber(value: unknown, field: string): number | null {
  return value === null || value === undefined ? null : requiredNumber(value, field);
}

function text(value: unknown, field: string, fallback?: string): string {
  if (typeof value === 'string' && value.trim()) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (fallback !== undefined) return fallback;
  throw new Error(`B2B source did not confirm ${field}.`);
}

function record(value: unknown, field: string): Row {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`B2B source returned an invalid ${field}.`);
  return value as Row;
}

function sqlRow(rows: Row[], field: string): Row {
  if (rows.length !== 1) throw new Error(`B2B source did not confirm ${field}.`);
  return record(rows[0], field);
}

// A count that is not known (null link clicks) gives no rate and no cost, never 0.
const ratio = (numerator: number | null, denominator: number | null): number | null => numerator !== null && denominator !== null && denominator > 0 ? Math.round((numerator / denominator) * 10_000) / 10_000 : null;
const per = (numerator: number, denominator: number | null): number | null => denominator !== null && denominator > 0 ? roundUsd(numerator / denominator) : null;
const rate = (numerator: number | null, denominator: number | null): number | null => numerator !== null && denominator !== null && denominator > 0 ? numerator / denominator : null;

function finish(window: B2bAdWindow): B2bAdWindow {
  window.cpm = window.impressions > 0 ? roundUsd((window.spend / window.impressions) * 1000) : null;
  // CTR (all), kept in the payload and never shown; Link CTR is what the Ads tab shows.
  window.ctr = ratio(window.clicks, window.impressions);
  window.ctrLink = ratio(window.linkClicks, window.impressions);
  window.cpc = per(window.spend, window.linkClicks);
  window.cpl = per(window.spend, window.leads);
  window.qualifiedPct = ratio(window.qualifiedLeads, window.leads);
  window.costPerQualified = per(window.spend, window.qualifiedLeads);
  window.bookRate = ratio(window.introsBooked, window.leads);
  window.costPerIntroBooked = per(window.spend, window.introsBooked);
  window.introShowRate = ratio(window.introsShown, window.introsDue);
  window.costPerIntroShown = per(window.spend, window.introsShown);
  window.introToDemo = ratio(window.introsAdvanced, window.introsShown);
  window.demoShowRate = ratio(window.demosShown, window.demosDue);
  window.costPerDemoBooked = per(window.spend, window.demosBooked);
  window.costPerDemo = per(window.spend, window.demosShown);
  window.closeRate = ratio(window.closes, window.demosShown);
  window.closeRateQualified = ratio(window.closes, window.demosQualified);
  window.cac = per(window.spend, window.closes);
  window.roas = window.spend > 0 ? Math.round((window.contracted / window.spend) * 100) / 100 : null;
  window.cashRoas = window.spend > 0 ? Math.round((window.cash / window.spend) * 100) / 100 : null;
  window.leadToDemo = ratio(window.demosBooked, window.leads);
  return window;
}

function emptyWindow(): B2bAdWindow {
  const window = {
    spend: 0, impressions: 0, clicks: 0, linkClicks: 0, metaLeads: 0, leads: 0, qualifiedLeads: 0, notReadyLeads: 0,
    introsBooked: 0, introsDue: 0, introsShown: 0, introsQualified: 0, introsCancelled: 0, introsAdvanced: 0,
    demosBooked: 0, demosDue: 0, demosShown: 0, demosQualified: 0, demosCancelled: 0, closes: 0, contracted: 0, cash: 0,
    frequency: null, cpm: null, ctr: null, ctrLink: null, cpc: null, cpl: null, qualifiedPct: null, costPerQualified: null,
    bookRate: null, costPerIntroBooked: null, introShowRate: null, costPerIntroShown: null, introToDemo: null,
    demoShowRate: null, costPerDemoBooked: null, costPerDemo: null, closeRate: null, closeRateQualified: null,
    cac: null, roas: null, cashRoas: null, leadToDemo: null,
  } satisfies B2bAdWindow;
  return finish(window);
}

function windowOf(row: Row, prefix: 'w7' | 'w30'): B2bAdWindow {
  const get = (field: string) => requiredNumber(row[`${prefix}_${field}`], `${prefix} ${field}`);
  const frequency = optionalNumber(row[`${prefix}_freq`], `${prefix} frequency`);
  const window = {
    spend: roundUsd(get('spend')),
    impressions: get('impressions'), clicks: get('clicks'),
    linkClicks: optionalNumber(row[`${prefix}_link_clicks`], `${prefix} link clicks`), metaLeads: get('meta_leads'),
    leads: get('leads'), qualifiedLeads: get('qualified_leads'), notReadyLeads: get('not_ready_leads'),
    introsBooked: get('intros_booked'), introsDue: get('intros_due'), introsShown: get('intros_shown'),
    introsQualified: get('intros_qualified'), introsCancelled: get('intros_cancelled'), introsAdvanced: get('intros_advanced'),
    demosBooked: get('demos_booked'), demosDue: get('demos_due'), demosShown: get('demos_shown'),
    demosQualified: get('demos_qualified'), demosCancelled: get('demos_cancelled'), closes: get('closes'),
    contracted: roundUsd(get('contracted')), cash: roundUsd(get('cash')),
    frequency: frequency === null ? null : Math.round(frequency * 100) / 100,
    cpm: null, ctr: null, ctrLink: null, cpc: null, cpl: null, qualifiedPct: null, costPerQualified: null,
    bookRate: null, costPerIntroBooked: null, introShowRate: null, costPerIntroShown: null, introToDemo: null,
    demoShowRate: null, costPerDemoBooked: null, costPerDemo: null, closeRate: null, closeRateQualified: null,
    cac: null, roas: null, cashRoas: null, leadToDemo: null,
  } satisfies B2bAdWindow;
  return finish(window);
}

function addWindow(target: B2bAdWindow, source: B2bAdWindow): void {
  target.spend = roundUsd(target.spend + source.spend);
  target.contracted = roundUsd(target.contracted + source.contracted);
  target.cash = roundUsd(target.cash + source.cash);
  for (const key of COUNTS) target[key] += source[key];
  target.linkClicks = target.linkClicks === null || source.linkClicks === null ? null : target.linkClicks + source.linkClicks;
  if (source.frequency !== null) target.frequency = target.frequency === null ? source.frequency : Math.max(target.frequency, source.frequency);
}

function treeSql(from7: string, from30: string, to: string): string {
  const funnel = (from: string, alias: 'w7' | 'w30') => `
  ${alias}_ads as (
    select campaign_id, adset_id, ad_id,
           sum(spend) as spend, sum(impressions) as impressions,
           sum(clicks) as clicks,
           case when bool_and(inline_link_clicks is not null) then sum(inline_link_clicks) end as link_clicks, sum(leads) as meta_leads,
           max(frequency) as freq
    from public.meta_ad_snapshots
    where date between ${dateLiteral(from)} and ${dateLiteral(to)}
    group by 1,2,3),
  ${alias}_leads as (
    select l.ad_id,
      count(*) filter (where ('roas-qualified' = any(coalesce(l.tags, '{}'::text[])) or 'roas-unqualified' = any(coalesce(l.tags, '{}'::text[])))) as leads,
      count(*) filter (where 'roas-qualified' = any(coalesce(l.tags, '{}'::text[]))) as qualified_leads,
      count(*) filter (where 'roas-qualified' <> all(coalesce(l.tags, '{}'::text[])) and 'roas-unqualified' <> all(coalesce(l.tags, '{}'::text[])) and 'roas-unprepared' = any(coalesce(l.tags, '{}'::text[]))) as not_ready_leads
    from public.leads l
    where l.ad_id is not null
      and (l.lead_created_at at time zone 'Asia/Riyadh')::date between ${dateLiteral(from)} and ${dateLiteral(to)}
    group by 1),
  ${alias}_calls as (
    select c.ad_id,
      count(*) filter (where c.call_type='intro' and (c.booked_at at time zone 'Asia/Riyadh')::date between ${dateLiteral(from)} and ${dateLiteral(to)}) as intros_booked,
      count(*) filter (where c.call_type='intro' and (c.start_at at time zone 'Asia/Riyadh')::date between ${dateLiteral(from)} and ${dateLiteral(to)} and c.start_at <= now()) as intros_due,
      count(*) filter (where c.call_type='intro' and (c.start_at at time zone 'Asia/Riyadh')::date between ${dateLiteral(from)} and ${dateLiteral(to)} and (c.status='showed' or (c.status in ('confirmed','invalid') and c.start_at <= now()))) as intros_shown,
      count(*) filter (where c.call_type='intro' and (c.start_at at time zone 'Asia/Riyadh')::date between ${dateLiteral(from)} and ${dateLiteral(to)} and (c.status='showed' or (c.status='confirmed' and c.start_at <= now()))) as intros_qualified,
      count(*) filter (where c.call_type='intro' and (c.start_at at time zone 'Asia/Riyadh')::date between ${dateLiteral(from)} and ${dateLiteral(to)} and c.status='cancelled') as intros_cancelled,
      count(*) filter (where c.call_type='intro' and (c.start_at at time zone 'Asia/Riyadh')::date between ${dateLiteral(from)} and ${dateLiteral(to)} and (c.status='showed' or (c.status in ('confirmed','invalid') and c.start_at <= now()))
        and exists (select 1 from public.calls d where d.contact_id = c.contact_id and d.call_type='demo' and d.booked_at >= c.start_at)) as intros_advanced,
      count(*) filter (where c.call_type='demo' and (c.booked_at at time zone 'Asia/Riyadh')::date between ${dateLiteral(from)} and ${dateLiteral(to)}) as demos_booked,
      count(*) filter (where c.call_type='demo' and (c.start_at at time zone 'Asia/Riyadh')::date between ${dateLiteral(from)} and ${dateLiteral(to)} and c.start_at <= now()) as demos_due,
      count(*) filter (where c.call_type='demo' and (c.start_at at time zone 'Asia/Riyadh')::date between ${dateLiteral(from)} and ${dateLiteral(to)} and (c.status='showed' or (c.status in ('confirmed','invalid') and c.start_at <= now()))) as demos_shown,
      count(*) filter (where c.call_type='demo' and (c.start_at at time zone 'Asia/Riyadh')::date between ${dateLiteral(from)} and ${dateLiteral(to)} and (c.status='showed' or (c.status='confirmed' and c.start_at <= now()))) as demos_qualified,
      count(*) filter (where c.call_type='demo' and (c.start_at at time zone 'Asia/Riyadh')::date between ${dateLiteral(from)} and ${dateLiteral(to)} and c.status='cancelled') as demos_cancelled
    from public.calls c
    where c.ad_id is not null
      and ((c.booked_at at time zone 'Asia/Riyadh')::date between ${dateLiteral(from)} and ${dateLiteral(to)}
        or (c.start_at at time zone 'Asia/Riyadh')::date between ${dateLiteral(from)} and ${dateLiteral(to)})
    group by 1),
  ${alias}_deals as (
    select d.ad_id, count(*) as closes,
           coalesce(sum(d.contracted_revenue),0) as contracted,
           coalesce(sum(d.cash_collected),0) as cash
    from public.closed_deals d
    where d.ad_id is not null
      and (d.submitted_at at time zone 'Asia/Riyadh')::date between ${dateLiteral(from)} and ${dateLiteral(to)}
      and ${NOT_VOIDED('d')}
    group by 1)`;
  const columns = (prefix: 'w7' | 'w30') => `
    coalesce(${prefix}_ads.spend,0) as ${prefix}_spend,
    coalesce(${prefix}_ads.impressions,0) as ${prefix}_impressions,
    coalesce(${prefix}_ads.clicks,0) as ${prefix}_clicks,
    case when ${prefix}_ads.ad_id is null then 0 else ${prefix}_ads.link_clicks end as ${prefix}_link_clicks,
    coalesce(${prefix}_ads.meta_leads,0) as ${prefix}_meta_leads,
    ${prefix}_ads.freq as ${prefix}_freq,
    coalesce(${prefix}_leads.leads,0) as ${prefix}_leads,
    coalesce(${prefix}_leads.qualified_leads,0) as ${prefix}_qualified_leads,
    coalesce(${prefix}_leads.not_ready_leads,0) as ${prefix}_not_ready_leads,
    coalesce(${prefix}_calls.intros_booked,0) as ${prefix}_intros_booked,
    coalesce(${prefix}_calls.intros_due,0) as ${prefix}_intros_due,
    coalesce(${prefix}_calls.intros_shown,0) as ${prefix}_intros_shown,
    coalesce(${prefix}_calls.intros_qualified,0) as ${prefix}_intros_qualified,
    coalesce(${prefix}_calls.intros_cancelled,0) as ${prefix}_intros_cancelled,
    coalesce(${prefix}_calls.intros_advanced,0) as ${prefix}_intros_advanced,
    coalesce(${prefix}_calls.demos_booked,0) as ${prefix}_demos_booked,
    coalesce(${prefix}_calls.demos_due,0) as ${prefix}_demos_due,
    coalesce(${prefix}_calls.demos_shown,0) as ${prefix}_demos_shown,
    coalesce(${prefix}_calls.demos_qualified,0) as ${prefix}_demos_qualified,
    coalesce(${prefix}_calls.demos_cancelled,0) as ${prefix}_demos_cancelled,
    coalesce(${prefix}_deals.closes,0) as ${prefix}_closes,
    coalesce(${prefix}_deals.contracted,0) as ${prefix}_contracted,
    coalesce(${prefix}_deals.cash,0) as ${prefix}_cash`;
  return `with
  ident as (
    select distinct on (ad_id) ad_id, adset_id, campaign_id,
           ad_name, adset_name, campaign_name, campaign_status, effective_status, thumbnail_url
    from public.meta_ad_snapshots
    where date between ${dateLiteral(from30)} and ${dateLiteral(to)}
    order by ad_id, date desc),
  ${funnel(from7, 'w7')},
  ${funnel(from30, 'w30')},
  setters as (
    select distinct on (c.ad_id) c.ad_id,
      coalesce(sr.display_name, 'Unknown setter') as setter_name,
      count(*) filter (where c.status in ('showed','confirmed','invalid') and c.start_at < now()) as setter_shown,
      count(*) filter (where c.start_at < now()) as setter_due
    from public.calls c
    left join public.sales_reps sr on sr.ghl_user_id = c.assigned_user_id
    where c.ad_id is not null and c.call_type = 'intro' and c.assigned_user_id is not null
      and (c.booked_at at time zone 'Asia/Riyadh')::date between ${dateLiteral(from30)} and ${dateLiteral(to)}
    group by c.ad_id, c.assigned_user_id, sr.display_name
    order by c.ad_id, count(*) desc),
  closers as (
    select distinct on (d.ad_id) d.ad_id, d.closer as closer_name, count(*) as closer_closes
    from public.closed_deals d
    where d.ad_id is not null and d.closer is not null and btrim(d.closer) <> ''
      and (d.submitted_at at time zone 'Asia/Riyadh')::date between ${dateLiteral(from30)} and ${dateLiteral(to)}
      and ${NOT_VOIDED('d')}
    group by d.ad_id, d.closer
    order by d.ad_id, count(*) desc)
select ident.*, public.b2b_campaign_type(ident.campaign_name) as campaign_type,
  setters.setter_name, setters.setter_shown, setters.setter_due,
  closers.closer_name, closers.closer_closes,
  ${columns('w7')},
  ${columns('w30')}
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

function emptyPeople(): B2bPeople {
  return { setter: null, closer: null };
}

function peopleOf(ads: B2bAdNode[]): B2bPeople {
  const setters = new Map<string, { shown: number; due: number }>();
  const closers = new Map<string, number>();
  for (const ad of ads) {
    if (ad.people.setter) {
      const setter = setters.get(ad.people.setter.name) ?? { shown: 0, due: 0 };
      setter.shown += ad.people.setter.shown;
      setter.due += ad.people.setter.due;
      setters.set(ad.people.setter.name, setter);
    }
    if (ad.people.closer) closers.set(ad.people.closer.name, (closers.get(ad.people.closer.name) ?? 0) + ad.people.closer.closes);
  }
  const setter = [...setters.entries()].sort((left, right) => right[1].shown - left[1].shown || right[1].due - left[1].due)[0];
  const closer = [...closers.entries()].sort((left, right) => right[1] - left[1])[0];
  return {
    setter: setter ? { name: setter[0], ...setter[1] } : null,
    closer: closer ? { name: closer[0], closes: closer[1] } : null,
  };
}

function judge(running: boolean, seven: B2bAdWindow, thirty: B2bAdWindow, staleSince: string | null, from: string, to: string): B2bVerdict {
  const range = `${from} to ${to}`;
  if (!running) return { verdict: 'off', reason: 'Not delivering: switched off in Meta.', owner: null };
  if (staleSince && seven.spend < 1) return {
    verdict: 'no delivery', reason: `Meta has reported no delivery since ${staleSince}. Either it has been off since then or Meta is late; ${range} cannot be judged yet.`, owner: 'ads',
  };
  if (seven.spend < 1) return { verdict: 'no delivery', reason: `On, but nothing spent from ${range}.`, owner: 'ads' };
  if (seven.leads === 0 && seven.spend >= 30) return {
    verdict: 'kill', reason: `$${seven.spend.toFixed(0)} from ${range} and not one lead reached the CRM${seven.metaLeads > 0 ? `, though Meta counts ${seven.metaLeads}` : ''}.`, owner: 'ads',
  };
  if (seven.cpl !== null && seven.cpl > CPL_GATE * 1.5) return {
    verdict: 'kill', reason: `$${seven.cpl.toFixed(2)} a lead, more than half again over the $${CPL_GATE} gate.`, owner: 'ads',
  };
  if (seven.frequency !== null && seven.frequency >= 2.5) return {
    verdict: 'fatiguing', reason: `Frequency ${seven.frequency.toFixed(2)}: the same people keep seeing it. Refresh the creative before the cost moves.`, owner: 'ads',
  };
  if (thirty.leads >= 8 && thirty.introsBooked === 0) return {
    verdict: 'leads do not book', reason: `${thirty.leads} leads from ${range} and no intro booked. The ad is doing its job; the follow-up is not.`, owner: 'setter',
  };
  if (thirty.introsShown >= 5 && thirty.demosBooked === 0) return {
    verdict: 'intros do not convert', reason: `${thirty.introsShown} intros shown from ${range} and no demo booked. That is the intro call, not the ad.`, owner: 'setter',
  };
  if (thirty.demosShown >= 3 && thirty.closes === 0) return {
    verdict: 'demos do not close', reason: `${thirty.demosShown} demos shown from ${range} and nothing signed. That is the closing call, not the ad.`, owner: 'closer',
  };
  if (seven.cpl !== null && seven.cpl > CPL_GATE) return {
    verdict: 'hold', reason: `$${seven.cpl.toFixed(2)} a lead is over the $${CPL_GATE} gate but within half again. Watch it; do not scale it.`, owner: 'ads',
  };
  return {
    verdict: 'scale', reason: `$${(seven.cpl ?? 0).toFixed(2)} a lead under the $${CPL_GATE} gate on $${seven.spend.toFixed(0)}${thirty.closes ? `, and ${thirty.closes} ${thirty.closes === 1 ? 'close' : 'closes'} from ${range}` : ''}.`, owner: 'ads',
  };
}

function constraintOf(window: B2bAdWindow, account: B2bAdWindow): B2bAdsPayload['campaigns'][number]['constraint'] {
  const stages: { key: string; label: string; owner: 'ads' | 'landing' | 'setter' | 'closer'; mine: number | null; all: number | null; floor: number }[] = [
    { key: 'click', label: 'impressions to link clicks', owner: 'ads', mine: rate(window.linkClicks, window.impressions), all: rate(account.linkClicks, account.impressions), floor: 500 },
    { key: 'optin', label: 'clicks to leads', owner: 'landing', mine: rate(window.leads, window.linkClicks), all: rate(account.leads, account.linkClicks), floor: 30 },
    { key: 'book', label: 'leads to intros booked', owner: 'setter', mine: rate(window.introsBooked, window.leads), all: rate(account.introsBooked, account.leads), floor: 8 },
    { key: 'show', label: 'intros booked to shown', owner: 'setter', mine: rate(window.introsShown, window.introsBooked), all: rate(account.introsShown, account.introsBooked), floor: 5 },
    { key: 'demo', label: 'intros shown to demos booked', owner: 'setter', mine: rate(window.demosBooked, window.introsShown), all: rate(account.demosBooked, account.introsShown), floor: 5 },
    { key: 'close', label: 'demos shown to closes', owner: 'closer', mine: rate(window.closes, window.demosShown), all: rate(account.closes, account.demosShown), floor: 3 },
  ];
  const denominator: Record<string, number | null> = {
    click: window.impressions, optin: window.linkClicks, book: window.leads, show: window.introsBooked, demo: window.introsShown, close: window.demosShown,
  };
  const leadsUnderCounted = window.introsBooked > window.leads;
  let worst: (typeof stages)[number] | null = null;
  let worstGap = 0;
  for (const stage of stages) {
    if (stage.mine === null || stage.all === null || stage.all === 0 || (denominator[stage.key] ?? 0) < stage.floor) continue;
    if (leadsUnderCounted && (stage.key === 'optin' || stage.key === 'book')) continue;
    const gap = (stage.all - stage.mine) / stage.all;
    if (gap > worstGap) { worstGap = gap; worst = stage; }
  }
  if (!worst || worstGap < 0.2) return null;
  return { stage: worst.label, owner: worst.owner, mine: Math.round((worst.mine ?? 0) * 1000) / 1000, account: Math.round((worst.all ?? 0) * 1000) / 1000 };
}

function windowRowsSql(from: string, to: string): string {
  const first = dateLiteral(from);
  const last = dateLiteral(to);
  return `select
        (select count(*) from public.leads l where ('roas-qualified' = any(coalesce(l.tags, '{}'::text[])) or 'roas-unqualified' = any(coalesce(l.tags, '{}'::text[]))) and (l.lead_created_at at time zone 'Asia/Riyadh')::date between ${first} and ${last}) as w7_leads,
        (select count(*) from public.leads l where ('roas-qualified' = any(coalesce(l.tags, '{}'::text[])) or 'roas-unqualified' = any(coalesce(l.tags, '{}'::text[]))) and (l.lead_created_at at time zone 'Asia/Riyadh')::date between ${first} and ${last}) as w30_leads,
        (select count(*) from public.closed_deals d where (d.submitted_at at time zone 'Asia/Riyadh')::date between ${first} and ${last} and ${NOT_VOIDED('d')}) as w7_closes,
        (select count(*) from public.closed_deals d where (d.submitted_at at time zone 'Asia/Riyadh')::date between ${first} and ${last} and ${NOT_VOIDED('d')}) as w30_closes,
        (select coalesce(sum(d.contracted_revenue),0) from public.closed_deals d where (d.submitted_at at time zone 'Asia/Riyadh')::date between ${first} and ${last} and ${NOT_VOIDED('d')}) as w7_contracted,
        (select coalesce(sum(d.contracted_revenue),0) from public.closed_deals d where (d.submitted_at at time zone 'Asia/Riyadh')::date between ${first} and ${last} and ${NOT_VOIDED('d')}) as w30_contracted,
        (select count(*) from public.closed_deals d where (d.submitted_at at time zone 'Asia/Riyadh')::date between ${first} and ${last} and ${VOIDED('d')}) as w30_voided`;
}

function buildAdsNotes(payload: B2bAdsPayload, staleSince: string | null, freshnessAt: number | undefined, voided: number): void {
  if (payload.accountStatus && payload.accountStatus.code !== 1) payload.notes.push({
    level: 'warn',
    text: `Meta reports the ad account as ${payload.accountStatus.label}${payload.accountStatus.disableReason ? ` (${payload.accountStatus.disableReason})` : ''}${payload.accountStatus.balance ? `, with a balance of ${payload.accountStatus.currency ?? ''} ${payload.accountStatus.balance.toFixed(2)} outstanding` : ''}. Nothing delivers and nothing can be created or edited on the account until that is resolved in Ads Manager. It is the first thing to fix; every verdict below is about the past.`,
  });
  if (staleSince) payload.notes.push({
    level: 'warn',
    text: `"Running" here means switched on as of ${staleSince}, the newest day Meta has reported. Whether those ads are still on today is not known until the sync catches up.`,
  });
  if (payload.running === 0) payload.notes.push({ level: 'warn', text: 'Nothing on the account is delivering. Every ad is switched off, so the figures read spend from before the pause and the verdicts are about what was running, not what is.' });
  const gapAds = payload.campaigns.flatMap(campaign => campaign.adsets.flatMap(adset => adset.ads)).filter(ad => ad.w30.metaLeads >= 5 && ad.w30.leads < ad.w30.metaLeads * 0.5);
  if (gapAds.length) payload.notes.push({
    level: 'warn',
    text: `On ${gapAds.length} ${gapAds.length === 1 ? 'ad' : 'ads'} the CRM received fewer than half the leads Meta counts. Meta counts a form fill; the CRM counts a contact that arrived with its attribution. The gap is either forms that never became contacts or contacts that lost the ad on the way in, and it is the first thing to check before believing any cost per lead here.`,
  });
  const coverage = payload.coverage.w30;
  payload.notes.push({
    level: 'info',
    text: `In this window the CRM holds ${coverage.leads} leads and ${coverage.closes} signed deals worth $${coverage.contracted.toLocaleString('en-US')}; ${coverage.adLeads} leads and ${coverage.adCloses} deals ($${coverage.adContracted.toLocaleString('en-US')}) carry an ad id and are what this screen attributes. The rest came in organically, on WhatsApp or by hand.${voided > 0 ? ` ${voidedDeals(voided)} in these days ${voided === 1 ? 'is' : 'are'} left out of every count here, though B2B keeps ${voided === 1 ? 'it' : 'them'} in its table.` : ''} The account row is lead-gen campaigns only, the way the B2B dashboard reads it; retargeting spend is shown beside it and never inside a cost per lead.`,
  });
  payload.notes.push({
    level: 'info',
    text: `Every row follows an ad from the first impression to the signed contract, through leads, intro calls, demos and closes that carry the ad's id. Both comparison windows use exactly ${payload.windows.from7} to ${payload.windows.to}. Meta leads are what Meta claims; leads are what reached the CRM. Cost per lead is against Aziz's $${CPL_GATE} gate. Cost per demo has no gate set, so it is shown and never judged. Frequency on a parent is the highest of its ads, never a sum.`,
  });
  payload.notes.push({
    level: 'info',
    text: 'A verdict names whose problem it is. "Kill", "hold", "scale" and "fatiguing" are the ad. "Leads do not book" and "intros do not convert" are the setter. "Demos do not close" are the closer. Switching an ad off never fixes the last three; it just stops the calendar filling.',
  });
  if (staleSince) {
    const ranAt = freshnessAt ? new Date(freshnessAt + 3 * 3_600_000).toISOString().slice(0, 16).replace('T', ' ') : null;
    payload.notes.push({ level: 'warn', text: `Meta has reported no delivery since ${staleSince}.${ranAt ? ` The sync itself last ran at ${ranAt} Kuwait time and succeeded, so this is not a dead feed:` : ''} either nothing on the account has delivered since then, which fits every campaign being paused, or Meta is late. Until a newer day lands, every figure in this window reflects the last confirmed snapshot.` });
  }
}

export async function readAdsWindow(from: string, to: string, sources: WindowSources): Promise<B2bAdsPayload> {
  checkWindow(from, to);
  const freshRows = await sources.readSql(B2B, `select max(extract(epoch from last_synced_at) * 1000) as ms,
              to_char(max(date), 'YYYY-MM-DD') as last_day,
              to_char(min(date), 'YYYY-MM-DD') as first_day
       from public.meta_ad_snapshots`);
  const fresh = sqlRow(freshRows, 'snapshot coverage');
  const freshnessAt = optionalNumber(fresh.ms, 'snapshot freshness') ?? undefined;
  const lastDay = typeof fresh.last_day === 'string' ? fresh.last_day : null;
  const firstDay = typeof fresh.first_day === 'string' ? fresh.first_day : null;
  const staleSince = lastDay && lastDay < new Date(Date.parse(`${to}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10)
    ? lastDay
    : null;
  const account = await sources.readMeta(`act_${ACCOUNT}`, { fields: 'account_status,disable_reason,balance,currency,amount_spent,spend_cap' });
  const code = requiredNumber(account.account_status, 'Meta account status');
  const disableReason = optionalNumber(account.disable_reason, 'Meta disable reason') ?? 0;
  const balance = optionalNumber(account.balance, 'Meta account balance');
  const accountStatus = {
    code,
    label: ACCOUNT_STATUS[code] ?? `status ${code}`,
    disableReason: disableReason ? DISABLE_REASON[disableReason] ?? `reason ${disableReason}` : null,
    balance: balance === null ? null : balance / 100,
    currency: typeof account.currency === 'string' && account.currency ? account.currency : null,
  };
  const rows = await sources.readSql(B2B, treeSql(from, from, to));
  const totalsRow = sqlRow(await sources.readSql(B2B, windowRowsSql(from, to)), 'window totals');
  const account7 = emptyWindow();
  const account30 = emptyWindow();
  const all7 = emptyWindow();
  const all30 = emptyWindow();
  let retargeting7 = 0;
  let retargeting30 = 0;
  const campaigns = new Map<string, B2bAdsPayload['campaigns'][number]>();
  const adIds = new Set<string>();
  for (const raw of rows) {
    const row = record(raw, 'ad row');
    const adId = text(row.ad_id, 'ad ID');
    if (adIds.has(adId)) throw new Error('B2B source returned the same ad more than once.');
    adIds.add(adId);
    const seven = windowOf(row, 'w7');
    const thirty = windowOf(row, 'w30');
    const status = text(row.effective_status, 'effective ad status', '');
    const running = status === 'ACTIVE';
    const ad: B2bAdNode = {
      id: adId,
      name: text(row.ad_name, 'ad name', `Ad ${adId}`),
      status,
      running,
      thumbnail: typeof row.thumbnail_url === 'string' && row.thumbnail_url ? row.thumbnail_url : null,
      w7: seven,
      w30: thirty,
      verdict: judge(running, seven, thirty, staleSince, from, to),
      people: {
        setter: row.setter_name ? { name: text(row.setter_name, 'setter name'), shown: requiredNumber(row.setter_shown, 'setter shown count'), due: requiredNumber(row.setter_due, 'setter due count') } : null,
        closer: row.closer_name ? { name: text(row.closer_name, 'closer name'), closes: requiredNumber(row.closer_closes, 'closer close count') } : null,
      },
    };
    addWindow(all7, seven);
    addWindow(all30, thirty);
    const kind = text(row.campaign_type, 'B2B campaign type', 'unknown');
    if (kind === 'lead_gen') {
      addWindow(account7, seven);
      addWindow(account30, thirty);
    } else if (kind === 'retargeting') {
      retargeting7 = roundUsd(retargeting7 + seven.spend);
      retargeting30 = roundUsd(retargeting30 + thirty.spend);
    }
    const campaignId = text(row.campaign_id, 'campaign ID');
    let campaign = campaigns.get(campaignId);
    if (!campaign) {
      campaign = {
        id: campaignId,
        name: text(row.campaign_name, 'campaign name', campaignId),
        type: kind,
        status: text(row.campaign_status, 'campaign status', ''),
        running: false,
        w7: emptyWindow(),
        w30: emptyWindow(),
        people: emptyPeople(),
        constraint: null,
        adsets: [],
      };
      campaigns.set(campaignId, campaign);
    }
    const adsetId = text(row.adset_id, 'ad set ID');
    let adset = campaign.adsets.find(item => item.id === adsetId);
    if (!adset) {
      adset = { id: adsetId, name: text(row.adset_name, 'ad set name', adsetId), running: false, w7: emptyWindow(), w30: emptyWindow(), people: emptyPeople(), ads: [] };
      campaign.adsets.push(adset);
    }
    adset.ads.push(ad);
    addWindow(adset.w7, seven);
    addWindow(adset.w30, thirty);
    addWindow(campaign.w7, seven);
    addWindow(campaign.w30, thirty);
    if (running) { adset.running = true; campaign.running = true; }
  }
  finish(account7); finish(account30); finish(all7); finish(all30);
  const totals = {
    w7Leads: requiredNumber(totalsRow.w7_leads, '7-day CRM leads'),
    w30Leads: requiredNumber(totalsRow.w30_leads, '30-day CRM leads'),
    w7Closes: requiredNumber(totalsRow.w7_closes, '7-day non-voided deals'),
    w30Closes: requiredNumber(totalsRow.w30_closes, '30-day non-voided deals'),
    w7Contracted: requiredNumber(totalsRow.w7_contracted, '7-day non-voided contracted revenue'),
    w30Contracted: requiredNumber(totalsRow.w30_contracted, '30-day non-voided contracted revenue'),
    w30Voided: requiredNumber(totalsRow.w30_voided, '30-day voided deal count'),
  };
  const coverage = {
    w7: { leads: totals.w7Leads, adLeads: all7.leads, closes: totals.w7Closes, adCloses: all7.closes, contracted: roundUsd(totals.w7Contracted), adContracted: all7.contracted },
    w30: { leads: totals.w30Leads, adLeads: all30.leads, closes: totals.w30Closes, adCloses: all30.closes, contracted: roundUsd(totals.w30Contracted), adContracted: all30.contracted },
  };
  const list = [...campaigns.values()];
  for (const campaign of list) {
    finish(campaign.w7); finish(campaign.w30);
    for (const adset of campaign.adsets) {
      finish(adset.w7); finish(adset.w30);
      adset.ads.sort((left, right) => right.w30.spend - left.w30.spend);
      adset.people = peopleOf(adset.ads);
    }
    campaign.adsets.sort((left, right) => right.w30.spend - left.w30.spend);
    campaign.people = peopleOf(campaign.adsets.flatMap(adset => adset.ads));
    campaign.constraint = campaign.type === 'lead_gen' ? constraintOf(campaign.w30, account30) : null;
  }
  list.sort((left, right) => Number(right.type === 'lead_gen') - Number(left.type === 'lead_gen') || Number(right.running) - Number(left.running) || right.w30.spend - left.w30.spend);
  const ads = list.flatMap(campaign => campaign.adsets.flatMap(adset => adset.ads));
  const running = ads.filter(ad => ad.running).length;
  const verdicts: Record<string, number> = {};
  for (const ad of ads) if (ad.running) verdicts[ad.verdict.verdict] = (verdicts[ad.verdict.verdict] ?? 0) + 1;
  const payload: B2bAdsPayload = {
    accountId: ACCOUNT,
    windows: { from7: from, from30: from, to },
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
    notes: [],
  };
  buildAdsNotes(payload, staleSince, freshnessAt, totals.w30Voided);
  return payload;
}

export type ContentPlatform = {
  platform: string; contacts: number; leads: number; booked: number; demosShown: number; closes: number;
  contracted: number; cash: number; posts: number | null; newestPost: string | null;
};
export type ContentDealSource = { source: string; deals: number; contracted: number; cash: number; withAd: number; paid: boolean };
export type ContentWindow = {
  from: string; to: string;
  totals: { contacts: number; leads: number; paidLeads: number; organicLeads: number; reactivationLeads: number; unnamedLeads: number };
  platforms: ContentPlatform[]; deals: ContentDealSource[];
  dealsAll: { deals: number; contracted: number; cash: number };
  dealsOrganic: { deals: number; contracted: number; cash: number };
  voided: { deals: number; contracted: number; cash: number };
};

function contentWindowSql(from: string, to: string): string {
  const first = dateLiteral(from);
  const last = dateLiteral(to);
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
      array_to_string(coalesce(l.tags,'{}'::text[]),' ')) as blob
  from public.leads l
  where (l.lead_created_at at time zone 'Asia/Riyadh')::date between ${first} and ${last}
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
    count(*) as contacts,
    count(*) filter (where roas_lead) as leads,
    count(*) filter (where exists (select 1 from public.calls c where c.contact_id = t.contact_id and c.call_type in ('intro','demo'))) as booked,
    count(*) filter (where exists (select 1 from public.calls c where c.contact_id = t.contact_id and c.call_type = 'demo' and (c.status='showed' or (c.status in ('confirmed','invalid') and c.start_at <= now())))) as demos_shown,
    count(*) filter (where exists (select 1 from public.closed_deals d where d.contact_id = t.contact_id and ${NOT_VOIDED('d')})) as closes,
    coalesce(sum((select coalesce(sum(d.contracted_revenue),0) from public.closed_deals d where d.contact_id = t.contact_id and ${NOT_VOIDED('d')})),0) as contracted,
    coalesce(sum((select coalesce(sum(d.cash_collected),0) from public.closed_deals d where d.contact_id = t.contact_id and ${NOT_VOIDED('d')})),0) as cash
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
  where (d.submitted_at at time zone 'Asia/Riyadh')::date between ${first} and ${last}
    and ${NOT_VOIDED('d')}
  group by 1
),
voided as (
  select count(*) as deals,
    coalesce(sum(d.contracted_revenue),0) as contracted,
    coalesce(sum(d.cash_collected),0) as cash
  from public.closed_deals d
  where (d.submitted_at at time zone 'Asia/Riyadh')::date between ${first} and ${last}
    and ${VOIDED('d')}
),
posts as (
  select case when asset_type = 'reel' then 'Instagram' else 'YouTube' end as platform,
    count(*) as posts, to_char(max(published_at), 'YYYY-MM-DD') as newest
  from public.assets
  where asset_type in ('youtube_video','reel')
    and published_at::date between ${first} and ${last}
  group by 1
)
select
  (select jsonb_agg(to_jsonb(p) order by p.contacts desc) from per p) as platforms,
  (select jsonb_agg(to_jsonb(d) order by d.contracted desc) from deals d) as deals,
  (select to_jsonb(x) from totals x) as totals,
  (select jsonb_agg(to_jsonb(q)) from posts q) as posts,
  (select to_jsonb(v) from voided v) as voided`;
}

function sourceIsPaid(source: string): boolean {
  return /\bads?\b/i.test(source);
}

function sumDealRows(deals: ContentDealSource[]): ContentWindow['dealsAll'] {
  return {
    deals: deals.reduce((total, deal) => total + deal.deals, 0),
    contracted: roundUsd(deals.reduce((total, deal) => total + deal.contracted, 0)),
    cash: roundUsd(deals.reduce((total, deal) => total + deal.cash, 0)),
  };
}

export async function readContentWindow(from: string, to: string, sources: Pick<WindowSources, 'readSql'>): Promise<ContentWindow> {
  checkWindow(from, to);
  const row = sqlRow(await sources.readSql(B2B, contentWindowSql(from, to)), 'content window');
  const totals = record(row.totals, 'content totals');
  const voided = record(row.voided, 'voided deal totals');
  const postRows = row.posts === null || row.posts === undefined ? [] : Array.isArray(row.posts) ? row.posts.map(value => record(value, 'post row')) : null;
  if (postRows === null) throw new Error('B2B source returned invalid content post rows.');
  const posts = new Map(postRows.map(post => [text(post.platform, 'post platform'), post]));
  const platformRows = row.platforms === null || row.platforms === undefined ? [] : Array.isArray(row.platforms) ? row.platforms.map(value => record(value, 'content platform row')) : null;
  if (platformRows === null) throw new Error('B2B source returned invalid content platforms.');
  const platforms: ContentPlatform[] = platformRows.map(platform => {
    const name = text(platform.platform, 'content platform');
    const post = posts.get(name);
    return {
      platform: name,
      contacts: requiredNumber(platform.contacts, `${name} contacts`),
      leads: requiredNumber(platform.leads, `${name} leads`),
      booked: requiredNumber(platform.booked, `${name} calls booked`),
      demosShown: requiredNumber(platform.demos_shown, `${name} demos shown`),
      closes: requiredNumber(platform.closes, `${name} closes`),
      contracted: roundUsd(requiredNumber(platform.contracted, `${name} contracted revenue`)),
      cash: roundUsd(requiredNumber(platform.cash, `${name} cash`)),
      posts: post ? requiredNumber(post.posts, `${name} post count`) : null,
      newestPost: post && typeof post.newest === 'string' ? post.newest : null,
    };
  });
  for (const [name, post] of posts) {
    if (platforms.some(platform => platform.platform === name)) continue;
    platforms.push({
      platform: name, contacts: 0, leads: 0, booked: 0, demosShown: 0, closes: 0, contracted: 0, cash: 0,
      posts: requiredNumber(post.posts, `${name} post count`), newestPost: typeof post.newest === 'string' ? post.newest : null,
    });
  }
  platforms.sort((left, right) => right.contacts - left.contacts || (right.posts ?? 0) - (left.posts ?? 0));
  const dealRows = row.deals === null || row.deals === undefined ? [] : Array.isArray(row.deals) ? row.deals.map(value => record(value, 'content deal row')) : null;
  if (dealRows === null) throw new Error('B2B source returned invalid content deal rows.');
  const deals: ContentDealSource[] = dealRows.map(deal => {
    const source = text(deal.source, 'deal source');
    return {
      source,
      deals: requiredNumber(deal.deals, `${source} deals`),
      contracted: roundUsd(requiredNumber(deal.contracted, `${source} contracted revenue`)),
      cash: roundUsd(requiredNumber(deal.cash, `${source} cash`)),
      withAd: requiredNumber(deal.with_ad, `${source} ad-attributed deals`),
      paid: sourceIsPaid(source),
    };
  });
  return {
    from, to,
    totals: {
      contacts: requiredNumber(totals.contacts, 'content contacts'),
      leads: requiredNumber(totals.leads, 'content leads'),
      paidLeads: requiredNumber(totals.paid_leads, 'paid leads'),
      organicLeads: requiredNumber(totals.organic_leads, 'organic leads'),
      reactivationLeads: requiredNumber(totals.reactivation_leads, 'reactivation leads'),
      unnamedLeads: requiredNumber(totals.unnamed_leads, 'unnamed leads'),
    },
    platforms,
    deals,
    dealsAll: sumDealRows(deals),
    dealsOrganic: sumDealRows(deals.filter(deal => !deal.paid && deal.source !== 'Not answered')),
    voided: {
      deals: requiredNumber(voided.deals, 'voided deal count'),
      contracted: roundUsd(requiredNumber(voided.contracted, 'voided contracted revenue')),
      cash: roundUsd(requiredNumber(voided.cash, 'voided cash')),
    },
  };
}
