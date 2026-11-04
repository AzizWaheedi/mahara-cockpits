/**
 * Stage 4: Make is the floor, better data on top (20261102p_stage4_better_data.sql; the CEO, 2026-11-02:
 * "You can even improve what's already there with the data that you have. So you can add more if it
 * gives us better data.").
 *
 * The functions 20261102p reads or replaces are cut from their canonical migrations (20261025n,
 * 20261102a, 20261102j, 20261102l, 20261102o), the way stage4-match-make-supabase.test.ts stands on what
 * o reads, and the ground proves each replaced body is the one the drift guard names: 20261102o's
 * builder, 20261102l's effects arrays and 20261025n's kickoff facts (live). Stand-in tables give the
 * builder, the briefs, card_facts and the registry step the columns they read. 20261102o's builder is
 * also kept under a _m name, 20261102l's arrays under _l and 20261025n's facts under _live, so every
 * part of the plan Make writes is compared with what it was, byte for byte.
 *
 * Covered: the prerequisite and the drift guard; the after values; a second apply; owner-only grants;
 * Make's part of every effect equal to 20261102o's on invented kickoffs and onboardings; the onboarding
 * tasks' brief (B1) and the Brand DNA brief (B2) line by line, with their missing-value rules, the
 * per-value cuts, the 3,600-character cap and its drop order; a request type with no details field said
 * in the plan; the kickoff notice's open items (B4); card_facts for both forms (B8): the five fields
 * only, each onlyIfEmpty, option ids from the s40 snapshot, an unknown option planned nowhere; the
 * effects arrays and the registry step. Every client, card, person and answer is invented.
 */
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  setDefaultTimeout,
  test,
} from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { PGlite } from "@electric-sql/pglite";
import { cockpitTestDb, migration } from "./lib/cockpitTestDb";

setDefaultTimeout(120_000);

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const A_FILE = "20261102a_forms_invites.sql";
const N25 = "20261025n_slack_notices.sql";
const J = "20261102j_stage4_native.sql";
const L = "20261102l_stage4_no_client_data_row.sql";
// M and N keep the letters the two files were first drafted under: the goals sheet's 20261102m and
// 20261102n reached live first (2026-11-02), so match Make is 20261102o and better data 20261102p.
const M = "20261102o_stage4_match_make.sql";
const N = "20261102p_stage4_better_data.sql";
/** onboarding.raw_titles as D-S4F fills it. */
const RAW_TITLES = JSON.parse(
  readFileSync(`${ROOT}scripts/dev/forms-deploy/stage4-raw-titles.json`, "utf8"),
);

/** md5(white space folded prosrc) of the bodies 20261102p replaces, as its drift guard names them. */
const BEFORE_N = {
  "cockpit_form_stage4_build(jsonb)": "a565db2d881852ff3a1481a438768e20",
  "cockpit_form_stage4_effects(text,integer)": "1b01ccc56e88b8fa4f4fc8985d36c93c",
  "cockpit_slack_notice_kickoff_facts(text,text,jsonb,text)":
    "3ecb0f63f577ec3712789bdad68bded8",
} as const;
const NEW_FNS = [
  "cockpit_form_stage4_cut(text,integer)",
  "cockpit_form_stage4_link_kind(text)",
  "cockpit_form_stage4_open_items(jsonb)",
  "cockpit_form_stage4_onboarding_call(text,timestamptz)",
  "cockpit_form_stage4_brief_line(integer,text,text,integer,text)",
  "cockpit_form_stage4_brief_join(jsonb,integer)",
  "cockpit_form_stage4_link_flags(jsonb)",
  "cockpit_form_stage4_details_note(text)",
  "cockpit_form_stage4_task_brief(text,jsonb,timestamptz)",
  "cockpit_form_stage4_dna_brief(text,jsonb,text)",
  "cockpit_form_stage4_card_facts(text,text,jsonb,timestamptz)",
] as const;
const BRIEF_HEAD = "From the onboarding and kickoff forms (cockpit)";
const DNA_HEAD = "For the Brand DNA doc (cockpit)";
const CAP = 3600;

const TASK = "taskCedar1";
const PAGE = `https://cockpit.maharamedia.com/client-success/clients/${TASK}`;
/** The card's links (invented). */
const LINKS = {
  drive: "https://drive.google.com/drive/folders/inventedCedar01",
  ghl: "https://app.gohighlevel.com/v2/location/inventedLoc01",
  brand_dna: "https://docs.google.com/document/d/inventedDna01/edit",
  offer_sheet: "https://docs.google.com/document/d/inventedOffer01/edit",
};
/** The five card_facts fields (s40 snapshot) and their options. */
const FIELD = {
  consultation: "45fdd2ea-f83c-4721-bce7-2e6187a43541",
  platform: "2de15aa5-7fe9-48bf-86a1-e4cfee1306c9",
  fathom: "abaa31ee-28ff-46f6-83bf-6c6d357a26d5",
  callDate: "ee9bf855-e05b-4afc-addf-1063cb54d3f0",
  website: "5d57fdde-eb70-4610-a23b-88f718b4451d",
};
const OPT = {
  inOffice: "82279634-6601-4dd2-a1bc-af6737260b6b",
  inHome: "387c686d-5652-4635-abe6-10621f8359b3",
  online: "d9c0f5a6-6db5-4e97-8dd4-cc80247b96ae",
  meta: "88d55b4b-f296-4a0b-abc6-3b228889444a",
  tiktok: "c115bdfe-661f-4855-a86b-69a54b2e616a",
  snapchat: "97b22a7b-c18b-4be9-bd03-ff271bacfd77",
};
/** tG7dnxBn refs. */
const K = {
  detailsOk: "c0000001-0000-4000-8000-000000000001",
  service: "c0000001-0000-4000-8000-000000000007",
  consult: "c0000001-0000-4000-8000-000000000008",
  contract: "c0000001-0000-4000-8000-00000000000a",
  platforms: "7d16afbb-b99a-4ee9-8718-4418cbeba534",
  funded: "8bee68fc-0764-41a8-b90a-db2a3f401e9d",
  calendar: "3bebf47d-c00b-4f26-8624-933b84e42ebc",
  fbAccess: "6fcbd33c-60e9-4df7-bfaa-e76b588dd887",
  waSync: "a813378f-06ce-499e-8f0e-14761b89b474",
  maharaOs: "ad562fc2-6858-4e37-81c5-c4cc2375a330",
  training: "c56a7e2d-6f18-4bf9-a9f6-11367eab4c11",
  hasLeads: "dff79b66-89dd-43ef-9664-3fa4e6a61d69",
  reachLeads: "85d7ebb5-ce36-4ac3-aff8-3ce464737abd",
  leadFile: "86a6cce0-9111-4d98-97e7-7af5b6d518c8",
  payment: "75e97e7d-4c19-437a-b4b8-67570c29344f",
  recording: "b5578678-d0c2-475b-b66f-7ea54d55fe31",
} as const;
/** KFRCXPFx refs. */
const O = {
  fullName: "533f14a0-712f-4de9-9ac7-67e1be6bc0c8",
  phone: "64f2fb80-b074-4017-b8b7-b7d549947e52",
  email: "7994f0d2-baeb-451b-983a-816290873a68",
  businessName: "514bfd3f-4ca1-469e-b9e7-87656503f65c",
  website: "454a425f-2ac6-4d94-92db-cec08618600e",
  instagram: "adecfe45-5d55-4319-98ff-3761e04bfc9b",
  facebook: "575d17ed-e26d-4e55-87d3-7cb31cb71939",
  paymentOptions: "ee25f923-d5e1-4d1a-a95f-cd9c17abbe83",
  frontDesk: "282dac48-5031-4acb-96b6-ea469e8a5a8b",
  personalPhone: "09d2e62a-51d4-4665-a3a9-30f5279b71bc",
  years: "ed1ba2fe-2827-4eea-a678-62205f1ce9f5",
  booking: "7a120dbb-0169-4bcc-9193-5c525a470d02",
  facebookAds: "ddf2767d-5725-4df2-b200-f0aab77a2db5",
  projects: "0a6b5704-c46d-480c-a592-b59108683596",
  hours: "b7873d40-d154-42ac-bf24-cb3b667e84cc",
  services: "d976036f-6c2e-4d5d-999a-64cf9bb2ef02",
  focus: "6271b610-6946-4056-bb08-d03ffc274141",
  ideal: "6c819933-3eb9-4db8-bd59-d39be11cb7f0",
  areas: "fa017616-3fb5-4e64-9fbd-39cea6e26c47",
  appointments: "b370341c-6ea3-43c9-bd8c-16e278a2d2d5",
  maxDistance: "35ea63c3-090a-425d-b75c-e3d183d48cd1",
  landmark: "b7c403ea-8d66-4814-80cf-7e8d7fdb8d11",
  apptLength: "a20cfc1a-0228-413d-80ab-d97fc97574e0",
  consultants: "0a80a0a8-3a09-4907-a1d1-6c57e57d4c47",
  whyJoined: "7426c6c5-344f-44c9-9999-3b9daf3a06b8",
  freeConsults: "ec89854f-d006-402b-958a-91738e2b3e7a",
  lastRevenue: "7ff5d37a-df7f-4002-8248-d0b4af6c28e8",
  goal90: "791b99b8-c7e9-40a4-96d6-868399e1ae97",
} as const;
const APPT = {
  online: "عن بُعد (أونلاين) | Online",
  onsite: "في موقع العميل / في المنزل | Onsite / In-home",
  office: "في مقرّكم / مكتبكم | In your office",
};
const FREE_YES =
  "Yes, we do offer free consultations / نعم، نقدم استشارات مجانية✅";
