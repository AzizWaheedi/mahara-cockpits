/**
 * The churn confirm (20261101o_churn_confirm.sql; docs/forms/WAVE12-CONTRACT.md
 * 2.6, 3.1, 3.2, 3.5, 4.5 and section 8's churn-confirm row) on an isolated
 * PostgreSQL with Supabase's default privileges on, so a missing REVOKE opens
 * a function here as it would in production.
 *
 * It stands on the canonical billing base (20260923a, 20261009a without its
 * schedule, 20261009h, the writeback queue of 20261009f and 20261009j, as
 * billing-native-sync-supabase.test.ts stands on them), the client success
 * read models and the churn register (20260926m, 20260927v, 20261001a,
 * 20261004a, as csm-growth-supabase.test.ts stands on them), and cuts of the
 * notice queue (20261025n) and the forms tables (20261027f).
 *
 * 20261101l (forms-foundation) and 20261101m (billing-rails) are built beside
 * this slice. When their files are in the tree, the objects `o` calls are cut
 * from them (the staff-form record, the derived notice rows, the one detail
 * builder, the card's churn reason and the churn writes); until then this test
 * stands in for each with the shape the contract gives it (3.1, 3.3), so the
 * test runs green on the slice's own branch and on the merged branch alike.
 *
 * Every person, client and value is invented; the CEO's address is read from
 * the CEO gate migration, never written here.
 */
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  setDefaultTimeout,
  test,
} from "bun:test";
import { existsSync } from "node:fs";
import type { PGlite } from "@electric-sql/pglite";
import {
  churnView,
  confirmSummary,
  departureState,
} from "../src/pages/ceo/churnRegister";
import { actor, cockpitTestDb, member, migration } from "./lib/cockpitTestDb";

setDefaultTimeout(180_000);

const O = "20261101o_churn_confirm.sql";
/** The file inside a test's own transaction: its BEGIN and COMMIT would end that transaction. */
const inTx = (file: string) =>
  migration(file)
    .replace(/^BEGIN;$/m, "")
    .replace(/^COMMIT;$/m, "");
const L = "20261101l_forms_stage3_base.sql";
const M = "20261101m_billing_rails.sql";
const has = (file: string) =>
  existsSync(new URL(`../../../supabase/migrations/${file}`, import.meta.url));

