import { num, sql, TRIAGE } from "../sb";
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
 * Checked against every calendar in the project on 2026-09-19. The two that
 * feed the booking count are `Main Appointment Calendar` and
 * `A. Appointment Calendar (Online)`; the In Office and In Home variants are
 * the same kind of thing and count too, they simply had none that month.
 *
 * The other two Aziz named are configured on 46 and 47 client locations and
 * have produced **zero** appointment rows, ever: `Not Confirmed Appointments`
 * (a provisional hold, not a booking) and `Callback Calendar [AGENTS ONLY]`
 * (an agent's callback queue, not a client appointment). They are classified
 * here anyway, so that the day they do start syncing they are counted apart
 * instead of silently inflating every booking figure on the tab.
 *
 * A reschedule is also held apart: the original appointment is already on the
 * main calendar, so counting both would book one meeting twice.
 */
export type CalendarKind =
  | "booking"
  | "provisional"
  | "callback"
  | "reschedule"
  | "other";

export function calendarKind(name: string | null | undefined): CalendarKind {
  const n = String(name ?? "").toLowerCase();
  if (!n) return "other";
  if (/callback|call-back|معاودة/.test(n)) return "callback";
  if (/not confirmed|provisional|tentative/.test(n)) return "provisional";
  if (/reschedul/.test(n)) return "reschedule";
  if (/appointment calendar|main appointment/.test(n)) return "booking";
  return "other";
}

export type TriageBooking = {
  clientId: string;
  /** The Kuwait day the appointment is for. */
  date: string;
  kind: CalendarKind;
  count: number;
  /** Of `count`, how many start after now and so cannot have happened yet. */
  future: number;
  /** Of `count`, how many the appointment record marks as attended. */
  attended: number;
};

export type TriageDelivery = {
  clients: TriageClient[];
  days: TriageDay[];
  bookings: TriageBooking[];
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
};

/** A Kuwait day as a checked SQL date literal. */
function day(d: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new Error(`triage: bad day ${d}`);
  return `date '${d}'`;
}

/**
 * Read client delivery between two Kuwait days, inclusive.
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
): Promise<TriageDelivery> {
  const [clientRows, dayRows, bookingRows] = await Promise.all([
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
                where a.client_id = c.id and a.date between ${day(from)} and ${day(to)}) as campaigns
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
    // coming, instead of a number that silently grows all month.
    sql(
      TRIAGE,
      `select ap.client_id::text as client_id,
              to_char(ap.start_at at time zone 'Asia/Kuwait', 'YYYY-MM-DD') as date,
              coalesce(cal.name, '') as calendar,
              count(*) as count,
              count(*) filter (where ap.start_at > now()) as future,
              count(*) filter (where ap.attended is true) as attended,
              max(extract(epoch from ap.updated_at) * 1000) as fresh_ms
       from public.appointments ap
       left join public.ghl_calendars cal on cal.calendar_id = ap.calendar_id
       where (ap.start_at at time zone 'Asia/Kuwait')::date between ${day(from)} and ${day(to)}
         and ap.client_id is not null
       group by ap.client_id, 2, 3`,
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
  for (const r of bookingRows) {
    const clientId = String(r.client_id);
    bookingsFresh = Math.max(bookingsFresh, num(r.fresh_ms));
    if (own.has(clientId) || !rate.has(clientId)) continue;
    const calendar = String(r.calendar ?? "");
    const kind = calendarKind(calendar);
    if (kind !== "booking") {
      const h = held.get(kind) ?? { count: 0, names: new Set<string>() };
      h.count += num(r.count);
      if (calendar) h.names.add(calendar);
      held.set(kind, h);
      continue;
    }
    bookings.push({
      clientId,
      date: String(r.date),
      kind,
      count: num(r.count),
      future: num(r.future),
      attended: num(r.attended),
    });
  }

  const spent = new Set(days.filter(d => d.spend > 0).map(d => d.clientId));
  const unmapped = clients
    .filter(c => !c.clickupTaskId && spent.has(c.clientId))
    .map(c => c.account)
    .sort();

  return {
    clients,
    days,
    bookings,
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
  };
}