const UNSURE = "IM UNSURE | لست متأكدًا";
const NEVER_RAN =
  "I Have a Business Account but have never ran ads | لديّ حساب أعمال على فيسبوك لكنني لم أقم بتشغيل إعلانات من قبل";
/** A services answer over 500 characters (invented). */
const SERVICES = `Design and build of villas, fit out and renovation. ${"Kitchens, bathrooms and majlis rooms; ".repeat(14)}`.trim();
/** The contact answers that never go into a brief. */
const CONTACT = {
  fullName: "Invented Owner Name",
  phone: "+96500000001",
  email: "owner@cedar.invalid",
  personalPhone: "+96500000004",
};

type Row = Record<string, any>;
type Answer = { ref: string; title: string; value: string };
const a = (ref: string, value: string, title = "Stored title"): Answer => ({
  ref,
  title,
  value,
});
const json = (v: unknown) => JSON.stringify(v);

let db: PGlite;
let DAY = "";
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
const renamed = (sql: string, name: string, suffix: string) =>
  fnDef(sql, name).replace(`FUNCTION public.${name}(`, `FUNCTION public.${name}${suffix}(`);
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
const build = (input: unknown, suffix = "") =>
  one<Row[]>(`SELECT public.cockpit_form_stage4_build${suffix}($1::jsonb) AS r`, [
    json(input),
  ]);
const byKey = (effects: Row[]) =>
  Object.fromEntries(effects.map(e => [e.key, e]));
/** The card's client record: its name, links and stored answers (Typeform-shaped). */
const card = (opts: { onboarding?: Answer[] | null; links?: Row; name?: string; task?: string } = {}) =>
  db.query(
    "INSERT INTO public.cockpit_client_onboarding(clickup_task_id, client_name, forms, links) VALUES ($1, $2, $3::jsonb, $4::jsonb)",
    [
      opts.task ?? TASK,
      opts.name ?? "Cedar Homes Invented",
      json(
        opts.onboarding === null
          ? {}
          : {
              onboarding: {
                form_id: "KFRCXPFx",
                response_id: "tokCedarOnb1",
                submitted_at: "2026-10-20T09:00:00Z",
                answers: opts.onboarding ?? ONBOARDING,
              },
            },
      ),
      json(opts.links ?? LINKS),
    ],
  );
/** A stored call; by default placed on the card by an exact sign (appointment_time at 1). */
const call = (opts: {
  at: string;
  recording?: string | null;
  kind?: string;
  source?: string;
  status?: string;
  task?: string;
  method?: string | null;
  confidence?: number | null;
}) =>
  db.query(
    "INSERT INTO public.cockpit_csm_calls(source, task_id, kind, status, starts_at, recording_url, match_method, match_confidence) VALUES ($1, $2, $3, $4, $5::timestamptz, $6, $7, $8)",
    [
      opts.source ?? "fathom",
      opts.task ?? TASK,
      opts.kind ?? "onboarding",
      opts.status ?? "held",
      opts.at,
      opts.recording === undefined ? "https://fathom.video/calls/invented0002" : opts.recording,
      opts.method === undefined ? "appointment_time" : opts.method,
      opts.confidence === undefined ? 1 : opts.confidence,
    ],
  );
const requestType = (key: string, withDetails: boolean) =>
  db.query(
    "INSERT INTO public.cockpit_request_types(key, version, label, enabled, fields) VALUES ($1, 1, $1, true, $2::jsonb)",
    [
      key,
      json([
        { key: "client", label: "Client", kind: "client", required: true },
        ...(withDetails ? [{ key: "details", label: "Details", kind: "details", required: false }] : []),
      ]),
    ],
  );

// --- Synthetic answers ---------------------------------------------------------------------------

/** The card's stored onboarding answer (Typeform-shaped; invented). Projects completed is unanswered. */
const ONBOARDING: Answer[] = [
  a(O.fullName, CONTACT.fullName),
  a(O.phone, CONTACT.phone),
  a(O.email, CONTACT.email),
  a(O.businessName, "Cedar Homes Invented Co"),
  a(O.website, "https://www.instagram.com/cedar.invented"),
  a(O.instagram, "https://www.instagram.com/cedar.invented"),
  a(O.facebook, "https://instagram.com/cedar.invented"),
  a(O.paymentOptions, "Two parts: half at signing"),
  a(O.frontDesk, "+96500000003"),
  a(O.personalPhone, CONTACT.personalPhone),
  a(O.years, "6 years"),
  a(O.booking, "None"),
  a(O.facebookAds, UNSURE),
  a(O.hours, "Sat to Thu 9 to 5"),
  a(O.services, SERVICES),
  a(O.focus, "Villas"),
  a(O.ideal, "A full villa in the north"),
  a(O.areas, "Kuwait City and Hawalli"),
  a(O.appointments, `${APPT.onsite}, ${APPT.online}`),
  a(O.maxDistance, "30 km"),
  a(O.landmark, "Next to the invented mall"),
  a(O.apptLength, "One hour, 15 minutes buffer"),
  a(O.consultants, "Two engineers"),
  a(O.whyJoined, "To grow steadily"),
  a(O.freeConsults, FREE_YES),
  a(O.lastRevenue, "250000"),
  a(O.goal90, "100000"),
];
/** A kickoff with open setup items (invented). */
const KICKOFF: Answer[] = [
  a(K.detailsOk, "Yes"),
  a(K.service, "Fit out and renovation, Design and build"),
  a(K.consult, "In-office, In-home or onsite"),
  a(K.contract, "Sent and waiting on client"),
  a(K.platforms, "Meta (Facebook and Instagram)"),
  a(K.funded, "No"),
  a(K.calendar, "Yes"),
  a(K.fbAccess, "Waiting on Client"),
  a(K.waSync, "Integrated"),
  a(K.maharaOs, "Logged In"),
  a(K.training, "Requested"),
  a(K.hasLeads, "Yes"),
  a(K.reachLeads, "Yes"),
  a(K.payment, "1500"),
  a(K.recording, "https://fathom.video/share/invented0001"),
];
const HIDDEN: Record<string, string> = {
  onboarding_client_id: TASK,
  legal_name: "Cedar Homes Invented Co",
  phone: CONTACT.phone,
  email: CONTACT.email,
  hours: "Sat to Thu 9 to 5",
  consultants: "Two engineers",
  consultation_types: `${APPT.onsite},${APPT.online}`,
  last_revenue: "250000",
};
const kickoffInput = (answers: Answer[], extra: Row = {}) => ({
  formKey: "kickoff",
  taskId: TASK,
  client: "Cedar Homes Invented",
  responseId: "00000000-0000-4000-8000-00000000c0de",
  submittedAt: "2026-11-01T09:00:00Z",
  second: false,
  answers,
  hidden: HIDDEN,
  newMrrUsd: 2500,
  cardMrr: 2000,
  cardOnSheet: true,
  readModelFormId: "native",
  readModelResponseId: "00000000-0000-4000-8000-00000000c0de",
  ...extra,
});
const onboardingInput = (answers: Answer[], extra: Row = {}) => ({
  formKey: "onboarding",
  taskId: TASK,
  client: "Cedar Homes Invented",
  responseId: "00000000-0000-4000-8000-0000000000b1",
  submittedAt: "2026-10-20T09:00:00Z",
  second: false,
  answers,
  hidden: {},
  readModelFormId: "native",
  readModelResponseId: "00000000-0000-4000-8000-0000000000b1",
  ...extra,
});

