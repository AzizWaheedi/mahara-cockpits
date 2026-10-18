/**
 * Money ties and the deal ledger (docs/money/MONEY-ATTRIBUTION.md section 3),
 * migration 20261018c, in PGlite with Supabase's default privileges on.
 * The finance refresh tables and the worker path load from their canonical
 * migrations (as live, 20261007e); made-up people, clients and payment ids only.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import { migration } from "./lib/cockpitTestDb";
import { ADMIN, actor, call, CEO, hoursTestDb, MEMBER, owner, service } from "./lib/hoursTestDb";

const MIGRATION = "20261018c_money_ties_deal_payments.sql";
let db: PGlite;
let today = "";

function extract(sql: string, pattern: RegExp, what: string): string {
  const hit = sql.match(pattern);
  if (!hit) throw new Error(`Canonical definition missing: ${what}`);
  return hit[0];
}

/** Money in and out as the last published money section shows it (made-up ids). */
const PUBLISHED = [
  { id: "whop:pay_fixtureA", day: "2026-10-01", rail: "whop", direction: "in", usd: 1500, payerName: "Payer One", side: "unattributed" },
  { id: "whop:pay_fixtureB", day: "2026-10-02", rail: "whop", direction: "in", usd: 500, payerName: "Payer Two", side: "unattributed" },
  { id: "transfer:fixture-transfer-1", day: "2026-10-03", rail: "transfer", direction: "in", usd: 2500, payerName: "Client A", side: "back_end" },
  { id: "whop:pay_outOnly", day: "2026-10-04", rail: "whop", direction: "out", usd: 200, payerName: "Payer Three", side: "out" },
];

function financeOutput(extra: Record<string, unknown> = {}) {
  return {
    sections: [
      { key: "money", label: "Money", payload: { attribution: { transactions: PUBLISHED }, rails: { manual: { connected: true } } }, sources: [{ name: "Fixture", ok: true }] },
      { key: "expenses", label: "Expenses", payload: { month: "2026-10" }, sources: [{ name: "Fixture", ok: true }] },
    ],
    payments: [],
    ...extra,
  };
}

