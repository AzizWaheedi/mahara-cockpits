import { ms, num, sql, TRIAGE } from "../sb.js";
import { USD_PER } from "./tap.js";
/**
 * Client delivery, read straight from the Creative Triage Supabase project.
 *
 * Why this exists. Until 2026-09-19 the delivery section counted only what the
 * media buyer's own Meta sync had pulled for campaigns carrying an Ads
 * Management card, and counted bookings by asking GHL for appointments up to
 * now. Both undercount, and both were measured against this source on
 * 2026-09-18 over the same window (1-18 September):
 *
 *   spend      $5,008.87 through the board   vs  $5,976.75 here  (+19%)
 *   leads            436                     vs        453
 *   bookings          60                     vs         79 due, 93 including
 *                                                 appointments still to come
 *
 * The gap is campaigns with no card and clients the board does not carry. So
 * this project is the source of truth for what a client was delivered, and the
 * media buyer sync becomes the cross-check: the adapter shows both and says so
 * when they disagree, rather than quietly replacing one number with another.
 *
 * Since 2026-09-21 it also reads Mahara OS's appointment outcomes
 * (portal_data.appointment_outcomes, the client's own report on each
 * appointment: attendance and whether the deal was won), joined to the
 * appointment by its GHL id. That is where the close rate comes from now.
 *
 * Everything here is read-only SQL (convex/ceo/sb.ts refuses anything else).
 */
/**
 * Mahara's own ad accounts, which sit in the same table as the clients'.
 * Their spend is the company's own lead generation and belongs to the
 * Marketing and Frontend tabs; counting it as client delivery would double it
 * and inflate every cost per lead on this tab.
 */
const OWN_ACCOUNTS = new Set(["maharamedia", "maharamassdesign"]);
const fold = (s) => String(s ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
/** The provisional calendar's names; shared with the SQL that counts its rows. */
const PROVISIONAL = /not confirmed|provisional|tentative/;
export function calendarKind(name) {
    const n = String(name ?? "").toLowerCase();
    if (!n)
        return "other";
    if (/callback|call-back|معاودة/.test(n))
        return "callback";
    if (PROVISIONAL.test(n))
        return "provisional";
    if (/reschedul/.test(n))
        return "reschedule";
    if (/appointment calendar|main appointment/.test(n))
        return /online/.test(n) ? "online" : "main";
    return "other";
}
export function isBookingKind(kind) {
    return kind === "main" || kind === "online" || kind === "provisional";
}
/**
 * Whether a past appointment was shown, the same rule for the show rate and
 * the close rate: the CRM status when it says showed or noshow; else the
 * attendance sheet's mark; else Mahara OS's attendance. A cancelled or
 * invalid appointment is never shown or missed, and one nobody marked is
 * unknown, which no rate counts.
 */
export function attendanceOf(a) {
    if (a.status === "cancelled" || a.status === "invalid")
        return "unknown";
    if (a.status === "showed")
        return "showed";
    if (a.status === "noshow")
        return "noshow";
    if (a.attended === true || a.outcome?.attendance === "showed")
        return "showed";
    if (a.attended === false || a.outcome?.attendance === "no_show")
        return "noshow";
    return "unknown";
}
/**
 * A past appointment with no outcome in Mahara OS: no outcome row at any
 * revision, and the attendance sheet marked nothing either. An appointment
 * still marked confirmed after its time is exactly this, unless the sheet
 * marked it.
 */
export function hasNoOutcome(a) {
    return a.outcome === null && a.attended === null;
}
/** A deal the client marked won in Mahara OS. */
export function isWon(a) {
    return a.outcome?.deal === "won";
}
/** A Kuwait day as a checked SQL date literal. */
function day(d) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d))
        throw new Error(`triage: bad day ${d}`);
    return `date '${d}'`;
}
/**
 * USD per unit of an account currency, as SQL, from the one rate table
 * (./tap.js USD_PER). A currency the table has no rate for gives NULL, never
 * one to one, so its spend is left out and named rather than miscounted.
 */
