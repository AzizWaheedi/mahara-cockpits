/**
 * Stage 4 writes what Make writes (20261102o_stage4_match_make.sql; docs/forms/WAVE56-CONTRACT.md
 * 4.13.3, 4.14.3, 4.15.1 and the D-S4F findings; the CEO's decision of 2026-11-02: "Yes, match Make").
 *
 * The functions 20261102o reads or replaces are cut from their canonical migrations (20260921a,
 * 20261025n, 20261026r, 20261027f, 20261029s, 20261029w, 20261102a, 20261102i, 20261102j, 20261102l),
 * the way stage4-content-folder-supabase.test.ts stands on what j reads, and the ground proves each
 * replaced body is the live one (20261102l's for the builder) by the md5 the file's drift guard names,
 * and the onboarding's version 2 is 20261102j's by the md5 of its text. Stand-in tables give
 * cockpit_form_stage4_input, cockpit_form_stage4_hidden, the planner, cockpit_request_create_system and
 * the version-2 guard the columns they read, and a stand-in cockpit_request_plan gives each request
 * part a payload (its description from the request's details, as the real one writes them).
 * 20261102l's builder and j's question list, hidden values, Typeform answers list, native answers,
 * input, parity plan and kickoff answers check are also kept under a _l name, and 20261102i's two client
 * form checks under an _i name, so every effect and every other form is compared with what it was.
 *
 * Make's side is scripts/dev/make_parity.py's evaluator (python3), run on the saved blueprints and
 * Typeform definitions in scripts/dev/fixtures/make-parity: for the same answers the SQL text must
 * equal the evaluator's for the handoff (Make 12 [11]) and the comment on each onboarding task ([18],
 * [23], kept whole on the request and in each part's queue payload, the task carrying no details),
 * Service Advertised ([21]), the kickoff's hidden values (Make 13 [29]'s Kickoff Form Link), the raw
 * answers comment (Make 13 [47]), the Client Profile ([29], never cut) and the dispatch ([25]); the
 * Brand DNA task carries no text, as [46] writes none. A native answer keeps what was typed as Typeform
 * keeps it (line breaks as line feeds, both ends trimmed, everything between as typed): the client
 * onboarding's answers check and the kickoff's long texts, so multi-line Arabic and English answers,
 * double spaces and carriage returns typed natively give the texts Make writes for the same typing.
 * The onboarding's version 2 asks what KFRCXPFx typed (13): the revenues are numbers, printed as Make
 * prints Typeform's, the four links https, and each phone is stored as E.164. The writeback queue's
 * audit trigger (20261026t's, live; 20261009f's triggers on the stand-in queue) keeps a request part's
 * comment as its length (14), and a kickoff's answers have 256 KB, past which the check refuses them by
 * name (15; the stand-in responses table carries 20261102f's answers check, live). The onboarding
 * Typeform door (20261102j's, live, with its live grant) stores a late KFRCXPFx delivery in the portal's
 * shape, each revenue a number (16; stand-ins give it what it reads beside this ground).
 * Every client, card, person and answer is invented.
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
const I = "20261102i_client_tail.sql";
const J = "20261102j_stage4_native.sql";
const L = "20261102l_stage4_no_client_data_row.sql";
// M (and BEFORE_M, AFTER_M, V2_M_MD5 below) keeps the letter the file was first drafted under: the goals
// sheet's 20261102m reached live first (2026-11-02), so match Make is 20261102o.
const M = "20261102o_stage4_match_make.sql";
const TITLES_FILE = "scripts/dev/forms-deploy/stage4-raw-titles.json";
/** onboarding.raw_titles as D-S4F fills it. */
const RAW_TITLES = JSON.parse(readFileSync(`${ROOT}${TITLES_FILE}`, "utf8"));

/**
 * md5(whitespace folded prosrc) of the bodies 20261102o replaces, as live holds them (read 2026-11-02:
 * 20261102i's two client form checks, 20261102j's kickoff answers check and onboarding Typeform door)
 * and 20261102l's builder.
 */
const BEFORE_M = {
  "cockpit_form_stage4_fields(text)": "8c36fd1cf1b0a60b0c776241765eddf7",
  "cockpit_form_stage4_hidden(text)": "cb8d434b635091957a15c7ca96652848",
  "cockpit_form_stage4_typeform_answers(text,jsonb)":
    "97ec3ad0bb4d2282c518be1447d4f262",
  "cockpit_form_stage4_build(jsonb)": "7e5f7fdaadc74983367cd07bd8c56e3c",
  "cockpit_request_create_system(text,text,jsonb,uuid)":
    "295e926095e7832e7d7a220b4d233a23",
  "cockpit_form_stage4_plan(uuid,boolean)": "cb27a3730e539bcfbb46dea136af96ae",
  "cockpit_form_schema_check(jsonb)": "1f5d9016571ed472b83dbffa17363095",
  "cockpit_form_answers_check(jsonb,jsonb,jsonb)":
    "d1d8bb66ae056415f8a2a968627220df",
  "cockpit_kickoff_answers_check(jsonb)": "8a02898fe501f501b7f7cc8653453db6",
  "cockpit_clickup_writeback_audit()": "d595491be9d1cac3e385382a2e84814a",
  "cockpit_form_onboarding_typeform(jsonb)": "25a794296916c1e01447633d308cecc7",
} as const;
/** 20261102o's own bodies (the after values of its drift guard). */
const AFTER_M = {
  "cockpit_form_stage4_fields(text)": "2b874cb1ed7fcf92a3d7fd9ca00547c5",
  "cockpit_form_stage4_hidden(text)": "c43644ee277f532770e523e61e389aad",
  "cockpit_form_stage4_typeform_answers(text,jsonb)":
    "c9ad150b861d72d497ccb6f3af16cf7e",
  "cockpit_form_stage4_build(jsonb)": "a565db2d881852ff3a1481a438768e20",
  "cockpit_request_create_system(text,text,jsonb,uuid)":
    "45207dde9903fee3c1d0aa0b20eea18f",
  "cockpit_form_stage4_plan(uuid,boolean)": "1b13ba4315097727973c4bff54f027c3",
  "cockpit_form_schema_check(jsonb)": "07f88396a8df9e1b2b42f41b5c3e189a",
  "cockpit_form_answers_check(jsonb,jsonb,jsonb)":
    "ac54af52c93ca8f2517a5f55b507cfa7",
  "cockpit_kickoff_answers_check(jsonb)": "8c3045bcdcf0906294d78d9ca7377a9b",
  "cockpit_clickup_writeback_audit()": "4127726aa23cffe1ce78fc5ceafb8292",
  "cockpit_form_onboarding_typeform(jsonb)": "ddefa9130061bc21b8b05c882d778d72",
} as const;
/** The trigger function 20261102o replaces that keeps its live grant (service_role), as 20261026t left it. */
const AUDIT_FN = "cockpit_clickup_writeback_audit()";
/** The onboarding Typeform door (X26), which keeps its live grant (service_role, forms-door), as 20261102j left it. */
const DOOR_FN = "cockpit_form_onboarding_typeform(jsonb)";
/** md5 of the onboarding's version-2 schema text: 20261102j's (live, read 2026-11-02) and 20261102o's. */
const V2_J_MD5 = "8fa1f38dfd4307f22d0b3faec8604ce7";
const V2_M_MD5 = "bc89ca36000ebf7943c6ec569cd1be73";
/** 20261102j's builder, live before 20261102l. */
const J_BUILD_MD5 = "a704e72a3921191d2f06a24855d7f219";
/**
 * cockpit_form_effects_plan_check, white space folded: 20261027f's (live, read 2026-11-02) and 20261102o's,
 * which gives a kickoff or onboarding plan 2 MB.
 */
const ROOM_F =
  "CHECK (((jsonb_typeof(plan) = 'object'::text) AND (octet_length((plan)::text) <= 131072)))";
const ROOM_M =
  "CHECK (((jsonb_typeof(plan) = 'object'::text) AND (octet_length((plan)::text) <= CASE WHEN (form_key = ANY (ARRAY['kickoff'::text, 'onboarding'::text])) THEN 2097152 ELSE 131072 END)))";
/**
 * cockpit_form_responses_answers_check, white space folded: 20261102f's (live, read 2026-11-02, word for word)
 * and 20261102o's, which gives a kickoff's answers 256 KB (15).
 */
const ANSWERS_F =
  "CHECK (((jsonb_typeof(answers) = 'object'::text) AND (octet_length((answers)::text) <= CASE WHEN (form_key = ANY (ARRAY['new_client'::text, 'onboarding'::text])) THEN 1048576 ELSE 65536 END)))";
const ANSWERS_M =
  "CHECK (((jsonb_typeof(answers) = 'object'::text) AND (octet_length((answers)::text) <= CASE WHEN (form_key = ANY (ARRAY['new_client'::text, 'onboarding'::text])) THEN 1048576 WHEN (form_key = 'kickoff'::text) THEN 262144 ELSE 65536 END)))";
/** The reason a step gets when its plan is past the 2 MB the table keeps (20261102o, 12). */
const TOO_LARGE =
  "This step carries more than the 2 MB the cockpit keeps for one step, so it did not run. Do it by hand from the stored answers.";
const NEW_FNS = [
  "cockpit_form_typeform_text(text)",
  "cockpit_form_stage4_make_text(text,text)",
  "cockpit_form_stage4_handoff_text(jsonb,jsonb)",
  "cockpit_form_stage4_profile_text(jsonb)",
  "cockpit_form_stage4_raw_answers_text(jsonb,jsonb)",
  "cockpit_form_stage4_numbers(jsonb,jsonb)",
] as const;
/** j's bodies 20261102o keeps (live, read 2026-11-02): they read the replaced readers by name. */
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
/** Answers typed over several lines, with double spaces and a space before a line break (invented). */
const MULTI_AR = "نشتغل على:\nالفلل  الجديدة \n\nوالشقق في الشمال";
const MULTI_EN = "Instagram ads in 2024 \nGoogle ads  in 2025\n\n- flyers";

type Row = Record<string, any>;
type Answer = { ref: string; title: string; value: string };
const a = (ref: string, value: string, title = "Stored title"): Answer => ({
  ref,
  title,
  value,
});
const json = (v: unknown) => JSON.stringify(v);
/** What Typeform keeps of a typed answer and hands to Make: line feeds for line breaks, both ends trimmed. */
const kept = (typed: string) => typed.replace(/\r\n?/g, "\n").trim();

let db: PGlite;
const groundMd5: Record<string, string> = {};
let groundRoom = "";
let groundAnswersRoom = "";

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
/** cockpit_form_effects_plan_check with its white space folded, as 20261102o's guard reads it. */
const planCheck = () =>
  one<string>(
    `SELECT regexp_replace(pg_get_constraintdef(c.oid), '\\s+', ' ', 'g') AS r FROM pg_constraint c
      WHERE c.conrelid = 'public.cockpit_form_effects'::regclass AND c.conname = 'cockpit_form_effects_plan_check'`,
  );
/** cockpit_form_responses_answers_check with its white space folded, as 20261102o's guard reads it. */
const answersCheck = () =>
  one<string>(
    `SELECT regexp_replace(pg_get_constraintdef(c.oid), '\\s+', ' ', 'g') AS r FROM pg_constraint c
      WHERE c.conrelid = 'public.cockpit_form_responses'::regclass AND c.conname = 'cockpit_form_responses_answers_check'`,
  );
/** md5 of the onboarding's version-2 schema text, as 20261102o's guard reads it. */
const v2Md5 = () =>
  one<string>(
    "SELECT md5(schema::text) AS r FROM public.cockpit_form_versions WHERE form_key = 'onboarding' AND version = 2",
  );
