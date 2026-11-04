/**
 * The sale tie (20261103g_sale_tie.sql; docs/forms/WAVE56-CONTRACT.md 4.19; next-design sale-tie.md section 4): every
 * New Client Form on its client card, by an exact phone or email digest or a person, never a name.
 *
 * The functions 20261103g replaces are cut from their canonical migrations (the responses guard from 20261102b, the
 * portal's onboarding open from 20261102j, the doors from 20261102g), and the ground proves each is the live body by
 * the md5 the file's drift guard names. What the file reads is cut too (cockpit_form_typeform_text from 20261102o,
 * cockpit_billing_card_listed from 20261023x, the identity and client gates, the forms audit, the effects guard and the
 * queue audit as live), and stand-in tables give the reads their live columns. The vault and pgcrypto's hmac are
 * stand-ins (PGlite has no pgcrypto): the HMAC is checked against node's own here, so a digest in a test is the
 * digest live. Billing's deal assignments and the CSM client gate are stand-ins that read a test table.
 *
 * Every client, card, person, phone, email and answer is invented. Phones use the unassigned 0000 block.
 */
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { createHmac } from "node:crypto";
import { existsSync } from "node:fs";
import type { PGlite } from "@electric-sql/pglite";
import { formStep } from "../../../supabase/functions/clickup-writeback/forms";
import { actor, cockpitTestDb, member, migration, owner } from "./lib/cockpitTestDb";

setDefaultTimeout(180_000);

const FILE = "20261103g_sale_tie.sql";
/** Build B2's gate (the (new_client, sale_facts) branch, next-design plan 2.2): its own body when it is on the branch. */
const B2 = "20261103c_stage4_profile_backfill.sql";
const B2_ON_BRANCH = existsSync(new URL(`../../../supabase/migrations/${B2}`, import.meta.url));
/** Until B2 is on the branch: 20261102j's gate plus exactly B2's documented branch (20261103c header, item 1). */
const B2_BRANCH = `
    IF v_pass IS NULL AND p_delivery = 'clickup_queue' AND e.state IN ('queued','unknown') AND e.owner = 'cockpit'
       AND ((e.form_key = 'onboarding' AND e.effect_key = 'profile_backfill')
         OR (e.form_key = 'new_client' AND e.effect_key = 'sale_facts')) THEN
      v_pass := v_pick;
    END IF;
  END LOOP;
  IF v_rows = 0 THEN`;
function b2Gate(): string {
  if (B2_ON_BRANCH) return fnDef(migration(B2), "cockpit_form_effect_gate");
  const today = fnDef(migration("20261102j_stage4_native.sql"), "cockpit_form_effect_gate");
  const anchor = "\n  END LOOP;\n  IF v_rows = 0 THEN";
  if (today.split(anchor).length !== 2) throw new Error("20261102j's gate changed: re-cut the B2 stand-in");
  return today.replace(anchor, B2_BRANCH);
}
const todayGate = () => fnDef(migration("20261102j_stage4_native.sql"), "cockpit_form_effect_gate");
const LIVE = {
  "cockpit_form_responses_guard()": "d013e81456ebe7a8791270fe8858b972",
  "portal_form_onboarding_open(text,text,text,text)": "81c9ede6f7c2c511d1e34c22388ddf24",
  "cockpit_form_doors()": "709af1bfae87a41adaa5edf46ca5f0a9",
} as const;

const CEO = "5a1e0000-0000-4000-8000-000000000001";
const CSM = "5a1e0000-0000-4000-8000-000000000002";
const CREATIVE = "5a1e0000-0000-4000-8000-000000000003";
const ADMIN = "5a1e0000-0000-4000-8000-000000000004";

const REF = {
  business: "a1be4eee-8219-4228-8423-8cbf64919c5f",
  closer: "a86cbf90-2154-44d9-84e3-b4a20f8e96a2",
  goLive: "e30bc458-1bf3-4840-a849-f2443843ed8a",
  handoff: "3cf4bfdf-f42a-447c-a109-a0d24468c5cd",
  expect: "23dd5b40-144e-462e-bfac-795058701f2b",
  link: "52ca9be9-8f56-4bb8-a130-dc1754e7d84d",
  rawPhone: "f322053a-3b86-4e8c-8596-93d31a096679",
  first: "01247377-41fd-430d-bafd-c7223cfb911f",
  onbPhone: "64f2fb80-b074-4017-b8b7-b7d549947e52",
  onbEmail: "7994f0d2-baeb-451b-983a-816290873a68",
} as const;
const FIELD = {
  goLive: "d4483463-840f-4730-ae7f-bfa77c5bb22a",
  handoff: "e17a1c27-ec34-4f87-8796-3cf1f8fa80f9",
  link: "1f2e9ad1-98d8-410d-9994-ac6da91ff91d",
} as const;
/** The card fields this path must never name (sale-tie.md 2.8). */
const NEVER = ["63af118b", "890d4ab8", "539743c2", "e0ca65e7", "a90c8230", "085d5e18", "17d17129", "f071ee8f"];

type Row = Record<string, any>;
let db: PGlite;
const json = (v: unknown) => JSON.stringify(v);
const HOUR = 3_600_000;
const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();

/** A function's whole CREATE statement in a migration (the last one when it is defined twice). */
function fnDef(sql: string, name: string): string {
  const head = `CREATE OR REPLACE FUNCTION public.${name}(`;
  const start = sql.lastIndexOf(head);
  if (start < 0) throw new Error(`Canonical definition missing: ${name}`);
  const as = /AS\s+(\$[A-Za-z_]*\$)/g;
  as.lastIndex = start;
  const m = as.exec(sql);
  if (!m) throw new Error(`No body for ${name}`);
  const close = sql.indexOf(`${m[1]};`, m.index + m[0].length);
  return sql.slice(start, close + m[1].length + 1);
}
async function one<T = any>(text: string, params: unknown[] = []): Promise<T> {
  return (await db.query<{ r: T }>(text, params)).rows[0]?.r as T;
}
async function refusal(fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (e) {
    const x = e as { code?: string; message: string };
    return { code: x.code ?? "", message: x.message };
  }
  throw new Error("Expected a refusal");
}
async function asService<T>(fn: () => Promise<T>): Promise<T> {
  await owner(db);
  await db.query("SELECT set_config('request.jwt.claim.sub', '', false), set_config('request.jwt.claims', $1, false)", [
    json({ role: "service_role" }),
  ]);
  await db.exec("SET ROLE service_role");
  try {
    return await fn();
  } finally {
    await owner(db);
    await db.query("SELECT set_config('request.jwt.claims', '', false)");
  }
}
const md5Of = (fn: string) =>
  one<string>(
    "SELECT md5(regexp_replace(p.prosrc, '\\s+', ' ', 'g')) AS r FROM pg_proc p WHERE p.oid = to_regprocedure($1)",
    [`public.${fn}`],
  );
/** The (function, live, after) rows of the file's drift guard. */
function guardRows(sql: string): [string, string, string][] {
  const out: [string, string, string][] = [];
  for (const m of sql.matchAll(/\('([a-z_]+\([^)]*\))', '([0-9a-f]{32})', '([0-9a-f]{32})'\)/g)) out.push([m[1], m[2], m[3]]);
  return out;
}

// ---- the world ----------------------------------------------------------------------------------------------------

const flags = (v: Row) =>
  owner(db).then(() =>
    db.query("UPDATE public.cockpit_settings SET value = value || $1::jsonb, updated_by = 'test' WHERE key = 'forms.sale_tie'", [json(v)]),
  );
const pepper = () => one<string>("SELECT s.decrypted_secret AS r FROM vault.decrypted_secrets s WHERE s.name = 'cockpit_sale_tie_pepper'");
const nodeDigest = (pep: string, kind: "phone" | "email", norm: string) =>
  createHmac("sha256", pep).update(`${kind}:${norm}`).digest("hex");

async function card(task: string, name: string, o: { group?: string; onboarding?: boolean; phone?: string; email?: string;
  salesCall?: string; churned?: boolean } = {}) {
  await owner(db);
  await db.query(
    `INSERT INTO public.cockpit_billing_accounts(clickup_task_id, client_name, stage_group, client_status, churn_date)
     VALUES ($1, $2, $3, 'Active', $4) ON CONFLICT (clickup_task_id) DO UPDATE SET client_name = excluded.client_name,
       stage_group = excluded.stage_group, churn_date = excluded.churn_date`,
    [task, name, o.group ?? "active", o.churned ? "2026-10-01" : null],
  );
  const answers = [
    ...(o.phone ? [{ ref: REF.onbPhone, title: "Phone", value: o.phone }] : []),
    ...(o.email ? [{ ref: REF.onbEmail, title: "Email", value: o.email }] : []),
  ];
  await db.query(
    `INSERT INTO public.cockpit_client_onboarding(clickup_task_id, client_name, in_onboarding, links, forms)
     VALUES ($1, $2, $3, $4::jsonb, $5::jsonb) ON CONFLICT (clickup_task_id) DO UPDATE SET in_onboarding = excluded.in_onboarding,
       links = excluded.links, forms = excluded.forms`,
    [task, name, o.onboarding ?? false, json(o.salesCall ? { sales_call: o.salesCall } : {}),
     json(answers.length ? { onboarding: { form_id: "KFRCXPFx", answers } } : {})],
  );
}

type Sale = { at?: string; business?: string; goLive?: string; handoff?: string; expectations?: string; link?: string;
  rawPhone?: string; closer?: string; phone8?: string; email?: string; voided?: boolean; noDeal?: boolean; extra?: Row[] };
async function sale(token: string, s: Sale = {}) {
  await owner(db);
  const at = s.at ?? iso(5 * 60_000);
  const f = (ref: string, type: string, title: string, value: unknown) => ({ ref, type, title, value });
  const fields = [
    f(REF.closer, "dropdown", "Who Closed The Deal?", s.closer ?? "Closer Invented"),
    f(REF.first, "short_text", "First name", "Firstnameinvented"),
    f(REF.business, "short_text", "Business name", s.business ?? `Business ${token}`),
    ...(s.rawPhone ? [f(REF.rawPhone, "short_text", "Raw Phone", s.rawPhone)] : []),
    f(REF.handoff, "long_text", "Handoff problems?", s.handoff ?? "No"),
    f(REF.goLive, "long_text", "How soon?", s.goLive ?? "In two weeks,\nafter the invented launch"),
    ...(s.expectations ? [f(REF.expect, "long_text", "Expectations", s.expectations)] : []),
    ...(s.link ? [f(REF.link, "website", "Fathom", s.link)] : []),
    ...(s.extra ?? []),
  ];
  const id = (await db.query<{ id: string }>(
    `INSERT INTO public.cockpit_form_responses(form_key, form_version, source, external_id, mode, state, answers, answer_meta,
       hidden, created_by, submitted_by, submitted_at)
     VALUES ('new_client', 1, 'typeform_sync', $1, 'live', 'submitted', $2::jsonb, '{"owner":"make","notice_on":"2026-10-01"}'::jsonb,
       '{"closer":"Closer Invented"}'::jsonb, 'forms-door', 'typeform', $3::timestamptz) RETURNING id`,
    [token, json({ fields }), at],
  )).rows[0].id;
  if (!s.noDeal)
    await db.query(
      `INSERT INTO public.cockpit_sales_deals(response_id, submitted_at, phone8, email, voided, business_name)
       VALUES ($1, $2::timestamptz, $3, $4, $5, 'Invented')`,
      [token, at, s.phone8 ?? null, s.email ?? null, s.voided ?? false],
    );
  return id;
}
const live = (token: string) =>
  one<Row>("SELECT to_jsonb(t) AS r FROM public.cockpit_sale_ties t WHERE t.response_id = $1 AND t.cleared_at IS NULL", [token]);
const stored = (token: string) =>
  one<Row>("SELECT to_jsonb(r) AS r FROM public.cockpit_form_responses r WHERE r.form_key = 'new_client' AND r.external_id = $1", [token]);
const open = (p: Row) => asService(() => one<Row>("SELECT public.cockpit_sale_tie_open($1::jsonb) AS r", [json(p)]));
const offer = (cards: Row[], run = 11) => asService(() => one<Row>("SELECT public.cockpit_sale_tie_offer($1, $2::jsonb) AS r", [run, json(cards)]));
const sweep = () => asService(() => one<Row>("SELECT public.cockpit_sale_tie_sweep(12) AS r"));
const backfill = (cards: Row[], dry: boolean) =>
  asService(() => one<Row>("SELECT public.cockpit_sale_tie_backfill($1::jsonb, $2) AS r", [json(cards), dry]));
