/**
 * The Client Profile backfill (20261103c_stage4_profile_backfill.sql; the CEO's "Sure" to CEO-2, the next-design plan's
 * build B2, docs/forms/WAVE56-CONTRACT.md 4.17), on an isolated PostgreSQL with Supabase's default privileges on, so a
 * missing REVOKE opens an object here as it would in production.
 *
 * It stands on the bodies the file replaces, calls or is asked through, cut from their canonical migrations: the owner
 * gate (20261102j), Make's Client Profile text and the two helpers it reads (20261102o), the forms claim and its mode
 * (20261029t), the registry's owner and native window (20261029s), the effects guard, settle and from-queue trigger
 * (20261029w), the forms audit (20261027f), the queue audit (20261102o) and the service check (20261009a). The first test
 * proves each of those bodies is the live one: its white-space-folded prosrc md5 equals the md5 read live, read only, on
 * 2026-11-03. The effects table, the writeback queue and the client records are cut from their own files with the live
 * CHECKs and triggers; the form responses and the registry are stand-ins with the columns the file reads.
 *
 * Covered: the drift guard and the prerequisite guard; two applies; the gate's after md5; grants (the gate the owner's
 * only, the backfill the service role's only: anon, authenticated and the owner without the service role refused); every
 * refusal; a dry run writes no row in any table and never returns the text; the text equals an independent builder of
 * Make 13 [29]'s seven labels and B1's PROFILE_LABELS; apply makes one effect and one queue row per card under B1's
 * payload contract (no text in the payload, the sha256 of the plan's text), and the writer's own check (forms.ts
 * formStep) takes the claimed row; a second apply queues nothing; one card's failed insert skips that card alone and the
 * next card in the same call is still queued; the RUNBOOK's stop gate (the CEO's re-confirmation, word for word in the
 * RUNBOOK and the contract) comes before the lane opens, and its apply actor records that yes; each skip reason; the
 * gate passes both new keys and,
 * on every other case of a 700-case matrix, answers exactly as 20261102j's gate does; the claim keeps a held backfill
 * row in every mode (20261102j's gate would settle it); cancel; audit rows hold no text.
 * Every client, card and answer is invented.
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
import { readFileSync } from "node:fs";
import type { PGlite } from "@electric-sql/pglite";
import {
  CLIENT_PROFILE_FIELD,
  formStep,
  PROFILE_BACKFILL,
  PROFILE_LABELS,
} from "../../../supabase/functions/clickup-writeback/forms.ts";
import { cockpitTestDb, migration } from "./lib/cockpitTestDb";

setDefaultTimeout(120_000);

const C = "20261103c_stage4_profile_backfill.sql";

/**
 * md5(white-space-folded prosrc) of every body this file replaces, calls or stands on, read live 2026-11-03. In creation
 * order: a LANGUAGE sql body is checked when it is made, so the two helpers come before the Client Profile text.
 */
const LIVE: Record<string, { file: string; md5: string }> = {
  "cockpit_form_effect_gate(text,text)": { file: "20261102j_stage4_native.sql", md5: "a683c23676194229cc175e4d47cb8b2b" },
  "cockpit_form_typeform_text(text)": { file: "20261102o_stage4_match_make.sql", md5: "4509bcd520194d07a477d24dd183df91" },
  "cockpit_form_stage4_make_text(text,text)": { file: "20261102o_stage4_match_make.sql", md5: "b14bfda43df528ef80bdc79c107b7681" },
  "cockpit_form_stage4_profile_text(jsonb)": { file: "20261102o_stage4_match_make.sql", md5: "6c652fb15684e5c928f4d868e033f2ca" },
  "cockpit_clickup_writeback_audit()": { file: "20261102o_stage4_match_make.sql", md5: "4127726aa23cffe1ce78fc5ceafb8292" },
  "cockpit_clickup_writeback_claim_forms(uuid,integer)": {
    file: "20261029t_forms_clickup_writeback.sql",
    md5: "c79ffe4c8d0273ee517e745feb672186",
  },
  "cockpit_clickup_forms_mode()": { file: "20261029t_forms_clickup_writeback.sql", md5: "3a265f0240261c048b59ec6fc89488b9" },
  "cockpit_form_native_since(text)": { file: "20261029s_forms_registry.sql", md5: "14b384f0298888ff069621725063bc54" },
  "cockpit_form_effect_owner(text,text)": { file: "20261029s_forms_registry.sql", md5: "f4f8ceb7a24da0703f48f9653cc9ec2c" },
  "cockpit_form_effects_guard()": { file: "20261029w_forms_dispatch.sql", md5: "b3d4444b4f9cd7645cdecfab1b2204c3" },
  "cockpit_form_effects_settle(text,text,text,text,jsonb,boolean)": {
    file: "20261029w_forms_dispatch.sql",
    md5: "a9f0623644b36e8329ddedaed59aa647",
  },
  "cockpit_form_effects_from_queue()": { file: "20261029w_forms_dispatch.sql", md5: "01adbb40fb3ad5d2f5c3c42caccb4ea1" },
  "cockpit_form_effects_health(boolean,text,jsonb)": {
    file: "20261029w_forms_dispatch.sql",
    md5: "08994c00dd5351f8f5adb364a9336706",
  },
  "cockpit_forms_audit()": { file: "20261027f_forms_core.sql", md5: "c260558cd2e817050b0649b0da5b737c" },
  "cockpit_hours_require_service()": { file: "20261009a_cockpit_team_hours.sql", md5: "c401ede538ce0cbbf6fe0c9df87fdb3a" },
};
/** The gate as this file writes it (its drift guard's "after"). */
const GATE_AFTER = "4ca44d25514e25806229a7e6d185673b";
/** The live CHECKs and triggers of the tables the file writes (pg_get_constraintdef / pg_get_triggerdef, 2026-11-03). */
const LIVE_EFFECT_CHECKS: Record<string, string> = {
  cockpit_form_effects_check: "CHECK ((dedupe_key = (((response_id)::text || ':'::text) || effect_key)))",
  cockpit_form_effects_check1: "CHECK (((owner = 'cockpit'::text) OR (state = ANY (ARRAY['dry_run'::text, 'skipped'::text]))))",
  cockpit_form_effects_delivery_check:
    "CHECK ((delivery = ANY (ARRAY['clickup_queue'::text, 'slack_notice'::text, 'client_message'::text, 'creative_outbox'::text, 'sql'::text, 'relay'::text])))",
  cockpit_form_effects_effect_key_check: "CHECK ((effect_key ~ '^[a-z][a-z0-9_]{1,40}$'::text))",
  cockpit_form_effects_owner_check: "CHECK ((owner = ANY (ARRAY['make'::text, 'shadow'::text, 'cockpit'::text])))",
  cockpit_form_effects_plan_check:
    "CHECK (((jsonb_typeof(plan) = 'object'::text) AND (octet_length((plan)::text) <= CASE WHEN (form_key = ANY (ARRAY['kickoff'::text, 'onboarding'::text])) THEN 2097152 ELSE 131072 END)))",
  cockpit_form_effects_reason_check: "CHECK (((reason IS NULL) OR (char_length(reason) <= 240)))",
  cockpit_form_effects_receipt_check: "CHECK (((receipt IS NULL) OR (jsonb_typeof(receipt) = 'object'::text)))",
  cockpit_form_effects_state_check:
    "CHECK ((state = ANY (ARRAY['planned'::text, 'dry_run'::text, 'queued'::text, 'delivered'::text, 'failed'::text, 'unknown'::text, 'skipped'::text])))",
  cockpit_form_effects_dedupe_key_key: "UNIQUE (dedupe_key)",
  cockpit_form_effects_response_id_effect_key_key: "UNIQUE (response_id, effect_key)",
  cockpit_form_effects_response_id_fkey: "FOREIGN KEY (response_id) REFERENCES cockpit_form_responses(id)",
  cockpit_form_effects_pkey: "PRIMARY KEY (id)",
};
const LIVE_QUEUE_CHECKS: Record<string, string> = {
  cockpit_clickup_writeback_queue_attempts_check: "CHECK ((attempts >= 0))",
  cockpit_clickup_writeback_queue_check: "CHECK (((state = 'sending'::text) = (claim_token IS NOT NULL)))",
  cockpit_clickup_writeback_queue_dedupe_key_key: "UNIQUE (dedupe_key)",
  cockpit_clickup_writeback_queue_kind_check:
    "CHECK ((kind = ANY (ARRAY['decision'::text, 'manual_change'::text, 'provider_action'::text, 'tracking_backlog'::text, 'billing'::text, 'request'::text, 'task_action'::text, 'form'::text])))",
  cockpit_clickup_writeback_queue_payload_check: "CHECK ((jsonb_typeof(payload) = 'object'::text))",
  cockpit_clickup_writeback_queue_pkey: "PRIMARY KEY (id)",
  cockpit_clickup_writeback_queue_planned_check: "CHECK (((planned IS NULL) OR (jsonb_typeof(planned) = 'array'::text)))",
  cockpit_clickup_writeback_queue_progress_check: "CHECK ((jsonb_typeof(progress) = 'object'::text))",
  cockpit_clickup_writeback_queue_state_check:
    "CHECK ((state = ANY (ARRAY['queued'::text, 'sending'::text, 'retry'::text, 'unknown'::text, 'delivered'::text, 'dry_run'::text, 'skipped'::text, 'failed'::text])))",
  cockpit_clickup_writeback_queue_steps_check: "CHECK (((steps IS NULL) OR (jsonb_typeof(steps) = 'array'::text)))",
};
const LIVE_TRIGGERS = [
  "CREATE TRIGGER cockpit_clickup_writeback_queue_audit_insert AFTER INSERT ON public.cockpit_clickup_writeback_queue FOR EACH ROW EXECUTE FUNCTION cockpit_clickup_writeback_audit()",
  "CREATE TRIGGER cockpit_clickup_writeback_queue_audit_state AFTER UPDATE OF state ON public.cockpit_clickup_writeback_queue FOR EACH ROW WHEN (((old.state IS DISTINCT FROM new.state) AND (new.state <> 'sending'::text))) EXECUTE FUNCTION cockpit_clickup_writeback_audit()",
  "CREATE TRIGGER cockpit_form_effects_from_queue AFTER UPDATE OF state ON public.cockpit_clickup_writeback_queue FOR EACH ROW WHEN (((old.state IS DISTINCT FROM new.state) AND (new.kind = 'form'::text))) EXECUTE FUNCTION cockpit_form_effects_from_queue()",
  "CREATE TRIGGER cockpit_form_effects_audit AFTER INSERT OR UPDATE OF state ON public.cockpit_form_effects FOR EACH ROW EXECUTE FUNCTION cockpit_forms_audit()",
  "CREATE TRIGGER cockpit_form_effects_guard BEFORE INSERT OR UPDATE ON public.cockpit_form_effects FOR EACH ROW EXECUTE FUNCTION cockpit_form_effects_guard()",
];

