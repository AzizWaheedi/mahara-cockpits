import { expect, test } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import type { SupabaseClient } from "@supabase/supabase-js";
import { optionsFrom, planMirror } from "../../../supabase/functions/billing-sync/billing";
// The client success cockpit's copy of the same lib (its default source is "csm").
import * as csm from "../../client-success-cockpit/src/lib/billing";
import {
  assignBillingPayer,
  BillingWriteError,
  editBillingAccount,
  logBillingPayment,
} from "../src/lib/billing";
import type { Account } from "../src/lib/billingCore";
import { actor, cockpitTestDb, member, migration, owner } from "./lib/cockpitTestDb";

// supabase/migrations/20261009a_billing_native_sync.sql against canonical SQL:
// the server-side billing writes, the sync's apply step and the inbox ingest.
// Success-manager actions go through the client success lib, CEO actions
// through this app's lib, exactly as the two cockpits call them.

const CEO = "00000000-0000-4000-8000-000000000001";
const CSM = "00000000-0000-4000-8000-000000000002";
const OTHER_CSM = "00000000-0000-4000-8000-000000000003";
const BUYER = "00000000-0000-4000-8000-000000000004";
const FINANCE = "00000000-0000-4000-8000-000000000005";

function nativeSync(): string {
  const text = migration("20261009a_billing_native_sync.sql");
  const start = text.indexOf("-- cron:begin");
  const end = text.indexOf("-- cron:end");
  if (start < 0 || end < start) throw new Error("The schedule block is missing its markers");
  // pg_cron, pg_net and the vault are not in the test engine.
  // 20261009h closes the browser's direct writes; it ships with the cockpits.
  return text.slice(0, start) + text.slice(end + "-- cron:end".length) + "\n" + migration("20261009h_billing_browser_writes_closed.sql");
}

function extract(file: string, pattern: RegExp): string {
  const hit = migration(file).match(pattern);
  if (!hit) throw new Error(`Canonical definition missing in ${file}: ${pattern}`);
  return hit[0];
}

