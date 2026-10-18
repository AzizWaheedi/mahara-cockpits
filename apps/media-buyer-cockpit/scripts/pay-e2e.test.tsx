/**
 * Pay for [month], end to end (docs/pay/PAY-PLANS.md sections 4 to 8): the
 * three migrations (20261018c, 20261018a, 20261018b) in PGlite over made-up
 * source rows, the October seed run as the CEO, cockpit_ceo_pay_month read
 * through the browser's own client (ceoPayClient's zod schemas) and rendered
 * by PayMonthCard in happy-dom, every write going back through the real
 * functions. It pins that the SQL month and the screens agree on names and
 * shapes (the setter and paid-in-full waits found on 2026-10-18 are plain
 * tests since their fix).
 * Every person, client, deal and id is invented; the CEO gate is pointed at
 * ceo@example.test.
 */
import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { PGlite } from "@electric-sql/pglite";
import { migration } from "./lib/cockpitTestDb";
import { actor, CEO, hoursTestDb, owner } from "./lib/hoursTestDb";

// Nothing here may outlive this file: every global and the env are put back.
const g = globalThis as any;
const ENV = {
  VITE_SUPABASE_URL: "https://bldgtotkfmhoxmlzowdx.supabase.co",
  VITE_SUPABASE_ANON_KEY: "test-placeholder-key",
};
const envs = [process.env, (import.meta as any).env].filter(Boolean);
const envBefore = envs.map(e => Object.fromEntries(Object.keys(ENV).map(k => [k, e[k]])));
for (const e of envs) Object.assign(e, ENV);
const realFetch = globalThis.fetch;
const strayFetches: string[] = [];
globalThis.fetch = (async (input: RequestInfo | URL) => {
  strayFetches.push(String(input));
  throw new Error("The pay end-to-end test makes no network calls.");
}) as typeof fetch;

// --- The database ---------------------------------------------------------

const CEO_EMAIL = "ceo@example.test";
const REP_CLOSER = "00000000-0000-4000-8000-00000000c105";
const REP_SETTER = "00000000-0000-4000-8000-00000000c5e7";
const kw = (day: string, hhmm: string) => `${day}T${hhmm}:00+03:00`;

function extract(sql: string, pattern: RegExp, what: string): string {
  const hit = sql.match(pattern);
  if (!hit) throw new Error(`Canonical definition missing: ${what}`);
  return hit[0];
}

/** The live columns the facts read, for the sources no migration here creates (as ceo-pay-facts-supabase.test.ts). */
const STUBS = `
CREATE SCHEMA mahara_reporting; CREATE SCHEMA mahara_console; CREATE SCHEMA portal_data;
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
CREATE TABLE public.cockpit_csm_sources(table_name text, source_id text, data jsonb, source_snapshot_at timestamptz DEFAULT now());
CREATE TABLE public.cockpit_board_clients(location_id text PRIMARY KEY, clickup_id text, client_name text, service_mode text,
  ad_account_ids text[] DEFAULT '{}', tiktok boolean DEFAULT false);
CREATE TABLE public.cockpit_meta_ad_days(account_id text, account_timezone text, day date, ad_id text, spend numeric, spend_usd numeric, leads bigint);
CREATE TABLE public.cockpit_client_days(location_id text, day date, confirmed_bookings integer, PRIMARY KEY(location_id, day));
CREATE TABLE public.cockpit_creative_sources(table_name text, source_id text, data jsonb, source_snapshot_at timestamptz DEFAULT now());
CREATE TABLE public.cockpit_sales_reps(id uuid PRIMARY KEY, display_name text, ghl_user_id text, closer_aliases text[]);
CREATE TABLE public.cockpit_sales_people(email text PRIMARY KEY, b2b_rep_id uuid);
CREATE TABLE public.cockpit_sales_appointments(appointment_id text PRIMARY KEY, contact_id text, calendar_id text, call_type text,
  start_at timestamptz, status text, assigned_user_id text, assigned_user_name text);
CREATE TABLE public.cockpit_sales_leads(contact_id text PRIMARY KEY, phone8 text);
CREATE TABLE public.cockpit_sales_settings(key text PRIMARY KEY, value jsonb);
CREATE TABLE public.cockpit_sales_rooms(id bigserial PRIMARY KEY, count_appointment_id text, count_result text);
ALTER TABLE public.cockpit_sales_deals ADD COLUMN IF NOT EXISTS setter text;
`;

let pg: PGlite;
const ids: Record<string, number> = {};

