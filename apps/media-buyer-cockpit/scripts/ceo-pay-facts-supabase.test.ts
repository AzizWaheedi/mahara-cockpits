/**
 * The pay facts (migration 20261018b_ceo_pay_facts.sql, contract
 * docs/pay/PAY-PLANS.md sections 4.1-4.4, 5.2 and 9) on an isolated
 * PostgreSQL, over stub source tables: the call centre (method B), ads, the
 * clients' churn and qualifying counts, and the closer's deal cash.
 *
 * The stubs carry the live columns the functions read (Creative Triage,
 * 2026-10-18); cockpit_pay_entries, cockpit_pay_confirmations and
 * cockpit_deal_payments carry the contract's columns (20261018a, 20261018c).
 * cockpit_board_calendar_kind is the board migration's own definition. Every
 * person, client, contact, deal and payment here is made up.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import { cockpitTestDb, migration, owner } from "./lib/cockpitTestDb";

const SQL = migration("20261018b_ceo_pay_facts.sql");
const CALENDAR_KIND = (() => {
  const hit = migration("20261016111157_board_facts.sql").match(
    /CREATE OR REPLACE FUNCTION public\.cockpit_board_calendar_kind\(p_name text\)[\s\S]*?\$\$;/,
  );
  if (!hit) throw new Error("cockpit_board_calendar_kind definition missing");
  return hit[0];
})();

const STUBS = `
CREATE SCHEMA mahara_reporting; CREATE SCHEMA mahara_console; CREATE SCHEMA portal_data;
CREATE TABLE public.cockpit_people(id bigserial PRIMARY KEY, name text, email text, role text, active boolean DEFAULT true, ended_on date);
CREATE TABLE public.ghl_clients(location_id text PRIMARY KEY, client_name text, country text);
CREATE TABLE public.client_leads(ghl_contact_id text, location_id text, contact_phone text, deleted boolean DEFAULT false);
CREATE TABLE public.appointments(ghl_appointment_id text PRIMARY KEY, ghl_contact_id text, ghl_location_id text, ghl_location text,
  calendar_id text, booked_at timestamptz, start_at timestamptz, status text, attended boolean, ghl_source text);
CREATE TABLE public.ghl_calendars(location_id text, calendar_id text, name text, synced_at timestamptz DEFAULT now());
CREATE TABLE mahara_reporting.facts(namespace text, source text, kind text, external_id text, data jsonb, conflict boolean DEFAULT false);
CREATE TABLE mahara_reporting.sheet_snapshots(namespace text, id text, sheet_id text, data jsonb);
CREATE TABLE mahara_console.attempts(namespace text, id text, agent text, data jsonb);
CREATE TABLE portal_data.appointments(location_id text, appointment_id text, contact_id text, assigned_agent text, source text,
  source_updated_at timestamptz, PRIMARY KEY(location_id, appointment_id));
CREATE TABLE portal_data.appointment_outcomes(location_id text, appointment_id text, revision bigint, attendance text, deal text,
  project_value numeric, currency text);
CREATE TABLE public.call_report(callers jsonb);
CREATE FUNCTION public.mahara_call_center_report(p_from date, p_to date, p_agent text, p_client text) RETURNS jsonb
LANGUAGE plpgsql STABLE AS $$
BEGIN
  IF p_to > (now() AT TIME ZONE 'Asia/Kuwait')::date THEN RAISE EXCEPTION 'Choose a valid date range of up to 93 days'; END IF;
  RETURN jsonb_build_object('callers', (SELECT callers FROM public.call_report LIMIT 1), 'from', p_from, 'to', p_to);
END $$;
CREATE TABLE public.cockpit_csm_sources(table_name text, source_id text, data jsonb, source_snapshot_at timestamptz DEFAULT now());
CREATE TABLE public.cockpit_board_clients(location_id text PRIMARY KEY, clickup_id text, client_name text, service_mode text,
  ad_account_ids text[] DEFAULT '{}', tiktok boolean DEFAULT false);
CREATE TABLE public.cockpit_meta_ad_days(account_id text, account_timezone text, day date, ad_id text, spend numeric, spend_usd numeric, leads bigint);
CREATE TABLE public.cockpit_client_days(location_id text, day date, confirmed_bookings integer, PRIMARY KEY(location_id, day));
CREATE TABLE public.cockpit_client_billing_days(day date, clickup_task_id text, next_payment_date date, paused_on date, churn_type text,
  PRIMARY KEY(day, clickup_task_id));
CREATE TABLE public.cockpit_creative_sources(table_name text, source_id text, data jsonb, source_snapshot_at timestamptz DEFAULT now());
CREATE TABLE public.cockpit_pay_entries(id bigserial PRIMARY KEY, person_id bigint, month date, part_key text, quantity numeric,
  cash_usd numeric, amount_usd numeric, client text, cleared_on date, entered_by text, voided_at timestamptz);
CREATE TABLE public.cockpit_pay_confirmations(id bigserial PRIMARY KEY, month date NOT NULL, key text NOT NULL, value jsonb NOT NULL,
  note text, set_by text NOT NULL, set_at timestamptz NOT NULL DEFAULT now(), UNIQUE(month, key));
CREATE TABLE public.cockpit_deal_payments(payment_id text PRIMARY KEY, deal_response_id text NOT NULL, day date NOT NULL, usd numeric NOT NULL,
  rail text NOT NULL, kind text NOT NULL CHECK (kind IN ('deposit','remainder')), matched_by text NOT NULL, tie_id bigint, payer text,
  active boolean NOT NULL DEFAULT true, source_refresh_id uuid, recorded_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.cockpit_sales_deals(response_id text PRIMARY KEY, submitted_at timestamptz, closer text, setter text, contact_id text,
  client_name text, business_name text, phone8 text, payment_structure text, cash_collected numeric, contracted_revenue numeric, voided boolean DEFAULT false);
CREATE TABLE public.cockpit_sales_reps(id uuid PRIMARY KEY, display_name text, ghl_user_id text, closer_aliases text[]);
CREATE TABLE public.cockpit_sales_people(email text PRIMARY KEY, b2b_rep_id uuid);
CREATE TABLE public.cockpit_sales_appointments(appointment_id text PRIMARY KEY, contact_id text, calendar_id text, call_type text,
  start_at timestamptz, status text, assigned_user_id text, assigned_user_name text);
CREATE TABLE public.cockpit_sales_leads(contact_id text PRIMARY KEY, phone8 text);
CREATE TABLE public.cockpit_sales_settings(key text PRIMARY KEY, value jsonb);
CREATE TABLE public.cockpit_sales_rooms(id bigserial PRIMARY KEY, count_appointment_id text, count_result text);
CREATE TABLE public.cockpit_sections(key text PRIMARY KEY, computed_at timestamptz, payload jsonb);
-- cockpit_pay_plan_for (20261018a), stubbed: each person's plan parts from a test table, none without a row.
CREATE TABLE public.test_plan_parts(person_id bigint PRIMARY KEY, parts jsonb NOT NULL);
CREATE FUNCTION public.cockpit_pay_plan_for(p_person bigint, p_month date) RETURNS jsonb LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT CASE WHEN t.parts IS NULL THEN jsonb_build_object('source', 'none', 'plan', NULL)
              ELSE jsonb_build_object('source', 'own', 'plan', jsonb_build_object('version', 1, 'parts', t.parts)) END
    FROM (SELECT (SELECT x.parts FROM public.test_plan_parts AS x WHERE x.person_id = p_person) AS parts) AS t
$$;
`;

const LOC_A = "locPayClientA";
const LOC_B = "locPayClientB";
const LOC_C = "locPayClientC";
const LOC_E = "locPayClientE";
const LOC_G = "locPayClientG";
const AGENT1 = "agent1@example.test";
const AGENT2 = "agent2@example.test";
const REP_CLOSER = "00000000-0000-4000-8000-00000000c105";
const REP_SETTER = "00000000-0000-4000-8000-00000000c5e7";
const MONTH = "2026-09-01";
const MONTH_END = "2026-09-30";

/** A Kuwait wall time on a September day: kw("05", "11:00"). */
const kw = (dd: string, hhmm: string, mm = "09") =>
  `2026-${mm}-${dd}T${hhmm}:00+03:00`;