async function decide(who: string, token: string, choice: string, task: string | null = null, note: string | null = null) {
  await actor(db, who);
  try {
    return await one<Row>("SELECT public.cockpit_sale_tie_decide($1, $2, $3, $4) AS r", [token, choice, task, note]);
  } finally {
    await owner(db);
  }
}
async function asSeat<T>(who: string, text: string, params: unknown[] = []): Promise<T> {
  await actor(db, who);
  try {
    return await one<T>(text, params);
  } finally {
    await owner(db);
  }
}
const effect = async (responseId: string) =>
  (await one<Row>("SELECT to_jsonb(e) AS r FROM public.cockpit_form_effects e WHERE e.response_id = $1::uuid AND e.effect_key = 'sale_facts'", [responseId])) ?? null;

// ---- the ground ---------------------------------------------------------------------------------------------------

const VAULT_AND_CRYPTO = `
  CREATE SCHEMA vault;
  CREATE TABLE vault.secrets (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text UNIQUE, description text NOT NULL DEFAULT '',
    secret text NOT NULL, key_id uuid, nonce bytea, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
  CREATE VIEW vault.decrypted_secrets AS
    SELECT s.id, s.name, s.description, s.secret, s.secret AS decrypted_secret, s.key_id, s.nonce, s.created_at, s.updated_at FROM vault.secrets s;
  CREATE FUNCTION vault.create_secret(new_secret text, new_name text DEFAULT NULL, new_description text DEFAULT '',
    new_key_id uuid DEFAULT NULL) RETURNS uuid LANGUAGE plpgsql AS $$
  DECLARE v uuid;
  BEGIN
    INSERT INTO vault.secrets(name, description, secret, key_id) VALUES (new_name, coalesce(new_description, ''), new_secret, new_key_id)
    RETURNING id INTO v;
    RETURN v;
  END $$;
  REVOKE ALL ON SCHEMA vault FROM PUBLIC;
  CREATE SCHEMA extensions;
  -- pgcrypto's hmac(text, text, 'sha256'), from the core sha256 (RFC 2104).
  CREATE FUNCTION extensions.hmac(data text, key text, type text) RETURNS bytea LANGUAGE plpgsql IMMUTABLE AS $$
  DECLARE k bytea := convert_to(key, 'UTF8'); m bytea := convert_to(data, 'UTF8'); ipad bytea; opad bytea; i int;
  BEGIN
    IF type <> 'sha256' THEN RAISE EXCEPTION 'This stand-in makes sha256 only'; END IF;
    IF length(k) > 64 THEN k := sha256(k); END IF;
    k := k || decode(repeat('00', 64 - length(k)), 'hex');
    ipad := k; opad := k;
    FOR i IN 0..63 LOOP
      ipad := set_byte(ipad, i, get_byte(k, i) # 54);
      opad := set_byte(opad, i, get_byte(k, i) # 92);
    END LOOP;
    RETURN sha256(opad || sha256(ipad || m));
  END $$;
  CREATE FUNCTION extensions.gen_random_bytes(n integer) RETURNS bytea LANGUAGE sql VOLATILE AS
    $$ SELECT substring(decode(replace(gen_random_uuid()::text,'-','') || replace(gen_random_uuid()::text,'-',''), 'hex') FROM 1 FOR n) $$;`;

const TABLES = `
  CREATE TABLE public.cockpit_settings (key text PRIMARY KEY, value jsonb NOT NULL, updated_by text,
    updated_at timestamptz NOT NULL DEFAULT now());
  CREATE TABLE public.cockpit_forms (key text PRIMARY KEY, title text NOT NULL, audience text NOT NULL DEFAULT 'team',
    provider text NOT NULL, typeform_id text, version integer NOT NULL DEFAULT 1, schema jsonb NOT NULL DEFAULT '{}'::jsonb,
    seats text[] NOT NULL DEFAULT '{}', client_scoped boolean NOT NULL DEFAULT false, effects jsonb NOT NULL DEFAULT '[]'::jsonb,
    updated_by text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(), provider_since timestamptz);
  CREATE TABLE public.cockpit_form_responses (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), form_key text NOT NULL,
    form_version integer NOT NULL, source text NOT NULL, external_id text, task_id text, client_name text, mode text NOT NULL,
    state text NOT NULL DEFAULT 'draft', answers jsonb NOT NULL DEFAULT '{}'::jsonb, answer_meta jsonb NOT NULL DEFAULT '{}'::jsonb,
    hidden jsonb NOT NULL DEFAULT '{}'::jsonb, revision integer NOT NULL DEFAULT 1, created_by text NOT NULL, created_by_id uuid,
    submitted_by text, submitted_at timestamptz, confirmed_by text, confirmed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), invite_id uuid, signer text, lang text,
    UNIQUE (form_key, external_id),
    CHECK (task_id IS NULL OR task_id ~ '^[A-Za-z0-9_-]{1,40}$'));
  CREATE TABLE public.cockpit_form_effects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    response_id uuid NOT NULL REFERENCES public.cockpit_form_responses(id), form_key text NOT NULL,
    effect_key text NOT NULL CHECK (effect_key ~ '^[a-z][a-z0-9_]{1,40}$'), dedupe_key text NOT NULL UNIQUE,
    owner text NOT NULL CHECK (owner IN ('make','shadow','cockpit')),
    delivery text NOT NULL CHECK (delivery IN ('clickup_queue','slack_notice','client_message','creative_outbox','sql','relay')),
    delivery_ref text, plan jsonb NOT NULL DEFAULT '{}'::jsonb, receipt jsonb,
    state text NOT NULL CHECK (state IN ('planned','dry_run','queued','delivered','failed','unknown','skipped')),
    reason text CHECK (reason IS NULL OR char_length(reason) <= 240),
    created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), settled_at timestamptz,
    UNIQUE (response_id, effect_key),
    CHECK (dedupe_key = (response_id::text || ':' || effect_key)),
    CHECK (owner = 'cockpit' OR state IN ('dry_run','skipped')),
    CHECK (jsonb_typeof(plan) = 'object' AND octet_length(plan::text) <= CASE WHEN form_key IN ('kickoff','onboarding') THEN 2097152 ELSE 131072 END));
  CREATE TABLE public.cockpit_clickup_writeback_queue (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), dedupe_key text NOT NULL UNIQUE,
    kind text NOT NULL, source_table text, source_id text, campaign_name text, payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
    state text NOT NULL DEFAULT 'queued', attempts integer NOT NULL DEFAULT 0, next_attempt_at timestamptz NOT NULL DEFAULT now(),
    claim_token uuid, claimed_at timestamptz, task_id text, steps jsonb, progress jsonb NOT NULL DEFAULT '{}'::jsonb, planned jsonb,
    error text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), delivered_at timestamptz);
  CREATE TABLE public.cockpit_billing_accounts (clickup_task_id text PRIMARY KEY, client_name text, stage_group text,
    client_status text, paused_on date, churn_date date);
  CREATE TABLE public.cockpit_client_billing_days (clickup_task_id text, day date, stage text);
  CREATE TABLE public.cockpit_client_onboarding (clickup_task_id text PRIMARY KEY, client_name text, in_onboarding boolean,
    links jsonb NOT NULL DEFAULT '{}'::jsonb, forms jsonb NOT NULL DEFAULT '{}'::jsonb);
  CREATE TABLE public.cockpit_sales_deals (response_id text PRIMARY KEY, submitted_at timestamptz, phone8 text, email text,
    voided boolean, business_name text);
  CREATE TABLE public.cockpit_sync_state (key text PRIMARY KEY, last_run_at timestamptz, last_ok_at timestamptz, ok boolean NOT NULL,
    note text, rows_seen integer, updated_at timestamptz NOT NULL DEFAULT now(), detail jsonb);
  CREATE TABLE public.cockpit_form_invites (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), task_id text, form_key text, state text,
    origin text, issued_at timestamptz NOT NULL DEFAULT now());
  CREATE TABLE public.cockpit_churn_departures (id bigint);
  CREATE TABLE public.cockpit_client_messages (id uuid PRIMARY KEY, kind text);
  -- Stand-ins' own tables.
  CREATE TABLE public.test_billing_assignments (deal_response_id text, clickup_task_id text, matched_by text);
  CREATE TABLE public.test_csm_clients (actor uuid, task_id text);
  CREATE TABLE public.test_invites_issued (task_id text, context jsonb);`;

const STAND_INS = `
  CREATE FUNCTION public.cockpit_billing_deal_assignments()
  RETURNS TABLE(deal_response_id text, signed_at timestamptz, clickup_task_id text, matched_by text, conflict boolean,
                conflict_with text[], linked_by text, link_id bigint)
  LANGUAGE sql STABLE SET search_path = '' AS $$
    SELECT a.deal_response_id, NULL::timestamptz, a.clickup_task_id, a.matched_by, false, '{}'::text[], NULL::text, NULL::bigint
      FROM public.test_billing_assignments a $$;
  CREATE FUNCTION public.cockpit_csm_client_gate(p_task_id text) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path = '' AS $$
  BEGIN
    IF NOT public.cockpit_is_ceo() AND NOT EXISTS (SELECT 1 FROM public.test_csm_clients t WHERE t.actor = auth.uid() AND t.task_id = p_task_id) THEN
      RAISE EXCEPTION 'That client is not on your access list' USING ERRCODE = '42501';
    END IF;
    RETURN jsonb_build_object('taskId', p_task_id);
  END $$;
  GRANT EXECUTE ON FUNCTION public.cockpit_csm_client_gate(text) TO authenticated;
  -- What the portal's onboarding open reads beside the business name, with the live signatures.
  CREATE FUNCTION public.cockpit_form_portal_workspace(p_location_id text, p_clickup_id text) RETURNS void LANGUAGE sql AS $$ SELECT $$;
  CREATE FUNCTION public.cockpit_form_client_live(p text) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
  CREATE FUNCTION public.cockpit_form_stage4_on(p text) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
  CREATE FUNCTION public.cockpit_form_stage4_answered_at(p_task text, p_skip uuid) RETURNS timestamptz LANGUAGE sql AS $$ SELECT NULL::timestamptz $$;
  CREATE FUNCTION public.cockpit_form_invites_expire() RETURNS void LANGUAGE sql AS $$ SELECT $$;
  CREATE FUNCTION public.cockpit_form_invite_issue_system(p_task text, p_form text, p_channels text[], p_context jsonb, p_origin text)
  RETURNS uuid LANGUAGE plpgsql AS $$
  BEGIN
    INSERT INTO public.test_invites_issued VALUES (p_task, p_context);
    RETURN gen_random_uuid();
  END $$;
  CREATE FUNCTION public.cockpit_form_invite_gate(p uuid) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;`;