const FIELD = "7755485f-74a8-496c-85d8-562588e77944";
/** KFRCXPFx refs (as 20261102o lists them). */
const REF = {
  lastRevenue: "7ff5d37a-df7f-4002-8248-d0b4af6c28e8",
  goal90: "791b99b8-c7e9-40a4-96d6-868399e1ae97",
  goal12: "f4b96a9b-bd7c-4398-98b4-6a28a7d3595a",
  marketing: "bf8c7c7b-fff9-463f-b30a-8d8ca8b622f6",
  challenges: "fcf43e6a-cc84-4ae7-9cef-2336069d0280",
  whyJoined: "7426c6c5-344f-44c9-9999-3b9daf3a06b8",
  additional: "41d2d5bb-b023-4fa4-906c-72aeef7a5e46",
  fullName: "533f14a0-712f-4de9-9ac7-67e1be6bc0c8",
  phone: "64f2fb80-b074-4017-b8b7-b7d549947e52",
  email: "7994f0d2-baeb-451b-983a-816290873a68",
  businessName: "514bfd3f-4ca1-469e-b9e7-87656503f65c",
  hours: "b7873d40-d154-42ac-bf24-cb3b667e84cc",
} as const;
/** The contact answers (invented) that must never reach a plan line, a payload or an audit row. */
const CONTACT = {
  fullName: "Invented Owner Fullname",
  phone: "+96500000077",
  email: "owner@cedar.invalid",
};

type Row = Record<string, any>;
type Answer = { ref: string; title: string; value: string };
const a = (ref: string, value: string, title = "Stored title"): Answer => ({ ref, title, value });
const json = (v: unknown) => JSON.stringify(v);
/** Each worded answer as it would sit inside JSON text (a bare number could match an id by chance). */
const worded = (answers: Answer[]) =>
  answers
    .map(x => x.value.trim())
    .filter(v => /[A-Za-z\u0600-\u06FF]{3}/.test(v))
    .map(v => json(v.split(/\r?\n/)[0]).slice(1, -1));
const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
const md5 = (s: string) => createHash("md5").update(s).digest("hex");

// Cards (invented).
const CARD_A = "taskBfA1"; // 6 of 7 (no 12-24 month goal)
const CARD_B = "taskBfB2"; // 7 of 7: a CR LF, spaces at both ends, a ref answered twice, Arabic-Indic digits, a decimal
const CARD_C = "taskBfC3"; // Arabic texts, a revenue of 0 (blank, as Make prints it)
const SKIP = {
  noRecord: "taskNoRec1",
  launched: "taskLaunch1",
  hasProfile: "taskHasProf1",
  noAnswer: "taskNoAns1",
  portal: "taskPortal1",
  noResponse: "taskNoResp1",
  shadow: "taskShadow1",
  disagree: "taskDisagr1",
  openNative: "taskOpenNat1",
  noProfileAnswers: "taskNoProf1",
  badShape: "taskShape1",
} as const;

/** Answers per card (Typeform-shaped; invented). */
const ANSWERS: Record<string, Answer[]> = {
  [CARD_A]: [
    a(REF.fullName, CONTACT.fullName),
    a(REF.phone, CONTACT.phone),
    a(REF.email, CONTACT.email),
    a(REF.businessName, "Cedar Homes Invented Co"),
    a(REF.lastRevenue, "250000"),
    a(REF.goal90, "100000"),
    a(REF.marketing, "Instagram posts and word of mouth."),
    a(REF.challenges, "Lead quality\nSlow replies\nPricing"),
    a(REF.whyJoined, "To grow steadily."),
    a(REF.additional, "Nothing more for now."),
  ],
  [CARD_B]: [
    a(REF.fullName, CONTACT.fullName),
    a(REF.lastRevenue, "١٢٠٠٠٠"),
    a(REF.goal90, "1500000.50"),
    a(REF.goal12, "3000000"),
    a(REF.marketing, "An early answer the client changed."),
    a(REF.challenges, "Referrals dried up\r\nFlyers did nothing"),
    a(REF.whyJoined, "  To grow  "),
    a(REF.additional, "Weekends  are  busy."),
    a(REF.marketing, "Referrals, flyers and a small Google Ads test."),
    a(REF.hours, "Sat to Thu 9 to 5"),
  ],
  [CARD_C]: [
    a(REF.email, CONTACT.email),
    a(REF.lastRevenue, "0"),
    a(REF.goal90, "80000"),
    a(REF.goal12, "500000"),
    a(REF.marketing, "إعلانات إنستغرام والتوصيات"),
    a(REF.challenges, "جودة العملاء\nبطء الردود"),
    a(REF.whyJoined, "نبي نكبر"),
    a(REF.additional, "لا شيء"),
  ],
};

/**
 * Make 13 [29]'s Client Profile, built here on its own (the second source): each answer as Typeform hands it to Make
 * (CR to LF, trimmed as JavaScript trims), a ref answered twice giving its last answer, the three revenues as Typeform
 * hands a number (Arabic-Indic digits read, no trailing zeros, 0 blank), and the seven labels in order.
 */
function makeProfile(answers: Answer[]): string {
  const by: Record<string, string> = {};
  for (const x of answers) by[x.ref] = x.value.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  const num = (v: string | undefined) => {
    if (!v) return "";
    const d = v
      .trim()
      .replace(/[٠-٩]/g, c => String(c.charCodeAt(0) - 0x0660))
      .replace(/[۰-۹]/g, c => String(c.charCodeAt(0) - 0x06f0));
    const m = d.match(/^(-?)([0-9]+)(?:\.([0-9]+))?$/);
    if (!m) return v;
    const int = m[2].replace(/^0+(?=\d)/, "");
    const frac = (m[3] ?? "").replace(/0+$/, "");
    const out = `${m[1]}${int}${frac ? `.${frac}` : ""}`;
    return out === "0" ? "" : out;
  };
  return [
    `Last Year's Total Revenue: ${num(by[REF.lastRevenue])}`,
    `90-Day Goal Revenue: ${num(by[REF.goal90])}`,
    `12-24 Month Revenue Goal: ${num(by[REF.goal12])}`,
    `Marketing they've tried A-Z: ${by[REF.marketing] ?? ""}`,
    `Top 3 challenges: ${by[REF.challenges] ?? ""}`,
    `Why they joined: ${by[REF.whyJoined] ?? ""}`,
    `Additional notes: ${by[REF.additional] ?? ""}`,
  ].join("\n\n");
}

let db: PGlite;
let firstApplyMd5 = "";
let seq = 0;
const uid = () => `40000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`;

// --- Sessions ---------------------------------------------------------------------------------

