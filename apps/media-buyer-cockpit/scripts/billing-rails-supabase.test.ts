import { expect, test } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import type { SupabaseClient } from "@supabase/supabase-js";
import { churnReasonCard, REGISTER_REASONS } from "../../../supabase/functions/clickup-writeback/billing";
import * as csm from "../../client-success-cockpit/src/lib/billing";
import { actor, cockpitTestDb, member, migration, owner } from "./lib/cockpitTestDb";

// supabase/migrations/20261101m_billing_rails.sql against canonical SQL
// (docs/forms/WAVE12-CONTRACT.md 2.4, 3.1, 3.3, section 8 billing-rails): the
// new kinds and source, what each event writes and says on the card, the
// trigger's queue rules, the stored field map, the canary door, the voids and
// the held-edit review. No test reaches ClickUp: the queue rows are read back.

const CEO = "00000000-0000-4000-8000-000000000001";
const CSM = "00000000-0000-4000-8000-000000000002";
const FINANCE = "00000000-0000-4000-8000-000000000005";
const CLIENTS = "901816559981";
const TEST_CARD = "86eywg1cq";
const FILE = "20261101m_billing_rails.sql";

/** The file without its pg_cron block (no pg_cron, pg_net or vault in the test engine). */
function rails(): string {
  const text = migration(FILE);
  const start = text.indexOf("-- cron:begin");
  const end = text.indexOf("-- cron:end");
  if (start < 0 || end < start) throw new Error("The schedule block is missing its markers");
  return text.slice(0, start) + text.slice(end + "-- cron:end".length);
}

function extract(file: string, pattern: RegExp): string {
  const hit = migration(file).match(pattern);
  if (!hit) throw new Error(`Canonical definition missing in ${file}: ${pattern}`);
  return hit[0];
}

