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
 * known answer. Every person, client, ad and number is invented.
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

  await db.exec(migration(FILE));
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

  test("the CEO, admins and unlimited seats see every client that is not cancelled", async () => {
    for (const id of [CEO, ADMIN, CREATIVE, SALES]) {
      const names = (await board(id)).clients.map((c: Row) => c.clientName);
      expect(names).toEqual(["Client A", "Client B", "Client C", "Formula Co"]);
    }
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
      cockpit_board_ad_cells: "",
      cockpit_board_ad_unmeasured: "",
      cockpit_board_appointments: "",
      cockpit_board_audit: "",
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
      cockpit_board_no_outcome_list: "",
      cockpit_board_read: "authenticated",
      cockpit_board_rows: "",
      cockpit_board_sheet_marks: "",
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
    expect(rows).toHaveLength(19);
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
    expect(v.closeRate).toMatchObject({
      v: r2((2 / 7) * 100),
      status: "watch",
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
    const row = rowOf(await board(CEO, kd(6), today), LOC_C);
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
    expect(ad1.metrics.shows.v).toBe(1);
    expect(ad1.metrics.hookRate).toMatchObject({ v: 30, num: 1800, den: 6000 });
    const ad2 = form.ads.find((a: Row) => a.id === "70002");
    expect(ad2.metrics.crmLeads.v).toBe(2);
    // AP6 (sheet mark only), AP11 and AP12 carry AD2; AP6 showed by the sheet.
    expect(ad2.metrics.confirmedBookings.v).toBe(3);
    expect(ad2.metrics.shows.v).toBe(1);
    const chat = camp.adsets[1];
    expect(chat.metrics.cpl).toMatchObject({ status: "not_measured" });
    expect(c.notInStore).toEqual([
      { adId: "70009", crmLeads: 1, confirmedBookings: 1, shows: 1 },
    ]);
    expect(c.noAd).toMatchObject({ crmLeads: 1 });
  });

  test("the row names the assigned callers; an admin who holds assignments is left out", async () => {
    const row = rowOf(await board(CEO, kd(6), today), LOC_A);
    expect(row.callers).toEqual([
      { email: AGENT, name: "Agent One" },
      { email: AGENT2, name: "Agent Two" },
    ]);
    expect(rowOf(await board(CEO, kd(6), today), LOC_C).callers).toEqual([
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

describe("the migration", () => {
  test("applies twice", async () => {
    await owner(db);
    await db.exec(migration(FILE));
    expect((await board(CEO)).clients.length).toBe(4);
  });
});
