/**
 * The ClickUp writer's 1-1 notes lane (20261029t_forms_clickup_writeback.sql,
 * docs/forms/STAGE2B-CONTRACT.md 2.4, 3.3 and build 1) on an isolated
 * PostgreSQL with Supabase's default privileges on, so a missing REVOKE opens
 * a function here as it would in production.
 *
 * It stands on the 2a base, applied as the Stage 2a fit applies it (its cut
 * of the canonical definitions, then 20261024a, 20261025n, 20261025o,
 * 20261026r, 20261026s, 20261026t, 20261027f, 20261027g and 20261027h), then
 * 20261029s_forms_registry.sql (the owner gate, 3.1) when the db builder has
 * delivered it, 20261029t twice, and 20261029w_forms_dispatch.sql (the settle
 * triggers, 3.6) when that is delivered. Until 20261029s exists the gate is a
 * stand-in written to 3.1's table, so every gate case runs against 3.1's shape
 * either way; the cases that need w's settle triggers run only once w exists.
 *
 * Covered: the two CHECKs; the replaced log claim never takes a form row and
 * otherwise equals the live body; claim_forms by mode (unknown, dry_run,
 * apply, apply_limited and its canary), order, lanes, stale sending, the
 * limit and two claims that never share a row (PGlite has one connection, so
 * "concurrent" is two claims in a row with different tokens); every gate
 * refusal and the unknown-effect failure; release, the mode mirror, the state
 * row, the kick (with a vault and pg_net stand-in in a rolled-back
 * transaction; it posts nothing while a forms run is still writing) and the
 * doctor's inputs; the body-diff rule for the claim,
 * release, begin and idle; the ACLs of 2.2 and 2.4; the drift guard; twice
 * safe. Every person, client, card and response is invented; the field and
 * option ids are ClickUp's own (20261027h), no secret. PGlite has no pg_cron,
 * vault or pg_net, so the guarded blocks skip. Nothing here reaches ClickUp.
 */

import {
  afterAll,
  beforeAll,
  describe,
  expect,
  setDefaultTimeout,
  test,
} from "bun:test";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import type { PGlite } from "@electric-sql/pglite";
import { cockpitTestDb, member, migration } from "./lib/cockpitTestDb";

// Keep direct, ship and readiness runs consistent on busy build hosts.
setDefaultTimeout(120_000);

const N = "20261025n_slack_notices.sql";
const O = "20261025o_blueprint_close_drain.sql";
const R = "20261026r_requests.sql";
const S = "20261026s_request_types_seed.sql";
const T = "20261026t_task_alerts.sql";
const V = "20261027f_forms_core.sql";
const W = "20261027g_fathom_intake.sql";
const X = "20261027h_checkin_plans.sql";
const REGISTRY = "20261029s_forms_registry.sql";
const WRITEBACK = "20261029t_forms_clickup_writeback.sql";
const DISPATCH = "20261029w_forms_dispatch.sql";
const exists = (file: string) =>
  existsSync(new URL(`../../../supabase/migrations/${file}`, import.meta.url));
const HAS_S = exists(REGISTRY);
const HAS_W = exists(DISPATCH);

const SEAT = "00000000-0000-4000-8000-0000000000a1"; // the CSM
const CSM_EMAIL = "csm@tests.invalid";
const A = "taskA1"; // Acme Interiors
const B = "taskB1"; // Beta Build
const TEST_CARD = "86eywg1cq";
const CLIENT: Record<string, string> = {
  [A]: "Acme Interiors",
  [B]: "Beta Build",
  [TEST_CARD]: "Test client",
};
const HAPPY_FIELD = "4e3924e3-4898-4e98-aca1-cc1ac3015b73";
const LAST_POC = "e183f2ce-8b7a-491a-b160-2287a247758b";
const LAST_CALL = "032203ad-e327-4d76-a0ce-c07496da6486";
const HAPPY = "c5d6b01f-5f2b-40c1-afac-5b9f1efab213";
const ORDER = [
  "todo_comment",
  "happiness",
  "last_poc",
  "last_checkin_call",
] as const;
type Key = (typeof ORDER)[number];
const SVC = "{postgres=X/postgres,service_role=X/postgres}";
const OWNER = "{postgres=X/postgres}";

const NO_EFFECT =
  "No 1-1 notes effect points at this write, so nothing was written.";
const SETTLED =
  "This write was settled in the cockpit, so nothing was written.";
const MAKE = "Make owns this again.";
const MAKE_UNKNOWN =
  "Make owns this again. An earlier try may have reached the card, so check it in ClickUp.";

let db: PGlite;
type Row = Record<string, any>;

function cut(sql: string, pattern: RegExp, what: string): string {
  const hit = sql.match(pattern);
  if (!hit) throw new Error(`Canonical definition missing: ${what}`);
  return hit[0];
}
async function asOwner() {
  await db.exec("RESET ROLE");
  await db.query("SELECT set_config('request.jwt.claim.sub','',false)");
  await db.query("SELECT set_config('request.jwt.claims','',false)");
}
async function q<X = Row>(text: string, params: unknown[] = []): Promise<X[]> {
  await asOwner();
  return (await db.query<X>(text, params)).rows;
}
/** One value as PostgREST with the service key: role service_role in the claims. */
async function svc<X = any>(text: string, params: unknown[] = []): Promise<X> {
  await asOwner();
  await db.query("SELECT set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({ role: "service_role" }),
  ]);
  await db.exec("SET ROLE service_role");
  try {
    return (await db.query<{ r: X }>(text, params)).rows[0]?.r as X;
  } finally {
    await asOwner();
  }
}
let open = false;
/**
 * A refusal the case expects, as the owner, the service key (with or without its claims) or a seat: under a
 * savepoint inside rolledBack, else in a transaction of its own, so nothing it did stays.
 */
async function refusal(
  who: "owner" | "service" | "service-no-claims" | "authenticated",
  text: string,
  params: unknown[] = [],
) {
  await asOwner();
  await db.exec(open ? "SAVEPOINT expected_refusal" : "BEGIN");
  const undo = open
    ? "ROLLBACK TO SAVEPOINT expected_refusal; RELEASE SAVEPOINT expected_refusal"
    : "ROLLBACK";
  try {
    if (who === "service")
      await db.query("SELECT set_config('request.jwt.claims',$1,true)", [
        JSON.stringify({ role: "service_role" }),
      ]);
    if (who === "service" || who === "service-no-claims")
      await db.exec("SET LOCAL ROLE service_role");
    if (who === "authenticated") {
      await db.query("SELECT set_config('request.jwt.claims',$1,true)", [
        JSON.stringify({ sub: SEAT, role: "authenticated" }),
      ]);
      await db.exec("SET LOCAL ROLE authenticated");
    }
    await db.query(text, params);
  } catch (e) {
    await db.exec(undo);
    await asOwner();
    return {
      message: (e as Error).message,
      code: String((e as { code?: string }).code ?? ""),
    };
  }
  await db.exec(undo);
  await asOwner();
  throw new Error(`Expected a refusal for ${text}`);
}
/** Runs as the owner inside a transaction that is always rolled back. */
async function rolledBack(fn: () => Promise<void>) {
  await asOwner();
  await db.exec("BEGIN");
  open = true;
  try {
    await fn();
  } finally {
    open = false;
    await db.exec("ROLLBACK");
    await asOwner();
  }
}
const norm = (s: string) => s.replace(/\s+/g, " ");
const md5 = (s: string) => createHash("md5").update(norm(s)).digest("hex");
const sha256 = (s: string) =>
  createHash("sha256").update(s, "utf8").digest("hex");
/** A function's body as a migration file writes it (its last definition in that file). */
function fileBody(file: string, name: string): string {
  const sql = migration(file);
  const at = sql.lastIndexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  if (at < 0) throw new Error(`${name} is not defined in ${file}`);
  const tag = /AS (\$[A-Za-z_]*\$)/.exec(sql.slice(at));
  if (!tag) throw new Error(`${name} has no body in ${file}`);
  const start = at + (tag.index ?? 0) + tag[0].length;
  return sql.slice(start, sql.indexOf(tag[1], start));
}
async function installed(
  sig: string,
): Promise<{ src: string; acl: string; md5: string }> {
  const [r] = await q<{ src: string; acl: string; md5: string }>(
    `SELECT p.prosrc AS src, p.proacl::text AS acl, md5(regexp_replace(p.prosrc, '\\s+', ' ', 'g')) AS md5
       FROM pg_proc p WHERE p.oid = to_regprocedure($1)`,
    [`public.${sig}`],
  );
  if (!r) throw new Error(`${sig} is not installed`);
  return r;
}
/** The drift guard's after value for one function, as written in this file. */
function afterValue(sig: string): string {
  const hit = new RegExp(
    `\\('${sig.replace(/[()[\]]/g, m => `\\${m}`)}', '([0-9a-f]{32})', '([0-9a-f]{32})'\\)`,
  ).exec(migration(WRITEBACK));
  if (!hit) throw new Error(`No drift guard row for ${sig}`);
  return hit[2];
}

// --- The fixtures ------------------------------------------------------------------------------

let seq = 0;
const nextId = (prefix: string) =>
  `${prefix}-0000-4000-8000-${String(++seq).padStart(12, "0")}`;
const COMMENT =
  "*1-1 notes*\nMahara: Send the invented plan\nClient: Share the invented files";
function plan(key: Key, task: string): Row {
  const lines = [`Would write ${key}.`];
  if (key === "todo_comment")
    return {
      taskId: task,
      comment_text: COMMENT,
      notify_all: false,
      items: 2,
      sides: { ours: 1, theirs: 1 },
      lines,
    };
  if (key === "happiness")
    return {
      taskId: task,
      field: HAPPY_FIELD,
      label: "Happy",
      value: HAPPY,
      lines,
    };
  const day = key === "last_poc" ? "2026-10-25" : "2026-10-24";
  return {
    taskId: task,
    field: key === "last_poc" ? LAST_POC : LAST_CALL,
    day,
    value: Date.parse(`${day}T09:00:00Z`),
    value_options: { time: false },
    rule: "forward_only",
    lines,
  };
}
async function response(
  task: string,
  mode: "live" | "shadow" = "live",
): Promise<string> {
  const id = nextId("60000000");
  await q(
    `INSERT INTO public.cockpit_form_responses(id, form_key, form_version, source, task_id, client_name, mode, state, answers,
       created_by, created_by_id, submitted_by, submitted_at)
     VALUES ($1,'checkin',1,'cockpit',$2,$3,$4,'submitted','{}'::jsonb,$5,$6,$5,now())`,
    [id, task, CLIENT[task], mode, CSM_EMAIL, SEAT],
  );
  return id;
}
/**
 * One check-in effect the cockpit owns and the queue row 20261029w makes of it (3.3), the effect queued
 * with delivery_ref = the row. `minutesAgo` dates the row (and the lane order).
 */
