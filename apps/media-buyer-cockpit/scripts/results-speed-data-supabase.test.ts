/**
 * Results and speed data: the number meanings, the meeting gap report, the CSM call list,
 * bookings by call speed and the morning uncalled list (migrations 20261021e to 20261021h) on an
 * isolated PostgreSQL.
 *
 * The board's own migrations are applied first, in the order production has them, over the
 * dialer's views exactly as the board facts test builds them (its DIALER block is read from that
 * file), so the new functions are checked against the board's own numbers: cockpit_board_rows,
 * cockpit_client_days after cockpit_board_facts_refresh, and cockpit_client_now. Every client,
 * lead, call, meeting and sheet row below is invented.
 */
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { PGlite } from "@electric-sql/pglite";
import {
  actor,
  cockpitTestDb,
  member,
  migration as migrationFile,
  owner,
} from "./lib/cockpitTestDb";

/** A migration with LF line ends, so the checks below read the same on a Windows checkout. */
const migration = (name: string) => migrationFile(name).replace(/\r\n/g, "\n");

const FILES = {
  meanings: "20261021e_number_meanings.sql",
  gap: "20261021f_meeting_gap_report.sql",
  callList: "20261021g_csm_call_list.sql",
  speed: "20261021h_speed_bands_and_uncalled.sql",
};
/** The board, in production order (as the board API test loads it). */
const BOARD_CHAIN = [
  "20261013180000_cockpit_client_calls.sql",
  "20261015200000_cockpit_client_calls_whatsapp_chats.sql",
  "20261013180200_cockpit_client_callers.sql",
  "20261016111157_board_facts.sql",
  "20261016121700_meta_ad_days.sql",
];
const BOARD_API = [
  "20261016133300_board_api.sql",
  "20261016210000_board_facts_checked.sql",
  "20261016210100_meta_ad_days_checked.sql",
  "20261017100000_meta_budgets.sql",
  "20261016220000_board_read_checked.sql",
  "20261016220100_board_read_notes.sql",
  "20261017090000_board_active_only.sql",
  "20261017100100_board_budgets.sql",
  "20261017120000_board_budget_issue_scope.sql",
  "20261021a_board_skip_excluded_ads.sql",
];

const BUYER = "00000000-0000-4000-8000-0000000000b1";
const LOC_A = "locGapClientA000001";
const LOC_B = "locGapClientB000002";
const LOC_D = "locGapClientD000004";
const LOC_E = "locGapClientE000005";
const LOC_F = "locGapClientF000006";
const LOC_S = "locSpeedClient000007";
const LOC_U = "locUncalledClient008";
const ACCT_A = "3111111111";
const ACCT_D = "3222222222";
const ACCT_F = "3333333333";
const AGENT = "agent1@maharamedia.com";
const AGENT2 = "agent2@maharamedia.com";
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
/** Hand-written days well before the refresh window: Client D, Client E and Client B. */
const H_FROM = kd(40);
const H_TO = kd(31);
const SCHEDULE = {
  timezone: "Asia/Kuwait",
  exceptions: [],
  week: Object.fromEntries(
    ["sun", "mon", "tue", "wed", "thu", "fri", "sat"].map(d => [
      d,
      { on: d !== "fri", start: "10:00", end: "18:00" },
    ]),
  ),
};

/** The dialer's views and tables, exactly as the board facts test builds them. */
const DIALER = (() => {
  const text = readFileSync(
    new URL("./board-facts-supabase.test.ts", import.meta.url),
    "utf8",
  ).replace(/\r\n/g, "\n");
  const hit = text.match(/const DIALER = String\.raw`([\s\S]*?)`;\n/);
  if (!hit || hit[1].includes("${"))
    throw new Error("The board facts test's DIALER block moved");
  return hit[1];
})();
const EXCLUDED_ADS = (() => {
  const hit = migration("20261010a_exclude_unauthorized_ads.sql").match(
    /create table if not exists public\.cockpit_excluded_ads \([\s\S]*?\n\);\nalter table public\.cockpit_excluded_ads enable row level security;\nrevoke all on public\.cockpit_excluded_ads from anon, authenticated;/,
  );
  if (!hit) throw new Error("The compromise list's table moved in 20261010a");
  return hit[0];
})();
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

// The dialer's call view runs slowly on PGlite: one read over the 1,365-lead fixture takes several seconds.
setDefaultTimeout(180_000);

let db: PGlite;
type Row = Record<string, any>;

async function q<T = Row>(text: string, params: unknown[] = []): Promise<T[]> {
  return (await db.query<T>(text, params)).rows;
}
async function one<T = any>(text: string, params: unknown[] = []): Promise<T> {
  return (await q<{ r: T }>(text, params))[0].r;
}
/** Run as the service role, the one door the new functions have. */
async function svc<T = Row>(text: string, params: unknown[] = []): Promise<T[]> {
  await owner(db);
  await db.query("SELECT set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({ role: "service_role" }),
  ]);
  await db.exec("SET ROLE service_role");
  try {
    return await q<T>(text, params);
  } finally {
    await owner(db);
  }
}
async function refusedFor(
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
const r1 = (n: number) => Math.round(n * 10) / 10;
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
      r.campaign ?? "80001",
      r.campaignName ?? "Campaign",
      "OUTCOME_LEADS",
      r.adset ?? "81001",
      "Ad set",
      r.ad ?? "70001",
      "Ad",
      r.spend,
      r.imp ?? 1000,
      null,
      null,
      r.clicks ?? 10,
      r.leads ?? 1,
      r.leads ?? 1,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
    ],
  );
}
/** One hand-written day of the board's stored facts. */
async function factsDay(
  loc: string,
  day: string,
  v: { booked: number; due: number; shows: number | null; noShows: number | null; noOutcome?: number },
) {
  await q(
    `INSERT INTO public.cockpit_client_days(location_id,day,crm_leads,crm_ad_leads,confirmed_bookings,provisional_bookings,meetings_due,
       shows,no_shows,no_outcome,sources)
     VALUES($1,$2,4,3,$3,0,$4,$5,$6,$7,'{}'::jsonb)`,
    [loc, day, v.booked, v.due, v.shows, v.noShows, v.noOutcome ?? 0],
  );
}
async function sheet(loc: string, name: string, rows: Row[]) {
  await q(
    "INSERT INTO mahara_reporting.sheet_snapshots VALUES('production',$1,$2,$3,true,$4::jsonb,now(),NULL)",
    [loc, name, `S_${loc}`, JSON.stringify({ sheetId: `S_${loc}`, currency: null, rows })],
  );
}
const TAB = (iso: string) => {
  const d = new Date(iso);
  return `${d.toLocaleString("en-US", { month: "short", timeZone: "UTC" })} ${String(d.getUTCFullYear()).slice(2)}`;
};

