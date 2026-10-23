import { describe, expect, test } from "bun:test";
import { withRuntime, type Row, type Runtime } from "../../runtime.ts";
import { BoardBookingsUnreadable, clientDelivery, mediaFeedFresh, usdRateSql } from "./triage.js";

/**
 * R2 (2026-10-11 and 2026-10-22) against a real Postgres (PGlite) with the
 * production column shapes: client spend and leads from the live media table
 * (already USD, tied through cockpit_campaigns), the snapshot table for the
 * ad-days the live table has no tied row for (matched by Meta ad id), ads on
 * the compromise list left out of both (R3), and bookings from the Client
 * Performance board's stored days (cockpit_client_days), tied to the client
 * through cockpit_board_clients by ad account first and GoHighLevel second.
 */
const now = Date.now();
const today = new Date(now + 3 * 3600_000).toISOString().slice(0, 10);
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const D = (n: number) => addDays(today, n);
const SAR = "00000000-0000-4000-8000-00000000000a";
const USD = "00000000-0000-4000-8000-00000000000b";
const OWN = "00000000-0000-4000-8000-00000000000c";
const MOVED = "00000000-0000-4000-8000-00000000000d";
const LOOSE = "00000000-0000-4000-8000-00000000000e";
const CHURNED = "00000000-0000-4000-8000-00000000000f";
const UNTIED = "00000000-0000-4000-8000-000000000010";

const SCHEMA = `
  CREATE SCHEMA portal_data;
  CREATE TABLE public.clients(id uuid PRIMARY KEY, name text, meta_ad_account_id text, currency text, hidden_from_dashboard boolean);
  CREATE TABLE public.cockpit_campaigns(id bigint, meta_account_id text, raw_data jsonb, synced_at timestamptz, source_deleted boolean DEFAULT false);
  CREATE TABLE public.cockpit_media_daily_stats(source_id text, campaign_name text, day date, data jsonb);
  CREATE TABLE public.cockpit_media_feed_state(feed text, ready boolean, source_snapshot_at timestamptz, source_rows bigint);
  CREATE TABLE public.ads_daily_snapshots(ad_id text, client_id uuid, date date, campaign_id text, campaign_name text, spend numeric, leads integer, last_synced_at timestamptz);
  CREATE TABLE public.cockpit_excluded_ads(ad_id text PRIMARY KEY);
  CREATE TABLE public.ghl_client_ad_accounts(client_id uuid, location_id text, matched_by text);
  CREATE TABLE public.ghl_clients(location_id text, client_name text, clickup_id text, service_mode text, status text);
  CREATE TABLE public.appointments(ghl_appointment_id text, ghl_location_id text, ghl_location text, client_id uuid, calendar_id text,
    start_at timestamptz, booked_at timestamptz, status text, attended boolean, updated_at timestamptz, ghl_source text);
  CREATE TABLE public.ghl_calendars(location_id text, calendar_id text, name text, synced_at timestamptz);
  CREATE TABLE public.client_opportunities(location_id text, status text, last_stage_change_at timestamptz, updated_at timestamptz, monetary_value numeric);
  CREATE TABLE portal_data.appointment_outcomes(appointment_id text, attendance text, deal text, revision integer, captured_at timestamptz);
  CREATE TABLE public.cockpit_board_clients(location_id text PRIMARY KEY, clickup_id text, client_name text, service_mode text, status text, ad_account_ids text[]);
  CREATE TABLE public.cockpit_client_days(location_id text, day date, confirmed_bookings integer, provisional_bookings integer, computed_at timestamptz);
  CREATE TABLE public.cockpit_churned_ad_accounts(account_id text PRIMARY KEY, client_name text NOT NULL, status text NOT NULL DEFAULT 'Churned',
    evidence text NOT NULL, added_by text NOT NULL, added_at timestamptz NOT NULL DEFAULT now());
  CREATE TABLE public.cockpit_board_targets(scope_key text, metric text, good numeric NOT NULL, watch numeric, direction text, note text,
    updated_by text, updated_at timestamptz DEFAULT now(), PRIMARY KEY (scope_key, metric));
`;

