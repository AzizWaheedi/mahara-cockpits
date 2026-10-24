import { expect, test } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { actor, cockpitTestDb, member, migration, owner } from "./lib/cockpitTestDb";

// supabase/migrations/20261023x_billing_balances.sql, 20261023y_billing_balance_write.sql and
// 20261024p_billing_payment_exclusions.sql against canonical SQL (hw-notes/billing-pending/PLAN.md
// 3.4): the tables, the helpers, the gated read and the write (confirm, withdraw, link, unlink,
// exclude, unexclude). Made-up clients, people, deals and payment ids only, except the 13e and
// 13f seed tests, which use the three ids the 20261024p seed names (a card, a deal and a Whop
// payment, already in scripts/fixtures/billingBalances20261023.ts) under a made-up name; no live
// credentials.

const CEO = "00000000-0000-4000-8000-0000000000c1";
const CSM = "00000000-0000-4000-8000-0000000000c2";
const OTHER_CSM = "00000000-0000-4000-8000-0000000000c3";
const BUYER = "00000000-0000-4000-8000-0000000000c4";
const FINANCE = "00000000-0000-4000-8000-0000000000c5";
const CALLS = "00000000-0000-4000-8000-0000000000c6";
const GONE_SEAT = "00000000-0000-4000-8000-0000000000c7";

const X = "20261023x_billing_balances.sql";
const Y = "20261023y_billing_balance_write.sql";
const P = "20261024p_billing_payment_exclusions.sql";
const KICKOFF_PAYMENT_REF = "75e97e7d-4c19-437a-b4b8-67570c29344f";

function extract(file: string, pattern: RegExp): string {
  const hit = migration(file).match(pattern);
  if (!hit) throw new Error(`Canonical definition missing in ${file}: ${pattern}`);
  return hit[0];
}

/** 20261009a without its schedule block (pg_cron, pg_net and the vault are not in the test engine), then 20261009h. */
function nativeSync(): string {
  const text = migration("20261009a_billing_native_sync.sql");
  const start = text.indexOf("-- cron:begin");
  const end = text.indexOf("-- cron:end");
  if (start < 0 || end < start) throw new Error("The schedule block is missing its markers");
  return `${text.slice(0, start)}${text.slice(end + "-- cron:end".length)}\n${migration("20261009h_billing_browser_writes_closed.sql")}`;
}

/** The ClickUp write-back queue (20261009f) and the billing write-back trigger (20261009j). */
function billingWriteback(): string {
  const f = "20261009f_clickup_writeback_native.sql";
  return [
    extract(f, /CREATE TABLE IF NOT EXISTS public\.cockpit_clickup_writeback_queue\([\s\S]*?\n\);/),
    "ALTER TABLE public.cockpit_clickup_writeback_queue ENABLE ROW LEVEL SECURITY;",
    "REVOKE ALL ON public.cockpit_clickup_writeback_queue FROM PUBLIC,anon,authenticated;",
    "GRANT SELECT,INSERT,UPDATE ON public.cockpit_clickup_writeback_queue TO service_role;",
    extract(f, /CREATE OR REPLACE FUNCTION public\.cockpit_clickup_writeback_audit\(\)[\s\S]*?END \$\$;/),
    extract(f, /DROP TRIGGER IF EXISTS cockpit_clickup_writeback_queue_audit_insert[\s\S]*?EXECUTE FUNCTION public\.cockpit_clickup_writeback_audit\(\);/),
    migration("20261009j_billing_clickup_writeback.sql"),
  ].join("\n");
}

async function schema(db: PGlite, beforeX?: string) {
  for (const name of ["cockpit_client_billing_days"])
    await db.exec(extract("20260919_cockpit_core.sql", new RegExp(`create table if not exists public\\.${name} \\([\\s\\S]*?\\n\\);`, "i")));
  await db.exec(extract("20260919b_people.sql", /create table if not exists public\.cockpit_people \([\s\S]*?\n\);/i));
  await db.exec("ALTER TABLE public.cockpit_people ENABLE ROW LEVEL SECURITY; REVOKE ALL ON public.cockpit_people FROM anon, authenticated;");
  await db.exec(migration("20260921c_bank_statements.sql"));
  await db.exec(extract("20260921d_cockpit_metrics.sql", /create table if not exists public\.cockpit_sections \([\s\S]*?\n\);/i));
  await db.exec("ALTER TABLE public.cockpit_sections ENABLE ROW LEVEL SECURITY; REVOKE ALL ON public.cockpit_sections FROM anon, authenticated;");
  await db.exec(migration("20260921e_tap_charges.sql"));
  await db.exec(migration("20260923a_client_billing.sql"));
  await db.exec(extract("20260926m_cockpit_csm_state.sql", /CREATE OR REPLACE FUNCTION public\.cockpit_client_allowed\([\s\S]*?END \$\$;/));
  await db.exec("REVOKE ALL ON FUNCTION public.cockpit_client_allowed(text) FROM PUBLIC, anon; GRANT EXECUTE ON FUNCTION public.cockpit_client_allowed(text) TO authenticated, service_role;");
  // The hand-logged ledger's tables (20261009a declares variables of their row types) and its text cleaner.
  for (const name of ["cockpit_manual_payment_state", "cockpit_manual_payments"])
    await db.exec(extract("20260927d_cockpit_manual_payments_access.sql", new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${name}\\([\\s\\S]*?\\n\\);`)));
  await db.exec(extract("20260927d_cockpit_manual_payments_access.sql", /CREATE OR REPLACE FUNCTION public\.cockpit_manual_clean_text\([\s\S]*?\$\$;/));
  await db.exec(nativeSync());
  await db.exec(billingWriteback());
  // Signed deals (the B2B closed_deals mirror).
  await db.exec(extract("20260924a_sales_cockpit.sql", /create table if not exists public\.cockpit_sales_deals \([\s\S]*?\n\);/i));
  await db.exec("ALTER TABLE public.cockpit_sales_deals ENABLE ROW LEVEL SECURITY; REVOKE ALL ON public.cockpit_sales_deals FROM anon, authenticated;");
  await db.exec(migration("20261005a_client_onboarding.sql"));
  for (const t of ["cockpit_csm_calls", "cockpit_csm_call_forms"])
    await db.exec(extract("20261011c_csm_call_store.sql", new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${t}\\([\\s\\S]*?\\n\\);`)));
  await db.exec("ALTER TABLE public.cockpit_csm_calls ENABLE ROW LEVEL SECURITY; ALTER TABLE public.cockpit_csm_call_forms ENABLE ROW LEVEL SECURITY; REVOKE ALL ON public.cockpit_csm_calls, public.cockpit_csm_call_forms FROM PUBLIC, anon, authenticated;");
  await db.exec(extract("20261011v_cockpit_invoices.sql", /CREATE TABLE IF NOT EXISTS public\.cockpit_invoices\([\s\S]*?\n\);/));
  await db.exec(extract("20261015a_cockpit_invoice_whop_links.sql", /ALTER TABLE public\.cockpit_invoices\n ADD COLUMN IF NOT EXISTS checkout_source[\s\S]*?;/));
  await db.exec(extract("20261022a_cockpit_invoice_tax_id.sql", /ALTER TABLE public\.cockpit_invoices\n ADD COLUMN IF NOT EXISTS client_tax_id[\s\S]*?;/));
  await db.exec("ALTER TABLE public.cockpit_invoices ENABLE ROW LEVEL SECURITY; REVOKE ALL ON public.cockpit_invoices FROM PUBLIC, anon, authenticated;");
  await db.exec(migration("20261022b_ecom_payments.sql"));
  await db.exec(extract("20260927i_cockpit_finance_refresh.sql", /CREATE TABLE IF NOT EXISTS public\.cockpit_finance_client_aliases\([\s\S]*?\n\);/));
  for (const col of ["active", "source_refresh_id"])
    await db.exec(extract("20260927i_cockpit_finance_refresh.sql", new RegExp(`ALTER TABLE public\\.cockpit_client_payments ADD COLUMN IF NOT EXISTS ${col}[^;]*;`)));
  await db.exec("ALTER TABLE public.cockpit_finance_client_aliases ENABLE ROW LEVEL SECURITY; REVOKE ALL ON public.cockpit_finance_client_aliases FROM anon, authenticated;");
  await db.exec(extract("20261018c_money_ties_deal_payments.sql", /CREATE TABLE IF NOT EXISTS public\.cockpit_deal_payments \([\s\S]*?\n\);/));
  await db.exec("ALTER TABLE public.cockpit_deal_payments ENABLE ROW LEVEL SECURITY; REVOKE ALL ON public.cockpit_deal_payments FROM PUBLIC, anon, authenticated;");
  await db.exec(extract("20261009a_cockpit_team_hours.sql", /CREATE OR REPLACE FUNCTION public\.cockpit_hours_refuse_delete\(\)[\s\S]*?\$\$;/));
  // The billing log's browser policy as it is live (20260924r, narrowed for team-only seats by 20261017b):
  // every active seat reads every row. x narrows it for its four kinds.
  await db.exec(extract("20260924q_ceo_and_team_access.sql", /CREATE OR REPLACE FUNCTION public\.cockpit_has_active_seat\(\)[\s\S]*?\$\$;/));
  await db.exec(`GRANT EXECUTE ON FUNCTION public.cockpit_has_active_seat() TO authenticated;
    GRANT SELECT ON public.cockpit_billing_events TO authenticated;
    CREATE POLICY cockpit_billing_events_seat ON public.cockpit_billing_events FOR ALL TO authenticated
      USING (public.cockpit_has_active_seat() OR public.cockpit_is_ceo())
      WITH CHECK (public.cockpit_has_active_seat() OR public.cockpit_is_ceo());`);
  // The live database as another build may have left it before x runs.
  if (beforeX) await db.exec(beforeX);
  await db.exec(migration(X));
  await db.exec(migration(Y));
  await db.exec(migration(P));
}

const MONEY = {
  attribution: {
    transactions: [
      { id: "whop:pay_u1", day: "2026-08-24", rail: "whop", direction: "in", side: "unattributed", usd: 500, currency: "USD", amount: 500, payerName: "Payer Person", payerEmail: "payer@example.test" },
      { id: "bank:9001", day: "2026-08-25", rail: "bank", direction: "in", side: "unattributed", usd: 900, currency: "KWD", amount: 276, payerName: "Bank Line" },
      { id: "whop:pay_u2", day: "2026-08-26", rail: "whop", direction: "in", side: "unattributed", usd: 3, currency: "USD", amount: 3, payerName: "Tiny Payer" },
      { id: "whop:pay_out", day: "2026-08-27", rail: "whop", direction: "out", side: "out", usd: 200, currency: "USD", amount: 200, payerName: "Refund Payer" },
      { id: "whop:pay_a1", day: "2026-09-01", rail: "whop", direction: "in", side: "front_end", usd: 500, currency: "USD", amount: 500, payerName: "Acme Payer" },
    ],
  },
};

/** A day N days before today in Kuwait, as SQL. */
const ago = (n: number) => `((now() AT TIME ZONE 'Asia/Kuwait')::date - ${n})`;