async function moneyTiesDb(): Promise<PGlite> {
  // Roster, audit log, CEO gate, the hours helpers (gate, audit, refuse-delete) and Tap charges.
  const next = await hoursTestDb();
  await owner(next);
  const core = migration("20260919_cockpit_core.sql");
  for (const name of ["cockpit_client_billing_days", "cockpit_metric_days", "cockpit_payer_clients"]) {
    await next.exec(extract(core, new RegExp(`create table if not exists public\\.${name} \\([\\s\\S]*?\\n\\);`, "i"), name));
  }
  const manual = migration("20260927d_cockpit_manual_payments_access.sql");
  for (const name of ["cockpit_manual_payment_state", "cockpit_manual_payments"]) {
    await next.exec(extract(manual, new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${name}\\([\\s\\S]*?\\n\\);`), name));
  }
  await next.exec("INSERT INTO public.cockpit_manual_payment_state(id,history_ready) VALUES(true,true) ON CONFLICT DO NOTHING");
  await next.exec(migration("20260921c_bank_statements.sql"));
  await next.exec(extract(migration("20260921d_cockpit_metrics.sql"), /create table if not exists public\.cockpit_sections \([\s\S]*?\n\);/i, "cockpit_sections"));
  // The columns and receipts table 20260927h adds, which the snapshot and 20260927i read.
  const actions = migration("20260927h_cockpit_ceo_actions.sql");
  for (const pattern of [
    /ALTER TABLE public\.cockpit_payer_clients ADD COLUMN IF NOT EXISTS cleared_at timestamptz;/,
    /CREATE TABLE IF NOT EXISTS public\.cockpit_ceo_provider_health\(.*\);/,
    /ALTER TABLE public\.cockpit_expense_exclusions ADD COLUMN IF NOT EXISTS removed_at timestamptz;/,
    /ALTER TABLE public\.cockpit_bank_lines ADD COLUMN IF NOT EXISTS base_kind text;/,
    /ALTER TABLE public\.cockpit_bank_lines ADD COLUMN IF NOT EXISTS manual_kind boolean NOT NULL DEFAULT false;/,
  ]) await next.exec(extract(actions, pattern, String(pattern)));
  await next.exec(migration("20260927i_cockpit_finance_refresh.sql"));
  // The worker path as it is live (20261007e): service-role jobs, the snapshot and the input reader.
  const restore = migration("20261007e_cockpit_provider_rpc_restore.sql");
  await next.exec("ALTER TABLE public.cockpit_finance_refreshes ALTER COLUMN actor_id DROP NOT NULL");
  for (const fn of ["cockpit_ceo_refresh_require_service", "cockpit_ceo_refresh_finance_snapshot",
    "cockpit_ceo_worker_begin_finance_refresh", "cockpit_finance_refresh_input"]) {
    await next.exec(extract(restore, new RegExp(`CREATE OR REPLACE FUNCTION public\\.${fn}\\([\\s\\S]*?\\n\\$\\$;`), fn));
  }
  await next.exec(`
    REVOKE ALL ON FUNCTION public.cockpit_ceo_refresh_require_service(), public.cockpit_ceo_refresh_finance_snapshot(),
      public.cockpit_ceo_worker_begin_finance_refresh(), public.cockpit_finance_refresh_input(uuid) FROM PUBLIC, anon, authenticated, service_role;
    GRANT EXECUTE ON FUNCTION public.cockpit_ceo_worker_begin_finance_refresh(), public.cockpit_finance_refresh_input(uuid) TO service_role;`);
  // Signed deals (the B2B closed_deals mirror).
  await next.exec(extract(migration("20260924a_sales_cockpit.sql"), /create table if not exists public\.cockpit_sales_deals \([\s\S]*?\n\);/i, "cockpit_sales_deals"));
  await next.exec("ALTER TABLE public.cockpit_sales_deals ENABLE ROW LEVEL SECURITY; REVOKE ALL ON public.cockpit_sales_deals FROM anon, authenticated;");
  await next.exec(migration(MIGRATION));

  // Made-up sources.
  await next.exec(`
    INSERT INTO public.cockpit_sales_deals(response_id,submitted_at,closer,business_name,email,contracted_revenue,cash_collected,voided) VALUES
      ('resp_deal_a','2026-10-01T09:00:00Z','Closer One','Client A','client.a@example.test',6000,500,false),
      ('resp_deal_void','2026-10-02T09:00:00Z','Closer One','Client V','client.v@example.test',3000,0,true),
      ('resp_unsigned',NULL,'Closer One','Client U','client.u@example.test',3000,0,false);
    INSERT INTO public.cockpit_client_billing_days(day,clickup_task_id,client_name) VALUES('2026-10-01','task_card_a','Client A');
    INSERT INTO public.cockpit_finance_client_aliases(source_kind,source_id,task_id,name,source_record) VALUES('client','alias-b','task_card_b','Client B','{}');
    INSERT INTO public.cockpit_sections(key,label,computed_at,payload,sources)
      VALUES('money','Money',now(),'{"attribution":{"transactions":${JSON.stringify(PUBLISHED)}},"rails":{"manual":{"connected":true}}}','[]');
    INSERT INTO public.cockpit_tap_charges(id,day,at,status,live,currency,amount,usd,email,name) VALUES
      ('chg_fixture1','2026-10-05','2026-10-05T10:00:00Z','CAPTURED',true,'KWD',150,489,'payer.four@example.test','Payer Four'),
      ('chg_fixture2','2026-10-05','2026-10-05T11:00:00Z','FAILED',true,'KWD',150,489,'payer.four@example.test','Payer Four');
    INSERT INTO public.cockpit_statements(id,account,imported_by) VALUES('fixture-statement','0000','fixture');
    INSERT INTO public.cockpit_bank_lines(id,statement_id,account,hash,day,amount,usd,kind) VALUES
      (9001,'fixture-statement','0000','fixture:1','2026-10-06',300,978,'client_payment'),
      (9002,'fixture-statement','0000','fixture:2','2026-10-06',-30,-97.8,'expense');
    INSERT INTO public.cockpit_manual_payments(id,day,amount,currency,amount_usd,usd_per_unit,client_name,client_key,rail,added_by) VALUES
      ('manual-fixture-1','2026-10-07',1000,'USD',1000,1,'Client B','clientb','cash','fixture@example.test');
    INSERT INTO public.cockpit_manual_payments(id,day,amount,currency,amount_usd,usd_per_unit,client_name,client_key,rail,added_by,deleted_by,deleted_at) VALUES
      ('manual-fixture-gone','2026-10-07',1000,'USD',1000,1,'Client B','clientb','cash','fixture@example.test','fixture@example.test',now());
    -- The alias import above marks aliases as needing reconciliation (as live); reconcile.
    UPDATE public.cockpit_finance_source_state SET aliases_ready=true, manual_ready=true;`);
  today = (await next.query<{ d: string }>("select ((now() at time zone 'Asia/Kuwait')::date)::text d")).rows[0].d;
  return next;
}

async function revision(): Promise<number> {
  await owner(db);
  return Number((await db.query<{ r: number }>("select revision::int r from public.cockpit_manual_payment_state")).rows[0].r);
}
async function tie(p: unknown) {
  await actor(db, CEO);
  return call(db, "cockpit_ceo_payment_tie", p);
}
async function untie(p: unknown) {
  await actor(db, CEO);
  return call(db, "cockpit_ceo_payment_untie", p);
}
async function liveTies() {
  await owner(db);
  return (await db.query<Record<string, unknown>>("select * from public.cockpit_payment_ties where cleared_at is null order by id")).rows;
}
async function startJob(): Promise<string> {
  await service(db);
  return (await db.query<{ r: { id: string } }>("select public.cockpit_ceo_worker_begin_finance_refresh() r")).rows[0].r.id;
}
async function finish(id: string, output: unknown) {
  await service(db);
  return (await db.query<{ r: Record<string, unknown> }>("select public.cockpit_finish_finance_refresh($1::uuid,$2::jsonb) r", [id, JSON.stringify(output)])).rows[0].r;
}
async function fail(id: string) {
  await service(db);
  await db.query("select public.cockpit_finish_finance_refresh($1::uuid,NULL,'Fixture: inputs changed')", [id]);
}
async function ledger() {
  await owner(db);
  return (await db.query<Record<string, unknown>>(
    "select payment_id,deal_response_id,day::text AS day,usd::float8 AS usd,rail,kind,deposit_usd::float8 AS deposit_usd,matched_by,tie_id::int AS tie_id,payer,active,source_refresh_id::text AS source_refresh_id from public.cockpit_deal_payments order by payment_id")).rows;
}

const BASE = { note: "Fixture: the payer is the deal's contact" };

beforeAll(async () => { db = await moneyTiesDb(); }, 60000);
afterAll(async () => { await db.close(); });

describe("access", () => {
  test("anon, a non-CEO admin, a member and a revoked CEO get 42501 on both RPCs", async () => {
    const calls = ["select public.cockpit_ceo_payment_tie('{}'::jsonb)", "select public.cockpit_ceo_payment_untie('{}'::jsonb)"];
    for (const who of [null, ADMIN, MEMBER]) {
      await actor(db, who);
      for (const sql of calls) await expect(db.query(sql)).rejects.toMatchObject({ code: "42501" });
    }
    await owner(db);
    await db.query("update public.cockpit_members set active=false where auth_user_id=$1", [CEO]);
    try {
      await actor(db, CEO);
      for (const sql of calls) await expect(db.query(sql)).rejects.toMatchObject({ code: "42501" });
    } finally {
      await owner(db);
      await db.query("update public.cockpit_members set active=true where auth_user_id=$1", [CEO]);
    }
  });

  test("the tables and the sequence are unreachable; service_role reads only", async () => {
    for (const who of [null, MEMBER, ADMIN, CEO]) {
      await actor(db, who);
      for (const t of ["cockpit_payment_ties", "cockpit_deal_payments"]) {
        await expect(db.query(`select * from public.${t} limit 1`)).rejects.toMatchObject({ code: "42501" });
      }
      await expect(db.query("select nextval('public.cockpit_payment_ties_id_seq')")).rejects.toMatchObject({ code: "42501" });
    }
    await service(db);
    await expect(db.query("select * from public.cockpit_payment_ties limit 1")).resolves.toBeTruthy();
    await expect(db.query("select * from public.cockpit_deal_payments limit 1")).resolves.toBeTruthy();
    await expect(db.query("insert into public.cockpit_payment_ties(payment_id,deal_response_id,note,set_by) values('whop:pay_x','resp_deal_a','Fixture note','x')"))
      .rejects.toMatchObject({ code: "42501" });
    await expect(db.query("insert into public.cockpit_deal_payments(payment_id,deal_response_id,day,usd,rail,kind,matched_by) values('whop:pay_x','resp_deal_a','2026-10-01',1,'whop','deposit','ceo')"))
      .rejects.toMatchObject({ code: "42501" });
    await expect(db.query("delete from public.cockpit_deal_payments")).rejects.toMatchObject({ code: "42501" });
    await expect(db.query("select nextval('public.cockpit_payment_ties_id_seq')")).rejects.toMatchObject({ code: "42501" });

    await owner(db);
    const priv = async (sql: string) => (await db.query<{ ok: boolean }>(`select ${sql} ok`)).rows[0].ok;
    for (const role of ["anon", "authenticated", "service_role"]) {
      for (const t of ["cockpit_payment_ties", "cockpit_deal_payments"]) {
        expect(await priv(`has_table_privilege('${role}','public.${t}','SELECT')`)).toBe(role === "service_role");
        for (const p of ["INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"]) {
          expect(await priv(`has_table_privilege('${role}','public.${t}','${p}')`)).toBe(false);
        }
      }
      for (const p of ["USAGE", "SELECT", "UPDATE"]) {
        expect(await priv(`has_sequence_privilege('${role}','public.cockpit_payment_ties_id_seq','${p}')`)).toBe(false);
      }
      expect(await priv(`has_function_privilege('${role}','public.cockpit_ceo_payment_tie(jsonb)','EXECUTE')`)).toBe(role === "authenticated");
      expect(await priv(`has_function_privilege('${role}','public.cockpit_ceo_payment_untie(jsonb)','EXECUTE')`)).toBe(role === "authenticated");
      expect(await priv(`has_function_privilege('${role}','public.cockpit_finish_finance_refresh(uuid,jsonb,text)','EXECUTE')`)).toBe(role === "service_role");
      expect(await priv(`has_function_privilege('${role}','public.cockpit_ceo_refresh_finance_snapshot()','EXECUTE')`)).toBe(false);
      expect(await priv(`has_function_privilege('${role}','public.cockpit_payment_ties_lock()','EXECUTE')`)).toBe(false);
    }
    const rls = await db.query<{ relname: string; relrowsecurity: boolean }>(
      "select relname, relrowsecurity from pg_class where relname in ('cockpit_payment_ties','cockpit_deal_payments') order by relname");
    expect(rls.rows).toEqual([{ relname: "cockpit_deal_payments", relrowsecurity: true }, { relname: "cockpit_payment_ties", relrowsecurity: true }]);
    expect(Number((await db.query<{ n: number }>("select count(*)::int n from pg_policy where polrelid in ('public.cockpit_payment_ties'::regclass,'public.cockpit_deal_payments'::regclass)")).rows[0].n)).toBe(0);
  });

  test("the CEO cannot finish a finance refresh or read the snapshot directly", async () => {
    await actor(db, CEO);
    await expect(db.query("select public.cockpit_ceo_refresh_finance_snapshot()")).rejects.toMatchObject({ code: "42501" });
    await expect(db.query("select public.cockpit_finish_finance_refresh(gen_random_uuid(),'{}'::jsonb)")).rejects.toMatchObject({ code: "42501" });
    await service(db);
    await expect(db.query("select public.cockpit_ceo_refresh_finance_snapshot()")).rejects.toMatchObject({ code: "42501" });
  });
});

describe("ties", () => {
  test("refusals say what to do, and write nothing", async () => {
    const before = await revision();
    const refused: [unknown, string | RegExp][] = [
      [[], "A tie must be an object"],
      [{ ...BASE, paymentId: "whop:pay_fixtureA", dealResponseId: "resp_deal_a", amount: 1500 }, "Unsupported field: amount"],
      [{ ...BASE, dealResponseId: "resp_deal_a" }, "Tie one payment, one payer email or one payer name"],
      [{ ...BASE, paymentId: "whop:pay_fixtureA", payerEmail: "payer.one@example.test", dealResponseId: "resp_deal_a" }, "Tie one payment"],
      [{ ...BASE, paymentId: "whop:pay_fixtureA" }, "Choose one: a signed deal, a client card or not client money"],
      [{ ...BASE, paymentId: "whop:pay_fixtureA", dealResponseId: "resp_deal_a", notClient: true }, "Choose one"],
      [{ paymentId: "whop:pay_fixtureA", dealResponseId: "resp_deal_a", note: " a " }, "Say why in a note of 3 to 500 characters"],
      [{ ...BASE, paymentId: "whop:pay_fixtureA", notClient: "yes" }, "notClient is true or false"],
      [{ ...BASE, paymentId: 42, dealResponseId: "resp_deal_a" }, "paymentId must be text"],
      [{ ...BASE, paymentId: "stripe:ch_1", dealResponseId: "resp_deal_a" }, "That is not a payment id"],
      [{ ...BASE, paymentId: "whop:pay_missing", dealResponseId: "resp_deal_a" }, "That payment is not in the ledger yet; refresh Money first."],
      [{ ...BASE, paymentId: "whop:pay_outOnly", dealResponseId: "resp_deal_a" }, "That payment is not in the ledger yet; refresh Money first."],
      [{ ...BASE, paymentId: "tap:chg_fixture2", dealResponseId: "resp_deal_a" }, "That payment is not in the ledger yet"],
      [{ ...BASE, paymentId: "bank:9002", dealResponseId: "resp_deal_a" }, "That payment is not in the ledger yet"],
      [{ ...BASE, paymentId: "manual:manual-fixture-gone", dealResponseId: "resp_deal_a" }, "That payment is not in the ledger yet"],
      [{ ...BASE, paymentId: "whop:pay_fixtureA", dealResponseId: "resp_missing" }, "That deal is not a signed closer-form deal"],
      [{ ...BASE, paymentId: "whop:pay_fixtureA", dealResponseId: "resp_unsigned" }, "That deal is not a signed closer-form deal"],
      [{ ...BASE, paymentId: "whop:pay_fixtureA", dealResponseId: "resp_deal_void" }, "That deal was voided. Choose a signed deal."],
      [{ ...BASE, paymentId: "whop:pay_fixtureA", clickupTaskId: "task_unknown" }, "That client card is unknown"],
      [{ ...BASE, payerKey: "Ab Cd", dealResponseId: "resp_deal_a" }, "Tie by email or the full payer name."],
      [{ ...BASE, payerKey: "Payeronlyname", dealResponseId: "resp_deal_a" }, "Tie by email or the full payer name."],
      [{ ...BASE, payerEmail: "payer one at example", dealResponseId: "resp_deal_a" }, "That is not an email address"],
    ];
    for (const [p, sentence] of refused) {
      await actor(db, CEO);
      await expect(call(db, "cockpit_ceo_payment_tie", p)).rejects.toThrow(sentence);
    }
    expect(await liveTies()).toEqual([]);
    expect(await revision()).toBe(before);
    await owner(db);
    expect(Number((await db.query<{ n: number }>("select count(*)::int n from public.cockpit_audit_log where action like 'money.%'")).rows[0].n)).toBe(0);
  });

  test("a payment from each source can be tied; a second tie of the same scope replaces the first", async () => {
    const before = await revision();
    const a = await tie({ ...BASE, paymentId: "whop:pay_fixtureA", dealResponseId: "resp_deal_a", evidence: "Fixture: same amount as the typed deposit" });
    expect(a).toEqual({ ok: true, id: expect.any(Number) });
    expect((await tie({ ...BASE, paymentId: "tap:chg_fixture1", clickupTaskId: "task_card_a" })).ok).toBe(true);
    expect((await tie({ ...BASE, paymentId: "bank:9001", notClient: true, note: "Fixture: an owner's transfer" })).ok).toBe(true);
    expect((await tie({ ...BASE, paymentId: "manual:manual-fixture-1", clickupTaskId: "task_card_b" })).ok).toBe(true);
    expect((await tie({ ...BASE, paymentId: "transfer:fixture-transfer-1", dealResponseId: "resp_deal_a" })).ok).toBe(true);
    expect(await revision()).toBe(before + 5);

    const again = await tie({ ...BASE, paymentId: "whop:pay_fixtureA", clickupTaskId: "task_card_a", note: "Fixture: it is the card's renewal" });
    expect(again.id).not.toBe(a.id);
    await owner(db);
    const rows = (await db.query<Record<string, unknown>>("select id::int id, clickup_task_id, deal_response_id, cleared_reason, cleared_at is not null cleared from public.cockpit_payment_ties where payment_id='whop:pay_fixtureA' order by id")).rows;
    expect(rows).toEqual([
      { id: Number(a.id), clickup_task_id: null, deal_response_id: "resp_deal_a", cleared_reason: "Replaced by a new tie", cleared: true },
      { id: Number(again.id), clickup_task_id: "task_card_a", deal_response_id: null, cleared_reason: null, cleared: false },
    ]);
    // One live tie per payment, whatever writes it.
    await expect(db.query("insert into public.cockpit_payment_ties(payment_id,not_client,note,set_by) values('whop:pay_fixtureA',true,'Fixture note','fixture')"))
      .rejects.toMatchObject({ code: "23505" });
  });

  test("payer ties key on the email or the full name, never a first name alone", async () => {
    const first = await tie({ ...BASE, payerEmail: "  Payer.One@Example.TEST ", dealResponseId: "resp_deal_a" });
    const second = await tie({ ...BASE, payerEmail: "payer.one@example.test", dealResponseId: "resp_deal_a", note: "Fixture: same payer, new note" });
    const byName = await tie({ ...BASE, payerKey: "  Payer Two-Name ", dealResponseId: "resp_deal_a" });
    const ties = (await liveTies()).filter(r => r.payer_email !== null || r.payer_key !== null);
    expect(ties.map(r => [Number(r.id), r.payer_email, r.payer_key])).toEqual([
      [Number(second.id), "payer.one@example.test", null],
      [Number(byName.id), null, "payertwoname"],
    ]);
    expect(Number(first.id)).toBeLessThan(Number(second.id));
    await owner(db);
    await expect(db.query("insert into public.cockpit_payment_ties(payer_email,not_client,note,set_by) values(' PAYER.ONE@example.test',true,'Fixture note','fixture')"))
      .rejects.toMatchObject({ code: "23505" });
  });

  test("a tie is removed with a reason, once", async () => {
    const t = await tie({ ...BASE, paymentId: "whop:pay_fixtureB", notClient: true });
    const before = await revision();
    await actor(db, CEO);
    await expect(call(db, "cockpit_ceo_payment_untie", { id: t.id })).rejects.toThrow("Say why the tie goes, in 3 to 500 characters");
    await expect(call(db, "cockpit_ceo_payment_untie", { id: t.id, reason: "Fixture", extra: 1 })).rejects.toThrow("Unsupported field: extra");
    await expect(call(db, "cockpit_ceo_payment_untie", { id: "x", reason: "Fixture: wrong" })).rejects.toThrow("Choose a tie to remove");
    await expect(call(db, "cockpit_ceo_payment_untie", { reason: "Fixture: wrong" })).rejects.toThrow("Choose a tie to remove");
    await expect(call(db, "cockpit_ceo_payment_untie", { id: 999999, reason: "Fixture: wrong" })).rejects.toThrow("That tie does not exist");
    expect(await untie({ id: t.id, reason: "Fixture: it was a client payment after all" })).toEqual({ ok: true, id: t.id });
    await actor(db, CEO);
    await expect(call(db, "cockpit_ceo_payment_untie", { id: t.id, reason: "Fixture: again" })).rejects.toThrow("That tie is already removed");
    expect(await revision()).toBe(before + 1);
    await owner(db);
    const row = (await db.query<Record<string, unknown>>("select cleared_reason, cleared_by is not null by_set, cleared_at is not null at_set from public.cockpit_payment_ties where id=$1", [t.id])).rows[0];
    expect(row).toEqual({ cleared_reason: "Fixture: it was a client payment after all", by_set: true, at_set: true });
  });

  test("ties are append-only: no delete, no truncate, no edit, cleared once", async () => {
    await owner(db);
    const live = (await liveTies())[0];
    const cleared = (await db.query<{ id: number }>("select id::int id from public.cockpit_payment_ties where cleared_at is not null limit 1")).rows[0];
    await expect(db.query("delete from public.cockpit_payment_ties")).rejects.toThrow("kept for good");
    await expect(db.query("truncate public.cockpit_payment_ties")).rejects.toThrow("kept for good");
    await expect(db.query("update public.cockpit_payment_ties set note='Fixture: edited' where id=$1", [live.id])).rejects.toThrow("never edited");
    await expect(db.query("update public.cockpit_payment_ties set deal_response_id='resp_deal_void' where id=$1", [live.id])).rejects.toThrow("never edited");
    await expect(db.query("update public.cockpit_payment_ties set cleared_at=now() where id=$1", [live.id])).rejects.toThrow();
    await expect(db.query("update public.cockpit_payment_ties set cleared_reason='Fixture: changed' where id=$1", [cleared.id])).rejects.toThrow("kept as it was");
    await expect(db.query("update public.cockpit_payment_ties set cleared_at=null, cleared_by=null where id=$1", [cleared.id])).rejects.toThrow("kept as it was");
  });

  test("audit rows carry ids only: no note, email, name or amount", async () => {
    await owner(db);
    const rows = (await db.query<{ action: string; entity_type: string; entity_id: string; actor_email: string; before: unknown; after: Record<string, unknown> }>(
      "select action, entity_type, entity_id, actor_email, before, after from public.cockpit_audit_log where action like 'money.%' order by created_at, id")).rows;
    const ceoEmail = (await db.query<{ email: string }>("select lower(email) email from auth.users where id=$1", [CEO])).rows[0].email;
    expect(rows.filter(r => r.action === "money.tie").length).toBe(10);
    expect(rows.filter(r => r.action === "money.untie").length).toBe(1);
    for (const r of rows) {
      expect(r.entity_type).toBe("cockpit_payment_ties");
      expect(r.actor_email).toBe(ceoEmail);
      expect(r.before).toBeNull();
      expect(String(r.after.id)).toBe(r.entity_id);
      for (const key of Object.keys(r.after)) {
        expect(["id", "replaced", "scope", "paymentId", "target", "dealResponseId", "clickupTaskId"]).toContain(key);
      }
      const text = JSON.stringify(r.after);
      for (const leak of ["Fixture", "example.test", "Payer", "payertwoname", "1500", "usd", "note", "evidence"]) expect(text).not.toContain(leak);
    }
    const replaced = rows.find(r => r.action === "money.tie" && r.after.replaced !== undefined && r.after.paymentId === "whop:pay_fixtureA");
    expect(replaced?.after).toMatchObject({ scope: "payment", target: "card", clickupTaskId: "task_card_a" });
    expect(rows.find(r => r.action === "money.untie")?.after).toEqual({ id: expect.any(Number) });
  });

  test("the finance snapshot carries the live ties, read by the worker", async () => {
    await owner(db);
    const snapshot = (await db.query<{ s: Record<string, unknown> }>("select public.cockpit_ceo_refresh_finance_snapshot() s")).rows[0].s;
    const live = await liveTies();
    const ties = snapshot.ties as Record<string, unknown>[];
    expect(ties.map(t => Number(t.id))).toEqual(live.map(t => Number(t.id)));
    expect(ties.every(t => t.cleared_at === null)).toBe(true);
    expect(ties.find(t => t.payment_id === "whop:pay_fixtureA")).toMatchObject({ clickup_task_id: "task_card_a", not_client: false, deal_response_id: null });
    expect(ties.find(t => t.payment_id === "bank:9001")).toMatchObject({ not_client: true });
    // Every key the snapshot had before is still there.
    for (const key of ["revision", "totals_revision", "history_ready", "updated_at", "aliases_ready", "manual_ready", "manual", "aliases", "billing",
      "series", "statements", "bank_lines", "exclusions", "payers", "newestManualChange", "ties"]) expect(snapshot).toHaveProperty(key);

    const job = await startJob();
    await service(db);
    const input = (await db.query<{ s: Record<string, unknown> }>("select public.cockpit_finance_refresh_input($1::uuid) s", [job])).rows[0].s;
    expect((input.ties as unknown[]).length).toBe(live.length);
    await fail(job);
  });

  test("a tie made while a refresh runs fails that refresh's fence; the next one reads it", async () => {
    const job = await startJob();
    await tie({ ...BASE, payerKey: "Payer Five Name", notClient: true });
    // The finish re-reads its input first (live): the revision moved, so nothing is written.
    await expect(finish(job, financeOutput())).rejects.toThrow(/Finance source readiness or revision changed|Finance inputs changed during this refresh/);
    await fail(job);
    const next = await startJob();
    await service(db);
    const input = (await db.query<{ s: { ties: { payer_key: string | null }[]; revision: number } }>("select public.cockpit_finance_refresh_input($1::uuid) s", [next])).rows[0].s;
    expect(input.ties.some(t => t.payer_key === "payerfivename")).toBe(true);
    expect(input.revision).toBe(await revision());
    expect((await finish(next, financeOutput())).ok).toBe(true);
  });
});

describe("deal ledger", () => {
  test("a refresh with dealPayments writes and deactivates the window; one without the key leaves the table alone", async () => {
    await owner(db);
    // A row outside the 11-month window is never touched.
    await db.query("insert into public.cockpit_deal_payments(payment_id,deal_response_id,day,usd,rail,kind,matched_by) values('whop:pay_fixtureOld','resp_old','2020-01-15',100,'whop','deposit','deal_id')");

    const first = await startJob();
    await finish(first, financeOutput({ dealPayments: [
      { payment_id: "whop:pay_fixtureA", deal_response_id: "resp_deal_a", day: today, usd: 500, rail: "whop", kind: "deposit", deposit_usd: 250, matched_by: "ceo", tie_id: 1, payer: "Payer One" },
      { paymentId: "tap:chg_fixture1", dealResponseId: "resp_deal_a", day: today, usd: 489, rail: "tap", kind: "remainder", matchedBy: "card_payer", tieId: null, payer: null },
    ] }));
    // The deposit part as sent; a row sent without it (a worker from before the split) is all deposit or none by its kind.
    expect(await ledger()).toEqual([
      { payment_id: "tap:chg_fixture1", deal_response_id: "resp_deal_a", day: today, usd: 489, rail: "tap", kind: "remainder", deposit_usd: 0, matched_by: "card_payer", tie_id: null, payer: null, active: true, source_refresh_id: first },
      { payment_id: "whop:pay_fixtureA", deal_response_id: "resp_deal_a", day: today, usd: 500, rail: "whop", kind: "deposit", deposit_usd: 250, matched_by: "ceo", tie_id: 1, payer: "Payer One", active: true, source_refresh_id: first },
      { payment_id: "whop:pay_fixtureOld", deal_response_id: "resp_old", day: "2020-01-15", usd: 100, rail: "whop", kind: "deposit", deposit_usd: 0, matched_by: "deal_id", tie_id: null, payer: null, active: true, source_refresh_id: null },
    ]);

    const second = await startJob();
    await finish(second, financeOutput({ dealPayments: [
      { payment_id: "whop:pay_fixtureA", deal_response_id: "resp_deal_a", day: today, usd: 450, rail: "whop", kind: "deposit", matched_by: "ceo", tie_id: 1, payer: "Payer One" },
    ] }));
    const afterSecond = await ledger();
    expect(afterSecond.map(r => [r.payment_id, r.active, r.usd, r.deposit_usd, r.source_refresh_id])).toEqual([
      ["tap:chg_fixture1", false, 489, 0, second],
      ["whop:pay_fixtureA", true, 450, 450, second],
      ["whop:pay_fixtureOld", true, 100, 0, null],
    ]);

    const third = await startJob();
    expect((await finish(third, financeOutput())).ok).toBe(true);
    expect(await ledger()).toEqual(afterSecond);
    await owner(db);
    expect((await db.query<{ n: number }>("select count(*)::int n from public.cockpit_client_payments")).rows[0].n).toBe(0);
  });

  test("a bad dealPayments output fails the whole refresh and keeps the ledger", async () => {
    const before = await ledger();
    for (const dealPayments of [
      { payment_id: "whop:pay_fixtureA" },
      [{ payment_id: "whop:pay_fixtureA", deal_response_id: "resp_deal_a", day: today, usd: 450, rail: "whop", kind: "kickoff", matched_by: "ceo" }],
      [{ payment_id: "whop:pay_fixtureA", deal_response_id: "", day: today, usd: 450, rail: "whop", kind: "deposit", matched_by: "ceo" }],
      [{ payment_id: "whop:pay_fixtureA", deal_response_id: "resp_deal_a", day: today, usd: "450", rail: "whop", kind: "deposit", matched_by: "ceo" }],
      // The deposit part is a number from 0 to the payment.
      [{ payment_id: "whop:pay_fixtureA", deal_response_id: "resp_deal_a", day: today, usd: 450, rail: "whop", kind: "deposit", deposit_usd: 451, matched_by: "ceo" }],
      [{ payment_id: "whop:pay_fixtureA", deal_response_id: "resp_deal_a", day: today, usd: 450, rail: "whop", kind: "deposit", deposit_usd: -1, matched_by: "ceo" }],
      [{ payment_id: "whop:pay_fixtureA", deal_response_id: "resp_deal_a", day: today, usd: 450, rail: "whop", kind: "deposit", deposit_usd: "450", matched_by: "ceo" }],
    ]) {
      const job = await startJob();
      await expect(finish(job, financeOutput({ dealPayments }))).rejects.toThrow(Array.isArray(dealPayments) ? "Invalid deal payment" : "Incomplete finance output");
      await fail(job);
    }
    expect(await ledger()).toEqual(before);
  });
});

describe("migration", () => {
  test("applying it a second time keeps every tie, the ledger and the grants", async () => {
    await owner(db);
    const ties = (await db.query("select * from public.cockpit_payment_ties order by id")).rows;
    const rows = await ledger();
    await db.exec(migration(MIGRATION));
    await owner(db);
    expect((await db.query("select * from public.cockpit_payment_ties order by id")).rows).toEqual(ties);
    expect(await ledger()).toEqual(rows);
    for (const role of ["anon", "authenticated", "service_role"]) {
      expect((await db.query<{ ok: boolean }>(`select has_table_privilege('${role}','public.cockpit_payment_ties','INSERT') ok`)).rows[0].ok).toBe(false);
      expect((await db.query<{ ok: boolean }>(`select has_function_privilege('${role}','public.cockpit_ceo_payment_tie(jsonb)','EXECUTE') ok`)).rows[0].ok).toBe(role === "authenticated");
    }
    expect((await tie({ ...BASE, paymentId: "whop:pay_fixtureB", dealResponseId: "resp_deal_a" })).ok).toBe(true);
    await expect(db.query("delete from public.cockpit_payment_ties")).rejects.toThrow();
  });
});
