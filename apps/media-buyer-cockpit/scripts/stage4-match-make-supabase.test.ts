/**
 * Stage 4 writes what Make writes (20261102m_stage4_match_make.sql; docs/forms/WAVE56-CONTRACT.md
 * 4.13.3, 4.14.3, 4.15.1 and the D-S4F findings; the CEO's decision of 2026-11-02: "Yes, match Make").
 *
 * The functions 20261102m reads or replaces are cut from their canonical migrations (20260921a,
 * 20261025n, 20261026r, 20261029s, 20261029w, 20261102a, 20261102j, 20261102l), the way
 * stage4-content-folder-supabase.test.ts stands on what j reads, and the ground proves each replaced
 * body is the live one (20261102l's for the builder) by the md5 the file's drift guard names.
 * Stand-in tables give cockpit_form_stage4_input, cockpit_form_stage4_hidden, the planner and
 * cockpit_request_create_system the columns they read, and a stand-in cockpit_request_plan gives each
 * request part a payload (its description from the request's details, as the real one writes them).
 * 20261102l's builder and j's question list,
 * hidden values, Typeform answers list, native answers, input and parity plan are also kept under a
 * _l name, so every effect is compared with what 20261102l plans for the same input.
 *
 * Make's side is scripts/dev/make_parity.py's evaluator (python3), run on the saved blueprints and
 * Typeform definitions in scripts/dev/fixtures/make-parity: for the same answers the SQL text must
 * equal the evaluator's for the handoff (Make 12 [11]) and the comment on each onboarding task ([18],
 * [23], kept whole on the request each task's comment is posted from), Service Advertised ([21]), the
 * kickoff's hidden values (Make 13 [29]'s Kickoff Form Link), the raw answers comment (Make 13 [47]),
 * the Client Profile ([29]) and the dispatch ([25]); the Brand DNA task carries no text, as [46]
 * writes none. Two places still differ from Make, as the file says: until the request writer posts
 * taskComment, each onboarding task's description keeps 20261102l's first 4,000 characters of the
 * handoff, and the Client Profile keeps its 5,000-character cut until clickup-writeback's forms.ts
 * takes longer text. Every client, card, person and answer is invented.
 */
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  setDefaultTimeout,
  test,
} from "bun:test";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { PGlite } from "@electric-sql/pglite";
import { cockpitTestDb, migration } from "./lib/cockpitTestDb";

setDefaultTimeout(120_000);

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const J = "20261102j_stage4_native.sql";
const L = "20261102l_stage4_no_client_data_row.sql";
const M = "20261102m_stage4_match_make.sql";
const TITLES_FILE = "scripts/dev/forms-deploy/stage4-raw-titles.json";
/** onboarding.raw_titles as D-S4F fills it. */
const RAW_TITLES = JSON.parse(readFileSync(`${ROOT}${TITLES_FILE}`, "utf8"));

/** md5(whitespace folded prosrc) of the bodies 20261102m replaces, as live holds them (read 2026-11-02) and 20261102l's builder. */
const BEFORE_M = {
  "cockpit_form_stage4_fields(text)": "8c36fd1cf1b0a60b0c776241765eddf7",
  "cockpit_form_stage4_hidden(text)": "cb8d434b635091957a15c7ca96652848",
  "cockpit_form_stage4_typeform_answers(text,jsonb)":
    "97ec3ad0bb4d2282c518be1447d4f262",
  "cockpit_form_stage4_build(jsonb)": "7e5f7fdaadc74983367cd07bd8c56e3c",
  "cockpit_request_create_system(text,text,jsonb,uuid)":
    "295e926095e7832e7d7a220b4d233a23",
  "cockpit_form_stage4_plan(uuid,boolean)": "cb27a3730e539bcfbb46dea136af96ae",
} as const;
/** 20261102j's builder, live before 20261102l. */
const J_BUILD_MD5 = "a704e72a3921191d2f06a24855d7f219";
const NEW_FNS = [
  "cockpit_form_stage4_make_text(text,text)",
  "cockpit_form_stage4_handoff_text(jsonb,jsonb)",
  "cockpit_form_stage4_profile_text(jsonb)",
  "cockpit_form_stage4_raw_answers_text(jsonb,jsonb)",
] as const;
/** j's bodies 20261102m keeps (live, read 2026-11-02): they read the replaced readers by name. */
const KEPT_J = {
  "cockpit_form_stage4_input(uuid)": "a40d17418bda54193c278e63ae524fcd",
  "cockpit_form_parity_plan(text,jsonb)": "7a089ccc09d745caafba489ac23e0313",
} as const;

const TASK = "86exmm001";
const SERVICE_FIELD = "bab9a58b-15af-4b0d-8e20-b8e5a4bee2cc";
const PROFILE_FIELD = "7755485f-74a8-496c-85d8-562588e77944";
/** tG7dnxBn refs. */
const K = {
  detailsOk: "c0000001-0000-4000-8000-000000000001",
  detailsNote: "c0000001-0000-4000-8000-000000000002",
  detailsWrong: "c0000001-0000-4000-8000-000000000012",
  linksOk: "c0000001-0000-4000-8000-000000000003",
  linksWrong: "c0000001-0000-4000-8000-000000000013",
  opsOk: "c0000001-0000-4000-8000-000000000005",
  opsWrong: "c0000001-0000-4000-8000-000000000014",
  service: "c0000001-0000-4000-8000-000000000007",
  consult: "c0000001-0000-4000-8000-000000000008",
  profileOk: "c0000001-0000-4000-8000-000000000009",
  profileMissing: "c0000001-0000-4000-8000-000000000015",
  contract: "c0000001-0000-4000-8000-00000000000a",
  contractChanges: "c0000001-0000-4000-8000-00000000000b",
  inGroup: "3db082bb-1939-444b-8b32-d0067fc9878c",
  whatsappAdd: "071c480f-17f9-48db-8155-56030f952e85",
  driveDiscussed: "87c68a44-b19b-4a86-a286-0a2c8c32134e",
  whatsappStatus: "92fab954-d771-431c-9fc4-b9f15c53cbb8",
  platforms: "7d16afbb-b99a-4ee9-8718-4418cbeba534",
  maharaOs: "ad562fc2-6858-4e37-81c5-c4cc2375a330",
  contentDiscussed: "753c4cde-4d28-4719-8459-06e4db640180",
  payment: "75e97e7d-4c19-437a-b4b8-67570c29344f",
  postCall: "34310b2e-4df4-4ed5-b67e-9aefa9087d6e",
  recording: "b5578678-d0c2-475b-b66f-7ea54d55fe31",
} as const;
/** KFRCXPFx refs. */
const O = {
  fullName: "533f14a0-712f-4de9-9ac7-67e1be6bc0c8",
  phone: "64f2fb80-b074-4017-b8b7-b7d549947e52",
  email: "7994f0d2-baeb-451b-983a-816290873a68",
  businessName: "514bfd3f-4ca1-469e-b9e7-87656503f65c",
  address: "e5caee43-e9b5-427d-8583-6982c5dd9be8",
  hours: "b7873d40-d154-42ac-bf24-cb3b667e84cc",
  facebookAds: "ddf2767d-5725-4df2-b200-f0aab77a2db5",
  appointments: "b370341c-6ea3-43c9-bd8c-16e278a2d2d5",
  freeConsults: "ec89854f-d006-402b-958a-91738e2b3e7a",
  marketing: "bf8c7c7b-fff9-463f-b30a-8d8ca8b622f6",
  lastRevenue: "7ff5d37a-df7f-4002-8248-d0b4af6c28e8",
  challenges: "fcf43e6a-cc84-4ae7-9cef-2336069d0280",
  goal90: "791b99b8-c7e9-40a4-96d6-868399e1ae97",
  goal12: "f4b96a9b-bd7c-4398-98b4-6a28a7d3595a",
  whyJoined: "7426c6c5-344f-44c9-9999-3b9daf3a06b8",
  additional: "41d2d5bb-b023-4fa4-906c-72aeef7a5e46",
} as const;
/** KFRCXPFx's appointment labels (the version-2 options online, onsite, office). */
const APPT = {
  online: "عن بُعد (أونلاين) | Online",
  onsite: "في موقع العميل / في المنزل | Onsite / In-home",
  office: "في مقرّكم / مكتبكم | In your office",
};
const FREE_YES =
  "Yes, we do offer free consultations / نعم، نقدم استشارات مجانية✅";
const ARABIC_NOTE = "نبي نركز على الفلل الجديدة في الشمال، والدفع على دفعتين";

type Row = Record<string, any>;
type Answer = { ref: string; title: string; value: string };
const a = (ref: string, value: string, title = "Stored title"): Answer => ({
  ref,
  title,
  value,
});
const json = (v: unknown) => JSON.stringify(v);
/** SQL's left(text, n): the first n characters (code points, not UTF-16 units). */
const leftChars = (text: string, n: number) => Array.from(text).slice(0, n).join("");

let db: PGlite;
const groundMd5: Record<string, string> = {};

function fnDef(sql: string, name: string): string {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  if (start < 0) throw new Error(`Canonical definition missing: ${name}`);
  const open = sql.indexOf("$$", start);
  const close = sql.indexOf("$$;", open + 2);
  return sql.slice(start, close + 3);
}
function cut(sql: string, pattern: RegExp, what: string): string {
  const hit = sql.match(pattern);
  if (!hit) throw new Error(`Canonical definition missing: ${what}`);
  return hit[0];
}
/** A file without its BEGIN and COMMIT, to run inside a rolled-back test. */
const inTest = (file: string) =>
  migration(file)
    .replace(/^BEGIN;/m, "")
    .replace(/COMMIT;\s*$/m, "");

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
async function rolledBack(fn: () => Promise<void>) {
  await db.exec("BEGIN");
  try {
    await fn();
  } finally {
    await db.exec("ROLLBACK");
  }
}
const md5Of = (fn: string) =>
  one<string>(
    "SELECT md5(regexp_replace(p.prosrc, '\\s+', ' ', 'g')) AS r FROM pg_proc p WHERE p.oid = to_regprocedure($1)",
    [`public.${fn}`],
  );