async function fixture(
  opts: { supabaseDefaultPrivileges?: boolean; beforeX?: string } = {},
) {
  const db = await cockpitTestDb(opts);
  await schema(db, opts.beforeX);
  await member(db, CEO, "aziz@maharamedia.com", []);
  await member(db, CSM, "sara@tests.invalid", ["csm"]);
  await member(db, OTHER_CSM, "omar@tests.invalid", ["csm"]);
  await member(db, BUYER, "nada@tests.invalid", ["media_buyer"]);
  await member(db, FINANCE, "fin@tests.invalid", ["finance"]);
  await member(db, CALLS, "agent@tests.invalid", ["call_center"]);
  await member(db, GONE_SEAT, "left@tests.invalid", ["csm"], false);
  await owner(db);
  await db.exec(`
    UPDATE cockpit_members SET clients=ARRAY['Acme'], name='Sara Test' WHERE email='sara@tests.invalid';
    UPDATE cockpit_members SET clients=ARRAY['Beta Co'], name='Omar Test' WHERE email='omar@tests.invalid';
    UPDATE cockpit_members SET name='Fin Test' WHERE email='fin@tests.invalid';
    INSERT INTO cockpit_people(name,email,added_by) VALUES('Aziz Waheedi','aziz@maharamedia.com','fixture');
    INSERT INTO cockpit_sync_state(key,last_ok_at,ok) VALUES('billing-sync','2026-10-23T13:07:00Z',true),('csm-ghl-calls','2026-10-23T13:01:00Z',true);
    INSERT INTO cockpit_sections(key,label,computed_at,payload) VALUES('money','Money','2026-10-23T13:09:00Z','${JSON.stringify(MONEY)}');

    INSERT INTO cockpit_billing_accounts(clickup_task_id,client_name,task_url,stage,stage_group,client_status,payment_method,payment_plan,next_payment_usd,next_payment_date,ltv_field_usd,paused_on,churn_date,csm) VALUES
      ('task_a','Acme','https://app.clickup.com/t/task_a','Active','active','Active','Tap link','Paid in full (90 days)',5500,'2026-10-25',2500,NULL,NULL,'Sara'),
      ('task_b','Beta Co','https://app.clickup.com/t/task_b','Active','active','Active','Whop link','Split Pay (2x payments)',3000,'2026-10-15',3000,NULL,NULL,'Omar'),
      ('task_g','Ghost Co',NULL,'GHOSTED','pipeline','GHOSTED',NULL,NULL,NULL,NULL,500,NULL,NULL,NULL),
      ('task_gp','Paused Ghost',NULL,'GHOSTED','pipeline','GHOSTED',NULL,NULL,NULL,NULL,6000,NULL,NULL,NULL),
      ('task_s','Sales Back',NULL,'SALES TEAM TO CONTACT','sales','SALES TEAM TO CONTACT',NULL,NULL,NULL,NULL,200,NULL,NULL,NULL),
      ('task_x','Stopped Co',NULL,'Stopped','gone','Stopped',NULL,NULL,NULL,NULL,NULL,NULL,'2026-09-01',NULL),
      ('task_p','Paused Co',NULL,'Paused','paused','Paused',NULL,NULL,NULL,NULL,NULL,'2026-10-01',NULL,NULL),
      ('task_i','[internal test] Mahara',NULL,'Active','active','Active',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
      ('task_pt','Professional Touch Company',NULL,'Active','active','Active',NULL,NULL,4000,'2026-11-29',4000,NULL,NULL,NULL),
      ('task_r','Render',NULL,'Ready For Launch🚀','pipeline','Ready For Launch🚀',NULL,NULL,NULL,NULL,3700,NULL,NULL,NULL),
      ('task_c','Castello Industries',NULL,'Active','active','Active',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
      ('task_abc','Abcde',NULL,'Active','active','Active',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
      ('task_d1','Delta Build',NULL,'Active','active','Active',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
      ('task_d2','Delta Build Group',NULL,'Brand Blueprint Booked♠️','pipeline','Brand Blueprint Booked♠️',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
      ('task_arc','Arcturus Construction',NULL,'Active','active','Active',NULL,'Monthly',2000,'2026-10-03',2000,NULL,NULL,NULL),
      ('task_m','مدانة العمرانية لﻺستشارات',NULL,'Active','active','Active',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
      ('task_cob','Castello Industries Old Branch',NULL,'Stopped','gone','Stopped',NULL,NULL,NULL,NULL,NULL,NULL,'2026-06-01',NULL);

    INSERT INTO cockpit_finance_client_aliases(source_kind,source_id,task_id,name,aliases,source_record)
      VALUES('client','alias-pt','task_pt','Professional Touch Company','["Brillant Touch Company"]','{}');

    INSERT INTO cockpit_sales_deals(response_id,submitted_at,closer,client_name,business_name,email,payment_structure,cash_collected,contracted_revenue,new_mrr,voided,cash_at_onboarding,second_payment) VALUES
      ('resp_acme_1','2026-04-01T09:00:00Z','Closer One','Contact Alpha','Acme','alpha@example.test','Monthly',500,5000,NULL,false,NULL,NULL),
      ('resp_acme_2','2026-09-01T09:00:00Z','Closer One','Contact Alpha','Acme','alpha@example.test','Paid in full ($6,000)',500,6000,NULL,false,5500,NULL),
      ('resp_void','2026-09-02T09:00:00Z','Closer One','Contact Alpha','Acme','alpha@example.test','Paid in full ($6,000)',500,6000,NULL,true,NULL,NULL),
      ('resp_beta','2026-09-05T09:00:00Z','Closer Two','Contact Beta','Beta Co','beta@example.test','Split Pay (2x payments)',3000,6000,NULL,false,NULL,3000),
      ('resp_ghost','2026-07-01T09:00:00Z','Closer Two','Contact Gamma','Ghost Co','gamma@example.test','Paid in full (90 days)',500,6000,NULL,false,NULL,NULL),
      ('resp_pghost','2026-06-01T09:00:00Z','Closer Two','Contact Delta','Paused Ghost','delta@example.test','Paid in full (90 days)',500,6000,NULL,false,NULL,NULL),
      ('resp_sales','2026-05-04T09:00:00Z','Closer Two','Contact Eps','Sales Back','eps@example.test','Monthly',500,5000,NULL,false,NULL,NULL),
      ('resp_brillant','2026-04-02T09:00:00Z','Closer One','Contact Zeta','Brillant touch company','zeta@example.test','Paid in full',4000,5000,NULL,false,NULL,NULL),
      ('resp_render','2026-07-29T09:00:00Z','Closer One','Contact Eta','Precise Solutions Contracting','eta@example.test','Split Pay (2x payments)',500,6000,NULL,false,NULL,NULL),
      ('resp_castello','2026-08-17T09:00:00Z','Closer One','Contact Theta','Castello Industries Co','theta@example.test','Monthly',500,6000,NULL,false,NULL,NULL),
      ('resp_abc','2026-08-01T09:00:00Z','Closer One','Contact Iota','Abcde Plus','iota@example.test','Monthly',500,6000,NULL,false,NULL,NULL),
      ('resp_delta','2026-09-10T09:00:00Z','Closer One','Contact Kappa','Delta Build Group Kuwait','kappa@example.test','Monthly',500,6000,NULL,false,NULL,NULL),
      ('resp_orphan','2026-08-25T09:00:00Z','Closer Two','Contact Lambda','اكتوروس للتشيد','lambda@example.test','Monthly',500,6000,NULL,false,NULL,NULL),
      ('resp_m','2026-10-02T09:00:00Z','Closer Two','Contact Mu','مدانة العمرانية لﻺستشارات','mu@example.test','Monthly',500,6000,NULL,false,1500,2000),
      ('resp_test','2026-04-01T09:00:00Z','Closer One','Nobody','test',NULL,NULL,NULL,NULL,NULL,false,NULL,NULL),
      ('resp_test2','2026-04-03T09:00:00Z','Closer One','Nobody','Test 2',NULL,NULL,NULL,NULL,NULL,false,NULL,NULL);

    -- The deal ledger and the cards' own payments.
    INSERT INTO cockpit_deal_payments(payment_id,deal_response_id,day,usd,rail,kind,deposit_usd,matched_by,active) VALUES
      ('whop:pay_a1','resp_acme_2','2026-09-01',500,'whop','deposit',500,'deal_id',true),
      ('tap:chg_a2','resp_acme_2','2026-09-10',1000,'tap','remainder',0,'card_payer',true),
      ('whop:pay_a5','resp_acme_1','2026-09-15',300,'whop','remainder',0,'ceo',true),
      ('whop:pay_a7','resp_acme_2','2026-09-21',400,'whop','remainder',0,'deal_id',false),
      ('whop:pay_b1','resp_beta','2026-09-05',3000,'whop','deposit',3000,'deal_id',true),
      ('whop:pay_r1','resp_render','2026-07-30',500,'whop','deposit',500,'deal_id',true);
    INSERT INTO cockpit_client_payments(payment_id,clickup_task_id,client_name,day,usd,rail,side,kind,active) VALUES
      ('whop:pay_a1','task_a','Acme','2026-09-01',500,'whop','front_end','deposit',true),
      ('manual:m_a3','task_a','Acme','2026-08-28',1000,'manual','front_end','remainder',true),
      ('whop:pay_a4','task_a','Acme','2026-08-20',700,'whop','back_end','client',true),
      ('whop:pay_a5','task_a','Acme','2026-09-15',300,'whop','back_end','client',true),
      ('whop:pay_a6','task_a','Acme','2026-09-20',999,'whop','back_end','client',false),
      ('whop:pay_b1','task_b','Beta Co','2026-09-05',3000,'whop','front_end','deposit',true),
      ('whop:pay_r1','task_r','Render','2026-07-30',500,'whop','front_end','deposit',true),
      ('whop:pay_s1','task_s','Sales Back','2026-05-05',200,'whop','front_end','deposit',true);

    INSERT INTO cockpit_client_onboarding(clickup_task_id,client_name,client_status,in_onboarding,signup_on,onboarding_call_on,launch_on,handover) VALUES
      ('task_a','Acme','Active',false,'2026-09-01',NULL,'2026-09-20',
        '{"billing_notes":"Cash collected: 500\\nCash To Be Collected On Onboarding: 5,500\\nPayment Structure: Paid in full ($6,000)\\nTotal Contracted Revenue: 6000"}'),
      ('task_b','Beta Co','Active',false,'2026-09-05','2026-09-08','2026-09-25','{}'),
      ('task_arc','Arcturus Construction','Active',false,'2026-08-26',NULL,'2026-09-03','{}');

    -- Days before today (Kuwait), so the read's 400-day window never empties the history.
    INSERT INTO cockpit_client_billing_days(day,clickup_task_id,client_name,stage,ltv_usd,next_payment_usd,next_payment_date,signup_date,launch_date) VALUES
      (${ago(16)},'task_a','Acme','Needs Contacting',500,NULL,'2026-10-20',NULL,NULL),
      (${ago(15)},'task_a','Acme','Onboarding Booked',500,NULL,'2026-10-20',NULL,NULL),
      (${ago(13)},'task_a','Acme','Brand Blueprint Booked♠️',500,NULL,'2026-10-20',NULL,NULL),
      (${ago(12)},'task_a','Acme','Brand Blueprint Booked♠️',500,NULL,'2026-10-20',NULL,NULL),
      (${ago(11)},'task_a','Acme','Active',2500,5500,'2026-10-25',NULL,'2026-09-20'),
      (${ago(16)},'task_b','Beta Co','Active',3000,3000,'2026-10-15',NULL,NULL),
      (${ago(3)},'task_g','Ghost Co','LAUNCH BOOKED',500,NULL,NULL,NULL,NULL),
      (${ago(1)},'task_g','Ghost Co','GHOSTED',500,NULL,NULL,NULL,NULL),
      (${ago(3)},'task_gp','Paused Ghost','Paused',6000,NULL,NULL,NULL,NULL),
      (${ago(1)},'task_gp','Paused Ghost','GHOSTED',6000,NULL,NULL,NULL,NULL);

    INSERT INTO cockpit_csm_calls(source,source_id,task_id,client_name,match_method,match_confidence,kind,starts_at,status) VALUES
      ('ghl_appointment','appt_a1','task_a','Acme','client_id_field',1,'onboarding',now() + interval '2 days','confirmed'),
      ('ghl_appointment','appt_a2','task_a','Acme','client_id_field',1,'checkin','2026-10-01T09:00:00Z','showed'),
      ('fathom','fathom_b1','task_b','Beta Co','name',0.6,'onboarding','2026-09-08T09:00:00Z','held');
    INSERT INTO cockpit_csm_call_forms(token,form_id,form_kind,task_id,submitted_at,answers) VALUES
      ('tok_a','tG7dnxBn','kickoff','task_a','2026-09-03T09:00:00Z','[{"ref":"${KICKOFF_PAYMENT_REF}","type":"number","title":"Payment Amount","value":1500}]'),
      ('tok_a2','fRokTITH','checkin','task_a','2026-10-03T09:00:00Z','[]'),
      ('tok_b','oYZKtogO','kickoff_old','task_b','2026-09-07T09:00:00Z','[]');

    INSERT INTO cockpit_billing_events(clickup_task_id,client_name,kind,from_value,to_value,reason,detail,source,by_whom) VALUES
      ('task_a','Acme','extension','2026-10-19','2026-11-02','Client asked for time','{"weeks":2,"movedDate":true}','clickup','aziz@maharamedia.com'),
      ('task_a','Acme','note',NULL,NULL,'A note',NULL,'clickup','Faris'),
      ('task_b','Beta Co','date','2026-10-01','2026-10-12',NULL,NULL,'clickup','Faris');
    INSERT INTO cockpit_billing_inbox(clickup_task_id,client_name,paid_on,amount,currency,method,source,logged_by,status,status_note) VALUES
      ('task_a','Acme','2026-09-02',5500,'USD','tap','csm','sara@tests.invalid','pending',NULL),
      ('task_b','Beta Co','2026-09-06',300,'KWD','tap','csm','omar@tests.invalid','rejected','Tap carries it by itself');
    INSERT INTO cockpit_invoices(clickup_task_id,client_name,kind,amount_usd,description,issue_date,due_date,payments,status,invoice_no,drive_url,pay_note,requested_by) VALUES
      ('task_a','Acme','paid',5500,'Onboarding payment','2026-10-22',NULL,'[{"day":"2026-10-22","usd":5500}]','issued','INV-2026-026','https://example.test/d/1','The pending amount must be paid by the end of October','sara@tests.invalid'),
      ('task_b','Beta Co','autocharge',3000,'Second half','2026-10-01','2026-10-15','[]','queued',NULL,NULL,NULL,'omar@tests.invalid');
    INSERT INTO cockpit_ecom_invoices(id,invoice_number,status,amount_kwd,usd,customer_name,created_at) VALUES
      ('INV_fixture_arc1','26B106914','UNPAID',620,2021.20,'Arcturus','2026-10-20T10:00:00Z'),
      ('INV_fixture_paid','26B000001','PAID',100,326,'Acme','2026-10-01T10:00:00Z'),
      ('INV_fixture_beta','26B000002','UNPAID',300,978,'Beta Co','2026-10-21T10:00:00Z'),
      -- Deleted in Ecom (ecom-payments-sync marks it), and expired: neither is a request still open.
      ('INV_fixture_del','26B000003','DELETED',100,326,'Acme','2026-10-22T10:00:00Z'),
      ('INV_fixture_exp','26B000004','EXPIRED',100,326,'Acme','2026-10-02T10:00:00Z'),
      -- A card name inside another card's name, and a gone card's own invoice:
      -- each goes to its best card among all cards, and only then to the caller.
      ('INV_fixture_d2','26B777777','UNPAID',500,1630,'Delta Build Group','2026-10-21T10:00:00Z'),
      ('INV_fixture_cob','26B888888','UNPAID',400,1304,'Castello Industries Old Branch','2026-10-21T10:00:00Z');`);
  return db;
}

async function read(db: PGlite) {
  return (await db.query<{ r: any }>("SELECT public.cockpit_billing_balances_read() AS r")).rows[0].r;
}
async function write(db: PGlite, action: string, args: Record<string, unknown>) {
  return (await db.query<{ r: any }>("SELECT public.cockpit_billing_balance_write($1,$2::jsonb) AS r", [action, JSON.stringify(args)])).rows[0].r;
}
async function refused(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    return (e as Error).message;
  }
  throw new Error("Expected the server to refuse");
}
const rows = async (db: PGlite, sql: string) => {
  await owner(db);
  return (await db.query<Record<string, unknown>>(sql)).rows;
};
const count = async (db: PGlite, sql: string) => Number((await rows(db, sql))[0].n);
const writes = async (db: PGlite) => ({
  confirmations: await count(db, "SELECT count(*)::int AS n FROM cockpit_billing_confirmations"),
  links: await count(db, "SELECT count(*)::int AS n FROM cockpit_billing_deal_links"),
  events: await count(db, "SELECT count(*)::int AS n FROM cockpit_billing_events"),
  audit: await count(db, "SELECT count(*)::int AS n FROM cockpit_audit_log WHERE action LIKE 'billing.%'"),
  queue: await count(db, "SELECT count(*)::int AS n FROM cockpit_clickup_writeback_queue"),
  inbox: await count(db, "SELECT count(*)::int AS n FROM cockpit_billing_inbox"),
  payments: await count(db, "SELECT count(*)::int AS n FROM cockpit_client_payments") + await count(db, "SELECT count(*)::int AS n FROM cockpit_deal_payments"),
});
const today = async (db: PGlite) => String((await rows(db, "SELECT ((now() AT TIME ZONE 'Asia/Kuwait')::date)::text AS d"))[0].d);
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

const confirmAcme = (over: Record<string, unknown> = {}) => ({
  taskId: "task_a", dealResponseId: "resp_acme_2", part: "onboarding", amount: 3000, currency: "USD", rail: "tap",
  paidOn: "2026-09-02", evidenceUrl: "https://example.test/r/1", note: "Paid on the call", ...over,
});