// --- The ground ----------------------------------------------------------------------------------

/** The columns the builder, the briefs, card_facts, the kickoff facts and the registry step read. */
const STAND_INS = `
  CREATE TABLE public.cockpit_client_onboarding (clickup_task_id text PRIMARY KEY, client_name text, forms jsonb,
    links jsonb, synced_at timestamptz);
  CREATE TABLE public.cockpit_form_responses (id uuid PRIMARY KEY, form_key text, form_version integer, source text,
    external_id text, task_id text, client_name text, mode text, state text, answers jsonb, answer_meta jsonb,
    hidden jsonb, submitted_at timestamptz, created_by_id uuid, created_at timestamptz NOT NULL DEFAULT now());
  CREATE TABLE public.cockpit_forms (key text PRIMARY KEY, provider text, effects jsonb, version integer, schema jsonb,
    updated_by text, updated_at timestamptz);
  CREATE TABLE public.cockpit_request_types (key text PRIMARY KEY, version integer, label text, enabled boolean,
    fields jsonb, targets jsonb, due_days integer, priority text);
  CREATE TABLE public.cockpit_csm_calls (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, source text, task_id text,
    kind text, status text, starts_at timestamptz, recording_url text, match_method text, match_confidence numeric);
  CREATE TABLE public.cockpit_csm_form_sends (response_id text PRIMARY KEY, second boolean NOT NULL);`;
/** What 20261102o's builder calls, from its canonical migrations. */
const J_FNS = [
  "cockpit_form_stage4_setting",
  "cockpit_form_stage4_card_fields",
  "cockpit_form_stage4_hidden_map",
  "cockpit_form_stage4_ts",
  "cockpit_form_stage4_text",
  "cockpit_form_stage4_render",
  "cockpit_form_stage4_message",
  "cockpit_form_stage4_map_url",
] as const;
const M_FNS = [
  "cockpit_form_typeform_text",
  "cockpit_form_stage4_make_text",
  "cockpit_form_stage4_handoff_text",
  "cockpit_form_stage4_profile_text",
  "cockpit_form_stage4_raw_answers_text",
  "cockpit_form_stage4_fields",
  "cockpit_form_stage4_typeform_answers",
  "cockpit_form_stage4_build",
] as const;

beforeAll(async () => {
  db = await cockpitTestDb({ supabaseDefaultPrivileges: true });
  await db.exec(
    cut(
      migration("20260921a_cockpit_settings.sql"),
      /create table if not exists public\.cockpit_settings \([\s\S]*?\n\);/,
      "settings",
    ),
  );
  await db.exec(fnDef(migration(A_FILE), "cockpit_client_text_ok"));
  await db.exec(STAND_INS);
  const j = migration(J);
  await db.exec(
    cut(j, /CREATE TABLE IF NOT EXISTS public\.cockpit_form_option_maps \([\s\S]*?\n\);/, "option maps"),
  );
  await db.exec(
    cut(
      j,
      /INSERT INTO public\.cockpit_form_option_maps\(form_key, field_id, answer, option_name\) VALUES[\s\S]*?ON CONFLICT \(form_key, field_id, answer\) DO NOTHING;/,
      "option map rows",
    ),
  );
  for (const name of J_FNS) await db.exec(fnDef(j, name));
  const l = migration(L);
  await db.exec(fnDef(l, "cockpit_form_stage4_effects"));
  await db.exec(renamed(l, "cockpit_form_stage4_effects", "_l"));
  const m = migration(M);
  for (const name of M_FNS) await db.exec(fnDef(m, name));
  await db.exec(renamed(m, "cockpit_form_stage4_build", "_m"));
  const n25 = migration(N25);
  await db.exec(fnDef(n25, "cockpit_slack_notice_kickoff_facts"));
  await db.exec(renamed(n25, "cockpit_slack_notice_kickoff_facts", "_live"));
  // The registry as live holds it: both forms on Typeform with their version-1 arrays.
  await db.query(
    `INSERT INTO public.cockpit_forms(key, provider, effects, version) VALUES
       ('kickoff', 'typeform', public.cockpit_form_stage4_effects('kickoff', 1), 1),
       ('onboarding', 'typeform', public.cockpit_form_stage4_effects('onboarding', 1), 1)`,
  );
  for (const fn of Object.keys(BEFORE_N)) groundMd5[fn] = await md5Of(fn);
  await db.exec(migration(N));
  DAY = await one<string>(
    "SELECT to_char((now() AT TIME ZONE 'Asia/Kuwait')::date, 'YYYY-MM-DD') AS r",
  );
});
afterAll(async () => {
  await db?.close();
});

/** The guard line of one replaced function in this file. */
const guardLine = (fn: string) =>
  migration(N)
    .split("\n")
    .find(x => x.includes(`('public.${fn}', '`)) ?? "";

// --- The file ------------------------------------------------------------------------------------

describe("20261102p: the file", () => {
  test("the ground holds the bodies the drift guard names: 20261102o's builder, 20261102l's arrays, 20261025n's facts", () => {
    expect(groundMd5).toEqual({ ...BEFORE_N });
    for (const [fn, md5] of Object.entries(BEFORE_N))
      expect(guardLine(fn)).toContain(`('public.${fn}', '${md5}', '`);
  });

  test("the after values are this file's bodies, and the prerequisite names them too", async () => {
    const sql = migration(N);
    for (const fn of Object.keys(BEFORE_N)) {
      const now = await md5Of(fn);
      expect(now).not.toBe(BEFORE_N[fn as keyof typeof BEFORE_N]);
      expect(guardLine(fn)).toContain(`', '${now}')`);
    }
    expect(sql).toContain(
      `NOT IN ('${BEFORE_N["cockpit_form_stage4_build(jsonb)"]}', '${await md5Of("cockpit_form_stage4_build(jsonb)")}')`,
    );
  });

  test("a second apply changes nothing", async () => {
    const snapshot = async () => ({
      md5: await Promise.all([...Object.keys(BEFORE_N), ...NEW_FNS].map(fn => md5Of(fn))),
      registry: await one("SELECT jsonb_agg(to_jsonb(f) ORDER BY key) AS r FROM public.cockpit_forms f"),
    });
    await rolledBack(async () => {
      const before = await snapshot();
      await db.exec(inTest(N));
      expect(await snapshot()).toEqual(before);
    });
  });

  test("20261102l's or any other builder asks for 20261102o first; a changed body stops the file", async () => {
    await rolledBack(async () => {
      await db.exec(fnDef(migration(L), "cockpit_form_stage4_build"));
      expect(await refusal(() => db.exec(inTest(N)))).toEqual({
        code: "55000",
        message: "Apply 20261102o before 20261102p.",
      });
    });
    await rolledBack(async () => {
      const def = await one<string>(
        "SELECT pg_get_functiondef('public.cockpit_form_stage4_build(jsonb)'::regprocedure) AS r",
      );
      await db.exec(def.replace("BEGIN", "BEGIN  /* changed */"));
      expect((await refusal(() => db.exec(inTest(N)))).message).toBe(
        "Apply 20261102o before 20261102p.",
      );
    });
    for (const fn of [
      "cockpit_form_stage4_effects(text,integer)",
      "cockpit_slack_notice_kickoff_facts(text,text,jsonb,text)",
    ])
      await rolledBack(async () => {
        const def = await one<string>("SELECT pg_get_functiondef($1::regprocedure) AS r", [
          `public.${fn}`,
        ]);
        await db.exec(def.replace("BEGIN", "BEGIN  /* changed */"));
        expect(await refusal(() => db.exec(inTest(N)))).toEqual({
          code: "55000",
          message: `${fn} changed since 20261102o; stop and re-read it.`,
        });
      });
  });

  test("every function it makes or replaces is the owner's only", async () => {
    for (const fn of [...Object.keys(BEFORE_N), ...NEW_FNS])
      expect(
        await one<string>(
          "SELECT coalesce(proacl::text, '') AS r FROM pg_proc WHERE oid = to_regprocedure($1)",
          [`public.${fn}`],
        ),
      ).toBe("{postgres=X/postgres}");
  });
});