beforeAll(async () => {
  db = await cockpitTestDb({ supabaseDefaultPrivileges: true });
  const core = migration("20261027f_forms_core.sql");
  const b = migration("20261102b_client_lifecycle.sql");
  const g = migration("20261102g_money_rails_w5.sql");
  const j = migration("20261102j_stage4_native.sql");
  const o = migration("20261102o_stage4_match_make.sql");
  const s = migration("20261029s_forms_registry.sql");
  await db.exec(VAULT_AND_CRYPTO);
  await db.exec(TABLES);
  // Without what it stands on, the file stops.
  const stop = await refusal(() => db.exec(migration(FILE)));
  expect(stop.message).toContain("Apply 20261102o (Stage 4, match Make) and the billing balances (20261023x) before 20261103g.");
  await db.exec("ROLLBACK");

  // The identity, the client and CSM gates, the forms audit and guards, as live.
  const team = migration("20261017b_team_only_seats.sql");
  for (const [sql, name] of [
    [team, "cockpit_is_team_only"], [team, "cockpit_client_allowed"],
    [migration("20260926m_cockpit_csm_state.sql"), "cockpit_csm_actor"],
    [core, "cockpit_form_seat"], [core, "cockpit_form_actor"], [core, "cockpit_forms_audit"], [core, "cockpit_forms_refuse_delete"],
    [j, "cockpit_forms_effects_valid"],
    [migration("20261101p_money_acts.sql"), "cockpit_settings_forms_audit"],
    [migration("20261029w_forms_dispatch.sql"), "cockpit_form_effects_guard"],
    [o, "cockpit_clickup_writeback_audit"], [o, "cockpit_form_typeform_text"],
    [migration("20261023x_billing_balances.sql"), "cockpit_billing_card_listed"],
    [migration("20261009a_cockpit_team_hours.sql"), "cockpit_hours_require_service"],
    [migration("20261009a_cockpit_team_hours.sql"), "cockpit_hours_refuse_delete"],
    [s, "cockpit_form_effect_owner"], [s, "cockpit_form_native_since"], [j, "cockpit_form_effect_gate"],
    // The live settle path (a queue row's state moves its effect) and the forms writer's claim, as live.
    [migration("20261029w_forms_dispatch.sql"), "cockpit_form_effects_health"],
    [migration("20261029w_forms_dispatch.sql"), "cockpit_form_effects_settle"],
    [migration("20261029w_forms_dispatch.sql"), "cockpit_form_effects_from_queue"],
    [migration("20261029t_forms_clickup_writeback.sql"), "cockpit_clickup_forms_mode"],
    [migration("20261029t_forms_clickup_writeback.sql"), "cockpit_clickup_writeback_claim_forms"],
    // The three this file replaces, as live.
    [b, "cockpit_form_responses_guard"], [j, "portal_form_onboarding_open"], [g, "cockpit_form_doors"],
  ] as const)
    await db.exec(fnDef(sql, name));
  await db.exec(STAND_INS);
  await db.exec(`
    ALTER TABLE public.cockpit_forms ADD CONSTRAINT cockpit_forms_effects_check CHECK (public.cockpit_forms_effects_valid(effects));
    CREATE TRIGGER cockpit_forms_audit AFTER INSERT OR UPDATE ON public.cockpit_forms FOR EACH ROW EXECUTE FUNCTION public.cockpit_forms_audit();
    CREATE TRIGGER cockpit_form_responses_audit AFTER INSERT OR UPDATE ON public.cockpit_form_responses
      FOR EACH ROW EXECUTE FUNCTION public.cockpit_forms_audit();
    CREATE TRIGGER cockpit_form_effects_audit AFTER INSERT OR UPDATE OF state ON public.cockpit_form_effects
      FOR EACH ROW EXECUTE FUNCTION public.cockpit_forms_audit();
    CREATE TRIGGER cockpit_form_responses_guard BEFORE UPDATE ON public.cockpit_form_responses
      FOR EACH ROW EXECUTE FUNCTION public.cockpit_form_responses_guard();
    CREATE TRIGGER cockpit_form_effects_guard BEFORE INSERT OR UPDATE ON public.cockpit_form_effects
      FOR EACH ROW EXECUTE FUNCTION public.cockpit_form_effects_guard();
    CREATE TRIGGER cockpit_forms_no_delete BEFORE DELETE ON public.cockpit_form_responses
      FOR EACH ROW EXECUTE FUNCTION public.cockpit_forms_refuse_delete();
    CREATE TRIGGER cockpit_clickup_writeback_queue_audit_insert AFTER INSERT ON public.cockpit_clickup_writeback_queue
      FOR EACH ROW EXECUTE FUNCTION public.cockpit_clickup_writeback_audit();
    CREATE TRIGGER cockpit_clickup_writeback_queue_audit_state AFTER UPDATE OF state ON public.cockpit_clickup_writeback_queue
      FOR EACH ROW EXECUTE FUNCTION public.cockpit_clickup_writeback_audit();
    CREATE TRIGGER cockpit_form_effects_from_queue AFTER UPDATE OF state ON public.cockpit_clickup_writeback_queue
      FOR EACH ROW WHEN (OLD.state IS DISTINCT FROM NEW.state AND NEW.kind = 'form')
      EXECUTE FUNCTION public.cockpit_form_effects_from_queue();
    CREATE TRIGGER cockpit_settings_forms_audit AFTER INSERT OR UPDATE OR DELETE ON public.cockpit_settings
      FOR EACH ROW EXECUTE FUNCTION public.cockpit_settings_forms_audit();
    REVOKE ALL ON FUNCTION public.cockpit_form_responses_guard(), public.portal_form_onboarding_open(text,text,text,text),
      public.cockpit_form_doors() FROM PUBLIC, anon, authenticated, service_role;
    GRANT EXECUTE ON FUNCTION public.portal_form_onboarding_open(text,text,text,text) TO service_role;
    GRANT EXECUTE ON FUNCTION public.cockpit_form_doors() TO authenticated;
    INSERT INTO public.cockpit_forms(key, title, provider, typeform_id, effects, updated_by)
    VALUES ('new_client', 'New Client Form', 'typeform', 'BTzMwXiw', '[
      {"key":"onboarding_main","label":"Sub-account, Mahara OS, welcome, card, CSM post, CS pipeline (Make 8979157)","owner":"make","delivery":"sql"},
      {"key":"highlevel_workflow","label":"HighLevel workflow (its own webhook)","owner":"make","delivery":"sql"},
      {"key":"cortana","label":"Cortana (its own webhook)","owner":"make","delivery":"sql"},
      {"key":"b2b_closed_deals","label":"B2B closed deals (typeform-sync)","owner":"make","delivery":"sql"}]'::jsonb, 'seed');
    INSERT INTO public.cockpit_settings(key, value, updated_by) VALUES ('forms.doors', '{"wins":true}'::jsonb, 'seed'),
      ('forms.stage4', '{"kickoff":false,"onboarding":false}'::jsonb, 'seed');
    INSERT INTO public.cockpit_sync_state(key, ok, note, detail) VALUES ('forms-door:new_client', true, 'seed', '{"outcome":"probe"}'::jsonb);`);
  // The ground is live: each replaced body has the md5 the drift guard names.
  for (const [fn, md5] of Object.entries(LIVE)) expect(await md5Of(fn)).toBe(md5);
  await db.exec(migration(FILE));
  // Planning waits for build B2's gate branch (20261103c); the ground carries it, and one test takes it away.
  await owner(db);
  expect(await one<boolean>("SELECT public.cockpit_sale_tie_gate_ready() AS r")).toBe(false);
  await db.exec(b2Gate());
  expect(await one<boolean>("SELECT public.cockpit_sale_tie_gate_ready() AS r")).toBe(true);
  await member(db, CEO, "aziz@maharamedia.com", ["ceo"]);
  await member(db, CSM, "csm@sale-tie.invalid", ["csm"]);
  await member(db, CREATIVE, "creative@sale-tie.invalid", ["creative"]);
  await member(db, ADMIN, "admin@sale-tie.invalid", ["admin"]);
  await owner(db);
  await db.query("UPDATE public.cockpit_members SET clients = ARRAY['Cedar Invented','Olive Invented'] WHERE email = 'csm@sale-tie.invalid'");
});

afterAll(async () => {
  await db?.close();
});

// ---- applying ------------------------------------------------------------------------------------------------------

describe("applying", () => {
  test("each replaced body is the file's after value, and a second apply changes nothing and keeps a switch on", async () => {
    const rows = guardRows(migration(FILE));
    expect(rows.map(r => r[0]).sort()).toEqual(Object.keys(LIVE).sort());
    for (const [fn, live, after] of rows) {
      expect(LIVE[fn as keyof typeof LIVE]).toBe(live);
      expect(await md5Of(fn)).toBe(after);
    }
    // The registry gained its two entries with one audit row each, and the setting was seeded off with its own.
    expect(await one<number>("SELECT count(*)::int AS r FROM public.cockpit_audit_log WHERE action = 'forms.sale_tie_registry'")).toBe(2);
    expect(await one<number>("SELECT count(*)::int AS r FROM public.cockpit_audit_log WHERE action = 'forms.switch_seeded' AND entity_id = 'forms.sale_tie'")).toBe(1);
    await flags({ on: true });
    const pep = await pepper();
    const audits = await one<number>("SELECT count(*)::int AS r FROM public.cockpit_audit_log WHERE action IN ('forms.sale_tie_registry','forms.sale_tie_pepper_created')");
    await db.exec(migration(FILE));
    expect(await one<Row>("SELECT value AS r FROM public.cockpit_settings WHERE key = 'forms.sale_tie'")).toEqual({ on: true, fill: false, salesLink: false });
    expect(await pepper()).toBe(pep);
    expect(await one<number>("SELECT count(*)::int AS r FROM public.cockpit_audit_log WHERE action IN ('forms.sale_tie_registry','forms.sale_tie_pepper_created')")).toBe(audits);
    const keys = await one<string[]>("SELECT array_agg(e->>'key' ORDER BY n) AS r FROM public.cockpit_forms f, jsonb_array_elements(f.effects) WITH ORDINALITY x(e, n) WHERE f.key = 'new_client'");
    expect(keys).toEqual(["onboarding_main", "highlevel_workflow", "cortana", "b2b_closed_deals", "sale_tie", "sale_facts"]);
    await flags({ on: false });
  });

  test("each drift guard refuses a changed body", async () => {
    for (const fn of Object.keys(LIVE)) {
      const def = await one<string>("SELECT pg_get_functiondef(to_regprocedure($1)) AS r", [`public.${fn}`]);
      await db.exec("BEGIN");
      await db.exec(def.replace(/\nBEGIN\n/, "\nBEGIN\n  -- an edit made after the design read it\n"));
      const err = await refusal(() => db.exec(migration(FILE)));
      expect(err.message).toContain(`${fn} changed since the sale tie design read it; stop and re-read it.`);
      await db.exec("ROLLBACK");
    }
  });

  test("the pepper is made once in the vault, with one audit row and no secret in it", async () => {
    expect(await one<number>("SELECT count(*)::int AS r FROM vault.secrets WHERE name = 'cockpit_sale_tie_pepper'")).toBe(1);
    expect((await pepper()).length).toBe(64);
    const a = await one<Row>("SELECT jsonb_build_object('n', count(*), 'm', min(metadata::text)) AS r FROM public.cockpit_audit_log WHERE action = 'forms.sale_tie_pepper_created'");
    expect(a.n).toBe(1);
    expect(a.m).toBe('{"bytes": 32}');
  });

  test("row security and grants: SELECT for service_role only; the door and the sync's functions for service_role; three for the cockpit; helpers for nobody", async () => {
    for (const t of ["cockpit_sale_ties", "cockpit_sale_tie_cards"]) {
      expect(await one<boolean>("SELECT relrowsecurity AS r FROM pg_class WHERE oid = to_regclass($1)", [`public.${t}`])).toBe(true);
      for (const role of ["anon", "authenticated"])
        for (const p of ["SELECT", "INSERT", "UPDATE", "DELETE"])
          expect(await one<boolean>("SELECT has_table_privilege($1, $2, $3) AS r", [role, `public.${t}`, p])).toBe(false);
      expect(await one<boolean>("SELECT has_table_privilege('service_role', $1, 'SELECT') AS r", [`public.${t}`])).toBe(true);
      for (const p of ["INSERT", "UPDATE", "DELETE"])
        expect(await one<boolean>("SELECT has_table_privilege('service_role', $1, $2) AS r", [`public.${t}`, p])).toBe(false);
    }
    const can = (role: string, fn: string) => one<boolean>("SELECT has_function_privilege($1, to_regprocedure($2), 'EXECUTE') AS r", [role, `public.${fn}`]);
    const service = ["cockpit_sale_tie_open(jsonb)", "cockpit_sale_tie_door_failed()", "cockpit_sale_tie_waiting()",
      "cockpit_sale_tie_offer(bigint,jsonb)", "cockpit_sale_tie_sweep(bigint)", "cockpit_sale_tie_backfill(jsonb,boolean)"];
    const browser = ["cockpit_sale_tie_list()", "cockpit_sale_tie_decide(text,text,text,text)", "cockpit_csm_sale_read(text[])", "cockpit_form_doors()"];
    const helpers = ["cockpit_sale_tie_norm(text,text)", "cockpit_sale_tie_key(text,text)", "cockpit_sale_tie_pepper()",
      "cockpit_sale_tie_digest(text,text,text)", "cockpit_sale_tie_match(text,text,timestamptz,jsonb)",
      "cockpit_sale_tie_plan_facts(bigint)", "cockpit_sale_tie_write(text,jsonb,text,text,text,text)",
      "cockpit_sale_tie_card_keys(jsonb,text)", "cockpit_sale_tie_stored_keys(text,text)", "cockpit_form_responses_guard()",
      "cockpit_sale_tie_gate_ready()", "cockpit_sale_tie_take_back(uuid,text)", "cockpit_sale_tie_switch_off()"];
    for (const fn of service) {
      expect(await can("service_role", fn)).toBe(true);
      expect(await can("authenticated", fn)).toBe(false);
      expect(await can("anon", fn)).toBe(false);
    }
    for (const fn of browser) {
      expect(await can("authenticated", fn)).toBe(true);
      expect(await can("anon", fn)).toBe(false);
      expect(await can("service_role", fn)).toBe(false);
    }
    for (const fn of helpers) for (const role of ["anon", "authenticated", "service_role"]) expect(await can(role, fn)).toBe(false);
    expect(await can("service_role", "portal_form_onboarding_open(text,text,text,text)")).toBe(true);
    expect(await can("authenticated", "portal_form_onboarding_open(text,text,text,text)")).toBe(false);
    // The service functions check the role inside too: a signed-in seat holding them by mistake is still refused.
    await owner(db);
    const err = await refusal(() => db.query("SELECT public.cockpit_sale_tie_waiting()"));
    expect(err.code).toBe("42501");
  });
});