const setting = (key: string, value: unknown) =>
  db.query(
    "INSERT INTO public.cockpit_settings(key, value, updated_by) VALUES ($1, $2::jsonb, 'test') ON CONFLICT (key) DO UPDATE SET value = excluded.value",
    [key, json(value)],
  );
const parity = (form: string, input: unknown, suffix = "") =>
  one<Row>(
    `SELECT public.cockpit_form_parity_plan${suffix}($1, $2::jsonb) AS r`,
    [form, json(input)],
  );
const build = (input: unknown, suffix = "") =>
  one<Row[]>(
    `SELECT public.cockpit_form_stage4_build${suffix}($1::jsonb) AS r`,
    [json(input)],
  );
const byKey = (effects: Row[]) =>
  Object.fromEntries(effects.map(e => [e.key, e]));
/** cockpit_form_stage4_hidden's values by name. */
const hiddenOf = async (task: string, suffix = "") =>
  Object.fromEntries(
    Object.entries(
      await one<Row>(
        `SELECT public.cockpit_form_stage4_hidden${suffix}($1) AS r`,
        [task],
      ),
    ).map(([k, v]) => [k, (v as Row).value]),
  );
/** The link's values that carry something (an empty one is no value: the handoff says Not provided). */
const filled = (hidden: Record<string, string>) =>
  Object.fromEntries(Object.entries(hidden).filter(([, v]) => v !== ""));
const readModel = (onboarding: Row, name = "Cedar Homes Invented") =>
  db.query(
    "INSERT INTO public.cockpit_client_onboarding VALUES ($1, $2, $3::jsonb)",
    [TASK, name, json({ onboarding })],
  );
const billing = (name = "Cedar Homes Invented") =>
  db.query(
    "INSERT INTO public.cockpit_billing_accounts VALUES ($1, $2, NULL)",
    [TASK, name],
  );

/** make_parity.py's evaluator on the same answers (Python 3.9, the standard library only). */
const EVALUATOR = `
import json, re, sys
root = sys.argv[1]
sys.path.insert(0, root + "/scripts/dev")
import make_parity as mp
fx = root + "/scripts/dev/fixtures/make-parity"
make12 = mp.blueprint_of(mp.saved_file(fx, str(mp.MAKE12)))
make13 = mp.blueprint_of(mp.saved_file(fx, str(mp.MAKE13)))
kick = mp.saved_file(fx, mp.KICKOFF_FORM)
onb = mp.saved_file(fx, mp.ONBOARDING_FORM)
m21 = next(m for m in mp.flat_modules(make12["flow"]) if m["id"] == 21)
labels = {i: n for n, i in re.findall(r'"([^"]+)"; "([0-9a-f-]{36})"', m21["mapper"]["custom_fields"][mp.FIELD["service"]])}
out = {"titles": [{"ref": f["ref"], "title": f["title"]} for f in mp.question_fields(onb)],
       "kickoff": [{"ref": f["ref"], "title": f["title"], "type": f["type"]} for f in mp.question_fields(kick)]}
for case in json.load(sys.stdin):
    answers = mp.clean(case["answers"])
    if case["form"] == "kickoff":
        hidden = case.get("hidden") or {}
        src = case.get("hiddenFrom")
        if src:
            card = mp.clean(src["onboarding"])
            hidden = (mp.cockpit_hidden(make13, case["task"], card, src.get("cardName")) if src["source"] == "cockpit"
                      else mp.kickoff_hidden(make13, onb, case["task"], card))
        mods = mp.make_modules(make12, mp.trigger_bundle(kick, answers, hidden))
        sid = mods[21]["input"]["custom_fields"].get(mp.FIELD["service"])
        out[case["id"]] = {"hidden": hidden, "handoff": [mods[k]["input"]["comment_text"] for k in (11, 18, 23)],
                           "service": labels.get(sid) if sid else None, "serviceId": sid}
    else:
        mods = mp.make_modules(make13, mp.trigger_bundle(onb, answers, {"onboarding_client_id": case["task"]}))
        out[case["id"]] = {"raw": mods[47]["input"]["comment_text"],
                           "profile": mods[29]["input"]["custom_fields"][mp.FIELD["profile"]],
                           "dispatch": json.loads(mods[25]["input"]["jsonStringBodyContent"])["client_payload"],
                           "brandDna": {"module": mods[46]["module"], "keys": sorted(mods[46]["input"])}}
json.dump(out, sys.stdout, ensure_ascii=False)
`;
type MakeCase = {
  id: string;
  form: "kickoff" | "onboarding";
  task: string;
  answers: Answer[];
  hidden?: Record<string, string>;
  hiddenFrom?: {
    source: "make13" | "cockpit";
    onboarding: Answer[];
    cardName?: string;
  };
};
function evaluate(cases: MakeCase[]): Row {
  const out = spawnSync(
    // Windows checkout: there is no python3 command, only python.
    process.platform === "win32" ? "python" : "python3",
    ["-I", "-c", EVALUATOR, ROOT],
    { cwd: ROOT, encoding: "utf8", input: json(cases) },
  );
  if (out.status !== 0)
    throw new Error(`The evaluator stopped: ${out.stderr || out.stdout}`);
  return JSON.parse(out.stdout);
}

// --- Synthetic answers ---------------------------------------------------------------------------

/** A card's onboarding answers as the read model holds them (Typeform-shaped; invented). */
const CARD_ONBOARDING: Answer[] = [
  a(O.fullName, "Invented Owner"),
  a(O.phone, "+965 0000 0001"),
  a(O.email, "owner@cedar.invalid"),
  a(O.businessName, "Cedar Homes Invented"),
  a(O.address, "قطعة ٣، شارع ٢٠، منزل ٧"),
  a(O.hours, "9am - 5pm, Sat to Thu"),
  a(O.appointments, `${APPT.office}, ${APPT.online}`),
  a(O.lastRevenue, "0"),
  a(O.goal90, "60000"),
  a(O.marketing, ARABIC_NOTE),
];
/** A kickoff hidden set with an empty value, Arabic text and a list joined by "," (Make 13 [29]'s link). */
const HIDDEN: Record<string, string> = {
  onboarding_client_id: TASK,
  legal_name: "Cedar Homes Invented",
  phone: "+965 0000 0001",
  email: "owner@cedar.invalid",
  address: "قطعة ٣، شارع ٢٠، منزل ٧",
  consultation_types: `${APPT.office},${APPT.online}`,
  last_revenue: "0",
  goal_90d: "60000",
  marketing_tried: ARABIC_NOTE,
};
/** A kickoff as the read model stores it: yes/no as Yes or No, lists joined in the order ticked. */
const KICKOFF: Answer[] = [
  a(K.detailsOk, "Yes"),
  a(K.detailsNote, ARABIC_NOTE),
  a(K.linksOk, "No"),
  a(K.service, "Fit out and renovation, Design and build"),
  a(K.consult, "Online, In-office"),
  a(K.profileOk, "Yes"),
  a(K.contract, "Signed"),
  a(K.inGroup, "No"),
  a(K.whatsappAdd, "المدير الفني وفريق المبيعات"),
  a(K.whatsappStatus, "Invited."),
  a(K.platforms, "Tiktok, Snapchat"),
  a(K.maharaOs, "Logged In"),
  a(K.payment, "0"),
  a(K.postCall, "Yes"),
  a(K.recording, "https://fathom.video/share/invented0001"),
];
/** tG7dnxBn's five follow-ups, as a CSM answers them. */
const FOLLOW_UPS: Answer[] = [
  a(K.detailsWrong, "The office moved to Block 4."),
  a(K.linksWrong, "Instagram is @cedar.invented now."),
  a(K.opsWrong, "Closed on Fridays from November."),
  a(K.profileMissing, "The 12-24 month goal."),
  a(K.contractChanges, "Pay in two parts, not three."),
];
/** An onboarding answer as Typeform recorded it, out of the form's order, a list in the order ticked. */
const ONBOARDING: Answer[] = [
  a(O.additional, "Nothing else for now."),
  a(O.fullName, "Invented Owner"),
  a(O.businessName, "  Cedar Homes Invented  "),
  a(O.appointments, `${APPT.office}, ${APPT.online}`),
  a(O.freeConsults, FREE_YES),
  a(O.lastRevenue, "0"),
  a(O.goal90, "60000.50"),
  a(O.marketing, `${ARABIC_NOTE}\nInstagram ads in 2024`),
  a(O.whyJoined, "We want steady consultations."),
];

// --- The ground ----------------------------------------------------------------------------------

/**
 * The columns cockpit_form_stage4_input, cockpit_form_stage4_hidden, the planner and
 * cockpit_request_create_system read (stand-ins), and the request plan as each part's payload: its
 * description is the type's heading and the request's details, as cockpit_request_plan writes them.
 */
