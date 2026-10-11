import { describe, expect, test } from "bun:test";
import { withRuntime, type Row, type Runtime } from "../../runtime.ts";
import { clientDelivery, mediaFeedFresh, usdRateSql } from "./triage.js";

/**
 * R2 and A113 (2026-10-11) against a real Postgres (PGlite) with the
 * production column shapes: client spend and leads from the live media table
 * (already USD, tied through cockpit_campaigns), the frozen snapshot table
 * for the ad-days the live table has no tied row for (matched by Meta ad id),
 * and provisional bookings from the
 * call-centre reporting store, provisional calendar only.
 */
const now = Date.now();
const today = new Date(now + 3 * 3600_000).toISOString().slice(0, 10);
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const D = (n: number) => addDays(today, n);
const SAR = "00000000-0000-4000-8000-00000000000a";
const USD = "00000000-0000-4000-8000-00000000000b";
const OWN = "00000000-0000-4000-8000-00000000000c";

const SCHEMA = `
  CREATE SCHEMA portal_data; CREATE SCHEMA mahara_reporting;
  CREATE TABLE public.clients(id uuid PRIMARY KEY, name text, meta_ad_account_id text, currency text, hidden_from_dashboard boolean);
  CREATE TABLE public.cockpit_campaigns(id bigint, meta_account_id text, raw_data jsonb, synced_at timestamptz, source_deleted boolean DEFAULT false);
  CREATE TABLE public.cockpit_media_daily_stats(source_id text, campaign_name text, day date, data jsonb);
  CREATE TABLE public.cockpit_media_feed_state(feed text, ready boolean, source_snapshot_at timestamptz, source_rows bigint);
  CREATE TABLE public.ads_daily_snapshots(ad_id text, client_id uuid, date date, campaign_id text, campaign_name text, spend numeric, leads integer, last_synced_at timestamptz);
  CREATE TABLE public.ghl_client_ad_accounts(client_id uuid, location_id text, matched_by text);
  CREATE TABLE public.ghl_clients(location_id text, client_name text, clickup_id text, service_mode text, status text);
  CREATE TABLE public.appointments(ghl_appointment_id text, ghl_location_id text, ghl_location text, client_id uuid, calendar_id text,
    start_at timestamptz, booked_at timestamptz, status text, attended boolean, updated_at timestamptz, ghl_source text);
  CREATE TABLE public.ghl_calendars(location_id text, calendar_id text, name text, synced_at timestamptz);
  CREATE TABLE public.client_opportunities(location_id text, status text, last_stage_change_at timestamptz, updated_at timestamptz, monetary_value numeric);
  CREATE TABLE portal_data.appointment_outcomes(appointment_id text, attendance text, deal text, revision integer, captured_at timestamptz);
  CREATE TABLE mahara_reporting.facts(namespace text, kind text, source text, data jsonb, version_at timestamptz, conflict boolean);
  CREATE TABLE mahara_reporting.cc_attempts(location_id text, data jsonb);
`;