export function usdRateSql(currencyExpr) {
    const cases = Object.entries(USD_PER)
        .map(([code, rate]) => {
        if (!/^[A-Z]{3}$/.test(code) || !Number.isFinite(rate))
            throw new Error(`triage: bad rate ${code}`);
        return `when '${code}' then ${rate}`;
    })
        .join(" ");
    return `(case upper(coalesce(nullif(btrim(${currencyExpr}), ''), 'USD')) ${cases} end)`;
}
/**
 * The two ad tables, row by row, per ad and day (R2, 2026-10-11).
 *
 * `live`: public.cockpit_media_daily_stats, the media buyer's Meta sync, one
 * row per ad per day, spend already in USD (the sync converts with
 * spendToUsd), with no client id. A row reaches a client through its
 * campaign: campaign_name -> cockpit_campaigns (raw_data campaignName, the
 * newest row, deleted ones kept for the tie) -> the Meta ad account ->
 * clients.meta_ad_account_id ("act_" + id); client_id is null when it ties
 * to nothing.
 *
 * `old`: public.ads_daily_snapshots, stopped on 2026-10-02, in the account's
 * own currency with the client on the row. It fills only the ad-days the live
 * table has no tied row for. The live table is the board's sync: it lacks
 * campaigns with no card and drops a campaign's rows when it leaves the
 * board, so from 13 Aug to mid-September it holds a fraction of what clients
 * spent (checked 2026-10-11, Mahara's own accounts left out: 17 to 23 Aug
 * $472.75 live against $2,001.86 in the snapshots; September $8,773.94
 * against $10,472.85). Both tables carry Meta's ad id (metaAdId, ad_id): 500 ad-days
 * from 14 Sep to 2 Oct are in both, and no ad-day missing from one sits in
 * the other under a different id, so filling by ad id never counts a day
 * twice.
 */
function adRowsCte(from, to) {
    return `camp as (
    select distinct on (raw_data->>'campaignName') raw_data->>'campaignName' as name,
           coalesce(nullif(meta_account_id, ''), nullif(raw_data->>'metaAccountId', '')) as account
    from public.cockpit_campaigns
    where coalesce(raw_data->>'campaignName', '') <> ''
    order by raw_data->>'campaignName', synced_at desc
  ),
  live as (
    select c.id::text as client_id, d.day, coalesce(nullif(d.data->>'metaAdId', ''), d.source_id) as ad, d.campaign_name,
           coalesce(nullif(d.data->>'spend', '')::numeric, 0) as spend,
           coalesce(nullif(d.data->>'leads', '')::numeric, 0) as leads
    from public.cockpit_media_daily_stats d
    left join camp on camp.name = d.campaign_name
    left join public.clients c on camp.account is not null and replace(c.meta_ad_account_id, 'act_', '') = camp.account
    where d.day between ${day(from)} and ${day(to)}
  ),
  old as (
    select a.client_id::text as client_id, a.date as day, a.ad_id as ad,
           coalesce(nullif(a.campaign_name, ''), a.campaign_id) as campaign_name,
           a.spend, coalesce(a.leads, 0)::numeric as leads,
           upper(coalesce(nullif(btrim(c.currency), ''), 'USD')) as currency
    from public.ads_daily_snapshots a
    join public.clients c on c.id = a.client_id
    where a.date between ${day(from)} and ${day(to)}
      and (a.spend <> 0 or coalesce(a.leads, 0) <> 0)
      and not exists (select 1 from live l where l.client_id is not null and l.day = a.date and l.ad = a.ad_id)
  )`;
}
/**
 * Client ad spend and leads by client and day (R2, 2026-10-11; Aziz, A006:
 * "client ad spend, leads, and cost per lead ... just use the Supabase
 * table"), from adRowsCte: the live media table's tied rows, plus the frozen
 * snapshot rows for the ad-days the live table lacks, converted to USD with
 * the rate table (a currency with no rate gives a null spend, named by the
 * caller). A client day can have one row from each table; `source` says which
 * (media or frozen), and every caller adds them. A live campaign that ties to
 * nothing is left out here and named by mediaUntiedSql.
 */
export function mediaClientDaysSql(from, to) {
    return `with ${adRowsCte(from, to)},
  media as (
    select client_id, day, sum(spend) as spend_usd, sum(leads) as leads,
           coalesce(jsonb_agg(distinct campaign_name) filter (where spend > 0), '[]'::jsonb) as campaigns,
           'USD'::text as currency
    from live
    where client_id is not null
    group by 1, 2
  ),
  frozen as (
    select client_id, day, sum(spend) * ${usdRateSql("currency")} as spend_usd, sum(leads) as leads,
           coalesce(jsonb_agg(distinct campaign_name) filter (where spend > 0), '[]'::jsonb) as campaigns,
           currency
    from old
    group by client_id, day, currency
  )
  select client_id, to_char(day, 'YYYY-MM-DD') as day, spend_usd, leads, campaigns, currency, 'media' as source from media
  union all
  select client_id, to_char(day, 'YYYY-MM-DD') as day, spend_usd, leads, campaigns, currency, 'frozen' as source from frozen`;
}
/**
 * Campaigns in the live media table with spend in the window that reach no
 * client (named, never dropped silently). An ad-day the frozen snapshot table
 * holds for a client is counted from there, so it is not named here.
 */