const ms = (iso: string) => Date.parse(iso);
const kuwaitToday = new Date(Date.now() + 3 * 3600_000)
  .toISOString()
  .slice(0, 10);

let db: PGlite;

async function q<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
) {
  return (await db.query<T>(sql, params)).rows;
}
async function facts(fn: string, ...args: unknown[]): Promise<any> {
  const marks = args.map((_, i) => `$${i + 1}`).join(", ");
  const [row] = await q<{ f: unknown }>(
    `SELECT public.${fn}(${marks}) AS f`,
    args,
  );
  return row.f;
}

async function appt(
  id: string,
  loc: string,
  contact: string,
  cal: string,
  start: string,
  status: string,
  o: {
    booked?: string;
    attended?: boolean | null;
    source?: string | null;
  } = {},
) {
  await q(
    `INSERT INTO public.appointments(ghl_appointment_id,ghl_contact_id,ghl_location_id,calendar_id,booked_at,start_at,status,attended,ghl_source)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      id,
      contact,
      loc,
      cal,
      o.booked ?? kw("01", "09:00"),
      start,
      status,
      o.attended ?? null,
      o.source ?? "third_party",
    ],
  );
}
async function attempt(
  id: string,
  agent: string | null,
  data: Record<string, unknown>,
) {
  await q("INSERT INTO mahara_console.attempts VALUES('production',$1,$2,$3)", [
    id,
    agent,
    JSON.stringify(data),
  ]);
}
const booked = (loc: string, apptId: string) => ({
  locationId: loc,
  appointmentId: apptId,
  disposition: { outcome: "BOOKED" },
  bookingVerification: { id: apptId, verifiedAt: "2026-09-01T06:00:00Z" },
});
async function roster(day: string, clients: [string, string, string][]) {
  await q(
    "INSERT INTO public.cockpit_csm_sources(table_name,source_id,data) VALUES('rosterDays',$1,$2)",
    [
      `roster:${day}`,
      JSON.stringify({
        day,
        clients: clients.map(([key, name, status]) => ({
          key,
          name,
          status,
          paying: true,
        })),
      }),
    ],
  );
}
async function card(
  taskId: string,
  name: string,
  csm: string | null,
  launchDate: string | null,
) {
  const data: Record<string, unknown> = { taskId, name };
  if (csm) data.csmAssigned = csm;
  if (launchDate) data.launchDate = launchDate;
  await q(
    "INSERT INTO public.cockpit_csm_sources(table_name,source_id,data) VALUES('clients',$1,$2)",
    [`card:${taskId}`, JSON.stringify(data)],
  );
}
async function adDay(
  account: string,
  day: string,
  spend: number,
  usd: number | null,
  leads: number | null,
) {
  await q(
    "INSERT INTO public.cockpit_meta_ad_days(account_id,day,ad_id,spend,spend_usd,leads) VALUES($1,$2,$3,$4,$5,$6)",
    [account, day, `ad-${account}`, spend, usd, leads],
  );
}
/** One client_days row per September day, except those in `skip`; bookings by day. */
async function bookingDays(
  loc: string,
  byDay: Record<string, number> = {},
  skip: string[] = [],
) {
  for (let d = 1; d <= 30; d++) {
    const day = `2026-09-${String(d).padStart(2, "0")}`;
    if (skip.includes(day)) continue;
    await q(
      "INSERT INTO public.cockpit_client_days(location_id,day,confirmed_bookings) VALUES($1,$2,$3)",
      [loc, day, byDay[day] ?? 0],
    );
  }
}
async function deal(
  id: string,
  signed: string,
  o: {
    closer?: string | null;
    setter?: string | null;
    contact?: string | null;
    phone8?: string | null;
    plan?: string;
    contracted?: number;
    deposit?: number;
    voided?: boolean;
  },
) {
  await q(
    `INSERT INTO public.cockpit_sales_deals(response_id,submitted_at,closer,setter,contact_id,client_name,business_name,phone8,payment_structure,
       cash_collected,contracted_revenue,voided) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [
      id,
      signed,
      o.closer ?? null,
      o.setter ?? null,
      o.contact ?? null,
      `Contact ${id}`,
      `Business ${id}`,
      o.phone8 ?? null,
      o.plan ?? "Paid in full ($6,000)",
      o.deposit ?? 500,
      o.contracted ?? 6000,
      o.voided ?? false,
    ],
  );
}
async function dealPay(
  id: string,
  dealId: string,
  day: string,
  usd: number,
  kind = "remainder",
  matchedBy = "whop_link",
) {
  await q(
    "INSERT INTO public.cockpit_deal_payments(payment_id,deal_response_id,day,usd,rail,kind,matched_by,payer) VALUES($1,$2,$3,$4,'whop',$5,$6,'Payer')",
    [id, dealId, day, usd, kind, matchedBy],
  );
}