const v2Schema = () =>
  one<Row>(
    "SELECT schema AS r FROM public.cockpit_form_versions WHERE form_key = 'onboarding' AND version = 2",
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
       "kickoff": [{"ref": f["ref"], "title": f["title"], "type": f["type"]} for f in mp.question_fields(kick)],
       "onboarding": [{"ref": f["ref"], "type": f["type"]} for f in mp.question_fields(onb)]}
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
/** An onboarding answer as Typeform hands it to Make when the client typed over several lines. */
const MULTI_LINE: Answer[] = [
  a(O.address, "قطعة ٣\nشارع ٢٠، منزل ٧"),
  a(O.hours, "Sat to Thu  9-5\nFriday closed"),
  a(O.marketing, MULTI_AR),
  a(O.challenges, MULTI_EN),
  a(O.whyJoined, "We want  steady\nconsultations."),
  a(O.additional, "سؤال:\n  متى نبدأ؟"),
];

// --- The ground ----------------------------------------------------------------------------------

/**
 * The columns cockpit_form_stage4_input, cockpit_form_stage4_hidden, the planner and
 * cockpit_request_create_system read (stand-ins), with the effects' plan check as 20261027f made it (live,
 * read 2026-11-02; 20261102o widens it), and the request plan as each part's payload: its description is
 * the type's heading and the request's details, as cockpit_request_plan writes them.
 */