// ---- normalising and keys ------------------------------------------------------------------------------------------

describe("normalising and keys", () => {
  test("+965 0000 0101, 0096500000101 and the raw 96500000101 give one key; the HMAC is node's own", async () => {
    await owner(db);
    const k = async (kind: string, v: string | null) => one<string | null>("SELECT public.cockpit_sale_tie_key($1, $2) AS r", [kind, v]);
    const a = await k("phone", "+965 0000 0101");
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(await k("phone", "0096500000101")).toBe(a);
    expect(await k("phone", "(+965) 0000-0101")).toBe(a);
    expect(await k("raw_phone", "96500000101")).toBe(a);
    expect(await k("raw_phone", "0096500000101")).toBe(a);
    expect(a).toBe(nodeDigest(await pepper(), "phone", "+96500000101"));
    expect(await k("email", "  Owner@Cedar-Invented.Example ")).toBe(nodeDigest(await pepper(), "email", "owner@cedar-invented.example"));
    expect(await k("email", "owner+tag@cedar-invented.example")).not.toBe(await k("email", "owner@cedar-invented.example"));
  });

  test("a national number, a typed phone without its country code, junk and no value give no key", async () => {
    await owner(db);
    for (const [kind, v] of [["phone", "0000 0101"], ["phone", "96500000101"], ["raw_phone", "00000101"], ["raw_phone", "50000101"],
      ["phone", "+965 ABCD 0101"], ["email", "not an email"], ["email", "owner@nodot"], ["phone", ""], ["email", null], ["name", "Cedar"]] as const)
      expect(await one<string | null>("SELECT public.cockpit_sale_tie_key($1, $2) AS r", [kind, v])).toBeNull();
  });
});

// ---- the door, the sync and the states -----------------------------------------------------------------------------

describe("ties and states", () => {
  test("off: the door stores the two digests in a waiting row only, a repeat changes nothing, and nothing ties", async () => {
    await flags({ on: false });
    await card("taskOffOne", "Off Invented", { phone: "+96500000901" });
    await sale("ncfoff00001", { at: iso(10 * 60_000) });
    const out = await open({ externalId: "ncfoff00001", submittedAt: iso(10 * 60_000), tieKeys: { phone: "+965 0000 0901", email: "off@invented.example" } });
    expect(out).toMatchObject({ ok: true, state: "waiting", repeat: false });
    const t = await live("ncfoff00001");
    const pep = await pepper();
    expect(t).toMatchObject({ state: "waiting", clickup_task_id: null, set_by: "system:forms-door",
      phone_key: nodeDigest(pep, "phone", "+96500000901"), email_key: nodeDigest(pep, "email", "off@invented.example") });
    expect(await open({ externalId: "ncfoff00001", tieKeys: { phone: "+96500000999" } })).toMatchObject({ repeat: true, state: "waiting" });
    expect(await one<number>("SELECT count(*)::int AS r FROM public.cockpit_sale_ties WHERE response_id = 'ncfoff00001'")).toBe(1);
    expect(await offer([{ taskId: "taskOffOne", createdAt: iso(60_000), phone: "+96500000901" }])).toMatchObject({ on: false, stored: 0, tied: 0 });
    expect(await one<number>("SELECT count(*)::int AS r FROM public.cockpit_sale_tie_cards")).toBe(0);
    expect(await sweep()).toEqual({ on: false });
    expect((await stored("ncfoff00001")).task_id).toBeNull();
    expect((await one<Row>("SELECT detail AS r FROM public.cockpit_sync_state WHERE key = 'forms-door:new_client'")).tie).toBe("ok");
    expect(await asService(() => one<Row>("SELECT public.cockpit_sale_tie_waiting() AS r"))).toMatchObject({ on: false, waiting: 1 });
  });

  test("the door's refusals and its failure mark", async () => {
    const bad = await refusal(() => open({ externalId: "x", tieKeys: {} }));
    expect(bad.message).toBe("That is not a Typeform response token.");
    await owner(db);
    const keys = await refusal(() => open({ externalId: "ncfbadkeys1", tieKeys: { phone: 96500000101 } }));
    expect(keys.message).toBe("Send tieKeys as {phone, email}, each text or null.");
    await owner(db);
    await asService(() => one("SELECT public.cockpit_sale_tie_door_failed() AS r"));
    expect((await one<Row>("SELECT detail AS r FROM public.cockpit_sync_state WHERE key = 'forms-door:new_client'"))).toMatchObject({ tie: "failed", outcome: "probe" });
  });

  test("one card by phone ties `phone` (K2, the onboarding answer), and the sale sits on its card", async () => {
    await flags({ on: true });
    await card("taskCedar01", "Cedar Invented", { phone: "+96500000101", onboarding: true });
    await sale("ncfcedar001", { at: iso(5 * 24 * HOUR), rawPhone: "96500000101", phone8: "00000101" });
    const s = await sweep();
    expect(s.on).toBe(true);
    const t = await live("ncfcedar001");
    expect(t).toMatchObject({ state: "tied", clickup_task_id: "taskCedar01", matched_by: "phone", key_source: "onboarding_answer",
      set_by: "system:onboarding-sync" });
    const r = await stored("ncfcedar001");
    expect(r.task_id).toBe("taskCedar01");
    expect(r.client_name).toBe("Cedar Invented");
    expect(r.answer_meta).toMatchObject({ owner: "make", match: "phone", matched: { by: "the cockpit", via: "sale_tie", taskId: "taskCedar01" } });
    expect(Object.keys(r.answer_meta.matched).sort()).toEqual(["at", "by", "taskId", "via"]);
  });

  test("the raw phone counts only when its last 8 digits equal B2B's phone8; the email adds `phone_email`", async () => {
    await card("taskPine001", "Pine Invented", { phone: "+96500000202", email: "owner@pine-invented.example" });
    await sale("ncfpine0001", { at: iso(5 * 24 * HOUR), rawPhone: "96500000202", phone8: "00000202", email: "Owner@Pine-Invented.example" });
    await sale("ncfpine0002", { at: iso(4 * 24 * HOUR), rawPhone: "96500000202", phone8: "99999999" });
    await sweep();
    expect(await live("ncfpine0001")).toMatchObject({ state: "tied", matched_by: "phone_email", clickup_task_id: "taskPine001" });
    // No phone key (phone8 disagrees) and no email: no card after 2 days.
    expect(await live("ncfpine0002")).toMatchObject({ state: "unmatched", clickup_task_id: null, phone_key: null });
  });

  test("two cards share the phone: the one ClickUp made in the window ties `phone` with the older card in also_on", async () => {
    await card("taskElmOld1", "Elm Invented", { phone: "+96500000303" });
    await card("taskElmNew1", "Elm Invented Two");
    const at = iso(30 * 60_000);
    await sale("ncfelm00001", { at });
    expect(await open({ externalId: "ncfelm00001", tieKeys: { phone: "+96500000303" } })).toMatchObject({ state: "waiting" });
    // Make's new card carries the same phone on its own Phone Number field, made a minute after the sale.
    const out = await offer([
      { taskId: "taskElmNew1", createdAt: new Date(Date.parse(at) + 60_000).toISOString(), phone: "+965 0000 0303", email: null },
      { taskId: "taskElmOld1", createdAt: "2026-04-01T08:00:00Z", phone: null, email: null },
    ]);
    expect(out).toMatchObject({ on: true, offered: 2, tied: 1 });
    expect(await live("ncfelm00001")).toMatchObject({ state: "tied", clickup_task_id: "taskElmNew1", matched_by: "phone",
      key_source: "card_fields", also_on: ["taskElmOld1"] });
  });

  test("while the sale is under 2 days old an older card never ties it: the row waits for Make's card", async () => {
    await card("taskAshOld1", "Ash Invented", { phone: "+96500000404" });
    await sale("ncfash00001", { at: iso(20 * 60_000) });
    await open({ externalId: "ncfash00001", tieKeys: { phone: "+96500000404" } });
    await offer([{ taskId: "taskAshOld1", createdAt: "2026-05-01T08:00:00Z", phone: null }]);
    await sweep();
    expect(await live("ncfash00001")).toMatchObject({ state: "waiting", clickup_task_id: null });
  });

  test("two cards outside the window give `ambiguous`, with both for a person", async () => {
    await card("taskOakOne1", "Oak Invented", { phone: "+96500000505" });
    await card("taskOakTwo1", "Oak Invented Two", { phone: "+96500000505" });
    await sale("ncfoak00001", { at: iso(6 * 24 * HOUR), rawPhone: "96500000505", phone8: "00000505" });
    await sweep();
    expect(await live("ncfoak00001")).toMatchObject({ state: "ambiguous", candidates: ["taskOakOne1", "taskOakTwo1"], clickup_task_id: null });
  });

  test("a phone on card A and an email on card B give `conflict`, and nothing is tied", async () => {
    await card("taskFigA001", "Fig Invented", { phone: "+96500000606" });
    await card("taskFigB001", "Fig Invented Two", { email: "owner@fig-invented.example" });
    await sale("ncffig00001", { at: iso(6 * 24 * HOUR), rawPhone: "96500000606", phone8: "00000606", email: "owner@fig-invented.example" });
    await sweep();
    expect(await live("ncffig00001")).toMatchObject({ state: "conflict", candidates: ["taskFigA001", "taskFigB001"] });
    expect((await stored("ncffig00001")).task_id).toBeNull();
  });

  test("no match waits, turns unmatched after 2 days, then ties later by the client's onboarding answer (K2)", async () => {
    await sale("ncfbay00001", { at: iso(3 * HOUR), email: "owner@bay-invented.example" });
    await sweep();
    expect(await live("ncfbay00001")).toMatchObject({ state: "waiting" });
    await sale("ncfbay00002", { at: iso(3 * 24 * HOUR), email: "owner@bay2-invented.example" });
    await sweep();
    const first = await live("ncfbay00002");
    expect(first.state).toBe("unmatched");
    await card("taskBay0002", "Bay Invented", { email: "OWNER@bay2-invented.example" });
    await sweep();
    const t = await live("ncfbay00002");
    expect(t).toMatchObject({ state: "tied", matched_by: "email", key_source: "onboarding_answer", clickup_task_id: "taskBay0002" });
    expect(await one<Row>("SELECT jsonb_build_object('by', cleared_by, 'reason', cleared_reason) AS r FROM public.cockpit_sale_ties WHERE id = $1", [first.id]))
      .toEqual({ by: "system:onboarding-sync", reason: "Checked again: tied." });
  });

  test("voided in B2B gives `void`; the playing account and an internal test are never candidates", async () => {
    await card("taskVoid001", "Void Invented", { phone: "+96500000707" });
    await sale("ncfvoid0001", { at: iso(6 * 24 * HOUR), rawPhone: "96500000707", phone8: "00000707", voided: true });
    await card("taskPlay001", "Mahara Playing Account", { phone: "+96500000808" });
    await card("taskTest001", "[Internal Test] Invented", { phone: "+96500000808" });
    await sale("ncfplay0001", { at: iso(6 * 24 * HOUR), rawPhone: "96500000808", phone8: "00000808" });
    await sweep();
    expect(await live("ncfvoid0001")).toMatchObject({ state: "void" });
    expect(await live("ncfplay0001")).toMatchObject({ state: "unmatched", candidates: [] });
  });

  test("the waiting count and the time the sync offers cards from", async () => {
    const w = await asService(() => one<Row>("SELECT public.cockpit_sale_tie_waiting() AS r"));
    expect(w.on).toBe(true);
    expect(w.waiting).toBeGreaterThanOrEqual(2);
    expect(Date.parse(w.since)).toBeLessThan(Date.now() - 2 * HOUR);
  });

  test("the sale-ties health row says the run's counts, never a value", async () => {
    const h = await one<Row>("SELECT to_jsonb(s) AS r FROM public.cockpit_sync_state s WHERE key = 'sale-ties'");
    expect(h.ok).toBe(true);
    expect(h.note).toMatch(/^Sales checked against the cards: \d+ tied this run, \d+ waiting for their card, \d+ waiting for a person\.$/);
    expect(Object.keys(h.detail).sort()).toEqual(["forPerson", "opened", "planned", "run", "tied", "unmatched", "waiting"]);
  });
});