test("1. anon, an inactive seat, a media buyer and a call-centre seat are refused by both functions", async () => {
  const db = await fixture();
  try {
    await actor(db, null);
    expect(await refused(read(db))).toContain("permission denied");
    expect(await refused(write(db, "confirm", confirmAcme()))).toContain("permission denied");
    for (const seat of [GONE_SEAT, BUYER, CALLS]) {
      await actor(db, seat);
      expect(await refused(read(db))).toBe("Pending payments need a client success, finance or CEO seat. Ask an admin to add the role.");
      expect(await refused(write(db, "confirm", confirmAcme()))).toBe(
        "Billing changes need a client success, finance or CEO seat. Ask an admin to add the role.",
      );
    }
    await actor(db, FINANCE);
    expect((await read(db)).ceo).toBe(false);
  } finally {
    await db.close();
  }
});

test("2. a success manager sees only their cards; nothing of another card leaks; the CEO sees everything", async () => {
  const db = await fixture();
  try {
    await actor(db, CEO);
    const all = await read(db);
    expect(all.ceo).toBe(true);
    expect(all.today).toBe(await today(db));
    await actor(db, CEO);
    // The cards on the list: on the books, not paused, churned, internal, Back with sales or GHOSTED from Paused.
    expect(all.cards.map((c: { taskId: string }) => c.taskId).sort()).toEqual(
      ["task_a", "task_abc", "task_arc", "task_b", "task_c", "task_d1", "task_d2", "task_g", "task_m", "task_pt", "task_r"].sort(),
    );
    const ghost = all.cards.find((c: { taskId: string }) => c.taskId === "task_g");
    expect(ghost.quiet).toBe(true);
    expect(ghost.previousStatus).toBe("LAUNCH BOOKED");
    const acme = all.cards.find((c: { taskId: string }) => c.taskId === "task_a");
    expect(acme).toMatchObject({
      name: "Acme", group: "active", status: "Active", previousStatus: "Brand Blueprint Booked♠️", quiet: false,
      nextUsd: 5500, nextDate: "2026-10-25", ltvFieldUsd: 2500, launchOn: "2026-09-20", signupOn: "2026-09-01",
      noteAtOnboardingUsd: 5500, noteContractUsd: 6000, inOnboarding: false, firstPastOnboardingBookedOn: addDays(await today(db), -13),
    });
    expect(all.cards.find((c: { taskId: string }) => c.taskId === "task_b").firstPastOnboardingBookedOn).toBeNull();
    // The CEO's extras.
    expect(all.deals.find((d: { responseId: string }) => d.responseId === "resp_acme_2").contactName).toBe("Contact Alpha");
    expect(all.untied).toEqual([
      { id: "whop:pay_u1", day: "2026-08-24", rail: "whop", usd: 500, currency: "USD", amount: 500, payerName: "Payer Person" },
    ]);
    expect(all.untiedAsOf).not.toBeNull();
    expect(all.unlinked.map((d: { responseId: string }) => d.responseId)).toEqual(["resp_orphan", "resp_abc"]);
    expect(all.unlinked[0]).toMatchObject({ suggestedTaskId: "task_arc", suggestedName: "Arcturus Construction", contactName: "Contact Lambda", rails: [] });
    expect(all.unlinked[1].suggestedTaskId).toBeNull();
    expect(all.backWithSales).toHaveLength(1);
    expect(all.backWithSales[0]).toMatchObject({ taskId: "task_s", deal: { responseId: "resp_sales", contractUsd: 5000, matchedBy: "name", contactName: "Contact Eps" } });
    // Its card's own payment from signing - 7 counts, as for every deal.
    expect(all.backWithSales[0].rails.map((r: { paymentId: string; fromLedger: boolean }) => [r.paymentId, r.fromLedger])).toEqual([["whop:pay_s1", false]]);
    // UNPAID only (not the DELETED or EXPIRED Acme rows); "Delta Build Group" goes to its own card, not
    // to "Delta Build"; the Stopped "Castello Industries Old Branch" keeps its invoice, so none lands on
    // the listed "Castello Industries".
    expect(all.ecomOpen.map((e: { taskId: string; invoiceNumber: string }) => `${e.taskId}:${e.invoiceNumber}`).sort()).toEqual(
      ["task_arc:26B106914", "task_b:26B000002", "task_d2:26B777777"],
    );
    expect(all.moneyAsOf).not.toBeNull();
    expect(all.cardsAsOf).toBe("2026-10-23T13:07:00+00:00");
    expect(all.callsAsOf).toBe("2026-10-23T13:01:00+00:00");

    // A confirmation on each side, so the confirmations list has something to leak.
    await actor(db, CEO);
    await write(db, "confirm", { taskId: "task_b", dealResponseId: "resp_beta", part: "later", partNo: 1, amount: 1000, currency: "USD", rail: "whop", paidOn: "2026-10-10" });
    await actor(db, CSM);
    await write(db, "confirm", confirmAcme());

    const mine = await read(db);
    expect(mine.ceo).toBe(false);
    expect(mine.cards.map((c: { taskId: string }) => c.taskId)).toEqual(["task_a"]);
    for (const list of ["deals", "calls", "kickoffs", "cardHistory", "events", "inbox", "invoices", "confirmations"]) {
      expect(mine[list].length).toBeGreaterThan(0);
      for (const item of mine[list]) expect(item.taskId).toBe("task_a");
    }
    expect(mine.ecomOpen).toEqual([]);
    for (const r of mine.rails) expect(r.dealResponseId).toBe("resp_acme_2");
    expect(mine.untied).toEqual([]);
    expect(mine.unlinked).toEqual([]);
    expect(mine.backWithSales).toEqual([]);
    expect(mine.untiedAsOf).toBeNull();
    for (const d of mine.deals) {
      expect("contactName" in d).toBe(false);
      expect("conflictWith" in d).toBe(false);
    }
    // Nothing of another card, deal, payment or person anywhere in the answer.
    const text = JSON.stringify(mine);
    for (const other of [
      "task_b", "Beta Co", "resp_beta", "whop:pay_b1", "26B000002", "fathom_b1", "Second half", "Tap carries it",
      "task_g", "task_gp", "task_s", "task_x", "task_p", "task_i", "task_pt", "task_r", "task_c", "task_abc", "task_d1", "task_d2", "task_arc", "task_m",
      "resp_orphan", "resp_sales", "resp_render", "resp_delta", "resp_abc", "Payer Person", "Contact Alpha", "payer@example.test",
      "alpha@example.test", "omar@tests.invalid", "sara@tests.invalid", "aziz@maharamedia.com",
      "task_cob", "26B777777", "26B888888", "26B000003", "26B000004", "26B106914",
    ]) expect(text).not.toContain(other);

    // The other success manager sees Beta only, and not Acme's confirmation.
    await actor(db, OTHER_CSM);
    const theirs = await read(db);
    expect(theirs.cards.map((c: { taskId: string }) => c.taskId)).toEqual(["task_b"]);
    expect(JSON.stringify(theirs)).not.toContain("task_a");
    expect(theirs.ecomOpen.map((e: { invoiceNumber: string }) => e.invoiceNumber)).toEqual(["26B000002"]);

    // A success manager whose only client is "Delta Build" does not get the "Delta Build Group" invoice:
    // the invoice's card is picked among every card first, and only then cut to the caller's.
    await owner(db);
    await db.exec("UPDATE cockpit_members SET clients=ARRAY['Delta Build'] WHERE email='sara@tests.invalid'");
    await actor(db, CSM);
    const delta = await read(db);
    expect(delta.cards.map((c: { taskId: string }) => c.taskId)).toEqual(["task_d1"]);
    expect(delta.ecomOpen).toEqual([]);
    for (const other of ["26B777777", "task_d2", "Delta Build Group"]) expect(JSON.stringify(delta)).not.toContain(other);
  } finally {
    await db.close();
  }
});

test("the read carries each list's facts: rails, calls, kickoffs, history, events, inbox, invoices", async () => {
  const db = await fixture();
  try {
    await actor(db, CEO);
    const all = await read(db);
    const acmeDeal = all.deals.find((d: { taskId: string }) => d.taskId === "task_a");
    expect(acmeDeal).toMatchObject({
      responseId: "resp_acme_2", signedOn: "2026-09-01", business: "Acme", paymentStructure: "Paid in full ($6,000)",
      contractUsd: 6000, depositUsd: 500, atOnboardingUsd: 5500, secondPaymentUsd: null, matchedBy: "ledger", conflict: false,
      otherForms: [{ responseId: "resp_acme_1" }],
    });
    const acmeRails = all.rails.filter((r: { dealResponseId: string }) => r.dealResponseId === "resp_acme_2");
    expect(acmeRails.map((r: { paymentId: string; fromLedger: boolean; byHand: boolean }) => [r.paymentId, r.fromLedger, r.byHand])).toEqual([
      ["manual:m_a3", false, true],
      ["whop:pay_a1", true, false],
      ["tap:chg_a2", true, false],
    ]);
    expect(all.calls.filter((c: { taskId: string }) => c.taskId === "task_a")).toEqual([
      expect.objectContaining({ status: "confirmed", source: "ghl_appointment", matchMethod: "client_id_field", booked: true }),
    ]);
    expect(all.calls.find((c: { taskId: string }) => c.taskId === "task_b")).toMatchObject({ status: "held", confidence: 0.6, booked: false });
    expect(all.kickoffs.map((k: { taskId: string; kind: string; typedPayment: number | null }) => [k.taskId, k.kind, k.typedPayment])).toEqual([
      ["task_a", "kickoff", 1500],
      ["task_b", "kickoff_old", null],
    ]);
    const day = await today(db);
    expect(all.cardHistory.filter((h: { taskId: string }) => h.taskId === "task_a").map((h: { day: string }) => h.day)).toEqual(
      [16, 15, 13, 11].map(n => addDays(day, -n)),
    );
    expect(all.events.map((e: { taskId: string; kind: string }) => `${e.taskId}:${e.kind}`)).toEqual(["task_a:extension", "task_b:date"]);
    expect(all.events[0]).toMatchObject({ from: "2026-10-19", to: "2026-11-02", weeks: 2, movedDate: true, byName: "Aziz Waheedi" });
    expect(all.events[1].byName).toBe("Faris");
    expect(all.inbox.find((i: { taskId: string }) => i.taskId === "task_b")).toMatchObject({
      amount: 300, currency: "KWD", usd: 978, status: "rejected", statusNote: "Tap carries it by itself", loggedByName: "Omar Test",
    });
    expect(all.invoices.find((i: { taskId: string }) => i.taskId === "task_a")).toMatchObject({
      invoiceNo: "INV-2026-026", kind: "paid", amountUsd: 5500, dueDate: null, status: "issued",
    });
    // No email anywhere in the CEO's answer either: names only.
    const text = JSON.stringify(all);
    for (const email of ["aziz@maharamedia.com", "sara@tests.invalid", "omar@tests.invalid", "payer@example.test", "alpha@example.test"])
      expect(text).not.toContain(email);
  } finally {
    await db.close();
  }
});

test("3. one confirm writes one confirmation, one event and one audit row; a refused call writes none", async () => {
  const db = await fixture();
  try {
    const before = await writes(db);
    await actor(db, CSM);
    const done = await write(db, "confirm", confirmAcme());
    expect(done.ok).toBe(true);
    expect(done.sentence).toBe("Confirmed by you · waiting for Tap");
    expect(done.confirmation).toMatchObject({
      taskId: "task_a", dealResponseId: "resp_acme_2", part: "onboarding", partNo: 0, amount: 3000, usd: 3000, rail: "tap",
      paidOn: "2026-09-02", railsUsdAtConfirm: 2500, source: "csm", confirmedByCeo: false, byYou: true,
    });
    const after = await writes(db);
    expect(after).toEqual({ ...before, confirmations: before.confirmations + 1, events: before.events + 1, audit: before.audit + 1 });
    const [c] = await rows(db, "SELECT * FROM cockpit_billing_confirmations");
    const [e] = await rows(db, "SELECT * FROM cockpit_billing_events WHERE kind='confirm'");
    const [a] = await rows(db, "SELECT * FROM cockpit_audit_log WHERE action='billing.confirm'");
    expect(c).toMatchObject({ confirmed_by: "sara@tests.invalid", confirmed_by_ceo: false, source: "csm", event_id: e.id });
    expect(e).toMatchObject({ clickup_task_id: "task_a", client_name: "Acme", to_value: "3000", source: "csm", by_whom: "sara@tests.invalid" });
    expect(e.detail).toMatchObject({ confirmationId: Number(c.id), part: "onboarding", partNo: 0, rail: "tap", railsUsdAtConfirm: 2500, dealResponseId: "resp_acme_2" });
    expect(a).toMatchObject({ entity_type: "cockpit_billing_confirmations", entity_id: String(c.id), actor_email: "sara@tests.invalid", source_app: "client-success-cockpit" });
    expect((a.metadata as { event_id: number }).event_id).toBe(Number(e.id));

    // The read shows it, named, never as money.
    await actor(db, CSM);
    const view = await read(db);
    expect(view.confirmations).toEqual([
      expect.objectContaining({ id: Number(c.id), confirmedByName: "Sara Test", byYou: true, withdrawnAt: null, railsUsdAtConfirm: 2500 }),
    ]);
    expect(view.rails.reduce((s: number, r: { usd: number }) => s + r.usd, 0)).toBe(2500);

    // A refused call changes nothing.
    await actor(db, CSM);
    expect(await refused(write(db, "confirm", confirmAcme({ rail: "bank_transfer" })))).toContain("Log it as a payment");
    expect(await writes(db)).toEqual(after);

    // The same press twice within two minutes is answered with the first.
    await actor(db, CSM);
    const again = await write(db, "confirm", confirmAcme());
    expect(again.repeated).toBe(true);
    expect(again.confirmation.id).toBe(Number(c.id));
    expect(await writes(db)).toEqual(after);
  } finally {
    await db.close();
  }
});

