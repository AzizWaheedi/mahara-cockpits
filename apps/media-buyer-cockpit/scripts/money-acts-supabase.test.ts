import { expect, test } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import {
  actor,
  cockpitTestDb,
  member,
  migration,
  owner,
} from "./lib/cockpitTestDb";

// supabase/migrations/20261101p_money_acts.sql against canonical SQL
// (docs/forms/WAVE12-CONTRACT.md 2.7, 3.1, 3.2, 3.5, 4.7 to 4.10, section 8).
//
// The file stands on 20261101l, m and n, built side by side with it. This test
// applies the live tables those files change and, in place of the three files,
// the few objects of theirs this file calls, exactly as the contract names them
// (the stubs below). The integration run applies the real l, m and n first.

const CEO = "00000000-0000-4000-8000-000000000001";
const CSM = "00000000-0000-4000-8000-000000000002";
const OTHER_CSM = "00000000-0000-4000-8000-000000000003";
const FINANCE = "00000000-0000-4000-8000-000000000005";
const FILE = "20261101p_money_acts.sql";

function extract(file: string, pattern: RegExp): string {
  const hit = migration(file).match(pattern);
  if (!hit)
    throw new Error(`Canonical definition missing in ${file}: ${pattern}`);
  return hit[0];
}

function withoutCron(text: string): string {
  const start = text.indexOf("-- cron:begin");
  const end = text.indexOf("-- cron:end");
  if (start < 0 || end < start)
    throw new Error("The schedule block is missing its markers");
  // pg_cron is not in the test engine.
  return text.slice(0, start) + text.slice(end + "-- cron:end".length);
}

const moneyActs = () => withoutCron(migration(FILE));

/** The contract's objects of 20261101l, m and n that 20261101p calls (3.1, 2.3 to 2.5). */
const SIBLING_STUBS = `
-- l: the six notice kinds, the staff forms in the registry, the staff record.
ALTER TABLE public.cockpit_slack_notices DROP CONSTRAINT cockpit_slack_notices_kind_check;
ALTER TABLE public.cockpit_slack_notices ADD CONSTRAINT cockpit_slack_notices_kind_check CHECK (kind IN ('kickoff','kickoff.updated',
  'blueprint.close','blueprint.updated','blueprint.media','blueprint.offer','rehearsal','termination.submitted','termination.notice',
  'churn.confirmed','extension.granted','pause.agreed','client.resumed'));
INSERT INTO public.cockpit_forms(key,title,audience,provider,typeform_id,schema,seats,client_scoped,effects,updated_by) VALUES
  ('extension','Give more time','team','native',NULL,'{}','{csm}',true,'[]','migration 20261101l'),
  ('pause','Pause this client','team','native',NULL,'{}','{csm}',true,'[]','migration 20261101l'),
  ('resume','Resume this client','team','native',NULL,'{}','{csm}',true,'[]','migration 20261101l'),
  ('mrr','Set MRR','team','native',NULL,'{}','{csm}',true,'[]','migration 20261101l'),
  ('checkin','1-1','team','native',NULL,'{}','{csm}',true,'[]','migration'),
  ('exit_survey','Termination survey','client','typeform','knIe4eF3','{}','{csm}',true,'[]','migration 20261101l');
INSERT INTO public.cockpit_form_versions(form_key,version,schema,published_by)
  SELECT key, 1, '{}', 'migration' FROM public.cockpit_forms;
CREATE FUNCTION public.cockpit_form_staff_record(p_form_key text, p_task_id text, p_answers jsonb, p_request_id uuid,
  p_source text DEFAULT 'cockpit') RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v uuid; v_email text;
BEGIN
  SELECT r.id INTO v FROM public.cockpit_form_responses r WHERE r.form_key = p_form_key AND r.external_id = 'req:' || p_request_id;
  IF FOUND THEN RETURN v; END IF;
  IF p_source <> 'cockpit' OR auth.uid() IS NULL THEN RAISE EXCEPTION 'stub: cockpit only'; END IF;
  SELECT lower(u.email) INTO v_email FROM auth.users u WHERE u.id = auth.uid();
  INSERT INTO public.cockpit_form_responses(form_key, form_version, source, external_id, task_id, client_name, mode, state,
    answers, created_by, created_by_id, confirmed_by, confirmed_at)
  VALUES (p_form_key, 1, 'cockpit', 'req:' || p_request_id, p_task_id,
    (SELECT a.client_name FROM public.cockpit_billing_accounts a WHERE a.clickup_task_id = p_task_id), 'live', 'confirmed',
    p_answers, v_email, auth.uid(), v_email, now())
  RETURNING id INTO v;
  RETURN v;
END $$;
REVOKE ALL ON FUNCTION public.cockpit_form_staff_record(text,text,jsonb,uuid,text) FROM PUBLIC, anon, authenticated, service_role;

-- m: kinds mrr, ltv, late; source system; the voids; the trigger's new list.
ALTER TABLE public.cockpit_billing_events DROP CONSTRAINT cockpit_billing_events_kind_check;
ALTER TABLE public.cockpit_billing_events ADD CONSTRAINT cockpit_billing_events_kind_check CHECK (kind IN ('amount','assign','chase',
  'churn','confirm','date','exclude','extension','invoice','link','method','note','pause','payment','plan','resume','unconfirm',
  'unexclude','unlink','mrr','ltv','late'));
ALTER TABLE public.cockpit_billing_events DROP CONSTRAINT cockpit_billing_events_source_check;
ALTER TABLE public.cockpit_billing_events ADD CONSTRAINT cockpit_billing_events_source_check CHECK (source IN ('ceo','csm','maher','clickup','system'));
CREATE TABLE public.cockpit_billing_event_voids (
  event_id bigint PRIMARY KEY REFERENCES public.cockpit_billing_events(id),
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 4 AND 300),
  voided_by text NOT NULL,
  voided_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.cockpit_billing_event_voids ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cockpit_billing_event_voids FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON public.cockpit_billing_event_voids TO service_role;
DROP TRIGGER IF EXISTS cockpit_billing_events_clickup_writeback ON public.cockpit_billing_events;
CREATE TRIGGER cockpit_billing_events_clickup_writeback AFTER INSERT ON public.cockpit_billing_events
 FOR EACH ROW WHEN ((NEW.source IN ('ceo','csm') AND NEW.kind IN ('method','plan','amount','date','extension','pause','resume','payment','note','churn','mrr'))
   OR (NEW.source = 'system' AND NEW.kind IN ('extension','ltv','late')))
 EXECUTE FUNCTION public.cockpit_billing_writeback_enqueue();

-- n: a rail payment is checked or not (20260927i's active column first, as live).
ALTER TABLE public.cockpit_client_payments ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;
ALTER TABLE public.cockpit_client_payments ADD COLUMN checked boolean NOT NULL DEFAULT false;
`;

type Db = PGlite;