export function mediaUntiedSql(from, to) {
    return `with ${adRowsCte(from, to)}
  select l.campaign_name as campaign, round(sum(l.spend), 2) as spend_usd,
         to_char(min(l.day), 'YYYY-MM-DD') as first_day, to_char(max(l.day), 'YYYY-MM-DD') as last_day
  from live l
  where l.client_id is null
    and not exists (select 1 from public.ads_daily_snapshots a join public.clients c on c.id = a.client_id
                    where a.date = l.day and a.ad_id = l.ad)
  group by 1
  having sum(l.spend) > 0
  order by 2 desc`;
}
/**
 * The frozen snapshot ad-days the live table has no tied row for (adRowsCte
 * `old`), one row per ad and day, in USD, with the client's ClickUp card
 * (ad account -> ghl_client_ad_accounts -> ghl_clients.clickup_id), for a
 * series keyed by card that reads the live table by campaign tags (Client
 * success, A127). The caller drops an ad-day it already counted from the
 * live table, so a day is never counted twice.
 */
export function frozenFillByCardSql(from, to) {
    return `with ${adRowsCte(from, to)}
  select g.clickup_id as task_id, to_char(o.day, 'YYYY-MM-DD') as day, o.ad,
         o.spend * ${usdRateSql("o.currency")} as spend_usd, o.leads, o.currency
  from old o
  join public.ghl_client_ad_accounts m on m.client_id::text = o.client_id
  join public.ghl_clients g on g.location_id = m.location_id
  where coalesce(g.clickup_id, '') <> ''`;
}
/**
 * The live media table's own health: the sync marks the feed ready with the
 * row count it wrote; a read whose count differs caught a rewrite in flight.
 * Also the table's first and last day, so callers can say what it covers.
 */
export const MEDIA_FEED_SQL = `select s.ready, s.source_rows,
    floor(extract(epoch from s.source_snapshot_at) * 1000)::bigint as snapshot_ms,
    (select count(*) from public.cockpit_media_daily_stats)::bigint as actual_rows,
    (select to_char(min(day), 'YYYY-MM-DD') from public.cockpit_media_daily_stats) as first_day,
    (select to_char(max(day), 'YYYY-MM-DD') from public.cockpit_media_daily_stats) as last_day
  from public.cockpit_media_feed_state s where s.feed = 'dailyStats'`;
/**
 * Check the media feed row and return when it was written. Throws (the
 * caller's source is then not confirmed) when the feed is missing, not
 * ready, mid-rewrite, empty, or older than `maxAgeMs`.
 */
export function mediaFeedFresh(row, now, maxAgeMs) {
    if (!row)
        throw new Error("The media daily statistics feed has no state row");
    if (row.ready !== true)
        throw new Error("The media daily statistics feed is not ready (the sync may be rewriting it)");
    if (num(row.source_rows) !== num(row.actual_rows))
        throw new Error(`The media daily statistics feed holds ${num(row.actual_rows)} rows against the ${num(row.source_rows)} the sync wrote (a rewrite in flight)`);
    if (!row.first_day || num(row.actual_rows) === 0)
        throw new Error("The media daily statistics table is empty");
    const at = num(row.snapshot_ms);
    if (!(at > 0))
        throw new Error("The media daily statistics feed has no snapshot time");
    if (now - at > maxAgeMs || at - now > 60_000)
        throw new Error(`The media daily statistics feed was last written ${Math.round((now - at) / 3600_000)} hours ago`);
    return { at, firstDay: String(row.first_day), lastDay: row.last_day ? String(row.last_day) : null, rows: num(row.actual_rows) };
}
/** Provisional calendar names: the same words calendarKind() calls provisional, less callbacks and reschedules. */
const PROVISIONAL_SQL = `lower(cal.name) ~ '${PROVISIONAL.source}' and lower(cal.name) !~ 'callback|call-back|reschedul|معاودة'`;
/** The reporting store's time parser (mahara_reporting.cc_time), inline: the read-only role may not execute the function. */
const ccTime = (expr) => `(case when (${expr}) ~ '^\\d{12,14}$' then to_timestamp((${expr})::numeric / 1000)
      when (${expr}) ~ '^\\d{4}-\\d\\d-\\d\\dT.*(Z|[+-]\\d\\d:\\d\\d)$' then (${expr})::timestamptz end)`;
