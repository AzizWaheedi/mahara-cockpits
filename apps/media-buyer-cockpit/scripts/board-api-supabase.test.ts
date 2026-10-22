/**
 * The Client Performance board's reads, targets and levers (migration
 * 20261016133300_board_api.sql) on an isolated PostgreSQL.
 *
 * It stands on the two data migrations it reads (20261016111157_board_facts
 * and 20261016121700_meta_ad_days) and on the dialer's real views, which are
 * taken from the board facts test itself (its DIALER block, read from that
 * file so the two never drift). Client A's facts come from a real facts
 * refresh over invented leads, appointments, sheet rows and portal outcomes;
 * Formula Co's days and ad-days are written by hand so every formula has a
 * known answer. Since 2026-10-17 the budget store (20261017100000_meta_budgets)
 * and the board's budgets (20261017100100_board_budgets) run too: Client A's
 * account gets hand-written budgets now and per day, so Budget/day, Spend/day
 * and Budget used have known answers. Since 2026-10-21 the reads are
 * 20261021a_board_skip_excluded_ads's: ads on the compromise list
 * (cockpit_excluded_ads, matched on the ad id) never count, and their
 * outsiders' campaigns leave Budget/day and Budget used and are said instead.
 * Every person, client, ad and number is invented.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { PGlite } from "@electric-sql/pglite";
import { CALL_RULES as CS_CALL_RULES } from "../../client-success-cockpit/src/lib/callCentre";
import * as csKpi from "../../client-success-cockpit/src/lib/kpi";
import { CALL_RULES } from "../src/lib/callCentre";
import * as kpi from "../src/lib/kpi";
import {
  actor,
  cockpitTestDb,
  member,
  migration,
  owner,
} from "./lib/cockpitTestDb";

const FILE = "20261016133300_board_api.sql";
/** The 16 October corrections: the facts, the Meta store, then the read that takes them. */
const FIXES = [
  "20261016210000_board_facts_checked.sql",
  "20261016210100_meta_ad_days_checked.sql",
  // The budget store (2026-10-17).
  "20261017100000_meta_budgets.sql",
];
/** The read that takes them, then its notes said once. */
const READ_CHECKED = [
  "20261016220000_board_read_checked.sql",
  "20261016220100_board_read_notes.sql",
  "20261017090000_board_active_only.sql",
  // The budgets on the board (2026-10-17).
  "20261017100100_board_budgets.sql",
  "20261017120000_board_budget_issue_scope.sql",
  // Ads on the compromise list never count (2026-10-21). It takes the read as
  // live, so cockpit_is_team_only (20261017b) is loaded first.
  "20261021a_board_skip_excluded_ads.sql",
];

const CEO = "00000000-0000-4000-8000-0000000000c1";
const ADMIN = "00000000-0000-4000-8000-0000000000a1";
const CSM = "00000000-0000-4000-8000-0000000000c2";
const CREATIVE = "00000000-0000-4000-8000-0000000000c3";
const EDITOR = "00000000-0000-4000-8000-0000000000c4";
const SALES = "00000000-0000-4000-8000-0000000000c5";
const BUYER = "00000000-0000-4000-8000-0000000000b1";
const INACTIVE = "00000000-0000-4000-8000-0000000000d1";
const UNCONFIRMED = "00000000-0000-4000-8000-0000000000d2";
const LIMITED = "00000000-0000-4000-8000-0000000000d3";
const SEATS: [string, string, string[]][] = [
  [CEO, "aziz@maharamedia.com", []],
  [ADMIN, "admin@tests.invalid", ["admin"]],
  [CSM, "csm@tests.invalid", ["csm"]],
  [CREATIVE, "creative@tests.invalid", ["creative"]],
  [EDITOR, "editor@tests.invalid", ["editor"]],
  [SALES, "sales@tests.invalid", ["sales"]],
  [BUYER, "buyer@tests.invalid", ["media_buyer"]],
  [LIMITED, "limited@tests.invalid", ["csm"]],
];

const LOC_A = "locBoardApiA00001";
const LOC_B = "locBoardApiB00002";
const LOC_C = "locBoardApiC00003";
const LOC_D = "locBoardApiD00004";
const LOC_X = "locBoardApiX00005";
const ACCT_A = "1111111111";
const ACCT_D = "2222222222";
const AGENT = "agent1@maharamedia.com";
const AGENT2 = "agent2@maharamedia.com";
const ADMIN_AGENT = "boss@maharamedia.com";
const CAL_MAIN = "calMainA";
const CAL_ONLINE = "calOnlineA";
const CAL_PROV = "calProvA";
const CAL_CB = "calCallbackA";

/** Kuwait calendar days: kd(n) is n days before today; kt(n, "HH:MM") a Kuwait wall time on it. */
const DAY = 86400_000;
const today = new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
const dayShift = (d: string, n: number) =>
  new Date(Date.parse(`${d}T12:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const kd = (n: number) => dayShift(today, -n);
const kt = (n: number, hhmm: string) =>
  new Date(`${kd(n)}T${hhmm}:00+03:00`).toISOString();
const ms = (iso: string) => Date.parse(iso);
const FROM = kd(9);
const TAB = (() => {
  const d = new Date(`${FROM}T12:00:00Z`);
  return `${d.toLocaleString("en-US", { month: "short", timeZone: "UTC" })} ${String(d.getUTCFullYear()).slice(2)}`;
})();
/** Formula Co's ten hand-written days. */
const F_FROM = kd(40);
const F_TO = kd(31);

/** The dialer's views and tables, exactly as the board facts test builds them. */
const DIALER = (() => {
  const text = readFileSync(
    new URL("./board-facts-supabase.test.ts", import.meta.url),
    "utf8",
  );
  const hit = text.match(/const DIALER = String\.raw`([\s\S]*?)`;\n/);
  if (!hit || hit[1].includes("${"))
    throw new Error("The board facts test's DIALER block moved");
  return hit[1];
})();

/** The compromise list's table, as 20261010a makes it (the rest of that file needs the dashboard's tables). */
const EXCLUDED_ADS = (() => {
  const hit = migration("20261010a_exclude_unauthorized_ads.sql").match(
    /create table if not exists public\.cockpit_excluded_ads \([\s\S]*?\n\);\nalter table public\.cockpit_excluded_ads enable row level security;\nrevoke all on public\.cockpit_excluded_ads from anon, authenticated;/,
  );
  if (!hit) throw new Error("The compromise list's table moved in 20261010a");
  return hit[0];
})();
/** cockpit_is_team_only and its grants, as 20261017b makes them: the live read asks it. */
const TEAM_ONLY = (() => {
  const sql = migration("20261017b_team_only_seats.sql");
  const fn = sql.match(
    /CREATE OR REPLACE FUNCTION public\.cockpit_is_team_only\(\)[\s\S]*?\n\$\$;/,
  );
  const revoke = sql.match(
    /REVOKE ALL ON FUNCTION public\.cockpit_is_team_only\(\) FROM [^;]*;/,
  );
  const grant = sql.match(
    /GRANT EXECUTE ON FUNCTION public\.cockpit_is_team_only\(\) TO [^;]*;/,
  );
  if (!fn || !revoke || !grant)
    throw new Error("cockpit_is_team_only moved in 20261017b");
  return `${fn[0]}\n${revoke[0]}\n${grant[0]}`;
})();

let db: PGlite;
type Row = Record<string, any>;

async function q<T = Row>(text: string, params: unknown[] = []): Promise<T[]> {
  return (await db.query<T>(text, params)).rows;
}
async function one<T = any>(text: string, params: unknown[] = []): Promise<T> {
  return (await q<{ r: T }>(text, params))[0].r;
}
async function as<T = any>(
  who: string | null,
  text: string,
  params: unknown[] = [],
): Promise<T> {
  await actor(db, who);
  try {
    return await one<T>(text, params);
  } finally {
    await owner(db);
  }
}
async function refused(
  who: string | null,
  text: string,
  params: unknown[] = [],
) {
  await actor(db, who);
  try {
    await db.query(text, params);
  } catch (e) {
    await owner(db);
    return (e as Error).message;
  }
  await owner(db);
  throw new Error(`Expected a refusal for ${text}`);
}
async function service<T = any>(
  text: string,
  params: unknown[] = [],
): Promise<T> {
  await owner(db);
  await db.query("SELECT set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({ role: "service_role" }),
  ]);
  await db.exec("SET ROLE service_role");
  try {
    return await one<T>(text, params);
  } finally {
    await owner(db);
  }
}
const board = (who: string, from = F_FROM, to = F_TO) =>
  as(who, "SELECT public.cockpit_board_read($1::date,$2::date) AS r", [
    from,
    to,
  ]);
const client = (who: string, loc: string, from = F_FROM, to = F_TO) =>
  as(who, "SELECT public.cockpit_board_client($1,$2::date,$3::date) AS r", [
    loc,
    from,
    to,
  ]);
const rowOf = (b: Row, loc: string) =>
  (b.clients as Row[]).find(c => c.locationId === loc) as Row;
const r2 = (n: number) => Math.round(n * 100) / 100;

async function lead(id: string, loc: string, created: string, extra: Row = {}) {
  await q(
    "INSERT INTO public.client_leads(ghl_contact_id,location_id,created_at,channel,ad_id,campaign_id,contact_name,contact_phone,deleted) VALUES($1,$2,$3,$4,$5,$6,$7,$8,false)",
    [
      id,
      loc,
      created,
      extra.channel ?? "Meta",
      extra.ad ?? null,
      extra.campaign ?? null,
      extra.name ?? null,
      extra.phone ?? null,
    ],
  );
}
async function appt(id: string, loc: string, extra: Row) {
  await q(
    `INSERT INTO public.appointments(ghl_appointment_id,ghl_contact_id,ghl_location_id,calendar_id,contact_phone,booked_at,start_at,status,attended,attended_source,ghl_source,ad_id,contact_name)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [
      id,
      extra.contact ?? null,
      loc,
      extra.calendar ?? CAL_MAIN,
      extra.phone ?? null,
      extra.booked,
      extra.start,
      extra.status ?? "confirmed",
      extra.attended ?? null,
      extra.attended === undefined || extra.attended === null ? null : "sheet",
      extra.source ?? null,
      extra.ad ?? null,
      extra.name ?? null,
    ],
  );
}
async function outcome(
  loc: string,
  appointment: string,
  revision: number,
  extra: Row,
) {
  await q(
    "INSERT INTO portal_data.appointment_outcomes(location_id,appointment_id,revision,attendance,deal,quotation,project_value,currency,lead_quality,source) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'portal')",
    [
      loc,
      appointment,
      revision,
      extra.attendance ?? null,
      extra.deal ?? null,
      extra.quotation ?? null,
      extra.value ?? null,
      extra.currency ?? null,
      extra.lq ?? null,
    ],
  );
}
/** One Meta ad-day. */
async function adDay(r: Row) {
  await q(
    `INSERT INTO public.cockpit_meta_ad_days(account_id,account_name,account_timezone,account_currency,day,campaign_id,campaign_name,objective,
       adset_id,adset_name,ad_id,ad_name,spend,spend_usd,usd_rate,impressions,reach,frequency,link_clicks,leads,lead_actions,
       video_plays,video_3s,video_p25,video_p50,video_p75,video_p100,thruplays,destination_type,fetched_at)
     VALUES($1,$2,$3,'USD',$4,$5,$6,$7,$8,$9,$10,$11,$12,$12,1,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,now())`,
    [
      r.account,
      r.accountName ?? "Ads",
      r.tz ?? "Asia/Kuwait",
      r.day,
      r.campaign,
      r.campaignName ?? `Campaign ${r.campaign}`,
      r.objective ?? "OUTCOME_LEADS",
      r.adset,
      r.adsetName ?? `Ad set ${r.adset}`,
      r.ad,
      r.adName ?? `Ad ${r.ad}`,
      r.spend,
      r.imp,
      r.reach ?? null,
      r.freq ?? null,
      r.clicks,
      r.leads ?? null,
      r.leadActions ?? r.leads ?? 0,
      r.plays ?? null,
      r.v3 ?? null,
      r.p25 ?? null,
      r.p50 ?? null,
      r.p75 ?? null,
      r.p100 ?? null,
      r.thru ?? null,
      r.destination ?? null,
    ],
  );
}

// Client A's meetings (kd/kt relative to today), the no-outcome scenario.
const AP = {
  sheetAttended: { start: kt(2, "12:00"), booked: kt(3, "11:00") },
  crmNoshow: { start: kt(2, "13:00"), booked: kt(3, "12:00") },
  portalShowed: { start: kt(2, "14:00"), booked: kt(3, "13:00") },
  unmarked: { start: kt(2, "15:00"), booked: kt(3, "14:00") },
  google: { start: kt(2, "16:00"), booked: kt(3, "15:00") },
  sheetRowOnly: { start: kt(1, "10:00"), booked: kt(2, "09:00") },
  provisional: { start: kt(1, "11:00"), booked: kt(2, "09:30") },
  cancelled: { start: kt(1, "12:00"), booked: kt(2, "10:00") },
  future: { start: kt(-1, "10:00"), booked: kt(1, "08:00") },
  callback: { start: kt(1, "13:00"), booked: kt(2, "10:30") },
  dialerBooked: { start: kt(4, "10:00"), booked: kt(5, "09:00") },
  widget: { start: kt(5, "16:00"), booked: kt(6, "09:00") },
};

let callersBefore: Row[] = [];

beforeAll(async () => {
  db = await cockpitTestDb({ supabaseDefaultPrivileges: true });
  const allowed = migration("20260926m_cockpit_csm_state.sql").match(
    /CREATE OR REPLACE FUNCTION public\.cockpit_client_allowed\(p_name text\)[\s\S]*?END \$\$;/,
  );
  const seat = migration("20261007d_cockpit_team_rpc_restore.sql").match(
    /create or replace function public\.cockpit_has_active_seat\(\)[\s\S]*?\$\$;/,
  );
  expect(allowed).not.toBeNull();
  expect(seat).not.toBeNull();
  await db.exec(allowed![0]);
  await db.exec(seat![0]);
  await db.exec(`REVOKE ALL ON FUNCTION public.cockpit_has_active_seat(), public.cockpit_client_allowed(text) FROM PUBLIC, anon;
    GRANT EXECUTE ON FUNCTION public.cockpit_has_active_seat(), public.cockpit_client_allowed(text) TO authenticated, service_role;`);
  await db.exec(DIALER);
  // The live appointments table also carries the ad and the contact's name.
  await db.exec(`ALTER TABLE public.appointments ADD COLUMN ad_id text, ADD COLUMN adset_id text, ADD COLUMN campaign_id text,
    ADD COLUMN contact_name text;`);
  for (const [id, email, roles] of SEATS) await member(db, id, email, roles);
  await member(db, INACTIVE, "inactive@tests.invalid", ["media_buyer"], false);
  await member(
    db,
    UNCONFIRMED,
    "unconfirmed@tests.invalid",
    ["media_buyer"],
    true,
    false,
  );
  await owner(db);
  await q(
    "UPDATE public.cockpit_members SET clients = ARRAY['Client A'] WHERE auth_user_id = $1",
    [LIMITED],
  );

  await db.exec(`
    INSERT INTO public.ghl_clients(location_id,client_name,status,clickup_id,meta_ad_account,country,service_mode,tiktok_ad_account) VALUES
     ('${LOC_A}','Client A','Active','CU_A',NULL,'KW','DFY',NULL),
     ('${LOC_B}','Client B','Active','CU_B',NULL,'SA','dwy',NULL),
     ('${LOC_C}','Client C','Launching',NULL,NULL,'KW',NULL,'Client C TikTok'),
     ('${LOC_D}','Formula Co','Active','CU_D',NULL,'KW','DFY',NULL),
     ('${LOC_X}','Old client','Cancelled','CU_X',NULL,'KW','DFY',NULL);
    INSERT INTO public.clients(name,meta_ad_account_id,ghl_location_id,hidden_from_dashboard) VALUES
     ('Client A ads','act_${ACCT_A}','${LOC_A}',false),
     ('Formula ads','act_${ACCT_D}','${LOC_D}',false);
    INSERT INTO public.cockpit_people(name,email,role,active,schedule) VALUES
     ('Agent One','${AGENT}','Call centre agent',true,NULL),
     ('Agent Two','${AGENT2}','Call center agent',true,NULL),
     ('The Boss','${ADMIN_AGENT}','CEO',true,NULL);
    INSERT INTO mahara_console.metadata VALUES
     ('production','access:agent:${AGENT}','{"email":"${AGENT}","active":true,"locationIds":["${LOC_A}","${LOC_B}","${LOC_C}"]}'),
     ('production','identity:account:${AGENT}','{"email":"${AGENT}","role":"agent","enabled":true}'),
     ('production','access:agent:${AGENT2}','{"email":"${AGENT2}","active":true,"locationIds":["${LOC_D}","${LOC_A}"]}'),
     ('production','access:agent:${ADMIN_AGENT}','{"email":"${ADMIN_AGENT}","active":true,"locationIds":["${LOC_A}","${LOC_D}"]}'),
     ('production','identity:account:${ADMIN_AGENT}','{"email":"${ADMIN_AGENT}","role":"admin","enabled":true}'),
     ('production','access:agent:gone@maharamedia.com','{"email":"gone@maharamedia.com","active":false,"locationIds":["${LOC_D}"]}');
    INSERT INTO public.ghl_calendars(location_id,calendar_id,name) VALUES
     ('${LOC_A}','${CAL_MAIN}','Main Appointment Calendar'),
     ('${LOC_A}','${CAL_ONLINE}','Online Appointment Calendar'),
     ('${LOC_A}','${CAL_PROV}','Not Confirmed Appointments'),
     ('${LOC_A}','${CAL_CB}','Callback Calendar');
    INSERT INTO public.lead_sync_state VALUES ('${LOC_A}',now(),'success',NULL),('${LOC_B}',now(),'success',NULL),('${LOC_D}',now(),'success',NULL);
    INSERT INTO public.appointment_sync_state VALUES ('${LOC_A}',now(),'success'),('${LOC_B}',now(),'success'),('${LOC_D}',now(),'success');
    INSERT INTO mahara_reporting.sync_jobs VALUES
     ('production','j1','ghl','${LOC_A}','appointments_recent',now(),NULL),
     ('production','maqsam:${AGENT}','maqsam','${AGENT}','calls',now(),NULL);
  `);

  // Client A: leads (two from ad 70001, two from 70002, one from 70009 that is not in the Meta store, one with no ad).
  await lead("L1", LOC_A, kt(3, "10:00"), {
    ad: "70001",
    campaign: "80001",
    name: "Sara Ahmad",
    phone: "+96550000001",
  });
  await lead("L2", LOC_A, kt(3, "11:00"), {
    ad: "70001",
    campaign: "80001",
    name: "Omar  Khalid",
    phone: "+96550000002",
  });
  await lead("L3", LOC_A, kt(3, "12:00"), {
    ad: "70009",
    campaign: "80009",
    name: "Huda",
    phone: "+96550000003",
  });
  await lead("L4", LOC_A, kt(3, "13:00"), {
    channel: "Other",
    name: "Ali",
    phone: "+96550000004",
  });
  await lead("L5", LOC_A, kt(5, "13:00"), {
    ad: "70002",
    campaign: "80001",
    name: "Mona Saleh",
    phone: "+96550000005",
  });
  await lead("L6", LOC_A, kt(6, "08:00"), {
    ad: "70002",
    campaign: "80001",
    name: "Yousef",
    phone: "+96550000006",
  });

  // Client A's meetings.
  await appt("AP1", LOC_A, {
    contact: "L1",
    ...AP.sheetAttended,
    attended: true,
    ad: "70001",
    name: "Sara Ahmad",
  });
  await appt("AP2", LOC_A, {
    contact: "L2",
    ...AP.crmNoshow,
    status: "noshow",
    ad: "70001",
    name: "Omar  Khalid",
  });
  await appt("AP3", LOC_A, { contact: "L3", ...AP.portalShowed, ad: "70009" });
  await appt("AP4", LOC_A, {
    contact: "L4",
    ...AP.unmarked,
    name: "Ali Hassan",
  });
  await appt("AP5", LOC_A, {
    contact: "GC1",
    ...AP.google,
    source: "google_calendar",
  });
  await appt("AP6", LOC_A, {
    contact: "L5",
    calendar: CAL_ONLINE,
    phone: "+96550000005",
    ...AP.sheetRowOnly,
    ad: "70002",
  });
  await appt("AP7", LOC_A, {
    contact: "L6",
    calendar: CAL_PROV,
    ...AP.provisional,
    source: "calendar_page",
  });
  await appt("AP8", LOC_A, {
    contact: "L1",
    ...AP.cancelled,
    status: "cancelled",
  });
  await appt("AP9", LOC_A, { contact: "L2", ...AP.future });
  await appt("AP10", LOC_A, {
    contact: "L3",
    calendar: CAL_CB,
    ...AP.callback,
  });
  await appt("AP11", LOC_A, {
    contact: "L5",
    ...AP.dialerBooked,
    ad: "70002",
    source: "third_party",
  });
  await appt("AP12", LOC_A, {
    contact: "L6",
    ...AP.widget,
    source: "booking_widget",
    ad: "70002",
  });
  await outcome(LOC_A, "AP3", 1, { attendance: "no_show" });
  await outcome(LOC_A, "AP3", 2, { attendance: "showed", lq: 8 });
  // The dialer verified AP11's booking.
  await q(
    "INSERT INTO mahara_console.attempts VALUES('production','T1',$1,$2,'closed',$3::jsonb,$4)",
    [
      `${LOC_A}:L5`,
      AGENT,
      JSON.stringify({
        locationId: LOC_A,
        contactId: "L5",
        mode: "outcome",
        dispositionSavedAt: ms(AP.dialerBooked.booked),
        disposition: { outcome: "BOOKED", note: "Booked on the call" },
        bookingVerification: {
          id: "AP11",
          calendarId: CAL_MAIN,
          startTime: AP.dialerBooked.start,
          verifiedAt: AP.dialerBooked.booked,
          appointmentStatus: "confirmed",
        },
      }),
      ms(AP.dialerBooked.booked),
    ],
  );
  // The client's sheet marks AP6 showed: only the dialer's read of it holds that.
  await q(
    "INSERT INTO mahara_reporting.sheet_snapshots VALUES('production',$1,'Client A','S_A',true,$2::jsonb,now(),NULL)",
    [
      LOC_A,
      JSON.stringify({
        sheetId: "S_A",
        currency: null,
        rows: [
          {
            tab: TAB,
            phone: "+96550000005",
            meeting: ms(AP.sheetRowOnly.start),
            show: "Y",
            closed: "N",
          },
        ],
      }),
    ],
  );

  await db.exec(migration("20261013180000_cockpit_client_calls.sql"));
  await db.exec(
    migration("20261015200000_cockpit_client_calls_whatsapp_chats.sql"),
  );
  await db.exec(migration("20261013180200_cockpit_client_callers.sql"));
  await db.exec(migration("20261016111157_board_facts.sql"));
  await db.exec(migration("20261016121700_meta_ad_days.sql"));
  callersBefore = (await as(CSM, "SELECT public.cockpit_client_callers() AS r"))
    .clients;

  // The facts for the last 10 days, from the sources above.
  await owner(db);
  const refreshed = await one(
    "SELECT public.cockpit_board_facts_refresh($1::date,$2::date) AS r",
    [FROM, today],
  );
  expect(refreshed.ok).toBe(true);

  // Formula Co: ten hand-written days well before the refresh window.
  for (let i = 0; i < 10; i++) {
    const day = kd(40 - i);
    const shows = i < 7 ? 1 : i < 9 ? 0 : null;
    const noShows = i < 7 ? 0 : i < 9 ? 1 : null;
    await q(
      `INSERT INTO public.cockpit_client_days(location_id,day,crm_leads,crm_ad_leads,confirmed_bookings,provisional_bookings,meetings_due,
         shows,no_shows,no_outcome,quotations,quotation_answers,closes,closes_with_value,revenue_usd,lead_quality_sum,lead_quality_count,
         dials,leads_called,sources)
       VALUES($1,$2,4,3,1,0,1,$3,$4,$5,$6,NULL,$7,$8,$9,$10,$11,10,4,'{}'::jsonb)`,
      [
        LOC_D,
        day,
        shows,
        noShows,
        i === 9 ? 1 : 0,
        i < 4 ? 1 : 0,
        i < 2 ? 1 : 0,
        i < 2 ? 1 : 0,
        i === 0 ? 15000 : i === 1 ? 5000 : 0,
        i < 3 ? 6 : 0,
        i < 3 ? 1 : 0,
      ],
    );
    // An image lead ad, a video lead ad and an engagement ad, on a Riyadh account.
    const base = {
      account: ACCT_D,
      tz: "Asia/Riyadh",
      day,
      campaign: "90001",
      adset: "91001",
    };
    await adDay({
      ...base,
      ad: "92001",
      adName: "Kitchen photo",
      spend: 50,
      imp: 10000,
      clicks: 100,
      leads: 4,
      freq: 1.2,
      destination: "ON_AD",
    });
    await adDay({
      ...base,
      ad: "92002",
      adName: "Kitchen video",
      spend: 30,
      imp: 5000,
      clicks: 25,
      leads: 1,
      freq: 1.5,
      plays: 4500,
      v3: 1000,
      p25: 2000,
      p50: 1000,
      p75: 500,
      p100: 250,
      thru: 300,
      destination: "ON_AD",
    });
    await adDay({
      ...base,
      campaign: "90002",
      adset: "91002",
      ad: "92003",
      objective: "OUTCOME_ENGAGEMENT",
      spend: 20,
      imp: 5000,
      clicks: 10,
    });
  }

  // Client A's ads: the last six days and today. Today is not in yet.
  for (let i = 1; i <= 6; i++) {
    const base = {
      account: ACCT_A,
      day: kd(i),
      campaign: "80001",
      campaignName: "Kitchens leads",
    };
    await adDay({
      ...base,
      adset: "81001",
      adsetName: "Form",
      ad: "70001",
      adName: "Sara video",
      spend: 10,
      imp: 1000,
      clicks: 10,
      leads: 1,
      freq: 1.1,
      plays: 900,
      v3: 300,
      p25: 400,
      p50: 200,
      p75: 100,
      p100: 50,
      thru: 90,
      destination: "ON_AD",
    });
    await adDay({
      ...base,
      adset: "81001",
      adsetName: "Form",
      ad: "70002",
      adName: "Still image",
      spend: 5,
      imp: 500,
      clicks: 5,
      leads: 0,
      freq: 1.1,
      destination: "ON_AD",
    });
    await adDay({
      ...base,
      adset: "81002",
      adsetName: "WhatsApp",
      ad: "70003",
      adName: "Chat ad",
      spend: 7,
      imp: 700,
      clicks: 7,
      leads: null,
      leadActions: 2,
      freq: 1.1,
      destination: "WHATSAPP",
    });
  }
  await adDay({
    account: ACCT_A,
    day: today,
    campaign: "80001",
    campaignName: "Kitchens leads",
    adset: "81001",
    adsetName: "Form",
    ad: "70001",
    adName: "Sara video",
    spend: 999,
    imp: 99999,
    clicks: 999,
    leads: 99,
    destination: "ON_AD",
  });
  // Meta's reach for client A over the last 7 days.
  await q(
    `INSERT INTO public.cockpit_meta_reach(level,key,window_key,from_day,to_day,reach,impressions,account_id,note)
     VALUES('client',$1,'last_7',$2,$3,5000,12000,NULL,NULL)`,
    [LOC_A, kd(6), today],
  );

  await db.exec(EXCLUDED_ADS);
  await db.exec(TEAM_ONLY);
  await db.exec(migration(FILE));
  for (const f of FIXES) await db.exec(migration(f));
  for (const f of READ_CHECKED) await db.exec(migration(f));
}, 180_000);