async function fixture(historyReady = true) {
  const db = await cockpitTestDb();
  await db.exec(
    "CREATE SCHEMA storage; CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint); CREATE TABLE storage.objects(bucket_id text,name text,metadata jsonb); ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY; GRANT USAGE ON SCHEMA storage TO authenticated; GRANT SELECT,INSERT ON storage.objects TO authenticated;",
  );
  for (const name of ["cockpit_client_billing_days", "cockpit_metric_days", "cockpit_payer_clients"])
    await db.exec(extract("20260919_cockpit_core.sql", new RegExp(`create table if not exists public\\.${name} \\([\\s\\S]*?\\n\\);`, "i")));
  // The import's provenance columns, as production has them.
  await db.exec(extract("20260927x_cockpit_native_media_sync.sql", /ALTER TABLE public\.cockpit_client_billing_days[\s\S]*?source_record jsonb;/));
  await db.exec(extract("20260919b_people.sql", /create table if not exists public\.cockpit_people \([\s\S]*?\n\);/i));
  for (const f of [
    "20260921c_bank_statements.sql",
    "20260921d_cockpit_metrics.sql",
    "20260921a_cockpit_settings.sql",
    "20260921f_cockpit_feedback.sql",
    "20260922e_goals_and_people.sql",
    "20260921e_tap_charges.sql",
    "20260923a_client_billing.sql",
  ])
    await db.exec(migration(f));
  await db.exec(extract("20261007d_cockpit_team_rpc_restore.sql", /create or replace function public\.cockpit_has_active_seat\(\)[\s\S]*?\$\$;/));
  await db.exec("GRANT EXECUTE ON FUNCTION public.cockpit_has_active_seat() TO authenticated, service_role;");
  // The browser grants and policies the billing tables have in production.
  await db.exec(extract("20260924r_billing_and_comms_access.sql", /-- 1\. Cockpit Billing Accounts[\s\S]*?(?=-- 4\. WhatsApp)/));
  await db.exec(extract("20260926m_cockpit_csm_state.sql", /CREATE OR REPLACE FUNCTION public\.cockpit_client_allowed\([\s\S]*?END \$\$;/));
  await db.exec("GRANT EXECUTE ON FUNCTION public.cockpit_client_allowed(text) TO authenticated, service_role;");
  await db.exec(migration("20260927d_cockpit_manual_payments_access.sql"));
  await db.exec(migration("20260927h_cockpit_ceo_actions.sql"));
  await db.exec(nativeSync());

  await member(db, CEO, "aziz@maharamedia.com", []);
  await member(db, CSM, "sara@tests.invalid", ["csm"]);
  await member(db, OTHER_CSM, "omar@tests.invalid", ["csm"]);
  await member(db, BUYER, "nada@tests.invalid", ["media_buyer"]);
  await member(db, FINANCE, "fin@tests.invalid", ["finance"]);
  await owner(db);
  await db.exec(`
    UPDATE cockpit_members SET clients=ARRAY['Acme'] WHERE email='sara@tests.invalid';
    UPDATE cockpit_members SET clients=ARRAY['Beta Co'] WHERE email='omar@tests.invalid';
    UPDATE cockpit_manual_payment_state SET history_ready=${historyReady};
    INSERT INTO cockpit_sections(key,label,computed_at,payload) VALUES('money','Money',now(),'{"rails":{"tap":{"connected":true}}}');
    INSERT INTO cockpit_billing_accounts(clickup_task_id,client_name,stage,stage_group,client_status,payment_method,next_payment_usd,next_payment_date,synced_at)
      VALUES('task_a','Acme','Active','active','Active','Bank transfer',1500,(now() AT TIME ZONE 'Asia/Kuwait')::date+10,'2026-10-07T22:30:00Z'),
            ('task_b','Beta Co','Active','active','Active',NULL,NULL,NULL,'2026-10-07T22:30:00Z');
    INSERT INTO cockpit_client_billing_days(day,clickup_task_id,client_name,stage,captured_at)
      VALUES((now() AT TIME ZONE 'Asia/Kuwait')::date,'task_a','Acme','Active',now());`);
  const today = String((await db.query<{ d: string }>("SELECT (now() AT TIME ZONE 'Asia/Kuwait')::date::text AS d")).rows[0].d);
  const client = {
    async rpc(name: string, args: { p_action: string; p_args: unknown }) {
      expect(name).toBe("cockpit_billing_write");
      try {
        const r = await db.query<{ result: unknown }>("SELECT cockpit_billing_write($1,$2::jsonb) AS result", [
          args.p_action,
          JSON.stringify(args.p_args),
        ]);
        return { data: r.rows[0].result, error: null };
      } catch (e) {
        const err = e as { message: string; detail?: string; code?: string };
        return { data: null, error: { message: err.message, details: err.detail, code: err.code } };
      }
    },
  } as unknown as SupabaseClient;
  return { db, client, today };
}

const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const acme = (over: Partial<Account> = {}) => ({ taskId: "task_a", name: "Acme", nextDate: null, ...over }) as Account;
const rows = async (db: PGlite, sql: string) => {
  await owner(db);
  return (await db.query<Record<string, unknown>>(sql)).rows;
};
const refusal = async (p: Promise<unknown>): Promise<BillingWriteError> => {
  try {
    await p;
  } catch (e) {
    expect((e as Error).name).toBe("BillingWriteError");
    expect(e).toBeInstanceOf(Error);
    return e as BillingWriteError;
  }
  throw new Error("Expected the server to refuse");
};

test("the server checks the seat, the client and the cockpit", async () => {
  const { db, client } = await fixture();
  try {
    const method = { taskId: "task_a", edit: { kind: "method", value: "Tap link" } };
    await actor(db, null);
    expect((await refusal(csm.editBillingAccount(client, "", method))).message).toContain("permission denied");
    await actor(db, BUYER);
    expect((await refusal(csm.editBillingAccount(client, "", method))).data.message).toContain(
      "client success, finance or CEO seat",
    );
    await actor(db, OTHER_CSM);
    expect((await refusal(csm.editBillingAccount(client, "", method))).message).toBe(
      "Acme is not one of your clients in the portal, so its billing is not yours to change.",
    );
    await actor(db, CSM);
    expect((await refusal(editBillingAccount(client, "", method))).message).toBe(
      "Only the CEO can make a change from the CEO cockpit.",
    );
    expect((await refusal(csm.editBillingAccount(client, "", { taskId: "task_b", edit: method.edit }))).message).toContain(
      "Beta Co is not one of your clients",
    );
    await actor(db, FINANCE);
    expect((await csm.editBillingAccount(client, "", method)).method).toBe("Tap link");
    await actor(db, CEO);
    expect((await editBillingAccount(client, "", { taskId: "task_b", edit: { kind: "plan", value: "Monthly" } }, "ceo")).plan).toBe(
      "Monthly",
    );
  } finally {
    await db.close();
  }
});

test("an edit lands on the mirror, the billing log and the audit log, with billingCore's rules", async () => {
  const { db, client, today } = await fixture();
  try {
    await actor(db, CSM);
    const updated = await csm.editBillingAccount(client, "ignored@tests.invalid", {
      taskId: "task_a",
      edit: { kind: "method", value: "Tap link" },
    });
    expect(updated.method).toBe("Tap link");
    expect(updated.source).toBe("csm");
    expect((await refusal(csm.editBillingAccount(client, "", { taskId: "task_a", edit: { kind: "method", value: "Cash" } }))).message).toBe(
      "Pick one of the payment methods on the card.",
    );
    expect(
      (await refusal(csm.editBillingAccount(client, "", { taskId: "task_a", edit: { kind: "extension", weeks: 3, reason: "late", ours: false, moveDate: true } })))
        .message,
    ).toContain("one, two or four weeks");
    await actor(db, CSM);
    // An extension moves the date from the later of today and the date set.
    const extended = await csm.editBillingAccount(client, "", {
      taskId: "task_a",
      edit: { kind: "extension", weeks: 2, reason: "Bank holiday delay", ours: true, moveDate: true },
    });
    expect(extended.extensionWeeks).toBe(2);
    expect(extended.nextDate).toBe(addDays(today, 24));
    const paused = await csm.editBillingAccount(client, "", { taskId: "task_a", edit: { kind: "pause", reason: "Client asked to pause" } });
    expect([paused.status, paused.group, paused.pausedOn]).toEqual(["Paused", "paused", today]);
    const resumed = await csm.editBillingAccount(client, "", { taskId: "task_a", edit: { kind: "resume", nextDate: addDays(today, 30) } });
    expect([resumed.status, resumed.group, resumed.pausedOn, resumed.nextDate]).toEqual(["Active", "active", null, addDays(today, 30)]);
    const note = await csm.editBillingAccount(client, "", { taskId: "task_a", edit: { kind: "note", text: "Called, all fine" } });
    expect(note.nextDate).toBe(addDays(today, 30));

    const events = await rows(db, "SELECT kind,from_value,to_value,reason,detail,source,by_whom FROM cockpit_billing_events ORDER BY id");
    expect(events.map(e => e.kind)).toEqual(["method", "extension", "pause", "resume", "note"]);
    expect(events[0]).toMatchObject({ from_value: "Bank transfer", to_value: "Tap link", source: "csm", by_whom: "sara@tests.invalid" });
    expect(events[1].detail).toEqual({ weeks: 2, ours: true, movedDate: true });
    expect(events[4].reason).toBe("Called, all fine");
    const audit = await rows(db, "SELECT action,entity_id,actor_email,source_app FROM cockpit_audit_log WHERE action LIKE 'billing.%' ORDER BY created_at");
    expect(audit.map(a => a.action)).toEqual(["billing.method", "billing.extension", "billing.pause", "billing.resume", "billing.note"]);
    expect(audit[0]).toMatchObject({ entity_id: "task_a", actor_email: "sara@tests.invalid", source_app: "client-success-cockpit" });
  } finally {
    await db.close();
  }
});

test("the browser cannot write the billing tables directly; it still reads them", async () => {
  const { db } = await fixture();
  try {
    await actor(db, CSM);
    expect((await db.query("SELECT clickup_task_id FROM cockpit_billing_accounts")).rows.length).toBe(2);
    expect((await db.query("SELECT id FROM cockpit_billing_events")).rows.length).toBe(0);
    expect((await db.query("SELECT id FROM cockpit_billing_inbox")).rows.length).toBe(0);
    await expect(db.query("UPDATE cockpit_billing_accounts SET next_payment_date=NULL")).rejects.toThrow(/permission denied/);
    await expect(
      db.query("INSERT INTO cockpit_billing_events(clickup_task_id,kind,source,by_whom) VALUES('task_a','assign','ceo','x')"),
    ).rejects.toThrow(/permission denied/);
    await expect(
      db.query(
        "INSERT INTO cockpit_billing_inbox(clickup_task_id,paid_on,amount,currency,method,source,logged_by) VALUES('task_a',current_date,1,'USD','cash','csm','x')",
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(db.query("SELECT cockpit_billing_sync_apply('[]','[]','{}')")).rejects.toThrow(/permission denied/);
    await expect(db.query("SELECT cockpit_billing_ingest_inbox(true)")).rejects.toThrow(/permission denied/);
  } finally {
    await db.close();
  }
});

test("a success manager's payment waits in the inbox; a transfer needs its photo", async () => {
  const { db, client, today } = await fixture();
  try {
    await actor(db, CSM);
    const pay = { account: acme(), day: today, amount: 250.5, currency: "USD" as const, rail: "bank_transfer" };
    expect((await refusal(csm.logBillingPayment(client, "", pay))).message).toContain("receipt photo first");
    expect((await refusal(csm.logBillingPayment(client, "", { ...pay, amount: 1.005 }))).message).toBe(
      "A dollar amount has at most two decimals.",
    );
    expect((await refusal(csm.logBillingPayment(client, "", { ...pay, day: addDays(today, 1) }))).message).toContain("today or before");
    const message = await csm.logBillingPayment(client, "", {
      ...pay,
      evidenceUrl: "https://drive.example/receipt.jpg",
      reference: "TRX-1",
      nextDate: addDays(today, 31),
    });
    expect(message).toBe(
      `Logged $250.5 from Acme. It waits in the billing inbox until the next billing sync takes it into the ledger, and next date is now ${addDays(today, 31)}.`,
    );
    const [inbox] = await rows(db, "SELECT status,source,logged_by,amount::float8 AS amount,reference FROM cockpit_billing_inbox");
    expect(inbox).toEqual({ status: "pending", source: "csm", logged_by: "sara@tests.invalid", amount: 250.5, reference: "TRX-1" });
    expect((await rows(db, "SELECT next_payment_date::text AS d,source FROM cockpit_billing_accounts WHERE clickup_task_id='task_a'"))[0]).toEqual({
      d: addDays(today, 31),
      source: "csm",
    });
    expect((await rows(db, "SELECT kind,reason FROM cockpit_billing_events"))[0]).toEqual({ kind: "date", reason: "Paid; next payment set" });
    expect((await rows(db, "SELECT count(*)::int AS n FROM cockpit_manual_payments"))[0].n).toBe(0);
  } finally {
    await db.close();
  }
});

test("the CEO's payment goes straight into the ledger, with the repeat confirmation", async () => {
  const { db, client, today } = await fixture();
  try {
    await actor(db, CEO);
    const pay = { account: acme(), day: today, amount: 100, currency: "USD" as const, rail: "bank_transfer", note: "First month" };
    expect(await logBillingPayment(client, "", pay, "ceo")).toBe(
      "Logged $100 from Acme in the ledger. It counts toward cash and LTV at the next refresh.",
    );
    const repeat = await refusal(logBillingPayment(client, "", pay, "ceo"));
    expect(repeat.data.code).toBe("repeat");
    await logBillingPayment(client, "", { ...pay, allowRepeat: true }, "ceo");
    const ledger = await rows(db, "SELECT client_name,clickup_task_id,amount_usd::float8 AS usd,note FROM cockpit_manual_payments ORDER BY added_at");
    expect(ledger).toHaveLength(2);
    expect(ledger[0]).toEqual({ client_name: "Acme", clickup_task_id: "task_a", usd: 100, note: "First month" });
    const events = await rows(db, "SELECT kind,source,detail->>'ledgerId' AS ledger FROM cockpit_billing_events ORDER BY id");
    expect(events.map(e => [e.kind, e.source])).toEqual([["payment", "ceo"], ["payment", "ceo"]]);
    expect(events[0].ledger).toBeTruthy();
    expect((await rows(db, "SELECT count(*)::int AS n FROM cockpit_billing_inbox"))[0].n).toBe(0);
  } finally {
    await db.close();
  }
});

test("tying a payer to a client assigns it for real, and only the CEO can", async () => {
  const { db, client } = await fixture();
  try {
    const p = { payer: "Abdullah Al-Hussaini", taskId: "task_a", clientName: "Acme", usd: 8479, count: 6 };
    await actor(db, CSM);
    expect((await refusal(assignBillingPayer(client, "", p))).message).toBe("Only the CEO can tie money to a client.");
    await actor(db, CEO);
    expect(await assignBillingPayer(client, "", p)).toBe(
      "Tied Abdullah Al-Hussaini to Acme. Their payments count as Acme's money from the next refresh.",
    );
    expect((await rows(db, "SELECT payer,payer_key,clickup_task_id,client_name,mapped_by FROM cockpit_payer_clients"))[0]).toEqual({
      payer: "Abdullah Al-Hussaini",
      payer_key: "abdullahalhussaini",
      clickup_task_id: "task_a",
      client_name: "Acme",
      mapped_by: "aziz@maharamedia.com",
    });
    expect((await rows(db, "SELECT reason FROM cockpit_billing_events WHERE kind='assign'"))[0].reason).toBe(
      "6 payments from Abdullah Al-Hussaini, $8,479, tied to Acme. They count as Acme's money from the next refresh; LTV adds only those from 19 Sep on.",
    );
    expect((await rows(db, "SELECT action FROM cockpit_audit_log WHERE action IN ('payers.assign','billing.assign') ORDER BY action")).map(a => a.action)).toEqual([
      "billing.assign",
      "payers.assign",
    ]);
    // Without a fresh billing snapshot for the card, nothing is tied and nothing is logged.
    await actor(db, CEO);
    expect((await refusal(assignBillingPayer(client, "", { ...p, payer: "Someone Else", taskId: "task_b" }))).message).toContain(
      "missing or stale",
    );
    expect((await rows(db, "SELECT count(*)::int AS n FROM cockpit_billing_events WHERE kind='assign'"))[0].n).toBe(1);
  } finally {
    await db.close();
  }
});

// The real planMirror payload, applied by the real SQL.
const STATUS = "9368ca9e-3549-4320-84ff-9abd0a2901cb";
const METHOD = "665e5754-b9c6-4776-9386-111ad221dead";
const OPTIONS = optionsFrom({
  fields: [
    { id: STATUS, type_config: { options: [{ id: "s0", name: "Active", orderindex: 0 }, { id: "s1", name: "Paused", orderindex: 1 }] } },
    { id: METHOD, type_config: { options: [{ id: "m0", name: "Card on file", orderindex: 0 }, { id: "m1", name: "Bank transfer", orderindex: 1 }] } },
  ],
});
const task = (id: string, name: string, method: number | null) => ({
  id,
  name,
  url: `https://app.clickup.com/t/${id}`,
  date_updated: String(Date.parse("2026-10-08T10:00:00Z")),
  custom_fields: [
    { id: STATUS, value: 0 },
    { id: METHOD, value: method },
  ],
});
const day = (today: string, taskId: string, name: string) => ({
  day: today,
  clickup_task_id: taskId,
  client_name: name,
  stage: "Active",
  mrr_usd: 1500,
  captured_at: new Date().toISOString(),
  source_deployment: "billing-sync",
  source_id: null,
  source_record: null,
});
async function serviceRole(db: PGlite) {
  await actor(db, null);
  await db.exec("RESET ROLE; SET ROLE service_role");
}

test("the sync's apply step: never over a newer cockpit edit, never over imported history", async () => {
  const { db, client, today } = await fixture();
  try {
    const existing = await rows(db, "SELECT * FROM cockpit_billing_accounts");
    const plan = planMirror(
      [task("task_a", "Acme", 0), task("task_b", "Beta Co", null), task("task_c", "Gamma", 1)],
      OPTIONS,
      existing.map(r => ({ ...r, synced_at: new Date(String(r.synced_at)).toISOString() })),
      [],
      new Date().toISOString(),
    );
    // The mirror's timestamps as PostgREST would hand them back, to the microsecond.
    for (const r of plan.rows)
      if (r.expected_synced_at) r.expected_synced_at = String((await rows(db, `SELECT synced_at::text AS s FROM cockpit_billing_accounts WHERE clickup_task_id='${r.row.clickup_task_id}'`))[0].s);
    // A success manager edits Beta Co's card while the sync is running.
    await actor(db, CEO);
    await editBillingAccount(client, "", { taskId: "task_b", edit: { kind: "method", value: "Whop link" } }, "ceo");
    // An imported Convex row for today is history and stays as it was.
    await owner(db);
    await db.exec(
      `INSERT INTO cockpit_client_billing_days(day,clickup_task_id,client_name,mrr_usd,captured_at,source_deployment,source_id) VALUES('${today}','task_c','Gamma',99,now()-interval '1 hour','convex','imported-1')`,
    );
    await serviceRole(db);
    const result = (
      await db.query<{ r: Record<string, unknown> }>("SELECT cockpit_billing_sync_apply($1::jsonb,$2::jsonb,$3::jsonb) AS r", [
        JSON.stringify(plan.rows),
        JSON.stringify([day(today, "task_a", "Acme"), day(today, "task_c", "Gamma")]),
        JSON.stringify({ changed: plan.changed }),
      ])
    ).rows[0].r;
    expect(result).toEqual({ written: 2, skipped: ["task_b"], days: 1 });
    const mirror = await rows(db, "SELECT clickup_task_id,payment_method,source FROM cockpit_billing_accounts ORDER BY clickup_task_id");
    expect(mirror).toEqual([
      { clickup_task_id: "task_a", payment_method: "Card on file", source: "sync" },
      { clickup_task_id: "task_b", payment_method: "Whop link", source: "ceo" },
      { clickup_task_id: "task_c", payment_method: "Bank transfer", source: "sync" },
    ]);
    const days = await rows(db, "SELECT clickup_task_id,mrr_usd::float8 AS mrr,source_id FROM cockpit_client_billing_days ORDER BY clickup_task_id");
    expect(days).toEqual([
      { clickup_task_id: "task_a", mrr: 1500, source_id: null },
      { clickup_task_id: "task_c", mrr: 99, source_id: "imported-1" },
    ]);
    expect((await rows(db, "SELECT actor_email,metadata FROM cockpit_audit_log WHERE action='billingSync.apply'"))[0]).toEqual({
      actor_email: "billing-sync",
      metadata: { written: 2, skipped: ["task_b"], days: 1 },
    });
    await serviceRole(db);
    await expect(
      db.query("SELECT cockpit_billing_sync_apply('[]'::jsonb,$1::jsonb,'{}'::jsonb)", [JSON.stringify([day(addDays(today, -5), "task_a", "Acme")])]),
    ).rejects.toThrow(/today only/);
  } finally {
    await db.close();
  }
});

test("the inbox ingest: a dry run writes nothing; a run takes payments in once, with Convex's verdicts", async () => {
  const { db, today } = await fixture();
  try {
    await owner(db);
    await db.exec(`
      INSERT INTO cockpit_manual_payments(day,amount,currency,amount_usd,usd_per_unit,client_name,client_key,clickup_task_id,rail,added_by)
        VALUES('${today}',75,'USD',75,1,'Acme','acme','task_a','cash','aziz@maharamedia.com');
      INSERT INTO cockpit_billing_inbox(clickup_task_id,client_name,paid_on,amount,currency,method,reference,evidence_url,source,logged_by) VALUES
        ('task_a','Acme','${today}',250.5,'USD','bank_transfer','TRX-1','https://drive.example/r.jpg','csm','sara@tests.invalid'),
        ('task_a','Acme','${today}',75,'USD','cash',NULL,NULL,'maher','maher'),
        ('task_a','Acme','${addDays(today, 3)}',10,'USD','cash',NULL,NULL,'csm','sara@tests.invalid'),
        ('task_a','Acme','${today}',20,'USD','tap',NULL,NULL,'csm','sara@tests.invalid'),
        ('gone_card','Old Client','${today}',30,'KWD','cash',NULL,NULL,'csm','sara@tests.invalid');`);
    await serviceRole(db);
    const preview = (await db.query<{ r: Record<string, unknown> }>("SELECT cockpit_billing_ingest_inbox(false) AS r")).rows[0].r;
    expect(preview).toMatchObject({ ready: true, pending: 5, ingested: 1, duplicate: 1, rejected: 3, waiting: 0 });
    expect((await rows(db, "SELECT count(*)::int AS n FROM cockpit_billing_inbox WHERE status='pending'"))[0].n).toBe(5);
    expect((await rows(db, "SELECT count(*)::int AS n FROM cockpit_manual_payments"))[0].n).toBe(1);

    await serviceRole(db);
    const run = (await db.query<{ r: Record<string, unknown> }>("SELECT cockpit_billing_ingest_inbox(true) AS r")).rows[0].r;
    expect(run).toMatchObject({ ingested: 1, duplicate: 1, rejected: 3 });
    const inbox = await rows(db, "SELECT amount::float8 AS amount,status,status_note,ledger_id IS NOT NULL AS linked FROM cockpit_billing_inbox ORDER BY id");
    expect(inbox.map(r => r.status)).toEqual(["ingested", "duplicate", "rejected", "rejected", "rejected"]);
    expect(inbox[1].status_note).toBe(`$75.00 from Acme on ${today} was already in the ledger (cash), so this was not counted a second time.`);
    expect(inbox[3].status_note).toContain("Tap is connected");
    expect(inbox[4].status_note).toBe("That client card is not on the roster any more.");
    const [taken] = await rows(
      db,
      "SELECT amount_usd::float8 AS usd,rail,note,added_by,source_deployment FROM cockpit_manual_payments WHERE source_deployment='billing-inbox'",
    );
    expect(taken).toEqual({
      usd: 250.5,
      rail: "bank_transfer",
      note: "ref TRX-1; receipt https://drive.example/r.jpg",
      added_by: "csm: sara@tests.invalid",
      source_deployment: "billing-inbox",
    });
    expect((await rows(db, "SELECT kind,source,by_whom FROM cockpit_billing_events"))).toEqual([
      { kind: "payment", source: "csm", by_whom: "sara@tests.invalid" },
    ]);
    expect((await rows(db, "SELECT count(*)::int AS n FROM cockpit_audit_log WHERE action LIKE 'billingInbox.%'"))[0].n).toBe(5);
    // A second run finds nothing pending and adds nothing.
    await serviceRole(db);
    expect((await db.query<{ r: Record<string, unknown> }>("SELECT cockpit_billing_ingest_inbox(true) AS r")).rows[0].r).toMatchObject({
      pending: 0,
      ingested: 0,
    });
    expect((await rows(db, "SELECT count(*)::int AS n FROM cockpit_manual_payments"))[0].n).toBe(2);
  } finally {
    await db.close();
  }
});

test("the inbox waits while the manual payment history is not reconciled", async () => {
  const { db, today } = await fixture(false);
  try {
    await owner(db);
    await db.exec(
      `INSERT INTO cockpit_billing_inbox(clickup_task_id,client_name,paid_on,amount,currency,method,source,logged_by) VALUES('task_a','Acme','${today}',5,'USD','cash','csm','x')`,
    );
    await serviceRole(db);
    expect((await db.query<{ r: Record<string, unknown> }>("SELECT cockpit_billing_ingest_inbox(true) AS r")).rows[0].r).toMatchObject({
      ready: false,
      pending: 1,
    });
    expect((await rows(db, "SELECT status FROM cockpit_billing_inbox"))[0].status).toBe("pending");
  } finally {
    await db.close();
  }
});