/**
 * Provisional bookings (A113; Aziz, 2026-09-21: "provisional bookings
 * (provisional calendar only)"), one row per tied client, meeting day and
 * calendar. The appointments sync (public.appointments) has never carried
 * the Not Confirmed Appointments calendar, so this reads the call-centre
 * report's own source, mahara_reporting.cc_appointments, rebuilt here from
 * its three inputs because the view calls a function the read-only role
 * cannot run: public.appointments, the dialer's verified bookings
 * (cc_attempts) and the dialer's own GoHighLevel appointment facts, newest
 * version per appointment, Google Calendar copies dropped, exactly as the
 * view does. Kept: a calendar whose name says not confirmed, provisional or
 * tentative (the calendar only, not a main-calendar appointment in status
 * new), no conflict, not deleted at the provider. Dated by the day the
 * meeting is for, like confirmed bookings, and tied to a client through the
 * location when exactly one ad account is on it.
 */
export function provisionalBookingsSql(from, to) {
    return `with records as (
    select coalesce(nullif(ap.ghl_location_id, ''), nullif(ap.ghl_location, '')) as location_id, ap.ghl_appointment_id as id,
           ap.calendar_id, ap.start_at, ap.status, ap.updated_at as version_at, 0 as priority, false as conflict
    from public.appointments ap
    union all
    select a.location_id, a.data->'bookingVerification'->>'id', a.data->'bookingVerification'->>'calendarId',
           ${ccTime("a.data->'bookingVerification'->>'startTime'")},
           a.data->'bookingVerification'->>'appointmentStatus',
           ${ccTime("a.data->'bookingVerification'->>'verifiedAt'")}, 2, false
    from mahara_reporting.cc_attempts a
    where a.data->'disposition'->>'outcome' = 'BOOKED' and a.data->'bookingVerification'->>'verifiedAt' is not null
    union all
    select f.data->>'locationId', f.data->>'id', f.data->>'calendarId',
           ${ccTime("f.data->>'startAt'")},
           case when coalesce(f.data->>'deleted', 'false') = 'true' or coalesce(f.data->>'missingFromProvider', 'false') = 'true' then 'deleted' else f.data->>'status' end,
           f.version_at, 1, f.conflict
    from mahara_reporting.facts f
    where f.namespace = 'production' and f.kind = 'appointment' and f.source = 'ghl'
  ),
  latest as (
    select distinct on (r.location_id, r.id) r.*
    from records r
    where r.location_id is not null and r.id is not null
      and not exists (select 1 from public.appointments g where g.ghl_appointment_id = r.id and g.ghl_source = 'google_calendar')
    order by r.location_id, r.id, r.version_at desc nulls last, r.priority
  ),
  calendars as (
    select distinct on (c.location_id, c.calendar_id) c.location_id, c.calendar_id, c.name
    from (select location_id, calendar_id, name, synced_at from public.ghl_calendars
          union all
          select f.data->>'locationId', f.data->>'id', f.data->>'name', f.version_at
          from mahara_reporting.facts f where f.namespace = 'production' and f.kind = 'calendar') c
    order by c.location_id, c.calendar_id, c.synced_at desc nulls last
  ),
  prov as (
    select a.*, cal.name as calendar
    from latest a
    join calendars cal on cal.location_id = a.location_id and cal.calendar_id = a.calendar_id
    where ${PROVISIONAL_SQL}
      and a.conflict is not true
      and a.status is distinct from 'deleted'
      and a.start_at is not null
      and (a.start_at at time zone 'Asia/Kuwait')::date between ${day(from)} and ${day(to)}
  )
  select one.client_id,
         (g.location_id is not null) as has_client,
         case when g.location_id is not null then to_char(p.start_at at time zone 'Asia/Kuwait', 'YYYY-MM-DD') end as date,
         p.calendar,
         min(g.client_name) as location_client,
         count(*) as count,
         count(*) filter (where p.start_at > now()) as future,
         count(*) filter (where p.priority = 0) as from_appointments,
         max(extract(epoch from p.version_at) * 1000) as fresh_ms
  from prov p
  left join lateral (
    select min(m.client_id::text) as client_id
    from public.ghl_client_ad_accounts m
    where m.location_id = p.location_id
  ) one on true
  left join public.ghl_clients g on g.location_id = p.location_id
  group by 1, 2, 3, 4`;
}
/**
 * Appointments with their client tie. The sync sets `client_id` on most rows;
 * the ones it leaves empty (24 of 157 booking rows in the 30 days to
 * 2026-09-21, twelve of them one client's confirmed appointments) are tied
 * here through the row's GHL location. A location tied to two ad accounts is
 * one client on one card that moved account (clientDelivery folds the rows
 * on a card into one), so the row ties to either; one tied to none stays
 * untied, and the adapter says so. [2026-10-21: it used to need exactly one]
 */