async function seed(db: { exec(sql: string): Promise<unknown> }, opts: { feedRows?: number; ready?: boolean } = {}) {
  const at = (day: string, hour = 9) => `${day}T${String(hour).padStart(2, "0")}:00:00+03:00`;
  await db.exec(`
    INSERT INTO public.clients VALUES
      ('${SAR}','Ardon SAR','act_111','SAR',false),
      ('${USD}','Ocean Home','act_222','USD',false),
      ('${OWN}','MaharaMedia','act_999','USD',true);
    -- Two campaigns tie to SAR (one deleted, kept for the tie), one to USD; one ties to nothing.
    INSERT INTO public.cockpit_campaigns VALUES
      (1,'111','{"campaignName":"Ardon A"}',now(),false),
      (2,'111','{"campaignName":"Ardon old"}',now() - interval '5 days',true),
      (3,'222','{"campaignName":"Ocean A"}',now(),false);
    INSERT INTO public.cockpit_media_daily_stats VALUES
      ('m1','Ardon A','${D(-2)}','{"metaAdId":"ad-1","spend":100,"leads":4}'),
      ('m2','Ardon A','${D(-2)}','{"metaAdId":"ad-2","spend":20.5,"leads":1}'),
      ('m3','Ardon old','${D(-10)}','{"metaAdId":"ad-3","spend":50,"leads":2}'),
      ('m4','Ocean A','${D(-1)}','{"metaAdId":"ad-4","spend":30,"leads":3}'),
      ('m5','Ghost campaign','${D(-1)}','{"metaAdId":"ad-5","spend":12.34,"leads":1}'),
      ('m6','Ghost campaign','${D(-12)}','{"metaAdId":"ad-6","spend":40,"leads":2}');
    INSERT INTO public.cockpit_media_feed_state VALUES ('dailyStats', ${opts.ready ?? true}, now() - interval '10 minutes', ${opts.feedRows ?? 6});
    -- Frozen table, in SAR: a day before the live table's first day (converted);
    -- the live table's own ad-day (ignored: the live row wins); an ad the live
    -- table does not hold on a live day (converted, counted); and the ghost
    -- campaign's untied ad-day, which the frozen table ties to the client.
    INSERT INTO public.ads_daily_snapshots VALUES
      ('ad-0','${SAR}','${D(-30)}','c-old','Ardon gone',100,5,now() - interval '9 days'),
      ('ad-1','${SAR}','${D(-2)}','c-a','Ardon A',999,9,now() - interval '9 days'),
      ('ad-7','${SAR}','${D(-2)}','c-off','Ardon off board',50,3,now() - interval '9 days'),
      ('ad-6','${SAR}','${D(-12)}','c-ghost','Ghost campaign',150,2,now() - interval '9 days');
    INSERT INTO public.ghl_client_ad_accounts VALUES ('${SAR}','loc-sar','exact'),('${USD}','loc-usd','exact');
    INSERT INTO public.ghl_clients VALUES ('loc-sar','Ardon','task-ardon','DFY','Active'),('loc-usd','Ocean Home','task-ocean','DFY','Active');
    INSERT INTO public.ghl_calendars VALUES
      ('loc-sar','cal-main','Main Appointment Calendar',now()),
      ('loc-sar','cal-prov','Not Confirmed Appointments',now()),
      ('loc-usd','cal-prov-u','Not Confirmed Appointments',now());
    -- A main-calendar booking in the appointments sync, and the same provisional
    -- appointment in both the appointments sync and the dialer's facts.
    INSERT INTO public.appointments VALUES
      ('ap-main','loc-sar',null,null,'cal-main','${at(D(-2))}','${at(D(-3))}','confirmed',null,now(),'ghl'),
      ('ap-prov-dup','loc-sar',null,null,'cal-prov','${at(D(-1))}','${at(D(-2))}','confirmed',null,now() - interval '1 day','ghl');
    INSERT INTO mahara_reporting.facts VALUES
      ('production','appointment','ghl','{"locationId":"loc-sar","id":"ap-prov-dup","calendarId":"cal-prov","startAt":"${D(-1)}T06:00:00.000Z","status":"confirmed"}',now(),false),
      ('production','appointment','ghl','{"locationId":"loc-sar","id":"f-prov-1","calendarId":"cal-prov","startAt":"${D(-3)}T06:00:00.000Z","status":"confirmed"}',now(),false),
      ('production','appointment','ghl','{"locationId":"loc-sar","id":"f-prov-conflict","calendarId":"cal-prov","startAt":"${D(-3)}T06:00:00.000Z","status":"confirmed"}',now(),true),
      ('production','appointment','ghl','{"locationId":"loc-sar","id":"f-prov-deleted","calendarId":"cal-prov","startAt":"${D(-3)}T06:00:00.000Z","status":"confirmed","deleted":true}',now(),false),
      ('production','appointment','ghl','{"locationId":"loc-sar","id":"f-main-new","calendarId":"cal-main","startAt":"${D(-3)}T06:00:00.000Z","status":"new"}',now(),false),
      ('production','appointment','ghl','{"locationId":"loc-usd","id":"f-prov-future","calendarId":"cal-prov-u","startAt":"${D(5)}T06:00:00.000Z","status":"confirmed"}',now(),false);
    -- A verified dialer booking on the provisional calendar, its start time in milliseconds.
    INSERT INTO mahara_reporting.cc_attempts VALUES
      ('loc-usd', jsonb_build_object('disposition', jsonb_build_object('outcome','BOOKED'),
        'bookingVerification', jsonb_build_object('id','cc-1','calendarId','cal-prov-u','verifiedAt', (extract(epoch from now()) * 1000)::bigint,
          'startTime','${D(-4)}T10:00:00+03:00','appointmentStatus','new')));
  `);
}

async function withDb<T>(opts: { feedRows?: number; ready?: boolean }, run: () => Promise<T>): Promise<T> {
  const { PGlite } = await import("../../../../apps/media-buyer-cockpit/node_modules/@electric-sql/pglite");
  const db = new PGlite();
  try {
    await db.exec(SCHEMA);
    await seed(db, opts);
    const read: Runtime["read"] = async (_project, query) => (await db.query(query)).rows as Row[];
    const runtime: Runtime = { env: () => undefined, read, repository: {} as Runtime["repository"], tools: {} as Runtime["tools"] };
    return await withRuntime(runtime, run);
  } finally {
    await db.close();
  }
}

