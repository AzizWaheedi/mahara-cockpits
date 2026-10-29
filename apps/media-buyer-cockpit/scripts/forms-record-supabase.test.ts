/**
 * Kickoff and Brand Blueprint in the forms tables (20261029y_forms_records.sql;
 * docs/forms/STAGE2B-CONTRACT.md 2.9, 3.9 and 4.8, build 8) on an isolated
 * PostgreSQL with Supabase's default privileges on, so a missing REVOKE opens
 * a function here as it would in production.
 *
 * It stands on the 2a base of section 8 in order (20261025n, 20261025o,
 * 20261026r, 20261026s, 20261026t, 20261027f, 20261027g, 20261027h over
 * 20261024a), cut from or applied as the canonical migrations the way
 * stage2a-fit-supabase.test.ts stands on them, then the 2b files it needs in
 * letter order, each twice: 20261029s_forms_registry.sql,
 * 20261029w_forms_dispatch.sql (the effects guard's record move) and
 * 20261029y_forms_records.sql. The vault is a plain-text stand-in, inside
 * this test only. Stage 1 runs as itself: kickoff notices are queued as the
 * onboarding trigger queues them, and a Blueprint close leaving sending
 * queues its close and media notices through 20261025n's outbox trigger.
 *
 * Covered: one kickoff response whoever writes first, the Typeform row
 * stored only when absent and a person's match never overwritten, Make and
 * shadow effects skipped, the kickoff notice waiting, delivered, skipped and
 * its 48-hour sentence, presses and the earlier press, the Stage 1 counts
 * never changed, p_apply false and a second sweep writing nothing, no hidden
 * email or phone in any audit row, the keys CHECK, the mark, the refusals of
 * checkin, the CEO card's keys kept to four, the body-diff of the four key
 * functions, the drift guard, grants. The CEO's address is read from the CEO
 * gate migration, never written here; every other person, client and value
 * is invented.
 */
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  setDefaultTimeout,
  test,
} from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import { actor, cockpitTestDb, member, migration } from "./lib/cockpitTestDb";

// Keep direct, ship and readiness runs consistent on busy build hosts.
setDefaultTimeout(120_000);

const BASE = [
  "20261025n_slack_notices.sql",
  "20261025o_blueprint_close_drain.sql",
  "20261026r_requests.sql",
  "20261026s_request_types_seed.sql",
  "20261026t_task_alerts.sql",
  "20261027f_forms_core.sql",
  "20261027g_fathom_intake.sql",
  "20261027h_checkin_plans.sql",
] as const;
const S = "20261029s_forms_registry.sql";
const W = "20261029w_forms_dispatch.sql";
const Y = "20261029y_forms_records.sql";