// ---------------------------------------------------------------------------
// Client A: a clean client. Meetings by the Kuwait day, 1 to 3 days ago.
const AP = {
  sheetAttended: { start: kt(3, "12:00"), booked: kt(5, "09:00") },
  crmNoshow: { start: kt(3, "13:00"), booked: kt(5, "10:00") },
  portalShowed: { start: kt(3, "14:00"), booked: kt(5, "11:00") },
  blankRow: { start: kt(3, "15:00"), booked: kt(5, "12:00") },
  noRow: { start: kt(3, "16:00"), booked: kt(5, "13:00") },
  newStatus: { start: kt(2, "10:00"), booked: kt(4, "09:00") },
  cancelled: { start: kt(2, "11:00"), booked: kt(4, "10:00") },
  google: { start: kt(2, "12:00"), booked: kt(4, "11:00") },
  provisional: { start: kt(2, "13:00"), booked: kt(4, "12:00") },
  callback: { start: kt(2, "14:00"), booked: kt(4, "13:00") },
  future: { start: kt(-1, "10:00"), booked: kt(1, "08:00") },
  sheetOnly: { start: kt(1, "10:00"), booked: kt(3, "09:00") },
};
// Client E: the places the one rule and the board's old count differ.
const EP = {
  portalNoAttendance: { start: kt(3, "12:00"), booked: kt(5, "09:00") },
  crmShowedOnly: { start: kt(3, "13:00"), booked: kt(5, "10:00") },
  unclear: { start: kt(3, "14:00"), booked: kt(5, "11:00") },
  plainBlank: { start: kt(3, "15:00"), booked: kt(5, "12:00") },
  crmShowedToo: { start: kt(3, "16:00"), booked: kt(5, "13:00") },
};

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
  await db.exec(`ALTER TABLE public.appointments ADD COLUMN ad_id text, ADD COLUMN adset_id text, ADD COLUMN campaign_id text,
    ADD COLUMN contact_name text;`);
  await member(db, BUYER, "buyer@tests.invalid", ["media_buyer"]);
  for (const f of BOARD_CHAIN) await db.exec(migration(f));
  await db.exec(EXCLUDED_ADS);
  await db.exec(TEAM_ONLY);
  for (const f of BOARD_API) await db.exec(migration(f));
  for (const f of Object.values(FILES)) await db.exec(migration(f));
  // Applying twice is safe.
  for (const f of Object.values(FILES)) await db.exec(migration(f));

  await owner(db);
  await db.exec(`
    INSERT INTO public.ghl_clients(location_id,client_name,status,clickup_id,meta_ad_account,country,service_mode,tiktok_ad_account) VALUES
     ('${LOC_A}','Client A','Active','CU_A',NULL,'KW','DFY',NULL),
     ('${LOC_B}','Client B','Active','CU_B',NULL,'SA','DWY',NULL),
     ('${LOC_D}','Client D','Active','CU_D',NULL,'KW','DFY',NULL),
     ('${LOC_E}','Client E','Active','CU_E',NULL,'KW','DFY',NULL),
     ('${LOC_F}','Client F','Active','CU_F',NULL,'KW','DFY',NULL),
     ('${LOC_S}','Speed Client','Active','CU_S',NULL,'KW','DFY',NULL),
     ('${LOC_U}','Uncalled Client','Active','CU_U',NULL,'KW','DFY',NULL);
    INSERT INTO public.clients(name,meta_ad_account_id,ghl_location_id,hidden_from_dashboard) VALUES
     ('Client D ads','act_${ACCT_D}','${LOC_D}',false),
     ('Client F ads','act_${ACCT_F}','${LOC_F}',false),
     ('Client A ads','act_${ACCT_A}','${LOC_A}',false);
    INSERT INTO public.cockpit_people(name,email,role,active,schedule) VALUES
     ('Agent One','${AGENT}','Call centre agent',true,'${JSON.stringify(SCHEDULE)}'::jsonb),
     ('Agent Two','${AGENT2}','Call centre agent',true,'${JSON.stringify(SCHEDULE)}'::jsonb);
    INSERT INTO mahara_console.metadata VALUES
     ('production','access:agent:${AGENT}','{"email":"${AGENT}","active":true,"locationIds":["${LOC_A}","${LOC_S}","${LOC_U}"]}'),
     ('production','identity:account:${AGENT}','{"email":"${AGENT}","role":"agent","enabled":true}');
    INSERT INTO public.ghl_calendars(location_id,calendar_id,name) VALUES
     ('${LOC_A}','${CAL_MAIN}','Main Appointment Calendar'),
     ('${LOC_A}','${CAL_ONLINE}','Online Appointment Calendar'),
     ('${LOC_A}','${CAL_PROV}','Not Confirmed Appointments'),
     ('${LOC_A}','${CAL_CB}','Callback Calendar'),
     ('${LOC_E}','${CAL_MAIN}','Main Appointment Calendar'),
     ('${LOC_S}','${CAL_MAIN}','Main Appointment Calendar'),
     ('${LOC_S}','${CAL_PROV}','Not Confirmed Appointments');
    INSERT INTO public.lead_sync_state VALUES ('${LOC_A}',now(),'success',NULL),('${LOC_E}',now(),'success',NULL),
     ('${LOC_S}',now(),'success',NULL),('${LOC_U}',now(),'success',NULL);
    INSERT INTO public.appointment_sync_state VALUES ('${LOC_A}',now(),'success'),('${LOC_E}',now(),'success'),
     ('${LOC_S}',now(),'success'),('${LOC_U}',now(),'success');
    INSERT INTO mahara_reporting.sync_jobs VALUES
     ('production','j1','ghl','${LOC_A}','appointments_recent',now(),NULL),
     ('production','maqsam:${AGENT}','maqsam','${AGENT}','calls',now(),NULL);
  `);

  // ---- Client A: leads and meetings
  const phoneA = (n: number) => `+9655000${String(n).padStart(4, "0")}`;
  for (let i = 1; i <= 12; i++)
    await lead(`A${i}`, LOC_A, kt(12, "10:00"), {
      ad: "70001",
      campaign: "80001",
      name: `Lead${i} Family`,
      phone: phoneA(i),
    });
  await appt("AP1", LOC_A, { contact: "A1", ...AP.sheetAttended, attended: true });
  await appt("AP2", LOC_A, { contact: "A2", ...AP.crmNoshow, status: "noshow", attended: false });
  await appt("AP3", LOC_A, { contact: "A3", ...AP.portalShowed });
  await outcome(LOC_A, "AP3", 1, { attendance: "no_show" });
  await outcome(LOC_A, "AP3", 2, { attendance: "showed", lq: 8 });
  await appt("AP4", LOC_A, { contact: "A4", ...AP.blankRow });
  await appt("AP5", LOC_A, { contact: "A5", ...AP.noRow });
  await appt("AP6", LOC_A, { contact: "A6", ...AP.newStatus, status: "new" });
  await appt("AP7", LOC_A, { contact: "A7", ...AP.cancelled, status: "cancelled" });
  await appt("AP8", LOC_A, { contact: "A8", ...AP.google, source: "google_calendar" });
  await appt("AP9", LOC_A, { contact: "A9", calendar: CAL_PROV, ...AP.provisional });
  await appt("AP10", LOC_A, { contact: "A10", calendar: CAL_CB, ...AP.callback });
  await appt("AP11", LOC_A, { contact: "A11", ...AP.future });
  await appt("AP12", LOC_A, { contact: "A12", ...AP.sheetOnly });
  await sheet(LOC_A, "Client A", [
    // marked Y: only the dialer's read of the sheet holds it
    { tab: TAB(AP.sheetOnly.start), name: "Lead12 Family", phone: phoneA(12), meeting: ms(AP.sheetOnly.start), show: "Y", closed: null, row: 2 },
    // AP1's own sheet row is marked as well (the appointment also carries attended)
    { tab: TAB(AP.sheetAttended.start), name: "Lead1 Family", phone: phoneA(1), meeting: ms(AP.sheetAttended.start), show: "Y", closed: "N", row: 3 },
    // blank Show cell: the client has the row and has not filled it
    { tab: TAB(AP.blankRow.start), name: "Lead4 Family", phone: phoneA(4), meeting: ms(AP.blankRow.start), show: null, closed: null, row: 4 },
    { tab: TAB(AP.newStatus.start), name: "Lead6 Family", phone: phoneA(6), meeting: ms(AP.newStatus.start), show: null, closed: null, row: 5 },
    // a meeting in the future and a row with no phone number: counted in the sheet's rows, never matched
    { tab: TAB(AP.future.start), name: "Lead11 Family", phone: phoneA(11), meeting: ms(AP.future.start), show: null, closed: null, row: 6 },
    { tab: TAB(AP.blankRow.start), name: "No Phone", phone: null, meeting: ms(AP.blankRow.start), show: null, closed: null, row: 7 },
  ]);

  // ---- Client E: where the one rule and the board's old count differ
  const phoneE = (n: number) => `+9655100${String(n).padStart(4, "0")}`;
  for (let i = 1; i <= 5; i++)
    await lead(`E${i}`, LOC_E, kt(12, "10:00"), { ad: "70002", campaign: "80002", name: `Eman${i} Family`, phone: phoneE(i) });
  await appt("EP1", LOC_E, { contact: "E1", ...EP.portalNoAttendance });
  // The portal holds a row for the meeting, with no attendance in it (only a deal answer).
  await outcome(LOC_E, "EP1", 1, { attendance: null, deal: "pending" });
  await appt("EP2", LOC_E, { contact: "E2", ...EP.crmShowedOnly, status: "showed" });
  await appt("EP3", LOC_E, { contact: "E3", ...EP.unclear });
  await appt("EP4", LOC_E, { contact: "E4", ...EP.plainBlank });
  await appt("EP5", LOC_E, { contact: "E5", ...EP.crmShowedToo, status: "showed" });
  await sheet(LOC_E, "Client E", [
    // two rows for one meeting that disagree
    { tab: TAB(EP.unclear.start), name: "Eman3 Family", phone: phoneE(3), meeting: ms(EP.unclear.start), show: "Y", closed: null, row: 2 },
    { tab: TAB(EP.unclear.start), name: "Eman3 Family", phone: phoneE(3), meeting: ms(EP.unclear.start), show: "N", closed: null, row: 3 },
    { tab: TAB(EP.plainBlank.start), name: "Eman4 Family", phone: phoneE(4), meeting: ms(EP.plainBlank.start), show: "", closed: null, row: 4 },
  ]);

  // ---- Client D (80% coverage), Client F (70%) and Client B (done with you): ten hand-written days each
  for (let i = 0; i < 10; i++) {
    const day = dayShift(H_FROM, i);
    await adDay({ account: ACCT_D, day, spend: 100, tz: "Asia/Riyadh", ad: "70101" });
    await adDay({ account: ACCT_F, day, spend: 100, tz: "Asia/Riyadh", ad: "70201" });
  }
  // Client A's ads: the last six days. Today is not in yet.
  for (let i = 1; i <= 6; i++)
    await adDay({ account: ACCT_A, day: kd(i), spend: 20, ad: "70001" });

  // ---- The board's facts for the last ten days, from the sources above
  await owner(db);
  const refreshed = await one(
    "SELECT public.cockpit_board_facts_refresh($1::date,$2::date) AS r",
    [FROM, today],
  );
  expect(refreshed.ok).toBe(true);

  // Hand-written days (they need the spine the refresh writes): Client D 8 of 10 meetings marked
  // (80%), Client F 7 of 10 (70%), and Client B, done with you, 8 of 10.
  for (let i = 0; i < 10; i++) {
    const day = dayShift(H_FROM, i);
    for (const [loc, marked] of [
      [LOC_D, 8],
      [LOC_F, 7],
      [LOC_B, 8],
    ] as [string, number][])
      await factsDay(loc, day, {
        booked: 1,
        due: 1,
        shows: i < marked ? 1 : null,
        noShows: i < marked ? 0 : null,
      });
  }
}, 240_000);