const STAND_INS = `
  CREATE TABLE public.cockpit_form_responses (id uuid PRIMARY KEY, form_key text, form_version integer, source text,
    external_id text, task_id text, client_name text, mode text, state text, answers jsonb, answer_meta jsonb,
    hidden jsonb, submitted_at timestamptz, created_by_id uuid, created_at timestamptz NOT NULL DEFAULT now());
  CREATE TABLE public.cockpit_billing_accounts (clickup_task_id text PRIMARY KEY, client_name text, mrr_usd numeric);
  CREATE TABLE public.cockpit_client_onboarding (clickup_task_id text PRIMARY KEY, client_name text, forms jsonb,
    synced_at timestamptz);
  CREATE TABLE public.cockpit_forms (key text PRIMARY KEY, provider text, effects jsonb);
  CREATE TABLE public.cockpit_form_effects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), response_id uuid, form_key text,
    effect_key text, dedupe_key text, owner text, delivery text, plan jsonb, state text, reason text, delivery_ref text,
    receipt jsonb, UNIQUE (response_id, effect_key));
  CREATE TABLE public.cockpit_request_types (key text PRIMARY KEY, version integer, label text, enabled boolean,
    fields jsonb, targets jsonb, due_days integer, priority text);
  CREATE TABLE public.cockpit_requests (id uuid PRIMARY KEY, type_key text, type_version integer, type_label text,
    requester_member_id uuid, requester_email text, requester_label text, source text, client_task_id text,
    client_name text, answers jsonb, due_on date, priority text, state text, content_hash text, form_response_id uuid,
    created_at timestamptz NOT NULL DEFAULT now());
  CREATE TABLE public.cockpit_request_parts (request_id uuid, part text, list_id text, team text, template_id text,
    template_name text, task_name text, owner_rule text, owner_clickup_id bigint, owner_how text, owner_label text,
    owner_note text, state text, queue_id uuid);
  CREATE TABLE public.cockpit_clickup_writeback_queue (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), dedupe_key text UNIQUE,
    kind text, source_table text, source_id text, campaign_name text, task_id text, payload jsonb, state text DEFAULT 'queued');
  CREATE FUNCTION public.cockpit_request_plan(p_type public.cockpit_request_types, p_request uuid, p_client_task text,
    p_client_name text, p_answers jsonb, p_due date, p_priority text, p_requester_label text, p_replaces text)
  RETURNS jsonb LANGUAGE sql STABLE AS $$
    SELECT coalesce(jsonb_agg(jsonb_build_object('part', g->>'part', 'listId', g->>'list_id', 'templateId', g->>'template_id',
             'taskName', p_client_name || ' - ' || p_type.label, 'owner', '{}'::jsonb,
             'payload', jsonb_build_object('requestId', p_request, 'part', g->>'part', 'listId', g->>'list_id',
               'templateId', g->>'template_id', 'taskName', p_client_name || ' - ' || p_type.label,
               'descriptionMarkdown', '**' || p_type.label || '** for ' || p_client_name
                                      || coalesce(E'\\n\\n' || (p_answers->>'details'), ''),
               'clientTaskId', p_client_task)) ORDER BY n), '[]'::jsonb)
      FROM jsonb_array_elements(p_type.targets) WITH ORDINALITY AS x(g, n)
  $$;`;
/** What the planner and cockpit_request_create_system call, from their canonical migrations. */
const OTHER_FNS: [string, string][] = [
  ["20261029s_forms_registry.sql", "cockpit_form_effect_owner"],
  ["20261029w_forms_dispatch.sql", "cockpit_form_effect_note"],
  ["20261026r_requests.sql", "cockpit_request_due_default"],
  ["20261026r_requests.sql", "cockpit_request_hash"],
  ["20261026r_requests.sql", "cockpit_request_audit"],
  ["20261025n_slack_notices.sql", "cockpit_slack_notice_role_of"],
];
const J_FNS = [
  "cockpit_form_stage4_effects",
  "cockpit_form_stage4_fields",
  "cockpit_form_stage4_card_fields",
  "cockpit_form_stage4_hidden_map",
  "cockpit_form_stage4_setting",
  "cockpit_form_stage4_text",
  "cockpit_form_stage4_typeform_answers",
  "cockpit_form_stage4_native_answers",
  "cockpit_form_stage4_hidden",
  "cockpit_form_stage4_render",
  "cockpit_form_stage4_message",
  "cockpit_form_stage4_map_url",
  "cockpit_form_stage4_build",
  "cockpit_form_stage4_input",
  "cockpit_form_parity_plan",
  "cockpit_kickoff_answers_check",
  "cockpit_form_stage4_ts",
  "cockpit_form_stage4_kickoff_at",
  "cockpit_form_stage4_answered_at",
  "cockpit_request_create_system",
  "cockpit_form_stage4_plan",
] as const;
/** 20261102l's plan, under _l names, beside 20261102m's. */
function keptAsL(j: string, l: string): string {
  const rename = (sql: string) =>
    [
      "cockpit_form_stage4_fields",
      "cockpit_form_stage4_hidden",
      "cockpit_form_stage4_typeform_answers",
      "cockpit_form_stage4_native_answers",
      "cockpit_form_stage4_build",
      "cockpit_form_stage4_input",
      "cockpit_form_parity_plan",
    ].reduce(
      (s, name) =>
        s.replace(
          new RegExp(`public\\.${name}\\(`, "g"),
          `public.${name}_l(`,
        ),
      sql,
    );
  return [
    fnDef(j, "cockpit_form_stage4_fields"),
    fnDef(j, "cockpit_form_stage4_hidden"),
    fnDef(j, "cockpit_form_stage4_typeform_answers"),
    fnDef(j, "cockpit_form_stage4_native_answers"),
    fnDef(l, "cockpit_form_stage4_build"),
    fnDef(j, "cockpit_form_stage4_input"),
    fnDef(j, "cockpit_form_parity_plan"),
  ]
    .map(rename)
    .join("\n\n");
}

beforeAll(async () => {
  db = await cockpitTestDb({ supabaseDefaultPrivileges: true });
  await db.exec(
    cut(
      migration("20260921a_cockpit_settings.sql"),
      /create table if not exists public\.cockpit_settings \([\s\S]*?\n\);/,
      "settings",
    ),
  );
  await db.exec(
    fnDef(migration("20261102a_forms_invites.sql"), "cockpit_client_text_ok"),
  );
  await db.exec(STAND_INS);
  const j = migration(J);
  await db.exec(
    cut(
      j,
      /CREATE TABLE IF NOT EXISTS public\.cockpit_form_option_maps \([\s\S]*?\n\);/,
      "option maps",
    ),
  );
  await db.exec(
    cut(
      j,
      /INSERT INTO public\.cockpit_form_option_maps\(form_key, field_id, answer, option_name\) VALUES[\s\S]*?ON CONFLICT \(form_key, field_id, answer\) DO NOTHING;/,
      "option map rows",
    ),
  );
  for (const key of [
    "forms\\.stage4",
    "onboarding\\.map_urls",
    "stage4\\.messages",
    "stage4\\.templates",
  ])
    await db.exec(
      cut(
        j,
        new RegExp(
          `INSERT INTO public\\.cockpit_settings\\(key, value, updated_by\\)\\nVALUES \\('${key}'[^\\n]*\\n(ON CONFLICT[^\\n]*\\n(WHERE[^\\n]*\\n)?)?`,
        ),
        key,
      ),
    );
  for (const [file, name] of OTHER_FNS)
    await db.exec(fnDef(migration(file), name));
  for (const name of J_FNS) await db.exec(fnDef(j, name));
  const l = migration(L);
  await db.exec(fnDef(l, "cockpit_form_stage4_effects"));
  await db.exec(fnDef(l, "cockpit_form_stage4_build"));
  await db.exec(keptAsL(j, l));
  for (const fn of [...Object.keys(BEFORE_M), ...Object.keys(KEPT_J)])
    groundMd5[fn] = await md5Of(fn);
  await db.exec(migration(M));
});
afterAll(async () => {
  await db?.close();
});

/** Make's answers as the builder's input, the way the parity plan sends a recorded one. */
const kickoffInput = (answers: Answer[], hidden = HIDDEN) => ({
  taskId: TASK,
  client: "Cedar Homes Invented",
  submittedAt: "2026-11-01T09:00:00Z",
  token: "tokInvent0001",
  hidden,
  answers,
});
const onboardingInput = (answers: Answer[]) => ({
  taskId: TASK,
  client: "Cedar Homes (card name)",
  submittedAt: "2026-11-01T08:00:00Z",
  token: "tokInvent0002",
  answers,
});

// --- The file ------------------------------------------------------------------------------------

describe("20261102m: the file", () => {
  test("the ground holds the bodies the drift guard names: live's, and 20261102l's builder", () => {
    expect(groundMd5).toEqual({ ...BEFORE_M, ...KEPT_J });
    const sql = migration(M);
    for (const [fn, md5] of Object.entries(BEFORE_M))
      expect(sql).toContain(`('public.${fn}', '${md5}', '`);
    for (const fn of Object.keys(KEPT_J))
      expect(sql).not.toContain(`FUNCTION public.${fn.split("(")[0]}(`);
  });

  test("the after values are this file's bodies; a second apply changes nothing; j's input and parity plan stay", async () => {
    const sql = migration(M);
    for (const fn of Object.keys(BEFORE_M)) {
      const now = await md5Of(fn);
      expect(
        sql.split("\n").find(x => x.includes(`('public.${fn}', '`)),
      ).toContain(`', '${now}')`);
      expect(now).not.toBe(BEFORE_M[fn as keyof typeof BEFORE_M]);
    }
    for (const [fn, md5] of Object.entries(KEPT_J))
      expect(await md5Of(fn)).toBe(md5);
    const snapshot = async () => ({
      md5: await Promise.all(
        [...Object.keys(BEFORE_M), ...NEW_FNS].map(fn => md5Of(fn)),
      ),
      titles: await one(
        "SELECT value AS r FROM public.cockpit_settings WHERE key = 'onboarding.raw_titles'",
      ),
      column: await one(
        `SELECT format_type(a.atttypid, a.atttypmod) AS r FROM pg_attribute a
          WHERE a.attrelid = 'public.cockpit_requests'::regclass AND a.attname = 'task_comment' AND NOT a.attisdropped`,
      ),
    });
    await rolledBack(async () => {
      await setting("onboarding.raw_titles", RAW_TITLES);
      const before = await snapshot();
      await db.exec(inTest(M));
      expect(await snapshot()).toEqual(before);
      expect((before.titles as Row).fields).toHaveLength(36);
      expect(before.column).toBe("text");
    });
  });

  test("onboarding.raw_titles is seeded empty", async () => {
    expect(
      await one(
        "SELECT jsonb_build_object('value', value, 'by', updated_by) AS r FROM public.cockpit_settings WHERE key = 'onboarding.raw_titles'",
      ),
    ).toEqual({ value: {}, by: "migration 20261102m" });
  });

  test("a changed body stops the file; 20261102j's builder asks for 20261102l first", async () => {
    for (const fn of [
      "cockpit_form_stage4_typeform_answers(text,jsonb)",
      "cockpit_form_stage4_hidden(text)",
      "cockpit_request_create_system(text,text,jsonb,uuid)",
    ])
      await rolledBack(async () => {
        const def = await one<string>(
          "SELECT pg_get_functiondef($1::regprocedure) AS r",
          [`public.${fn}`],
        );
        await db.exec(def.replace("BEGIN", "BEGIN  /* changed */"));
        const r = await refusal(() => db.exec(inTest(M)));
        expect(r).toEqual({
          code: "55000",
          message: `${fn} changed since 20261102l; stop and re-read it.`,
        });
      });
    await rolledBack(async () => {
      await db.exec(fnDef(migration(J), "cockpit_form_stage4_build"));
      expect(await md5Of("cockpit_form_stage4_build(jsonb)")).toBe(J_BUILD_MD5);
      const r = await refusal(() => db.exec(inTest(M)));
      expect(r).toEqual({
        code: "55000",
        message: "Apply 20261102l before 20261102m.",
      });
    });
  });

  test("the owner runs every function it makes or replaces, and nobody else", async () => {
    const grants = await one<Row>(
      `SELECT jsonb_object_agg(f || ':' || r, has_function_privilege(r, 'public.' || f, 'EXECUTE')) AS r
         FROM unnest($1::text[]) f, unnest(ARRAY['anon','authenticated','service_role']) r`,
      [[...Object.keys(BEFORE_M), ...NEW_FNS]],
    );
    expect(
      Object.entries(grants)
        .filter(([, v]) => v)
        .map(([k]) => k),
    ).toEqual([]);
  });

  test("the deploy file holds the 36 questions of the saved KFRCXPFx, in its order, with its full titles", () => {
    const made = evaluate([]);
    expect(Object.keys(RAW_TITLES)).toEqual(["fields"]);
    expect(RAW_TITLES.fields).toEqual(made.titles);
    expect(RAW_TITLES.fields).toHaveLength(36);
  });
});