/** The CEO gate's own address (20260923m), so no address is written here. */
const CEO_EMAIL = (() => {
  const hit = migration("20260923m_cockpit_ceo_gate.sql").match(
    /IN \(\s*'([^']+@[^']+)'/,
  );
  if (!hit) throw new Error("The CEO gate names no address");
  return hit[1];
})();

const CEO = "00000000-0000-4000-8000-0000000000c3";
const ADMIN = "00000000-0000-4000-8000-0000000000d1";
const CSM = "00000000-0000-4000-8000-0000000000a1"; // csm only, every client
const EDITOR_ROW = "00000000-0000-4000-8000-0000000000f2";
const EDITOR_ROLE = "00000000-0000-4000-8000-0000000000f3";
const GONE = "00000000-0000-4000-8000-0000000000f4";
const NOBODY = "00000000-0000-4000-8000-0000000000f5";
const CSM_EMAIL = "csm@tests.invalid";
const CREATIVE = "00000000-0000-4000-8000-0000000000e1"; // the presses' actor
const CREATIVE_EMAIL = "creative@tests.invalid";

const A = "taskA1"; // Acme Interiors
const B = "taskB1"; // Beta Build

/** Invented contact details as kickoff hidden fields carry them; none may reach an audit row. */
const CONTACT_EMAIL = "owner@acme.invalid";
const CONTACT_PHONE = "+00 0000 0000";

/** 2.2's body-diff rule: each key function's 20261027g body with exactly these edits (before, after). */
const KEY_EDITS: Record<string, [string, string][]> = {
  cockpit_forms_key_put: [
    [
      "  v_ok boolean;\n  k public.cockpit_forms_keys;\nBEGIN\n",
      "  v_ok boolean;\n  v_registered boolean;\n  k public.cockpit_forms_keys;\nBEGIN\n",
    ],
    [
      "  IF v_provider IS NULL OR v_provider NOT IN ('fathom','fathom_webhook','anthropic','deepseek') THEN\n    RAISE EXCEPTION 'Choose fathom, fathom_webhook, anthropic or deepseek.' USING ERRCODE = '22023';\n",
      "  IF v_provider IS NULL OR v_provider NOT IN ('fathom','fathom_webhook','anthropic','deepseek','typeform_kickoff') THEN\n    RAISE EXCEPTION 'Choose fathom, fathom_webhook, anthropic, deepseek or typeform_kickoff.' USING ERRCODE = '22023';\n",
    ],
    [
      "    WHEN 'deepseek' THEN v_secret ~ '^sk-[A-Za-z0-9]{20,}$' END;\n",
      "    WHEN 'deepseek' THEN v_secret ~ '^sk-[A-Za-z0-9]{20,}$'\n    WHEN 'typeform_kickoff' THEN v_secret ~ '^[A-Za-z0-9_-]{32,128}$' END;\n  IF NOT coalesce(v_ok, false) AND v_provider = 'typeform_kickoff' THEN\n    RAISE EXCEPTION 'That doesn''t look like a Typeform signing secret: 32 to 128 letters, digits, - or _. Nothing was changed.'\n      USING ERRCODE = '22023';\n  END IF;\n",
    ],
    [
      "         meta = CASE WHEN EXCLUDED.provider = 'fathom_webhook' THEN EXCLUDED.meta ELSE k0.meta || EXCLUDED.meta END\n",
      "         meta = CASE WHEN EXCLUDED.provider IN ('fathom_webhook','typeform_kickoff') THEN EXCLUDED.meta ELSE k0.meta || EXCLUDED.meta END\n",
    ],
    [
      "    ON CONFLICT (key) DO UPDATE SET note = EXCLUDED.note, detail = EXCLUDED.detail, updated_at = now();\n  END IF;\n",
      "    ON CONFLICT (key) DO UPDATE SET note = EXCLUDED.note, detail = EXCLUDED.detail, updated_at = now();\n  END IF;\n  IF v_provider = 'typeform_kickoff' THEN\n    -- Registered: a webhook id and no unregisteredAt, as the Fathom webhook.\n    v_registered := (public.cockpit_forms_webhook_detail(k.meta, k.saved_at)->>'registered')::boolean;\n    -- A saved key is no failing job. While nothing is registered there is no\n    -- delivery to lose, so an earlier failure stops counting too.\n    INSERT INTO public.cockpit_sync_state AS s0 (key, last_run_at, last_ok_at, ok, note, detail, updated_at)\n    VALUES ('forms-door:kickoff', now(), now(), true,\n            CASE WHEN v_registered THEN 'The kickoff webhook is registered.'\n                 ELSE 'The kickoff signing key is saved; the webhook is not registered with it yet.' END,\n            jsonb_build_object('registered', v_registered,\n                               'registeredAt', CASE WHEN v_registered THEN coalesce(k.meta->'registeredAt', to_jsonb(k.saved_at)) END,\n                               'lastDelivery', NULL, 'outcome', NULL), now())\n    ON CONFLICT (key) DO UPDATE\n       SET note = EXCLUDED.note,\n           ok = s0.ok OR NOT v_registered,\n           last_ok_at = CASE WHEN s0.ok OR v_registered THEN s0.last_ok_at ELSE now() END,\n           detail = coalesce(s0.detail, '{}'::jsonb)\n                    || jsonb_build_object('registered', EXCLUDED.detail->'registered', 'registeredAt', EXCLUDED.detail->'registeredAt'),\n           updated_at = now();\n  END IF;\n",
    ],
  ],
  cockpit_forms_key_mark: [
    [
      "  IF v_provider IS NULL OR v_provider NOT IN ('fathom','fathom_webhook','anthropic','deepseek') THEN\n    RAISE EXCEPTION 'Choose fathom, fathom_webhook, anthropic or deepseek.' USING ERRCODE = '22023';\n",
      "  IF v_provider IS NULL OR v_provider NOT IN ('fathom','fathom_webhook','anthropic','deepseek','typeform_kickoff') THEN\n    RAISE EXCEPTION 'Choose fathom, fathom_webhook, anthropic, deepseek or typeform_kickoff.' USING ERRCODE = '22023';\n",
    ],
    [
      "       SET note = coalesce(EXCLUDED.note, s0.note), detail = EXCLUDED.detail, updated_at = now();\n  END IF;\n",
      "       SET note = coalesce(EXCLUDED.note, s0.note), detail = EXCLUDED.detail, updated_at = now();\n  ELSIF v_provider = 'typeform_kickoff' THEN\n    -- Registered: a webhook id and no unregisteredAt, as the Fathom webhook.\n    -- registeredAt is the registration's own time, so the guardian counts\n    -- missed kickoffs only from then.\n    v_was := (public.cockpit_forms_webhook_detail(k.meta, k.saved_at)->>'registered')::boolean;\n    v_now := (public.cockpit_forms_webhook_detail(n.meta, n.saved_at)->>'registered')::boolean;\n    INSERT INTO public.cockpit_sync_state AS s0 (key, last_run_at, last_ok_at, ok, note, detail, updated_at)\n    VALUES ('forms-door:kickoff', now(), now(), true,\n            CASE WHEN v_now THEN 'The kickoff webhook is registered.'\n                 ELSE 'The kickoff webhook is not registered: kickoffs arrive by the 15-minute read.' END,\n            jsonb_build_object('registered', v_now,\n                               'registeredAt', CASE WHEN v_now THEN coalesce(n.meta->'registeredAt', to_jsonb(n.checked_at)) END,\n                               'lastDelivery', NULL, 'outcome', NULL), now())\n    ON CONFLICT (key) DO UPDATE\n       SET note = EXCLUDED.note,\n           ok = s0.ok OR NOT v_now,\n           last_ok_at = CASE WHEN s0.ok OR v_now THEN s0.last_ok_at ELSE now() END,\n           detail = coalesce(s0.detail, '{}'::jsonb)\n                    || jsonb_build_object('registered', v_now, 'registeredAt', EXCLUDED.detail->'registeredAt'),\n           updated_at = now();\n  END IF;\n",
    ],
  ],
  cockpit_forms_key_label: [
    [
      "                         WHEN 'anthropic' THEN 'Anthropic' WHEN 'deepseek' THEN 'DeepSeek' END\n",
      "                         WHEN 'anthropic' THEN 'Anthropic' WHEN 'deepseek' THEN 'DeepSeek'\n                         WHEN 'typeform_kickoff' THEN 'Typeform kickoff signing key' END\n",
    ],
  ],
  cockpit_forms_keys_status: [
    [
      "  v_sentence text;\nBEGIN\n",
      "  v_sentence text;\n  tk public.cockpit_forms_keys;\n  v_door public.cockpit_sync_state;\nBEGIN\n",
    ],
    [
      "  SELECT * INTO s FROM public.cockpit_sync_state x WHERE x.key = 'fathom-pull';\n",
      "  SELECT * INTO s FROM public.cockpit_sync_state x WHERE x.key = 'fathom-pull';\n  -- The kickoff form's Typeform signing key, apart from keys (Z57).\n  SELECT * INTO tk FROM public.cockpit_forms_keys x WHERE x.provider = 'typeform_kickoff';\n  SELECT * INTO v_door FROM public.cockpit_sync_state x WHERE x.key = 'forms-door:kickoff';\n",
    ],
    [
      "    'pull', jsonb_build_object('lastRunAt', s.last_run_at, 'ok', s.ok, 'note', s.note),\n",
      "    'pull', jsonb_build_object('lastRunAt', s.last_run_at, 'ok', s.ok, 'note', s.note),\n    'typeform', jsonb_build_array(jsonb_build_object(\n      'form', 'kickoff',\n      'connected', coalesce(tk.state = 'connected', false),\n      'last4', tk.last4,\n      'registered', coalesce((public.cockpit_forms_webhook_detail(tk.meta, tk.saved_at)->>'registered')::boolean, false),\n      'lastDelivery', v_door.detail->'lastDelivery')),\n",
    ],
  ],
};

let db: PGlite;
type Row = Record<string, any>;
type Refusal = { code: string; message: string };

function cut(sql: string, pattern: RegExp, what: string): string {
  const hit = sql.match(pattern);
  if (!hit) throw new Error(`Canonical definition missing: ${what}`);
  return hit[0];
}
const ago = (minutes: number) =>
  new Date(Date.now() - minutes * 60_000).toISOString();

// --- Sessions ---------------------------------------------------------------------------------

async function asOwner() {
  await db.exec("RESET ROLE");
  await db.query("SELECT set_config('request.jwt.claim.sub','',false)");
  await db.query("SELECT set_config('request.jwt.claims','',false)");
}
// Inside rolledBack every step runs under a savepoint, so a refusal the test
// expects leaves the transaction usable for the steps after it.
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
/** Several statements as the owner, no parameters. */
async function ex(text: string): Promise<void> {
  await guarded(async () => {
    await asOwner();
    await db.exec(text);
  });
}
async function one<T = any>(text: string, params: unknown[] = []): Promise<T> {
  return (await q<{ r: T }>(text, params))[0]?.r as T;
}
async function count(text: string, params: unknown[] = []): Promise<number> {
  return Number((await q<{ n: number }>(text, params))[0].n);
}
/** One value as a seat (its auth id) or as PostgREST with the service key. */
async function as<T = any>(
  who: string | "service",
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
async function refusal(fn: () => Promise<unknown>): Promise<Refusal> {
  try {
    await fn();
  } catch (e) {
    const x = e as { code?: string; message: string };
    return { code: x.code ?? "", message: x.message };
  }
  throw new Error("Expected a refusal");
}
/** Runs as the owner inside a transaction that is always rolled back. */
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

// --- The database the 2b files stand on (section 8's 2a base) ---------------------------------

/**
 * What Stage 1, the ticketing and the 2a forms read, each cut from its
 * canonical migration as stage2a-fit-supabase.test.ts cuts it; the sales
 * index and a few provider ledgers are stand-ins with the live column names.
 * PL/pgSQL resolves a declared row type when a function is created, so the
 * call store and the sync state come first.
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
    [
      "20260921a_cockpit_settings.sql",
      /create table if not exists public\.cockpit_settings \([\s\S]*?\n\);/,
      "settings",
    ],
  ] as const)
    await db.exec(cut(migration(file), pattern, what));

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
    ALTER TABLE public.cockpit_settings ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON public.cockpit_sync_state, public.cockpit_people, public.cockpit_eod_radar_slack_ids,
      public.cockpit_client_onboarding, public.cockpit_csm_form_sends,
      public.cockpit_csm_source_state, public.cockpit_csm_sources, public.cockpit_csm_deck_prep,
      public.cockpit_media_actions, public.cockpit_client_logos, public.ghl_clients, public.editor_clients,
      public.cockpit_csm_provider_health, public.cockpit_media_provider_health, public.cockpit_decisions,
      public.cockpit_media_native_records, public.cockpit_settings FROM PUBLIC, anon, authenticated, service_role;
    REVOKE ALL ON public.cockpit_media_source_state, public.cockpit_media_sources, public.cockpit_media_call_briefs,
      public.cockpit_sales_recordings, public.cockpit_sales_call_notes FROM anon, authenticated;
    GRANT SELECT, INSERT ON public.cockpit_csm_provider_health, public.cockpit_media_provider_health TO service_role;
    GRANT SELECT, INSERT, UPDATE ON public.cockpit_media_actions, public.cockpit_sync_state TO service_role;
    GRANT ALL ON public.cockpit_settings TO service_role;`);

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

/** The seats, the people by role, the roster the client gate reads and Acme's alias. */
async function seats() {
  await member(db, CEO, CEO_EMAIL, []);
  await member(db, ADMIN, "admin@tests.invalid", ["admin"]);
  await member(db, CSM, CSM_EMAIL, ["csm"]);
  await member(db, EDITOR_ROW, "buyer.editor@tests.invalid", ["media_buyer"]);
  await member(db, EDITOR_ROLE, "forms.editor@tests.invalid", ["forms_editor"]);
  await member(db, GONE, "gone@tests.invalid", ["csm"], false);
  await q(
    "INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,'nobody@tests.invalid',now())",
    [NOBODY],
  );
  for (const [name, email, role] of [
    ["Csm Test", CSM_EMAIL, "Client success manager"],
    ["Ceo Test", CEO_EMAIL, "CEO"],
  ])
    await q(
      "INSERT INTO public.cockpit_people(name,email,role,active,added_by) VALUES($1,$2,$3,true,'test')",
      [name, email, role],
    );
  const snap = "2026-10-28T08:00:00Z";
  const clients = [
    [A, "Acme Interiors", "Active", "Happy"],
    [B, "Beta Build", "Onboarding", null],
  ] as const;
  for (const [taskId, name, stage, happiness] of clients)
    await q(
      "INSERT INTO public.cockpit_csm_sources(table_name,source_id,client_names,data,source_snapshot_at) VALUES('clients',$1,$2,$3::jsonb,$4)",
      [
        `c-${taskId}`,
        [name],
        JSON.stringify({ _id: `c-${taskId}`, taskId, name, stage, happiness }),
        snap,
      ],
    );
  await q(
    "UPDATE public.cockpit_csm_source_state SET ready=true,row_count=$1,source_snapshot_at=$2 WHERE table_name='clients'",
    [clients.length, snap],
  );
}

/** Every public function's definition md5 and ACL. */
async function functions() {
  return new Map(
    (
      await q<{ sig: string; md5: string; acl: string | null }>(
        `SELECT p.oid::regprocedure::text AS sig, md5(pg_get_functiondef(p.oid)) AS md5, p.proacl::text AS acl
           FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'public' AND p.prokind IN ('f','p')`,
      )
    ).map(r => [r.sig, `${r.md5}|${r.acl}`]),
  );
}

const VAULT = `
  CREATE SCHEMA vault;
  CREATE TABLE vault.secrets (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text UNIQUE, description text NOT NULL DEFAULT '',
    secret text NOT NULL, key_id uuid, nonce bytea,
    created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
  CREATE VIEW vault.decrypted_secrets AS
    SELECT s.id, s.name, s.description, s.secret, s.secret AS decrypted_secret, s.key_id, s.nonce, s.created_at, s.updated_at
      FROM vault.secrets s;
  CREATE FUNCTION vault.create_secret(new_secret text, new_name text DEFAULT NULL, new_description text DEFAULT '',
    new_key_id uuid DEFAULT NULL) RETURNS uuid LANGUAGE plpgsql AS $$
  DECLARE v uuid;
  BEGIN
    INSERT INTO vault.secrets(name, description, secret, key_id)
    VALUES (new_name, coalesce(new_description, ''), new_secret, new_key_id) RETURNING id INTO v;
    RETURN v;
  END $$;
  CREATE FUNCTION vault.update_secret(secret_id uuid, new_secret text DEFAULT NULL, new_name text DEFAULT NULL,
    new_description text DEFAULT NULL, new_key_id uuid DEFAULT NULL) RETURNS void LANGUAGE plpgsql AS $$
  BEGIN
    UPDATE vault.secrets SET secret = coalesce(new_secret, secret), name = coalesce(new_name, name),
      description = coalesce(new_description, description), key_id = coalesce(new_key_id, key_id), updated_at = now()
     WHERE id = secret_id;
  END $$;
  REVOKE ALL ON SCHEMA vault FROM PUBLIC;
  REVOKE ALL ON FUNCTION vault.create_secret(text,text,text,uuid), vault.update_secret(uuid,text,text,text,uuid) FROM PUBLIC;`;

let first: Map<string, string>;
let auditOnce = 0;
let auditTwice = 0;
let twiceFns: Map<string, string>;

beforeAll(async () => {
  db = await cockpitTestDb({ supabaseDefaultPrivileges: true });
  // The order audit rows were written in: two statements of one transaction
  // share created_at, and the ids are random.
  await db.exec(
    "ALTER TABLE public.cockpit_audit_log ADD COLUMN test_seq bigint GENERATED BY DEFAULT AS IDENTITY;",
  );
  await standOn();
  await seats();
  await member(db, CREATIVE, CREATIVE_EMAIL, ["creative"]);
  await db.exec(migration("20261024a_brand_blueprints.sql"));
  for (const file of BASE) await db.exec(migration(file));
  for (const file of [S, W, Y]) await db.exec(migration(file));
  first = await functions();
  auditOnce = await count("SELECT count(*) n FROM public.cockpit_audit_log");
  for (const file of [S, W, Y]) await db.exec(migration(file));
  twiceFns = await functions();
  auditTwice = await count("SELECT count(*) n FROM public.cockpit_audit_log");
  await db.exec(VAULT);
}, 300_000);
afterAll(async () => {
  await db?.close();
});

// --- Stage 1 and the stores as their writers write them ------------------------------------------

let tokenSeq = 0;
const token = () => `kick${String(++tokenSeq).padStart(28, "0")}`;
const HIDDEN = (card: string) => ({
  onboarding_client_id: card,
  email: CONTACT_EMAIL,
  phone: CONTACT_PHONE,
  legal_name: "Acme Interiors Trading",
});
const ANSWERS = [
  {
    ref: "kick-goal",
    type: "long_text",
    title: "Goal in 90 days",
    value: "Invented goal.",
  },
  { ref: "kick-email", type: "email", title: "Email", value: CONTACT_EMAIL },
];
/** The csm-calls worker's stored kickoff row. */
async function storedKickoff(
  t: string,
  o: { task?: string | null; at?: string; manual?: boolean } = {},
) {
  const task = o.task === undefined ? A : o.task;
  await q(
    `INSERT INTO public.cockpit_csm_call_forms(token, form_id, form_kind, task_id, typed_client, matched_by, submitted_at,
       answers, hidden)
     VALUES ($1, 'tG7dnxBn', 'kickoff', $2, NULL, $3, $4, $5::jsonb, $6::jsonb)`,
    [
      t,
      task,
      o.manual ? "manual" : task ? "hidden_field" : null,
      o.at ?? ago(30),
      JSON.stringify(ANSWERS),
      JSON.stringify(HIDDEN(A)),
    ],
  );
}
const webhook = (t: string, card = A, at = ago(30)) =>
  as<Row>(
    "service",
    "SELECT public.cockpit_form_record_typeform($1::jsonb) AS r",
    [
      JSON.stringify({
        formKey: "kickoff",
        token: t,
        submittedAt: at,
        hidden: HIDDEN(card),
        answers: ANSWERS,
        recordingUrl: null,
        via: "typeform_webhook",
      }),
    ],
  );
const sweep = (apply = true) =>
  as<Row>("service", "SELECT public.cockpit_form_record_sweep($1) AS r", [
    apply,
  ]);
/** A Stage 1 kickoff notice, through the sender's states. */
async function kickoffNotice(
  t: string,
  state: string,
  error: string | null = null,
) {
  const id = await one<string>(
    "SELECT public.cockpit_slack_notice_queue('kickoff', 'kickoff:' || $1, $2, 'Acme Interiors', '{}'::jsonb, NULL, $3, $4)::text AS r",
    [
      t,
      A,
      state === "skipped" ? "skipped" : "queued",
      state === "skipped" ? error : null,
    ],
  );
  const path: Record<string, string[]> = {
    queued: [],
    skipped: [],
    sending: ["sending"],
    posted: ["sending", "posted"],
    failed: ["sending", "failed"],
    muted: ["muted"],
  };
  for (const s of path[state])
    await q(
      `UPDATE public.cockpit_slack_notices SET state = $2, error = $3,
          slack_ts = CASE WHEN $2 = 'posted' THEN '1730000000.000200' END,
          channel = CASE WHEN $2 = 'posted' THEN 'C09RZ0GS0V9' END
        WHERE id = $1::uuid`,
      [id, s, s === "failed" ? error : null],
    );
  return id;
}
let pressSeq = 0;
/** A Blueprint press as cockpit_blueprint_part_done queues it, run to a state by the creative runner. */
async function press(
  kind: string,
  task: string,
  state: string,
  error: string | null = null,
) {
  const id = `6b000000-0000-4000-8000-${String(++pressSeq).padStart(12, "0")}`;
  await q(
    `INSERT INTO public.cockpit_creative_outbox(id, client_name, kind, task_id, payload, actor_id, actor_email, created_at)
     VALUES ($1::uuid, $2, $3, $4, '{"service":"design-build"}'::jsonb, $5, $6, now() + ($7 || ' seconds')::interval)`,
    [
      id,
      task === A ? "Acme Interiors" : "Beta Build",
      kind,
      task,
      CREATIVE,
      CREATIVE_EMAIL,
      String(pressSeq),
    ],
  );
  const path: Record<string, string[]> = {
    pending: [],
    sending: ["sending"],
    done: ["sending", "done"],
    reconcile: ["sending", "reconcile"],
    failed: ["sending", "failed"],
  };
  for (const s of path[state])
    await q(
      "UPDATE public.cockpit_creative_outbox SET state = $2, error = $3, settled_at = now() WHERE id = $1::uuid",
      [id, s, s === "failed" ? error : null],
    );
  return id;
}
const response = (where: string, params: unknown[]) =>
  q<Row>(
    `SELECT id::text, form_key, source, external_id, task_id, client_name, mode, state, answers, hidden, created_by,
            created_by_id::text, submitted_at FROM public.cockpit_form_responses WHERE ${where}`,
    params,
  );
async function effectsOf(id: string): Promise<Record<string, Row>> {
  const rows = await q<Row>(
    "SELECT effect_key, owner, delivery, delivery_ref, plan, receipt, state, reason FROM public.cockpit_form_effects WHERE response_id = $1::uuid",
    [id],
  );
  return Object.fromEntries(rows.map(r => [r.effect_key, r]));
}
const stage1 = async () => ({
  notices: await count("SELECT count(*) n FROM public.cockpit_slack_notices"),
  outbox: await count("SELECT count(*) n FROM public.cockpit_creative_outbox"),
  queue: await count(
    "SELECT count(*) n FROM public.cockpit_clickup_writeback_queue",
  ),
});
const normalised = (text: string) =>
  one<string>("SELECT regexp_replace($1, '\\s+', ' ', 'g') AS r", [text]);
function canonical(file: string, name: string): string {
  const hit = migration(file).match(
    new RegExp(
      `CREATE OR REPLACE FUNCTION public\\.${name}\\([\\s\\S]*?AS \\$\\$([\\s\\S]*?)\\$\\$;`,
    ),
  );
  if (!hit) throw new Error(`No body for ${name} in ${file}`);
  return hit[1];
}
const MAKE = [
  "handoff_comment",
  "onboarding_tasks",
  "card_fields",
  "map_phase4",
  "phase4_whatsapp",
];

// ---------------------------------------------------------------------------------------------

describe("the migration", () => {
  test("is one transaction that reloads the schema, opens with its drift guard, and a second apply changes nothing", async () => {
    const sql = migration(Y);
    expect(sql.startsWith("-- ")).toBe(true);
    expect(sql).toMatch(
      /\nBEGIN;\n\n-- -+\n-- 0\. The drift guard[\s\S]*?\nDO \$\$/,
    );
    expect(sql.indexOf("DO $$")).toBeLessThan(
      sql.indexOf("CREATE OR REPLACE FUNCTION"),
    );
    expect(
      sql.trimEnd().endsWith("NOTIFY pgrst, 'reload schema';\nCOMMIT;"),
    ).toBe(true);
    expect([...first].filter(([sig, v]) => twiceFns.get(sig) !== v)).toEqual(
      [],
    );
    expect(auditTwice).toBe(auditOnce);
    expect(
      await count("SELECT count(*) n FROM public.cockpit_form_responses"),
    ).toBe(0);
    for (const [name, live] of [
      ["cockpit_forms_key_put", "68763f4ab3de37be2fe538bc80155a43"],
      ["cockpit_forms_key_mark", "db3c2859624bdbb75b43bf7de85f2672"],
      ["cockpit_forms_key_label", "5f01adc978c71ba5b7834b6083ea0b93"],
      ["cockpit_forms_keys_status", "5ecbb4ae9493c0ef1c6f14cc78c84e12"],
    ]) {
      expect(
        await one("SELECT md5(regexp_replace($1, '\\s+', ' ', 'g')) AS r", [
          canonical("20261027g_fathom_intake.sql", name),
        ]),
      ).toBe(live);
      const after = await one<string>(
        "SELECT md5(regexp_replace(p.prosrc, '\\s+', ' ', 'g')) AS r FROM pg_proc p WHERE p.proname = $1",
        [name],
      );
      expect(sql).toContain(`'${after}'`);
    }
  });

  test("each key function is 20261027g's body with exactly its typeform_kickoff edits", async () => {
    for (const [name, pairs] of Object.entries(KEY_EDITS)) {
      let expected = canonical("20261027g_fathom_intake.sql", name);
      for (const [before, after] of pairs) {
        expect(expected.split(before).length - 1).toBe(1);
        expected = expected.replace(before, () => after);
      }
      const installed = await one<string>(
        "SELECT p.prosrc AS r FROM pg_proc p WHERE p.proname = $1",
        [name],
      );
      expect(await normalised(installed)).toBe(await normalised(expected));
    }
  });

  test("the drift guard refuses a body it did not read", async () => {
    await rolledBack(async () => {
      await ex(`CREATE OR REPLACE FUNCTION public.cockpit_forms_key_label(p_provider text)
        RETURNS text LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$ SELECT 'changed' $$;`);
      expect(await refusal(() => ex(migration(Y)))).toEqual({
        code: "55000",
        message:
          "cockpit_forms_key_label(text) changed since the 2b contract read it; stop and re-read it.",
      });
    });
  });

  test("grants: the key functions keep their live grants; the record RPCs are the service key's; the helpers no role's", async () => {
    const acl = (sig: string) =>
      one<string | null>(
        "SELECT p.proacl::text AS r FROM pg_proc p WHERE p.oid = $1::regprocedure",
        [`public.${sig}`],
      );
    const svc = "{postgres=X/postgres,service_role=X/postgres}";
    for (const sig of [
      "cockpit_forms_key_put(jsonb)",
      "cockpit_forms_key_mark(jsonb)",
      "cockpit_form_record_typeform(jsonb)",
      "cockpit_form_record_sweep(boolean)",
      "cockpit_forms_door_seen(text,text,text)",
    ])
      expect(await acl(sig)).toBe(svc);
    expect(await acl("cockpit_forms_keys_status()")).toBe(
      "{postgres=X/postgres,authenticated=X/postgres}",
    );
    for (const sig of [
      "cockpit_forms_key_label(text)",
      "cockpit_form_record_kickoff(text,text,timestamp with time zone,text)",
      "cockpit_form_record_effect(cockpit_form_responses,jsonb,text,text,text,text,text,text)",
    ])
      expect(await acl(sig)).toBe("{postgres=X/postgres}");
    for (const text of [
      "SELECT public.cockpit_form_record_sweep(false) AS r",
      "SELECT public.cockpit_forms_door_seen('kickoff', 'probe', NULL) AS r",
    ])
      expect((await refusal(() => as(CEO, text))).code).toBe("42501");
  });
});

describe("the kickoff form's signing key", () => {
  /** The meta scripts/dev/forms_key.py's register-typeform marks the key connected with. */
  const registered = (registeredAt: string) => ({
    webhookId: "cockpit",
    tag: "cockpit",
    formId: "tG7dnxBn",
    destination:
      "https://tests.invalid/functions/v1/forms-door/typeform/kickoff",
    registeredAt,
    unregisteredAt: null,
  });
  const doorRow = async () =>
    (
      await q<Row>(
        "SELECT note, detail FROM public.cockpit_sync_state WHERE key = 'forms-door:kickoff'",
      )
    )[0];

  test("the keys CHECK takes typeform_kickoff and refuses typeform_checkin", async () => {
    expect(
      await one(
        "SELECT pg_get_constraintdef(oid) AS r FROM pg_constraint WHERE conrelid = 'public.cockpit_forms_keys'::regclass AND conname = 'cockpit_forms_keys_provider_check'",
      ),
    ).toBe(
      "CHECK ((provider = ANY (ARRAY['fathom'::text, 'fathom_webhook'::text, 'anthropic'::text, 'deepseek'::text, 'typeform_kickoff'::text])))",
    );
    await rolledBack(async () => {
      expect(
        (
          await refusal(() =>
            q(
              "INSERT INTO public.cockpit_forms_keys(provider, vault_name, saved_by) VALUES ('typeform_checkin', 'cockpit_forms_key_typeform_checkin', 'server')",
            ),
          )
        ).code,
      ).toBe("23514");
      expect(
        await one(
          "SELECT public.cockpit_forms_key_label('typeform_kickoff') AS r",
        ),
      ).toBe("Typeform kickoff signing key");
    });
  });

  test("put, mark connected, mark refused: the CEO card's keys stay four and the key shows only in typeform", async () => {
    await rolledBack(async () => {
      const secret = "Tf_kickoff-secret-for-tests-0123456789abcdef";
      expect(
        await refusal(() =>
          as("service", "SELECT public.cockpit_forms_key_put($1::jsonb) AS r", [
            JSON.stringify({
              provider: "typeform_kickoff",
              secret: "short",
              savedBy: "server",
            }),
          ]),
        ),
      ).toEqual({
        code: "22023",
        message:
          "That doesn't look like a Typeform signing secret: 32 to 128 letters, digits, - or _. Nothing was changed.",
      });
      const put = await as<Row>(
        "service",
        "SELECT public.cockpit_forms_key_put($1::jsonb) AS r",
        [
          JSON.stringify({
            provider: "typeform_kickoff",
            secret,
            savedBy: "server",
          }),
        ],
      );
      expect(put).toEqual({
        ok: true,
        provider: "typeform_kickoff",
        last4: "cdef",
        state: "unchecked",
      });
      expect(
        await one(
          "SELECT decrypted_secret AS r FROM vault.decrypted_secrets WHERE name = 'cockpit_forms_key_typeform_kickoff'",
        ),
      ).toBe(secret);
      let door = (
        await q<Row>(
          "SELECT note, detail FROM public.cockpit_sync_state WHERE key = 'forms-door:kickoff'",
        )
      )[0];
      expect(door.detail).toEqual({
        registered: false,
        registeredAt: null,
        lastDelivery: null,
        outcome: null,
      });
      expect(door.note).toBe(
        "The kickoff signing key is saved; the webhook is not registered with it yet.",
      );
      let status = await as<Row>(
        CEO,
        "SELECT public.cockpit_forms_keys_status() AS r",
      );
      expect((status.keys as Row[]).map(k => k.provider)).toEqual([
        "fathom",
        "fathom_webhook",
        "deepseek",
        "anthropic",
      ]);
      expect(status.typeform).toEqual([
        {
          form: "kickoff",
          connected: false,
          last4: "cdef",
          registered: false,
          lastDelivery: null,
        },
      ]);
      expect(JSON.stringify(status)).not.toContain(secret);
      const savedAt = await one<string>(
        "SELECT saved_at::text AS r FROM public.cockpit_forms_keys WHERE provider = 'typeform_kickoff'",
      );
      const mark = (state: string, meta: Row = {}) =>
        as<Row>(
          "service",
          "SELECT public.cockpit_forms_key_mark($1::jsonb) AS r",
          [
            JSON.stringify({
              provider: "typeform_kickoff",
              state,
              savedAt,
              meta,
              note: "Checked by the test.",
            }),
          ],
        );
      const registeredAt = ago(1);
      expect(await mark("connected", registered(registeredAt))).toEqual({
        ok: true,
        provider: "typeform_kickoff",
        state: "connected",
      });
      door = await doorRow();
      expect(door).toEqual({
        note: "The kickoff webhook is registered.",
        detail: {
          registered: true,
          registeredAt,
          lastDelivery: null,
          outcome: null,
        },
      });
      status = await as<Row>(
        CEO,
        "SELECT public.cockpit_forms_keys_status() AS r",
      );
      expect(status.typeform[0]).toMatchObject({
        connected: true,
        registered: true,
      });
      expect((status.keys as Row[]).map(k => k.provider)).toEqual([
        "fathom",
        "fathom_webhook",
        "deepseek",
        "anthropic",
      ]);
      // A door delivery keeps the registration and records its outcome.
      await as(
        "service",
        "SELECT public.cockpit_forms_door_seen('kickoff', 'recorded', NULL) AS r",
      );
      expect(
        (await as<Row>(CEO, "SELECT public.cockpit_forms_keys_status() AS r"))
          .typeform[0].lastDelivery,
      ).not.toBeNull();
      expect(await mark("refused", { unregisteredAt: ago(0) })).toMatchObject({
        ok: true,
        state: "refused",
      });
      door = await doorRow();
      expect(door.note).toBe(
        "The kickoff webhook is not registered: kickoffs arrive by the 15-minute read.",
      );
      expect(door.detail).toMatchObject({
        registered: false,
        registeredAt: null,
        outcome: "recorded",
      });
      expect(
        await q(
          "SELECT before, after FROM public.cockpit_audit_log WHERE action = 'forms.keyState' AND entity_id = 'typeform_kickoff' ORDER BY test_seq",
        ),
      ).toEqual([
        {
          before: { state: "unchecked", registered: false },
          after: { state: "connected", registered: true },
        },
        {
          before: { state: "connected", registered: true },
          after: { state: "refused", registered: false },
        },
      ]);
      // An unknown provider is still refused, with the sentence naming the five.
      expect(
        await refusal(() =>
          as(
            "service",
            "SELECT public.cockpit_forms_key_mark($1::jsonb) AS r",
            [
              JSON.stringify({
                provider: "typeform_checkin",
                state: "connected",
                savedAt,
              }),
            ],
          ),
        ),
      ).toEqual({
        code: "22023",
        message:
          "Choose fathom, fathom_webhook, anthropic, deepseek or typeform_kickoff.",
      });
      // No audit row holds the secret.
      expect(
        await count(
          "SELECT count(*) n FROM public.cockpit_audit_log WHERE coalesce(before::text,'') || coalesce(after::text,'') || metadata::text LIKE '%' || $1 || '%'",
          [secret],
        ),
      ).toBe(0);
    });
  });

  test("registered is a webhook id with no unregisteredAt, as forms_key.py reads it; registeredAt is the registration's own time", async () => {
    await rolledBack(async () => {
      // typeform-secret: 32 random bytes as base64url without padding, 43 characters.
      const secret = Buffer.from(
        Array.from({ length: 32 }, (_, i) => (i * 37 + 11) % 256),
      ).toString("base64url");
      expect(secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
      const put = (s: string) =>
        as<Row>(
          "service",
          "SELECT public.cockpit_forms_key_put($1::jsonb) AS r",
          [
            JSON.stringify({
              provider: "typeform_kickoff",
              secret: s,
              savedBy: "server",
              state: "unchecked",
              meta: { form: "kickoff", tag: "cockpit" },
            }),
          ],
        );
      expect(await put(secret)).toMatchObject({ ok: true, state: "unchecked" });
      const savedAt = () =>
        one<string>(
          "SELECT saved_at::text AS r FROM public.cockpit_forms_keys WHERE provider = 'typeform_kickoff'",
        );
      const mark = async (state: string, meta: Row) =>
        as<Row>(
          "service",
          "SELECT public.cockpit_forms_key_mark($1::jsonb) AS r",
          [
            JSON.stringify({
              provider: "typeform_kickoff",
              state,
              savedAt: await savedAt(),
              meta,
            }),
          ],
        );
      const typeform = async () =>
        (await as<Row>(CEO, "SELECT public.cockpit_forms_keys_status() AS r"))
          .typeform[0];
      // A key checked connected without a webhook id is not a registration.
      await mark("connected", { tag: "cockpit" });
      expect(await doorRow()).toEqual({
        note: "The kickoff webhook is not registered: kickoffs arrive by the 15-minute read.",
        detail: {
          registered: false,
          registeredAt: null,
          lastDelivery: null,
          outcome: null,
        },
      });
      expect(await typeform()).toMatchObject({
        connected: true,
        registered: false,
      });
      // register-typeform: the guardian counts missed kickoffs from registeredAt.
      const registeredAt = ago(2);
      await mark("connected", registered(registeredAt));
      expect((await doorRow()).detail).toEqual({
        registered: true,
        registeredAt,
        lastDelivery: null,
        outcome: null,
      });
      expect(await typeform()).toMatchObject({
        connected: true,
        registered: true,
      });
      // A delivery keeps the registration; a row removed by hand is rebuilt from the key.
      await as(
        "service",
        "SELECT public.cockpit_forms_door_seen('kickoff', 'recorded', NULL) AS r",
      );
      expect((await doorRow()).detail).toMatchObject({
        registered: true,
        registeredAt,
        outcome: "recorded",
        reason: null,
      });
      await q(
        "DELETE FROM public.cockpit_sync_state WHERE key = 'forms-door:kickoff'",
      );
      await as(
        "service",
        "SELECT public.cockpit_forms_door_seen('kickoff', 'repeat', NULL) AS r",
      );
      expect((await doorRow()).detail).toMatchObject({
        registered: true,
        registeredAt,
        outcome: "repeat",
        reason: null,
      });
      // unregister-typeform: refused with unregisteredAt.
      await mark("refused", { unregisteredAt: ago(0) });
      expect((await doorRow()).detail).toMatchObject({
        registered: false,
        registeredAt: null,
        outcome: "repeat",
      });
      expect(await typeform()).toMatchObject({
        connected: false,
        registered: false,
      });
      // Registered again, then a new secret: the put replaces the meta, so it is not registered until registered again.
      await mark("connected", registered(ago(1)));
      expect((await doorRow()).detail.registered).toBe(true);
      expect(await put(`${secret.slice(0, 40)}xyz`)).toMatchObject({
        ok: true,
        last4: `${secret.slice(39, 40)}xyz`,
      });
      expect(await doorRow()).toEqual({
        note: "The kickoff signing key is saved; the webhook is not registered with it yet.",
        detail: {
          registered: false,
          registeredAt: null,
          lastDelivery: expect.any(String),
          outcome: "repeat",
          reason: null,
        },
      });
      expect(await typeform()).toMatchObject({ registered: false });
    });
  });
});

describe("cockpit_form_record_typeform and cockpit_forms_door_seen", () => {
  test("refuse checkin and any other form; door_seen takes only its six outcomes", async () => {
    for (const formKey of ["checkin", "blueprint", "nope"])
      expect(
        await refusal(() =>
          as(
            "service",
            "SELECT public.cockpit_form_record_typeform($1::jsonb) AS r",
            [
              JSON.stringify({
                formKey,
                token: token(),
                submittedAt: ago(5),
                via: "typeform_webhook",
              }),
            ],
          ),
        ),
      ).toEqual({
        code: "22023",
        message: "Only the kickoff form is recorded from Typeform in 2b.",
      });
    expect(
      await refusal(() =>
        as(
          "service",
          "SELECT public.cockpit_forms_door_seen('checkin', 'recorded', NULL) AS r",
        ),
      ),
    ).toEqual({
      code: "22023",
      message: "Only the kickoff form has a cockpit webhook in 2b.",
    });
    expect(
      await refusal(() =>
        as(
          "service",
          "SELECT public.cockpit_forms_door_seen('kickoff', 'stored', NULL) AS r",
        ),
      ),
    ).toEqual({
      code: "22023",
      message: "Choose recorded, repeat, ignored, probe, unsigned or failed.",
    });
    for (const [p, message] of [
      [{ token: "bad token" }, "That is not a Typeform response token."],
      [{ via: "email" }, "Choose typeform_webhook or typeform_sync."],
      [
        { submittedAt: "not a time" },
        "The response has no readable submit time.",
      ],
      [{ answers: { a: 1 } }, "The answers come as a list."],
    ] as const)
      expect(
        await refusal(() =>
          as(
            "service",
            "SELECT public.cockpit_form_record_typeform($1::jsonb) AS r",
            [
              JSON.stringify({
                formKey: "kickoff",
                token: token(),
                submittedAt: ago(5),
                via: "typeform_webhook",
                ...p,
              }),
            ],
          ),
        ),
      ).toEqual({ code: "22023", message });
    await rolledBack(async () => {
      for (const outcome of [
        "recorded",
        "repeat",
        "ignored",
        "probe",
        "unsigned",
        "failed",
      ]) {
        expect(
          await as(
            "service",
            "SELECT public.cockpit_forms_door_seen('kickoff', $1, 'Invented reason.') AS r",
            [outcome],
          ),
        ).toEqual({ ok: true, outcome });
        const row = (
          await q<Row>(
            "SELECT ok, note, detail FROM public.cockpit_sync_state WHERE key = 'forms-door:kickoff'",
          )
        )[0];
        expect(row.detail.outcome).toBe(outcome);
        // An unsigned request is quiet; this failure is a store refusal, a real fault.
        expect(row.ok).toBe(outcome !== "failed");
      }
      expect(
        (
          await q<Row>(
            "SELECT note FROM public.cockpit_sync_state WHERE key = 'forms-door:kickoff'",
          )
        )[0].note,
      ).toMatch(/^A kickoff could not be stored at .+: Invented reason\.$/);
    });
  });

  test("forms-door:kickoff never reads failing or overdue because it exists or an outsider posted; only a real fault fails it", async () => {
    const NO_KEY = "No signing key saved";
    const row = async () =>
      (
        await q<Row>(
          "SELECT ok, note, last_ok_at::text AS last_ok_at, last_run_at::text AS last_run_at, detail FROM public.cockpit_sync_state WHERE key = 'forms-door:kickoff'",
        )
      )[0];
    // What the CEO's Machine tab reads as overdue (hermes/ceo-refresh/repository.ts staleJobs).
    const staleForMachine = () =>
      count(
        "SELECT count(*) n FROM public.cockpit_sync_state WHERE key = 'forms-door:kickoff' AND (NOT ok OR last_ok_at IS NULL)",
      );
    const seen = (outcome: string, reason: string | null) =>
      as(
        "service",
        "SELECT public.cockpit_forms_door_seen('kickoff', $1, $2) AS r",
        [outcome, reason],
      );
    const put = () =>
      as<Row>(
        "service",
        "SELECT public.cockpit_forms_key_put($1::jsonb) AS r",
        [
          JSON.stringify({
            provider: "typeform_kickoff",
            secret: "Tf_kickoff-secret-for-tests-0123456789abcdef",
            savedBy: "server",
          }),
        ],
      );
    const mark = async (state: string, meta: Row) =>
      as<Row>(
        "service",
        "SELECT public.cockpit_forms_key_mark($1::jsonb) AS r",
        [
          JSON.stringify({
            provider: "typeform_kickoff",
            state,
            savedAt: await one<string>(
              "SELECT saved_at::text AS r FROM public.cockpit_forms_keys WHERE provider = 'typeform_kickoff'",
            ),
            meta,
            note: "Checked by the test.",
          }),
        ],
      );
    const webhook = {
      webhookId: "cockpit",
      tag: "cockpit",
      formId: "tG7dnxBn",
      destination:
        "https://tests.invalid/functions/v1/forms-door/typeform/kickoff",
      registeredAt: ago(1),
      unregisteredAt: null,
    };

    // The first thing the row ever sees is an unsigned POST: running, not failing.
    await rolledBack(async () => {
      await seen("unsigned", "The signature was missing or did not match.");
      const r = await row();
      expect(r.ok).toBe(true);
      expect(r.last_ok_at).not.toBeNull();
      expect(r.detail.outcome).toBe("unsigned");
      expect(await staleForMachine()).toBe(0);
    });
    // Or the 503 of a door with no key (D11's read-back): the same, in its own words.
    await rolledBack(async () => {
      await seen("failed", NO_KEY);
      const r = await row();
      expect(r.ok).toBe(true);
      expect(r.note).toMatch(
        /^A delivery at .+ could not be checked: no signing key is saved yet\.$/,
      );
      expect(r.detail).toMatchObject({ outcome: "failed", reason: NO_KEY });
      expect(await staleForMachine()).toBe(0);
    });
    // A saved key, and a mark, each make a row that is not failing; so a refused B3 stays quiet.
    await rolledBack(async () => {
      await put();
      expect((await row()).ok).toBe(true);
      expect((await row()).last_run_at).not.toBeNull();
      expect(await staleForMachine()).toBe(0);
      await q(
        "DELETE FROM public.cockpit_sync_state WHERE key = 'forms-door:kickoff'",
      );
      await mark("refused", { unregisteredAt: ago(0) });
      expect((await row()).ok).toBe(true);
      expect(await staleForMachine()).toBe(0);
    });
    // A signed delivery the store refused fails the row, registered or not. No
    // outsider can clear it, or overwrite its sentence, by posting.
    await rolledBack(async () => {
      await put();
      const before = (await row()).last_ok_at;
      const reason = "The store refused the response (42P01).";
      await seen("failed", reason);
      const fault = await row();
      expect(fault.ok).toBe(false);
      expect(fault.note).toMatch(/^A kickoff could not be stored at .+42P01/);
      expect(fault.last_ok_at).toBe(before);
      for (const [outcome, why] of [
        ["unsigned", "The signature was missing or did not match."],
        ["failed", NO_KEY],
      ] as const) {
        await seen(outcome, why);
        const held = await row();
        expect(held.ok).toBe(false);
        expect(held.note).toBe(fault.note);
        expect(held.last_ok_at).toBe(before);
        expect(held.detail.outcome).toBe(outcome);
      }
      // A signed delivery that works clears it.
      await seen("probe", "A signed probe; nothing stored.");
      const clear = await row();
      expect(clear.ok).toBe(true);
      expect(clear.note).toMatch(/^The signed probe reached the door at /);
      expect(await staleForMachine()).toBe(0);
    });
    // A registered webhook that lost its key refuses real deliveries: that is a fault.
    await rolledBack(async () => {
      await put();
      await mark("connected", webhook);
      await seen("failed", NO_KEY);
      expect((await row()).ok).toBe(false);
      // A mark that keeps the webhook registered does not clear it; unregistering does,
      // since there is then no delivery left to lose.
      await mark("connected", webhook);
      expect((await row()).ok).toBe(false);
      await mark("refused", { unregisteredAt: ago(0) });
      const off = await row();
      expect(off.ok).toBe(true);
      expect(off.note).toBe(
        "The kickoff webhook is not registered: kickoffs arrive by the 15-minute read.",
      );
      expect(await staleForMachine()).toBe(0);
      // So does saving a new key, which is unregistered until it is registered again.
      await seen("failed", "The store refused the response.");
      expect((await row()).ok).toBe(false);
      await put();
      expect((await row()).ok).toBe(true);
      expect(await staleForMachine()).toBe(0);
    });
  });

  test("the webhook stores the Typeform row when absent and one response with a pointer; Make and shadow effects are skipped", async () => {
    await rolledBack(async () => {
      const t = token();
      const out = await webhook(t);
      expect(out).toMatchObject({
        ok: true,
        inserted: true,
        taskId: A,
        state: "submitted",
      });
      const stored = await q<Row>(
        "SELECT form_id, form_kind, task_id, matched_by, hidden, answers FROM public.cockpit_csm_call_forms WHERE token = $1",
        [t],
      );
      expect(stored).toEqual([
        {
          form_id: "tG7dnxBn",
          form_kind: "kickoff",
          task_id: A,
          matched_by: "hidden_field",
          hidden: HIDDEN(A),
          answers: ANSWERS,
        },
      ]);
      const [r] = await response("external_id = $1", [t]);
      expect(r).toMatchObject({
        id: out.id,
        form_key: "kickoff",
        source: "typeform_webhook",
        task_id: A,
        client_name: "Acme Interiors",
        mode: "live",
        state: "submitted",
        created_by: "typeform",
        created_by_id: null,
      });
      expect(r.answers).toEqual({
        source: "typeform",
        formId: "tG7dnxBn",
        token: t,
      });
      expect(r.hidden).toEqual({ onboarding_client_id: A });
      const e = await effectsOf(out.id);
      for (const k of MAKE)
        expect(e[k]).toMatchObject({
          owner: "make",
          state: "skipped",
          reason: "Make owns this.",
        });
      expect(e.recap).toMatchObject({
        owner: "shadow",
        state: "skipped",
        reason: "No cockpit plan for this yet.",
      });
      expect(e.kickoff_notice).toBeUndefined();
      // Again: the same response, nothing new.
      expect(await webhook(t)).toMatchObject({
        ok: true,
        id: out.id,
        inserted: false,
      });
      expect(
        await count(
          "SELECT count(*) n FROM public.cockpit_form_effects WHERE response_id = $1::uuid",
          [out.id],
        ),
      ).toBe(6);
      // A card off the roster is the typed client, with no match.
      const u = token();
      expect(await webhook(u, "taskZ9")).toMatchObject({
        inserted: true,
        taskId: null,
      });
      expect(
        await q(
          "SELECT task_id, typed_client, matched_by FROM public.cockpit_csm_call_forms WHERE token = $1",
          [u],
        ),
      ).toEqual([{ task_id: null, typed_client: "taskZ9", matched_by: null }]);
    });
  });

  test("one response whoever writes first, and a person's match is never overwritten", async () => {
    await rolledBack(async () => {
      // The read first, then the webhook.
      const t1 = token();
      await storedKickoff(t1);
      expect((await sweep()).kickoff).toEqual({ recorded: 1, already: 0 });
      const out = await webhook(t1);
      expect(out.inserted).toBe(false);
      expect(await response("external_id = $1", [t1])).toHaveLength(1);
      expect((await response("external_id = $1", [t1]))[0].source).toBe(
        "typeform_sync",
      );
      // The webhook first, then the read.
      const t2 = token();
      await webhook(t2);
      expect((await sweep()).kickoff).toEqual({ recorded: 0, already: 2 });
      expect(await response("external_id = $1", [t2])).toHaveLength(1);
      // A person placed the stored row on Beta: the webhook leaves it, and the response follows it.
      const t3 = token();
      await storedKickoff(t3, { task: B, manual: true });
      const placed = await webhook(t3);
      expect(placed.taskId).toBe(B);
      expect(
        await q(
          "SELECT task_id, matched_by FROM public.cockpit_csm_call_forms WHERE token = $1",
          [t3],
        ),
      ).toEqual([{ task_id: B, matched_by: "manual" }]);
    });
  });
});

describe("the record sweep", () => {
  test("the kickoff notice: waiting while Stage 1 is in flight, delivered when it posted, skipped with its reason, and the 48-hour sentence", async () => {
    await rolledBack(async () => {
      const t = {
        fresh: token(),
        queued: token(),
        posted: token(),
        skipped: token(),
        old: token(),
      };
      for (const [k, v] of Object.entries(t))
        await storedKickoff(v, { at: k === "old" ? ago(60 * 49) : ago(30) });
      await kickoffNotice(t.queued, "sending");
      const posted = await kickoffNotice(t.posted, "posted");
      await kickoffNotice(
        t.skipped,
        "skipped",
        "This kickoff was more than 48 hours old when the mirror listed it, so it was not posted.",
      );
      const before = await stage1();
      const out = await sweep();
      expect(out).toEqual({
        apply: true,
        kickoff: { recorded: 5, already: 0 },
        blueprint: { recorded: 0 },
        effects: { delivered: 1, skipped: 2, waiting: 2 },
        errors: 0,
      });
      expect(await stage1()).toEqual(before);
      const notice = async (k: keyof typeof t) => {
        const [r] = await response("external_id = $1", [t[k]]);
        return (await effectsOf(r.id)).kickoff_notice;
      };
      expect(await notice("fresh")).toBeUndefined();
      expect(await notice("queued")).toBeUndefined();
      expect(await notice("posted")).toMatchObject({
        owner: "cockpit",
        delivery: "slack_notice",
        state: "delivered",
        delivery_ref: posted,
        reason: null,
      });
      expect((await notice("posted")).plan).toEqual({
        recorded: true,
        lines: [],
        stage1: {
          table: "cockpit_slack_notices",
          id: posted,
          dedupeKey: `kickoff:${t.posted}`,
          state: "posted",
        },
      });
      expect(await notice("skipped")).toMatchObject({
        state: "skipped",
        delivery_ref: null,
        reason:
          "Stage 1 did not send it: This kickoff was more than 48 hours old when the mirror listed it, so it was not posted.",
      });
      expect(await notice("old")).toMatchObject({
        state: "skipped",
        reason: "No Stage 1 notice was made for this kickoff.",
      });
      // Stage 1 posts the one in flight: the next sweep records it, once.
      await q(
        "UPDATE public.cockpit_slack_notices SET state = 'posted', slack_ts = '1730000000.000300', channel = 'C09RZ0GS0V9' WHERE dedupe_key = $1",
        [`kickoff:${t.queued}`],
      );
      expect((await sweep()).effects).toEqual({
        delivered: 1,
        skipped: 0,
        waiting: 1,
      });
      expect((await notice("queued")).state).toBe("delivered");
      // Nothing is ever planned, queued or dispatched for a record.
      expect(
        await count(
          "SELECT count(*) n FROM public.cockpit_form_effects WHERE state IN ('planned','queued')",
        ),
      ).toBe(0);
    });
  });

  test("presses: one response per press with its part and press number; the outbox and notices recorded; a later press's notices were posted for an earlier one", async () => {
    await rolledBack(async () => {
      const launch = await press("blueprintLaunch", A, "done");
      const close1 = await press("blueprintClose", A, "done");
      const failed = await press(
        "blueprintLaunch",
        B,
        "failed",
        "ClickUp refused the launch task.",
      );
      const offer = await press("blueprintOffer", A, "pending");
      // Stage 1 queued the close and media notices when the first close left sending; it posts the close.
      const closeNotice = await one<string>(
        "SELECT id::text AS r FROM public.cockpit_slack_notices WHERE dedupe_key = $1",
        [`blueprint:${A}:close`],
      );
      await q(
        "UPDATE public.cockpit_slack_notices SET state = 'sending' WHERE id = $1::uuid",
        [closeNotice],
      );
      await q(
        "UPDATE public.cockpit_slack_notices SET state = 'posted', slack_ts = '1730000000.000400', channel = 'C09RZ0GS0V9' WHERE id = $1::uuid",
        [closeNotice],
      );
      const close2 = await press("blueprintClose", A, "done");
      const before = await stage1();
      const out = await sweep();
      expect(await stage1()).toEqual(before);
      expect(out.blueprint).toEqual({ recorded: 5 });
      const [r1] = await response("id = $1::uuid", [launch]);
      expect(r1).toMatchObject({
        form_key: "blueprint",
        source: "cockpit",
        task_id: A,
        client_name: "Acme Interiors",
        mode: "live",
        state: "submitted",
        created_by: CREATIVE_EMAIL,
        created_by_id: CREATIVE,
      });
      expect(r1.answers).toEqual({ part: 1, press: 1, outboxId: launch });
      expect((await response("id = $1::uuid", [close2]))[0].answers).toEqual({
        part: 2,
        press: 2,
        outboxId: close2,
      });
      const e1 = await effectsOf(launch);
      expect(Object.keys(e1)).toEqual(["launch_task"]);
      expect(e1.launch_task).toMatchObject({
        owner: "cockpit",
        delivery: "creative_outbox",
        state: "delivered",
        delivery_ref: launch,
      });
      const c1 = await effectsOf(close1);
      expect(c1.close_card).toMatchObject({
        state: "delivered",
        delivery_ref: close1,
      });
      expect(c1.close_notice).toMatchObject({
        state: "delivered",
        delivery_ref: closeNotice,
      });
      expect(c1.media_notice).toBeUndefined(); // queued by Stage 1, not posted yet
      expect(c1.phase5_whatsapp).toMatchObject({
        owner: "shadow",
        state: "skipped",
        reason: "No cockpit plan for this yet.",
      });
      expect(c1.recap).toMatchObject({ owner: "shadow", state: "skipped" });
      const c2 = await effectsOf(close2);
      expect(c2.close_card).toMatchObject({
        state: "delivered",
        delivery_ref: close2,
      });
      expect(c2.close_notice).toMatchObject({
        state: "skipped",
        reason: "Posted for an earlier press.",
        delivery_ref: null,
      });
      expect(c2.media_notice).toMatchObject({
        state: "skipped",
        reason: "Posted for an earlier press.",
      });
      expect((await effectsOf(failed)).launch_task).toMatchObject({
        state: "skipped",
        reason: "The press did not run: ClickUp refused the launch task.",
      });
      expect(await effectsOf(offer)).toEqual({});
      // Delivered: the launch, both close cards and the first close's notice; waiting: its media notice and the offer.
      expect(out.effects).toEqual({ delivered: 4, skipped: 3, waiting: 2 });
    });
  });

  test("p_apply false writes nothing and counts the same; a second sweep writes nothing", async () => {
    await rolledBack(async () => {
      for (let i = 0; i < 3; i++) await storedKickoff(token());
      await press("blueprintClose", A, "done");
      const snap = async () => ({
        responses: await count(
          "SELECT count(*) n FROM public.cockpit_form_responses",
        ),
        effects: await count(
          "SELECT count(*) n FROM public.cockpit_form_effects",
        ),
        audit: await count("SELECT count(*) n FROM public.cockpit_audit_log"),
        ...(await stage1()),
      });
      const before = await snap();
      const dry = await sweep(false);
      expect(await snap()).toEqual(before);
      expect(dry.apply).toBe(false);
      const real = await sweep(true);
      expect({ ...real, apply: false }).toEqual(dry);
      expect(real.kickoff.recorded).toBe(3);
      const after = await snap();
      expect(await sweep(true)).toMatchObject({
        kickoff: { recorded: 0, already: 3 },
        blueprint: { recorded: 0 },
      });
      expect(await snap()).toEqual(after);
      expect(
        await one(
          "SELECT current_setting('cockpit.forms_record', true) || current_setting('cockpit.forms_action', true) AS r",
        ),
      ).toBe("");
    });
  });

  test("no audit row holds a kickoff's hidden email or phone, or its answers", async () => {
    await rolledBack(async () => {
      await storedKickoff(token());
      await webhook(token());
      await sweep();
      expect(
        await count(
          "SELECT count(*) n FROM public.cockpit_audit_log WHERE coalesce(before::text,'') || coalesce(after::text,'') || metadata::text ~ $1",
          [
            `${CONTACT_EMAIL}|${CONTACT_PHONE.replace(/\+/g, "\\+")}|Invented goal`,
          ],
        ),
      ).toBe(0);
      expect(
        await count(
          "SELECT count(*) n FROM public.cockpit_audit_log WHERE entity_type = 'cockpit_form_responses'",
        ),
      ).toBe(2);
    });
  });

  test("the effects guard refuses a delivered insert without the flag, for a Make effect, without its row and for the 1-1 notes", async () => {
    await rolledBack(async () => {
      const t = token();
      const { id } = await webhook(t);
      const insert = (
        key: string,
        owner: string,
        ref: string | null,
        form = "kickoff",
        rid = id,
      ) =>
        q(
          `INSERT INTO public.cockpit_form_effects(response_id, form_key, effect_key, dedupe_key, owner, delivery, delivery_ref, state)
           VALUES ($1::uuid, $2, $3, $1 || ':' || $3, $4, 'slack_notice', $5, 'delivered')`,
          [rid, form, key, owner, ref],
        );
      expect(
        (await refusal(() => insert("kickoff_notice", "cockpit", "n-1")))
          .message,
      ).toBe("An effect starts planned, dry_run or skipped");
      await q("SELECT set_config('cockpit.forms_record', 'on', true)");
      expect(
        (await refusal(() => insert("kickoff_notice", "make", "n-1"))).message,
      ).toBe("Only an effect the cockpit owns can be delivered");
      expect(
        (await refusal(() => insert("kickoff_notice", "cockpit", null)))
          .message,
      ).toBe("An effect starts planned, dry_run or skipped");
      await q(
        `INSERT INTO public.cockpit_form_responses(id, form_key, form_version, source, task_id, mode, state, created_by, submitted_at)
         VALUES ('6c000000-0000-4000-8000-000000000001', 'checkin', 1, 'import', $1, 'live', 'submitted', 'import', now())`,
        [A],
      );
      expect(
        (
          await refusal(() =>
            insert(
              "grade_notice",
              "cockpit",
              "n-1",
              "checkin",
              "6c000000-0000-4000-8000-000000000001",
            ),
          )
        ).message,
      ).toBe("An effect starts planned, dry_run or skipped");
      await insert("kickoff_notice", "cockpit", "n-1");
      expect((await effectsOf(id)).kickoff_notice.state).toBe("delivered");
    });
  });
});