afterAll(async () => {
  await db?.close();
});

const WINDOW = [FROM, today];

describe("the new functions open to the service key only", () => {
  const CALLS = [
    "SELECT * FROM public.cockpit_dictionary_definitions()",
    "SELECT * FROM public.cockpit_dictionary_numbers($1::date,$2::date)",
    "SELECT * FROM public.cockpit_dictionary_first_call()",
    "SELECT * FROM public.cockpit_gap_report($1::date,$2::date)",
    "SELECT * FROM public.cockpit_csm_call_list()",
    "SELECT * FROM public.cockpit_booking_by_speed(now() - interval '60 days', now())",
    "SELECT * FROM public.cockpit_morning_uncalled()",
    "SELECT * FROM public.cockpit_morning_uncalled_summary()",
  ];
  test("anon and a signed-in seat are refused, the service role is not", async () => {
    for (const text of CALLS) {
      const params = text.includes("$1") ? WINDOW : [];
      for (const who of [null, BUYER])
        expect(await refusedFor(who, text, params)).toMatch(/permission denied/);
      await svc(text, params);
    }
  });
});

describe("1. number meanings", () => {
  test("every number has one definition with its source and the decision behind it", async () => {
    const rows = await svc("SELECT * FROM public.cockpit_dictionary_definitions()");
    const keys = rows.map(r => r.metric);
    for (const k of [
      "show_rate",
      "cancellations",
      "coverage",
      "no_attendance",
      "cost_per_booking",
      "cost_per_attended",
      "first_call_working",
      "first_call_clock",
      "bookings_per_100_by_speed",
    ])
      expect(keys).toContain(k);
    expect(new Set(keys).size).toBe(keys.length);
    for (const r of rows) {
      for (const c of ["label", "formula", "counts", "leaves_out", "source", "decision"])
        expect(String(r[c]).length).toBeGreaterThan(c === "label" ? 3 : 10);
      // plain words: no em dash
      expect(JSON.stringify(r)).not.toContain("—");
    }
    expect(rows.find(r => r.metric === "show_rate")!.decision).toContain("2026-09-23");
  });

  test("show rate, coverage and cancellations for a clean client are worked out from the meetings", async () => {
    const [a] = await svc(
      "SELECT * FROM public.cockpit_dictionary_numbers($1::date,$2::date,$3)",
      [FROM, today, LOC_A],
    );
    // Past meetings: AP1-AP6, AP9 (provisional calendar) and AP12 = 8. Cancelled AP7, Google AP8,
    // callback AP10 and future AP11 are not past meetings that count.
    expect(a.meetings_past).toBe(8);
    expect(a.shows).toBe(3); // AP1 (attended), AP3 (portal), AP12 (sheet read)
    expect(a.no_shows).toBe(1); // AP2
    expect(a.attendance_recorded).toBe(4);
    expect(a.no_attendance).toBe(4); // AP4, AP5, AP6, AP9
    expect(Number(a.show_rate)).toBe(75);
    expect(Number(a.coverage)).toBe(50);
    expect(a.cancellations).toBe(1);
    expect(a.show_rate_status).toBe("ok");
    expect(a.coverage_status).toBe("ok");
    // the cancellation is not a no-show, and no_shows + shows + cancellations stays three different counts
    expect(a.no_shows).not.toBe(a.cancellations + a.no_shows);
  });

  test("the show rate equals the board's own cell, and so does the cost per booking", async () => {
    const rows = await one(
      "SELECT public.cockpit_board_rows($1::date,$2::date,NULL,public.cockpit_meta_ad_days_status()) AS r",
      [FROM, today],
    );
    const dict = await svc(
      "SELECT * FROM public.cockpit_dictionary_numbers($1::date,$2::date)",
      [FROM, today],
    );
    const names = dict.map(d => d.location_id).sort();
    expect(names).toContain(LOC_A);
    expect(names).toContain(LOC_D);
    expect(names).not.toContain("locNotActive");
    for (const d of dict) {
      const b = (rows as Row[]).find(x => x.locationId === d.location_id)!;
      const sr = b.values.showRate;
      expect(d.show_rate === null ? null : Number(d.show_rate)).toBe(sr.v === null ? null : Number(sr.v));
      const cp = b.values.costPerBooking;
      expect(d.cost_per_booking === null ? null : Number(d.cost_per_booking)).toBe(cp.v === null ? null : Number(cp.v));
      if (cp.num !== undefined) expect(Number(d.spend_paired_usd)).toBe(Number(cp.num));
    }
    const a = dict.find(d => d.location_id === LOC_A)!;
    // Six days of $20 spend over the confirmed bookings counted by creation day, provisional left out.
    expect(Number(a.spend_paired_usd)).toBe(120);
    expect(a.bookings_provisional).toBeGreaterThanOrEqual(1);
  });

  test("provisional bookings are shown apart and never counted in the cost per booking", async () => {
    const [a] = await svc(
      "SELECT * FROM public.cockpit_dictionary_numbers($1::date,$2::date,$3)",
      [FROM, today, LOC_A],
    );
    const days = await q(
      "SELECT sum(confirmed_bookings)::int c, sum(provisional_bookings)::int p FROM public.cockpit_client_days WHERE location_id=$1 AND day BETWEEN $2 AND $3",
      [LOC_A, FROM, today],
    );
    expect(a.bookings_counted).toBe(days[0].c);
    expect(a.bookings_provisional).toBe(days[0].p);
    expect(days[0].p).toBeGreaterThan(0);
    if (a.bookings_paired && a.bookings_paired > 0)
      expect(r2(Number(a.spend_paired_usd) / a.bookings_paired)).toBe(Number(a.cost_per_booking));
  });

  test("cost per attended meeting is hidden at 70% coverage, shown at 80%, and never for done with you", async () => {
    const [d, f, b] = await Promise.all(
      [LOC_D, LOC_F, LOC_B].map(async loc =>
        (
          await svc(
            "SELECT * FROM public.cockpit_dictionary_numbers($1::date,$2::date,$3)",
            [H_FROM, H_TO, loc],
          )
        )[0],
      ),
    );
    // Client D: 8 shows of 10 meetings, all marked: coverage 80%, spend $100 a day.
    expect(Number(d.coverage)).toBe(80);
    expect(d.cost_per_attended_status).toBe("ok");
    expect(Number(d.cost_per_attended)).toBe(125); // $1,000 over 8 showed meetings
    expect(Number(d.cost_per_booking)).toBe(100);
    expect(Number(d.show_rate)).toBe(100);
    // Client F: 7 of 10 marked, coverage 70%: hidden with the reason.
    expect(Number(f.coverage)).toBe(70);
    expect(f.cost_per_attended).toBeNull();
    expect(f.cost_per_attended_status).toBe("hidden_low_coverage");
    expect(f.note).toContain("under the 80%");
    // Client B is done with you: even at 80% it never shows.
    expect(Number(b.coverage)).toBe(80);
    expect(b.cost_per_attended).toBeNull();
    expect(b.cost_per_attended_status).toBe("not_dfy");
  });

  test("a day count with nothing marked is not filled in, never a zero rate", async () => {
    const rows = await svc(
      "SELECT * FROM public.cockpit_dictionary_numbers($1::date,$2::date,$3)",
      [FROM, today, LOC_E],
    );
    // E has five meetings past, two marked showed by the CRM (EP2, EP5), none by the sheet or portal
    expect(rows[0].meetings_past).toBe(5);
    expect(rows[0].show_rate_status).toBe("ok");
    const none = await svc(
      "SELECT * FROM public.cockpit_dictionary_numbers($1::date,$2::date,$3)",
      [kd(300), kd(299), LOC_A],
    );
    expect(none[0].meetings_past === null || none[0].meetings_past === 0 || none[0].show_rate_status !== "ok").toBe(true);
    expect(none[0].show_rate).toBeNull();
    expect(none[0].cost_per_attended).toBeNull();
  });

  test("an invalid window is refused", async () => {
    await owner(db);
    await expect(
      q("SELECT * FROM public.cockpit_dictionary_numbers($1::date,$2::date)", [today, kd(3)]),
    ).rejects.toThrow(/first day on or before the last day/);
  });

  test("the official first call is the median of the clients' medians, in working minutes", async () => {
    await owner(db);
    await q("UPDATE public.cockpit_client_now SET first_call_median_work_seconds_30d = NULL");
    await q(
      "UPDATE public.cockpit_client_now SET first_call_median_work_seconds_30d = v.s FROM (VALUES ($1,1800),($2,5400),($3,12600)) v(l,s) WHERE location_id = v.l",
      [LOC_A, LOC_D, LOC_E],
    );
    // Client B is done with you and left out even with a figure.
    await q("UPDATE public.cockpit_client_now SET first_call_median_work_seconds_30d = 90000 WHERE location_id = $1", [LOC_B]);
    const [x] = await svc("SELECT * FROM public.cockpit_dictionary_first_call()");
    expect(x.clients).toBe(3);
    expect(Number(x.official_work_minutes)).toBe(90); // median of 30, 90 and 210 minutes
    const board = await one(
      "SELECT public.cockpit_board_rows($1::date,$2::date,$3,public.cockpit_meta_ad_days_status()) AS r",
      [FROM, today, LOC_D],
    );
    const [dn] = await svc(
      "SELECT * FROM public.cockpit_dictionary_numbers($1::date,$2::date,$3)",
      [FROM, today, LOC_D],
    );
    expect(Number(dn.first_call_work_minutes)).toBe(Number((board as Row[])[0].values.firstCall.v));
    expect(Number(dn.first_call_work_minutes)).toBe(90);
  });
});

