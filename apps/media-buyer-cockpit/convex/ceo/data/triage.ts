import { ms, num, sql, TRIAGE } from "../sb";
import { USD_PER } from "./tap";

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

const fold = (s: unknown) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");

/** One client's delivery identity, as Creative Triage knows it. */
export type TriageClient = {
  /** The ad account's client id in Creative Triage. */
  clientId: string;
  /** The ad account name. */
  account: string;
  /** The client card name from GHL, when the account maps to one. */
  name: string;
  /** The ClickUp card id, through public.ghl_client_ad_accounts. */
  clickupTaskId: string | null;
  /** How the account was tied to the client, e.g. "meta_exact". Null when untied. */
  matchedBy: string | null;
  /** DFY, DWY, or null when the CSM has not set Service Mode. */
  serviceMode: string | null;
  /** The client's status in GHL (Active, Cancelled, ...), or null when untied. */
  status: string | null;
  /** The account's own currency, as Meta reports it. */
  currency: string;
  /** Distinct Meta campaigns with a row in the window. */
  campaigns: number;
};

export type TriageDay = {
  clientId: string;
  date: string;
  /** Spend converted to USD with the one fixed table the cockpit uses. */
  spend: number;
  leads: number;
};

/**
 * What a client's calendar is for. A client location carries several, and only
 * some of them mean "an appointment was booked".
 *
 * Aziz's three booking groups (2026-09-21), by calendar name:
 *
 * - `main`: `Main Appointment Calendar`, `A. Appointment Calendar (In Office)`
 *   and `A. Appointment Calendar (In Home)`.
 * - `online`: `A. Appointment Calendar (Online)`.
 * - `provisional`: `Not Confirmed Appointments`, a hold that is not yet a
 *   confirmed booking. It is configured on 46 client locations and has
 *   produced **zero** appointment rows, ever (checked 2026-09-19 and again
 *   2026-09-21). It is classified anyway, so that the day it starts syncing
 *   it is counted apart instead of silently inflating the confirmed figure.
 *
 * Confirmed bookings are main plus online; total bookings add provisional.
 *
 * Held apart and never counted as a booking: `Callback Calendar [AGENTS ONLY]`
 * (an agent's callback queue, also never synced a row), `A. Reschedule
 * Calendar` (the original appointment is already on the main calendar, so
 * counting both would book one meeting twice), and everything else (`Follow
 * Up Call`, `Consultation`, test calendars, and the Arabic-named calendars of
 * a location that has no client card).
 */
export type CalendarKind =
  | "main"
  | "online"
  | "provisional"
  | "callback"
  | "reschedule"
  | "other";

/** The kinds that count as a booking. */
export type BookingKind = "main" | "online" | "provisional";

/** The provisional calendar's names; shared with the SQL that counts its rows. */
const PROVISIONAL = /not confirmed|provisional|tentative/;

export function calendarKind(name: string | null | undefined): CalendarKind {
  const n = String(name ?? "").toLowerCase();
  if (!n) return "other";
  if (/callback|call-back|معاودة/.test(n)) return "callback";
  if (PROVISIONAL.test(n)) return "provisional";
  if (/reschedul/.test(n)) return "reschedule";
  if (/appointment calendar|main appointment/.test(n))
    return /online/.test(n) ? "online" : "main";
  return "other";
}

export function isBookingKind(kind: CalendarKind): kind is BookingKind {
  return kind === "main" || kind === "online" || kind === "provisional";
}

export type TriageBooking = {
  clientId: string;
  /** The Kuwait day the appointment is for. */
  date: string;
  kind: BookingKind;
  count: number;
  /** Of `count`, how many start after now and so cannot have happened yet. */
  future: number;
};

/**
 * One appointment on a booking calendar whose time has passed, with what the
 * three sources say about it. No contact identity, by design: the CEO
 * payloads never carry a lead's name or phone.
 */
export type TriageAppointment = {
  clientId: string;
  /** The Kuwait day the appointment was for. */
  date: string;
  /** Kuwait day and time, "YYYY-MM-DD HH:MM". */
  at: string;
  kind: BookingKind;
  calendar: string;
  /** The CRM's status: confirmed, showed, noshow, new, ... (cancelled and invalid are never read). */
  status: string | null;
  /** The attendance sheet's mark, or null when it marked nothing. */
  attended: boolean | null;
  /**
   * Mahara OS's outcome at its highest revision: attendance is showed,
   * no_show or unknown; deal is won, lost, pending or unknown. Null when
   * Mahara OS holds no row for the appointment.
   */
  outcome: { attendance: string | null; deal: string | null } | null;
};

export type Attendance = "showed" | "noshow" | "unknown";