afterAll(async () => {
  await db?.close();
});

describe("who may read the board", () => {
  test("no session, an inactive seat and an unconfirmed email are refused", async () => {
    for (const who of [null, INACTIVE, UNCONFIRMED]) {
      expect(
        await refused(
          who,
          "SELECT public.cockpit_board_read($1::date,$2::date)",
          [F_FROM, F_TO],
        ),
      ).toMatch(/active cockpit seat|permission denied/);
      expect(
        await refused(
          who,
          "SELECT public.cockpit_board_client($1,$2::date,$3::date)",
          [LOC_D, F_FROM, F_TO],
        ),
      ).toMatch(/active cockpit seat|permission denied/);
    }
  });

  test("every active seat reads it, whatever its role", async () => {
    for (const [id] of SEATS) {
      const b = await board(id);
      expect(b.clients.length).toBeGreaterThan(0);
    }
  });

  test("the CEO, admins and unlimited seats see every Active client; a launching one is off the board, its page still opens", async () => {
    for (const id of [CEO, ADMIN, CREATIVE, SALES]) {
      const names = (await board(id)).clients.map((c: Row) => c.clientName);
      expect(names).toEqual(["Client A", "Client B", "Formula Co"]);
    }
    const page = await client(CEO, LOC_C);
    expect(page.client.clientName).toBe("Client C");
    expect(page.client.status).toBe("Launching");
  });

  test("a seat limited to some clients sees those only, and the client page refuses the rest", async () => {
    const names = (await board(LIMITED)).clients.map((c: Row) => c.clientName);
    expect(names).toEqual(["Client A"]);
    expect(
      await refused(
        LIMITED,
        "SELECT public.cockpit_board_client($1,$2::date,$3::date)",
        [LOC_D, F_FROM, F_TO],
      ),
    ).toMatch(/not on your board/);
    expect((await client(LIMITED, LOC_A, kd(6), today)).clientName).toBe(
      "Client A",
    );
  });

  test("unlinked ad accounts and the Meta jobs' notes reach only the CEO, admins and unlimited seats", async () => {
    await owner(db);
    const note =
      "1 of 3 ad accounts could not be read. Not linked to a client: Pidco Test 9999999999.";
    await q(
      `INSERT INTO public.cockpit_meta_ad_day_runs(job,state,requested_by,accounts,detail,note,started_at,finished_at)
       VALUES('hourly','partial','cron',$1::jsonb,'{"tieSource":"board_clients"}'::jsonb,$2,now(),now())`,
      [
        JSON.stringify([
          {
            accountId: "9999999999",
            name: "Pidco Test",
            currency: "USD",
            spend: 12,
            linked: false,
          },
        ]),
        note,
      ],
    );
    try {
      for (const who of [CEO, ADMIN, CREATIVE]) {
        const b = await board(who);
        expect(b.notLinked).toEqual([
          {
            accountId: "9999999999",
            name: "Pidco Test",
            currency: "USD",
            spend: 12,
          },
        ]);
        expect(b.notes).toContain(note);
        expect(b.freshness.meta.hourly.note).toBe(note);
      }
      const limited = await board(LIMITED);
      expect(limited.notLinked).toEqual([]);
      expect(limited.freshness.meta.hourly.state).toBe("partial");
      expect(limited.freshness.meta.hourly.note).toBeUndefined();
      expect(limited.freshness.meta.note).toBe(
        "The last Meta read did not finish every ad account.",
      );
      expect(limited.notes).toContain(
        "The last Meta read did not finish every ad account.",
      );
      expect(JSON.stringify(limited)).not.toMatch(/Pidco|9999999999/);
    } finally {
      await owner(db);
      await q("DELETE FROM public.cockpit_meta_ad_day_runs WHERE note = $1", [
        note,
      ]);
    }
  });

  test("an unknown or cancelled client reads the same as one outside the seat", async () => {
    expect(
      await refused(
        CEO,
        "SELECT public.cockpit_board_client($1,$2::date,$3::date)",
        ["nope", F_FROM, F_TO],
      ),
    ).toMatch(/not on your board/);
    const c = await client(CEO, LOC_X, F_FROM, F_TO);
    expect(c.client).toBeNull();
  });

  test("the time frame is checked", async () => {
    expect(
      await refused(
        CEO,
        "SELECT public.cockpit_board_read($1::date,$2::date)",
        [F_TO, F_FROM],
      ),
    ).toMatch(/first day on or before/);
    expect(
      await refused(
        CEO,
        "SELECT public.cockpit_board_read($1::date,$2::date)",
        [today, kd(-1)],
      ),
    ).toMatch(/up to today/);
    expect(
      await refused(
        CEO,
        "SELECT public.cockpit_board_read($1::date,$2::date)",
        [kd(400), today],
      ),
    ).toMatch(/at most 366/);
  });

  test("the tables and the internal functions are closed to every browser role", async () => {
    for (const table of [
      "cockpit_board_targets",
      "cockpit_board_levers",
      "cockpit_board_provider_health",
    ]) {
      expect(await refused(CEO, `SELECT * FROM public.${table}`)).toMatch(
        /permission denied/,
      );
    }
    for (const fn of [
      "public.cockpit_board_rows(current_date, current_date, NULL, '{}'::jsonb)",
      "public.cockpit_client_caller_rows()",
      "public.cockpit_board_no_outcome_list('x', current_date, current_date, NULL)",
      "public.cockpit_board_lever_begin(gen_random_uuid(), '{}'::jsonb, '{}'::jsonb)",
    ]) {
      expect(await refused(CEO, `SELECT ${fn}`)).toMatch(/permission denied/);
      expect(await refused(null, `SELECT ${fn}`)).toMatch(/permission denied/);
    }
    const grants = await q<{ fn: string; roles: string }>(
      `SELECT p.proname AS fn, coalesce(string_agg(DISTINCT g.grantee, ',' ORDER BY g.grantee), '') AS roles
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       LEFT JOIN information_schema.routine_privileges g ON g.specific_name = p.proname || '_' || p.oid
         AND g.grantee IN ('anon','authenticated','service_role','PUBLIC')
       WHERE n.nspname = 'public' AND (p.proname LIKE 'cockpit_board_%' OR p.proname IN ('cockpit_client_caller_rows','cockpit_client_callers'))
         AND p.proname NOT LIKE 'cockpit_board_facts%' AND p.proname NOT IN ('cockpit_board_norm','cockpit_board_calendar_kind','cockpit_board_usd_rate')
       GROUP BY p.proname ORDER BY 1`,
    );
    const open = Object.fromEntries(grants.map(g => [g.fn, g.roles]));
    expect(open).toEqual({
      cockpit_board_account_words: "",
      cockpit_board_ad_cells: "",
      cockpit_board_ad_cover: "",
      cockpit_board_ad_unmeasured: "",
      cockpit_board_add_note: "",
      cockpit_board_appointments: "",
      cockpit_board_audit: "",
      cockpit_board_budget_cells: "",
      cockpit_board_budget_clocks: "",
      cockpit_board_budget_list: "",
      cockpit_board_card_status: "",
      cockpit_board_cell: "",
      cockpit_board_check_window: "",
      cockpit_board_client: "authenticated",
      cockpit_board_count: "",
      cockpit_board_default_targets: "service_role",
      cockpit_board_floor_status: "",
      cockpit_board_fmt: "",
      cockpit_board_judge: "",
      cockpit_board_lever_begin: "service_role",
      cockpit_board_lever_context: "authenticated",
      cockpit_board_lever_finish: "service_role",
      cockpit_board_lever_json: "",
      cockpit_board_marks_json: "",
      cockpit_board_money: "",
      cockpit_board_no_outcome_list: "",
      cockpit_board_paired: "",
      cockpit_board_read: "authenticated",
      cockpit_board_rows: "",
      cockpit_board_sheet_marks: "",
      cockpit_board_shows: "",
      cockpit_board_spend_known: "",
      cockpit_board_targets_map: "",
      cockpit_board_targets_save: "authenticated",
      cockpit_board_tree: "",
      cockpit_client_caller_rows: "service_role",
      cockpit_client_callers: "authenticated",
    });
  });
});

describe("the default targets", () => {
  test("are the approved list, pinned to both kpi.ts copies and CALL_RULES", async () => {
    for (const k of [
      "CPL_GATE",
      "CPL_BAD",
      "CPB_GATE",
      "CPB_BAD",
      "BOOKING_RATE_GATE",
      "SHOW_RATE_AIM",
      "SHOW_RATE_GOOD",
      "CLOSE_RATE_GATE",
      "LINK_CTR_FLOOR",
    ] as const) {
      expect((csKpi as Row)[k]).toBe((kpi as Row)[k]);
    }
    expect(CS_CALL_RULES).toEqual(CALL_RULES);
    const rows = await q<Row>(
      "SELECT metric, good::float AS good, watch::float AS watch, direction, strict_good, never_off, min_sample::float AS min FROM public.cockpit_board_default_targets()",
    );
    const t = Object.fromEntries(rows.map(r => [r.metric, r]));
    expect(t.cpl).toMatchObject({
      good: kpi.CPL_GATE,
      watch: kpi.CPL_BAD,
      direction: "lower",
    });
    expect(t.cost_per_booking).toMatchObject({
      good: kpi.CPB_GATE,
      watch: kpi.CPB_BAD,
      direction: "lower",
    });
    expect(t.lead_to_booking).toMatchObject({
      good: kpi.BOOKING_RATE_GATE,
      watch: 17.5,
      min: 10,
    });
    expect(t.show_rate).toMatchObject({
      good: kpi.SHOW_RATE_AIM,
      watch: kpi.SHOW_RATE_GOOD,
      never_off: true,
      min: 5,
    });
    expect(t.close_rate).toMatchObject({
      good: 30,
      watch: kpi.CLOSE_RATE_GATE,
      min: 5,
    });
    expect(t.link_ctr).toMatchObject({
      good: 0.8,
      watch: kpi.LINK_CTR_FLOOR,
      min: 1000,
    });
    // callCentreVerdict calls any miss of CALL_RULES the call centre's problem: the watch line is the good line.
    expect(t.leads_touched).toMatchObject({
      good: CALL_RULES.touchedShare,
      watch: CALL_RULES.touchedShare,
      min: CALL_RULES.minLeads,
    });
    expect(t.first_call).toMatchObject({
      good: CALL_RULES.firstCallWorkMinutes,
      watch: CALL_RULES.firstCallWorkMinutes,
      direction: "lower",
    });
    expect(t.frequency).toMatchObject({
      good: 2.5,
      watch: 3.5,
      strict_good: true,
      min: 1000,
    });
    expect(t.opt_in).toMatchObject({ good: 10, watch: 2, min: 50 });
    // The rest of the approved list, line by line.
    const rest: [string, number, number | null][] = [
      ["quotation_rate", 50, 30],
      ["aov", 10000, null],
      ["roas", 20, 10],
      ["lead_quality", 7, 5],
      ["no_outcome_share", 0, 10],
      ["cpm", 10, 15],
      ["cpc", 1.25, 2],
      ["hook_rate", 25, 15],
      ["hold_rate", 30, 15],
    ];
    for (const [m, good, watch] of rest)
      expect(t[m]).toMatchObject({ good, watch });
    // Budget used (2026-10-17): a starting aim, judged from 3 days with a budget, before CPM.
    expect(t.budget_used).toMatchObject({
      good: 90,
      watch: 70,
      direction: "higher",
      strict_good: false,
      never_off: false,
      min: 3,
    });
    const order = rows.map(r => r.metric);
    expect(order.indexOf("budget_used")).toBe(order.indexOf("cpm") - 1);
    expect(order.indexOf("budget_used")).toBe(
      order.indexOf("no_outcome_share") + 1,
    );
    const pinned = await q<Row>(
      "SELECT value_key, label, unit, sample, owner_department, basis FROM public.cockpit_board_default_targets() WHERE metric = 'budget_used'",
    );
    expect(pinned).toEqual([
      {
        value_key: "budgetUsed",
        label: "Budget used",
        unit: "percent",
        sample: "days with a budget",
        owner_department: "media_buyer",
        basis:
          "set 2026-10-17 as a starting aim; Meta paces a daily budget over a week (up to 75% over on one day, at most 7 times it in a week), so the time frame is judged, never one day",
      },
    ]);
    expect(rows).toHaveLength(20);
  });

  test("the judge: lines are inclusive, frequency's good is strict, the show rate is never off", async () => {
    const j = (
      v: number,
      d: string,
      g: number,
      w: number | null,
      s = false,
      n = false,
    ) =>
      one<string>("SELECT public.cockpit_board_judge($1,$2,$3,$4,$5,$6) AS r", [
        v,
        d,
        g,
        w,
        s,
        n,
      ]);
    expect(await j(15, "lower", 15, 22.5)).toBe("good");
    expect(await j(22.5, "lower", 15, 22.5)).toBe("watch");
    expect(await j(22.51, "lower", 15, 22.5)).toBe("off");
    expect(await j(2.5, "lower", 2.5, 3.5, true)).toBe("watch");
    expect(await j(2.49, "lower", 2.5, 3.5, true)).toBe("good");
    expect(await j(40, "higher", 70, 60, false, true)).toBe("watch");
    expect(await j(9000, "higher", 10000, null)).toBe("watch");
    expect(await j(25, "higher", 25, 17.5)).toBe("good");
    expect(await j(17, "higher", 25, 17.5)).toBe("off");
  });
});