// ---- the backfill job ----------------------------------------------------------------------------------------------

describe("the backfill job", () => {
  test("a dry run writes nothing and answers counts only; a real run needs on, then stores digests and ties", async () => {
    await card("taskWil0001", "Willow Invented");
    await sale("ncfwil00001", { at: iso(9 * 24 * HOUR), email: "owner@willow-invented.example" });
    await db.query("INSERT INTO public.test_billing_assignments VALUES ('ncfwil00001', 'taskWil0001', 'ledger'), ('ncfcedar001', 'taskCedar01', 'ledger'), ('ncffig00001', 'taskFigA001', 'name')");
    const before = await one<Row>(`SELECT jsonb_build_object('ties', (SELECT count(*) FROM public.cockpit_sale_ties), 'cards', (SELECT count(*) FROM public.cockpit_sale_tie_cards),
      'audit', (SELECT count(*) FROM public.cockpit_audit_log), 'responses', (SELECT count(*) FROM public.cockpit_form_responses WHERE task_id IS NOT NULL)) AS r`);
    const cards = [{ taskId: "taskWil0001", createdAt: new Date(Date.now() - 9 * 24 * HOUR + 60_000).toISOString(), phone: null, email: "owner@willow-invented.example" },
      { taskId: "taskNoKey01", createdAt: "2026-06-01T00:00:00Z", phone: null, email: null }];
    const dry = await backfill(cards, true);
    expect(dry).toMatchObject({ dryRun: true, written: 0, planned: 0, cards: 2, cardsWithPhone: 0, cardsWithEmail: 1, billingRead: true });
    expect(dry.sales).toBe(await one<number>("SELECT count(*)::int AS r FROM public.cockpit_form_responses WHERE form_key = 'new_client'"));
    expect(dry.tied).toBeGreaterThanOrEqual(4);
    expect(dry.billingAgree).toBeGreaterThanOrEqual(2);
    for (const v of Object.values(dry)) expect(["number", "boolean"]).toContain(typeof v);
    const after = await one<Row>(`SELECT jsonb_build_object('ties', (SELECT count(*) FROM public.cockpit_sale_ties), 'cards', (SELECT count(*) FROM public.cockpit_sale_tie_cards),
      'audit', (SELECT count(*) FROM public.cockpit_audit_log), 'responses', (SELECT count(*) FROM public.cockpit_form_responses WHERE task_id IS NOT NULL)) AS r`);
    expect(after).toEqual(before);
    await flags({ on: false });
    const off = await refusal(() => backfill(cards, false));
    expect(off.message).toBe("Sale ties are off. Read the dry run first, then turn forms.sale_tie.on on and run the job again.");
    await flags({ on: true });
    const real = await backfill(cards, false);
    expect(real.dryRun).toBe(false);
    expect(real.written).toBeGreaterThanOrEqual(1);
    expect(await live("ncfwil00001")).toMatchObject({ state: "tied", matched_by: "email", key_source: "card_fields", billing_task_id: "taskWil0001",
      billing_matched_by: "ledger", set_by: "system:backfill" });
    expect(await one<number>("SELECT count(*)::int AS r FROM public.cockpit_sale_tie_cards")).toBeGreaterThanOrEqual(2);
    const seen = await one<Row>("SELECT metadata AS r FROM public.cockpit_audit_log WHERE action = 'forms.sale_tie_cards_seen' ORDER BY created_at DESC LIMIT 1");
    expect(Object.keys(seen).sort()).toEqual(["cards", "changed", "run"]);
    // A second real run changes nothing it already decided.
    expect((await backfill(cards, false)).written).toBe(0);
  });

  test("the job checks the system's own ambiguous rows again with every card's creation time", async () => {
    await card("taskYewOld1", "Yew Invented", { phone: "+96500001717" });
    await card("taskYewNew1", "Yew Invented Two", { phone: "+96500001717" });
    const at = Date.now() - 6 * 24 * HOUR;
    await sale("ncfyew00001", { at: new Date(at).toISOString(), rawPhone: "96500001717", phone8: "00001717" });
    await sweep();
    expect(await live("ncfyew00001")).toMatchObject({ state: "ambiguous", candidates: ["taskYewNew1", "taskYewOld1"] });
    const cards = [{ taskId: "taskYewNew1", createdAt: new Date(at + 5 * 60_000).toISOString(), phone: null, email: null },
      { taskId: "taskYewOld1", createdAt: "2026-03-01T00:00:00Z", phone: null, email: null }];
    // The dry run counts this sale tied already (the other ambiguous rows have no creation times to settle them).
    const before = await one<number>("SELECT count(*)::int AS r FROM public.cockpit_sale_ties WHERE cleared_at IS NULL AND state = 'ambiguous'");
    expect((await backfill(cards, true)).ambiguous).toBe(before - 1);
    expect(await live("ncfyew00001")).toMatchObject({ state: "ambiguous" });
    await backfill(cards, false);
    expect(await live("ncfyew00001")).toMatchObject({ state: "tied", clickup_task_id: "taskYewNew1", matched_by: "phone",
      key_source: "onboarding_answer", also_on: ["taskYewOld1"], set_by: "system:backfill" });
  });

  test("a sweep between `on` and the job ties from K2 alone; the job settles that tie with K1: the in-window card, or a conflict for a person", async () => {
    // The old card holds the client's onboarding phone (K2); Make's card has the same phone and email on its own fields
    // (K1), made a minute after the sale, which only the job's card read knows.
    await card("taskHolOld1", "Holly Invented", { phone: "+96500001818" });
    await card("taskHolNew1", "Holly Invented Two");
    const at = Date.now() - 8 * 24 * HOUR;
    await sale("ncfhol00001", { at: new Date(at).toISOString(), rawPhone: "96500001818", phone8: "00001818", email: "owner@holly-invented.example" });
    // A phone on an old card (K2) and, by K1 only, the email on another card made long before the sale.
    await card("taskJunA001", "Juniper Invented", { phone: "+96500001919" });
    await card("taskJunB001", "Juniper Invented Two");
    await sale("ncfjun00001", { at: new Date(at).toISOString(), rawPhone: "96500001919", phone8: "00001919", email: "owner@juniper-invented.example" });
    await sweep();
    expect(await live("ncfhol00001")).toMatchObject({ state: "tied", clickup_task_id: "taskHolOld1", matched_by: "phone",
      key_source: "onboarding_answer", set_by: "system:onboarding-sync" });
    expect(await live("ncfjun00001")).toMatchObject({ state: "tied", clickup_task_id: "taskJunA001", matched_by: "phone" });
    const cards = [
      { taskId: "taskHolNew1", createdAt: new Date(at + 60_000).toISOString(), phone: "+965 0000 1818", email: "owner@holly-invented.example" },
      { taskId: "taskHolOld1", createdAt: "2026-02-01T00:00:00Z", phone: null, email: null },
      { taskId: "taskJunB001", createdAt: "2026-03-01T00:00:00Z", phone: null, email: "owner@juniper-invented.example" },
    ];
    // The dry run counts what the real run writes.
    const tiedBefore = await one<number>("SELECT count(*)::int AS r FROM public.cockpit_sale_ties WHERE cleared_at IS NULL AND state = 'tied'");
    const conflictsBefore = await one<number>("SELECT count(*)::int AS r FROM public.cockpit_sale_ties WHERE cleared_at IS NULL AND state = 'conflict'");
    const dry = await backfill(cards, true);
    expect(dry.conflict).toBe(conflictsBefore + 1);
    expect(dry.tied).toBe(tiedBefore - 1);
    const real = await backfill(cards, false);
    expect(real.written).toBe(2);
    expect(await live("ncfhol00001")).toMatchObject({ state: "tied", clickup_task_id: "taskHolNew1", matched_by: "phone_email",
      key_source: "card_fields", also_on: ["taskHolOld1"], set_by: "system:backfill" });
    const r = await stored("ncfhol00001");
    expect(r.task_id).toBe("taskHolNew1");
    expect(r.answer_meta.matched).toMatchObject({ via: "sale_tie", taskId: "taskHolNew1", from: "taskHolOld1" });
    // A K1-against-K2 conflict goes to a person, never stays tied.
    expect(await live("ncfjun00001")).toMatchObject({ state: "conflict", clickup_task_id: null, candidates: ["taskJunA001", "taskJunB001"] });
    expect((await stored("ncfjun00001")).task_id).toBeNull();
    expect((await backfill(cards, false)).written).toBe(0);
  });
});

// ---- who may decide ------------------------------------------------------------------------------------------------

describe("who may decide", () => {
  test("only a CSM seat or the CEO; a creative is refused with the sentence", async () => {
    const err = await refusal(() => decide(CREATIVE, "ncfoak00001", "pick", "taskOakOne1"));
    expect(err).toEqual({ code: "42501", message: "Only a client success seat or the CEO ties a sale to a card." });
    const list = await refusal(() => asSeat(CREATIVE, "SELECT public.cockpit_sale_tie_list() AS r"));
    expect(list.code).toBe("42501");
  });

  test("a CSM decides only for their own client; the CEO decides any row; a person's tie is never changed by the sweep", async () => {
    // Oak is not the CSM's client.
    const notMine = await refusal(() => decide(CSM, "ncfoak00001", "pick", "taskOakOne1"));
    expect(notMine).toEqual({ code: "42501", message: "Oak Invented is not one of your clients. Ask its CSM or the CEO to tie this sale." });
    const out = await decide(CEO, "ncfoak00001", "pick", "taskOakTwo1", "The invented owner confirmed the second card.");
    expect(out).toMatchObject({ ok: true, state: "tied", taskId: "taskOakTwo1", clientName: "Oak Invented Two" });
    expect(await live("ncfoak00001")).toMatchObject({ state: "tied", matched_by: "person", set_by: "aziz@maharamedia.com", key_source: null });
    expect((await stored("ncfoak00001")).answer_meta).toMatchObject({ match: "confirmed_by_person", matched: { by: "the CEO", taskId: "taskOakTwo1" } });
    await sweep();
    await backfill([], false);
    expect(await live("ncfoak00001")).toMatchObject({ state: "tied", clickup_task_id: "taskOakTwo1", matched_by: "person" });
    const a = await one<Row>("SELECT metadata AS r FROM public.cockpit_audit_log WHERE action = 'forms.sale_tie_person' ORDER BY created_at DESC LIMIT 1");
    expect(a).toMatchObject({ choice: "pick", role: "ceo", has_note: true });
  });

  test("yes ties to the suggestion; not_client and clear need a reason; a CSM ties their own client", async () => {
    // Fig (conflict) has billing's card as the suggestion (by name).
    const list = await asSeat<Row>(CEO, "SELECT public.cockpit_sale_tie_list() AS r");
    const fig = list.rows.find((r: Row) => r.responseId === "ncffig00001");
    expect(fig).toMatchObject({ state: "conflict", sentence: "The phone points to one card and the email to another. Pick the right card.",
      suggestion: { taskId: "taskFigA001", by: "billing", reason: "Billing ties this sale to this card by its name" } });
    expect(fig.candidates.map((c: Row) => [c.taskId, c.reason])).toEqual([["taskFigA001", "Same phone as the card"], ["taskFigB001", "Same email as the card"]]);
    expect(await decide(CEO, "ncffig00001", "yes")).toMatchObject({ state: "tied", taskId: "taskFigA001" });
    const reason = await refusal(() => decide(CEO, "ncfplay0001", "not_client"));
    expect(reason.message).toBe("Say why in a note of 3 to 500 characters.");
    expect(await decide(CEO, "ncfplay0001", "not_client", null, "An invented test sale.")).toMatchObject({ state: "not_client" });
    // The CSM ties a waiting Bay sale to their own client (Cedar), then clears it with a reason.
    expect(await decide(CSM, "ncfbay00001", "pick", "taskCedar01", null)).toMatchObject({ state: "tied", taskId: "taskCedar01" });
    expect((await refusal(() => decide(CSM, "ncfbay00001", "clear"))).message).toBe("Say why in a note of 3 to 500 characters.");
    expect(await decide(CSM, "ncfbay00001", "clear", null, "Picked the wrong card.")).toMatchObject({ state: "unmatched", taskId: null });
    expect(await live("ncfbay00001")).toMatchObject({ state: "unmatched", candidates: ["taskCedar01"], set_by: "csm@sale-tie.invalid" });
    const r = await stored("ncfbay00001");
    expect(r.task_id).toBeNull();
    expect(r.client_name).toBeNull();
    expect(r.answer_meta.match).toBeUndefined();
    expect(r.answer_meta.matched).toBeUndefined();
    // A CSM marks a sale not a client's only when it shows one of their clients.
    expect(await refusal(() => decide(CSM, "ncfpine0002", "not_client", null, "Looks like a test."))).toEqual({ code: "42501",
      message: "This sale does not show one of your clients. Ask the CEO to mark it." });
    // A person's clear is never undone by the system.
    await sweep();
    expect(await live("ncfbay00001")).toMatchObject({ state: "unmatched", set_by: "csm@sale-tie.invalid" });
    expect((await refusal(() => decide(CEO, "ncfoak00001", "pick", "taskOakTwo1"))).message).toBe("This sale is already on that card.");
    expect((await refusal(() => decide(CEO, "ncfoak00001", "pick", "taskNotOnSheet"))).message).toBe("That card is not on the billing sheet. Pick another.");
  });

  test("append-only: a tie is never edited, deleted or truncated, and a cleared tie stays as it was", async () => {
    await owner(db);
    const id = (await live("ncfcedar001")).id;
    expect((await refusal(() => db.query("UPDATE public.cockpit_sale_ties SET state = 'void' WHERE id = $1", [id]))).message)
      .toBe("A sale tie is never edited: clear it and decide again.");
    expect((await refusal(() => db.query("DELETE FROM public.cockpit_sale_ties WHERE id = $1", [id]))).code).toBe("42501");
    expect((await refusal(() => db.query("TRUNCATE public.cockpit_sale_ties"))).code).toBe("42501");
    const cleared = await one<number>("SELECT min(id)::int AS r FROM public.cockpit_sale_ties WHERE cleared_at IS NOT NULL");
    expect((await refusal(() => db.query("UPDATE public.cockpit_sale_ties SET cleared_reason = 'x' WHERE id = $1", [cleared]))).message)
      .toBe("A cleared sale tie is kept as it was: decide the sale again instead.");
    expect((await refusal(() => db.query("DELETE FROM public.cockpit_sale_tie_cards"))).code).toBe("42501");
    // Not even the service key writes them directly.
    const svc = await refusal(() => asService(() => db.query("INSERT INTO public.cockpit_sale_ties(response_id, state, set_by) VALUES ('ncfsvc00001', 'waiting', 'x')")));
    expect(svc.code).toBe("42501");
  });
});