beforeAll(async () => {
  db = await cockpitTestDb({ supabaseDefaultPrivileges: true });
  await db.exec(STUBS);
  await db.exec(CALENDAR_KIND);
  await db.exec(SQL);
  await owner(db);

  // ---- people
  await db.exec(`
    INSERT INTO public.cockpit_people(id,name,email,role,active,ended_on) VALUES
     (1,'Agent One','${AGENT1}','Call centre agent',true,NULL),
     (2,'Agent Two','${AGENT2}','Call centre agent',true,NULL),
     (3,'Closer One','closer1@example.test','Closer',true,NULL),
     (4,'Setter One','setter1@example.test','B2B setter',false,'2026-09-20'),
     (5,'Success One','csm1@example.test','Client success manager',true,NULL),
     (6,'Sami Ward','creative1@example.test','Creative strategist',true,NULL);
  `);

  // ---- call centre: two clients, their calendars, leads and the sheet
  await db.exec(`
    INSERT INTO public.ghl_clients VALUES ('${LOC_A}','Client A','KW'),('${LOC_B}','Client B','KW');
    INSERT INTO public.ghl_calendars(location_id,calendar_id,name) VALUES
     ('${LOC_A}','calMainA','Main Appointment Calendar'),('${LOC_A}','calProvA','Not Confirmed Appointments'),
     ('${LOC_A}','calCbA','Callback Calendar'),('${LOC_B}','calMainB','Main Appointment Calendar');
    INSERT INTO public.client_leads(ghl_contact_id,location_id,contact_phone) VALUES
     ('cA3','${LOC_A}','+965 5000 0003'),('cB10','${LOC_B}','50000010');
  `);
  // Agent One: a dialer receipt (A1), a client-sheet caller (A3), a reschedule
  // walked back to its booking (A5), a portal win (A9) on A3's contact, a
  // provisional meeting nobody marked (A13).
  await appt("A1", LOC_A, "cA1", "calMainA", kw("05", "11:00"), "showed", {
    booked: kw("01", "10:00"),
  });
  await attempt("t1", AGENT1, booked(LOC_A, "A1"));
  await appt("A3", LOC_A, "cA3", "calMainA", kw("07", "13:00"), "confirmed", {
    booked: kw("03", "10:00"),
  });
  await appt("A5o", LOC_A, "cA5", "calMainA", kw("09", "10:00"), "cancelled", {
    booked: kw("02", "10:00"),
  });
  await attempt("t5", AGENT1, booked(LOC_A, "A5o"));
  await appt("A5", LOC_A, "cA5", "calMainA", kw("10", "10:00"), "noshow", {
    booked: kw("08", "10:00"),
  });
  await attempt("t5r", AGENT2, {
    locationId: LOC_A,
    appointmentId: "A5",
    originalAppointmentId: "A5o",
    disposition: { outcome: "RESCHEDULE" },
  });
  await appt("A9", LOC_A, "cA3", "calMainA", kw("20", "12:00"), "showed", {
    booked: kw("15", "10:00"),
  });
  await attempt("t9", AGENT1, booked(LOC_A, "A9"));
  await appt("A13", LOC_A, "cA13", "calProvA", kw("21", "12:00"), "confirmed", {
    booked: kw("16", "10:00"),
  });
  // Agent Two: a central-sheet caller with the portal's show (A2), a receipt
  // nobody marked (A4), a receipt and a portal win (A7), a client-sheet close (A10).
  await appt("A2", LOC_A, "cA2", "calMainA", kw("06", "12:00"), "confirmed", {
    booked: kw("02", "11:00"),
  });
  await appt("A4", LOC_A, "cA4", "calMainA", kw("08", "10:00"), "confirmed", {
    booked: kw("04", "11:00"),
  });
  await attempt("t4", AGENT2, booked(LOC_A, "A4"));
  await appt("A7", LOC_B, "cB7", "calMainB", kw("15", "10:00"), "showed", {
    booked: kw("10", "11:00"),
  });
  await attempt("t7", AGENT2, booked(LOC_B, "A7"));
  await appt("A10", LOC_B, "cB10", "calMainB", kw("18", "16:00"), "showed", {
    booked: kw("12", "11:00"),
  });
  // Nobody can be credited: two agents claim A6, A15's central caller is on no
  // team list, A17 was booked by someone not on cockpit_people.
  await appt("A6", LOC_B, "cB6", "calMainB", kw("12", "10:00"), "showed", {
    booked: kw("05", "11:00"),
  });
  await attempt("t6a", AGENT1, booked(LOC_B, "A6"));
  await attempt("t6b", AGENT2, booked(LOC_B, "A6"));
  await appt("A15", LOC_B, "cB15", "calMainB", kw("22", "10:00"), "confirmed", {
    booked: kw("14", "11:00"),
  });
  await appt("A17", LOC_B, "cB17", "calMainB", kw("23", "10:00"), "showed", {
    booked: kw("14", "12:00"),
  });
  await attempt("t17", "outsider@example.test", booked(LOC_B, "A17"));
  // Never due: a Google Calendar copy, a callback, an October meeting.
  await appt("A11", LOC_A, "cA1", "calMainA", kw("05", "11:00"), "showed", {
    source: "google_calendar",
  });
  await appt("A12", LOC_A, "cA12", "calCbA", kw("06", "15:00"), "showed");
  await appt(
    "A16",
    LOC_A,
    "cA16",
    "calMainA",
    kw("02", "10:00", "10"),
    "showed",
    { booked: kw("20", "10:00") },
  );
  await db.exec(`
    INSERT INTO portal_data.appointments(location_id,appointment_id,contact_id,assigned_agent,source) VALUES
     ('${LOC_A}','A2','cA2','Agent Two','central-appointments'),
     ('${LOC_A}','A13','cA13','agent one','central-appointments'),
     ('${LOC_B}','A15','cB15','Someone Else','central-appointments');
    INSERT INTO portal_data.appointment_outcomes VALUES
     ('${LOC_A}','A2',1,'showed','pending',NULL,NULL),
     ('${LOC_A}','A9',1,'showed','pending',NULL,NULL),
     ('${LOC_A}','A9',2,'showed','won',2000,'USD'),
     ('${LOC_B}','A7',1,'showed','won',1000,'KWD');
  `);
  await q(
    "INSERT INTO mahara_reporting.sheet_snapshots VALUES('production',$1,'sheetA',$2),('production',$3,'sheetB',$4)",
    [
      LOC_A,
      JSON.stringify({
        sheetId: "sheetA",
        currency: "USD",
        rows: [
          {
            caller: "Agent One",
            phone: "50000003",
            meeting: String(ms(kw("07", "13:00"))),
            show: "Y",
            closed: "Y",
            value: "5000",
          },
        ],
      }),
      LOC_B,
      JSON.stringify({
        sheetId: "sheetB",
        currency: "USD",
        rows: [
          {
            caller: "Agent Two",
            phone: "50000010",
            meeting: String(ms(kw("18", "16:00"))),
            show: "Y",
            closed: "Y",
            value: "300",
          },
        ],
      }),
    ],
  );
  await q("INSERT INTO public.call_report VALUES($1)", [
    JSON.stringify([
      { name: "Agent One", email: AGENT1, shows: 2, closed: 1, noShow: 1 },
    ]),
  ]);

  // ---- ads and clients: the roster, the cards, the board
  const A: [string, string, string] = ["KA", "Client A", "Active"];
  const B: [string, string, string] = ["KB", "Client B", "Active"];
  const C: [string, string, string] = ["KC", "Client C", "Active"];
  const D: [string, string, string] = ["KD", "Client D", "Active"];
  const E: [string, string, string] = ["KE", "Client E", "Active"];
  const G: [string, string, string] = ["KG", "Client G", "Active"];
  const H: [string, string, string] = ["KH", "Client H", "Active"];
  await roster("2026-08-31", [
    A,
    B,
    C,
    D,
    E,
    G,
    H,
    ["KF", "Client F", "Paused"],
    ["KI", "Client I", "Active"],
    ["KP", "Client P", "Active"],
  ]);
  await roster("2026-09-09", [
    A,
    B,
    C,
    D,
    E,
    G,
    H,
    ["KF", "Client F", "Paused"],
    ["KI", "Client I", "Active"],
    ["KP", "Client P", "Paused"],
    ["KJ", "Client J", "Onboarding"],
  ]);
  await roster("2026-09-20", [
    A,
    B,
    C,
    D,
    E,
    G,
    H,
    ["KF", "Client F", "Stopped"],
    ["KI", "Client I", "Stopped"],
    ["KP", "Client P", "Paused"],
    ["KJ", "Client J", "Onboarding"],
  ]);
  await roster("2026-09-30", [
    A,
    B,
    C,
    D,
    E,
    G,
    H,
    ["KF", "Client F", "Stopped"],
    ["KI", "Client I", "Stopped"],
    ["KP", "Client P", "Paused"],
    ["KJ", "Client J", "Stopped"],
  ]);
  await card("KA", "Client A", "Success One", "2026-09-10");
  await card("KB", "Client B", "Success One", "2026-06-01");
  await card("KC", "Client C", "Success One", "2026-06-01");
  await card("KE", "Client E", "Success One", null);
  await card("KF", "Client F", "Success One", "2026-07-01");
  await card("KH", "Client H", "Success One", "2026-08-01");
  await card("KI", "Client I", "Old Manager", "2026-05-01");
  await card("KP", "Client P", null, null);
  await card("KJ", "Client J", "Success One", null);
  for (const [loc, k, name, mode, accounts] of [
    [LOC_A, "KA", "Client A", "DFY", ["111"]],
    [LOC_B, "KB", "Client B", "DWY", ["222"]],
    [LOC_C, "KC", "Client C", "DFY", ["333"]],
    [LOC_E, "KE", "Client E", "DFY", ["555"]],
    [LOC_G, "KG", "Client G", "DFY", []],
  ] as [string, string, string, string, string[]][]) {
    await q(
      "INSERT INTO public.cockpit_board_clients(location_id,clickup_id,client_name,service_mode,ad_account_ids) VALUES($1,$2,$3,$4,$5)",
      [loc, k, name, mode, accounts],
    );
  }
  // Client A: lead campaigns before and after its creative start + 14, and engagement spend.
  await adDay("111", "2026-09-05", 100, 100, 5);
  await adDay("111", "2026-09-25", 200, 200, 10);
  await adDay("111", "2026-09-26", 50, 50, null);
  // Client B (done with you), Client C (one unpriced row), Client E (no launch date:
  // its creative starts on its first lead-campaign day, not on August's engagement).
  await adDay("222", "2026-09-12", 100, 100, 10);
  await adDay("333", "2026-09-10", 100, null, 4);
  await adDay("333", "2026-09-11", 60, 60, 2);
  await adDay("555", "2026-08-20", 40, 40, null);
  await adDay("555", "2026-09-03", 90, 90, 3);
  await bookingDays(LOC_A, { "2026-09-05": 1, "2026-09-25": 2 });
  await bookingDays(LOC_B);
  await bookingDays(LOC_C, { "2026-09-11": 1 });
  await bookingDays(LOC_E, { "2026-09-04": 1 }, ["2026-09-15"]);
  await bookingDays(LOC_G, { "2026-09-10": 1 });

  // Clients: Client H falls more than 14 days behind its payment; Client P's
  // card says it paused on 2 Sep; Client A is paid ahead; Client I renewed on 20 Aug.
  for (let d = 10; d <= 30; d++) {
    const day = `2026-09-${String(d).padStart(2, "0")}`;
    await q(
      "INSERT INTO public.cockpit_client_billing_days(day,clickup_task_id,next_payment_date) VALUES($1,'KH','2026-09-01')",
      [day],
    );
  }
  await db.exec(`
    INSERT INTO public.cockpit_client_billing_days(day,clickup_task_id,next_payment_date,paused_on,churn_type) VALUES
     ('2026-09-20','KP',NULL,'2026-09-02',NULL),
     ('2026-09-30','KA','2026-10-05',NULL,NULL),
     ('2026-09-30','KF',NULL,NULL,'Mid-programme loss (counts as churn)');
    INSERT INTO public.test_plan_parts VALUES
     (5,'[{"key":"renewals","kind":"per_event","label":"Renewals","event":"renewal","amount":100}]');
    INSERT INTO public.cockpit_pay_entries(person_id,month,part_key,quantity,client,cleared_on,entered_by) VALUES
     (5,'2026-08-01','renewals',1,'KI','2026-08-20','ceo@example.test'),
     (5,'2026-08-01','renewals',1,'Client B','2026-08-25','ceo@example.test');
    UPDATE public.cockpit_pay_entries SET voided_at = now() WHERE client = 'Client B';
  `);
  for (const [key, from, to, day] of [
    ["KF", "Paused", "Stopped", "2026-09-20"],
    ["KI", "Active", "Stopped", "2026-09-19"],
    ["KJ", "Onboarding", "Stopped", "2026-09-25"],
    ["KX", "Active", "Stopped", "2026-08-15"],
  ]) {
    await q(
      "INSERT INTO public.cockpit_csm_sources(table_name,source_id,data) VALUES('churnEvents',$1,$2)",
      [
        `churn:${key}`,
        JSON.stringify({
          key,
          kind: "lost",
          from,
          to,
          day,
          name: `Client ${key.slice(1)}`,
        }),
      ],
    );
  }
  for (const [id, data] of [
    [
      "s1",
      {
        kind: "script",
        status: "complete",
        assignees: ["Ward"],
        clients: ["Client A"],
        createdAt: ms("2026-08-10T10:00:00Z"),
      },
    ],
    [
      "s2",
      {
        kind: "script",
        status: "cancelled",
        assignees: ["Ward"],
        client: "Client B",
        createdAt: ms("2026-08-11T10:00:00Z"),
      },
    ],
    [
      "s3",
      {
        kind: "script",
        status: "complete",
        assignees: ["Ward"],
        client: "Client E",
        createdAt: ms("2026-10-05T10:00:00Z"),
      },
    ],
    [
      "s4",
      {
        kind: "script",
        status: "complete",
        assignees: ["Nobody Known"],
        clients: ["Client C"],
        createdAt: ms("2026-08-12T10:00:00Z"),
      },
    ],
    [
      "s5",
      {
        kind: "brandDNA",
        status: "complete",
        assignees: ["Ward"],
        clients: ["Client G"],
        createdAt: ms("2026-08-12T10:00:00Z"),
      },
    ],
  ] as [string, Record<string, unknown>][]) {
    await q(
      "INSERT INTO public.cockpit_creative_sources(table_name,source_id,data) VALUES('creativeTasks',$1,$2)",
      [id, JSON.stringify(data)],
    );
  }

  // ---- sales: two reps, their seats, deals, intros and the deal ledger
  await db.exec(`
    INSERT INTO public.cockpit_sales_reps VALUES
     ('${REP_CLOSER}','Closer One','ghlCloser1',ARRAY['Closer One','C. One']),
     ('${REP_SETTER}','Setter One','ghlSetter1',ARRAY['Setter One']);
    INSERT INTO public.cockpit_sales_people VALUES ('closer1@example.test','${REP_CLOSER}'),('setter1@example.test','${REP_SETTER}');
    INSERT INTO public.cockpit_sales_settings VALUES ('rooms','{"live_calendar_id":"calLiveRoom","test_calendar_id":""}');
    INSERT INTO public.cockpit_sales_leads VALUES ('c3','55500003'),('c3b','55500009'),('c3c','55500009');
    INSERT INTO public.cockpit_sales_appointments VALUES
     ('i1','c1','calIntro','intro','${kw("04", "10:00")}','showed','ghlCloser1','Closer One'),
     ('i2a','c2','calIntro','intro','2026-08-20T10:00:00+03:00','noshow','ghlSetter1','Setter One'),
     ('i2b','c2','calIntro','intro','${kw("07", "10:00")}','showed','ghlCloser1','Closer One'),
     ('i2c','c2','calIntro','intro','${kw("07", "18:00")}','cancelled','ghlSetter1','Setter One'),
     ('i2d','c2','calLiveRoom','intro','${kw("07", "19:00")}','showed','ghlSetter1','Setter One'),
     ('i3','c3','calIntro','intro','2026-08-25T10:00:00+03:00','showed','ghlSetter1','Setter One'),
     ('i3x','c3','calIntro','intro','${kw("12", "10:00")}','showed','ghlCloser1','Closer One');
  `);
  // D1: set and closed by the closer, paid in full on 12 Sep. D2: the form says
  // the setter, the intro that showed was the closer's. D3: found by phone, 95%
  // paid. D4: 99% paid, nobody on record set it. D5: voided. D6: a closer on no
  // roster. D7: 92% paid, the CEO said it is paid in full. D8: signed in August.
  await deal("D1", kw("05", "15:00"), {
    closer: "Closer One",
    setter: "Closer One",
    contact: "c1",
    contracted: 6000,
  });
  await deal("D2", kw("08", "15:00"), {
    closer: "C. One",
    setter: "Setter One",
    contact: "c2",
    contracted: 6000,
  });
  await deal("D3", kw("10", "15:00"), {
    closer: "Closer One",
    phone8: "55500003",
    contracted: 5000,
    plan: "Split pay ($2,500 + $2,500)",
  });
  await deal("D4", kw("15", "15:00"), {
    closer: "closer one ",
    contracted: 4000,
    phone8: "55500009",
  });
  await deal("D5", kw("16", "15:00"), { closer: "Closer One", voided: true });
  await deal("D6", kw("20", "15:00"), {
    closer: "Unknown Person",
    contracted: 3000,
  });
  await deal("D7", kw("21", "15:00"), {
    closer: "Closer One",
    setter: "Setter One",
    contracted: 5000,
  });
  await deal("D8", "2026-08-25T15:00:00+03:00", {
    closer: "Closer One",
    setter: "Setter One",
    contracted: 6000,
    plan: "Monthly",
  });
  await deal("D9", kw("28", "15:00"), {
    closer: "Closer One",
    contracted: 6000,
  });
  await dealPay("p1a", "D1", "2026-09-04", 500, "deposit");
  await dealPay("p1b", "D1", "2026-09-12", 5500);
  await dealPay("p2", "D2", "2026-09-08", 500, "deposit");
  await dealPay("p3", "D3", "2026-09-10", 4750);
  await dealPay("p4", "D4", "2026-09-16", 3960);
  await dealPay("p5", "D5", "2026-09-16", 700);
  await dealPay("p6", "D6", "2026-09-21", 1000);
  await dealPay("p7", "D7", "2026-09-22", 4600);
  await dealPay("p8a", "D8", "2026-08-26", 500, "deposit");
  await dealPay("p8b", "D8", "2026-09-03", 1500);
  await dealPay("p9", "D9", "2026-10-02", 6000);
  await q(
    "INSERT INTO public.cockpit_pay_confirmations(month,key,value,set_by) VALUES('2026-09-01','pif:D7','{\"earned\":true}','ceo@example.test')",
  );
  await q("INSERT INTO public.cockpit_sections VALUES('money',$1,$2)", [
    "2026-10-01T06:00:00Z",
    JSON.stringify({
      attribution: {
        transactions: [
          {
            id: "whop:pay_loose1",
            day: "2026-09-14",
            usd: 1500,
            rail: "whop",
            direction: "in",
            side: "unattributed",
            payerName: "Payer Loose",
          },
          {
            id: "bankline:9",
            day: "2026-09-14",
            usd: 300,
            rail: "bank",
            direction: "in",
            side: "unattributed",
            payerName: "Own transfer",
          },
          {
            id: "whop:pay_oct",
            day: "2026-10-03",
            usd: 200,
            rail: "whop",
            direction: "in",
            side: "unattributed",
            payerName: "Payer Late",
          },
          {
            id: "whop:pay_fe",
            day: "2026-09-12",
            usd: 5500,
            rail: "whop",
            direction: "in",
            side: "front_end",
            payerName: "Payer One",
          },
        ],
        dealLedger: { rows: 11, usd: 29510, from: "2025-11-01" },
      },
    }),
  ]);
});