async function formRow(
  responseId: string,
  key: Key,
  task: string,
  opts: {
    minutesAgo?: number;
    effectState?: "queued" | "unknown" | "delivered";
    ref?: boolean;
  } = {},
): Promise<{ effectId: string; queueId: string }> {
  const p = plan(key, task);
  const [{ id: effectId }] = await q<{ id: string }>(
    `INSERT INTO public.cockpit_form_effects(response_id, form_key, effect_key, dedupe_key, owner, delivery, plan, state)
     VALUES ($1::uuid,'checkin',$2,$1::uuid::text || ':' || $2,'cockpit','clickup_queue',$3::jsonb,'planned') RETURNING id`,
    [responseId, key, JSON.stringify(p)],
  );
  const { lines: _lines, comment_text, ...rest } = p;
  const payload = {
    formKey: "checkin",
    responseId,
    effectId,
    effectKey: key,
    taskId: task,
    clientName: CLIENT[task],
    ...rest,
    ...(comment_text
      ? {
          commentChars: comment_text.length,
          commentSha256: sha256(comment_text),
        }
      : {}),
  };
  const [{ id: queueId }] = await q<{ id: string }>(
    `INSERT INTO public.cockpit_clickup_writeback_queue(dedupe_key, kind, source_table, source_id, task_id, payload, created_at)
     VALUES ($1::text || ':' || $2,'form','cockpit_form_effects',$3,$4,$5::jsonb, now() - make_interval(mins => $6)) RETURNING id`,
    [
      responseId,
      key,
      effectId,
      task,
      JSON.stringify(payload),
      opts.minutesAgo ?? 0,
    ],
  );
  if (opts.ref !== false) {
    await q(
      "UPDATE public.cockpit_form_effects SET state='queued', delivery_ref=$2, receipt=jsonb_build_object('queueId',$2::text) WHERE id=$1",
      [effectId, queueId],
    );
    if (opts.effectState === "unknown")
      await q(
        "UPDATE public.cockpit_form_effects SET state='unknown' WHERE id=$1",
        [effectId],
      );
    if (opts.effectState === "delivered")
      await q(
        "UPDATE public.cockpit_form_effects SET state='delivered' WHERE id=$1",
        [effectId],
      );
  }
  return { effectId, queueId };
}
/** All four ClickUp effects of one response, in Make's order. */
async function fourRows(responseId: string, task: string, minutesAgo = 0) {
  const out: Record<string, { effectId: string; queueId: string }> = {};
  for (const key of ORDER)
    out[key] = await formRow(responseId, key, task, { minutesAgo });
  return out;
}
/** The registry owner of the four ClickUp effects (direct, as the 2a suites flip it; Z12 adds no guard). */
/**
 * The registry as the cut-over or its rollback leaves it: the four ClickUp effects' owner, and the provider with it,
 * because the owner gate passes nothing while the provider is typeform (20261029s). Every case runs in one
 * transaction, so provider_since and the responses' submitted_at are the same now() and the gate's >= holds.
 */
async function owners(owner: "shadow" | "cockpit") {
  await q(
    `UPDATE public.cockpit_forms SET provider = CASE WHEN $1::text = 'cockpit' THEN 'native' ELSE 'typeform' END, effects = (
       SELECT jsonb_agg(CASE WHEN e->>'delivery' = 'clickup_queue' THEN jsonb_set(e, '{owner}', to_jsonb($1::text)) ELSE e END ORDER BY n)
         FROM jsonb_array_elements(effects) WITH ORDINALITY AS x(e, n)) WHERE key = 'checkin'`,
    [owner],
  );
}
/** The writer's report, as runForms makes it through cockpit_clickup_forms_state. */
async function mode(
  m: "dry_run" | "apply" | "apply_limited",
  cards: string[] = [],
) {
  await svc(
    "SELECT public.cockpit_clickup_forms_state(true, 'Nothing to write.', $1, $2::text[], '{}'::jsonb) AS r",
    [m, cards],
  );
}
async function claim(token: string, limit?: number): Promise<Row[]> {
  return svc(
    limit === undefined
      ? "SELECT public.cockpit_clickup_writeback_claim_forms($1::uuid) AS r"
      : "SELECT public.cockpit_clickup_writeback_claim_forms($1::uuid, $2) AS r",
    limit === undefined ? [token] : [token, limit],
  );
}
async function queueRow(id: string): Promise<Row> {
  return (
    await q(
      "SELECT * FROM public.cockpit_clickup_writeback_queue WHERE id=$1",
      [id],
    )
  )[0];
}
async function effectRow(id: string): Promise<Row> {
  return (
    await q("SELECT * FROM public.cockpit_form_effects WHERE id=$1", [id])
  )[0];
}
/** Settle every open form row, so each case starts with an empty lane. */
async function clearLanes() {
  await q(
    `UPDATE public.cockpit_clickup_writeback_queue SET state='skipped', claim_token=NULL, claimed_at=NULL, error='Cleared by the test.'
      WHERE kind='form' AND state IN ('queued','sending','retry','unknown')`,
  );
}

/**
 * The owner gate of 3.1 until 20261029s is delivered: the same answers in the same order. With 20261029s
 * present the real gate is applied instead and nothing here is created.
 */
const GATE_STAND_IN = `
CREATE OR REPLACE FUNCTION public.cockpit_form_effect_owner(p_form_key text, p_effect_key text)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT e->>'owner' FROM public.cockpit_forms f, jsonb_array_elements(f.effects) e
   WHERE f.key = p_form_key AND e->>'key' = p_effect_key LIMIT 1
$$;
CREATE OR REPLACE FUNCTION public.cockpit_form_effect_gate(p_delivery text, p_ref text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE e public.cockpit_form_effects; v_n integer; v_final integer;
BEGIN
  SELECT count(*), count(*) FILTER (WHERE x.state IN ('delivered','skipped','failed','dry_run')) INTO v_n, v_final
    FROM public.cockpit_form_effects x WHERE x.delivery = p_delivery AND x.delivery_ref = p_ref;
  IF v_n = 0 THEN
    RETURN jsonb_build_object('ok', false, 'effectId', NULL, 'responseId', NULL, 'formKey', NULL, 'effectKey', NULL,
      'effectState', NULL, 'reason', '${NO_EFFECT}');
  END IF;
  SELECT x.* INTO e FROM public.cockpit_form_effects x JOIN public.cockpit_form_responses r ON r.id = x.response_id
   WHERE x.delivery = p_delivery AND x.delivery_ref = p_ref AND x.state IN ('queued','unknown') AND x.owner = 'cockpit'
     AND public.cockpit_form_effect_owner(x.form_key, x.effect_key) = 'cockpit' AND r.mode = 'live'
   ORDER BY (x.state = 'queued') DESC, x.created_at LIMIT 1;
  IF e.id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'effectId', e.id, 'responseId', e.response_id, 'formKey', e.form_key,
      'effectKey', e.effect_key, 'effectState', e.state, 'reason', NULL);
  END IF;
  SELECT x.* INTO e FROM public.cockpit_form_effects x WHERE x.delivery = p_delivery AND x.delivery_ref = p_ref
   ORDER BY (x.state IN ('delivered','skipped','failed','dry_run')), (x.state = 'queued') DESC, x.created_at LIMIT 1;
  RETURN jsonb_build_object('ok', false, 'effectId', e.id, 'responseId', e.response_id, 'formKey', e.form_key,
    'effectKey', e.effect_key, 'effectState', e.state,
    'reason', CASE WHEN v_final = v_n THEN '${SETTLED}' ELSE '${MAKE}' END);
END $$;
REVOKE ALL ON FUNCTION public.cockpit_form_effect_owner(text,text), public.cockpit_form_effect_gate(text,text)
  FROM PUBLIC, anon, authenticated, service_role;`;

// --- The database the file stands on ------------------------------------------------------------

/**
 * What Stage 1 and the ticketing read (the requests fit's cut), and what v, w
 * and x read (the db builder's cut), each from its canonical migration. The
 * call store keeps 20261011c's own grants (the service role keeps Supabase's
 * default DELETE and TRUNCATE, as live, until w revokes them); PL/pgSQL
 * resolves a declared row type when a function is created, so the store and
 * the sync state come before v.
 */