// --- Make's part ---------------------------------------------------------------------------------

/**
 * A plan without this file's additions: no card_facts; the two tasks' plans without details,
 * detailsKind, detailsMissing and their last line. Everything else as built.
 */
function makePart(effects: Row[]): Row[] {
  return effects
    .filter(e => e.key !== "card_facts")
    .map(e => {
      if (e.key !== "onboarding_tasks" && e.key !== "brand_dna_task") return e;
      const { details, detailsKind, detailsMissing, ...plan } = e.plan;
      return { ...e, plan: { ...plan, lines: plan.lines.slice(0, -1) } };
    });
}

describe("Make's part of every effect is 20261102o's, byte for byte", () => {
  const cases: [string, () => Row][] = [
    ["a kickoff with every kind of answer", () => kickoffInput(KICKOFF)],
    ["a kickoff with no answers and no hidden values", () => kickoffInput([], { hidden: {} })],
    ["a second kickoff", () => kickoffInput(KICKOFF, { second: true })],
    ["a kickoff off the billing sheet, New MRR 0", () => kickoffInput(KICKOFF, { cardOnSheet: false, newMrrUsd: 0 })],
    ["an onboarding answer", () => onboardingInput(ONBOARDING)],
    ["an onboarding with no answers", () => onboardingInput([])],
  ];
  for (const [what, input] of cases)
    test(what, async () => {
      for (const titles of [{}, RAW_TITLES])
        for (const maps of [{}, { 3: "https://map.invalid/?p=3&cid={task}", 4: "https://map.invalid/?p=4&cid={task}" }])
          for (const types of [false, true])
            for (const stored of [false, true])
              await rolledBack(async () => {
                await setting("onboarding.raw_titles", titles);
                await setting("onboarding.map_urls", maps);
                await setting("stage4.messages", { phase3: "Phase 3 for {client}: {map_link}", phase4: "Phase 4 for {client}: {map_link}" });
                if (types) {
                  await requestType("client_onboarding", true);
                  await requestType("brand_dna", true);
                }
                if (stored) {
                  await card();
                  await call({ at: "2026-10-31T09:00:00Z" });
                }
                const was = await build(input(), "_m");
                const now = await build(input());
                expect(json(makePart(now))).toBe(json(was));
                // The comments, the Client Profile, the dropdowns and the dispatch, as text.
                const w = byKey(was);
                const x = byKey(now);
                for (const k of ["handoff_comment", "raw_answers_comment"])
                  if (w[k]) expect(x[k].plan.comment_text).toBe(w[k].plan.comment_text);
                if (w.onboarding_tasks)
                  expect(x.onboarding_tasks.plan.comment_text).toBe(w.onboarding_tasks.plan.comment_text);
                for (const k of ["profile_fields", "card_fields", "map_phase3", "map_phase4", "github_dispatch"])
                  if (w[k]) expect(json(x[k])).toBe(json(w[k]));
              });
    });
});

// --- B1: the onboarding tasks' brief --------------------------------------------------------------

const brief = async (input: Row) => {
  const fx = byKey(await build(input));
  return fx.onboarding_tasks.plan as Row;
};