describe("clientDelivery on the live media table (R2) with PGlite", () => {
  test("spend is already USD, ties through the campaign's ad account, and the frozen table fills only the ad-days the live table lacks", async () => {
    const result = await withDb({}, () => clientDelivery(D(-40), today, D(-30), { now })) as {
      days: Row[]; clients: Row[]; media: { firstDay: string; untied: Row[]; frozenRows: number }; unknownCurrencies: string[];
    };
    const sum = (id: string, from = D(-40)) => result.days.filter(d => d.clientId === id && String(d.date) >= from).reduce((n, d) => n + Number(d.spend), 0);
    // 100 + 20.5 on one day, not converted from SAR a second time.
    const live2 = result.days.filter(d => d.clientId === SAR && d.date === D(-2) && d.source === "media");
    expect(live2.map(d => d.spend)).toEqual([120.5]);
    expect(live2[0]?.leads).toBe(5);
    // Same day: ad-1's frozen 999 SAR is ignored (the live row wins); ad-7,
    // which the live table does not hold, is counted at the rate: 50 SAR = $13.33.
    const filled = result.days.filter(d => d.clientId === SAR && d.date === D(-2) && d.source === "frozen");
    expect(filled.map(d => d.spend)).toEqual([13.33]);
    expect(filled[0]?.leads).toBe(3);
    // The deleted campaign still ties.
    expect(result.days.find(d => d.clientId === SAR && d.date === D(-10))?.spend).toBe(50);
    // Frozen: 100 SAR before the first live day at the rate table (0.2666), source frozen;
    // the frozen row on a live day (999 SAR) is ignored.
    const frozen = result.days.find(d => d.clientId === SAR && d.date === D(-30));
    expect(frozen?.spend).toBe(26.66);
    expect(frozen?.source).toBe("frozen");
    // The ghost campaign's ad-day the frozen table ties to the client: 150 SAR = $39.99.
    expect(result.days.find(d => d.clientId === SAR && d.date === D(-12))?.spend).toBe(39.99);
    expect(sum(SAR)).toBeCloseTo(120.5 + 13.33 + 50 + 39.99 + 26.66, 2);
    expect(result.media.frozenRows).toBe(3);
    expect(result.media.firstDay).toBe(D(-12));
    expect(result.days.find(d => d.clientId === USD)?.spend).toBe(30);
    // The campaign that ties to nothing is named, never dropped silently; its
    // ad-day the frozen table counts for the client is not named again.
    expect(result.media.untied).toEqual([{ campaign: "Ghost campaign", spend: 12.34, firstDay: D(-1), lastDay: D(-1) }]);
    // Mahara's own hidden account is not a client row.
    expect(result.clients.map(c => c.clientId).sort()).toEqual([SAR, USD].sort());
    expect(result.unknownCurrencies).toEqual([]);
  });

  test("a feed that is not ready, or mid-rewrite, raises instead of reading as zero", async () => {
    await expect(withDb({ ready: false }, () => clientDelivery(D(-40), today, D(-30), { now }))).rejects.toThrow("not ready");
    await expect(withDb({ feedRows: 9 }, () => clientDelivery(D(-40), today, D(-30), { now }))).rejects.toThrow("rewrite in flight");
  });
});

describe("Provisional bookings from the call-centre reporting store (A113) with PGlite", () => {
  test("provisional calendar only, deduplicated, no conflicts or deletions, dated by the meeting day", async () => {
    const result = await withDb({}, () => clientDelivery(D(-40), D(10), D(-30), { now })) as {
      bookings: Row[]; provisional: { rowsEver: number; inAppointmentsSync: number };
    };
    const prov = result.bookings.filter(b => b.kind === "provisional");
    const by = (id: string) => prov.filter(b => b.clientId === id).reduce((n, b) => n + Number(b.count), 0);
    // SAR: the duplicate (appointments sync + facts) once, plus f-prov-1; the
    // conflict, the deleted one and the main-calendar "new" are not provisional.
    expect(by(SAR)).toBe(2);
    // USD: the verified dialer booking (ms timestamps parsed) and one future appointment.
    expect(by(USD)).toBe(2);
    expect(prov.find(b => b.clientId === USD && b.date === D(5))?.future).toBe(1);
    expect(prov.find(b => b.clientId === SAR && b.date === D(-1))?.count).toBe(1);
    // The main-calendar appointment stays confirmed, from the appointments sync.
    expect(result.bookings.filter(b => b.kind === "main").reduce((n, b) => n + Number(b.count), 0)).toBe(1);
    expect(result.provisional.rowsEver).toBe(4);
    expect(result.provisional.inAppointmentsSync).toBe(1);
  });
});

describe("Pure helpers", () => {
  test("the rate SQL covers the rate table and leaves an unknown currency null", () => {
    const sql = usdRateSql("c.currency");
    expect(sql).toContain("when 'SAR' then 0.2666");
    expect(sql).toContain("when 'KWD' then 3.26");
    expect(sql).not.toContain("else");
  });

  test("the media feed check names what is wrong", () => {
    const row = { ready: true, source_rows: 3, actual_rows: 3, snapshot_ms: now - 1000, first_day: "2026-08-13", last_day: today };
    expect(mediaFeedFresh(row, now, 3 * 3600_000).firstDay).toBe("2026-08-13");
    expect(() => mediaFeedFresh(undefined, now, 1)).toThrow("no state row");
    expect(() => mediaFeedFresh({ ...row, first_day: null, actual_rows: 0, source_rows: 0 }, now, 3 * 3600_000)).toThrow("empty");
    expect(() => mediaFeedFresh({ ...row, snapshot_ms: now - 5 * 3600_000 }, now, 3 * 3600_000)).toThrow("5 hours ago");
  });
});