/**
 * Whether a past appointment was shown, the same rule for the show rate and
 * the close rate: the CRM status when it says showed or noshow; else the
 * attendance sheet's mark; else Mahara OS's attendance. A cancelled or
 * invalid appointment is never shown or missed, and one nobody marked is
 * unknown, which no rate counts.
 */
export function attendanceOf(
  a: Pick<TriageAppointment, "status" | "attended" | "outcome">,
): Attendance {
  if (a.status === "cancelled" || a.status === "invalid") return "unknown";
  if (a.status === "showed") return "showed";
  if (a.status === "noshow") return "noshow";
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
export function hasNoOutcome(
  a: Pick<TriageAppointment, "attended" | "outcome">,
): boolean {
  return a.outcome === null && a.attended === null;
}

/** A deal the client marked won in Mahara OS. */
export function isWon(a: Pick<TriageAppointment, "outcome">): boolean {
  return a.outcome?.deal === "won";
}

/** Opportunities the client's own CRM marked won, dated by the day the stage changed. */
export type TriageWin = {
  clientId: string;
  date: string;
  count: number;
  /** Sum of the monetary value GHL holds, in the client's currency, often 0. */
  value: number;
};

export type TriageDelivery = {
  clients: TriageClient[];
  days: TriageDay[];
  bookings: TriageBooking[];
  wins: TriageWin[];
  /**
   * Every appointment on a booking calendar whose time has passed, from
   * `recentFrom` to `to`, tied to a client row, cancelled and invalid left
   * out. The show rate, the close rate and the no-outcome list read these.
   */
  appointments: TriageAppointment[];
  /** Newest ad row sync time, epoch ms. */
  adsFreshAt: number | undefined;
  /** Newest appointment update time, epoch ms. */
  bookingsFreshAt: number | undefined;
  /** Accounts with spend that no client card claims, by account name. */
  unmapped: string[];
  /** Currencies Meta reported that the fixed table has no rate for. */
  unknownCurrencies: string[];
  /** Rows kept out of the booking count, by calendar kind, over the window. */
  notBookings: { kind: CalendarKind; count: number; calendars: string[] }[];
  /** The calendar names seen per booking kind in the window, so a note can name them. */
  calendarNames: Record<BookingKind, string[]>;
  /**
   * Booking-calendar rows on a client's location that reached no client row
   * here, by the day they are for: the row carries no client id and the
   * location is tied to no ad account or to two, or the client had no ad
   * spend in the window. Named by the location's client so the note can say
   * whose bookings are missing.
   */
  untied: { date: string; client: string; count: number }[];
  /**
   * Appointment rows on GoHighLevel locations with no client card at all
   * (no ghl_clients row), every calendar, over the window. On 2026-09-21
   * that was one location with four Arabic-named calendars.
   */
  noClientLocation: { rows: number; calendars: string[] };
  /** The provisional calendar: how many locations carry one and how many appointment rows it has ever produced. */
  provisional: { calendars: number; names: string[]; rowsEver: number };
  /**
   * Mahara OS outcomes overall: rows, how many join an appointment in this
   * project, the first capture day and the newest capture time.
   */
  outcomes: {
    rows: number;
    joined: number;
    since: string | null;
    latestAt: number | undefined;
  };
};

/** A Kuwait day as a checked SQL date literal. */
function day(d: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new Error(`triage: bad day ${d}`);
  return `date '${d}'`;
}

/**
 * Appointments with their client tie. The sync sets `client_id` on most rows;
 * the ones it leaves empty (24 of 157 booking rows in the 30 days to
 * 2026-09-21, twelve of them one client's confirmed appointments) are tied
 * here through the row's GHL location, when exactly one ad account is tied
 * to that location. A location tied to two accounts, or to none, leaves the
 * row untied, and the adapter says so.
 */
const tied = (where: string) => `
  select ap.*,
         coalesce(ap.client_id::text, one.client_id) as tie,
         (g.location_id is not null) as has_client,
         g.client_name as location_client
  from public.appointments ap
  left join lateral (
    select min(m.client_id::text) as client_id
    from public.ghl_client_ad_accounts m
    where m.location_id = ap.ghl_location_id
    having count(*) = 1
  ) one on true
  left join public.ghl_clients g on g.location_id = ap.ghl_location_id
  where ${where}`;

/**
 * Read client delivery between two Kuwait days, inclusive, plus every past
 * appointment from `recentFrom` with its Mahara OS outcome.
 *
 * Spend comes back in the account's own currency with the currency beside it,
 * and is converted here rather than in SQL, so the rates live in exactly one
 * place (ceo/data/tap.ts USD_PER) and a dollar means the same thing on every
 * screen. An account in a currency that table has no rate for is reported in
 * `unknownCurrencies` and its spend is left out rather than counted at one to
 * one, which would silently understate or inflate it.
 */
export async function clientDelivery(
  from: string,
  to: string,
  recentFrom: string,
): Promise<TriageDelivery> {
  const [clientRows, dayRows, bookingRows, winRows, appointmentRows, metaRows] =
    await Promise.all([
      sql(
        TRIAGE,
        `select c.id::text as client_id,
              c.name as account,
              coalesce(c.currency, 'USD') as currency,
              g.client_name as name,
              g.clickup_id,
              g.service_mode,
              g.status,
              m.matched_by,
              (select count(distinct a.campaign_id) from public.ads_daily_snapshots a
                where a.client_id = c.id and a.spend > 0
                  and a.date between (${day(to)}::date - 2) and ${day(to)}) as campaigns
       from public.clients c
       left join public.ghl_client_ad_accounts m on m.client_id = c.id
       left join public.ghl_clients g on g.location_id = m.location_id
       where exists (
         select 1 from public.ads_daily_snapshots a
         where a.client_id = c.id and a.date between ${day(from)} and ${day(to)}
       )`,
      ),
      sql(
        TRIAGE,
        `select a.client_id::text as client_id,
              to_char(a.date, 'YYYY-MM-DD') as date,
              sum(a.spend) as spend,
              sum(coalesce(a.leads, 0)) as leads,
              max(extract(epoch from a.last_synced_at) * 1000) as fresh_ms
       from public.ads_daily_snapshots a
       where a.date between ${day(from)} and ${day(to)}
       group by a.client_id, a.date`,
      ),
      // Appointments are dated by the day they are FOR, which is how a cost per
      // booking is read. `future` carries the ones that have not happened yet, so
      // the screen can show a comparable "due" figure and still say how many are
      // coming, instead of a number that silently grows all month. Rows on a
      // location with no client card collapse into one line per calendar: they
      // are counted for a note, never by day.
      sql(
        TRIAGE,
        `with ap as (${tied(`(ap.start_at at time zone 'Asia/Kuwait')::date between ${day(from)} and ${day(to)}`)})
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
       group by 1, 2, 3, 4`,
      ),
      // A close in the client's own CRM: an opportunity moved to won, dated by
      // the day the stage changed. Kept as the second source beside the Mahara
      // OS close rate; few clients mark wins, so it reads low by construction.
      sql(
        TRIAGE,
        `select m.client_id::text as client_id,
              to_char(coalesce(o.last_stage_change_at, o.updated_at) at time zone 'Asia/Kuwait', 'YYYY-MM-DD') as date,
              count(*) as count,
              sum(coalesce(o.monetary_value, 0)) as value
       from public.client_opportunities o
       join public.ghl_client_ad_accounts m on m.location_id = o.location_id
       where o.status = 'won'
         and (coalesce(o.last_stage_change_at, o.updated_at) at time zone 'Asia/Kuwait')::date between ${day(from)} and ${day(to)}
       group by 1, 2`,
      ),
      // One row per past appointment since `recentFrom`, with the CRM status,
      // the attendance sheet's mark and Mahara OS's outcome at its highest
      // revision (portal_data.appointment_outcomes.appointment_id is the GHL
      // appointment id). Cancelled and invalid never count for anything, so
      // they are not read. The calendar name comes back and is classified
      // here, so the booking rule lives in one place.
      sql(
        TRIAGE,
        `with ap as (${tied(`ap.start_at <= now()
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
       order by ap.start_at desc`,
      ),
      // Two facts the notes need: whether the provisional calendar has ever
      // synced a row, and how far Mahara OS's outcomes reach.
      sql(
        TRIAGE,
        `select (select count(*) from public.ghl_calendars cal where cal.name ~* '${PROVISIONAL.source}') as provisional_calendars,
              (select string_agg(distinct cal.name, '|') from public.ghl_calendars cal where cal.name ~* '${PROVISIONAL.source}') as provisional_names,
              (select count(*) from public.appointments ap join public.ghl_calendars cal on cal.calendar_id = ap.calendar_id
                 where cal.name ~* '${PROVISIONAL.source}') as provisional_rows,
              (select count(*) from portal_data.appointment_outcomes) as outcome_rows,
              (select count(distinct o.appointment_id) from portal_data.appointment_outcomes o
                 join public.appointments ap on ap.ghl_appointment_id = o.appointment_id) as outcomes_joined,
              (select to_char(min(o.captured_at) at time zone 'Asia/Kuwait', 'YYYY-MM-DD') from portal_data.appointment_outcomes o) as outcomes_since,
              (select max(o.captured_at) from portal_data.appointment_outcomes o) as outcomes_latest`,
      ),
    ]);

  const unknown = new Set<string>();
  const clients: TriageClient[] = [];
  const own = new Set<string>();
  for (const r of clientRows) {
    const account = String(r.account ?? "");
    const clientId = String(r.client_id);
    if (OWN_ACCOUNTS.has(fold(account))) {
      own.add(clientId);
      continue;
    }
    const currency = String(r.currency ?? "USD").toUpperCase();
    if (USD_PER[currency] === undefined) unknown.add(currency);
    clients.push({
      clientId,
      account,
      name: String(r.name ?? account),
      clickupTaskId: r.clickup_id ? String(r.clickup_id) : null,
      matchedBy: r.matched_by ? String(r.matched_by) : null,
      serviceMode: r.service_mode ? String(r.service_mode) : null,
      status: r.status ? String(r.status) : null,
      currency,
      campaigns: num(r.campaigns),
    });
  }

  const rate = new Map(clients.map(c => [c.clientId, USD_PER[c.currency]]));
  let adsFresh = 0;
  const days: TriageDay[] = [];
  for (const r of dayRows) {
    const clientId = String(r.client_id);
    adsFresh = Math.max(adsFresh, num(r.fresh_ms));
    if (own.has(clientId)) continue;
    const per = rate.get(clientId);
    if (per === undefined) continue; // unknown currency, or not a client row
    days.push({
      clientId,
      date: String(r.date),
      spend: Math.round(num(r.spend) * per * 100) / 100,
      leads: num(r.leads),
    });
  }

  let bookingsFresh = 0;
  const bookings: TriageBooking[] = [];
  const held = new Map<CalendarKind, { count: number; names: Set<string> }>();
  const seen: Record<BookingKind, Set<string>> = {
    main: new Set(),
    online: new Set(),
    provisional: new Set(),
  };
  const untied: TriageDelivery["untied"] = [];
  const noClient = { rows: 0, calendars: new Set<string>() };
  for (const r of bookingRows) {
    bookingsFresh = Math.max(bookingsFresh, num(r.fresh_ms));
    const calendar = String(r.calendar ?? "");
    const kind = calendarKind(calendar);
    const count = num(r.count);
    if (r.has_client !== true) {
      noClient.rows += count;
      if (calendar) noClient.calendars.add(calendar);
      continue;
    }
    const clientId = r.client_id ? String(r.client_id) : null;
    if (clientId && own.has(clientId)) continue;
    if (!clientId || !rate.has(clientId)) {
      // A client's booking that reaches no client row: untied, or a client
      // with no ad spend in the window (the table is clients with spend).
      if (isBookingKind(kind))
        untied.push({
          date: String(r.date),
          client: String(r.location_client ?? "a client with no card name"),
          count,
        });
      continue;
    }
    if (!isBookingKind(kind)) {
      const h = held.get(kind) ?? { count: 0, names: new Set<string>() };
      h.count += count;
      if (calendar) h.names.add(calendar);
      held.set(kind, h);
      continue;
    }
    seen[kind].add(calendar);
    bookings.push({
      clientId,
      date: String(r.date),
      kind,
      count,
      future: num(r.future),
    });
  }

  const wins: TriageWin[] = [];
  for (const r of winRows) {
    const clientId = String(r.client_id);
    if (own.has(clientId) || !rate.has(clientId)) continue;
    wins.push({
      clientId,
      date: String(r.date),
      count: num(r.count),
      value: num(r.value),
    });
  }

  const appointments: TriageAppointment[] = [];
  for (const r of appointmentRows) {
    const clientId = String(r.client_id);
    if (own.has(clientId) || !rate.has(clientId)) continue;
    const calendar = String(r.calendar ?? "");
    const kind = calendarKind(calendar);
    if (!isBookingKind(kind)) continue;
    const at = String(r.at);
    appointments.push({
      clientId,
      date: at.slice(0, 10),
      at,
      kind,
      calendar,
      status: r.status ? String(r.status) : null,
      attended: typeof r.attended === "boolean" ? r.attended : null,
      outcome:
        r.has_outcome === true
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
    adsFreshAt: adsFresh > 0 ? adsFresh : undefined,
    bookingsFreshAt: bookingsFresh > 0 ? bookingsFresh : undefined,
    unmapped,
    unknownCurrencies: [...unknown].sort(),
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
      rowsEver: num(meta.provisional_rows),
    },
    outcomes: {
      rows: num(meta.outcome_rows),
      joined: num(meta.outcomes_joined),
      since: meta.outcomes_since ? String(meta.outcomes_since) : null,
      latestAt: ms(meta.outcomes_latest),
    },
  };
}