test("4. confirm refusals: rails, amounts, the cap, the paid-on day; a second piece of a part is accepted", async () => {
  const db = await fixture();
  try {
    const sentence = "A transfer, cheque or cash never arrives on its own. Log it as a payment with its receipt instead.";
    await actor(db, CSM);
    for (const rail of ["bank_transfer", "cheque", "cash", "transfer", "manual", "other"])
      expect(await refused(write(db, "confirm", confirmAcme({ rail })))).toBe(sentence);
    expect(await refused(write(db, "confirm", confirmAcme({ rail: "" })))).toBe("Pick how they paid: Whop, Tap or an Ecom link.");

    for (const [amount, currency, message] of [
      [0, "USD", "The amount has to be above zero."],
      [-5, "USD", "The amount has to be above zero."],
      [100001, "USD", "That is too large for one client payment; check the amount."],
      [10.555, "USD", "A dollar amount has at most two decimals."],
      [1.2345, "KWD", "A dinar amount has at most three decimals."],
    ] as const) expect(await refused(write(db, "confirm", confirmAcme({ amount, currency })))).toBe(message);
    expect(await refused(write(db, "confirm", confirmAcme({ amount: "3000" })))).toBe("Type the amount as a number.");
    expect(await refused(write(db, "confirm", confirmAcme({ currency: "SAR" })))).toBe("Pick dollars or dinars.");
    expect(await refused(write(db, "confirm", confirmAcme({ evidenceUrl: "http://example.test/r" })))).toBe(
      "The receipt has to be a link that opens, starting https://.",
    );
    expect(await refused(write(db, "confirm", confirmAcme({ part: "everything" })))).toBe("Say which part of the plan was paid.");
    expect(await refused(write(db, "confirm", confirmAcme({ part: "later" })))).toBe("Say which part of the plan was paid.");
    expect(await refused(write(db, "confirm", confirmAcme({ part: "onboarding", partNo: 2 })))).toBe("Say which part of the plan was paid.");

    // The paid-on day: today or before, and no earlier than seven days before signing (1 Sep).
    const day = await today(db);
    await actor(db, CSM);
    expect(await refused(write(db, "confirm", confirmAcme({ paidOn: addDays(day, 1) })))).toBe("Pick the day they paid, today or before.");
    expect(await refused(write(db, "confirm", confirmAcme({ paidOn: "2026-08-24" })))).toBe("That day is before they signed. Pick the day they paid.");
    expect(await refused(write(db, "confirm", confirmAcme({ paidOn: "not a day" })))).toBe("Pick the day they paid, today or before.");
    const edge = await write(db, "confirm", confirmAcme({ amount: 100, paidOn: "2026-08-25", rail: "whop" }));
    expect(edge.ok).toBe(true);

    // The cap: contract 6,000 - rails 2,500 + 1% (60) = 3,560 for all live confirmations.
    const first = await write(db, "confirm", confirmAcme({ amount: 3000, paidOn: "2026-09-02" }));
    expect(first.ok).toBe(true);
    // A second piece of the same part, under the cap, is accepted (3,100 + 400 = 3,500).
    const second = await write(db, "confirm", confirmAcme({ amount: 400, paidOn: "2026-09-03", evidenceUrl: null }));
    expect(second.ok).toBe(true);
    expect(await refused(write(db, "confirm", confirmAcme({ amount: 100, paidOn: "2026-09-04" })))).toBe(
      "That is more than the $0 the rails have not shown. Confirmations already cover $3,500 of it.",
    );
    // 60 more is still within the 1% (3,560).
    expect((await write(db, "confirm", confirmAcme({ amount: 60, paidOn: "2026-09-04" }))).ok).toBe(true);
    // Dinars count at 3.26: 1 KWD is $3.26, over the cap now.
    expect(await refused(write(db, "confirm", confirmAcme({ amount: 1, currency: "KWD", paidOn: "2026-09-05" })))).toContain(
      "the rails have not shown",
    );
    // A fresh deal with nothing confirmed: the sentence names what the rails have not shown.
    await actor(db, CEO);
    expect(await refused(write(db, "confirm", {
      taskId: "task_b", dealResponseId: "resp_beta", part: "later", partNo: 1, amount: 3100, currency: "USD", rail: "whop", paidOn: "2026-10-10",
    }))).toBe("That is more than the $3,000 the rails have not shown.");
    const kwd = await write(db, "confirm", {
      taskId: "task_b", dealResponseId: "resp_beta", part: "later", partNo: 1, amount: 100, currency: "KWD", rail: "ecom", paidOn: "2026-10-10",
    });
    expect(kwd.confirmation).toMatchObject({ amount: 100, currency: "KWD", usd: 326, rail: "ecom", partNo: 1, confirmedByCeo: true, source: "ceo" });
  } finally {
    await db.close();
  }
});

test("4b. the deal has to be the card's newest live deal; no deal only for 'all' on a card in onboarding with no terms", async () => {
  const db = await fixture();
  try {
    await actor(db, CEO);
    expect(await refused(write(db, "confirm", confirmAcme({ dealResponseId: "resp_acme_1" })))).toBe(
      "That signed deal is not this client's newest deal on record. Reload the page.",
    );
    expect(await refused(write(db, "confirm", confirmAcme({ dealResponseId: "resp_void" })))).toBe(
      "That signed deal is not this client's newest deal on record. Reload the page.",
    );
    expect(await refused(write(db, "confirm", confirmAcme({ dealResponseId: "resp_beta" })))).toBe(
      "That signed deal is not this client's newest deal on record. Reload the page.",
    );
    expect(await refused(write(db, "confirm", confirmAcme({ dealResponseId: null })))).toBe(
      "This client has a signed deal on record. Reload the page and confirm against it.",
    );
    // Abcde has no deal it can claim and is past onboarding: it is a footnote on the screen, not a row.
    const noTerms = { taskId: "task_abc", part: "all", amount: 2000, currency: "USD", rail: "whop", paidOn: "2026-10-01" };
    expect(await refused(write(db, "confirm", noTerms))).toBe(
      "Abcde has no signed deal on record and is past onboarding. Link its closer form to the card first (the CEO's Link to a card), then confirm against it.",
    );
    // Nova is in onboarding with no deal: "Terms not on record", confirmed in all.
    await owner(db);
    await db.exec(`INSERT INTO cockpit_billing_accounts(clickup_task_id,client_name,stage,stage_group,client_status)
      VALUES('task_n','Nova Interiors','Onboarding Booked','pipeline','Onboarding Booked')`);
    await actor(db, CEO);
    noTerms.taskId = "task_n";
    expect(await refused(write(db, "confirm", { ...noTerms, part: "onboarding" }))).toBe(
      "With no signed deal on record, confirm what they paid in all.",
    );
    const ok = await write(db, "confirm", noTerms);
    expect(ok.confirmation).toMatchObject({ dealResponseId: null, part: "all", partNo: 0, railsUsdAtConfirm: null });
    expect(await refused(write(db, "confirm", { ...noTerms, amount: 99000, paidOn: "2026-10-02" }))).toBe(
      "That is too large for one client's payments; check the amount.",
    );
  } finally {
    await db.close();
  }
});

test("4c. the cap counts only confirmations no rail payment has proven; a same-size payment on another rail proves nothing", async () => {
  const db = await fixture();
  try {
    // Acme: contract 6,000, rails 2,500. A $3,000 Tap confirmation holds 3,000 of the 3,560 room.
    await actor(db, CSM);
    expect((await write(db, "confirm", confirmAcme({ amount: 3000, paidOn: "2026-09-02" }))).ok).toBe(true);
    // The Tap charge lands on the deal ledger the next day: the rails show 5,500 and the confirmation is proven.
    await owner(db);
    await db.exec(`INSERT INTO cockpit_deal_payments(payment_id,deal_response_id,day,usd,rail,kind,deposit_usd,matched_by,active)
      VALUES('tap:chg_a9','resp_acme_2','2026-09-03',3000,'tap','remainder',0,'card_payer',true)`);
    // $500 is left on the contract: 500 + 1% fits, 600 does not, and the proven 3,000 is not counted again.
    await actor(db, CSM);
    expect(await refused(write(db, "confirm", confirmAcme({ part: "later", partNo: 1, amount: 600, rail: "whop", paidOn: "2026-09-20" })))).toBe(
      "That is more than the $500 the rails have not shown.",
    );
    expect((await write(db, "confirm", confirmAcme({ part: "later", partNo: 1, amount: 500, rail: "whop", paidOn: "2026-09-20" }))).ok).toBe(true);

    // Beta: contract 6,000, rails 3,000. The CEO confirms the second half on Tap; a Whop payment of the
    // same size then lands. It is not on the rail the confirmation named, so it proves nothing.
    await actor(db, CEO);
    const beta = { taskId: "task_b", dealResponseId: "resp_beta", part: "later", partNo: 1, currency: "USD", rail: "tap" };
    expect((await write(db, "confirm", { ...beta, amount: 3000, paidOn: "2026-10-10" })).ok).toBe(true);
    await owner(db);
    await db.exec(`INSERT INTO cockpit_deal_payments(payment_id,deal_response_id,day,usd,rail,kind,deposit_usd,matched_by,active)
      VALUES('whop:pay_b2','resp_beta','2026-10-11',3000,'whop','remainder',0,'deal_id',true)`);
    await actor(db, CEO);
    expect(await refused(write(db, "confirm", { ...beta, amount: 61, paidOn: "2026-10-12" }))).toBe(
      "That is more than the $0 the rails have not shown. Confirmations already cover $3,000 of it.",
    );
    // A Tap charge 3% off the amount, or 20 days early, proves nothing either.
    await owner(db);
    await db.exec(`INSERT INTO cockpit_deal_payments(payment_id,deal_response_id,day,usd,rail,kind,deposit_usd,matched_by,active) VALUES
      ('tap:chg_b3','resp_beta','2026-10-11',2910,'tap','remainder',0,'deal_id',true),
      ('tap:chg_b4','resp_beta','2026-09-20',3000,'tap','remainder',0,'deal_id',true)`);
    await actor(db, CEO);
    expect(await refused(write(db, "confirm", { ...beta, amount: 1, paidOn: "2026-10-12" }))).toContain("Confirmations already cover $3,000 of it.");
  } finally {
    await db.close();
  }
});

test("4d. once a deal reaches a card, the card's own confirmations from before count in the deal's cap", async () => {
  const db = await fixture();
  try {
    await owner(db);
    await db.exec(`INSERT INTO cockpit_billing_accounts(clickup_task_id,client_name,stage,stage_group,client_status)
      VALUES('task_n','Nova Interiors','Onboarding Booked','pipeline','Onboarding Booked')`);
    // Terms not on record: finance confirms $2,000 in all.
    await actor(db, FINANCE);
    const all = await write(db, "confirm", { taskId: "task_n", part: "all", amount: 2000, currency: "USD", rail: "tap", paidOn: "2026-10-01" });
    expect(all.confirmation).toMatchObject({ dealResponseId: null, part: "all" });
    // The CEO links the signed deal ($6,000, nothing on the rails) to the card.
    await actor(db, CEO);
    expect((await write(db, "link", { dealResponseId: "resp_orphan", taskId: "task_n" })).ok).toBe(true);
    // The deal's room is 6,000 + 60 less the 2,000 already confirmed on the card.
    await actor(db, FINANCE);
    const onDeal = { taskId: "task_n", dealResponseId: "resp_orphan", part: "onboarding", currency: "USD", rail: "whop", paidOn: "2026-10-02" };
    expect(await refused(write(db, "confirm", { ...onDeal, amount: 4061 }))).toBe(
      "That is more than the $4,000 the rails have not shown. Confirmations already cover $2,000 of it.",
    );
    expect((await write(db, "confirm", { ...onDeal, amount: 4060 })).ok).toBe(true);
    await actor(db, CEO);
    const view = await read(db);
    expect(view.confirmations.filter((c: { taskId: string }) => c.taskId === "task_n").map((c: { dealResponseId: string | null }) => c.dealResponseId))
      .toEqual([null, "resp_orphan"]);
  } finally {
    await db.close();
  }
});

test("5. seat rules: source ceo is the CEO's; a success manager only on their clients; confirmed_by_ceo follows the caller", async () => {
  const db = await fixture();
  try {
    await actor(db, CSM);
    expect(await refused(write(db, "confirm", confirmAcme({ source: "ceo" })))).toBe("Only the CEO can make a change from the CEO cockpit.");
    expect(await refused(write(db, "confirm", confirmAcme({ source: "maher" })))).toBe("That billing change came from an unknown cockpit.");
    expect(await refused(write(db, "confirm", {
      taskId: "task_b", dealResponseId: "resp_beta", part: "later", partNo: 1, amount: 100, currency: "USD", rail: "whop", paidOn: "2026-10-10",
    }))).toBe("Beta Co is not one of your clients in the portal, so its billing is not yours to change.");
    expect(await refused(write(db, "confirm", confirmAcme({ taskId: "task_nope" })))).toBe(
      "That client card is not on the billing sheet. Refresh the page and pick it again.",
    );
    expect(await refused(write(db, "confirm", confirmAcme({ taskId: "bad id!" })))).toBe("That is not a ClickUp card id.");
    expect(await refused(write(db, "dance", {}))).toBe("That is not a pending payments action.");

    // The CEO confirming from client success: source csm, still confirmed by the CEO.
    await actor(db, CEO);
    const fromCsm = await write(db, "confirm", confirmAcme({ source: "csm", amount: 100 }));
    expect(fromCsm.confirmation).toMatchObject({ source: "csm", confirmedByCeo: true });
    // Finance (an empty client list sees every client) confirms, and is not the CEO.
    await actor(db, FINANCE);
    const finance = await write(db, "confirm", confirmAcme({ amount: 200, paidOn: "2026-09-03" }));
    expect(finance.confirmation).toMatchObject({ source: "csm", confirmedByCeo: false });
    const [audit] = await rows(db, `SELECT source_app FROM cockpit_audit_log WHERE entity_id='${fromCsm.confirmation.id}' AND action='billing.confirm'`);
    expect(audit.source_app).toBe("client-success-cockpit");
  } finally {
    await db.close();
  }
});

test("5b. confirm only on a card the caller's list shows; the CEO's list includes Back with sales", async () => {
  const db = await fixture();
  try {
    // Finance sees every client, but Back with sales is the CEO's, and gone, paused, internal and
    // GHOSTED-from-Paused cards are on nobody's list.
    await actor(db, FINANCE);
    for (const [taskId, name] of [
      ["task_s", "Sales Back"], ["task_x", "Stopped Co"], ["task_p", "Paused Co"], ["task_i", "[internal test] Mahara"], ["task_gp", "Paused Ghost"],
    ]) {
      expect(await refused(write(db, "confirm", { ...confirmAcme(), taskId, dealResponseId: null, part: "all" }))).toBe(
        `${name} is not on the pending payments list. Reload the page to see who is.`,
      );
    }
    await actor(db, CEO);
    for (const taskId of ["task_x", "task_p", "task_i", "task_gp"])
      expect(await refused(write(db, "confirm", { ...confirmAcme(), taskId, dealResponseId: null, part: "all" }))).toContain(
        "is not on the pending payments list",
      );
    // The CEO confirms on a Back with sales card, and his read returns it; nobody else's does.
    const sales = await write(db, "confirm", {
      taskId: "task_s", dealResponseId: "resp_sales", part: "later", partNo: 1, amount: 500, currency: "USD", rail: "whop", paidOn: "2026-06-04",
    });
    expect(sales.confirmation).toMatchObject({ taskId: "task_s", confirmedByCeo: true });
    expect((await read(db)).confirmations.map((c: { taskId: string }) => c.taskId)).toEqual(["task_s"]);
    await actor(db, FINANCE);
    expect((await read(db)).confirmations).toEqual([]);
    // A withdraw stays open off the list, so a stray confirmation can still be taken back.
    await actor(db, CEO);
    expect((await write(db, "withdraw", { taskId: "task_s", confirmationId: sales.confirmation.id, reason: "Back with sales" })).ok).toBe(true);
  } finally {
    await db.close();
  }
});