describe("the formulas, on Formula Co's ten known days", () => {
  let row: Row;
  let v: Row;
  beforeAll(async () => {
    const b = await board(CREATIVE);
    row = rowOf(b, LOC_D);
    v = row.values;
  });

  test("counts are the sums of the days", () => {
    expect(v.crmLeads).toEqual({ v: 40, status: null });
    expect(v.crmAdLeads.v).toBe(30);
    expect(v.confirmedBookings.v).toBe(10);
    expect(v.provisionalBookings.v).toBe(0);
    expect(v.meetingsDue.v).toBe(10);
    expect(v.shows).toMatchObject({ v: 7, noShows: 2, marked: 9, due: 10 });
    expect(v.quotations.v).toBe(4);
    // Formula Co's sheet copy keeps only Y: answers cannot be told, never 0.
    expect(v.quotationAnswers).toEqual({
      v: null,
      status: "not_measured",
      note: "The client sheet copy keeps only Y, so answers cannot be counted.",
    });
    expect(v.closes).toMatchObject({ v: 2, withValue: 2 });
    expect(v.revenue.v).toBe(20000);
    expect(v.dials.v).toBe(100);
    expect(v.leadsCalled).toMatchObject({ v: 40, share: 100 });
    expect(row.noOutcome).toBe(1);
  });

  test("rates are the sum of numerators over the sum of denominators, each judged", () => {
    expect(v.leadToBooking).toMatchObject({
      v: 25,
      status: "good",
      num: 10,
      den: 40,
    });
    // Leads and bookings are known on all ten days: nothing partial.
    expect(v.leadToBooking.partial).toBeUndefined();
    expect(v.leadToBooking.note).toBeUndefined();
    expect(v.showRate).toMatchObject({
      v: r2((7 / 9) * 100),
      status: "good",
      num: 7,
      den: 9,
    });
    expect(v.quotationRate).toMatchObject({
      v: r2((4 / 7) * 100),
      status: "good",
      num: 4,
      den: 7,
    });
    // The last day's meeting is unmarked (shows NULL): the rates of shows are over the other nine.
    expect(v.closeRate).toMatchObject({
      v: r2((2 / 7) * 100),
      status: "watch",
      partial: true,
      note: "Over the 9 of 10 days where both are known.",
    });
    expect(v.aov).toMatchObject({
      v: 10000,
      status: "good",
      num: 20000,
      den: 2,
    });
    expect(v.leadQuality).toMatchObject({ v: 6, status: "watch", sample: 3 });
    expect(v.noOutcomeShare).toMatchObject({
      v: 10,
      status: "watch",
      num: 1,
      den: 10,
    });
  });

  test("the ad columns: spend, CPM, CTR, CPC, CPL on form leads, opt-in, hook, hold, retention", () => {
    expect(v.spend.v).toBe(1000);
    expect(v.impressions.v).toBe(200000);
    expect(v.linkClicks.v).toBe(1350);
    expect(v.metaLeads.v).toBe(50);
    expect(v.cpm).toMatchObject({ v: 5, status: "good" });
    expect(v.linkCtr).toMatchObject({
      v: r2((1350 / 200000) * 100),
      status: "watch",
    });
    expect(v.cpc).toMatchObject({ v: r2(1000 / 1350), status: "good" });
    // Cost per lead leaves out the engagement campaign's spend.
    expect(v.cpl).toMatchObject({ v: 16, status: "watch", num: 800, den: 50 });
    expect(v.optIn).toMatchObject({
      v: 4,
      status: "watch",
      num: 50,
      den: 1250,
    });
    expect(v.hookRate).toMatchObject({
      v: 20,
      status: "watch",
      num: 10000,
      den: 50000,
    });
    expect(v.holdRate).toMatchObject({
      v: 30,
      status: "good",
      num: 3000,
      den: 10000,
    });
    expect(v.retention25).toMatchObject({
      v: r2((20000 / 45000) * 100),
      status: null,
    });
    expect(v.retention100.v).toBe(r2((2500 / 45000) * 100));
    // Not a standard window: impressions-weighted daily frequency.
    expect(v.frequency).toMatchObject({
      v: 1.3,
      status: "good",
      basis: "average_daily",
    });
  });

  test("cost per booking and ROAS divide by the same days as spend", () => {
    expect(v.costPerBooking).toMatchObject({
      v: 100,
      status: "off",
      num: 1000,
      den: 10,
    });
    expect(v.roas).toMatchObject({
      v: 20,
      status: "good",
      num: 20000,
      den: 1000,
    });
  });

  test("the row names its callers by the dialer's assignment", () => {
    expect(row.callers).toEqual([{ email: AGENT2, name: "Agent Two" }]);
  });

  test("under the minimum sample a rate is shown and called too few", async () => {
    const one = rowOf(await board(CREATIVE, F_FROM, F_FROM), LOC_D).values;
    expect(one.leadToBooking).toMatchObject({
      v: 25,
      status: "too_few",
      sample: 4,
    });
    expect(one.showRate).toMatchObject({
      v: 100,
      status: "too_few",
      sample: 1,
    });
    expect(one.closeRate).toMatchObject({ v: 100, status: "too_few" });
    // 125 link clicks is over the 50 the opt-in rate needs: judged.
    expect(one.optIn).toMatchObject({ v: 4, status: "watch", sample: 125 });
  });

  test("quotation answers are summed where the source can tell them", async () => {
    await owner(db);
    await q(
      "UPDATE public.cockpit_client_days SET quotation_answers = 2 WHERE location_id = $1 AND day BETWEEN $2 AND $3",
      [LOC_D, F_FROM, kd(37)],
    );
    try {
      const v = rowOf(await board(CREATIVE), LOC_D).values;
      expect(v.quotationAnswers).toMatchObject({
        v: 8,
        status: null,
        atLeast: true,
      });
      expect(v.quotationAnswers.note).toMatch(
        /6 of the 10 days have no figure/,
      );
      const known = rowOf(await board(CREATIVE, F_FROM, kd(37)), LOC_D).values;
      expect(known.quotationAnswers).toEqual({ v: 8, status: null });
    } finally {
      await owner(db);
      await q(
        "UPDATE public.cockpit_client_days SET quotation_answers = NULL WHERE location_id = $1",
        [LOC_D],
      );
    }
  });

  test("leads touched and first call: any miss of CALL_RULES is off, as callCentreVerdict calls it", async () => {
    await owner(db);
    const before = await q<Row>(
      "SELECT * FROM public.cockpit_client_now WHERE location_id = $1",
      [LOC_D],
    );
    const set = (share: number, firstSeconds: number) =>
      q(
        `INSERT INTO public.cockpit_client_now(location_id,untouched_leads,touched_share_30d,callable_30d,touched_30d,first_call_median_work_seconds_30d,computed_at)
         VALUES($1,3,$2::numeric,100,round($2::numeric * 100),$3::numeric,now())
         ON CONFLICT (location_id) DO UPDATE SET touched_share_30d = EXCLUDED.touched_share_30d, callable_30d = 100,
           touched_30d = EXCLUDED.touched_30d, first_call_median_work_seconds_30d = EXCLUDED.first_call_median_work_seconds_30d, note = NULL`,
        [LOC_D, share, firstSeconds],
      );
    try {
      await set(0.4, 3 * 3600);
      let v = rowOf(await board(CREATIVE), LOC_D).values;
      expect(v.leadsTouched).toMatchObject({ v: 40, status: "off" });
      expect(v.firstCall).toMatchObject({ v: 180, status: "off" });
      await owner(db);
      await set(0.89, 31 * 60);
      v = rowOf(await board(CREATIVE), LOC_D).values;
      expect(v.leadsTouched).toMatchObject({ v: 89, status: "off" });
      expect(v.firstCall).toMatchObject({ v: 31, status: "off" });
      await owner(db);
      await set(0.9, 30 * 60);
      v = rowOf(await board(CREATIVE), LOC_D).values;
      expect(v.leadsTouched).toMatchObject({ v: 90, status: "good" });
      expect(v.firstCall).toMatchObject({ v: 30, status: "good" });
    } finally {
      await owner(db);
      await q("DELETE FROM public.cockpit_client_now WHERE location_id = $1", [
        LOC_D,
      ]);
      for (const r of before)
        await q(
          `INSERT INTO public.cockpit_client_now(location_id,untouched_leads,oldest_untouched_at,touched_share_30d,callable_30d,touched_30d,
             first_call_median_work_seconds_30d,computed_at,note) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [
            r.location_id,
            r.untouched_leads,
            r.oldest_untouched_at,
            r.touched_share_30d,
            r.callable_30d,
            r.touched_30d,
            r.first_call_median_work_seconds_30d,
            r.computed_at,
            r.note,
          ],
        );
    }
  });
});

describe("missing is never zero", () => {
  test("a client who records no quotation or close: not filled in, never 0", async () => {
    await owner(db);
    await q(
      "UPDATE public.cockpit_client_days SET quotations = NULL, closes = NULL, closes_with_value = NULL, revenue_usd = NULL, lead_quality_sum = NULL, lead_quality_count = NULL WHERE location_id = $1 AND day BETWEEN $2 AND $3",
      [LOC_D, F_FROM, F_TO],
    );
    try {
      const v = rowOf(await board(CREATIVE), LOC_D).values;
      for (const k of [
        "quotations",
        "quotationRate",
        "closes",
        "closeRate",
        "revenue",
        "aov",
        "roas",
        "leadQuality",
      ])
        expect(v[k]).toMatchObject({ v: null, status: "not_filled_in" });
    } finally {
      await owner(db);
      for (let i = 0; i < 10; i++)
        await q(
          "UPDATE public.cockpit_client_days SET quotations = $3, closes = $4, closes_with_value = $4, revenue_usd = $5, lead_quality_sum = $6, lead_quality_count = $7 WHERE location_id = $1 AND day = $2",
          [
            LOC_D,
            kd(40 - i),
            i < 4 ? 1 : 0,
            i < 2 ? 1 : 0,
            i === 0 ? 15000 : i === 1 ? 5000 : 0,
            i < 3 ? 6 : 0,
            i < 3 ? 1 : 0,
          ],
        );
    }
  });

  test("a source missing on some days does not inflate a rate: both sides are summed over the days both are known", async () => {
    await owner(db);
    // A lead-sync outage on Formula Co's first five days; a close on the day whose meeting nobody marked.
    await q(
      "UPDATE public.cockpit_client_days SET crm_leads = NULL WHERE location_id = $1 AND day BETWEEN $2 AND $3",
      [LOC_D, F_FROM, kd(36)],
    );
    await q(
      "UPDATE public.cockpit_client_days SET closes = 1, closes_with_value = 1, revenue_usd = 1000 WHERE location_id = $1 AND day = $2",
      [LOC_D, F_TO],
    );
    try {
      const v = rowOf(await board(CREATIVE), LOC_D).values;
      expect(v.crmLeads).toMatchObject({ v: 20, atLeast: true });
      // 5 bookings over the 20 leads of the same five days: 25%, never 10 / 20.
      expect(v.leadToBooking).toEqual({
        v: 25,
        status: "good",
        num: 5,
        den: 20,
        sample: 20,
        target: "lead_to_booking",
        partial: true,
        pairedDays: 5,
        note: "Over the 5 of 10 days where both are known.",
      });
      // Leads called: 20 of the same days' 20 leads, never 40 of 20.
      expect(v.leadsCalled).toMatchObject({
        v: 40,
        share: 100,
        sharePartial: true,
        shareNote: "Over the 5 of 10 days where both are known.",
      });
      // The unmarked day's close stays out of the close rate: 2 of 7 shows, never 3 of 7.
      expect(v.closes.v).toBe(3);
      expect(v.closeRate).toMatchObject({
        v: r2((2 / 7) * 100),
        num: 2,
        den: 7,
        partial: true,
        note: "Over the 9 of 10 days where both are known.",
      });
      expect(v.quotationRate).toMatchObject({
        v: r2((4 / 7) * 100),
        partial: true,
        pairedDays: 9,
      });
    } finally {
      await owner(db);
      await q(
        "UPDATE public.cockpit_client_days SET crm_leads = 4 WHERE location_id = $1 AND day BETWEEN $2 AND $3",
        [LOC_D, F_FROM, F_TO],
      );
      await q(
        "UPDATE public.cockpit_client_days SET closes = 0, closes_with_value = 0, revenue_usd = 0 WHERE location_id = $1 AND day = $2",
        [LOC_D, F_TO],
      );
    }
  });

  test("quotations recorded as 0 in the window: the rate is not filled in", async () => {
    const v = rowOf(await board(CREATIVE, kd(36), F_TO), LOC_D).values;
    expect(v.quotations.v).toBe(0);
    expect(v.quotationRate).toMatchObject({ v: null, status: "not_filled_in" });
  });

  test("meetings due and none marked: shows and the show rate are not filled in", async () => {
    const v = rowOf(await board(CREATIVE, F_TO, F_TO), LOC_D).values;
    expect(v.meetingsDue.v).toBe(1);
    expect(v.shows).toMatchObject({ v: null, status: "not_filled_in" });
    expect(v.showRate).toMatchObject({ v: null, status: "not_filled_in" });
  });

  test("days with no stored figure are named, and a window with none at all is not measured", async () => {
    const part = rowOf(await board(CREATIVE, kd(45), F_TO), LOC_D).values;
    expect(part.crmLeads).toMatchObject({ v: 40, atLeast: true });
    expect(part.crmLeads.note).toMatch(/5 of the 15 days have no figure/);
    const none = rowOf(await board(CREATIVE, kd(60), kd(50)), LOC_D);
    expect(none.values.crmLeads).toMatchObject({
      v: null,
      status: "not_measured",
    });
    expect(none.values.closes).toMatchObject({
      v: null,
      status: "not_measured",
    });
    expect(none.notes).toContain(
      "No business figures are stored for these days yet.",
    );
  });

  test("spend in a currency with no fixed rate: spend is at least, costs are floors, ROAS is not known", async () => {
    await owner(db);
    await q(
      `INSERT INTO public.cockpit_meta_ad_days(account_id,account_currency,account_timezone,day,campaign_id,objective,adset_id,ad_id,
         spend,spend_usd,usd_rate,impressions,link_clicks,leads,lead_actions,fetched_at)
       VALUES($1,'EUR','Asia/Riyadh',$2,'90001','OUTCOME_LEADS','91001','92009',100,NULL,NULL,1000,10,1,1,now())`,
      [ACCT_D, F_FROM],
    );
    try {
      const v = rowOf(await board(CREATIVE), LOC_D).values;
      expect(v.spend).toMatchObject({ v: 1000, atLeast: true });
      expect(v.spend.note).toBe(
        "1 ad-day in a currency with no fixed USD rate is left out, so spend is at least this.",
      );
      // A cost worked out from a floor: under its lines is too early to call, over them is as bad as that.
      expect(v.cpm).toMatchObject({
        v: r2((1000 / 201000) * 1000),
        status: "too_few",
        atLeast: true,
      });
      expect(v.cpl).toMatchObject({
        v: r2(800 / 51),
        status: "watch",
        atLeast: true,
      });
      expect(v.costPerBooking).toMatchObject({
        v: 100,
        status: "off",
        atLeast: true,
      });
      expect(v.roas).toMatchObject({ v: null, status: "not_measured" });
    } finally {
      await owner(db);
      await q("DELETE FROM public.cockpit_meta_ad_days WHERE ad_id = '92009'");
    }
  });

  test("no ad account: every ad column is not measured with the reason; TikTok is said", async () => {
    const row = (await client(CEO, LOC_C, kd(6), today)).client;
    for (const k of [
      "spend",
      "impressions",
      "cpm",
      "frequency",
      "hookRate",
      "cpl",
    ])
      expect(row.values[k]).toMatchObject({ v: null, status: "not_measured" });
    expect(row.values.spend.note).toBe(
      "No Meta ad account is linked to this client, and TikTok spend is not stored.",
    );
    expect(row.values.costPerBooking.status).toBe("not_measured");
    expect(row.notes).toContain(
      "No ClickUp card, so no lever can be filed for this client.",
    );
  });

  test("a Done With You client: the call columns say the client calls", async () => {
    const row = rowOf(await board(CEO, kd(6), today), LOC_B);
    expect(row.clientCalls).toBe(true);
    for (const k of [
      "dials",
      "leadsCalled",
      "leadsTouched",
      "untouchedLeads",
      "firstCall",
    ])
      expect(row.values[k]).toMatchObject({
        v: null,
        status: "not_measured",
        note: "The client calls: Done With You.",
        clientCalls: true,
      });
  });

  test("an image-only ad set is not a video: hook and hold say so", async () => {
    const c = await client(CEO, LOC_A, kd(6), today);
    const ad2 = c.campaigns[0].adsets
      .find((s: Row) => s.id === "81001")
      .ads.find((a: Row) => a.id === "70002");
    expect(ad2.metrics.hookRate).toMatchObject({
      v: null,
      status: "not_measured",
      notVideo: true,
    });
    // No form lead yet for $30: already past the $22.50 line, so off, not too early.
    expect(ad2.metrics.cpl).toMatchObject({
      v: null,
      status: "off",
      atLeast: 30,
    });
  });

  test("a time frame of today only: ad numbers are not in yet", async () => {
    const row = rowOf(await board(CEO, today, today), LOC_A);
    expect(row.values.spend).toMatchObject({ v: null, status: "not_measured" });
    expect(row.values.spend.note).toMatch(/end yesterday/);
  });
});

describe("ad numbers only for the days the Meta store holds", () => {
  const MON = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  /** A day as the sentences write it: to_char 'DD Mon YYYY' and 'DD Mon'. */
  const dmy = (d: string) =>
    `${d.slice(8, 10)} ${MON[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`;
  const dm = (d: string) => dmy(d).slice(0, 6);
  const NO_DELIVERY = "No delivery on the linked ad accounts in these days.";

  test("a time frame before the store's first day: every ad column is not measured, never $0", async () => {
    // Formula Co's days are the store's first: kd(40).
    const row = rowOf(await board(CREATIVE, kd(60), kd(50)), LOC_D);
    const note = `Meta ad numbers are stored from ${dmy(F_FROM)}; this time frame is before that.`;
    for (const k of [
      "spend",
      "impressions",
      "linkClicks",
      "metaLeads",
      "cpl",
      "cpm",
      "cpc",
      "linkCtr",
    ])
      expect(row.values[k]).toEqual({ v: null, status: "not_measured", note });
    expect(row.values.costPerBooking).toMatchObject({
      v: null,
      status: "not_measured",
      note,
    });
    expect(row.adCover).toEqual({ state: "before", note });
    expect(row.notes).not.toContain(NO_DELIVERY);

    // The tree: an ad with a CRM lead in those days is listed, its ad columns not measured.
    await owner(db);
    await lead("LD1", LOC_D, kt(55, "10:00"), {
      ad: "92001",
      campaign: "90001",
      name: "Test Lead",
    });
    try {
      const c = await client(CEO, LOC_D, kd(60), kd(50));
      const ad = c.campaigns[0].adsets[0].ads[0];
      expect(ad.id).toBe("92001");
      expect(ad.metrics.spend).toEqual({
        v: null,
        status: "not_measured",
        note,
      });
      expect(ad.metrics.crmLeads.v).toBe(1);
      expect(ad.metrics.costPerBooking).toMatchObject({
        v: null,
        status: "not_measured",
      });
    } finally {
      await owner(db);
      await q("DELETE FROM public.client_leads WHERE ghl_contact_id = 'LD1'");
    }
  });

  test("a time frame that straddles the store's first day: at least these, costs not called good, cost per booking and ROAS over the stored days", async () => {
    const row = rowOf(await board(CREATIVE, kd(45), F_TO), LOC_D);
    const v = row.values;
    const note = `Meta ad numbers are stored from ${dmy(F_FROM)}; the days before are left out, so the ad numbers are at least these.`;
    expect(v.spend).toEqual({
      v: 1000,
      status: null,
      atLeast: true,
      partial: true,
      note,
    });
    expect(v.impressions).toMatchObject({ v: 200000, atLeast: true, note });
    expect(v.linkClicks).toMatchObject({ v: 1350, atLeast: true });
    expect(v.metaLeads).toMatchObject({ v: 50, atLeast: true });
    // A cost over part of the days is called only when already past its lines.
    expect(v.cpm).toMatchObject({ v: 5, status: "too_few", partial: true });
    expect(v.cpm.atLeast).toBeUndefined();
    expect(v.cpc).toMatchObject({ v: r2(1000 / 1350), status: "too_few" });
    expect(v.cpl).toMatchObject({ v: 16, status: "watch", partial: true });
    // Spend and the facts over the same ten stored days: exact for them, and it says so.
    expect(v.costPerBooking).toMatchObject({
      v: 100,
      status: "off",
      num: 1000,
      den: 10,
      partial: true,
      pairedDays: 10,
    });
    expect(v.costPerBooking.note).toMatch(
      /Over the 10 of 15 days where both are known\.$/,
    );
    expect(v.roas).toMatchObject({
      v: 20,
      status: "good",
      num: 20000,
      den: 1000,
      partial: true,
    });
    expect(row.adCover).toMatchObject({
      state: "partial",
      pairFrom: F_FROM,
      pairTo: F_TO,
      adDays: 15,
    });
    expect(row.notes).toContain(note);
    expect(row.notes).not.toContain(NO_DELIVERY);
    // The tree carries the same floor.
    const c = await client(CEO, LOC_D, kd(45), F_TO);
    const camp = c.campaigns.find((x: Row) => x.id === "90001");
    expect(camp.metrics.spend).toMatchObject({
      v: 800,
      atLeast: true,
      partial: true,
    });
    expect(c.adCover.state).toBe("partial");
  });

  test("an ad account behind Kuwait's clock: its unfinished day is left out, never a $0 day", async () => {
    const LA = "3333333333";
    await owner(db);
    for (const n of [1, 2, 3])
      await adDay({
        account: LA,
        accountName: "Atlantis LA",
        tz: "America/Los_Angeles",
        day: kd(n),
        campaign: "83001",
        adset: "84001",
        ad: "73001",
        spend: 40,
        imp: 4000,
        clicks: 40,
        leads: 2,
        destination: "ON_AD",
      });
    await db.exec(
      "CREATE TEMP TABLE _board_accounts AS SELECT location_id, ad_account_ids FROM public.cockpit_board_clients",
    );
    // 05:00 Kuwait time today: Los Angeles is still on Kuwait's yesterday.
    await db.exec(`CREATE OR REPLACE FUNCTION public.cockpit_meta_ad_days_now() RETURNS timestamptz
      LANGUAGE sql STABLE SET search_path = '' AS $$ SELECT '${kt(0, "05:00")}'::timestamptz $$`);
    await q(
      "UPDATE public.cockpit_board_clients SET ad_account_ids = ARRAY[$1] WHERE location_id = $2",
      [LA, LOC_B],
    );
    await q(
      "UPDATE public.cockpit_board_clients SET ad_account_ids = ARRAY[$1, $2] WHERE location_id = $3",
      [ACCT_A, LA, LOC_A],
    );
    try {
      const lag = `Ad numbers end yesterday on each ad account's own clock: Atlantis LA keeps America/Los_Angeles time, so its numbers end ${dm(kd(2))}`;
      // Yesterday, on a client whose only account is in Los Angeles: not over there yet.
      const y = rowOf(await board(CEO, kd(1), kd(1)), LOC_B);
      expect(y.values.spend).toEqual({
        v: null,
        status: "not_measured",
        note: `${lag}, so these days are not over there yet.`,
      });
      expect(y.values.costPerBooking.status).toBe("not_measured");
      expect(y.adCover.state).toBe("not_over");
      expect(y.notes).not.toContain(NO_DELIVERY);
      // Three days: the two Los Angeles has finished, as at least.
      const three = rowOf(await board(CEO, kd(3), kd(1)), LOC_B).values;
      expect(three.spend).toMatchObject({
        v: 80,
        atLeast: true,
        partial: true,
        note: `${lag}, so the ad numbers are at least these.`,
      });
      expect(three.impressions).toMatchObject({ v: 8000, atLeast: true });
      expect(three.cpl).toMatchObject({
        v: 20,
        status: "watch",
        partial: true,
      });
      // Client A has a Kuwait account and the Los Angeles one: yesterday is in for one only.
      const a = rowOf(await board(CEO, kd(1), kd(1)), LOC_A);
      expect(a.values.spend).toMatchObject({ v: 22, atLeast: true });
      expect(a.values.costPerBooking).toMatchObject({
        v: null,
        status: "not_measured",
        note: "No day of this time frame is over on every linked ad account's clock yet.",
      });
      expect(a.notes).toContain(
        `${lag}, so the ad numbers are at least these.`,
      );
      const c = await client(CEO, LOC_A, kd(1), kd(1));
      expect(c.adCover).toMatchObject({
        state: "partial",
        pairFrom: kd(1),
        pairTo: kd(2),
      });
      const camp = c.campaigns.find((x: Row) => x.id === "80001");
      expect(camp.metrics.spend).toMatchObject({
        v: 22,
        atLeast: true,
        partial: true,
      });
      expect(camp.metrics.costPerBooking.status).toBe("not_measured");
      // The Los Angeles ad's unfinished day is not in the tree.
      expect(c.campaigns.map((x: Row) => x.id)).not.toContain("83001");
    } finally {
      await owner(db);
      await db.exec(`CREATE OR REPLACE FUNCTION public.cockpit_meta_ad_days_now() RETURNS timestamptz
        LANGUAGE sql STABLE SET search_path = '' AS $$ SELECT pg_catalog.now() $$`);
      await db.exec(`UPDATE public.cockpit_board_clients b SET ad_account_ids = x.ad_account_ids
        FROM _board_accounts x WHERE x.location_id = b.location_id; DROP TABLE _board_accounts;`);
      await q("DELETE FROM public.cockpit_meta_ad_days WHERE account_id = $1", [
        LA,
      ]);
    }
  });
});

describe("Client A: real facts, Meta's reach, the tree", () => {
  test("ad numbers end yesterday; chat lead ad sets stay out of cost per lead", async () => {
    const b = await board(CEO, kd(6), today);
    expect(b.adWindow.to).toBe(kd(1));
    expect(b.adWindow.note).toMatch(/end yesterday/);
    const v = rowOf(b, LOC_A).values;
    expect(v.spend.v).toBe(132);
    expect(v.metaLeads.v).toBe(6);
    expect(v.cpl).toMatchObject({ v: 15, status: "good", num: 90, den: 6 });
  });

  test("a standard window takes frequency from Meta's reach", async () => {
    const v = rowOf(await board(CEO, kd(6), today), LOC_A).values;
    expect(v.frequency).toMatchObject({
      v: 2.4,
      status: "good",
      basis: "window",
      num: 12000,
      den: 5000,
    });
  });

  test("the tree: campaign > ad set > ad, with CRM leads, bookings and shows by ad id", async () => {
    const c = await client(CEO, LOC_A, kd(6), today);
    expect(c.campaigns.map((x: Row) => x.id)).toEqual(["80001"]);
    const camp = c.campaigns[0];
    expect(camp.metrics.spend.v).toBe(132);
    expect(camp.adsets.map((s: Row) => [s.id, s.destination])).toEqual([
      ["81001", "ON_AD"],
      ["81002", "WHATSAPP"],
    ]);
    const form = camp.adsets[0];
    expect(form.metrics.cpl).toMatchObject({ v: 15, num: 90, den: 6 });
    const ad1 = form.ads.find((a: Row) => a.id === "70001");
    expect(ad1.name).toBe("Sara video");
    expect(ad1.metrics.crmLeads.v).toBe(2);
    expect(ad1.metrics.confirmedBookings.v).toBe(2);
    // AP1 showed (sheet), AP2 a no-show: both due meetings marked.
    expect(ad1.metrics.shows).toEqual({
      v: 1,
      status: null,
      noShows: 1,
      marked: 2,
      due: 2,
      note: "2 of 2 meetings due are marked.",
    });
    // AP1 and AP2 were booked from it in these days: $60 of spend over 2 bookings.
    expect(ad1.metrics.costPerBooking).toMatchObject({
      v: 30,
      status: "good",
      num: 60,
      den: 2,
    });
    expect(ad1.metrics.hookRate).toMatchObject({ v: 30, num: 1800, den: 6000 });
    const ad2 = form.ads.find((a: Row) => a.id === "70002");
    expect(ad2.metrics.crmLeads.v).toBe(2);
    // AP6 (sheet mark only), AP11 and AP12 carry AD2; AP6 showed by the sheet.
    expect(ad2.metrics.confirmedBookings.v).toBe(3);
    expect(ad2.metrics.shows).toMatchObject({
      v: 1,
      marked: 1,
      due: 3,
      note: "1 of 3 meetings due are marked.",
    });
    const chat = camp.adsets[1];
    expect(chat.metrics.cpl).toMatchObject({ status: "not_measured" });
    expect(c.notInStore).toEqual([
      {
        adId: "70009",
        crmLeads: 1,
        confirmedBookings: 1,
        shows: {
          v: 1,
          status: null,
          noShows: 0,
          marked: 1,
          due: 1,
          note: "1 of 1 meetings due are marked.",
        },
      },
    ]);
    // AP4 and AP7 carry no ad and nobody marked them: not filled in, never 0 shows.
    expect(c.noAd).toMatchObject({
      crmLeads: 1,
      shows: {
        v: null,
        status: "not_filled_in",
        due: 2,
        note: "None of the 2 meetings due is marked showed or no-show.",
      },
    });
  });

  test("the tree: an ad whose due meetings are all unmarked has shows not filled in, never 0", async () => {
    // AP12 (kd 5) and AP11 (kd 4) carry ad 70002; neither is marked.
    const c = await client(CEO, LOC_A, kd(5), kd(4));
    const camp = c.campaigns.find((x: Row) => x.id === "80001");
    const form = camp.adsets.find((s: Row) => s.id === "81001");
    const ad2 = form.ads.find((a: Row) => a.id === "70002");
    expect(ad2.metrics.shows).toEqual({
      v: null,
      status: "not_filled_in",
      due: 2,
      note: "None of the 2 meetings due is marked showed or no-show.",
    });
    // An ad with no meeting due shows 0, plainly.
    const ad1 = form.ads.find((a: Row) => a.id === "70001");
    expect(ad1.metrics.shows).toEqual({
      v: 0,
      status: null,
      noShows: 0,
      marked: 0,
      due: 0,
    });
    // The ad set and the campaign add the same meetings up.
    expect(form.metrics.shows).toMatchObject({
      v: null,
      status: "not_filled_in",
      due: 2,
    });
    expect(camp.metrics.shows.status).toBe("not_filled_in");
  });

  test("the row names the assigned callers; an admin who holds assignments is left out", async () => {
    const row = rowOf(await board(CEO, kd(6), today), LOC_A);
    expect(row.callers).toEqual([
      { email: AGENT, name: "Agent One" },
      { email: AGENT2, name: "Agent Two" },
    ]);
    expect((await client(CEO, LOC_C, kd(6), today)).client.callers).toEqual([
      { email: AGENT, name: "Agent One" },
    ]);
  });

  test("cockpit_client_callers keeps its output and its gate, from the shared rule", async () => {
    const after = (await as(CSM, "SELECT public.cockpit_client_callers() AS r"))
      .clients;
    expect(after).toEqual(callersBefore);
    expect(
      after
        .find((c: Row) => c.locationId === LOC_A)
        .callers.map((c: Row) => c.email),
    ).toEqual([AGENT, AGENT2]);
    expect(
      await refused(CREATIVE, "SELECT public.cockpit_client_callers()"),
    ).toMatch(/client success and media buyers/);
    const rows = await service<Row[]>(
      "SELECT jsonb_agg(to_jsonb(x) ORDER BY x.location_id, x.email) AS r FROM public.cockpit_client_caller_rows() x",
    );
    expect(rows.filter(r => r.location_id === LOC_D)).toEqual([
      { location_id: LOC_D, email: AGENT2, name: "Agent Two" },
    ]);
  });
});

describe("appointments due with no outcome", () => {
  test("the list matches the facts' count for the time frame, oldest first, with what the meeting needs", async () => {
    await owner(db);
    const facts = Number(
      (
        await q<{ n: string }>(
          "SELECT sum(no_outcome) AS n FROM public.cockpit_client_days WHERE location_id = $1 AND day BETWEEN $2 AND $3",
          [LOC_A, FROM, today],
        )
      )[0].n,
    );
    const c = await client(SALES, LOC_A, FROM, today);
    const list = c.noOutcomeAppointments as Row[];
    // AP2 (a CRM no-show with no sheet mark), AP4 (unmarked), AP7 (provisional), AP11 and AP12 have no outcome;
    // AP1 (sheet), AP3 (portal), AP6 (the sheet's row only) do; Google copies, cancelled, future and callback meetings are not due.
    expect(list.map(a => a.appointmentId)).toEqual([
      "AP12",
      "AP11",
      "AP2",
      "AP4",
      "AP7",
    ]);
    expect(list.length).toBe(facts);
    expect(c.client.noOutcome).toBe(facts);
    expect(c.client.noOutcomeOldestDays).toBe(5);
    expect(c.noOutcomeCheck).toEqual({ board: facts, live: facts, note: null });

    const [ap12, ap11, ap2, ap4, ap7] = list;
    expect(ap12).toMatchObject({
      meetingDay: kd(5),
      meetingTime: "16:00",
      calendar: "main",
      firstName: "Yousef",
      adId: "70002",
      adName: "Still image",
      bookedBy: { name: "The lead", how: "The booking page" },
      daysSince: 5,
      contactUrl: `https://app.gohighlevel.com/v2/location/${LOC_A}/contacts/detail/L6`,
    });
    expect(ap11.bookedBy).toEqual({
      name: "Agent One",
      how: "The call centre",
    });
    expect(ap11.firstName).toBe("Mona");
    expect(ap2).toMatchObject({
      firstName: "Omar",
      adName: "Sara video",
      crmStatus: "noshow",
      daysSince: 2,
    });
    expect(ap4).toMatchObject({
      firstName: "Ali",
      adId: null,
      adName: null,
      bookedBy: null,
    });
    expect(ap7).toMatchObject({
      calendar: "provisional",
      bookedBy: { name: "Someone in GoHighLevel" },
    });
    // First names only: no surname, no phone.
    expect(JSON.stringify(list)).not.toMatch(/Khalid|Hassan|Saleh|\+965/);
  });

  test("a meeting marked since the facts ran leaves the live list at once, and the page says why the two differ", async () => {
    await owner(db);
    await outcome(LOC_A, "AP4", 1, { attendance: "showed" });
    try {
      const c = await client(CEO, LOC_A, FROM, today);
      expect(
        c.noOutcomeAppointments.map((a: Row) => a.appointmentId),
      ).not.toContain("AP4");
      expect(c.noOutcomeCheck.board - c.noOutcomeCheck.live).toBe(1);
      expect(c.noOutcomeCheck.note).toMatch(
        /1 of the board's 5 has been marked since/,
      );
      // The next facts run agrees again.
      await owner(db);
      await one(
        "SELECT public.cockpit_board_facts_refresh($1::date,$2::date) AS r",
        [FROM, today],
      );
      const again = await client(CEO, LOC_A, FROM, today);
      expect(again.noOutcomeCheck).toMatchObject({
        board: 4,
        live: 4,
        note: null,
      });
    } finally {
      await owner(db);
      await q(
        "DELETE FROM portal_data.appointment_outcomes WHERE appointment_id = 'AP4'",
      );
      await one(
        "SELECT public.cockpit_board_facts_refresh($1::date,$2::date) AS r",
        [FROM, today],
      );
    }
  });

  test("a shorter time frame lists only the meetings due in it", async () => {
    const c = await client(CEO, LOC_A, kd(2), kd(2));
    expect(c.noOutcomeAppointments.map((a: Row) => a.appointmentId)).toEqual([
      "AP2",
      "AP4",
    ]);
    expect(c.client.noOutcome).toBe(2);
  });
});

describe("targets: the CEO and admins edit them, everyone reads them", () => {
  const save = (
    who: string,
    scope: string,
    metric: string,
    good: number | null,
    watch: number | null,
    note: string | null = null,
  ) =>
    as(who, "SELECT public.cockpit_board_targets_save($1,$2,$3,$4,$5) AS r", [
      scope,
      metric,
      good,
      watch,
      note,
    ]);

  test("other seats are refused", async () => {
    for (const who of [CSM, CREATIVE, BUYER, SALES, EDITOR, INACTIVE])
      expect(
        await refused(
          who,
          "SELECT public.cockpit_board_targets_save('defaults','cpl',20,25)",
        ),
      ).toMatch(/Only the CEO and admins/);
  });

  test("a board override moves every client's status and keeps the official line beside it", async () => {
    const saved = await save(CEO, "defaults", "cpl", 20, 25, "October push");
    expect(saved.target).toMatchObject({
      good: 20,
      watch: 25,
      source: "board",
      official: { good: 15, watch: 22.5 },
    });
    const b = await board(CREATIVE);
    expect(b.targets.cpl).toMatchObject({
      good: 20,
      source: "board",
      board: { by: "aziz@maharamedia.com", note: "October push" },
    });
    expect(rowOf(b, LOC_D).values.cpl.status).toBe("good");
    expect(b.canEditTargets).toBe(false);
    expect((await board(ADMIN)).canEditTargets).toBe(true);
  });

  test("a client override wins for that client only; no watch line makes short of good a watch", async () => {
    await save(ADMIN, "client:CU_D", "aov", 25000, null);
    const b = await board(CEO);
    const d = rowOf(b, LOC_D);
    expect(d.values.aov).toMatchObject({ v: 10000, status: "watch" });
    expect(d.overrides.aov).toMatchObject({
      good: 25000,
      watch: null,
      by: "admin@tests.invalid",
    });
    expect(b.targets.aov.source).toBe("official");
    const page = await client(CEO, LOC_D);
    expect(page.targets.aov).toMatchObject({ source: "client", good: 25000 });
  });

  test("both lines empty goes back to the official target", async () => {
    await save(CEO, "defaults", "cpl", null, null);
    await save(CEO, "client:CU_D", "aov", null, null);
    const b = await board(CEO);
    expect(b.targets.cpl).toMatchObject({
      good: 15,
      watch: 22.5,
      source: "official",
    });
    expect(rowOf(b, LOC_D).values.cpl.status).toBe("watch");
    expect(rowOf(b, LOC_D).overrides).toEqual({});
  });

  test("bad input is refused in plain words", async () => {
    expect(
      await refused(
        CEO,
        "SELECT public.cockpit_board_targets_save('defaults','nope',1,1)",
      ),
    ).toMatch(/one of the board's targets/);
    expect(
      await refused(
        CEO,
        "SELECT public.cockpit_board_targets_save('client:ZZZ','cpl',1,2)",
      ),
    ).toMatch(/not on the board/);
    expect(
      await refused(
        CEO,
        "SELECT public.cockpit_board_targets_save('defaults','cpl',20,10)",
      ),
    ).toMatch(/at or above the good line/);
    expect(
      await refused(
        CEO,
        "SELECT public.cockpit_board_targets_save('defaults','show_rate',70,80)",
      ),
    ).toMatch(/at or below the good line/);
    expect(
      await refused(
        CEO,
        "SELECT public.cockpit_board_targets_save('defaults','show_rate',120,60)",
      ),
    ).toMatch(/from 0 to 100/);
    expect(
      await refused(
        CEO,
        "SELECT public.cockpit_board_targets_save('defaults','cpl',NULL,10)",
      ),
    ).toMatch(/Set the good line/);
  });

  test("every save and every reset leaves an audit row with who did it", async () => {
    await owner(db);
    const rows = await q<Row>(
      "SELECT action, entity_id, actor_email, before IS NOT NULL AS had_before, after IS NOT NULL AS has_after FROM public.cockpit_audit_log WHERE entity_type = 'cockpit_board_targets' ORDER BY created_at, action",
    );
    expect(rows).toEqual([
      {
        action: "board_target.insert",
        entity_id: "defaults:cpl",
        actor_email: "aziz@maharamedia.com",
        had_before: false,
        has_after: true,
      },
      {
        action: "board_target.insert",
        entity_id: "client:CU_D:aov",
        actor_email: "admin@tests.invalid",
        had_before: false,
        has_after: true,
      },
      {
        action: "board_target.delete",
        entity_id: "defaults:cpl",
        actor_email: "aziz@maharamedia.com",
        had_before: true,
        has_after: false,
      },
      {
        action: "board_target.delete",
        entity_id: "client:CU_D:aov",
        actor_email: "aziz@maharamedia.com",
        had_before: true,
        has_after: false,
      },
    ]);
  });
});

describe("levers: the gate, the row and its audit", () => {
  const LEVER = "6f9a0f8e-5d0b-4c3e-9d5c-1a2b3c4d5e6f";
  const args = (extra: Row = {}) =>
    JSON.stringify({
      locationId: LOC_D,
      metric: "cpl",
      lever: "Test a new hook on the kitchen video",
      department: "creative",
      from: F_FROM,
      to: F_TO,
      ...extra,
    });

  test("any active seat gets the context, with the metric's value as the evidence", async () => {
    const ctx = await as(
      EDITOR,
      "SELECT public.cockpit_board_lever_context($1::jsonb) AS r",
      [args({ note: "  Try the before and after  " })],
    );
    expect(ctx).toMatchObject({
      actorId: EDITOR,
      email: "editor@tests.invalid",
      locationId: LOC_D,
      taskId: "CU_D",
      clientName: "Formula Co",
      metric: "cpl",
      metricLabel: "Cost per lead",
      lever: "Test a new hook on the kitchen video",
      department: "creative",
      note: "Try the before and after",
      meetingId: null,
      day: today,
      from: F_FROM,
      to: F_TO,
    });
    expect(ctx.evidence).toMatch(
      /^Formula Co Cost per lead, .* to .*: \$16\.00 against a good line of \$15\.00 \(watch\)\.$/,
    );
  });

  test("refused: no seat, a client outside the seat, no ClickUp card, a bad department or metric", async () => {
    expect(
      await refused(
        INACTIVE,
        "SELECT public.cockpit_board_lever_context($1::jsonb)",
        [args()],
      ),
    ).toMatch(/active cockpit seat/);
    expect(
      await refused(
        LIMITED,
        "SELECT public.cockpit_board_lever_context($1::jsonb)",
        [args()],
      ),
    ).toMatch(/not on your board/);
    expect(
      await refused(
        CEO,
        "SELECT public.cockpit_board_lever_context($1::jsonb)",
        [args({ locationId: LOC_C })],
      ),
    ).toMatch(/no ClickUp card/);
    expect(
      await refused(
        CEO,
        "SELECT public.cockpit_board_lever_context($1::jsonb)",
        [args({ department: "sales" })],
      ),
    ).toMatch(/department/);
    expect(
      await refused(
        CEO,
        "SELECT public.cockpit_board_lever_context($1::jsonb)",
        [args({ metric: "vibes" })],
      ),
    ).toMatch(/metric/);
    expect(
      await refused(
        CEO,
        "SELECT public.cockpit_board_lever_context($1::jsonb)",
        [args({ lever: "x" })],
      ),
    ).toMatch(/3 to 200/);
    expect(
      await refused(
        CEO,
        "SELECT public.cockpit_board_lever_context($1::jsonb)",
        [args({ extra: 1 })],
      ),
    ).toMatch(/Send the client/);
  });

  test("only the service role writes the row: sending, then open with the ClickUp task; a request id never files twice", async () => {
    const ctx = await as(
      CSM,
      "SELECT public.cockpit_board_lever_context($1::jsonb) AS r",
      [args()],
    );
    expect(
      await refused(
        CEO,
        "SELECT public.cockpit_board_lever_begin($1::uuid,$2::jsonb,'{}'::jsonb)",
        [LEVER, JSON.stringify(ctx)],
      ),
    ).toMatch(/permission denied/);
    const begun = await service(
      "SELECT public.cockpit_board_lever_begin($1::uuid,$2::jsonb,$3::jsonb) AS r",
      [LEVER, JSON.stringify(ctx), args()],
    );
    expect(begun).toEqual({ created: true });
    const again = await service(
      "SELECT public.cockpit_board_lever_begin($1::uuid,$2::jsonb,$3::jsonb) AS r",
      [LEVER, JSON.stringify(ctx), args()],
    );
    expect(again.existing).toMatchObject({
      id: LEVER,
      status: "sending",
      createdById: CSM,
      result: null,
    });
    const done = await service(
      "SELECT public.cockpit_board_lever_finish($1::uuid,$2::jsonb,NULL) AS r",
      [
        LEVER,
        JSON.stringify({
          ok: true,
          ticketId: "86abc",
          ticketUrl: "https://app.clickup.com/t/86abc",
          commentId: "c1",
        }),
      ],
    );
    expect(done).toMatchObject({
      status: "open",
      clickupTaskId: "86abc",
      clickupUrl: "https://app.clickup.com/t/86abc",
      department: "creative",
    });
    expect(
      await refused(null, "SELECT 1 FROM public.cockpit_board_levers"),
    ).toMatch(/permission denied/);
    await owner(db);
    await db.query("SELECT set_config('request.jwt.claims',$1,false)", [
      JSON.stringify({ role: "service_role" }),
    ]);
    await db.exec("SET ROLE service_role");
    let err = "";
    try {
      await db.query(
        "SELECT public.cockpit_board_lever_finish($1::uuid,'{}'::jsonb,'late')",
        [LEVER],
      );
    } catch (e) {
      err = (e as Error).message;
    }
    await owner(db);
    expect(err).toMatch(/already open/);
  });

  test("a failed ClickUp call leaves the lever to reconcile, never open", async () => {
    const id = "7f9a0f8e-5d0b-4c3e-9d5c-1a2b3c4d5e6f";
    const ctx = await as(
      BUYER,
      "SELECT public.cockpit_board_lever_context($1::jsonb) AS r",
      [args({ metric: "frequency", department: "media_buyer" })],
    );
    await service(
      "SELECT public.cockpit_board_lever_begin($1::uuid,$2::jsonb,$3::jsonb) AS r",
      [id, JSON.stringify(ctx), args()],
    );
    const out = await service(
      "SELECT public.cockpit_board_lever_finish($1::uuid,NULL,$2) AS r",
      [id, "ClickUp response is unknown."],
    );
    expect(out).toMatchObject({
      status: "reconcile",
      error: "ClickUp response is unknown.",
      clickupTaskId: null,
    });
  });

  test("the board counts open levers and the client page lists them; every change is audited", async () => {
    const row = rowOf(await board(CEO), LOC_D);
    expect(row.levers).toMatchObject({ open: 1, reconcile: 1 });
    const page = await client(SALES, LOC_D);
    expect(page.levers.map((l: Row) => l.status).sort()).toEqual([
      "open",
      "reconcile",
    ]);
    expect(page.levers.find((l: Row) => l.status === "open")).toMatchObject({
      createdBy: "csm@tests.invalid",
      lever: "Test a new hook on the kitchen video",
    });
    await owner(db);
    const audit = await q<Row>(
      "SELECT action, actor_email FROM public.cockpit_audit_log WHERE entity_type = 'cockpit_board_levers' AND entity_id = $1 ORDER BY created_at, action",
      [LEVER],
    );
    expect(audit).toEqual([
      { action: "board_lever.insert", actor_email: "csm@tests.invalid" },
      { action: "board_lever.update", actor_email: "csm@tests.invalid" },
    ]);
  });
});

describe("the read takes the 16 October corrections", () => {
  const now = (row: Row) =>
    q(
      `INSERT INTO public.cockpit_client_now(location_id,untouched_leads,touched_share_30d,callable_30d,touched_30d,
         verified_called_30d,outcome_only_30d,first_call_median_work_seconds_30d,computed_at,note)
       VALUES($1,3,$2::numeric,$3,$4,$5,$6,600,'2026-10-16 10:30:00+00',$7)
       ON CONFLICT (location_id) DO UPDATE SET touched_share_30d = EXCLUDED.touched_share_30d, callable_30d = EXCLUDED.callable_30d,
         touched_30d = EXCLUDED.touched_30d, verified_called_30d = EXCLUDED.verified_called_30d,
         outcome_only_30d = EXCLUDED.outcome_only_30d, computed_at = EXCLUDED.computed_at, note = EXCLUDED.note`,
      [
        LOC_D,
        row.share,
        row.callable,
        row.touched,
        row.verified,
        row.outcomeOnly,
        row.note ?? null,
      ],
    );
  const clearNow = async () => {
    await owner(db);
    await q("DELETE FROM public.cockpit_client_now WHERE location_id = $1", [
      LOC_D,
    ]);
  };

  test("leads contacted counts a lead once it has a Maqsam call; a saved outcome alone is said, not counted", async () => {
    await owner(db);
    try {
      // City Wood's shape on 16 Oct: 95% touched, 57% with a Maqsam call.
      await now({
        share: 0.95,
        callable: 100,
        touched: 95,
        verified: 57,
        outcomeOnly: 38,
        // The facts say the outcome-only touches too: said once, the rest kept.
        note: "38 of the 95 touched leads had a dialer outcome saved but no Maqsam call to the number. 3 WhatsApp chat contacts are left out (tagged inbound whatsapp, no ad).",
      });
      let v = rowOf(await board(CREATIVE), LOC_D).values;
      expect(v.leadsTouched).toMatchObject({
        v: 57,
        status: "off",
        num: 57,
        den: 100,
        sample: 100,
        outcomeOnly: 38,
        touchedShare: 95,
      });
      expect(v.leadsTouched.note).toBe(
        "57 of the 100 callable leads from the last 30 days have a Maqsam call, as of 16 Oct 13:30 Kuwait time. " +
          "38 more have a saved outcome but no Maqsam call, so they are not counted (95% if they were). " +
          "3 WhatsApp chat contacts are left out (tagged inbound whatsapp, no ad).",
      );
      await owner(db);
      await now({
        share: 0.92,
        callable: 100,
        touched: 92,
        verified: 91,
        outcomeOnly: 1,
      });
      v = rowOf(await board(CREATIVE), LOC_D).values;
      expect(v.leadsTouched).toMatchObject({ v: 91, status: "good" });
      expect(v.leadsTouched.note).toContain(
        "1 more has a saved outcome but no Maqsam call, so it is not counted (92% if it were).",
      );
      await owner(db);
      await now({
        share: 0.9,
        callable: 100,
        touched: 90,
        verified: 90,
        outcomeOnly: 0,
      });
      v = rowOf(await board(CREATIVE), LOC_D).values;
      expect(v.leadsTouched).toMatchObject({ v: 90, status: "good" });
      expect(v.leadsTouched.note).not.toMatch(/saved outcome/);
      // Under the minimum sample the rate is shown and called too few, counted on Maqsam calls.
      await owner(db);
      await now({
        share: 1,
        callable: 7,
        touched: 7,
        verified: 4,
        outcomeOnly: 3,
      });
      v = rowOf(await board(CREATIVE), LOC_D).values;
      expect(v.leadsTouched).toMatchObject({
        v: r2((4 / 7) * 100),
        status: "too_few",
        num: 4,
        den: 7,
      });
      // Facts from before the Maqsam split keep the looser share, and say so.
      await owner(db);
      await now({
        share: 0.95,
        callable: 100,
        touched: 95,
        verified: null,
        outcomeOnly: null,
      });
      v = rowOf(await board(CREATIVE), LOC_D).values;
      expect(v.leadsTouched).toMatchObject({ v: 95, status: "good", num: 95 });
      expect(v.leadsTouched.note).toContain(
        "This still counts a saved outcome with no Maqsam call; the next refresh counts Maqsam calls only.",
      );
    } finally {
      await clearNow();
    }
  });

  test("closes says won, pending and lost; the close rate stays closes / shows", async () => {
    await owner(db);
    const before = rowOf(await board(CREATIVE), LOC_D).values;
    await owner(db);
    try {
      // Formula Co's ten days: 2 won (days 0 and 1), 3 pending, 1 lost.
      await q(
        `UPDATE public.cockpit_client_days SET closes_pending = CASE WHEN day BETWEEN $2::date AND $3::date THEN 1 ELSE 0 END,
           closes_lost = CASE WHEN day = $4::date THEN 1 ELSE 0 END, closes_answered = 0
         WHERE location_id = $1 AND day BETWEEN $5::date AND $6::date`,
        [LOC_D, kd(38), kd(36), kd(35), F_FROM, F_TO],
      );
      const v = rowOf(await board(CREATIVE), LOC_D).values;
      expect(v.closes).toEqual({
        v: 2,
        status: null,
        withValue: 2,
        pending: 3,
        lost: 1,
        note: "Won 2, still pending 3, lost 1.",
      });
      expect(v.closeRate).toEqual(before.closeRate);
    } finally {
      await owner(db);
      await q(
        "UPDATE public.cockpit_client_days SET closes_pending = NULL, closes_lost = NULL, closes_answered = NULL WHERE location_id = $1",
        [LOC_D],
      );
    }
    // A client who marks only wins has nothing more to say.
    let v = rowOf(await board(CREATIVE), LOC_D).values;
    expect(v.closes).toEqual({ v: 2, status: null, withValue: 2 });
    // Nothing pending or lost: the figures are kept, the note stays quiet.
    await owner(db);
    try {
      await q(
        "UPDATE public.cockpit_client_days SET closes_pending = 0, closes_lost = 0 WHERE location_id = $1",
        [LOC_D],
      );
      v = rowOf(await board(CREATIVE), LOC_D).values;
      expect(v.closes).toEqual({
        v: 2,
        status: null,
        withValue: 2,
        pending: 0,
        lost: 0,
      });
    } finally {
      await owner(db);
      await q(
        "UPDATE public.cockpit_client_days SET closes_pending = NULL, closes_lost = NULL WHERE location_id = $1",
        [LOC_D],
      );
    }
  });

  test("CRM leads say how many are Instagram or Messenger chats with no ad", async () => {
    await owner(db);
    try {
      await q(
        `UPDATE public.cockpit_client_days SET crm_dm_contacts = CASE WHEN day BETWEEN $2::date AND $3::date THEN 1 ELSE 0 END
         WHERE location_id = $1 AND day BETWEEN $4::date AND $5::date`,
        [LOC_D, kd(40), kd(38), F_FROM, F_TO],
      );
      let v = rowOf(await board(CREATIVE), LOC_D).values;
      expect(v.crmLeads).toEqual({
        v: 40,
        status: null,
        dms: 3,
        note: "3 of these are an Instagram or Messenger chat with no ad behind it; WhatsApp chats are left out.",
      });
      await owner(db);
      await q(
        "UPDATE public.cockpit_client_days SET crm_dm_contacts = 0 WHERE location_id = $1",
        [LOC_D],
      );
      v = rowOf(await board(CREATIVE), LOC_D).values;
      expect(v.crmLeads).toEqual({ v: 40, status: null, dms: 0 });
    } finally {
      await owner(db);
      await q(
        "UPDATE public.cockpit_client_days SET crm_dm_contacts = NULL WHERE location_id = $1",
        [LOC_D],
      );
    }
    const v = rowOf(await board(CREATIVE), LOC_D).values;
    expect(v.crmLeads).toEqual({ v: 40, status: null });
  });

  test("spend no client row carries is named for whole-board seats, and kept out of every row", async () => {
    await owner(db);
    const spendBefore = rowOf(await board(CEO), LOC_D).values.spend;
    await owner(db);
    const OLD = "3333333333";
    const LOOSE = "4444444444";
    const KEPT = "5555555555";
    const LAUNCH = "6666666666";
    const [{ ids: cBefore }] = await q<{ ids: string[] }>(
      "SELECT ad_account_ids AS ids FROM public.cockpit_board_clients WHERE location_id = $1",
      [LOC_C],
    );
    const base = (account: string, accountName: string, spend: number) => ({
      account,
      accountName,
      day: kd(35),
      campaign: `1${account}`,
      adset: `2${account}`,
      ad: `3${account}`,
      spend,
      imp: 1000,
      clicks: 10,
    });
    try {
      await q(
        "UPDATE public.cockpit_board_clients SET ad_account_ids = ARRAY[$2] WHERE location_id = $1",
        [LOC_X, OLD],
      );
      // Client C is Launching: off the board, so its spend is outside the rows too.
      await q(
        "UPDATE public.cockpit_board_clients SET ad_account_ids = ARRAY[$2] WHERE location_id = $1",
        [LOC_C, LAUNCH],
      );
      await q(
        `INSERT INTO public.cockpit_board_account_ties(account_id,location_id,evidence,added_by,kept_out)
         VALUES($1,$2,'The client''s own post boosts, tested.','tests',true)`,
        [KEPT, LOC_A],
      );
      await adDay(base(OLD, "Old client ads", 30.5));
      await adDay(base(LOOSE, "Nobody's ads", 12.25));
      await adDay(base(KEPT, "Client A boosts", 7));
      await adDay(base(LAUNCH, "Client C ads", 20));
      for (const who of [CEO, ADMIN, CREATIVE]) {
        const b = await board(who);
        expect(b.offBoard).toEqual({
          spend: 69.75,
          unpriced: false,
          accounts: [
            {
              accountId: OLD,
              name: "Old client ads",
              spend: 30.5,
              client: "Old client",
              reason: "cancelled",
            },
            {
              accountId: LAUNCH,
              name: "Client C ads",
              spend: 20,
              client: "Client C",
              clientStatus: "Launching",
              reason: "not_active",
            },
            {
              accountId: LOOSE,
              name: "Nobody's ads",
              spend: 12.25,
              reason: "not_tied",
            },
            {
              accountId: KEPT,
              name: "Client A boosts",
              spend: 7,
              client: "Client A",
              reason: "kept_out",
            },
          ],
        });
        expect(rowOf(b, LOC_D).values.spend).toEqual(spendBefore);
      }
      // Outside the time frame, nothing.
      const later = await board(CEO, kd(20), kd(10));
      expect(later.offBoard).toEqual({
        spend: 0,
        unpriced: false,
        accounts: [],
      });
      const limited = await board(LIMITED);
      expect(limited.offBoard).toBeNull();
      expect(JSON.stringify(limited)).not.toMatch(/Old client|3333333333/);
    } finally {
      await owner(db);
      await q(
        "DELETE FROM public.cockpit_meta_ad_days WHERE account_id = ANY($1)",
        [[OLD, LOOSE, KEPT, LAUNCH]],
      );
      await q(
        "DELETE FROM public.cockpit_board_account_ties WHERE account_id = $1",
        [KEPT],
      );
      await q(
        "UPDATE public.cockpit_board_clients SET ad_account_ids = '{}' WHERE location_id = $1",
        [LOC_X],
      );
      await q(
        "UPDATE public.cockpit_board_clients SET ad_account_ids = $2 WHERE location_id = $1",
        [LOC_C, cBefore],
      );
    }
  });

  test("the leads-contacted target is labelled for what it counts", async () => {
    const t = await service<Row>(
      "SELECT jsonb_object_agg(metric, label) AS r FROM public.cockpit_board_default_targets()",
    );
    expect(t.leads_touched).toBe("Leads contacted");
  });

  test("only the read and the defaults are doors; the note helper is internal", async () => {
    await owner(db);
    const rows = await q<Row>(
      `SELECT p.proname, has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth,
              has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
              has_function_privilege('service_role', p.oid, 'EXECUTE') AS svc
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname IN ('cockpit_board_add_note','cockpit_board_rows','cockpit_board_read','cockpit_board_default_targets')
       ORDER BY p.proname`,
    );
    expect(rows).toEqual([
      {
        proname: "cockpit_board_add_note",
        auth: false,
        anon: false,
        svc: false,
      },
      {
        proname: "cockpit_board_default_targets",
        auth: false,
        anon: false,
        svc: true,
      },
      { proname: "cockpit_board_read", auth: true, anon: false, svc: false },
      { proname: "cockpit_board_rows", auth: false, anon: false, svc: false },
    ]);
  });
});

describe("daily budgets and budget used (2026-10-17)", () => {
  const MON = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  /** A day as the sentences write it: to_char 'DD Mon YYYY', 'DD Mon' and 'FMDD Mon'. */
  const dmy = (d: string) =>
    `${d.slice(8, 10)} ${MON[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`;
  const dm = (d: string) => dmy(d).slice(0, 6);
  const fm = (d: string) =>
    `${Number(d.slice(8, 10))} ${MON[Number(d.slice(5, 7)) - 1]}`;
  const UNREAD_A = `Budgets for act_${ACCT_A} (Ads) have not been read.`;
  const LIFETIME_OUT = "1 campaign on a lifetime budget is left out.";
  const NOW_SQL = `INSERT INTO public.cockpit_meta_budgets(level,object_id,account_id,campaign_id,name,objective,status,effective_status,
      budget_level,budget_type,daily_budget,lifetime_budget,budget_remaining,currency,currency_offset,usd_rate,daily_budget_usd,
      start_time,end_time,ads_active,ads_with_issues,issues,switched_on,starts_at,delivering,why_not,fetched_at)
    VALUES($1,$2,$3,$4,$5,'OUTCOME_LEADS',$6,$7,$8,$9,$10,$11,$12,'USD',100,$13,$14,NULL,$15,1,0,NULL,$16,$17,$18,$19,
      now() - interval '15 minutes')`;
  type Now = {
    level?: "campaign" | "adset";
    id: string;
    campaign?: string;
    name: string;
    budgetLevel: "campaign" | "adset";
    type: "daily" | "lifetime" | null;
    daily?: number | null;
    lifetime?: number | null;
    remaining?: number | null;
    on?: boolean;
    delivering?: boolean;
    whyNot?: string;
    end?: string | null;
    startsAt?: string | null;
    account?: string;
  };
  const budgetNow = (b: Now) =>
    q(NOW_SQL, [
      b.level ?? "campaign",
      b.id,
      b.account ?? ACCT_A,
      b.campaign ?? b.id,
      b.name,
      b.on === false && !b.startsAt ? "PAUSED" : "ACTIVE",
      b.on === false && !b.startsAt ? "PAUSED" : "ACTIVE",
      b.budgetLevel,
      b.type,
      b.daily ?? null,
      b.lifetime ?? null,
      b.remaining ?? null,
      b.daily != null ? 1 : null,
      b.daily ?? null,
      b.end ?? null,
      b.on ?? true,
      b.startsAt ?? null,
      b.delivering ?? true,
      b.delivering === false ? (b.whyNot ?? "Paused") : null,
    ]);
  /**
   * One campaign's budget on one day of its account's clock: switched on with
   * `usd` a day (the highest it was on with), delivering or not; `endOff`: off
   * by the day's last read, its budget type then unknown (an ABO campaign
   * whose ad sets were all paused).
   */
  const budgetDay = (
    campaign: string,
    n: number,
    usd: number | null,
    o: {
      type?: "daily" | "lifetime";
      level?: "campaign" | "adset";
      delivering?: boolean;
      account?: string;
      endOff?: boolean;
      source?: "snapshot" | "activity";
      verified?: boolean;
    } = {},
  ) =>
    q(
      `INSERT INTO public.cockpit_meta_budget_days(campaign_id,day,account_id,budget_level,budget_type,daily_budget,daily_budget_usd,
         max_switched_on_budget,max_switched_on_budget_usd,currency,usd_rate,switched_on,switched_on_any,delivering,delivering_any,why_not,
         changed_during_day,source,verified,first_seen,last_seen)
       VALUES($1,$2,$3,$4,$5,$6,$6,$7,$7,'USD',1,$8,true,$9,$10,$11,false,$12,$13,now(),now())
       ON CONFLICT (campaign_id, day) DO UPDATE SET daily_budget = EXCLUDED.daily_budget,
         daily_budget_usd = EXCLUDED.daily_budget_usd, max_switched_on_budget = EXCLUDED.max_switched_on_budget,
         max_switched_on_budget_usd = EXCLUDED.max_switched_on_budget_usd`,
      [
        campaign,
        kd(n),
        o.account ?? ACCT_A,
        o.level ?? "campaign",
        o.endOff ? null : (o.type ?? "daily"),
        o.endOff ? null : usd,
        o.type === "lifetime" ? null : usd,
        !o.endOff,
        o.source === "activity" ? null : (o.delivering ?? !o.endOff),
        o.source === "activity" ? null : (o.delivering ?? true),
        o.source === "activity"
          ? null
          : o.endOff
            ? "Ad sets paused"
            : o.delivering === false
              ? "Ads with issues"
              : null,
        o.source ?? "snapshot",
        o.verified ?? true,
      ],
    );
  /** An account day whose budgets were read. */
  const readDay = (n: number, account = ACCT_A) =>
    q(
      `INSERT INTO public.cockpit_meta_budget_account_days(account_id,day,source,reads,first_read,last_read,campaigns,verified)
       VALUES($1,$2,'snapshot',24,now(),now(),3,true) ON CONFLICT DO NOTHING`,
      [account, kd(n)],
    );
  /** Meta answered an account's spend over these days: a finished day read, or the listing with no spend. */
  const spendRead = (
    account: string,
    since: number,
    until: number,
    source: "days" | "discovery" = "days",
  ) =>
    q(
      `INSERT INTO public.cockpit_meta_spend_reads(account_id,source,since,until,read_at)
       VALUES($1,$2,$3,$4,now()) ON CONFLICT DO NOTHING`,
      [account, source, kd(since), kd(until)],
    );
  const state = (
    account: string,
    o: {
      status?: number;
      cap?: number | null;
      spent?: number | null;
      prepay?: boolean | null;
    } = {},
  ) =>
    q(
      `INSERT INTO public.cockpit_meta_account_state(account_id,account_status,disable_reason,spend_cap,amount_spent,is_prepay,currency,
         currency_offset,usd_rate,fetched_at)
       VALUES($1,$2,0,$3,$4,$5,'USD',100,1,now() - interval '15 minutes')
       ON CONFLICT (account_id) DO UPDATE SET account_status = EXCLUDED.account_status, spend_cap = EXCLUDED.spend_cap,
         amount_spent = EXCLUDED.amount_spent, is_prepay = EXCLUDED.is_prepay, fetched_at = EXCLUDED.fetched_at`,
      [
        account,
        o.status ?? 1,
        o.cap ?? null,
        o.spent === undefined ? null : o.spent,
        o.prepay ?? false,
      ],
    );

  /**
   * Client A's account (Kuwait, USD), whose ads spend $22 a day on campaign
   * 80001 from kd(6) to kd(1): budgets read from kd(6). 80001 a campaign
   * budget, $25 then $22; 80002 ad set budgets ($15 + $25, one more ad set
   * paused) from kd(3), never spending; 80003 a lifetime budget; 80004
   * switched on but blocked by its ads ($30, the CEO's "budget set, not
   * spending": counted); 80005 paused; 80006 waiting for its start (not
   * counted). A spending limit of $1,000 with $960 spent.
   */
  let seeded = false;
  async function seed() {
    if (seeded) return;
    seeded = true;
    await owner(db);
    await state(ACCT_A, { cap: 1000, spent: 960 });
    await budgetNow({
      id: "80001",
      name: "Kitchens leads",
      budgetLevel: "campaign",
      type: "daily",
      daily: 22,
    });
    await budgetNow({
      id: "80002",
      name: "Chats",
      budgetLevel: "adset",
      type: "daily",
      daily: 40,
    });
    await budgetNow({
      level: "adset",
      id: "81101",
      campaign: "80002",
      name: "Chats A",
      budgetLevel: "adset",
      type: "daily",
      daily: 15,
    });
    await budgetNow({
      level: "adset",
      id: "81102",
      campaign: "80002",
      name: "Chats B",
      budgetLevel: "adset",
      type: "daily",
      daily: 25,
    });
    await budgetNow({
      level: "adset",
      id: "81103",
      campaign: "80002",
      name: "Chats old",
      budgetLevel: "adset",
      type: "daily",
      daily: 50,
      on: false,
      delivering: false,
    });
    await budgetNow({
      id: "80003",
      name: "Spring launch",
      budgetLevel: "campaign",
      type: "lifetime",
      lifetime: 500,
      remaining: 200,
      end: `${dayShift(today, 10)}T21:00:00Z`,
    });
    await budgetNow({
      id: "80004",
      name: "Retargeting",
      budgetLevel: "campaign",
      type: "daily",
      daily: 30,
      delivering: false,
      whyNot: "Ads with issues",
    });
    await budgetNow({
      id: "80005",
      name: "Old offer",
      budgetLevel: "campaign",
      type: "daily",
      daily: 50,
      on: false,
      delivering: false,
    });
    await budgetNow({
      id: "80006",
      name: "Eid offer",
      budgetLevel: "campaign",
      type: "daily",
      daily: 10,
      on: false,
      delivering: false,
      startsAt: `${dayShift(today, 3)}T06:00:00Z`,
      whyNot: `Starts ${fm(dayShift(today, 3))}`,
    });
    for (let n = 0; n <= 6; n++) {
      await readDay(n);
      await budgetDay("80001", n, n >= 4 ? 25 : 22);
    }
    for (let n = 0; n <= 3; n++) {
      await budgetDay("80002", n, 40, { level: "adset" });
      await budgetDay("80003", n, null, { type: "lifetime" });
    }
    await budgetDay("80004", 1, 30, { delivering: false });
  }

  afterAll(async () => {
    await owner(db);
    await db.exec(`DELETE FROM public.cockpit_meta_budgets; DELETE FROM public.cockpit_meta_budget_days;
      DELETE FROM public.cockpit_meta_budget_account_days; DELETE FROM public.cockpit_meta_account_state;
      DELETE FROM public.cockpit_meta_spend_reads;`);
  });

  test("before any budget is read: Budget/day and Budget used are not measured and say which account, never $0", async () => {
    const b = await board(CEO, kd(6), kd(4));
    const a = rowOf(b, LOC_A).values;
    expect(a.dailyBudget).toEqual({
      v: null,
      status: "not_measured",
      note: UNREAD_A,
    });
    expect(a.budgetUsed).toMatchObject({
      v: null,
      status: "not_measured",
      note: UNREAD_A,
      target: "budget_used",
    });
    expect(a.spendPerDay).toEqual({ v: 22, status: null, num: 66, den: 3 });
    expect(b.notes).toContain(
      "Meta budgets have not been read yet, so Budget/day and Budget used are empty.",
    );
    // No ad account at all: said so, in all three.
    const none = rowOf(b, LOC_B).values;
    for (const k of ["dailyBudget", "spendPerDay", "budgetUsed"])
      expect(none[k]).toMatchObject({
        v: null,
        status: "not_measured",
        note: "No Meta ad account is linked to this client.",
      });
  });

  test("Budget/day: the daily budgets switched on now, blocked or not, in dollars; lifetime, paused and waiting ones left out and said", async () => {
    await seed();
    const b = await board(CEO, kd(6), kd(4));
    const d = rowOf(b, LOC_A).values.dailyBudget;
    expect(d).toMatchObject({
      v: 92,
      status: null,
      campaigns: 3,
      lifetime: 1,
      notDelivering: 1,
      heldBudget: 30,
      notDeliveringWhy: ["Ads with issues"],
      starting: 1,
      accountIssues: [
        {
          accountId: ACCT_A,
          name: "Ads",
          issue: "limit_near",
          words:
            "Spending limit nearly used: $40.00 left, under a day of budget",
        },
      ],
    });
    expect(d.note).toMatch(
      new RegExp(
        `^3 campaigns switched on now: 2 on a campaign budget, 1 on ad set budgets\\. 1 of them is not delivering \\(\\$30\\.00 a day\\)\\. Ads with issues\\. 1 campaign on a lifetime budget is left out\\. 1 campaign is waiting for its start, not counted yet: Starts ${fm(dayShift(today, 3))}\\. Spending limit nearly used: \\$40\\.00 left, under a day of budget \\(Ads\\)\\. Read \\d\\d \\w{3} \\d\\d:\\d\\d Kuwait time: the budget now, whatever the time frame\\.$`,
      ),
    );
    expect(b.notes).not.toContain(
      "Meta budgets have not been read yet, so Budget/day and Budget used are empty.",
    );
    // The budget now, whatever the time frame.
    const old = await board(CEO, F_FROM, F_TO);
    expect(rowOf(old, LOC_A).values.dailyBudget.v).toBe(92);
    // Formula Co's account was never read: not measured and named, never $0.
    const unread = `Budgets for act_${ACCT_D} (Ads) have not been read.`;
    expect(rowOf(old, LOC_D).values.dailyBudget).toEqual({
      v: null,
      status: "not_measured",
      note: unread,
    });
    expect(rowOf(old, LOC_D).values.budgetUsed).toMatchObject({
      v: null,
      status: "not_measured",
      note: unread,
    });
  });

  test("Budget used: spend over the daily budgets of the campaign-days switched on, blocked ones too, judged watch, off and good", async () => {
    await seed();
    const used = async (from: number, to: number) =>
      rowOf(await board(CEO, kd(from), kd(to)), LOC_A).values.budgetUsed;
    // Yesterday: 80001 spent its $22; 80002 ($40) and 80004 ($30, blocked by its ads) spent nothing.
    const yesterday = { day: kd(1), spend: 22, budget: 92 };
    // 66 of 75: the campaign budget alone, before the ad set campaign began.
    expect(await used(6, 4)).toEqual({
      v: 88,
      status: "watch",
      num: 66,
      den: 75,
      sample: 3,
      target: "budget_used",
      budgetDays: 3,
      yesterday,
      notSpending: 2,
    });
    // The ad set campaign's $120 and the blocked one's $30, nothing spent on days the account was read: $0, never left out.
    expect(await used(3, 1)).toEqual({
      v: 30.56,
      status: "off",
      num: 66,
      den: 216,
      sample: 3,
      target: "budget_used",
      note: LIFETIME_OUT,
      budgetDays: 3,
      yesterday,
      notSpending: 2,
    });
    await owner(db);
    try {
      for (const n of [6, 5, 4]) await budgetDay("80001", n, 22);
      expect(await used(6, 4)).toMatchObject({ v: 100, status: "good" });
      // Above 110%: a note, never a status.
      for (const n of [6, 5, 4]) await budgetDay("80001", n, 18);
      const over = await used(6, 4);
      expect(over).toMatchObject({ v: 122.22, status: "good", over: true });
      expect(over.note).toBe(
        "Above its daily budgets: Meta may spend up to 75% over a daily budget on one day, and at most 7 times it in a week.",
      );
    } finally {
      await owner(db);
      for (const n of [6, 5, 4]) await budgetDay("80001", n, 25);
    }
    expect((await used(6, 4)).status).toBe("watch");
  });

  test("a campaign switched off by the day's last read keeps the budget it was on with that day, CBO and ABO alike", async () => {
    await seed();
    await owner(db);
    try {
      // An ABO campaign whose ad sets were all paused in the afternoon: $100 in the morning, $90 spent.
      await budgetDay("80007", 2, 100, { level: "adset", endOff: true });
      await adDay({
        account: ACCT_A,
        day: kd(2),
        campaign: "80007",
        adset: "81007",
        ad: "70007",
        spend: 90,
        imp: 900,
        clicks: 9,
      });
      const u = rowOf(await board(CEO, kd(3), kd(1)), LOC_A).values.budgetUsed;
      expect(u).toMatchObject({ v: 49.37, num: 156, den: 316 });
      expect(u.note).toBe(LIFETIME_OUT);
    } finally {
      await owner(db);
      await q("DELETE FROM public.cockpit_meta_ad_days WHERE ad_id = '70007'");
      await q(
        "DELETE FROM public.cockpit_meta_budget_days WHERE campaign_id = '80007'",
      );
    }
  });

  test("under 3 days with a budget is too few; before the history starts the days are partial and said", async () => {
    await seed();
    const used = async (from: string, to: string) =>
      rowOf(await board(CEO, from, to), LOC_A).values.budgetUsed;
    expect(await used(kd(2), kd(1))).toMatchObject({
      v: 28.57,
      status: "too_few",
      sample: 2,
    });
    const nine = await used(kd(9), kd(1));
    expect(nine).toMatchObject({
      v: 45.36,
      status: "off",
      num: 132,
      den: 291,
      partial: true,
      pairedDays: 6,
    });
    expect(nine.note).toBe(
      `Over the 6 of 9 days whose budgets are known. Budgets are stored from ${dmy(kd(6))}. ${LIFETIME_OUT}`,
    );
    // A time frame before the history: not measured, never 0%.
    expect(await used(F_FROM, F_TO)).toMatchObject({
      v: null,
      status: "not_measured",
      note: `Meta budgets are stored from ${dmy(kd(6))}; this time frame is before that.`,
      yesterday: { day: kd(1), spend: 22, budget: 92 },
    });
  });

  test("a day whose spend was not read is left out and said; once Meta answered for it, a budget that spent nothing there is $0", async () => {
    await seed();
    await owner(db);
    let run: string | null = null;
    try {
      await readDay(8);
      await budgetDay("80001", 8, 25);
      const left = rowOf(await board(CEO, kd(9), kd(1)), LOC_A).values
        .budgetUsed;
      expect(left).toMatchObject({
        v: 45.36,
        num: 132,
        den: 291,
        partial: true,
        pairedDays: 7,
      });
      expect(left.note).toContain(
        "1 campaign-day with a daily budget is left out: the spend of Ads was not read those days.",
      );
      // A day read that finished after the day ended on the account's clock, kept once its task is gone: no rows is $0.
      await spendRead(ACCT_A, 9, 8);
      const read = rowOf(await board(CEO, kd(9), kd(1)), LOC_A).values
        .budgetUsed;
      expect(read).toMatchObject({
        v: 41.77,
        num: 132,
        den: 316,
        partial: true,
        pairedDays: 7,
      });
      expect(read.note).not.toContain("left out: the spend");
      await q("DELETE FROM public.cockpit_meta_spend_reads");
      // A finished days task of a run still open counts the same.
      [{ id: run }] = await q<{ id: string }>(
        `INSERT INTO public.cockpit_meta_ad_day_runs(job,state,requested_by,started_at,finished_at)
         VALUES('backfill','ok','tests',now() - interval '1 hour',now()) RETURNING id`,
      );
      await q(
        `INSERT INTO public.cockpit_meta_ad_day_tasks(run_id,kind,account_id,account_name,account_currency,account_timezone,since,until,state,updated_at)
         VALUES($1,'days',$2,'Ads','USD','Asia/Kuwait',$3,$4,'done',now())`,
        [run, ACCT_A, kd(9), kd(8)],
      );
      expect(
        rowOf(await board(CEO, kd(9), kd(1)), LOC_A).values.budgetUsed,
      ).toMatchObject({ v: 41.77, den: 316 });
    } finally {
      await owner(db);
      if (run)
        await q("DELETE FROM public.cockpit_meta_ad_day_runs WHERE id = $1", [
          run,
        ]);
      await q("DELETE FROM public.cockpit_meta_spend_reads");
      await q(
        "DELETE FROM public.cockpit_meta_budget_days WHERE campaign_id = '80001' AND day = $1",
        [kd(8)],
      );
      await q(
        "DELETE FROM public.cockpit_meta_budget_account_days WHERE account_id = $1 AND day = $2",
        [ACCT_A, kd(8)],
      );
    }
  });

  test("a new account with a budget and no spend at all: once the listing found no spend, Budget used is 0% and off, and says it spent nothing", async () => {
    await seed();
    const NEW = "4444444444";
    await owner(db);
    await db.exec(
      "CREATE TEMP TABLE _budget_new AS SELECT location_id, ad_account_ids FROM public.cockpit_board_clients",
    );
    try {
      await q(
        "UPDATE public.cockpit_board_clients SET ad_account_ids = ARRAY[$1] WHERE location_id = $2",
        [NEW, LOC_B],
      );
      await state(NEW);
      await budgetNow({
        id: "85001",
        account: NEW,
        name: "Launch",
        budgetLevel: "campaign",
        type: "daily",
        daily: 50,
        delivering: false,
        whyNot: "Ads not approved yet",
      });
      for (const n of [3, 2, 1]) {
        await readDay(n, NEW);
        await budgetDay("85001", n, 50, { account: NEW, delivering: false });
      }
      // No ad-day rows and no read of its spend: the days are left out, never $0.
      const before = rowOf(await board(CEO, kd(3), kd(1)), LOC_B).values;
      expect(before.budgetUsed).toMatchObject({
        v: null,
        status: "not_measured",
        partial: true,
        notSpending: 0,
      });
      expect(before.budgetUsed.note).toContain(
        `3 campaign-days with a daily budget are left out: the spend of ad account ${NEW} was not read those days.`,
      );
      // The hourly listing found no spend on it from kd(4): each day that had ended is a known $0.
      await spendRead(NEW, 4, -1, "discovery");
      const after = rowOf(await board(CEO, kd(3), kd(1)), LOC_B).values;
      expect(after.budgetUsed).toMatchObject({
        v: 0,
        status: "off",
        num: 0,
        den: 150,
        sample: 3,
        yesterday: { day: kd(1), spend: 0, budget: 50 },
        notSpending: 1,
      });
      expect(after.dailyBudget).toMatchObject({
        v: 50,
        notDelivering: 1,
        heldBudget: 50,
      });
      expect(after.spend).toMatchObject({ v: 0 });
    } finally {
      await owner(db);
      await db.exec(`UPDATE public.cockpit_board_clients b SET ad_account_ids = x.ad_account_ids
        FROM _budget_new x WHERE x.location_id = b.location_id; DROP TABLE _budget_new;`);
      for (const t of [
        "cockpit_meta_budgets",
        "cockpit_meta_budget_days",
        "cockpit_meta_budget_account_days",
        "cockpit_meta_account_state",
        "cockpit_meta_spend_reads",
      ])
        await q(`DELETE FROM public.${t} WHERE account_id = $1`, [NEW]);
    }
  });

  test('a linked account whose budgets were never read is named, never "0 of N days"', async () => {
    await seed();
    const NEVER = "5555555555";
    await owner(db);
    await db.exec(
      "CREATE TEMP TABLE _budget_never AS SELECT location_id, ad_account_ids FROM public.cockpit_board_clients",
    );
    let run: string | null = null;
    try {
      await q(
        "UPDATE public.cockpit_board_clients SET ad_account_ids = ARRAY[$1, $2] WHERE location_id = $3",
        [ACCT_A, NEVER, LOC_A],
      );
      const u = rowOf(await board(CEO, kd(3), kd(1)), LOC_A).values;
      // The account that was read gives the days: 3 of 3 known, the other named.
      expect(u.budgetUsed).toMatchObject({
        v: 30.56,
        status: "off",
        num: 66,
        den: 216,
        partial: true,
      });
      expect(u.budgetUsed.pairedDays).toBeUndefined();
      expect(u.budgetUsed.note).toBe(
        `Budgets for act_${NEVER} have not been read. ${LIFETIME_OUT}`,
      );
      expect(u.dailyBudget).toMatchObject({ v: 92, atLeast: true });
      expect(u.dailyBudget.note).toContain(
        `Budgets for act_${NEVER} have not been read. So this is at least the budget.`,
      );
      // The last hourly run knows why: Mahara's business does not list it.
      [{ id: run }] = await q<{ id: string }>(
        `INSERT INTO public.cockpit_meta_ad_day_runs(job,state,requested_by,started_at,finished_at,detail)
         VALUES('hourly','ok','cron',now() - interval '10 minutes',now(),$1::jsonb) RETURNING id`,
        [
          JSON.stringify({
            budgetAccounts: 1,
            budgetUnlisted: [{ accountId: NEVER, clientName: "Client A" }],
          }),
        ],
      );
      expect(
        rowOf(await board(CEO, kd(3), kd(1)), LOC_A).values.budgetUsed.note,
      ).toBe(
        `Budgets for act_${NEVER} have not been read: Mahara's business does not list the account. ${LIFETIME_OUT}`,
      );
      // The page says why too, and never promises an hourly read Meta will not give.
      expect(
        (await client(CEO, LOC_A, kd(3), kd(1))).budgets.account.find(
          (a: Row) => a.accountId === NEVER,
        ).words,
      ).toBe(
        `Budgets for act_${NEVER} have not been read: Mahara's business does not list the account.`,
      );
      await q(
        "UPDATE public.cockpit_board_clients SET ad_account_ids = ARRAY[$1] WHERE location_id = $2",
        [NEVER, LOC_B],
      );
      const only = (await client(CEO, LOC_B, kd(3), kd(1))).budgets;
      expect(only.asOf).toBeNull();
      expect(only.note).toBe(
        "Meta budgets have not been read for the linked ad account. Ask the client to share the ad account with Mahara's business in Meta; it is read every hour after that. One day is not judged: Meta may spend up to 75% over a daily budget on a day, and at most 7 times it in a week.",
      );
      await q("DELETE FROM public.cockpit_meta_ad_day_runs WHERE id = $1", [
        run,
      ]);
      run = null;
      expect((await client(CEO, LOC_B, kd(3), kd(1))).budgets).toMatchObject({
        note: expect.stringMatching(
          /^Meta budgets have not been read for the linked ad account yet; they are read every hour\. /,
        ),
        account: [
          {
            accountId: NEVER,
            words: `Budgets for act_${NEVER} have not been read.`,
          },
        ],
      });
    } finally {
      await owner(db);
      if (run)
        await q("DELETE FROM public.cockpit_meta_ad_day_runs WHERE id = $1", [
          run,
        ]);
      await db.exec(`UPDATE public.cockpit_board_clients b SET ad_account_ids = x.ad_account_ids
        FROM _budget_never x WHERE x.location_id = b.location_id; DROP TABLE _budget_never;`);
    }
  });

  test('an account whose budgets start after the others\' is said apart, never as "0 of N days"', async () => {
    await seed();
    const LATE = "6666666666";
    await owner(db);
    await db.exec(
      "CREATE TEMP TABLE _budget_late AS SELECT location_id, ad_account_ids FROM public.cockpit_board_clients",
    );
    try {
      await q(
        "UPDATE public.cockpit_board_clients SET ad_account_ids = ARRAY[$1, $2] WHERE location_id = $3",
        [ACCT_A, LATE, LOC_A],
      );
      // Added today: read once, no day before.
      await state(LATE);
      await readDay(0, LATE);
      const u = rowOf(await board(CEO, kd(3), kd(1)), LOC_A).values.budgetUsed;
      expect(u).toMatchObject({
        v: 30.56,
        status: "off",
        num: 66,
        den: 216,
        sample: 3,
        partial: true,
      });
      expect(u.pairedDays).toBeUndefined();
      expect(u.note).toBe(
        `Budgets for act_${LATE} are known from ${dmy(today)}. ${LIFETIME_OUT}`,
      );
      // Read from kd(4): the days before it are known from the other account, each account's first day said.
      for (const n of [4, 3, 2, 1]) await readDay(n, LATE);
      const nine = rowOf(await board(CEO, kd(9), kd(1)), LOC_A).values
        .budgetUsed;
      expect(nine).toMatchObject({ partial: true, pairedDays: 6 });
      expect(nine.note).toBe(
        `Over the 6 of 9 days whose budgets are known. Budgets are stored from ${dmy(kd(6))}. Budgets for act_${LATE} are known from ${dmy(kd(4))}. ${LIFETIME_OUT}`,
      );
    } finally {
      await owner(db);
      await db.exec(`UPDATE public.cockpit_board_clients b SET ad_account_ids = x.ad_account_ids
        FROM _budget_late x WHERE x.location_id = b.location_id; DROP TABLE _budget_late;`);
      for (const t of [
        "cockpit_meta_budget_account_days",
        "cockpit_meta_account_state",
      ])
        await q(`DELETE FROM public.${t} WHERE account_id = $1`, [LATE]);
    }
  });

  test("a history day switched on with a budget the activity log does not show is left out and said, never dropped silently", async () => {
    await seed();
    await owner(db);
    try {
      // The day before a change whose old side was 0: switched on, its budget unknown.
      await budgetDay("80008", 2, null, {
        endOff: true,
        source: "activity",
        verified: false,
      });
      const u = rowOf(await board(CEO, kd(3), kd(1)), LOC_A).values.budgetUsed;
      expect(u).toMatchObject({
        v: 30.56,
        num: 66,
        den: 216,
        partial: true,
      });
      expect(u.note).toBe(
        `1 campaign-day switched on with a budget Meta's activity log does not show is left out. ${LIFETIME_OUT}`,
      );
    } finally {
      await owner(db);
      await q(
        "DELETE FROM public.cockpit_meta_budget_days WHERE campaign_id = '80008'",
      );
    }
  });

  test("Budget/day in a currency with no fixed USD rate is not measured with the amount, never $0", async () => {
    await seed();
    const BHD = "7777777777";
    await owner(db);
    await db.exec(
      "CREATE TEMP TABLE _budget_bhd AS SELECT location_id, ad_account_ids FROM public.cockpit_board_clients",
    );
    try {
      await q(
        "UPDATE public.cockpit_board_clients SET ad_account_ids = ARRAY[$1] WHERE location_id = $2",
        [BHD, LOC_B],
      );
      await state(BHD);
      await q(
        `INSERT INTO public.cockpit_meta_budgets(level,object_id,account_id,campaign_id,name,objective,status,effective_status,
           budget_level,budget_type,daily_budget,lifetime_budget,budget_remaining,currency,currency_offset,usd_rate,daily_budget_usd,
           start_time,end_time,ads_active,ads_with_issues,issues,switched_on,starts_at,delivering,why_not,fetched_at)
         VALUES('campaign','86001',$1,'86001','Manama','OUTCOME_LEADS','ACTIVE','ACTIVE','campaign','daily',15,NULL,NULL,'BHD',100,NULL,NULL,
           NULL,NULL,1,0,NULL,true,NULL,true,NULL,now() - interval '15 minutes')`,
        [BHD],
      );
      const d = rowOf(await board(CEO, kd(3), kd(1)), LOC_B).values.dailyBudget;
      expect(d).toMatchObject({
        v: null,
        status: "not_measured",
        campaigns: 1,
      });
      expect(d.atLeast).toBeUndefined();
      expect(d.note).toMatch(
        /^1 campaign switched on now: 1 on a campaign budget\. Its budget is 15\.00 BHD a day, in a currency with no fixed USD rate\. Read /,
      );
    } finally {
      await owner(db);
      await db.exec(`UPDATE public.cockpit_board_clients b SET ad_account_ids = x.ad_account_ids
        FROM _budget_bhd x WHERE x.location_id = b.location_id; DROP TABLE _budget_bhd;`);
      for (const t of ["cockpit_meta_budgets", "cockpit_meta_account_state"])
        await q(`DELETE FROM public.${t} WHERE account_id = $1`, [BHD]);
    }
  });

  test("spend per day: the Spend cell over the ad days it covers, with its floor", async () => {
    await seed();
    expect(
      rowOf(await board(CEO, kd(6), kd(4)), LOC_A).values.spendPerDay,
    ).toEqual({
      v: 22,
      status: null,
      num: 66,
      den: 3,
    });
    // The store holds Formula Co from kd(40): the $1,000 is over its 10 days, not the 15 of the time frame.
    const part = rowOf(await board(CREATIVE, kd(45), F_TO), LOC_D).values;
    expect(part.spendPerDay).toEqual({
      v: 100,
      status: null,
      num: 1000,
      den: 10,
      atLeast: true,
      partial: true,
      note: part.spend.note,
    });
    const before = rowOf(await board(CREATIVE, kd(60), kd(50)), LOC_D).values;
    expect(before.spendPerDay).toEqual({
      v: null,
      status: "not_measured",
      note: before.spend.note,
    });
  });

  test("the client page lists every campaign switched on, a $0 one the tree cannot show too, one waiting for its start, with its account and the paused spend", async () => {
    await seed();
    const page = await client(CEO, LOC_A, kd(3), kd(1));
    const b = page.budgets;
    expect(b.account).toEqual([
      {
        accountId: ACCT_A,
        name: "Ads",
        currency: "USD",
        status: null,
        prepaid: false,
        asOf: b.asOf,
        spendingLimit: {
          cap: 1000,
          spent: 960,
          left: 40,
          daysLeft: 0.4,
          prepaid: false,
        },
        words: "Spending limit: $40.00 left (under a day of budget).",
      },
    ]);
    // Flagged first, then the biggest daily budget, the one waiting last; the paused one is not listed.
    expect(b.campaigns.map((c: Row) => c.id)).toEqual([
      "80002",
      "80004",
      "80001",
      "80003",
      "80006",
    ]);
    const camp = (id: string) => b.campaigns.find((c: Row) => c.id === id);
    expect(camp("80002")).toMatchObject({
      name: "Chats",
      budgetLevel: "adset",
      budgetType: "daily",
      adsets: 2,
      delivering: true,
      whyNot: null,
      lifetime: null,
      flag: { status: "off", words: `Spent nothing since ${fm(kd(3))}` },
    });
    expect(camp("80002").metrics.budgetUsed).toMatchObject({
      v: 0,
      status: "off",
      num: 0,
      den: 120,
      sample: 3,
    });
    expect(camp("80002").metrics.spentYesterday).toMatchObject({
      v: 0,
      zeroSince: kd(3),
    });
    expect(camp("80002").metrics.dailyBudget).toMatchObject({
      v: 40,
      status: null,
    });
    // The tree has no row for a campaign with no ad numbers.
    expect(page.campaigns.map((c: Row) => c.id)).not.toContain("80002");
    expect(camp("80001").flag).toBeNull();
    expect(camp("80001").metrics).toMatchObject({
      dailyBudget: { v: 22 },
      spentYesterday: { v: 22 },
      usedYesterday: { v: 100, num: 22, den: 22, status: null },
      spendPerDay: { v: 22, num: 66, den: 3 },
      budgetUsed: { v: 100, status: "good" },
    });
    // Blocked by its ads: its budget counts, $0 spent, and why.
    expect(camp("80004")).toMatchObject({
      delivering: false,
      whyNot: "Ads with issues",
      flag: { status: "off", words: "Ads with issues" },
    });
    expect(camp("80004").metrics.dailyBudget.v).toBe(30);
    expect(camp("80004").metrics.dailyBudget.note).toContain(
      "Not delivering now (Ads with issues).",
    );
    expect(camp("80004").metrics.budgetUsed).toMatchObject({
      v: 0,
      status: "too_few",
      sample: 1,
    });
    expect(camp("80003")).toMatchObject({
      budgetType: "lifetime",
      flag: null,
      lifetime: {
        budget: 500,
        remaining: 200,
        currency: "USD",
        endsOn: dayShift(today, 10),
      },
    });
    expect(camp("80003").metrics.budgetUsed).toMatchObject({
      v: null,
      status: "not_measured",
      note: "A lifetime budget: no daily figure.",
    });
    // Waiting for its start: said in words with no status, never a problem.
    const start = `Starts ${fm(dayShift(today, 3))}`;
    expect(camp("80006")).toMatchObject({
      delivering: false,
      whyNot: start,
      flag: { status: null, words: start },
    });
    expect(camp("80006").metrics.dailyBudget.note).toContain(
      `${start}: not counted until then.`,
    );
    expect(b.paused).toEqual({ campaigns: 0, spend: 0 });
    // A campaign paused now that spent in these days is summed, not listed.
    await owner(db);
    try {
      await adDay({
        account: ACCT_A,
        day: kd(2),
        campaign: "80005",
        adset: "81005",
        ad: "70005",
        spend: 9,
        imp: 900,
        clicks: 9,
      });
      const again = (await client(CEO, LOC_A, kd(3), kd(1))).budgets;
      expect(again.paused).toEqual({ campaigns: 1, spend: 9 });
      expect(again.campaigns.map((c: Row) => c.id)).not.toContain("80005");
    } finally {
      await owner(db);
      await q("DELETE FROM public.cockpit_meta_ad_days WHERE ad_id = '70005'");
    }
    // No ad account: said, nothing listed.
    const none = (await client(CEO, LOC_B, kd(3), kd(1))).budgets;
    expect(none).toEqual({
      asOf: null,
      note: "No Meta ad account is linked to this client.",
      account: [],
      campaigns: [],
      paused: { campaigns: 0, spend: null },
    });
  });

  test("the Los Angeles account's yesterday is its own", async () => {
    await seed();
    const LA = "3333333333";
    await owner(db);
    await db.exec(
      "CREATE TEMP TABLE _budget_accounts AS SELECT location_id, ad_account_ids FROM public.cockpit_board_clients",
    );
    try {
      for (const n of [4, 3, 2, 1]) {
        await adDay({
          account: LA,
          accountName: "Atlantis LA",
          tz: "America/Los_Angeles",
          day: kd(n),
          campaign: "83001",
          adset: "84001",
          ad: "73001",
          spend: 40,
          imp: 4000,
          clicks: 40,
          leads: 2,
        });
        await readDay(n, LA);
        await budgetDay("83001", n, 50, { account: LA });
      }
      await state(LA);
      await budgetNow({
        id: "83001",
        account: LA,
        name: "LA leads",
        budgetLevel: "campaign",
        type: "daily",
        daily: 50,
      });
      // 05:00 Kuwait time today: Los Angeles is still on Kuwait's yesterday.
      await db.exec(`CREATE OR REPLACE FUNCTION public.cockpit_meta_ad_days_now() RETURNS timestamptz
        LANGUAGE sql STABLE SET search_path = '' AS $$ SELECT '${kt(0, "05:00")}'::timestamptz $$`);
      await q(
        "UPDATE public.cockpit_board_clients SET ad_account_ids = ARRAY[$1] WHERE location_id = $2",
        [LA, LOC_B],
      );
      await q(
        "UPDATE public.cockpit_board_clients SET ad_account_ids = ARRAY[$1, $2] WHERE location_id = $3",
        [ACCT_A, LA, LOC_A],
      );
      const b = await board(CEO, kd(4), kd(1));
      const la = rowOf(b, LOC_B).values.budgetUsed;
      expect(la).toMatchObject({
        v: 80,
        status: "watch",
        num: 120,
        den: 150,
        sample: 3,
        partial: true,
        pairedDays: 3,
        yesterday: { day: kd(2), spend: 40, budget: 50 },
        notSpending: 0,
      });
      expect(la.note).toBe(
        `Over the 3 of 4 days whose budgets are known. Atlantis LA keeps America/Los_Angeles time, so ${dm(kd(1))} is not over there yet.`,
      );
      // Client A on both clocks: each account's own yesterday.
      expect(rowOf(b, LOC_A).values.budgetUsed.yesterday).toEqual({
        day: kd(1),
        days: [kd(2), kd(1)],
        spend: 62,
        budget: 142,
      });
    } finally {
      await owner(db);
      await db.exec(`CREATE OR REPLACE FUNCTION public.cockpit_meta_ad_days_now() RETURNS timestamptz
        LANGUAGE sql STABLE SET search_path = '' AS $$ SELECT pg_catalog.now() $$`);
      await db.exec(`UPDATE public.cockpit_board_clients b SET ad_account_ids = x.ad_account_ids
        FROM _budget_accounts x WHERE x.location_id = b.location_id; DROP TABLE _budget_accounts;`);
      await q("DELETE FROM public.cockpit_meta_ad_days WHERE account_id = $1", [
        LA,
      ]);
      for (const t of [
        "cockpit_meta_budgets",
        "cockpit_meta_budget_days",
        "cockpit_meta_budget_account_days",
        "cockpit_meta_account_state",
      ])
        await q(`DELETE FROM public.${t} WHERE account_id = $1`, [LA]);
    }
  });

  test("an account not in use (nothing switched on, no spend in the time frame) needs no action, closed or not", async () => {
    await seed();
    await owner(db);
    const OLD = "7777777777";
    const [{ ids }] = await q<{ ids: string[] }>(
      "SELECT ad_account_ids AS ids FROM public.cockpit_board_clients WHERE location_id = $1",
      [LOC_A],
    );
    try {
      await q(
        "UPDATE public.cockpit_board_clients SET ad_account_ids = ad_account_ids || ARRAY[$2] WHERE location_id = $1",
        [LOC_A, OLD],
      );
      // An old closed account the client no longer runs (City Wood's "City Old").
      await state(OLD, { status: 101 });
      const d = rowOf(await board(CEO, kd(3), kd(1)), LOC_A).values.dailyBudget;
      expect(
        (d.accountIssues ?? []).map((i: Row) => i.accountId),
      ).not.toContain(OLD);
      expect(d.note).not.toMatch(/Account closed/);
      // Switched on again, it needs action and is named.
      await q(
        `INSERT INTO public.cockpit_meta_budgets(level,object_id,account_id,campaign_id,name,status,effective_status,budget_level,budget_type,
           daily_budget,currency,currency_offset,usd_rate,daily_budget_usd,ads_active,ads_with_issues,switched_on,delivering,why_not,fetched_at)
         VALUES('campaign','8999901',$1,'8999901','Old campaign','ACTIVE','ACTIVE','campaign','daily',10,'USD',100,1,10,1,0,true,false,'Account closed',now())`,
        [OLD],
      );
      const again = rowOf(await board(CEO, kd(3), kd(1)), LOC_A).values
        .dailyBudget;
      expect(
        (again.accountIssues ?? []).find((i: Row) => i.accountId === OLD),
      ).toMatchObject({ issue: "account", words: "Account closed" });
    } finally {
      await owner(db);
      await q("DELETE FROM public.cockpit_meta_budgets WHERE account_id = $1", [
        OLD,
      ]);
      await q(
        "DELETE FROM public.cockpit_meta_account_state WHERE account_id = $1",
        [OLD],
      );
      await q(
        "UPDATE public.cockpit_board_clients SET ad_account_ids = $2 WHERE location_id = $1",
        [LOC_A, ids],
      );
    }
  });

  test("the account's status, its spending limit and a prepaid balance, in Meta's words: for the board's line and the page", async () => {
    await seed();
    await owner(db);
    const issues = async () =>
      rowOf(await board(CEO, kd(3), kd(1)), LOC_A).values.dailyBudget
        .accountIssues;
    const page = async () =>
      (await client(CEO, LOC_A, kd(3), kd(1))).budgets.account[0];
    try {
      // A payment: unsettled (3) or being settled (8); one due in the grace period (9) apart.
      await state(ACCT_A, { status: 3, cap: 1000, spent: 960 });
      expect(await issues()).toEqual([
        {
          accountId: ACCT_A,
          name: "Ads",
          issue: "billing",
          words: "Account unsettled: payment needed",
        },
      ]);
      expect(await page()).toMatchObject({
        status: "Account unsettled: payment needed",
        words:
          "Account unsettled: payment needed. Spending limit: $40.00 left (under a day of budget).",
      });
      // The campaign the account stops: its reason said once, with the account's name, and never after a second colon.
      await q(
        "UPDATE public.cockpit_meta_budgets SET why_not = 'Account unsettled: payment needed' WHERE object_id = '80004'",
      );
      const held = rowOf(await board(CEO, kd(3), kd(1)), LOC_A).values
        .dailyBudget;
      expect(held.notDeliveringWhy).toBeUndefined();
      expect(held.note).toContain(
        "1 of them is not delivering ($30.00 a day). 1 campaign on a lifetime budget is left out.",
      );
      expect(held.note).toContain("Account unsettled: payment needed (Ads).");
      expect(held.note.split("Account unsettled").length).toBe(2);
      const campNote = (
        await client(CEO, LOC_A, kd(3), kd(1))
      ).budgets.campaigns.find((c: Row) => c.id === "80004").metrics.dailyBudget
        .note;
      expect(campNote).toContain(
        "Not delivering now (Account unsettled: payment needed).",
      );
      for (const sentence of [
        ...held.note.split(/(?<=\.) /),
        ...campNote.split(/(?<=\.) /),
      ])
        expect([sentence, sentence.split(": ").length <= 2]).toEqual([
          sentence,
          true,
        ]);
      // An account that cannot run is not a payment.
      await state(ACCT_A, { status: 2, cap: 1000, spent: 960 });
      expect(await issues()).toMatchObject([
        { issue: "account", words: "Account disabled" },
      ]);
      await state(ACCT_A, { status: 7 });
      expect(await issues()).toMatchObject([
        { issue: "account", words: "Account under risk review" },
      ]);
      // In its grace period the account still delivers: a payment due, never one that stops spend.
      await state(ACCT_A, { status: 9 });
      expect(await issues()).toMatchObject([
        { issue: "billing_due", words: "In grace period: payment due" },
      ]);
      // The spending limit reached.
      await state(ACCT_A, { cap: 1000, spent: 1000 });
      expect(await issues()).toEqual([
        {
          accountId: ACCT_A,
          name: "Ads",
          issue: "limit_reached",
          words: "Spending limit reached",
        },
      ]);
      // A prepaid account: the cap is the funds added, what is left the balance.
      await state(ACCT_A, { cap: 1000, spent: 960, prepay: true });
      expect(await issues()).toMatchObject([
        {
          issue: "balance_low",
          words: "Prepaid balance: $40.00 left, under a day of budget",
        },
      ]);
      expect(await page()).toMatchObject({
        prepaid: true,
        spendingLimit: { left: 40, prepaid: true },
        words: "Prepaid balance: $40.00 left (under a day of budget).",
      });
      await state(ACCT_A, { cap: 1000, spent: 800, prepay: true });
      expect(await issues()).toBeUndefined();
      expect((await page()).words).toBe(
        "Prepaid balance: $200.00 left (about 2.2 days of budget).",
      );
      await state(ACCT_A, { cap: 1000, spent: 1000, prepay: true });
      expect(await issues()).toMatchObject([
        { issue: "balance_out", words: "Prepaid balance used up: add funds" },
      ]);
      // How much is spent not given: unknown, never $0 spent, and no issue.
      await state(ACCT_A, { cap: 1000, spent: null });
      expect(await issues()).toBeUndefined();
      expect(await page()).toMatchObject({
        spendingLimit: { cap: 1000, spent: null, left: null, daysLeft: null },
        words:
          "Spending limit of $1,000.00; Meta did not say how much of it is spent.",
      });
    } finally {
      await owner(db);
      await state(ACCT_A, { cap: 1000, spent: 960 });
      await q(
        "UPDATE public.cockpit_meta_budgets SET why_not = 'Ads with issues' WHERE object_id = '80004'",
      );
    }
  });

  test("the board says when the budgets were last read hours ago, and never calls the ad numbers incomplete for it", async () => {
    await seed();
    await owner(db);
    try {
      await q(
        "UPDATE public.cockpit_meta_budgets SET fetched_at = now() - interval '4 hours'",
      );
      await q(
        "UPDATE public.cockpit_meta_account_state SET fetched_at = now() - interval '4 hours'",
      );
      const b = await board(CEO, kd(3), kd(1));
      expect(
        b.notes.filter((n: string) => n.startsWith("Budgets were")),
      ).toEqual([
        expect.stringMatching(
          /^Budgets were last read at \d\d:\d\d( on \d\d \w{3})? Kuwait time\.$/,
        ),
      ]);
      expect(b.notes.join(" ")).not.toContain(
        "did not finish every ad account",
      );
      expect(rowOf(b, LOC_A).values.dailyBudget.note).toMatch(
        new RegExp(
          `Budgets for act_${ACCT_A} \\(Ads\\) were last read \\d\\d \\w{3} \\d\\d:\\d\\d Kuwait time\\.`,
        ),
      );
    } finally {
      await owner(db);
      await q(
        "UPDATE public.cockpit_meta_budgets SET fetched_at = now() - interval '15 minutes'",
      );
      await q(
        "UPDATE public.cockpit_meta_account_state SET fetched_at = now() - interval '15 minutes'",
      );
    }
  });

  test("a lever for budget used carries the board's value as its evidence", async () => {
    await seed();
    const ctx = await as(
      CSM,
      "SELECT public.cockpit_board_lever_context($1::jsonb) AS r",
      [
        JSON.stringify({
          locationId: LOC_A,
          metric: "budget_used",
          lever: "Widen the ad set audience",
          department: "media_buyer",
          from: kd(3),
          to: kd(1),
        }),
      ],
    );
    expect(ctx).toMatchObject({
      metric: "budget_used",
      metricLabel: "Budget used",
    });
    expect(ctx.evidence).toBe(
      `Client A Budget used, ${dm(kd(3))} to ${dm(kd(1))}: 30.56% against a good line of 90.0% (off target).`,
    );
  });

  test("an outsider's campaign on the compromise list (2026-10-21): its budget leaves the sums with its spend and is said; the page lists it flagged, with no figures; one that also runs the client's own ad keeps its budget", async () => {
    await seed();
    const row = async () => rowOf(await board(CEO, kd(6), kd(4)), LOC_A).values;
    const before = await row();
    expect(before.budgetUsed).toMatchObject({ v: 88, num: 66, den: 75 });
    await owner(db);
    try {
      // "Copy 3/3" on Client A's account: switched on at $8,150 a day, spending $500 a day.
      await budgetNow({
        id: "80099",
        name: "Copy 3/3",
        budgetLevel: "campaign",
        type: "daily",
        daily: 8150,
      });
      for (const n of [6, 5, 4]) {
        await budgetDay("80099", n, 8150);
        await adDay({
          account: ACCT_A,
          day: kd(n),
          campaign: "80099",
          campaignName: "Copy 3/3",
          objective: "OUTCOME_SALES",
          adset: "81099",
          ad: "70099",
          adName: "Made-up sales ad",
          spend: 500,
          imp: 50000,
          clicks: 50,
        });
      }
      // Off the list it counts, as the board did before 2026-10-21.
      let v = await row();
      expect(v.spend.v).toBe(66 + 1500);
      expect(v.dailyBudget).toMatchObject({ v: 92 + 8150, campaigns: 4 });
      expect(v.budgetUsed).toMatchObject({
        num: 66 + 1500,
        den: 75 + 3 * 8150,
      });
      // On the list: its spend and its budget leave the sums together, and Client A reads as
      // before. Budget/day says the outsider's campaign switched on, so it is switched off in Meta.
      await owner(db);
      await q(
        "INSERT INTO public.cockpit_excluded_ads(ad_id,account_id,campaign_id,reason) VALUES('70099',$1,'80099','unauthorized_meta_incident_2026_10')",
        [`act_${ACCT_A}`],
      );
      v = await row();
      for (const k of ["spend", "spendPerDay", "budgetUsed"])
        expect(v[k]).toEqual(before[k]);
      const OUT =
        "1 outsider's campaign on the compromise list is switched on at $8,150.00 a day, not counted: switch it off in Meta.";
      const { note, outsiders, ...daily } = v.dailyBudget;
      const { note: beforeNote, ...beforeDaily } = before.dailyBudget;
      expect(daily).toEqual(beforeDaily);
      expect(outsiders).toEqual({ campaigns: 1, budget: 8150 });
      expect(beforeNote).toContain(" Spending limit nearly used:");
      expect(note).toBe(
        beforeNote.replace(
          " Spending limit nearly used:",
          ` ${OUT} Spending limit nearly used:`,
        ),
      );
      // The account's spending limit is read as Meta runs it: the outsider's budget spends it too.
      expect(v.dailyBudget.accountIssues).toMatchObject([
        { accountId: ACCT_A, issue: "limit_near" },
      ]);
      const page = await client(CEO, LOC_A, kd(6), kd(4));
      expect(page.campaigns.map((c: Row) => c.id)).not.toContain("80099");
      const listed = page.budgets.campaigns.find((c: Row) => c.id === "80099");
      expect(listed).toMatchObject({
        name: "Copy 3/3",
        outsider: true,
        flag: {
          status: "off",
          words:
            "An outsider's campaign on the compromise list ($8,150.00 a day), not counted. Switch it off in Meta.",
        },
        metrics: {},
      });
      // Flagged first, the client's own campaigns after it with their figures as before.
      expect(page.budgets.campaigns[0].id).toBe("80099");
      expect(
        page.budgets.campaigns
          .filter((c: Row) => !c.outsider)
          .every((c: Row) => c.metrics.dailyBudget),
      ).toBe(true);
      // A campaign that also runs one of the client's own ads is the client's: its budget
      // stays, and only the listed ad's spend leaves.
      await owner(db);
      await adDay({
        account: ACCT_A,
        day: kd(5),
        campaign: "80099",
        campaignName: "Copy 3/3",
        objective: "OUTCOME_SALES",
        adset: "81099",
        ad: "70098",
        spend: 4,
        imp: 400,
        clicks: 4,
      });
      v = await row();
      expect(v.spend.v).toBe(66 + 4);
      expect(v.dailyBudget.v).toBe(92 + 8150);
      expect(v.dailyBudget.outsiders).toBeUndefined();
      expect(v.budgetUsed).toMatchObject({ num: 66 + 4, den: 75 + 3 * 8150 });
      const own = (
        await client(CEO, LOC_A, kd(6), kd(4))
      ).budgets.campaigns.find((c: Row) => c.id === "80099");
      expect(own.outsider).toBeUndefined();
      expect(own.metrics.dailyBudget.v).toBe(8150);
    } finally {
      await owner(db);
      await q("DELETE FROM public.cockpit_excluded_ads WHERE ad_id = '70099'");
      await q(
        "DELETE FROM public.cockpit_meta_ad_days WHERE ad_id IN ('70098', '70099')",
      );
      await q(
        "DELETE FROM public.cockpit_meta_budgets WHERE object_id = '80099'",
      );
      await q(
        "DELETE FROM public.cockpit_meta_budget_days WHERE campaign_id = '80099'",
      );
    }
  });

  test("an account whose only campaign switched on is an outsider's is still in use (2026-10-21): its payment and its spending limit are said, its budget is not counted", async () => {
    await seed();
    await owner(db);
    const OLD = "7777777778";
    const [{ ids }] = await q<{ ids: string[] }>(
      "SELECT ad_account_ids AS ids FROM public.cockpit_board_clients WHERE location_id = $1",
      [LOC_A],
    );
    const daily = async () =>
      rowOf(await board(CEO, kd(3), kd(1)), LOC_A).values.dailyBudget;
    try {
      await q(
        "UPDATE public.cockpit_board_clients SET ad_account_ids = ad_account_ids || ARRAY[$2] WHERE location_id = $1",
        [LOC_A, OLD],
      );
      // An unsettled account, nothing of the client's running or spending, and an outsider's
      // campaign switched on at $5,130 a day. No ad of it is stored.
      await state(OLD, { status: 3 });
      await budgetNow({
        id: "8999902",
        name: "Made-up |MAHARA|3\\3",
        budgetLevel: "adset",
        type: "daily",
        daily: 5130,
        delivering: false,
        whyNot: "Account unsettled: payment needed",
        account: OLD,
      });
      await q(
        "INSERT INTO public.cockpit_excluded_ads(ad_id,account_id,campaign_id,reason) VALUES('8999903',$1,'8999902','unauthorized_meta_incident_2026_10')",
        [`act_${OLD}`],
      );
      let d = await daily();
      expect(d.v).toBe(92);
      expect(d.campaigns).toBe(3);
      expect(d.outsiders).toEqual({ campaigns: 1, budget: 5130 });
      expect(
        (d.accountIssues ?? []).find((i: Row) => i.accountId === OLD),
      ).toMatchObject({
        issue: "billing",
        words: "Account unsettled: payment needed",
      });
      expect(d.note).toContain(
        "1 outsider's campaign on the compromise list is switched on at $5,130.00 a day, not counted: switch it off in Meta. Spending limit nearly used",
      );
      // Settled, with a $1,000 spending limit: under a day of the outsider's budget left.
      await state(OLD, { cap: 1000, spent: 0 });
      d = await daily();
      expect(
        (d.accountIssues ?? []).find((i: Row) => i.accountId === OLD),
      ).toMatchObject({
        issue: "limit_near",
        words:
          "Spending limit nearly used: $1,000.00 left, under a day of budget",
      });
      const account = (
        await client(CEO, LOC_A, kd(3), kd(1))
      ).budgets.account.find((a: Row) => a.accountId === OLD);
      expect(account.words).toBe(
        "Spending limit: $1,000.00 left (under a day of budget).",
      );
      // Switched off in Meta: nothing to say, and the old account goes quiet.
      await q(
        "UPDATE public.cockpit_meta_budgets SET switched_on = false WHERE object_id = '8999902'",
      );
      await state(OLD, { status: 3 });
      d = await daily();
      expect(d.outsiders).toBeUndefined();
      expect(d.note).not.toContain("outsider");
      expect(
        (d.accountIssues ?? []).map((i: Row) => i.accountId),
      ).not.toContain(OLD);
    } finally {
      await owner(db);
      await q(
        "DELETE FROM public.cockpit_excluded_ads WHERE ad_id = '8999903'",
      );
      for (const t of ["cockpit_meta_budgets", "cockpit_meta_account_state"])
        await q(`DELETE FROM public.${t} WHERE account_id = $1`, [OLD]);
      await q(
        "UPDATE public.cockpit_board_clients SET ad_account_ids = $2 WHERE location_id = $1",
        [LOC_A, ids],
      );
    }
  });

  test("an outsider's campaign on a lifetime budget is flagged like a daily one (2026-10-21): no lifetime figures, so it never reads as the client's own lifetime budget", async () => {
    await seed();
    const page = async () =>
      (await client(CEO, LOC_A, kd(3), kd(1))).budgets.campaigns as Row[];
    const daily = async () =>
      rowOf(await board(CEO, kd(3), kd(1)), LOC_A).values.dailyBudget;
    const own = (await page()).find(c => c.id === "80003");
    expect(own).toMatchObject({
      budgetType: "lifetime",
      flag: null,
      lifetime: { budget: 500, remaining: 200 },
    });
    expect(own?.outsider).toBeUndefined();
    expect((await daily()).note).toContain(LIFETIME_OUT);
    await owner(db);
    try {
      // "Spring launch" holds no stored ad of the client's, so one listed ad makes it the outsiders'.
      await q(
        "INSERT INTO public.cockpit_excluded_ads(ad_id,account_id,campaign_id,reason) VALUES('70096',$1,'80003','unauthorized_meta_incident_2026_10')",
        [`act_${ACCT_A}`],
      );
      expect((await page()).find(c => c.id === "80003")).toEqual(
        expect.objectContaining({
          budgetType: "lifetime",
          outsider: true,
          lifetime: null,
          metrics: {},
          flag: {
            status: "off",
            words:
              "An outsider's campaign on the compromise list (a lifetime budget), not counted. Switch it off in Meta.",
          },
        }),
      );
      // Budget/day says it as an outsider's campaign with no daily figure, not as the client's lifetime budget.
      const d = await daily();
      expect(d.outsiders).toEqual({ campaigns: 1 });
      expect(d.lifetime).toBe(0);
      expect(d.note).not.toContain(LIFETIME_OUT);
      expect(d.note).toContain(
        "1 outsider's campaign on the compromise list is switched on, not counted: switch it off in Meta.",
      );
    } finally {
      await owner(db);
      await q("DELETE FROM public.cockpit_excluded_ads WHERE ad_id = '70096'");
    }
  });
});

describe("ads on the compromise list never count (2026-10-21)", () => {
  // An outsider's lead ad on Formula Co's account on each of its ten days ($40, 4,000
  // impressions, 20 link clicks and 2 form leads a day), and one on an account no client carries.
  const OUTSIDER = {
    account: ACCT_D,
    tz: "Asia/Riyadh",
    campaign: "90009",
    campaignName: "Copy 3/3",
    adset: "91009",
    ad: "92009",
    adName: "Made-up sales ad",
    spend: 40,
    imp: 4000,
    clicks: 20,
    leads: 2,
    destination: "ON_AD",
  };
  const LOOSE = "8888888888";
  const list = (ad: string, account: string, campaign: string) =>
    q(
      "INSERT INTO public.cockpit_excluded_ads(ad_id,account_id,campaign_id,reason) VALUES($1,$2,$3,'unauthorized_meta_incident_2026_10')",
      [ad, account, campaign],
    );
  const unlist = (ad: string) =>
    q("DELETE FROM public.cockpit_excluded_ads WHERE ad_id = $1", [ad]);
  /** Formula Co's row and the board's spend outside the rows, read by the CEO. */
  const read = async () => {
    const b = await board(CEO);
    return { v: rowOf(b, LOC_D).values, offBoard: b.offBoard };
  };
  /** Run `fn` with the outsider's ad off the list, then put it back. */
  async function offTheList<T>(fn: () => Promise<T>): Promise<T> {
    await owner(db);
    await unlist("92009");
    try {
      return await fn();
    } finally {
      await owner(db);
      await list("92009", `act_${ACCT_D}`, "90009");
    }
  }
  let base: Awaited<ReturnType<typeof read>>;

  beforeAll(async () => {
    base = await read();
    await owner(db);
    for (let i = 0; i < 10; i++) await adDay({ ...OUTSIDER, day: kd(40 - i) });
    await adDay({
      account: LOOSE,
      accountName: "Outsider's ads",
      day: kd(35),
      campaign: `1${LOOSE}`,
      adset: `2${LOOSE}`,
      ad: `3${LOOSE}`,
      spend: 25,
      imp: 1000,
      clicks: 10,
    });
    await list("92009", `act_${ACCT_D}`, "90009");
    await list(`3${LOOSE}`, `act_${LOOSE}`, `1${LOOSE}`);
  });
  afterAll(async () => {
    await owner(db);
    await q("DELETE FROM public.cockpit_excluded_ads");
    await q("DELETE FROM public.cockpit_meta_ad_days WHERE ad_id = ANY($1)", [
      ["92009", `3${LOOSE}`],
    ]);
  });

  test("its spend, impressions, clicks and form leads leave the client's row; the client's own ads stay", async () => {
    const on = await read();
    // Formula Co reads exactly as before the outsider's ad was stored.
    expect(on.v).toEqual(base.v);
    expect(on.v.spend.v).toBe(1000);
    expect(on.v.metaLeads.v).toBe(50);
    expect(on.v.cpl).toMatchObject({ v: 16, num: 800, den: 50 });
    expect(on.v.costPerBooking).toMatchObject({ v: 100 });
    // Off the list it is counted, as the board did before 2026-10-21.
    const off = await offTheList(read);
    expect(off.v.spend.v).toBe(1400);
    expect(off.v.impressions.v).toBe(240000);
    expect(off.v.linkClicks.v).toBe(1550);
    expect(off.v.metaLeads.v).toBe(70);
    expect(off.v.cpl).toMatchObject({ num: 1200, den: 70 });
    expect(off.v.costPerBooking).toMatchObject({ v: 140 });
  });

  test("the client page's tree names none of its campaign, ad set or ad; the client's own keep their numbers", async () => {
    const tree = (c: Row) =>
      (c.campaigns as Row[]).map(x => [x.id, x.metrics.spend.v]);
    const on = await client(CEO, LOC_D);
    expect(tree(on)).toEqual([
      ["90001", 800],
      ["90002", 200],
    ]);
    expect(JSON.stringify(on)).not.toMatch(
      /9[012]009|Made-up sales ad|Copy 3\/3/,
    );
    const off = await offTheList(() => client(CEO, LOC_D));
    expect(tree(off)).toEqual([
      ["90001", 800],
      ["90009", 400],
      ["90002", 200],
    ]);
  });

  test("spend outside the rows leaves it out too", async () => {
    expect((await read()).offBoard).toEqual({
      spend: 0,
      unpriced: false,
      accounts: [],
    });
    await owner(db);
    await unlist(`3${LOOSE}`);
    try {
      expect((await read()).offBoard).toEqual({
        spend: 25,
        unpriced: false,
        accounts: [
          {
            accountId: LOOSE,
            name: "Outsider's ads",
            spend: 25,
            reason: "not_tied",
          },
        ],
      });
    } finally {
      await owner(db);
      await list(`3${LOOSE}`, `act_${LOOSE}`, `1${LOOSE}`);
    }
  });

  test("the list is matched on the ad id alone, as the media sync and the snapshot trigger match it: the account written with act_, without, or another one", async () => {
    await owner(db);
    await unlist("92009");
    try {
      await list("92009", ACCT_D, "90009");
      expect((await read()).v.spend.v).toBe(1000);
      await owner(db);
      await unlist("92009");
      // Meta's ad ids are unique: an account written wrong on the list still leaves the ad out.
      await list("92009", "act_9999999999", "90009");
      expect((await read()).v.spend.v).toBe(1000);
    } finally {
      await owner(db);
      await unlist("92009");
      await list("92009", `act_${ACCT_D}`, "90009");
    }
  });

  test("a client row's frequency leaves Meta's reach out while a listed ad delivered on its accounts in the time frame, and says why: the client's own ads' daily frequency stands in", async () => {
    const freq = async () =>
      rowOf(await board(CEO, kd(6), today), LOC_A).values.frequency;
    // Client A's reach over the last 7 days: 12,000 impressions over 5,000 people.
    expect(await freq()).toMatchObject({ v: 2.4, basis: "window" });
    await owner(db);
    try {
      // An outsider's ad on Client A's account: Meta's reach for the account counts its people too.
      await adDay({
        account: ACCT_A,
        day: kd(3),
        campaign: "80097",
        campaignName: "Copy 4/4",
        adset: "81097",
        ad: "70097",
        adName: "Made-up outsider ad",
        spend: 30,
        imp: 9000,
        clicks: 9,
        freq: 3,
      });
      await list("70097", `act_${ACCT_A}`, "80097");
      const f = await freq();
      // Client A's own ads all read 1.1 a day; the outsider's 3.0 is left out with its row.
      expect(f).toMatchObject({
        v: 1.1,
        basis: "average_daily",
        sample: 13200,
      });
      expect(f.num).toBeUndefined();
      expect(f.den).toBeUndefined();
      expect(f.note).toEndWith(
        "Meta's reach for these ad accounts also counts the outsiders' ads on the compromise list, so it is not used: this is the average daily frequency of the client's own ads.",
      );
      // Off the list its delivery is the client's: Meta's reach again.
      await owner(db);
      await unlist("70097");
      expect(await freq()).toMatchObject({ v: 2.4, basis: "window" });
      // Listed, with no impression in these days: nobody of it is in the reach, so the reach stays.
      await owner(db);
      await q(
        "UPDATE public.cockpit_meta_ad_days SET impressions = 0, spend = 0, spend_usd = 0, frequency = NULL WHERE ad_id = '70097'",
      );
      await list("70097", `act_${ACCT_A}`, "80097");
      expect(await freq()).toMatchObject({ v: 2.4, basis: "window" });
      // Delivered before the time frame only: the reach stays too.
      await owner(db);
      await q(
        "UPDATE public.cockpit_meta_ad_days SET day = $1, impressions = 9000, spend = 30, spend_usd = 30, frequency = 3 WHERE ad_id = '70097'",
        [kd(8)],
      );
      expect(await freq()).toMatchObject({ v: 2.4, basis: "window" });
    } finally {
      await owner(db);
      await unlist("70097");
      await q("DELETE FROM public.cockpit_meta_ad_days WHERE ad_id = '70097'");
    }
  });
});

describe("the migration", () => {
  test("applies twice, in production's order", async () => {
    await owner(db);
    await db.exec(migration(FILE));
    for (const f of FIXES) await db.exec(migration(f));
    for (const f of READ_CHECKED) await db.exec(migration(f));
    for (const f of READ_CHECKED) await db.exec(migration(f));
    const b = await board(CEO);
    expect(b.clients.length).toBe(3);
    expect(b).toHaveProperty("offBoard");
  });
});