describe("B1: the onboarding tasks' brief", () => {
  test("a full kickoff on a card with its onboarding answer, links and call: every section, line by line", async () => {
    await rolledBack(async () => {
      await card();
      await requestType("client_onboarding", true);
      const plan = await brief(kickoffInput(KICKOFF));
      expect(plan.detailsKind).toBe("brief");
      expect(plan.detailsMissing).toBeUndefined();
      expect(plan.details).toBe(
        [
          BRIEF_HEAD,
          `Read from the cockpit on ${DAY} (Kuwait). Answers are as typed. The whole onboarding answer is in the Raw Onboarding Form Answers comment on the client card.`,
          "",
          "Links",
          `- Cockpit client page: ${PAGE}`,
          `- Drive folder (from the card): ${LINKS.drive}`,
          `- GHL: ${LINKS.ghl}`,
          `- Brand DNA doc: ${LINKS.brand_dna}`,
          `- Offer Cheat Sheet: ${LINKS.offer_sheet}`,
          "- Market Research doc: not ready yet; the market intel job adds it to the card",
          "- Call recording: https://fathom.video/share/invented0001",
          "",
          "Still open from the kickoff",
          "- Funded card not linked",
          "- Facebook access: Waiting on Client",
          "- Training course: Requested",
          "- Contract: Sent and waiting on client",
          "- Lead file missing",
          "",
          "For the tech setup (Calendars, Call Center, Custom Values)",
          "- Appointment types (confirmed at kickoff): In-office, In-home or onsite",
          "- Appointment length and buffer: One hour, 15 minutes buffer",
          "- Hours: Sat to Thu 9 to 5",
          "- Consultants: Two engineers",
          "- Furthest they travel: 30 km",
          "- Landmark: Next to the invented mall",
          `- Free consultations: ${FREE_YES}`,
          "- Front desk phone: +96500000003",
          "- Payment options: Two parts: half at signing",
          `- Meta Business Manager: ${UNSURE} (needs the access link)`,
          "- Booking software: None (no system to connect)",
          "- Service areas: Kuwait City and Hawalli",
          `- Services and prices: ${SERVICES.slice(0, 499)}… (whole answer: raw answers comment on the card)`,
          "",
          "For creative",
          "- Services advertised (ticked at kickoff, in order; the card shows only the first): Fit out and renovation, Design and build",
          "- #1 service: Villas",
          "- Years in business: 6 years",
          "- Link check: The Facebook answer is an Instagram link. The website answer is a social link.",
          "",
          "Not in the forms: Projects completed.",
        ].join("\n"),
      );
      expect(plan.lines).toEqual([
        "Technical Onboarding Check and Creative Onboarding tasks",
        `Cockpit brief in each task's description (${[...plan.details].length} characters)`,
      ]);
      // No full name, personal phone, client phone or email.
      for (const v of Object.values(CONTACT)) expect(plan.details).not.toContain(v);
    });
  });

  test("missing values: no card links, the call store's recording, a hidden max distance, the onboarding's types, unanswered lines named", async () => {
    await rolledBack(async () => {
      const onboarding = ONBOARDING.filter(
        x => ![O.landmark, O.areas, O.focus].includes(x.ref as never),
      ).map(x =>
        x.ref === O.appointments ? a(O.appointments, `${APPT.office}, ${APPT.online}`)
        : x.ref === O.facebookAds ? a(O.facebookAds, NEVER_RAN)
        : x.ref === O.booking ? a(O.booking, "Fresha")
        : x.ref === O.services ? a(O.services, "Villas and fit out")
        : x.ref === O.facebook ? a(O.facebook, "https://www.facebook.com/cedar.invented")
        : x.ref === O.website ? a(O.website, "https://cedar.invalid")
        : x,
      );
      await card({ onboarding, links: { drive: "not a link", ghl: null } });
      // A call 2 days before the kickoff, its recording in the store; a later one past the kickoff
      // and an older one out of the window are not read.
      await call({ at: "2026-10-30T10:00:00Z", recording: "https://fathom.video/calls/inventedStore" });
      await call({ at: "2026-11-01T10:00:00Z", recording: "https://fathom.video/calls/inventedLater" });
      await call({ at: "2026-10-20T10:00:00Z", recording: "https://fathom.video/calls/inventedOld" });
      const kickoff = KICKOFF.filter(x => ![K.recording, K.consult, K.service].includes(x.ref as never));
      const { details } = await brief(kickoffInput(kickoff));
      const lines = (details as string).split("\n");
      for (const label of ["Drive folder (from the card)", "GHL", "Brand DNA doc", "Offer Cheat Sheet"])
        expect(lines).toContain(`- ${label}: not on the card yet`);
      expect(lines).toContain("- Call recording: https://fathom.video/calls/inventedStore (from the call store)");
      expect(lines).toContain(`- Appointment types: ${APPT.office}, ${APPT.online} (from the onboarding)`);
      // Max distance only with an onsite or in-home type: left out, and not named as missing.
      expect(details).not.toContain("Furthest they travel");
      expect(lines).toContain(`- Meta Business Manager: ${NEVER_RAN}`);
      expect(lines).toContain("- Booking software: Fresha");
      expect(lines).toContain("- Services and prices: Villas and fit out");
      expect(details).not.toContain("Link check");
      expect(lines.at(-1)).toBe(
        "Not in the forms: Landmark, Service areas, Services advertised, #1 service, Projects completed.",
      );
    });
  });

  test("20261103b's question list (B0): a restricted account prints KFRCXPFx's label with no access-link note; unsure keeps its note", async () => {
    // KFRCXPFx's fifth Meta choice, which 20261103b adds to cockpit_form_stage4_fields (live after B0).
    const RESTRICTED = "My Account is restricted | حسابي مقيّد";
    const meta = async (value: string) => {
      await card({ onboarding: ONBOARDING.map(x => (x.ref === O.facebookAds ? a(O.facebookAds, value) : x)) });
      const { details } = await brief(kickoffInput(KICKOFF));
      return (details as string).split("\n").filter(l => l.startsWith("- Meta Business Manager: "));
    };
    for (const [value, line] of [
      [RESTRICTED, `- Meta Business Manager: ${RESTRICTED}`],
      [UNSURE, `- Meta Business Manager: ${UNSURE} (needs the access link)`],
    ])
      await rolledBack(async () => {
        await db.exec(fnDef(migration("20261103b_onboarding_v2_hints.sql"), "cockpit_form_stage4_fields"));
        const options = await one<Row[]>(
          "SELECT f->'options' AS r FROM jsonb_array_elements(public.cockpit_form_stage4_fields('onboarding')) f WHERE f->>'key' = 'facebookAds'",
        );
        expect(options.map(o => o.value)).toEqual(["yes", "unsure", "ran_before", "never_ran", "restricted"]);
        expect([value, await meta(value)]).toEqual([value, [line]]);
      });
  });

  test("no recording anywhere: the line is left out and named; the kickoff's types hide max distance", async () => {
    await rolledBack(async () => {
      await card();
      await call({ at: "2026-10-31T10:00:00Z", recording: null });
      const kickoff = KICKOFF.filter(x => x.ref !== K.recording).map(x =>
        x.ref === K.consult ? a(K.consult, "Online") : x,
      );
      const { details } = await brief(kickoffInput(kickoff));
      expect(details).not.toContain("- Call recording:");
      expect(details).not.toContain("Furthest they travel");
      expect((details as string).split("\n").at(-1)).toBe(
        "Not in the forms: Call recording, Projects completed.",
      );
    });
  });

  test("a call the worker placed from a likely sign settles nothing (A7.14 rule 2): the recording is named missing", async () => {
    await rolledBack(async () => {
      await card();
      // In the window, each with a link: a name match at 0.6, a company-domain invitee at 0.8, and a
      // row with no method; none of them names this card.
      await call({ at: "2026-10-31T10:00:00Z", recording: "https://fathom.video/calls/inventedByName", method: "name", confidence: 0.6 });
      await call({ at: "2026-10-31T11:00:00Z", recording: "https://fathom.video/calls/inventedByDomain", method: "invitee_email", confidence: 0.8 });
      await call({ at: "2026-10-31T12:00:00Z", recording: "https://fathom.video/calls/inventedNoMethod", method: null, confidence: null });
      const kickoff = KICKOFF.filter(x => x.ref !== K.recording);
      const { details } = await brief(kickoffInput(kickoff));
      expect(details).not.toContain("- Call recording:");
      expect(details).not.toContain("inventedBy");
      expect(details).not.toContain("inventedNoMethod");
      expect((details as string).split("\n").at(-1)).toBe("Not in the forms: Call recording, Projects completed.");
      // A known contact's address (invitee_email at 0.9) and a person's placement do settle it; the newest wins.
      await call({ at: "2026-10-30T10:00:00Z", recording: "https://fathom.video/calls/inventedByContact", method: "invitee_email", confidence: 0.9 });
      expect((await brief(kickoffInput(kickoff))).details).toContain(
        "- Call recording: https://fathom.video/calls/inventedByContact (from the call store)",
      );
      await call({ at: "2026-10-30T12:00:00Z", recording: "https://fathom.video/calls/inventedManual", method: "manual", confidence: null });
      expect((await brief(kickoffInput(kickoff))).details).toContain(
        "- Call recording: https://fathom.video/calls/inventedManual (from the call store)",
      );
    });
  });

  test("no onboarding answer stored: one sentence, then the links and the kickoff's items", async () => {
    await rolledBack(async () => {
      await card({ onboarding: null });
      const { details } = await brief(kickoffInput(KICKOFF.filter(x => x.ref !== K.service)));
      expect(details).toBe(
        [
          BRIEF_HEAD,
          `Read from the cockpit on ${DAY} (Kuwait). Answers are as typed. No onboarding answer is stored for this client yet, so only the card's links and the kickoff's answers follow.`,
          "",
          "Links",
          `- Cockpit client page: ${PAGE}`,
          `- Drive folder (from the card): ${LINKS.drive}`,
          `- GHL: ${LINKS.ghl}`,
          `- Brand DNA doc: ${LINKS.brand_dna}`,
          `- Offer Cheat Sheet: ${LINKS.offer_sheet}`,
          "- Market Research doc: not ready yet; the market intel job adds it to the card",
          "- Call recording: https://fathom.video/share/invented0001",
          "",
          "Still open from the kickoff",
          "- Funded card not linked",
          "- Facebook access: Waiting on Client",
          "- Training course: Requested",
          "- Contract: Sent and waiting on client",
          "- Lead file missing",
          "",
          "For the tech setup (Calendars, Call Center, Custom Values)",
          "- Appointment types (confirmed at kickoff): In-office, In-home or onsite",
          "",
          "Not in the forms: Services advertised.",
        ].join("\n"),
      );
    });
  });

  test("the kickoff's setup items: nothing open, and none answered", async () => {
    await rolledBack(async () => {
      await card();
      const done = KICKOFF.filter(x => ![K.funded, K.fbAccess, K.training, K.contract, K.hasLeads].includes(x.ref as never));
      expect((await brief(kickoffInput(done))).details).toContain(
        "\n\nStill open from the kickoff\n- Nothing open from the kickoff's setup questions.\n\n",
      );
      expect((await brief(kickoffInput([a(K.service, "Other")]))).details).toContain(
        "\n\nStill open from the kickoff\n- The kickoff left its setup questions unanswered.\n\n",
      );
    });
  });

  test("each value is cut at 400 characters; the brief stays at 3,600 with the plan's drop order", async () => {
    // Every value long: the first lines to go are the services, then the consultants, then the hours.
    const long = (n: number, tag: string) => `${tag}: ${"قيمة طويلة مكتوبة ".repeat(60)}`.slice(0, n);
    const answersAt = (n: number) =>
      ONBOARDING.map(x =>
        [O.fullName, O.phone, O.email, O.personalPhone, O.businessName, O.lastRevenue, O.goal90, O.website, O.instagram, O.facebook].includes(x.ref as never)
          ? x
          : a(x.ref, long(n, x.ref.slice(0, 4))),
      ).map(x => (x.ref === O.appointments ? a(O.appointments, `${APPT.onsite}, ${long(n, "types")}`) : x));
    const seen: string[][] = [];
    for (const n of [120, 145, 150, 160, 240, 300, 420, 700]) {
      await rolledBack(async () => {
        await card({ onboarding: answersAt(n) });
        const { details } = await brief(kickoffInput(KICKOFF));
        const text = details as string;
        expect([...text].length).toBeLessThanOrEqual(CAP);
        expect(text.startsWith(`${BRIEF_HEAD}\n`)).toBe(true);
        const pointers = text
          .split("\n")
          .filter(l => / in the (Raw Onboarding Form Answers comment on the client card|handoff comment on this task)$/.test(l))
          .map(l => l.slice(2, l.indexOf(":")));
        seen.push(pointers);
        // The pointers are always the first ones of the drop order.
        const ORDER = [
          "Services and prices", "Consultants", "Hours", "Service areas", "Payment options", "Landmark",
          "Appointment length and buffer", "Furthest they travel", "#1 service", "Booking software",
          "Meta Business Manager", "Free consultations", "Years in business", "Projects completed",
          "Front desk phone", "Appointment types", "Services advertised", "Call recording",
        ];
        // Lines the brief never had (an unanswered question) are skipped in the order.
        const present = ORDER.filter(label => text.includes(`\n- ${label}`));
        expect([...pointers].sort()).toEqual(present.slice(0, pointers.length).sort());
        if (pointers.length > 0) expect(pointers).toContain("Services and prices");
        if (pointers.includes("Services and prices"))
          expect(text).toContain("\n- Services and prices: in the Raw Onboarding Form Answers comment on the client card\n");
        if (pointers.includes("Consultants"))
          expect(text).toContain("\n- Consultants: in the handoff comment on this task\n");
        if (pointers.includes("Hours")) expect(text).toContain("\n- Hours: in the handoff comment on this task\n");
        // A value line is never cut past its own cut: 400, the services 500.
        for (const line of text.split("\n").filter(l => l.startsWith("- ") && l.includes(": ")))
          expect([...line.slice(line.indexOf(": ") + 2)].length).toBeLessThanOrEqual(
            line.startsWith("- Services and prices") ? 500 + 50 : 400,
          );
      });
    }
    // Short answers fit whole; then the plan's three first, one at a time (each line's text order).
    expect(seen.slice(0, 4)).toEqual([
      [],
      ["Services and prices"],
      ["Consultants", "Services and prices"],
      ["Hours", "Consultants", "Services and prices"],
    ]);
    expect(seen.at(-1)!.length).toBeGreaterThan(3);
  });

  test("past every pointer the brief is its heading, the read line and the cockpit client page", async () => {
    await rolledBack(async () => {
      const huge = (k: string) => `https://drive.google.com/drive/folders/${k}${"x".repeat(1200)}`;
      await card({ links: { drive: huge("a"), ghl: huge("b"), brand_dna: huge("c"), offer_sheet: huge("d") } });
      const { details } = await brief(kickoffInput(KICKOFF));
      expect(details).toBe(
        [
          BRIEF_HEAD,
          `Read from the cockpit on ${DAY} (Kuwait). This brief is too long for a task description: read the handoff comment on this task and the Raw Onboarding Form Answers comment on the client card.`,
          "",
          "Links",
          `- Cockpit client page: ${PAGE}`,
        ].join("\n"),
      );
    });
  });

  test("a request type with no details field: the plan says the brief stays out, and the tasks are still planned", async () => {
    await rolledBack(async () => {
      await card();
      await requestType("client_onboarding", false);
      const plan = await brief(kickoffInput(KICKOFF));
      const say =
        "The brief stays out of the task description: the client_onboarding request type has no details field. Add one (key details, kind details) to carry it.";
      expect(plan.detailsMissing).toBe(say);
      expect(plan.lines).toEqual(["Technical Onboarding Check and Creative Onboarding tasks", say]);
      expect(plan.details.startsWith(BRIEF_HEAD)).toBe(true);
      const fx = byKey(await build(kickoffInput(KICKOFF)));
      expect(fx.onboarding_tasks.missing).toBeUndefined();
      expect(fx.onboarding_tasks.skip).toBeUndefined();
    });
    // No type yet: cockpit_request_create_system makes no task and says so itself.
    await rolledBack(async () => {
      const plan = await brief(kickoffInput(KICKOFF));
      expect(plan.detailsMissing).toBeUndefined();
      expect(plan.lines[1]).toStartWith("Cockpit brief in each task's description (");
    });
  });
});