// --- The kickoff's questions ---------------------------------------------------------------------

describe("the kickoff asks every question Make 12 [11] prints", () => {
  test("tG7dnxBn's five follow-ups join the 41 after the question each follows; Post call form filled is Yes or No", async () => {
    const now = await one<Row[]>(
      "SELECT public.cockpit_form_stage4_fields('kickoff') AS r",
    );
    const was = await one<Row[]>(
      "SELECT public.cockpit_form_stage4_fields_l('kickoff') AS r",
    );
    expect(now).toHaveLength(46);
    const keys = now.map(f => f.key);
    // The 41 keep their order and words; only Post call form filled changes, to tG7dnxBn's yes/no.
    expect(keys.filter(k => was.some(w => w.key === k))).toEqual(
      was.map(w => w.key),
    );
    for (const w of was)
      expect(now.find(f => f.key === w.key)).toEqual(
        w.key === "postCallFormFilled"
          ? { ...w, type: "choice", options: ["Yes", "No"] }
          : w,
      );
    const tf = evaluate([]).kickoff as Row[];
    const added = now.filter(f => !was.some(w => w.key === f.key));
    expect(
      added.map(f => [f.key, f.typeformRef, f.title, f.type, keys[keys.indexOf(f.key) - 1]]),
    ).toEqual([
      ["detailsCorrection", K.detailsWrong, tf.find(x => x.ref === K.detailsWrong).title, "longtext", "detailsFix"],
      ["linksCorrection", K.linksWrong, tf.find(x => x.ref === K.linksWrong).title, "longtext", "linksFix"],
      ["operationsCorrection", K.opsWrong, tf.find(x => x.ref === K.opsWrong).title, "longtext", "operationsFix"],
      ["profileMissing", K.profileMissing, tf.find(x => x.ref === K.profileMissing).title, "longtext", "profileFix"],
      ["contractChanges", K.contractChanges, tf.find(x => x.ref === K.contractChanges).title, "longtext", "contractStatus"],
    ]);
    // Every question of tG7dnxBn is one of the kickoff's now, and nothing else is.
    expect(now.map(f => f.typeformRef).sort()).toEqual(
      tf.map(x => x.ref).sort(),
    );
    expect(tf.find(x => x.ref === K.postCall).type).toBe("yes_no");
    expect(
      await one("SELECT public.cockpit_form_stage4_fields('onboarding') AS r"),
    ).toEqual(
      await one("SELECT public.cockpit_form_stage4_fields_l('onboarding') AS r"),
    );
  });

  test("the answers check takes the five follow-ups and only Yes or No for Post call form filled", async () => {
    const check = (answers: Row) =>
      one<Row>("SELECT public.cockpit_kickoff_answers_check($1::jsonb) AS r", [
        json({ newMrrUsd: 0, ...answers }),
      ]);
    const follow = {
      detailsCorrection: "The office moved to Block 4.",
      linksCorrection: "Instagram is @cedar.invented now.",
      operationsCorrection: "Closed on Fridays from November.",
      profileMissing: "The 12-24 month goal.",
      contractChanges: "Pay in two parts, not three.",
    };
    expect(await check({ ...follow, postCallFormFilled: "Yes" })).toEqual({
      ok: true,
      errors: {},
      answers: { ...follow, postCallFormFilled: "Yes", newMrrUsd: 0 },
    });
    expect(await check({ postCallFormFilled: "Done" })).toMatchObject({
      ok: false,
      errors: { postCallFormFilled: "option" },
    });
    expect(await check({ postCallFormFilled: "No" })).toMatchObject({
      ok: true,
    });
  });
});

// --- Make's texts against the evaluator -----------------------------------------------------------