/** 20261009a's billing tables and write, 20261009f's queue, 20261009j's write-back (as billing-native-sync-supabase.test.ts builds them). */
async function base(): Promise<PGlite> {
  const db = await cockpitTestDb();
  await db.exec(
    "CREATE SCHEMA storage; CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint); CREATE TABLE storage.objects(bucket_id text,name text,metadata jsonb); ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY; GRANT USAGE ON SCHEMA storage TO authenticated; GRANT SELECT,INSERT ON storage.objects TO authenticated;",
  );
  for (const name of ["cockpit_client_billing_days", "cockpit_metric_days", "cockpit_payer_clients"])
    await db.exec(extract("20260919_cockpit_core.sql", new RegExp(`create table if not exists public\\.${name} \\([\\s\\S]*?\\n\\);`, "i")));
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
  // The health rows' detail column, as production has it (20261011c).
  await db.exec(extract("20261011c_csm_call_store.sql", /ALTER TABLE public\.cockpit_sync_state ADD COLUMN IF NOT EXISTS detail jsonb;/));
  await db.exec(extract("20260924r_billing_and_comms_access.sql", /-- 1\. Cockpit Billing Accounts[\s\S]*?(?=-- 4\. WhatsApp)/));
  await db.exec(extract("20260926m_cockpit_csm_state.sql", /CREATE OR REPLACE FUNCTION public\.cockpit_client_allowed\([\s\S]*?END \$\$;/));
  await db.exec("GRANT EXECUTE ON FUNCTION public.cockpit_client_allowed(text) TO authenticated, service_role;");
  await db.exec(migration("20260927d_cockpit_manual_payments_access.sql"));
  await db.exec(migration("20260927h_cockpit_ceo_actions.sql"));
  const sync = migration("20261009a_billing_native_sync.sql");
  await db.exec(sync.slice(0, sync.indexOf("-- cron:begin")) + sync.slice(sync.indexOf("-- cron:end") + "-- cron:end".length));
  await db.exec(migration("20261009h_billing_browser_writes_closed.sql"));
  const f = "20261009f_clickup_writeback_native.sql";
  await db.exec(
    [
      extract(f, /CREATE TABLE IF NOT EXISTS public\.cockpit_clickup_writeback_queue\([\s\S]*?\n\);/),
      "ALTER TABLE public.cockpit_clickup_writeback_queue ENABLE ROW LEVEL SECURITY;",
      "REVOKE ALL ON public.cockpit_clickup_writeback_queue FROM PUBLIC,anon,authenticated;",
      "GRANT SELECT,INSERT,UPDATE ON public.cockpit_clickup_writeback_queue TO service_role;",
      extract(f, /CREATE OR REPLACE FUNCTION public\.cockpit_clickup_writeback_audit\(\)[\s\S]*?END \$\$;/),
      extract(f, /DROP TRIGGER IF EXISTS cockpit_clickup_writeback_queue_audit_insert[\s\S]*?EXECUTE FUNCTION public\.cockpit_clickup_writeback_audit\(\);/),
      migration("20261009j_billing_clickup_writeback.sql"),
    ].join("\n"),
  );
  // The live kind list (11.2-d): 20261023x and 20261024p widened 20261009a's.
  await db.exec(`ALTER TABLE cockpit_billing_events DROP CONSTRAINT cockpit_billing_events_kind_check;
    ALTER TABLE cockpit_billing_events ADD CONSTRAINT cockpit_billing_events_kind_check CHECK (kind IN ('amount','assign','chase','churn','confirm','date','exclude','extension','invoice','link','method','note','pause','payment','plan','resume','unconfirm','unexclude','unlink'));`);
  return db;
}

const opts = (prefix: string, names: string[]) => names.map((name, i) => ({ id: `${prefix}-${i}`, name, orderindex: i }));
const CHURN_REASONS = ["Cancelled", "Refund", "Chargeback", "Non-payment 14+ days", "Paused past 14 days", "Ghosted", "Completed term, did not renew"];
const FIELDS = [
  { id: "9368ca9e-3549-4320-84ff-9abd0a2901cb", name: "Client Status", type: "drop_down", type_config: { options: opts("st", ["Active", "Paused", "Stopped"]) } },
  { id: "796f25e7-7e63-4d08-9ec4-41c58a5b57ca", name: "❌ Churn Reason", type: "drop_down", type_config: { options: opts("cr", CHURN_REASONS) } },
  { id: "a121f39a-f8a4-41f5-905e-a735ee729071", name: "Churn Type", type: "drop_down", type_config: { options: opts("ct", ["Mid-programme loss (counts as churn)", "Completed term (does NOT count as churn)"]) } },
  { id: "42429a6e-5cba-4a3b-964d-2b493315421b", name: "Churn Date", type: "date" },
  { id: "d3c46259-3017-4429-a52a-c609a40f348b", name: "Resume On", type: "date" },
  { id: "9cfdb353-1111-2222-3333-444455556666", name: "Will not continue if billed on schedule", type: "checkbox" },
];

async function fixture(opts: { fields?: boolean } = {}) {
  const db = await base();
  await db.exec(rails());
  await member(db, CEO, "aziz@maharamedia.com", []);
  await member(db, CSM, "sara@tests.invalid", ["csm"]);
  await member(db, FINANCE, "fin@tests.invalid", ["finance"]);
  await owner(db);
  await db.exec(`
    UPDATE cockpit_members SET clients=ARRAY['Acme'] WHERE email='sara@tests.invalid';
    INSERT INTO cockpit_billing_accounts(clickup_task_id,client_name,stage,stage_group,client_status,payment_method,next_payment_usd,next_payment_date,synced_at)
      VALUES('task_a','Acme','Active','active','Active','Bank transfer',1500,(now() AT TIME ZONE 'Asia/Kuwait')::date+10,now());`);
  if (opts.fields !== false) await putFields(db, FIELDS);
  return db;
}

async function putFields(db: PGlite, fields: unknown[]) {
  await deploy(db);
  await db.exec("SET ROLE service_role");
  try {
    return (await db.query<{ n: number }>("SELECT cockpit_clickup_fields_put($1, $2::jsonb) AS n", [CLIENTS, JSON.stringify(fields)])).rows[0].n;
  } finally {
    await owner(db);
  }
}

/** The owner with no signed-in seat: the deploy connection (Composio) runs as this. */
async function deploy(db: PGlite) {
  await owner(db);
  await db.query("SELECT set_config('request.jwt.claim.sub','',false), set_config('request.jwt.claims','',false)");
}

const rows = async (db: PGlite, sql: string, params: unknown[] = []) => {
  await deploy(db);
  return (await db.query<Record<string, any>>(sql, params)).rows;
};
const one = async (db: PGlite, sql: string, params: unknown[] = []) => (await rows(db, sql, params))[0];
const val = async (db: PGlite, sql: string, params: unknown[] = []) => Object.values((await rows(db, sql, params))[0] ?? {})[0];

/** One event inserted as the owner (a door would do it); returns its id and its queue row. */
async function event(db: PGlite, e: { kind: string; source?: string; from?: string | null; to?: string | null; reason?: string | null; detail?: unknown; task?: string; by?: string }) {
  const id = Number(
    await val(
      db,
      `INSERT INTO cockpit_billing_events(clickup_task_id,client_name,kind,from_value,to_value,reason,detail,source,by_whom)
       VALUES($1,'Acme',$2,$3,$4,$5,$6::jsonb,$7,$8) RETURNING id`,
      [e.task ?? "task_a", e.kind, e.from ?? null, e.to ?? null, e.reason ?? null, e.detail === undefined ? null : JSON.stringify(e.detail), e.source ?? "csm", e.by ?? "sara@tests.invalid"],
    ),
  );
  const item = await one(db, "SELECT * FROM cockpit_clickup_writeback_queue WHERE source_id=$1", [String(id)]);
  return { id, item };
}
const detail = (db: PGlite, kind: string, args: unknown) => val(db, "SELECT cockpit_billing_detail($1,$2::jsonb)", [kind, JSON.stringify(args)]) as Promise<any>;

async function refused(db: PGlite, sql: string, params: unknown[] = []): Promise<{ message: string; code?: string }> {
  try {
    // A whole file goes through exec (many statements); one statement with parameters through query.
    await (params.length || !sql.includes(";") ? db.query(sql, params) : db.exec(sql));
  } catch (e) {
    const err = e as { message: string; code?: string };
    return { message: err.message, code: err.code };
  }
  throw new Error(`Expected the server to refuse: ${sql}`);
}

/** The writer's report of its switch, as clickup-writeback saves it each log run. */
async function report(db: PGlite, mode: string, kinds: string[], onlyCards: string[] = [], at = "now()") {
  await deploy(db);
  await db.query(
    `INSERT INTO cockpit_sync_state(key,last_run_at,ok,note,detail,updated_at)
     VALUES('clickup-writeback:billing',${at},true,'test',$1::jsonb,${at})
     ON CONFLICT (key) DO UPDATE SET detail=EXCLUDED.detail, updated_at=EXCLUDED.updated_at`,
    [JSON.stringify({ mode, kinds, onlyCards })],
  );
}

const md5Of = (db: PGlite, sig: string) =>
  val(db, "SELECT md5(regexp_replace(p.prosrc,'\\s+',' ','g')) FROM pg_proc p WHERE p.oid=to_regprocedure($1)", [`public.${sig}`]);

// --- the file ---------------------------------------------------------------------------------------------

test("20261101m_billing_rails.sql applies twice, its guard holds the replaced bodies, and it is wrapped as the contract says", async () => {
  const db = await base();
  try {
    const text = migration(FILE);
    expect(text.trimStart().split("\n").find(l => !l.startsWith("--"))).toBe("BEGIN;");
    expect(text.trimEnd().endsWith("NOTIFY pgrst, 'reload schema';\nCOMMIT;")).toBe(true);
    // The live bodies (2.2) are the ones 20261009j installed, so the guard reads them as "live".
    expect(await md5Of(db, "cockpit_billing_writeback_writes(text,text,text,jsonb)")).toBe("957894a2a6ce3ae8f5a9c9c9acc1eaab");
    expect(await md5Of(db, "cockpit_billing_writeback_enqueue()")).toBe("ce6cff4631816e5352852b3726dc832d");
    await db.exec(rails());
    await db.exec(rails());
    // The "after" values written into the guard are the bodies this file installs.
    const after = [...text.matchAll(/\('(cockpit_billing_writeback_[a-z]+\([^)]*\))', '[0-9a-f]{32}', '([0-9a-f]{32})'\)/g)];
    expect(after.length).toBe(2);
    for (const [, sig, md5] of after) expect(await md5Of(db, sig)).toBe(md5);
    // A body changed by anyone else stops the file.
    await db.exec("CREATE OR REPLACE FUNCTION public.cockpit_billing_writeback_enqueue() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;");
    const stop = await refused(db, rails());
    expect(stop.message).toBe("public.cockpit_billing_writeback_enqueue() changed since the waves 1-2 contract read it; stop and re-read it.");
    expect(stop.code).toBe("55000");
  } finally {
    await db.close();
  }
});

test("kinds gain mrr, ltv and late, the source gains system, and kinds another file added are kept", async () => {
  const db = await fixture();
  try {
    const defs = await rows(db, "SELECT conname, pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conrelid='cockpit_billing_events'::regclass AND contype='c' ORDER BY 1");
    const kinds = defs.find(d => d.conname === "cockpit_billing_events_kind_check")!.d as string;
    for (const k of ["mrr", "ltv", "late", "churn", "unlink", "exclude", "chase"]) expect(kinds).toContain(`'${k}'`);
    for (const k of ["ceo", "csm", "maher", "clickup", "system"]) expect(defs.find(d => d.conname === "cockpit_billing_events_source_check")!.d).toContain(`'${k}'`);
  } finally {
    await db.close();
  }
});

// --- the trigger and the payload --------------------------------------------------------------------------

test("the trigger queues a person's churn and mrr, the system's extension, ltv and late close, never a system pause", async () => {
  const db = await fixture();
  try {
    const churn = await event(db, { kind: "churn", from: "Active", to: "Stopped", detail: await detail(db, "churn", { leftOn: "2026-10-30", reason: "Cancelled", churnType: "mid_programme", seatRole: "csm" }) });
    expect(churn.item).toMatchObject({ kind: "billing", state: "queued", dedupe_key: `billing:${churn.id}`, task_id: "task_a" });
    const mrr = await event(db, { kind: "mrr", source: "ceo", from: "1500", to: "2000", detail: await detail(db, "mrr", { from: 1500, to: 2000, reasonCat: "upsell", effective: "2026-11-01", seatRole: "ceo" }) });
    expect(mrr.item.payload.writes).toEqual([{ field: "mrr", value: 2000, old: 1500 }]);
    const clear = await event(db, { kind: "extension", source: "system", by: "the cockpit", detail: await detail(db, "extension", { system: true, grantId: 7, seatRole: "system" }) });
    expect(clear.item.payload).toMatchObject({ writes: [{ field: "extension", value: 0 }], comment: null, seatRole: "system", source: "system" });
    const ltv = await event(db, { kind: "ltv", source: "system", to: "12500", by: "the cockpit", detail: await detail(db, "ltv", { sum: 12500, rows: 6, asOf: "2026-11-01" }) });
    expect(ltv.item.payload.writes).toEqual([{ field: "ltv", value: 12500 }]);
    // A late spell opening writes nothing and says nothing, so nothing is queued; its close posts the comment only.
    const open = await event(db, { kind: "late", source: "system", by: "the cockpit", detail: await detail(db, "late", { due: "2026-10-20", spellDay: 1, amountUsd: 1500 }) });
    expect(open.item).toBeUndefined();
    const close = await event(db, { kind: "late", source: "system", by: "the cockpit", detail: await detail(db, "late", { closes: open.id, due: "2026-10-20", daysLate: 9, paidOn: "2026-10-29", closedHow: "date_moved" }) });
    expect(close.item.payload).toMatchObject({ writes: [], comment: "LATE 9 days: due 2026-10-20, paid 2026-10-29" });
    // The system never pauses a client, and an LTV from a person is not a card write either.
    expect((await event(db, { kind: "pause", source: "system", from: "Active", to: "Paused", detail: { on: "2026-11-01" } })).item).toBeUndefined();
    expect((await event(db, { kind: "ltv", source: "ceo", to: "100" })).item).toBeUndefined();
    expect((await event(db, { kind: "churn", source: "maher", from: "Active", to: "Stopped", detail: { left_on: "2026-11-01" } })).item).toBeUndefined();
    const trigger = String(await val(db, "SELECT pg_get_triggerdef(oid) FROM pg_trigger WHERE tgname='cockpit_billing_events_clickup_writeback'"));
    expect(trigger).toContain("'churn'::text, 'mrr'::text");
    expect(trigger).toContain("'extension'::text, 'ltv'::text, 'late'::text");
  } finally {
    await db.close();
  }
});

test("a churn writes Churn Date first, then Stopped, the reason from the stored map, the type, and clears Paused On when asked", async () => {
  const db = await fixture();
  try {
    const d = await detail(db, "churn", {
      leftOn: "2026-10-30", noticeOn: "2026-10-25", reason: "Non-payment 14+ days", churnType: "mid_programme", clearPaused: true,
      whyDetail: "Stopped paying after the launch slipped twice.", surveyState: "filled", departureId: 20, seatRole: "csm",
      requestId: "8f6c1f2e-1111-4222-8333-944445555666",
    });
    expect(d).toEqual({
      left_on: "2026-10-30", notice_on: "2026-10-25", reason: "Non-payment 14+ days", churn_type: "mid_programme",
      card_type: "Mid-programme loss (counts as churn)", card_reason: "Non-payment 14+ days", clear_paused: true,
      why_detail: "Stopped paying after the launch slipped twice.", survey_state: "filled", departure_id: 20, seat_role: "csm",
      request_id: "8f6c1f2e-1111-4222-8333-944445555666",
    });
    const { item } = await event(db, { kind: "churn", from: "Paused", to: "Stopped", reason: "Non-payment 14+ days", detail: d });
    expect(item.payload.writes).toEqual([
      { field: "churnDate", value: "2026-10-30" },
      { field: "status", value: "Stopped", old: "Paused" },
      { field: "churnReason", value: "Non-payment 14+ days" },
      { field: "churnType", value: "Mid-programme loss (counts as churn)" },
      { field: "pausedOn", value: null },
    ]);
    expect(item.payload.comment).toBe(
      [
        "CHURN CONFIRMED: left 2026-10-30",
        "Reason: Non-payment 14+ days",
        "Type: Mid-programme loss (counts as churn)",
        "Why: Stopped paying after the launch slipped twice.",
        "Notice on: 2026-10-25",
        "Exit survey: filled in",
        "By: the CSM",
      ].join("\n"),
    );
    expect(item.payload.comment).not.toContain("@");
  } finally {
    await db.close();
  }
});

test("Completed term maps to the card's option; Other and a reason missing from the map skip only that field, with the 3.3 sentence", async () => {
  const db = await fixture();
  try {
    expect(await val(db, "SELECT cockpit_churn_reason_card('Completed term')")).toBe("Completed term, did not renew");
    expect(await val(db, "SELECT cockpit_churn_reason_card('Completed term, did not renew')")).toBe("Completed term, did not renew");
    expect(await val(db, "SELECT cockpit_churn_reason_card('Other')")).toBeNull();
    expect(await val(db, "SELECT cockpit_churn_reason_card('cancelled')")).toBe("Cancelled");
    const other = await event(db, { kind: "churn", from: "Active", detail: await detail(db, "churn", { leftOn: "2026-10-30", reason: "Other", churnType: "mid_programme", seatRole: "ceo" }) });
    expect(other.item.payload.writes.map((w: any) => w.field)).toEqual(["churnDate", "status", "churnType"]);
    expect(other.item.payload.comment).toContain("Reason: Other\nReason Other: the card's Churn Reason is left as it is.");
    expect(other.item.payload.comment).not.toContain("left empty");
    // Someone removed "Ghosted" from the card's list: the next read is the map, and only that field is skipped.
    await putFields(db, FIELDS.map(f => (f.name === "❌ Churn Reason" ? { ...f, type_config: { options: opts("cr", CHURN_REASONS.filter(r => r !== "Ghosted")) } } : f)));
    expect(await val(db, "SELECT cockpit_churn_reason_card('Ghosted')")).toBeNull();
    expect(await val(db, "SELECT cockpit_churn_reason_card('Completed term')")).toBe("Completed term, did not renew");
    const ghosted = await event(db, { kind: "churn", from: "Active", detail: await detail(db, "churn", { leftOn: "2026-10-30", reason: "Ghosted", churnType: "completed", seatRole: "csm" }) });
    expect(ghosted.item.payload.writes).toEqual([
      { field: "churnDate", value: "2026-10-30" },
      { field: "status", value: "Stopped", old: "Active" },
      { field: "churnType", value: "Completed term (does NOT count as churn)" },
    ]);
    expect(ghosted.item.payload.comment).toContain("Reason: Ghosted\nNot on the card's list, so the card's Churn Reason is left as it is.");
    // Without the card's own "Completed term, did not renew" option, Completed term is left empty too.
    await putFields(db, FIELDS.map(f => (f.name === "❌ Churn Reason" ? { ...f, type_config: { options: opts("cr", ["Cancelled", "Refund"]) } } : f)));
    expect(await val(db, "SELECT cockpit_churn_reason_card('Completed term')")).toBeNull();
    // An older event with no card_reason key is looked up when it is written.
    const legacy = await event(db, { kind: "churn", source: "ceo", from: "Active", detail: { left_on: "2026-10-29", reason: "Refund" } });
    expect(legacy.item.payload.writes).toContainEqual({ field: "churnReason", value: "Refund" });
  } finally {
    await db.close();
  }
});

test("with no stored field map, a reason goes on as named and clickup-writeback judges it against the live list", async () => {
  const db = await fixture({ fields: false });
  try {
    expect(await val(db, "SELECT cockpit_churn_reason_card('Cancelled')")).toBe("Cancelled");
    expect(await val(db, "SELECT cockpit_churn_reason_card('Completed term')")).toBe("Completed term, did not renew");
    expect(await val(db, "SELECT cockpit_churn_reason_card('Other')")).toBeNull();
    const ev = await event(db, { kind: "churn", from: "Active", detail: await detail(db, "churn", { leftOn: "2026-10-30", reason: "Cancelled", churnType: "mid_programme", seatRole: "csm" }) });
    expect(ev.item.payload.writes).toContainEqual({ field: "churnReason", value: "Cancelled" });
    expect(ev.item.payload.comment).not.toContain("left as it is");
  } finally {
    await db.close();
  }
});

test("clickup-writeback's churnReasonCard equals cockpit_churn_reason_card for every register reason", async () => {
  const db = await fixture();
  try {
    for (const names of [CHURN_REASONS, CHURN_REASONS.filter(r => r !== "Refund" && r !== "Completed term, did not renew"), []]) {
      await putFields(db, FIELDS.map(f => (f.name === "❌ Churn Reason" ? { ...f, type_config: { options: opts("cr", names) } } : f)));
      for (const reason of [...REGISTER_REASONS, "Completed term"])
        expect([reason, churnReasonCard(reason, names)]).toEqual([reason, (await val(db, "SELECT cockpit_churn_reason_card($1)", [reason])) as string | null]);
    }
  } finally {
    await db.close();
  }
});

test("each comment of 3.3 says what the contract says, in roles, with no email", async () => {
  const db = await fixture();
  try {
    const ext = await event(db, {
      kind: "extension", from: "2026-10-20", to: "2026-11-03",
      detail: await detail(db, "extension", {
        weeks: 2, ours: false, newDate: "2026-11-03", from: "2026-10-20", reason: "Their launch slipped", reasonCat: "Launch slipped",
        limitations: ["Budget", "Content not ready"], atRisk: true, callId: "call-9", callOn: "2026-10-19", seatRole: "csm",
      }),
    });
    expect(ext.item.payload.writes).toEqual([
      { field: "extension", value: 2 },
      { field: "nextDate", value: "2026-11-03", old: "2026-10-20" },
      { field: "willNotContinue", value: true },
    ]);
    expect(ext.item.payload.comment).toBe(
      [
        "CLIENT EXTENSION: 2 weeks, to 2026-11-03",
        "Why: Launch slipped: Their launch slipped",
        "Ours to control: no",
        "Client limits: Budget, Content not ready",
        "Will not continue if billed on schedule: yes",
        "Call: 2026-10-19",
        "By: the CSM",
      ].join("\n"),
    );
    const noCall = await event(db, { kind: "extension", source: "ceo", from: "2026-10-20", to: "2026-10-27", detail: await detail(db, "extension", { weeks: 1, ours: true, atRisk: false, noCallReason: "Client on leave", seatRole: "ceo" }) });
    expect(noCall.item.payload.comment).toBe("CLIENT EXTENSION: 1 week, to 2026-10-27\nOurs to control: yes\nWill not continue if billed on schedule: no\nNo call: Client on leave\nBy: the CEO");
    expect(noCall.item.payload.writes.at(-1)).toEqual({ field: "willNotContinue", value: false });

    const pause = await event(db, {
      kind: "pause", from: "Active", to: "Paused",
      detail: await detail(db, "pause", {
        pauseKind: "client_request", on: "2026-11-01", restart: "2026-11-10", reasonCat: "Seasonal", reason: "Ramadan break",
        callId: "call-3", callOn: "2026-10-31", consent: { kind: "call", term_runs: true, over_14_ends: true }, seatRole: "csm",
      }),
    });
    expect(pause.item.payload.writes).toEqual([
      { field: "status", value: "Paused", old: "Active" },
      { field: "pausedOn", value: "2026-11-01" },
      { field: "resumeOn", value: "2026-11-10" },
    ]);
    expect(pause.item.payload.comment).toBe("PAUSE AGREED 2026-11-01 to 2026-11-10\nKind: client request\nWhy: Seasonal: Ramadan break\nConsent: on the call 2026-10-31\nBy: the CSM");
    const owed = await event(db, { kind: "pause", source: "ceo", from: "Active", detail: await detail(db, "pause", { pauseKind: "non_payment", on: "2026-11-01", reasonCat: "Not paying", seatRole: "finance" }) });
    expect(owed.item.payload.writes.map((w: any) => w.field)).toEqual(["status", "pausedOn"]);
    expect(owed.item.payload.comment).toBe("PAUSE AGREED 2026-11-01 to no restart date\nKind: non-payment\nWhy: Not paying\nBy: finance");

    const resume = await event(db, { kind: "resume", from: "Paused", to: "Active", detail: await detail(db, "resume", { on: "2026-11-10", nextDate: "2026-12-10", seatRole: "csm" }) });
    expect(resume.item.payload.writes).toEqual([
      { field: "status", value: "Active", old: "Paused" },
      { field: "pausedOn", value: null },
      { field: "resumeOn", value: null },
      { field: "nextDate", value: "2026-12-10" },
    ]);
    expect(resume.item.payload.comment).toBe("RESUMED 2026-11-10\nNext payment: 2026-12-10\nBy: the CSM");

    const mrr = await event(db, { kind: "mrr", from: null, to: "1250.5", detail: await detail(db, "mrr", { to: 1250.5, reasonCat: "correction", reason: "Card was empty", effective: "2026-11-01", seatRole: "csm" }) });
    expect(mrr.item.payload.comment).toBe("MRR none → $1,250.50 from 2026-11-01\nWhy: correction: Card was empty\nBy: the CSM");
    const down = await event(db, { kind: "mrr", source: "ceo", from: "2000", to: "1500", detail: await detail(db, "mrr", { from: 2000, to: 1500, reasonCat: "downgrade", seatRole: "ceo" }) });
    expect(down.item.payload.comment).toBe("MRR $2,000 → $1,500\nWhy: downgrade\nBy: the CEO");

    for (const [how, words] of [["extended", "extension moved the date"], ["stopped", "client stopped"], ["date_moved", "the date moved on the card"]]) {
      const close = await event(db, { kind: "late", source: "system", by: "the cockpit", detail: await detail(db, "late", { closes: 1, due: "2026-10-20", daysLate: 1, closedHow: how }) });
      expect(close.item.payload.comment).toBe(`LATE 1 day: due 2026-10-20, ${words}`);
    }
    // The four kinds of 20261009j keep their behaviour: no comment, a note is its own.
    for (const kind of ["method", "plan", "date", "payment"]) expect(await val(db, "SELECT cockpit_billing_writeback_comment($1,'a','b','{}'::jsonb,'Acme')", [kind])).toBeNull();
    const note = await event(db, { kind: "note", reason: "Called, all fine" });
    expect(note.item.payload).toMatchObject({ note: "Called, all fine", comment: null, writes: [] });
    // No comment anywhere carries the email that made the edit.
    const comments = await rows(db, "SELECT payload->>'comment' AS c FROM cockpit_clickup_writeback_queue WHERE payload->>'comment' IS NOT NULL");
    expect(comments.length).toBeGreaterThan(8);
    for (const c of comments) expect(c.c).not.toMatch(/@|sara|aziz/i);
  } finally {
    await db.close();
  }
});

test("an older event with no seat role names the seat from its source; the reason column feeds Why", async () => {
  const db = await fixture();
  try {
    // 20261009a's cockpit_billing_write, as the two held extensions of 10-19 were made.
    const { item } = await event(db, { kind: "extension", from: "2026-10-19", to: "2026-11-02", reason: "Bank holiday delay", detail: { weeks: 2, ours: true, movedDate: true } });
    expect(item.payload.seatRole).toBe("csm");
    expect(item.payload.comment).toBe("CLIENT EXTENSION: 2 weeks, to 2026-11-02\nWhy: Bank holiday delay\nOurs to control: yes\nBy: the CSM");
    expect(item.payload.writes).toEqual([{ field: "extension", value: 2 }, { field: "nextDate", value: "2026-11-02", old: "2026-10-19" }]);
  } finally {
    await db.close();
  }
});

test("the cockpits' own billing write still queues its edits, now with the comment", async () => {
  const db = await fixture();
  try {
    const client = {
      async rpc(name: string, args: { p_action: string; p_args: unknown }) {
        try {
          const r = await db.query<{ result: unknown }>(`SELECT ${name}($1,$2::jsonb) AS result`, [args.p_action, JSON.stringify(args.p_args)]);
          return { data: r.rows[0].result, error: null };
        } catch (e) {
          const err = e as { message: string; code?: string };
          return { data: null, error: { message: err.message, code: err.code } };
        }
      },
    } as unknown as SupabaseClient;
    await actor(db, CSM);
    await csm.editBillingAccount(client, "", { taskId: "task_a", edit: { kind: "pause", reason: "Client asked to pause" } });
    const [item] = await rows(db, "SELECT payload FROM cockpit_clickup_writeback_queue WHERE kind='billing'");
    expect(item.payload.writes.map((w: any) => w.field)).toEqual(["status", "pausedOn"]);
    // 20261009a records the reason on the event, not in its detail: the comment still says why.
    expect(item.payload.comment).toMatch(/^PAUSE AGREED \d{4}-\d{2}-\d{2} to no restart date\nWhy: Client asked to pause\nBy: the CSM$/);
  } finally {
    await db.close();
  }
});

// --- the detail builder -----------------------------------------------------------------------------------

test("cockpit_billing_detail refuses what the card cannot take", async () => {
  const db = await fixture();
  try {
    expect((await refused(db, "SELECT cockpit_billing_detail('extension','{\"weeks\":3}')")).message).toBe("Give 1, 2 or 4 weeks.");
    expect((await refused(db, "SELECT cockpit_billing_detail('pause','{\"on\":\"2026-02-30x\"}')")).message).toBe("That is not a day (YYYY-MM-DD): 2026-02-30x.");
    expect((await refused(db, "SELECT cockpit_billing_detail('churn','{\"reason\":\"Cancelled\"}')")).message).toBe("Pick the day they left, today or before.");
    expect((await refused(db, "SELECT cockpit_billing_detail('mrr','{\"to\":-5}')")).message).toBe("Set MRR to a dollar amount of 0 or more.");
    expect((await refused(db, "SELECT cockpit_billing_detail('resume','{\"seatRole\":\"sara@tests.invalid\"}')")).message).toContain("the CSM, finance, the CEO or the cockpit");
    expect((await refused(db, "SELECT cockpit_billing_detail('late','{\"closes\":1,\"closedHow\":\"paid\"}')")).message).toContain("extended, stopped or date_moved");
    expect((await refused(db, "SELECT cockpit_billing_detail('chase','{}')")).message).toBe("No billing detail is defined for kind chase.");
    // An extension moves the date unless told otherwise (W13); keys with no value are left out.
    expect(await detail(db, "extension", { weeks: 4, seatRole: "csm" })).toEqual({ weeks: 4, movedDate: true, seat_role: "csm" });
    expect(await detail(db, "date", { requestId: "r1" })).toEqual({ request_id: "r1" });
  } finally {
    await db.close();
  }
});

// --- the field map ----------------------------------------------------------------------------------------

test("the field map stores one read, resolves a prefix only when it is one field, and keeps the map on an empty read", async () => {
  const db = await fixture();
  try {
    expect(await rows(db, "SELECT field_id, type FROM cockpit_clickup_fields ORDER BY field_id")).toHaveLength(FIELDS.length);
    expect(await one(db, "SELECT options FROM cockpit_clickup_fields WHERE field_id LIKE 'a121f39a%'")).toEqual({
      options: [{ id: "ct-0", name: "Mid-programme loss (counts as churn)", orderindex: 0 }, { id: "ct-1", name: "Completed term (does NOT count as churn)", orderindex: 1 }],
    });
    expect(await val(db, "SELECT cockpit_clickup_field('9cfdb353')->>'type'")).toBe("checkbox");
    expect(await val(db, "SELECT cockpit_clickup_option_ok('9368ca9e','stopped')")).toBe(true);
    expect(await val(db, "SELECT cockpit_clickup_option_ok('9368ca9e','Churned')")).toBe(false);
    // Two fields on one prefix is no answer at all.
    await putFields(db, [...FIELDS, { id: "9cfdb353-9999-2222-3333-444455556666", name: "Copy", type: "checkbox" }]);
    expect(await val(db, "SELECT cockpit_clickup_field('9cfdb353')")).toBeNull();
    // A field ClickUp removed drops out of the newest read; its row stays as history.
    await putFields(db, FIELDS.filter(f => !f.id.startsWith("9cfdb353")));
    expect(await val(db, "SELECT cockpit_clickup_field('9cfdb353')")).toBeNull();
    expect(Number(await val(db, "SELECT count(*) FROM cockpit_clickup_fields WHERE field_id LIKE '9cfdb353%'"))).toBe(2);
    await db.exec("SET ROLE service_role");
    expect((await refused(db, "SELECT cockpit_clickup_fields_put($1,'[]'::jsonb)", [CLIENTS])).message).toBe(
      `ClickUp returned no fields for list ${CLIENTS}, so the stored field map was kept.`,
    );
    expect((await refused(db, "SELECT cockpit_clickup_fields_put($1,'[{\"name\":\"no id\"}]'::jsonb)", [CLIENTS])).message).toContain("no field with an id");
    await owner(db);
    expect(Number(await val(db, "SELECT count(*) FROM cockpit_clickup_fields"))).toBe(FIELDS.length + 1);
    // A changed field is audited; a plain daily read of the same field is not.
    const audits = await rows(db, "SELECT action, entity_id FROM cockpit_audit_log WHERE action LIKE 'billing.field_map.%'");
    expect(audits.filter(a => a.action === "billing.field_map.insert")).toHaveLength(FIELDS.length + 1);
    expect(audits.filter(a => a.action === "billing.field_map.update")).toHaveLength(0);
    expect((await refused(db, "DELETE FROM cockpit_clickup_fields")).message).toBe("cockpit_clickup_fields is a record: its rows are never changed or deleted.");
  } finally {
    await db.close();
  }
});

// --- the canary -------------------------------------------------------------------------------------------

test("the canary writes only the test card, builds the detail as the real door does, and runs only as the owner", async () => {
  const db = await fixture();
  try {
    expect((await refused(db, "SELECT cockpit_billing_canary('churn', '{\"taskId\":\"task_a\",\"leftOn\":\"2026-11-01\"}')")).message).toBe(
      "The canary writes only the test card 86eywg1cq.",
    );
    const id = Number(await val(db, "SELECT cockpit_billing_canary('churn', $1::jsonb)", [JSON.stringify({ from: "Active", leftOn: "2026-11-01", reason: "Completed term", churnType: "completed" })]));
    const e = await one(db, "SELECT clickup_task_id, kind, from_value, to_value, source, by_whom, detail FROM cockpit_billing_events WHERE id=$1", [id]);
    expect(e).toMatchObject({ clickup_task_id: TEST_CARD, kind: "churn", from_value: "Active", to_value: "Stopped", source: "ceo", by_whom: "canary" });
    expect(e.detail).toEqual(await detail(db, "churn", { leftOn: "2026-11-01", reason: "Completed term", churnType: "completed", seatRole: "ceo" }));
    const item = await one(db, "SELECT payload FROM cockpit_clickup_writeback_queue WHERE source_id=$1", [String(id)]);
    expect(item.payload.writes).toEqual([
      { field: "churnDate", value: "2026-11-01" },
      { field: "status", value: "Stopped", old: "Active" },
      { field: "churnReason", value: "Completed term, did not renew" },
      { field: "churnType", value: "Completed term (does NOT count as churn)" },
    ]);
    // The extension clear and a late event come from the system; a system pause never does.
    const clear = Number(await val(db, "SELECT cockpit_billing_canary('extension', '{\"system\":true}')"));
    expect(await one(db, "SELECT source, detail FROM cockpit_billing_events WHERE id=$1", [clear])).toEqual({ source: "system", detail: { weeks: 0, reason: "grant ended", seat_role: "system" } });
    expect((await refused(db, "SELECT cockpit_billing_canary('pause', '{\"system\":true,\"on\":\"2026-11-01\"}')")).message).toBe(
      "Only an extension clear or a late event comes from the cockpit itself.",
    );
    expect((await refused(db, "SELECT cockpit_billing_canary('late', '{\"due\":\"2026-10-01\"}')")).message).toContain("send system true");
    expect((await refused(db, "SELECT cockpit_billing_canary('ltv', '{}')")).message).toBe("The canary takes churn, extension, pause, resume, mrr, late or date.");
    expect((await refused(db, "SELECT cockpit_billing_canary('date', '{\"to\":\"soon\"}')")).message).toContain("needs the new day");
    // No browser seat can call it, nor any of the owner doors.
    await actor(db, CEO);
    for (const sql of [
      "SELECT cockpit_billing_canary('churn','{}')",
      "SELECT cockpit_billing_held_release(1,'close','test reason','x')",
      "SELECT cockpit_billing_event_void_owner(1,'test reason','x')",
      "SELECT cockpit_billing_detail('date','{}')",
      "SELECT cockpit_clickup_fields_put('901816559981','[]')",
      "SELECT cockpit_billing_writeback_held('{}')",
      "SELECT cockpit_billing_mode()",
    ])
      expect((await refused(db, sql)).message).toContain("permission denied");
  } finally {
    await db.close();
  }
});

// --- voids ------------------------------------------------------------------------------------------------

test("a void closes an unsent item, refuses one the card already shows, and is the CEO's or finance's", async () => {
  const db = await fixture();
  try {
    const held = await event(db, { kind: "extension", from: "2026-10-19", to: "2026-11-02", detail: { weeks: 2, movedDate: true } });
    await db.query("UPDATE cockpit_clickup_writeback_queue SET state='dry_run' WHERE id=$1", [held.item.id]);
    await actor(db, CSM);
    expect((await refused(db, "SELECT cockpit_billing_event_void($1,'Churned client')", [held.id])).message).toBe("Only finance or the CEO voids a billing change.");
    await actor(db, null);
    expect((await refused(db, "SELECT cockpit_billing_event_void($1,'Churned client')", [held.id])).message).toContain("permission denied");
    await actor(db, FINANCE);
    expect((await refused(db, "SELECT cockpit_billing_event_void($1,'no')", [held.id])).message).toBe("Say why in 4 to 300 characters, so the void reads back.");
    const out = (await db.query<{ r: any }>("SELECT cockpit_billing_event_void($1,'Churned client') AS r", [held.id])).rows[0].r;
    expect(out).toEqual({ eventId: held.id, kind: "extension", voided: true, itemId: held.item.id, itemState: "skipped" });
    expect(await one(db, "SELECT state, error FROM cockpit_clickup_writeback_queue WHERE id=$1", [held.item.id])).toEqual({ state: "skipped", error: "Voided in the cockpit: Churned client" });
    expect(await one(db, "SELECT reason, voided_by FROM cockpit_billing_event_voids WHERE event_id=$1", [held.id])).toEqual({ reason: "Churned client", voided_by: "fin@tests.invalid" });
    expect(await one(db, "SELECT action, actor_email, source_app FROM cockpit_audit_log WHERE action='billing.event_void'")).toEqual({
      action: "billing.event_void", actor_email: "fin@tests.invalid", source_app: "client-success-cockpit",
    });
    await actor(db, CEO);
    expect((await refused(db, "SELECT cockpit_billing_event_void($1,'Churned client')", [held.id])).message).toMatch(/^This change was already voided on \d{4}-\d{2}-\d{2}\.$/);

    const sent = await event(db, { kind: "date", from: "2026-10-27", to: "2026-11-27" });
    await db.query("UPDATE cockpit_clickup_writeback_queue SET state='delivered', delivered_at=now() WHERE id=$1", [sent.item.id]);
    await actor(db, CEO);
    expect((await refused(db, "SELECT cockpit_billing_event_void($1,'Wrong date')", [sent.id])).message).toBe("The card already shows this change; make a new edit instead.");
    const half = await event(db, { kind: "pause", from: "Active", detail: { on: "2026-11-01" } });
    await db.query("UPDATE cockpit_clickup_writeback_queue SET state='retry', progress='{\"status\":{\"done\":true,\"written\":true}}' WHERE id=$1", [half.item.id]);
    await actor(db, CEO);
    expect((await refused(db, "SELECT cockpit_billing_event_void($1,'Wrong client')", [half.id])).message).toBe("Part of this change is already on the card; make a new edit instead.");
    const sending = await event(db, { kind: "date", from: "2026-10-27", to: "2026-11-28" });
    await db.query("UPDATE cockpit_clickup_writeback_queue SET state='unknown' WHERE id=$1", [sending.item.id]);
    await actor(db, CEO);
    expect((await refused(db, "SELECT cockpit_billing_event_void($1,'Wrong date')", [sending.id])).message).toContain("being written to the card right now");
    // A queued item with nothing written yet is closed too.
    const queued = await event(db, { kind: "date", from: "2026-10-27", to: "2026-11-29" });
    await actor(db, CEO);
    expect(((await db.query<{ r: any }>("SELECT cockpit_billing_event_void($1,'Typed the wrong day') AS r", [queued.id])).rows[0].r).itemState).toBe("skipped");
    // The record cannot be edited or removed, and the browser cannot read it directly.
    expect((await refused(db, "SELECT * FROM cockpit_billing_event_voids")).message).toContain("permission denied");
    await owner(db);
    expect((await refused(db, "UPDATE cockpit_billing_event_voids SET reason='changed later'")).message).toBe("cockpit_billing_event_voids is a record: its rows are never changed or deleted.");
    expect((await refused(db, "DELETE FROM cockpit_billing_event_voids")).message).toContain("is a record");
    // The deploy's void is credited to whoever decided it.
    const marble = await event(db, { kind: "extension", from: "2026-10-19", to: "2026-11-02", detail: { weeks: 2, movedDate: true } });
    await db.query("UPDATE cockpit_clickup_writeback_queue SET state='dry_run' WHERE id=$1", [marble.item.id]);
    await db.query("SELECT cockpit_billing_event_void_owner($1, 'Churned; voided on the CEO''s default (Q3)', 'the CEO''s default (Q3)')", [marble.id]);
    expect(await one(db, "SELECT voided_by FROM cockpit_billing_event_voids WHERE event_id=$1", [marble.id])).toEqual({ voided_by: "the CEO's default (Q3)" });
    expect(await one(db, "SELECT error FROM cockpit_clickup_writeback_queue WHERE id=$1", [marble.item.id])).toEqual({ error: "Voided in the cockpit: Churned; voided on the CEO's default (Q3)" });
  } finally {
    await db.close();
  }
});

// --- the held-edit review ---------------------------------------------------------------------------------

async function heldItem(db: PGlite, kind = "date") {
  const e = await event(db, kind === "date" ? { kind, from: "2026-10-27", to: "2026-11-27", detail: { inbox: 5 } } : { kind, from: "2026-10-19", to: "2026-11-02", detail: { weeks: 2, movedDate: true } });
  await db.query(
    "UPDATE cockpit_clickup_writeback_queue SET state='dry_run', steps='[{\"key\":\"nextDate\"}]', progress='{}', planned='[{\"field\":\"Next Payment Date\"}]', created_at=now()-interval '5 days' WHERE id=$1",
    [e.item.id],
  );
  await db.query("UPDATE cockpit_billing_events SET at=now()-interval '5 days' WHERE id=$1", [e.id]);
  return e;
}
const release = (db: PGlite, id: number, how: string, reason = "Read the card on 11-01") =>
  db.query<{ r: any }>("SELECT cockpit_billing_held_release($1,$2,$3,'the CEO''s default') AS r", [id, how, reason]).then(r => r.rows[0].r);

test("held_release replans, records fresh, closes or voids one held edit of an open kind", async () => {
  const db = await fixture();
  try {
    await report(db, "apply", ["date", "extension"]);
    const a = await heldItem(db);
    expect(await release(db, a.id, "replan")).toEqual({ itemId: a.item.id, how: "replan", newEventId: null, state: "queued" });
    expect(await one(db, "SELECT state, steps, progress, error FROM cockpit_clickup_writeback_queue WHERE id=$1", [a.item.id])).toEqual({ state: "queued", steps: null, progress: {}, error: null });

    const b = await heldItem(db);
    const fresh = await release(db, b.id, "fresh", "Card changed since; Ardon still lacks 11-27");
    expect(fresh).toMatchObject({ itemId: b.item.id, how: "fresh", state: "queued" });
    const copy = await one(db, "SELECT kind, from_value, to_value, source, by_whom, detail, at > now() - interval '1 minute' AS now FROM cockpit_billing_events WHERE id=$1", [fresh.newEventId]);
    const { granted_at, ...kept } = copy.detail;
    expect({ ...copy, detail: kept }).toEqual({ kind: "date", from_value: "2026-10-27", to_value: "2026-11-27", source: "csm", by_whom: "sara@tests.invalid", now: true, detail: { inbox: 5, replaces_event_id: b.id, released_by: "the CEO's default" } });
    // The copy keeps the first event's time, so a grant's month does not move (cockpit_extensions_v reads it).
    expect(await val(db, "SELECT ($1::text)::timestamptz = (SELECT at FROM cockpit_billing_events WHERE id=$2)", [granted_at, b.id])).toBe(true);
    expect(await one(db, "SELECT state, error FROM cockpit_clickup_writeback_queue WHERE id=$1", [b.item.id])).toEqual({
      state: "skipped", error: "Voided in the cockpit: Recorded again at the kind opening: Card changed since; Ardon still lacks 11-27",
    });
    expect(await val(db, "SELECT count(*) FROM cockpit_billing_event_voids WHERE event_id=$1", [b.id])).toBe(1);
    const fresher = await one(db, "SELECT state, payload FROM cockpit_clickup_writeback_queue WHERE source_id=$1", [String(fresh.newEventId)]);
    expect(fresher.state).toBe("queued");
    expect(fresher.payload.at).toBeGreaterThan(Date.now() - 60_000);

    const c = await heldItem(db, "extension");
    expect(await release(db, c.id, "close", "grant ended before its kind opened")).toMatchObject({ state: "skipped", newEventId: null });
    expect(await one(db, "SELECT state, error FROM cockpit_clickup_writeback_queue WHERE id=$1", [c.item.id])).toEqual({ state: "skipped", error: "Closed at the kind opening: grant ended before its kind opened" });
    // A closed edit stays a record: the event is not voided.
    expect(await val(db, "SELECT count(*) FROM cockpit_billing_event_voids WHERE event_id=$1", [c.id])).toBe(0);

    const d = await heldItem(db, "extension");
    expect(await release(db, d.id, "void", "Churned; voided on the CEO's default")).toMatchObject({ state: "skipped" });
    expect(await one(db, "SELECT reason FROM cockpit_billing_event_voids WHERE event_id=$1", [d.id])).toEqual({ reason: "Churned; voided on the CEO's default" });

    const audits = await rows(db, "SELECT after->>'how' AS how, metadata->>'eventId' AS e FROM cockpit_audit_log WHERE action='billing.held_release' ORDER BY created_at");
    expect(audits.map(x => x.how)).toEqual(["replan", "fresh", "close", "void"]);
  } finally {
    await db.close();
  }
});

test("held_release refuses an item not held, not billing, of a closed kind, or limited to other cards", async () => {
  const db = await fixture();
  try {
    const a = await heldItem(db);
    // No report yet: the switch is unknown, so no kind is open.
    expect((await refused(db, "SELECT cockpit_billing_held_release($1,'replan','Read the card','x')", [a.id])).message).toBe(
      "Kind date is not open on the billing switch (now unknown), so a released edit would be held again. Open the kind first.",
    );
    await report(db, "dry_run", ["date"]);
    expect((await refused(db, "SELECT cockpit_billing_held_release($1,'close','Read the card','x')", [a.id])).message).toContain("(now dry_run)");
    await report(db, "apply", ["churn"]);
    expect((await refused(db, "SELECT cockpit_billing_held_release($1,'close','Read the card','x')", [a.id])).message).toContain("Kind date is not open");
    // A report older than an hour is not trusted.
    await report(db, "apply", ["date"], [], "now() - interval '2 hours'");
    expect((await refused(db, "SELECT cockpit_billing_held_release($1,'close','Read the card','x')", [a.id])).message).toContain("(now unknown)");
    await report(db, "apply_limited", ["date"], [TEST_CARD]);
    expect((await refused(db, "SELECT cockpit_billing_held_release($1,'replan','Read the card','x')", [a.id])).message).toContain("limited to other cards");
    expect((await refused(db, "SELECT cockpit_billing_held_release($1,'fresh','Read the card','x')", [a.id])).message).toContain("limited to other cards");
    await report(db, "apply", ["date", "pause"]);
    const sent = await event(db, { kind: "date", from: "2026-10-01", to: "2026-11-01" });
    expect((await refused(db, "SELECT cockpit_billing_held_release($1,'replan','Read the card','x')", [sent.id])).message).toBe(
      "Only a held edit (dry_run) is released here; this one is queued.",
    );
    // An item of another kind pointing at a billing event (never written by the trigger) is refused.
    const odd = Number(await val(db, "INSERT INTO cockpit_billing_events(clickup_task_id,kind,source,by_whom,from_value) VALUES('task_a','pause','maher','x','Active') RETURNING id"));
    await db.query("INSERT INTO cockpit_clickup_writeback_queue(dedupe_key,kind,source_table,source_id,payload,state) VALUES('odd','manual_change','cockpit_billing_events',$1,'{}','dry_run')", [String(odd)]);
    expect((await refused(db, "SELECT cockpit_billing_held_release($1,'close','Read the card','x')", [odd])).message).toBe("Only a billing edit is released here; this item is kind manual_change.");
    expect((await refused(db, "SELECT cockpit_billing_held_release($1,'release','Read the card','x')", [a.id])).message).toBe("Release a held edit with replan, fresh, close or void.");
    expect((await refused(db, "SELECT cockpit_billing_held_release($1,'close','ok','x')", [a.id])).message).toContain("4 to 300 characters");
    expect((await refused(db, "SELECT cockpit_billing_held_release(999999,'close','Read the card','x')")).message).toBe("That billing change is not in the log.");
    // Nothing moved.
    expect(await val(db, "SELECT state FROM cockpit_clickup_writeback_queue WHERE id=$1", [a.item.id])).toBe("dry_run");
    // The general log edits are never this function's: it looks only at billing events.
    expect(String(await val(db, "SELECT prosrc FROM pg_proc WHERE proname='cockpit_billing_held_release'"))).toContain("source_table = 'cockpit_billing_events'");
  } finally {
    await db.close();
  }
});

// --- the switch as reported, and the held count ------------------------------------------------------------

test("cockpit_billing_mode reads the writer's report, and the held count names the open kinds", async () => {
  const db = await fixture();
  try {
    expect(await val(db, "SELECT cockpit_billing_mode()->>'mode'")).toBe("unknown");
    await report(db, "dry_run", ["churn"]);
    expect(await val(db, "SELECT cockpit_billing_mode()")).toMatchObject({ mode: "dry_run", kinds: [], onlyCards: [] });
    await report(db, "apply_limited", ["churn", "resume"], [TEST_CARD]);
    expect(await val(db, "SELECT cockpit_billing_mode()")).toMatchObject({ mode: "apply_limited", kinds: ["churn", "resume"], onlyCards: [TEST_CARD] });
    await heldItem(db);
    await heldItem(db, "extension");
    await heldItem(db, "extension");
    // clickup-writeback calls it with the service key.
    await db.exec("SET ROLE service_role");
    const held = async (kinds: string) => (await db.query<{ r: unknown }>(`SELECT cockpit_billing_writeback_held('${kinds}'::text[]) AS r`)).rows[0].r;
    expect(await held("{extension}")).toEqual({ held: 3, heldOpenKind: 2, byKind: { date: 1, extension: 2 } });
    expect(await held("{}")).toEqual({ held: 3, heldOpenKind: 0, byKind: { date: 1, extension: 2 } });
  } finally {
    await db.close();
  }
});

test("no browser role reads or writes the two new tables", async () => {
  const db = await fixture();
  try {
    for (const who of [CEO, null]) {
      await actor(db, who);
      for (const t of ["cockpit_clickup_fields", "cockpit_billing_event_voids"]) expect((await refused(db, `SELECT * FROM ${t}`)).message).toContain("permission denied");
    }
    await owner(db);
    const rls = await rows(db, "SELECT relname, relrowsecurity FROM pg_class WHERE relname IN ('cockpit_clickup_fields','cockpit_billing_event_voids') ORDER BY 1");
    expect(rls).toEqual([{ relname: "cockpit_billing_event_voids", relrowsecurity: true }, { relname: "cockpit_clickup_fields", relrowsecurity: true }]);
    const grants = await rows(
      db,
      "SELECT table_name, grantee, string_agg(privilege_type, ',' ORDER BY privilege_type) AS p FROM information_schema.role_table_grants WHERE table_name IN ('cockpit_clickup_fields','cockpit_billing_event_voids') AND grantee IN ('anon','authenticated','service_role') GROUP BY 1,2 ORDER BY 1,2",
    );
    expect(grants).toEqual([
      { table_name: "cockpit_billing_event_voids", grantee: "service_role", p: "INSERT,SELECT" },
      { table_name: "cockpit_clickup_fields", grantee: "service_role", p: "INSERT,SELECT,UPDATE" },
    ]);
  } finally {
    await db.close();
  }
});