// ---- the response mirror -------------------------------------------------------------------------------------------

describe("the response mirror and the guard's carve-out", () => {
  test("task_id changes only to the live tie's card, only under the carve-out, only on a stored New Client Form", async () => {
    await owner(db);
    const set = (setting: string, sql: string, params: unknown[] = []) =>
      refusal(async () => {
        await db.exec("BEGIN");
        try {
          await db.query("SELECT set_config('cockpit.forms_legacy', $1, true)", [setting]);
          await db.query(sql, params);
        } finally {
          await db.exec("ROLLBACK");
        }
      });
    const idOf = async (token: string) => (await stored(token)).id;
    const card = "A response keeps its form, version, source, card, mode, seat and creation time";
    // Without the setting, or to another card, or a tie row that is not tied.
    expect((await set("", "UPDATE public.cockpit_form_responses SET task_id = 'taskCedar01' WHERE id = $1", [await idOf("ncfash00001")])).message).toBe(card);
    expect((await set("sale_tie", "UPDATE public.cockpit_form_responses SET task_id = 'taskPine001', answer_meta = answer_meta || '{\"match\":\"phone\",\"matched\":{\"taskId\":\"taskPine001\"}}' WHERE id = $1", [await idOf("ncfcedar001")])).message).toBe(card);
    expect((await set("sale_tie", "UPDATE public.cockpit_form_responses SET task_id = 'taskAshOld1', answer_meta = answer_meta || '{\"match\":\"phone\",\"matched\":{\"taskId\":\"taskAshOld1\"}}' WHERE id = $1", [await idOf("ncfash00001")])).message).toBe(card);
    // The answers never change, nor answer_meta outside match and matched, nor matched with another key.
    expect((await set("sale_tie", "UPDATE public.cockpit_form_responses SET answers = '{\"fields\":[]}' WHERE id = $1", [await idOf("ncfcedar001")])).message).toBe("Sent notes keep their answers");
    expect((await set("sale_tie", "UPDATE public.cockpit_form_responses SET answer_meta = answer_meta || '{\"owner\":\"cockpit\"}' WHERE id = $1", [await idOf("ncfcedar001")])).message).toBe("Sent notes keep their answers");
    expect((await set("sale_tie", "UPDATE public.cockpit_form_responses SET answer_meta = jsonb_set(answer_meta, '{matched,phone}', '\"x\"') WHERE id = $1", [await idOf("ncfcedar001")])).message).toBe("Sent notes keep their answers");
    // Another form under the same setting.
    const onb = (await db.query<{ id: string }>(`INSERT INTO public.cockpit_form_responses(form_key, form_version, source, external_id, mode, state, created_by, submitted_at)
      VALUES ('onboarding', 1, 'typeform_sync', 'onbguard001', 'live', 'submitted', 'forms-door', now()) RETURNING id`)).rows[0].id;
    expect((await set("sale_tie", "UPDATE public.cockpit_form_responses SET task_id = 'taskCedar01' WHERE id = $1", [onb])).message).toBe(card);
    // Every other refusal still holds: a state move.
    expect((await set("sale_tie", "UPDATE public.cockpit_form_responses SET state = 'void' WHERE id = $1", [await idOf("ncfcedar001")])).message)
      .toBe("A response goes from submitted to void only through the cockpit");
  });

  test("an exit survey's person match still works under the live carve-out", async () => {
    await owner(db);
    const id = (await db.query<{ id: string }>(`INSERT INTO public.cockpit_form_responses(form_key, form_version, source, external_id, task_id, mode, state, answer_meta, created_by, submitted_at)
      VALUES ('exit_survey', 1, 'typeform_sync', 'exitguard01', 'taskPine001', 'live', 'legacy', '{"match":"hidden_id_unverified"}', 'forms-door', now()) RETURNING id`)).rows[0].id;
    await db.exec("BEGIN");
    await db.query("SELECT set_config('cockpit.forms_legacy', 'match', true)");
    await db.query(`UPDATE public.cockpit_form_responses SET task_id = 'taskCedar01',
      answer_meta = answer_meta || '{"match":"confirmed_by_person","matched":{"by":"the CEO"}}' WHERE id = $1`, [id]);
    await db.exec("COMMIT");
    expect((await one<Row>("SELECT to_jsonb(r) AS r FROM public.cockpit_form_responses r WHERE id = $1", [id])).task_id).toBe("taskCedar01");
  });
});

// ---- planning the card fields --------------------------------------------------------------------------------------