async function standOn() {
  for (const [file, pattern, what] of [
    [
      "20260921e_tap_charges.sql",
      /create table if not exists public\.cockpit_sync_state \([\s\S]*?\n\);/,
      "sync state",
    ],
    [
      "20261011c_csm_call_store.sql",
      /ALTER TABLE public\.cockpit_sync_state ADD COLUMN IF NOT EXISTS detail jsonb;/,
      "sync state detail",
    ],
    [
      "20260919b_people.sql",
      /create table if not exists public\.cockpit_people \([\s\S]*?\n\);/,
      "people",
    ],
    [
      "20260921b_people_schedule.sql",
      /alter table public\.cockpit_people\s+add column if not exists schedule jsonb;/,
      "schedule",
    ],
    [
      "20261015210000_eod_radar.sql",
      /CREATE TABLE IF NOT EXISTS public\.cockpit_eod_radar_slack_ids \([\s\S]*?\n\);/,
      "slack ids",
    ],
    [
      "20261005a_client_onboarding.sql",
      /create table if not exists public\.cockpit_client_onboarding \([\s\S]*?\n\);/,
      "onboarding",
    ],
    [
      "20261023a_csm_form_sends.sql",
      /CREATE TABLE IF NOT EXISTS public\.cockpit_csm_form_sends \([\s\S]*?\n\);/,
      "form sends",
    ],
  ] as const)
    await db.exec(cut(migration(file), pattern, what));

  // The client success roster and gate, and the seats' client rule.
  const roster = migration("20260927v_csm_read_models.sql");
  for (const [pattern, what] of [
    [
      /CREATE TABLE IF NOT EXISTS public\.cockpit_csm_source_state\([^\n]*\n/,
      "source state",
    ],
    [
      /INSERT INTO public\.cockpit_csm_source_state[^\n]*\n/,
      "source state rows",
    ],
    [
      /CREATE TABLE IF NOT EXISTS public\.cockpit_csm_sources\([^\n]*\n/,
      "csm sources",
    ],
  ] as const)
    await db.exec(cut(roster, pattern, what));
  await db.exec(
    cut(
      migration("20260927a_cockpit_ask_ai_jobs.sql"),
      /CREATE OR REPLACE FUNCTION public\.cockpit_ask_ai_owner_allowed\([\s\S]*?\$\$;/,
      "owner allowed",
    ),
  );
  const gate = migration("20261006c_csm_onboarding_checkins.sql");
  for (const [pattern, what] of [
    [
      /CREATE FUNCTION public\.cockpit_csm_client_gate_for_actor\([\s\S]*?END \$\$;/,
      "gate for actor",
    ],
    [
      /CREATE FUNCTION public\.cockpit_csm_client_gate\(p_task_id text\)[^\n]*\n/,
      "gate",
    ],
    [
      /REVOKE ALL ON FUNCTION public\.cockpit_csm_client_gate_for_actor[\s\S]*?GRANT EXECUTE ON FUNCTION public\.cockpit_csm_client_gate\(text\) TO authenticated;/,
      "gate grants",
    ],
  ] as const)
    await db.exec(cut(gate, pattern, what));
  const teamOnly = migration("20261017b_team_only_seats.sql");
  await db.exec(
    cut(
      teamOnly,
      /CREATE OR REPLACE FUNCTION public\.cockpit_is_team_only\(\)[\s\S]*?\$\$;/,
      "team only",
    ),
  );
  await db.exec(
    cut(
      teamOnly,
      /CREATE OR REPLACE FUNCTION public\.cockpit_client_allowed\(p_name text\)[\s\S]*?END \$function\$;/,
      "client allowed",
    ),
  );

  // The media side's client links (the matcher's aliases) and the call briefs the timeline reads.
  const media = migration("20260927w_media_read_models.sql");
  for (const [pattern, what] of [
    [
      /CREATE TABLE IF NOT EXISTS public\.cockpit_media_source_state\([\s\S]*?\n\);/,
      "media source state",
    ],
    [
      /INSERT INTO public\.cockpit_media_source_state[^\n]*\n/,
      "media source state rows",
    ],
    [
      /CREATE TABLE IF NOT EXISTS public\.cockpit_media_sources\([\s\S]*?\n\);/,
      "media sources",
    ],
  ] as const)
    await db.exec(cut(media, pattern, what));
  await db.exec(
    cut(
      migration("20261005f_cockpit_csm_history.sql"),
      /CREATE TABLE IF NOT EXISTS public\.cockpit_media_call_briefs \([\s\S]*?\n\);/,
      "call briefs",
    ),
  );

  // The call store: 20261011c's tables and grants, the live bodies w replaces, and the timeline.
  const store = migration("20261011c_csm_call_store.sql");
  for (const table of [
    "cockpit_csm_calls",
    "cockpit_csm_call_forms",
    "cockpit_fathom_meetings",
    "cockpit_csm_meta_activities",
    "cockpit_csm_changes",
    "cockpit_csm_unmatched",
    "cockpit_csm_match_audit",
  ])
    await db.exec(
      cut(
        store,
        new RegExp(
          `CREATE TABLE IF NOT EXISTS public\\.${table}\\([\\s\\S]*?\\n\\);`,
        ),
        table,
      ),
    );
  for (const [pattern, what] of [
    [
      /DO \$\$\nDECLARE t text;\nBEGIN\n {2}FOREACH t IN ARRAY ARRAY\['cockpit_csm_calls'[\s\S]*?public\.cockpit_csm_match_audit_id_seq TO service_role;/,
      "store grants",
    ],
    [
      /CREATE OR REPLACE FUNCTION public\.cockpit_csm_visible_tasks\(\)[\s\S]*?TO authenticated, service_role;/,
      "visible tasks",
    ],
    [
      /CREATE OR REPLACE FUNCTION public\.cockpit_csm_calls_summary\(\)[\s\S]*?GRANT EXECUTE ON FUNCTION public\.cockpit_csm_calls_summary\(\) TO authenticated;/,
      "calls summary",
    ],
  ] as const)
    await db.exec(cut(store, pattern, what));
  const privacy = migration("20261011d_csm_match_privacy.sql");
  for (const [pattern, what] of [
    [
      /CREATE OR REPLACE FUNCTION public\.cockpit_csm_unmatched_list\(\)[\s\S]*?GRANT EXECUTE ON FUNCTION public\.cockpit_csm_unmatched_list\(\) TO authenticated;/,
      "unmatched list",
    ],
    [
      /CREATE OR REPLACE FUNCTION public\.cockpit_csm_manual_match\([\s\S]*?GRANT EXECUTE ON FUNCTION public\.cockpit_csm_manual_match\(bigint,text\) TO authenticated;/,
      "manual match",
    ],
  ] as const)
    await db.exec(cut(privacy, pattern, what));
  await db.exec(migration("20261011f_csm_eod_mentions.sql"));

  // The creative read models, outbox and client action, whole; what the Blueprint migration reads beside them.
  await db.exec(migration("20260927s_creative_read_models.sql"));
  for (const [file, pattern, what] of [
    [
      "20261019120000_csm_decks.sql",
      /CREATE TABLE IF NOT EXISTS public\.cockpit_csm_deck_prep \([\s\S]*?\n\);/,
      "deck prep",
    ],
    [
      "20260927g_cockpit_media_actions.sql",
      /CREATE TABLE public\.cockpit_media_actions \([\s\S]*?\n\);/,
      "media actions",
    ],
    [
      "20261003a_client_logos.sql",
      /CREATE TABLE IF NOT EXISTS public\.cockpit_client_logos \([\s\S]*?\n\);/,
      "client logos",
    ],
  ] as const)
    await db.exec(cut(migration(file), pattern, what));

  // The sales index with the live column names; the exclusion w replaces is
  // LANGUAGE sql, so its tables exist before it is created.
  await db.exec(`
    CREATE TABLE public.cockpit_sales_recordings (
      recording_id text PRIMARY KEY, title text, recorded_by text, started_at timestamptz, duration_s integer,
      share_url text, contact_id text, appointment_id text, matched_by text, indexed_at timestamptz NOT NULL DEFAULT now(),
      source text, kind text, language text, people jsonb, summary text, action_items text, transcript_path text,
      transcript_chars integer, transcript_sha text, note_path text, duplicate_of text,
      hidden_reason text CHECK (hidden_reason IN ('duplicate','too short','client service','internal')));
    CREATE TABLE public.cockpit_sales_call_notes (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), recording_id text NOT NULL UNIQUE, contact_id text, call_type text,
      call_at timestamptz, rep text, notes jsonb NOT NULL, verdict text, verdict_why text, model text,
      written_at timestamptz NOT NULL DEFAULT now());
    ALTER TABLE public.cockpit_sales_recordings ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.cockpit_sales_call_notes ENABLE ROW LEVEL SECURITY;`);
  await db.exec(
    cut(
      migration("20261013112622_sales_client_call_exclusion.sql"),
      /create or replace function public\.cockpit_sales_call_exclusion\([\s\S]*?grant execute on function public\.cockpit_sales_call_exclusion\(text,text\) to service_role;/,
      "sales exclusion",
    ),
  );
  // The service gate of every service RPC, postgres-only as live (20261024a
  // brings cockpit_blueprint_first_name and 20261025n cockpit_slack_notice_role_of).
  await db.exec(
    cut(
      migration("20261009a_cockpit_team_hours.sql"),
      /CREATE OR REPLACE FUNCTION public\.cockpit_hours_require_service\(\)[\s\S]*?\$\$;/,
      "require service",
    ),
  );
  await db.exec(
    "REVOKE ALL ON FUNCTION public.cockpit_hours_require_service() FROM PUBLIC, anon, authenticated, service_role;",
  );

  // Stand-ins with the live column names (as the requests fit has them).
  await db.exec(`
    CREATE TABLE public.ghl_clients(location_id text PRIMARY KEY, client_name text, clickup_id text, country text, city text,
      language text, service_mode text);
    CREATE TABLE public.editor_clients(task_id text PRIMARY KEY, name text, dos_donts text, brand_dna_url text, brand_dna text,
      offer_url text, offer text, drive_url text, website text, instagram text, docs_read_at timestamptz, synced_at timestamptz);
    CREATE TABLE public.cockpit_csm_provider_health(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, action_id uuid,
      method text NOT NULL, resource text NOT NULL, phase text NOT NULL, http_status integer, object_id text,
      created_at timestamptz NOT NULL DEFAULT now(), provider text NOT NULL DEFAULT 'clickup', run_key text);
    CREATE TABLE public.cockpit_media_provider_health(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, action_id uuid,
      provider text NOT NULL, method text NOT NULL, resource text NOT NULL, phase text NOT NULL, http_status integer,
      object_id text, created_at timestamptz NOT NULL DEFAULT now(), native_run_id uuid, native_receipt_index integer);
    CREATE TABLE public.cockpit_decisions (id bigint PRIMARY KEY);
    CREATE TABLE public.cockpit_media_native_records (id uuid PRIMARY KEY);
    REVOKE ALL ON public.cockpit_sync_state, public.cockpit_people, public.cockpit_eod_radar_slack_ids,
      public.cockpit_client_onboarding, public.cockpit_csm_form_sends,
      public.cockpit_csm_source_state, public.cockpit_csm_sources, public.cockpit_csm_deck_prep,
      public.cockpit_media_actions, public.cockpit_client_logos, public.ghl_clients, public.editor_clients,
      public.cockpit_csm_provider_health, public.cockpit_media_provider_health, public.cockpit_decisions,
      public.cockpit_media_native_records FROM PUBLIC, anon, authenticated, service_role;
    REVOKE ALL ON public.cockpit_media_source_state, public.cockpit_media_sources, public.cockpit_media_call_briefs,
      public.cockpit_sales_recordings, public.cockpit_sales_call_notes FROM anon, authenticated;
    GRANT SELECT, INSERT ON public.cockpit_csm_provider_health, public.cockpit_media_provider_health TO service_role;
    GRANT SELECT, INSERT, UPDATE ON public.cockpit_media_actions, public.cockpit_sync_state TO service_role;`);

  // The writeback queue as it is live (20261009f with the billing kind of 20261009j).
  const wb = migration("20261009f_clickup_writeback_native.sql");
  for (const [pattern, what] of [
    [
      /CREATE TABLE IF NOT EXISTS public\.cockpit_clickup_writeback_config\([\s\S]*?\n\);/,
      "config",
    ],
    [
      /INSERT INTO public\.cockpit_clickup_writeback_config[^\n]*\n/,
      "config row",
    ],
    [
      /CREATE TABLE IF NOT EXISTS public\.cockpit_clickup_writeback_queue\([\s\S]*?\n\);/,
      "queue",
    ],
    [
      /CREATE TABLE IF NOT EXISTS public\.cockpit_clickup_writeback_runs\([\s\S]*?\n\);/,
      "runs",
    ],
    [
      /CREATE OR REPLACE FUNCTION public\.cockpit_clickup_writeback_audit\(\)[\s\S]*?END \$\$;/,
      "audit",
    ],
    [
      /DROP TRIGGER IF EXISTS cockpit_clickup_writeback_queue_audit_insert[\s\S]*?EXECUTE FUNCTION public\.cockpit_clickup_writeback_audit\(\);/,
      "insert trigger",
    ],
    [
      /DROP TRIGGER IF EXISTS cockpit_clickup_writeback_queue_audit_state[\s\S]*?EXECUTE FUNCTION public\.cockpit_clickup_writeback_audit\(\);/,
      "state trigger",
    ],
    [
      /CREATE OR REPLACE FUNCTION public\.cockpit_clickup_writeback_state\([\s\S]*?END \$\$;/,
      "state",
    ],
    [
      /CREATE OR REPLACE FUNCTION public\.cockpit_clickup_writeback_claim\([\s\S]*?END \$\$;/,
      "claim",
    ],
    [
      /CREATE OR REPLACE FUNCTION public\.cockpit_clickup_writeback_save\([\s\S]*?END \$\$;/,
      "save",
    ],
    [
      /CREATE OR REPLACE FUNCTION public\.cockpit_clickup_writeback_begin\([\s\S]*?END \$\$;/,
      "begin",
    ],
    [
      /CREATE OR REPLACE FUNCTION public\.cockpit_clickup_writeback_finish\([\s\S]*?END \$\$;/,
      "finish",
    ],
    [
      /CREATE OR REPLACE FUNCTION public\.cockpit_clickup_writeback_idle\([\s\S]*?END \$\$;/,
      "idle",
    ],
  ] as const)
    await db.exec(cut(wb, pattern, `20261009f ${what}`));
  await db.exec(
    cut(
      migration("20261009j_billing_clickup_writeback.sql"),
      /ALTER TABLE public\.cockpit_clickup_writeback_queue DROP CONSTRAINT IF EXISTS cockpit_clickup_writeback_queue_kind_check;\nALTER TABLE[\s\S]*?\)\);/,
      "billing kind",
    ),
  );
  await db.exec(`
    ALTER TABLE public.cockpit_clickup_writeback_queue ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.cockpit_clickup_writeback_runs ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.cockpit_clickup_writeback_config ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON public.cockpit_clickup_writeback_config, public.cockpit_clickup_writeback_queue, public.cockpit_clickup_writeback_runs
      FROM PUBLIC, anon, authenticated, service_role;
    GRANT SELECT, INSERT, UPDATE ON public.cockpit_clickup_writeback_config, public.cockpit_clickup_writeback_queue,
      public.cockpit_clickup_writeback_runs TO service_role;
    REVOKE ALL ON FUNCTION public.cockpit_clickup_writeback_claim(uuid,integer), public.cockpit_clickup_writeback_save(uuid,uuid,jsonb),
      public.cockpit_clickup_writeback_begin(text,text,boolean), public.cockpit_clickup_writeback_finish(uuid,boolean,text,jsonb,jsonb),
      public.cockpit_clickup_writeback_idle(text,boolean,text) FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.cockpit_clickup_writeback_claim(uuid,integer), public.cockpit_clickup_writeback_save(uuid,uuid,jsonb),
      public.cockpit_clickup_writeback_begin(text,text,boolean), public.cockpit_clickup_writeback_finish(uuid,boolean,text,jsonb,jsonb),
      public.cockpit_clickup_writeback_idle(text,boolean,text) TO service_role;`);
}

/** The four bodies before t, read off the 2a base. */
const before: Record<string, string> = {};
const SIGS = {
  claim: "cockpit_clickup_writeback_claim(uuid,integer)",
  release:
    "cockpit_clickup_writeback_release(uuid,uuid,jsonb,text,timestamptz)",
  begin: "cockpit_clickup_writeback_begin(text,text,boolean)",
  idle: "cockpit_clickup_writeback_idle(text,boolean,text)",
} as const;
const LIVE_MD5: Record<keyof typeof SIGS, string> = {
  claim: "39c142839f9d669354e9b0d0b6079842",
  release: "7329848a1ef67391a962c68b5ef67fd3",
  begin: "29906b33362f9cbcacd591e70071c0fa",
  idle: "e67840b5b981fe6fc5eca237a351c55c",
};
let firstApply: string | null = null;

beforeAll(async () => {
  db = await cockpitTestDb({ supabaseDefaultPrivileges: true });
  await standOn();
  await member(db, SEAT, CSM_EMAIL, ["csm"]);
  // Stage 1 whole, the ticketing and Stage 2a, as live.
  await db.exec(migration("20261024a_brand_blueprints.sql"));
  for (const file of [N, O, R, S, T, V, W, X]) await db.exec(migration(file));
  for (const [k, sig] of Object.entries(SIGS))
    before[k] = (await installed(sig)).md5;
  // The owner gate: 20261029s when the db builder has delivered it, else 3.1's stand-in.
  if (HAS_S) for (let i = 0; i < 2; i++) await db.exec(migration(REGISTRY));
  else await db.exec(GATE_STAND_IN);
  await db.exec(migration(WRITEBACK));
  firstApply = (await installed(SIGS.claim)).md5;
  await db.exec(migration(WRITEBACK));
  if (HAS_S && HAS_W)
    for (let i = 0; i < 2; i++) await db.exec(migration(DISPATCH));
}, 600_000);
afterAll(async () => {
  await db?.close();
});

describe("the base and the file", () => {
  test("the 2a base holds the bodies the contract read (2.2 live body md5)", () => {
    expect(before).toEqual(LIVE_MD5);
  });

  test("twice-safe: the second apply changes nothing and a third still applies", async () => {
    expect((await installed(SIGS.claim)).md5).toBe(firstApply as string);
    const snapshot = await q(
      "SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname LIKE 'cockpit_clickup_writeback_%' ORDER BY 1",
    );
    await db.exec(migration(WRITEBACK));
    expect(
      await q(
        "SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname LIKE 'cockpit_clickup_writeback_%' ORDER BY 1",
      ),
    ).toEqual(snapshot);
  });

  test("the CHECKs take kind 'form' and job 'forms', and keep every live value", async () => {
    const defs = Object.fromEntries(
      (
        await q<{ conname: string; def: string }>(
          `SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
          WHERE conname IN ('cockpit_clickup_writeback_queue_kind_check','cockpit_clickup_writeback_runs_job_check')`,
        )
      ).map(r => [r.conname, r.def]),
    );
    for (const kind of [
      "decision",
      "manual_change",
      "provider_action",
      "tracking_backlog",
      "billing",
      "request",
      "task_action",
      "form",
    ])
      expect(defs.cockpit_clickup_writeback_queue_kind_check).toContain(
        `'${kind}'`,
      );
    for (const job of ["kpi", "log", "dosdonts", "requests", "forms"])
      expect(defs.cockpit_clickup_writeback_runs_job_check).toContain(
        `'${job}'`,
      );
    await rolledBack(async () => {
      expect(
        (
          await refusal(
            "owner",
            "INSERT INTO public.cockpit_clickup_writeback_queue(dedupe_key, kind, source_table, source_id, payload) VALUES ('x:1','forms','t','1','{}')",
          )
        ).message,
      ).toMatch(/kind_check/);
      expect(
        (
          await refusal(
            "owner",
            "INSERT INTO public.cockpit_clickup_writeback_runs(job, mode) VALUES ('form','dry_run')",
          )
        ).message,
      ).toMatch(/job_check/);
      await q(
        "INSERT INTO public.cockpit_clickup_writeback_runs(job, mode) VALUES ('forms','dry_run')",
      );
    });
  });

  test("the lane index exists", async () => {
    const [ix] = await q<{ def: string }>(
      "SELECT pg_get_indexdef(indexrelid) AS def FROM pg_index WHERE indexrelid = 'public.cockpit_clickup_writeback_form_lane'::regclass",
    );
    expect(ix.def).toContain("(task_id, created_at)");
    expect(ix.def).toContain("kind = 'form'::text");
  });

  test("ACLs: the four replaced keep the service key alone; the new RPCs are service only; the mode and kick no role", async () => {
    for (const sig of Object.values(SIGS))
      expect((await installed(sig)).acl).toBe(SVC);
    for (const sig of [
      "cockpit_clickup_forms_state(boolean,text,text,text[],jsonb)",
      "cockpit_clickup_writeback_claim_forms(uuid,integer)",
      "cockpit_clickup_forms_doctor_inputs()",
    ])
      expect((await installed(sig)).acl).toBe(SVC);
    for (const sig of [
      "cockpit_clickup_forms_mode()",
      "cockpit_clickup_forms_kick()",
    ])
      expect((await installed(sig)).acl).toBe(OWNER);
    for (const sig of [
      ...Object.values(SIGS),
      "cockpit_clickup_writeback_claim_forms(uuid,integer)",
      "cockpit_clickup_forms_kick()",
    ])
      for (const role of ["anon", "authenticated"])
        expect(
          (
            await q<{ ok: boolean }>(
              "SELECT has_function_privilege($1, $2, 'EXECUTE') AS ok",
              [role, `public.${sig}`],
            )
          )[0].ok,
        ).toBe(false);
  });

  test("every service RPC refuses a seat, and the new ones refuse the service role without its claims", async () => {
    const token = nextId("70000000");
    expect(
      (
        await refusal(
          "authenticated",
          "SELECT public.cockpit_clickup_writeback_claim_forms($1::uuid)",
          [token],
        )
      ).message,
    ).toMatch(/permission denied/);
    expect(
      (
        await refusal(
          "service-no-claims",
          "SELECT public.cockpit_clickup_writeback_claim_forms($1::uuid)",
          [token],
        )
      ).code,
    ).toBe("42501");
    expect(
      (
        await refusal(
          "service-no-claims",
          "SELECT public.cockpit_clickup_forms_doctor_inputs()",
        )
      ).code,
    ).toBe("42501");
    expect(
      (
        await refusal(
          "service-no-claims",
          "SELECT public.cockpit_clickup_forms_state(true,'x','dry_run','{}'::text[],'{}'::jsonb)",
        )
      ).code,
    ).toBe("42501");
    expect(
      (await refusal("service", "SELECT public.cockpit_clickup_forms_kick()"))
        .message,
    ).toMatch(/permission denied/);
  });
});

describe("the body-diff rule (2.2): the live body with exactly the stated edits", () => {
  const edits: Record<keyof typeof SIGS, [string, string][]> = {
    claim: [
      [
        "    AND q.kind NOT IN ('request','task_action')",
        "    AND q.kind NOT IN ('request','task_action','form')",
      ],
    ],
    release: [
      [
        "  IF q.kind NOT IN ('request','task_action') THEN",
        "  IF q.kind NOT IN ('request','task_action','form') THEN",
      ],
      [
        "                  THEN 'unknown'\n",
        "                  THEN 'unknown'\n                  WHEN q.kind = 'form'\n                  THEN CASE WHEN jsonb_typeof(q.progress->'steps') = 'object' AND q.progress->'steps' <> '{}'::jsonb\n                            THEN 'retry' ELSE 'queued' END\n",
      ],
    ],
    begin: [
      [
        " IF p_job NOT IN('kpi','log','dosdonts','requests') OR",
        " IF p_job NOT IN('kpi','log','dosdonts','requests','forms') OR",
      ],
    ],
    idle: [
      [
        " IF p_job NOT IN('kpi','log','dosdonts','requests') THEN RETURN; END IF;",
        " IF p_job NOT IN('kpi','log','dosdonts','requests','forms') THEN RETURN; END IF;",
      ],
    ],
  };
  for (const [k, sig] of Object.entries(SIGS) as [keyof typeof SIGS, string][])
    test(k, async () => {
      let expected = fileBody(R, sig.split("(")[0]);
      expect(md5(expected)).toBe(LIVE_MD5[k]);
      for (const [from, to] of edits[k]) {
        expect(expected.split(from).length).toBe(2);
        expected = expected.replace(from, to);
      }
      const now = await installed(sig);
      expect(norm(now.src)).toBe(norm(expected));
      expect(norm(now.src)).toBe(norm(fileBody(WRITEBACK, sig.split("(")[0])));
      expect(now.md5).toBe(afterValue(sig));
    });
});

describe("the drift guard (2.1, Z61)", () => {
  const guard = () =>
    cut(
      migration(WRITEBACK),
      /DO \$\$\nDECLARE f record; v_md5 text;[\s\S]*?\nEND \$\$;/,
      "drift guard",
    );

  test("passes on the installed bodies and on the live ones", async () => {
    await rolledBack(async () => {
      await q(guard());
      // The live bodies, as 20261026r writes them: the guard's live value.
      for (const name of [
        "cockpit_clickup_writeback_claim",
        "cockpit_clickup_writeback_begin",
        "cockpit_clickup_writeback_idle",
      ])
        await q(
          cut(
            migration(R),
            new RegExp(
              `CREATE OR REPLACE FUNCTION public\\.${name}\\([\\s\\S]*?END \\$function\\$;`,
            ),
            name,
          ),
        );
      await q(
        cut(
          migration(R),
          /CREATE OR REPLACE FUNCTION public\.cockpit_clickup_writeback_release\([\s\S]*?END \$\$;/,
          "release",
        ),
      );
      for (const [k, sig] of Object.entries(SIGS))
        expect((await installed(sig)).md5).toBe(
          LIVE_MD5[k as keyof typeof SIGS],
        );
      await q(guard());
    });
  });

  test("refuses a stand-in body with the contract's sentence and code", async () => {
    await rolledBack(async () => {
      await q(`CREATE OR REPLACE FUNCTION public.cockpit_clickup_writeback_idle(p_job text, p_ok boolean, p_note text)
        RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$ BEGIN RETURN; END $function$`);
      const r = await refusal("owner", guard());
      expect(r.code).toBe("55000");
      expect(r.message).toBe(
        "public.cockpit_clickup_writeback_idle(text,boolean,text) changed since the 2b contract read it; stop and re-read it.",
      );
    });
  });

  test("refuses a missing function", async () => {
    await rolledBack(async () => {
      await q(
        "DROP FUNCTION public.cockpit_clickup_writeback_begin(text,text,boolean)",
      );
      expect((await refusal("owner", guard())).message).toBe(
        "public.cockpit_clickup_writeback_begin(text,text,boolean) changed since the 2b contract read it; stop and re-read it.",
      );
    });
  });
});

describe("the log claim never takes a form row", () => {
  test("a due form row stays queued while the log claim takes a decision beside it", async () => {
    await rolledBack(async () => {
      const rid = await response(A);
      const { queueId } = await formRow(rid, "happiness", A, {
        minutesAgo: 30,
      });
      await q(
        `INSERT INTO public.cockpit_clickup_writeback_queue(dedupe_key, kind, source_table, source_id, payload, created_at)
         VALUES ('manual:log-beside','tracking_backlog','cockpit_media_tracking_runs','1','{}'::jsonb, now() - interval '20 minutes')`,
      );
      const token = nextId("71000000");
      const got = await svc<Row[]>(
        "SELECT public.cockpit_clickup_writeback_claim($1::uuid, 50) AS r",
        [token],
      );
      expect(got.map(r => r.kind)).toEqual(["tracking_backlog"]);
      expect((await queueRow(queueId)).state).toBe("queued");
    });
  });
});

describe("claim_forms (4.1)", () => {
  test("takes nothing while the writer's mode is unknown or dry_run, and needs a token", async () => {
    await rolledBack(async () => {
      await owners("cockpit");
      const rid = await response(A);
      const rows = await fourRows(rid, A, 5);
      // Never reported: unknown.
      expect(await claim(nextId("72000000"))).toEqual([]);
      await mode("dry_run");
      expect(await claim(nextId("72000000"))).toEqual([]);
      // A report older than 15 minutes reads as unknown again.
      await mode("apply");
      await q(
        "UPDATE public.cockpit_sync_state SET detail = jsonb_set(detail, '{at}', to_jsonb(now() - interval '16 minutes')) WHERE key = 'clickup-writeback:forms'",
      );
      expect(await claim(nextId("72000000"))).toEqual([]);
      for (const r of Object.values(rows))
        expect((await queueRow(r.queueId)).state).toBe("queued");
      expect(
        (
          await refusal(
            "service",
            "SELECT public.cockpit_clickup_writeback_claim_forms(NULL)",
          )
        ).message,
      ).toBe("A claim token is required");
    });
  });

  test("apply: one response's rows together in Make's order, each with its effect's plan less its lines", async () => {
    await rolledBack(async () => {
      await owners("cockpit");
      await mode("apply");
      const rid = await response(A);
      // Inserted out of order: the claim orders them todo_comment, happiness, last_poc, last_checkin_call.
      const rows: Record<string, { effectId: string; queueId: string }> = {};
      for (const key of [
        "last_checkin_call",
        "happiness",
        "todo_comment",
        "last_poc",
      ] as Key[])
        rows[key] = await formRow(rid, key, A, { minutesAgo: 3 });
      const token = nextId("73000000");
      const got = await claim(token);
      expect(got.map(r => r.payload.effectKey)).toEqual([...ORDER]);
      for (const r of got) {
        expect(r).toMatchObject({
          state: "sending",
          claim_token: token,
          attempts: 1,
          kind: "form",
          task_id: A,
        });
        expect(r.effect.id).toBe(rows[r.payload.effectKey].effectId);
        expect(r.effect.state).toBe("queued");
        expect(r.effect.plan.lines).toBeUndefined();
        expect(r.effect.plan.taskId).toBe(A);
      }
      // The comment text comes only from the effect plan; the payload holds its length and fingerprint.
      const todo = got[0];
      expect(todo.effect.plan.comment_text).toBe(COMMENT);
      expect(JSON.stringify(todo.payload)).not.toContain("invented plan");
      expect(todo.payload.commentSha256).toBe(sha256(COMMENT));
    });
  });

  test("apply_limited: only the canary cards' rows; the rest stay queued", async () => {
    await rolledBack(async () => {
      await owners("cockpit");
      await mode("apply_limited", [TEST_CARD]);
      const onA = await formRow(await response(A), "happiness", A, {
        minutesAgo: 9,
      });
      const onTest = await formRow(
        await response(TEST_CARD),
        "happiness",
        TEST_CARD,
        { minutesAgo: 1 },
      );
      const got = await claim(nextId("74000000"));
      expect(got.map(r => r.id)).toEqual([onTest.queueId]);
      expect((await queueRow(onA.queueId)).state).toBe("queued");
    });
  });

  test("lanes: an older response on the card goes first; another card is not held", async () => {
    await rolledBack(async () => {
      await owners("cockpit");
      await mode("apply");
      const older = await fourRows(await response(A), A, 20);
      const newer = await fourRows(await response(A), A, 2);
      const elsewhere = await formRow(await response(B), "last_poc", B, {
        minutesAgo: 1,
      });
      const first = await claim(nextId("75000000"), 12);
      expect(first.map(r => r.id)).toEqual([
        ...ORDER.map(k => older[k].queueId),
        elsewhere.queueId,
      ]);
      // The older response's rows are freshly sending: the newer ones still wait.
      expect(await claim(nextId("75000000"), 12)).toEqual([]);
      for (const k of ORDER)
        expect((await queueRow(newer[k].queueId)).state).toBe("queued");
      // Once the older response is settled, the newer one goes.
      await q(
        "UPDATE public.cockpit_clickup_writeback_queue SET state='delivered', claim_token=NULL, claimed_at=NULL WHERE id = ANY($1::uuid[])",
        [ORDER.map(k => older[k].queueId)],
      );
      const next = await claim(nextId("75000000"), 12);
      expect(next.map(r => r.id)).toEqual(ORDER.map(k => newer[k].queueId));
    });
  });

  test("an open older row in retry or unknown on the card holds a newer response, not its own response's rows", async () => {
    await rolledBack(async () => {
      await owners("cockpit");
      await mode("apply");
      const r1 = await response(A);
      const waiting = await formRow(r1, "last_poc", A, { minutesAgo: 30 });
      const sibling = await formRow(r1, "last_checkin_call", A, {
        minutesAgo: 30,
      });
      await q(
        "UPDATE public.cockpit_clickup_writeback_queue SET state='retry', next_attempt_at = now() + interval '1 hour' WHERE id=$1",
        [waiting.queueId],
      );
      const later = await formRow(await response(A), "happiness", A, {
        minutesAgo: 1,
      });
      const got = await claim(nextId("76000000"));
      // r1's own sibling goes; the later response waits behind r1's row in retry.
      expect(got.map(r => r.id)).toEqual([sibling.queueId]);
      expect((await queueRow(later.queueId)).state).toBe("queued");
    });
  });

  test("a sending row older than ten minutes is claimed again; a fresh one is not", async () => {
    await rolledBack(async () => {
      await owners("cockpit");
      await mode("apply");
      const stale = await formRow(await response(A), "happiness", A, {
        minutesAgo: 40,
      });
      const fresh = await formRow(await response(B), "happiness", B, {
        minutesAgo: 40,
      });
      const old = nextId("77000000");
      await q(
        "UPDATE public.cockpit_clickup_writeback_queue SET state='sending', claim_token=$2, claimed_at=now() - interval '11 minutes', attempts=1 WHERE id=$1",
        [stale.queueId, old],
      );
      await q(
        "UPDATE public.cockpit_clickup_writeback_queue SET state='sending', claim_token=$2, claimed_at=now() - interval '2 minutes', attempts=1 WHERE id=$1",
        [fresh.queueId, old],
      );
      const token = nextId("77000000");
      const got = await claim(token);
      expect(got.map(r => r.id)).toEqual([stale.queueId]);
      expect(got[0]).toMatchObject({ claim_token: token, attempts: 2 });
      expect((await queueRow(fresh.queueId)).claim_token).toBe(old);
    });
  });

  test("the limit: 8 by default, 12 at most, 1 at least; two claims never share a row", async () => {
    await rolledBack(async () => {
      await owners("cockpit");
      await mode("apply");
      // Fourteen cards, one row each, so no lane holds any of them.
      const ids: string[] = [];
      for (let i = 0; i < 14; i++) {
        const card = `taskL${String(i).padStart(2, "0")}`;
        CLIENT[card] = `Lane Client ${i}`;
        ids.push(
          (
            await formRow(await response(card), "happiness", card, {
              minutesAgo: 30 - i,
            })
          ).queueId,
        );
      }
      const a = await claim(nextId("78000000"));
      expect(a.length).toBe(8);
      const b = await claim(nextId("78000000"), 50);
      expect(b.length).toBe(6);
      expect(new Set([...a, ...b].map(r => r.id)).size).toBe(14);
      expect([...a, ...b].map(r => r.id)).toEqual(ids);
      await q(
        "UPDATE public.cockpit_clickup_writeback_queue SET state='queued', claim_token=NULL, claimed_at=NULL WHERE id = ANY($1::uuid[])",
        [ids],
      );
      expect((await claim(nextId("78000000"), 50)).length).toBe(12);
      await q(
        "UPDATE public.cockpit_clickup_writeback_queue SET state='queued', claim_token=NULL, claimed_at=NULL WHERE id = ANY($1::uuid[])",
        [ids],
      );
      expect((await claim(nextId("78000000"), 0)).length).toBe(1);
    });
  });
});

describe("claim_forms asks the owner gate (3.1) and settles each refusal itself", () => {
  test("no effect points at the row: skipped with the gate's sentence, the claim cleared", async () => {
    await rolledBack(async () => {
      await owners("cockpit");
      await mode("apply");
      const { queueId } = await formRow(await response(A), "happiness", A, {
        minutesAgo: 5,
        ref: false,
      });
      expect(await claim(nextId("79000000"))).toEqual([]);
      expect(await queueRow(queueId)).toMatchObject({
        state: "skipped",
        error: NO_EFFECT,
        claim_token: null,
        claimed_at: null,
      });
    });
  });

  test("a settled effect: skipped with 'This write was settled in the cockpit'", async () => {
    await rolledBack(async () => {
      await owners("cockpit");
      await mode("apply");
      const { queueId } = await formRow(await response(A), "happiness", A, {
        minutesAgo: 5,
        effectState: "delivered",
      });
      expect(await claim(nextId("79100000"))).toEqual([]);
      expect(await queueRow(queueId)).toMatchObject({
        state: "skipped",
        error: SETTLED,
        claim_token: null,
      });
    });
  });

  test("the registry owner back to shadow: skipped 'Make owns this again.'", async () => {
    await rolledBack(async () => {
      await owners("cockpit");
      await mode("apply");
      const rows = await fourRows(await response(A), A, 5);
      await owners("shadow");
      expect(await claim(nextId("79200000"))).toEqual([]);
      for (const k of ORDER)
        expect(await queueRow(rows[k].queueId)).toMatchObject({
          state: "skipped",
          error: MAKE,
          claim_token: null,
        });
    });
  });

  test("an unknown effect that Make owns again: failed with the check-the-card sentence", async () => {
    await rolledBack(async () => {
      await owners("cockpit");
      await mode("apply");
      const { queueId } = await formRow(await response(A), "todo_comment", A, {
        minutesAgo: 5,
        effectState: "unknown",
      });
      await q(
        "UPDATE public.cockpit_clickup_writeback_queue SET state='unknown' WHERE id=$1",
        [queueId],
      );
      await owners("shadow");
      expect(await claim(nextId("79300000"))).toEqual([]);
      expect(await queueRow(queueId)).toMatchObject({
        state: "failed",
        error: MAKE_UNKNOWN,
        claim_token: null,
      });
    });
  });

  test("a write that reached the card is never settled as if nothing was written (round 1 finding, 3.1 amended)", async () => {
    await rolledBack(async () => {
      await clearLanes();
      await owners("cockpit");
      await mode("apply");
      // The comment POST answered with its id and the row went to retry, its effect still queued.
      const posted = await formRow(await response(A), "todo_comment", A, {
        minutesAgo: 30,
      });
      await q(
        `UPDATE public.cockpit_clickup_writeback_queue SET state='retry', attempts=1,
           progress='{"steps":{"todo_comment":{"state":"started","commentId":"90001","at":"2026-10-29T08:00:00Z"}}}'::jsonb WHERE id=$1`,
        [posted.queueId],
      );
      // The write was read back and booked done, then the run stopped before it settled the row.
      const done = await formRow(await response(B), "happiness", B, {
        minutesAgo: 29,
      });
      await q(
        `UPDATE public.cockpit_clickup_writeback_queue SET state='sending', claim_token=$2, claimed_at=now() - interval '11 minutes', attempts=1,
           progress='{"steps":{"happiness":{"state":"done","at":"2026-10-29T08:00:00Z"}}}'::jsonb WHERE id=$1`,
        [done.queueId, nextId("79400000")],
      );
      // The card already showed the value: this attempt wrote nothing, and neither did an earlier one.
      const same = await formRow(
        await response(TEST_CARD),
        "last_poc",
        TEST_CARD,
        {
          minutesAgo: 28,
        },
      );
      await q(
        `UPDATE public.cockpit_clickup_writeback_queue SET state='sending', claim_token=$2, claimed_at=now() - interval '11 minutes', attempts=1,
           progress='{"steps":{"last_poc":{"state":"unchanged","at":"2026-10-29T08:00:00Z"}}}'::jsonb WHERE id=$1`,
        [same.queueId, nextId("79400000")],
      );
      await owners("shadow");
      expect(await claim(nextId("79400000"))).toEqual([]);
      for (const r of [posted, done])
        expect(await queueRow(r.queueId)).toMatchObject({
          state: "failed",
          error: MAKE_UNKNOWN,
          claim_token: null,
          claimed_at: null,
        });
      expect(await queueRow(same.queueId)).toMatchObject({
        state: "skipped",
        error: MAKE,
        claim_token: null,
      });
    });
  });

  test("a shadow response's row is refused: 'Make owns this again.'", async () => {
    await rolledBack(async () => {
      await owners("cockpit");
      await mode("apply");
      const { queueId } = await formRow(
        await response(A, "shadow"),
        "happiness",
        A,
        { minutesAgo: 5 },
      );
      expect(await claim(nextId("79400000"))).toEqual([]);
      expect(await queueRow(queueId)).toMatchObject({
        state: "skipped",
        error: MAKE,
      });
    });
  });

  test("in dry_run or unknown mode the claim still settles every open row the gate refuses: any card, due or not (review round 3)", async () => {
    // A rollback past cut-over step 7b: the writer reports dry_run and the registry is shadow again. Without this
    // pass these rows stayed queued and reached the writer at a later cut-over with an old call's notes.
    await rolledBack(async () => {
      await clearLanes();
      await owners("cockpit");
      await mode("apply_limited", [TEST_CARD]);
      const rid = await response(A);
      // The other cards' rows held during the canary, never claimed.
      const held = await fourRows(rid, A, 20);
      // A row on the retry ladder, its next try hours away.
      const later = await formRow(await response(B), "last_poc", B, {
        minutesAgo: 30,
      });
      await q(
        "UPDATE public.cockpit_clickup_writeback_queue SET state='retry', attempts=2, next_attempt_at = now() + interval '4 hours' WHERE id=$1",
        [later.queueId],
      );
      // An unknown row and its unknown effect.
      const doubt = await formRow(
        await response(TEST_CARD),
        "todo_comment",
        TEST_CARD,
        { minutesAgo: 25, effectState: "unknown" },
      );
      await q(
        "UPDATE public.cockpit_clickup_writeback_queue SET state='unknown', next_attempt_at = now() + interval '1 hour' WHERE id=$1",
        [doubt.queueId],
      );
      // A run that stopped mid-write: sending for 11 minutes with a started step.
      const stopped = await formRow(
        await response(TEST_CARD),
        "happiness",
        TEST_CARD,
        { minutesAgo: 24 },
      );
      await q(
        `UPDATE public.cockpit_clickup_writeback_queue SET state='sending', claim_token=$2, claimed_at=now() - interval '11 minutes', attempts=1,
           progress='{"steps":{"happiness":{"state":"started","at":"2026-10-29T08:00:00Z"}}}'::jsonb WHERE id=$1`,
        [stopped.queueId, nextId("79600000")],
      );
      // A run writing right now keeps its row.
      CLIENT.taskW1 = "Writing Client";
      const writing = await formRow(
        await response("taskW1"),
        "happiness",
        "taskW1",
        { minutesAgo: 23 },
      );
      const live = nextId("79600000");
      await q(
        "UPDATE public.cockpit_clickup_writeback_queue SET state='sending', claim_token=$2, claimed_at=now() - interval '1 minute', attempts=1 WHERE id=$1",
        [writing.queueId, live],
      );
      await owners("shadow");
      await mode("dry_run");
      expect(await claim(nextId("79600000"))).toEqual([]);
      for (const r of [...Object.values(held), later])
        expect(await queueRow(r.queueId)).toMatchObject({
          state: "skipped",
          error: MAKE,
          claim_token: null,
          claimed_at: null,
        });
      for (const r of [doubt, stopped])
        expect(await queueRow(r.queueId)).toMatchObject({
          state: "failed",
          error: MAKE_UNKNOWN,
          claim_token: null,
          claimed_at: null,
        });
      expect(await queueRow(writing.queueId)).toMatchObject({
        state: "sending",
        claim_token: live,
      });
      // Never reported (unknown mode): a row no effect points at is settled too.
      await q(
        "DELETE FROM public.cockpit_sync_state WHERE key = 'clickup-writeback:forms'",
      );
      const orphan = await formRow(await response(B), "happiness", B, {
        ref: false,
      });
      expect(await claim(nextId("79600000"))).toEqual([]);
      expect(await queueRow(orphan.queueId)).toMatchObject({
        state: "skipped",
        error: NO_EFFECT,
      });
      // A later cut-over: the owner and the mode back to live claim none of the old rows.
      await owners("cockpit");
      await mode("apply");
      expect(await claim(nextId("79600000"), 12)).toEqual([]);
    });
  });

  test("in dry_run a row the gate lets through stays queued, untouched", async () => {
    await rolledBack(async () => {
      await clearLanes();
      await owners("cockpit");
      await mode("dry_run");
      const { queueId } = await formRow(await response(A), "happiness", A, {
        minutesAgo: 5,
      });
      expect(await claim(nextId("79700000"))).toEqual([]);
      expect(await queueRow(queueId)).toMatchObject({
        state: "queued",
        error: null,
        attempts: 0,
        claim_token: null,
      });
    });
  });

  test("a kept row and a refused one in one claim: only the kept row comes back", async () => {
    await rolledBack(async () => {
      await owners("cockpit");
      await mode("apply");
      const kept = await formRow(await response(A), "happiness", A, {
        minutesAgo: 5,
      });
      const gone = await formRow(await response(B), "happiness", B, {
        minutesAgo: 4,
        ref: false,
      });
      const got = await claim(nextId("79500000"));
      expect(got.map(r => r.id)).toEqual([kept.queueId]);
      expect((await queueRow(gone.queueId)).state).toBe("skipped");
    });
  });
});

describe.skipIf(!(HAS_S && HAS_W))(
  "with 20261029s and 20261029w applied: the settle triggers move the effect (3.6)",
  () => {
    test("a gate refusal settles the effect skipped with the queue's error", async () => {
      await rolledBack(async () => {
        await owners("cockpit");
        await mode("apply");
        const { effectId, queueId } = await formRow(
          await response(A),
          "happiness",
          A,
          { minutesAgo: 5 },
        );
        await owners("shadow");
        await claim(nextId("7a000000"));
        expect((await queueRow(queueId)).state).toBe("skipped");
        expect(await effectRow(effectId)).toMatchObject({
          state: "skipped",
          reason: MAKE,
        });
      });
    });

    test("an unknown effect refused by the gate settles failed", async () => {
      await rolledBack(async () => {
        await owners("cockpit");
        await mode("apply");
        const { effectId, queueId } = await formRow(
          await response(A),
          "last_poc",
          A,
          { minutesAgo: 5, effectState: "unknown" },
        );
        await q(
          "UPDATE public.cockpit_clickup_writeback_queue SET state='unknown' WHERE id=$1",
          [queueId],
        );
        await owners("shadow");
        await claim(nextId("7a100000"));
        expect(await effectRow(effectId)).toMatchObject({ state: "failed" });
      });
    });

    test("a booked write refused by the gate settles its queued effect failed, with the sentence to check the card", async () => {
      await rolledBack(async () => {
        await clearLanes();
        await owners("cockpit");
        await mode("apply");
        const posted = await formRow(await response(A), "todo_comment", A, {
          minutesAgo: 6,
        });
        await q(
          `UPDATE public.cockpit_clickup_writeback_queue SET state='retry', attempts=1,
             progress='{"steps":{"todo_comment":{"state":"started","commentId":"90001","at":"2026-10-29T08:00:00Z"}}}'::jsonb WHERE id=$1`,
          [posted.queueId],
        );
        const done = await formRow(await response(B), "happiness", B, {
          minutesAgo: 5,
        });
        await q(
          `UPDATE public.cockpit_clickup_writeback_queue SET state='sending', claim_token=$2, claimed_at=now() - interval '11 minutes', attempts=1,
             progress='{"steps":{"happiness":{"state":"done","at":"2026-10-29T08:00:00Z"}}}'::jsonb WHERE id=$1`,
          [done.queueId, nextId("7a200000")],
        );
        await owners("shadow");
        await claim(nextId("7a200000"));
        for (const r of [posted, done])
          expect(await effectRow(r.effectId)).toMatchObject({
            state: "failed",
            reason: MAKE_UNKNOWN,
          });
      });
    });

    test("after a rollback the dry-run claim settles the rows and their effects; a later cut-over writes none of them (review round 3)", async () => {
      await rolledBack(async () => {
        await clearLanes();
        await owners("cockpit");
        await mode("apply_limited", [TEST_CARD]);
        const rows = await fourRows(await response(A), A, 10);
        const doubt = await formRow(await response(B), "last_poc", B, {
          minutesAgo: 9,
          effectState: "unknown",
        });
        await q(
          "UPDATE public.cockpit_clickup_writeback_queue SET state='unknown' WHERE id=$1",
          [doubt.queueId],
        );
        expect(await claim(nextId("7a300000"))).toEqual([]);
        await owners("shadow");
        await mode("dry_run");
        expect(await claim(nextId("7a300000"))).toEqual([]);
        for (const k of ORDER) {
          expect((await queueRow(rows[k].queueId)).state).toBe("skipped");
          expect(await effectRow(rows[k].effectId)).toMatchObject({
            state: "skipped",
            reason: MAKE,
          });
        }
        expect((await queueRow(doubt.queueId)).state).toBe("failed");
        expect(await effectRow(doubt.effectId)).toMatchObject({
          state: "failed",
        });
        await owners("cockpit");
        await mode("apply");
        expect(await claim(nextId("7a300000"), 12)).toEqual([]);
      });
    });

    test("a delivered save settles the effect delivered", async () => {
      await rolledBack(async () => {
        await owners("cockpit");
        await mode("apply");
        const { effectId, queueId } = await formRow(
          await response(A),
          "happiness",
          A,
          { minutesAgo: 5 },
        );
        const token = nextId("7a200000");
        expect((await claim(token)).map(r => r.id)).toEqual([queueId]);
        await svc(
          "SELECT public.cockpit_clickup_writeback_save($1::uuid, $2::uuid, $3::jsonb) AS r",
          [
            queueId,
            token,
            JSON.stringify({
              state: "delivered",
              progress: {
                steps: {
                  happiness: { state: "done", at: new Date().toISOString() },
                },
              },
              delivered_at: new Date().toISOString(),
            }),
          ],
        );
        expect((await effectRow(effectId)).state).toBe("delivered");
      });
    });
  },
);

describe("release (2.4)", () => {
  const release = (
    id: string,
    token: string,
    note:
      | string
      | null = "Held: the 1-1 notes writer is off until the switch-over.",
  ) =>
    svc(
      "SELECT public.cockpit_clickup_writeback_release($1::uuid, $2::uuid, '[]'::jsonb, $3, now() + interval '5 minutes') AS r",
      [id, token, note],
    );

  test("a held form row goes back queued with the claim's try taken off", async () => {
    await rolledBack(async () => {
      await owners("cockpit");
      await mode("apply");
      const { queueId } = await formRow(await response(A), "happiness", A, {
        minutesAgo: 5,
      });
      const token = nextId("7b000000");
      await claim(token);
      expect(await release(queueId, token)).toEqual({
        id: queueId,
        state: "queued",
      });
      expect(await queueRow(queueId)).toMatchObject({
        state: "queued",
        attempts: 0,
        claim_token: null,
        claimed_at: null,
        error: "Held: the 1-1 notes writer is off until the switch-over.",
      });
    });
  });

  test("a form row whose steps hold anything goes back to retry", async () => {
    await rolledBack(async () => {
      await owners("cockpit");
      await mode("apply");
      const { queueId } = await formRow(await response(A), "todo_comment", A, {
        minutesAgo: 5,
      });
      const token = nextId("7b100000");
      await claim(token);
      await q(
        `UPDATE public.cockpit_clickup_writeback_queue SET progress='{"steps":{"todo_comment":{"state":"started","at":"2026-10-29T08:00:00Z"}}}'::jsonb WHERE id=$1`,
        [queueId],
      );
      expect(await release(queueId, token)).toEqual({
        id: queueId,
        state: "retry",
      });
    });
  });

  test("another kind keeps the live refusal word for word, and only the claiming run may release", async () => {
    await rolledBack(async () => {
      const token = nextId("7b200000");
      const [{ id }] = await q<{ id: string }>(
        `INSERT INTO public.cockpit_clickup_writeback_queue(dedupe_key, kind, source_table, source_id, payload, state, claim_token, claimed_at)
         VALUES ('decision:release-2b','decision','cockpit_decisions','1','{}'::jsonb,'sending',$1,now()) RETURNING id`,
        [token],
      );
      expect(
        (
          await refusal(
            "service",
            "SELECT public.cockpit_clickup_writeback_release($1::uuid,$2::uuid,'[]'::jsonb,'x',NULL)",
            [id, token],
          )
        ).message,
      ).toBe("Only a request or a task change is handed back this way");
      expect(
        (
          await refusal(
            "service",
            "SELECT public.cockpit_clickup_writeback_release($1::uuid,$2::uuid,'[]'::jsonb,'x',NULL)",
            [id, nextId("7b200000")],
          )
        ).message,
      ).toBe("This queue item is no longer claimed by this run");
    });
  });
});

describe("the mode, the state row and begin/idle", () => {
  test("forms_state writes {mode, onlyCards, counts, at}; forms_mode reads it back; a bad mode is 22023", async () => {
    await rolledBack(async () => {
      await svc(
        "SELECT public.cockpit_clickup_forms_state(true, 'Nothing to write.', 'apply_limited', ARRAY['86eywg1cq'], '{\"claimed\":0}'::jsonb) AS r",
      );
      const [row] = await q(
        "SELECT ok, note, detail FROM public.cockpit_sync_state WHERE key='clickup-writeback:forms'",
      );
      expect(row).toMatchObject({
        ok: true,
        note: "Nothing to write.",
        detail: {
          mode: "apply_limited",
          onlyCards: [TEST_CARD],
          counts: { claimed: 0 },
        },
      });
      const m = (
        await q<{ m: Row }>("SELECT public.cockpit_clickup_forms_mode() AS m")
      )[0].m;
      expect(m).toMatchObject({
        mode: "apply_limited",
        onlyCards: [TEST_CARD],
        live: true,
        lastMode: "apply_limited",
      });
      const bad = await refusal(
        "service",
        "SELECT public.cockpit_clickup_forms_state(true,'x','off','{}'::text[],'{}'::jsonb)",
      );
      expect(bad).toEqual({
        code: "22023",
        message: "Unsupported 1-1 notes writer mode",
      });
      // A failed report keeps the last good time.
      const okAt = (
        await q<{ t: string }>(
          "SELECT last_ok_at::text AS t FROM public.cockpit_sync_state WHERE key='clickup-writeback:forms'",
        )
      )[0].t;
      await svc(
        "SELECT public.cockpit_clickup_forms_state(false, 'A failure.', 'dry_run', '{}'::text[], '{}'::jsonb) AS r",
      );
      expect(
        (
          await q(
            "SELECT ok, last_ok_at::text AS t FROM public.cockpit_sync_state WHERE key='clickup-writeback:forms'",
          )
        )[0],
      ).toEqual({ ok: false, t: okAt });
    });
  });

  test("begin and idle know the forms job and nothing more", async () => {
    await rolledBack(async () => {
      const run = await svc<Row>(
        "SELECT public.cockpit_clickup_writeback_begin('forms','dry_run',false) AS r",
      );
      expect(typeof run.id).toBe("string");
      expect(
        (
          await refusal(
            "service",
            "SELECT public.cockpit_clickup_writeback_begin('forms_doctor','dry_run',false)",
          )
        ).message,
      ).toBe("Unsupported writeback run");
      await svc(
        "SELECT public.cockpit_clickup_writeback_idle('forms', false, 'The forms run failed: invented.') AS r",
      );
      expect(
        (
          await q(
            "SELECT ok, note FROM public.cockpit_sync_state WHERE key='clickup-writeback:forms'",
          )
        )[0],
      ).toEqual({
        ok: false,
        note: "The forms run failed: invented.",
      });
      await svc(
        "SELECT public.cockpit_clickup_writeback_idle('forms_doctor', false, 'ignored') AS r",
      );
      expect(
        (
          await q(
            "SELECT count(*)::int AS n FROM public.cockpit_sync_state WHERE key='clickup-writeback:forms_doctor'",
          )
        )[0].n,
      ).toBe(0);
    });
  });
});

describe("the kick", () => {
  const kickRow = async () =>
    (
      await q(
        "SELECT ok, note FROM public.cockpit_sync_state WHERE key='clickup-writeback:forms-kick'",
      )
    )[0];
  /** A vault and pg_net stand-in inside the case's rolled-back transaction: posts land in net.posts. */
  const network = async () => {
    await asOwner();
    await db.exec(`CREATE SCHEMA vault; CREATE TABLE vault.decrypted_secrets(name text, decrypted_secret text);
      INSERT INTO vault.decrypted_secrets VALUES ('cockpit_sync_secret','invented-secret');
      CREATE SCHEMA net; CREATE TABLE net.posts(id bigint GENERATED ALWAYS AS IDENTITY, url text, body jsonb, headers jsonb, timeout integer);
      CREATE FUNCTION net.http_post(url text, body jsonb, headers jsonb, timeout_milliseconds integer) RETURNS bigint
        LANGUAGE sql AS $$ INSERT INTO net.posts(url, body, headers, timeout) VALUES (url, body, headers, timeout_milliseconds) RETURNING id $$;`);
  };
  const posts = async () =>
    q<{ url: string; body: Row; headers: Row; timeout: number }>(
      "SELECT url, body, headers, timeout FROM net.posts ORDER BY id",
    );

  test("with no vault: a writer that never reported is due a run, and the note says what to add", async () => {
    await rolledBack(async () => {
      expect(
        (
          await q<{ r: unknown }>(
            "SELECT public.cockpit_clickup_forms_kick() AS r",
          )
        )[0].r,
      ).toBeNull();
      expect(await kickRow()).toEqual({
        ok: false,
        note: "The vault has no cockpit_sync_secret, so the 1-1 notes writer was not started. Add it to the vault.",
      });
    });
  });

  test("a fresh dry-run report with nothing due posts nothing and says when the writer last reported", async () => {
    await rolledBack(async () => {
      await network();
      await mode("dry_run");
      await q("SELECT public.cockpit_clickup_forms_kick()");
      expect(await posts()).toEqual([]);
      expect((await kickRow()).ok).toBe(true);
      expect((await kickRow()).note).toMatch(
        /^Nothing due\. The 1-1 notes writer last reported at \d{2}:\d{2} Kuwait\.$/,
      );
    });
  });

  test("a stale report posts {job: forms} with the cron secret, so the writer reports its mode", async () => {
    await rolledBack(async () => {
      await network();
      await mode("dry_run");
      await q(
        "UPDATE public.cockpit_sync_state SET detail = jsonb_set(detail, '{at}', to_jsonb(now() - interval '11 minutes')) WHERE key='clickup-writeback:forms'",
      );
      await q("SELECT public.cockpit_clickup_forms_kick()");
      expect(await posts()).toEqual([
        {
          url: "https://bldgtotkfmhoxmlzowdx.supabase.co/functions/v1/clickup-writeback",
          body: { job: "forms" },
          headers: {
            "Content-Type": "application/json",
            "x-cron-secret": "invented-secret",
          },
          timeout: 150000,
        },
      ]);
      expect(await kickRow()).toEqual({
        ok: true,
        note: "Posted a 1-1 notes run so the writer reports its mode.",
      });
    });
  });

  test("apply with a due row posts a run; apply_limited posts only for a canary card's row", async () => {
    await rolledBack(async () => {
      await network();
      await owners("cockpit");
      await formRow(await response(A), "happiness", A, { minutesAgo: 2 });
      await mode("apply_limited", [TEST_CARD]);
      await q("SELECT public.cockpit_clickup_forms_kick()");
      expect(await posts()).toEqual([]);
      await mode("apply");
      await q("SELECT public.cockpit_clickup_forms_kick()");
      expect((await posts()).length).toBe(1);
      expect(await kickRow()).toEqual({
        ok: true,
        note: "Posted a 1-1 notes run.",
      });
    });
  });

  test("a row the claim's lane holds back is not due: no post every minute while an older call's row waits (review round 3)", async () => {
    await rolledBack(async () => {
      await network();
      await owners("cockpit");
      await clearLanes();
      await mode("apply");
      const r1 = await response(A);
      const waiting = await formRow(r1, "last_poc", A, { minutesAgo: 30 });
      await q(
        "UPDATE public.cockpit_clickup_writeback_queue SET state='retry', attempts=1, next_attempt_at = now() + interval '4 hours' WHERE id=$1",
        [waiting.queueId],
      );
      const newer = await formRow(await response(A), "happiness", A, {
        minutesAgo: 1,
      });
      expect(await claim(nextId("7d000000"))).toEqual([]);
      expect((await queueRow(newer.queueId)).state).toBe("queued");
      for (let i = 0; i < 3; i++)
        await q("SELECT public.cockpit_clickup_forms_kick()");
      expect(await posts()).toEqual([]);
      expect((await kickRow()).note).toMatch(
        /^Nothing due\. The 1-1 notes writer last reported at \d{2}:\d{2} Kuwait\.$/,
      );
      // The older call's row comes due: the claim could take it, so the kick posts.
      await q(
        "UPDATE public.cockpit_clickup_writeback_queue SET next_attempt_at = now() - interval '1 minute' WHERE id=$1",
        [waiting.queueId],
      );
      await q("SELECT public.cockpit_clickup_forms_kick()");
      expect((await posts()).length).toBe(1);
      expect(await kickRow()).toEqual({
        ok: true,
        note: "Posted a 1-1 notes run.",
      });
    });
  });

  test("an open row the owner gate refuses is due in any mode, so a dry run settles it within a minute (review round 3)", async () => {
    await rolledBack(async () => {
      await network();
      await clearLanes();
      await owners("cockpit");
      await mode("apply_limited", [TEST_CARD]);
      const held = await formRow(await response(A), "happiness", A, {
        minutesAgo: 5,
      });
      const later = await formRow(await response(B), "last_poc", B, {
        minutesAgo: 4,
      });
      await q(
        "UPDATE public.cockpit_clickup_writeback_queue SET state='retry', next_attempt_at = now() + interval '4 hours' WHERE id=$1",
        [later.queueId],
      );
      // The rollback: the registry back to shadow, the writer reporting dry_run.
      await owners("shadow");
      await mode("dry_run");
      await q("SELECT public.cockpit_clickup_forms_kick()");
      expect((await posts()).length).toBe(1);
      expect(await kickRow()).toEqual({
        ok: true,
        note: "Posted a 1-1 notes run to settle 2 writes the cockpit no longer sends.",
      });
      // The run the kick posted: its claim settles both, so the next minute posts nothing.
      expect(await claim(nextId("7e000000"))).toEqual([]);
      expect((await queueRow(held.queueId)).state).toBe("skipped");
      expect((await queueRow(later.queueId)).state).toBe("skipped");
      await q("SELECT public.cockpit_clickup_forms_kick()");
      expect((await posts()).length).toBe(1);
      expect((await kickRow()).note).toMatch(/^Nothing due\./);
      // One refused row says so in the singular.
      await formRow(await response(B), "happiness", B, { ref: false });
      await q("SELECT public.cockpit_clickup_forms_kick()");
      expect(await kickRow()).toEqual({
        ok: true,
        note: "Posted a 1-1 notes run to settle 1 write the cockpit no longer sends.",
      });
    });
  });

  test("one run at a time: no post while a forms run under 4 minutes old is open; a second exclusive begin is refused and its claimed rows go back uncounted", async () => {
    // Review round 2: the writer's pace belongs to one run, so a second run beside it would double the job's calls.
    const BUSY =
      "Another 1-1 notes run is still sending, so this waits for the next run.";
    await rolledBack(async () => {
      await network();
      await owners("cockpit");
      await clearLanes();
      await fourRows(await response(A), A, 2);
      await formRow(await response(B), "happiness", B, { minutesAgo: 2 });
      await mode("apply");
      const run = await svc<Row>(
        "SELECT public.cockpit_clickup_writeback_begin('forms','apply',true) AS r",
      );
      expect(typeof run.id).toBe("string");
      await q("SELECT public.cockpit_clickup_forms_kick()");
      expect(await posts()).toEqual([]);
      const held = await kickRow();
      expect(held.ok).toBe(true);
      expect(held.note).toMatch(
        /^A 1-1 notes run that started at \d{2}:\d{2} Kuwait is still writing, so no second run was posted\.$/,
      );
      // A run the kick did not post (one sent by hand) still claims: its exclusive begin is refused, so the run
      // hands every claimed row back through the release, the claim's try taken off.
      const token = nextId("7c000000");
      const claimed = await claim(token);
      expect(claimed.length).toBe(5);
      const busy = await svc<Row>(
        "SELECT public.cockpit_clickup_writeback_begin('forms','apply',true) AS r",
      );
      expect(busy.id).toBeNull();
      expect(busy.note).toMatch(
        /^A forms run that started at \d{2}:\d{2} Kuwait is still running\.$/,
      );
      for (const c of claimed)
        await svc(
          "SELECT public.cockpit_clickup_writeback_release($1::uuid, $2::uuid, '[]'::jsonb, $3, now()) AS r",
          [c.id, token, BUSY],
        );
      for (const c of claimed)
        expect(await queueRow(c.id)).toMatchObject({
          state: "queued",
          attempts: 0,
          claim_token: null,
          claimed_at: null,
          error: BUSY,
        });
      // A finished run holds nothing.
      await q(
        "UPDATE public.cockpit_clickup_writeback_runs SET finished_at = now(), ok = true WHERE id = $1",
        [run.id],
      );
      await q("SELECT public.cockpit_clickup_forms_kick()");
      expect((await posts()).length).toBe(1);
      // A run open 4 minutes stopped without reporting back: the kick no longer waits on it.
      const [{ id: stale }] = await q<{ id: string }>(
        "INSERT INTO public.cockpit_clickup_writeback_runs(job, mode, started_at) VALUES ('forms','apply', now() - interval '4 minutes') RETURNING id",
      );
      expect(typeof stale).toBe("string");
      await q("SELECT public.cockpit_clickup_forms_kick()");
      expect((await posts()).length).toBe(2);
      expect(await kickRow()).toEqual({
        ok: true,
        note: "Posted a 1-1 notes run.",
      });
      // Another job's open run holds nothing either.
      await q(
        "INSERT INTO public.cockpit_clickup_writeback_runs(job, mode) VALUES ('requests','apply')",
      );
      await q("SELECT public.cockpit_clickup_forms_kick()");
      expect((await posts()).length).toBe(3);
    });
  });

  test("a forms run and a requests run do not hold each other up: begin, the kicks and the claims are job by job (20261026r beside 20261029t)", async () => {
    const begin = (job: string, exclusive = true) =>
      svc<Row>(
        "SELECT public.cockpit_clickup_writeback_begin($1, 'apply', $2) AS r",
        [job, exclusive],
      );
    const isOpen = async (id: string) =>
      (
        await q<{ open: boolean }>(
          "SELECT finished_at IS NULL AS open FROM public.cockpit_clickup_writeback_runs WHERE id = $1",
          [id],
        )
      )[0].open;
    const finish = (id: string) =>
      q(
        "UPDATE public.cockpit_clickup_writeback_runs SET finished_at = now(), ok = true WHERE id = $1",
        [id],
      );
    await rolledBack(async () => {
      await network();
      await owners("cockpit");
      await clearLanes();
      await q(
        "DELETE FROM public.cockpit_clickup_writeback_runs WHERE job IN ('forms','requests')",
      );
      await q(
        "DELETE FROM public.cockpit_clickup_writeback_queue WHERE kind IN ('request','task_action')",
      );
      await mode("apply");
      await svc(
        "SELECT public.cockpit_clickup_requests_state(true,'test','apply',NULL,'{}'::jsonb) AS r",
      );
      // Open forms: requests still opens, and each job's second exclusive begin is refused by its own run alone.
      const forms = await begin("forms");
      expect(typeof forms.id).toBe("string");
      const requests = await begin("requests");
      expect(typeof requests.id).toBe("string");
      expect((await begin("forms")).note).toMatch(
        /^A forms run that started at \d{2}:\d{2} Kuwait is still running\.$/,
      );
      expect((await begin("requests")).note).toMatch(
        /^A requests run that started at \d{2}:\d{2} Kuwait is still running\.$/,
      );
      // One finishing frees only itself.
      await finish(String(forms.id));
      expect(await isOpen(String(requests.id))).toBe(true);
      const formsAgain = await begin("forms");
      expect(typeof formsAgain.id).toBe("string");
      await finish(String(requests.id));
      expect(await isOpen(String(formsAgain.id))).toBe(true);
      const requestsAgain = await begin("requests");
      expect(typeof requestsAgain.id).toBe("string");
      // Each job's begin closes only its own abandoned run.
      await finish(String(formsAgain.id));
      const [{ id: oldRequests }] = await q<{ id: string }>(
        "INSERT INTO public.cockpit_clickup_writeback_runs(job, mode, started_at) VALUES ('requests','apply', now() - interval '20 minutes') RETURNING id",
      );
      const formsBeside = await begin("forms");
      expect(typeof formsBeside.id).toBe("string");
      expect(await isOpen(oldRequests)).toBe(true);
      // The kicks: forms holds its own post for its own open run and never holds the requests post.
      const { queueId: formId } = await formRow(
        await response(A),
        "happiness",
        A,
        {
          minutesAgo: 3,
        },
      );
      const [{ id: actionId }] = await q<{ id: string }>(
        `INSERT INTO public.cockpit_clickup_writeback_queue(dedupe_key, kind, source_table, source_id, task_id, payload, created_at)
         VALUES ('task:beside-forms','task_action','cockpit_task_actions','1',$1,$2::jsonb, now() - interval '2 minutes') RETURNING id`,
        [A, JSON.stringify({ op: "comment", clientTaskId: A })],
      );
      await q("SELECT public.cockpit_clickup_forms_kick()");
      expect(await posts()).toEqual([]);
      await q("SELECT public.cockpit_clickup_requests_kick()");
      expect((await posts()).map(p => p.body)).toEqual([{ job: "requests" }]);
      // With requests open and forms finished, the forms kick posts.
      await finish(String(formsBeside.id));
      expect(await isOpen(String(requestsAgain.id))).toBe(true);
      await q("SELECT public.cockpit_clickup_forms_kick()");
      expect((await posts()).map(p => p.body)).toEqual([
        { job: "requests" },
        { job: "forms" },
      ]);
      // Each claim takes only its own kind on the same card; neither lane holds the other's row.
      const taken = await svc<Row[]>(
        "SELECT public.cockpit_clickup_writeback_claim_requests($1::uuid, 6) AS r",
        [nextId("7d100000")],
      );
      expect(taken.map(r => r.id)).toEqual([actionId]);
      expect((await queueRow(formId)).state).toBe("queued");
      const mine = await claim(nextId("7d100000"));
      expect(mine.map(r => r.id)).toEqual([formId]);
      expect((await queueRow(actionId)).state).toBe("sending");
    });
  });
});

describe("the doctor's inputs", () => {
  test("rows by state, the six option ids the planner writes, the three fields, the owners and the mode", async () => {
    await rolledBack(async () => {
      await mode("dry_run");
      await clearLanes();
      const before = await svc<Row>(
        "SELECT public.cockpit_clickup_forms_doctor_inputs() AS r",
      );
      await owners("cockpit");
      await formRow(await response(A), "happiness", A, { minutesAgo: 60 });
      const got = await svc<Row>(
        "SELECT public.cockpit_clickup_forms_doctor_inputs() AS r",
      );
      expect(got.queue.queued).toBe((before.queue.queued ?? 0) + 1);
      expect(got.stuckSending).toBe(0);
      expect(typeof got.oldestDue).toBe("string");
      const planner = await q<{ label: string; id: string }>(
        "SELECT l AS label, public.cockpit_form_happiness_option(l) AS id FROM unnest(ARRAY['Paused','At Risk','Neutral','Happy','Very Happy (testimonial)','Churned']) l",
      );
      expect(got.happinessOptions).toEqual(
        planner.map(p => ({ label: p.label, optionId: p.id })),
      );
      expect(got.happinessOptions.map((o: Row) => o.optionId)).toContain(HAPPY);
      expect(got.fields).toEqual({
        happiness: HAPPY_FIELD,
        lastPoc: LAST_POC,
        lastCheckinCall: LAST_CALL,
      });
      expect(got.owners).toEqual({
        todo_comment: "cockpit",
        happiness: "cockpit",
        last_poc: "cockpit",
        last_checkin_call: "cockpit",
      });
      expect(got.mode.mode).toBe("dry_run");
    });
  });

  test("the registry as seeded: the four ClickUp effects are shadow", async () => {
    const got = await svc<Row>(
      "SELECT public.cockpit_clickup_forms_doctor_inputs() AS r",
    );
    expect(got.owners).toEqual({
      todo_comment: "shadow",
      happiness: "shadow",
      last_poc: "shadow",
      last_checkin_call: "shadow",
    });
  });
});

describe("the cron (pg_cron only where it exists)", () => {
  test("the file schedules exactly one job, every minute, after unscheduling it", () => {
    const sql = migration(WRITEBACK);
    expect(sql.match(/cron\.schedule\(/g)?.length).toBe(1);
    expect(sql).toContain(
      "$q$SELECT cron.schedule('mahara-clickup-writeback-forms','* * * * *',$job$SELECT public.cockpit_clickup_forms_kick();$job$)$q$",
    );
    expect(sql.indexOf("cron.unschedule")).toBeLessThan(
      sql.indexOf("cron.schedule("),
    );
    expect(sql).toContain("IF to_regclass('cron.job') IS NOT NULL THEN");
  });
});