async function buildDb() {
  pg = await hoursTestDb();
  await owner(pg);
  const gate = migration("20260923m_cockpit_ceo_gate.sql").replace(/IN \(\s*'[^']+',\s*'[^']+'\s*\)/, `IN ('${CEO_EMAIL}')`);
  if (!gate.includes(CEO_EMAIL)) throw new Error("gate fixture not patched");
  await pg.exec(gate);
  await pg.query("UPDATE auth.users SET email=$1 WHERE id=$2", [CEO_EMAIL, CEO]);
  await pg.query("UPDATE public.cockpit_members SET email=$1 WHERE auth_user_id=$2", [CEO_EMAIL, CEO]);
  // The pay month's today (settle day, history dates) is pinned; the facts read now(), and every source row is in the past.
  await pg.exec(`CREATE OR REPLACE FUNCTION public.cockpit_hours_kw_today() RETURNS date LANGUAGE sql STABLE SET search_path='' AS
    $$ SELECT '2026-10-18'::date $$;`);

  // 20261018c and what it rests on, as money-ties-supabase.test.ts loads it.
  const core = migration("20260919_cockpit_core.sql");
  for (const name of ["cockpit_client_billing_days", "cockpit_metric_days", "cockpit_payer_clients"])
    await pg.exec(extract(core, new RegExp(`create table if not exists public\\.${name} \\([\\s\\S]*?\\n\\);`, "i"), name));
  const manual = migration("20260927d_cockpit_manual_payments_access.sql");
  for (const name of ["cockpit_manual_payment_state", "cockpit_manual_payments"])
    await pg.exec(extract(manual, new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${name}\\([\\s\\S]*?\\n\\);`), name));
  await pg.exec("INSERT INTO public.cockpit_manual_payment_state(id,history_ready) VALUES(true,true) ON CONFLICT DO NOTHING");
  await pg.exec(migration("20260921c_bank_statements.sql"));
  await pg.exec(extract(migration("20260921d_cockpit_metrics.sql"), /create table if not exists public\.cockpit_sections \([\s\S]*?\n\);/i, "cockpit_sections"));
  const actions = migration("20260927h_cockpit_ceo_actions.sql");
  for (const pattern of [
    /ALTER TABLE public\.cockpit_payer_clients ADD COLUMN IF NOT EXISTS cleared_at timestamptz;/,
    /CREATE TABLE IF NOT EXISTS public\.cockpit_ceo_provider_health\(.*\);/,
    /ALTER TABLE public\.cockpit_expense_exclusions ADD COLUMN IF NOT EXISTS removed_at timestamptz;/,
    /ALTER TABLE public\.cockpit_bank_lines ADD COLUMN IF NOT EXISTS base_kind text;/,
    /ALTER TABLE public\.cockpit_bank_lines ADD COLUMN IF NOT EXISTS manual_kind boolean NOT NULL DEFAULT false;/,
  ]) await pg.exec(extract(actions, pattern, String(pattern)));
  await pg.exec(migration("20260927i_cockpit_finance_refresh.sql"));
  const restore = migration("20261007e_cockpit_provider_rpc_restore.sql");
  await pg.exec("ALTER TABLE public.cockpit_finance_refreshes ALTER COLUMN actor_id DROP NOT NULL");
  for (const fn of ["cockpit_ceo_refresh_require_service", "cockpit_ceo_refresh_finance_snapshot",
    "cockpit_ceo_worker_begin_finance_refresh", "cockpit_finance_refresh_input"])
    await pg.exec(extract(restore, new RegExp(`CREATE OR REPLACE FUNCTION public\\.${fn}\\([\\s\\S]*?\\n\\$\\$;`), fn));
  await pg.exec(extract(migration("20260924a_sales_cockpit.sql"), /create table if not exists public\.cockpit_sales_deals \([\s\S]*?\n\);/i, "cockpit_sales_deals"));
  await pg.exec(migration("20261018c_money_ties_deal_payments.sql"));

  // Two commission lines; the roster before 20261018a so lines and roles date from 2026-01-01.
  await pg.exec(migration("20261011d_ceo_commission_two_lines.sql"));
  for (const [name, extra] of [
    ["Agent One", { role: "Call centre agent", monthlyCost: 650, email: "agent1@example.test" }],
    ["Buyer One", { role: "Media buyer", monthlyCost: 700 }],
    ["Strategist One", { role: "Creative strategist", monthlyCost: 750 }],
    ["Success One", { role: "Client success manager", monthlyCost: 800 }],
    ["Systems One", { role: "Systems manager", monthlyCost: 1000 }],
    ["Closer One", { role: "Closer", monthlyCost: 1500, email: "closer1@example.test",
      commissionBasis: "closed_cash", commissionRate: 0.1, commission2Basis: "set_cash", commission2Rate: 0.05 }],
    ["Setter One", { role: "B2B setter", monthlyCost: 500, email: "setter1@example.test", commissionBasis: "set_cash", commissionRate: 0.05 }],
    ["Editor One", { role: "Video editor", monthlyCost: 600 }],
    ["Founder One", { role: "CEO" }],
  ] as [string, Record<string, unknown>][]) {
    await actor(pg, CEO);
    const r = (await pg.query<{ r: any }>("SELECT public.cockpit_ceo_people_save($1::jsonb) r",
      [JSON.stringify({ name, startedOn: "2026-01-01", currency: "USD", ...extra })])).rows[0].r;
    ids[name] = Number(r.id);
  }
  await owner(pg);
  await pg.exec(migration("20261018a_ceo_pay_plans.sql"));
  // The agent's client lines exist once 20261018a widens the constraint (so they date from October).
  await actor(pg, CEO);
  await pg.query("SELECT public.cockpit_ceo_people_save($1::jsonb)", [JSON.stringify({ id: ids["Agent One"],
    commissionBasis: "per_client_appt_shown", commissionRate: 5, commission2Basis: "per_client_deal_closed", commission2Rate: 20 })]);
  await owner(pg);
  await pg.exec(STUBS);
  await pg.exec(extract(migration("20261016111157_board_facts.sql"),
    /CREATE OR REPLACE FUNCTION public\.cockpit_board_calendar_kind\(p_name text\)[\s\S]*?\$\$;/, "calendar kind"));
  await pg.exec(migration("20261018b_ceo_pay_facts.sql"));
  const seed = readFileSync(new URL("../../../docs/pay/seed-2026-10.sql", import.meta.url), "utf8")
    .replace(/v_ceo_email text:='[^']+'/, `v_ceo_email text:='${CEO_EMAIL}'`);
  if (!seed.includes(CEO_EMAIL)) throw new Error("seed fixture not patched");
  await owner(pg);
  await pg.exec(seed);
}

/** Made-up October sources for every facts function (and September, for last month's churn). */
async function seedSources() {
  await owner(pg);
  const q = (sql: string, p: unknown[] = []) => pg.query(sql, p);
  // Calls: Agent One booked A1 (showed), A3 (the client sheet says showed and closed; no portal win) and A4 (not marked).
  await pg.exec(`
    INSERT INTO public.ghl_clients VALUES ('locA','Client A','KW');
    INSERT INTO public.ghl_calendars(location_id,calendar_id,name) VALUES ('locA','calMainA','Main Appointment Calendar');
    INSERT INTO public.client_leads(ghl_contact_id,location_id,contact_phone) VALUES ('cA3','locA','+965 5000 0003');
    INSERT INTO public.appointments(ghl_appointment_id,ghl_contact_id,ghl_location_id,calendar_id,booked_at,start_at,status,attended,ghl_source) VALUES
      ('A1','cA1','locA','calMainA','${kw("2026-10-01", "10:00")}','${kw("2026-10-05", "11:00")}','showed',NULL,'third_party'),
      ('A3','cA3','locA','calMainA','${kw("2026-10-03", "10:00")}','${kw("2026-10-07", "13:00")}','confirmed',NULL,'third_party'),
      ('A4','cA4','locA','calMainA','${kw("2026-10-04", "10:00")}','${kw("2026-10-08", "10:00")}','confirmed',NULL,'third_party');`);
  for (const id of ["A1", "A4"])
    await q("INSERT INTO mahara_console.attempts VALUES('production',$1,'agent1@example.test',$2)", [`t-${id}`,
      JSON.stringify({ locationId: "locA", appointmentId: id, disposition: { outcome: "BOOKED" }, bookingVerification: { id, verifiedAt: "2026-10-01T06:00:00Z" } })]);
  await q("INSERT INTO mahara_reporting.sheet_snapshots VALUES('production','locA','sheetA',$1)", [JSON.stringify({ sheetId: "sheetA", currency: "USD",
    rows: [{ caller: "Agent One", phone: "50000003", meeting: String(Date.parse(kw("2026-10-07", "13:00"))), show: "Y", closed: "Y", value: "5000" }] })]);
  // Clients: Client L lost in September; three cards in Success One's book; Meta and bookings for two of them.
  const roster = (day: string, clients: [string, string, string][]) =>
    q("INSERT INTO public.cockpit_csm_sources(table_name,source_id,data) VALUES('rosterDays',$1,$2)", [`roster:${day}`,
      JSON.stringify({ day, clients: clients.map(([key, name, status]) => ({ key, name, status, paying: true })) })]);
  const abc: [string, string, string][] = [["KA", "Client A", "Active"], ["KB", "Client B", "Active"], ["KC", "Client C", "Active"]];
  await roster("2026-08-31", [...abc, ["KL", "Client L", "Active"]]);
  await roster("2026-09-30", [...abc, ["KL", "Client L", "Stopped"]]);
  await roster("2026-10-10", [...abc, ["KL", "Client L", "Stopped"]]);
  for (const [k, n, launch] of [["KA", "Client A", "2026-06-01"], ["KB", "Client B", "2026-09-20"], ["KC", "Client C", "2026-01-01"], ["KL", "Client L", "2026-08-01"]])
    await q("INSERT INTO public.cockpit_csm_sources(table_name,source_id,data) VALUES('clients',$1,$2)", [`card:${k}`,
      JSON.stringify({ taskId: k, name: n, csmAssigned: "Success One", launchDate: launch })]);
  await q("INSERT INTO public.cockpit_csm_sources(table_name,source_id,data) VALUES('churnEvents','churn:KL',$1)",
    [JSON.stringify({ key: "KL", kind: "lost", from: "Active", to: "Stopped", day: "2026-09-20", name: "Client L" })]);
  await pg.exec(`
    INSERT INTO public.cockpit_board_clients(location_id,clickup_id,client_name,service_mode,ad_account_ids) VALUES
      ('locA','KA','Client A','DFY',ARRAY['111']),('locB','KB','Client B','DFY',ARRAY['222']);
    INSERT INTO public.cockpit_meta_ad_days(account_id,day,ad_id,spend,spend_usd,leads) VALUES
      ('111','2026-10-05','ad-1',200,200,16),('111','2026-10-12','ad-1',100,100,8),('222','2026-10-06','ad-2',120,120,10);`);
  for (let d = 1; d <= 17; d++) {
    const day = `2026-10-${String(d).padStart(2, "0")}`;
    await q("INSERT INTO public.cockpit_client_days VALUES('locA',$1,$2),('locB',$1,$3)", [day, d === 6 ? 2 : 0, d === 9 ? 1 : 0]);
  }
  await q("INSERT INTO public.cockpit_creative_sources(table_name,source_id,data) VALUES('creativeTasks','s1',$1)",
    [JSON.stringify({ kind: "script", status: "complete", assignees: ["Strategist One"], clients: ["Client A"], createdAt: Date.parse("2026-09-10T10:00:00Z") })]);
  // Sales: D1 set and closed by the closer and paid in full; D2's form names Setter One, the intro was the closer's; D3 is 95% paid.
  await pg.exec(`
    INSERT INTO public.cockpit_sales_reps VALUES
      ('${REP_CLOSER}','Closer One','ghlCloser1',ARRAY['Closer One']),('${REP_SETTER}','Setter One','ghlSetter1',ARRAY['Setter One']);
    INSERT INTO public.cockpit_sales_people VALUES ('closer1@example.test','${REP_CLOSER}'),('setter1@example.test','${REP_SETTER}');
    INSERT INTO public.cockpit_sales_settings VALUES ('rooms','{"live_calendar_id":"calLiveRoom","test_calendar_id":""}');
    INSERT INTO public.cockpit_sales_appointments VALUES
      ('i1','c1','calIntro','intro','${kw("2026-10-03", "10:00")}','showed','ghlCloser1','Closer One'),
      ('i2','c2','calIntro','intro','${kw("2026-10-07", "10:00")}','showed','ghlCloser1','Closer One'),
      ('i3','c3','calIntro','intro','${kw("2026-10-09", "10:00")}','showed','ghlCloser1','Closer One');
    INSERT INTO public.cockpit_sales_deals(response_id,submitted_at,closer,setter,contact_id,client_name,business_name,payment_structure,cash_collected,contracted_revenue,voided) VALUES
      ('D1','${kw("2026-10-05", "15:00")}','Closer One','Closer One','c1','Contact One','Client One Co','Paid in full',5500,5500,false),
      ('D2','${kw("2026-10-08", "15:00")}','Closer One','Setter One','c2','Contact Two','Client Two Co','Split pay',500,6000,false),
      ('D3','${kw("2026-10-10", "15:00")}','Closer One','Closer One','c3','Contact Three','Client Three Co','Paid in full',4750,5000,false);
    INSERT INTO public.cockpit_deal_payments(payment_id,deal_response_id,day,usd,rail,kind,matched_by,payer) VALUES
      ('whop:pay_d1','D1','2026-10-06',5500,'whop','remainder','whop_link','Payer One'),
      ('tap:chg_d2','D2','2026-10-09',500,'tap','deposit','email','Payer Two'),
      ('bank:9003','D3','2026-10-11',4750,'bank','deposit','card','Payer Three');
    INSERT INTO public.cockpit_sections(key,label,computed_at,payload,sources) VALUES('money','Money',now(),
      '{"attribution":{"transactions":[],"dealLedger":{"rows":3,"usd":10750,"from":"2025-11-01"}}}','[]');`);
}

/** The browser's rpc door, played against PGlite as the CEO. */
const ARG_TYPES: Record<string, string> = { p: "jsonb", p_month: "date", p_patch: "jsonb" };
const calls: { name: string; args: any; error: string | null }[] = [];
async function pgRpc(name: string, args: Record<string, unknown> = {}) {
  await actor(pg, CEO);
  const keys = Object.keys(args);
  const sql = `SELECT public.${name}(${keys.map((k, i) => `${k} => $${i + 1}::${ARG_TYPES[k] ?? "text"}`).join(", ")}) AS r`;
  try {
    const r = await pg.query<{ r: unknown }>(sql, keys.map(k => (ARG_TYPES[k] === "jsonb" ? JSON.stringify(args[k]) : args[k])));
    calls.push({ name, args, error: null });
    return { data: r.rows[0]?.r ?? null, error: null };
  } catch (e) {
    calls.push({ name, args, error: (e as Error).message });
    return { data: null, error: { message: (e as Error).message } };
  } finally {
    await owner(pg);
  }
}
const rpcClient = { rpc: pgRpc } as any;

// --- The cockpit's own client, its rpc answered by PGlite -----------------

// An earlier file in the same bun process may leave "../src/lib/supabase"
// mocked with a client that has no Auth: put the module's own exports back.
if (!((await import("../src/lib/supabase")).supabase as any)?.auth) {
  const { getCockpitSupabaseClient } = await import("../src/auth/SupabaseAuthProvider");
  mock.module("../src/lib/supabase", () => ({
    supabase: getCockpitSupabaseClient(),
    STILLS_BUCKET: "editor-stills",
    IDEA_STILLS_BUCKET: "ideation-stills",
    AD_VIDEOS_BUCKET: "ad-videos",
  }));
}
const { supabase } = await import("../src/lib/supabase");
const sb = supabase as any;
const realRpc = sb.rpc;
const realGetSession = sb.auth.getSession;
sb.rpc = (name: string, args: any = {}) => pgRpc(name, args);
sb.auth.getSession = async () => ({ data: { session: { access_token: "test-token" } }, error: null });

// --- A DOM ------------------------------------------------------------------

const { Window } = await import("happy-dom");
const win = new Window({ url: "https://cockpit.test/ceo?tab=team" });
const DOM: string[] = ["window", "document", "navigator", "localStorage", "HTMLElement", "HTMLInputElement", "HTMLButtonElement",
  "HTMLTextAreaElement", "HTMLSelectElement", "Element", "Node", "Event", "InputEvent", "MouseEvent", "KeyboardEvent", "PointerEvent",
  "FocusEvent", "MutationObserver", "ResizeObserver", "DocumentFragment", "Text", "getComputedStyle", "requestAnimationFrame",
  "cancelAnimationFrame", "IS_REACT_ACT_ENVIRONMENT",
  ...Object.getOwnPropertyNames(win).filter(k => /^(HTML|SVG)\w*Element$|^(CustomEvent|DOMRect|NodeFilter|Range)$/.test(k))];
const globalsBefore = new Map(DOM.map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
for (const k of DOM)
  Object.defineProperty(globalThis, k, { configurable: true, writable: true,
    value: k === "window" ? win : k === "IS_REACT_ACT_ENVIRONMENT" ? true
      : typeof (win as any)[k] === "function" && /^[a-z]/.test(k) ? (win as any)[k].bind(win) : (win as any)[k] });
const realError = console.error;
console.error = (...args: unknown[]) => {
  if (typeof args[0] === "string" && /not wrapped in act|DialogContent|Missing `Description`|useLayoutEffect does nothing/.test(args[0])) return;
  realError(...args);
};
const { MotionGlobalConfig } = await import("framer-motion");
const skipBefore = MotionGlobalConfig.skipAnimations;
MotionGlobalConfig.skipAnimations = true;

const { createRoot } = await import("react-dom/client");
const { act, createElement } = await import("react");
const { PayMonthCard } = await import("../src/pages/ceo/pay/PayMonthCard");
const { churnCards } = await import("../src/pages/ceo/pay/PayConfirmDialog");
const { confirmFor } = await import("../src/pages/ceo/pay/payCopy");
const { readPayMonth, readPayPlans } = await import("../src/lib/ceoPayClient");
type PayMonth = import("../src/types/ceo/payPlan").PayMonth;
type PayPlansList = import("../src/types/ceo/payPlan").PayPlansList;

const host = win.document.createElement("div");
win.document.body.append(host);
const root = createRoot(host as any);
async function flush(times = 10) {
  for (let i = 0; i < times; i++) await act(async () => { await new Promise(r => setTimeout(r, 0)); });
}
const text = (el: any = win.document.body) => (el?.textContent ?? "") as string;
const receipt = (name: string) =>
  Array.from(host.querySelectorAll("#team-pay-month details") as ArrayLike<any>).find(d => text(d.querySelector("summary")).includes(name)) as any;
const buttons = (label: string, within: any = host) =>
  Array.from(within.querySelectorAll("button") as ArrayLike<any>).filter(b => (b.textContent ?? "").trim() === label);
async function click(el: any) {
  await act(async () => { el.click(); });
  await flush();
}

let plans: PayPlansList;
async function showCard() {
  // A fresh card each time: it reads its month on mount.
  await act(async () => root.render(null));
  await act(async () => root.render(createElement(PayMonthCard, { plans, onPlansChanged: () => {}, onRosterChanged: () => {}, today: "2026-10" })));
  await flush(14);
}
const person = (m: PayMonth, name: string) => {
  const p = m.people.find(x => x.name === name);
  if (!p) throw new Error(`${name} is not in ${m.month}`);
  return p;
};

beforeAll(async () => {
  await buildDb();
  await seedSources();
  plans = await readPayPlans(rpcClient);
}, 180000);

afterAll(async () => {
  await act(async () => root.unmount());
  await pg?.close();
  globalThis.fetch = realFetch;
  console.error = realError;
  MotionGlobalConfig.skipAnimations = skipBefore;
  sb.rpc = realRpc;
  sb.auth.getSession = realGetSession;
  for (const [k, d] of globalsBefore)
    if (d) Object.defineProperty(globalThis, k, d);
    else delete g[k];
  envs.forEach((e, i) => {
    for (const [k, v] of Object.entries(envBefore[i]))
      if (v === undefined) delete e[k];
      else e[k] = v;
  });
  await win.happyDOM.close();
  expect(strayFetches).toEqual([]);
});

describe("the SQL month through the browser's client and onto the card", () => {
  test("the real month parses with the client's schemas, and every person it works out has a receipt", async () => {
    const m = await readPayMonth(rpcClient, { month: "2026-10" });
    expect(m.people.map(p => p.name)).toEqual(["Agent One", "Buyer One", "Closer One", "Setter One", "Strategist One", "Success One", "Systems One"]);
    expect(m.notOnAPlan.map(n => n.name)).toEqual(["Editor One"]);
    expect(m.closed).toBe(false);
    await showCard();
    for (const p of m.people) expect(receipt(p.name)).toBeTruthy();
    expect(text(host)).toContain('Editor One, Video editor: No pay plan for the role "Video editor"');
    // The media buyer's band, from the real ads facts: $420 / 34 leads.
    expect(text(receipt("Buyer One"))).toContain("$12.35 · measured");
    expect(person(m, "Buyer One")).toMatchObject({ totalUsd: 900, parts: [{ key: "cpl_bonus", amountUsd: 200, band: { index: 2 } }] });
  });

  test("the closer is paid both lines on the deal he set and closed", async () => {
    const m = await readPayMonth(rpcClient, { month: "2026-10" });
    const closer = person(m, "Closer One");
    expect(closer.commission.map(l => [l.basis, l.baseUsd, l.amountUsd, l.state])).toEqual([
      ["closed_cash", 10750, 1075, "measured"],
      ["set_cash", 10250, 512.5, "waiting"],
    ]);
    expect(closer.commission[1].evidence).toEqual(["D1", "D3"]);
    expect(closer.parts.map(p => [p.key, p.amountUsd, p.state])).toEqual([["pif", 250, "waiting"]]);
  });

  test("a close seen only on a client sheet is confirmed from the receipt, through the real function", async () => {
    await showCard();
    const agent = receipt("Agent One");
    expect(text(agent)).toContain("1 close on the client sheet only waits for your confirmation.");
    await click(buttons("Confirm close", agent)[0]);
    await flush(14);
    expect(calls.filter(c => c.name === "cockpit_ceo_pay_confirm").at(-1)).toMatchObject({
      args: { p: { month: "2026-10", key: "close:A3", value: { confirmed: true } } }, error: null });
    expect(text(receipt("Agent One"))).toContain("$20 × 1 · 1 confirmed client close.");
  });

  test("last month's churn asks with the server's own proposal: the lost card ticked", async () => {
    const m = await readPayMonth(rpcClient, { month: "2026-10" });
    const part = person(m, "Strategist One").parts.find(p => p.key === "churn_bonus");
    expect(part?.input?.state).toBe("missing");
    const target = confirmFor(part as any, ids["Strategist One"], "2026-10", null);
    expect(target).toMatchObject({ kind: "churn", key: "logo_churn", month: "2026-09" });
    expect(churnCards(part?.input?.proposal).map(c => [c.clickupId, c.candidate])).toEqual([["KL", false]]);
    expect((part?.input?.proposal as any)?.proposal).toMatchObject({ lost: 1, activeAtStart: 4 });
  });

  test("a setter the sources disagree on can be confirmed from the receipts it waits on", async () => {
    // The facts give setWaiting as response ids (["D2"]); the month names each deal as the receipt asks about it.
    const m = await readPayMonth(rpcClient, { month: "2026-10" });
    const wait = { responseId: "D2", business: "Client Two Co", state: "waiting", form: "Setter One", intro: "Closer One" };
    expect(person(m, "Closer One").commission[1].waiting).toEqual([wait]);
    expect(person(m, "Setter One").commission[0].waiting).toEqual([wait]);
    await showCard();
    for (const who of ["Closer One", "Setter One"]) {
      expect(buttons("Confirm setter", receipt(who)).length).toBe(1);
      expect(text(receipt(who))).toContain("Client Two Co: the closer form says Setter One, the last intro before signing says Closer One.");
    }
  });

  test("a paid-in-full at 90 to 99% can be confirmed from the receipt", async () => {
    // The facts give pifWaiting as response ids (["D3"]); the month names the deal and what it is short.
    const m = await readPayMonth(rpcClient, { month: "2026-10" });
    expect(person(m, "Closer One").parts[0].input?.waiting).toEqual([
      { responseId: "D3", business: "Client Three Co", shortUsd: 250, day: "2026-10-11" }]);
    await showCard();
    const closer = receipt("Closer One");
    expect(buttons("Paid in full", closer).length).toBe(1);
    expect(buttons("Not yet", closer).length).toBe(1);
    expect(text(closer)).toContain("Client Three Co, $250 short of its contract:");
  });

  test("the floor never reads above what is known", async () => {
    // What a waiting line or part has already settled is known.
    const m = await readPayMonth(rpcClient, { month: "2026-10" });
    const closer = person(m, "Closer One");
    expect(closer.knownUsd).toBe(1500 + 1075 + 512.5 + 250);
    expect(closer.lowestUsd).toBeLessThanOrEqual(closer.knownUsd);
    // The receipt keeps the cents the server pays: $512.50, never $513.
    await showCard();
    expect(text(receipt("Closer One"))).toContain("5% of $10,250");
    expect(text(receipt("Closer One"))).toContain("$512.50");
    expect(text(receipt("Closer One"))).not.toContain("$513");
  });

  test("confirming the setter and the paid in full from the receipts settles the closer's month", async () => {
    await showCard();
    // The intro was the closer's, so he is offered first; the confirmation goes through the real function.
    await click(buttons("Confirm setter", receipt("Closer One"))[0]);
    await flush(14);
    expect(calls.filter(c => c.name === "cockpit_ceo_pay_confirm").at(-1)).toMatchObject({
      args: { p: { month: "2026-10", key: "setter:D2", value: { personId: ids["Closer One"] } } }, error: null });
    await click(buttons("Paid in full", receipt("Closer One"))[0]);
    await flush(14);
    expect(calls.filter(c => c.name === "cockpit_ceo_pay_confirm").at(-1)).toMatchObject({
      args: { p: { month: "2026-10", key: "pif:D3", value: { earned: true } } }, error: null });
    const m = await readPayMonth(rpcClient, { month: "2026-10" });
    const closer = person(m, "Closer One");
    expect(closer.commission.map(l => [l.basis, l.baseUsd, l.amountUsd, l.state])).toEqual([
      ["closed_cash", 10750, 1075, "measured"],
      ["set_cash", 10750, 537.5, "measured"],
    ]);
    expect(closer.parts.map(p => [p.key, p.amountUsd, p.state])).toEqual([["pif", 500, "known"]]);
    // October is still running: in progress, with every figure in.
    expect(closer.status).toBe("in_progress");
    expect(closer.totalUsd).toBe(1500 + 1075 + 537.5 + 500);
    expect(person(m, "Setter One").commission[0]).toMatchObject({ state: "measured", amountUsd: 0 });
  });

  test("an approved month is shown as approved, with the change since and the adjustment that carries it", async () => {
    await showCard();
    await click(buttons("September")[0]);
    await flush(14);
    await click(buttons("Approve September")[0]);
    const dialog = win.document.querySelector('[role="dialog"]') as any;
    if (dialog) await click(buttons("Approve September", dialog)[0]);
    else {
      // Radix portals do not mount when another file loaded them before a DOM existed: approve through the client.
      const m = await readPayMonth(rpcClient, { month: "2026-09" });
      const { approvePayMonth } = await import("../src/lib/ceoPayClient");
      const { approvePayload, approvable } = await import("../src/pages/ceo/pay/payCopy");
      await approvePayMonth(rpcClient, approvePayload(m, approvable(m)));
    }
    const sep = await readPayMonth(rpcClient, { month: "2026-09" });
    expect(person(sep, "Closer One").status).toBe("approved");
    await owner(pg);
    await pg.exec(`
      INSERT INTO public.cockpit_sales_deals(response_id,submitted_at,closer,setter,contact_id,client_name,business_name,payment_structure,cash_collected,contracted_revenue,voided)
        VALUES('D9','2026-09-10T12:00:00+03:00','Closer One','Closer One','c9','Contact Nine','Client Nine Co','Paid in full',2000,2000,false);
      INSERT INTO public.cockpit_deal_payments(payment_id,deal_response_id,day,usd,rail,kind,matched_by,payer)
        VALUES('whop:pay_d9','D9','2026-09-12',2000,'whop','deposit','whop_link','Payer Nine');`);
    await showCard();
    await click(buttons("September")[0]);
    await flush(14);
    const closer = receipt("Closer One");
    expect(text(closer)).toMatch(/Approved \d{1,2} \w{3} by the CEO at \$1,500\./);
    expect(text(closer)).toContain("Changed since approval: +$300");
    expect(buttons("Add to October", closer).length).toBe(1);
  });

  test("a deal source that fails after approval reads as not known on the receipt, never a clawback", async () => {
    await owner(pg);
    await pg.exec("ALTER TABLE public.cockpit_sales_reps RENAME TO cockpit_sales_reps_away");
    try {
      const sep = await readPayMonth(rpcClient, { month: "2026-09" });
      expect(person(sep, "Closer One").sinceApproval).toMatchObject({ deltaUsd: null, unread: true });
      await showCard();
      await click(buttons("September")[0]);
      await flush(14);
      const closer = receipt("Closer One");
      expect(text(closer)).toContain("Some figures could not be read since approval, so the change is not known");
      expect(text(closer)).not.toContain("−$");
      expect(buttons("Add to October", closer).length).toBe(0);
    } finally {
      await owner(pg);
      await pg.exec("ALTER TABLE public.cockpit_sales_reps_away RENAME TO cockpit_sales_reps");
    }
  });

  test("with no deal ledger written, the closer's cash lines are missing, never a measured $0", async () => {
    // Last: it empties the ledger. First the Money section as published before the ledger existed (no attribution.dealLedger).
    await owner(pg);
    await pg.exec("UPDATE public.cockpit_sections SET payload = payload #- '{attribution,dealLedger}' WHERE key='money'");
    let m = await readPayMonth(rpcClient, { month: "2026-10" });
    expect((m.facts as any).sales).toMatchObject({ ledgerReady: false });
    let closer = person(m, "Closer One");
    expect(closer.commission.map(l => l.state)).toEqual(["missing", "missing"]);
    expect(closer.parts.map(p => [p.key, p.state])).toEqual([["pif", "missing"]]);
    expect(closer.totalUsd).toBeNull();
    // September is closed: base only must not read ready.
    expect(person(await readPayMonth(rpcClient, { month: "2026-09" }), "Closer One").sinceApproval).toMatchObject({ deltaUsd: null });
    await owner(pg);
    await pg.exec("DELETE FROM public.cockpit_deal_payments; DELETE FROM public.cockpit_sections WHERE key='money';");
    m = await readPayMonth(rpcClient, { month: "2026-10" });
    expect((m.facts as any).sales.cashThrough).toBeNull();
    closer = person(m, "Closer One");
    expect(closer.commission.map(l => [l.state, l.note])).toEqual([
      ["missing", "The money refresh has not run: no deal cash is known yet."],
      ["missing", "The money refresh has not run: no deal cash is known yet."]]);
    expect(closer.totalUsd).toBeNull();
  });
});