// --- B2: the Brand DNA brief ---------------------------------------------------------------------

const dna = async (input: Row) => byKey(await build(input)).brand_dna_task.plan as Row;

describe("B2: the Brand DNA task's brief", () => {
  test("an onboarding answer on a card with its links: every section, line by line", async () => {
    await rolledBack(async () => {
      await card({ onboarding: null, name: "Cedar Homes Invented" });
      await requestType("brand_dna", true);
      const answers = ONBOARDING.map(x =>
        x.ref === O.businessName ? a(O.businessName, "  Owner Business Co ")
        : x.ref === O.instagram ? a(O.instagram, "@cedar.invented")
        : x,
      );
      const plan = await dna(onboardingInput(answers));
      expect(plan.detailsKind).toBe("dna_brief");
      expect(plan.typeKey).toBe("brand_dna");
      expect(plan.details).toBe(
        [
          DNA_HEAD,
          "Typed in the onboarding form as: Owner Business Co",
          `Read from the cockpit on ${DAY} (Kuwait). The whole onboarding answer is in the Raw Onboarding Form Answers comment on the client card.`,
          "",
          "Links",
          `- Brand DNA doc: ${LINKS.brand_dna}`,
          `- Offer Cheat Sheet: ${LINKS.offer_sheet}`,
          `- Drive folder (from the card): ${LINKS.drive}`,
          `- Blueprint prep: ${PAGE}/present/blueprint?view=prep`,
          `- Cockpit client page: ${PAGE}`,
          "- Market Research doc: lands on the card's Market Research field when the market intel job finishes",
          "- Website: https://www.instagram.com/cedar.invented (this looks like a social link)",
          "- Instagram: @cedar.invented (this is not an Instagram link)",
          "- Facebook: https://instagram.com/cedar.invented (this is an Instagram link, not a Facebook page)",
          "",
          "Business Overview",
          "- Years in business: 6 years",
          "- Service areas: Kuwait City and Hawalli",
          "",
          "Business Model",
          `- Appointment types: ${APPT.onsite}, ${APPT.online}`,
          `- Free consultations: ${FREE_YES}`,
          "- Payment options: Two parts: half at signing",
          "",
          "Market Positioning",
          "- #1 service: Villas",
          "",
          "Target Audience",
          "- Ideal project: A full villa in the north",
          "",
          "Why they joined",
          "- To grow steadily",
          "",
          "Not in the forms: Projects completed.",
        ].join("\n"),
      );
      expect(plan.lines).toEqual([
        "Brand DNA task",
        `Cockpit brief in the task's description (${[...plan.details].length} characters)`,
      ]);
      for (const v of Object.values(CONTACT)) expect(plan.details).not.toContain(v);
    });
  });

  test("the typed name only when it is not the card's; a Facebook page and a site pass the check; missing lines named", async () => {
    await rolledBack(async () => {
      await card({ onboarding: null, name: "Cedar Homes Invented", links: { market_research: "https://docs.google.com/document/d/inventedMr01" } });
      const answers = [
        a(O.businessName, "cedar homes invented co."),
        a(O.website, "https://cedar.invalid"),
        a(O.instagram, "https://instagram.com/cedar"),
        a(O.facebook, "https://m.facebook.com/cedar"),
        a(O.whyJoined, "w".repeat(700)),
      ];
      const { details } = await dna(onboardingInput(answers));
      const lines = (details as string).split("\n");
      expect(details).not.toContain("Typed in the onboarding form as");
      expect(lines).toContain("- Market Research doc: https://docs.google.com/document/d/inventedMr01");
      expect(lines).toContain("- Brand DNA doc: not on the card yet");
      expect(lines).toContain("- Website: https://cedar.invalid");
      expect(lines).toContain("- Instagram: https://instagram.com/cedar");
      expect(lines).toContain("- Facebook: https://m.facebook.com/cedar");
      expect(lines).toContain(`- ${"w".repeat(599)}…`);
      expect(details).not.toContain("Business Model");
      expect(lines.at(-1)).toBe(
        "Not in the forms: Years in business, Projects completed, Service areas, Appointment types, Free consultations, Payment options, #1 service, Ideal project.",
      );
    });
  });

  test("the cap: the drop order, then the short brief", async () => {
    for (const n of [100, 600, 2000])
      await rolledBack(async () => {
        await card({ onboarding: null });
        const answers = ONBOARDING.map(x => (x.ref === O.fullName ? x : a(x.ref, `${x.ref.slice(0, 4)} ${"y".repeat(n)}`)));
        const { details } = await dna(onboardingInput(answers));
        expect([...(details as string)].length).toBeLessThanOrEqual(CAP);
        expect((details as string).startsWith(`${DNA_HEAD}\n`)).toBe(true);
        if (n === 100) expect(details).not.toContain("in the Raw Onboarding Form Answers comment on the client card\n");
        if (n === 600) expect(details).toContain("\n- Service areas: in the Raw Onboarding Form Answers comment on the client card\n");
      });
    await rolledBack(async () => {
      const huge = `https://drive.google.com/drive/folders/${"z".repeat(1300)}`;
      await card({ onboarding: null, links: { drive: huge, brand_dna: huge, offer_sheet: huge } });
      expect((await dna(onboardingInput(ONBOARDING))).details).toBe(
        [
          DNA_HEAD,
          `Read from the cockpit on ${DAY} (Kuwait). This brief is too long for a task description: read the Raw Onboarding Form Answers comment on the client card.`,
          "",
          "Links",
          `- Cockpit client page: ${PAGE}`,
        ].join("\n"),
      );
    });
  });

  test("a brand_dna type with no details field: the plan says so", async () => {
    await rolledBack(async () => {
      await requestType("brand_dna", false);
      const plan = await dna(onboardingInput(ONBOARDING));
      expect(plan.detailsMissing).toBe(
        "The brief stays out of the task description: the brand_dna request type has no details field. Add one (key details, kind details) to carry it.",
      );
      expect(plan.lines).toEqual(["Brand DNA task", plan.detailsMissing]);
    });
  });
});