afterAll(async () => {
  await db?.close();
});

const byName = (rows: any[], name: string) => rows.find(r => r.name === name);

describe("the call centre (method B)", () => {
  test("each meeting goes to who booked it: dialer receipt, central caller, client-sheet caller; a reschedule stays with the booking", async () => {
    const f = await facts("cockpit_pay_facts_calls", MONTH, MONTH_END);
    const one = byName(f.agents, "Agent One");
    const two = byName(f.agents, "Agent Two");
    expect(one).toMatchObject({
      email: AGENT1,
      personId: 1,
      due: 5,
      shows: 3,
      noShows: 1,
      unmarked: 1,
      showsBy: { console: 2, central: 0, sheet: 1 },
      viaReschedule: 1,
      showIds: ["A1", "A3", "A9"],
      unmarkedBy: [{ client: "Client A", count: 1 }],
    });
    expect(two).toMatchObject({
      email: AGENT2,
      personId: 2,
      due: 4,
      shows: 3,
      noShows: 0,
      unmarked: 1,
      showsBy: { console: 1, central: 1, sheet: 1 },
      showIds: ["A2", "A7", "A10"],
    });
  });

  test("an unmarked meeting is neither a show nor a no-show; Google copies, callbacks and other months are never due", async () => {
    const f = await facts("cockpit_pay_facts_calls", MONTH, MONTH_END);
    const all = [
      ...f.agents.flatMap((a: any) => a.showIds),
      ...f.unattributed.items.map((i: any) => i.appointmentId),
    ];
    for (const never of ["A11", "A12", "A16", "A5o"])
      expect(all).not.toContain(never);
    const due =
      f.agents.reduce((n: number, a: any) => n + a.due, 0) + f.unattributed.due;
    expect(due).toBe(12);
    const unmarked = f.agents.reduce((n: number, a: any) => n + a.unmarked, 0);
    expect(unmarked).toBe(2);
  });

  test("closes: once per contact, the portal's win as evidence when there is one, else the sheet's first closed meeting", async () => {
    const f = await facts("cockpit_pay_facts_calls", MONTH, MONTH_END);
    expect(byName(f.agents, "Agent One").closes).toEqual([
      expect.objectContaining({
        appointmentId: "A9",
        contactId: "cA3",
        evidence: "portal",
        value: 2000,
        currency: "USD",
        client: "Client A",
      }),
    ]);
    expect(
      byName(f.agents, "Agent Two").closes.map((c: any) => [
        c.appointmentId,
        c.evidence,
        c.value,
        c.currency,
      ]),
    ).toEqual([
      ["A7", "portal", 1000, "KWD"],
      ["A10", "sheet", 300, "USD"],
    ]);
  });

  test("a booking two agents claim, an unknown central caller and a booker off the roster are listed with why, never credited", async () => {
    const f = await facts("cockpit_pay_facts_calls", MONTH, MONTH_END);
    expect(f.unattributed).toMatchObject({ due: 3, shows: 2, closes: 0 });
    const why = Object.fromEntries(
      f.unattributed.items.map((i: any) => [i.appointmentId, i.why]),
    );
    expect(why.A6).toBe("Two agents booked it in the dialer.");
    expect(why.A15).toContain("The central sheet names Someone Else");
    expect(why.A17).toBe(
      "Booked in the dialer by outsider@example.test, who is not on the team list.",
    );
    expect(f.agents.map((a: any) => a.email)).not.toContain(
      "outsider@example.test",
    );
  });

  test("booked: confirmed main bookings by booking day, receipt then central caller, a reschedule never a second booking", async () => {
    const f = await facts("cockpit_pay_facts_calls", MONTH, MONTH_END);
    expect(byName(f.agents, "Agent One").booked).toBe(2); // A1, A9 (A5 is a reschedule, A5o cancelled, A13 provisional)
    expect(byName(f.agents, "Agent Two").booked).toBe(3); // A2, A4, A7
    expect(f.unattributed.booked).toBe(6); // A3, A6, A10, A15, A17 and A16 (booked in September for an October meeting)
  });

  test("the scorecard sits beside the counts; it is cut to today for the open month and skipped before a month starts", async () => {
    const f = await facts("cockpit_pay_facts_calls", MONTH, MONTH_END);
    expect(f.scorecard).toEqual({
      to: MONTH_END,
      callers: [{ name: "Agent One", email: AGENT1, shows: 2, closed: 1 }],
    });
    expect(f.scorecardNote).toContain("Scorecard to 30 Sep");
    const first = `${kuwaitToday.slice(0, 8)}01`;
    const last = `${kuwaitToday.slice(0, 8)}28`;
    const open = await facts("cockpit_pay_facts_calls", first, last);
    expect(open.scorecard.to).toBe(kuwaitToday < last ? kuwaitToday : last);
    const future = await facts(
      "cockpit_pay_facts_calls",
      "2099-01-01",
      "2099-01-31",
    );
    expect(future.scorecard).toBeNull();
    expect(future.scorecardNote).toBe("The month has not started.");
    expect(future.agents).toEqual([]);
  });
});