describe("2. the gap report", () => {
  test("the rule: ended, not cancelled, no attendance", async () => {
    const [x] = await svc(
      `SELECT public.cockpit_no_result_rule(true,'unknown') a, public.cockpit_no_result_rule(true,'showed') b,
              public.cockpit_no_result_rule(true,'noshow') c, public.cockpit_no_result_rule(false,'unknown') d,
              public.cockpit_no_result_rule(NULL,'unknown') e`,
    );
    expect([x.a, x.b, x.c, x.d, x.e]).toEqual([true, false, false, false, false]);
  });

  test("a clean client: the counts, the two splits and the board's own counts agree", async () => {
    const [g] = await svc(
      "SELECT * FROM public.cockpit_gap_report($1::date,$2::date,$3)",
      [FROM, today, LOC_A],
    );
    expect(g.meetings_past).toBe(8);
    expect(g.with_attendance).toBe(4);
    expect(g.no_result).toBe(4);
    expect(Number(g.coverage)).toBe(50);
    // AP4 (confirmed, blank row), AP5 (confirmed, no row), AP6 (status new, blank row), AP9 (confirmed, no row)
    expect(g.crm_confirmed).toBe(3);
    expect(g.sheet_blank).toBe(2);
    expect(g.sheet_missing).toBe(2);
    expect(g.sheet_unclear).toBe(0);
    expect(g.crm_confirmed_sheet_blank).toBe(1); // AP4
    expect(g.sheet_blank + g.sheet_missing + g.sheet_unclear).toBe(g.no_result);
    expect(g.sheet_read_ok).toBe(true);
    expect(g.oldest_days).toBe(3);
    // the board's stored facts, after its own refresh
    expect(g.board_meetings_past).toBe(8);
    expect(g.board_no_outcome).toBe(4);
    expect(g.matches_board).toBe(true);
    expect(g.note).toBeNull();
  });

  test("the counts match the board's stored table for every client with facts in the window", async () => {
    const report = await svc(
      "SELECT * FROM public.cockpit_gap_report($1::date,$2::date)",
      [FROM, today],
    );
    const facts = await q(
      `SELECT location_id, sum(meetings_due)::int due, sum(no_outcome)::int no_out, sum(shows)::int shows, sum(no_shows)::int no_shows
       FROM public.cockpit_client_days WHERE day BETWEEN $1 AND $2 GROUP BY 1`,
      [FROM, today],
    );
    for (const f of facts) {
      const g = report.find(r => r.location_id === f.location_id);
      if (!g) continue;
      expect(g.meetings_past).toBe(f.due ?? 0);
      // attendance recorded is what the facts call shows plus no-shows
      expect(g.with_attendance).toBe((f.shows ?? 0) + (f.no_shows ?? 0));
    }
    // The report lists Active clients only, as the board does.
    expect(report.map(r => r.location_id)).toContain(LOC_A);
    // ordered with the most meetings without a result first
    const counts = report.map(r => r.no_result);
    expect([...counts].sort((x, y) => y - x)).toEqual(counts);
  });

  test("where the one rule and the board's old count differ, the report says so", async () => {
    const [g] = await svc(
      "SELECT * FROM public.cockpit_gap_report($1::date,$2::date,$3)",
      [FROM, today, LOC_E],
    );
    // EP1 (portal row, no attendance), EP3 (sheet rows that disagree) and EP4 (blank row) have no
    // attendance; EP2 and EP5 (CRM says showed) are recorded.
    expect(g.meetings_past).toBe(5);
    expect(g.no_result).toBe(3);
    expect(g.with_attendance).toBe(2);
    expect(g.sheet_blank).toBe(1); // EP4: its row is there and blank
    expect(g.sheet_unclear).toBe(1); // EP3: two rows that disagree
    expect(g.sheet_missing).toBe(1); // EP1: no sheet row at all
    expect(g.sheet_blank + g.sheet_missing + g.sheet_unclear).toBe(g.no_result);
    // The board's stored count has no outcome for EP2, EP3, EP4 and EP5 (no sheet mark and no
    // portal row) but not EP1 (the portal holds a row): 4 against the rule's 3.
    expect(g.board_meetings_past).toBe(5);
    expect(g.board_no_outcome).toBe(4);
    expect(g.matches_board).toBe(false);
    expect(g.note).toContain("differ");
    const list = await svc(
      "SELECT * FROM public.cockpit_gap_meetings($1,$2::date,$3::date)",
      [LOC_E, FROM, today],
    );
    expect(list.map(m => m.appointment_id).sort()).toEqual(["EP1", "EP3", "EP4"]);
    const board = await q(
      "SELECT * FROM public.cockpit_board_no_outcome_list($1,$2::date,$3::date,NULL::jsonb)",
      [LOC_E, FROM, today],
    ).catch(() => []);
    expect(board).toBeDefined();
  });

  test("the meetings with no result, each with both splits and nothing about the lead but a first name", async () => {
    const list = await svc(
      "SELECT * FROM public.cockpit_gap_meetings($1,$2::date,$3::date)",
      [LOC_A, FROM, today],
    );
    expect(list.map(m => m.appointment_id)).toEqual(["AP4", "AP5", "AP6", "AP9"]);
    const byId = Object.fromEntries(list.map(m => [m.appointment_id, m]));
    expect(byId.AP4.crm_confirmed).toBe(true);
    expect(byId.AP4.sheet_state).toBe("blank");
    expect(byId.AP5.sheet_state).toBe("missing");
    expect(byId.AP6.crm_status).toBe("new");
    expect(byId.AP6.crm_confirmed).toBe(false);
    expect(byId.AP6.sheet_state).toBe("blank");
    expect(byId.AP9.calendar_kind).toBe("provisional");
    expect(byId.AP4.first_name).toBe("Lead4");
    expect(byId.AP4.contact_url).toBe(`https://app.gohighlevel.com/v2/location/${LOC_A}/contacts/detail/A4`);
    expect(Object.keys(byId.AP4).some(k => /phone|email/i.test(k))).toBe(false);
    expect(byId.AP4.days_since).toBe(3);
  });

  test("the sheet row count per client is the rows in the client's own sheet, split into filled and blank", async () => {
    const [g] = await svc(
      "SELECT * FROM public.cockpit_gap_report($1::date,$2::date,$3)",
      [FROM, today, LOC_A],
    );
    const raw = await q(
      "SELECT jsonb_array_length(data->'rows') n FROM mahara_reporting.sheet_snapshots WHERE id = $1",
      [LOC_A],
    );
    expect(g.sheet_rows_total).toBe(raw[0].n);
    expect(g.sheet_rows_total).toBe(6);
    // 5 rows have a past meeting in the window (the sixth is a future meeting): 2 filled, 3 blank
    expect(g.sheet_rows_in_window).toBe(5);
    expect(g.sheet_rows_filled).toBe(2);
    expect(g.sheet_rows_blank).toBe(3);
    expect(g.sheet_rows_filled + g.sheet_rows_blank).toBe(g.sheet_rows_in_window);
    expect(g.sheet_checked_at).not.toBeNull();
    // Every blank row that matches a meeting with no result is one of the sheet's blank rows.
    expect(g.sheet_blank).toBeLessThanOrEqual(g.sheet_rows_blank);
  });

  test("a client with no sheet at all says so and counts every missing", async () => {
    const [g] = await svc(
      "SELECT * FROM public.cockpit_gap_report($1::date,$2::date,$3)",
      [FROM, today, LOC_D],
    );
    expect(g.sheet_rows_total).toBeNull();
    expect(g.note).toContain("holds no sheet");
    // Client D has hand-written days only, before the window: nothing past in these days.
    expect(g.meetings_past).toBe(0);
    expect(g.no_result).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 3. The CSM call list. The clock is passed in: Thursday 22 October 2026, 11:00 Kuwait time, one hour
// after that day's run. The Thursday runs before it are 15 October (week 42), 8 October (41) and 1 October (40).
const NOW = "2026-10-22T08:00:00Z";
const KW = (iso: string) => `${iso}+03:00`;
const csmLoc = (n: number) => `locCsmClient${String(n).padStart(6, "0")}`;

describe("3. the CSM call list", () => {
  /** One sheet row of a client's report sheet. */
  const row = (when: string, extra: Row = {}) => ({
    tab: "Oct 26",
    name: extra.name ?? "Lead Family",
    phone: "+96560000000",
    meeting: ms(KW(when)),
    show: extra.show ?? null,
    closed: extra.closed ?? null,
    confirmed: extra.confirmed ?? null,
    row: 2,
  });
  const many = (n: number, first: string) =>
    Array.from({ length: n }, (_, i) =>
      row(`2026-10-${first}T${String(10 + i).padStart(2, "0")}:00:00`, { name: `Person${i} Surname` }),
    );
  const DEFAULT = "SELECT *, oldest_meeting::text AS oldest FROM public.cockpit_csm_call_list($1::timestamptz)";
  const clients: [number, string, Row[]][] = [
    [
      1,
      "Client 1",
      [
        row("2026-10-06T12:00:00", { name: "Old Two" }), // runs 8 and 15 Oct: counts
        row("2026-10-12T12:00:00", { name: "Two Runs" }), // runs 15 and 22 Oct: counts
        row("2026-10-13T12:00:00", { name: "Closed Blank", show: "Y" }), // runs 15 and 22 Oct, Closed blank: counts
        row("2026-10-15T11:00:00", { name: "After Run" }), // an hour after the 15 Oct run: one run only
        row("2026-10-20T12:00:00", { name: "Recent" }), // one run only
        row("2026-10-23T12:00:00", { name: "Future" }), // not over yet
        row("2026-10-06T13:00:00", { name: "Filled", show: "Y", closed: "Y" }),
        row("2026-10-06T14:00:00", { name: "Came No Close", show: "Y", closed: "N" }),
        row("2026-10-06T15:00:00", { name: "No Show", show: "N" }),
        row("2026-10-06T16:00:00", { name: "Cancelled", confirmed: "C" }),
        row("2026-08-01T12:00:00", { name: "Far Back" }), // outside the 60 days
        row("2026-10-06T17:00:00", { name: "   " }), // no lead name: not an anchor row
      ],
    ],
    [2, "Client 2", many(6, "06")],
    [3, "Client 3", many(5, "06")],
    // 4 and 5 both have 4; client 4's oldest meeting is older
    [4, "Client 4", [...many(3, "07"), row("2026-10-01T12:00:00", { name: "Oldest Four" })]],
    [5, "Client 5", many(4, "07")],
    [6, "Client 6", many(2, "06")],
    [7, "Client 7", many(1, "06")],
  ];

  beforeAll(async () => {
    await owner(db);
    for (const [n, name, rows] of clients) {
      await q(
        "INSERT INTO public.cockpit_board_clients(location_id,client_name,status,service_mode) VALUES($1,$2,'Active','DFY')",
        [csmLoc(n), name],
      );
      await sheet(csmLoc(n), name, rows);
    }
    // A client that is not Active is never asked, and neither is one with no sheet.
    await q(
      "INSERT INTO public.cockpit_board_clients(location_id,client_name,status,service_mode) VALUES($1,'Paused client','Paused','DFY'),($2,'No sheet client','Active','DFY')",
      [csmLoc(8), csmLoc(9)],
    );
    await sheet(csmLoc(8), "Paused client", many(9, "06"));
  });
  afterAll(async () => {
    await owner(db);
    await q("DELETE FROM mahara_reporting.sheet_snapshots WHERE id LIKE 'locCsmClient%'");
    await q("DELETE FROM public.cockpit_board_clients WHERE location_id LIKE 'locCsmClient%'");
  });

  test("a meeting counts after two Thursday runs and not before, and the rule reads the sheet's own cells", async () => {
    const list = await svc(DEFAULT, [NOW]);
    const c1 = list.find(r => r.location_id === csmLoc(1))!;
    // Old Two, Two Runs, Closed Blank. After Run and Recent have one run; Future is not over; the rest
    // are filled, marked no-show, cancelled, outside 60 days or have no lead name.
    expect(c1.missing_meetings).toBe(3);
    expect(c1.missing_show).toBe(2);
    expect(c1.missing_closed).toBe(1);
    expect(c1.in_first_chase).toBe(2);
    expect(c1.oldest).toBe("2026-10-06");
    expect(c1.week_key).toBe("2026-W43");
    expect(c1.meetings.map((m: Row) => m.name)).toEqual(["Old", "Two", "Closed"]);
    expect(c1.meetings.map((m: Row) => m.cell)).toEqual(["Show", "Show", "Closed"]);
    expect(c1.meetings.every((m: Row) => m.runs === 2)).toBe(true);
    // first names only
    expect(JSON.stringify(c1.meetings)).not.toContain("Runs");
    expect(JSON.stringify(c1.meetings)).not.toContain("Blank");
    // a client that is not Active, and one with no sheet, are not on the list
    expect(list.map(r => r.location_id)).not.toContain(csmLoc(8));
    expect(list.map(r => r.location_id)).not.toContain(csmLoc(9));
  });

  test("at most 5 clients a week, the most missing meetings first, the rest queued", async () => {
    const list = await svc(DEFAULT, [NOW]);
    expect(list.map(r => r.client_name)).toEqual([
      "Client 2",
      "Client 3",
      "Client 4",
      "Client 5",
      "Client 1",
      "Client 6",
      "Client 7",
    ]);
    expect(list.map(r => r.missing_meetings)).toEqual([6, 5, 4, 4, 3, 2, 1]);
    expect(list.map(r => r.rank)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(list.map(r => r.status)).toEqual(["call", "call", "call", "call", "call", "queued", "queued"]);
    // a tie on the count goes to the client whose oldest meeting is older
    expect(list[2].oldest).toBe("2026-10-01");
    const two = await svc("SELECT status FROM public.cockpit_csm_call_list($1::timestamptz, 2)", [NOW]);
    expect(two.filter(r => r.status === "call").length).toBe(2);
    expect(two.filter(r => r.status === "queued").length).toBe(5);
  });

  test("by default it counts the runs that were due and says so; with the Make store it counts the cards sent", async () => {
    const byRuns = await svc(DEFAULT, [NOW]);
    expect(new Set(byRuns.map(r => r.runs_basis))).toEqual(new Set(["scheduled_runs"]));
    expect(byRuns[0].note).toContain("Thursday runs that were due");
    // Client 1: only the 15 and 22 October cards (weeks 42 and 43) were sent.
    const sent = [`report-${csmLoc(1)}-2026-W42`, { key: `report-${csmLoc(1)}-2026-W43`, status: "sent" },
      { key: `report-${csmLoc(1)}-2026-W41`, data: { status: "pending" } }];
    const bySent = await svc(
      "SELECT * FROM public.cockpit_csm_call_list($1::timestamptz, 5, $2::jsonb)",
      [NOW, JSON.stringify(sent)],
    );
    expect(new Set(bySent.map(r => r.runs_basis))).toEqual(new Set(["sent_runs"]));
    expect(bySent[0].note ?? "").not.toContain("Thursday runs that were due");
    // Only Client 1 has sent cards, in weeks 42 and 43: Two Runs and Closed Blank were asked in both,
    // Old Two only in week 42 (its 8 October card was pending, not sent).
    expect(bySent.map(r => r.location_id)).toEqual([csmLoc(1)]);
    expect(bySent[0].missing_meetings).toBe(2);
    expect(bySent[0].meetings.map((m: Row) => m.name)).toEqual(["Two", "Closed"]);
    expect(bySent[0].in_first_chase).toBe(3);
    // an empty store: nobody was asked twice
    expect(await svc("SELECT * FROM public.cockpit_csm_call_list($1::timestamptz, 5, '[]'::jsonb)", [NOW])).toEqual([]);
  });

  test("a run that has not happened yet is not counted", async () => {
    // 22 October, 08:00 Kuwait time: that day's 10:00 run is still ahead. The runs so far are 15, 8 and 1 October.
    const early = await svc("SELECT * FROM public.cockpit_csm_call_list($1::timestamptz)", ["2026-10-22T05:00:00Z"]);
    const c1 = early.find(r => r.location_id === csmLoc(1))!;
    // Old Two (6 October) was asked on 8 and 15 October. Two Runs and Closed Blank have had one run so far.
    expect(c1.meetings.map((m: Row) => m.name)).toEqual(["Old"]);
    expect(c1.missing_meetings).toBe(1);
  });

  test("bad arguments are refused", async () => {
    await owner(db);
    await expect(q("SELECT * FROM public.cockpit_csm_call_list(now(), 0)")).rejects.toThrow(/cap of at least 1/);
    await expect(q("SELECT * FROM public.cockpit_csm_call_list(now(), 5, '{}'::jsonb)")).rejects.toThrow(/JSON array/);
  });
});

// ---------------------------------------------------------------------------
// 4. Bookings by call speed: the 20 October baseline, 1,365 paid leads.
describe("4. bookings by call speed", () => {
  beforeAll(async () => {
    await owner(db);
    // The five bands of the 20 October read: leads, booked, minutes to the first call (none for no call).
    await db.exec(`
      CREATE TEMP TABLE speed_spec AS
      SELECT * FROM (VALUES ('a',81,22,10),('b',133,33,90),('c',422,92,600),('d',326,61,2000),('e',403,69,NULL::int)) v(band,n,booked,mins);
      CREATE TEMP TABLE speed_leads AS
      SELECT row_number() OVER (ORDER BY s.band, g.k)::int AS i, s.band, s.mins, g.k <= s.booked AS is_booked
      FROM speed_spec s CROSS JOIN LATERAL generate_series(1, s.n) g(k);
      CREATE TEMP TABLE speed_created AS
      SELECT l.*, ((date_trunc('day', now() AT TIME ZONE 'Asia/Kuwait') - ((5 + l.i % 55) || ' days')::interval
                    + ((l.i % 24) || ' hours')::interval) AT TIME ZONE 'Asia/Kuwait') AS created
      FROM speed_leads l;
      INSERT INTO public.client_leads(ghl_contact_id,location_id,created_at,channel,ad_id,campaign_id,contact_name,contact_phone,deleted)
      SELECT 'S' || i, '${LOC_S}', created, 'Meta', '70500', '80500', 'Speed ' || i, '+965' || lpad(i::text, 8, '0'), false FROM speed_created;
      INSERT INTO public.appointments(ghl_appointment_id,ghl_contact_id,ghl_location_id,calendar_id,booked_at,start_at,status)
      SELECT 'SA' || i, 'S' || i, '${LOC_S}', '${CAL_MAIN}', created + interval '3 hours', created + interval '2 days', 'confirmed'
      FROM speed_created WHERE is_booked;
      INSERT INTO mahara_reporting.facts(namespace,source,kind,external_id,version_at,data)
      SELECT 'production', 'maqsam', 'call', 'speedcall' || i, now(),
        jsonb_build_object('id', 'speedcall' || i,
          'timestamp', to_char((created + (mins || ' minutes')::interval) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
          'agents', jsonb_build_array(jsonb_build_object('email', '${AGENT}')), 'duration', 60, 'ringingTime', 5,
          'type', 'outbound', 'state', 'completed', 'phone', '+965' || lpad(i::text, 8, '0'))
      FROM speed_created WHERE mins IS NOT NULL;
    `);
  });

  const WIN = "now() - interval '63 days', now()";
  const bands = async (clock = "clock") =>
    Object.fromEntries(
      (
        await svc(
          `SELECT * FROM public.cockpit_booking_by_speed(${WIN}, $1) WHERE dimension = 'speed'`,
          [clock],
        )
      ).map(r => [r.band, r]),
    );

  test("it reproduces the 20 October baseline: 27% booked within 30 minutes, 19% after 24 hours, 1,365 paid leads", async () => {
    const b = await bands();
    expect(b.all.paid_leads).toBe(1365);
    expect(b.all.bookings).toBe(277);
    expect([b.up_to_30m.paid_leads, b.up_to_30m.bookings]).toEqual([81, 22]);
    expect([b["30m_to_4h"].paid_leads, b["30m_to_4h"].bookings]).toEqual([133, 33]);
    expect([b["4h_to_24h"].paid_leads, b["4h_to_24h"].bookings]).toEqual([422, 92]);
    expect([b.over_24h.paid_leads, b.over_24h.bookings]).toEqual([326, 61]);
    expect([b.no_call.paid_leads, b.no_call.bookings]).toEqual([403, 69]);
    expect(Number(b.up_to_30m.bookings_per_100)).toBe(27.2);
    expect(Number(b["30m_to_4h"].bookings_per_100)).toBe(24.8);
    expect(Number(b["4h_to_24h"].bookings_per_100)).toBe(21.8);
    expect(Number(b.over_24h.bookings_per_100)).toBe(18.7);
    expect(Number(b.no_call.bookings_per_100)).toBe(17.1);
    // the same figures in the 20 October basis (any appointment) here, as every booking is a main-calendar one
    expect(b.up_to_30m.bookings_any).toBe(22);
    // sorted by speed, with the total last
    const order = (
      await svc(`SELECT band FROM public.cockpit_booking_by_speed(${WIN}, 'clock') WHERE dimension = 'speed' ORDER BY band_order`)
    ).map(r => r.band);
    expect(order).toEqual(["up_to_30m", "30m_to_4h", "4h_to_24h", "over_24h", "no_call", "all"]);
    expect(b.up_to_30m.note).toContain("Correlation only");
  });

  test("by arrival hour and by country, and every dimension adds up to the same paid leads", async () => {
    const rows = await svc(`SELECT * FROM public.cockpit_booking_by_speed(${WIN}, 'clock')`);
    const hours = rows.filter(r => r.dimension === "arrival_hour" && r.band === "all");
    expect(hours.length).toBe(24);
    expect(hours.reduce((a, r) => a + r.paid_leads, 0)).toBe(1365);
    expect(hours.reduce((a, r) => a + r.bookings, 0)).toBe(277);
    expect(hours[0].key).toBe("00");
    expect(hours[23].key).toBe("23");
    const countries = rows.filter(r => r.dimension === "country" && r.band === "all");
    expect(countries.map(r => [r.key, r.paid_leads])).toEqual([["KW", 1365]]);
    // each hour splits into the same bands
    const h9 = rows.filter(r => r.dimension === "arrival_hour" && r.key === "09" && r.band !== "all");
    expect(h9.reduce((a, r) => a + r.paid_leads, 0)).toBe(hours.find(r => r.key === "09")!.paid_leads);
  });

  test("the lead rows carry both clocks: working minutes are never more than the wall clock", async () => {
    const leads = await svc(`SELECT * FROM public.cockpit_speed_leads(${WIN})`);
    expect(leads.length).toBe(1365);
    const called = leads.filter(l => l.first_call_at !== null);
    expect(called.length).toBe(962);
    expect(called.every(l => l.working_minutes !== null && Number(l.working_minutes) <= Number(l.clock_minutes))).toBe(true);
    expect(leads.filter(l => l.first_call_at === null).every(l => l.clock_minutes === null)).toBe(true);
    // no lead name, phone number or email leaves the function
    expect(Object.keys(leads[0]).some(k => /name|phone|email/i.test(k))).toBe(false);
    const w = await bands("working");
    expect(w.all.paid_leads).toBe(1365);
    const total = Object.entries(w).filter(([k]) => k !== "all").reduce((a, [, r]) => a + r.paid_leads, 0);
    expect(total).toBe(1365);
    // working minutes can only make a call faster
    expect(w.up_to_30m.paid_leads).toBeGreaterThanOrEqual(81);
  });

  test("a lead created in the last 3 days is left out, and a provisional, cancelled or Google booking is not counted", async () => {
    await owner(db);
    // A window of its own: leads created 70 to 75 days ago.
    await db.exec(`
      INSERT INTO public.client_leads(ghl_contact_id,location_id,created_at,channel,ad_id,campaign_id,contact_name,contact_phone,deleted) VALUES
       ('X1','${LOC_S}', now() - interval '72 days', 'Meta', '70500', '80500', 'X1', '+96560000001', false),
       ('X2','${LOC_S}', now() - interval '72 days', 'Meta', '70500', '80500', 'X2', '+96560000002', false),
       ('X3','${LOC_S}', now() - interval '72 days', 'Meta', '70500', '80500', 'X3', '+966500000003', false),
       ('X4','${LOC_S}', now() - interval '72 days', 'Meta', '70500', '80500', 'X4', '+96560000004', false),
       ('X5','${LOC_S}', now() - interval '72 days', 'Meta', '70500', '80500', 'X5', '+96560000005', false),
       ('X6','${LOC_S}', now() - interval '72 days', 'Meta', NULL, NULL, 'X6', '+96560000006', false),
       ('X7','${LOC_S}', now() - interval '72 days', 'Meta', '70500', '80500', 'X7', '+96560000007', true),
       ('X8','${LOC_S}', now() - interval '1 day', 'Meta', '70500', '80500', 'X8', '+96560000008', false);
      INSERT INTO public.appointments(ghl_appointment_id,ghl_contact_id,ghl_location_id,calendar_id,booked_at,start_at,status,ghl_source) VALUES
       ('XA1','X1','${LOC_S}','${CAL_PROV}', now() - interval '71 days', now() - interval '70 days', 'confirmed', NULL),
       ('XA2','X2','${LOC_S}','${CAL_MAIN}', now() - interval '71 days', now() - interval '70 days', 'cancelled', NULL),
       ('XA3','X3','${LOC_S}','${CAL_MAIN}', now() - interval '71 days', now() - interval '70 days', 'confirmed', 'google_calendar'),
       ('XA4','X4','${LOC_S}','${CAL_MAIN}', now() - interval '73 days', now() - interval '70 days', 'confirmed', NULL),
       ('XA5','X5','${LOC_S}','${CAL_MAIN}', now() - interval '71 days', now() - interval '70 days', 'confirmed', NULL);
    `);
    const leads = await svc(
      "SELECT * FROM public.cockpit_speed_leads(now() - interval '80 days', now() - interval '66 days')",
    );
    const byId = Object.fromEntries(leads.map(l => [l.contact_id, l]));
    // X6 (no ad), X7 (deleted) and X8 (too new, and outside the window) are left out.
    expect(Object.keys(byId).filter(k => k.startsWith("X")).sort()).toEqual(["X1", "X2", "X3", "X4", "X5"]);
    const flags = (id: string) => [byId[id].booked, byId[id].booked_any];
    expect(flags("X1")).toEqual([false, true]); // provisional calendar: not counted
    expect(flags("X2")).toEqual([false, true]); // cancelled: not counted
    expect(flags("X3")).toEqual([false, true]); // Google Calendar copy: not counted
    expect(flags("X4")).toEqual([false, false]); // booked before the lead existed
    expect(flags("X5")).toEqual([true, true]);
    expect(byId.X3.country).toBe("SA");
    expect(byId.X5.country).toBe("KW");
    // The settle time: asking for the last 10 days still leaves out leads from the last 3 days.
    const recent = await svc("SELECT * FROM public.cockpit_speed_leads(now() - interval '10 days', now())");
    expect(recent.some(l => l.contact_id === "X8")).toBe(false);
    expect(recent.every(l => new Date(l.created_at).getTime() <= Date.now() - 3 * DAY)).toBe(true);
    // The country rows follow the window.
    const c = await svc(
      "SELECT key, paid_leads FROM public.cockpit_booking_by_speed(now() - interval '80 days', now() - interval '66 days') WHERE dimension = 'country' AND band = 'all' ORDER BY key",
    );
    expect(c.map(r => [r.key, r.paid_leads])).toEqual([["KW", 4], ["SA", 1]]);
    // An empty window is an empty answer, never a division by zero.
    expect(await svc("SELECT * FROM public.cockpit_booking_by_speed(now() - interval '300 days', now() - interval '290 days')")).toEqual([]);
  });

  test("bad arguments are refused", async () => {
    await owner(db);
    await expect(q("SELECT * FROM public.cockpit_booking_by_speed(now(), now() - interval '1 day')")).rejects.toThrow(/first time before the last/);
    await expect(q("SELECT * FROM public.cockpit_booking_by_speed(now() - interval '5 days', now(), 'lunar')")).rejects.toThrow(/clock or working/);
  });

  test("the band of one call", async () => {
    const [x] = await svc(
      `SELECT public.cockpit_speed_band(30,true) a, public.cockpit_speed_band(30.1,true) b, public.cockpit_speed_band(240,true) c,
              public.cockpit_speed_band(1440,true) d, public.cockpit_speed_band(1440.1,true) e, public.cockpit_speed_band(NULL,false) f,
              public.cockpit_speed_band(NULL,true) g`,
    );
    expect([x.a, x.b, x.c, x.d, x.e, x.f, x.g]).toEqual([
      "up_to_30m",
      "30m_to_4h",
      "30m_to_4h",
      "4h_to_24h",
      "over_24h",
      "no_call",
      "clock_unknown",
    ]);
  });
});

// ---------------------------------------------------------------------------
// 5. The morning uncalled list
describe("5. the morning uncalled list", () => {
  const phoneU = (n: number) => `+9657000${String(n).padStart(4, "0")}`;
  const call = async (id: string, startedAt: string, phone: string, extra: Row = {}) =>
    q(
      "INSERT INTO mahara_reporting.facts(namespace,source,kind,external_id,version_at,data) VALUES('production','maqsam','call',$1,now(),$2::jsonb)",
      [
        id,
        JSON.stringify({
          id,
          timestamp: startedAt,
          agents: [{ email: extra.agent ?? AGENT }],
          duration: 60,
          ringingTime: 5,
          type: extra.type ?? "outbound",
          state: "completed",
          phone,
        }),
      ],
    );
  const attempt = async (id: string, contact: string, extra: Row = {}) =>
    q(
      "INSERT INTO mahara_console.attempts VALUES('production',$1,$2,$3,'closed',$4::jsonb,$5)",
      [
        id,
        `${LOC_U}:${contact}`,
        AGENT,
        JSON.stringify({
          locationId: LOC_U,
          contactId: contact,
          mode: "outcome",
          callId: extra.callId ?? null,
          dispositionSavedAt: ms(extra.at ?? kt(3, "11:00")),
          disposition: { outcome: extra.outcome ?? "NO ANSWER", note: "Rang, no answer" },
        }),
        ms(extra.at ?? kt(3, "11:00")),
      ],
    );

  beforeAll(async () => {
    await owner(db);
    // U1 a caller-linked call, U2 a call joined by its number only, U3a and U3b one number shared by two leads,
    // U4 a saved outcome and no call, U5 and U6 nothing (U6 is a paid lead), U7 a WhatsApp chat, U8 a number
    // outside the Gulf, U9 a lead that arrived a minute ago.
    await lead("U1", LOC_U, kt(12, "10:00"), { ad: "70600", campaign: "80600", name: "Una Family", phone: phoneU(1) });
    await lead("U2", LOC_U, kt(12, "11:00"), { ad: "70600", campaign: "80600", name: "Umm Family", phone: phoneU(2) });
    await lead("U3a", LOC_U, kt(11, "10:00"), { name: "Uthman A", phone: phoneU(3), channel: "Other" });
    await lead("U3b", LOC_U, kt(11, "11:00"), { name: "Uthman B", phone: phoneU(3), channel: "Other" });
    await lead("U4", LOC_U, kt(10, "10:00"), { ad: "70600", campaign: "80600", name: "Umar Family", phone: phoneU(4) });
    await lead("U5", LOC_U, kt(10, "11:00"), { name: "Uzma Family", phone: phoneU(5), channel: "Other" });
    await lead("U6", LOC_U, kt(9, "10:00"), { ad: "70600", campaign: "80600", name: "Usama Family", phone: phoneU(6) });
    await lead("U7", LOC_U, kt(9, "11:00"), { name: "Chat Family", phone: phoneU(7), channel: "WhatsApp" });
    await lead("U8", LOC_U, kt(9, "12:00"), { name: "Far Family", phone: "+919876543210", channel: "Other" });
    await lead("U9", LOC_U, new Date(Date.now() - 60_000).toISOString(), { ad: "70600", campaign: "80600", name: "New Family", phone: phoneU(9) });
    // U7 is a WhatsApp chat: no ad, no campaign and the CRM tags it inbound whatsapp.
    await q(
      "INSERT INTO mahara_reporting.facts(namespace,source,kind,external_id,version_at,data) VALUES('production','ghl','contact',$1,now(),$2::jsonb)",
      [`${LOC_U}:U7`, JSON.stringify({ id: "U7", locationId: LOC_U, tags: ["Inbound WhatsApp"] })],
    );
    await call("uc1", kt(12, "10:30"), phoneU(1));
    await attempt("UT1", "U1", { callId: "uc1", at: kt(12, "10:35") });
    await call("uc2", kt(12, "11:30"), phoneU(2));
    await call("uc3", kt(11, "12:00"), phoneU(3));
    await attempt("UT4", "U4", { at: kt(10, "10:30"), outcome: "CALLBACK" });
    await refreshFacts();
  });

  const refreshFacts = async () => {
    await owner(db);
    const r = await one("SELECT public.cockpit_board_facts_refresh($1::date,$2::date) AS r", [FROM, today]);
    expect(r.ok).toBe(true);
  };

  test("each callable lead is in one group: exact call, phone only, outcome only or never called", async () => {
    const cohort = await svc("SELECT * FROM public.cockpit_uncalled_cohort($1)", [LOC_U]);
    const g = Object.fromEntries(cohort.map(r => [r.contact_id, r]));
    // U7 (chat), U8 (not a Gulf number) and U9 (a minute old) are not callable leads.
    expect(Object.keys(g).sort()).toEqual(["U1", "U2", "U3a", "U3b", "U4", "U5", "U6"]);
    expect(g.U1.grp).toBe("exact");
    expect(g.U1.call_evidence).toBe("call_id");
    expect(g.U2.grp).toBe("phone_only");
    expect(g.U2.call_evidence).toBe("unique_phone_match");
    expect(g.U3a.grp).toBe("phone_only");
    expect(g.U3a.call_evidence).toBe("same_phone_other_lead");
    expect(g.U3b.grp).toBe("phone_only");
    expect(g.U4.grp).toBe("outcome_only");
    expect(g.U4.last_outcome).toBe("CALLBACK");
    expect(g.U4.last_attempt_at).not.toBeNull();
    expect(g.U5.grp).toBe("never_called");
    expect(g.U6.grp).toBe("never_called");
    expect([g.U2.paid, g.U3a.paid, g.U4.paid, g.U5.paid, g.U6.paid]).toEqual([true, false, true, false, true]);
    expect(g.U2.phone_last4).toBe("0002");
    expect(g.U2.first_name).toBe("Umm");
    expect(Number(g.U5.hours_waiting)).toBeGreaterThan(200);
    expect(g.U5.contact_url).toBe(`https://app.gohighlevel.com/v2/location/${LOC_U}/contacts/detail/U5`);
  });

  test("the list is the leads with no call linked to them, oldest first", async () => {
    const list = await svc("SELECT * FROM public.cockpit_morning_uncalled($1)", [LOC_U]);
    expect(list.map(r => r.contact_id)).toEqual(["U2", "U3a", "U3b", "U4", "U5", "U6"]);
    expect(list.map(r => r.grp)).toEqual(["phone_only", "phone_only", "phone_only", "outcome_only", "never_called", "never_called"]);
    expect(Object.keys(list[0]).some(k => /^(phone|email|contact_name)$/i.test(k))).toBe(false);
  });

  test("the groups add up to the board's own uncalled total", async () => {
    const [s] = await svc("SELECT * FROM public.cockpit_morning_uncalled_summary($1)", [LOC_U]);
    expect([s.callable, s.exact, s.phone_only, s.outcome_only, s.never_called]).toEqual([7, 1, 3, 1, 2]);
    expect(s.exact + s.phone_only + s.outcome_only + s.never_called).toBe(s.callable);
    expect(s.uncalled_strict).toBe(6);
    expect(s.uncalled_paid).toBe(3); // U2, U4 and U6 carry an ad
    // the board's stored counts, after its refresh
    expect([s.board_callable, s.board_verified, s.board_outcome_only, s.board_untouched]).toEqual([7, 4, 1, 2]);
    expect(s.never_called).toBe(s.board_untouched);
    expect(s.outcome_only).toBe(s.board_outcome_only);
    expect(s.exact + s.phone_only).toBe(s.board_verified);
    expect(s.matches_board).toBe(true);
    // the board's own "uncalled" (callable less verified) is the never-called and outcome-only leads
    expect(s.board_callable - s.board_verified).toBe(s.never_called + s.outcome_only);
  });

  test("across every Active client the groups equal the board for each client it holds a row for", async () => {
    const all = await svc("SELECT * FROM public.cockpit_morning_uncalled_summary()");
    expect(all.map(r => r.location_id)).toContain(LOC_U);
    // done with you is left out, as on the board
    expect(all.map(r => r.location_id)).not.toContain(LOC_B);
    for (const r of all) {
      expect(r.exact + r.phone_only + r.outcome_only + r.never_called).toBe(r.callable);
      if (r.matches_board !== null) expect(r.matches_board).toBe(true);
    }
  });
});