test("6. withdraw: the confirmer or the CEO, once, with a reason", async () => {
  const db = await fixture();
  try {
    await actor(db, CSM);
    const mine = (await write(db, "confirm", confirmAcme())).confirmation.id;
    await actor(db, CEO);
    const ceos = (await write(db, "confirm", confirmAcme({ amount: 200, paidOn: "2026-09-03" }))).confirmation.id;

    await actor(db, FINANCE);
    expect(await refused(write(db, "withdraw", { taskId: "task_a", confirmationId: mine, reason: "Not mine" }))).toBe(
      "Only the person who confirmed it, or the CEO, can withdraw it.",
    );
    await actor(db, OTHER_CSM);
    expect(await refused(write(db, "withdraw", { taskId: "task_a", confirmationId: mine, reason: "Not mine" }))).toContain(
      "is not one of your clients",
    );
    await actor(db, CSM);
    expect(await refused(write(db, "withdraw", { taskId: "task_a", confirmationId: mine, reason: "no" }))).toBe("Say why in 3 to 300 characters.");
    expect(await refused(write(db, "withdraw", { taskId: "task_a", confirmationId: "1", reason: "Wrong rail" }))).toBe(
      "Say which confirmation to withdraw.",
    );
    expect(await refused(write(db, "withdraw", { taskId: "task_b", confirmationId: mine, reason: "Wrong card" }))).toContain(
      "is not one of your clients",
    );
    expect(await refused(write(db, "withdraw", { taskId: "task_a", confirmationId: ceos, reason: "Not mine either" }))).toBe(
      "Only the person who confirmed it, or the CEO, can withdraw it.",
    );
    const before = await writes(db);
    await actor(db, CSM);
    const out = await write(db, "withdraw", { taskId: "task_a", confirmationId: mine, reason: "Tap showed another client's charge" });
    expect(out).toMatchObject({ ok: true, sentence: "Withdrawn.", confirmation: { id: mine, withdrawnReason: "Tap showed another client's charge" } });
    expect(await writes(db)).toEqual({ ...before, events: before.events + 1, audit: before.audit + 1 });
    const [e] = await rows(db, "SELECT * FROM cockpit_billing_events WHERE kind='unconfirm'");
    expect(e).toMatchObject({ clickup_task_id: "task_a", from_value: "3000", reason: "Tap showed another client's charge", source: "csm" });
    const [a] = await rows(db, "SELECT * FROM cockpit_audit_log WHERE action='billing.unconfirm'");
    expect((a.before as { withdrawn_at: string | null }).withdrawn_at).toBeNull();
    expect((a.after as { withdrawn_by: string }).withdrawn_by).toBe("sara@tests.invalid");

    await actor(db, CSM);
    expect(await refused(write(db, "withdraw", { taskId: "task_a", confirmationId: mine, reason: "Again" }))).toBe(
      "That confirmation was already withdrawn.",
    );
    // The CEO withdraws anyone's; the read shows who.
    await actor(db, CEO);
    await write(db, "withdraw", { taskId: "task_a", confirmationId: ceos, reason: "Typed twice" });
    await actor(db, CSM);
    const view = await read(db);
    expect(view.confirmations.map((c: { id: number; withdrawnByName: string }) => [c.id, c.withdrawnByName])).toEqual([
      [mine, "Sara Test"],
      [ceos, "Aziz Waheedi"],
    ]);
    // A withdrawn confirmation no longer holds the cap.
    await actor(db, CSM);
    expect((await write(db, "confirm", confirmAcme({ amount: 3500, paidOn: "2026-09-06" }))).ok).toBe(true);
  } finally {
    await db.close();
  }
});

test("7. link and unlink are the CEO's, audited, and only for a deal no card claims", async () => {
  const db = await fixture();
  try {
    await actor(db, CSM);
    expect(await refused(write(db, "link", { dealResponseId: "resp_orphan", taskId: "task_a" }))).toBe(
      "Only the CEO can link a signed deal to a client card.",
    );
    await actor(db, FINANCE);
    expect(await refused(write(db, "unlink", { dealResponseId: "resp_orphan", reason: "No reason" }))).toBe(
      "Only the CEO can link a signed deal to a client card.",
    );
    await actor(db, CEO);
    expect(await refused(write(db, "link", { dealResponseId: "resp_beta", taskId: "task_arc" }))).toBe(
      "That deal already matches Beta Co by its payments. If that is wrong, tie its payments on Money instead.",
    );
    expect(await refused(write(db, "link", { dealResponseId: "resp_castello", taskId: "task_arc" }))).toBe(
      "That deal already matches Castello Industries by its name. If that is wrong, tie its payments on Money instead.",
    );
    expect(await refused(write(db, "link", { dealResponseId: "resp_brillant", taskId: "task_arc" }))).toBe(
      "That deal already matches Professional Touch Company by its alias. If that is wrong, tie its payments on Money instead.",
    );
    expect(await refused(write(db, "link", { dealResponseId: "resp_render", taskId: "task_arc" }))).toBe(
      "That deal already matches Render by its payments. If that is wrong, tie its payments on Money instead.",
    );
    expect(await refused(write(db, "link", { dealResponseId: "resp_void", taskId: "task_arc" }))).toBe(
      "That is not a live signed deal (voided, a test, or not mirrored yet).",
    );
    expect(await refused(write(db, "link", { dealResponseId: "resp_test", taskId: "task_arc" }))).toBe(
      "That is not a live signed deal (voided, a test, or not mirrored yet).",
    );
    const before = await writes(db);
    await actor(db, CEO);
    const linked = await write(db, "link", { dealResponseId: "resp_orphan", taskId: "task_arc", note: "Same client, Arabic name on the form" });
    expect(linked).toMatchObject({ ok: true, sentence: "Linked to Arcturus Construction.", link: { dealResponseId: "resp_orphan", taskId: "task_arc" } });
    expect(await writes(db)).toEqual({ ...before, links: before.links + 1, events: before.events + 1, audit: before.audit + 1 });
    expect(await refused(write(db, "link", { dealResponseId: "resp_orphan", taskId: "task_abc" }))).toBe(
      "That deal is already linked to a card. Unlink it first.",
    );
    const view = await read(db);
    expect(view.unlinked.map((d: { responseId: string }) => d.responseId)).toEqual(["resp_abc"]);
    expect(view.deals.find((d: { taskId: string }) => d.taskId === "task_arc")).toMatchObject({
      responseId: "resp_orphan", matchedBy: "link", linkedByName: "Aziz Waheedi", conflict: false,
    });
    // A linked deal counts the card's own payments too.
    await owner(db);
    await db.exec(`INSERT INTO cockpit_client_payments(payment_id,clickup_task_id,client_name,day,usd,rail,side,kind,active)
      VALUES('whop:pay_arc1','task_arc','Arcturus Construction','2026-08-24',500,'whop','back_end','client',true)`);
    await actor(db, CEO);
    expect((await read(db)).rails.filter((r: { dealResponseId: string }) => r.dealResponseId === "resp_orphan").map((r: { paymentId: string }) => r.paymentId))
      .toEqual(["whop:pay_arc1"]);

    expect(await refused(write(db, "unlink", { dealResponseId: "resp_orphan", reason: "x" }))).toBe("Say why in 3 to 300 characters.");
    const out = await write(db, "unlink", { dealResponseId: "resp_orphan", reason: "Linked by mistake" });
    expect(out).toMatchObject({ ok: true, sentence: "Unlinked from Arcturus Construction." });
    const [e] = await rows(db, "SELECT * FROM cockpit_billing_events WHERE kind='unlink'");
    expect(e).toMatchObject({ clickup_task_id: "task_arc", from_value: "resp_orphan", reason: "Linked by mistake", source: "ceo" });
    expect(await count(db, "SELECT count(*)::int AS n FROM cockpit_audit_log WHERE action IN ('billing.link','billing.unlink')")).toBe(2);
    await actor(db, CEO);
    expect(await refused(write(db, "unlink", { dealResponseId: "resp_orphan", reason: "Linked by mistake" }))).toBe(
      "That deal is not linked to a card. Reload the page.",
    );
    expect((await read(db)).unlinked.map((d: { responseId: string }) => d.responseId)).toEqual(["resp_orphan", "resp_abc"]);
    // Linked again after a clear: a fresh row, the old one kept.
    await write(db, "link", { dealResponseId: "resp_orphan", taskId: "task_arc" });
    expect(await count(db, "SELECT count(*)::int AS n FROM cockpit_billing_deal_links")).toBe(2);
  } finally {
    await db.close();
  }
});

test("7b. a link goes only to a card on the list whose own deal is older; its note stays out of the billing log", async () => {
  const db = await fixture();
  try {
    await actor(db, CEO);
    expect(await refused(write(db, "link", { dealResponseId: "resp_orphan", taskId: "task_x" }))).toBe(
      "Stopped Co is not on the pending payments list. Link the deal to a client who is.",
    );
    expect(await refused(write(db, "link", { dealResponseId: "resp_orphan", taskId: "task_gp" }))).toBe(
      "Paused Ghost is not on the pending payments list. Link the deal to a client who is.",
    );
    // Acme's own deal (1 Sep) is newer than this one (25 Aug): linked there, the deal would show on no row.
    expect(await refused(write(db, "link", { dealResponseId: "resp_orphan", taskId: "task_a" }))).toBe(
      "Acme already has a signed deal from 1 Sep 2026; link this one to the client it belongs to.",
    );
    expect(await count(db, "SELECT count(*)::int AS n FROM cockpit_billing_deal_links")).toBe(0);
    // Professional Touch's own deal (2 Apr) is older: the linked deal becomes its deal, the old form listed under it.
    await actor(db, CEO);
    expect((await write(db, "link", { dealResponseId: "resp_abc", taskId: "task_pt", note: "Renewal under a new name" })).ok).toBe(true);
    const pt = (await rows(db, "SELECT * FROM public.cockpit_billing_deal_cards() WHERE clickup_task_id='task_pt'"))[0];
    expect(pt).toMatchObject({ deal_response_id: "resp_abc", matched_by: "link" });
    expect((pt.other_forms as { responseId: string }[]).map(f => f.responseId)).toEqual(["resp_brillant"]);
    // The CEO's note is kept in the link row and the audit row, never in the more widely read log.
    const [e] = await rows(db, "SELECT reason, to_value FROM cockpit_billing_events WHERE kind='link'");
    expect(e).toEqual({ reason: null, to_value: "resp_abc" });
    const [l] = await rows(db, "SELECT note FROM cockpit_billing_deal_links");
    expect(l.note).toBe("Renewal under a new name");
    const [a] = await rows(db, "SELECT after FROM cockpit_audit_log WHERE action='billing.link'");
    expect((a.after as { note: string }).note).toBe("Renewal under a new name");
  } finally {
    await db.close();
  }
});

test("the billing log's confirm, unconfirm, link, unlink, exclude and unexclude rows are read only by the CEO, client success and finance", async () => {
  const db = await fixture();
  try {
    await actor(db, CSM);
    const c = await write(db, "confirm", confirmAcme());
    await write(db, "withdraw", { taskId: "task_a", confirmationId: c.confirmation.id, reason: "Wrong rail" });
    await actor(db, CEO);
    await write(db, "link", { dealResponseId: "resp_orphan", taskId: "task_arc", note: "Arabic name on the form" });
    await write(db, "unlink", { dealResponseId: "resp_orphan", reason: "Wrong card" });
    await write(db, "exclude", { taskId: "task_a", dealResponseId: "resp_acme_2", paymentId: "whop:pay_a1", reason: "website" });
    await write(db, "unexclude", { paymentId: "whop:pay_a1", reason: "Program money after all" });
    const kinds = async (seat: string) => {
      await actor(db, seat);
      return (await db.query<{ kind: string }>("SELECT kind FROM public.cockpit_billing_events ORDER BY id")).rows.map(r => r.kind);
    };
    const all = ["extension", "note", "date", "confirm", "unconfirm", "link", "unlink", "exclude", "unexclude"];
    for (const seat of [CEO, CSM, FINANCE]) expect(await kinds(seat)).toEqual(all);
    // A media buyer still reads the older kinds, and none of the six.
    expect(await kinds(BUYER)).toEqual(["extension", "note", "date"]);
  } finally {
    await db.close();
  }
});

test("8. the browser cannot touch the three tables or the helpers; the service key reads (Supabase default privileges on)", async () => {
  const db = await fixture({ supabaseDefaultPrivileges: true });
  try {
    for (const seat of [null, CSM, CEO]) {
      await actor(db, seat);
      for (const table of ["cockpit_billing_confirmations", "cockpit_billing_deal_links", "cockpit_billing_payment_exclusions"]) {
        expect(await refused(db.query(`SELECT * FROM public.${table}`))).toContain("permission denied");
        expect(await refused(db.query(`INSERT INTO public.${table}(clickup_task_id) VALUES('task_a')`))).toContain("permission denied");
        expect(await refused(db.query(`UPDATE public.${table} SET clickup_task_id='task_b'`))).toContain("permission denied");
        expect(await refused(db.query(`DELETE FROM public.${table}`))).toContain("permission denied");
      }
      for (const call of [
        "public.cockpit_name_key('x')",
        "public.cockpit_billing_card_listed('task_a', true)",
        "public.cockpit_billing_person_name('x')",
        "* FROM public.cockpit_billing_deal_assignments()",
        "* FROM public.cockpit_billing_deal_cards()",
        "* FROM public.cockpit_billing_deal_rails('resp_acme_2','task_a')",
        "* FROM public.cockpit_billing_deal_rails_held('resp_acme_2','task_a')",
      ]) expect(await refused(db.query(`SELECT ${call}`))).toContain("permission denied");
      expect(await refused(db.query("SELECT nextval('public.cockpit_billing_confirmations_id_seq')"))).toContain("permission denied");
      expect(await refused(db.query("SELECT nextval('public.cockpit_billing_payment_exclusions_id_seq')"))).toContain("permission denied");
    }
    // The two functions are the door, and only for a signed-in seat.
    await actor(db, CEO);
    expect((await read(db)).ceo).toBe(true);
    expect((await write(db, "confirm", confirmAcme())).ok).toBe(true);
    expect((await write(db, "exclude", { taskId: "task_b", dealResponseId: "resp_beta", paymentId: "whop:pay_b1", reason: "website" })).ok).toBe(true);
    await actor(db, null);
    expect(await refused(read(db))).toContain("permission denied");
    expect(await refused(write(db, "unexclude", { paymentId: "whop:pay_b1", reason: "Program money after all" }))).toContain("permission denied");
    // The service key reads both tables.
    await owner(db);
    await db.exec("SET ROLE service_role");
    expect((await db.query("SELECT id FROM public.cockpit_billing_confirmations")).rows).toHaveLength(1);
    expect((await db.query("SELECT id FROM public.cockpit_billing_deal_links")).rows).toHaveLength(0);
    expect((await db.query("SELECT id FROM public.cockpit_billing_payment_exclusions")).rows).toHaveLength(1);
    for (const call of ["public.cockpit_billing_balances_read()", "public.cockpit_name_key('x')"])
      expect(await refused(db.query(`SELECT ${call}`))).toContain("permission denied");
    await owner(db);
    const grants = await rows(db, `SELECT grantee, privilege_type FROM information_schema.role_table_grants
      WHERE table_name IN ('cockpit_billing_confirmations','cockpit_billing_deal_links','cockpit_billing_payment_exclusions') AND grantee IN ('anon','authenticated','PUBLIC')`);
    expect(grants).toEqual([]);
  } finally {
    await db.close();
  }
});