describe("the texts equal the evaluator's on the same answers", () => {
  test("the handoff (Make 12 [11], [18], [23]): Not provided, yes/no, numbers, lists as ticked, Arabic", async () => {
    const cases: MakeCase[] = [
      {
        id: "full",
        form: "kickoff",
        task: TASK,
        hidden: HIDDEN,
        answers: [...KICKOFF, ...FOLLOW_UPS],
      },
      { id: "empty", form: "kickoff", task: TASK, hidden: {}, answers: [] },
      {
        id: "yes_no",
        form: "kickoff",
        task: TASK,
        hidden: { onboarding_client_id: TASK, legal_name: " " },
        answers: [
          a(K.detailsOk, "true"),
          a(K.linksOk, "FALSE"),
          a(K.opsOk, " yes "),
          a(K.profileOk, "maybe"),
          a(K.inGroup, "No"),
          a(K.postCall, "Done"),
          a(K.contentDiscussed, "  "),
        ],
      },
      ...[
        "1500",
        "1500.50",
        "0.0",
        "-0",
        "007",
        "١٥٠٠",
        "1,500",
        " 42 ",
        "about 900",
      ].map(
        (value, i): MakeCase => ({
          id: `payment${i}`,
          form: "kickoff",
          task: TASK,
          hidden: { onboarding_client_id: TASK },
          answers: [a(K.payment, value)],
        }),
      ),
    ];
    const made = evaluate(cases);
    for (const c of cases) {
      const sql = await one<string>(
        "SELECT public.cockpit_form_stage4_handoff_text($1::jsonb, $2::jsonb) AS r",
        [
          json(c.hidden),
          json(Object.fromEntries(c.answers.map(x => [x.ref, x.value]))),
        ],
      );
      expect([c.id, sql]).toEqual([c.id, made[c.id].handoff[0]]);
      expect(made[c.id].handoff[1]).toBe(sql);
      expect(made[c.id].handoff[2]).toBe(sql);
    }
    const full = made.full.handoff[0].split("\n");
    expect(full).toHaveLength(110);
    for (const line of [
      "*KICKOFF HANDOFF*",
      "*Client:* Cedar Homes Invented",
      "*Address:* قطعة ٣، شارع ٢٠، منزل ٧",
      "*Google Maps:* Not provided",
      "*Business details confirmed:* Yes",
      "*Business corrections:* The office moved to Block 4.",
      "*Online links confirmed:* No",
      "*Online-link corrections:* Instagram is @cedar.invented now.",
      "*Operations confirmed:* Not provided",
      "*Operations corrections:* Closed on Fridays from November.",
      "*Services we are advertising:* Fit out and renovation, Design and build",
      "*Consultation types confirmed at kickoff:* Online, In-office",
      `*Original consultation types:* ${APPT.office},${APPT.online}`,
      "*Previous revenue:* 0",
      "*Missing profile information:* The 12-24 month goal.",
      "*Contract changes needed:* Pay in two parts, not three.",
      "*Payment amount:* Not provided",
      "*Other people to add:* المدير الفني وفريق المبيعات",
      "*Post-call form completed:* Yes",
    ])
      expect(full).toContain(line);
    expect(made.empty.handoff[0].match(/Not provided/g)).toHaveLength(69);
    expect(made.yes_no.handoff[0]).toContain(
      "*Post-call form completed:* Not provided",
    );
    expect(
      Array.from({ length: 9 }, (_, i) =>
        made[`payment${i}`].handoff[0]
          .split("\n")
          .find((x: string) => x.startsWith("*Payment amount:*")),
      ),
    ).toEqual([
      "*Payment amount:* 1500",
      "*Payment amount:* 1500.5",
      "*Payment amount:* Not provided",
      "*Payment amount:* Not provided",
      "*Payment amount:* 7",
      "*Payment amount:* 1500",
      "*Payment amount:* 1,500",
      "*Payment amount:* 42",
      "*Payment amount:* about 900",
    ]);
  });

  test("the Client Profile (Make 13 [29]): every label kept when empty, a revenue of 0 blank", async () => {
    const cases: MakeCase[] = [
      { id: "full", form: "onboarding", task: TASK, answers: ONBOARDING },
      { id: "empty", form: "onboarding", task: TASK, answers: [] },
      {
        id: "numbers",
        form: "onboarding",
        task: TASK,
        answers: [
          a(O.lastRevenue, "١٢٠٠٠٠"),
          a(O.goal90, "12.50"),
          a(O.goal12, "250,000 KWD"),
          a(O.challenges, "Leads\nTime"),
        ],
      },
    ];
    const made = evaluate(cases);
    for (const c of cases) {
      const sql = await one<string>(
        "SELECT public.cockpit_form_stage4_profile_text($1::jsonb) AS r",
        [json(Object.fromEntries(c.answers.map(x => [x.ref, x.value])))],
      );
      expect([c.id, sql]).toEqual([c.id, made[c.id].profile]);
    }
    expect(made.empty.profile).toBe(
      "Last Year's Total Revenue: \n\n90-Day Goal Revenue: \n\n12-24 Month Revenue Goal: \n\nMarketing they've tried A-Z: \n\nTop 3 challenges: \n\nWhy they joined: \n\nAdditional notes: ",
    );
    expect(made.full.profile).toStartWith(
      "Last Year's Total Revenue: \n\n90-Day Goal Revenue: 60000.5\n\n",
    );
    expect(made.numbers.profile).toStartWith(
      "Last Year's Total Revenue: 120000\n\n90-Day Goal Revenue: 12.5\n\n12-24 Month Revenue Goal: 250,000 KWD\n\n",
    );
  });

  test("the raw answers comment (Make 13 [41] to [47]): the form's order and full titles, 0 blank, a retired question last", async () => {
    const cases: MakeCase[] = [
      { id: "full", form: "onboarding", task: TASK, answers: ONBOARDING },
      { id: "empty", form: "onboarding", task: TASK, answers: [] },
      {
        id: "edges",
        form: "onboarding",
        task: TASK,
        answers: [
          a(
            "retired-question-ref",
            "An old answer",
            "A question the form no longer has",
          ),
          a(O.goal12, "0.00"),
          a(O.hours, "  "),
          a(O.facebookAds, "IM UNSURE | لست متأكدًا"),
          a(O.goal12, "90000"),
          a(O.email, "owner@cedar.invalid"),
        ],
      },
    ];
    const made = evaluate(cases);
    for (const c of cases) {
      const sql = await one<string>(
        "SELECT public.cockpit_form_stage4_raw_answers_text($1::jsonb, $2::jsonb) AS r",
        [json(c.answers), json(RAW_TITLES.fields)],
      );
      expect([c.id, sql]).toEqual([c.id, made[c.id].raw]);
    }
    const title = (ref: string) =>
      RAW_TITLES.fields.find((f: Row) => f.ref === ref).title;
    expect(made.empty.raw).toBe("**Raw Onboarding Form Answers**\n\n");
    expect(made.full.raw).toStartWith(
      `**Raw Onboarding Form Answers**\n\n**${title(O.fullName)}**\nInvented Owner\n\n**${title(O.businessName)}**\n  Cedar Homes Invented  \n\n`,
    );
    expect(made.full.raw).toContain(
      `**${title(O.appointments)}**\n${APPT.office}, ${APPT.online}\n`,
    );
    expect(made.full.raw).toContain(`**${title(O.lastRevenue)}**\n\n\n`);
    expect(made.full.raw).toEndWith(
      `**${title(O.additional)}**\nNothing else for now.\n`,
    );
    expect(made.edges.raw).toEndWith(
      "**A question the form no longer has**\nAn old answer\n",
    );
    expect(made.edges.raw).toContain(`**${title(O.goal12)}**\n90000\n`);
  });

  test("a recorded kickoff through the parity plan: the handoff, the comment on each onboarding task and Service Advertised", async () => {
    const cases: MakeCase[] = [
      {
        id: "given",
        form: "kickoff",
        task: TASK,
        hidden: HIDDEN,
        answers: KICKOFF,
      },
      {
        id: "followUps",
        form: "kickoff",
        task: TASK,
        hidden: HIDDEN,
        answers: [...KICKOFF, ...FOLLOW_UPS],
      },
      {
        id: "make13",
        form: "kickoff",
        task: TASK,
        answers: KICKOFF.map(x =>
          x.ref === K.service ? { ...x, value: "Other, Interior design" } : x,
        ),
        hiddenFrom: { source: "make13", onboarding: CARD_ONBOARDING },
      },
      {
        id: "cockpit",
        form: "kickoff",
        task: TASK,
        answers: KICKOFF.filter(x => x.ref !== K.service),
        hiddenFrom: {
          source: "cockpit",
          onboarding: CARD_ONBOARDING,
          cardName: "Cedar Homes Invented",
        },
      },
      {
        id: "long",
        form: "kickoff",
        task: TASK,
        hidden: HIDDEN,
        answers: KICKOFF.map(x =>
          x.ref === K.detailsNote
            ? { ...x, value: "ملاحظة ".repeat(400).trim() }
            : x.ref === K.whatsappAdd
              ? { ...x, value: "x".repeat(1500) }
              : x,
        ),
      },
    ];
    const made = evaluate(cases);
    for (const c of cases) {
      const now = await parity("kickoff", kickoffInput(c.answers, made[c.id].hidden));
      expect([c.id, now.unmapped]).toEqual([c.id, null]);
      const plan = byKey(now.effects);
      const [handoff, task18, task23] = made[c.id].handoff;
      expect([c.id, plan.handoff_comment.plan.comment_text]).toEqual([
        c.id,
        handoff,
      ]);
      // Make 12 [17] and [22] make each task from its template with no description; [18] and [23]
      // post the handoff on it, whole. Until the request writer posts it, the details keep
      // 20261102l's first 4,000 characters of it, so no task is made without the handoff.
      expect([c.id, plan.onboarding_tasks.plan]).toEqual([
        c.id,
        {
          typeKey: "client_onboarding",
          details: leftChars(task18, 4000),
          comment_text: task18,
          lines: ["Technical Onboarding Check and Creative Onboarding tasks"],
        },
      ]);
      expect(task23).toBe(task18);
      const service = plan.card_fields.plan.fields.find(
        (f: Row) => f.fieldId === SERVICE_FIELD,
      );
      expect([c.id, service?.optionName ?? null]).toEqual([
        c.id,
        made[c.id].service,
      ]);
    }
    expect(made.given.service).toBe("Fit out and renovation");
    expect(made.make13.service).toBe("Other");
    expect(made.make13.hidden.consultation_types).toBe(
      `${APPT.office},${APPT.online}`,
    );
    expect(made.make13.hidden.last_revenue).toBe("");
    expect(made.cockpit.service).toBeNull();
    expect(Array.from(made.long.handoff[0]).length).toBeGreaterThan(4000);
    expect(made.followUps.handoff[0]).toContain(
      "*Contract changes needed:* Pay in two parts, not three.",
    );
    // 20261102l had no question for the follow-ups, so its handoff said Not provided; its tasks carried a cut copy.
    const was = byKey(
      (await parity("kickoff", kickoffInput([...KICKOFF, ...FOLLOW_UPS]), "_l"))
        .effects,
    );
    expect(was.handoff_comment.plan.comment_text).not.toContain(
      "The office moved to Block 4.",
    );
    const long = byKey(
      (await parity("kickoff", kickoffInput(cases[4].answers), "_l")).effects,
    );
    expect(long.onboarding_tasks.plan.comment_text).toBeUndefined();
    expect(Array.from(long.onboarding_tasks.plan.details as string).length).toBe(4000);
    // The long handoff is cut in the details as 20261102l cut its own, and whole in the comment.
    const now = byKey(
      (await parity("kickoff", kickoffInput(cases[4].answers, made.long.hidden))).effects,
    );
    expect(Array.from(now.onboarding_tasks.plan.details as string).length).toBe(4000);
    expect(now.onboarding_tasks.plan.comment_text).toBe(made.long.handoff[1]);
  });

  test("Service Advertised is the option ticked first, or nothing when that one is not an option (Make 12 [21])", async () => {
    const lists = [
      "Landscaping, Interior design",
      "Interior design, Other",
      "Construction only",
      "Other, Landscaping",
    ];
    const cases = lists.map(
      (value, i): MakeCase => ({
        id: `s${i}`,
        form: "kickoff",
        task: TASK,
        hidden: HIDDEN,
        answers: [a(K.service, value)],
      }),
    );
    const made = evaluate(cases);
    const service = async (answers: Answer[], suffix = "") =>
      (await build({ ...kickoffInput(answers), formKey: "kickoff" }, suffix))
        .find(e => e.key === "card_fields")
        ?.plan.fields.find((f: Row) => f.fieldId === SERVICE_FIELD)
        ?.optionName ?? null;
    for (const c of cases)
      expect([c.id, await service(c.answers)]).toEqual([
        c.id,
        made[c.id].service,
      ]);
    expect(cases.map(c => made[c.id].service)).toEqual([
      null,
      "Interior design",
      "Construction only",
      "Other",
    ]);
    // 20261102l wrote the first listed service the map knows.
    expect(await service(cases[0].answers, "_l")).toBe("Interior design");
  });

  test("a recorded onboarding answer through the parity plan: the raw comment, the Client Profile and the dispatch", async () => {
    await rolledBack(async () => {
      await setting("onboarding.raw_titles", RAW_TITLES);
      const cases: MakeCase[] = [
        { id: "full", form: "onboarding", task: TASK, answers: ONBOARDING },
        {
          id: "noName",
          form: "onboarding",
          task: TASK,
          answers: ONBOARDING.filter(x => x.ref !== O.businessName),
        },
        {
          id: "arabicName",
          form: "onboarding",
          task: TASK,
          answers: [
            a(O.businessName, "شركة الأرز للتصميم"),
            a(O.lastRevenue, "250000"),
          ],
        },
        {
          id: "long",
          form: "onboarding",
          task: TASK,
          answers: [
            ...ONBOARDING,
            a(O.challenges, "التحديات ".repeat(300).trim()),
            a(O.additional, "y".repeat(2500)),
          ].filter(
            (x, i, all) => all.findLastIndex(y => y.ref === x.ref) === i,
          ),
        },
      ];
      const made = evaluate(cases);
      for (const c of cases) {
        const plan = byKey(
          (await parity("onboarding", onboardingInput(c.answers))).effects,
        );
        expect([c.id, plan.raw_answers_comment.plan.comment_text]).toEqual([
          c.id,
          made[c.id].raw,
        ]);
        expect(plan.raw_answers_comment.missing).toBeNull();
        expect([c.id, plan.profile_fields.plan.fields[0]]).toMatchObject([
          c.id,
          { fieldId: PROFILE_FIELD, value: leftChars(made[c.id].profile, 5000) },
        ]);
        // Every text value is one clickup-writeback's forms.ts takes (5,000 UTF-16 units at most), so
        // the row, with the Kickoff Form Link in it, is written.
        for (const f of plan.profile_fields.plan.fields as Row[])
          if (f.kind === "text")
            expect([c.id, f.value.length <= 5000]).toEqual([c.id, true]);
        expect(
          [c.id, plan.profile_fields.plan.fields.map((f: Row) => f.label)],
        ).toEqual([c.id, ["Client Profile", "Kickoff Form Link"]]);
        expect([c.id, plan.github_dispatch.plan.payload]).toEqual([
          c.id,
          {
            taskId: made[c.id].dispatch.clickup_id,
            client: made[c.id].dispatch.client_name,
          },
        ]);
      }
      expect(made.full.dispatch).toEqual({
        client_name: "  Cedar Homes Invented  ",
        clickup_id: TASK,
      });
      expect(made.noName.dispatch).toEqual({
        client_name: "",
        clickup_id: TASK,
      });
      // Make 13 [29] has no limit. The plan cuts the Client Profile at 5,000 characters, as 20261102l
      // did, until forms.ts takes longer text: a profile this long cannot match Make yet.
      expect(Array.from(made.long.profile as string).length).toBeGreaterThan(5000);
      const long = byKey(
        (await parity("onboarding", onboardingInput(cases[3].answers))).effects,
      );
      expect(long.profile_fields.plan.fields[0].value).toHaveLength(5000);
      expect(made.long.profile).toStartWith(long.profile_fields.plan.fields[0].value);
      expect(long.profile_fields.plan.lines[0]).toBe(
        `Client Profile (${Array.from(made.long.profile as string).length} characters)`,
      );
      const was = byKey(
        (await parity("onboarding", onboardingInput(cases[3].answers), "_l"))
          .effects,
      );
      expect(was.profile_fields.plan.fields[0].value).toHaveLength(5000);
    });
  });
});