const tied = (where) => `
  select ap.*,
         coalesce(ap.client_id::text, one.client_id) as tie,
         (g.location_id is not null) as has_client,
         g.client_name as location_client
  from public.appointments ap
  left join lateral (
    select min(m.client_id::text) as client_id
    from public.ghl_client_ad_accounts m
    where m.location_id = ap.ghl_location_id
  ) one on true
  left join public.ghl_clients g on g.location_id = ap.ghl_location_id
  where ${where}`;
/**
 * Read client delivery between two Kuwait days, inclusive, plus every past
 * appointment from `recentFrom` with its Mahara OS outcome.
 *
 * Spend and leads come from mediaClientDaysSql: the live media table, already
 * in USD, and the frozen snapshot table for the ad-days the live one lacks,
 * converted with the one rate table (./tap.js USD_PER). An account in
 * a currency that table has no rate for is reported in `unknownCurrencies`
 * and its spend is left out rather than counted at one to one, which would
 * silently understate or inflate it.
 *
 * `options.now` and `options.maxAgeMs` set the media feed's freshness rule
 * (3 hours by default, the media sync's own stale line).
 */
export const MEDIA_STALE_MS = 3 * 3600_000;
export async function clientDelivery(from, to, recentFrom, options = {}) {
    const now = options.now ?? Date.now();
    const [feedRows, dayRows, untiedRows, clientRows, bookingRows, provisionalRows, winRows, appointmentRows, metaRows] = await Promise.all([
        sql(TRIAGE, MEDIA_FEED_SQL),
        sql(TRIAGE, mediaClientDaysSql(from, to)),
        sql(TRIAGE, mediaUntiedSql(from, to)),
        sql(TRIAGE, `with days as (${mediaClientDaysSql(from, to)})
       select c.id::text as client_id,
              c.name as account,
              coalesce(c.hidden_from_dashboard, false) as hidden,
              coalesce(c.currency, 'USD') as currency,
              g.client_name as name,
              g.clickup_id,
              g.service_mode,
              g.status,
              m.matched_by
       from public.clients c
       left join public.ghl_client_ad_accounts m on m.client_id = c.id
       left join public.ghl_clients g on g.location_id = m.location_id
       where c.id::text in (select client_id from days)`),
        // Appointments are dated by the day they are FOR, which is how a cost per
        // booking is read. `future` carries the ones that have not happened yet, so
        // the screen can show a comparable "due" figure and still say how many are
        // coming, instead of a number that silently grows all month. Rows on a
        // location with no client card collapse into one line per calendar: they
        // are counted for a note, never by day. Provisional calendar rows are
        // read from the reporting store below instead (it includes these rows,
        // so a calendar the sync starts to cover is never counted twice).
        sql(TRIAGE, `with ap as (${tied(`(ap.start_at at time zone 'Asia/Kuwait')::date between ${day(from)} and ${day(to)}`)})
       select ap.tie as client_id,
              ap.has_client,
              case when ap.has_client then to_char(ap.start_at at time zone 'Asia/Kuwait', 'YYYY-MM-DD') end as date,
              coalesce(cal.name, '') as calendar,
              min(ap.location_client) as location_client,
              count(*) as count,
              count(*) filter (where ap.start_at > now()) as future,
              max(extract(epoch from ap.updated_at) * 1000) as fresh_ms
       from ap
       left join public.ghl_calendars cal on cal.calendar_id = ap.calendar_id
       group by 1, 2, 3, 4`),
        sql(TRIAGE, provisionalBookingsSql(from, to)),
        // A close in the client's own CRM: an opportunity moved to won, dated by
        // the day the stage changed. Kept as the second source beside the Mahara
        // OS close rate; few clients mark wins, so it reads low by construction.
        sql(TRIAGE, `select m.client_id::text as client_id,
              to_char(coalesce(o.last_stage_change_at, o.updated_at) at time zone 'Asia/Kuwait', 'YYYY-MM-DD') as date,
              count(*) as count,
              sum(coalesce(o.monetary_value, 0)) as value
       from public.client_opportunities o
       join public.ghl_client_ad_accounts m on m.location_id = o.location_id
       where o.status = 'won'
         and (coalesce(o.last_stage_change_at, o.updated_at) at time zone 'Asia/Kuwait')::date between ${day(from)} and ${day(to)}
       group by 1, 2`),
        // One row per past appointment since `recentFrom`, with the CRM status,
        // the attendance sheet's mark and Mahara OS's outcome at its highest
        // revision (portal_data.appointment_outcomes.appointment_id is the GHL
        // appointment id). Cancelled and invalid never count for anything, so
        // they are not read. The calendar name comes back and is classified
        // here, so the booking rule lives in one place.
        sql(TRIAGE, `with ap as (${tied(`ap.start_at <= now()
           and (ap.start_at at time zone 'Asia/Kuwait')::date between ${day(recentFrom)} and ${day(to)}
           and ap.status is distinct from 'cancelled' and ap.status is distinct from 'invalid'`)})
       select ap.tie as client_id,
              to_char(ap.start_at at time zone 'Asia/Kuwait', 'YYYY-MM-DD HH24:MI') as at,
              coalesce(cal.name, '') as calendar,
              ap.status,
              ap.attended,
              o.attendance,
              o.deal,
              (o.appointment_id is not null) as has_outcome
       from ap
       left join public.ghl_calendars cal on cal.calendar_id = ap.calendar_id
       left join lateral (
         select o.appointment_id, o.attendance, o.deal
         from portal_data.appointment_outcomes o
         where o.appointment_id = ap.ghl_appointment_id
         order by o.revision desc
         limit 1
       ) o on true
       where ap.tie is not null
       order by ap.start_at desc`),
        // Facts the notes need: how many locations carry the provisional
        // calendar, whether the appointments sync has ever carried a row of it,
        // and how far Mahara OS's outcomes reach.
        sql(TRIAGE, `select (select count(*) from public.ghl_calendars cal where cal.name ~* '${PROVISIONAL.source}') as provisional_calendars,
              (select string_agg(distinct cal.name, '|') from public.ghl_calendars cal where cal.name ~* '${PROVISIONAL.source}') as provisional_names,
              (select count(*) from public.appointments ap join public.ghl_calendars cal on cal.calendar_id = ap.calendar_id
                 where cal.name ~* '${PROVISIONAL.source}') as provisional_rows,
              (select count(*) from portal_data.appointment_outcomes) as outcome_rows,
              (select count(distinct o.appointment_id) from portal_data.appointment_outcomes o
                 join public.appointments ap on ap.ghl_appointment_id = o.appointment_id) as outcomes_joined,
              (select to_char(min(o.captured_at) at time zone 'Asia/Kuwait', 'YYYY-MM-DD') from portal_data.appointment_outcomes o) as outcomes_since,
              (select max(o.captured_at) from portal_data.appointment_outcomes o) as outcomes_latest`),
    ]);
    // A feed mid-rewrite or stale is not a source: the caller says so and
    // falls back, rather than showing missing spend as zero.
    const feed = mediaFeedFresh(feedRows[0], now, options.maxAgeMs ?? MEDIA_STALE_MS);
    const unknown = new Set();
    const clients = [];
    const own = new Set();
    // A client taken off the dashboards is off them everywhere: out of the
    // list, out of the company totals, out of every average (Aziz, 2026-09-22
    // about ريبالو, "I don't think that's a client... you can remove them for
    // now"). Dropped here rather than in six queries, so nothing can be
    // filtered in one place and counted in another. Put it back with
    // ceo/clientVisibility:show.
    const hiddenClients = new Set(clientRows.filter(r => r.hidden === true).map(r => String(r.client_id)));
    for (const r of clientRows) {
        if (hiddenClients.has(String(r.client_id)))
            continue;
        const account = String(r.account ?? "");
        const clientId = String(r.client_id);
        if (OWN_ACCOUNTS.has(fold(account))) {
            own.add(clientId);
            continue;
        }
        clients.push({
            clientId,
            account,
            name: String(r.name ?? account),
            clickupTaskId: r.clickup_id ? String(r.clickup_id) : null,
            matchedBy: r.matched_by ? String(r.matched_by) : null,
            serviceMode: r.service_mode ? String(r.service_mode) : null,
            status: r.status ? String(r.status) : null,
            currency: String(r.currency ?? "USD").toUpperCase(),
            campaigns: 0,
        });
    }
    // One ClickUp card is one client, however many ad accounts it runs. When a
    // client moves to a new account the old one keeps its spend for the week
    // (Munshaat Khalida, 2026-10-20), and two rows on one card made Delivery
    // publish that card twice and refuse. Rows on a card fold into the first,
    // and every day, booking, win and appointment of the others is counted
    // under it. [2026-10-21]
    const canonical = new Map();
    const byCard = new Map();
    for (const c of clients) {
        const first = c.clickupTaskId ? byCard.get(c.clickupTaskId) : undefined;
        if (first) {
            canonical.set(c.clientId, first.clientId);
            continue;
        }
        if (c.clickupTaskId)
            byCard.set(c.clickupTaskId, c);
        canonical.set(c.clientId, c.clientId);
    }
    const folded = clients.filter(c => canonical.get(c.clientId) === c.clientId);
    clients.length = 0;
    clients.push(...folded);
    const canon = (id) => canonical.get(id) ?? id;
    const known = new Set(canonical.keys());
    const days = [];
    const recentCampaigns = new Map();
    const recentFrom3 = addDaysTo(to, -2);
    let frozenRows = 0;
    for (const r of dayRows) {
        const clientId = String(r.client_id);
        if (own.has(clientId) || hiddenClients.has(clientId) || !known.has(clientId))
            continue;
        if (r.source === "frozen")
            frozenRows += 1;
        if (r.spend_usd === null || r.spend_usd === undefined) {
            // Only the frozen table carries an account currency; no rate, no spend.
            unknown.add(String(r.currency ?? "unknown"));
            continue;
        }
        const date = String(r.day);
        days.push({
            clientId: canon(clientId),
            date,
            spend: Math.round(num(r.spend_usd) * 100) / 100,
            leads: num(r.leads),
            source: r.source === "frozen" ? "frozen" : "media",
        });
        // Campaigns that spent in the last three days of the window, counted once.
        if (date >= recentFrom3 && date <= to) {
            const list = Array.isArray(r.campaigns) ? r.campaigns : typeof r.campaigns === "string" ? JSON.parse(r.campaigns) : [];
            const set = recentCampaigns.get(canon(clientId)) ?? new Set();
            for (const name of list)
                set.add(String(name));
            recentCampaigns.set(canon(clientId), set);
        }
    }
    for (const c of clients)
        c.campaigns = recentCampaigns.get(c.clientId)?.size ?? 0;
    let bookingsFresh = 0;
    const bookings = [];
    const held = new Map();
    const seen = {
        main: new Set(),
        online: new Set(),
        provisional: new Set(),
    };
    const untied = [];
    const noClient = { rows: 0, calendars: new Set() };
    const takeBooking = (r, kind, calendar) => {
        const count = num(r.count);
        if (r.has_client !== true) {
            noClient.rows += count;
            if (calendar)
                noClient.calendars.add(calendar);
            return;
        }
        const clientId = r.client_id ? String(r.client_id) : null;
        if (clientId && (own.has(clientId) || hiddenClients.has(clientId)))
            return;
        if (!clientId || !known.has(clientId)) {
            // A client's booking that reaches no client row: untied, or a client
            // with no ad spend in the window (the table is clients with spend).
            if (isBookingKind(kind))
                untied.push({
                    date: String(r.date),
                    client: String(r.location_client ?? "a client with no card name"),
                    count,
                });
            return;
        }
        if (!isBookingKind(kind)) {
            const h = held.get(kind) ?? { count: 0, names: new Set() };
            h.count += count;
            if (calendar)
                h.names.add(calendar);
            held.set(kind, h);
            return;
        }
        seen[kind].add(calendar);
        bookings.push({
            clientId: canon(clientId),
            date: String(r.date),
            kind,
            count,
            future: num(r.future),
        });
    };
    for (const r of bookingRows) {
        bookingsFresh = Math.max(bookingsFresh, num(r.fresh_ms));
        const calendar = String(r.calendar ?? "");
        const kind = calendarKind(calendar);
        // Provisional comes from the reporting store, which already holds
        // these rows; counting them here too would count them twice.
        if (kind === "provisional")
            continue;
        takeBooking(r, kind, calendar);
    }
    let provisionalRows180 = 0;
    let provisionalFresh = 0;
    for (const r of provisionalRows) {
        provisionalRows180 += num(r.count);
        provisionalFresh = Math.max(provisionalFresh, num(r.fresh_ms));
        takeBooking(r, "provisional", String(r.calendar ?? ""));
    }
    const wins = [];
    for (const r of winRows) {
        const clientId = String(r.client_id);
        if (own.has(clientId) || hiddenClients.has(clientId) || !known.has(clientId))
            continue;
        wins.push({
            clientId: canon(clientId),
            date: String(r.date),
            count: num(r.count),
            value: num(r.value),
        });
    }
    const appointments = [];
    for (const r of appointmentRows) {
        const clientId = String(r.client_id);
        if (own.has(clientId) || hiddenClients.has(clientId) || !known.has(clientId))
            continue;
        const calendar = String(r.calendar ?? "");
        const kind = calendarKind(calendar);
        if (!isBookingKind(kind))
            continue;
        const at = String(r.at);
        appointments.push({
            clientId: canon(clientId),
            date: at.slice(0, 10),
            at,
            kind,
            calendar,
            status: r.status ? String(r.status) : null,
            attended: typeof r.attended === "boolean" ? r.attended : null,
            outcome: r.has_outcome === true
                ? {
                    attendance: r.attendance ? String(r.attendance) : null,
                    deal: r.deal ? String(r.deal) : null,
                }
                : null,
        });
    }
    const meta = metaRows[0] ?? {};
    const spent = new Set(days.filter(d => d.spend > 0).map(d => d.clientId));
    const unmapped = clients
        .filter(c => !c.clickupTaskId && spent.has(c.clientId))
        .map(c => c.account)
        .sort();
    return {
        clients,
        days,
        bookings,
        wins,
        appointments,
        adsFreshAt: feed.at,
        bookingsFreshAt: bookingsFresh > 0 ? bookingsFresh : undefined,
        unmapped,
        unknownCurrencies: [...unknown].sort(),
        media: {
            firstDay: feed.firstDay,
            lastDay: feed.lastDay,
            rows: feed.rows,
            frozenRows,
            untied: untiedRows.map(r => ({
                campaign: String(r.campaign ?? ""),
                spend: Math.round(num(r.spend_usd) * 100) / 100,
                firstDay: r.first_day ? String(r.first_day) : null,
                lastDay: r.last_day ? String(r.last_day) : null,
            })),
        },
        notBookings: [...held.entries()]
            .map(([kind, h]) => ({
            kind,
            count: h.count,
            calendars: [...h.names].sort(),
        }))
            .sort((a, b) => b.count - a.count),
        calendarNames: {
            main: [...seen.main].sort(),
            online: [...seen.online].sort(),
            provisional: [...seen.provisional].sort(),
        },
        untied,
        noClientLocation: {
            rows: noClient.rows,
            calendars: [...noClient.calendars].sort(),
        },
        provisional: {
            calendars: num(meta.provisional_calendars),
            names: String(meta.provisional_names ?? "")
                .split("|")
                .filter(Boolean)
                .sort(),
            // Provisional calendar rows over the read window, from the
            // reporting store; and how many of them the appointments sync holds.
            rowsEver: provisionalRows180,
            inAppointmentsSync: num(meta.provisional_rows),
            freshAt: provisionalFresh > 0 ? provisionalFresh : undefined,
            source: "call-centre reporting store",
        },
        outcomes: {
            rows: num(meta.outcome_rows),
            joined: num(meta.outcomes_joined),
            since: meta.outcomes_since ? String(meta.outcomes_since) : null,
            latestAt: ms(meta.outcomes_latest),
        },
    };
}
/** The Kuwait day n days from `d` (time.js addDays, kept local so this module stays self-contained). */
function addDaysTo(d, n) {
    return new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}
