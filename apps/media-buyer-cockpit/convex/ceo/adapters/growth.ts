import type { FunnelWindow, GrowthPayload, Note } from "../payloads";
import { B2B, num, type Row, sql } from "../sb";
import { addDays, daysInMonth, kuwaitDay, monthStart } from "../time";
import type { Adapter, DailyPoint, SourceStamp } from "../types";

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
 * One statement for all six windows: b2b_window_metrics per window (the
 * Overview tiles), plus demo outcomes as marked, for the stricter show rate.
 */
function windowsSql(ranges: Record<WindowKey, Range>): string {
  const values = Object.entries(ranges)
    .map(([k, [f, t]]) => `('${k}', ${day(f)}, ${day(t)})`)
    .join(",\n    ");
  return `with w(k, f, t) as (
  values
    ${values}
),
marked as (
  select w.k,
    count(*) filter (where c.status in ('showed', 'invalid')) as marked_shown,
    count(*) filter (where c.status = 'noshow') as marked_noshow,
    count(*) filter (where c.status = 'confirmed' and c.start_at <= now()) as unmarked_past
  from w
  join public.calls c on c.call_type = 'demo'
    and (c.start_at at time zone 'Asia/Riyadh')::date between w.f and w.t
  group by w.k
)
select w.k, w.f::text as d_from, w.t::text as d_to,
  public.b2b_window_metrics(w.f, w.t, null::text[]) as m,
  coalesce(mk.marked_shown, 0) as marked_shown,
  coalesce(mk.marked_noshow, 0) as marked_noshow,
  coalesce(mk.unmarked_past, 0) as unmarked_past
from w left join marked mk on mk.k = w.k`;
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
  select (lead_created_at at time zone 'Asia/Riyadh')::date as d, count(*) as n
  from public.leads
  where is_lead
    and (lead_created_at at time zone 'Asia/Riyadh')::date between ${f} and ${t}
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
  const markedShown = num(r.marked_shown);
  const marked = markedShown + num(r.marked_noshow);
  return {
    from: String(r.d_from),
    to: String(r.d_to),
    spend: num(m.spend),
    leads: num(m.leads),
    cpl: orNull(m.cost_per_lead),
    introsBooked: num(m.intros_booked),
    demosBooked: num(m.demos_booked),
    demosShown: num(m.demos_shown),
    demoShowRate: pct(m.demo_show_rate),
    // Invalid calls did happen (the lead was disqualified), so they count as shown.
    demoShowRateMarked:
      marked > 0 ? Math.round((markedShown / marked) * 1000) / 1000 : null,
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
  label: "Growth",
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
    const mtdUnmarked = num(rowOf("mtd").unmarked_past);
    const mtdDemosDue = num(mtd.raw.demos_due);

    const daily = await attempt(
      "The 60-day daily series",
      notes,
      [] as GrowthPayload["daily"],
      async () =>
        (await sql(B2B, dailySql(addDays(today, -59), today))).map(r => ({
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

    // Trust caveats, most important first.
    if (mtdDemosDue > 0 && mtdUnmarked / mtdDemosDue >= 0.2)
      notes.push({
        level: "warn",
        text: `${mtdUnmarked} of ${mtdDemosDue} demos due this month still have no outcome marked. The dashboard counts them as shows, so its show rate is likely too high.`,
      });
    notes.push(
      {
        level: "info",
        text: "Demo show rate is the dashboard's: past calls still marked confirmed, and invalid calls, count as shows. The marked rate uses only calls marked showed, invalid or no-show.",
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

    const payload = {
      windows,
      daily,
      reps,
      topAds,
      leadSources,
      notes,
    } satisfies GrowthPayload;

    // Call outcomes are overwritten in place at the source, so keep today's
    // month-to-date show rates here to see how they settle.
    const points: DailyPoint[] = [];
    const keep = (metric: string, value: number | null) => {
      if (value !== null)
        points.push({ date: today, metric, scope: "company", value });
    };
    keep("growth.demoShowRate.mtd", mtd.demoShowRate);
    keep("growth.demoShowRateMarked.mtd", mtd.demoShowRateMarked);
    keep("growth.demosUnmarked.mtd", mtdUnmarked);

    return { payload, daily: points, sources };
  },
};