const STAND_INS = `
  CREATE TABLE public.cockpit_form_responses (id uuid PRIMARY KEY, form_key text, form_version integer, source text,
    external_id text, task_id text, client_name text, mode text, state text, answers jsonb, answer_meta jsonb,
    hidden jsonb, submitted_at timestamptz, created_by_id uuid, created_at timestamptz NOT NULL DEFAULT now());
  CREATE TABLE public.cockpit_billing_accounts (clickup_task_id text PRIMARY KEY, client_name text, mrr_usd numeric);
  CREATE TABLE public.cockpit_client_onboarding (clickup_task_id text PRIMARY KEY, client_name text, forms jsonb,
    synced_at timestamptz);
  CREATE TABLE public.cockpit_forms (key text PRIMARY KEY, provider text, effects jsonb, version integer, schema jsonb,
    updated_by text, updated_at timestamptz);
  CREATE TABLE public.cockpit_form_versions (form_key text, version integer, schema jsonb, published_by text, note text,
    PRIMARY KEY (form_key, version));
  CREATE TABLE public.cockpit_form_invites (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), form_key text, form_version integer,
    state text);
  CREATE TABLE public.cockpit_form_effects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), response_id uuid, form_key text,
    effect_key text, dedupe_key text, owner text, delivery text,
    plan jsonb CHECK (jsonb_typeof(plan) = 'object' AND octet_length(plan::text) <= 131072), state text, reason text,
    delivery_ref text, receipt jsonb, UNIQUE (response_id, effect_key));
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
  // What the client form checks call.
  ["20261027f_forms_core.sql", "cockpit_form_kuwait_day"],
  ["20261102a_forms_invites.sql", "cockpit_form_schema_pair"],
];
/** 20261102i's client form checks (live), which 20261102o replaces. */
const I_FNS = ["cockpit_form_schema_check", "cockpit_form_answers_check"] as const;
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
  "cockpit_form_onboarding_typeform",
] as const;
/** 20261102l's plan and 20261102j's kickoff answers check, under _l names, beside 20261102o's. */
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
      "cockpit_kickoff_answers_check",
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
    fnDef(j, "cockpit_kickoff_answers_check"),
  ]
    .map(rename)
    .join("\n\n");
}
/** 20261102i's client form checks under _i names, beside 20261102o's. */
const keptAsI = (i: string) =>
  I_FNS.map(name =>
    fnDef(i, name).replace(`FUNCTION public.${name}(`, `FUNCTION public.${name}_i(`),
  ).join("\n\n");
/** The onboarding's version 2 as 20261102j inserts it (live). */
const V2_INSERT = cut(
  migration(J),
  /INSERT INTO public\.cockpit_form_versions\(form_key, version, schema, published_by, note\)\nVALUES \('onboarding', 2,[\s\S]*?ON CONFLICT \(form_key, version\) DO NOTHING;/,
  "onboarding version 2",
);

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
  // The responses table's answers check as live holds it: 20261027f's, then 20261102f's.
  await db.exec(
    "ALTER TABLE public.cockpit_form_responses ADD CONSTRAINT cockpit_form_responses_answers_check CHECK (jsonb_typeof(answers) = 'object' AND octet_length(answers::text) <= 65536)",
  );
  await db.exec(inTest("20261102f_form_responses_answer_size.sql"));
  // The writeback queue's audit trigger as live holds it (20261026t's body, 20261009f's grant and triggers).
  await db.exec(fnDef(migration("20261026t_task_alerts.sql"), "cockpit_clickup_writeback_audit"));
  const f9 = migration("20261009f_clickup_writeback_native.sql");
  await db.exec(
    cut(f9, /REVOKE ALL ON FUNCTION public\.cockpit_clickup_writeback_audit\(\) FROM PUBLIC,anon,authenticated;/, "audit grant"),
  );
  for (const name of ["insert", "state"])
    await db.exec(
      cut(
        f9,
        new RegExp(
          `DROP TRIGGER IF EXISTS cockpit_clickup_writeback_queue_audit_${name} ON public\\.cockpit_clickup_writeback_queue;\\nCREATE TRIGGER[\\s\\S]*?EXECUTE FUNCTION public\\.cockpit_clickup_writeback_audit\\(\\);`,
        ),
        `queue audit trigger ${name}`,
      ),
    );
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
  // The door's grant as 20261102j leaves it (live: the owner and service_role, for forms-door).
  await db.exec(
    `REVOKE ALL ON FUNCTION public.${DOOR_FN} FROM PUBLIC, anon, authenticated, service_role;
     GRANT EXECUTE ON FUNCTION public.${DOOR_FN} TO service_role;`,
  );
  const l = migration(L);
  await db.exec(fnDef(l, "cockpit_form_stage4_effects"));
  await db.exec(fnDef(l, "cockpit_form_stage4_build"));
  await db.exec(keptAsL(j, l));
  const i = migration(I);
  for (const name of I_FNS) await db.exec(fnDef(i, name));
  await db.exec(keptAsI(i));
  await db.exec(V2_INSERT);
  for (const fn of [...Object.keys(BEFORE_M), ...Object.keys(KEPT_J)])
    groundMd5[fn] = await md5Of(fn);
  groundMd5.v2 = await v2Md5();
  groundRoom = await planCheck();
  groundAnswersRoom = await answersCheck();
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

describe("20261102o: the file", () => {
  test("the ground holds the bodies the drift guard names: live's, and 20261102l's builder", () => {
    expect(groundMd5).toEqual({ ...BEFORE_M, ...KEPT_J, v2: V2_J_MD5 });
    const sql = migration(M);
    for (const [fn, md5] of Object.entries(BEFORE_M))
      expect(sql).toContain(`('public.${fn}', '${md5}', '`);
    for (const fn of Object.keys(KEPT_J))
      expect(sql).not.toContain(`FUNCTION public.${fn.split("(")[0]}(`);
    expect(sql).toContain(`v_md5 NOT IN ('${V2_J_MD5}', '${V2_M_MD5}')`);
  });

  test("the after values are this file's bodies; a second apply changes nothing; j's input and parity plan stay", async () => {
    const sql = migration(M);
    for (const fn of Object.keys(BEFORE_M)) {
      const now = await md5Of(fn);
      expect(now).toBe(AFTER_M[fn as keyof typeof AFTER_M]);
      expect(
        sql.split("\n").find(x => x.includes(`('public.${fn}', '`)),
      ).toContain(`', '${now}')`);
      expect(now).not.toBe(BEFORE_M[fn as keyof typeof BEFORE_M]);
    }
    expect(await v2Md5()).toBe(V2_M_MD5);
    for (const [fn, md5] of Object.entries(KEPT_J))
      expect(await md5Of(fn)).toBe(md5);
    const snapshot = async () => ({
      md5: await Promise.all(
        [...Object.keys(BEFORE_M), ...NEW_FNS].map(fn => md5Of(fn)),
      ),
      v2: await v2Md5(),
      titles: await one(
        "SELECT value AS r FROM public.cockpit_settings WHERE key = 'onboarding.raw_titles'",
      ),
      column: await one(
        `SELECT format_type(a.atttypid, a.atttypmod) AS r FROM pg_attribute a
          WHERE a.attrelid = 'public.cockpit_requests'::regclass AND a.attname = 'task_comment' AND NOT a.attisdropped`,
      ),
      room: await planCheck(),
      answersRoom: await answersCheck(),
    });
    await rolledBack(async () => {
      await setting("onboarding.raw_titles", RAW_TITLES);
      // A response on version 2 after this file changes nothing either: the guard reads it only on j's.
      await db.query(
        "INSERT INTO public.cockpit_form_invites(form_key, form_version, state) VALUES ('onboarding', 2, 'open')",
      );
      const before = await snapshot();
      await db.exec(inTest(M));
      expect(await snapshot()).toEqual(before);
      expect((before.titles as Row).fields).toHaveLength(36);
      expect(before.column).toBe("text");
      expect(before.room).toBe(ROOM_M);
      expect(before.answersRoom).toBe(ANSWERS_M);
    });
  });

  test("onboarding.raw_titles is seeded empty", async () => {
    expect(
      await one(
        "SELECT jsonb_build_object('value', value, 'by', updated_by) AS r FROM public.cockpit_settings WHERE key = 'onboarding.raw_titles'",
      ),
    ).toEqual({ value: {}, by: "migration 20261102o" });
  });

  test("a changed body stops the file; 20261102j's builder asks for 20261102l first", async () => {
    for (const fn of [
      "cockpit_form_stage4_typeform_answers(text,jsonb)",
      "cockpit_form_stage4_hidden(text)",
      "cockpit_request_create_system(text,text,jsonb,uuid)",
      "cockpit_form_answers_check(jsonb,jsonb,jsonb)",
      "cockpit_form_schema_check(jsonb)",
      "cockpit_kickoff_answers_check(jsonb)",
      AUDIT_FN,
      DOOR_FN,
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
        message: "Apply 20261102l before 20261102o.",
      });
    });
  });

  test("a kickoff or onboarding plan has 2 MB, every other form 128 KB as before; another check stops the file", async () => {
    expect(groundRoom).toBe(ROOM_F);
    expect(await planCheck()).toBe(ROOM_M);
    const sql = migration(M);
    for (const room of [ROOM_F, ROOM_M])
      expect(sql).toContain(`'${room.replace(/'/g, "''")}'`);
    // {"t": "x…x"} is the x's and 9 bytes.
    const effect = (form: string, bytes: number) =>
      db.query(
        `INSERT INTO public.cockpit_form_effects(response_id, form_key, effect_key, plan)
         VALUES (gen_random_uuid(), $1, 'x_y', jsonb_build_object('t', repeat('x', $2::int - 9)))`,
        [form, bytes],
      );
    for (const [form, room] of [
      ["kickoff", 2097152],
      ["onboarding", 2097152],
      ["checkin", 131072],
    ] as const) {
      await rolledBack(async () => {
        await effect(form, room);
        expect(
          await one<number>(
            "SELECT max(octet_length(plan::text)) AS r FROM public.cockpit_form_effects WHERE form_key = $1",
            [form],
          ),
        ).toBe(room);
      });
      await rolledBack(async () => {
        expect((await refusal(() => effect(form, room + 1))).code).toBe("23514");
      });
    }
    const swap = (check: string) =>
      db.exec(`ALTER TABLE public.cockpit_form_effects DROP CONSTRAINT cockpit_form_effects_plan_check;
        ALTER TABLE public.cockpit_form_effects ADD CONSTRAINT cockpit_form_effects_plan_check CHECK (${check})`);
    // 20261027f's check (live) becomes this file's.
    await rolledBack(async () => {
      await swap("jsonb_typeof(plan) = 'object' AND octet_length(plan::text) <= 131072");
      expect(await planCheck()).toBe(ROOM_F);
      await db.exec(inTest(M));
      expect(await planCheck()).toBe(ROOM_M);
    });
    // Any other check stops the file.
    await rolledBack(async () => {
      await swap("jsonb_typeof(plan) = 'object' AND octet_length(plan::text) <= 65536");
      expect(await refusal(() => db.exec(inTest(M)))).toEqual({
        code: "55000",
        message: "cockpit_form_effects_plan_check changed since 20261027f; stop and re-read it.",
      });
    });
  });

  test("a kickoff's answers have 256 KB, the New Client Form and the onboarding 1 MB and every other form 64 KB as before; another check stops the file", async () => {
    // The ground is 20261102f's check as live holds it, word for word.
    expect(groundAnswersRoom).toBe(ANSWERS_F);
    expect(await answersCheck()).toBe(ANSWERS_M);
    const sql = migration(M);
    for (const room of [ANSWERS_F, ANSWERS_M])
      expect(sql).toContain(`'${room.replace(/'/g, "''")}'`);
    // {"t": "x…x"} is the x's and 9 bytes.
    const answer = (form: string, bytes: number) =>
      db.query(
        `INSERT INTO public.cockpit_form_responses(id, form_key, answers)
         VALUES (gen_random_uuid(), $1, jsonb_build_object('t', repeat('x', $2::int - 9)))`,
        [form, bytes],
      );
    for (const [form, room] of [
      ["kickoff", 262144],
      ["onboarding", 1048576],
      ["new_client", 1048576],
      ["exit_survey", 65536],
    ] as const) {
      await rolledBack(async () => {
        await answer(form, room);
        expect(
          await one<number>(
            "SELECT max(octet_length(answers::text)) AS r FROM public.cockpit_form_responses WHERE form_key = $1",
            [form],
          ),
        ).toBe(room);
      });
      await rolledBack(async () => {
        expect((await refusal(() => answer(form, room + 1))).code).toBe("23514");
      });
    }
    const swap = (check: string) =>
      db.exec(`ALTER TABLE public.cockpit_form_responses DROP CONSTRAINT cockpit_form_responses_answers_check;
        ALTER TABLE public.cockpit_form_responses ADD CONSTRAINT cockpit_form_responses_answers_check CHECK (${check})`);
    // 20261102f's check (live) becomes this file's; a kickoff past 64 KB, refused before, is kept.
    await rolledBack(async () => {
      await swap(
        "jsonb_typeof(answers) = 'object' AND octet_length(answers::text) <= CASE WHEN form_key IN ('new_client', 'onboarding') THEN 1048576 ELSE 65536 END",
      );
      expect(await answersCheck()).toBe(ANSWERS_F);
      expect((await refusal(() => answer("kickoff", 65537))).code).toBe("23514");
    });
    await rolledBack(async () => {
      await swap(
        "jsonb_typeof(answers) = 'object' AND octet_length(answers::text) <= CASE WHEN form_key IN ('new_client', 'onboarding') THEN 1048576 ELSE 65536 END",
      );
      await db.exec(inTest(M));
      expect(await answersCheck()).toBe(ANSWERS_M);
      await answer("kickoff", 65537);
    });
    // Any other check stops the file.
    await rolledBack(async () => {
      await swap("jsonb_typeof(answers) = 'object' AND octet_length(answers::text) <= 65536");
      expect(await refusal(() => db.exec(inTest(M)))).toEqual({
        code: "55000",
        message: "cockpit_form_responses_answers_check changed since 20261102f; stop and re-read it.",
      });
    });
  });

  test("the onboarding's version 2 changes in place only from 20261102j's and only while nothing uses it", async () => {
    const jV2 = async () => {
      await db.query(
        "DELETE FROM public.cockpit_form_versions WHERE form_key = 'onboarding' AND version = 2",
      );
      await db.exec(V2_INSERT);
      expect(await v2Md5()).toBe(V2_J_MD5);
    };
    // From 20261102j's: exactly this file's.
    await rolledBack(async () => {
      await jV2();
      await db.exec(inTest(M));
      expect(await v2Md5()).toBe(V2_M_MD5);
    });
    // A version 2 already answered, or with an open invite, stops the file.
    for (const use of [
      "INSERT INTO public.cockpit_form_responses(id, form_key, form_version, task_id) VALUES (gen_random_uuid(), 'onboarding', 2, 'taskX')",
      "INSERT INTO public.cockpit_form_invites(form_key, form_version, state) VALUES ('onboarding', 2, 'open')",
    ])
      await rolledBack(async () => {
        await jV2();
        await db.query(use);
        expect(await refusal(() => db.exec(inTest(M)))).toEqual({
          code: "55000",
          message:
            "The onboarding form's version 2 is in use (1 answers and invites), so it cannot change in place: stop, and give its long texts and limits a version 3 instead.",
        });
      });
    // A version 2 that is neither, or none, stops it.
    for (const change of [
      "UPDATE public.cockpit_form_versions SET schema = schema || '{\"minutes\": 30}' WHERE form_key = 'onboarding' AND version = 2",
      "DELETE FROM public.cockpit_form_versions WHERE form_key = 'onboarding' AND version = 2",
    ])
      await rolledBack(async () => {
        await db.query(change);
        expect(await refusal(() => db.exec(inTest(M)))).toEqual({
          code: "55000",
          message:
            "The onboarding form's version 2 changed since 20261102j; stop and re-read it.",
        });
      });
    // The registry's copy changes with it when the form is already live on version 2 with j's.
    await rolledBack(async () => {
      await jV2();
      await db.query(
        `INSERT INTO public.cockpit_forms(key, provider, version, schema)
         SELECT 'onboarding', 'native', 2, schema FROM public.cockpit_form_versions WHERE form_key = 'onboarding' AND version = 2`,
      );
      await db.exec(inTest(M));
      expect(
        await one(
          "SELECT jsonb_build_object('md5', md5(schema::text), 'by', updated_by) AS r FROM public.cockpit_forms WHERE key = 'onboarding'",
        ),
      ).toEqual({ md5: V2_M_MD5, by: "migration 20261102o" });
    });
  });

  test("the owner runs every function it makes or replaces, and nobody else; the queue's audit trigger and the Typeform door keep their live grants", async () => {
    const granted = async (fns: string[]) =>
      Object.entries(
        await one<Row>(
          `SELECT jsonb_object_agg(f || ':' || r, has_function_privilege(r, 'public.' || f, 'EXECUTE')) AS r
             FROM unnest($1::text[]) f, unnest(ARRAY['anon','authenticated','service_role']) r`,
          [fns],
        ),
      )
        .filter(([, v]) => v)
        .map(([k]) => k);
    expect(
      await granted([...Object.keys(BEFORE_M).filter(fn => fn !== AUDIT_FN && fn !== DOOR_FN), ...NEW_FNS]),
    ).toEqual([]);
    // 20261009f revoked it from PUBLIC, anon and authenticated; service_role keeps it, as live.
    expect(await granted([AUDIT_FN])).toEqual([`${AUDIT_FN}:service_role`]);
    // forms-door calls it with the service key, as 20261102j granted it.
    expect(await granted([DOOR_FN])).toEqual([`${DOOR_FN}:service_role`]);
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
    // The 41 keep their order and words; only Post call form filled changes, to tG7dnxBn's yes/no, and
    // Who else should we add to the WhatsApp group, to tG7dnxBn's long text.
    expect(keys.filter(k => was.some(w => w.key === k))).toEqual(
      was.map(w => w.key),
    );
    for (const w of was)
      expect(now.find(f => f.key === w.key)).toEqual(
        w.key === "postCallFormFilled"
          ? { ...w, type: "choice", options: ["Yes", "No"] }
          : w.key === "whatsappAdd"
            ? { ...w, type: "longtext" }
            : w,
      );
    const made = evaluate([]);
    const tf = made.kickoff as Row[];
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
    // Every question tG7dnxBn asks as long_text is a long text here.
    for (const x of tf.filter(y => y.type === "long_text"))
      expect([x.ref, now.find(f => f.typeformRef === x.ref).type]).toEqual([
        x.ref,
        "longtext",
      ]);
    // The onboarding's 36: the four KFRCXPFx asks as long_text that 20261102j made short are long texts.
    const onb = await one<Row[]>(
      "SELECT public.cockpit_form_stage4_fields('onboarding') AS r",
    );
    const onbWas = await one<Row[]>(
      "SELECT public.cockpit_form_stage4_fields_l('onboarding') AS r",
    );
    const retyped = ["address", "hours", "landmark", "appointmentLength"];
    expect(onb).toEqual(
      onbWas.map(w => (retyped.includes(w.key) ? { ...w, type: "longtext" } : w)),
    );
    expect(onbWas.filter(w => retyped.includes(w.key)).map(w => w.type)).toEqual(
      ["text", "text", "text", "text"],
    );
    for (const x of (made.onboarding as Row[]).filter(y => y.type === "long_text"))
      expect([x.ref, onb.find(f => f.typeformRef === x.ref).type]).toEqual([
        x.ref,
        "longtext",
      ]);
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

  test("the answers check keeps a long text as Typeform keeps it, and still folds a short one", async () => {
    const check = (answers: Row, suffix = "") =>
      one<Row>(
        `SELECT public.cockpit_kickoff_answers_check${suffix}($1::jsonb) AS r`,
        [json({ newMrrUsd: 0, ...answers })],
      );
    const typed = {
      whatsappAdd: "\r\n  المدير الفني\r\nوفريق  المبيعات (Sales team)\r\n\n",
      detailsFix: " First line  \n\n  second line\u00a0",
      contractChanges: `\u3000${"x".repeat(4000)}\n`,
      adPlatforms: "Tiktok,\n  Snapchat ",
    };
    expect(await check(typed)).toEqual({
      ok: true,
      errors: {},
      answers: {
        whatsappAdd: "المدير الفني\nوفريق  المبيعات (Sales team)",
        detailsFix: "First line  \n\n  second line",
        contractChanges: "x".repeat(4000),
        adPlatforms: "Tiktok, Snapchat",
        newMrrUsd: 0,
      },
    });
    // Each kept text is what JavaScript's trim() keeps of it, its carriage returns read as line feeds.
    for (const key of ["whatsappAdd", "detailsFix", "contractChanges"] as const)
      expect((await check(typed)).answers[key]).toBe(kept(typed[key]));
    // 20261102j folded every long text's ends only of spaces and its short whatsappAdd to one line.
    expect((await check(typed, "_l")).answers).toMatchObject({
      whatsappAdd: "المدير الفني وفريق المبيعات (Sales team)",
      adPlatforms: "Tiktok, Snapchat",
    });
    // A long text takes 4,000 characters (whatsappAdd took 500 as a short text); white space alone is no answer.
    expect(await check({ whatsappAdd: "y".repeat(4000) })).toMatchObject({ ok: true });
    expect(await check({ whatsappAdd: "y".repeat(501) }, "_l")).toMatchObject({
      ok: false,
      errors: { whatsappAdd: "length" },
    });
    expect(await check({ whatsappAdd: "y".repeat(4001) })).toMatchObject({
      ok: false,
      errors: { whatsappAdd: "length" },
    });
    expect(
      await check({ whatsappAdd: "\r\n\u00a0\u3000\r\n", detailsFix: " \n " }),
    ).toEqual({ ok: true, errors: {}, answers: { newMrrUsd: 0 } });
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
      {
        id: "multiLine",
        form: "kickoff",
        task: TASK,
        hidden: {
          onboarding_client_id: TASK,
          address: "Block 3\nStreet 20",
          hours: "Sat to Thu  9-5\nFriday closed",
          marketing_tried: MULTI_AR,
          challenges: MULTI_EN,
        },
        answers: [
          a(K.detailsNote, MULTI_AR),
          a(K.whatsappAdd, "Sara (sales)\nOmar  (design)"),
          a(K.contractChanges, MULTI_EN),
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
    // A multi-line answer or hidden value is written whole, its line breaks and double spaces kept.
    for (const part of [
      `*Address:* Block 3\nStreet 20\n`,
      `*Working hours / availability:* Sat to Thu  9-5\nFriday closed\n`,
      `*Business notes:* ${MULTI_AR}\n`,
      `*Marketing tried before:* ${MULTI_AR}\n`,
      `*Current challenges:* ${MULTI_EN}\n`,
      `*Contract changes needed:* ${MULTI_EN}\n`,
      `*Other people to add:* Sara (sales)\nOmar  (design)\n`,
    ])
      expect(made.multiLine.handoff[0]).toContain(part);
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
      { id: "multiLine", form: "onboarding", task: TASK, answers: MULTI_LINE },
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
    expect(made.multiLine.profile).toBe(
      `Last Year's Total Revenue: \n\n90-Day Goal Revenue: \n\n12-24 Month Revenue Goal: \n\nMarketing they've tried A-Z: ${MULTI_AR}\n\nTop 3 challenges: ${MULTI_EN}\n\nWhy they joined: We want  steady\nconsultations.\n\nAdditional notes: سؤال:\n  متى نبدأ؟`,
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
      { id: "multiLine", form: "onboarding", task: TASK, answers: MULTI_LINE },
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
    expect(made.multiLine.raw).toContain(
      `**${title(O.address)}**\nقطعة ٣\nشارع ٢٠، منزل ٧\n\n**${title(O.hours)}**\nSat to Thu  9-5\nFriday closed\n\n`,
    );
    expect(made.multiLine.raw).toContain(`**${title(O.marketing)}**\n${MULTI_AR}\n\n`);
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
      // post the handoff on it, whole. So the plan carries the comment and no details.
      expect([c.id, plan.onboarding_tasks.plan]).toEqual([
        c.id,
        {
          typeKey: "client_onboarding",
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
    // 20261102l cut the long handoff into the details; now it is whole in the comment and in no description.
    const now = byKey(
      (await parity("kickoff", kickoffInput(cases[4].answers, made.long.hidden))).effects,
    );
    expect(now.onboarding_tasks.plan).not.toHaveProperty("details");
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
        { id: "multiLine", form: "onboarding", task: TASK, answers: MULTI_LINE },
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
        // The Client Profile whole, whatever its length, as Make 13 [29] writes it.
        expect([c.id, plan.profile_fields.plan.fields[0]]).toEqual([
          c.id,
          { fieldId: PROFILE_FIELD, kind: "text", value: made[c.id].profile, label: "Client Profile" },
        ]);
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
      // Make 13 [29] has no limit, and the plan none: a profile over 5,000 characters is written whole
      // (20261102l cut it there).
      expect(Array.from(made.long.profile as string).length).toBeGreaterThan(5000);
      const long = byKey(
        (await parity("onboarding", onboardingInput(cases[3].answers))).effects,
      );
      expect(long.profile_fields.plan.fields[0].value).toBe(made.long.profile);
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
/** A native onboarding answer as the check stores it: a revenue is a number (20261102o, 13). */
const NATIVE_ONBOARDING = {
  fullName: "Invented Owner",
  businessName: "Cedar Homes Invented",
  appointmentTypes: ["office", "online"],
  freeConsults: "yes",
  lastRevenue: 0,
  goal90: 60000,
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
      expect(plan.onboarding_tasks.plan).not.toHaveProperty("details");
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

// --- What was typed --------------------------------------------------------------------------------

/**
 * A client's whole native onboarding answer, typed over several lines in Arabic and English, with
 * double spaces, carriage returns and white space at the ends (invented). mapsLink, projectsDone and
 * faqs are as long as the longest stored KFRCXPFx answers to a short and a long text (431, 224, 2,695).
 */
const FAQ = "س: متى تبدأون؟\nج: بعد التوقيع بأسبوع.\n\n";
const ONB_TYPED: Record<string, unknown> = {
  fullName: "  Invented  Owner\u00a0",
  phone: "+965 0000 0001",
  email: "owner@cedar.invalid",
  businessName: "Cedar  Homes Invented ",
  address: "قطعة ٣\r\nشارع ٢٠، منزل ٧\r\n",
  mapsLink: `https://maps.example.invalid/${"m".repeat(402)}`,
  website: "https://cedar.invalid",
  instagram: "https://instagram.com/cedar.invented",
  facebook: "https://facebook.com/cedar.invented",
  paymentOptions: "50% upfront\n50% on handover",
  frontDeskPhone: "+965 0000 0002",
  personalPhone: "+965 0000 0003",
  yearsInBusiness: "12 years",
  bookingSoftware: "None  yet",
  facebookAds: "unsure",
  projectsDone: "p".repeat(224),
  hours: "Sat to Thu  9-5\r\nFriday closed",
  services: MULTI_EN.replace(/\n/g, "\r\n"),
  serviceFocus: "Villas",
  faqs: `${FAQ.repeat(60)}${"q".repeat(2695 - Array.from(FAQ.repeat(60)).length)}`,
  idealProject: MULTI_AR,
  serviceAreas: "Kuwait City\rHawalli",
  appointmentTypes: ["office", "online"],
  maxDistance: "30 km",
  landmark: "Next to the co-op \n(blue gate)",
  appointmentLength: "60 minutes\r\n+ 15 buffer",
  consultants: "Eng. Invented One\nEng. Invented Two",
  whyJoined: "\n We want  steady\r\nconsultations. \n",
  freeConsults: "yes",
  marketing: `\u3000${MULTI_AR}\r\n`,
  lastRevenue: 120000,
  challenges: MULTI_EN.replace(/\n/g, "\r\n"),
  goal90: 60000,
  goal12: 250000,
  additionalInfo: "سؤال:\r\n  متى نبدأ؟\r\n",
  driveLink: "https://drive.example.invalid/folder",
};
/** KFRCXPFx's three number questions (20261102o, 13): the portal sends each as a number. */
const REVENUES = ["lastRevenue", "goal90", "goal12"];
/** KFRCXPFx's four website questions: the url format. mapsLink, a short text there, stays plain. */
const LINKS = ["website", "instagram", "facebook", "driveLink"];
/** KFRCXPFx's three phone_number questions, as the check stores ONB_TYPED's: E.164. */
const E164: Record<string, string> = {
  phone: "+96500000001",
  frontDeskPhone: "+96500000002",
  personalPhone: "+96500000003",
};
/** ONB_TYPED's revenues as round 3's version 2 asked them, short texts. */
const REVENUE_TEXTS = { lastRevenue: "120000", goal90: "60000", goal12: "250000" };
const onboardingCheck = (answers: unknown, suffix = "", schema?: Row) =>
  schema
    ? one<Row>(
        `SELECT public.cockpit_form_answers_check${suffix}($1::jsonb, $2::jsonb, '{}'::jsonb) AS r`,
        [json(schema), json(answers)],
      )
    : one<Row>(
        `SELECT public.cockpit_form_answers_check${suffix}(schema, $1::jsonb, '{}'::jsonb) AS r
           FROM public.cockpit_form_versions WHERE form_key = 'onboarding' AND version = 2`,
        [json(answers)],
      );
/** 20261102j's version-2 schema (as live holds it), read back inside a rolled-back step. */
async function jV2Schema(): Promise<Row> {
  let schema: Row = {};
  await rolledBack(async () => {
    await db.query(
      "DELETE FROM public.cockpit_form_versions WHERE form_key = 'onboarding' AND version = 2",
    );
    await db.exec(V2_INSERT);
    schema = await v2Schema();
  });
  return schema;
}

describe("a native answer keeps what was typed, as Typeform keeps it for Make", () => {
  test("cockpit_form_typeform_text: line breaks as line feeds, both ends trimmed as JavaScript's trim(), everything between as typed", async () => {
    const typed = [
      "",
      "plain",
      "  two  spaces  inside  ",
      "a\r\nb\rc\nd",
      "\r\n\r\nblank lines\r\n\r\n\r\nkept inside\r\n",
      "\t\u000b\f\u00a0\u1680\u2000\u2005\u200a\u2028\u2029\u202f\u205f\u3000\ufeff edges \u3000\u00a0",
      "سطر أول \nسطر  ثاني\n\nسطر ثالث",
      "\u00a0inside\u00a0no-break\u00a0",
      " \n\t ",
    ];
    const sql = await one<(string | null)[]>(
      "SELECT jsonb_agg(public.cockpit_form_typeform_text(x) ORDER BY n) AS r FROM unnest($1::text[]) WITH ORDINALITY AS u(x, n)",
      [typed],
    );
    expect(sql).toEqual(typed.map(kept));
    expect(sql[3]).toBe("a\nb\nc\nd");
    expect(sql[7]).toBe("inside\u00a0no-break");
    expect(
      await one("SELECT public.cockpit_form_typeform_text(NULL) AS r"),
    ).toBeNull();
  });

  test("the onboarding's version 2: four long texts, three numbers, four links, 1,000 and 10,000 characters, everything else 20261102j's; the schema check holds every other form to 200 and 2,000", async () => {
    const now = await v2Schema();
    const was = await jV2Schema();
    const retyped = ["address", "hours", "landmark", "appointmentLength"];
    expect({ ...now, fields: null }).toEqual({ ...was, fields: null });
    expect(now.fields).toEqual(
      was.fields.map((f: Row) => {
        const { maxLength: _, ...rest } = f;
        return retyped.includes(f.key)
          ? { ...f, type: "longtext", maxLength: 10000 }
          : REVENUES.includes(f.key)
            ? { ...rest, type: "number", min: 0, max: 1000000000, decimals: 0 }
            : LINKS.includes(f.key)
              ? { ...f, maxLength: 1000, format: "url" }
              : f.type === "longtext"
                ? { ...f, maxLength: 10000 }
                : f.type === "text"
                  ? { ...f, maxLength: 1000 }
                  : f;
      }),
    );
    expect(
      was.fields.filter((f: Row) => retyped.includes(f.key)).map((f: Row) => [f.type, f.maxLength]),
    ).toEqual(Array(4).fill(["text", 200]));
    // 20261102j asked the revenues and the links as plain short texts; the phones already had the phone
    // format and keep it, and mapsLink stays plain. No label or hint changes.
    const shape = (schema: Row, key: string) => {
      const f = schema.fields.find((x: Row) => x.key === key);
      return [key, f.type, f.format ?? "plain", f.maxLength ?? null];
    };
    expect([...REVENUES, ...LINKS, "mapsLink", ...Object.keys(E164)].map(k => shape(was, k))).toEqual([
      ...REVENUES.map(k => [k, "text", "plain", 200]),
      ...LINKS.map(k => [k, "text", "plain", 200]),
      ["mapsLink", "text", "plain", 200],
      ...Object.keys(E164).map(k => [k, "text", "phone", 200]),
    ]);
    expect([...REVENUES, ...LINKS, "mapsLink", ...Object.keys(E164)].map(k => shape(now, k))).toEqual([
      ...REVENUES.map(k => [k, "number", "plain", null]),
      ...LINKS.map(k => [k, "text", "url", 1000]),
      ["mapsLink", "text", "plain", 1000],
      ...Object.keys(E164).map(k => [k, "text", "phone", 1000]),
    ]);
    const words = (schema: Row) => schema.fields.map((f: Row) => [f.key, f.label, f.hint ?? null, f.required ?? null]);
    expect(words(now)).toEqual(words(was));
    // Each question KFRCXPFx asks as long_text is a long text in it, as number a number, as website a
    // link and as phone_number a phone, by its Typeform ref; no other question is.
    const refs = await one<Row[]>(
      "SELECT public.cockpit_form_stage4_fields('onboarding') AS r",
    );
    const asked = (evaluate([]).onboarding as Row[]).map(x => ({
      ...x,
      key: refs.find(f => f.typeformRef === x.ref).key,
    }));
    for (const x of asked.filter(y => y.type === "long_text"))
      expect([x.key, now.fields.find((f: Row) => f.key === x.key).type]).toEqual([x.key, "longtext"]);
    const keysOf = (type: string) => asked.filter(y => y.type === type).map(y => y.key).sort();
    expect(keysOf("number")).toEqual([...REVENUES].sort());
    expect(keysOf("website")).toEqual([...LINKS].sort());
    expect(keysOf("phone_number")).toEqual(Object.keys(E164).sort());
    expect(now.fields.filter((f: Row) => f.type === "number").map((f: Row) => f.key).sort()).toEqual([...REVENUES].sort());
    expect(now.fields.filter((f: Row) => f.format === "url").map((f: Row) => f.key).sort()).toEqual([...LINKS].sort());
    expect(now.fields.filter((f: Row) => f.format === "phone").map((f: Row) => f.key).sort()).toEqual(Object.keys(E164).sort());
    const schemaCheck = (schema: Row, suffix = "") =>
      one<string | null>(`SELECT public.cockpit_form_schema_check${suffix}($1::jsonb) AS r`, [json(schema)]);
    expect(await schemaCheck(now)).toBeNull();
    expect(await schemaCheck(was)).toBeNull();
    expect(await schemaCheck(was, "_i")).toBeNull();
    // 20261102i's check would refuse the new limits; the client onboarding's are its own.
    expect(await schemaCheck(now, "_i")).toBe("Question fullName allows at most 200 characters.");
    const withLimit = (schema: Row, key: string, maxLength: number) => ({
      ...schema,
      fields: schema.fields.map((f: Row) => (f.key === key ? { ...f, maxLength } : f)),
    });
    expect(await schemaCheck(withLimit(now, "fullName", 1001))).toBe(
      "Question fullName allows at most 1000 characters.",
    );
    expect(await schemaCheck(withLimit(now, "address", 10001))).toBe(
      "Question address allows at most 10000 characters.",
    );
    // Every other form keeps 20261102i's limits, word for word.
    const other = { ...now, key: "onboarding_copy" };
    for (const schema of [other, withLimit({ ...was, key: "onboarding_copy" }, "faqs", 2001), { ...was, key: "onboarding_copy" }])
      expect(await schemaCheck(schema)).toBe(await schemaCheck(schema, "_i"));
    expect(await schemaCheck(other)).toBe("Question fullName allows at most 200 characters.");
  });

  test("the onboarding's answers check keeps each text as Typeform keeps it and takes what KFRCXPFx took; every other form folds as before", async () => {
    const out = await onboardingCheck(ONB_TYPED);
    expect([out.ok, out.errors]).toEqual([true, {}]);
    const schema = await v2Schema();
    const texts = schema.fields.filter((f: Row) => ["text", "longtext"].includes(f.type));
    expect(texts).toHaveLength(30);
    // Every text as typed, but a phone, which is stored as E.164 (13).
    for (const f of texts)
      expect([f.key, out.answers[f.key]]).toEqual([f.key, E164[f.key] ?? kept(ONB_TYPED[f.key] as string)]);
    for (const key of REVENUES) expect([key, out.answers[key]]).toEqual([key, ONB_TYPED[key]]);
    expect(out.answers).toMatchObject({
      fullName: "Invented  Owner",
      address: "قطعة ٣\nشارع ٢٠، منزل ٧",
      serviceAreas: "Kuwait City\nHawalli",
      landmark: "Next to the co-op \n(blue gate)",
      whyJoined: "We want  steady\nconsultations.",
      appointmentTypes: ["office", "online"],
      facebookAds: "unsure",
    });
    for (const [key, length] of [["mapsLink", 431], ["projectsDone", 224], ["faqs", 2695]] as const)
      expect([key, Array.from(out.answers[key] as string).length]).toEqual([key, length]);
    // The limits count what is kept: 1,000 for a text, 10,000 for a long text, line breaks included.
    const limits = async (answers: Row) => (await onboardingCheck({ ...ONB_TYPED, ...answers })).errors;
    expect(await limits({ mapsLink: ` ${"m".repeat(1000)}\n`, faqs: `\r\n${"f\r\n".repeat(5000)}` })).toEqual({});
    expect(await limits({ mapsLink: "m".repeat(1001), faqs: `${"f\n".repeat(5000)}f` })).toEqual({
      mapsLink: "length",
      faqs: "length",
    });
    // White space alone is no answer: a required question says so, an optional one is left out.
    const blank = await onboardingCheck({ ...ONB_TYPED, hours: "\r\n\u00a0\u3000", additionalInfo: "\u00a0" });
    expect(blank.errors).toEqual({ hours: "required" });
    expect(blank.answers).not.toHaveProperty("additionalInfo");
    // 20261102i's check folded every answer, and refused what KFRCXPFx took.
    const iOut = await onboardingCheck(ONB_TYPED, "_i");
    expect(iOut.answers.address).toBe("قطعة ٣ شارع ٢٠، منزل ٧");
    expect(iOut.answers.businessName).toBe("Cedar Homes Invented");
    expect((await onboardingCheck({ ...ONB_TYPED, ...REVENUE_TEXTS }, "_i", await jV2Schema())).errors).toEqual({
      mapsLink: "length",
      projectsDone: "length",
      faqs: "length",
    });
    // Every other form folds as before, answer for answer.
    for (const key of ["onboarding_copy", "exit_survey"]) {
      const other = { ...schema, key };
      expect(await onboardingCheck(ONB_TYPED, "", other)).toEqual(
        await onboardingCheck(ONB_TYPED, "_i", other),
      );
    }
  });

  test("typed natively, the onboarding writes Make's raw answers comment, Client Profile, dispatch and kickoff link values for the same typing", async () => {
    await rolledBack(async () => {
      await setting("onboarding.raw_titles", RAW_TITLES);
      const checked = await onboardingCheck(ONB_TYPED);
      const id = await nativeResponse("onboarding", checked.answers);
      const input = await one<Row>(
        "SELECT public.cockpit_form_stage4_input($1) AS r",
        [id],
      );
      // Each text the planner reads is what Typeform would have handed Make for the same typing: a phone
      // as E.164 (phone_number), a revenue as its number (number), every other text as typed.
      const fields = await one<Row[]>(
        "SELECT public.cockpit_form_stage4_fields('onboarding') AS r",
      );
      for (const f of fields.filter(x => ["text", "longtext"].includes(x.type)))
        expect([f.key, input.answers.find((x: Answer) => x.ref === f.typeformRef)?.value]).toEqual([
          f.key,
          E164[f.key] ??
            (REVENUES.includes(f.key) ? String(ONB_TYPED[f.key]) : kept(ONB_TYPED[f.key] as string)),
        ]);
      const made = evaluate([
        { id: "typed", form: "onboarding", task: TASK, answers: input.answers },
        {
          id: "link",
          form: "kickoff",
          task: TASK,
          answers: [],
          hiddenFrom: { source: "make13", onboarding: input.answers },
        },
      ]);
      const plan = byKey(await build(input));
      expect(plan.raw_answers_comment.plan.comment_text).toBe(made.typed.raw);
      expect(plan.profile_fields.plan.fields[0].value).toBe(made.typed.profile);
      expect(plan.github_dispatch.plan.payload).toEqual({
        taskId: made.typed.dispatch.clickup_id,
        client: made.typed.dispatch.client_name,
      });
      expect(made.typed.dispatch.client_name).toBe("Cedar  Homes Invented");
      const title = (ref: string) =>
        RAW_TITLES.fields.find((f: Row) => f.ref === ref).title;
      expect(made.typed.raw).toContain(
        `**${title(O.address)}**\nقطعة ٣\nشارع ٢٠، منزل ٧\n\n`,
      );
      expect(made.typed.raw).toContain(`**${title(O.whyJoined)}**\nWe want  steady\nconsultations.\n\n`);
      expect(made.typed.profile).toContain(`Marketing they've tried A-Z: ${MULTI_AR}\n\nTop 3 challenges: ${MULTI_EN}\n\n`);
      expect(made.typed.profile).toEndWith("Additional notes: سؤال:\n  متى نبدأ؟");
      // The read model it writes gives the next kickoff Make 13 [29]'s link values, line breaks kept.
      expect(plan.read_model.plan.entry.answers).toEqual(input.answers);
      await readModel(plan.read_model.plan.entry);
      const hidden = await hiddenOf(TASK);
      expect(hidden).toEqual(filled(made.link.hidden));
      expect(hidden).toMatchObject({
        address: "قطعة ٣\nشارع ٢٠، منزل ٧",
        hours: "Sat to Thu  9-5\nFriday closed",
        marketing_tried: MULTI_AR,
        challenges: MULTI_EN,
        client_notes: "سؤال:\n  متى نبدأ؟",
      });

      // The kickoff that follows, its long texts typed over several lines: Make 12 [11]'s handoff.
      const kTyped = {
        ...NATIVE_KICKOFF,
        detailsFix: "ملاحظة أولى\r\n  ملاحظة  ثانية\r\n",
        whatsappAdd: " Sara (sales)\r\nOmar  (design) ",
        contentLinks: "https://drive.example.invalid/a\nhttps://drive.example.invalid/b",
        adPlatforms: "Tiktok,\n  Snapchat",
      };
      const kCheck = await one<Row>(
        "SELECT public.cockpit_kickoff_answers_check($1::jsonb) AS r",
        [json(kTyped)],
      );
      expect([kCheck.ok, kCheck.errors]).toEqual([true, {}]);
      const kId = await nativeResponse("kickoff", kCheck.answers);
      const kInput = await one<Row>(
        "SELECT public.cockpit_form_stage4_input($1) AS r",
        [kId],
      );
      const kMade = evaluate([
        {
          id: "k",
          form: "kickoff",
          task: TASK,
          answers: kInput.answers,
          hiddenFrom: { source: "make13", onboarding: input.answers },
        },
      ]).k;
      expect(kInput.hidden).toEqual(filled(kMade.hidden));
      const kPlan = byKey(await build(kInput));
      expect(kPlan.handoff_comment.plan.comment_text).toBe(kMade.handoff[0]);
      expect(kPlan.onboarding_tasks.plan.comment_text).toBe(kMade.handoff[1]);
      for (const part of [
        "*Business notes:* ملاحظة أولى\n  ملاحظة  ثانية\n",
        "*Other people to add:* Sara (sales)\nOmar  (design)\n",
        "*Marketing content links / notes:* https://drive.example.invalid/a\nhttps://drive.example.invalid/b\n",
        "*Advertising platforms:* Tiktok, Snapchat\n",
        "*Address:* قطعة ٣\nشارع ٢٠، منزل ٧\n",
        "*Working hours / availability:* Sat to Thu  9-5\nFriday closed\n",
      ])
        expect(kMade.handoff[0]).toContain(part);
    });
  });
});

// --- Typeform's typed inputs (13) -----------------------------------------------------------------

/** Characters a phone copied from a chat or a contact card can carry, written by code point. */
const CH = {
  nbsp: String.fromCodePoint(0xa0),
  lrm: String.fromCodePoint(0x200e),
  lre: String.fromCodePoint(0x202a),
  pdf: String.fromCodePoint(0x202c),
  enDash: String.fromCodePoint(0x2013),
  minus: String.fromCodePoint(0x2212),
};
/**
 * Whole answers in the shapes the 46 stored KFRCXPFx answers have (counts only, read 2026-11-02): every
 * revenue a plain whole number (0 among them), every link https (a path, a query, a trailing slash),
 * every phone E.164 with its country code, mapsLink a link or a few words, driveLink often unanswered.
 */
const PAST_SHAPES: Record<string, unknown>[] = [
  ONB_TYPED,
  {
    ...ONB_TYPED,
    phone: "+966500000001",
    frontDeskPhone: "+971500000002",
    personalPhone: "+15550100003",
    website: "https://www.cedar.invalid/",
    instagram: "https://www.instagram.com/cedar.invented/?hl=en",
    facebook: "https://www.facebook.com/profile.php?id=100000000000001",
    mapsLink: "https://maps.app.goo.gl/Invented0001",
    driveLink: "https://drive.google.com/drive/folders/Invented0001?usp=sharing",
    lastRevenue: 0,
    goal90: 0,
    goal12: 0,
  },
  {
    ...ONB_TYPED,
    phone: "+96550000001",
    frontDeskPhone: "+96522000002",
    personalPhone: "+96560000003",
    mapsLink: "Next to the co-op, Block 4",
    driveLink: undefined,
    lastRevenue: 250000000,
    goal90: 1000000000,
    goal12: 1000000000,
  },
];

describe("the onboarding asks what KFRCXPFx typed: numbers, https links and E.164 phones", () => {
  test("a revenue is a whole number from 0 to 1,000,000,000: \"2 million\", \"1,500,000\" and any text are refused", async () => {
    const errors = async (answers: Row) => (await onboardingCheck({ ...ONB_TYPED, ...answers })).errors;
    for (const ok of [0, 1, 1500000, 1000000000])
      expect([ok, await errors({ lastRevenue: ok, goal90: ok, goal12: ok })]).toEqual([ok, {}]);
    for (const no of ["2 million", "1,500,000", "1500000", "", -1, 1.5, 1000000001])
      expect([no, await errors({ lastRevenue: no })]).toEqual([
        no,
        no === "" ? { lastRevenue: "required" } : { lastRevenue: "range" },
      ]);
    // Each is required, as KFRCXPFx asks it.
    const { lastRevenue: _, ...without } = ONB_TYPED;
    expect((await onboardingCheck(without)).errors).toEqual({ lastRevenue: "required" });
    // A whole number written with a decimal point or an exponent is the same number.
    const out = await one<Row>(
      `SELECT public.cockpit_form_answers_check(schema, $1::jsonb || '{"goal90": 60000.0, "goal12": 1.5e6}'::jsonb, '{}'::jsonb) AS r
         FROM public.cockpit_form_versions WHERE form_key = 'onboarding' AND version = 2`,
      [json(ONB_TYPED)],
    );
    expect([out.ok, out.answers.goal90, out.answers.goal12]).toEqual([true, 60000, 1500000]);
  });

  test("a revenue prints in Make's texts as Make prints Typeform's number: 1500000 is 1500000, 0 is blank (make_parity.py)", async () => {
    await rolledBack(async () => {
      await setting("onboarding.raw_titles", RAW_TITLES);
      const checked = await one<Row>(
        `SELECT public.cockpit_form_answers_check(schema, $1::jsonb || '{"lastRevenue": 1500000, "goal90": 0, "goal12": 1e9}'::jsonb, '{}'::jsonb) AS r
           FROM public.cockpit_form_versions WHERE form_key = 'onboarding' AND version = 2`,
        [json(ONB_TYPED)],
      );
      expect([checked.ok, checked.answers.lastRevenue, checked.answers.goal90, checked.answers.goal12]).toEqual([
        true,
        1500000,
        0,
        1000000000,
      ]);
      const id = await nativeResponse("onboarding", checked.answers);
      const input = await one<Row>("SELECT public.cockpit_form_stage4_input($1) AS r", [id]);
      const value = (ref: string) => input.answers.find((x: Answer) => x.ref === ref)?.value;
      // The answers list holds each number as Typeform hands it to Make: its digits, 0 as 0.
      expect([value(O.lastRevenue), value(O.goal90), value(O.goal12)]).toEqual(["1500000", "0", "1000000000"]);
      // Make's side from what Typeform hands Make for the same typing (its number questions as numbers).
      const typeform = CARD_ONBOARDING.filter(x => ![O.lastRevenue, O.goal90].includes(x.ref)).concat([
        a(O.lastRevenue, "1500000"),
        a(O.goal90, "0"),
        a(O.goal12, "1000000000"),
      ]);
      const made = evaluate([
        { id: "native", form: "onboarding", task: TASK, answers: input.answers },
        { id: "typeform", form: "onboarding", task: TASK, answers: typeform },
        { id: "link", form: "kickoff", task: TASK, answers: [], hiddenFrom: { source: "make13", onboarding: typeform } },
      ]);
      const plan = byKey(await build(input));
      expect(plan.profile_fields.plan.fields[0].value).toBe(made.native.profile);
      expect(plan.raw_answers_comment.plan.comment_text).toBe(made.native.raw);
      const lines = (text: string) =>
        text.split("\n").filter(l => /^(Last Year's Total Revenue|90-Day Goal Revenue|12-24 Month Revenue Goal): /.test(l));
      expect(lines(plan.profile_fields.plan.fields[0].value)).toEqual(lines(made.typeform.profile));
      expect(lines(made.typeform.profile)).toEqual([
        "Last Year's Total Revenue: 1500000",
        "90-Day Goal Revenue: ",
        "12-24 Month Revenue Goal: 1000000000",
      ]);
      const title = (ref: string) => RAW_TITLES.fields.find((f: Row) => f.ref === ref).title;
      for (const [ref, printed] of [
        [O.lastRevenue, "1500000"],
        [O.goal90, ""],
        [O.goal12, "1000000000"],
      ]) {
        // (The comment's last answer has no blank line after it.)
        expect(`${made.typeform.raw}\n`).toContain(`**${title(ref)}**\n${printed}\n\n`);
        expect(`${plan.raw_answers_comment.plan.comment_text}\n`).toContain(`**${title(ref)}**\n${printed}\n\n`);
      }
      // The next kickoff's link values: the number's digits, and 0 as nothing.
      await readModel(plan.read_model.plan.entry);
      const hidden = await hiddenOf(TASK);
      expect({
        last: hidden.last_revenue,
        goal90: hidden.goal_90d,
        goal12: hidden.goal_12_24,
      }).toEqual({ last: made.link.hidden.last_revenue, goal90: undefined, goal12: made.link.hidden.goal_12_24 });
      expect([hidden.last_revenue, hidden.goal_12_24]).toEqual(["1500000", "1000000000"]);
      expect(made.link.hidden.goal_90d ?? "").toBe("");
    });
  });

  test("a late KFRCXPFx delivery mapped into version 2 (X26) writes the texts the portal's answer writes for the same typing", async () => {
    const schema = await v2Schema();
    for (const [n, answers] of PAST_SHAPES.entries()) {
      const portal = (await onboardingCheck(answers)).answers;
      // What Typeform hands the door for the same typing, then the mapping into version 2 (20261102j's,
      // unchanged, which the parity plan's read model also uses): a revenue is the text of Typeform's
      // number, every other answer is what the portal stores.
      const handed = await one<Row[]>(
        "SELECT public.cockpit_form_stage4_typeform_answers('onboarding', $1::jsonb) AS r",
        [json(portal)],
      );
      const mapped = await one<Row>(
        "SELECT public.cockpit_form_stage4_native_answers('onboarding', $1::jsonb) AS r",
        [json(handed)],
      );
      expect([n, mapped]).toEqual([
        n,
        { ...portal, ...Object.fromEntries(REVENUES.map(k => [k, String(portal[k])])) },
      ]);
      // The door then stores each number question of version 2 as a number (16): the portal's answer.
      const door = await one<Row>(
        "SELECT public.cockpit_form_stage4_numbers($1::jsonb, $2::jsonb) AS r",
        [json(schema), json(mapped)],
      );
      expect([n, door]).toEqual([n, portal]);
      // Every text reads the same answers list from either.
      for (const stored of [mapped, door]) {
        const again = await one<Row[]>(
          "SELECT public.cockpit_form_stage4_typeform_answers('onboarding', $1::jsonb) AS r",
          [json(stored)],
        );
        expect([n, again]).toEqual([n, handed]);
      }
    }
  });

  test("a number question's answer is stored as the number its text writes; any other text stays as it came", async () => {
    const schema = await v2Schema();
    const numbers = (answers: unknown, s: unknown = schema) =>
      one<Row>("SELECT public.cockpit_form_stage4_numbers($1::jsonb, $2::jsonb) AS r", [json(s), json(answers)]);
    // A number as cockpit_form_stage4_text writes Typeform's; only the number questions change.
    expect(
      await numbers({ lastRevenue: "0", goal90: "60000", goal12: "1000000000", yearsInBusiness: "12", website: "123" }),
    ).toEqual({ lastRevenue: 0, goal90: 60000, goal12: 1000000000, yearsInBusiness: "12", website: "123" });
    expect(await numbers({ lastRevenue: "1500.5", goal90: "-5" })).toEqual({ lastRevenue: 1500.5, goal90: -5 });
    // Any other text is kept as it came, so every text prints it as before; a number stays a number.
    for (const text of ["2 million", "1,500,000", "060000", "60000.50", "1e6", "+5", "-0", " 5", "٦٠٠٠٠", ""])
      expect([text, await numbers({ goal90: text, goal12: 250000 })]).toEqual([text, { goal90: text, goal12: 250000 }]);
    // No schema, or answers that are not an object: as they came.
    expect(await numbers({ goal90: "60000" }, null)).toEqual({ goal90: "60000" });
    expect(
      await one("SELECT public.cockpit_form_stage4_numbers(NULL, '{\"goal90\": \"60000\"}'::jsonb) AS r"),
    ).toEqual({ goal90: "60000" });
    expect(await numbers(["60000"])).toEqual(["60000"]);
  });

  test("the Typeform door (X26) stores a late KFRCXPFx delivery as the portal stores the same answer, each revenue a number", async () => {
    await rolledBack(async () => {
      // What 20261102j's door reads beside this ground, as stand-ins: the service gate, the card's
      // onboarding signals and the planner's hook (stage4-native-supabase.test.ts runs the real ones).
      await db.exec(`
        ALTER TABLE public.cockpit_form_responses ALTER COLUMN id SET DEFAULT gen_random_uuid(),
          ADD COLUMN created_by text, ADD COLUMN submitted_by text;
        ALTER TABLE public.cockpit_client_onboarding ADD COLUMN in_onboarding boolean, ADD COLUMN signup_on date;
        ALTER TABLE public.cockpit_billing_accounts ADD COLUMN stage_group text;
        CREATE TABLE public.cockpit_sales_deals (response_id uuid, submitted_at timestamptz);
        CREATE FUNCTION public.cockpit_hours_require_service() RETURNS void LANGUAGE plpgsql AS $$ BEGIN END $$;
        CREATE FUNCTION public.cockpit_billing_today() RETURNS date LANGUAGE sql AS $$ SELECT current_date $$;
        CREATE FUNCTION public.cockpit_billing_deal_cards() RETURNS TABLE (clickup_task_id text, deal_response_id uuid)
          LANGUAGE sql AS $$ SELECT NULL::text, NULL::uuid WHERE false $$;
        CREATE FUNCTION public.cockpit_form_hook_onboarding(p_response_id uuid) RETURNS jsonb
          LANGUAGE sql AS $$ SELECT '{"effects": []}'::jsonb $$;`);
      await db.exec(fnDef(migration("20261102a_forms_invites.sql"), "cockpit_form_client_version"));
      // The card is in the pipeline group on the billing sheet: onboarding now.
      await billing();
      await db.query(
        "UPDATE public.cockpit_billing_accounts SET stage_group = 'pipeline' WHERE clickup_task_id = $1",
        [TASK],
      );
      const deliver = async (token: string, fields: Row[]) => {
        const out = await one<Row>("SELECT public.cockpit_form_onboarding_typeform($1::jsonb) AS r", [
          json({
            formKey: "onboarding",
            externalId: token,
            submittedAt: "2026-11-02T09:00:00Z",
            answers: { fields },
            hidden: { onboarding_client_id: TASK },
            taskId: TASK,
          }),
        ]);
        expect(out).toMatchObject({ inserted: true, stored: "native", taskId: TASK });
        return one<Row>(
          `SELECT jsonb_build_object('version', form_version, 'answers', answers,
                    'types', (SELECT jsonb_object_agg(k, jsonb_typeof(answers->k)) FROM unnest($2::text[]) k)) AS r
             FROM public.cockpit_form_responses WHERE id = $1::uuid`,
          [out.responseId, REVENUES],
        );
      };
      const numbers = { lastRevenue: "number", goal90: "number", goal12: "number" };
      let handed: Row[] = [];
      for (const [n, answers] of PAST_SHAPES.entries()) {
        const portal = (await onboardingCheck(answers)).answers;
        handed = await one<Row[]>(
          "SELECT public.cockpit_form_stage4_typeform_answers('onboarding', $1::jsonb) AS r",
          [json(portal)],
        );
        const stored = await deliver(`tokDoorShape${n}`, handed);
        expect([n, stored]).toEqual([n, { version: 2, answers: portal, types: numbers }]);
        // The version-2 check takes the stored answer again as it is: one shape whichever door.
        const again = await onboardingCheck(stored.answers);
        expect([n, again.ok, again.answers]).toEqual([n, true, portal]);
      }
      // A revenue Typeform's number question never hands is kept as it came, so Make's texts print it as before.
      const odd = handed.map(x => (x.ref === O.lastRevenue ? { ...x, value: "2 million" } : x));
      const stored = await deliver("tokDoorOdd0001", odd);
      expect([stored.answers.lastRevenue, stored.types]).toEqual(["2 million", { ...numbers, lastRevenue: "string" }]);
    });
  });

  test("the four links are https, as KFRCXPFx's website questions; mapsLink stays plain", async () => {
    const errors = async (answers: Row) => (await onboardingCheck({ ...ONB_TYPED, ...answers })).errors;
    for (const key of LINKS) {
      for (const ok of ["https://cedar.invalid", "http://cedar.invalid/a?b=c", "https://www.instagram.com/cedar.invented/"])
        expect([key, ok, await errors({ [key]: ok })]).toEqual([key, ok, {}]);
      // The portal writes https:// before a "www." or a bare domain; what reaches the check without it is refused.
      for (const no of ["cedar.invalid", "www.cedar.invalid", "@cedar.invented", "cedar page", "https://cedar"])
        expect([key, no, await errors({ [key]: no })]).toEqual([key, no, { [key]: "format" }]);
    }
    // driveLink is optional, as in KFRCXPFx; the other three are required.
    const { driveLink: _, ...noDrive } = ONB_TYPED;
    expect((await onboardingCheck(noDrive)).errors).toEqual({});
    for (const plain of ["Next to the co-op, Block 4", "https://maps.app.goo.gl/Invented0001", "قرب الجمعية"])
      expect([plain, await errors({ mapsLink: plain })]).toEqual([plain, {}]);
  });

  test("a phone is stored as E.164; a number with no country code is refused; every other form checks a phone as before", async () => {
    const stored = async (typed: string) => {
      const out = await onboardingCheck({ ...ONB_TYPED, phone: typed, frontDeskPhone: typed, personalPhone: typed });
      return out.ok ? [out.answers.phone, out.answers.frontDeskPhone, out.answers.personalPhone] : out.errors;
    };
    for (const [typed, e164] of [
      ["+966 50 000 0001", "+966500000001"],
      ["+965 5000 0001", "+96550000001"],
      ["00965 5000-0001", "+96550000001"],
      ["(+965) 5000.0001", "+96550000001"],
      ["+1 (555) 010-0001", "+15550100001"],
      ["[+971] 50 000 0001", "+971500000001"],
      ["+٩٦٥ ٥٠٠٠ ٠٠٠١", "+96550000001"],
      ["+۹۶۶ ۵۰ ۰۰۰ ۰۰۰۱", "+966500000001"],
      [`+965${CH.nbsp}5000${CH.nbsp}0001`, "+96550000001"],
      [`${CH.lre}+965 5000 0001${CH.pdf}`, "+96550000001"],
      [`${CH.lrm}+965${CH.enDash}5000${CH.minus}0001`, "+96550000001"],
      ["+96550000001", "+96550000001"],
      ["+12345678", "+12345678"],
      ["+123456789012345", "+123456789012345"],
    ])
      expect([typed, await stored(typed)]).toEqual([typed, [e164, e164, e164]]);
    const refused = { phone: "format", frontDeskPhone: "format", personalPhone: "format" };
    for (const typed of [
      "5000 0001",
      "0501234567",
      "96550000001",
      "+965 5000",
      "+1234567890123456",
      "+965 5000 0001 ext 2",
      "Phone: +96550000001",
      "+965 5000 0001 / +965 5000 0002",
      "+96550000001+",
      "---",
    ])
      expect([typed, await stored(typed)]).toEqual([typed, refused]);
    // Blank is still no answer: each phone is required, as KFRCXPFx asks it.
    expect(await stored(" ")).toEqual({ phone: "required", frontDeskPhone: "required", personalPhone: "required" });
    // Every other form's phone is 20261102i's, answer for answer.
    const schema = await v2Schema();
    for (const key of ["onboarding_copy", "exit_survey"])
      for (const typed of ["+965 5000-0001", "5000 0001", "(965) 5000 0001", "+٩٦٥ ٥٠٠٠ ٠٠٠١", "00965 5000 0001"]) {
        const answers = { ...ONB_TYPED, phone: typed };
        expect(await onboardingCheck(answers, "", { ...schema, key })).toEqual(
          await onboardingCheck(answers, "_i", { ...schema, key }),
        );
      }
    expect((await onboardingCheck({ ...ONB_TYPED, phone: "5000 0001" }, "", { ...schema, key: "exit_survey" })).answers.phone).toBe(
      "5000 0001",
    );
  });

  test("answers in every shape the 46 stored KFRCXPFx answers have pass, and keep what Typeform handed Make", async () => {
    for (const [n, answers] of PAST_SHAPES.entries()) {
      const out = await onboardingCheck(answers);
      expect([n, out.ok, out.errors]).toEqual([n, true, {}]);
      for (const key of [...REVENUES, ...LINKS, "mapsLink"])
        expect([n, key, out.answers[key]]).toEqual([
          n,
          key,
          typeof answers[key] === "string" ? kept(answers[key] as string) : answers[key],
        ]);
      for (const key of Object.keys(E164))
        expect([n, key, out.answers[key]]).toEqual([n, key, (answers[key] as string).replace(/ /g, "")]);
    }
  });
});

// --- The writeback queue's audit (14) -------------------------------------------------------------

describe("the audit log keeps a request part's comment as its length, never its words", () => {
  const queueAudit = () =>
    db.query<Row>(
      `SELECT a.action, a.before, a.after FROM public.cockpit_audit_log a
        WHERE a.entity_type = 'cockpit_clickup_writeback_queue' ORDER BY a.created_at, a.action`,
    );

  test("a native kickoff's onboarding tasks: each part's insert and change of state is audited with the comment's length", async () => {
    await rolledBack(async () => {
      await liveForms();
      await billing();
      await readModel({ form_id: "native", answers: CARD_ONBOARDING });
      const id = await nativeResponse("kickoff", NATIVE_KICKOFF);
      const out = await one<Row>("SELECT public.cockpit_form_stage4_plan($1, true) AS r", [id]);
      expect(byKey(out.effects).onboarding_tasks.state).toBe("delivered");
      const { request, parts } = await requestOf(id, "client_onboarding");
      const comment = request.task_comment as string;
      // The handoff holds the client's email and phone, which the audit must not copy.
      expect(comment).toContain("owner@cedar.invalid");
      expect(comment).toContain("+965 0000 0001");
      // The queue keeps the comment whole: the writer posts it.
      for (const part of Object.values(parts)) expect(part.taskComment).toBe(comment);
      await db.query(
        "UPDATE public.cockpit_clickup_writeback_queue SET state = 'sent' WHERE source_id = $1",
        [request.id],
      );
      const rows = (await queueAudit()).rows;
      expect(rows.map(r => r.action).sort()).toEqual(["insert:queued", "insert:queued", "update:sent", "update:sent"]);
      for (const r of rows) {
        for (const side of [r.after, r.before].filter(Boolean)) {
          expect(side.payload).not.toHaveProperty("taskComment");
          expect(side.payload.taskCommentChars).toBe(Array.from(comment).length);
          expect(side.payload.requestId).toBe(request.id);
        }
      }
      expect(rows.filter(r => r.before).length).toBe(2);
      // Nothing in the audit log holds the comment's words.
      expect(
        await one<number>(
          `SELECT count(*)::int AS r FROM public.cockpit_audit_log a
            WHERE strpos(to_jsonb(a)::text, 'owner@cedar.invalid') > 0 OR strpos(to_jsonb(a)::text, '+965 0000 0001') > 0`,
        ),
      ).toBe(0);
    });
  });

  test("every other kind is audited as 20261026t audits it: a focus-view comment as its length, the rest whole", async () => {
    await rolledBack(async () => {
      const insert = (kind: string, payload: Row) =>
        one<Row>(
          `INSERT INTO public.cockpit_clickup_writeback_queue(dedupe_key, kind, source_table, source_id, payload)
           VALUES (gen_random_uuid()::text, $1, 'test', 'x', $2::jsonb) RETURNING to_jsonb(cockpit_clickup_writeback_queue) AS r`,
          [kind, json(payload)],
        );
      const focus = await insert("task_action", { action: "comment", text: "Call the client back" });
      const field = await insert("card_field", { fieldId: "f-1", value: "Invented value", comment: "kept" });
      const odd = await insert("request", { requestId: "r-1", taskComment: 42 });
      const rows = (await queueAudit()).rows;
      const after = (id: string) => rows.find(r => r.after.id === id).after;
      expect(after(focus.id)).toEqual({
        ...focus,
        payload: { action: "comment", text: "(20 characters, left out of the audit)" },
      });
      expect(after(field.id)).toEqual(field);
      // A comment that is not text keeps no length: missing, never 0.
      expect(after(odd.id).payload).toEqual({ requestId: "r-1", taskCommentChars: null });
    });
  });
});

// --- Room for a long Arabic kickoff (15) -----------------------------------------------------------

/** n characters of unit, counted as the database counts them (code points). */
const fill = (unit: string, n: number) =>
  Array.from(unit.repeat(Math.ceil(n / Array.from(unit).length)))
    .slice(0, n)
    .join("");
/**
 * A kickoff with every answer the sheet takes at its longest: each long text 4,000 characters and each
 * other text 500 (the check's limits, as the sheet counts them), every choice and list answered.
 */
async function kickoffAtMaxima(longUnit: string, shortUnit: string): Promise<Row> {
  const specs = await one<Row[]>("SELECT public.cockpit_form_stage4_fields('kickoff') AS r");
  const answers: Row = { newMrrUsd: 100000 };
  for (const s of specs)
    answers[s.key] =
      s.type === "longtext"
        ? `${fill(longUnit, 3998)}..`
        : s.type === "text"
          ? `${fill(shortUnit, 498)}..`
          : s.type === "url"
            ? `https://fathom.video/share/${"x".repeat(500 - 27)}`
            : s.type === "choice"
              ? s.options[s.options.length - 1]
              : s.type === "multi"
                ? s.options
                : 9999999.99;
  return answers;
}
const ARABIC_LONG = "نبي نركز على الفلل الجديدة في الشمال\nوالدفع على  دفعتين ";
const ARABIC_SHORT = "المدير الفني وفريق المبيعات ";

describe("a long Arabic kickoff is kept: 256 KB for its answers, a plain refusal past them", () => {
  const bytes = (v: unknown) =>
    one<number>("SELECT octet_length($1::jsonb::text) AS r", [json(v)]);
  const kickoffCheck = (answers: Row) =>
    one<Row>("SELECT public.cockpit_kickoff_answers_check($1::jsonb) AS r", [json(answers)]);

  test("the sheet's longest Arabic answers pass the check and are stored; 20261102f's 64 KB refused them with the table's error", async () => {
    const answers = await kickoffAtMaxima(ARABIC_LONG, ARABIC_SHORT);
    const specs = await one<Row[]>("SELECT public.cockpit_form_stage4_fields('kickoff') AS r");
    expect(specs.filter(s => s.type === "longtext")).toHaveLength(12);
    const check = await kickoffCheck(answers);
    expect([check.ok, check.errors]).toEqual([true, {}]);
    const size = await bytes(check.answers);
    expect(size).toBeGreaterThan(65536);
    expect(size).toBeLessThan(120000);
    await rolledBack(async () => {
      await nativeResponse("kickoff", check.answers);
    });
    // Under 20261102f's check (live) the same send failed with 23514, which the CSM saw raw.
    await rolledBack(async () => {
      await db.exec(`ALTER TABLE public.cockpit_form_responses DROP CONSTRAINT cockpit_form_responses_answers_check;
        ALTER TABLE public.cockpit_form_responses ADD CONSTRAINT cockpit_form_responses_answers_check
          CHECK (jsonb_typeof(answers) = 'object' AND octet_length(answers::text) <= CASE WHEN form_key IN ('new_client', 'onboarding') THEN 1048576 ELSE 65536 END)`);
      expect(await answersCheck()).toBe(ANSWERS_F);
      expect((await refusal(() => nativeResponse("kickoff", check.answers))).code).toBe("23514");
    });
    // Four bytes a letter (a script outside the first plane) fit too.
    const wide = await kickoffCheck(
      await kickoffAtMaxima(String.fromCodePoint(0x1d49c), String.fromCodePoint(0x1d4b7)),
    );
    expect([wide.ok, wide.errors]).toEqual([true, {}]);
    expect(await bytes(wide.answers)).toBeGreaterThan(200000);
    expect(await bytes(wide.answers)).toBeLessThanOrEqual(262144);
    await rolledBack(async () => {
      await nativeResponse("kickoff", wide.answers);
    });
  });

  test("past 256 KB the check refuses the answers by name (too_large) and the send stores nothing; a fix the CSM can make comes first", async () => {
    // Only characters JSON writes as six-byte escapes can pass every limit and still not fit.
    const control = String.fromCodePoint(1);
    const answers = await kickoffAtMaxima(control, ARABIC_SHORT);
    const check = await kickoffCheck(answers);
    expect(await bytes(check.answers)).toBeGreaterThan(262144);
    expect([check.ok, check.errors]).toEqual([false, { _answers: "too_large" }]);
    await rolledBack(async () => {
      expect((await refusal(() => nativeResponse("kickoff", check.answers))).code).toBe("23514");
    });
    // Another refusal is named alone, so the sheet says what to fix.
    expect((await kickoffCheck({ ...answers, detailsCorrect: "Maybe" })).errors).toEqual({ detailsCorrect: "option" });
    // 20261102j's send returns the check's refusal before it stores anything (this file keeps that send).
    const j = migration(J);
    const send = fnDef(j, "cockpit_kickoff_submit");
    const refuse = send.indexOf(
      "v_check := public.cockpit_kickoff_answers_check(p_answers);\n  IF NOT (v_check->>'ok')::boolean THEN\n    RETURN jsonb_build_object('ok', false, 'reason', 'invalid', 'errors', v_check->'errors');",
    );
    expect(refuse).toBeGreaterThan(0);
    expect(refuse).toBeLessThan(send.indexOf("INSERT INTO public.cockpit_form_responses"));
    expect(migration(M)).not.toContain("FUNCTION public.cockpit_kickoff_submit(");
  });

  test("with the onboarding's long answers beside it, every step of the kickoff is kept well under 2 MB", async () => {
    const check = await kickoffCheck(await kickoffAtMaxima(ARABIC_LONG, ARABIC_SHORT));
    expect(check.ok).toBe(true);
    await rolledBack(async () => {
      await liveForms();
      await billing();
      // The card's onboarding answer with the nine long ones the handoff prints at 10,000 Arabic characters.
      const long = [O.address, O.hours, "0a80a0a8-3a09-4907-a1d1-6c57e57d4c47", "6271b610-6946-4056-bb08-d03ffc274141",
        "ee25f923-d5e1-4d1a-a95f-cd9c17abbe83", O.marketing, O.challenges, O.whyJoined, O.additional];
      await readModel({
        form_id: "native",
        answers: [
          ...CARD_ONBOARDING.filter(x => !long.includes(x.ref)),
          ...long.map(ref => a(ref, fill(ARABIC_LONG, 10000))),
        ],
      });
      const id = await nativeResponse("kickoff", check.answers);
      const out = await one<Row>("SELECT public.cockpit_form_stage4_plan($1, true) AS r", [id]);
      for (const e of out.effects) expect([e.key, e.reason]).not.toEqual([e.key, TOO_LARGE]);
      expect(byKey(out.effects).onboarding_tasks).toMatchObject({ state: "delivered", reason: null });
      const largest = await one<number>(
        "SELECT max(octet_length(plan::text)) AS r FROM public.cockpit_form_effects WHERE response_id = $1",
        [id],
      );
      // Past 20261027f's 128 KB, kept whole, and under half of the 2 MB a step has.
      expect(largest).toBeGreaterThan(131072);
      expect(largest).toBeLessThan(1048576);
      const { request } = await requestOf(id, "client_onboarding");
      expect(request.task_comment).toContain(`*Business notes:* ${fill(ARABIC_LONG, 3998)}..\n`);
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
      // No details: each task's description holds only what the request writer adds, as Make writes
      // none, and both parts, tech and creative, carry the whole handoff for their task's comment.
      expect(request.answers).toEqual({});
      expect(Object.keys(parts)).toEqual(["creative", "tech"]);
      for (const part of Object.values(parts)) {
        expect(part.taskComment).toBe(task18);
        expect(part.descriptionMarkdown).toBe(
          "**Client Onboarding** for Cedar Homes Invented",
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
      expect(audit.after.answers).toEqual({});
      expect(audit.meta.taskCommentChars).toBe(Array.from(task18).length);
      // The plan again makes no second request.
      await one("SELECT public.cockpit_form_stage4_plan($1, true) AS r", [id]);
      expect(
        await one<number>("SELECT count(*)::int AS r FROM public.cockpit_requests"),
      ).toBe(1);
    });
  });

  test("a handoff past 128 KB is kept whole; past 2 MB the two steps that carry it fail with a plain reason and the rest runs", async () => {
    /** The card's onboarding answer with the nine the handoff prints at n characters each. */
    const longAnswers = (text: string, n: number) => [
      ...CARD_ONBOARDING.filter(x => x.ref !== O.address && x.ref !== O.hours && x.ref !== O.marketing),
      ...[
        O.address,
        O.hours,
        "0a80a0a8-3a09-4907-a1d1-6c57e57d4c47",
        "6271b610-6946-4056-bb08-d03ffc274141",
        "ee25f923-d5e1-4d1a-a95f-cd9c17abbe83",
        O.marketing,
        O.challenges,
        O.whyJoined,
        O.additional,
      ].map(ref => a(ref, text.repeat(Math.ceil(n / text.length)).slice(0, n))),
    ];
    const planBytes = (id: string, key: string) =>
      one<number>(
        "SELECT octet_length(plan::text) AS r FROM public.cockpit_form_effects WHERE response_id = $1 AND effect_key = $2",
        [id, key],
      );
    // The nine at 10,000 Arabic characters each, as many as a native answer takes (two bytes a letter).
    await rolledBack(async () => {
      await liveForms();
      await billing();
      await readModel({ form_id: "native", answers: longAnswers(`${ARABIC_NOTE}\n`, 10000) });
      const id = await nativeResponse("kickoff", NATIVE_KICKOFF);
      const out = await one<Row>("SELECT public.cockpit_form_stage4_plan($1, true) AS r", [id]);
      expect(byKey(out.effects).onboarding_tasks).toMatchObject({ state: "delivered", reason: null });
      expect(await planBytes(id, "handoff_comment")).toBeGreaterThan(131072);
      expect(await planBytes(id, "onboarding_tasks")).toBeGreaterThan(131072);
      const handoff = await one<string>(
        "SELECT plan->>'comment_text' AS r FROM public.cockpit_form_effects WHERE response_id = $1 AND effect_key = 'handoff_comment'",
        [id],
      );
      expect(handoff).toContain(`\n*Marketing tried before:* ${`${ARABIC_NOTE}\n`.repeat(200).slice(0, 10000)}\n`);
      const { request, parts } = await requestOf(id, "client_onboarding");
      expect(request.task_comment).toBe(handoff);
      for (const part of Object.values(parts)) expect(part.taskComment).toBe(handoff);
    });
    // The nine at 240,000 characters each, as a Typeform answer in the read model can be.
    await rolledBack(async () => {
      await liveForms();
      await billing();
      await readModel({ form_id: "KFRCXPFx", answers: longAnswers("Invented answer, typed long. ", 240000) });
      const id = await nativeResponse("kickoff", NATIVE_KICKOFF);
      const out = await one<Row>("SELECT public.cockpit_form_stage4_plan($1, true) AS r", [id]);
      const fx = byKey(out.effects);
      for (const key of ["handoff_comment", "onboarding_tasks"]) {
        expect(fx[key]).toMatchObject({ owner: "cockpit", state: "failed", reason: TOO_LARGE });
        const plan = await one<Row>(
          "SELECT plan AS r FROM public.cockpit_form_effects WHERE response_id = $1 AND effect_key = $2",
          [id, key],
        );
        expect(Object.keys(plan).sort()).toEqual(["lines", "planBytes"]);
        expect(plan.planBytes).toBeGreaterThan(2097152);
      }
      expect(TOO_LARGE.length).toBeLessThanOrEqual(240);
      expect(
        await one<number>("SELECT count(*)::int AS r FROM public.cockpit_requests"),
      ).toBe(0);
      // Every other step is planned as a dry run of the same answer plans it, which still shows the whole
      // handoff (the queue here is a stand-in, so the ClickUp steps go no further than planned).
      const dry = byKey((await one<Row>("SELECT public.cockpit_form_stage4_plan($1, false) AS r", [id])).effects);
      expect(dry.handoff_comment.plan.comment_text.length).toBeGreaterThan(2097152);
      const stored = await db.query<Row>(
        "SELECT effect_key, plan FROM public.cockpit_form_effects WHERE response_id = $1 AND effect_key NOT IN ('handoff_comment', 'onboarding_tasks')",
        [id],
      );
      expect(stored.rows.length).toBe(Object.keys(dry).length - 2);
      for (const e of stored.rows) {
        expect(fx[e.effect_key].reason).not.toBe(TOO_LARGE);
        expect(e.plan).toEqual(dry[e.effect_key].plan ?? {});
      }
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
 * An effect with the parts 20261102o changes taken out: the five texts, the onboarding tasks' comment
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
