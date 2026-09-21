import type { FunnelWindow, GrowthPayload, Note } from "../payloads";
import { B2B, num, type Row, sql } from "../sb";
import { addDays, daysInMonth, kuwaitDay, monthStart } from "../time";
import type { Adapter, DailyPoint, SourceStamp } from "../types";

// biome-ignore lint/suspicious/noExplicitAny: the B2B functions return jsonb
type Any = any;

/**
 * Mahara's own acquisition funnel, read through the B2B dashboard's own
 * read-only functions so every number matches mahara-b2-b.vercel.app. The
 * dashboard day is Asia/Riyadh, the same clock as Kuwait.
 */

type WindowKey = keyof GrowthPayload["windows"];
type Range = [from: string, to: string];

/** A date literal for SQL. Days come from time.ts, never from user input. */
function day(d: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new Error(`growth: bad day ${d}`);
  return `'${d}'::date`;
}

/** Inclusive Kuwait-day ranges for each window. */
function windowRanges(today: string): Record<WindowKey, Range> {
  const yesterday = addDays(today, -1);
  const first = monthStart(today);
  const lastMonthEnd = addDays(first, -1);
  const lastMonthFirst = monthStart(lastMonthEnd);
  // Same day of last month, capped at its length (the 31st in a 30-day month).
  const sameDay = Math.min(
    Number(today.slice(8, 10)),
    daysInMonth(lastMonthFirst),
  );
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
 * One statement for all six windows: b2b_window_metrics per window (the
 * Overview tiles), plus the ROAS lead classes, speed to lead on Maqsam,
 * and a count of past demos still marked confirmed. The show rate itself
 * is the dashboard's and is never worked out here.
 *
 * Speed to lead (Aziz, 2026-09-21): from the lead's creation to the first
 * call with that lead on Maqsam, whatever its direction, matched by the
 * CRM contact id or the last eight digits of the phone. Median over the
 * leads that were called; the uncalled are counted beside it.
 */
function windowsSql(ranges: Record<WindowKey, Range>): string {
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
  group by w.k
),
speed as (
  select w.k,
    count(*) as sp_leads,
    count(fc.first_call) as sp_called,
    percentile_cont(0.5) within group (order by extract(epoch from (fc.first_call - l.lead_created_at)) / 60.0) filter (where fc.first_call is not null) as sp_median_min,
    count(*) filter (where fc.first_call is not null and fc.first_call - l.lead_created_at <= interval '5 minutes') as sp_within_5
  from w
  join public.leads l on ${IS_LEAD} and (l.lead_created_at at time zone 'Asia/Riyadh')::date between w.f and w.t
  cross join lateral (
    select min(m.occurred_at) as first_call from public.maqsam_calls m
    where m.occurred_at >= l.lead_created_at
      and (m.contact_id = l.contact_id
        or (length(regexp_replace(coalesce(l.phone,''), '[^0-9]', '', 'g')) >= 8 and (regexp_replace(coalesce(m.lead_phone,''), '[^0-9]', '', 'g') like '%' || right(regexp_replace(coalesce(l.phone,''), '[^0-9]', '', 'g'), 8) or regexp_replace(coalesce(m.callee_number,''), '[^0-9]', '', 'g') like '%' || right(regexp_replace(coalesce(l.phone,''), '[^0-9]', '', 'g'), 8) or regexp_replace(coalesce(m.caller_number,''), '[^0-9]', '', 'g') like '%' || right(regexp_replace(coalesce(l.phone,''), '[^0-9]', '', 'g'), 8))))
  ) fc
  group by w.k
)
select w.k, w.f::text as d_from, w.t::text as d_to,
  public.b2b_window_metrics(w.f, w.t, null::text[]) as m,
  coalesce(sc.demos_still_confirmed, 0) as demos_still_confirmed,
  coalesce(r.q, 0) as roas_q, coalesce(r.u, 0) as roas_u, coalesce(r.nr, 0) as roas_nr, coalesce(r.untagged, 0) as roas_untagged,
  coalesce(sp.sp_leads, 0) as sp_leads, coalesce(sp.sp_called, 0) as sp_called, sp.sp_median_min, coalesce(sp.sp_within_5, 0) as sp_within_5
from w
left join still_confirmed sc on sc.k = w.k
left join roas r on r.k = w.k
left join speed sp on sp.k = w.k`;
}

/**
 * Daily funnel with the Overview's rules, so the days add up to the windows:
 * lead-gen spend by Meta day, leads by creation day, intro and demo calls by
 * booking day, closes by form day. b2b_marketing_daily is not used because it
 * adds retargeting spend and counts demos only.
 */
function dailySql(from: string, to: string): string {
  const f = day(from);
  const t = day(to);
  return `with days as (
  select generate_series(${f}, ${t}, interval '1 day')::date as d
),
meta as (
  select date as d, sum(spend) as spend
  from public.meta_ad_snapshots
  where date between ${f} and ${t}
    and public.b2b_campaign_type(campaign_name) = 'lead_gen'
  group by 1
),
ld as (
  select (l.lead_created_at at time zone 'Asia/Riyadh')::date as d, count(*) as n
  from public.leads l
  where ${IS_LEAD}
    and (l.lead_created_at at time zone 'Asia/Riyadh')::date between ${f} and ${t}
  group by 1
),
bk as (
  select (booked_at at time zone 'Asia/Riyadh')::date as d, count(*) as n
  from public.calls
  where call_type in ('intro', 'demo')
    and (booked_at at time zone 'Asia/Riyadh')::date between ${f} and ${t}
  group by 1
),
cl as (
  select (submitted_at at time zone 'Asia/Riyadh')::date as d, count(*) as n
  from public.closed_deals
  where (submitted_at at time zone 'Asia/Riyadh')::date between ${f} and ${t}
  group by 1
)
select days.d::text as date,
  round(coalesce(meta.spend, 0)::numeric, 2) as spend,
  coalesce(ld.n, 0) as leads,
  coalesce(bk.n, 0) as booked,
  coalesce(cl.n, 0) as closes
from days
left join meta on meta.d = days.d
left join ld on ld.d = days.d
left join bk on bk.d = days.d
left join cl on cl.d = days.d
order by days.d`;
}

/** b2b_rep_scorecard, trimmed to first names and the payload's columns. */
function repsSql(from: string, to: string): string {
  return `select
  case when (e.value->>'is_known')::boolean
    then split_part(btrim(e.value->>'display_name'), ' ', 1)
    else e.value->>'display_name' end as name,
  coalesce(e.value->>'role', sr.role) as role,
  e.value->>'calls_scheduled' as booked,
  e.value->>'calls_shown' as shown,
  e.value->>'closes' as closes,
  e.value->>'close_rate' as close_rate,
  e.value->>'revenue' as contracted,
  e.value->>'cash_collected' as cash
from json_array_elements(public.b2b_rep_scorecard(${day(from)}, ${day(to)})) with ordinality e
left join public.sales_reps sr on sr.id::text = e.value->>'person_key'
order by e.ordinality`;
}

/** The Marketing tab's per-ad table, top 6 by spend. */
function topAdsSql(from: string, to: string): string {
  return `select
  coalesce(nullif(btrim(e.value->>'ad_name'), ''), 'Ad ' || (e.value->>'ad_id')) as name,
  e.value->>'spend' as spend,
  e.value->>'leads' as leads,
  e.value->>'cpl' as cpl
from json_array_elements(public.b2b_marketing_ads(${day(from)}, ${day(to)}, null::text[])) with ordinality e
where (e.value->>'spend')::numeric > 0
order by (e.value->>'spend')::numeric desc, e.ordinality
limit 6`;
}

/**
 * Every ad with something to show for itself, over a long enough window that a
 * close can be attributed. Ranked by outcome, not by spend.
 */
function winningAdsSql(from: string, to: string): string {
  return `select
  e.value->>'ad_id' as ad_id,
  coalesce(nullif(btrim(e.value->>'ad_name'), ''), 'Ad ' || (e.value->>'ad_id')) as name,
  e.value->>'thumbnail_url' as thumbnail,
  e.value->>'status' as status,
  e.value->>'in_meta' as in_meta,
  e.value->>'spend' as spend,
  e.value->>'impressions' as impressions,
  e.value->>'clicks' as clicks,
  e.value->>'ctr' as ctr,
  e.value->>'leads' as leads,
  e.value->>'cpl' as cpl,
  e.value->>'qualified_leads' as qualified,
  e.value->>'qualified_pct' as qualified_pct,
  e.value->>'demos_booked' as demos,
  e.value->>'cost_per_demo' as cost_per_demo,
  e.value->>'sales' as sales,
  e.value->>'revenue' as revenue,
  e.value->>'cash' as cash,
  e.value->>'cpa' as cpa,
  e.value->>'rev_roas' as rev_roas
from json_array_elements(public.b2b_marketing_ads(${day(from)}, ${day(to)}, null::text[])) with ordinality e
where coalesce((e.value->>'leads')::numeric, 0) > 0
   or coalesce((e.value->>'spend')::numeric, 0) > 0
order by coalesce((e.value->>'sales')::numeric, 0) desc,
         coalesce((e.value->>'demos_booked')::numeric, 0) desc,
         coalesce((e.value->>'leads')::numeric, 0) desc,
         e.ordinality
limit 24`;
}

/** Lead sources with the same rule as b2b_cockpit's sources list. */
function leadSourcesSql(from: string, to: string): string {
  return `select coalesce(nullif(btrim(source), ''), '(none)') as source, count(*) as leads
from public.leads
where is_lead
  and (lead_created_at at time zone 'Asia/Riyadh')::date between ${day(from)} and ${day(to)}
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
    when 'typeform' then (select max(submitted_at) from public.closed_deals)
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

const orNull = (x: unknown): number | null =>
  x === null || x === undefined ? null : num(x);

/** The dashboard's percents (one decimal) as fractions 0..1. */
const pct = (x: unknown): number | null =>
  x === null || x === undefined ? null : Math.round(num(x) * 10) / 1000;

function usd(x: number): string {
  return `$${x.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
}

/**
 * A record-keeping fact, at info level so Today leaves it off its growth
 * card: how many of this month's past demos are still marked confirmed. The
 * dashboard's rule counts each of them as shown, which is correct, so a demo
 * that did not happen has to be marked no-show in GHL for the rate to see it.
 */
function stillConfirmedNote(w: FunnelWindow): Note | null {
  const n = w.demosStillConfirmed;
  if (n <= 0) return null;
  const due = num(w.raw.demos_due);
  return {
    level: "info",
    text: `${n} of the ${due} demos due this month are still marked confirmed. The dashboard counts a past confirmed demo as shown, so a demo that did not happen should be marked no-show in GHL.`,
  };
}

/** Every numeric key of the function's JSON, as is (percents stay x100). */
function rawNumbers(m: Row): Record<string, number | null> {
  const raw: Record<string, number | null> = {};
  for (const [k, x] of Object.entries(m)) {
    if (x === null) raw[k] = null;
    else if (typeof x === "number") raw[k] = x;
    else if (
      typeof x === "string" &&
      x.trim() !== "" &&
      Number.isFinite(Number(x))
    )
      raw[k] = Number(x);
  }
  return raw;
}

function metricsOf(r: Row): Row {
  const m = typeof r.m === "string" ? JSON.parse(r.m) : r.m;
  if (!m || m.leads === undefined)
    throw new Error(`growth: b2b_window_metrics gave no data for ${r.k}`);
  return m;
}

function toWindow(r: Row): FunnelWindow {
  const m = metricsOf(r);
  const spend = num(m.spend);
  const qualified = num(r.roas_q);
  const unqualified = num(r.roas_u);
  const leads = qualified + unqualified;
  const called = num(r.sp_called);
  const medianMin = orNull(r.sp_median_min);
  return {
    from: String(r.d_from),
    to: String(r.d_to),
    spend,
    leads,
    cpl: leads > 0 ? Math.round((spend / leads) * 100) / 100 : null,
    leadClasses: {
      qualified,
      unqualified,
      notReady: num(r.roas_nr),
      untagged: num(r.roas_untagged),
    },
    speedToLead: {
      leads: num(r.sp_leads),
      called,
      medianMin: medianMin === null ? null : Math.round(medianMin * 10) / 10,
      within5Share:
        called > 0
          ? Math.round((num(r.sp_within_5) / called) * 1000) / 1000
          : null,
    },
    introsBooked: num(m.intros_booked),
    demosBooked: num(m.demos_booked),
    demosShown: num(m.demos_shown),
    demoShowRate: pct(m.demo_show_rate),
    introShowRate: pct(m.intro_show_rate),
    introToDemo: pct(m.intro_to_demo),
    demosStillConfirmed: num(r.demos_still_confirmed),
    costPerDemo: orNull(m.cost_per_demo),
    costPerDemoBooked: orNull(m.cost_per_demo_booked),
    closes: num(m.signed),
    closeRate: pct(m.close_rate),
    contracted: num(m.revenue),
    cash: num(m.cash_collected),
    cac: orNull(m.cac),
    roas: orNull(m.roas),
    raw: rawNumbers(m),
  };
}

/** Run a secondary read; on failure keep going with a fallback and a warning. */
async function attempt<T>(
  what: string,
  notes: Note[],
  fallback: T,
  run: () => Promise<T>,
): Promise<T> {
  try {
    return await run();
  } catch (e) {
    const why = String(e instanceof Error ? e.message : e).slice(0, 140);
    notes.push({
      level: "warn",
      text: `${what} could not be read this run (${why}).`,
    });
    return fallback;
  }
}

export const growth: Adapter = {
  key: "growth",
  label: "Marketing and sales",
  compute: async () => {
    const today = kuwaitDay();
    const ranges = windowRanges(today);
    const notes: Note[] = [];

    // Core read. No fallback: a failure keeps the last good payload.
    const windowRows = await sql(B2B, windowsSql(ranges));
    const byKey = new Map(windowRows.map(r => [String(r.k), r]));
    const rowOf = (k: WindowKey): Row => {
      const r = byKey.get(k);
      if (!r) throw new Error(`growth: no ${k} window returned`);
      return r;
    };
    const windows: GrowthPayload["windows"] = {
      yesterday: toWindow(rowOf("yesterday")),
      last7: toWindow(rowOf("last7")),
      prevLast7: toWindow(rowOf("prevLast7")),
      mtd: toWindow(rowOf("mtd")),
      lastMonthToDate: toWindow(rowOf("lastMonthToDate")),
      lastMonth: toWindow(rowOf("lastMonth")),
    };
    const mtd = windows.mtd;

    const daily = await attempt(
      "The 365-day daily series",
      notes,
      [] as GrowthPayload["daily"],
      async () =>
        (await sql(B2B, dailySql(addDays(today, -364), today))).map(r => ({
          date: String(r.date),
          spend: num(r.spend),
          leads: num(r.leads),
          booked: num(r.booked),
          closes: num(r.closes),
        })),
    );

    const reps = await attempt(
      "The rep scorecard",
      notes,
      [] as GrowthPayload["reps"],
      async () =>
        (await sql(B2B, repsSql(ranges.mtd[0], ranges.mtd[1]))).map(r => ({
          name: String(r.name ?? "Unknown"),
          role: r.role ? String(r.role) : null,
          booked: num(r.booked),
          shown: num(r.shown),
          closes: num(r.closes),
          closeRate: pct(r.close_rate),
          contracted: num(r.contracted),
          cash: num(r.cash),
        })),
    );

    const topAds = await attempt(
      "Top ads",
      notes,
      [] as GrowthPayload["topAds"],
      async () =>
        (await sql(B2B, topAdsSql(ranges.last7[0], ranges.last7[1]))).map(
          r => ({
            name: String(r.name),
            spend: num(r.spend),
            leads: num(r.leads),
            cpl: orNull(r.cpl),
          }),
        ),
    );

    const leadSources = await attempt(
      "Lead sources",
      notes,
      [] as GrowthPayload["leadSources"],
      async () =>
        (await sql(B2B, leadSourcesSql(ranges.mtd[0], ranges.mtd[1]))).map(
          r => ({ source: String(r.source), leads: num(r.leads) }),
        ),
    );

    const feedRows = await attempt<Row[] | null>(
      "Feed freshness",
      notes,
      null,
      () => sql(B2B, FRESHNESS_SQL),
    );

    // Caveats, most important first.
    const stillConfirmed = stillConfirmedNote(mtd);
    if (stillConfirmed) notes.push(stillConfirmed);
    notes.push(
      {
        level: "info",
        text: "Show rate is the B2B dashboard's: calls shown over calls due. A call counts as shown when it is marked showed, or marked confirmed or invalid once its time has passed. Calls due are every call whose time has passed in the window, cancelled and no-show included. A future call is in neither count.",
      },
      {
        level: "info",
        text: `Spend is lead-gen campaigns only, as on the dashboard overview. Retargeting adds ${usd(num(mtd.raw.spend_retargeting))} this month. Spend days are the Meta ad account's reporting day.`,
      },
      {
        level: "info",
        text: "Each stage is dated by its own event: leads by creation day, bookings by booking day, shows by call day, closes by form day. Rates are not cohort conversion, and close rate can pass 100% in a short window.",
      },
      {
        level: "info",
        text: "Leads are every opted-in GHL contact with a phone or email, including WhatsApp, organic and manual contacts.",
      },
      {
        level: "info",
        text: "Contracted and cash come from the closed-deal form. Cash is the upfront amount the closer typed, not Whop payments.",
      },
      {
        level: "info",
        text: "Reps: booked and shown are calls on each person's GHL calendar by call day. A close goes to the closer named on the form. Top ads include retargeting spend and only leads tied to an ad.",
      },
    );

    const sources: SourceStamp[] = FEEDS.map(f => {
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
      const newest =
        f.source === "meta"
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
    const actionQueue = await attempt(
      "The action queue",
      notes,
      undefined as GrowthPayload["actionQueue"],
      async () => {
        const rows = await sql(
          B2B,
          `select (public.b2b_action_queue(1)::jsonb) as q`,
        );
        const q = (rows[0]?.q ?? {}) as Any;
        const buckets = ((q.buckets ?? []) as Any[]).map(b => ({
          key: String(b.key ?? ""),
          label: String(b.label ?? b.key ?? ""),
          hint: String(b.hint ?? ""),
          count: num(b.count),
        }));
        return { total: num(q.total), buckets };
      },
    );
    if (actionQueue && actionQueue.total > 0) {
      const worst = [...actionQueue.buckets].sort(
        (a, b) => b.count - a.count,
      )[0];
      notes.push({
        level: "warn",
        text: `${actionQueue.total.toLocaleString("en-US")} records are waiting on somebody${
          worst
            ? `, ${worst.count.toLocaleString("en-US")} of them ${worst.label.toLowerCase()}. ${worst.hint}`
            : "."
        } Every rate on this tab is computed over those records, so they are soft until the backlog is cleared.`,
      });
    }

    const stalled = await attempt(
      "Stalled deals",
      notes,
      undefined as GrowthPayload["stalled"],
      async () => {
        const rows = await sql(
          B2B,
          `select (public.b2b_stalled_deals(${day(addDays(today, -120))}, ${day(today)}, 14)::jsonb) as s`,
        );
        const q = (rows[0]?.s ?? {}) as Any;
        const byOwner = new Map<string, { deals: number; value: number }>();
        for (const r of (q.rows ?? []) as Any[]) {
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
          buckets: ((q.buckets ?? []) as Any[]).map(b => ({
            age: String(b.age ?? ""),
            deals: num(b.n),
          })),
          byOwner: [...byOwner.entries()]
            .map(([owner, o]) => ({ owner, ...o }))
            .sort((a, b) => b.deals - a.deals)
            .slice(0, 8),
        };
      },
    );
    if (stalled && stalled.stale > 0)
      notes.push({
        level: "warn",
        text: `${stalled.stale} of ${stalled.total} open deals have not been touched in ${stalled.staleDays} days${
          stalled.buckets.find(b => b.age === ">30d")
            ? `, ${stalled.buckets.find(b => b.age === ">30d")?.deals} of them for over a month`
            : ""
        }. Owner counts come from the deals the function returns, which is a capped sample, so read them as a shape rather than a total.`,
      });

    const WINNING_DAYS = 90;
    const winningAds = await attempt(
      "The ad breakdown",
      notes,
      undefined as GrowthPayload["winningAds"],
      async () => {
        const rows = await sql(
          B2B,
          winningAdsSql(addDays(today, -WINNING_DAYS), today),
        );
        const opt = (x: unknown) =>
          x === null || x === undefined || x === "" ? null : num(x);
        return {
          windowDays: WINNING_DAYS,
          rows: rows.map(r => ({
            adId: String(r.ad_id),
            name: String(r.name),
            thumbnail: r.thumbnail ? String(r.thumbnail) : null,
            status: r.status ? String(r.status) : null,
            inMeta: String(r.in_meta) === "true",
            spend: num(r.spend),
            impressions: num(r.impressions),
            clicks: num(r.clicks),
            ctr: opt(r.ctr),
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
      },
    );
    if (winningAds?.rows.length)
      notes.push({
        level: "info",
        text: `Ads are ranked by what they produced over ${WINNING_DAYS} days, closes first, then demos, then leads, because the biggest spender is rarely the winner. An ad Meta no longer has a snapshot for still appears when leads or demos are attributed to it, with its spend shown as unknown rather than zero. Thumbnails come from Facebook on an expiring link, so one that stops loading is not a fault in the data.`,
      });

    const pacing = await attempt(
      "Pacing",
      notes,
      undefined as GrowthPayload["pacing"],
      async () => {
        const rows = await sql(
          B2B,
          `select (public.b2b_pacing_pipeline(${day(monthStart(today))}, ${day(today)})::jsonb) as p`,
        );
        const q = (rows[0]?.p ?? {}) as Any;
        const n = (x: unknown) =>
          x === null || x === undefined ? null : num(x);
        return {
          openDemosLeft: n(q.open_demos_left),
          closeRate: n(q.close_rate),
          avgDealValue: n(q.avg_deal_value),
        };
      },
    );

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
    } satisfies GrowthPayload;

    // Call statuses are overwritten in place at the source, so keep today's
    // month-to-date show rate and past demos still marked confirmed here to
    // see how they settle.
    const points: DailyPoint[] = [];
    const keep = (metric: string, value: number | null) => {
      if (value !== null)
        points.push({ date: today, metric, scope: "company", value });
    };
    keep("growth.demoShowRate.mtd", mtd.demoShowRate);
    // The key keeps its old name so the history stays one continuous series.
    keep("growth.demosUnmarked.mtd", mtd.demosStillConfirmed);

    return { payload, daily: points, sources };
  },
};