// --- B4: the kickoff notice's open items ---------------------------------------------------------

const openItems = (answers: Answer[]) =>
  one<string[] | null>("SELECT public.cockpit_form_stage4_open_items($1::jsonb) AS r", [
    json(Object.fromEntries(answers.map(x => [x.ref, x.value]))),
  ]);
const facts = (forms: unknown, suffix = "") =>
  one<Row>(`SELECT public.cockpit_slack_notice_kickoff_facts${suffix}($1, 'Cedar Homes Invented', $2::jsonb, NULL) AS r`, [
    TASK,
    json(forms),
  ]);

describe("B4: the kickoff notice's open items", () => {
  test("fixed labels in the table's order; done answers and unknown options are no items", async () => {
    expect(await openItems(KICKOFF)).toEqual([
      "funded card not linked",
      "Facebook access: Waiting on Client",
      "training course: Requested",
      "contract: Sent and waiting on client",
      "lead file missing",
    ]);
    expect(
      await openItems([
        a(K.funded, "false"),
        a(K.calendar, "No"),
        a(K.fbAccess, "Pending"),
        a(K.waSync, "Needs Integrating"),
        a(K.maharaOs, "Tech Issue"),
        a(K.training, "Waiting On Client"),
        a(K.contract, "Not sent yet"),
      ]),
    ).toEqual([
      "funded card not linked",
      "Google Calendar not connected",
      "Facebook access: Pending",
      "WhatsApp CRM sync: Needs Integrating",
      "Mahara OS access: Tech Issue",
      "training course: Waiting On Client",
      "contract: Not sent yet",
    ]);
    // Every answered one done.
    expect(
      await openItems([
        a(K.funded, "Yes"),
        a(K.calendar, "true"),
        a(K.fbAccess, "Their Page Our Ad Acc"),
        a(K.waSync, "Not Integrating"),
        a(K.maharaOs, "Doesn't Want To"),
        a(K.training, "Confirmed"),
        a(K.contract, "NA - already signed"),
        a(K.hasLeads, "Yes"),
        a(K.reachLeads, "Yes"),
        a(K.leadFile, "https://drive.google.com/file/d/inventedLeads"),
      ]),
    ).toEqual([]);
    expect(await openItems([a(K.hasLeads, "Yes"), a(K.reachLeads, "No")])).toEqual([]);
    // Typed text is never an item; an answer that is not an option counts as unanswered.
    expect(await openItems([a(K.fbAccess, "the client said maybe"), a(K.funded, "maybe")])).toBeNull();
    expect(await openItems([a(K.service, "Other"), a(K.payment, "1500")])).toBeNull();
    expect(await openItems([])).toBeNull();
  });

  test("the facts carry openItems only when a setup question is answered; every other fact is 20261025n's", async () => {
    const kickoff = (answers: Answer[] | undefined) => ({
      kickoff: {
        form_id: "native",
        response_id: "inventedResp01",
        submitted_at: "2026-11-01T09:00:00Z",
        ...(answers ? { answers } : {}),
      },
    });
    for (const [answers, items] of [
      [KICKOFF, await openItems(KICKOFF)],
      [[a(K.funded, "Yes")], []],
      [[a(K.service, "Other")], undefined],
      [[], undefined],
      [undefined, undefined],
    ] as [Answer[] | undefined, string[] | undefined][]) {
      const now = await facts(kickoff(answers));
      const was = await facts(kickoff(answers), "_live");
      const { openItems: got, ...rest } = now;
      expect(got).toEqual(items);
      expect("openItems" in now).toBe(items !== undefined);
      expect(json(rest)).toBe(json(was));
    }
    // A question answered twice: its last answer.
    expect(
      (await facts(kickoff([a(K.funded, "No"), a(K.funded, "Yes")]))).openItems,
    ).toEqual([]);
    expect(await facts({})).toEqual(await facts({}, "_live"));
  });
});

// --- B8: card_facts ------------------------------------------------------------------------------

const cardFacts = async (input: Row) => byKey(await build(input)).card_facts as Row;