describe("planning the card fields (sale_facts)", () => {
  test("nothing is planned while fill is off; with fill on only the newest sale on a card on the books plans its two texts", async () => {
    await card("taskMap0001", "Maple Invented", { phone: "+96500001111", onboarding: true });
    const older = await sale("ncfmap00001", { at: iso(20 * 24 * HOUR), rawPhone: "96500001111", phone8: "00001111" });
    const newer = await sale("ncfmap00002", { at: iso(8 * 24 * HOUR), rawPhone: "96500001111", phone8: "00001111",
      goLive: "  In ten days,\r\nonce the invented showroom opens  ", handoff: "No", link: "https://fathom.video/share/inventedMaple" });
    await card("taskGone001", "Gone Invented", { phone: "+96500001212", churned: true });
    const gone = await sale("ncfgone0001", { at: iso(8 * 24 * HOUR), rawPhone: "96500001212", phone8: "00001212" });
    await sweep();
    expect((await live("ncfmap00001")).state).toBe("tied");
    expect((await live("ncfmap00002")).state).toBe("tied");
    expect(await effect(newer)).toBeNull();
    expect(await asService(() => one<number>("SELECT count(*)::int AS r FROM public.cockpit_clickup_writeback_queue"))).toBe(0);

    await flags({ fill: true });
    const s = await sweep();
    expect(s.planned).toBeGreaterThanOrEqual(1);
    const e = await effect(newer);
    expect(e).toMatchObject({ form_key: "new_client", owner: "cockpit", delivery: "clickup_queue", state: "queued" });
    expect(e.plan.taskId).toBe("taskMap0001");
    expect(e.plan.fields).toEqual([
      { fieldId: FIELD.goLive, kind: "text", label: "Go-live expectation", value: "In ten days,\nonce the invented showroom opens", onlyIfEmpty: true, source: "new_client: e30bc458" },
      { fieldId: FIELD.handoff, kind: "text", label: "Handoff problems", value: "No", onlyIfEmpty: true, source: "new_client: 3cf4bfdf" },
    ]);
    expect(await effect(older)).toMatchObject({ state: "skipped", reason: "A newer sale on this card fills its fields." });
    expect(await effect(gone)).toMatchObject({ state: "skipped", reason: "The client has left: no card fields to fill." });
    // B1's contract: the queue payload is exactly these keys, and no text.
    const q = await one<Row>("SELECT to_jsonb(q) AS r FROM public.cockpit_clickup_writeback_queue q WHERE q.id::text = $1", [e.delivery_ref]);
    expect(q).toMatchObject({ kind: "form", source_table: "cockpit_form_effects", task_id: "taskMap0001", dedupe_key: `${newer}:sale_facts` });
    expect(q.payload).toEqual({ formKey: "new_client", effectKey: "sale_facts", effectId: e.id, responseId: newer, taskId: "taskMap0001" });
    for (const f of e.plan.fields) expect(Object.keys(FIELD).map(k => FIELD[k as keyof typeof FIELD])).toContain(f.fieldId);
    for (const n of NEVER) expect(JSON.stringify(e.plan)).not.toContain(n);
    expect(JSON.stringify(e.plan)).not.toContain(FIELD.link);
  });

  test("the queue row and its plan pass build B1's writer check as they are (the claim's shape)", async () => {
    const e = await effect((await stored("ncfmap00002")).id);
    const q = await one<Row>("SELECT to_jsonb(q) AS r FROM public.cockpit_clickup_writeback_queue q WHERE q.id::text = $1", [e.delivery_ref]);
    const { lines: _lines, ...plan } = e.plan;
    const out = await formStep({ id: q.id, kind: "form", payload: q.payload, attempts: 0, created_at: q.created_at, task_id: q.task_id,
      steps: null, progress: {}, effect: { id: e.id, state: e.state, plan } });
    expect(out).toEqual({ step: { key: "sale_facts", type: "facts", taskId: "taskMap0001", fields: [
      { fieldId: FIELD.goLive, kind: "text", label: "Go-live expectation", value: "In ten days,\nonce the invented showroom opens" },
      { fieldId: FIELD.handoff, kind: "text", label: "Handoff problems", value: "No" },
    ] } });
    // The same row named as another key, or another card, fails B1's check with no call.
    expect(await formStep({ id: q.id, kind: "form", payload: { ...q.payload, formKey: "kickoff" }, attempts: 0, created_at: q.created_at,
      task_id: q.task_id, steps: null, progress: {}, effect: { id: e.id, state: e.state, plan } })).toHaveProperty("fail");
    expect(await formStep({ id: q.id, kind: "form", payload: q.payload, attempts: 0, created_at: q.created_at, task_id: "taskOther01",
      steps: null, progress: {}, effect: { id: e.id, state: e.state, plan } })).toHaveProperty("fail");
  });

  test("a late door delivery ties at once and plans its fields while fill is on", async () => {
    await card("taskLate001", "Larch Invented", { email: "owner@larch-invented.example" });
    const id = await sale("ncflate0001", { at: iso(3 * 24 * HOUR), noDeal: true });
    const out = await open({ externalId: "ncflate0001", submittedAt: iso(3 * 24 * HOUR), tieKeys: { phone: null, email: "Owner@Larch-Invented.example" } });
    expect(out).toMatchObject({ ok: true, state: "tied", repeat: false });
    expect(await live("ncflate0001")).toMatchObject({ clickup_task_id: "taskLate001", matched_by: "email", set_by: "system:forms-door" });
    expect(await effect(id)).toMatchObject({ state: "queued" });
  });

  test("the Sales Meeting Link is planned only while salesLink is on, and only on https", async () => {
    await flags({ salesLink: true });
    await card("taskLnk0001", "Linden Invented", { phone: "+96500001313" });
    const id = await sale("ncflnk00001", { at: iso(8 * 24 * HOUR), rawPhone: "96500001313", phone8: "00001313", link: "https://fathom.video/share/inventedLinden" });
    await card("taskLnk0002", "Linden Invented Two", { phone: "+96500001414" });
    const http = await sale("ncflnk00002", { at: iso(8 * 24 * HOUR), rawPhone: "96500001414", phone8: "00001414", link: "http://fathom.video/share/plain" });
    await sweep();
    expect((await effect(id)).plan.fields.map((f: Row) => [f.fieldId, f.kind, f.value]).at(-1))
      .toEqual([FIELD.link, "url", "https://fathom.video/share/inventedLinden"]);
    expect((await effect(http)).plan.fields.map((f: Row) => f.fieldId)).toEqual([FIELD.goLive, FIELD.handoff]);
    await flags({ salesLink: false });
  });

  test("a card the onboarding sync keeps before billing-sync lists it ties at the run's sweep; its notes wait for billing; an internal test card never ties", async () => {
    const at = iso(30 * 60_000);
    const id = await sale("ncfhaz00001", { at });
    expect(await open({ externalId: "ncfhaz00001", tieKeys: { phone: "+96500002020" } })).toMatchObject({ state: "waiting" });
    await sale("ncfhaz00002", { at });
    await open({ externalId: "ncfhaz00002", tieKeys: { phone: "+96500002121" } });
    // Make's cards, offered by the sync's page before the page is published and long before billing-sync's next run.
    const made = new Date(Date.parse(at) + 60_000).toISOString();
    expect(await offer([{ taskId: "taskHaz0001", createdAt: made, phone: "+965 0000 2020", email: null },
      { taskId: "taskHazTst1", createdAt: made, phone: "+965 0000 2121", email: null }])).toMatchObject({ tied: 0 });
    // The same page reaches the onboarding read model; the run's sweep ties Make's card, never the internal test.
    await owner(db);
    await db.query(`INSERT INTO public.cockpit_client_onboarding(clickup_task_id, client_name, in_onboarding)
      VALUES ('taskHaz0001', 'Hazel Invented', true), ('taskHazTst1', '[Internal Test] Hazel Invented', true)`);
    await sweep();
    const t = await live("ncfhaz00001");
    expect(t).toMatchObject({ state: "tied", clickup_task_id: "taskHaz0001", matched_by: "phone", key_source: "card_fields" });
    expect((await stored("ncfhaz00001")).client_name).toBe("Hazel Invented");
    expect(await live("ncfhaz00002")).toMatchObject({ state: "waiting", candidates: [] });
    // Nothing is spent before billing lists the card: no effect, and the next sweep tries again.
    expect(await effect(id)).toBeNull();
    await owner(db);
    expect(await one<Row>("SELECT public.cockpit_sale_tie_plan_facts($1) AS r", [t.id])).toEqual({ planned: false,
      reason: "This card is not on the billing sheet yet, so its notes wait for the next sync after billing lists it." });
    await db.query(`INSERT INTO public.cockpit_billing_accounts(clickup_task_id, client_name, stage_group, client_status)
      VALUES ('taskHaz0001', 'Hazel Invented', 'active', 'Active')`);
    await sweep();
    expect(await effect(id)).toMatchObject({ state: "queued", plan: { taskId: "taskHaz0001" } });
  });

  test("nothing plans before build B2's gate branch is there (today's gate settles such a row skipped), and the sweep says so", async () => {
    await owner(db);
    await db.exec("BEGIN");
    try {
      await db.exec(todayGate());
      expect(await one<boolean>("SELECT public.cockpit_sale_tie_gate_ready() AS r")).toBe(false);
      await card("taskGat0001", "Gate Invented", { phone: "+96500002222" });
      const id = await sale("ncfgat00001", { at: iso(8 * 24 * HOUR), rawPhone: "96500002222", phone8: "00002222" });
      expect((await sweep()).planned).toBe(0);
      const t = await live("ncfgat00001");
      expect(t).toMatchObject({ state: "tied", clickup_task_id: "taskGat0001" });
      expect(await effect(id)).toBeNull();
      expect(await one<string>("SELECT note AS r FROM public.cockpit_sync_state WHERE key = 'sale-ties'"))
        .toMatch(/ Card notes wait for the forms gate that passes them \(20261103c\), so none were planned\.$/);
      expect(await one<Row>("SELECT public.cockpit_sale_tie_plan_facts($1) AS r", [t.id])).toEqual({ planned: false,
        reason: "Card notes wait for the forms gate that passes them (20261103c), so none were planned." });
    } finally {
      await db.exec("ROLLBACK");
    }
  });

  test("today's gate would settle a sale_facts row skipped in the claim's first pass (never a hold); build B2's gate passes it", async () => {
    const e = await effect((await stored("ncflnk00001")).id);
    await owner(db);
    await db.exec("BEGIN");
    try {
      await db.exec(todayGate());
      expect(await one<Row>("SELECT public.cockpit_form_effect_gate('clickup_queue', $1) AS r", [e.delivery_ref]))
        .toMatchObject({ ok: false, effectKey: "sale_facts", reason: "Make owns this again." });
      // In any mode (the writer has not reported here), the claim's first pass settles it, and its effect follows.
      expect(await asService(() => one<Row[]>("SELECT public.cockpit_clickup_writeback_claim_forms(gen_random_uuid(), 8) AS r"))).toEqual([]);
      expect(await one<Row>("SELECT jsonb_build_object('state', state, 'error', error) AS r FROM public.cockpit_clickup_writeback_queue WHERE id::text = $1", [e.delivery_ref]))
        .toEqual({ state: "skipped", error: "Make owns this again." });
      expect((await effect((await stored("ncflnk00001")).id)).state).toBe("skipped");
    } finally {
      await db.exec("ROLLBACK");
    }
    const pass = await one<Row>("SELECT public.cockpit_form_effect_gate('clickup_queue', $1) AS r", [e.delivery_ref]);
    expect(pass).toMatchObject({ ok: true, effectKey: "sale_facts", formKey: "new_client" });
    expect((await effect((await stored("ncflnk00001")).id)).state).toBe("queued");
  });

  test("a tie whose card notes are planned stays when the job would move it", async () => {
    await owner(db);
    await db.exec("BEGIN");
    try {
      const at = Date.parse((await stored("ncflnk00001")).submitted_at);
      await card("taskLnkNew1", "Linden Invented New");
      const out = await backfill([{ taskId: "taskLnkNew1", createdAt: new Date(at + 60_000).toISOString(), phone: "+96500001313", email: null }], false);
      expect(out.written).toBe(0);
      expect(await live("ncflnk00001")).toMatchObject({ state: "tied", clickup_task_id: "taskLnk0001", set_by: "system:onboarding-sync" });
    } finally {
      await db.exec("ROLLBACK");
    }
  });

  test("a CSM never moves a tie whose notes are planned or on a card; the CEO's move takes back a write that has not started", async () => {
    await db.query("INSERT INTO public.test_csm_clients VALUES ($1, 'taskMap0001'), ($1, 'taskCedar01')", [CSM]);
    await owner(db);
    await db.query("UPDATE public.cockpit_billing_accounts SET client_name = 'Olive Invented' WHERE clickup_task_id = 'taskMap0001'");
    await db.query("UPDATE public.cockpit_client_onboarding SET client_name = 'Olive Invented' WHERE clickup_task_id = 'taskMap0001'");
    const moved = await refusal(() => decide(CSM, "ncfmap00002", "pick", "taskCedar01"));
    expect(moved).toEqual({ code: "42501", message: "This sale's go-live and handoff notes are already on another card. Ask the CEO to move it." });
    const responseId = (await stored("ncfmap00002")).id;
    const before = await effect(responseId);
    expect(before).toMatchObject({ state: "queued", plan: { taskId: "taskMap0001" } });
    const out = await decide(CEO, "ncfmap00002", "pick", "taskCedar01", "The invented client asked for the older card.");
    const back = "The CEO took this sale off this card before its notes were written, so nothing was written.";
    expect(out).toMatchObject({ state: "tied", taskId: "taskCedar01", movedFrom: "taskMap0001",
      facts: { planned: false, state: "skipped", reason: back },
      handFill: { taskId: "taskCedar01", sentence: "This sale's notes were planned for another card first, and the cockpit writes them once. Fill Go-live expectation and Handoff problems on this card by hand if they are empty." } });
    // The queue row and its effect are settled, so nothing reaches the card the CEO rejected.
    await owner(db);
    expect(await one<Row>("SELECT jsonb_build_object('state', state, 'error', error) AS r FROM public.cockpit_clickup_writeback_queue WHERE id::text = $1", [before.delivery_ref]))
      .toEqual({ state: "skipped", error: back });
    expect(await effect(responseId)).toMatchObject({ state: "skipped", reason: back, plan: { taskId: "taskMap0001" } });
    expect(await one<Row>("SELECT public.cockpit_form_effect_gate('clickup_queue', $1) AS r", [before.delivery_ref]))
      .toMatchObject({ ok: false, effectState: "skipped", reason: "This write was settled in the cockpit, so nothing was written." });
    const a = await one<Row>("SELECT metadata AS r FROM public.cockpit_audit_log WHERE action = 'forms.sale_tie_person' ORDER BY created_at DESC LIMIT 1");
    expect(a).toMatchObject({ choice: "pick", role: "ceo", factsTakenBack: "taskMap0001" });
    expect(a.factsOnCard).toBeUndefined();
  });

  test("a write in flight is never moved under it; once written, the CEO's move names the first card for a hand fix", async () => {
    const responseId = (await stored("ncflnk00002")).id;
    const e = await effect(responseId);
    expect(e).toMatchObject({ state: "queued", plan: { taskId: "taskLnk0002" } });
    const setQueue = async (state: string) => {
      await owner(db);
      await db.query("UPDATE public.cockpit_clickup_writeback_queue SET state = $2, claimed_at = now() WHERE id::text = $1", [e.delivery_ref, state]);
    };
    const busy = { code: "55000", message: "This sale's go-live and handoff notes are being written to its card now. Try again once that write finishes." };
    await setQueue("sending");
    expect(await refusal(() => decide(CEO, "ncflnk00002", "pick", "taskLnk0001", "The invented client named the other card."))).toEqual(busy);
    await setQueue("unknown");
    expect((await effect(responseId)).state).toBe("unknown");
    expect(await refusal(() => decide(CEO, "ncflnk00002", "clear", null, "Not this card."))).toEqual(busy);
    expect(await live("ncflnk00002")).toMatchObject({ state: "tied", clickup_task_id: "taskLnk0002" });
    await setQueue("delivered");
    expect((await effect(responseId)).state).toBe("delivered");
    const out = await decide(CEO, "ncflnk00002", "pick", "taskLnk0001", "The invented client named the other card.");
    expect(out).toMatchObject({ state: "tied", taskId: "taskLnk0001", movedFrom: "taskLnk0002", facts: { planned: false, state: "delivered" },
      handFill: { taskId: "taskLnk0001" } });
    const a = await one<Row>("SELECT metadata AS r FROM public.cockpit_audit_log WHERE action = 'forms.sale_tie_person' ORDER BY created_at DESC LIMIT 1");
    expect(a).toMatchObject({ choice: "pick", role: "ceo", factsOnCard: "taskLnk0002" });
    expect(a.factsTakenBack).toBeUndefined();
  });

  test("turning fill off takes back every write that has not started: the claim hands the writer no sale_facts row", async () => {
    await owner(db);
    // The forms writer last reported apply, every card.
    await db.query(`INSERT INTO public.cockpit_sync_state(key, ok, last_run_at, detail) VALUES ('clickup-writeback:forms', true, now(), $1::jsonb)
      ON CONFLICT (key) DO UPDATE SET last_run_at = now(), detail = excluded.detail`, [json({ mode: "apply", at: new Date().toISOString(), onlyCards: [] })]);
    const claim = () => asService(() => one<Row[]>("SELECT public.cockpit_clickup_writeback_claim_forms(gen_random_uuid(), 12) AS r"));
    const facts = (rows: Row[]) => rows.filter(r => r.payload?.effectKey === "sale_facts");
    // While fill is on, the claim would hand them to the writer (rolled back).
    await db.exec("BEGIN");
    const control = await claim();
    await db.exec("ROLLBACK");
    expect(facts(control).length).toBeGreaterThan(0);
    // One write is in flight: it is left to finish.
    const late = await effect((await stored("ncflate0001")).id);
    await owner(db);
    await db.query("UPDATE public.cockpit_clickup_writeback_queue SET state = 'sending', claimed_at = now() WHERE id::text = $1", [late.delivery_ref]);
    const open = await one<number>(`SELECT count(*)::int AS r FROM public.cockpit_clickup_writeback_queue
      WHERE payload->>'effectKey' = 'sale_facts' AND state IN ('queued','retry')`);
    expect(open).toBeGreaterThan(0);
    await flags({ fill: false });
    const off = "Card writes for sales were turned off, so nothing was written.";
    expect(await one<Row>(`SELECT jsonb_build_object('open', count(*) FILTER (WHERE state IN ('queued','retry')),
        'off', count(*) FILTER (WHERE state = 'skipped' AND error = $1), 'sending', count(*) FILTER (WHERE state = 'sending'))::jsonb AS r
      FROM public.cockpit_clickup_writeback_queue WHERE payload->>'effectKey' = 'sale_facts'`, [off])).toEqual({ open: 0, off: open, sending: 1 });
    expect(await one<number>(`SELECT count(*)::int AS r FROM public.cockpit_form_effects WHERE effect_key = 'sale_facts' AND state = 'skipped' AND reason = $1`, [off])).toBe(open);
    expect(facts(await claim())).toEqual([]);
    // Turning fill on again plans nothing for those sales: their one write is spent (a hand step, RUNBOOK).
    await flags({ fill: true });
    const s = await sweep();
    expect(s.planned).toBe(0);
    await owner(db);
    await db.query("UPDATE public.cockpit_clickup_writeback_queue SET state = 'delivered' WHERE id::text = $1", [late.delivery_ref]);
  });
});