type Opts = {
  feedRows?: number;
  ready?: boolean;
  moved?: boolean;
  noBoardDays?: boolean;
  noBoardTable?: boolean;
  shared?: boolean;
  loose?: boolean;
  cents?: boolean;
  /** A former client's account with no live tie, on the churned list (decision 5). */
  churned?: boolean;
  /** The churned list also names an account that has a live tie: the tie wins. */
  churnedTied?: boolean;
  /** An account tied to no card, board row or list row. */
  untied?: boolean;
  noChurnedTable?: boolean;
  /** The loose GoHighLevel tie has no name or status, and the churned list names its account. */
  looseListed?: boolean;
  /** Ardon's card also runs a Done With You account on its own board row (a mixed card). */
  mixed?: boolean;
  targets?: boolean;
  noTargetsTable?: boolean;
};

async function seed(db: { exec(sql: string): Promise<unknown> }, opts: Opts = {}) {
  const at = (day: string, hour = 9) => `${day}T${String(hour).padStart(2, "0")}:00:00+03:00`;
  const liveRows = 7 + (opts.moved ? 1 : 0) + (opts.loose ? 1 : 0) + (opts.churned ? 1 : 0) + (opts.untied ? 1 : 0) + (opts.mixed ? 1 : 0);
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
      ('m6','Ghost campaign','${D(-12)}','{"metaAdId":"ad-6","spend":40,"leads":2}'),
      -- An outsider's ad on the client's account, on the compromise list (R3).
      ('m9','Ardon A','${D(-2)}','{"metaAdId":"ad-x","spend":500,"leads":0}');
    INSERT INTO public.cockpit_excluded_ads VALUES ('ad-x'),('ad-y');
    INSERT INTO public.cockpit_media_feed_state VALUES ('dailyStats', ${opts.ready ?? true}, now() - interval '10 minutes', ${opts.feedRows ?? liveRows});
    -- Snapshot table, in SAR: a day before the live table's first day (converted);
    -- the live table's own ad-day (ignored: the live row wins); an ad the live
    -- table does not hold on a live day (converted, counted); the ghost
    -- campaign's untied ad-day, which the snapshot table ties to the client;
    -- and a listed outsider ad (left out).
    INSERT INTO public.ads_daily_snapshots VALUES
      ('ad-0','${SAR}','${D(-30)}','c-old','Ardon gone',100,5,now() - interval '9 days'),
      ('ad-1','${SAR}','${D(-2)}','c-a','Ardon A',999,9,now() - interval '9 days'),
      ('ad-7','${SAR}','${D(-2)}','c-off','Ardon off board',50,3,now() - interval '9 days'),
      ('ad-6','${SAR}','${D(-12)}','c-ghost','Ghost campaign',150,2,now() - interval '9 days'),
      ('ad-y','${SAR}','${D(-3)}','c-out','Outsider',400,0,now());
    INSERT INTO public.ghl_client_ad_accounts VALUES ('${SAR}','loc-sar','exact'),('${USD}','loc-usd','exact');
    INSERT INTO public.ghl_clients VALUES ('loc-sar','Ardon (GHL)','task-ardon','DFY','Active'),('loc-usd','Ocean Home (GHL)','task-ocean','DFY','Active');
    -- The board lists Ardon's account itself; Ocean's location is on the board
    -- with no ad account listed, so Ocean ties through GoHighLevel; a client
    -- on the board with no ad spend here has bookings that are named, not counted.
    INSERT INTO public.cockpit_board_clients VALUES
      ('loc-sar','task-ardon','Ardon','DFY','Active',ARRAY['111']),
      ('loc-usd','task-ocean','Ocean Home','DFY','Active',ARRAY[]::text[]),
      ('loc-pro','task-pro','Professional Touch','DFY','Active',ARRAY[]::text[]);
    ${opts.noBoardDays ? "" : `INSERT INTO public.cockpit_client_days VALUES
      ('loc-sar','${D(-2)}',2,1,now() - interval '3 hours'),
      ('loc-sar','${D(-1)}',null,null,now()),
      ('loc-usd','${D(-1)}',1,null,now()),
      ('loc-usd','${D(-60)}',4,0,now()),
      ('loc-pro','${D(-1)}',3,0,now());`}
    ${opts.noBoardTable ? "DROP TABLE public.cockpit_client_days;" : ""}
    INSERT INTO public.ghl_calendars VALUES
      ('loc-sar','cal-main','Main Appointment Calendar',now()),
      ('loc-sar','cal-prov','Not Confirmed Appointments',now());
    -- Past meetings for the show rate: main calendar only, by the day of the meeting.
    INSERT INTO public.appointments VALUES
      ('ap-main','loc-sar',null,null,'cal-main','${at(D(-2))}','${at(D(-3))}','showed',null,now(),'ghl'),
      ('ap-prov','loc-sar',null,null,'cal-prov','${at(D(-1))}','${at(D(-2))}','confirmed',null,now(),'ghl'),
      ('ap-cancel','loc-sar',null,null,'cal-main','${at(D(-1))}','${at(D(-2))}','cancelled',null,now(),'ghl'),
      -- A Google Calendar copy of a booking: never marked, so it is no meeting of its own.
      ('ap-gcal','loc-sar',null,null,'cal-main','${at(D(-1))}','${at(D(-2))}','confirmed',null,now(),'google_calendar');
  `);
  // The client moved to a new ad account: a second client row on the same
  // location and ClickUp card, spending the same week (Munshaat Khalida,
  // 2026-10-20). The board lists both accounts on the one location.
  if (opts.moved)
    await db.exec(`
      INSERT INTO public.clients VALUES ('${MOVED}','Ardon new account','act_333','USD',false);
      INSERT INTO public.cockpit_campaigns VALUES (4,'333','{"campaignName":"Ardon new A"}',now(),false);
      INSERT INTO public.cockpit_media_daily_stats VALUES ('m7','Ardon new A','${D(-1)}','{"metaAdId":"ad-8","spend":25,"leads":2}');
      INSERT INTO public.ghl_client_ad_accounts VALUES ('${MOVED}','loc-sar','meta_exact');
      UPDATE public.cockpit_board_clients SET ad_account_ids = ARRAY['111','333'] WHERE location_id = 'loc-sar';
    `);
  // An account a second board row also lists: it counts once, under the first location.
  if (opts.shared)
    await db.exec(`
      INSERT INTO public.cockpit_board_clients VALUES ('loc-zz','task-zz','Ardon twin','DFY','Active',ARRAY['111']);
    `);
  // A snapshot ad-day worth a fraction of a cent in USD (1 SAR = $0.2666).
  if (opts.cents)
    await db.exec(`
      INSERT INTO public.ads_daily_snapshots VALUES ('ad-r','${SAR}','${D(-4)}','c-r','Ardon cents',1,0,now());
    `);
  if (opts.churned)
    await db.exec(`
      INSERT INTO public.clients VALUES ('${CHURNED}','Triple Edge','act_2002793296961811','USD',false);
      INSERT INTO public.cockpit_campaigns VALUES (6,'2002793296961811','{"campaignName":"Promote page"}',now(),false);
      INSERT INTO public.cockpit_media_daily_stats VALUES ('m10','Promote page','${D(-1)}','{"metaAdId":"ad-10","spend":9.74,"leads":2}');
      INSERT INTO public.cockpit_churned_ad_accounts(account_id, client_name, evidence, added_by)
        VALUES ('2002793296961811','Triple Edge Building Construction','Aziz, 23 Oct 2026','test');
    `);
  if (opts.untied)
    await db.exec(`
      INSERT INTO public.clients VALUES ('${UNTIED}','Art Vision','act_555','USD',false);
      INSERT INTO public.cockpit_campaigns VALUES (7,'555','{"campaignName":"Art A"}',now(),false);
      INSERT INTO public.cockpit_media_daily_stats VALUES ('m11','Art A','${D(-1)}','{"metaAdId":"ad-11","spend":4,"leads":1}');
    `);
  if (opts.churnedTied)
    await db.exec(`
      INSERT INTO public.cockpit_churned_ad_accounts(account_id, client_name, evidence, added_by) VALUES
        ('111','Ardon (old name)','test','test'),
        ('222','Ocean (old name)','test','test');
    `);
  if (opts.noChurnedTable) await db.exec("DROP TABLE public.cockpit_churned_ad_accounts;");
  if (opts.targets)
    await db.exec(`
      INSERT INTO public.cockpit_board_targets(scope_key, metric, good, direction, updated_by) VALUES
        ('defaults','cpl',18,'lower','test'),
        ('client:task-ardon','cpl',20,'lower','test'),
        ('client:task-ardon','cpb',70,'lower','test');
    `);
  if (opts.noTargetsTable) await db.exec("DROP TABLE public.cockpit_board_targets;");
  // An account tied through GoHighLevel to a location the board does not carry: not measured.
  if (opts.loose)
    await db.exec(`
      INSERT INTO public.clients VALUES ('${LOOSE}','Loose account','act_444','USD',false);
      INSERT INTO public.cockpit_campaigns VALUES (5,'444','{"campaignName":"Loose A"}',now(),false);
      INSERT INTO public.cockpit_media_daily_stats VALUES ('m8','Loose A','${D(-1)}','{"metaAdId":"ad-9","spend":10,"leads":1}');
      INSERT INTO public.ghl_client_ad_accounts VALUES ('${LOOSE}','loc-nb','exact');
      INSERT INTO public.ghl_clients VALUES ('loc-nb','Loose client','task-loose','DFY','Active');
    `);
  if (opts.looseListed)
    await db.exec(`
      UPDATE public.ghl_clients SET client_name = null, status = null WHERE location_id = 'loc-nb';
      INSERT INTO public.cockpit_churned_ad_accounts(account_id, client_name, evidence, added_by)
        VALUES ('444','Loose (old name)','test','test');
    `);
  if (opts.mixed)
    await db.exec(`
      INSERT INTO public.clients VALUES ('${MOVED}','Ardon studio account','act_333','USD',false);
      INSERT INTO public.cockpit_campaigns VALUES (4,'333','{"campaignName":"Ardon studio A"}',now(),false);
      INSERT INTO public.cockpit_media_daily_stats VALUES ('m7','Ardon studio A','${D(-1)}','{"metaAdId":"ad-8","spend":25,"leads":2}');
      INSERT INTO public.cockpit_board_clients VALUES ('loc-dwy','task-ardon','Ardon studio','DWY','Active',ARRAY['333']);
    `);
}

async function withDb<T>(opts: Opts, run: () => Promise<T>): Promise<T> {
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

type Result = {
  cplTargets: { ok: boolean; defaults: number | null; byCard: Record<string, number>; error?: string };
  unmapped: string[];
  bookingsFreshAt?: number;
  bookingsDayFreshAt: Record<string, number>;
  days: Row[];
  clients: Row[];
  bookingDays: Row[];
  untied: Row[];
  appointments: Row[];
  sharedAccounts: Row[];
  media: { firstDay: string; untied: Row[]; frozenRows: number };
  unknownCurrencies: string[];
};

describe("clientDelivery on the live media table (R2) with PGlite", () => {
  test("spend is already USD, ties through the campaign's ad account, and the snapshot table fills only the ad-days the live table lacks", async () => {
    const result = await withDb({}, () => clientDelivery(D(-40), today, D(-30), { now })) as Result;
    const sum = (id: string, from = D(-40)) => result.days.filter(d => d.clientId === id && String(d.date) >= from).reduce((n, d) => n + Number(d.spend), 0);
    // 100 + 20.5 on one day, not converted from SAR a second time; the listed outsider ad's $500 is left out.
    const live2 = result.days.filter(d => d.clientId === SAR && d.date === D(-2) && d.source === "media");
    expect(live2.map(d => d.spend)).toEqual([120.5]);
    expect(live2[0]?.leads).toBe(5);
    // Same day: ad-1's snapshot 999 SAR is ignored (the live row wins); ad-7,
    // which the live table does not hold, is counted at the rate: 50 SAR = $13.33.
    const filled = result.days.filter(d => d.clientId === SAR && d.date === D(-2) && d.source === "frozen");
    expect(filled.map(d => d.spend)).toEqual([13.33]);
    expect(filled[0]?.leads).toBe(3);
    // The deleted campaign still ties.
    expect(result.days.find(d => d.clientId === SAR && d.date === D(-10))?.spend).toBe(50);
    // 100 SAR before the first live day at the rate table (0.2666).
    const frozen = result.days.find(d => d.clientId === SAR && d.date === D(-30));
    expect(frozen?.spend).toBe(26.66);
    expect(frozen?.source).toBe("frozen");
    // The ghost campaign's ad-day the snapshot table ties to the client: 150 SAR = $39.99.
    expect(result.days.find(d => d.clientId === SAR && d.date === D(-12))?.spend).toBe(39.99);
    // The listed outsider ad in the snapshot table (400 SAR on D-3) is left out too (R3).
    expect(result.days.find(d => d.clientId === SAR && d.date === D(-3))).toBeUndefined();
    expect(sum(SAR)).toBeCloseTo(120.5 + 13.33 + 50 + 39.99 + 26.66, 2);
    expect(result.media.frozenRows).toBe(3);
    expect(result.media.firstDay).toBe(D(-12));
    expect(result.days.find(d => d.clientId === USD)?.spend).toBe(30);
    // The campaign that ties to nothing is named, never dropped silently; its
    // ad-day the snapshot table counts for the client is not named again.
    expect(result.media.untied).toEqual([{ campaign: "Ghost campaign", spend: 12.34, firstDay: D(-1), lastDay: D(-1) }]);
    // Mahara's own hidden account is not a client row.
    expect(result.clients.map(c => c.clientId).sort()).toEqual([SAR, USD].sort());
    expect(result.unknownCurrencies).toEqual([]);
  });

  test("a feed that is not ready, or mid-rewrite, raises instead of reading as zero", async () => {
    await expect(withDb({ ready: false }, () => clientDelivery(D(-40), today, D(-30), { now }))).rejects.toThrow("not ready");
    await expect(withDb({ feedRows: 99 }, () => clientDelivery(D(-40), today, D(-30), { now }))).rejects.toThrow("rewrite in flight");
  });
});

describe("Bookings from the Client Performance board (R2, 2026-10-22) with PGlite", () => {
  test("clients tie by the board's ad account first, GoHighLevel second, and carry their board locations", async () => {
    const result = await withDb({}, () => clientDelivery(D(-40), today, D(-30), { now })) as Result;
    const ardon = result.clients.find(c => c.clientId === SAR);
    const ocean = result.clients.find(c => c.clientId === USD);
    // The board's own name, card and tie win over GoHighLevel's.
    expect(ardon).toMatchObject({ name: "Ardon", clickupTaskId: "task-ardon", matchedBy: "board ad account", locationIds: ["loc-sar"], adAccount: "111" });
    expect(ocean).toMatchObject({ name: "Ocean Home", clickupTaskId: "task-ocean", matchedBy: "exact", locationIds: ["loc-usd"] });
  });

  test("stored days come back as they are: counts by the day the booking was made, a NULL count never read as zero", async () => {
    const result = await withDb({}, () => clientDelivery(D(-40), today, D(-30), { now })) as Result;
    const by = (loc: string) => result.bookingDays.filter(b => b.locationId === loc).map(b => [b.date, b.confirmed, b.provisional]);
    expect(by("loc-sar")).toEqual([[D(-2), 2, 1]]);
    expect(by("loc-usd")).toEqual([[D(-1), 1, null]]);
    // Outside the window: not read.
    expect(result.bookingDays.some(b => b.date === D(-60))).toBe(false);
    // Bookings on a board client with no ad spend here are named, in no figure.
    expect(result.untied).toEqual([{ date: D(-1), client: "Professional Touch", status: "Active", count: 3 }]);
  });

  test("show and close rates still read past meetings by the day of the meeting, main and online calendars only, Google copies left out", async () => {
    const result = await withDb({}, () => clientDelivery(D(-40), today, D(-30), { now })) as Result;
    // ap-gcal, a confirmed Google Calendar copy on the main calendar, is not
    // a meeting: it would only swell the "no outcome" counts.
    expect(result.appointments.map(a => [a.clientId, a.date, a.kind, a.status])).toEqual([[SAR, D(-2), "main", "showed"]]);
  });

  test("each stored day says when the board last counted it, so a stale or unfinished day can be told apart", async () => {
    const result = await withDb({}, () => clientDelivery(D(-40), today, D(-30), { now })) as Result;
    const two = result.bookingsDayFreshAt[D(-2)];
    const one = result.bookingsDayFreshAt[D(-1)];
    expect(one).toBeGreaterThan(two);
    expect(result.bookingsFreshAt).toBe(one);
    // Counted three hours before the newest day, give or take the test's own run time.
    expect(Math.round((one - two) / 3600_000)).toBe(3);
    expect(result.bookingsDayFreshAt[D(-60)]).toBeUndefined();
  });

  test("a client-day's spend stays unrounded; callers round once after adding", async () => {
    const result = await withDb({ cents: true }, () => clientDelivery(D(-40), today, D(-30), { now })) as Result;
    const day = result.days.find(d => d.clientId === SAR && d.date === D(-4));
    expect(day?.spend).toBeCloseTo(0.2666, 6);
  });

  test("no stored day for any client, or no board table, is a failed read: the section keeps its last good payload", async () => {
    await expect(withDb({ noBoardDays: true }, () => clientDelivery(D(-40), today, D(-30), { now }))).rejects.toBeInstanceOf(BoardBookingsUnreadable);
    await expect(withDb({ noBoardTable: true }, () => clientDelivery(D(-40), today, D(-30), { now }))).rejects.toBeInstanceOf(BoardBookingsUnreadable);
  });

  test("an account the board lists on two rows counts once, under the first location, and is named", async () => {
    const result = await withDb({ shared: true }, () => clientDelivery(D(-40), today, D(-30), { now })) as Result;
    expect(result.clients.find(c => c.clientId === SAR)?.locationIds).toEqual(["loc-sar"]);
    expect(result.sharedAccounts).toEqual([{ account: "111", client: "Ardon", rows: 2 }]);
  });

  test("an account tied only to a location the board does not carry has no locations: not measured", async () => {
    const result = await withDb({ loose: true }, () => clientDelivery(D(-40), today, D(-30), { now })) as Result;
    expect(result.clients.find(c => c.clientId === LOOSE)).toMatchObject({ name: "Loose client", clickupTaskId: "task-loose", locationIds: [] });
  });
});

describe("A client on two ad accounts (one ClickUp card) with PGlite", () => {
  test("rows on one card fold into one client: spend and leads counted once, under one id, with the location once", async () => {
    const result = await withDb({ moved: true }, () => clientDelivery(D(-40), today, D(-30), { now })) as Result;
    // One client per card, so Delivery's client:<card> scope is unique.
    const ardon = result.clients.filter(c => c.clickupTaskId === "task-ardon");
    expect(ardon.length).toBe(1);
    expect(result.clients.length).toBe(2);
    expect(ardon[0].locationIds).toEqual(["loc-sar"]);
    const id = String(ardon[0].clientId);
    expect([SAR, MOVED]).toContain(id);
    // Every row of either account is counted under that one id, the new account's $25 included.
    expect(result.days.every(d => d.clientId === id || d.clientId === USD)).toBe(true);
    const ardonDay1 = result.days.filter(d => d.clientId === id && d.date === D(-1)).reduce((n, d) => n + Number(d.spend), 0);
    expect(ardonDay1).toBe(25);
    expect(result.days.filter(d => d.clientId === id).reduce((n, d) => n + Number(d.leads), 0)).toBe(5 + 3 + 2 + 2 + 5 + 2);
    expect(result.untied.map(u => u.client)).toEqual(["Professional Touch"]);
  });
});

describe("A mixed card (decision 2, contract 1.2) with PGlite", () => {
  test("each day keeps the Service Mode of the account that spent it, after the card fold", async () => {
    const result = await withDb({ mixed: true }, () => clientDelivery(D(-40), today, D(-30), { now })) as Result;
    const ardon = result.clients.filter(c => c.clickupTaskId === "task-ardon");
    expect(ardon.length).toBe(1);
    const id = String(ardon[0].clientId);
    const mine = result.days.filter(d => d.clientId === id);
    // The Done With You account's $25 is under the card's one id, marked DWY.
    expect(mine.filter(d => d.serviceMode === "DWY").map(d => Number(d.spend))).toEqual([25]);
    // Every other day of the card is the account we book for.
    expect(mine.filter(d => d.serviceMode !== "DWY").every(d => d.serviceMode === "DFY")).toBe(true);
    expect(result.days.filter(d => d.clientId === USD).every(d => d.serviceMode === "DFY")).toBe(true);
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

describe("A churned client's account (decision 5, 23 Oct 2026) with PGlite", () => {
  test("an account with no live tie on the churned list reads Churned with the list's name, and is not named as untied", async () => {
    const result = await withDb({ churned: true }, () => clientDelivery(D(-40), today, D(-30), { now })) as Result;
    const t = result.clients.find(c => c.clientId === CHURNED);
    expect(t).toMatchObject({ name: "Triple Edge Building Construction", status: "Churned", clickupTaskId: null, locationIds: [] });
    // Its spend stays in the days: never dropped.
    expect(result.days.find(d => d.clientId === CHURNED)?.spend).toBe(9.74);
    // A lost client is named in the lost client note, not as an account tied to no card.
    expect(result.unmapped).toEqual([]);
  });

  test("a live board or GoHighLevel tie wins over the churned list", async () => {
    const result = await withDb({ churnedTied: true }, () => clientDelivery(D(-40), today, D(-30), { now })) as Result;
    // Ardon ties through the board's ad account, Ocean through GoHighLevel.
    expect(result.clients.find(c => c.clientId === SAR)).toMatchObject({ name: "Ardon", status: "Active" });
    expect(result.clients.find(c => c.clientId === USD)).toMatchObject({ name: "Ocean Home", status: "Active" });
  });

  test("an untied account not on the list keeps no status and is named as tied to no card", async () => {
    const result = await withDb({ untied: true, churned: true }, () => clientDelivery(D(-40), today, D(-30), { now })) as Result;
    expect(result.clients.find(c => c.clientId === UNTIED)).toMatchObject({ name: "Art Vision", status: null, clickupTaskId: null });
    expect(result.unmapped).toEqual(["Art Vision"]);
  });

  test("a live tie with no name or status still wins: the list never fills it in", async () => {
    const result = await withDb({ loose: true, looseListed: true }, () => clientDelivery(D(-40), today, D(-30), { now })) as Result;
    const loose = result.clients.find(c => c.clientId === LOOSE);
    expect(loose).toMatchObject({ name: "Loose account", status: null, clickupTaskId: "task-loose" });
    // Still a client row, never read as churned.
    expect(String(loose?.status ?? "")).not.toMatch(/churn/i);
  });

  test("a GoHighLevel tie to a location the board does not carry is a live tie too", async () => {
    const result = await withDb({ loose: true, churned: true }, () => clientDelivery(D(-40), today, D(-30), { now })) as Result;
    expect(result.clients.find(c => c.clientId === LOOSE)).toMatchObject({ name: "Loose client", status: "Active" });
  });

  test("a missing churned table fails the read, never zeros", async () => {
    await expect(withDb({ noChurnedTable: true }, () => clientDelivery(D(-40), today, D(-30), { now }))).rejects.toThrow();
  });
});

describe("The clients' cost per lead lines (decision 4, 23 Oct 2026) with PGlite", () => {
  test("the board default and each card's own cpl line, other metrics left out", async () => {
    const result = await withDb({ targets: true }, () => clientDelivery(D(-40), today, D(-30), { now })) as Result;
    expect(result.cplTargets).toEqual({ ok: true, defaults: 18, byCard: { "task-ardon": 20 } });
  });

  test("no rows: no lines, so every client falls back to the gate", async () => {
    const result = await withDb({}, () => clientDelivery(D(-40), today, D(-30), { now })) as Result;
    expect(result.cplTargets).toEqual({ ok: true, defaults: null, byCard: {} });
  });

  test("a failed read is said, never a failed section", async () => {
    const result = await withDb({ noTargetsTable: true }, () => clientDelivery(D(-40), today, D(-30), { now })) as Result;
    expect(result.cplTargets.ok).toBe(false);
    expect(result.cplTargets.error).toContain("cockpit_board_targets");
    expect(result.clients.length).toBe(2);
  });
});

describe("Booking days carry the board row's Service Mode (decision 2) with PGlite", () => {
  test("each stored day says the location's mode", async () => {
    const result = await withDb({}, () => clientDelivery(D(-40), today, D(-30), { now })) as Result;
    expect(result.bookingDays.every(b => b.serviceMode === "DFY")).toBe(true);
  });
});