describe("B8: card_facts", () => {
  test("a kickoff fills the four empty card facts it can, each onlyIfEmpty, option ids from the s40 snapshot", async () => {
    await rolledBack(async () => {
      const fx = await cardFacts(kickoffInput(KICKOFF));
      expect(fx.delivery).toBe("clickup_queue");
      expect(fx.skip).toBeUndefined();
      expect(fx.plan).toEqual({
        taskId: TASK,
        fields: [
          { fieldId: FIELD.consultation, kind: "labels", label: "Consultation Types", optionIds: [OPT.inOffice, OPT.inHome], onlyIfEmpty: true, source: "kickoff" },
          { fieldId: FIELD.platform, kind: "drop_down", label: "ADs Platform", optionId: OPT.meta, onlyIfEmpty: true, source: "kickoff" },
          { fieldId: FIELD.fathom, kind: "url", label: "Fathom", value: "https://fathom.video/share/invented0001", onlyIfEmpty: true, source: "kickoff" },
          { fieldId: FIELD.callDate, kind: "date", label: "Onboarding Call Date", value: "2026-11-01", onlyIfEmpty: true, source: "kickoff_day" },
        ],
        lines: [
          "Consultation Types, if empty on the card: In Office, In Home / On Site",
          "ADs Platform, if empty on the card: Facebook/Meta",
          "Fathom, if empty on the card: the kickoff's call recording",
          "Onboarding Call Date, if empty on the card: 2026-11-01 (the day the kickoff was sent)",
        ],
      });
    });
  });

  test("the stored onboarding call gives the date and, without a Fathom answer, the recording", async () => {
    await rolledBack(async () => {
      // 23:30 UTC on 30 October is 31 October in Kuwait.
      await call({ at: "2026-10-30T23:30:00Z", recording: "https://fathom.video/calls/inventedStore" });
      await call({ at: "2026-10-31T09:00:00Z", kind: "checkin" });
      await call({ at: "2026-10-31T09:30:00Z", status: "cancelled" });
      await call({ at: "2026-10-31T10:00:00Z", source: "ghl_appointment" });
      const kickoff = KICKOFF.map(x => (x.ref === K.recording ? a(K.recording, "https://drive.google.com/file/d/inventedRec") : x));
      const f = byKey((await cardFacts(kickoffInput(kickoff))).plan.fields.map((x: Row) => ({ ...x, key: x.label })));
      expect(f.Fathom).toMatchObject({ value: "https://fathom.video/calls/inventedStore", source: "call_store" });
      expect(f["Onboarding Call Date"]).toMatchObject({ value: "2026-10-31", source: "call_store" });
    });
  });

  test("a call placed from a likely sign plans no Fathom and not its day: the date is the kickoff's, as with no call", async () => {
    await rolledBack(async () => {
      // Another client's recording on this card by a name match at 0.6, and a company-domain invitee at 0.8.
      await call({ at: "2026-10-30T10:00:00Z", recording: "https://fathom.video/calls/inventedByName", method: "name", confidence: 0.6 });
      await call({ at: "2026-10-30T11:00:00Z", recording: "https://fathom.video/calls/inventedByDomain", method: "invitee_email", confidence: 0.8 });
      const kickoff = KICKOFF.map(x => (x.ref === K.recording ? a(K.recording, "https://drive.google.com/file/d/inventedRec") : x));
      const fx = await cardFacts(kickoffInput(kickoff));
      const f = byKey(fx.plan.fields.map((x: Row) => ({ ...x, key: x.label })));
      expect(f.Fathom).toBeUndefined();
      expect(fx.plan.fields.filter((x: Row) => x.source === "call_store")).toEqual([]);
      expect(JSON.stringify(fx.plan)).not.toContain("inventedBy");
      expect(f["Onboarding Call Date"]).toEqual({
        fieldId: FIELD.callDate, kind: "date", label: "Onboarding Call Date", value: "2026-11-01", onlyIfEmpty: true, source: "kickoff_day", key: "Onboarding Call Date",
      });
      expect(fx.plan.lines).toContain("Onboarding Call Date, if empty on the card: 2026-11-01 (the day the kickoff was sent)");
    });
  });

  test("an unknown type, two platforms or none, no recording and no send time plan nothing for those fields", async () => {
    await rolledBack(async () => {
      const fx = await cardFacts(
        kickoffInput(
          [a(K.consult, "In-office, Rooftop"), a(K.platforms, "TikTok and Snapchat")],
          { submittedAt: null },
        ),
      );
      expect(fx.plan.fields).toEqual([]);
      expect(fx.plan.lines).toEqual([
        "Consultation Types: not filled, the answer has a type the card does not have.",
        "ADs Platform: not filled, the answer names more than one platform.",
      ]);
      expect(fx.skip).toBe("No card field to fill from this kickoff.");
      const one2 = await cardFacts(kickoffInput([a(K.platforms, "Google ads"), a(K.consult, "Online, Online")]));
      expect(one2.plan.lines.slice(0, 2)).toEqual([
        "Consultation Types, if empty on the card: Online",
        "ADs Platform: not filled, the answer names no platform the card has.",
      ]);
      expect((await cardFacts(kickoffInput([a(K.platforms, "snap")]))).plan.fields[0]).toMatchObject({
        optionId: OPT.snapchat,
      });
      expect((await cardFacts(kickoffInput([a(K.platforms, "Tik Tok only")]))).plan.fields[0]).toMatchObject({
        optionId: OPT.tiktok,
      });
    });
  });

  test("only the five fields, never Country or Daily Budget; a second kickoff plans none", async () => {
    const allowed = new Set(Object.values(FIELD));
    for (const input of [kickoffInput(KICKOFF), onboardingInput(ONBOARDING.map(x => (x.ref === O.website ? a(O.website, "https://cedar.invalid/home") : x)))]) {
      const fx = await cardFacts(input);
      for (const f of fx.plan.fields) {
        expect(allowed.has(f.fieldId)).toBe(true);
        expect(f.onlyIfEmpty).toBe(true);
      }
    }
    const second = await cardFacts(kickoffInput(KICKOFF, { second: true }));
    expect(second.skip).toBe("A second kickoff posts only the handoff comment.");
  });

  test("the onboarding fills Company Website only from an https link to the business's own site", async () => {
    const site = await cardFacts(onboardingInput([a(O.website, "https://cedar.invalid/home")]));
    expect(site.plan.fields).toEqual([
      { fieldId: FIELD.website, kind: "url", label: "Company Website", value: "https://cedar.invalid/home", onlyIfEmpty: true, source: "onboarding" },
    ]);
    expect(site.plan.lines).toEqual(["Company Website, if empty on the card: the website answer"]);
    for (const v of [
      "https://www.instagram.com/cedar",
      "https://linktr.ee/cedar",
      "https://maps.app.goo.gl/invented",
      "https://www.google.com/maps/place/invented",
      "https://sites.google.com/view/cedar",
      "https://wa.me/96500000003",
      "http://cedar.invalid",
      "cedar.invalid",
      "https://cedar.invalid and https://cedar2.invalid",
    ]) {
      const fx = await cardFacts(onboardingInput([a(O.website, v)]));
      expect(fx.plan.fields).toEqual([]);
      expect(fx.skip).toBe("No card field to fill: the website answer is not an https link to the business's own site.");
    }
    expect((await cardFacts(onboardingInput([]))).skip).toBe("No card field to fill: there is no website answer.");
  });

  test("the version-2 arrays are 20261102l's with card_facts after card_fields and profile_fields; the builder plans in that order", async () => {
    for (const form of ["kickoff", "onboarding"]) {
      expect(await one("SELECT public.cockpit_form_stage4_effects($1, 1) AS r", [form])).toEqual(
        await one("SELECT public.cockpit_form_stage4_effects_l($1, 1) AS r", [form]),
      );
      const now = await one<Row[]>("SELECT public.cockpit_form_stage4_effects($1, 2) AS r", [form]);
      const was = await one<Row[]>("SELECT public.cockpit_form_stage4_effects_l($1, 2) AS r", [form]);
      expect(now.filter(e => e.key !== "card_facts")).toEqual(was);
      const at = now.findIndex(e => e.key === "card_facts");
      expect(now[at - 1].key).toBe(form === "kickoff" ? "card_fields" : "profile_fields");
      expect(now[at]).toMatchObject({ owner: "cockpit", delivery: "clickup_queue" });
      expect(now[at].label.length).toBeLessThanOrEqual(80);
      const built = await build(form === "kickoff" ? kickoffInput(KICKOFF) : onboardingInput(ONBOARDING));
      expect(built.map(e => e.key)).toEqual(now.map(e => e.key));
    }
  });

  test("the registry: 20261102l's version-2 array moves to the new one; version 1 and the new one stay; any other array stops the file", async () => {
    const registry = (key: string) =>
      one<Row>("SELECT to_jsonb(f) AS r FROM public.cockpit_forms f WHERE key = $1", [key]);
    await rolledBack(async () => {
      await db.query(
        "UPDATE public.cockpit_forms SET effects = public.cockpit_form_stage4_effects_l(key, 2), provider = 'native', version = 2",
      );
      await db.exec(inTest(N));
      for (const form of ["kickoff", "onboarding"]) {
        const row = await registry(form);
        expect(row.effects).toEqual(await one("SELECT public.cockpit_form_stage4_effects($1, 2) AS r", [form]));
        expect(row.updated_by).toBe("migration 20261102p");
      }
    });
    await rolledBack(async () => {
      const before = await registry("onboarding");
      await db.exec(inTest(N));
      expect(await registry("onboarding")).toEqual(before);
    });
    await rolledBack(async () => {
      await db.query("UPDATE public.cockpit_forms SET effects = '[]' WHERE key = 'onboarding'");
      expect(await refusal(() => db.exec(inTest(N)))).toEqual({
        code: "55000",
        message: "The onboarding effects changed since 20261102l; stop and re-read them.",
      });
    });
  });
});