test("9. the kind check takes the four new kinds, and the ClickUp write-back queues nothing for them", async () => {
  const db = await fixture();
  try {
    const queued = await count(db, "SELECT count(*)::int AS n FROM cockpit_clickup_writeback_queue");
    await owner(db);
    await db.exec(`INSERT INTO cockpit_billing_events(clickup_task_id,client_name,kind,source,by_whom) VALUES
      ('task_a','Acme','confirm','csm','fixture'),('task_a','Acme','unconfirm','ceo','fixture'),
      ('task_a','Acme','link','ceo','fixture'),('task_a','Acme','unlink','csm','fixture'),
      ('task_a','Acme','exclude','ceo','fixture'),('task_a','Acme','unexclude','ceo','fixture')`);
    expect(await refused(db.query("INSERT INTO cockpit_billing_events(clickup_task_id,kind,source,by_whom) VALUES('task_a','dance','csm','x')"))).toContain(
      "cockpit_billing_events_kind_check",
    );
    // The old kinds still pass.
    await db.exec("INSERT INTO cockpit_billing_events(clickup_task_id,kind,source,by_whom) VALUES('task_a','chase','maher','x')");
    await actor(db, CSM);
    const c = await write(db, "confirm", confirmAcme());
    await write(db, "withdraw", { taskId: "task_a", confirmationId: c.confirmation.id, reason: "Wrong rail" });
    await actor(db, CEO);
    await write(db, "link", { dealResponseId: "resp_orphan", taskId: "task_arc" });
    await write(db, "unlink", { dealResponseId: "resp_orphan", reason: "Wrong card" });
    await write(db, "exclude", { taskId: "task_a", dealResponseId: "resp_acme_2", paymentId: "whop:pay_a1", reason: "website" });
    await write(db, "unexclude", { paymentId: "whop:pay_a1", reason: "Program money after all" });
    expect(await count(db, "SELECT count(*)::int AS n FROM cockpit_clickup_writeback_queue")).toBe(queued);
  } finally {
    await db.close();
  }
});

test("9b. the kind check is rebuilt from the live list: a kind another build added is kept, and x runs twice", async () => {
  // The live list read on 23 Oct, plus one kind another build added since.
  const db = await fixture({
    beforeX: `ALTER TABLE public.cockpit_billing_events DROP CONSTRAINT cockpit_billing_events_kind_check;
      ALTER TABLE public.cockpit_billing_events ADD CONSTRAINT cockpit_billing_events_kind_check CHECK (kind IN (
        'method','plan','amount','date','extension','pause','resume','payment','assign','note','churn','invoice','chase','refund'));`,
  });
  try {
    await owner(db);
    const kinds = async () => {
      const def = (await rows(db, `SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint
        WHERE conname = 'cockpit_billing_events_kind_check'`))[0].d as string;
      return [...def.matchAll(/'([a-z_]+)'/g)].map(m => m[1]).sort();
    };
    const want = [
      "amount", "assign", "chase", "churn", "confirm", "date", "exclude", "extension", "invoice", "link", "method",
      "note", "pause", "payment", "plan", "refund", "resume", "unconfirm", "unexclude", "unlink",
    ];
    expect(await kinds()).toEqual(want);
    await db.exec(`INSERT INTO cockpit_billing_events(clickup_task_id,kind,source,by_whom) VALUES
      ('task_a','refund','ceo','x'),('task_a','confirm','csm','x')`);
    // Safe to run twice: the rebuilt list reads back the same.
    await db.exec(migration(X));
    expect(await kinds()).toEqual(want);
    // A constraint that is not a list of kinds stops x with a sentence.
    await db.exec(`ALTER TABLE public.cockpit_billing_events DROP CONSTRAINT cockpit_billing_events_kind_check;
      ALTER TABLE public.cockpit_billing_events ADD CONSTRAINT cockpit_billing_events_kind_check CHECK (length(kind) > 0);`);
    expect(await refused(db.exec(migration(X)))).toContain(
      "cockpit_billing_events_kind_check is not a list of kinds",
    );
  } finally {
    await db.close();
  }
});

test("10. delete and truncate are refused on both tables; a row is withdrawn or cleared once and never edited", async () => {
  const db = await fixture();
  try {
    await actor(db, CEO);
    const id = (await write(db, "confirm", confirmAcme())).confirmation.id;
    await write(db, "link", { dealResponseId: "resp_orphan", taskId: "task_arc" });
    await owner(db);
    for (const table of ["cockpit_billing_confirmations", "cockpit_billing_deal_links"]) {
      expect(await refused(db.query(`DELETE FROM public.${table}`))).toBe(`${table} rows are kept for good: withdraw or replace instead of deleting`);
      expect(await refused(db.query(`TRUNCATE public.${table}`))).toBe(`${table} rows are kept for good: withdraw or replace instead of deleting`);
    }
    expect(await refused(db.query(`UPDATE cockpit_billing_confirmations SET usd=1 WHERE id=${id}`))).toBe(
      "cockpit_billing_confirmations rows are never edited: withdraw or clear them instead",
    );
    expect(await refused(db.query(`UPDATE cockpit_billing_confirmations SET withdrawn_by='x' WHERE id=${id}`))).toBe(
      "cockpit_billing_confirmations rows are never edited: withdraw or clear them instead",
    );
    expect(await refused(db.query(`UPDATE cockpit_billing_confirmations SET withdrawn_by='x', withdrawn_at=now(), withdrawn_reason='Typed twice', usd=1 WHERE id=${id}`))).toBe(
      "cockpit_billing_confirmations rows are never edited: withdraw or clear them instead",
    );
    await db.exec(`UPDATE cockpit_billing_confirmations SET withdrawn_by='x', withdrawn_at=now(), withdrawn_reason='Typed twice' WHERE id=${id}`);
    expect(await refused(db.query(`UPDATE cockpit_billing_confirmations SET withdrawn_reason='Changed my mind' WHERE id=${id}`))).toBe(
      "cockpit_billing_confirmations rows are kept as they were once withdrawn or cleared",
    );
    expect(await refused(db.query("UPDATE cockpit_billing_deal_links SET clickup_task_id='task_a'"))).toBe(
      "cockpit_billing_deal_links rows are never edited: withdraw or clear them instead",
    );
    expect(await refused(db.query(`INSERT INTO cockpit_billing_confirmations(clickup_task_id,deal_response_id,part,part_no,amount,currency,usd,rail,paid_on,source,confirmed_by,confirmed_by_ceo)
      VALUES('task_a','resp_acme_2','later',0,10,'USD',10,'tap','2026-09-01','csm','x',false)`))).toContain("cockpit_billing_confirmations_part_no");
    expect(await refused(db.query(`INSERT INTO cockpit_billing_confirmations(clickup_task_id,deal_response_id,part,part_no,amount,currency,usd,rail,paid_on,source,confirmed_by,confirmed_by_ceo)
      VALUES('task_a','resp_acme_2','deposit',0,10,'USD',10,'cash','2026-09-01','csm','x',false)`))).toContain("cockpit_billing_confirmations_rail_check");
    expect(await refused(db.query(`INSERT INTO cockpit_billing_deal_links(deal_response_id,clickup_task_id,set_by) VALUES('resp_orphan','task_abc','x')`))).toContain(
      "cockpit_billing_deal_links_live",
    );
  } finally {
    await db.close();
  }
});

test("11. cockpit_billing_deal_cards: ledger, name, alias, contains at 6+, conflicts, test deals, the newest form", async () => {
  const db = await fixture();
  try {
    const cards = Object.fromEntries(
      (await rows(db, "SELECT * FROM public.cockpit_billing_deal_cards()")).map(r => [r.clickup_task_id as string, r]),
    );
    expect(cards.task_pt).toMatchObject({ deal_response_id: "resp_brillant", matched_by: "alias", conflict: false });
    expect(cards.task_r).toMatchObject({ deal_response_id: "resp_render", matched_by: "ledger" });
    expect(cards.task_c).toMatchObject({ deal_response_id: "resp_castello", matched_by: "name" });
    expect(cards.task_m).toMatchObject({ deal_response_id: "resp_m", matched_by: "name" });
    expect(cards.task_g).toMatchObject({ deal_response_id: "resp_ghost", matched_by: "name" });
    // The newest live form wins (the voided one is newer and left out); older forms listed.
    expect(cards.task_a).toMatchObject({ deal_response_id: "resp_acme_2", matched_by: "ledger" });
    expect((cards.task_a.other_forms as { responseId: string }[]).map(f => f.responseId)).toEqual(["resp_acme_1"]);
    // Two cards on the books claim "Delta Build Group Kuwait": the longer name takes it, flagged.
    expect(cards.task_d2).toMatchObject({ deal_response_id: "resp_delta", matched_by: "name", conflict: true, conflict_with: ["task_d1"] });
    expect(cards.task_d1).toBeUndefined();
    // "Abcde" is 5 characters: no containing match below 6.
    expect(cards.task_abc).toBeUndefined();
    const assigned = Object.fromEntries(
      (await rows(db, "SELECT * FROM public.cockpit_billing_deal_assignments()")).map(r => [r.deal_response_id as string, r]),
    );
    expect(assigned.resp_abc.clickup_task_id).toBeNull();
    expect(assigned.resp_orphan.clickup_task_id).toBeNull();
    for (const gone of ["resp_test", "resp_test2", "resp_void"]) expect(assigned[gone]).toBeUndefined();

    // A gone card and a card on the books with the same name: the card on the books takes the deal, no conflict.
    await db.exec(`INSERT INTO cockpit_billing_accounts(clickup_task_id,client_name,stage,stage_group,client_status)
      VALUES('task_c_old','Castello Industries','Stopped','gone','Stopped')`);
    const again = (await rows(db, "SELECT * FROM public.cockpit_billing_deal_cards() WHERE deal_response_id='resp_castello'"))[0];
    expect(again).toMatchObject({ clickup_task_id: "task_c", conflict: false });
    // The CEO sees who else claims a conflicted deal; the deal still reads.
    await actor(db, CEO);
    const delta = (await read(db)).deals.find((d: { responseId: string }) => d.responseId === "resp_delta");
    expect(delta).toMatchObject({ conflict: true, conflictWith: [{ taskId: "task_d1", name: "Delta Build" }] });
  } finally {
    await db.close();
  }
});

test("12. cockpit_billing_deal_rails: the ledger, the card's own payments from signing - 7, nothing another deal holds, each once", async () => {
  const db = await fixture();
  try {
    const rails = await rows(db, "SELECT payment_id, usd::float AS usd, from_ledger FROM public.cockpit_billing_deal_rails('resp_acme_2','task_a') ORDER BY payment_id");
    expect(rails).toEqual([
      { payment_id: "manual:m_a3", usd: 1000, from_ledger: false },
      { payment_id: "tap:chg_a2", usd: 1000, from_ledger: true },
      { payment_id: "whop:pay_a1", usd: 500, from_ledger: true },
    ]);
    // Without a card, the ledger only.
    expect((await rows(db, "SELECT payment_id FROM public.cockpit_billing_deal_rails('resp_acme_2',NULL) ORDER BY payment_id")).map(r => r.payment_id)).toEqual([
      "tap:chg_a2", "whop:pay_a1",
    ]);
    // The older deal holds its own ledger payment and the card's payments from its own signing - 7.
    expect((await rows(db, "SELECT payment_id FROM public.cockpit_billing_deal_rails('resp_acme_1','task_a') ORDER BY payment_id")).map(r => r.payment_id)).toEqual([
      "manual:m_a3", "whop:pay_a4", "whop:pay_a5",
    ]);
  } finally {
    await db.close();
  }
});

const exclusions = async (db: PGlite, live = false) =>
  count(db, `SELECT count(*)::int AS n FROM cockpit_billing_payment_exclusions${live ? " WHERE withdrawn_at IS NULL" : ""}`);
const leaveAcme = (over: Record<string, unknown> = {}) => ({
  taskId: "task_a", dealResponseId: "resp_acme_2", paymentId: "whop:pay_a1", reason: "website", ...over,
});
const acmeRails = async (db: PGlite) =>
  (await read(db)).rails
    .filter((r: { dealResponseId: string }) => r.dealResponseId === "resp_acme_2")
    .map((r: { paymentId: string }) => r.paymentId);