describe("ads", () => {
  test("per client: spend, lead spend, Meta leads, bookings, CPL and CPB; a left-out client is named with why", async () => {
    const f = await facts("cockpit_pay_facts_ads", MONTH, MONTH_END, 0);
    const a = byName(f.clients, "Client A");
    expect(a).toMatchObject({
      clickupId: "KA",
      locationId: LOC_A,
      activeDays: 3,
      creativeStart: "2026-09-10",
      spendUsd: 350,
      leadSpendUsd: 300,
      nonLeadSpendUsd: 50,
      leads: 15,
      bookings: 3,
      cpl: 20,
      cpb: 116.67,
      unpricedRows: 0,
      nullBookingDays: 0,
      notMeasured: { cpl: null, cpb: null },
    });
    expect(byName(f.clients, "Client B").notMeasured).toEqual({
      cpl: null,
      cpb: "Done with you: the client books its own meetings.",
    });
    expect(byName(f.clients, "Client C")).toMatchObject({
      unpricedRows: 1,
      cpl: null,
      notMeasured: {
        cpl: "1 spend rows have no USD price.",
        cpb: "1 spend rows have no USD price.",
      },
    });
    expect(byName(f.clients, "Client D")).toMatchObject({
      locationId: null,
      spendUsd: null,
      nullBookingDays: null,
      notMeasured: {
        cpl: "No board row for this card.",
        cpb: "No board row for this card.",
      },
    });
    expect(byName(f.clients, "Client E")).toMatchObject({
      creativeStart: "2026-09-03",
      cpl: 30,
      cpb: null,
      nullBookingDays: 1,
      notMeasured: {
        cpl: null,
        cpb: "Bookings are not stored for 1 of the 30 days.",
      },
    });
    expect(byName(f.clients, "Client G").notMeasured.cpl).toBe(
      "No ad account is linked to this client.",
    );
    expect(f.clients.map((c: any) => c.name)).not.toContain("Client F"); // Paused all month
  });

  test("pooled as ratios of sums over the measured clients only", async () => {
    const f = await facts("cockpit_pay_facts_ads", MONTH, MONTH_END, 0);
    expect(f.pooled).toMatchObject({
      clients: 3,
      leadSpendUsd: 490,
      leads: 28,
      cpl: 17.5,
      nonLeadSpendUsd: 50,
      spendUsd: 350,
      bookings: 3,
      cpb: 116.67,
      cpbClients: 1,
    });
    // Client H and Client I have cards Active in September but no board row.
    expect(f.pooled.outOfCpl.map((c: any) => c.name)).toEqual([
      "Client C",
      "Client D",
      "Client G",
      "Client H",
      "Client I",
    ]);
    expect(f.pooled.outOfCpb.map((c: any) => c.name)).toEqual([
      "Client B",
      "Client C",
      "Client D",
      "Client E",
      "Client G",
      "Client H",
      "Client I",
    ]);
    expect(f.adThrough).toBe(MONTH_END);
  });

  test("the guard: days before creative start + 14 are left out of `after`", async () => {
    const f = await facts("cockpit_pay_facts_ads", MONTH, MONTH_END, 14);
    expect(f.excludeDays).toBe(14);
    expect(byName(f.clients, "Client A").after).toEqual({
      from: "2026-09-24",
      spendUsd: 250,
      leadSpendUsd: 200,
      leads: 10,
      bookings: 2,
    });
    expect(byName(f.clients, "Client E").after).toMatchObject({
      from: "2026-09-17",
      leads: null,
      spendUsd: null,
    });
    expect(byName(f.clients, "Client A").spendUsd).toBe(350); // the month's figures do not change
    expect(f.note.join(" ")).toContain("plus 14 days");
  });
});