// ---- the screens' reads --------------------------------------------------------------------------------------------

describe("the screens' reads", () => {
  test("the CSM read: the newest tie per card with the sale's notes, `none` without one, and only the CSM's own cards", async () => {
    await owner(db);
    await db.query("INSERT INTO public.test_csm_clients VALUES ($1, 'taskPine001')", [CSM]);
    const r = await asSeat<Row>(CSM, "SELECT public.cockpit_csm_sale_read($1) AS r", [["taskMap0001", "taskPine001"]]);
    expect(r.on).toBe(true);
    const map = r.cards.find((c: Row) => c.taskId === "taskMap0001");
    expect(map).toMatchObject({ state: "tied", responseId: "ncfmap00001", tiedBy: "phone", closer: "Closer Invented", voidedInB2B: false,
      otherSales: 0, goLive: "In two weeks,\nafter the invented launch", handoffProblems: "No" });
    const pine = r.cards.find((c: Row) => c.taskId === "taskPine001");
    expect(pine).toMatchObject({ state: "tied", tiedBy: "phone_email" });
    const text = JSON.stringify(r);
    for (const v of ["96500000202", "0000 0202", "owner@pine", "Firstnameinvented", REF.first]) expect(text).not.toContain(v);
    const none = await asSeat<Row>(CEO, "SELECT public.cockpit_csm_sale_read($1) AS r", [["taskWil0001", "taskNoSale1"]]);
    expect(none.cards.find((c: Row) => c.taskId === "taskNoSale1")).toEqual({ taskId: "taskNoSale1", state: "none" });
    const err = await refusal(() => asSeat(CSM, "SELECT public.cockpit_csm_sale_read($1) AS r", [["taskOakOne1"]]));
    expect(err.code).toBe("42501");
    expect((await refusal(() => asSeat(CREATIVE, "SELECT public.cockpit_csm_sale_read($1) AS r", [["taskMap0001"]]))).code).toBe("42501");
  });

  test("the list: open rows with plain sentences, the CEO's billing disagreements, a CSM's own rows only, never a phone, an email or a digest", async () => {
    await owner(db);
    // A tie billing puts on another card (billing names Cedar by its payments; the phone points at Dune's own card).
    await card("taskDune001", "Dune Invented", { phone: "+96500001616" });
    await db.query("INSERT INTO public.test_billing_assignments VALUES ('ncfdune0001', 'taskCedar01', 'ledger')");
    await sale("ncfdune0001", { at: iso(8 * 24 * HOUR), rawPhone: "96500001616", phone8: "00001616" });
    // An unmatched sale whose sales-call link is on exactly one card: the one-tap suggestion, never a tie.
    await card("taskReed001", "Reed Invented", { salesCall: "https://fathom.video/share/inventedReed" });
    await sale("ncfreed0001", { at: iso(8 * 24 * HOUR), link: "https://fathom.video/share/inventedReed" });
    await sweep();
    expect(await live("ncfdune0001")).toMatchObject({ state: "tied", clickup_task_id: "taskDune001", billing_task_id: "taskCedar01",
      billing_matched_by: "ledger" });
    expect(await live("ncfreed0001")).toMatchObject({ state: "unmatched", suggested_task_id: "taskReed001", suggested_by: "sales_call" });
    const ceo = await asSeat<Row>(CEO, "SELECT public.cockpit_sale_tie_list() AS r");
    expect(ceo).toMatchObject({ on: true, fill: true, salesLink: false });
    expect(ceo.summary.onCard).toBeGreaterThanOrEqual(5);
    expect(ceo.summary.byPerson).toBeGreaterThanOrEqual(2);
    expect(ceo.summary.sales).toBe(await one<number>("SELECT count(*)::int AS r FROM public.cockpit_form_responses WHERE form_key = 'new_client'"));
    const by = (id: string) => ceo.rows.find((r: Row) => r.responseId === id);
    expect(by("ncfdune0001")).toMatchObject({ state: "tied", sentence: "Billing ties this sale to another card.",
      tiedTo: { taskId: "taskDune001", clientName: "Dune Invented", tiedBy: "phone" },
      suggestion: { taskId: "taskCedar01", reason: "Billing ties this sale to this card by its payments" } });
    expect(by("ncfreed0001")).toMatchObject({ state: "unmatched",
      sentence: "No card has this sale's phone or email after 2 days. Check Make 10's run, or pick the card.",
      suggestion: { taskId: "taskReed001", by: "sales_call", reason: "Same sales-call link as the card" } });
    const unmatched = by("ncfpine0002");
    expect(unmatched).toMatchObject({ closer: "Closer Invented", businessName: "Business ncfpine0002", candidates: [], suggestion: null });
    expect(unmatched.signedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // A sale waiting under 2 hours is not a person's yet.
    expect(by("ncfash00001")).toBeUndefined();
    const text = JSON.stringify(ceo);
    for (const v of ["96500000", "invented.example", "phone_key", "email_key", "Firstnameinvented"]) expect(text).not.toContain(v);
    expect(text).not.toMatch(/[0-9a-f]{64}/);
    // Yes ties to the suggestion; a sale with no suggestion and no single candidate needs a pick.
    expect(await decide(CEO, "ncfreed0001", "yes")).toMatchObject({ state: "tied", taskId: "taskReed001" });
    expect((await refusal(() => decide(CEO, "ncfpine0002", "yes"))).message).toBe("This sale has no suggested card. Pick one from the list.");
    // The CSM sees only rows with one of their cards, and only those cards; never billing's disagreements.
    const csm = await asSeat<Row>(CSM, "SELECT public.cockpit_sale_tie_list() AS r");
    for (const row of csm.rows)
      for (const c of [...row.candidates, ...(row.suggestion ? [row.suggestion] : [])])
        expect(["Cedar Invented", "Olive Invented"]).toContain(c.clientName);
    expect(csm.rows.some((r: Row) => r.state === "tied" || r.responseId === "ncfpine0002")).toBe(false);
  });

  test("the portal's onboarding open takes the business name from the card's newest tied sale (stored shape)", async () => {
    await owner(db);
    await card("taskPort001", "Portal Invented", { phone: "+96500001515", onboarding: true });
    await sale("ncfport0001", { at: iso(8 * 24 * HOUR), rawPhone: "96500001515", phone8: "00001515", business: "  Harbour Invented Homes  " });
    await sweep();
    await asService(() => one("SELECT public.portal_form_onboarding_open('locInvented1', 'taskPort001', 'Invented Owner', 'owner') AS r"));
    expect(await one<Row>("SELECT context AS r FROM public.test_invites_issued WHERE task_id = 'taskPort001'")).toEqual({ businessName: "Harbour Invented Homes" });
    // A card with no tied sale gets no context.
    await asService(() => one("SELECT public.portal_form_onboarding_open('locInvented1', 'taskNoSale1', 'Invented Owner', 'owner') AS r"));
    expect(await one<Row>("SELECT context AS r FROM public.test_invites_issued WHERE task_id = 'taskNoSale1'")).toEqual({});
  });

  test("the doors report the three switches, off until set, with why", async () => {
    await flags({ on: false, fill: false, salesLink: false });
    const d = await asSeat<Row>(CEO, "SELECT public.cockpit_form_doors() AS r");
    expect([d.saleTie, d.saleFacts, d.salesLink]).toEqual([false, false, false]);
    expect([d.why.saleTie, d.why.saleFacts, d.why.salesLink]).toEqual(["off", "off", "off"]);
    expect(d.wins).toBe(false);
    await flags({ on: true, fill: true });
    const on = await asSeat<Row>(CEO, "SELECT public.cockpit_form_doors() AS r");
    expect([on.saleTie, on.saleFacts, on.salesLink]).toEqual([true, true, false]);
    expect(on.why.saleTie).toBeNull();
    const audits = await one<number>("SELECT count(*)::int AS r FROM public.cockpit_audit_log WHERE action = 'forms.switch_set' AND entity_id = 'forms.sale_tie'");
    expect(audits).toBeGreaterThanOrEqual(2);
  });
});

// ---- privacy and audit ---------------------------------------------------------------------------------------------

describe("privacy and audit", () => {
  test("no phone, email or digest is in any audit row; the tie rows' audit carries ids, states and methods only", async () => {
    await owner(db);
    // Every row but the test's own inserts of the stored sales (those copy the answers, as the live record does today).
    const all = await one<string>(`SELECT string_agg(coalesce(before::text, '') || coalesce(after::text, '') || metadata::text, ' ') AS r
      FROM public.cockpit_audit_log WHERE action <> 'forms.cockpit_form_responses.insert'`);
    for (const v of ["96500000", "0000 0", "invented.example", "@fig", "@pine", "@bay"]) expect(all).not.toContain(v);
    expect(all).not.toMatch(/[0-9a-f]{64}/);
    const tie = await one<Row>("SELECT after AS r FROM public.cockpit_audit_log WHERE entity_type = 'cockpit_sale_ties' ORDER BY created_at DESC LIMIT 1");
    expect(Object.keys(tie).sort()).toEqual(["also_on", "billing_matched_by", "billing_task_id", "candidates", "cleared_at", "cleared_by",
      "clickup_task_id", "form_response_id", "id", "key_source", "matched_by", "response_id", "set_at", "set_by", "state",
      "suggested_by", "suggested_task_id"]);
    // The queue's audit rows hold the payload, which holds no text.
    const q = await one<string>("SELECT string_agg(after::text, ' ') AS r FROM public.cockpit_audit_log WHERE entity_type = 'cockpit_clickup_writeback_queue'");
    expect(q).toContain("sale_facts");
    expect(q).not.toContain("invented showroom");
    expect(q).not.toContain("fathom.video");
  });

  test("the tables hold digests, never a value", async () => {
    await owner(db);
    const text = await one<string>("SELECT (SELECT string_agg(to_jsonb(t)::text, ' ') FROM public.cockpit_sale_ties t) || (SELECT coalesce(string_agg(to_jsonb(c)::text, ' '), '') FROM public.cockpit_sale_tie_cards c) AS r");
    // set_by and cleared_by name a person's seat address; no client's phone or email is anywhere.
    for (const v of ["96500000", "0000 0", "invented.example", "owner@"]) expect(text).not.toContain(v);
    const pep = await pepper();
    expect(await one<number>("SELECT count(*)::int AS r FROM public.cockpit_sale_ties WHERE phone_key = $1", [nodeDigest(pep, "phone", "+96500000101")])).toBeGreaterThanOrEqual(1);
  });
});