// --- The kickoff's hidden values -----------------------------------------------------------------

describe("the kickoff's hidden values are what Make 13 [29]'s Kickoff Form Link carries", () => {
  test("a Typeform onboarding answer: as stored, the list joined with ',', a revenue of 0 none, no card name", async () => {
    await rolledBack(async () => {
      const onboarding: Answer[] = [
        a(O.fullName, "Invented Owner"),
        a(O.phone, "+965 0000 0001"),
        a(O.address, "  قطعة ٣، شارع ٢٠  "),
        a(O.hours, "   "),
        a(O.appointments, `${APPT.office}, ${APPT.onsite}, ${APPT.online}`),
        a(O.lastRevenue, "0"),
        a(O.goal90, "60000.50"),
        a(O.goal12, "0.00"),
        a(O.marketing, ""),
        a(O.challenges, "An older answer"),
        a(O.challenges, "Leads\nTime"),
        a(O.whyJoined, "We want steady consultations.\n"),
      ];
      await billing();
      await readModel({ form_id: "KFRCXPFx", answers: onboarding });
      const made = evaluate([
        {
          id: "h",
          form: "kickoff",
          task: TASK,
          answers: [],
          hiddenFrom: { source: "make13", onboarding },
        },
      ]).h;
      const now = await hiddenOf(TASK);
      expect(now).toEqual(filled(made.hidden));
      expect(now).toEqual({
        onboarding_client_id: TASK,
        phone: "+965 0000 0001",
        address: "  قطعة ٣، شارع ٢٠  ",
        hours: "   ",
        consultation_types: `${APPT.office},${APPT.onsite},${APPT.online}`,
        goal_90d: "60000.5",
        challenges: "Leads\nTime",
        why_joined: "We want steady consultations.\n",
      });
      // 20261102l's: trimmed, ", ", 0 kept, the first answer of a ref, and the card's name for the business.
      expect(await hiddenOf(TASK, "_l")).toMatchObject({
        legal_name: "Cedar Homes Invented",
        address: "قطعة ٣، شارع ٢٠",
        consultation_types: `${APPT.office}, ${APPT.onsite}, ${APPT.online}`,
        last_revenue: "0",
        goal_90d: "60000.50",
      });
      // The handoff through cockpit_form_stage4_input then says what Make 12 [11] says.
      const id = await nativeResponse("kickoff", NATIVE_KICKOFF);
      const input = await one<Row>(
        "SELECT public.cockpit_form_stage4_input($1) AS r",
        [id],
      );
      expect(input.hidden).toEqual(now);
      const handoff = evaluate([
        {
          id: "k",
          form: "kickoff",
          task: TASK,
          answers: input.answers,
          hiddenFrom: { source: "make13", onboarding },
        },
      ]).k.handoff[0] as string;
      expect(byKey(await build(input)).handoff_comment.plan.comment_text).toBe(
        handoff,
      );
      for (const line of [
        "*Client:* Not provided",
        "*Working hours / availability:*    ",
        `*Original consultation types:* ${APPT.office},${APPT.onsite},${APPT.online}`,
        "*Previous revenue:* Not provided",
        "*90-day goal:* 60000.5",
        "*12-24 month goal:* Not provided",
      ])
        expect(handoff.split("\n")).toContain(line);
    });
  });

  test("no onboarding answer: only the card's id", async () => {
    await rolledBack(async () => {
      await billing();
      expect(await hiddenOf(TASK)).toEqual({ onboarding_client_id: TASK });
      await readModel({ form_id: "KFRCXPFx", answers: "none" });
      expect(await hiddenOf(TASK)).toEqual({ onboarding_client_id: TASK });
    });
  });
});

// --- Native answers ------------------------------------------------------------------------------

const NATIVE_KICKOFF = {
  detailsCorrect: "Yes",
  detailsCorrection: "The office moved to Block 4.",
  linksCorrect: "No",
  serviceAdvertised: ["Fit out and renovation", "Design and build"],
  consultationTypes: ["Online", "In-office"],
  contractStatus: "Adjustments requested by client",
  contractChanges: "Pay in two parts, not three.",
  inWhatsappGroup: "No",
  whatsappAdd: "المدير الفني وفريق المبيعات",
  whatsappStatus: "Invited.",
  adPlatforms: "Tiktok, Snapchat",
  maharaOsAccess: "Logged In",
  paymentAmount: 0,
  postCallFormFilled: "Yes",
  callRecording: "https://fathom.video/share/invented0001",
  newMrrUsd: 2500,
};
const NATIVE_ONBOARDING = {
  fullName: "Invented Owner",
  businessName: "Cedar Homes Invented",
  appointmentTypes: ["office", "online"],
  freeConsults: "yes",
  lastRevenue: "0",
  goal90: "60000",
  marketing: ARABIC_NOTE,
  additionalInfo: "Nothing else for now.",
};

async function nativeResponse(form: string, answers: unknown): Promise<string> {
  const id = crypto.randomUUID();
  await db.query(
    `INSERT INTO public.cockpit_form_responses(id, form_key, form_version, source, external_id, task_id, client_name, mode,
       state, answers, answer_meta, hidden, submitted_at)
     VALUES ($1::uuid, $2, 2, 'cockpit', $3, $4, 'Cedar Homes Invented', 'live', 'submitted', $5::jsonb, '{}', '{}',
             '2026-11-01T09:00:00Z')`,
    [id, form, `req:${id}`, TASK, json(answers)],
  );
  return id;
}