const CEO_EMAIL = (() => {
  const hit = migration("20260923m_cockpit_ceo_gate.sql").match(
    /IN \(\s*'([^']+@[^']+)'/,
  );
  if (!hit) throw new Error("The CEO gate names no address");
  return hit[1];
})();

const CEO = "00000000-0000-4000-8000-0000000000c1";
const CSM = "00000000-0000-4000-8000-0000000000c2";
const OTHER_CSM = "00000000-0000-4000-8000-0000000000c3";
const FINANCE = "00000000-0000-4000-8000-0000000000c4";
const CSM_EMAIL = "csm@tests.invalid";

const LIVE_READ_MD5 = "b008dbe49a35e451bd8979424b5fcdb3";
const LIVE_GUARD_MD5 = "168ce29dc03c2867603af6a488da2790";
/** 20261101l's guard (its drift guard's after value): o stands on its 'answer' carve-out. */
const L_GUARD_MD5 = "e05e4baa2c0059d9fd04a98684963bbb";

let db: PGlite;
type Row = Record<string, any>;

// --- Cutting canonical SQL --------------------------------------------------------------

function cut(file: string, pattern: RegExp, what: string): string {
  const hit = migration(file).match(pattern);
  if (!hit) throw new Error(`Canonical definition missing in ${file}: ${what}`);
  return hit[0];
}

/** One whole CREATE [OR REPLACE] FUNCTION public.<name>(...) statement, whatever its dollar tag. */
function fnFrom(sql: string, name: string): string | null {
  const start = sql.search(
    new RegExp(`CREATE (?:OR REPLACE )?FUNCTION public\\.${name}\\(`, "i"),
  );
  if (start < 0) return null;
  const tag = sql.slice(start).match(/AS\s+(\$[A-Za-z_]*\$)/);
  if (!tag || tag.index === undefined) return null;
  const bodyAt = start + tag.index + tag[0].length;
  const close = sql.indexOf(tag[1], bodyAt);
  if (close < 0) return null;
  const end = sql.indexOf(";", close + tag[1].length);
  return sql.slice(start, end + 1);
}
function tableFrom(sql: string, name: string): string | null {
  return (
    sql.match(
      new RegExp(
        `CREATE TABLE IF NOT EXISTS public\\.${name}\\s*\\([\\s\\S]*?\\n\\);`,
        "i",
      ),
    )?.[0] ?? null
  );
}

// --- Sessions -----------------------------------------------------------------------------

async function asOwner() {
  await db.exec("RESET ROLE");
  await db.query("SELECT set_config('request.jwt.claim.sub','',false)");
  await db.query("SELECT set_config('request.jwt.claims','',false)");
}
let depth = 0;
async function guarded<T>(fn: () => Promise<T>): Promise<T> {
  if (depth) await db.exec("SAVEPOINT step");
  try {
    const out = await fn();
    if (depth) await db.exec("RELEASE SAVEPOINT step");
    return out;
  } catch (e) {
    if (depth) await db.exec("ROLLBACK TO SAVEPOINT step");
    throw e;
  } finally {
    await asOwner();
  }
}
async function q<T = Row>(text: string, params: unknown[] = []): Promise<T[]> {
  return guarded(async () => {
    await asOwner();
    return (await db.query<T>(text, params)).rows;
  });
}
async function ex(text: string): Promise<void> {
  await guarded(async () => {
    await asOwner();
    await db.exec(text);
  });
}
async function one<T = any>(text: string, params: unknown[] = []): Promise<T> {
  return (await q<{ r: T }>(text, params))[0]?.r as T;
}
/** One value as a seat (its auth id), anon (null) or the service key. */
async function as<T = any>(
  who: string | null | "service",
  text: string,
  params: unknown[] = [],
): Promise<T> {
  return guarded(async () => {
    if (who === "service") {
      await asOwner();
      await db.query("SELECT set_config('request.jwt.claims',$1,false)", [
        JSON.stringify({ role: "service_role" }),
      ]);
      await db.exec("SET ROLE service_role");
    } else await actor(db, who);
    return (await db.query<{ r: T }>(text, params)).rows[0]?.r as T;
  });
}
async function refusal(
  fn: () => Promise<unknown>,
): Promise<{ code: string; message: string }> {
  try {
    await fn();
  } catch (e) {
    const x = e as { code?: string; message: string };
    return { code: x.code ?? "", message: x.message };
  }
  throw new Error("Expected a refusal");
}
async function rolledBack(fn: () => Promise<void>) {
  await asOwner();
  await db.exec("BEGIN");
  depth++;
  try {
    await fn();
  } finally {
    depth--;
    await db.exec("ROLLBACK");
    await asOwner();
  }
}

const today = async () =>
  String(
    await one("SELECT (now() AT TIME ZONE 'Asia/Kuwait')::date::text AS r"),
  );
const addDays = (day: string, n: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000)
    .toISOString()
    .slice(0, 10);
let uuidN = 0;
const rid = () =>
  `00000000-0000-4000-9000-${String(++uuidN).padStart(12, "0")}`;

function confirmArgs(taskId: string, over: Record<string, unknown> = {}) {
  return {
    taskId,
    requestId: rid(),
    leftOn: "2026-10-20",
    noticeOn: null,
    reason: "Cancelled",
    churnType: "mid_programme",
    whyDetail: "The owner moved the budget to a showroom fit-out.",
    howToStop: "Agree the second campaign before day 45.",
    mrrLostUsd: 2000,
    exitCallId: null,
    surveyState: "not_sent",
    surveyResponseId: null,
    ...over,
  };
}
const confirmAs = (who: string | null, args: Record<string, unknown>) =>
  as(
    who,
    "SELECT public.cockpit_client_lifecycle_confirm('churn', $1::jsonb) AS r",
    [JSON.stringify(args)],
  );

// --- The base -----------------------------------------------------------------------------

function nativeSync(): string {
  const text = migration("20261009a_billing_native_sync.sql");
  const start = text.indexOf("-- cron:begin");
  const end = text.indexOf("-- cron:end");
  if (start < 0 || end < start)
    throw new Error("The schedule block is missing its markers");
  return (
    text.slice(0, start) +
    text.slice(end + "-- cron:end".length) +
    "\n" +
    migration("20261009h_billing_browser_writes_closed.sql")
  );
}

async function billingBase() {
  await db.exec(
    "CREATE SCHEMA storage; CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint); CREATE TABLE storage.objects(bucket_id text,name text,metadata jsonb); ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;",
  );
  for (const name of [
    "cockpit_client_billing_days",
    "cockpit_metric_days",
    "cockpit_payer_clients",
  ])
    await db.exec(
      cut(
        "20260919_cockpit_core.sql",
        new RegExp(
          `create table if not exists public\\.${name} \\([\\s\\S]*?\\n\\);`,
          "i",
        ),
        name,
      ),
    );
  await db.exec(
    cut(
      "20260927x_cockpit_native_media_sync.sql",
      /ALTER TABLE public\.cockpit_client_billing_days[\s\S]*?source_record jsonb;/,
      "provenance",
    ),
  );
  await db.exec(
    cut(
      "20260919b_people.sql",
      /create table if not exists public\.cockpit_people \([\s\S]*?\n\);/i,
      "people",
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
    cut(
      "20261007d_cockpit_team_rpc_restore.sql",
      /create or replace function public\.cockpit_has_active_seat\(\)[\s\S]*?\$\$;/,
      "active seat",
    ),
  );
  await db.exec(
    "GRANT EXECUTE ON FUNCTION public.cockpit_has_active_seat() TO authenticated, service_role;",
  );
  await db.exec(
    cut(
      "20260924r_billing_and_comms_access.sql",
      /-- 1\. Cockpit Billing Accounts[\s\S]*?(?=-- 4\. WhatsApp)/,
      "billing access",
    ),
  );
  await db.exec(
    cut(
      "20260926m_cockpit_csm_state.sql",
      /CREATE OR REPLACE FUNCTION public\.cockpit_client_allowed\([\s\S]*?END \$\$;/,
      "client allowed",
    ),
  );
  await db.exec(
    "GRANT EXECUTE ON FUNCTION public.cockpit_client_allowed(text) TO authenticated, service_role;",
  );
  await db.exec(migration("20260927d_cockpit_manual_payments_access.sql"));
  await db.exec(migration("20260927h_cockpit_ceo_actions.sql"));
  await db.exec(nativeSync());
  const f = "20261009f_clickup_writeback_native.sql";
  await db.exec(
    [
      cut(
        f,
        /CREATE TABLE IF NOT EXISTS public\.cockpit_clickup_writeback_queue\([\s\S]*?\n\);/,
        "queue",
      ),
      "ALTER TABLE public.cockpit_clickup_writeback_queue ENABLE ROW LEVEL SECURITY;",
      "REVOKE ALL ON public.cockpit_clickup_writeback_queue FROM PUBLIC,anon,authenticated;",
      "GRANT SELECT,INSERT,UPDATE ON public.cockpit_clickup_writeback_queue TO service_role;",
      cut(
        f,
        /CREATE OR REPLACE FUNCTION public\.cockpit_clickup_writeback_audit\(\)[\s\S]*?END \$\$;/,
        "queue audit",
      ),
      cut(
        f,
        /DROP TRIGGER IF EXISTS cockpit_clickup_writeback_queue_audit_insert[\s\S]*?EXECUTE FUNCTION public\.cockpit_clickup_writeback_audit\(\);/,
        "queue audit triggers",
      ),
      migration("20261009j_billing_clickup_writeback.sql"),
    ].join("\n"),
  );
}

async function churnBase() {
  async function table(file: string, relation: string) {
    await db.exec(
      cut(
        file,
        new RegExp(
          `create table if not exists public\\.${relation}\\s*\\([\\s\\S]*?\\n\\);`,
          "i",
        ),
        relation,
      ),
    );
    await db.exec(`ALTER TABLE public.${relation} ENABLE ROW LEVEL SECURITY`);
  }
  await db.exec("CREATE TABLE public.clients(id uuid PRIMARY KEY)");
  for (const relation of [
    "cockpit_campaigns",
    "cockpit_ads",
    "cockpit_client_profiles",
    "cockpit_decisions",
  ])
    await table("20260923o_cockpit_domain_tables.sql", relation);
  await db.exec(migration("20260926a_cockpit_decision_details.sql"));
  await table("20260923p_cockpit_actions_and_rpcs.sql", "cockpit_plan_items");
  await table(
    "20260927i_cockpit_finance_refresh.sql",
    "cockpit_finance_refreshes",
  );
  await db.exec(
    cut(
      "20260927i_cockpit_finance_refresh.sql",
      /ALTER TABLE public\.cockpit_client_payments ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;/,
      "payments active",
    ),
  );
  for (const relation of [
    "team_people",
    "team_meetings",
    "team_meeting_people",
  ])
    await table("20260922b_team_meetings.sql", relation);
  await table("20260923d_team_meetings_screen.sql", "team_changes");
  await db.exec(
    cut(
      "20260923d_team_meetings_screen.sql",
      /alter table public\.team_meeting_people\s+add column[\s\S]*?;/i,
      "meeting people columns",
    ),
  );
  await db.exec(
    cut(
      "20260927d_team_meetings_v5.sql",
      /alter table public\.team_meetings\s+add column[\s\S]*?;[ \t]*\r?$/im,
      "meetings v5",
    ),
  );
  await db.exec(
    cut(
      "20260927g_renewals_projections_meeting.sql",
      /alter table public\.team_meetings add column if not exists embed text;/i,
      "embed",
    ),
  );
  await db.exec(
    cut(
      "20260927g_renewals_projections_meeting.sql",
      /alter table public\.team_meetings\s+add constraint team_meetings_embed_check[\s\S]*?;/i,
      "embed check",
    ),
  );
  for (const relation of [
    "cockpit_churn_departures",
    "cockpit_churn_months",
    "cockpit_churn_log",
  ])
    await table("20261001a_churn_tracker.sql", relation);
  await db.exec(
    cut(
      "20261001a_churn_tracker.sql",
      /create unique index if not exists cockpit_churn_departures_card_day[\s\S]*?;/i,
      "card day index",
    ),
  );
  await table("20260922a_eod_outbox.sql", "eod_outbox");
  await table("20260920b_wa_inbox.sql", "wa_threads");
  await db.exec(migration("20260926m_cockpit_csm_state.sql"));
  await db.exec(migration("20260927v_csm_read_models.sql"));
  await db.exec(migration("20261004a_csm_churn_projections.sql"));
  // The read models are ready and empty: the churn read's roster comes back empty.
  await db.exec(
    "UPDATE public.cockpit_csm_source_state SET ready=true, row_count=0, source_snapshot_at=now()",
  );
}

/** The notice queue and the forms tables `o` writes, cut from their canonical files. */
async function noticesAndForms() {
  const n = "20261025n_slack_notices.sql";
  await db.exec(
    cut(
      n,
      /CREATE TABLE IF NOT EXISTS public\.cockpit_slack_notices \([\s\S]*?\n\);/,
      "notices",
    ),
  );
  for (const name of [
    "cockpit_slack_notice_queue",
    "cockpit_slack_notice_queue_failed",
    "cockpit_slack_notice_role_of",
  ]) {
    const def = fnFrom(migration(n), name);
    if (!def) throw new Error(`${name} is missing from ${n}`);
    await db.exec(def);
  }
  await db.exec(`ALTER TABLE public.cockpit_slack_notices ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON public.cockpit_slack_notices FROM PUBLIC, anon, authenticated;
    REVOKE ALL ON FUNCTION public.cockpit_slack_notice_queue(text,text,text,text,jsonb,uuid,text,text),
      public.cockpit_slack_notice_queue_failed(text), public.cockpit_slack_notice_role_of(text) FROM PUBLIC, anon, authenticated, service_role;`);
  const f = "20261027f_forms_core.sql";
  const sql = migration(f);
  await db.exec(fnFrom(sql, "cockpit_forms_effects_valid") as string);
  for (const t of [
    "cockpit_forms",
    "cockpit_form_versions",
    "cockpit_form_responses",
  ])
    await db.exec(tableFrom(sql, t) as string);
  await db.exec(fnFrom(sql, "cockpit_form_responses_guard") as string);
  await db.exec(
    cut(
      f,
      /DROP TRIGGER IF EXISTS cockpit_form_responses_guard[\s\S]*?EXECUTE FUNCTION public\.cockpit_form_responses_guard\(\);/,
      "guard trigger",
    ),
  );
  await db.exec(`ALTER TABLE public.cockpit_forms ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.cockpit_form_versions ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.cockpit_form_responses ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON public.cockpit_forms, public.cockpit_form_versions, public.cockpit_form_responses FROM PUBLIC, anon, authenticated;
    REVOKE ALL ON FUNCTION public.cockpit_form_responses_guard() FROM PUBLIC, anon, authenticated, service_role;`);
}

// --- 20261101l and 20261101m: the real objects when the files are in the tree, else the contract's shape

const STAND_IN_L = `
ALTER TABLE public.cockpit_slack_notices DROP CONSTRAINT IF EXISTS cockpit_slack_notices_kind_check;
ALTER TABLE public.cockpit_slack_notices ADD CONSTRAINT cockpit_slack_notices_kind_check
  CHECK (kind IN ('kickoff','kickoff.updated','blueprint.close','blueprint.updated','blueprint.media','blueprint.offer',
                  'rehearsal','termination.notice','termination.submitted','churn.confirmed','extension.granted',
                  'pause.agreed','client.resumed'));
INSERT INTO public.cockpit_forms(key, title, audience, provider, typeform_id, schema, seats, client_scoped, updated_by) VALUES
  ('exit_survey', 'Termination survey', 'client', 'typeform', 'knIe4eF3', '{}', '{csm}', true, 'test'),
  ('pause_request', 'Pause request', 'client', 'typeform', 'CTUjv6l3', '{}', '{csm}', true, 'test'),
  ('churn_confirm', 'Client is leaving', 'team', 'native', NULL, '{}', '{csm}', true, 'test')
ON CONFLICT DO NOTHING;
INSERT INTO public.cockpit_form_versions(form_key, version, schema, published_by)
SELECT key, 1, '{}', 'test' FROM public.cockpit_forms WHERE key IN ('exit_survey','pause_request','churn_confirm')
ON CONFLICT DO NOTHING;

-- 3.1: one confirmed response per request id; cockpit needs a seat, import needs none.
CREATE OR REPLACE FUNCTION public.cockpit_form_staff_record(p_form_key text, p_task_id text, p_answers jsonb,
  p_request_id uuid, p_source text DEFAULT 'cockpit')
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_id uuid; v_by text; v_uid uuid := auth.uid();
BEGIN
  SELECT r.id INTO v_id FROM public.cockpit_form_responses r WHERE r.form_key = p_form_key AND r.external_id = 'req:' || p_request_id;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  IF p_source = 'cockpit' THEN
    IF v_uid IS NULL THEN RAISE EXCEPTION 'A cockpit record needs a signed-in seat.' USING ERRCODE = '42501'; END IF;
    SELECT lower(email) INTO v_by FROM auth.users WHERE id = v_uid;
  ELSIF p_source = 'import' THEN
    IF v_uid IS NOT NULL THEN RAISE EXCEPTION 'An import runs only as the owner.' USING ERRCODE = '42501'; END IF;
    v_by := 'the CEO''s word (Q5), 2026-11-01';
  ELSE RAISE EXCEPTION 'Unknown source.' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.cockpit_form_responses(form_key, form_version, source, external_id, task_id, client_name, mode, state,
    answers, created_by, created_by_id, confirmed_by, confirmed_at)
  VALUES (p_form_key, 1, p_source, 'req:' || p_request_id, p_task_id,
    (SELECT client_name FROM public.cockpit_billing_accounts WHERE clickup_task_id = p_task_id), 'live', 'confirmed',
    p_answers, v_by, CASE WHEN p_source = 'cockpit' THEN v_uid END, v_by, now())
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- 3.1: termination rows with no confirmed departure and no answer; matched rows
-- for the seat's own clients, unmatched rows for every CSM seat and the CEO.
CREATE OR REPLACE FUNCTION public.cockpit_form_notices_in()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object(
      'kind', CASE r.form_key WHEN 'exit_survey' THEN 'termination' ELSE 'pause_request' END,
      'responseId', r.id, 'taskId', r.task_id,
      'clientName', coalesce(b.client_name, r.hidden->>'client_name', r.client_name),
      'noticeOn', r.answer_meta->>'notice_on', 'submittedAt', r.submitted_at, 'matched', r.task_id IS NOT NULL,
      'departureId', (SELECT d.id FROM public.cockpit_churn_departures d WHERE d.clickup_task_id = r.task_id
                        AND d.removed_at IS NULL AND d.confirmed_at IS NULL ORDER BY d.left_on DESC LIMIT 1))
      ORDER BY r.submitted_at DESC)
    FROM public.cockpit_form_responses r
    LEFT JOIN public.cockpit_billing_accounts b ON b.clickup_task_id = r.task_id
   WHERE r.form_key IN ('exit_survey','pause_request') AND r.state IN ('legacy','submitted')
     AND NOT (r.answer_meta ? 'answered')
     AND NOT EXISTS (SELECT 1 FROM public.cockpit_churn_departures d WHERE d.clickup_task_id = r.task_id
                       AND d.removed_at IS NULL AND d.confirmed_at IS NOT NULL)
     AND (CASE WHEN r.task_id IS NULL THEN public.cockpit_is_ceo() OR public.cockpit_has_role('csm')
               ELSE public.cockpit_client_allowed(b.client_name) END)), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.cockpit_form_staff_record(text,text,jsonb,uuid,text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.cockpit_form_notices_in() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cockpit_form_notices_in() TO authenticated;
`;

/** 20261009j's writes with 3.3's churn case: Churn Date first, then Stopped, reason, type, Paused On clear. */
function standInWrites(): string {
  const body = fnFrom(
    migration("20261009j_billing_clickup_writeback.sql"),
    "cockpit_billing_writeback_writes",
  ) as string;
  const at = body.indexOf(" ELSE NULL;\n END CASE;");
  if (at < 0) throw new Error("20261009j's writes changed shape");
  return `${body.slice(0, at)} WHEN 'churn' THEN
  w:=jsonb_build_array(jsonb_build_object('field','churnDate','value',d->>'left_on'),
                       jsonb_build_object('field','status','value','Stopped','old',p_from),
                       jsonb_build_object('field','churnReason','value',d->>'card_reason'),
                       jsonb_build_object('field','churnType','value',d->>'card_type'));
  IF d->'clear_paused'='true'::jsonb THEN w:=w||jsonb_build_object('field','pausedOn','value',NULL,'clear',true); END IF;
${body.slice(at)}`;
}
const STAND_IN_M = `
CREATE TABLE IF NOT EXISTS public.cockpit_billing_event_voids (
  event_id bigint PRIMARY KEY REFERENCES public.cockpit_billing_events(id),
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 4 AND 300),
  voided_by text NOT NULL, voided_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.cockpit_billing_event_voids ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cockpit_billing_event_voids FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON public.cockpit_billing_event_voids TO service_role;
CREATE OR REPLACE FUNCTION public.cockpit_churn_reason_card(p_reason text)
RETURNS text LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT CASE WHEN p_reason = 'Completed term, did not renew' THEN 'Completed term, did not renew'
              WHEN p_reason = 'Other' OR p_reason IS NULL THEN NULL ELSE p_reason END $$;
CREATE OR REPLACE FUNCTION public.cockpit_billing_detail(p_kind text, p_args jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path = '' AS $$
BEGIN
  IF p_kind <> 'churn' THEN RETURN '{}'::jsonb; END IF;
  RETURN jsonb_build_object('left_on', p_args->>'leftOn', 'card_reason', public.cockpit_churn_reason_card(p_args->>'reason'),
    'card_type', p_args->>'cardType', 'clear_paused', coalesce((p_args->>'clearPaused')::boolean, false),
    'departure_id', (p_args->>'departureId')::bigint, 'response_id', p_args->>'responseId',
    'request_id', p_args->>'requestId', 'seat_role', p_args->>'seatRole', 'why_detail', p_args->>'whyDetail');
END $$;
${standInWrites()}
DROP TRIGGER IF EXISTS cockpit_billing_events_clickup_writeback ON public.cockpit_billing_events;
CREATE TRIGGER cockpit_billing_events_clickup_writeback AFTER INSERT ON public.cockpit_billing_events
 FOR EACH ROW WHEN (NEW.source IN('ceo','csm') AND NEW.kind IN('method','plan','amount','date','extension','pause','resume','payment','note','churn'))
 EXECUTE FUNCTION public.cockpit_billing_writeback_enqueue();
REVOKE ALL ON FUNCTION public.cockpit_churn_reason_card(text), public.cockpit_billing_detail(text,jsonb),
  public.cockpit_billing_writeback_writes(text,text,text,jsonb) FROM PUBLIC, anon, authenticated, service_role;
`;

/** Which path stood in for each sibling file, said in the test names. */
const SIBLINGS = {
  l: has(L) ? "20261101l" : "the 3.1 stand-in",
  m: has(M) ? "20261101m" : "the 3.3 stand-in",
};

async function siblings() {
  // l: until its file is merged, its objects come from the contract's shape.
  if (has(L)) {
    const sql = migration(L);
    await db.exec(STAND_IN_L); // its notice-kind CHECK and the three registry rows `o` needs
    // What l's records stand on: the seat reader (20261027f) and l's column probe.
    for (const name of ["cockpit_form_seat", "cockpit_form_actor"])
      await db.exec(
        fnFrom(migration("20261027f_forms_core.sql"), name) as string,
      );
    for (const name of [
      "cockpit_form_column_exists",
      "cockpit_form_responses_guard",
      "cockpit_form_staff_record",
      "cockpit_form_notices_in",
    ]) {
      const def = fnFrom(sql, name);
      if (def) await db.exec(def);
    }
  } else await db.exec(STAND_IN_L);
  if (has(M)) {
    const sql = migration(M);
    await db.exec(STAND_IN_M);
    for (const t of ["cockpit_clickup_fields"]) {
      const def = tableFrom(sql, t);
      if (def) await db.exec(def);
    }
    for (const name of [
      "cockpit_clickup_field",
      "cockpit_clickup_option_ok",
      "cockpit_churn_reason_card",
      "cockpit_billing_writeback_comment",
      "cockpit_billing_detail",
      "cockpit_billing_writeback_writes",
    ]) {
      const def = fnFrom(sql, name);
      if (def) await db.exec(def);
    }
    // m reads the card's Churn Reason options from its stored field map (W7).
    await db.exec(`INSERT INTO public.cockpit_clickup_fields(list_id, field_id, name, type, options, read_at, read_by)
      VALUES ('901816559981', '796f25e7-7e63-4d08-9ec4-41c58a5b57ca', 'Churn Reason', 'drop_down',
        '[{"id":"o1","name":"Cancelled","orderindex":0},{"id":"o2","name":"Non-payment 14+ days","orderindex":1},
          {"id":"o3","name":"Completed term, did not renew","orderindex":2},{"id":"o4","name":"Ghosted","orderindex":3}]',
        now(), 'test') ON CONFLICT DO NOTHING`);
  } else await db.exec(STAND_IN_M);
}

async function seed() {
  await member(db, CEO, CEO_EMAIL, []);
  await member(db, CSM, CSM_EMAIL, ["csm"]);
  await member(db, OTHER_CSM, "other.csm@tests.invalid", ["csm"]);
  await member(db, FINANCE, "finance@tests.invalid", ["finance"]);
  const t = await today();
  await ex(`
    UPDATE cockpit_members SET clients=ARRAY['Acme Interiors','Joe and Sera Company','Atlantis Contracting','Gone Co','Paused Co','Late Co','Extended Co','Comeback Co'] WHERE email='${CSM_EMAIL}';
    UPDATE cockpit_members SET clients=ARRAY['Beta Build'] WHERE email='other.csm@tests.invalid';
    INSERT INTO cockpit_billing_accounts(clickup_task_id,client_name,stage,stage_group,client_status,payment_plan,next_payment_usd,next_payment_date,mrr_usd,paused_on,csm,synced_at) VALUES
      ('taskAcme','Acme Interiors','Active','active','Active','Monthly',2000,'${addDays(t, 12)}',2000,NULL,'The CSM',now()),
      ('taskBeta','Beta Build','Active','active','Active','Monthly',1500,'${addDays(t, 5)}',1500,NULL,'The CSM',now()),
      ('taskJoe','Joe and Sera Company','Stopped','gone','Stopped','Monthly',NULL,NULL,1666,NULL,'The CSM',now()),
      ('taskAtl','Atlantis Contracting','Stopped','gone','Stopped','Monthly',NULL,NULL,2000,'2026-10-31','The CSM',now()),
      ('taskGone','Gone Co','Stopped','gone','Stopped','Monthly',NULL,NULL,NULL,NULL,'The CSM',now()),
      ('taskPaused','Paused Co','Paused','paused','Paused','Monthly',1000,NULL,1000,'${addDays(t, -20)}','The CSM',now()),
      ('taskLate','Late Co','Active','active','Active','Monthly',1200,'${addDays(t, -16)}',1200,NULL,'The CSM',now()),
      ('taskExt','Extended Co','Active','active','Active','Monthly',1300,'${addDays(t, 10)}',1300,NULL,'The CSM',now()),
      ('taskBack','Comeback Co','Active','active','Active','Monthly',900,'${addDays(t, 20)}',900,NULL,'The CSM',now());
    INSERT INTO cockpit_client_billing_days(day,clickup_task_id,client_name,stage,launch_date,next_renewal_date,churn_type,churn_reason,captured_at) VALUES
      ('2026-10-07','taskGone','Gone Co','Stopped',NULL,NULL,NULL,NULL,now()),
      ('2026-10-30','taskGone','Gone Co','Stopped',NULL,NULL,NULL,NULL,now()),
      ('2026-10-30','taskJoe','Joe and Sera Company','Stopped','2026-04-28',NULL,'Mid-programme loss (counts as churn)','Non-payment 14+ days',now()),
      ('2026-10-30','taskAtl','Atlantis Contracting','Stopped','2026-08-30',NULL,'Mid-programme loss (counts as churn)','Cancelled',now()),
      ('2026-10-30','taskAcme','Acme Interiors','Active','2026-09-01',NULL,NULL,NULL,now());
    INSERT INTO cockpit_churn_departures(id,client,clickup_task_id,left_on,launched_on,reason,mrr_lost_usd,csm,note,created_by) VALUES
      (20,'Atlantis Contracting','taskAtl','2026-10-18','2026-08-30','Other',2000,'The CSM','Dated by the client''s message of 18 Oct.','test'),
      (21,'Joe and Sera Company','taskJoe','2026-10-29','2026-04-28','Non-payment 14+ days',1666,'The CSM','The CEO: count it as churned. No payment on the rails.','test');
    SELECT setval('cockpit_churn_departures_id_seq', 100);
    INSERT INTO cockpit_billing_events(clickup_task_id,client_name,kind,from_value,to_value,reason,detail,source,by_whom,at) VALUES
      ('taskPaused','Paused Co','pause','Active','Paused','Client asked','{"on":"${addDays(t, -20)}","pause_kind":"client_request","restart":"${addDays(t, 10)}"}','csm','${CSM_EMAIL}',now() - interval '20 days'),
      ('taskExt','Extended Co','extension','${addDays(t, -4)}','${addDays(t, 10)}','Bank holiday','{"weeks":2,"ours":false,"movedDate":true}','csm','${CSM_EMAIL}',now() - interval '4 days');
  `);
}

beforeAll(async () => {
  db = await cockpitTestDb({ supabaseDefaultPrivileges: true });
  await billingBase();
  await churnBase();
  await noticesAndForms();
  await siblings();
  await seed();
  await db.exec(migration(O));
  await db.exec(migration(O)); // twice, as every file must apply
  await asOwner();
});
afterAll(async () => {
  await db?.close();
});

// --- The file ---------------------------------------------------------------------------

describe(`20261101o applies on ${SIBLINGS.l} and ${SIBLINGS.m}`, () => {
  test("twice without error, with the drift guard's after values equal to its own bodies", async () => {
    const md5 = async (name: string) =>
      one<string>(
        `SELECT md5(regexp_replace(p.prosrc, '\\s+', ' ', 'g')) AS r FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname=$1`,
        [name],
      );
    const sql = migration(O);
    const after = (name: string) =>
      sql.match(
        new RegExp(
          `\\('${name}', ARRAY\\['[0-9a-f]{32}', '([0-9a-f]{32})'\\]\\)`,
        ),
      )?.[1];
    expect(after("cockpit_csm_churn_read")).toBe(
      await md5("cockpit_csm_churn_read"),
    );
    // o no longer replaces the guard: l's body (with the answer carve-out) stays.
    expect(after("cockpit_form_responses_guard")).toBeUndefined();
    expect(await md5("cockpit_form_responses_guard")).toBe(L_GUARD_MD5);
  });

  test("the live bodies it replaces are the repo's, so the guard's live values are real", async () => {
    await rolledBack(async () => {
      await ex(
        cut(
          "20261004a_csm_churn_projections.sql",
          /CREATE OR REPLACE FUNCTION public\.cockpit_csm_churn_read\(\)[\s\S]*?END \$\$;/,
          "read",
        ),
      );
      const md5 = async (name: string) =>
        one<string>(
          `SELECT md5(regexp_replace(prosrc, '\\s+', ' ', 'g')) AS r FROM pg_proc WHERE proname=$1`,
          [name],
        );
      expect(await md5("cockpit_csm_churn_read")).toBe(LIVE_READ_MD5);
      // and the file applies over the live bodies
      await ex(inTx(O));
    });
  });

  test("the drift guard refuses a changed body, and the dependency check refuses a missing 20261101l", async () => {
    await rolledBack(async () => {
      await ex(
        "CREATE OR REPLACE FUNCTION public.cockpit_csm_churn_read() RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$",
      );
      const r = await refusal(() => ex(inTx(O)));
      expect(r.code).toBe("55000");
      expect(r.message).toBe(
        "cockpit_csm_churn_read changed since the waves 1-2 contract read it; stop and re-read it.",
      );
    });
    await rolledBack(async () => {
      await ex("DROP FUNCTION public.cockpit_form_notices_in()");
      const r = await refusal(() => ex(inTx(O)));
      expect(r.message).toBe(
        "20261101o needs 20261101l and 20261101m applied first; apply them, then this file.",
      );
    });
    // The live guard (20261027f, before l) has no answer carve-out: o waits for l.
    await rolledBack(async () => {
      await ex(
        fnFrom(
          migration("20261027f_forms_core.sql"),
          "cockpit_form_responses_guard",
        ) as string,
      );
      expect(
        await one<string>(
          `SELECT md5(regexp_replace(prosrc, '\\s+', ' ', 'g')) AS r FROM pg_proc WHERE proname='cockpit_form_responses_guard'`,
        ),
      ).toBe(LIVE_GUARD_MD5);
      const r = await refusal(() => ex(inTx(O)));
      expect(r.message).toBe(
        "20261101o needs 20261101l and 20261101m applied first; apply them, then this file.",
      );
    });
  });

  test("no new unique index on departures: (task, left_on) stays the rule (W21)", async () => {
    const idx = await q<{ indexname: string; indexdef: string }>(
      "SELECT indexname, indexdef FROM pg_indexes WHERE tablename='cockpit_churn_departures' AND indexdef ILIKE '%UNIQUE%'",
    );
    expect(idx.map(i => i.indexname).sort()).toEqual([
      "cockpit_churn_departures_card_day",
      "cockpit_churn_departures_pkey",
    ]);
  });

  test("forms.doors gains churn and keeps every other door", async () => {
    await rolledBack(async () => {
      await ex(
        `UPDATE cockpit_settings SET value='{"checks":true,"money":false}' WHERE key='forms.doors'`,
      );
      await ex(inTx(O));
      expect(
        await one(
          "SELECT value AS r FROM cockpit_settings WHERE key='forms.doors'",
        ),
      ).toEqual({ checks: true, money: false, churn: true });
    });
    expect(
      await one(
        "SELECT value->'churn' AS r FROM cockpit_settings WHERE key='forms.doors'",
      ),
    ).toBe(true);
  });

  test("grants: four browser RPCs, owner-only doors, a service-only view, anon nowhere", async () => {
    const can = (role: string, fn: string) =>
      one<boolean>(`SELECT has_function_privilege($1, $2, 'EXECUTE') AS r`, [
        role,
        fn,
      ]);
    for (const fn of [
      "public.cockpit_client_lifecycle_confirm(text,jsonb)",
      "public.cockpit_form_notice_answer(uuid,text,text)",
      "public.cockpit_client_lifecycle_read(text)",
      "public.cockpit_csm_churn_read()",
    ]) {
      expect(await can("authenticated", fn)).toBe(true);
      expect(await can("anon", fn)).toBe(false);
      expect(await can("service_role", fn)).toBe(false);
    }
    for (const fn of [
      "public.cockpit_churn_backfill_confirm(bigint)",
      "public.cockpit_churn_type_default(text,date)",
      "public.cockpit_churn_type_card(text)",
      "public.cockpit_churn_type_from_card(text)",
      "public.cockpit_churn_survey_ratings(jsonb)",
      "public.cockpit_form_responses_guard()",
    ])
      for (const role of ["anon", "authenticated", "service_role"])
        expect(await can(role, fn)).toBe(false);
    const sel = (role: string) =>
      one<boolean>(
        `SELECT has_table_privilege($1, 'public.cockpit_client_lifecycle_v', 'SELECT') AS r`,
        [role],
      );
    expect(await sel("service_role")).toBe(true);
    expect(await sel("authenticated")).toBe(false);
    expect(await sel("anon")).toBe(false);
    expect(
      await one(
        "SELECT reloptions::text AS r FROM pg_class WHERE relname='cockpit_client_lifecycle_v'",
      ),
    ).toContain("security_invoker=true");
    const refused = await refusal(() =>
      as(null, "SELECT public.cockpit_csm_churn_read() AS r"),
    );
    expect(refused.message).toContain("permission denied");
  });
});

// --- The confirm -------------------------------------------------------------------------

describe("cockpit_client_lifecycle_confirm('churn')", () => {
  test("the gate: a CSM on another client, finance and anon are refused; the CEO is allowed", async () => {
    await rolledBack(async () => {
      const other = await refusal(() =>
        confirmAs(OTHER_CSM, confirmArgs("taskAcme")),
      );
      expect(other.code).toBe("42501");
      expect(other.message).toBe(
        "Acme Interiors is not one of your clients. Ask its CSM or the CEO to confirm the churn.",
      );
      expect(
        (await refusal(() => confirmAs(FINANCE, confirmArgs("taskAcme"))))
          .message,
      ).toBe(
        "Confirming a churn needs a client success or CEO seat. Ask an admin to add the role.",
      );
      expect(
        (await refusal(() => confirmAs(null, confirmArgs("taskAcme")))).message,
      ).toContain("permission denied");
      const r = await confirmAs(CEO, confirmArgs("taskBeta"));
      expect(r.departureId).toBeGreaterThan(100);
      expect(
        await one(
          "SELECT source AS r FROM cockpit_billing_events WHERE id=$1",
          [r.eventId],
        ),
      ).toBe("ceo");
    });
  });

  test("the form's minimums and kinds, word for word", async () => {
    const t = await today();
    const said = async (over: Record<string, unknown>) =>
      (await refusal(() => confirmAs(CSM, confirmArgs("taskAcme", over))))
        .message;
    expect(await said({ whyDetail: "too short" })).toBe(
      "Say why they left in detail, so the lock-in reads back.",
    );
    expect(await said({ howToStop: "call more" })).toBe(
      "Say how we stop this next time.",
    );
    expect(await said({ leftOn: addDays(t, 1) })).toBe(
      "Pick the day they left, today or before.",
    );
    expect(await said({ reason: "Bored" })).toBe("Pick the reason they left.");
    expect(await said({ churnType: "maybe" })).toBe("Pick the churn type.");
    expect(await said({ mrrLostUsd: -1 })).toBe(
      "MRR lost is a dollar amount, 0 or more.",
    );
    expect(await said({ requestId: "not-a-uuid" })).toBe(
      "That form could not be read. Reload the page and send it again.",
    );
    expect(
      (
        await refusal(() =>
          as(
            CSM,
            "SELECT public.cockpit_client_lifecycle_confirm('pause', '{}'::jsonb) AS r",
          ),
        )
      ).message,
    ).toBe("Only a churn is confirmed here for now.");
  });

  test("a new departure, the response, one churn event and its card writes, the notice, the log and the audit", async () => {
    await rolledBack(async () => {
      const args = confirmArgs("taskAcme", { noticeOn: "2026-10-15" });
      const r = await confirmAs(CSM, args);
      expect(r.cardState).toBe("queued");
      const dep = (
        await q("SELECT * FROM cockpit_churn_departures WHERE id=$1", [
          r.departureId,
        ])
      )[0];
      expect(dep).toMatchObject({
        client: "Acme Interiors",
        clickup_task_id: "taskAcme",
        reason: "Cancelled",
        churn_type: "mid_programme",
        why_detail: args.whyDetail,
        how_to_stop: args.howToStop,
        survey_state: "not_sent",
        confirmed_by: CSM_EMAIL,
        billing_event_id: Number(r.eventId),
        csm: "The CSM",
        source: "cockpit",
      });
      expect(
        await one(
          "SELECT launched_on::text AS r FROM cockpit_churn_departures WHERE id=$1",
          [r.departureId],
        ),
      ).toBe("2026-09-01");
      expect(
        await one(
          "SELECT notice_on::text AS r FROM cockpit_churn_departures WHERE id=$1",
          [r.departureId],
        ),
      ).toBe("2026-10-15");
      const resp = (
        await q(
          "SELECT form_key, source, state, external_id, created_by_id::text AS by_id FROM cockpit_form_responses WHERE id=$1",
          [r.responseId],
        )
      )[0];
      expect(resp).toEqual({
        form_key: "churn_confirm",
        source: "cockpit",
        state: "confirmed",
        external_id: `req:${args.requestId}`,
        by_id: CSM,
      });
      const ev = (
        await q(
          "SELECT kind, source, from_value, to_value, reason, detail FROM cockpit_billing_events WHERE id=$1",
          [r.eventId],
        )
      )[0];
      expect(ev).toMatchObject({
        kind: "churn",
        source: "csm",
        from_value: "Active",
        to_value: "Stopped",
        reason: "Cancelled",
      });
      expect(ev.detail).toMatchObject({
        left_on: "2026-10-20",
        card_reason: "Cancelled",
        card_type: "Mid-programme loss (counts as churn)",
        clear_paused: false,
        departure_id: Number(r.departureId),
        response_id: r.responseId,
        request_id: args.requestId,
        seat_role: "csm",
        why_detail: args.whyDetail,
      });
      // Through m's writes: the date first, then Stopped, the reason and the type.
      const writes = await one(
        "SELECT payload->'writes' AS r FROM cockpit_clickup_writeback_queue WHERE dedupe_key=$1",
        [`billing:${r.eventId}`],
      );
      expect(writes.map((w: Row) => w.field).slice(0, 4)).toEqual([
        "churnDate",
        "status",
        "churnReason",
        "churnType",
      ]);
      expect(writes[0].value).toBe("2026-10-20");
      expect(writes[1]).toMatchObject({ value: "Stopped", old: "Active" });
      expect(writes.find((w: Row) => w.field === "pausedOn")).toBeUndefined();
      // The mirror follows until the card confirms it.
      expect(
        (
          await q(
            "SELECT client_status, stage_group, churn_date::text AS d, source FROM cockpit_billing_accounts WHERE clickup_task_id='taskAcme'",
          )
        )[0],
      ).toEqual({
        client_status: "Stopped",
        stage_group: "gone",
        d: "2026-10-20",
        source: "csm",
      });
      const notice = (
        await q(
          "SELECT kind, state, facts FROM cockpit_slack_notices WHERE dedupe_key=$1",
          [`churn:${r.departureId}`],
        )
      )[0];
      expect(notice.kind).toBe("churn.confirmed");
      expect(notice.facts).toEqual({
        taskId: "taskAcme",
        client: "Acme Interiors",
        departureId: Number(r.departureId),
        reason: "Cancelled",
        leftOn: "2026-10-20",
      });
      expect(JSON.stringify(notice.facts)).not.toContain("@");
      expect(
        await one(
          "SELECT count(*)::int AS r FROM cockpit_churn_log WHERE what='confirmed Acme Interiors leaving'",
        ),
      ).toBe(1);
      expect(
        await one(
          "SELECT count(*)::int AS r FROM cockpit_audit_log WHERE action='churn.confirm' AND entity_id=$1",
          [String(r.departureId)],
        ),
      ).toBe(1);
    });
  });

  test("a repeated requestId returns the first result and writes one event", async () => {
    await rolledBack(async () => {
      const args = confirmArgs("taskAcme");
      const first = await confirmAs(CSM, args);
      const again = await confirmAs(CSM, args);
      expect(again).toMatchObject({
        departureId: first.departureId,
        eventId: first.eventId,
        responseId: first.responseId,
        repeat: true,
      });
      expect(
        await one(
          "SELECT count(*)::int AS r FROM cockpit_billing_events WHERE clickup_task_id='taskAcme' AND kind='churn'",
        ),
      ).toBe(1);
      expect(
        await one(
          "SELECT count(*)::int AS r FROM cockpit_form_responses WHERE form_key='churn_confirm'",
        ),
      ).toBe(1);
    });
  });

  test("the open departure is confirmed in place; Other writes no reason; Paused On is cleared when asked", async () => {
    await rolledBack(async () => {
      const r = await confirmAs(
        CSM,
        confirmArgs("taskAtl", {
          leftOn: "2026-10-18",
          reason: "Other",
          mrrLostUsd: 2000,
        }),
      );
      expect(Number(r.departureId)).toBe(20);
      expect(
        await one(
          "SELECT count(*)::int AS r FROM cockpit_churn_departures WHERE clickup_task_id='taskAtl'",
        ),
      ).toBe(1);
      const d = await one(
        "SELECT detail AS r FROM cockpit_billing_events WHERE id=$1",
        [r.eventId],
      );
      expect(d.card_reason).toBeNull();
      expect(d.clear_paused).toBe(true);
      const writes = await one(
        "SELECT payload->'writes' AS r FROM cockpit_clickup_writeback_queue WHERE dedupe_key=$1",
        [`billing:${r.eventId}`],
      );
      expect(writes.map((w: Row) => w.field)).toEqual([
        "churnDate",
        "status",
        "churnType",
        "pausedOn",
      ]);
      expect(
        await one(
          "SELECT paused_on AS r FROM cockpit_billing_accounts WHERE clickup_task_id='taskAtl'",
        ),
      ).toBeNull();
    });
  });

  test("a client who resumes and leaves again gets a second departure; the first keeps its day, reason and confirm", async () => {
    await rolledBack(async () => {
      const first = await confirmAs(
        CSM,
        confirmArgs("taskBack", { leftOn: "2026-09-10", reason: "Ghosted" }),
      );
      const before = (
        await q(
          "SELECT left_on::text AS l, reason, confirmed_at::text AS c, confirmed_by FROM cockpit_churn_departures WHERE id=$1",
          [first.departureId],
        )
      )[0];
      // A second confirm with no resume in between finds the first one confirmed: a new row.
      await ex(`INSERT INTO cockpit_billing_events(clickup_task_id,client_name,kind,from_value,to_value,detail,source,by_whom,at)
                VALUES ('taskBack','Comeback Co','resume','Stopped','Active','{"on":"2026-09-20"}','csm','${CSM_EMAIL}','2026-09-20T08:00:00Z')`);
      const second = await confirmAs(
        CSM,
        confirmArgs("taskBack", { leftOn: "2026-10-25", reason: "Cancelled" }),
      );
      expect(second.departureId).not.toBe(first.departureId);
      expect(
        (
          await q(
            "SELECT left_on::text AS l, reason, confirmed_at::text AS c, confirmed_by FROM cockpit_churn_departures WHERE id=$1",
            [first.departureId],
          )
        )[0],
      ).toEqual(before);
      expect(
        await one(
          "SELECT count(*)::int AS r FROM cockpit_churn_departures WHERE clickup_task_id='taskBack' AND confirmed_at IS NOT NULL",
        ),
      ).toBe(2);
      // A second departure on the same day is refused in words.
      const same = await refusal(() =>
        confirmAs(CSM, confirmArgs("taskBack", { leftOn: "2026-10-25" })),
      );
      expect(same.message).toBe(
        "This client already has a departure on 25 Oct 2026; confirm that one.",
      );
    });
  });

  test("a survey that is not this client's is refused; a matching one marks the survey filled", async () => {
    await rolledBack(async () => {
      const resp =
        await one(`INSERT INTO cockpit_form_responses(form_key,form_version,source,external_id,task_id,client_name,mode,state,answers,created_by,submitted_at)
        VALUES ('exit_survey',1,'typeform_webhook','tok1','taskAcme','Acme Interiors','live','legacy','{}','forms-door',now()) RETURNING id::text AS r`);
      const other =
        await one(`INSERT INTO cockpit_form_responses(form_key,form_version,source,external_id,task_id,client_name,mode,state,answers,created_by,submitted_at)
        VALUES ('exit_survey',1,'typeform_webhook','tok2','taskBeta','Beta Build','live','legacy','{}','forms-door',now()) RETURNING id::text AS r`);
      expect(
        (
          await refusal(() =>
            confirmAs(
              CSM,
              confirmArgs("taskAcme", { surveyResponseId: other }),
            ),
          )
        ).message,
      ).toBe(
        "That termination survey is not this client's. Pick the card on the survey first.",
      );
      const r = await confirmAs(
        CSM,
        confirmArgs("taskAcme", {
          surveyResponseId: resp,
          surveyState: "not_sent",
        }),
      );
      expect(
        (
          await q(
            "SELECT survey_state, survey_response_id::text AS s FROM cockpit_churn_departures WHERE id=$1",
            [r.departureId],
          )
        )[0],
      ).toEqual({ survey_state: "filled", s: resp });
    });
  });
});

// --- The day-90 default ---------------------------------------------------------------------

describe("cockpit_churn_type_default (3.5)", () => {
  test("mid_programme while no renewal date is known, whatever the days", async () => {
    expect(
      await one(
        "SELECT public.cockpit_churn_type_default('taskJoe', '2026-10-29') AS r",
      ),
    ).toBe("mid_programme");
    expect(
      await one(
        "SELECT public.cockpit_churn_type_default('taskAcme', '2026-10-20') AS r",
      ),
    ).toBe("mid_programme");
    expect(
      await one(
        "SELECT public.cockpit_churn_type_default(NULL, '2026-10-20') AS r",
      ),
    ).toBe("mid_programme");
  });
  test("completed only from day 90 with a renewal on or before the day they left", async () => {
    await rolledBack(async () => {
      await ex(
        "UPDATE cockpit_client_billing_days SET next_renewal_date='2026-10-28' WHERE clickup_task_id='taskJoe'",
      );
      expect(
        await one(
          "SELECT public.cockpit_churn_type_default('taskJoe', '2026-10-29') AS r",
        ),
      ).toBe("completed");
      expect(
        await one(
          "SELECT public.cockpit_churn_type_default('taskJoe', '2026-10-27') AS r",
        ),
      ).toBe("mid_programme");
      expect(
        await one(
          "SELECT public.cockpit_churn_type_default('taskJoe', '2026-05-30') AS r",
        ),
      ).toBe("mid_programme");
    });
  });
  test("the card's options both ways", async () => {
    expect(
      await one("SELECT public.cockpit_churn_type_card('mid_programme') AS r"),
    ).toBe("Mid-programme loss (counts as churn)");
    expect(
      await one("SELECT public.cockpit_churn_type_card('completed') AS r"),
    ).toBe("Completed term (does NOT count as churn)");
    expect(
      await one(
        "SELECT public.cockpit_churn_type_from_card('Mid-programme loss (counts as churn)') AS r",
      ),
    ).toBe("mid_programme");
    expect(
      await one(
        "SELECT public.cockpit_churn_type_from_card('Completed term (does NOT count as churn)') AS r",
      ),
    ).toBe("completed");
    expect(
      await one("SELECT public.cockpit_churn_type_from_card('') AS r"),
    ).toBeNull();
  });
});

// --- The backfill door -----------------------------------------------------------------------

describe("cockpit_churn_backfill_confirm (D-B6, D-B7)", () => {
  test("Atlantis: confirmed on the CEO's word, response source import, Paused On cleared, no notice", async () => {
    await rolledBack(async () => {
      const ev = Number(
        await one("SELECT public.cockpit_churn_backfill_confirm(20) AS r"),
      );
      const d = (
        await q(
          "SELECT churn_type, confirmed_by, how_to_stop, why_detail, billing_event_id FROM cockpit_churn_departures WHERE id=20",
        )
      )[0];
      expect(d).toMatchObject({
        churn_type: "mid_programme",
        confirmed_by: "the CEO's word (Q5), 2026-11-01",
        how_to_stop: "Recorded before the confirm existed (Q5).",
        why_detail: "Dated by the client's message of 18 Oct.",
        billing_event_id: ev,
      });
      const e = (
        await q(
          "SELECT source, by_whom, detail FROM cockpit_billing_events WHERE id=$1",
          [ev],
        )
      )[0];
      expect(e.source).toBe("ceo");
      expect(e.by_whom).toBe("the CEO's word (Q5), 2026-11-01");
      expect(e.detail).toMatchObject({
        clear_paused: true,
        card_reason: null,
        card_type: "Mid-programme loss (counts as churn)",
        seat_role: "ceo",
      });
      const resp = (
        await q(
          "SELECT source, created_by, created_by_id FROM cockpit_form_responses WHERE id=$1::uuid",
          [e.detail.response_id],
        )
      )[0];
      expect(resp).toEqual({
        source: "import",
        created_by: "the CEO's word (Q5), 2026-11-01",
        created_by_id: null,
      });
      expect(
        await one(
          "SELECT count(*)::int AS r FROM cockpit_slack_notices WHERE kind='churn.confirmed'",
        ),
      ).toBe(0);
      const writes = await one(
        "SELECT payload->'writes' AS r FROM cockpit_clickup_writeback_queue WHERE dedupe_key=$1",
        [`billing:${ev}`],
      );
      expect(writes.map((w: Row) => w.field)).toContain("pausedOn");
      // A second run refuses the confirmed row.
      expect(
        (
          await refusal(() =>
            q("SELECT public.cockpit_churn_backfill_confirm(20)"),
          )
        ).message,
      ).toContain("was already confirmed on");
    });
  });

  test("Joe and Sera (184 days, card type Mid-programme loss) stays mid_programme", async () => {
    await rolledBack(async () => {
      const ev = Number(
        await one("SELECT public.cockpit_churn_backfill_confirm(21) AS r"),
      );
      expect(
        await one(
          "SELECT churn_type AS r FROM cockpit_churn_departures WHERE id=21",
        ),
      ).toBe("mid_programme");
      expect(
        await one(
          "SELECT detail->>'card_type' AS r FROM cockpit_billing_events WHERE id=$1",
          [ev],
        ),
      ).toBe("Mid-programme loss (counts as churn)");
      expect(
        await one(
          "SELECT detail->>'clear_paused' AS r FROM cockpit_billing_events WHERE id=$1",
          [ev],
        ),
      ).toBe("false");
    });
  });

  test("an empty card type falls back to the day-90 default; a signed-in seat is refused", async () => {
    await rolledBack(async () => {
      await ex(
        "UPDATE cockpit_client_billing_days SET churn_type=NULL, next_renewal_date='2026-10-01' WHERE clickup_task_id='taskJoe'",
      );
      await one("SELECT public.cockpit_churn_backfill_confirm(21) AS r");
      expect(
        await one(
          "SELECT churn_type AS r FROM cockpit_churn_departures WHERE id=21",
        ),
      ).toBe("completed");
    });
    await rolledBack(async () => {
      await ex(
        "GRANT EXECUTE ON FUNCTION public.cockpit_churn_backfill_confirm(bigint) TO authenticated",
      );
      const r = await refusal(() =>
        as(CEO, "SELECT public.cockpit_churn_backfill_confirm(21) AS r"),
      );
      expect(r.message).toBe(
        "The churn backfill runs only as the database owner, at deploy.",
      );
    });
  });
});

// --- Not leaving ---------------------------------------------------------------------------

describe("cockpit_form_notice_answer", () => {
  async function survey(
    task: string | null,
    token: string,
    hiddenName = "From The Form",
  ) {
    return one<string>(
      `INSERT INTO cockpit_form_responses(form_key,form_version,source,external_id,task_id,client_name,mode,state,answers,hidden,answer_meta,created_by,submitted_at)
      VALUES ('exit_survey',1,'typeform_webhook',$1,$2,NULL,'live','legacy',
              '{"fields":[{"ref":"r1","title":"How happy were you with the results?","type":"opinion_scale","value":3},{"ref":"r2","title":"Anything else?","type":"long_text","value":"call me"}]}',
              jsonb_build_object('client_name',$3::text),'{"notice_on":"2026-10-30"}','forms-door',now()) RETURNING id::text AS r`,
      [token, task, hiddenName],
    );
  }
  const answer = (who: string | null, id: string, a: string, note: string) =>
    as(who, "SELECT public.cockpit_form_notice_answer($1::uuid, $2, $3) AS r", [
      id,
      a,
      note,
    ]);

  test("the gate, the note minimum, one answer, and the row hidden after", async () => {
    await rolledBack(async () => {
      const id = await survey("taskAcme", "tokA");
      const inBefore = await as(
        CSM,
        "SELECT public.cockpit_csm_churn_read() AS r",
      );
      expect(inBefore.notices.map((n: Row) => n.responseId)).toContain(id);
      expect(
        inBefore.notices.find((n: Row) => n.responseId === id).ratings,
      ).toEqual([{ title: "How happy were you with the results?", value: 3 }]);
      expect(
        (
          await refusal(() =>
            answer(OTHER_CSM, id, "staying", "They signed again"),
          )
        ).message,
      ).toBe(
        "Acme Interiors is not one of your clients. Ask its CSM or the CEO to answer the notice.",
      );
      expect(
        (await refusal(() => answer(CSM, id, "staying", "ok"))).message,
      ).toBe("Say what the client said, so the answer reads back.");
      expect(
        (await refusal(() => answer(CSM, id, "handled", "They signed again")))
          .message,
      ).toBe(
        "A termination notice is answered with staying, a pause request with handled.",
      );
      expect(
        (await refusal(() => answer(null, id, "staying", "They signed again")))
          .message,
      ).toContain("permission denied");
      const r = await answer(
        CSM,
        id,
        "staying",
        "They signed for the second campaign on the call.",
      );
      expect(r.answer).toBe("staying");
      const meta = await one(
        "SELECT answer_meta AS r FROM cockpit_form_responses WHERE id=$1::uuid",
        [id],
      );
      expect(meta.notice_on).toBe("2026-10-30");
      expect(meta.answered).toMatchObject({
        answer: "staying",
        note: "They signed for the second campaign on the call.",
        by: "the CSM",
      });
      expect(
        (await refusal(() => answer(CEO, id, "staying", "Second answer")))
          .message,
      ).toMatch(/^This notice was answered on \d{1,2} [A-Z][a-z]{2} \d{4}\.$/);
      expect(
        await one(
          "SELECT count(*)::int AS r FROM cockpit_churn_log WHERE what='Answered the notice: staying'",
        ),
      ).toBe(1);
      expect(
        await one(
          "SELECT count(*)::int AS r FROM cockpit_audit_log WHERE action='forms.notice_answer' AND entity_id=$1",
          [id],
        ),
      ).toBe(1);
      const inAfter = await as(
        CSM,
        "SELECT public.cockpit_csm_churn_read() AS r",
      );
      expect(inAfter.notices.map((n: Row) => n.responseId)).not.toContain(id);
    });
  });

  test("an unmatched survey shows to every CSM and the CEO, and is answered only after its card is picked", async () => {
    await rolledBack(async () => {
      const id = await survey(null, "tokU", "حول العمران");
      for (const who of [CSM, OTHER_CSM, CEO]) {
        const read = await as(
          who,
          "SELECT public.cockpit_csm_churn_read() AS r",
        );
        expect(read.unmatched.map((n: Row) => n.responseId)).toContain(id);
        expect(
          read.unmatched.find((n: Row) => n.responseId === id).clientName,
        ).toBe("حول العمران");
      }
      expect(
        (await refusal(() => answer(CEO, id, "staying", "They are staying on")))
          .message,
      ).toBe("Pick the card first, so the answer lands on the right client.");
    });
  });

  test("outside the answer, a legacy row's answers stay as they were sent", async () => {
    await rolledBack(async () => {
      const id = await survey("taskAcme", "tokG");
      const r = await refusal(() =>
        q(
          `UPDATE cockpit_form_responses SET answer_meta = answer_meta || '{"answered":{"answer":"staying"}}' WHERE id=$1::uuid`,
          [id],
        ),
      );
      expect(r.message).toBe("Sent notes keep their answers");
      await ex("SELECT set_config('cockpit.forms_legacy','answer',true)");
      const twice = await refusal(() =>
        q(
          `UPDATE cockpit_form_responses SET answer_meta = '{}' WHERE id=$1::uuid`,
          [id],
        ),
      );
      expect(twice.message).toBe("Sent notes keep their answers");
    });
  });
});

// --- The tracker's read ---------------------------------------------------------------------

describe("cockpit_csm_churn_read", () => {
  test("departures carry the confirm columns; Stopped cards not in the register are listed for review", async () => {
    await rolledBack(async () => {
      const r = await confirmAs(CEO, confirmArgs("taskAcme"));
      const read = await as(CSM, "SELECT public.cockpit_csm_churn_read() AS r");
      const acme = read.deps.find((d: Row) => d.id === Number(r.departureId));
      expect(acme).toMatchObject({
        churn_type: "mid_programme",
        survey_state: "not_sent",
        confirmed_role: "the CEO",
        card_state: "queued",
        churn_type_default: "mid_programme",
      });
      const joe = read.deps.find((d: Row) => d.id === 21);
      expect(joe).toMatchObject({
        confirmed_at: null,
        confirmed_role: null,
        card_state: null,
      });
      const gone = read.stoppedNotInRegister.find(
        (s: Row) => s.taskId === "taskGone",
      );
      expect(gone).toEqual({
        taskId: "taskGone",
        clientName: "Gone Co",
        churnDate: null,
        mrrUsd: null,
        csm: "The CSM",
        stoppedSince: null,
        typeDefault: "mid_programme",
      });
      expect(read.stoppedNotInRegister.map((s: Row) => s.taskId)).not.toContain(
        "taskJoe",
      );
      expect(read.stoppedNotInRegister.map((s: Row) => s.taskId)).not.toContain(
        "taskAcme",
      );
      // Another CSM sees none of these clients.
      const other = await as(
        OTHER_CSM,
        "SELECT public.cockpit_csm_churn_read() AS r",
      );
      expect(other.stoppedNotInRegister).toEqual([]);
      expect(other.deps).toEqual([]);
    });
  });
});

// --- The lifecycle view ---------------------------------------------------------------------

describe("cockpit_client_lifecycle_v and its read", () => {
  test("a paused, an extended, a late and a churned card", async () => {
    const t = await today();
    await rolledBack(async () => {
      await confirmAs(CSM, confirmArgs("taskAcme"));
      const rows = new Map(
        (await q("SELECT * FROM cockpit_client_lifecycle_v")).map(r => [
          r.clickup_task_id,
          r,
        ]),
      );
      expect(rows.size).toBe(9);
      expect(rows.get("taskPaused")).toMatchObject({
        pause_kind: "client_request",
        pause_days: 20,
        ladder_step: "pause_day14",
        days_late: null,
      });
      expect(String(rows.get("taskPaused")?.pause_restart)).toContain(
        addDays(t, 10).slice(0, 4),
      );
      expect(
        await one(
          "SELECT pause_restart::text AS r FROM cockpit_client_lifecycle_v WHERE clickup_task_id='taskPaused'",
        ),
      ).toBe(addDays(t, 10));
      expect(
        await one(
          "SELECT extension_until::text AS r FROM cockpit_client_lifecycle_v WHERE clickup_task_id='taskExt'",
        ),
      ).toBe(addDays(t, 10));
      expect(rows.get("taskExt")).toMatchObject({
        ladder_step: "none",
        days_late: null,
      });
      expect(rows.get("taskLate")).toMatchObject({
        days_late: 16,
        ladder_step: "cancel_review",
        extension_until: null,
      });
      expect(rows.get("taskAcme")?.churn_confirmed_at).not.toBeNull();
      expect(rows.get("taskAcme")).toMatchObject({
        client_status: "Stopped",
        survey_state: "not_sent",
        ladder_step: "none",
      });
      expect(rows.get("taskBeta")).toMatchObject({
        departure_id: null,
        left_on: null,
        days_late: null,
        pause_kind: null,
        extension_until: null,
      });
      // The ladder's days come from billing.ladder once it exists.
      await ex(
        `INSERT INTO cockpit_settings(key,value,updated_by) VALUES ('billing.ladder','{"pauseReviewDay":4,"cancelReviewDay":20}','test')`,
      );
      expect(
        await one(
          "SELECT ladder_step AS r FROM cockpit_client_lifecycle_v WHERE clickup_task_id='taskLate'",
        ),
      ).toBe("pause_review");
    });
  });

  test("the read: allowed card only, latest five events with roles and never an email", async () => {
    const mine = await as(
      CSM,
      "SELECT public.cockpit_client_lifecycle_read('taskPaused') AS r",
    );
    expect(mine.pause_kind).toBe("client_request");
    expect(mine.events[0]).toMatchObject({
      kind: "pause",
      seatRole: "the CSM",
      voided: false,
    });
    expect(JSON.stringify(mine.events)).not.toContain("@");
    expect(
      (
        await refusal(() =>
          as(
            OTHER_CSM,
            "SELECT public.cockpit_client_lifecycle_read('taskPaused') AS r",
          ),
        )
      ).message,
    ).toBe("Paused Co is not one of your clients.");
    expect(
      (
        await as(
          FINANCE,
          "SELECT public.cockpit_client_lifecycle_read('taskPaused') AS r",
        )
      ).client_name,
    ).toBe("Paused Co");
    expect(
      (
        await refusal(() =>
          as(
            null,
            "SELECT public.cockpit_client_lifecycle_read('taskPaused') AS r",
          ),
        )
      ).message,
    ).toContain("permission denied");
  });
});

// --- The CEO's register (churnRegister.ts, 4.5.3) ---------------------------------------------

describe("the CEO reads the confirm", () => {
  test("Confirmed {date} by {role}, or Logged, not confirmed, in Kuwait time", () => {
    expect(
      departureState({
        confirmedAt: "2026-10-31T22:30:00Z",
        confirmedRole: "the CSM",
      }),
    ).toBe("Confirmed 1 Nov by the CSM");
    expect(departureState({ confirmedAt: null, confirmedRole: null })).toBe(
      "Logged, not confirmed",
    );
    expect(
      departureState({ confirmedAt: "not a time", confirmedRole: "the CEO" }),
    ).toBe("Logged, not confirmed");
  });

  test("the month's count, and nothing at all when the payload has no rows", () => {
    const rows = [
      {
        client: "Atlantis Contracting",
        leftOn: "2026-10-18",
        confirmedAt: "2026-11-01T08:00:00Z",
        confirmedRole: "the CEO",
      },
      {
        client: "Joe and Sera Company",
        leftOn: "2026-10-29",
        confirmedAt: null,
        confirmedRole: null,
      },
      {
        client: "Older Co",
        leftOn: "2026-09-02",
        confirmedAt: null,
        confirmedRole: null,
      },
    ];
    expect(confirmSummary(rows, "2026-10")).toBe(
      "1 of 2 confirmed · 1 logged, not confirmed",
    );
    expect(confirmSummary(rows.slice(0, 1), "2026-10")).toBe("All 1 confirmed");
    expect(confirmSummary(rows, "2026-11")).toBeNull();
    expect(confirmSummary(undefined)).toBeNull();
    const month = {
      month: "2026-10",
      activeAtStart: 21,
      newClients: 3,
      churned: 2,
      churnPct: 9.5,
      rolling3Pct: 9.5,
    };
    expect(
      churnView({ months: [month], departureRows: rows } as never, "2026-10")
        ?.confirmed,
    ).toBe("1 of 2 confirmed · 1 logged, not confirmed");
    expect(churnView({ months: [month] }, "2026-10")?.confirmed).toBeNull();
    expect(churnView([month], "2026-10")?.confirmed).toBeNull();
  });
});