async function asOwner() {
  await db.exec("RESET ROLE");
  await db.query("SELECT set_config('request.jwt.claim.sub','',false)");
  await db.query("SELECT set_config('request.jwt.claims','',false)");
}
let depth = 0;
/** Inside rolledBack each step runs under a savepoint, so an expected refusal leaves the transaction usable. */
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
/** One value as anon, an authenticated seat, or PostgREST with the service key. */
async function as<T = any>(who: "anon" | "authenticated" | "service", text: string, params: unknown[] = []): Promise<T> {
  return guarded(async () => {
    await asOwner();
    if (who === "service") {
      await db.query("SELECT set_config('request.jwt.claims',$1,false)", [json({ role: "service_role" })]);
      await db.exec("SET ROLE service_role");
    } else {
      await db.query("SELECT set_config('request.jwt.claims',$1,false)", [json({ role: who })]);
      await db.exec(`SET ROLE ${who}`);
    }
    return (await db.query<{ r: T }>(text, params)).rows[0]?.r as T;
  });
}
async function refusal(fn: () => Promise<unknown>): Promise<{ code: string; message: string }> {
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

// --- The calls --------------------------------------------------------------------------------

const backfill = (mode: string | null, cards: unknown, actor: string | null = "CEO-2 approved (test); D-PB") =>
  as<Row>("service", "SELECT public.cockpit_form_profile_backfill($1, $2::text[], $3) AS r", [mode, cards, actor]);
const gate = (delivery: string, ref: string) =>
  one<Row>("SELECT public.cockpit_form_effect_gate($1, $2) AS r", [delivery, ref]);
const fnMd5 = (sig: string) =>
  one<string>(
    "SELECT md5(regexp_replace(p.prosrc, '\\s+', ' ', 'g')) AS r FROM pg_proc p WHERE p.oid = to_regprocedure($1)",
    [`public.${sig}`],
  );
const acl = (sig: string) =>
  one<string>("SELECT p.proacl::text AS r FROM pg_proc p WHERE p.oid = to_regprocedure($1)", [`public.${sig}`]);
const effectsOf = (card: string) =>
  q(
    `SELECT e.* FROM public.cockpit_form_effects e JOIN public.cockpit_form_responses r ON r.id = e.response_id
      WHERE r.task_id = $1 ORDER BY e.created_at, e.id`,
    [card],
  );
const queueOf = (card: string) =>
  q("SELECT * FROM public.cockpit_clickup_writeback_queue WHERE task_id = $1 ORDER BY created_at, id", [card]);
/** Every table's row count, so a dry run can be shown to write nothing anywhere. */
async function everyCount(): Promise<Record<string, number>> {
  const tables = await q<{ s: string; t: string }>(
    "SELECT table_schema AS s, table_name AS t FROM information_schema.tables WHERE table_schema IN ('public','auth') AND table_type = 'BASE TABLE' ORDER BY 1, 2",
  );
  const out: Record<string, number> = {};
  for (const { s, t } of tables)
    out[`${s}.${t}`] = Number((await q<{ n: number }>(`SELECT count(*)::int AS n FROM "${s}"."${t}"`))[0].n);
  return out;
}

// --- The ground -------------------------------------------------------------------------------

function cut(sql: string, pattern: RegExp, what: string): string {
  const hit = sql.match(pattern);
  if (!hit) throw new Error(`Canonical definition missing: ${what}`);
  return hit[0];
}
/** A function's last CREATE in a file, whatever its dollar tag. */
function fnDef(file: string, name: string): string {
  const sql = migration(file);
  const head = `CREATE OR REPLACE FUNCTION public.${name}(`;
  const start = sql.lastIndexOf(head);
  if (start < 0) throw new Error(`Canonical definition missing: ${file} ${name}`);
  const tag = sql.slice(start).match(/AS\s+(\$[A-Za-z_]*\$)/);
  if (!tag || tag.index === undefined) throw new Error(`No body: ${file} ${name}`);
  const bodyAt = start + tag.index + tag[0].length;
  const close = sql.indexOf(tag[1], bodyAt);
  const semi = sql.indexOf(";", close + tag[1].length);
  return sql.slice(start, semi + 1);
}

async function ground() {
  // The sync state (the writer's mode) and the client records, as their files make them.
  await db.exec(
    cut(
      migration("20260921e_tap_charges.sql"),
      /create table if not exists public\.cockpit_sync_state \([\s\S]*?\n\);/,
      "sync state",
    ),
  );
  await db.exec("ALTER TABLE public.cockpit_sync_state ADD COLUMN IF NOT EXISTS detail jsonb;");
  await db.exec(
    cut(
      migration("20261005a_client_onboarding.sql"),
      /create table if not exists public\.cockpit_client_onboarding \([\s\S]*?\n\);/,
      "client records",
    ),
  );
  // Stand-ins with the live columns the file and the gate read.
  await db.exec(`
    CREATE TABLE public.cockpit_forms (key text PRIMARY KEY, title text, audience text, provider text NOT NULL,
      typeform_id text, version integer NOT NULL DEFAULT 1, schema jsonb, seats text[], client_scoped boolean,
      effects jsonb NOT NULL DEFAULT '[]'::jsonb, updated_by text, updated_at timestamptz NOT NULL DEFAULT now(),
      provider_since timestamptz);
    CREATE TABLE public.cockpit_form_responses (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), form_key text NOT NULL, form_version integer NOT NULL,
      source text NOT NULL CHECK (source IN ('cockpit','embed','typeform_webhook','typeform_sync','public','import','portal')),
      external_id text, task_id text, client_name text,
      mode text NOT NULL CHECK (mode IN ('live','shadow')),
      state text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft','submitted','confirmed','legacy','void')),
      answers jsonb NOT NULL DEFAULT '{}'::jsonb, answer_meta jsonb NOT NULL DEFAULT '{}'::jsonb,
      hidden jsonb NOT NULL DEFAULT '{}'::jsonb, revision integer NOT NULL DEFAULT 1, created_by text NOT NULL DEFAULT 'import',
      created_by_id uuid, submitted_by text, submitted_at timestamptz, confirmed_by text, confirmed_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), invite_id uuid,
      signer text, lang text, UNIQUE (form_key, external_id));
    CREATE TABLE public.cockpit_client_messages (id uuid PRIMARY KEY, kind text NOT NULL);`);
  // The effects table (20261027f) with the CHECKs 20261102j and 20261102o widened.
  await db.exec(
    cut(
      migration("20261027f_forms_core.sql"),
      /CREATE TABLE IF NOT EXISTS public\.cockpit_form_effects \([\s\S]*?\n\);/,
      "effects",
    ),
  );
  await db.exec(`
    ALTER TABLE public.cockpit_form_effects DROP CONSTRAINT cockpit_form_effects_delivery_check;
    ALTER TABLE public.cockpit_form_effects ADD CONSTRAINT cockpit_form_effects_delivery_check
      CHECK (delivery IN ('clickup_queue','slack_notice','client_message','creative_outbox','sql','relay'));
    ALTER TABLE public.cockpit_form_effects DROP CONSTRAINT cockpit_form_effects_plan_check;
    ALTER TABLE public.cockpit_form_effects ADD CONSTRAINT cockpit_form_effects_plan_check
      CHECK (jsonb_typeof(plan) = 'object' AND octet_length(plan::text) <=
             CASE WHEN form_key IN ('kickoff','onboarding') THEN 2097152 ELSE 131072 END);`);
  // The writeback queue (20261009f) with the live kinds.
  await db.exec(
    cut(
      migration("20261009f_clickup_writeback_native.sql"),
      /CREATE TABLE IF NOT EXISTS public\.cockpit_clickup_writeback_queue\([\s\S]*?\n\);/,
      "queue",
    ),
  );
  await db.exec(`
    ALTER TABLE public.cockpit_clickup_writeback_queue DROP CONSTRAINT cockpit_clickup_writeback_queue_kind_check;
    ALTER TABLE public.cockpit_clickup_writeback_queue ADD CONSTRAINT cockpit_clickup_writeback_queue_kind_check
      CHECK (kind IN ('decision','manual_change','provider_action','tracking_backlog','billing','request','task_action','form'));`);
  // The live bodies.
  for (const [sig, { file }] of Object.entries(LIVE)) await db.exec(fnDef(file, sig.slice(0, sig.indexOf("("))));
  // 20261102j's gate under another name: the matrix compares this file's gate with it.
  await db.exec(
    fnDef("20261102j_stage4_native.sql", "cockpit_form_effect_gate").replace(
      "FUNCTION public.cockpit_form_effect_gate(",
      "FUNCTION public.cockpit_form_effect_gate_j(",
    ),
  );
  await db.exec(`
    CREATE TRIGGER cockpit_form_effects_guard BEFORE INSERT OR UPDATE ON public.cockpit_form_effects
      FOR EACH ROW EXECUTE FUNCTION public.cockpit_form_effects_guard();
    CREATE TRIGGER cockpit_form_effects_audit AFTER INSERT OR UPDATE OF state ON public.cockpit_form_effects
      FOR EACH ROW EXECUTE FUNCTION public.cockpit_forms_audit();
    CREATE TRIGGER cockpit_clickup_writeback_queue_audit_insert AFTER INSERT ON public.cockpit_clickup_writeback_queue
      FOR EACH ROW EXECUTE FUNCTION public.cockpit_clickup_writeback_audit();
    CREATE TRIGGER cockpit_clickup_writeback_queue_audit_state AFTER UPDATE OF state ON public.cockpit_clickup_writeback_queue
      FOR EACH ROW WHEN (OLD.state IS DISTINCT FROM NEW.state AND NEW.state <> 'sending')
      EXECUTE FUNCTION public.cockpit_clickup_writeback_audit();
    CREATE TRIGGER cockpit_form_effects_from_queue AFTER UPDATE OF state ON public.cockpit_clickup_writeback_queue
      FOR EACH ROW WHEN (OLD.state IS DISTINCT FROM NEW.state AND NEW.kind = 'form')
      EXECUTE FUNCTION public.cockpit_form_effects_from_queue();`);
  // Row security and privileges as live: the tables are the service role's; the functions the owner's, the claim also
  // the service role's.
  await db.exec(`
    ALTER TABLE public.cockpit_form_effects ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.cockpit_form_responses ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.cockpit_clickup_writeback_queue ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.cockpit_client_onboarding ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON public.cockpit_form_effects, public.cockpit_form_responses, public.cockpit_clickup_writeback_queue,
      public.cockpit_client_onboarding, public.cockpit_forms, public.cockpit_client_messages, public.cockpit_sync_state
      FROM PUBLIC, anon, authenticated, service_role;
    GRANT SELECT, INSERT, UPDATE ON public.cockpit_clickup_writeback_queue, public.cockpit_sync_state TO service_role;
    GRANT SELECT ON public.cockpit_form_effects, public.cockpit_form_responses, public.cockpit_client_onboarding TO service_role;`);
  for (const sig of [...Object.keys(LIVE), "cockpit_form_effect_gate_j(text,text)"])
    await db.exec(`REVOKE ALL ON FUNCTION public.${sig} FROM PUBLIC, anon, authenticated, service_role;`);
  await db.exec(
    "GRANT EXECUTE ON FUNCTION public.cockpit_clickup_writeback_claim_forms(uuid,integer) TO service_role;",
  );
  // The registry: both Stage 4 forms and the sale on Typeform (no native window), the 1-1 notes native.
  await db.exec(`
    INSERT INTO public.cockpit_forms(key, provider, version, effects, provider_since) VALUES
      ('onboarding', 'typeform', 1, '[{"key":"profile_fields","owner":"make"}]', NULL),
      ('kickoff', 'typeform', 1, '[{"key":"card_facts","owner":"make"}]', NULL),
      ('new_client', 'typeform', 1, '[]', NULL),
      ('checkin', 'native', 1,
       '[{"key":"todo_comment","owner":"cockpit"},{"key":"profile_backfill","owner":"cockpit"},{"key":"sale_facts","owner":"cockpit"},{"key":"card_facts","owner":"cockpit"}]',
       '2026-01-01T00:00:00Z');`);
}

/** One card's client record and its stored Typeform answer. */
async function seedCard(
  card: string,
  answers: Answer[],
  opts: {
    inOnboarding?: boolean;
    profile?: string;
    formId?: string;
    response?: "match" | "none" | "shadow" | "other";
    status?: string;
  } = {},
) {
  const token = `tok${card}`;
  await q(
    `INSERT INTO public.cockpit_client_onboarding(clickup_task_id, client_name, client_status, in_onboarding, handover, forms)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb)`,
    [
      card,
      `Invented ${card}`,
      opts.status ?? "GHOSTED",
      opts.inOnboarding ?? true,
      json(opts.profile === undefined ? { closer: "Sales" } : { client_profile: opts.profile }),
      json({
        onboarding: { form_id: opts.formId ?? "KFRCXPFx", response_id: token, submitted_at: "2026-06-29T08:00:00Z", answers },
      }),
    ],
  );
  const response = opts.response ?? "match";
  if (response === "none") return;
  const stored = response === "other" ? [...answers, a(REF.hours, "A later edit")] : answers;
  await q(
    `INSERT INTO public.cockpit_form_responses(id, form_key, form_version, source, external_id, task_id, mode, state, answers, submitted_at)
     VALUES ($1, 'onboarding', 1, 'typeform_sync', $2, $3, $4, 'submitted', $5::jsonb, '2026-06-29T08:00:00Z')`,
    [uid(), token, card, response === "shadow" ? "shadow" : "live", json({ fields: stored })],
  );
}

beforeAll(async () => {
  db = await cockpitTestDb({ supabaseDefaultPrivileges: true });
  await ground();
  await db.exec(migration(C));
  firstApplyMd5 = await fnMd5("cockpit_form_effect_gate(text,text)");
  await db.exec(migration(C));
  // The cards.
  for (const card of [CARD_A, CARD_B, CARD_C]) await seedCard(card, ANSWERS[card]);
  await seedCard(SKIP.launched, ANSWERS[CARD_A], { inOnboarding: false, status: "Active" });
  await seedCard(SKIP.hasProfile, ANSWERS[CARD_A], { profile: "A profile a person wrote." });
  await ex(
    `INSERT INTO public.cockpit_client_onboarding(clickup_task_id, client_name, in_onboarding, forms)
     VALUES ('${SKIP.noAnswer}', 'Invented no answer', true, '{}'::jsonb)`,
  );
  await seedCard(SKIP.portal, ANSWERS[CARD_A], { formId: "native" });
  await seedCard(SKIP.noResponse, ANSWERS[CARD_A], { response: "none" });
  await seedCard(SKIP.shadow, ANSWERS[CARD_A], { response: "shadow" });
  await seedCard(SKIP.disagree, ANSWERS[CARD_A], { response: "other" });
  await seedCard(SKIP.openNative, ANSWERS[CARD_A]);
  // A native onboarding answer on that card whose Client Profile step is still open.
  const native = uid();
  await q(
    `INSERT INTO public.cockpit_form_responses(id, form_key, form_version, source, external_id, task_id, mode, state, answers, submitted_at)
     VALUES ($1::uuid, 'onboarding', 2, 'portal', $3, $2, 'live', 'submitted', '{}'::jsonb, now())`,
    [native, SKIP.openNative, native],
  );
  await q(
    `INSERT INTO public.cockpit_form_effects(response_id, form_key, effect_key, dedupe_key, owner, delivery, plan, state)
     VALUES ($1::uuid, 'onboarding', 'profile_fields', $2 || ':profile_fields', 'cockpit', 'clickup_queue', '{}'::jsonb, 'planned')`,
    [native, native],
  );
  await seedCard(SKIP.noProfileAnswers, [a(REF.businessName, "Only a name"), a(REF.hours, "Sun to Thu")]);
  await seedCard(SKIP.badShape, [a(REF.lastRevenue, "about\n100"), a(REF.whyJoined, "To grow")]);
}, 300_000);
afterAll(async () => {
  await db?.close();
});

// --- Tests ------------------------------------------------------------------------------------

describe("the ground and the file", () => {
  test("every body the file replaces, calls or stands on is the live one (md5 read live 2026-11-03)", async () => {
    const seen: Record<string, string> = {};
    for (const sig of Object.keys(LIVE))
      seen[sig] = sig === "cockpit_form_effect_gate(text,text)" ? md5Of(LIVE[sig].file, sig) : await fnMd5(sig);
    expect(seen).toEqual(Object.fromEntries(Object.entries(LIVE).map(([k, v]) => [k, v.md5])));
    expect(await fnMd5("cockpit_form_effect_gate_j(text,text)")).toBe(LIVE["cockpit_form_effect_gate(text,text)"].md5);
  });

  test("the tables the file writes have the live CHECKs and triggers", async () => {
    const cons = async (table: string) =>
      Object.fromEntries(
        (
          await q<{ n: string; d: string }>(
            "SELECT conname AS n, pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conrelid = $1::regclass",
            [`public.${table}`],
          )
        ).map(r => [r.n, r.d.replace(/\s+/g, " ")]),
      );
    expect(await cons("cockpit_form_effects")).toEqual(LIVE_EFFECT_CHECKS);
    expect(await cons("cockpit_clickup_writeback_queue")).toEqual(LIVE_QUEUE_CHECKS);
    const triggers = (
      await q<{ d: string }>(
        `SELECT pg_get_triggerdef(t.oid) AS d FROM pg_trigger t
          WHERE NOT t.tgisinternal AND t.tgrelid IN ('public.cockpit_form_effects'::regclass, 'public.cockpit_clickup_writeback_queue'::regclass)
          ORDER BY 1`,
      )
    ).map(r => r.d);
    expect(triggers).toEqual([...LIVE_TRIGGERS].sort());
  });

  test("the gate is j's body byte for byte plus exactly the two keyed branches, and its after md5", async () => {
    expect(firstApplyMd5).toBe(GATE_AFTER);
    expect(await fnMd5("cockpit_form_effect_gate(text,text)")).toBe(GATE_AFTER);
    const j = fnDef("20261102j_stage4_native.sql", "cockpit_form_effect_gate");
    const c = fnDef(C, "cockpit_form_effect_gate");
    const anchor = "      v_pass := v_pick;\n    END IF;\n  END LOOP;\n";
    const at = c.indexOf("    -- The next-design plan, B2 (20261103c)");
    expect(at).toBeGreaterThan(0);
    const end = c.indexOf("  END LOOP;\n", at);
    // Remove the added block: what is left is j's text exactly.
    expect(c.slice(0, at) + c.slice(end)).toBe(j);
    const added = c.slice(at, end);
    expect(added.match(/IF /g)?.length).toBe(1);
    expect(added).toContain("p_delivery = 'clickup_queue' AND e.state IN ('queued','unknown') AND e.owner = 'cockpit'");
    expect(added).toContain("(e.form_key = 'onboarding' AND e.effect_key = 'profile_backfill')");
    expect(added).toContain("(e.form_key = 'new_client' AND e.effect_key = 'sale_facts')");
    expect(j).toContain(anchor);
  });

  test("a second apply changes nothing; the drift guard stops on any other gate", async () => {
    await rolledBack(async () => {
      await ex(migration(C).replace(/^BEGIN;$/m, "").replace(/^COMMIT;$/m, ""));
      expect(await fnMd5("cockpit_form_effect_gate(text,text)")).toBe(GATE_AFTER);
      await ex(
        "CREATE OR REPLACE FUNCTION public.cockpit_form_effect_gate(p_delivery text, p_ref text) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$",
      );
      const r = await refusal(() => ex(migration(C).replace(/^BEGIN;$/m, "").replace(/^COMMIT;$/m, "")));
      expect(r).toEqual({ code: "55000", message: "cockpit_form_effect_gate(text,text) changed since 20261102j; stop and re-read it." });
    });
  });

  test("it stops unless 20261102o's texts and the claim are the bodies it stands on", async () => {
    const again = () => ex(migration(C).replace(/^BEGIN;$/m, "").replace(/^COMMIT;$/m, ""));
    await rolledBack(async () => {
      await ex(
        "CREATE OR REPLACE FUNCTION public.cockpit_form_stage4_profile_text(p_by_ref jsonb) RETURNS text LANGUAGE sql AS $$ SELECT 'x' $$",
      );
      expect(await refusal(again)).toEqual({
        code: "55000",
        message:
          "cockpit_form_stage4_profile_text(jsonb) changed since 20261102o (this file stands on it); stop and re-read it.",
      });
    });
    await rolledBack(async () => {
      await ex("DROP FUNCTION public.cockpit_form_typeform_text(text) CASCADE");
      expect(await refusal(again)).toEqual({
        code: "55000",
        message: "Apply 20261102o before this file (cockpit_form_typeform_text(text) is missing).",
      });
    });
    await rolledBack(async () => {
      await ex(
        "CREATE OR REPLACE FUNCTION public.cockpit_clickup_writeback_claim_forms(p_token uuid, p_limit integer DEFAULT 8) RETURNS jsonb LANGUAGE sql AS $$ SELECT '[]'::jsonb $$",
      );
      expect(await refusal(again)).toEqual({
        code: "55000",
        message:
          "cockpit_clickup_writeback_claim_forms(uuid,integer) changed since 20261029t (this file stands on it); stop and re-read it.",
      });
    });
  });

  test("grants: the gate is the owner's only; the backfill the service role's only", async () => {
    expect(await acl("cockpit_form_effect_gate(text,text)")).toBe("{postgres=X/postgres}");
    expect(await acl("cockpit_form_profile_backfill(text,text[],text)")).toBe(
      "{postgres=X/postgres,service_role=X/postgres}",
    );
    for (const who of ["anon", "authenticated"] as const) {
      const r = await refusal(() =>
        as(who, "SELECT public.cockpit_form_profile_backfill('dry_run', ARRAY['taskBfA1'], NULL) AS r"),
      );
      expect(r.code).toBe("42501");
      const g = await refusal(() => as(who, "SELECT public.cockpit_form_effect_gate('clickup_queue', 'x') AS r"));
      expect(g.code).toBe("42501");
    }
    const g = await refusal(() => as("service", "SELECT public.cockpit_form_effect_gate('clickup_queue', 'x') AS r"));
    expect(g.code).toBe("42501");
    // The owner with no service claim is refused too (cockpit_hours_require_service): the deploy session says it.
    const owner = await refusal(() =>
      q("SELECT public.cockpit_form_profile_backfill('dry_run', ARRAY['taskBfA1'], NULL) AS r"),
    );
    expect(owner).toEqual({ code: "42501", message: "This hours function needs the service role" });
    // The RUNBOOK's call: the claim set first, in the same statement.
    const r = await one<Row>(
      `WITH s AS MATERIALIZED (SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true))
       SELECT public.cockpit_form_profile_backfill('dry_run', ARRAY['${CARD_A}'], NULL) AS r FROM s`,
    );
    expect(r.counts.would_queue).toBe(1);
  });
});

describe("refusals", () => {
  test("the mode, the cards and who approved it", async () => {
    const say = async (mode: string | null, cards: unknown, actor: string | null = "CEO-2 (test)") =>
      refusal(() => backfill(mode, cards, actor));
    const mode = { code: "22023", message: "Say dry_run, apply or cancel." };
    expect(await say(null, [CARD_A])).toEqual(mode);
    expect(await say("all", [CARD_A])).toEqual(mode);
    expect(await say("APPLY", [CARD_A])).toEqual(mode);
    const cards = { code: "22023", message: "Name the cards: 1 to 10 different ClickUp ids." };
    expect(await say("dry_run", null)).toEqual(cards);
    expect(await say("dry_run", [])).toEqual(cards);
    expect(await say("dry_run", Array.from({ length: 11 }, (_, i) => `taskX${i}`))).toEqual(cards);
    expect(await say("dry_run", ["taskBfA1", "bad id"])).toEqual(cards);
    expect(await say("dry_run", ["taskBfA1;drop"])).toEqual(cards);
    expect(await say("dry_run", [CARD_A, CARD_A])).toEqual(cards);
    expect(await say("dry_run", [CARD_A, null])).toEqual(cards);
    const actor = { code: "22023", message: "Say who approved this." };
    expect(await say("apply", [CARD_A], null)).toEqual(actor);
    expect(await say("apply", [CARD_A], "   ")).toEqual(actor);
    expect(await say("cancel", [CARD_A], "")).toEqual(actor);
    expect(await say("apply", [CARD_A], "x".repeat(201))).toEqual(actor);
    // A dry run needs no actor.
    expect((await backfill("dry_run", [CARD_A], null)).counts.would_queue).toBe(1);
  });
});

describe("dry run", () => {
  test("writes no row in any table and names each card's outcome, never the text", async () => {
    const before = await everyCount();
    const all = [CARD_A, CARD_B, CARD_C, ...Object.values(SKIP)].slice(0, 10);
    const r = await backfill("dry_run", all, null);
    expect(await everyCount()).toEqual(before);
    expect(r.mode).toBe("dry_run");
    const byCard = Object.fromEntries((r.cards as Row[]).map(c => [c.taskId, c]));
    for (const card of [CARD_A, CARD_B, CARD_C]) {
      const text = makeProfile(ANSWERS[card]);
      expect(byCard[card]).toMatchObject({
        state: "would_queue",
        reason: null,
        sentOn: "2026-06-29",
        chars: [...text].length,
        sha256: sha256(text).slice(0, 12),
      });
      expect(byCard[card].responseId).toMatch(/^[0-9a-f-]{36}$/);
      expect(byCard[card]).not.toHaveProperty("effectId");
    }
    expect(byCard[CARD_A].answered).toBe(6);
    expect(byCard[CARD_B].answered).toBe(7);
    expect(byCard[CARD_C].answered).toBe(6); // a revenue of 0 prints blank, as Make prints it
    // No answer, no contact value and no label reaches the result.
    const out = json(r);
    for (const card of [CARD_A, CARD_B, CARD_C])
      for (const x of worded(ANSWERS[card])) expect(out).not.toContain(x);
    expect(out).not.toContain("Last Year's Total Revenue");
    expect(r.counts).toEqual({ would_queue: 3, queued: 0, cancelled: 0, not_cancelled: 0, skip: 7 });
  });

  test("each skip reason", async () => {
    const r = await backfill("dry_run", [...Object.values(SKIP)].slice(0, 10), null);
    const r2 = await backfill("dry_run", [SKIP.badShape], null);
    const reasons = Object.fromEntries([...(r.cards as Row[]), ...(r2.cards as Row[])].map(c => [c.taskId, c.reason]));
    expect(reasons).toEqual({
      [SKIP.noRecord]: "Skipped: this card is not in the client records.",
      [SKIP.launched]: "Skipped: this client is not in onboarding.",
      [SKIP.hasProfile]: "Skipped: the card already has a Client Profile.",
      [SKIP.noAnswer]: "Skipped: no stored onboarding answer for this card.",
      [SKIP.portal]:
        "Skipped: this client answered the onboarding in the portal, so its own Client Profile step fills the card.",
      [SKIP.noResponse]: "Skipped: the stored answer is not in the forms records. Tell the tech lead.",
      [SKIP.shadow]: "Skipped: the stored answer is not in the forms records. Tell the tech lead.",
      [SKIP.disagree]:
        "Skipped: the stored answer and the client record disagree, so nothing was queued. Tell the tech lead.",
      [SKIP.openNative]: "Skipped: the native onboarding is writing this card's Client Profile now.",
      [SKIP.noProfileAnswers]:
        "Skipped: the stored answer has none of the seven Client Profile answers, so there is nothing to write.",
      [SKIP.badShape]:
        "Skipped: the Client Profile built from this answer does not have Make's seven labels, so nothing was queued. Tell the tech lead.",
    });
    for (const c of [...(r.cards as Row[]), ...(r2.cards as Row[])]) {
      expect(c.state).toBe("skip");
      // Missing is never zero: a skipped card has no length and no fingerprint.
      expect(c.chars).toBeNull();
      expect(c.sha256).toBeNull();
    }
    // The bad shape is the one B1's writer would refuse as a mismatch (a failed row cannot be queued again).
    const bad = makeProfile([a(REF.lastRevenue, "about\n100"), a(REF.whyJoined, "To grow")]);
    expect(PROFILE_LABELS.test(bad)).toBe(false);
  });
});

describe("apply", () => {
  test("one effect and one queue row per card under B1's contract; the writer's own check takes the claimed row", async () => {
    await rolledBack(async () => {
      const before = await q("SELECT id FROM public.cockpit_audit_log");
      const r = await backfill("apply", [CARD_A, CARD_B, CARD_C, SKIP.launched], "CEO-2 approved (test); D-PB");
      expect(r.counts).toEqual({ would_queue: 0, queued: 3, cancelled: 0, not_cancelled: 0, skip: 1 });
      for (const card of [CARD_A, CARD_B, CARD_C]) {
        const text = makeProfile(ANSWERS[card]);
        const row = (r.cards as Row[]).find(c => c.taskId === card) as Row;
        expect(row).toMatchObject({ state: "queued", reason: null, sha256: sha256(text).slice(0, 12) });
        const [e] = await effectsOf(card);
        const [qr] = await queueOf(card);
        expect(row.effectId).toBe(e.id);
        expect(row.queueId).toBe(qr.id);
        // The effect.
        expect(e).toMatchObject({
          form_key: "onboarding",
          effect_key: "profile_backfill",
          dedupe_key: `${e.response_id}:profile_backfill`,
          owner: "cockpit",
          delivery: "clickup_queue",
          delivery_ref: qr.id,
          receipt: { queueId: qr.id },
          state: "queued",
          reason: null,
        });
        expect(e.plan).toEqual({
          taskId: card,
          fields: [{ fieldId: FIELD, kind: "text", label: "Client Profile", value: text, onlyIfEmpty: true }],
          lines: [
            `Client Profile from the stored onboarding answer (${[...text].length} characters)`,
            "Only where the card's Client Profile is empty",
          ],
        });
        expect(PROFILE_LABELS.test(e.plan.fields[0].value)).toBe(true);
        expect(Object.keys(PROFILE_BACKFILL)).toEqual([e.plan.fields[0].fieldId]);
        expect(CLIENT_PROFILE_FIELD).toBe(FIELD);
        // The queue row: B1's payload, exactly its keys, no text.
        expect(qr).toMatchObject({
          dedupe_key: `profile_backfill:${card}`,
          kind: "form",
          source_table: "cockpit_form_effects",
          source_id: e.id,
          task_id: card,
          state: "queued",
          attempts: 0,
        });
        expect(qr.payload).toEqual({
          formKey: "onboarding",
          effectKey: "profile_backfill",
          effectId: e.id,
          responseId: e.response_id,
          taskId: card,
          valueChars: [...text].length,
          valueSha256: sha256(text),
        });
        expect(qr.payload.valueSha256).toMatch(/^[0-9a-f]{64}$/);
      }
      // The gate passes each row, and the claim hands it to the writer with its plan (no lines).
      await ex(`INSERT INTO public.cockpit_sync_state(key, last_run_at, ok, detail)
        VALUES ('clickup-writeback:forms', now(), true, jsonb_build_object('mode','apply','at',now(),'onlyCards','[]'::jsonb))
        ON CONFLICT (key) DO UPDATE SET last_run_at = now(), detail = excluded.detail`);
      const claimed = await as<Row[]>(
        "service",
        "SELECT public.cockpit_clickup_writeback_claim_forms('50000000-0000-4000-8000-000000000001', 8) AS r",
      );
      expect(claimed.map(c => c.task_id).sort()).toEqual([CARD_A, CARD_B, CARD_C]);
      for (const item of claimed) {
        expect(item.state).toBe("sending");
        expect(item.effect.plan).not.toHaveProperty("lines");
        const step = await formStep(item as any);
        expect(step).toEqual({
          step: {
            key: "profile_backfill",
            type: "facts",
            taskId: item.task_id,
            fields: [{ fieldId: FIELD, kind: "text", label: "Client Profile", value: makeProfile(ANSWERS[item.task_id]) }],
          },
        });
        // A plan changed after the queue (its fingerprint no longer matches) is refused before any call.
        const tampered = structuredClone(item);
        tampered.effect.plan.fields[0].value = `${tampered.effect.plan.fields[0].value} `;
        expect(await formStep(tampered as any)).toHaveProperty("fail");
      }
      // The audit: the effects' and queue rows' own triggers, and one summary row; none holds the text.
      const rows = await q(
        "SELECT action, entity_type, actor_email, before, after, metadata FROM public.cockpit_audit_log WHERE id <> ALL($1::uuid[]) ORDER BY created_at",
        [before.map(b => b.id)],
      );
      const actions = rows.map(x => x.action);
      expect(actions.filter(x => x === "forms.profile_backfill_queued").length).toBe(6); // insert and queued, per card
      expect(actions.filter(x => x === "insert:queued").length).toBe(3);
      const summary = rows.filter(x => x.action === "forms.profile_backfill_apply");
      expect(summary.length).toBe(1);
      expect(summary[0].actor_email).toBe("CEO-2 approved (test); D-PB");
      expect(summary[0].metadata.counts).toEqual({ would_queue: 0, queued: 3, cancelled: 0, not_cancelled: 0, skip: 1 });
      expect(summary[0].metadata.cards).toEqual([CARD_A, CARD_B, CARD_C, SKIP.launched]);
      for (const x of rows.filter(y => y.action === "forms.profile_backfill_queued"))
        expect(x.actor_email).toBe("CEO-2 approved (test); D-PB");
      const audit = json(rows);
      expect(audit).not.toContain("Last Year");
      expect(audit).not.toContain("Additional notes");
      for (const card of [CARD_A, CARD_B, CARD_C]) for (const x of worded(ANSWERS[card])) expect(audit).not.toContain(x);
      for (const v of Object.values(CONTACT)) expect(audit).not.toContain(v);
    });
  });

  test("a second apply queues nothing (idempotent), and two cards in one call are one transaction each", async () => {
    await rolledBack(async () => {
      await backfill("apply", [CARD_A], "CEO-2 (test)");
      const effects = (await q("SELECT count(*)::int AS n FROM public.cockpit_form_effects"))[0].n;
      const queue = (await q("SELECT count(*)::int AS n FROM public.cockpit_clickup_writeback_queue"))[0].n;
      const again = await backfill("apply", [CARD_A, CARD_B], "CEO-2 (test)");
      expect((again.cards as Row[]).map(c => [c.taskId, c.state, c.reason])).toEqual([
        [CARD_A, "skip", "Skipped: already queued once for this card."],
        [CARD_B, "queued", null],
      ]);
      expect((await q("SELECT count(*)::int AS n FROM public.cockpit_form_effects"))[0].n).toBe(effects + 1);
      expect((await q("SELECT count(*)::int AS n FROM public.cockpit_clickup_writeback_queue"))[0].n).toBe(queue + 1);
      // The dry run says the same.
      const dry = await backfill("dry_run", [CARD_A], null);
      expect(dry.cards[0].reason).toBe("Skipped: already queued once for this card.");
      // Still once after the writer settled it, whatever its end.
      await ex(
        `UPDATE public.cockpit_clickup_writeback_queue SET state = 'delivered', progress = '{"steps":{"profile_backfill":{"state":"done"}}}'::jsonb WHERE dedupe_key = 'profile_backfill:${CARD_A}'`,
      );
      const [e] = await effectsOf(CARD_A);
      expect(e.state).toBe("delivered");
      expect(e.receipt.step).toEqual({ state: "done" });
      expect((await backfill("apply", [CARD_A], "CEO-2 (test)")).cards[0].reason).toBe(
        "Skipped: already queued once for this card.",
      );
    });
  });

  test("a card whose queue row already exists (another path) is skipped, and one card's error never stops the others", async () => {
    await rolledBack(async () => {
      // An error inside one card's writes (here a plan the table refuses) skips that card alone, with nothing left,
      // and the eligible card after it in the same call is still queued.
      await ex(`ALTER TABLE public.cockpit_form_effects ADD CONSTRAINT test_refuse CHECK (response_id IS NULL OR form_key <> 'onboarding' OR effect_key <> 'profile_backfill' OR plan->>'taskId' <> '${SKIP.openNative}')`);
      await ex(`UPDATE public.cockpit_form_effects SET state = 'skipped' WHERE effect_key = 'profile_fields'`);
      const r1 = await backfill("apply", [SKIP.openNative, CARD_A], "CEO-2 (test)");
      expect((r1.cards as Row[]).map(c => [c.taskId, c.state])).toEqual([
        [SKIP.openNative, "skip"],
        [CARD_A, "queued"],
      ]);
      expect(r1.cards[0].reason).toMatch(/^Skipped: new row for relation "cockpit_form_effects" violates check constraint "test_refuse"/);
      expect(r1.cards[0].effectId).toBeNull();
      expect(await queueOf(SKIP.openNative)).toEqual([]);
      expect((await effectsOf(SKIP.openNative)).map(e => e.effect_key)).toEqual(["profile_fields"]);
      expect(r1.cards[1].reason).toBeNull();
      const effectsA = await effectsOf(CARD_A);
      expect(effectsA.map(e => e.effect_key)).toEqual(["profile_backfill"]);
      expect(r1.cards[1].effectId).toBe(effectsA[0].id);
      const queueA = await queueOf(CARD_A);
      expect(queueA.map(x => x.dedupe_key)).toEqual([`profile_backfill:${CARD_A}`]);
      expect(queueA[0].payload.effectId).toBe(effectsA[0].id);
      // A queue row put there by another path skips its card, and the card after it is still queued.
      await ex(`INSERT INTO public.cockpit_clickup_writeback_queue(dedupe_key, kind, source_table, source_id, task_id, payload)
        VALUES ('profile_backfill:${CARD_B}', 'form', 'by_hand', 'x', '${CARD_B}', '{}'::jsonb)`);
      const r = await backfill("apply", [CARD_B, CARD_C], "CEO-2 (test)");
      expect((r.cards as Row[]).map(c => [c.taskId, c.state])).toEqual([
        [CARD_B, "skip"],
        [CARD_C, "queued"],
      ]);
      expect(r.cards[0].reason).toBe("Skipped: already queued once for this card.");
      expect(await effectsOf(CARD_B)).toEqual([]);
    });
  });

  test("the RUNBOOK stops until the CEO re-confirms, and its apply records that yes in the actor", async () => {
    const runbook = readFileSync(new URL("../../../RUNBOOK.md", import.meta.url), "utf8");
    const contract = readFileSync(new URL("../../../docs/forms/WAVE56-CONTRACT.md", import.meta.url), "utf8");
    const row = runbook.split("\n").find(l => l.startsWith("| The Client Profile backfill (`20261103c`"));
    expect(row).toBeDefined();
    // The question lives in the repo (no session scratchpad), word for word in the RUNBOOK and the contract.
    expect(row).not.toContain("next-design/");
    expect(contract).not.toContain("backfill.md` section 8");
    expect(contract).not.toContain("backfill.md` 8's sentence");
    const asked = row!.match(/\*\*\(2\) Stop gate: the CEO re-confirms the scope\.\*\* Ask the CEO, in these words: ("[^"]+")/);
    expect(asked).not.toBeNull();
    const question = asked![1];
    expect(question).toContain("all GHOSTED");
    expect(question).toContain("Fill the three anyway?");
    expect(question).toContain("The 6 Active clients with an empty profile stay out unless you say so.");
    expect(contract).toContain(question);
    // A stop gate, before the lane opens and before any apply.
    const stop = row!.indexOf("Go on only after the CEO answers yes to the three; otherwise stop and take nothing further");
    expect(stop).toBeGreaterThan(row!.indexOf("**(2) Stop gate"));
    expect(stop).toBeLessThan(row!.indexOf("**(3)**"));
    expect(row!.indexOf("**(3)**")).toBeLessThan(row!.indexOf("**(4)**"));
    expect(contract).toMatch(/\| D-PB \|[^\n]*\*\*stop gate:\*\* the CEO is asked the RUNBOOK row's step \(2\) question[^\n]*only after he answers yes to the three/);
    // The actor records the re-confirmation, not only the 2026-11-02 Sure.
    const actorAt = row!.match(/'apply', array\['86exnk0v4'\], '([^']+)'/);
    expect(actorAt).not.toBeNull();
    const template = actorAt![1];
    expect(template).toBe("CEO-2 approved 2026-11-02 (Sure); scope re-confirmed by the CEO on <YYYY-MM-DD>; D-PB");
    expect(row).not.toContain("'CEO-2 approved 2026-11-02 (Sure); D-PB'");
    expect(contract).not.toContain("`CEO-2 approved 2026-11-02 (Sure); D-PB`");
    // Filled with the date of the yes, the function takes it and the audit row keeps it.
    const actor = template.replace("<YYYY-MM-DD>", "2026-11-04");
    expect(actor.length).toBeLessThanOrEqual(200);
    await rolledBack(async () => {
      const before = (await q<{ id: string }>("SELECT id FROM public.cockpit_audit_log")).map(x => x.id);
      const r = await backfill("apply", [CARD_A], actor);
      expect(r.cards[0].state).toBe("queued");
      const summary = await q(
        "SELECT actor_email FROM public.cockpit_audit_log WHERE id <> ALL($1::uuid[]) AND action = 'forms.profile_backfill_apply'",
        [before],
      );
      expect(summary).toEqual([{ actor_email: actor }]);
    });
  });
});

describe("the gate and the claim", () => {
  test("the claim keeps a held backfill row in every mode; 20261102j's gate would have settled it", async () => {
    await rolledBack(async () => {
      await backfill("apply", [CARD_A], "CEO-2 (test)");
      const [qr] = await queueOf(CARD_A);
      const g = await gate("clickup_queue", qr.id);
      expect(g).toMatchObject({ ok: true, reason: null, formKey: "onboarding", effectKey: "profile_backfill", effectState: "queued" });
      for (const mode of ["dry_run", "unknown"]) {
        await ex(`INSERT INTO public.cockpit_sync_state(key, last_run_at, ok, detail)
          VALUES ('clickup-writeback:forms', now(), true, jsonb_build_object('mode','${mode}','at',now()))
          ON CONFLICT (key) DO UPDATE SET last_run_at = now(), detail = excluded.detail`);
        expect(
          await as("service", "SELECT public.cockpit_clickup_writeback_claim_forms('50000000-0000-4000-8000-000000000002') AS r"),
        ).toEqual([]);
        expect((await queueOf(CARD_A))[0].state).toBe("queued");
      }
      // An unknown effect (a write that may have landed) still passes, so the writer reads the card back.
      await ex(`UPDATE public.cockpit_clickup_writeback_queue SET state = 'unknown' WHERE id = '${qr.id}'`);
      expect((await effectsOf(CARD_A))[0].state).toBe("unknown");
      expect((await gate("clickup_queue", qr.id)).ok).toBe(true);
      // The same row under j's gate: settled as Make's, so the backfill could never be written without this file.
      expect(await one("SELECT public.cockpit_form_effect_gate_j('clickup_queue', $1) AS r", [qr.id])).toMatchObject({
        ok: false,
        reason: "Make owns this again.",
      });
      await ex(
        `CREATE OR REPLACE ${fnDef("20261102j_stage4_native.sql", "cockpit_form_effect_gate").slice("CREATE OR REPLACE ".length)}`,
      );
      await as("service", "SELECT public.cockpit_clickup_writeback_claim_forms('50000000-0000-4000-8000-000000000003') AS r");
      expect((await queueOf(CARD_A))[0]).toMatchObject({
        state: "failed",
        error: "Make owns this again. An earlier try may have reached the card, so check it in ClickUp.",
      });
    });
  });

  test("a sale's card facts (new_client, sale_facts) pass the same way (B3 plans them)", async () => {
    await rolledBack(async () => {
      const rid = uid();
      await q(
        `INSERT INTO public.cockpit_form_responses(id, form_key, form_version, source, external_id, task_id, mode, state, submitted_at)
         VALUES ($1, 'new_client', 1, 'typeform_sync', 'tokSale1', 'taskSale1', 'live', 'submitted', '2026-05-01T00:00:00Z')`,
        [rid],
      );
      const [e] = await q(
        `INSERT INTO public.cockpit_form_effects(response_id, form_key, effect_key, dedupe_key, owner, delivery, plan, state)
         VALUES ($1::uuid, 'new_client', 'sale_facts', $2 || ':sale_facts', 'cockpit', 'clickup_queue', '{"taskId":"taskSale1"}', 'planned') RETURNING id`,
        [rid, rid],
      );
      await ex(`UPDATE public.cockpit_form_effects SET state = 'queued', delivery_ref = 'sale-q1' WHERE id = '${e.id}'`);
      expect(await gate("clickup_queue", "sale-q1")).toEqual({
        ok: true,
        reason: null,
        effectId: e.id,
        responseId: rid,
        formKey: "new_client",
        effectKey: "sale_facts",
        effectState: "queued",
      });
      expect(await one("SELECT public.cockpit_form_effect_gate_j('clickup_queue', 'sale-q1') AS r")).toMatchObject({
        ok: false,
        reason: "Make owns this again.",
      });
    });
  });

  test("on every other case the gate answers exactly as 20261102j's (a 700-case matrix)", async () => {
    await rolledBack(async () => {
      await ex("ALTER TABLE public.cockpit_form_effects DISABLE TRIGGER cockpit_form_effects_guard");
      await ex("ALTER TABLE public.cockpit_form_effects DISABLE TRIGGER cockpit_form_effects_audit");
      await ex(`
        CREATE TEMP TABLE cases AS
        SELECT row_number() OVER (ORDER BY f.k, e.k, s.k, o.k, d.k, t.task) AS n, f.k AS form_key, e.k AS effect_key,
               s.k AS state, o.k AS owner, d.k AS delivery, t.task, t.ver, gen_random_uuid() AS rid
          FROM unnest(ARRAY['onboarding','new_client','kickoff','checkin']) f(k)
          CROSS JOIN unnest(ARRAY['profile_backfill','sale_facts','card_facts','todo_comment']) e(k)
          CROSS JOIN unnest(ARRAY['planned','dry_run','queued','delivered','failed','unknown','skipped']) s(k)
          CROSS JOIN unnest(ARRAY['cockpit','make','shadow']) o(k)
          CROSS JOIN unnest(ARRAY['clickup_queue','sql']) d(k)
          CROSS JOIN (VALUES ('taskGateX', 1), ('86eywg1cq', 2)) t(task, ver)
         WHERE o.k = 'cockpit' OR s.k IN ('dry_run','skipped');
        INSERT INTO public.cockpit_form_responses(id, form_key, form_version, source, external_id, task_id, mode, state, submitted_at)
        SELECT rid, form_key, ver, 'typeform_sync', 'case-' || n, task, 'live', 'submitted', '2026-06-01T00:00:00Z' FROM cases;
        INSERT INTO public.cockpit_form_effects(response_id, form_key, effect_key, dedupe_key, owner, delivery, delivery_ref, plan, state)
        SELECT rid, form_key, effect_key, rid::text || ':' || effect_key, owner, delivery, 'case-' || n, '{}'::jsonb, state FROM cases;`);
      const rows = await q(
        `SELECT n, form_key, effect_key, state, owner, delivery, task,
                public.cockpit_form_effect_gate(delivery, 'case-' || n) AS c,
                public.cockpit_form_effect_gate_j(delivery, 'case-' || n) AS j
           FROM cases ORDER BY n`,
      );
      expect(rows.length).toBe(704);
      let added = 0;
      for (const r of rows) {
        const isNew =
          r.delivery === "clickup_queue" &&
          ["queued", "unknown"].includes(r.state) &&
          r.owner === "cockpit" &&
          ((r.form_key === "onboarding" && r.effect_key === "profile_backfill") ||
            (r.form_key === "new_client" && r.effect_key === "sale_facts"));
        if (isNew && !r.j.ok) {
          added++;
          expect(r.c).toEqual({ ...r.j, ok: true, reason: null });
        } else expect(r.c).toEqual(r.j);
      }
      // 2 keys x 2 states x 2 cards, less the canary's onboarding pair, which j's canary branch already passes.
      expect(added).toBe(6);
      // A ref two effects share: the oldest open one is held as before; a backfill effect passes only on its own.
      const rid = uid();
      await q(
        `INSERT INTO public.cockpit_form_responses(id, form_key, form_version, source, external_id, task_id, mode, state, submitted_at)
         VALUES ($1, 'onboarding', 1, 'typeform_sync', 'tokShared', 'taskShared', 'live', 'submitted', '2026-06-01T00:00:00Z')`,
        [rid],
      );
      await ex(`INSERT INTO public.cockpit_form_effects(response_id, form_key, effect_key, dedupe_key, owner, delivery, delivery_ref, plan, state, created_at)
        VALUES ('${rid}', 'onboarding', 'profile_fields', '${rid}:profile_fields', 'cockpit', 'clickup_queue', 'shared-q', '{}', 'queued', now() - interval '1 hour'),
               ('${rid}', 'onboarding', 'profile_backfill', '${rid}:profile_backfill', 'cockpit', 'clickup_queue', 'shared-q', '{}', 'queued', now())`);
      const shared = await gate("clickup_queue", "shared-q");
      expect(shared).toMatchObject({ ok: true, effectKey: "profile_backfill" });
      expect(await one("SELECT public.cockpit_form_effect_gate_j('clickup_queue', 'shared-q') AS r")).toMatchObject({
        ok: false,
        effectKey: "profile_fields",
        reason: "Make owns this again.",
      });
      // No effect at all, and a message that is not a form link: as j.
      for (const [d, ref] of [
        ["clickup_queue", "nothing-here"],
        ["client_message", "60000000-0000-4000-8000-000000000001"],
      ])
        expect(await gate(d, ref)).toEqual(
          await one("SELECT public.cockpit_form_effect_gate_j($1, $2) AS r", [d, ref]),
        );
    });
  });
});

describe("cancel", () => {
  test("takes back a row the writer has not started, and leaves any other alone", async () => {
    await rolledBack(async () => {
      await backfill("apply", [CARD_A, CARD_B, CARD_C], "CEO-2 (test)");
      // B: on the retry ladder with nothing started (cancellable). C: its step started (may have reached the card).
      await ex(`UPDATE public.cockpit_clickup_writeback_queue SET state = 'retry', attempts = 1 WHERE task_id = '${CARD_B}'`);
      await ex(
        `UPDATE public.cockpit_clickup_writeback_queue SET state = 'retry', progress = '{"steps":{"profile_backfill":{"state":"started"}}}'::jsonb WHERE task_id = '${CARD_C}'`,
      );
      const before = await q("SELECT id FROM public.cockpit_audit_log");
      const r = await backfill("cancel", [CARD_A, CARD_B, CARD_C, SKIP.launched], "CEO-2 (test): stop");
      expect((r.cards as Row[]).map(c => [c.taskId, c.state, c.reason])).toEqual([
        [CARD_A, "cancelled", "Cancelled before it reached ClickUp, so nothing was written."],
        [CARD_B, "cancelled", "Cancelled before it reached ClickUp, so nothing was written."],
        [CARD_C, "not_cancelled", "Not cancelled: a write may have reached the card. Let the writer finish, then read the card."],
        [SKIP.launched, "skip", "Nothing to cancel: no Client Profile backfill was queued for this card."],
      ]);
      expect(r.counts).toEqual({ would_queue: 0, queued: 0, cancelled: 2, not_cancelled: 1, skip: 1 });
      // The audit of that call: the queue's and the effects' own rows and one summary row; no text.
      const rows = await q(
        "SELECT action, actor_email, before, after, metadata FROM public.cockpit_audit_log WHERE id <> ALL($1::uuid[]) ORDER BY created_at",
        [before.map(b => b.id)],
      );
      expect(rows.filter(x => x.action === "update:skipped").length).toBe(2);
      expect(rows.filter(x => x.action === "forms.effect_settled").length).toBe(2);
      const summary = rows.filter(x => x.action === "forms.profile_backfill_cancel");
      expect(summary.length).toBe(1);
      expect(summary[0]).toMatchObject({ actor_email: "CEO-2 (test): stop", metadata: { counts: r.counts } });
      const audit = json(rows);
      expect(audit).not.toContain("Last Year");
      for (const v of Object.values(CONTACT)) expect(audit).not.toContain(v);
      for (const card of [CARD_A, CARD_B]) {
        expect((await queueOf(card))[0]).toMatchObject({
          state: "skipped",
          error: "Cancelled before it reached ClickUp, so nothing was written.",
        });
        expect((await effectsOf(card))[0]).toMatchObject({
          state: "skipped",
          reason: "Cancelled before it reached ClickUp, so nothing was written.",
        });
      }
      expect((await queueOf(CARD_C))[0].state).toBe("retry");
      expect((await effectsOf(CARD_C))[0].state).toBe("queued");
      // A sending or unknown row is left alone; an ended one has nothing to cancel.
      await ex(`UPDATE public.cockpit_clickup_writeback_queue SET state = 'sending', claim_token = gen_random_uuid(), claimed_at = now(), progress = '{}'::jsonb WHERE task_id = '${CARD_C}'`);
      expect((await backfill("cancel", [CARD_C], "CEO-2 (test)")).cards[0].state).toBe("not_cancelled");
      await ex(`UPDATE public.cockpit_clickup_writeback_queue SET state = 'unknown', claim_token = NULL, claimed_at = NULL WHERE task_id = '${CARD_C}'`);
      expect((await backfill("cancel", [CARD_C], "CEO-2 (test)")).cards[0].state).toBe("not_cancelled");
      expect((await backfill("cancel", [CARD_A], "CEO-2 (test)")).cards[0]).toMatchObject({
        state: "skip",
        reason: "Nothing to cancel: this write already ended (skipped).",
      });
      // A cancelled card stays once: it is not queued again.
      expect((await backfill("dry_run", [CARD_A], null)).cards[0].reason).toBe("Skipped: already queued once for this card.");
    });
  });
});

/** The md5 of a function's body in a migration file, folded as the drift guards fold it. */
function md5Of(file: string, sig: string): string {
  const def = fnDef(file, sig.slice(0, sig.indexOf("(")));
  const tag = def.match(/AS\s+(\$[A-Za-z_]*\$)/);
  if (!tag || tag.index === undefined) throw new Error(`No body: ${sig}`);
  const from = tag.index + tag[0].length;
  return md5(def.slice(from, def.lastIndexOf(tag[1])).replace(/[ \t\n\r\f\v]+/g, " "));
}
