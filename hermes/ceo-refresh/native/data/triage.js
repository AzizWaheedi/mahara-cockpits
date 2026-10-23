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
 * `old`: public.ads_daily_snapshots, in the account's own currency with the
 * client on the row. Its own sync stopped on 2026-10-02; since 2026-10-18 the
 * Meta dashboard feed (20261018120000_meta_dashboard_feed.sql) keeps it
 * current from cockpit_meta_ad_days every 10 minutes, so it holds every day.
 * It fills only the ad-days the live table has no tied row for. The live
 * table is the board's sync: it lacks campaigns with no card and drops a
 * campaign's rows when it leaves the board, so from 13 Aug to mid-September
 * it holds a fraction of what clients spent (checked 2026-10-11, Mahara's own
 * accounts left out: 17 to 23 Aug $472.75 live against $2,001.86 in the
 * snapshots; September $8,773.94 against $10,472.85). Both tables carry
 * Meta's ad id (metaAdId, ad_id): 500 ad-days from 14 Sep to 2 Oct are in
 * both, and no ad-day missing from one sits in the other under a different
 * id, so filling by ad id never counts a day twice. In 14 to 20 Oct 2026 the
 * fill carried $589.94: an outsider's campaign on SAFAD's account ($375.09),
 * Pidco ($200.23) and Triple Edge ($14.62).
 *
 * Ads on the compromise list (public.cockpit_excluded_ads, outsiders' ads run
 * on a client's account) never count, in either table (R3, 2026-10-22): the
 * media publish never deletes their old rows, so the reader drops them. The
 * snapshot table's trigger already keeps them out; the filter there is a
 * second guard.
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
      and not exists (select 1 from public.cockpit_excluded_ads x where x.ad_id = coalesce(nullif(d.data->>'metaAdId', ''), d.source_id))
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
      and not exists (select 1 from public.cockpit_excluded_ads x where x.ad_id = a.ad_id)
  )`;
}
/**
 * Client ad spend and leads by client and day (R2, 2026-10-11; Aziz, A006:
 * "client ad spend, leads, and cost per lead ... just use the Supabase
 * table"), from adRowsCte: the live media table's tied rows, plus the
 * snapshot rows for the ad-days the live table lacks, converted to USD with
 * the rate table (a currency with no rate gives a null spend, named by the
 * caller). A client day can have one row from each table; `source` says which
 * (media, or frozen for the snapshot table: the name it had while its own
 * sync was stopped), and every caller adds them. A live campaign that ties to
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
 * client (named, never dropped silently). An ad-day the snapshot table
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
 * The snapshot table's ad-days the live table has no tied row for (adRowsCte
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
/**
 * Client bookings from the Client Performance board (R2, 2026-10-22), the
 * one booking rule every cockpit now reads: public.cockpit_client_days, one
 * row per GoHighLevel location and Kuwait day, written only by
 * cockpit_board_facts_refresh. confirmed_bookings is main and online
 * calendar bookings made that day, leaving out cancelled, invalid, Google
 * Calendar copies, the call centre's call-back bookings and rescheduled
 * bookings whose original still counts; provisional_bookings is the Not
 * Confirmed Appointments calendar. NULL means the board did not store the
 * count, which is never read as zero: a day with no row, or a NULL count, is
 * "not measured". Only stored rows are read; a missing day is the same as a
 * NULL one. The location reaches a ClickUp card through
 * cockpit_board_clients. Both tables grant SELECT to service_role only;
 * this read runs as the read-only SQL role, which reads every table.
 */
export function boardBookingDaysSql(from, to) {
    return `select b.location_id, b.clickup_id, b.client_name, b.status, b.service_mode,
         to_char(d.day, 'YYYY-MM-DD') as date,
         d.confirmed_bookings as confirmed,
         d.provisional_bookings as provisional,
         floor(extract(epoch from d.computed_at) * 1000)::bigint as computed_ms
  from public.cockpit_client_days d
  join public.cockpit_board_clients b on b.location_id = d.location_id
  where d.day between ${day(from)} and ${day(to)}
    and (d.confirmed_bookings is not null or d.provisional_bookings is not null)
  order by b.location_id, d.day`;
}
/**
 * The ad accounts with spend in the window and the client each one belongs
 * to (R2, 2026-10-22). The board's tie comes first: an account listed in a
 * cockpit_board_clients row's ad_account_ids (the board's own lead-sync-watch
 * order and the hand ties of 20261016210200) gives that row's location, card,
 * name, service mode and status. An account on two board rows counts once,
 * under the first location, and `board_rows` says how many rows list it. Only
 * an account the board does not list falls back to the GoHighLevel tie
 * (ghl_client_ad_accounts, then that location's board row or ghl_clients),
 * which a cancelled client with no account on the board still has.
 *
 * Only when neither tie exists is public.cockpit_churned_ad_accounts read
 * (the CEO, 23 Oct 2026, cost per booking decisions, 5: "triple edge is a old
 * churned client"): the account takes the list's client name and the status
 * "Churned", so the gone rule keeps it out of the live client rows and its
 * spend is named as a churned client's, never dropped and never "tied to no
 * client". A live tie always wins over the list. The worker reads the table
 * as the read-only role, which bypasses its row security; a missing table
 * fails this read, so the section keeps its labelled fallback, never zeros.
 */
export function clientTiesSql(from, to) {
    return `with days as (${mediaClientDaysSql(from, to)})
  select c.id::text as client_id,
         c.name as account,
         coalesce(c.hidden_from_dashboard, false) as hidden,
         coalesce(c.currency, 'USD') as currency,
         nullif(replace(coalesce(c.meta_ad_account_id, ''), 'act_', ''), '') as ad_account,
         coalesce(ba.location_id, bg.location_id, m.location_id) as location_id,
         coalesce(ba.client_name, bg.client_name, g.client_name, f.client_name) as name,
         coalesce(ba.clickup_id, bg.clickup_id, g.clickup_id) as clickup_id,
         coalesce(ba.service_mode, bg.service_mode, g.service_mode) as service_mode,
         coalesce(ba.status, bg.status, g.status, f.status) as status,
         case when ba.location_id is not null then 'board ad account' else m.matched_by end as matched_by,
         coalesce(ba.boards, 0) as board_rows,
         (ba.location_id is not null or bg.location_id is not null) as on_board
  from public.clients c
  left join lateral (
    select b.location_id, b.client_name, b.clickup_id, b.service_mode, b.status, count(*) over () as boards
    from public.cockpit_board_clients b
    where nullif(replace(coalesce(c.meta_ad_account_id, ''), 'act_', ''), '') = any (b.ad_account_ids)
    order by b.location_id
    limit 1
  ) ba on true
  left join lateral (
    select m.location_id, m.matched_by
    from public.ghl_client_ad_accounts m
    where ba.location_id is null and m.client_id = c.id
    order by m.location_id
    limit 1
  ) m on true
  left join lateral (
    select g.client_name, g.clickup_id, g.service_mode, g.status
    from public.ghl_clients g
    where g.location_id = m.location_id
    limit 1
  ) g on true
  left join public.cockpit_board_clients bg on bg.location_id = m.location_id
  left join public.cockpit_churned_ad_accounts f
    on f.account_id = nullif(replace(coalesce(c.meta_ad_account_id, ''), 'act_', ''), '')
   and ba.location_id is null and m.location_id is null
  where c.id::text in (select client_id from days)`;
}
/**
 * Appointments with their client tie, for the show rate, the close rate and
 * the no-outcome list only: those need the meeting to have happened, so
 * they are dated by the day of the meeting. Bookings are never counted from
 * here (boardBookingDaysSql). The sync sets `client_id` on most rows; the
 * ones it leaves empty are tied here through the row's GHL location. A
 * location tied to two ad accounts is one client on one card that moved
 * account (clientDelivery folds the rows on a card into one), so the row
 * ties to either; one tied to none stays untied.
 */
const tied = (where) => `
  select ap.*,
         coalesce(ap.client_id::text, one.client_id) as tie
  from public.appointments ap
  left join lateral (
    select min(m.client_id::text) as client_id
    from public.ghl_client_ad_accounts m
    where m.location_id = ap.ghl_location_id
  ) one on true
  where ${where}`;
/**
 * The board's booking read came back empty or failed. The section keeps its
 * last good payload rather than show bookings as zero or fall back to a
 * count with a different rule (R2, 2026-10-22).
 */
export class BoardBookingsUnreadable extends Error {
    constructor(message) {
        super(message);
        this.name = "BoardBookingsUnreadable";
    }
}
/** Card statuses whose spend is named as money on a lost client. */
export const GONE_STATUS = /cancel|stopped|churn/i;
/**
 * The cost per lead lines the Client Performance board judges against
 * (cockpit_board_targets, metric cpl): the board default and each client's
 * own line by ClickUp card. An absent row is the official gate
 * (cockpit_board_default_targets(), which this read-only role cannot run, is
 * pinned to kpi.ts). Read once per run for decision 4 (the CEO, 23 Oct 2026):
 * spend with no lead is bad at NO_LEAD_MULTIPLE x the client's line.
 */
export const CPL_TARGETS_SQL = `select scope_key, good from public.cockpit_board_targets
  where metric = 'cpl' and (scope_key = 'defaults' or scope_key like 'client:%')`;
/**
 * The rows of CPL_TARGETS_SQL as `{ defaults, byCard }`: a line is a positive
 * number or absent, never zero. A row with a bad value is skipped, so the
 * client falls back to the default line, then the gate.
 */
export function cplTargetsOf(rows) {
    let defaults = null;
    const byCard = {};
    for (const r of rows ?? []) {
        const good = r.good === null || r.good === undefined || r.good === "" ? NaN : Number(r.good);
        if (!(Number.isFinite(good) && good > 0))
            continue;
        const key = String(r.scope_key ?? "");
        if (key === "defaults")
            defaults = good;
        else if (key.startsWith("client:") && key.length > 7)
            byCard[key.slice(7)] = good;
    }
    return { defaults, byCard };
}
/**
 * Read client delivery between two Kuwait days, inclusive, plus every past
 * appointment from `recentFrom` with its Mahara OS outcome.
 *
 * Spend and leads come from mediaClientDaysSql: the live media table, already
 * in USD, and the snapshot table for the ad-days the live one lacks,
 * converted with the one rate table (./tap.js USD_PER), ads on the compromise
 * list left out. An account in a currency that table has no rate for is
 * reported in `unknownCurrencies` and its spend is left out rather than
 * counted at one to one, which would silently understate or inflate it.
 *
 * Bookings are the board's stored counts (boardBookingDaysSql), by the day
 * the booking was made, per location; each client carries the locations its
 * ad accounts tie to (clientTiesSql), and the adapter pairs them
 * (./deliveryClients.js). `bookingsDayFreshAt` is, per day, when the board
 * last computed that day's counts, so the adapter can tell a count that is
 * stale, or was taken before its day ended, from a final one.
 *
 * `options.now` and `options.maxAgeMs` set the media feed's freshness rule
 * (3 hours by default, the media sync's own stale line).
 */
export const MEDIA_STALE_MS = 3 * 3600_000;
export async function clientDelivery(from, to, recentFrom, options = {}) {
    const now = options.now ?? Date.now();
    const boardRead = sql(TRIAGE, boardBookingDaysSql(from, to)).catch(e => {
        throw new BoardBookingsUnreadable(`The Client Performance board's booking days (cockpit_client_days) could not be read: ${String(e instanceof Error ? e.message : e).slice(0, 160)}`);
    });
    // The client cost per lead lines: a failed read is said by the adapter and
    // every client falls back to the gate, the board's own default.
    const targetsRead = sql(TRIAGE, CPL_TARGETS_SQL).then(rows => ({ ok: true, ...cplTargetsOf(rows) }), e => ({
        ok: false,
        defaults: null,
        byCard: {},
        error: String(e instanceof Error ? e.message : e).slice(0, 160),
    }));
    const [feedRows, dayRows, untiedRows, clientRows, boardRows, winRows, appointmentRows, metaRows, cplTargets] = await Promise.all([
        sql(TRIAGE, MEDIA_FEED_SQL),
        sql(TRIAGE, mediaClientDaysSql(from, to)),
        sql(TRIAGE, mediaUntiedSql(from, to)),
        sql(TRIAGE, clientTiesSql(from, to)),
        boardRead,
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
        // here, so the booking rule lives in one place. Dated by the day of the
        // meeting: show and close rates need the meeting to have happened.
        // Google Calendar copies of a booking are left out with the board's
        // own predicate (20261021l): a copy is never marked, so it would only
        // swell the "no outcome" counts (26 in 22 Sep to 21 Oct 2026).
        sql(TRIAGE, `with ap as (${tied(`ap.start_at <= now()
           and (ap.start_at at time zone 'Asia/Kuwait')::date between ${day(recentFrom)} and ${day(to)}
           and ap.status is distinct from 'cancelled' and ap.status is distinct from 'invalid'
           and coalesce(ap.ghl_source, '') <> 'google_calendar'`)})
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
        // How far Mahara OS's outcomes reach.
        sql(TRIAGE, `select (select count(*) from portal_data.appointment_outcomes) as outcome_rows,
              (select count(distinct o.appointment_id) from portal_data.appointment_outcomes o
                 join public.appointments ap on ap.ghl_appointment_id = o.appointment_id) as outcomes_joined,
              (select to_char(min(o.captured_at) at time zone 'Asia/Kuwait', 'YYYY-MM-DD') from portal_data.appointment_outcomes o) as outcomes_since,
              (select max(o.captured_at) from portal_data.appointment_outcomes o) as outcomes_latest`),
        targetsRead,
    ]);
    // A feed mid-rewrite or stale is not a source: the caller says so and
    // falls back, rather than showing missing spend as zero.
    const feed = mediaFeedFresh(feedRows[0], now, options.maxAgeMs ?? MEDIA_STALE_MS);
    // No stored booking day for any client in the whole window is a failed
    // read, never zero bookings: the section keeps its last good payload.
    if (boardRows.length === 0)
        throw new BoardBookingsUnreadable(`The Client Performance board stores no booking day for any client from ${from} to ${to} (cockpit_client_days), so bookings were not read`);
    const unknown = new Set();
    const clients = [];
    const own = new Set();
    const sharedAccounts = [];
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
        if (num(r.board_rows) > 1)
            sharedAccounts.push({ account: String(r.ad_account ?? account), client: String(r.name ?? account), rows: num(r.board_rows) });
        clients.push({
            clientId,
            account,
            adAccount: r.ad_account ? String(r.ad_account) : null,
            name: String(r.name ?? account),
            clickupTaskId: r.clickup_id ? String(r.clickup_id) : null,
            matchedBy: r.matched_by ? String(r.matched_by) : null,
            serviceMode: r.service_mode ? String(r.service_mode) : null,
            status: r.status ? String(r.status) : null,
            currency: String(r.currency ?? "USD").toUpperCase(),
            locationIds: r.location_id && r.on_board === true ? [String(r.location_id)] : [],
            campaigns: 0,
        });
    }
    // One ClickUp card is one client, however many ad accounts it runs. When a
    // client moves to a new account the old one keeps its spend for the week
    // (Munshaat Khalida, 2026-10-20), and two rows on one card made Delivery
    // publish that card twice and refuse. Rows on a card fold into the first,
    // and every day, booking location, win and appointment of the others is
    // counted under it. [2026-10-21]
    const canonical = new Map();
    const byCard = new Map();
    // Each account's own Service Mode, kept on its days before the fold: a
    // card with one Done With You account and one we book for leaves out
    // only the first's spend from company costs per booking (decision 2,
    // contract 1.2; the card's row keeps the first account's mode).
    const modeOf = new Map(clients.map(c => [c.clientId, c.serviceMode]));
    for (const c of clients) {
        const first = c.clickupTaskId ? byCard.get(c.clickupTaskId) : undefined;
        if (first) {
            canonical.set(c.clientId, first.clientId);
            for (const loc of c.locationIds)
                if (!first.locationIds.includes(loc))
                    first.locationIds.push(loc);
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
            // Only the snapshot table carries an account currency; no rate, no spend.
            unknown.add(String(r.currency ?? "unknown"));
            continue;
        }
        const date = String(r.day);
        days.push({
            clientId: canon(clientId),
            date,
            // Unrounded: every caller rounds once after adding, as the board
            // does, so a week never drifts a cent from it.
            spend: num(r.spend_usd),
            leads: num(r.leads),
            source: r.source === "frozen" ? "frozen" : "media",
            serviceMode: modeOf.get(clientId) ?? null,
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
    // The board's stored days, as they are: a NULL count stays null.
    const count = (x) => x === null || x === undefined || x === "" ? null : num(x);
    const tiedLocations = new Set(clients.flatMap(c => c.locationIds));
    const bookingDays = [];
    const untied = [];
    let bookingsFresh = 0;
    const bookingsDayFreshAt = {};
    for (const r of boardRows) {
        const computed = num(r.computed_ms);
        bookingsFresh = Math.max(bookingsFresh, computed);
        const dayKey = String(r.date);
        bookingsDayFreshAt[dayKey] = Math.max(bookingsDayFreshAt[dayKey] ?? 0, computed);
        const row = {
            locationId: String(r.location_id),
            clickupTaskId: r.clickup_id ? String(r.clickup_id) : null,
            client: String(r.client_name ?? r.location_id),
            status: r.status ? String(r.status) : null,
            // The board row's Service Mode: a Done With You location's
            // bookings leave every company cost per booking (decision 2).
            serviceMode: r.service_mode ? String(r.service_mode) : null,
            date: String(r.date),
            confirmed: count(r.confirmed),
            provisional: count(r.provisional),
        };
        bookingDays.push(row);
        // A booking on a client this section has no ad account for (no spend
        // read, or no account tied): named, in no figure.
        const booked = (row.confirmed ?? 0) + (row.provisional ?? 0);
        if (!tiedLocations.has(row.locationId) && booked > 0)
            untied.push({ date: row.date, client: row.client, status: row.status, count: booked });
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
        // Show and close rates read the main and online calendars only.
        if (kind !== "main" && kind !== "online")
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
    // A lost client (cancelled, stopped or churned) is named in the lost
    // client note, not as an account tied to no card (decision 5).
    const unmapped = clients
        .filter(c => !c.clickupTaskId && spent.has(c.clientId) && !GONE_STATUS.test(c.status ?? ""))
        .map(c => c.account)
        .sort();
    return {
        clients,
        days,
        bookingDays,
        wins,
        appointments,
        adsFreshAt: feed.at,
        bookingsFreshAt: bookingsFresh > 0 ? bookingsFresh : undefined,
        bookingsDayFreshAt,
        unmapped,
        sharedAccounts,
        cplTargets,
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
        untied,
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