describe("a native answer (version 2) is planned as Make would write the same answers", () => {
  test("the kickoff: lists as ticked, the follow-ups, the hidden values of Make 13 [29]'s link, Make's texts", async () => {
    await rolledBack(async () => {
      await billing();
      await readModel({ form_id: "native", answers: CARD_ONBOARDING });
      const id = await nativeResponse("kickoff", NATIVE_KICKOFF);
      const input = await one<Row>(
        "SELECT public.cockpit_form_stage4_input($1) AS r",
        [id],
      );
      const pairs = (list: Answer[]) => list.map(x => [x.ref, x.value]);
      expect(pairs(input.answers)).toEqual([
        [K.detailsOk, "Yes"],
        [K.detailsWrong, "The office moved to Block 4."],
        [K.linksOk, "No"],
        [K.service, "Fit out and renovation, Design and build"],
        [K.consult, "Online, In-office"],
        [K.contract, "Adjustments requested by client"],
        [K.contractChanges, "Pay in two parts, not three."],
        [K.inGroup, "No"],
        [K.whatsappAdd, "المدير الفني وفريق المبيعات"],
        [K.whatsappStatus, "Invited."],
        [K.platforms, "Tiktok, Snapchat"],
        [K.maharaOs, "Logged In"],
        [K.payment, "0"],
        [K.postCall, "Yes"],
        [K.recording, "https://fathom.video/share/invented0001"],
      ]);
      const made = evaluate([
        {
          id: "native",
          form: "kickoff",
          task: TASK,
          answers: input.answers,
          hiddenFrom: { source: "make13", onboarding: CARD_ONBOARDING },
        },
      ]).native;
      expect(input.hidden).toEqual(filled(made.hidden));
      expect(input.hidden.consultation_types).toBe(
        `${APPT.office},${APPT.online}`,
      );
      expect(input.hidden.last_revenue).toBeUndefined();
      const plan = byKey(await build(input));
      expect(plan.handoff_comment.plan.comment_text).toBe(made.handoff[0]);
      expect(plan.onboarding_tasks.plan.comment_text).toBe(made.handoff[1]);
      expect(plan.onboarding_tasks.plan.details).toBe(leftChars(made.handoff[1], 4000));
      expect(
        plan.card_fields.plan.fields.find(
          (f: Row) => f.fieldId === SERVICE_FIELD,
        ).optionName,
      ).toBe(made.service);
      expect(made.service).toBe("Fit out and renovation");
      for (const line of [
        "*Payment amount:* Not provided",
        "*Post-call form completed:* Yes",
        "*Business corrections:* The office moved to Block 4.",
        "*Contract changes needed:* Pay in two parts, not three.",
        "*Previous revenue:* Not provided",
      ])
        expect(made.handoff[0].split("\n")).toContain(line);
      // 20261102l's plan for the same answer named the first in the form's option order.
      const was = byKey(
        await build(
          await one<Row>("SELECT public.cockpit_form_stage4_input_l($1) AS r", [
            id,
          ]),
          "_l",
        ),
      );
      expect(
        was.card_fields.plan.fields.find(
          (f: Row) => f.fieldId === SERVICE_FIELD,
        ).optionName,
      ).toBe("Design and build");
    });
  });

  test("the onboarding: the read model keeps each list as ticked, and the next kickoff's link reads it in that order", async () => {
    await rolledBack(async () => {
      await setting("onboarding.raw_titles", RAW_TITLES);
      const id = await nativeResponse("onboarding", {
        ...NATIVE_ONBOARDING,
        appointmentTypes: ["office", "onsite", "online"],
      });
      const input = await one<Row>(
        "SELECT public.cockpit_form_stage4_input($1) AS r",
        [id],
      );
      const appt = (list: Answer[]) =>
        list.find(x => x.ref === O.appointments)?.value;
      expect(appt(input.answers)).toBe(
        `${APPT.office}, ${APPT.onsite}, ${APPT.online}`,
      );
      const was = await one<Row>(
        "SELECT public.cockpit_form_stage4_input_l($1) AS r",
        [id],
      );
      expect(appt(was.answers)).toBe(
        `${APPT.online}, ${APPT.onsite}, ${APPT.office}`,
      );
      expect({
        ...input,
        answers: input.answers.filter((x: Answer) => x.ref !== O.appointments),
      }).toEqual({
        ...was,
        answers: was.answers.filter((x: Answer) => x.ref !== O.appointments),
      });
      const made = evaluate([
        {
          id: "native",
          form: "onboarding",
          task: TASK,
          answers: input.answers,
        },
        {
          id: "link",
          form: "kickoff",
          task: TASK,
          answers: [],
          hiddenFrom: { source: "make13", onboarding: input.answers },
        },
      ]);
      const plan = byKey(await build(input));
      expect(plan.raw_answers_comment.plan.comment_text).toBe(made.native.raw);
      expect(plan.profile_fields.plan.fields[0].value).toBe(made.native.profile);
      expect(plan.github_dispatch.plan.payload).toEqual({
        taskId: TASK,
        client: "Cedar Homes Invented",
      });
      expect(made.native.dispatch).toEqual({
        client_name: "Cedar Homes Invented",
        clickup_id: TASK,
      });
      expect(plan.read_model.plan.entry.answers).toEqual(input.answers);
      // A native answer takes the full title of its Typeform ref: each of the 36 questions has one.
      expect(made.native.raw).toContain(
        `**${RAW_TITLES.fields[0].title}**\nInvented Owner\n`,
      );
      expect(made.native.raw).not.toContain("**Full Name**");
      // The read model the plan writes gives the next kickoff Make 13 [29]'s values.
      await readModel(plan.read_model.plan.entry);
      expect(await hiddenOf(TASK)).toEqual(filled(made.link.hidden));
      expect((await hiddenOf(TASK)).consultation_types).toBe(
        `${APPT.office},${APPT.onsite},${APPT.online}`,
      );
    });
  });
});

// --- The raw answers comment without its titles ---------------------------------------------------

describe("the raw answers comment is never posted with a wrong title", () => {
  test("while onboarding.raw_titles is empty, the comment is missing and every other effect stands", async () => {
    await rolledBack(async () => {
      await setting("onboarding.raw_titles", {});
      const plan = byKey(
        (await parity("onboarding", onboardingInput(ONBOARDING))).effects,
      );
      expect(plan.raw_answers_comment).toEqual({
        key: "raw_answers_comment",
        delivery: "clickup_queue",
        plan: {
          taskId: TASK,
          comment_text: null,
          lines: ["Raw answers comment"],
        },
        missing:
          "The onboarding form's full question titles are not set up yet (onboarding.raw_titles), so the raw answers comment was not posted.",
      });
      expect(plan.profile_fields.plan.fields[0].value).toStartWith(
        "Last Year's Total Revenue: ",
      );
      expect(plan.brand_dna_task.plan).toEqual({
        typeKey: "brand_dna",
        lines: ["Brand DNA task"],
      });
      for (const broken of [
        { fields: [] },
        { fields: "x" },
        { fields: [{ ref: O.fullName }] },
        [1, 2],
      ]) {
        await setting("onboarding.raw_titles", broken);
        expect(
          (await parity("onboarding", onboardingInput(ONBOARDING))).effects[1]
            .missing,
        ).toBe(
          "The onboarding form's full question titles are not set up yet (onboarding.raw_titles), so the raw answers comment was not posted.",
        );
      }
    });
  });

  test("titles that miss an answered question: missing, with the count", async () => {
    await rolledBack(async () => {
      const lacking = RAW_TITLES.fields.filter(
        (f: Row) => f.ref !== O.lastRevenue && f.ref !== O.goal90,
      );
      await setting("onboarding.raw_titles", { fields: lacking });
      const plan = byKey(
        (await parity("onboarding", onboardingInput(ONBOARDING))).effects,
      );
      expect(plan.raw_answers_comment.missing).toBe(
        "The onboarding form's full question titles (onboarding.raw_titles) have none for 2 answered questions, so the raw answers comment was not posted.",
      );
      expect(plan.raw_answers_comment.plan.comment_text).toBeNull();
      await setting("onboarding.raw_titles", {
        fields: RAW_TITLES.fields.filter((f: Row) => f.ref !== O.lastRevenue),
      });
      expect(
        byKey((await parity("onboarding", onboardingInput(ONBOARDING))).effects)
          .raw_answers_comment.missing,
      ).toBe(
        "The onboarding form's full question titles (onboarding.raw_titles) have none for 1 answered question, so the raw answers comment was not posted.",
      );
    });
  });
});

// --- The system's requests -----------------------------------------------------------------------

/**
 * The registry rows of the two native forms at version 2, and the two system request types, each
 * taking details: client_onboarding on Make 12 [17] and [22]'s lists and templates, brand_dna on Make
 * 13 [46]'s list with no template.
 */
async function liveForms() {
  for (const form of ["kickoff", "onboarding"])
    await db.query(
      "INSERT INTO public.cockpit_forms(key, provider, effects) VALUES ($1, 'native', public.cockpit_form_stage4_effects($1, 2))",
      [form],
    );
  await db.query(
    `INSERT INTO public.cockpit_request_types(key, version, label, enabled, fields, targets, due_days, priority)
     VALUES ('client_onboarding', 1, 'Client Onboarding', true, $1::jsonb, $2::jsonb, 1, 'normal'),
            ('brand_dna', 1, 'Brand DNA', true, $1::jsonb, $3::jsonb, 2, 'normal')`,
    [
      json([{ key: "details", kind: "details", label: "Details" }]),
      json([
        { part: "tech", list_id: "901816723190", template_id: "t-86ex8x9xw" },
        { part: "creative", list_id: "901818016338", template_id: "t-86eyu1w3d" },
      ]),
      json([{ part: "creative", list_id: "901818016338" }]),
    ],
  );
}
/** The request one answer made: its row, each part's queue payload by part, and its audit row. */
async function requestOf(responseId: string, type: string) {
  const request = await one<Row>(
    "SELECT to_jsonb(q) AS r FROM public.cockpit_requests q WHERE q.form_response_id = $1 AND q.type_key = $2",
    [responseId, type],
  );
  const parts = (
    await db.query<Row>(
      `SELECT p.part, q.payload FROM public.cockpit_request_parts p
         JOIN public.cockpit_clickup_writeback_queue q ON q.id = p.queue_id
        WHERE p.request_id = $1 ORDER BY p.part`,
      [request.id],
    )
  ).rows;
  const audit = await one<Row>(
    `SELECT jsonb_build_object('after', a.after, 'meta', a.metadata) AS r FROM public.cockpit_audit_log a
      WHERE a.action = 'request.submitted' AND a.entity_id = $1`,
    [request.id],
  );
  return {
    request,
    parts: Object.fromEntries(parts.map(p => [p.part, p.payload])) as Record<string, Row>,
    audit,
  };
}