test("13. exclude and unexclude are the CEO's, audited, and only for a payment the deal already holds", async () => {
  const db = await fixture();
  try {
    for (const seat of [CSM, FINANCE]) {
      await actor(db, seat);
      expect(await refused(write(db, "exclude", leaveAcme()))).toBe("Only the CEO can leave a payment out of program money.");
      expect(await refused(write(db, "unexclude", { paymentId: "whop:pay_a1", reason: "Program money after all" }))).toBe(
        "Only the CEO can leave a payment out of program money.",
      );
    }
    const before = { ...(await writes(db)), exclusions: await exclusions(db) };
    await actor(db, CEO);
    const notHeld = "That payment is not one of Acme's rail payments. Reload the page.";
    const cases: [Record<string, unknown>, string][] = [
      [leaveAcme({ taskId: "task_x" }), "Stopped Co is not on the pending payments list. Reload the page to see who is."],
      [leaveAcme({ taskId: "no such card" }), "That is not a ClickUp card id."],
      [leaveAcme({ paymentId: "pay_a1" }), "That is not a payment id."],
      [leaveAcme({ paymentId: "whop:pay a1" }), "That is not a payment id."],
      [leaveAcme({ reason: "" }), "Say what the payment was for: the website, or something else."],
      [leaveAcme({ reason: "refund" }), "Say what the payment was for: the website, or something else."],
      [leaveAcme({ reason: "other" }), "Say what the payment was for in 3 to 500 characters."],
      [leaveAcme({ reason: "other", note: " ab " }), "Say what the payment was for in 3 to 500 characters."],
      [leaveAcme({ taskId: "task_abc", dealResponseId: "resp_abc" }), "Abcde has no signed deal on record, so no payment counts toward a plan yet."],
      [leaveAcme({ dealResponseId: "resp_acme_1" }), "That signed deal is not this client's newest deal on record. Reload the page."],
      [leaveAcme({ dealResponseId: undefined }), "That signed deal is not this client's newest deal on record. Reload the page."],
      // Invented, another deal's, inactive (ledger and card), the older deal's, before signing - 7, or untied:
      // never a payment Acme's newest deal holds, so nothing can be left out that the row does not count.
      [leaveAcme({ paymentId: "whop:pay_nope" }), notHeld],
      [leaveAcme({ paymentId: "whop:pay_b1" }), notHeld],
      [leaveAcme({ paymentId: "whop:pay_a7" }), notHeld],
      [leaveAcme({ paymentId: "whop:pay_a6" }), notHeld],
      [leaveAcme({ paymentId: "whop:pay_a5" }), notHeld],
      [leaveAcme({ paymentId: "whop:pay_a4" }), notHeld],
      [leaveAcme({ paymentId: "whop:pay_u1" }), notHeld],
    ];
    for (const [args, message] of cases) expect(await refused(write(db, "exclude", args))).toBe(message);
    expect(await refused(write(db, "unexclude", { paymentId: "whop:pay_a1", reason: "Program money after all" }))).toBe(
      "That payment already counts as program money. Reload the page.",
    );
    expect({ ...(await writes(db)), exclusions: await exclusions(db) }).toEqual(before);

    // Before: the card's transfer, the deposit and the Tap remainder, and the cap leaves $3,500.
    await actor(db, CEO);
    expect(await acmeRails(db)).toEqual(["manual:m_a3", "whop:pay_a1", "tap:chg_a2"]);
    expect(await refused(write(db, "confirm", confirmAcme({ amount: 4000 })))).toBe("That is more than the $3,500 the rails have not shown.");

    const out = await write(db, "exclude", leaveAcme({ note: "Sold with the program" }));
    expect(out).toMatchObject({
      ok: true,
      sentence: "Left $500 on 1 Sep out of program money.",
      exclusion: { paymentId: "whop:pay_a1", taskId: "task_a", dealResponseId: "resp_acme_2", reason: "website", usd: 500, day: "2026-09-01", rail: "whop" },
    });
    // One exclusion, one event, one audit row; no payment, inbox row or ClickUp write.
    expect({ ...(await writes(db)), exclusions: await exclusions(db) }).toEqual({
      ...before, events: before.events + 1, audit: before.audit + 1, exclusions: 1,
    });
    // Off the rails everywhere: the read, the helper and the confirm cap. The payment is held by the
    // ledger and by the card, and is taken out once and listed once.
    await actor(db, CEO);
    expect(await acmeRails(db)).toEqual(["manual:m_a3", "tap:chg_a2"]);
    expect((await rows(db, "SELECT payment_id FROM public.cockpit_billing_deal_rails('resp_acme_2','task_a') ORDER BY payment_id")).map(r => r.payment_id))
      .toEqual(["manual:m_a3", "tap:chg_a2"]);
    expect((await rows(db, "SELECT payment_id FROM public.cockpit_billing_deal_rails_held('resp_acme_2','task_a') ORDER BY payment_id")).map(r => r.payment_id))
      .toEqual(["manual:m_a3", "tap:chg_a2", "whop:pay_a1"]);
    await actor(db, CEO);
    const view = await read(db);
    expect(view.exclusions).toEqual([{
      id: out.exclusion.id, paymentId: "whop:pay_a1", dealResponseId: "resp_acme_2", taskId: "task_a", day: "2026-09-01",
      usd: 500, rail: "whop", reason: "website", setByName: "Aziz Waheedi", setAt: expect.any(String), note: "Sold with the program",
    }]);
    expect((await write(db, "confirm", confirmAcme({ amount: 4000 }))).ok).toBe(true);
    expect(await refused(write(db, "exclude", leaveAcme()))).toBe("That payment is already left out of program money.");

    const [e] = await rows(db, "SELECT * FROM cockpit_billing_events WHERE kind='exclude'");
    expect(e).toMatchObject({ clickup_task_id: "task_a", client_name: "Acme", from_value: null, to_value: "whop:pay_a1", reason: null, source: "ceo", by_whom: "aziz@maharamedia.com" });
    expect(e.detail).toEqual({
      exclusionId: out.exclusion.id, paymentId: "whop:pay_a1", dealResponseId: "resp_acme_2", usd: 500, day: "2026-09-01", rail: "whop", reason: "website",
    });
    const [x] = await rows(db, "SELECT * FROM cockpit_billing_payment_exclusions");
    expect(x).toMatchObject({
      payment_id: "whop:pay_a1", clickup_task_id: "task_a", deal_response_id: "resp_acme_2", reason: "website",
      note: "Sold with the program", set_by: "aziz@maharamedia.com", withdrawn_at: null,
    });
    expect(Number(x.event_id)).toBe(Number(e.id));
    const [a] = await rows(db, "SELECT * FROM cockpit_audit_log WHERE action='billing.exclude'");
    expect(a).toMatchObject({
      entity_type: "cockpit_billing_payment_exclusions", entity_id: String(x.id), actor_email: "aziz@maharamedia.com",
      source_app: "media-buyer-cockpit", source_system: "supabase", before: null,
    });
    expect((a.after as { note: string }).note).toBe("Sold with the program");
    expect(a.metadata).toMatchObject({ payment_id: "whop:pay_a1", deal_response_id: "resp_acme_2", usd: 500, day: "2026-09-01", rail: "whop" });

    // Counted again: the CEO, with a reason, once.
    await actor(db, CEO);
    expect(await refused(write(db, "unexclude", { paymentId: "whop:pay_a1", reason: "x" }))).toBe("Say why in 3 to 300 characters.");
    expect(await refused(write(db, "unexclude", { paymentId: "nope", reason: "Program money after all" }))).toBe("That is not a payment id.");
    expect(await write(db, "unexclude", { paymentId: "whop:pay_a1", reason: "Program money after all" })).toMatchObject({
      ok: true, sentence: "Counted as program money again.", exclusion: { paymentId: "whop:pay_a1" },
    });
    expect(await acmeRails(db)).toEqual(["manual:m_a3", "whop:pay_a1", "tap:chg_a2"]);
    expect((await read(db)).exclusions).toEqual([]);
    const [u] = await rows(db, "SELECT * FROM cockpit_billing_events WHERE kind='unexclude'");
    expect(u).toMatchObject({ clickup_task_id: "task_a", client_name: "Acme", from_value: "whop:pay_a1", reason: "Program money after all", source: "ceo" });
    const [ua] = await rows(db, "SELECT before, after FROM cockpit_audit_log WHERE action='billing.unexclude'");
    expect((ua.before as { withdrawn_at: string | null }).withdrawn_at).toBeNull();
    expect((ua.after as { withdrawn_reason: string }).withdrawn_reason).toBe("Program money after all");
    await actor(db, CEO);
    expect(await refused(write(db, "unexclude", { paymentId: "whop:pay_a1", reason: "Program money after all" }))).toBe(
      "That payment already counts as program money. Reload the page.",
    );
    // Left out again: a fresh row, the withdrawn one kept.
    expect((await write(db, "exclude", leaveAcme({ reason: "other", note: "A logo, sold the same day" }))).ok).toBe(true);
    expect(await exclusions(db)).toBe(2);
    expect(await exclusions(db, true)).toBe(1);
  } finally {
    await db.close();
  }
});

test("13b. the read lists exclusions only on the caller's deals, the note only for the CEO; an untied payment stays Possible money", async () => {
  const db = await fixture();
  try {
    await actor(db, CEO);
    await write(db, "exclude", leaveAcme({ reason: "other", note: "A logo, sold the same day" }));
    await write(db, "exclude", { taskId: "task_b", dealResponseId: "resp_beta", paymentId: "whop:pay_b1", reason: "website" });
    // The CEO's Back with sales card: only he may leave one of its payments out.
    await write(db, "exclude", { taskId: "task_s", dealResponseId: "resp_sales", paymentId: "whop:pay_s1", reason: "website" });
    // The service key can hold rows the write never makes: one naming an untied payment, and one on a deal with no card.
    await owner(db);
    await db.exec(`INSERT INTO cockpit_deal_payments(payment_id,deal_response_id,day,usd,rail,kind,deposit_usd,matched_by,active)
        VALUES('whop:pay_o1','resp_orphan','2026-08-26',500,'whop','deposit',500,'ceo',true);
      INSERT INTO cockpit_billing_payment_exclusions(payment_id,clickup_task_id,deal_response_id,reason,note,set_by) VALUES
        ('whop:pay_u1','task_arc','resp_orphan','other','Not this client''s money','aziz@maharamedia.com'),
        ('whop:pay_o1','task_arc','resp_orphan','website',NULL,'aziz@maharamedia.com')`);

    await actor(db, CEO);
    const all = await read(db);
    expect(all.exclusions.map((x: { paymentId: string; dealResponseId: string; taskId: string | null }) => [x.paymentId, x.dealResponseId, x.taskId])).toEqual([
      ["whop:pay_a1", "resp_acme_2", "task_a"],
      ["whop:pay_b1", "resp_beta", "task_b"],
      ["whop:pay_s1", "resp_sales", "task_s"],
      ["whop:pay_o1", "resp_orphan", null],
    ]);
    // A mark naming a payment its deal does not hold is listed on no row.
    expect(JSON.stringify(all.exclusions)).not.toContain("whop:pay_u1");
    expect(all.exclusions[0].note).toBe("A logo, sold the same day");
    expect(all.rails.some((r: { paymentId: string }) => ["whop:pay_a1", "whop:pay_b1"].includes(r.paymentId))).toBe(false);
    expect(all.backWithSales[0].rails).toEqual([]);
    expect(all.unlinked.find((d: { responseId: string }) => d.responseId === "resp_orphan").rails).toEqual([]);
    // An untied payment is on no deal, so no mark takes it off the CEO's Possible money.
    expect(all.untied.map((u: { id: string }) => u.id)).toEqual(["whop:pay_u1"]);

    await actor(db, CSM);
    const mine = await read(db);
    expect(mine.exclusions).toEqual([{
      id: expect.any(Number), paymentId: "whop:pay_a1", dealResponseId: "resp_acme_2", taskId: "task_a", day: "2026-09-01",
      usd: 500, rail: "whop", reason: "other", setByName: "Aziz Waheedi", setAt: expect.any(String),
    }]);
    const text = JSON.stringify(mine);
    for (const other of ["whop:pay_b1", "whop:pay_s1", "whop:pay_o1", "A logo", "aziz@maharamedia.com"]) expect(text).not.toContain(other);
  } finally {
    await db.close();
  }
});

test("13h. a mark counts only on the deal it was set on: Money moving the payment moves the money, and a new mark replaces the old", async () => {
  const db = await fixture();
  try {
    await actor(db, CEO);
    const first = await write(db, "exclude", leaveAcme());
    // Money ties the payment to Beta's deal since, and credits Beta's card (the
    // ledger and the cards' payments hold a payment once each).
    await owner(db);
    await db.exec(`UPDATE cockpit_deal_payments SET deal_response_id='resp_beta' WHERE payment_id='whop:pay_a1';
      UPDATE cockpit_client_payments SET clickup_task_id='task_b', client_name='Beta Co' WHERE payment_id='whop:pay_a1'`);
    expect((await rows(db, "SELECT payment_id FROM cockpit_billing_deal_rails('resp_beta','task_b') ORDER BY payment_id")).map(r => r.payment_id)).toEqual([
      "whop:pay_a1", "whop:pay_b1",
    ]);
    await actor(db, CEO);
    const moved = await read(db);
    // Beta's rails count it; Acme's no longer hold it; no row names the mark, which was Acme's.
    expect(moved.rails.filter((r: { dealResponseId: string }) => r.dealResponseId === "resp_beta").map((r: { paymentId: string }) => r.paymentId)).toEqual([
      "whop:pay_a1", "whop:pay_b1",
    ]);
    expect(await acmeRails(db)).toEqual(["manual:m_a3", "tap:chg_a2"]);
    expect(moved.exclusions).toEqual([]);
    // Nor does a success manager's read.
    await actor(db, CSM);
    expect((await read(db)).exclusions).toEqual([]);

    // The CEO leaves it out on Beta: the old mark is withdrawn with its own event and audit row.
    await actor(db, CEO);
    const before = { ...(await writes(db)), exclusions: await exclusions(db) };
    const out = await write(db, "exclude", { taskId: "task_b", dealResponseId: "resp_beta", paymentId: "whop:pay_a1", reason: "website" });
    expect(out).toMatchObject({ ok: true, sentence: "Left $500 on 1 Sep out of program money.", exclusion: { taskId: "task_b", dealResponseId: "resp_beta" } });
    expect({ ...(await writes(db)), exclusions: await exclusions(db) }).toEqual({
      ...before, events: before.events + 2, audit: before.audit + 2, exclusions: before.exclusions + 1,
    });
    expect(await exclusions(db, true)).toBe(1);
    const [old] = await rows(db, `SELECT * FROM cockpit_billing_payment_exclusions WHERE id = ${first.exclusion.id}`);
    expect(old).toMatchObject({
      deal_response_id: "resp_acme_2", withdrawn_by: "aziz@maharamedia.com",
      withdrawn_reason: "Left out again on the deal that holds it now (resp_beta)",
    });
    expect(old.withdrawn_at).not.toBeNull();
    const [u] = await rows(db, "SELECT * FROM cockpit_billing_events WHERE kind='unexclude'");
    expect(u).toMatchObject({ clickup_task_id: "task_a", client_name: "Acme", from_value: "whop:pay_a1", source: "ceo", by_whom: "aziz@maharamedia.com" });
    expect(u.detail).toEqual({ exclusionId: first.exclusion.id, paymentId: "whop:pay_a1", dealResponseId: "resp_acme_2", movedToDealResponseId: "resp_beta" });
    const [ua] = await rows(db, "SELECT * FROM cockpit_audit_log WHERE action='billing.unexclude'");
    expect(ua).toMatchObject({ entity_id: String(first.exclusion.id), actor_email: "aziz@maharamedia.com" });
    expect(ua.before.withdrawn_at).toBeNull();
    expect(ua.after.withdrawn_reason).toBe("Left out again on the deal that holds it now (resp_beta)");
    const now = await read(db);
    expect(now.exclusions.map((x: { paymentId: string; dealResponseId: string; taskId: string }) => [x.paymentId, x.dealResponseId, x.taskId])).toEqual([
      ["whop:pay_a1", "resp_beta", "task_b"],
    ]);
    expect(now.rails.some((r: { paymentId: string }) => r.paymentId === "whop:pay_a1")).toBe(false);
    expect(await refused(write(db, "exclude", { taskId: "task_b", dealResponseId: "resp_beta", paymentId: "whop:pay_a1", reason: "website" }))).toBe(
      "That payment is already left out of program money.",
    );
  } finally {
    await db.close();
  }
});