describe("clients", () => {
  test("the start set is the last snapshot before the month, Active or Paused; a loss counts only from it", async () => {
    const f = await facts("cockpit_pay_facts_clients", MONTH);
    expect(f.snapshots).toEqual({
      first: "2026-09-09",
      last: "2026-09-30",
      startFrom: "2026-08-31",
    });
    expect(f.logo.startSet).toHaveLength(10);
    expect(f.logo.lost.map((l: any) => [l.clickupId, l.startStatus])).toEqual([
      ["KI", "Active"],
      ["KF", "Paused"],
    ]);
    expect(f.logo.notInStart.map((l: any) => l.clickupId)).toEqual(["KJ"]);
    expect(f.logo.proposal).toEqual({
      lost: 4,
      activeAtStart: 10,
      pct: 40,
      clients: ["KF", "KH", "KI", "KP"],
    });
  });

  test("candidates: more than 14 days unpaid, or paused more than 14 days (the card's pause date counts)", async () => {
    const f = await facts("cockpit_pay_facts_clients", MONTH);
    const c = Object.fromEntries(
      f.logo.candidates.map((x: any) => [x.clickupId, x]),
    );
    expect(c.KH).toMatchObject({
      kind: "non_payment",
      day: "2026-09-16",
      termStart: "2026-08-01",
      dayOfTerm: 46,
      midProgramme: true,
    });
    expect(c.KH.why).toContain("15 days late on 16 Sep");
    expect(c.KP).toMatchObject({
      kind: "paused",
      day: "2026-09-20",
      midProgramme: null,
      csm: null,
    });
    expect(c.KP.why).toContain("paused since 2 Sep");
  });

  test("a loss in a renewed term is mid-programme from the renewal; the card's churn type rides along", async () => {
    const f = await facts("cockpit_pay_facts_clients", MONTH);
    const lost = Object.fromEntries(
      f.logo.lost.map((x: any) => [x.clickupId, x]),
    );
    expect(lost.KI).toMatchObject({
      termStart: "2026-08-20",
      dayOfTerm: 30,
      midProgramme: true,
      csm: "Old Manager",
    });
    expect(lost.KF).toMatchObject({
      termStart: "2026-07-01",
      dayOfTerm: 81,
      midProgramme: true,
      cardChurnType: "Mid-programme loss (counts as churn)",
    });
  });

  test("a renewal is an entry on the plan's renewal part, whatever its key; a clawback starts no term", async () => {
    const lostKI = async () =>
      (await facts("cockpit_pay_facts_clients", MONTH)).logo.lost.find(
        (x: any) => x.clickupId === "KI",
      );
    try {
      // The CSM's plan now pays renewals on "kept_on"; "renewals" is a referral part.
      await q(
        `UPDATE public.test_plan_parts SET parts = '[{"key":"renewals","kind":"per_event","label":"Referrals","event":"referral","amount":100},
          {"key":"kept_on","kind":"per_event","label":"Renewals","event":"renewal","amount":100}]' WHERE person_id = 5`,
      );
      expect(await lostKI()).toMatchObject({
        termStart: "2026-05-01",
        midProgramme: false,
      });
      await q(
        `INSERT INTO public.cockpit_pay_entries(person_id,month,part_key,quantity,client,cleared_on,entered_by) VALUES
          (5,'2026-08-01','kept_on',1,'Client I','2026-08-22','ceo@example.test'),
          (5,'2026-09-01','kept_on',-1,'KI','2026-09-01','ceo@example.test')`,
      );
      expect(await lostKI()).toMatchObject({
        termStart: "2026-08-22",
        dayOfTerm: 28,
        midProgramme: true,
      });
    } finally {
      await q(
        "DELETE FROM public.cockpit_pay_entries WHERE part_key = 'kept_on'",
      );
      await q(
        `UPDATE public.test_plan_parts SET parts = '[{"key":"renewals","kind":"per_event","label":"Renewals","event":"renewal","amount":100}]' WHERE person_id = 5`,
      );
    }
    expect(await lostKI()).toMatchObject({
      termStart: "2026-08-20",
      dayOfTerm: 30,
    });
  });

  test("books by today's CSM field; an unmatched CSM and a card with none get their own rows", async () => {
    const f = await facts("cockpit_pay_facts_clients", MONTH);
    const mine = f.byCsm.find((b: any) => b.personId === 5);
    expect(mine.name).toBe("Success One");
    expect(mine.startSet.map((s: any) => s.clickupId).sort()).toEqual([
      "KA",
      "KB",
      "KC",
      "KE",
      "KF",
      "KH",
    ]);
    expect(mine.proposal).toEqual({
      lost: 2,
      activeAtStart: 6,
      pct: 33.33,
      clients: ["KF", "KH"],
    });
    const old = f.byCsm.find((b: any) => b.name === "Old Manager");
    expect(old).toMatchObject({
      personId: null,
      proposal: { lost: 1, activeAtStart: 1, pct: 100, clients: ["KI"] },
    });
    const none = f.byCsm.find(
      (b: any) => b.personId === null && b.name === null,
    );
    expect(none.startSet.map((s: any) => s.clickupId).sort()).toEqual([
      "KD",
      "KG",
      "KP",
    ]);
    expect(none.proposal).toMatchObject({
      lost: 1,
      activeAtStart: 3,
      clients: ["KP"],
    });
  });

  test("qualifying: Active on every snapshot of the last 30 days, minus cards past due on the month-end billing row", async () => {
    const f = await facts("cockpit_pay_facts_clients", MONTH);
    const q = f.byCsm.find((b: any) => b.personId === 5).qualifying;
    expect(q).toMatchObject({
      upperBound: 4,
      paymentNotChecked: 3,
      checkedFrom: "2026-09-09",
      checkedTo: MONTH_END,
      paymentCheckedOn: MONTH_END,
    });
    expect(q.clients.map((c: any) => [c.clickupId, c.paymentChecked])).toEqual([
      ["KA", true],
      ["KB", false],
      ["KC", false],
      ["KE", false],
    ]);
  });

  test("owned creative: script tasks assigned to the person, by a one-word ClickUp name; the rest listed", async () => {
    const f = await facts("cockpit_pay_facts_clients", MONTH);
    expect(f.ownedCreative.map((o: any) => o.personId)).toEqual([6]);
    const own = f.ownedCreative.find((o: any) => o.personId === 6);
    expect(own.clients).toEqual([{ clickupId: "KA", name: "Client A" }]);
    expect(own.others.map((o: any) => o.name)).toContain("Client B"); // its task was cancelled
    expect(own.others.map((o: any) => o.name)).toContain("Client E"); // its task came after the month
    expect(f.note.join(" ")).toContain("Nobody Known");
  });

  test("with no snapshot before the month, the start is the month's first snapshot, said so", async () => {
    const f = await facts("cockpit_pay_facts_clients", "2026-08-01");
    expect(f.snapshots).toMatchObject({
      first: "2026-08-31",
      startFrom: "2026-08-31",
    });
    expect(f.note[0]).toContain("No roster snapshot before 1 Aug 2026");
  });
});