describe("the onboarding tasks carry the handoff to the request writer; the Brand DNA task carries no text", () => {
  test("a native kickoff: the planner hands the handoff to the request, which keeps it whole for each task's comment (Make 12 [18], [23])", async () => {
    await rolledBack(async () => {
      await liveForms();
      await billing();
      await readModel({ form_id: "native", answers: CARD_ONBOARDING });
      const id = await nativeResponse("kickoff", {
        ...NATIVE_KICKOFF,
        detailsFix: "ملاحظة ".repeat(400).trim(),
        whatsappAdd: "x".repeat(1500),
      });
      const input = await one<Row>(
        "SELECT public.cockpit_form_stage4_input($1) AS r",
        [id],
      );
      const made = evaluate([
        {
          id: "native",
          form: "kickoff",
          task: TASK,
          answers: input.answers,
          hiddenFrom: { source: "make13", onboarding: CARD_ONBOARDING },
        },
      ]).native;
      const [, task18, task23] = made.handoff as string[];
      expect(task23).toBe(task18);
      // Longer than a request's details may be (4,000 characters), as real handoffs are.
      expect(Array.from(task18).length).toBeGreaterThan(4000);

      const out = await one<Row>(
        "SELECT public.cockpit_form_stage4_plan($1, true) AS r",
        [id],
      );
      expect(out.live).toBe(true);
      expect(byKey(out.effects).onboarding_tasks).toMatchObject({
        owner: "cockpit",
        state: "delivered",
        reason: null,
      });
      const { request, parts, audit } = await requestOf(id, "client_onboarding");
      expect(request.task_comment).toBe(task18);
      // Until the request writer posts taskComment, each task's description keeps 20261102l's first
      // 4,000 characters of the handoff (the details, trimmed of spaces as a request's details are).
      const details = leftChars(task18, 4000).replace(/^ +| +$/g, "");
      expect(Array.from(details).length).toBeLessThan(Array.from(task18).length);
      expect(request.answers).toEqual({ details });
      expect(Object.keys(parts)).toEqual(["creative", "tech"]);
      for (const part of Object.values(parts)) {
        expect(part.taskComment).toBe(task18);
        expect(part.descriptionMarkdown).toBe(
          `**Client Onboarding** for Cedar Homes Invented\n\n${details}`,
        );
      }
      expect([
        parts.tech.listId,
        parts.tech.templateId,
        parts.creative.listId,
        parts.creative.templateId,
      ]).toEqual(["901816723190", "t-86ex8x9xw", "901818016338", "t-86eyu1w3d"]);
      // The audit row holds how long the comment is, not what it says.
      expect(audit.after).not.toHaveProperty("task_comment");
      expect(audit.after.answers).toEqual({ details });
      expect(audit.meta.taskCommentChars).toBe(Array.from(task18).length);
      // The plan again makes no second request.
      await one("SELECT public.cockpit_form_stage4_plan($1, true) AS r", [id]);
      expect(
        await one<number>("SELECT count(*)::int AS r FROM public.cockpit_requests"),
      ).toBe(1);
    });
  });

  test("a native onboarding answer: the Brand DNA task has no details and no comment, as Make 13 [46] writes no text", async () => {
    await rolledBack(async () => {
      const BRAND_DNA = { typeKey: "brand_dna", lines: ["Brand DNA task"] };
      for (const answers of [ONBOARDING, []])
        expect(
          byKey(await build({ ...onboardingInput(answers), formKey: "onboarding" }))
            .brand_dna_task.plan,
        ).toEqual(BRAND_DNA);
      await liveForms();
      await setting("onboarding.raw_titles", RAW_TITLES);
      await setting("stage4.templates", {
        rawAnswers: "Answers of {{client}}\n{{answers}}",
      });
      const id = await nativeResponse("onboarding", NATIVE_ONBOARDING);
      const input = await one<Row>(
        "SELECT public.cockpit_form_stage4_input($1) AS r",
        [id],
      );
      const made = evaluate([
        { id: "native", form: "onboarding", task: TASK, answers: input.answers },
      ]).native;
      expect(made.brandDna).toEqual({
        module: "clickup:createTaskInList",
        keys: [
          "assignees",
          "custom_fields",
          "due_date_time",
          "folder_id",
          "list_id",
          "name",
          "notify_all",
          "space_id",
          "start_date_time",
          "team_id",
        ],
      });
      expect(byKey(await build(input)).brand_dna_task.plan).toEqual(BRAND_DNA);
      // 20261102l wrote the raw answers there, through stage4.templates when it was set.
      expect(
        byKey(await build(input, "_l")).brand_dna_task.plan.details,
      ).toStartWith("Answers of Cedar Homes Invented\n");

      const out = await one<Row>(
        "SELECT public.cockpit_form_stage4_plan($1, true) AS r",
        [id],
      );
      expect(byKey(out.effects).brand_dna_task).toMatchObject({
        owner: "cockpit",
        state: "delivered",
        reason: null,
      });
      const { request, parts, audit } = await requestOf(id, "brand_dna");
      expect([request.answers, request.task_comment]).toEqual([{}, null]);
      expect(Object.keys(parts)).toEqual(["creative"]);
      expect(parts.creative).not.toHaveProperty("taskComment");
      expect(parts.creative.descriptionMarkdown).toBe(
        "**Brand DNA** for Cedar Homes Invented",
      );
      expect(audit.meta).not.toHaveProperty("taskCommentChars");
    });
  });
});

// --- Everything else is 20261102l's ---------------------------------------------------------------

/** A list answer with its options in one order, whichever order they were ticked in. */
const anyOrder = (value: string) => value.split(", ").sort().join(", ");
/**
 * An effect with the parts 20261102m changes taken out: the five texts, the onboarding tasks' comment
 * (20261102l's cut copy in details), the Brand DNA task's details (none now) and the order of a list
 * in the read model (as ticked now, the form's option order in 20261102l).
 */
function unlisted(effects: Row[]): Row[] {
  return effects.map(e => {
    const x = structuredClone(e);
    if (x.key === "handoff_comment") {
      delete x.plan.comment_text;
      delete x.plan.lines;
    }
    if (x.key === "onboarding_tasks") {
      delete x.plan.details;
      delete x.plan.comment_text;
    }
    if (x.key === "card_fields") {
      x.plan.fields = x.plan.fields.filter(
        (f: Row) => f.fieldId !== SERVICE_FIELD,
      );
      x.plan.lines = x.plan.lines.filter(
        (l: string) => !l.startsWith("Service Advertised: "),
      );
    }
    if (x.key === "profile_fields") {
      delete x.plan.fields[0].value;
      x.plan.lines = x.plan.lines.slice(1);
    }
    if (x.key === "raw_answers_comment") {
      delete x.plan.comment_text;
      delete x.plan.lines;
      delete x.missing;
    }
    if (x.key === "github_dispatch") delete x.plan.payload.client;
    if (x.key === "read_model")
      x.plan.entry.answers = x.plan.entry.answers.map((y: Answer) => ({
        ...y,
        value: anyOrder(y.value),
      }));
    if (x.key === "brand_dna_task") delete x.plan.details;
    return x;
  });
}

describe("every effect not named is 20261102l's, byte for byte", () => {
  const SETUPS: [string, Row][] = [
    ["nothing set up", {}],
    [
      "maps, texts and templates set up",
      {
        "onboarding.map_urls": {
          3: "https://mahara-onboarding-map.vercel.app/?phase=3&cid={task}",
          4: "https://mahara-onboarding-map.vercel.app/?phase=4&cid={task}",
        },
        "stage4.messages": {
          phase3: "هلا فريق {client}، شوفوا الخريطة: {map_link}",
          phase4: "هلا فريق {client}، المرحلة الرابعة: {map_link}",
        },
        "stage4.templates": {
          handoff: "Handoff for {{client}}: {{answers}}",
          profile: "Revenue {{answer:7ff5d37a-df7f-4002-8248-d0b4af6c28e8}}",
          rawAnswers: "Answers of {{client}}\n{{answers}}",
        },
        "onboarding.raw_titles": RAW_TITLES,
      },
    ],
  ];
  const KICKOFF_INPUTS: Row[] = [
    {
      ...kickoffInput(KICKOFF),
      newMrrUsd: 2500,
      cardMrr: 1000,
      cardOnSheet: true,
      responseId: "r1",
    },
    {
      ...kickoffInput(KICKOFF),
      newMrrUsd: 0,
      cardMrr: null,
      cardOnSheet: true,
      second: true,
    },
    {
      ...kickoffInput(
        [a(K.contract, "Not sent yet"), a(K.service, "Other")],
        {},
      ),
      cardOnSheet: false,
    },
    { ...kickoffInput([]), newMrrUsd: 1000, cardMrr: 1000, cardOnSheet: true },
  ].map(x => ({ ...x, formKey: "kickoff" }));
  const ONBOARDING_INPUTS: Row[] = [
    {
      ...onboardingInput(ONBOARDING),
      readModelFormId: "native",
      readModelResponseId: "r2",
    },
    { ...onboardingInput([]), client: null },
    {
      ...onboardingInput([a(O.businessName, "Cedar Homes Invented")]),
      hidden: { legal_name: "x" },
    },
  ].map(x => ({ ...x, formKey: "onboarding" }));

  for (const [name, settings] of SETUPS)
    test(`the builder and the parity plan, ${name}`, async () => {
      await rolledBack(async () => {
        for (const [key, value] of Object.entries(settings))
          await setting(key, value);
        for (const input of [...KICKOFF_INPUTS, ...ONBOARDING_INPUTS]) {
          const now = await build(input);
          const was = await build(input, "_l");
          expect(now.map(e => e.key)).toEqual(was.map(e => e.key));
          expect(unlisted(now)).toEqual(unlisted(was));
        }
        for (const [form, input] of [
          ["kickoff", kickoffInput(KICKOFF)],
          [
            "kickoff",
            kickoffInput([a(K.service, "Landscaping, Interior design")]),
          ],
          ["onboarding", onboardingInput(ONBOARDING)],
        ] as const) {
          const now = await parity(form, input);
          const was = await parity(form, input, "_l");
          expect(now.unmapped).toEqual(was.unmapped);
          expect(unlisted(now.effects)).toEqual(unlisted(was.effects));
        }
      });
    });

  test("the answers list keeps every list as it was ticked, for both forms; every other answer is 20261102j's", async () => {
    const lists = (form: string, answers: unknown) =>
      Promise.all(
        ["", "_l"].map(s =>
          one<Answer[]>(
            `SELECT public.cockpit_form_stage4_typeform_answers${s}($1, $2::jsonb) AS r`,
            [form, json(answers)],
          ),
        ),
      );
    const [onbNow, onbWas] = await lists("onboarding", {
      ...NATIVE_ONBOARDING,
      appointmentTypes: ["office", "onsite", "online", "office", "nowhere"],
      facebookAds: "unsure",
    });
    const appt = (list: Answer[]) =>
      list.find(x => x.ref === O.appointments)?.value;
    // Each option once, where it was first ticked; an answer that is not an option is left out.
    expect([appt(onbNow), appt(onbWas)]).toEqual([
      `${APPT.office}, ${APPT.onsite}, ${APPT.online}`,
      `${APPT.online}, ${APPT.onsite}, ${APPT.office}`,
    ]);
    expect(onbNow.filter(x => x.ref !== O.appointments)).toEqual(
      onbWas.filter(x => x.ref !== O.appointments),
    );
    const [kNow, kWas] = await lists("kickoff", {
      ...NATIVE_KICKOFF,
      serviceAdvertised: ["Fit out and renovation", "Design and build", "Fit out and renovation", "Villas"],
    });
    const service = (list: Answer[]) =>
      list.find(x => x.ref === K.service)?.value;
    expect([service(kNow), service(kWas)]).toEqual([
      "Fit out and renovation, Design and build",
      "Design and build, Fit out and renovation",
    ]);
    // 20261102j has no question for the follow-ups, so it leaves them out.
    expect(
      kNow.filter(
        x =>
          ![K.service, K.consult, K.detailsWrong, K.contractChanges].includes(
            x.ref as any,
          ),
      ),
    ).toEqual(kWas.filter(x => x.ref !== K.service && x.ref !== K.consult));
  });
});