test("13c. delete and truncate are refused on the exclusions table; a row is withdrawn once and never edited", async () => {
  const db = await fixture();
  try {
    await actor(db, CEO);
    const id = (await write(db, "exclude", leaveAcme())).exclusion.id;
    await owner(db);
    const table = "cockpit_billing_payment_exclusions";
    expect(await refused(db.query(`DELETE FROM public.${table}`))).toBe(`${table} rows are kept for good: withdraw or replace instead of deleting`);
    expect(await refused(db.query(`TRUNCATE public.${table}`))).toBe(`${table} rows are kept for good: withdraw or replace instead of deleting`);
    expect(await refused(db.query(`UPDATE ${table} SET reason='other', note='Changed' WHERE id=${id}`))).toBe(
      `${table} rows are never edited: withdraw or clear them instead`,
    );
    expect(await refused(db.query(`UPDATE ${table} SET withdrawn_by='x', withdrawn_at=now(), withdrawn_reason='Typed twice', payment_id='whop:pay_b1' WHERE id=${id}`))).toBe(
      `${table} rows are never edited: withdraw or clear them instead`,
    );
    await db.exec(`UPDATE ${table} SET withdrawn_by='x', withdrawn_at=now(), withdrawn_reason='Typed twice' WHERE id=${id}`);
    expect(await refused(db.query(`UPDATE ${table} SET withdrawn_reason='Changed my mind' WHERE id=${id}`))).toBe(
      `${table} rows are kept as they were once withdrawn or cleared`,
    );
    // One live row per payment, a reason from the list, and "other" says what.
    await db.exec(`INSERT INTO ${table}(payment_id,clickup_task_id,deal_response_id,reason,set_by) VALUES('whop:pay_a1','task_a','resp_acme_2','website','x')`);
    expect(await refused(db.query(`INSERT INTO ${table}(payment_id,clickup_task_id,deal_response_id,reason,set_by) VALUES('whop:pay_a1','task_a','resp_acme_2','website','x')`))).toContain(
      "cockpit_billing_payment_exclusions_live",
    );
    expect(await refused(db.query(`INSERT INTO ${table}(payment_id,clickup_task_id,deal_response_id,reason,set_by) VALUES('whop:pay_b1','task_b','resp_beta','refund','x')`))).toContain(
      "cockpit_billing_payment_exclusions_reason_check",
    );
    expect(await refused(db.query(`INSERT INTO ${table}(payment_id,clickup_task_id,deal_response_id,reason,set_by) VALUES('whop:pay_b1','task_b','resp_beta','other','x')`))).toContain(
      "cockpit_billing_payment_exclusions_other_says_what",
    );
  } finally {
    await db.close();
  }
});

/** The card, deal and Whop payments the 20261024p seed names, under a made-up name. */
const SEED = {
  task: "86eynfnv5",
  deal: "r6zgixh2u6paruulr6zgi2w9lckol261",
  website: "whop:pay_fjRE96EdeUqfmO",
  twin: "whop:pay_GYsGMMpS9xosfk",
  deposit: "whop:pay_muyoob7p33D97Q",
};
async function seedClient(db: PGlite, payments: string[]) {
  await owner(db);
  const day = (id: string) => (id === SEED.deposit ? "2026-08-17" : "2026-08-21");
  const usd = (id: string) => (id === SEED.deposit ? 500 : 1500);
  await db.exec(`
    INSERT INTO cockpit_billing_accounts(clickup_task_id,client_name,stage,stage_group,client_status,payment_plan,next_payment_usd,next_payment_date,ltv_field_usd)
      VALUES('${SEED.task}','Seed Client','Active','active','Active','Monthly',2000,'2026-10-08',2000);
    INSERT INTO cockpit_sales_deals(response_id,submitted_at,closer,client_name,business_name,payment_structure,cash_collected,contracted_revenue,voided)
      VALUES('${SEED.deal}','2026-08-17T14:00:28Z','Closer One','Contact Seed','Seed Client','Monthly',500,6000,false);
    INSERT INTO cockpit_deal_payments(payment_id,deal_response_id,day,usd,rail,kind,deposit_usd,matched_by,active) VALUES
      ${payments.map(id => `('${id}','${SEED.deal}','${day(id)}',${usd(id)},'whop','${id === SEED.deposit ? "deposit" : "remainder"}',${id === SEED.deposit ? 500 : 0},'ceo',true)`).join(",")};
    INSERT INTO cockpit_client_payments(payment_id,clickup_task_id,client_name,day,usd,rail,side,kind,active) VALUES
      ${payments.map(id => `('${id}','${SEED.task}','Seed Client','${day(id)}',${usd(id)},'whop','front_end','${id === SEED.deposit ? "deposit" : "remainder"}',true)`).join(",")};`);
}

test("13e. the seed leaves Castello's website $1,500 out once, with its event and audit row, and never again", async () => {
  const db = await fixture();
  try {
    // The first run (in schema) found no such card here, so it wrote nothing.
    expect(await exclusions(db)).toBe(0);
    await seedClient(db, [SEED.deposit, SEED.website, SEED.twin]);
    await db.exec(migration(P));
    const [x] = await rows(db, "SELECT * FROM cockpit_billing_payment_exclusions");
    expect(x).toMatchObject({
      payment_id: SEED.website, clickup_task_id: SEED.task, deal_response_id: SEED.deal, reason: "website",
      note: "The CEO, 23 Oct 2026: one of Castello's two $1,500 payments of 21 Aug was the website, not program money (the two are identical in Whop; the later one carries the mark).",
      set_by: "aziz@maharamedia.com", withdrawn_at: null,
    });
    const [e] = await rows(db, "SELECT * FROM cockpit_billing_events WHERE kind='exclude'");
    expect(e).toMatchObject({ clickup_task_id: SEED.task, client_name: "Seed Client", to_value: SEED.website, reason: null, source: "ceo", by_whom: "aziz@maharamedia.com" });
    expect(e.detail).toMatchObject({ paymentId: SEED.website, dealResponseId: SEED.deal, usd: 1500, day: "2026-08-21", rail: "whop", reason: "website" });
    expect(Number(x.event_id)).toBe(Number(e.id));
    const [a] = await rows(db, "SELECT * FROM cockpit_audit_log WHERE action='billing.exclude'");
    expect(a).toMatchObject({ entity_type: "cockpit_billing_payment_exclusions", entity_id: String(x.id), actor_email: "aziz@maharamedia.com", before: null });
    expect(a.metadata).toMatchObject({ payment_id: SEED.website, usd: 1500, run_by: "migration 20261024p" });

    // Pending payments counts the deposit and the twin only: $2,000, not $3,500.
    await actor(db, CEO);
    const view = await read(db);
    const rails = view.rails.filter((r: { dealResponseId: string }) => r.dealResponseId === SEED.deal);
    expect(rails.map((r: { paymentId: string }) => r.paymentId)).toEqual([SEED.deposit, SEED.twin]);
    expect(rails.reduce((t: number, r: { usd: number }) => t + Number(r.usd), 0)).toBe(2000);
    expect(view.exclusions).toEqual([{
      id: expect.any(Number), paymentId: SEED.website, dealResponseId: SEED.deal, taskId: SEED.task, day: "2026-08-21", usd: 1500,
      rail: "whop", reason: "website", setByName: "Aziz Waheedi", setAt: expect.any(String), note: x.note,
    }]);

    // Safe to run twice: still one of each.
    await owner(db);
    await db.exec(migration(P));
    await db.exec(migration(P));
    expect(await exclusions(db)).toBe(1);
    expect(await count(db, "SELECT count(*)::int AS n FROM cockpit_billing_events WHERE kind='exclude'")).toBe(1);
    expect(await count(db, "SELECT count(*)::int AS n FROM cockpit_audit_log WHERE action='billing.exclude'")).toBe(1);
    // Counted again by the CEO, a later run does not put it back.
    await actor(db, CEO);
    await write(db, "unexclude", { paymentId: SEED.website, reason: "Checked the Whop receipt" });
    await owner(db);
    await db.exec(migration(P));
    expect(await exclusions(db)).toBe(1);
    expect(await exclusions(db, true)).toBe(0);
  } finally {
    await db.close();
  }
});

test("13f. the seed refuses, and writes nothing, when the website payment is no longer the deal's", async () => {
  const db = await fixture();
  try {
    await seedClient(db, [SEED.deposit, SEED.twin]);
    expect(await refused(db.exec(migration(P)))).toContain(
      `20261024p: ${SEED.website} is not one of Castello's rail payments any more; read it again before applying.`,
    );
    await db.exec("ROLLBACK");
    expect(await exclusions(db)).toBe(0);
    expect(await count(db, "SELECT count(*)::int AS n FROM cockpit_billing_events WHERE kind='exclude'")).toBe(0);
    expect(await count(db, "SELECT count(*)::int AS n FROM cockpit_audit_log WHERE action='billing.exclude'")).toBe(0);
  } finally {
    await db.close();
  }
});

test("13g. the guard: a live body that is neither 20261023's nor this file's stops the file, which changes nothing", async () => {
  const db = await fixture();
  try {
    await owner(db);
    const src = async (fn: string) =>
      String((await rows(db, `SELECT md5(prosrc) AS m FROM pg_proc WHERE oid = to_regprocedure('${fn}')`))[0].m);
    const writeNow = await src("public.cockpit_billing_balance_write(text,jsonb)");
    // Someone changed the rails since 20261023x.
    await db.exec(`CREATE OR REPLACE FUNCTION public.cockpit_billing_deal_rails(p_deal text, p_task text)
      RETURNS TABLE(payment_id text, day date, usd numeric, rail text, from_ledger boolean, kind text, recorded_at timestamptz)
      LANGUAGE sql STABLE SET search_path='' AS $$ SELECT * FROM public.cockpit_billing_deal_rails_held(p_deal, p_task) $$;`);
    const railsChanged = await src("public.cockpit_billing_deal_rails(text,text)");
    expect(await refused(db.exec(migration(P)))).toContain(
      "cockpit_billing_deal_rails is not the definition this file was written against",
    );
    await db.exec("ROLLBACK");
    expect(await src("public.cockpit_billing_deal_rails(text,text)")).toBe(railsChanged);
    // And the write (20261023x's rails back first, which this file accepts).
    await db.exec(migration(X));
    await db.exec(migration(P));
    await db.exec(`CREATE OR REPLACE FUNCTION public.cockpit_billing_balance_write(p_action text, p_args jsonb DEFAULT '{}'::jsonb)
      RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN RETURN NULL; END $$;`);
    expect(await refused(db.exec(migration(P)))).toContain(
      "cockpit_billing_balance_write is not the definition this file was written against",
    );
    await db.exec("ROLLBACK");
    expect(await src("public.cockpit_billing_balance_write(text,jsonb)")).not.toBe(writeNow);
    // 20261023y's body again is accepted, and replaced by this file's.
    await db.exec(migration(Y));
    await db.exec(migration(P));
    expect(await src("public.cockpit_billing_balance_write(text,jsonb)")).toBe(writeNow);
  } finally {
    await db.close();
  }
});

test("cockpit_name_key agrees with money.js nameKey, Arabic presentation forms included", async () => {
  const money = readFileSync(new URL("../../../hermes/ceo-refresh/native/adapters/money.js", import.meta.url), "utf8");
  // The expression below is money.js's; if money.js changes it, this test points here.
  expect(money).toContain('normalize("NFKD").replace(/\\p{M}/gu, "").toLowerCase().replace(/[^\\p{L}\\p{N}]/gu, "")');
  const jsKey = (v: string) => v.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  const samples = [
    "مدانة العمرانية لﻺستشارات",
    "شركة أدق الحلول للمقاوﻻت",
    "شركة سويل للمقاوﻻت",
    "مُحَمَّد",
    "Brillant Touch Company!",
    "Shades Interior Design & General Contracting",
    "Café ٣ ﻻ",
    "mergestudio.kw",
    "Ｆｕｌｌ Ｗｉｄｔｈ",
    "",
  ];
  const db = await fixture();
  try {
    for (const s of samples) {
      const r = await db.query<{ k: string }>("SELECT public.cockpit_name_key($1) AS k", [s]);
      expect(r.rows[0].k).toBe(jsKey(s));
    }
    expect((await db.query<{ k: string }>("SELECT public.cockpit_name_key(NULL) AS k")).rows[0].k).toBe("");
  } finally {
    await db.close();
  }
});

test("safe to run twice: the three migrations again keep every row and every rule", async () => {
  const db = await fixture({ supabaseDefaultPrivileges: true });
  try {
    await actor(db, CEO);
    const first = (await write(db, "confirm", confirmAcme())).confirmation.id;
    await write(db, "link", { dealResponseId: "resp_orphan", taskId: "task_arc" });
    await write(db, "exclude", { taskId: "task_b", dealResponseId: "resp_beta", paymentId: "whop:pay_b1", reason: "website" });
    await owner(db);
    await db.exec(migration(X));
    await db.exec(migration(Y));
    await db.exec(migration(P));
    await db.exec(migration(P));
    expect(await count(db, "SELECT count(*)::int AS n FROM cockpit_billing_payment_exclusions WHERE withdrawn_at IS NULL")).toBe(1);
    expect(await refused(db.query("DELETE FROM cockpit_billing_payment_exclusions"))).toContain("kept for good");
    await actor(db, CEO);
    const again = await read(db);
    expect(again.exclusions.map((x: { paymentId: string }) => x.paymentId)).toEqual(["whop:pay_b1"]);
    expect(again.rails.some((r: { paymentId: string }) => r.paymentId === "whop:pay_b1")).toBe(false);
    await owner(db);
    expect(await count(db, "SELECT count(*)::int AS n FROM cockpit_billing_confirmations")).toBe(1);
    expect(await count(db, "SELECT count(*)::int AS n FROM cockpit_billing_deal_links WHERE cleared_at IS NULL")).toBe(1);
    expect(await refused(db.query("DELETE FROM cockpit_billing_confirmations"))).toContain("kept for good");
    await actor(db, CSM);
    expect(await refused(db.query("SELECT * FROM cockpit_billing_confirmations"))).toContain("permission denied");
    const view = await read(db);
    expect(view.confirmations.map((c: { id: number }) => c.id)).toEqual([first]);
    expect((await write(db, "confirm", confirmAcme({ amount: 100, paidOn: "2026-09-03" }))).ok).toBe(true);
  } finally {
    await db.close();
  }
});