describe("sales", () => {
  test("a deal set and closed by one person earns both; the paid-in-full at 99% is earned in the month of that payment", async () => {
    const f = await facts("cockpit_pay_facts_sales", MONTH, MONTH_END);
    const d1 = f.deals.find((d: any) => d.responseId === "D1");
    expect(d1).toMatchObject({
      closer: { name: "Closer One", personId: 3 },
      setter: { personId: 3, source: "form", state: "known", disagree: null },
      cashInMonth: 6000,
      pif: { state: "earned", day: "2026-09-12", shortUsd: 0, source: "cash" },
    });
    expect(d1.payments.map((p: any) => p.paymentId)).toEqual(["p1a", "p1b"]);
    const d4 = f.deals.find((d: any) => d.responseId === "D4");
    expect(d4.pif).toMatchObject({
      state: "earned",
      day: "2026-09-16",
      shortUsd: 40,
    });
    expect(d4.closer.personId).toBe(3); // "closer one " keys through the aliases
  });

  test("95% waits for the CEO; a confirmation decides; a short deal says how much is missing", async () => {
    const f = await facts("cockpit_pay_facts_sales", MONTH, MONTH_END);
    const get = (id: string) => f.deals.find((d: any) => d.responseId === id);
    expect(get("D3").pif).toMatchObject({
      state: "waiting",
      day: "2026-09-10",
      shortUsd: 250,
    });
    expect(get("D7").pif).toMatchObject({
      state: "earned",
      day: "2026-09-22",
      source: "confirmed",
    });
    expect(get("D2").pif).toMatchObject({
      state: "no",
      day: null,
      shortUsd: 5500,
      until: "2026-10-23",
    });
  });

  test("who set it: the form and the intro must agree; disagreement waits; the phone finds the lead; nobody on record waits on the closer", async () => {
    const f = await facts("cockpit_pay_facts_sales", MONTH, MONTH_END);
    const get = (id: string) => f.deals.find((d: any) => d.responseId === id);
    expect(get("D2").setter).toMatchObject({
      state: "waiting",
      personId: null,
      disagree: {
        form: { name: "Setter One", personId: 4 },
        intro: { name: "Closer One", personId: 3, by: "intro" },
      },
    });
    expect(get("D3").setter).toMatchObject({
      state: "known",
      personId: 4,
      source: "phone_intro",
      name: "Setter One",
    });
    expect(get("D4").setter).toMatchObject({ state: "none", personId: null }); // its phone matches two leads
    expect(get("D7").setter).toMatchObject({
      state: "known",
      personId: 4,
      source: "form",
    });
  });

  test("per person: closed and set cash in the month, waiting setters, paid-in-full deals; a leaver still earns", async () => {
    const f = await facts("cockpit_pay_facts_sales", MONTH, MONTH_END);
    const closer = f.people.find((p: any) => p.personId === 3);
    expect(closer).toEqual({
      personId: 3,
      name: "Closer One",
      closedCashUsd: 21310, // 6000 + 500 + 4750 + 3960 + 4600 + 1500 (D8's August deposit is not September's)
      setCashUsd: 6000,
      setWaiting: ["D2", "D4"],
      pifDeals: ["D1", "D4", "D7"],
      pifWaiting: ["D3"],
    });
    const setter = f.people.find((p: any) => p.personId === 4);
    expect(setter).toMatchObject({
      setCashUsd: 10850,
      closedCashUsd: 0,
      setWaiting: ["D2"],
    });
    expect(f.unkeyed).toEqual([
      { responseId: "D6", name: "Unknown Person", role: "closer" },
    ]);
    expect(f.deals.map((d: any) => d.responseId)).not.toContain("D5");
    // D9 was signed in September and paid in full in October: listed, no September cash, October's bonus.
    expect(f.deals.find((d: any) => d.responseId === "D9")).toMatchObject({
      cashInMonth: 0,
      cashToDate: 0,
      payments: [],
      pif: { state: "earned", day: "2026-10-02" },
    });
    expect(f.note.join(" ")).toContain(
      "1 deal payments in the range point at a deal that is voided or missing",
    );
  });

  test("the CEO's setter confirmation ends the wait; unattributed money is listed, never counted", async () => {
    await q(
      "INSERT INTO public.cockpit_pay_confirmations(month,key,value,set_by) VALUES('2026-09-01','setter:D2','{\"personId\":4}','ceo@example.test')",
    );
    try {
      const f = await facts("cockpit_pay_facts_sales", MONTH, MONTH_END);
      const d2 = f.deals.find((d: any) => d.responseId === "D2");
      expect(d2.setter).toMatchObject({
        state: "known",
        personId: 4,
        source: "confirmed",
        name: "Setter One",
        disagree: null,
      });
      expect(f.people.find((p: any) => p.personId === 4)).toMatchObject({
        setCashUsd: 11350,
        setWaiting: [],
      });
      expect(f.people.find((p: any) => p.personId === 3).setWaiting).toEqual([
        "D4",
      ]);
      expect(f.unattributed).toEqual({
        count: 1,
        usd: 1500,
        items: [
          {
            paymentId: "whop:pay_loose1",
            day: "2026-09-14",
            usd: 1500,
            payer: "Payer Loose",
            rail: "whop",
          },
        ],
      });
      expect(f.cashThrough).toContain("2026-10-01");
      expect(f.ledgerReady).toBe(true);
    } finally {
      await q(
        "DELETE FROM public.cockpit_pay_confirmations WHERE key = 'setter:D2'",
      );
    }
  });

  test("a Money section published before the deal ledger existed is not a ledger: ledgerReady false, said so", async () => {
    const [{ payload }] = await q<{ payload: unknown }>(
      "SELECT payload FROM public.cockpit_sections WHERE key = 'money'",
    );
    try {
      await q(
        "UPDATE public.cockpit_sections SET payload = payload #- '{attribution,dealLedger}' WHERE key = 'money'",
      );
      const f = await facts("cockpit_pay_facts_sales", MONTH, MONTH_END);
      expect(f.ledgerReady).toBe(false);
      expect(f.cashThrough).toContain("2026-10-01");
      expect(f.note).toContain(
        "The Money section was published before the deal ledger existed: no deal cash is known until the next money refresh.",
      );
      await q("DELETE FROM public.cockpit_sections WHERE key = 'money'");
      const none = await facts("cockpit_pay_facts_sales", MONTH, MONTH_END);
      expect(none.ledgerReady).toBe(false);
    } finally {
      await q(
        "INSERT INTO public.cockpit_sections VALUES('money','2026-10-01T06:00:00Z',$1) ON CONFLICT (key) DO UPDATE SET payload = EXCLUDED.payload",
        [JSON.stringify(payload)],
      );
    }
    expect(
      (await facts("cockpit_pay_facts_sales", MONTH, MONTH_END)).ledgerReady,
    ).toBe(true);
  });
});