async function base(): Promise<Db> {
  const db = await cockpitTestDb();
  await db.exec(
    "CREATE SCHEMA storage; CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint); CREATE TABLE storage.objects(bucket_id text,name text,metadata jsonb); ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY; GRANT USAGE ON SCHEMA storage TO authenticated; GRANT SELECT,INSERT ON storage.objects TO authenticated;",
  );
  for (const name of [
    "cockpit_client_billing_days",
    "cockpit_metric_days",
    "cockpit_payer_clients",
  ])
    await db.exec(
      extract(
        "20260919_cockpit_core.sql",
        new RegExp(
          `create table if not exists public\\.${name} \\([\\s\\S]*?\\n\\);`,
          "i",
        ),
      ),
    );
  await db.exec(
    extract(
      "20260927x_cockpit_native_media_sync.sql",
      /ALTER TABLE public\.cockpit_client_billing_days[\s\S]*?source_record jsonb;/,
    ),
  );
  await db.exec(
    extract(
      "20260919b_people.sql",
      /create table if not exists public\.cockpit_people \([\s\S]*?\n\);/i,
    ),
  );
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
  await db.exec(
    extract(
      "20261007d_cockpit_team_rpc_restore.sql",
      /create or replace function public\.cockpit_has_active_seat\(\)[\s\S]*?\$\$;/,
    ),
  );
  await db.exec(
    "GRANT EXECUTE ON FUNCTION public.cockpit_has_active_seat() TO authenticated, service_role;",
  );
  await db.exec(
    extract(
      "20260924r_billing_and_comms_access.sql",
      /-- 1\. Cockpit Billing Accounts[\s\S]*?(?=-- 4\. WhatsApp)/,
    ),
  );
  await db.exec(
    extract(
      "20260926m_cockpit_csm_state.sql",
      /CREATE OR REPLACE FUNCTION public\.cockpit_client_allowed\([\s\S]*?END \$\$;/,
    ),
  );
  await db.exec(
    "GRANT EXECUTE ON FUNCTION public.cockpit_client_allowed(text) TO authenticated, service_role;",
  );
  await db.exec(migration("20260927d_cockpit_manual_payments_access.sql"));
  await db.exec(migration("20260927h_cockpit_ceo_actions.sql"));
  await db.exec(
    withoutCron(migration("20261009a_billing_native_sync.sql")) +
      "\n" +
      migration("20261009h_billing_browser_writes_closed.sql"),
  );
  // 20261022c added the Ecom rail to the live body (the drift guard's md5 is of that body).
  await db.exec(
    extract("20261022c_ecom_money_rails.sql", /DO \$body\$[\s\S]*?\$body\$;/),
  );
  const wb = "20261009f_clickup_writeback_native.sql";
  await db.exec(
    [
      extract(
        wb,
        /CREATE TABLE IF NOT EXISTS public\.cockpit_clickup_writeback_queue\([\s\S]*?\n\);/,
      ),
      "ALTER TABLE public.cockpit_clickup_writeback_queue ENABLE ROW LEVEL SECURITY;",
      "REVOKE ALL ON public.cockpit_clickup_writeback_queue FROM PUBLIC,anon,authenticated;",
      "GRANT SELECT,INSERT,UPDATE ON public.cockpit_clickup_writeback_queue TO service_role;",
      extract(
        wb,
        /CREATE OR REPLACE FUNCTION public\.cockpit_clickup_writeback_audit\(\)[\s\S]*?END \$\$;/,
      ),
      extract(
        wb,
        /DROP TRIGGER IF EXISTS cockpit_clickup_writeback_queue_audit_insert[\s\S]*?EXECUTE FUNCTION public\.cockpit_clickup_writeback_audit\(\);/,
      ),
      migration("20261009j_billing_clickup_writeback.sql"),
    ].join("\n"),
  );
  // The forms registry and responses (20261027f), the call store (20261011c),
  // the notice queue (20261025n) and the settings audit (20261029z).
  const fc = "20261027f_forms_core.sql";
  await db.exec(
    extract(
      fc,
      /CREATE OR REPLACE FUNCTION public\.cockpit_forms_effects_valid\(p jsonb\)[\s\S]*?END \$\$;/,
    ),
  );
  await db.exec(
    extract(
      fc,
      /CREATE TABLE IF NOT EXISTS public\.cockpit_forms \([\s\S]*?\n\);/,
    ),
  );
  await db.exec(
    extract(
      fc,
      /CREATE TABLE IF NOT EXISTS public\.cockpit_form_versions \([\s\S]*?\n\);/,
    ),
  );
  await db.exec(
    extract(
      fc,
      /CREATE TABLE IF NOT EXISTS public\.cockpit_form_responses \([\s\S]*?\n\);/,
    ),
  );
  await db.exec(
    extract(
      "20261011c_csm_call_store.sql",
      /CREATE TABLE IF NOT EXISTS public\.cockpit_csm_calls\([\s\S]*?\n\);/,
    ),
  );
  const sn = "20261025n_slack_notices.sql";
  await db.exec(
    extract(
      sn,
      /CREATE TABLE IF NOT EXISTS public\.cockpit_slack_notices \([\s\S]*?\n\);/,
    ),
  );
  await db.exec(
    extract(
      sn,
      /CREATE OR REPLACE FUNCTION public\.cockpit_slack_notice_queue\([\s\S]*?END \$\$;/,
    ),
  );
  await db.exec(
    extract(
      sn,
      /CREATE OR REPLACE FUNCTION public\.cockpit_slack_notice_queue_failed\([\s\S]*?END \$\$;/,
    ),
  );
  const fa = "20261029z_forms_move_recording.sql";
  await db.exec(
    extract(
      fa,
      /CREATE OR REPLACE FUNCTION public\.cockpit_settings_forms_audit\(\)[\s\S]*?END \$\$;/,
    ),
  );
  await db.exec(
    extract(
      fa,
      /DROP TRIGGER IF EXISTS cockpit_settings_forms_audit[\s\S]*?EXECUTE FUNCTION public\.cockpit_settings_forms_audit\(\);/,
    ),
  );

  // As live (read 2026-11-01): the call store's detail column on the sync state,
  // and the service role reads the snapshot and payment tables.
  await db.exec(`ALTER TABLE public.cockpit_sync_state ADD COLUMN IF NOT EXISTS detail jsonb;
    GRANT SELECT ON public.cockpit_client_billing_days, public.cockpit_client_payments, public.cockpit_billing_events,
      public.cockpit_billing_accounts TO service_role;`);

  await member(db, CEO, "aziz@maharamedia.com", []);
  await member(db, CSM, "sara@tests.invalid", ["csm"]);
  await member(db, OTHER_CSM, "omar@tests.invalid", ["csm"]);
  await member(db, FINANCE, "fin@tests.invalid", ["finance"]);
  await owner(db);
  await db.exec(`
    UPDATE cockpit_members SET clients=ARRAY['Acme','Liwan','Marble'] WHERE email='sara@tests.invalid';
    UPDATE cockpit_members SET clients=ARRAY['Beta Co'] WHERE email='omar@tests.invalid';`);
  return db;
}

async function fixture(): Promise<{ db: Db; today: string }> {
  const db = await base();
  await db.exec(SIBLING_STUBS);
  await db.exec(moneyActs());
  const today = await todayOf(db);
  await db.exec(`
    INSERT INTO cockpit_billing_accounts(clickup_task_id,client_name,stage,stage_group,client_status,payment_method,payment_plan,
        next_payment_usd,next_payment_date,mrr_usd,synced_at)
      VALUES('task_a','Acme','Active','active','Active','Bank transfer','Monthly',1500,'${addDays(today, 10)}',1500,now()),
            ('task_b','Beta Co','Active','active','Active',NULL,'Monthly',NULL,NULL,NULL,now());`);
  return { db, today };
}

async function todayOf(db: Db): Promise<string> {
  await owner(db);
  return String(
    (
      await db.query<{ d: string }>(
        "SELECT (now() AT TIME ZONE 'Asia/Kuwait')::date::text AS d",
      )
    ).rows[0].d,
  );
}

const addDays = (day: string, n: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000)
    .toISOString()
    .slice(0, 10);
const uuid = () => crypto.randomUUID();

async function rows<T = Record<string, unknown>>(
  db: Db,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  await owner(db);
  return (await db.query<T>(sql, params)).rows;
}

async function call<T = Record<string, unknown>>(
  db: Db,
  who: string | null,
  sql: string,
  params: unknown[] = [],
): Promise<T> {
  await actor(db, who);
  try {
    const r = await db.query<{ r: T }>(`SELECT ${sql} AS r`, params);
    return r.rows[0].r;
  } finally {
    await owner(db);
  }
}

async function refused(
  db: Db,
  who: string | null,
  sql: string,
  params: unknown[] = [],
): Promise<string> {
  try {
    await call(db, who, sql, params);
  } catch (e) {
    return (e as Error).message;
  }
  throw new Error(`Expected a refusal for ${sql}`);
}

const write = (db: Db, who: string, args: Record<string, unknown>) =>
  call<Record<string, unknown>>(
    db,
    who,
    "cockpit_billing_write('edit', $1::jsonb)",
    [JSON.stringify(args)],
  );
const writeRefused = (db: Db, who: string, args: Record<string, unknown>) =>
  refused(db, who, "cockpit_billing_write('edit', $1::jsonb)", [
    JSON.stringify(args),
  ]);

async function addCall(
  db: Db,
  task: string,
  daysAgo: number,
  source = "fathom",
): Promise<string> {
  const r = await rows<{ id: string }>(
    db,
    `INSERT INTO cockpit_csm_calls(source,source_id,task_id,client_name,kind,starts_at,status)
     VALUES($1,$2,$3,'Acme','checkin',now() - make_interval(days => $4),'held') RETURNING id::text`,
    [source, uuid(), task, daysAgo],
  );
  return r[0].id;
}

const extensionArgs = (callId: string, over: Record<string, unknown> = {}) => ({
  taskId: "task_a",
  requestId: uuid(),
  kind: "extension",
  weeks: 2,
  reason: "Ad account broke on their side",
  ours: false,
  limitations: ["Ad account or page issue"],
  atRisk: true,
  callId,
  prevent: "Check the ad account a week before launch",
  ...over,
});

// ---------------------------------------------------------------------------

test("the file applies twice, guards the bodies it replaces and needs l, m and n", async () => {
  const db = await base();
  try {
    // Without the three files it stands on, it stops before changing anything.
    await expect(db.exec(moneyActs())).rejects.toThrow(
      "Apply 20261101l, 20261101m and 20261101n before 20261101p.",
    );
    await db.exec("ROLLBACK");
    await db.exec(SIBLING_STUBS);
    // The live bodies the contract read are the ones in this fixture.
    const live = await rows<{ fn: string; m: string }>(
      db,
      `SELECT p.proname AS fn, md5(regexp_replace(p.prosrc, '\\s+', ' ', 'g')) AS m FROM pg_proc p
        WHERE p.proname IN ('cockpit_billing_write','cockpit_settings_forms_audit') ORDER BY 1`,
    );
    expect(live).toEqual([
      { fn: "cockpit_billing_write", m: "8d499d5faa361ea51b86905e3ff0998c" },
      {
        fn: "cockpit_settings_forms_audit",
        m: "ae654764bf7e86bd914d9df4cbbd089c",
      },
    ]);
    await db.exec(moneyActs());
    await db.exec(moneyActs());
    // The "after" values written into the file are this file's own bodies.
    const after = await rows<{ fn: string; m: string }>(
      db,
      `SELECT p.proname AS fn, md5(regexp_replace(p.prosrc, '\\s+', ' ', 'g')) AS m FROM pg_proc p
        WHERE p.proname IN ('cockpit_billing_write','cockpit_settings_forms_audit') ORDER BY 1`,
    );
    const text = migration(FILE);
    for (const a of after) expect(text).toContain(`'${a.m}'`);
    // A changed body stops the file.
    await db.exec(
      "CREATE OR REPLACE FUNCTION public.cockpit_settings_forms_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NULL; END $$;",
    );
    await expect(db.exec(moneyActs())).rejects.toThrow(
      "cockpit_settings_forms_audit() changed since the waves 1-2 contract read it",
    );
    await db.exec("ROLLBACK");
  } finally {
    await db.close();
  }
});

test("seeds the settings once, merges the money door and audits billing settings", async () => {
  const { db } = await fixture();
  try {
    await db.exec(
      "INSERT INTO cockpit_settings(key,value,updated_by) VALUES('forms.doors','{\"checks\":true}','migration 20261101n') ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value",
    );
    await db.exec(moneyActs());
    const s = await rows<{ key: string; value: unknown }>(
      db,
      "SELECT key, value FROM cockpit_settings WHERE key LIKE 'billing.%' OR key='forms.doors' ORDER BY key",
    );
    expect(s).toEqual([
      { key: "billing.daily", value: { on: false } },
      {
        key: "billing.ladder",
        value: { pauseReviewDay: 4, cancelReviewDay: 15 },
      },
      { key: "billing.mrr_tolerance", value: { pct: 10 } },
      { key: "forms.doors", value: { checks: true, money: true } },
    ]);
    const seeded = await rows<{ action: string }>(
      db,
      "SELECT action FROM cockpit_audit_log WHERE entity_id LIKE 'billing.%' ORDER BY id",
    );
    expect(seeded.map(r => r.action)).toEqual([
      "billing.setting_seeded",
      "billing.setting_seeded",
      "billing.setting_seeded",
    ]);

    expect(
      await refused(db, CSM, "cockpit_billing_ladder_set($1::jsonb)", [
        '{"pauseReviewDay":3,"cancelReviewDay":10}',
      ]),
    ).toBe("Only the CEO or an admin changes the overdue steps.");
    expect(
      await refused(db, CEO, "cockpit_billing_ladder_set($1::jsonb)", [
        '{"pauseReviewDay":10,"cancelReviewDay":10}',
      ]),
    ).toBe("The cancel review comes after the pause review.");
    expect(
      await refused(db, CEO, "cockpit_billing_ladder_set($1::jsonb)", [
        '{"pauseReviewDay":3,"cancelReviewDay":61}',
      ]),
    ).toBe("The cancel review is on day 60 or earlier.");
    const saved = await call<Record<string, unknown>>(
      db,
      CEO,
      "cockpit_billing_ladder_set($1::jsonb)",
      ['{"pauseReviewDay":3,"cancelReviewDay":10}'],
    );
    expect(saved).toMatchObject({
      pauseReviewDay: 3,
      cancelReviewDay: 10,
      saved: true,
    });
    const audit = await rows<{ action: string; actor_email: string }>(
      db,
      "SELECT action, actor_email FROM cockpit_audit_log WHERE entity_id='billing.ladder' AND action <> 'billing.setting_seeded'",
    );
    expect(audit).toEqual([
      { action: "billing.setting_set", actor_email: "aziz@maharamedia.com" },
    ]);
    const read = await call<Record<string, unknown>>(
      db,
      CSM,
      "cockpit_billing_ladder_read()",
    );
    expect(read).toMatchObject({
      pauseReviewDay: 3,
      cancelReviewDay: 10,
      canEdit: false,
      sentence:
        "The ladder: a pause review on day 3 and a cancel review on day 10. Neither changes the card by itself.",
    });
    expect(await refused(db, null, "cockpit_billing_ladder_read()")).toContain(
      "permission denied",
    );
  } finally {
    await db.close();
  }
});

test("Give more time: the fields, the date that always moves, one request, one event", async () => {
  const { db, today } = await fixture();
  try {
    const callId = await addCall(db, "task_a", 3);
    const args = extensionArgs(callId);
    // Every new key is checked on the server, in the form's words.
    expect(await writeRefused(db, CSM, { ...args, requestId: undefined })).toBe(
      "That form is out of date. Reload the page and send it again.",
    );
    expect(await writeRefused(db, CSM, { ...args, ours: undefined })).toBe(
      "Say whether the delay was in or out of our control.",
    );
    expect(await writeRefused(db, CSM, { ...args, atRisk: undefined })).toBe(
      "Say whether they will stop if billed on schedule.",
    );
    expect(await writeRefused(db, CSM, { ...args, callId: undefined })).toBe(
      "Pick the call where this was agreed, or say why there was no call.",
    );
    expect(await writeRefused(db, CSM, { ...args, callId: "999999" })).toBe(
      "That call is not on this client's record. Pick one from the list.",
    );
    expect(
      await writeRefused(db, CSM, {
        ...args,
        limitations: ["No limitations", "Budget"],
      }),
    ).toBe('"No limitations" cannot be picked with another limit.');
    expect(await writeRefused(db, CSM, { ...args, weeks: 3 })).toBe(
      "An extension is one, two or four weeks.",
    );
    expect(await writeRefused(db, OTHER_CSM, args)).toBe(
      "Acme is not one of your clients in the portal, so its billing is not yours to change.",
    );

    // moveDate is not sent and the date still moves: from the card's date (in the future) + 2 weeks.
    const out = await write(db, CSM, args);
    expect(out).toMatchObject({
      next_payment_date: addDays(today, 24),
      extension_weeks: 2,
      newDate: addDays(today, 24),
      cardState: "queued",
    });
    expect(String(out.message)).toMatch(
      /^Given: 2 weeks to \d{1,2} [A-Z][a-z]{2}$/,
    );

    const ev = await rows<{
      id: number;
      detail: Record<string, unknown>;
      source: string;
      from_value: string;
      to_value: string;
    }>(
      db,
      "SELECT id, detail, source, from_value, to_value FROM cockpit_billing_events WHERE kind='extension'",
    );
    expect(ev).toHaveLength(1);
    expect(ev[0].detail).toEqual({
      weeks: 2,
      ours: false,
      movedDate: true,
      new_date: addDays(today, 24),
      from: addDays(today, 10),
      limitations: ["Ad account or page issue"],
      at_risk: true,
      call_id: callId,
      prevent: "Check the ad account a week before launch",
      request_id: args.requestId,
      seat_role: "the CSM",
      response_id: out.responseId,
    });
    // The response row and the event share the request id.
    const resp = await rows<{
      external_id: string;
      answers: Record<string, unknown>;
      form_key: string;
    }>(
      db,
      "SELECT external_id, answers, form_key FROM cockpit_form_responses WHERE id=$1",
      [out.responseId],
    );
    expect(resp[0]).toMatchObject({
      form_key: "extension",
      external_id: `req:${args.requestId}`,
    });
    expect(resp[0].answers).toMatchObject({ weeks: 2, atRisk: true, callId });

    // A repeat (a double press) returns the first result and writes nothing.
    const again = await write(db, CSM, args);
    expect(again).toMatchObject({
      repeat: true,
      eventId: ev[0].id,
      responseId: out.responseId,
    });
    expect(
      (
        await rows(
          db,
          "SELECT 1 FROM cockpit_billing_events WHERE kind='extension'",
        )
      ).length,
    ).toBe(1);
    expect(
      (
        await rows(
          db,
          "SELECT 1 FROM cockpit_form_responses WHERE form_key='extension'",
        )
      ).length,
    ).toBe(1);

    // The notice: names and dates only, once per event.
    const notices = await rows<{
      kind: string;
      dedupe_key: string;
      facts: Record<string, unknown>;
    }>(db, "SELECT kind, dedupe_key, facts FROM cockpit_slack_notices");
    expect(notices).toEqual([
      {
        kind: "extension.granted",
        dedupe_key: `extension:${ev[0].id}`,
        facts: {
          weeks: 2,
          until: addDays(today, 24),
          taskId: "task_a",
          client: "Acme",
          eventId: ev[0].id,
        },
      },
    ]);
    // An audit row with the event and the request.
    const audit = await rows<{ metadata: Record<string, unknown> }>(
      db,
      "SELECT metadata FROM cockpit_audit_log WHERE action='billing.extension'",
    );
    expect(audit[0].metadata).toMatchObject({
      event_id: ev[0].id,
      request_id: args.requestId,
      response_id: out.responseId,
    });
  } finally {
    await db.close();
  }
});

test("a card whose date has passed: the new date runs from today; no call needs a reason", async () => {
  const { db, today } = await fixture();
  try {
    await db.exec(
      `UPDATE cockpit_billing_accounts SET next_payment_date='${addDays(today, -6)}' WHERE clickup_task_id='task_a'`,
    );
    expect(
      await writeRefused(
        db,
        CSM,
        extensionArgs("", {
          callId: undefined,
          noCall: true,
          noCallReason: "no",
        }),
      ),
    ).toBe(
      "Pick the call where this was agreed, or say why there was no call.",
    );
    const out = await write(
      db,
      CEO,
      extensionArgs("", {
        callId: undefined,
        noCall: true,
        noCallReason: "Client was travelling",
        weeks: 1,
        source: "ceo",
      }),
    );
    expect(out.next_payment_date).toBe(addDays(today, 7));
    const d = (
      await rows<{ detail: Record<string, unknown> }>(
        db,
        "SELECT detail FROM cockpit_billing_events WHERE kind='extension'",
      )
    )[0].detail;
    expect(d).toMatchObject({
      from: today,
      new_date: addDays(today, 7),
      no_call_reason: "Client was travelling",
      seat_role: "the CEO",
    });
    expect(d.call_id).toBeUndefined();
  } finally {
    await db.close();
  }
});

test("one live grant per card: a second one replaces it, from the live grant's date", async () => {
  const { db, today } = await fixture();
  try {
    const callId = await addCall(db, "task_a", 2);
    const first = await write(db, CSM, extensionArgs(callId));
    const firstId = Number(first.eventId);
    expect(
      await writeRefused(db, CSM, extensionArgs(callId, { weeks: 1 })),
    ).toMatch(
      /^An extension already runs to \d{1,2} [A-Z][a-z]{2}\. Open Give more time again to add weeks to it\.$/,
    );
    expect(
      await writeRefused(
        db,
        CSM,
        extensionArgs(callId, { weeks: 1, replacesGrantId: firstId + 99 }),
      ),
    ).toBe(
      "That extension has ended or changed since the form opened. Close it and open Give more time again.",
    );
    const second = await write(
      db,
      CSM,
      extensionArgs(callId, { weeks: 1, replacesGrantId: firstId }),
    );
    // From the card's date as the live grant moved it.
    expect(second.next_payment_date).toBe(addDays(today, 24 + 7));
    const v = await rows<{
      grant_id: number;
      state: string;
      replaced_by: number | null;
      replaces_grant_id: number | null;
      until: string;
    }>(
      db,
      "SELECT grant_id, state, replaced_by, replaces_grant_id, until::text FROM cockpit_extensions_v ORDER BY grant_id",
    );
    expect(v).toEqual([
      {
        grant_id: firstId,
        state: "replaced",
        replaced_by: Number(second.eventId),
        replaces_grant_id: null,
        until: addDays(today, 24),
      },
      {
        grant_id: Number(second.eventId),
        state: "live",
        replaced_by: null,
        replaces_grant_id: firstId,
        until: addDays(today, 31),
      },
    ]);

    // Clear on end: only the newest grant, once, and only while billing.daily is on.
    expect(await call(db, null, "1")).toBe(1);
    await owner(db);
    expect(
      (await db.query<{ r: unknown }>("SELECT cockpit_billing_daily() AS r"))
        .rows[0].r,
    ).toEqual({ ran: false, why: "billing.daily is off" });
    const off = await rows<{ ok: boolean; note: string }>(
      db,
      "SELECT ok, note FROM cockpit_sync_state WHERE key='billing-daily'",
    );
    expect(off[0]).toEqual({
      ok: true,
      note: "Off: billing.daily is off, so no extension was cleared and no late record was written.",
    });
    await db.exec(
      `UPDATE cockpit_settings SET value='{"on":true}', updated_by='test' WHERE key='billing.daily'`,
    );
    const later = addDays(today, 32);
    const run = (
      await db.query<{ r: Record<string, unknown> }>(
        "SELECT cockpit_billing_daily_run($1::date) AS r",
        [later],
      )
    ).rows[0].r;
    expect(run).toMatchObject({ ran: true, cleared: 1 });
    const clears = await rows<{
      detail: Record<string, unknown>;
      source: string;
      by_whom: string;
    }>(
      db,
      "SELECT detail, source, by_whom FROM cockpit_billing_events WHERE kind='extension' AND source='system'",
    );
    expect(clears).toEqual([
      {
        detail: {
          weeks: 0,
          reason: "grant ended",
          grant_id: Number(second.eventId),
          until: addDays(today, 31),
          seat_role: "the cockpit",
        },
        source: "system",
        by_whom: "the cockpit",
      },
    ]);
    expect(
      (
        await rows<{ w: string }>(
          db,
          "SELECT extension_weeks::text AS w FROM cockpit_billing_accounts WHERE clickup_task_id='task_a'",
        )
      )[0].w,
    ).toBe("0");
    // The system clear queues the card write (m's trigger list).
    expect(
      (
        await rows(
          db,
          "SELECT 1 FROM cockpit_clickup_writeback_queue q JOIN cockpit_billing_events e ON q.dedupe_key='billing:'||e.id WHERE e.source='system'",
        )
      ).length,
    ).toBe(1);
    // A second run that day finds nothing to do.
    const twice = (
      await db.query<{ r: Record<string, unknown> }>(
        "SELECT cockpit_billing_daily_run($1::date) AS r",
        [later],
      )
    ).rows[0].r;
    expect(twice).toMatchObject({
      ran: true,
      cleared: 0,
      lateOpened: 0,
      lateClosed: 0,
    });
    expect(
      (
        await rows<{ c: number }>(
          db,
          "SELECT count(*)::int AS c FROM cockpit_extensions_v WHERE cleared_at IS NOT NULL",
        )
      )[0].c,
    ).toBe(1);
  } finally {
    await db.close();
  }
});

test("cockpit_extensions_v on the live 10-19 grants: Liwan and Marble, then Liwan after a void", async () => {
  const { db, today } = await fixture();
  try {
    await db.exec(`
      INSERT INTO cockpit_billing_events(id,clickup_task_id,client_name,kind,from_value,to_value,reason,detail,source,by_whom,at) OVERRIDING SYSTEM VALUE VALUES
        (114,'86eymcqdq','Marble and more','extension','2026-10-19','2026-11-02','Issue with the ad account and had to be fixed','{"movedDate": true, "ours": true, "weeks": 2}','csm','csm@tests.invalid','2026-10-19 15:49:49+03'),
        (115,'86ewvnqj5','Liwan Limited Construction and Finishing Of Buildings','extension','2026-10-15','2026-11-02','Ad account broke','{"movedDate": true, "ours": true, "weeks": 2}','csm','csm@tests.invalid','2026-10-19 15:50:07+03'),
        (247,'86ewvnqj5','Liwan Limited Construction and Finishing Of Buildings','date','2026-11-02','2026-11-02','Aziz extension 19 Oct',NULL,'maher','maher','2026-10-29 09:16:05+03'),
        (245,'86eypmbp3','Alkhalil','pause','Active','Paused','cancelled','{"on": "2026-10-27"}','csm','csm@tests.invalid','2026-10-27 18:10:59+03');
      SELECT setval(pg_get_serial_sequence('public.cockpit_billing_events','id'), 1000);`);
    const state = today <= "2026-11-02" ? "live" : "ended";
    const v = await rows(
      db,
      "SELECT grant_id, clickup_task_id, granted_on::text, weeks, from_date::text, until::text, ours, at_risk, state, seat_role FROM cockpit_extensions_v ORDER BY grant_id",
    );
    expect(v).toEqual([
      {
        grant_id: 114,
        clickup_task_id: "86eymcqdq",
        granted_on: "2026-10-19",
        weeks: 2,
        from_date: "2026-10-19",
        until: "2026-11-02",
        ours: true,
        at_risk: null,
        state,
        seat_role: "the CSM",
      },
      {
        grant_id: 115,
        clickup_task_id: "86ewvnqj5",
        granted_on: "2026-10-19",
        weeks: 2,
        from_date: "2026-10-15",
        until: "2026-11-02",
        ours: true,
        at_risk: null,
        state,
        seat_role: "the CSM",
      },
    ]);
    await db.exec(
      "INSERT INTO cockpit_billing_event_voids(event_id,reason,voided_by) VALUES(114,'Churned; voided on the CEO''s default (Q3)','the CEO''s default (Q3)')",
    );
    expect(
      (
        await rows<{ t: string }>(
          db,
          "SELECT clickup_task_id AS t FROM cockpit_extensions_v",
        )
      ).map(r => r.t),
    ).toEqual(["86ewvnqj5"]);
    // The browser reads it through the gate: a CSM sees their own clients only.
    await db.exec(
      "UPDATE cockpit_members SET clients=ARRAY['Liwan Limited Construction and Finishing Of Buildings'] WHERE email='sara@tests.invalid'",
    );
    const read = await call<{ rows: Record<string, unknown>[]; note: string }>(
      db,
      CSM,
      "cockpit_extensions_read('2026-10-01','2026-10-31')",
    );
    expect(read.rows.map(r => r.taskId)).toEqual(["86ewvnqj5"]);
    expect(read.note).toContain(
      "The two Typeform answers of 14 Sep were tests",
    );
    expect(
      (
        await call<{ rows: unknown[] }>(
          db,
          OTHER_CSM,
          "cockpit_extensions_read(NULL,NULL)",
        )
      ).rows,
    ).toEqual([]);
    expect(
      (
        await call<{ rows: unknown[] }>(
          db,
          FINANCE,
          "cockpit_extensions_read(NULL,NULL)",
        )
      ).rows,
    ).toHaveLength(1);
    expect(
      await refused(
        db,
        CSM,
        "cockpit_extensions_read('2026-01-01','2027-06-01')",
      ),
    ).toBe("Pick a window of up to 400 days, from before to.");
    // The views are the service role's only.
    expect(
      await refused(db, CSM, "(SELECT count(*) FROM cockpit_extensions_v)"),
    ).toContain("permission denied");
  } finally {
    await db.close();
  }
});

test("pause: a client request needs the call and both consents; Resume On is carried; resume clears both dates", async () => {
  const { db, today } = await fixture();
  try {
    const callId = await addCall(db, "task_a", 1);
    const pause = (over: Record<string, unknown> = {}) => ({
      taskId: "task_a",
      requestId: uuid(),
      kind: "pause",
      pauseKind: "client_request",
      restart: addDays(today, 20),
      reasonCat: "Client asked",
      reason: "Owner travelling for the season",
      callId,
      consent: { kind: "call", term_runs: true, over_14_ends: true },
      ...over,
    });
    expect(await writeRefused(db, CSM, pause({ callId: undefined }))).toBe(
      "Pick the call where the client asked to pause.",
    );
    expect(
      await writeRefused(
        db,
        CSM,
        pause({ consent: { kind: "call", term_runs: true } }),
      ),
    ).toBe("Tick both consents the client gave on the call.");
    expect(await writeRefused(db, CSM, pause({ consent: undefined }))).toBe(
      "Tick both consents the client gave on the call.",
    );
    expect(await writeRefused(db, CSM, pause({ restart: today }))).toBe(
      "Pick the restart day, after today.",
    );
    expect(await writeRefused(db, CSM, pause({ restart: undefined }))).toBe(
      "Pick the restart day, after today.",
    );
    expect(await writeRefused(db, CSM, pause({ reasonCat: "Bored" }))).toBe(
      "Pick why they pause.",
    );
    expect(await writeRefused(db, CSM, pause({ pauseKind: "holiday" }))).toBe(
      "Say whether the client asked or is not paying.",
    );

    // The two ticks may come as the form's own keys too.
    const out = await write(
      db,
      CSM,
      pause({ consent: undefined, consentTerm: true, consentOver14: true }),
    );
    expect(out).toMatchObject({
      client_status: "Paused",
      paused_on: today,
      cardState: "queued",
    });
    const ev = (
      await rows<{
        detail: Record<string, unknown>;
        from_value: string;
        to_value: string;
      }>(
        db,
        "SELECT detail, from_value, to_value FROM cockpit_billing_events WHERE kind='pause'",
      )
    )[0];
    expect(ev.detail).toMatchObject({
      pause_kind: "client_request",
      on: today,
      restart: addDays(today, 20),
      reason_cat: "client_asked",
      call_id: callId,
      consent: {
        kind: "call",
        call_id: callId,
        term_runs: true,
        over_14_ends: true,
      },
      seat_role: "the CSM",
    });
    expect([ev.from_value, ev.to_value]).toEqual(["Active", "Paused"]);
    expect(await writeRefused(db, CSM, pause())).toBe(
      "This client is already paused. Resume them first.",
    );
    expect(
      (
        await rows<{ kind: string }>(
          db,
          "SELECT kind FROM cockpit_slack_notices",
        )
      ).map(r => r.kind),
    ).toEqual(["pause.agreed"]);

    // Resume: Active, Paused On cleared, the next date when given.
    const resumed = await write(db, CSM, {
      taskId: "task_a",
      requestId: uuid(),
      kind: "resume",
      on: today,
      nextDate: addDays(today, 30),
    });
    expect(resumed).toMatchObject({
      client_status: "Active",
      paused_on: null,
      next_payment_date: addDays(today, 30),
    });
    const rev = (
      await rows<{ detail: Record<string, unknown> }>(
        db,
        "SELECT detail FROM cockpit_billing_events WHERE kind='resume'",
      )
    )[0];
    expect(rev.detail).toMatchObject({
      on: today,
      nextDate: addDays(today, 30),
      pause_days: 0,
    });
    expect(
      await writeRefused(db, CSM, {
        taskId: "task_a",
        requestId: uuid(),
        kind: "resume",
      }),
    ).toBe("This client is not paused, so there is nothing to resume.");

    // Non-payment: no call or consent needed; the pause starts today whatever "on" says.
    const np = await write(db, CEO, {
      taskId: "task_a",
      requestId: uuid(),
      kind: "pause",
      pauseKind: "non_payment",
      reasonCat: "not_paying",
      reason: "Day 5 late",
      on: addDays(today, 3),
      source: "ceo",
    });
    expect(np.paused_on).toBe(today);
    // No billing event of kind pause, churn or date was ever written by anyone but a person here.
    expect(
      (
        await rows(
          db,
          "SELECT 1 FROM cockpit_billing_events WHERE source='system'",
        )
      ).length,
    ).toBe(0);
  } finally {
    await db.close();
  }
});

test("pause after wave 3: a native pause consent form needs the client's signed consent", async () => {
  const { db, today } = await fixture();
  try {
    const callId = await addCall(db, "task_a", 1);
    await db.exec(
      "INSERT INTO cockpit_forms(key,title,audience,provider,schema,seats,client_scoped,effects,updated_by) VALUES('pause_consent','Pause consent','client','native','{}','{csm}',true,'[]','test')",
    );
    const args = {
      taskId: "task_a",
      requestId: uuid(),
      kind: "pause",
      pauseKind: "client_request",
      restart: addDays(today, 10),
      reasonCat: "client_asked",
      reason: "Owner travelling",
      callId,
      consent: { kind: "call", term_runs: true, over_14_ends: true },
    };
    expect(await writeRefused(db, CSM, args)).toBe(
      "The client has not signed the pause consent in the last 14 days. Send it from the client page first.",
    );
  } finally {
    await db.close();
  }
});

test("Set MRR: one writer, a reason to go down, and the downgrades this month", async () => {
  const { db, today } = await fixture();
  try {
    const mrr = (over: Record<string, unknown>) => ({
      taskId: "task_a",
      requestId: uuid(),
      kind: "mrr",
      reasonCat: "price_change",
      ...over,
    });
    expect(await writeRefused(db, CSM, mrr({ value: 0 }))).toBe(
      "Say why the MRR goes to zero.",
    );
    expect(await writeRefused(db, CSM, mrr({ value: 1200 }))).toBe(
      "Say why the MRR goes down, so the downgrade reads back.",
    );
    expect(await writeRefused(db, CSM, mrr({ value: 1500 }))).toBe(
      "The card already shows that MRR.",
    );
    expect(await writeRefused(db, CSM, mrr({ value: -1 }))).toBe(
      "Type the MRR in dollars, 0 or more.",
    );
    expect(
      await writeRefused(db, CSM, mrr({ value: 1800, reasonCat: "vibes" })),
    ).toBe("Pick why the MRR changes.");
    const up = await write(db, CSM, mrr({ value: 1800 }));
    expect(up).toMatchObject({ mrr_usd: 1800, message: "MRR set to $1,800" });
    const down = await write(
      db,
      CSM,
      mrr({
        value: 1000,
        reasonCat: "Downgrade",
        reason: "Dropped to one campaign",
      }),
    );
    expect(down.mrr_usd).toBe(1000);
    const ev = await rows<{
      from_value: string;
      to_value: string;
      detail: Record<string, unknown>;
    }>(
      db,
      "SELECT from_value, to_value, detail FROM cockpit_billing_events WHERE kind='mrr' ORDER BY id",
    );
    expect(ev.map(e => [e.from_value, e.to_value])).toEqual([
      ["1500", "1800"],
      ["1800", "1000"],
    ]);
    expect(ev[1].detail).toMatchObject({
      from: 1800,
      to: 1000,
      reason_cat: "downgrade",
      effective: today,
      seat_role: "the CSM",
    });

    const read = await call<Record<string, any>>(db, CEO, "cockpit_mrr_read()");
    expect(read.downgrades).toEqual([
      expect.objectContaining({
        taskId: "task_a",
        clientName: "Acme",
        fromUsd: 1800,
        toUsd: 1000,
        effective: today,
        reason: "Dropped to one campaign",
        seatRole: "the CSM",
      }),
    ]);
    expect(
      (await call<Record<string, any>>(db, OTHER_CSM, "cockpit_mrr_read()"))
        .downgrades,
    ).toEqual([]);
  } finally {
    await db.close();
  }
});

test("cockpit_mrr_read: suggestions, flags, totals and the stale rail sentence", async () => {
  const { db } = await fixture();
  try {
    // No monthly card holds an MRR: the total is missing, never $0.
    await db.exec("UPDATE cockpit_billing_accounts SET mrr_usd=NULL");
    const none = await call<Record<string, any>>(db, CEO, "cockpit_mrr_read()");
    expect(none.totals).toMatchObject({ onBooks: null, onBooksCards: 0, missing: 2 });
    expect(none.railNote).toBe("The money refresh has not run, so rail cash is not compared.");
    await db.exec(`
      UPDATE cockpit_billing_accounts SET mrr_usd=2000, next_payment_usd=2000 WHERE clickup_task_id='task_a';
      UPDATE cockpit_billing_accounts SET payment_plan='Monthly', next_payment_usd=1300 WHERE clickup_task_id='task_b';
      INSERT INTO cockpit_billing_accounts(clickup_task_id,client_name,stage,stage_group,client_status,payment_plan,next_payment_usd,mrr_usd,synced_at)
        VALUES('task_c','Cedar','Active','active','Active','Paid in full (90 days)',6000,2000,now()),
              ('task_d','Dune','Active','active','Active','Monthly',1000,1333,now()),
              ('task_e','Elm','Stopped','gone','Stopped','Monthly',1000,1000,now());
      INSERT INTO cockpit_sections(key,label,computed_at,payload,updated_at) VALUES('money','Money',now(),
        '{"mrrCheck":{"asOf":"2026-11-01","rows":[{"taskId":"task_a","railMonthlyUsd":1500,"months":2,"note":"Whop, two full months"}]}}', now());`);
    const r = await call<Record<string, any>>(db, CEO, "cockpit_mrr_read()");
    const by = Object.fromEntries((r.rows as any[]).map(x => [x.taskId, x]));
    expect(Object.keys(by).sort()).toEqual([
      "task_a",
      "task_b",
      "task_c",
      "task_d",
    ]);
    expect(by.task_b).toMatchObject({
      mrrUsd: null,
      suggestedUsd: 1300,
      flag: "missing",
    });
    expect(by.task_c).toMatchObject({
      flag: "not_recurring",
      suggestedUsd: null,
      suggestionWhy: "Not a monthly plan, so no suggestion.",
    });
    expect(by.task_d).toMatchObject({
      flag: "differs_suggestion",
      suggestedUsd: 1000,
    });
    expect(by.task_a).toMatchObject({
      flag: "differs_rail",
      railMonthlyUsd: 1500,
      railNote: "Whop, two full months",
    });
    expect(r.totals).toEqual({
      onBooks: 3333,
      onBooksCards: 2,
      suggested: 4300,
      noSuggestion: 1,
      missing: 1,
      differ: 2,
    });
    expect(r.tolerancePct).toBe(10);

    // An old money refresh: no rail cash compared, said in a sentence, never 0.
    await db.exec(
      "UPDATE cockpit_sections SET updated_at = now() - interval '37 hours' WHERE key='money'",
    );
    const stale = await call<Record<string, any>>(
      db,
      CEO,
      "cockpit_mrr_read()",
    );
    expect(stale.railNote).toBe(
      "The money refresh is older than a day and a half, so rail cash is not compared.",
    );
    const a = (stale.rows as any[]).find(x => x.taskId === "task_a");
    expect(a).toMatchObject({
      railMonthlyUsd: null,
      flag: "ok",
      railNote: stale.railNote,
    });
    expect(await refused(db, null, "cockpit_mrr_read()")).toContain(
      "permission denied",
    );
  } finally {
    await db.close();
  }
});

/** Daily snapshots for one card: [daysAgo, stage, next date offset from today, amount]. */
async function snapshots(
  db: Db,
  today: string,
  task: string,
  name: string,
  days: [number, string, number | null, number | null][],
) {
  for (const [ago, stage, due, usd] of days) {
    await db.query(
      `INSERT INTO cockpit_client_billing_days(day,clickup_task_id,client_name,stage,next_payment_date,next_payment_usd,captured_at)
       VALUES($1,$2,$3,$4,$5,$6,now())`,
      [
        addDays(today, -ago),
        task,
        name,
        stage,
        due === null ? null : addDays(today, due),
        usd,
      ],
    );
  }
}

test("late spells: one run across a missing day, how each closed, the checked payment, the ladder rows", async () => {
  const { db, today } = await fixture();
  try {
    await owner(db);
    await db.exec(`
      INSERT INTO cockpit_billing_accounts(clickup_task_id,client_name,stage,stage_group,client_status,payment_plan,next_payment_usd,next_payment_date,synced_at)
        VALUES('late4','Four Days','Active','active','Active','Monthly',2000,'${addDays(today, -4)}',now()),
              ('late15','Fifteen Days','Active','active','Active','Monthly',700,'${addDays(today, -15)}',now()),
              ('late3','Three Days','Active','active','Active','Monthly',900,'${addDays(today, -3)}',now()),
              ('stopped','Gone Co','Stopped','gone','Stopped','Monthly',500,'${addDays(today, -20)}',now()),
              ('paid','Paid Co','Active','active','Active','Monthly',1000,'${addDays(today, 25)}',now()),
              ('paused','Quiet Co','Paused','paused','Paused','Monthly',1000,'${addDays(today, -1)}',now());
      UPDATE cockpit_billing_accounts SET paused_on='${addDays(today, -14)}' WHERE clickup_task_id='paused';`);
    // Four days late, with today's snapshot and a missing day in the middle (the 2026-10-08 case).
    await snapshots(db, today, "late4", "Four Days", [
      [6, "Active", -4, 2000],
      [5, "Active", -4, 2000],
      [3, "Active", -4, 2000],
      [2, "Active", -4, 2000],
      [1, "Active", -4, 2000],
      [0, "Active", -4, 2000],
    ]);
    await snapshots(
      db,
      today,
      "late15",
      "Fifteen Days",
      Array.from(
        { length: 16 },
        (_, i) =>
          [15 - i, "Active", -15, null] as [number, string, number, null],
      ),
    );
    await snapshots(db, today, "late3", "Three Days", [
      [2, "Active", -3, 900],
      [1, "Active", -3, 900],
      [0, "Active", -3, 900],
    ]);
    // Stopped after 5 late days.
    await snapshots(db, today, "stopped", "Gone Co", [
      [20, "Active", -20, 500],
      [19, "Active", -20, 500],
      [15, "Active", -20, 500],
      [14, "Stopped", -20, 500],
      [0, "Stopped", -20, 500],
    ]);
    // Late 6 days, then paid (a checked rail payment) and the date moved.
    await snapshots(db, today, "paid", "Paid Co", [
      [12, "Active", -12, 1000],
      [8, "Active", -12, 1000],
      [6, "Active", -12, 1000],
      [5, "Active", 25, 1000],
      [0, "Active", 25, 1000],
    ]);
    await db.exec(`
      INSERT INTO cockpit_client_payments(payment_id,clickup_task_id,client_name,day,usd,rail,side,kind,active,checked)
        VALUES('p1','paid','Paid Co','${addDays(today, -7)}',1000,'whop','back_end','client',true,true),
              ('p0','paid','Paid Co','${addDays(today, -9)}',1000,'manual','back_end','client',true,false);`);

    const v = await rows(
      db,
      "SELECT clickup_task_id AS t, due_on::text, amount_usd::float AS usd, ended_on::text, closed_how, paid_on::text, days_late FROM cockpit_late_payments_v ORDER BY clickup_task_id",
    );
    expect(v).toEqual([
      {
        t: "late15",
        due_on: addDays(today, -15),
        usd: null,
        ended_on: null,
        closed_how: "open",
        paid_on: null,
        days_late: 15,
      },
      {
        t: "late3",
        due_on: addDays(today, -3),
        usd: 900,
        ended_on: null,
        closed_how: "open",
        paid_on: null,
        days_late: 3,
      },
      {
        t: "late4",
        due_on: addDays(today, -4),
        usd: 2000,
        ended_on: null,
        closed_how: "open",
        paid_on: null,
        days_late: 4,
      },
      {
        t: "paid",
        due_on: addDays(today, -12),
        usd: 1000,
        ended_on: addDays(today, -5),
        closed_how: "date_moved",
        paid_on: addDays(today, -7),
        days_late: 5,
      },
      {
        t: "stopped",
        due_on: addDays(today, -20),
        usd: 500,
        ended_on: addDays(today, -14),
        closed_how: "stopped",
        paid_on: null,
        days_late: 6,
      },
    ]);

    // The ladder on its defaults: a pause review on day 4, a cancel review on day 15, paused 14 days.
    const due = await call<Record<string, unknown>[]>(
      db,
      CEO,
      "cockpit_billing_ladder_due()",
    );
    expect(due.map(r => [r.taskId, r.step, r.daysLate])).toEqual([
      ["late15", "cancel_review", 15],
      ["late4", "pause_review", 4],
      ["paused", "pause_day14", null],
    ]);
    expect(due[2]).toMatchObject({
      pauseDays: 14,
      pausedOn: addDays(today, -14),
    });
    expect(
      await call<unknown[]>(db, OTHER_CSM, "cockpit_billing_ladder_due()"),
    ).toEqual([]);

    // The daily step opens a late record on the pause review day and never writes pause, churn or date.
    await db.exec(
      `UPDATE cockpit_settings SET value='{"on":true}', updated_by='test' WHERE key='billing.daily'`,
    );
    const run = (
      await db.query<{ r: Record<string, unknown> }>(
        "SELECT cockpit_billing_daily() AS r",
      )
    ).rows[0].r;
    expect(run).toMatchObject({ ran: true, lateOpened: 2, lateClosed: 0 });
    const opened = await rows<{ t: string; detail: Record<string, unknown> }>(
      db,
      "SELECT clickup_task_id AS t, detail FROM cockpit_billing_events WHERE kind='late' ORDER BY clickup_task_id",
    );
    expect(opened).toEqual([
      {
        t: "late15",
        detail: {
          due: addDays(today, -15),
          spell_day: 15,
          amount_usd: null,
          seat_role: "the cockpit",
        },
      },
      {
        t: "late4",
        detail: {
          due: addDays(today, -4),
          spell_day: 4,
          amount_usd: 2000,
          seat_role: "the cockpit",
        },
      },
    ]);
    expect(
      (
        await rows<{ id: number }>(
          db,
          "SELECT late_event_id AS id FROM cockpit_late_payments_v WHERE clickup_task_id='late4'",
        )
      )[0].id,
    ).toBeGreaterThan(0);
    // A live extension, given today in the log (the card still shows the old date: its write is held), takes
    // the card off the ladder and the client page's step, and stops the count on the grant's day.
    await db.exec(`INSERT INTO cockpit_billing_events(clickup_task_id,client_name,kind,from_value,to_value,reason,detail,source,by_whom)
      VALUES('late4','Four Days','extension','${addDays(today, -4)}','${addDays(today, 10)}','x','{"weeks":2,"movedDate":true}','maher','maher')`);
    expect(
      (
        await call<Record<string, unknown>[]>(
          db,
          CEO,
          "cockpit_billing_ladder_due()",
        )
      ).map(r => r.taskId),
    ).toEqual(["late15", "paused"]);
    expect(
      await rows(
        db,
        "SELECT closed_how, days_late FROM cockpit_late_payments_v WHERE clickup_task_id='late4'",
      ),
    ).toEqual([{ closed_how: "extended", days_late: 4 }]);
    // The card's run ends (the date moved): the next run closes the record, once.
    await snapshots(db, today, "late4", "Four Days", [
      [-1, "Active", 30, 2000],
    ]);
    const close = (
      await db.query<{ r: Record<string, unknown> }>(
        "SELECT cockpit_billing_daily_run($1::date) AS r",
        [addDays(today, 1)],
      )
    ).rows[0].r;
    // The same run, a day on, opens Three Days on its own day 4.
    expect(close).toMatchObject({ lateOpened: 1, lateClosed: 1 });
    const closed = await rows<{
      detail: Record<string, unknown>;
      reason: string;
    }>(
      db,
      "SELECT detail, reason FROM cockpit_billing_events WHERE kind='late' AND detail ? 'closes'",
    );
    expect(closed[0].detail).toMatchObject({
      due: addDays(today, -4),
      closed_how: "extended",
      days_late: 4,
    });
    expect(closed[0].reason).toMatch(
      /^Late 4 days: due \d{1,2} [A-Z][a-z]{2}, extension moved the date$/,
    );
    expect(
      (
        await db.query<{ r: Record<string, unknown> }>(
          "SELECT cockpit_billing_daily_run($1::date) AS r",
          [addDays(today, 1)],
        )
      ).rows[0].r,
    ).toMatchObject({
      lateOpened: 0,
      lateClosed: 0,
    });
    expect(
      (
        await rows(
          db,
          "SELECT 1 FROM cockpit_billing_events WHERE source='system' AND kind IN ('pause','churn','date')",
        )
      ).length,
    ).toBe(0);
    const ss = await rows<{ detail: Record<string, unknown> }>(
      db,
      "SELECT detail FROM cockpit_sync_state WHERE key='billing-daily'",
    );
    expect(ss[0].detail).toMatchObject({
      ran: true,
      cleared: 0,
      lateOpened: 0,
      lateClosed: 0,
    });

    // The browser's read, gated.
    await db.exec(
      "UPDATE cockpit_members SET clients=ARRAY['Paid Co'] WHERE email='sara@tests.invalid'",
    );
    const read = await call<{ rows: Record<string, unknown>[] }>(
      db,
      CSM,
      "cockpit_late_payments_read(NULL,NULL)",
    );
    expect(read.rows.map(r => r.taskId)).toEqual(["paid"]);
  } finally {
    await db.close();
  }
});

test("late spells follow the billing log: October's Liwan, Marble and Ardon (the card trailed the log)", async () => {
  const { db, today } = await fixture();
  try {
    await owner(db);
    // Today is 1 Nov in these days: Liwan due 15 Oct, Marble due 19 Oct, both given two weeks on 19 Oct in the log,
    // their cards moved only on 29 Oct; Ardon due 27 Oct and paid (checked) that day, its card moved on 29 Oct.
    await db.exec(`
      INSERT INTO cockpit_billing_accounts(clickup_task_id,client_name,stage,stage_group,client_status,payment_plan,next_payment_usd,next_payment_date,synced_at)
        VALUES('liwan','Liwan','Active','active','Active','Monthly',1333,'${addDays(today, 1)}',now()),
              ('marble','Marble','Active','active','Active','Monthly',2000,'${addDays(today, 1)}',now()),
              ('ardon','Ardon','Active','active','Active','Monthly',1500,'${addDays(today, 26)}',now());`);
    const run = (from: number, to: number, due: number): [number, string, number, number][] =>
      Array.from({ length: from - to + 1 }, (_, i) => [from - i, "Active", due, 1000]);
    await snapshots(db, today, "liwan", "Liwan", [...run(25, 4, -17), ...run(3, 0, 1)]);
    await snapshots(db, today, "marble", "Marble", [...run(20, 4, -13), ...run(3, 0, 1)]);
    await snapshots(db, today, "ardon", "Ardon", [...run(8, 4, -5), ...run(3, 0, 26)]);
    const at = (ago: number) => `(('${addDays(today, -ago)}')::date + time '15:50') AT TIME ZONE 'Asia/Kuwait'`;
    await db.exec(`
      INSERT INTO cockpit_billing_events(clickup_task_id,client_name,kind,from_value,to_value,reason,detail,source,by_whom,at)
        VALUES('liwan','Liwan','extension','${addDays(today, -17)}','${addDays(today, 1)}','Ad account broke','{"weeks":2,"movedDate":true,"ours":true}','csm','csm',${at(13)}),
              ('marble','Marble','extension','${addDays(today, -13)}','${addDays(today, 1)}','Ad account issue','{"weeks":2,"movedDate":true,"ours":true}','csm','csm',${at(13)});
      INSERT INTO cockpit_client_payments(payment_id,clickup_task_id,client_name,day,usd,rail,side,kind,active,checked)
        VALUES('manual:ardon','ardon','Ardon','${addDays(today, -5)}',1500,'manual','back_end','client',true,true);`);
    // Liwan was late four days, then extended; Marble was extended on its due day and Ardon paid on it: never late.
    expect(
      await rows(
        db,
        "SELECT clickup_task_id AS t, due_on::text, ended_on::text, closed_how, paid_on::text, days_late FROM cockpit_late_payments_v ORDER BY 1",
      ),
    ).toEqual([
      { t: "liwan", due_on: addDays(today, -17), ended_on: addDays(today, -3), closed_how: "extended", paid_on: null, days_late: 4 },
    ]);
    // A void takes the grant back: Liwan's run reads as the date moving, and its days run to the card's move.
    await db.exec(`INSERT INTO cockpit_billing_event_voids(event_id, reason, voided_by)
      SELECT id, 'test void', 'test' FROM cockpit_billing_events WHERE clickup_task_id='liwan' AND kind='extension'`);
    expect(
      await rows(db, "SELECT closed_how, days_late FROM cockpit_late_payments_v WHERE clickup_task_id='liwan'"),
    ).toEqual([{ closed_how: "date_moved", days_late: 14 }]);
  } finally {
    await db.close();
  }
});

test("cockpit_form_prefill: the gate, each value's source, NULL with a sentence, 30 days of calls", async () => {
  const { db, today } = await fixture();
  try {
    const recent = await addCall(db, "task_a", 2);
    await addCall(db, "task_a", 31);
    await addCall(db, "task_b", 1);
    await db.exec(`INSERT INTO cockpit_form_responses(form_key,form_version,source,task_id,client_name,mode,state,answers,created_by,submitted_at)
      VALUES('checkin',1,'import','task_a','Acme','live','submitted','{"notes":"Client asked about an extension for Ramadan"}','import',now() - interval '1 day')`);

    expect(
      await refused(
        db,
        OTHER_CSM,
        "cockpit_form_prefill('extension','task_a')",
      ),
    ).toBe("Acme is not one of your clients in the portal.");
    expect(
      await refused(db, null, "cockpit_form_prefill('extension','task_a')"),
    ).toContain("permission denied");
    expect(
      await refused(db, CSM, "cockpit_form_prefill('kickoff','task_a')"),
    ).toBe("That is not one of the staff forms.");

    const p = await call<Record<string, any>>(
      db,
      CSM,
      "cockpit_form_prefill('extension','task_a')",
    );
    expect(p.calls).toHaveLength(2);
    expect(p.calls[0]).toMatchObject({ kind: "checkin" });
    expect(p.calls[0].source).toMatch(/^the 1-1 notes, \d{1,2} [A-Z][a-z]{2}$/);
    expect(p.calls[1]).toMatchObject({ id: recent });
    expect(p.calls[1].source).toMatch(/^Fathom, \d{1,2} [A-Z][a-z]{2}$/);
    expect(p.hints).toEqual([
      {
        text: "The last 1-1 notes mention an extension",
        source: expect.stringMatching(/^the 1-1 notes, /),
      },
    ]);
    expect(p.card.nextDate).toEqual({
      value: addDays(today, 10),
      source: "the ClickUp card",
    });
    expect(p.grant).toBeNull();

    const m = await call<Record<string, any>>(
      db,
      FINANCE,
      "cockpit_form_prefill('mrr','task_b')",
    );
    expect(m.values).toEqual([
      { key: "mrrUsd", value: null, source: "The card has no MRR yet." },
      { key: "effective", value: today, source: "today" },
    ]);
    const c = await call<Record<string, any>>(
      db,
      CEO,
      "cockpit_form_prefill('churn_confirm','task_a')",
    );
    const byKey = Object.fromEntries((c.values as any[]).map(v => [v.key, v]));
    expect(byKey.mrrLostUsd).toEqual({
      key: "mrrLostUsd",
      value: 1500,
      source: "the ClickUp card",
    });
    expect(byKey.noticeOn).toEqual({
      key: "noticeOn",
      value: null,
      source: "No termination survey from this client.",
    });
    expect(byKey.churnType.value).toBeNull();
    expect(c.churnTypeDefault).toBeNull();
    // No value is ever a made-up zero.
    for (const v of c.values as any[])
      if (v.value === null) expect(String(v.source).length).toBeGreaterThan(10);

    // A live grant reaches the form, so the second grant replaces it.
    await write(db, CSM, extensionArgs(recent));
    const after = await call<Record<string, any>>(
      db,
      CSM,
      "cockpit_form_prefill('extension','task_a')",
    );
    expect(after.grant).toMatchObject({
      weeks: 2,
      until: addDays(today, 24),
      seatRole: "the CSM",
    });

    // Resume: the old date plus the paused days.
    await db.exec(
      `UPDATE cockpit_billing_accounts SET client_status='Paused', paused_on='${addDays(today, -5)}' WHERE clickup_task_id='task_b'`,
    );
    await db.exec(
      `UPDATE cockpit_billing_accounts SET next_payment_date='${addDays(today, 3)}' WHERE clickup_task_id='task_b'`,
    );
    const r = await call<Record<string, any>>(
      db,
      CEO,
      "cockpit_form_prefill('resume','task_b')",
    );
    expect(r.values[1]).toMatchObject({
      key: "nextDate",
      value: addDays(today, 8),
    });
    expect(r.values[1].source).toMatch(
      /^the ClickUp card: its date \d{1,2} [A-Z][a-z]{2} plus 5 paused days$/,
    );
  } finally {
    await db.close();
  }
});

test("grants: the browser runs only the gated functions; the daily step is the service role's", async () => {
  const { db } = await fixture();
  try {
    const acl = await rows<{ fn: string; acl: string | null }>(
      db,
      `SELECT p.proname AS fn, p.proacl::text AS acl FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname IN ('cockpit_billing_write','cockpit_extensions_read','cockpit_late_payments_read',
          'cockpit_billing_ladder_read','cockpit_billing_ladder_set','cockpit_billing_ladder_due','cockpit_mrr_read','cockpit_form_prefill',
          'cockpit_billing_daily','cockpit_billing_daily_run','cockpit_billing_notice','cockpit_billing_seat_role','cockpit_billing_iso_day') ORDER BY 1`,
    );
    const grantees = (a: string | null) =>
      (a ?? "")
        .replace(/[{}]/g, "")
        .split(",")
        .map(x => x.split("=")[0])
        .filter(x => x && x !== "postgres")
        .sort();
    const map = Object.fromEntries(acl.map(r => [r.fn, grantees(r.acl)]));
    for (const fn of [
      "cockpit_billing_write",
      "cockpit_extensions_read",
      "cockpit_late_payments_read",
      "cockpit_billing_ladder_read",
      "cockpit_billing_ladder_set",
      "cockpit_billing_ladder_due",
      "cockpit_mrr_read",
      "cockpit_form_prefill",
    ])
      expect(map[fn]).toEqual(["authenticated"]);
    expect(map.cockpit_billing_daily).toEqual(["service_role"]);
    expect(map.cockpit_billing_daily_run).toEqual([]);
    expect(map.cockpit_billing_iso_day).toEqual(["service_role"]);
    expect(map.cockpit_billing_notice).toEqual([]);
    expect(map.cockpit_billing_seat_role).toEqual([]);
    expect(await refused(db, CEO, "cockpit_billing_daily()")).toContain(
      "permission denied",
    );
    // The service role reads both views (the readers slice does, with the service key).
    await db.exec("SET ROLE service_role");
    await db.query("SELECT count(*) FROM cockpit_extensions_v");
    await db.query("SELECT count(*) FROM cockpit_late_payments_v");
    await owner(db);
  } finally {
    await db.close();
  }
});