describe("the gate and the house rules", () => {
  test("no role runs the facts: PUBLIC, anon, authenticated and service_role are all refused", async () => {
    for (const fn of [
      "cockpit_pay_facts_calls(date,date)",
      "cockpit_pay_facts_ads(date,date,integer)",
      "cockpit_pay_facts_clients(date)",
      "cockpit_pay_facts_sales(date,date)",
    ]) {
      for (const role of ["anon", "authenticated", "service_role"]) {
        const [row] = await q<{ ok: boolean }>(
          "SELECT has_function_privilege($1, $2, 'EXECUTE') AS ok",
          [role, `public.${fn}`],
        );
        expect({ fn, role, ok: row.ok }).toEqual({ fn, role, ok: false });
      }
      const [def] = await q<{ secdef: boolean; config: string[] }>(
        "SELECT prosecdef AS secdef, proconfig AS config FROM pg_proc WHERE oid = $1::regprocedure",
        [`public.${fn}`],
      );
      expect(def).toEqual({ secdef: true, config: ['search_path=""'] });
    }
    await db.exec("SET ROLE service_role");
    try {
      await expect(
        db.query(
          "SELECT public.cockpit_pay_facts_ads('2026-09-01','2026-09-30',0)",
        ),
      ).rejects.toThrow(/permission denied/);
    } finally {
      await owner(db);
    }
  });

  test("a range over 93 days, a bad exclusion and a month not on its 1st are refused in plain words", async () => {
    await expect(
      db.query(
        "SELECT public.cockpit_pay_facts_calls('2026-01-01','2026-06-30')",
      ),
    ).rejects.toThrow("Choose a range of up to 93 days.");
    await expect(
      db.query(
        "SELECT public.cockpit_pay_facts_ads('2026-09-01','2026-09-30',91)",
      ),
    ).rejects.toThrow("0 to 90");
    await expect(
      db.query("SELECT public.cockpit_pay_facts_clients('2026-09-15')"),
    ).rejects.toThrow("Choose a month by its first day.");
    await expect(
      db.query(
        "SELECT public.cockpit_pay_facts_sales('2026-09-30','2026-09-01')",
      ),
    ).rejects.toThrow("Choose a range of up to 93 days.");
  });

  test("the migration applies twice and the answers do not change", async () => {
    const before = await facts("cockpit_pay_facts_sales", MONTH, MONTH_END);
    await db.exec(SQL);
    expect(await facts("cockpit_pay_facts_sales", MONTH, MONTH_END)).toEqual(
      before,
    );
  });
});
