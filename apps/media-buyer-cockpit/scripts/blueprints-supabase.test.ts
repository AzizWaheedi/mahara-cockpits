/**
 * Brand Blueprint backend (20261024a_brand_blueprints.sql,
 * docs/brand-blueprint/SPEC.md sections 2 and 3) on an isolated PostgreSQL
 * with Supabase's default privileges on, so a missing REVOKE opens the object
 * here as it would in production.
 *
 * It stands on the real seat rule (20260927a), the real client success gate
 * (20261006c) and roster (20260927v), the real creative read models, outbox
 * and client action (20260927s, applied whole), the real client rule
 * (20260926m), the deck prep table (20261019120000) and the logo table
 * (20261003a). HighLevel accounts, the editor's client cards, the onboarding
 * kit, the call store and the team list are cut-down stand-ins with the live
 * column names. Every person, client and answer is invented. Nothing here
 * reaches ClickUp, Slack or Make: a press is an outbox row and audit rows.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import { actor, cockpitTestDb, member, migration } from "./lib/cockpitTestDb";

const FILE = "20261024a_brand_blueprints.sql";

const CD_A = "00000000-0000-4000-8000-0000000000d1"; // creative, Acme only
const CD_ALL = "00000000-0000-4000-8000-0000000000d2"; // creative, every client
const CSM_A = "00000000-0000-4000-8000-0000000000a1"; // csm, Acme only
const BUYER = "00000000-0000-4000-8000-0000000000c1"; // media buyer only
const ADMIN = "00000000-0000-4000-8000-0000000000e1"; // admin
const CEO = "00000000-0000-4000-8000-0000000000c3";
const GONE = "00000000-0000-4000-8000-0000000000c4"; // creative, deactivated

const A = "taskA1"; // Acme Interiors: both rosters, a kickoff on record
const B = "taskB1"; // Beta Build: both rosters, no kickoff
const C = "taskC1"; // Gamma Design: the client success roster only

const S1 = "sessionAAAAAAAAAAAAAA1"; // the creative director's browser
const S2 = "sessionBBBBBBBBBBBBBB2"; // another browser

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
async function one<T = any>(
  who: string | null,
  text: string,
  params: unknown[] = [],
): Promise<T> {
  await actor(db, who);
  try {
    return (await db.query<{ r: T }>(text, params)).rows[0].r;
  } finally {
    await asOwner();
  }
}
async function failure(
  who: string | null,
  text: string,
  params: unknown[] = [],
): Promise<Error & Row> {
  await actor(db, who);
  try {
    await db.query(text, params);
  } catch (e) {
    return e as Error & Row;
  } finally {
    await asOwner();
  }
  throw new Error(`Expected a refusal for ${text}`);
}
const refused = async (
  who: string | null,
  text: string,
  params: unknown[] = [],
) => (await failure(who, text, params)).message;
async function owner<T = any>(
  text: string,
  params: unknown[] = [],
): Promise<T> {
  await asOwner();
  return (await db.query<{ r: T }>(text, params)).rows[0].r;
}
async function count(sql: string, params: unknown[] = []): Promise<number> {
  await asOwner();
  return Number((await db.query<{ n: number }>(sql, params)).rows[0].n);
}

const SAVE = "SELECT public.cockpit_blueprint_save($1,$2::jsonb,$3,$4) r";
const change = (values: Row, seen: Row = {}, from: Row = {}) =>
  JSON.stringify(
    Object.fromEntries(
      Object.entries(values).map(([k, value]) => [
        k,
        {
          value,
          seen: k in seen ? seen[k] : null,
          ...(from[k] ? { from: from[k] } : {}),
        },
      ]),
    ),
  );
const save = (
  who: string,
  task: string,
  values: Row,
  opts: { session?: string; base?: number | null; seen?: Row; from?: Row } = {},
) =>
  one<Row>(who, SAVE, [
    task,
    change(values, opts.seen, opts.from),
    opts.session ?? S1,
    opts.base ?? null,
  ]);
const saveRefused = (
  who: string | null,
  task: string,
  values: Row,
  opts: { session?: string; base?: number | null } = {},
) =>
  refused(who, SAVE, [
    task,
    change(values),
    opts.session ?? S1,
    opts.base ?? null,
  ]);
const PRESS = "SELECT public.cockpit_blueprint_part_done($1,$2,$3::uuid) r";
const press = (who: string, task: string, part: number, id: string) =>
  one<Row>(who, PRESS, [task, part, id]);
const uuid = (n: number) =>
  `20000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const outboxRows = () =>
  count("SELECT count(*) n FROM public.cockpit_creative_outbox");
const partAudits = () =>
  count(
    "SELECT count(*) n FROM public.cockpit_audit_log WHERE action='blueprint.part_done'",
  );

// A whole part 1 and part 2, as the call would leave them (invented).
const PART1 = {
  service: "interior",
  capacity: "tight",
  capacity_note: "Two site teams busy until December",
  starter: "yes",
  pack_url: "https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUv",
  pack_approval: "on_call",
  daily_budget: { usd: 40, said: "$50 a day" },
  destination: "lead_form",
  identity: "their_page",
  red_lines: ["No before and after photos", "No prices on screen"],
};
const PART2 = {
  best_client: "Villa owners renovating a whole floor (example)",
  method: "Site visit, concept, 3D, then build (example)",
  pricing: "By square metre, most land in the middle band (example)",
  minimum: { amount: 3000, currency: "KWD" },
  anchor: { amount: 12000, currency: "KWD" },
  competitors: [{ name: "Example Studio", lose: true }],
  approval: "first_batch",
  dna_status: "small_gaps",
  dna_missing: "Tone of voice section",
  rules: { always: ["The logo at the end"], never: ["No prices on screen"] },
  camera: "yes_phone",
  readback_yes: true,
};

beforeAll(async () => {
  db = await cockpitTestDb({ supabaseDefaultPrivileges: true });

  // The client success roster and gate, from their canonical migrations.
  const roster = migration("20260927v_csm_read_models.sql");
  await db.exec(
    cut(
      roster,
      /CREATE TABLE IF NOT EXISTS public\.cockpit_csm_source_state\([^\n]*\n/,
      "cockpit_csm_source_state",
    ),
  );
  await db.exec(
    cut(
      roster,
      /INSERT INTO public\.cockpit_csm_source_state[^\n]*\n/,
      "cockpit_csm_source_state rows",
    ),
  );
  await db.exec(
    cut(
      roster,
      /CREATE TABLE IF NOT EXISTS public\.cockpit_csm_sources\([^\n]*\n/,
      "cockpit_csm_sources",
    ),
  );
  await db.exec(
    "REVOKE ALL ON public.cockpit_csm_source_state, public.cockpit_csm_sources FROM anon, authenticated;",
  );
  await db.exec(
    cut(
      migration("20260927a_cockpit_ask_ai_jobs.sql"),
      /CREATE OR REPLACE FUNCTION public\.cockpit_ask_ai_owner_allowed\([\s\S]*?\$\$;/,
      "cockpit_ask_ai_owner_allowed",
    ),
  );
  await db.exec(
    "REVOKE ALL ON FUNCTION public.cockpit_ask_ai_owner_allowed(uuid,text,text) FROM PUBLIC, anon, authenticated;",
  );
  const gate = migration("20261006c_csm_onboarding_checkins.sql");
  await db.exec(
    cut(
      gate,
      /CREATE FUNCTION public\.cockpit_csm_client_gate_for_actor\([\s\S]*?END \$\$;/,
      "gate for actor",
    ),
  );
  await db.exec(
    cut(
      gate,
      /CREATE FUNCTION public\.cockpit_csm_client_gate\(p_task_id text\)[^\n]*\n/,
      "gate",
    ),
  );
  await db.exec(
    cut(
      gate,
      /REVOKE ALL ON FUNCTION public\.cockpit_csm_client_gate_for_actor[\s\S]*?GRANT EXECUTE ON FUNCTION public\.cockpit_csm_client_gate\(text\) TO authenticated;/,
      "gate grants",
    ),
  );
  // The client rule, then the creative read models, outbox and client action, whole.
  await db.exec(
    cut(
      migration("20260926m_cockpit_csm_state.sql"),
      /CREATE OR REPLACE FUNCTION public\.cockpit_client_allowed\([\s\S]*?END \$\$;/,
      "cockpit_client_allowed",
    ),
  );
  await db.exec(migration("20260927s_creative_read_models.sql"));
  await db.exec(
    cut(
      migration("20261019120000_csm_decks.sql"),
      /CREATE TABLE IF NOT EXISTS public\.cockpit_csm_deck_prep \([\s\S]*?\n\);/,
      "deck prep",
    ),
  );
  // The runner's journal: a press checks when a running send was claimed.
  await db.exec(
    cut(
      migration("20260927g_cockpit_media_actions.sql"),
      /CREATE TABLE public\.cockpit_media_actions \([\s\S]*?\n\);/,
      "media actions",
    ),
  );
  await db.exec(
    "REVOKE ALL ON public.cockpit_media_actions FROM PUBLIC, anon, authenticated;",
  );
  await db.exec(
    cut(
      migration("20261003a_client_logos.sql"),
      /CREATE TABLE IF NOT EXISTS public\.cockpit_client_logos \([\s\S]*?\n\);/,
      "client logos",
    ),
  );

  // Stand-ins with the live column names (checked 2026-10-22).
  await db.exec(`
    CREATE TABLE public.ghl_clients(location_id text PRIMARY KEY, client_name text, clickup_id text, country text, city text,
      language text, service_mode text);
    CREATE TABLE public.editor_clients(task_id text PRIMARY KEY, name text, dos_donts text, brand_dna_url text, brand_dna text,
      offer_url text, offer text, drive_url text, website text, instagram text, docs_read_at timestamptz, synced_at timestamptz);
    CREATE TABLE public.cockpit_client_onboarding(clickup_task_id text PRIMARY KEY, client_name text NOT NULL, client_status text,
      csm text, signup_on date, onboarding_call_on date, launch_on date, links jsonb NOT NULL DEFAULT '{}',
      handover jsonb NOT NULL DEFAULT '{}', sales_transcript text, forms jsonb NOT NULL DEFAULT '{}', synced_at timestamptz);
    CREATE TABLE public.cockpit_csm_calls(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, task_id text, kind text NOT NULL,
      starts_at timestamptz, ends_at timestamptz, status text NOT NULL);
    CREATE TABLE public.cockpit_people(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, name text NOT NULL, email text,
      active boolean NOT NULL DEFAULT true);
    REVOKE ALL ON public.ghl_clients, public.editor_clients, public.cockpit_client_onboarding, public.cockpit_csm_calls,
      public.cockpit_people, public.cockpit_csm_deck_prep, public.cockpit_client_logos FROM anon, authenticated;`);

  await member(db, CD_A, "cd-a@tests.invalid", ["creative"]);
  await member(db, CD_ALL, "cd-all@tests.invalid", ["creative"]);
  await member(db, CSM_A, "csm-a@tests.invalid", ["csm"]);
  await member(db, BUYER, "buyer@tests.invalid", ["media_buyer"]);
  await member(db, ADMIN, "admin@tests.invalid", ["admin"]);
  await member(db, CEO, "aziz@maharamedia.com", []);
  await member(db, GONE, "gone@tests.invalid", ["creative"], false);
  await db.query(
    "UPDATE public.cockpit_members SET clients=$1 WHERE auth_user_id = ANY($2::uuid[])",
    [["Acme Interiors"], [CD_A, CSM_A]],
  );
  await db.query(
    "UPDATE public.cockpit_members SET name='dana al-mutairi' WHERE auth_user_id=$1",
    [CD_A],
  );
  await db.query(
    "UPDATE public.cockpit_members SET name='cd-all@tests.invalid' WHERE auth_user_id=$1",
    [CD_ALL],
  );
  await db.query(
    "INSERT INTO public.cockpit_people(name,email) VALUES('Omar Example','cd-all@tests.invalid')",
  );

  const snap = "2026-10-22T08:00:00Z";
  const csmClients = [
    {
      taskId: A,
      name: "Acme Interiors",
      stage: "Brand Blueprint Booked♠️",
      bucket: "onboarding",
      service: "DFY",
      launchDate: null,
    },
    {
      taskId: B,
      name: "Beta Build",
      stage: "Brand Blueprint Booked♠️",
      bucket: "onboarding",
    },
    {
      taskId: C,
      name: "Gamma Design",
      stage: "Onboarding Booked",
      bucket: "onboarding",
    },
  ];
  for (const c of csmClients)
    await db.query(
      "INSERT INTO public.cockpit_csm_sources(table_name,source_id,client_names,data,source_snapshot_at) VALUES('clients',$1,$2,$3::jsonb,$4)",
      [
        `c-${c.taskId}`,
        [c.name],
        JSON.stringify({ _id: `c-${c.taskId}`, ...c }),
        snap,
      ],
    );
  await db.query(
    "UPDATE public.cockpit_csm_source_state SET ready=true,row_count=$1,source_snapshot_at=$2 WHERE table_name='clients'",
    [csmClients.length, snap],
  );

  // The creative roster holds Acme and Beta, not Gamma.
  const creative = (table: string, id: string, names: string[], data: Row) =>
    db.query(
      "INSERT INTO public.cockpit_creative_sources(table_name,source_id,client_names,data,source_snapshot_at) VALUES($1,$2,$3,$4::jsonb,$5)",
      [table, id, names, JSON.stringify({ _id: id, ...data }), snap],
    );
  await creative("clients", "cl-a", ["Acme Interiors"], {
    taskId: A,
    name: "Acme Interiors",
    templatedAdsStatus: "Wants To See Them First",
    canSelfRecord: "Yes - phone only",
    driveFolder: "https://drive.google.com/drive/folders/acmeDriveFolder01",
    offerCheatSheet: "https://docs.google.com/document/d/acmeOffer",
  });
  await creative("clients", "cl-b", ["Beta Build"], {
    taskId: B,
    name: "Beta Build",
  });
  await creative("creativeTasks", "ct-old", ["Acme Interiors"], {
    taskId: "parOld",
    name: "Acme Interiors - Creative Onboarding",
    kind: "onboarding",
    createdAt: 500,
  });
  await creative("creativeTasks", "ct-par", ["Acme Interiors"], {
    taskId: "par1",
    name: "Acme Interiors - Creative Onboarding",
    kind: "onboarding",
    createdAt: 1000,
  });
  await creative("creativeTasks", "ct-s2", ["Acme Interiors"], {
    taskId: "st2",
    name: "2 · Run The Brand Blueprint Call",
    kind: "onboardingStep",
    parentId: "par1",
    status: "to do",
  });
  await creative("creativeTasks", "ct-s3", ["Acme Interiors"], {
    taskId: "st3",
    name: "3 · Lock The Brand DNA And The Offer",
    kind: "onboardingStep",
    parentId: "par1",
    status: "to do",
  });
  await creative("creativeTasks", "ct-s4", ["Acme Interiors"], {
    taskId: "st4",
    name: "4 · Select Templated Creatives So They Can Launch",
    kind: "onboardingStep",
    parentId: "par1",
    status: "to do",
  });
  await creative("creativeTasks", "ct-s4old", ["Acme Interiors"], {
    taskId: "st4old",
    name: "4 · Select Templated Creatives",
    kind: "onboardingStep",
    parentId: "parOld",
    status: "complete",
  });
  await db.query(
    "UPDATE public.cockpit_creative_source_state SET ready=true,row_count=2,source_snapshot_at=$1 WHERE table_name='clients'",
    [snap],
  );
  await db.query(
    "UPDATE public.cockpit_creative_source_state SET ready=true,row_count=6,source_snapshot_at=$1 WHERE table_name='creativeTasks'",
    [snap],
  );

  const kickoff = (ref: string, title: string, value: string) => ({
    ref,
    title,
    value,
  });
  await db.query(
    `INSERT INTO public.cockpit_client_onboarding(clickup_task_id,client_name,client_status,csm,onboarding_call_on,links,handover,sales_transcript,forms)
     VALUES($1,'Acme Interiors','Brand Blueprint Booked','noura al-sabah','2026-10-14',$2::jsonb,$3::jsonb,'SALES TRANSCRIPT SECRET',$4::jsonb),
           ($5,'Beta Build','Brand Blueprint Booked','Hana Example, someone@x.invalid',NULL,'{}','{}',NULL,'{}')`,
    [
      A,
      JSON.stringify({
        drive: "https://drive.google.com/drive/folders/acmeDrive000001",
        brand_dna: "https://docs.google.com/document/d/acmeDna",
        market_research: "https://docs.google.com/document/d/acmeResearch",
        contract: "https://contracts.invalid/CONTRACT-SECRET",
        sales_call: "https://calls.invalid/SALES-CALL-SECRET",
        report_sheet: "https://sheets.invalid/REPORT-SHEET-SECRET",
      }),
      JSON.stringify({
        closer: "Sami",
        daily_budget: 45,
        billing_notes: "BILLING SECRET",
        payment_plan: "PLAN SECRET",
        contract_status: "CONTRACT STATUS SECRET",
        next_payment_amount: 999,
        service: "Interior design",
      }),
      JSON.stringify({
        onboarding: {
          form_id: "KFRCXPFx",
          response_id: "onbacme0001",
          submitted_at: "2026-10-13T10:00:00Z",
          answers: [],
        },
        kickoff: {
          form_id: "tG7dnxBn",
          response_id: "kickacme0001",
          submitted_at: "2026-10-15T10:00:00Z",
          payment: "KICKOFF PAYMENT SECRET",
          answers: [
            kickoff(
              "cf53482c-1111-4000-8000-000000000001",
              "What is your daily budget for the ads?",
              "$50 a day",
            ),
            kickoff(
              "7d16afbb-1111-4000-8000-000000000002",
              "Platforms",
              "Meta (Facebook/Instagram)",
            ),
            kickoff(
              "e4b9dbd3-1111-4000-8000-000000000003",
              "Ad account name",
              "Acme Ads",
            ),
            kickoff(
              "940f494c-1111-4000-8000-000000000004",
              "Name of the Facebook page",
              "Acme Interiors Page",
            ),
            kickoff(
              "8bee68fc-1111-4000-8000-000000000005",
              "Card linked with funds",
              "Yes",
            ),
            kickoff(
              "c0000001-0000-4000-8000-000000000008",
              "Consultation types",
              "Free site visit",
            ),
            kickoff(
              "eb7ed18c-1111-4000-8000-000000000006",
              "Templated Ads Status",
              "Wants To See Them First",
            ),
            kickoff(
              "6fcbd33c-1111-4000-8000-000000000007",
              "Facebook Access Status",
              "Access Confirmed",
            ),
            // The internal payment question: never sent to a creative seat.
            kickoff(
              "75e97e7d-4c19-437a-b4b8-67570c29344f",
              "Payment Amount",
              "2500",
            ),
          ],
        },
      }),
      B,
    ],
  );
  await db.query(
    "INSERT INTO public.editor_clients(task_id,name,dos_donts,offer,offer_url) VALUES($1,'Acme Interiors','DO: logo last\nDON''T: prices','Free site visit','https://docs.google.com/document/d/acmeOffer')",
    [A],
  );
  await db.query(
    "INSERT INTO public.ghl_clients(location_id,client_name,clickup_id,country,language) VALUES('locA','Acme Interiors',$1,'KW','ar')",
    [A],
  );
  await db.query(
    "INSERT INTO public.cockpit_csm_deck_prep(task_id,deck,overrides,updated_by) VALUES($1,'onboarding',$2::jsonb,'csm-a@tests.invalid')",
    [
      A,
      JSON.stringify({
        red_lines: ["No prices on screen"],
        dialect: "kuwaiti",
        budget_band: "SECRET BAND",
        onboarding_presented_at: "x",
      }),
    ],
  );
  await db.query(
    "INSERT INTO public.cockpit_csm_calls(task_id,kind,starts_at,status) VALUES($1,'launch',now()+interval '3 days','booked'),($1,'blueprint',date_trunc('day', now() AT TIME ZONE 'Asia/Kuwait') AT TIME ZONE 'Asia/Kuwait' + interval '10 hours','booked')",
    [A],
  );

  // Applied twice: the second run must change nothing and raise nothing.
  await db.exec(migration(FILE));
  await db.exec(migration(FILE));
}, 60000);
afterAll(async () => {
  await db?.close();
});

const PUBLIC_FNS = [
  "public.cockpit_blueprint_read(text[])",
  "public.cockpit_blueprint_sources(text)",
  "public.cockpit_blueprint_save(text,jsonb,text,integer)",
  "public.cockpit_blueprint_part_done(text,integer,uuid)",
  "public.cockpit_blueprint_rehearse_payload(text,integer,jsonb)",
  "public.cockpit_blueprint_settings_read()",
  "public.cockpit_blueprint_settings_set(text,text,text)",
];
const SERVICE_FNS = [
  "public.cockpit_blueprint_gate_for_actor(uuid,text,boolean)",
  "public.cockpit_blueprint_outbox_settled(uuid,text)",
];
const INTERNAL_FNS = [
  "public.cockpit_blueprint_audit()",
  "public.cockpit_blueprint_first_name(text)",
  "public.cockpit_blueprint_seat()",
  "public.cockpit_blueprint_lines(jsonb,text)",
  "public.cockpit_blueprint_value(text,jsonb)",
  "public.cockpit_blueprint_part_answers(integer,jsonb)",
  "public.cockpit_blueprint_missing(integer,jsonb)",
  "public.cockpit_blueprint_shot_due(text)",
  "public.cockpit_blueprint_settings_json()",
  "public.cockpit_blueprint_steps(text)",
  "public.cockpit_blueprint_json(public.cockpit_blueprints)",
  "public.cockpit_blueprint_payload(jsonb,integer,jsonb,jsonb)",
];

describe("tables, functions and grants", () => {
  test("browser roles cannot touch either table; the service key reads, inserts and updates; row security is on", async () => {
    for (const table of [
      "public.cockpit_blueprints",
      "public.cockpit_blueprint_settings",
    ]) {
      for (const role of ["anon", "authenticated"])
        for (const privilege of [
          "SELECT",
          "INSERT",
          "UPDATE",
          "DELETE",
          "TRUNCATE",
        ])
          expect(
            await owner("SELECT has_table_privilege($1,$2,$3) r", [
              role,
              table,
              privilege,
            ]),
          ).toBe(false);
      for (const privilege of ["SELECT", "INSERT", "UPDATE"])
        expect(
          await owner("SELECT has_table_privilege('service_role',$1,$2) r", [
            table,
            privilege,
          ]),
        ).toBe(true);
      for (const privilege of ["DELETE", "TRUNCATE"])
        expect(
          await owner("SELECT has_table_privilege('service_role',$1,$2) r", [
            table,
            privilege,
          ]),
        ).toBe(false);
      expect(
        await owner(
          "SELECT relrowsecurity r FROM pg_class WHERE oid=$1::regclass",
          [table],
        ),
      ).toBe(true);
    }
    expect(
      await refused(CD_A, "SELECT * FROM public.cockpit_blueprints"),
    ).toContain("permission denied");
  });

  test("signed-in seats run the seven public functions, the server the gate and the settle, nobody the helpers", async () => {
    const can = (role: string, sig: string) =>
      owner<boolean>("SELECT has_function_privilege($1,$2,'EXECUTE') r", [
        role,
        sig,
      ]);
    for (const sig of PUBLIC_FNS) {
      expect(await can("authenticated", sig)).toBe(true);
      expect(await can("anon", sig)).toBe(false);
      expect(await can("service_role", sig)).toBe(false);
    }
    for (const sig of SERVICE_FNS) {
      expect(await can("service_role", sig)).toBe(true);
      expect(await can("authenticated", sig)).toBe(false);
      expect(await can("anon", sig)).toBe(false);
    }
    for (const sig of INTERNAL_FNS)
      for (const role of ["anon", "authenticated", "service_role"])
        expect(await can(role, sig)).toBe(false);
    await asOwner();
    const fns = (
      await db.query<{
        name: string;
        definer: boolean;
        config: string[] | null;
      }>(
        "SELECT proname name, prosecdef definer, proconfig config FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname LIKE 'cockpit_blueprint%'",
      )
    ).rows;
    expect(fns.length).toBe(
      PUBLIC_FNS.length + SERVICE_FNS.length + INTERNAL_FNS.length,
    );
    for (const fn of fns) {
      expect(fn.definer).toBe(true);
      expect(fn.config).toContain('search_path=""');
    }
    expect(
      await refused(null, "SELECT public.cockpit_blueprint_settings_read() r"),
    ).toContain("permission denied");
  });

  test("the close switch starts at card_only; the packs and the launch media buyer start empty", async () => {
    const s = await one<Row>(
      CD_A,
      "SELECT public.cockpit_blueprint_settings_read() r",
    );
    expect(s.closeRoute).toBe("card_only");
    // The seed has its audit row (written after the trigger exists), once.
    expect(
      await count(
        "SELECT count(*) n FROM public.cockpit_audit_log WHERE entity_type='cockpit_blueprint_settings' AND entity_id='close_route'",
      ),
    ).toBe(1);
    expect(s.assignee).toBeNull();
    expect(Object.values(s.packs)).toEqual([null, null, null, null, null]);
    expect(Object.keys(s.packs).sort()).toEqual([
      "architecture",
      "construction",
      "design-build",
      "fitout",
      "interior",
    ]);
    expect(s.can).toEqual({ packs: true, closeRoute: false });
  });
});

describe("the gate", () => {
  const gate = (who: string, task: string, write: boolean) =>
    one<Row>(
      who,
      "SELECT public.cockpit_blueprint_gate_for_actor(auth.uid(),$1,$2) r",
      [task, write],
    );
  test("is internal: a signed-in seat cannot call it directly", async () => {
    expect(
      await refused(
        CD_A,
        "SELECT public.cockpit_blueprint_gate_for_actor(auth.uid(),$1,true) r",
        [A],
      ),
    ).toContain("permission denied");
  });
  test("a creative seat with the client writes; one without it, a buyer and a deactivated seat are refused", async () => {
    await asOwner();
    await db.exec(
      "GRANT EXECUTE ON FUNCTION public.cockpit_blueprint_gate_for_actor(uuid,text,boolean) TO authenticated",
    );
    try {
      expect(await gate(CD_A, A, true)).toMatchObject({
        clientName: "Acme Interiors",
        write: true,
        rehearse: false,
        firstName: "Dana",
      });
      expect(
        (
          await failure(
            CD_A,
            "SELECT public.cockpit_blueprint_gate_for_actor(auth.uid(),$1,true) r",
            [B],
          )
        ).message,
      ).toContain("not on your access list");
      // Gamma is not in the creative roster: a creative seat is told to refresh it.
      expect(
        await refused(
          CD_ALL,
          "SELECT public.cockpit_blueprint_gate_for_actor(auth.uid(),$1,false) r",
          [C],
        ),
      ).toContain("not in the creative roster");
      expect(
        await refused(
          BUYER,
          "SELECT public.cockpit_blueprint_gate_for_actor(auth.uid(),$1,false) r",
          [A],
        ),
      ).toContain("access is required");
      expect(
        await refused(
          GONE,
          "SELECT public.cockpit_blueprint_gate_for_actor(auth.uid(),$1,false) r",
          [A],
        ),
      ).toContain("access is required");
      // A client success seat reads its own client, never writes.
      expect(await gate(CSM_A, A, false)).toMatchObject({
        clientName: "Acme Interiors",
        write: false,
      });
      expect(
        await refused(
          CSM_A,
          "SELECT public.cockpit_blueprint_gate_for_actor(auth.uid(),$1,true) r",
          [A],
        ),
      ).toContain("Only the creative director");
      expect(
        await refused(
          CSM_A,
          "SELECT public.cockpit_blueprint_gate_for_actor(auth.uid(),$1,false) r",
          [B],
        ),
      ).toContain("not on your access list");
      // An admin and a founder pass both, and may rehearse; Gamma reads through the client success path.
      expect(await gate(ADMIN, A, true)).toMatchObject({
        write: true,
        rehearse: true,
      });
      expect(await gate(CEO, B, true)).toMatchObject({
        write: true,
        rehearse: true,
        clientName: "Beta Build",
      });
      expect(await gate(CEO, C, false)).toMatchObject({
        write: false,
        rehearse: true,
        clientName: "Gamma Design",
      });
      expect(
        await refused(
          CEO,
          "SELECT public.cockpit_blueprint_gate_for_actor(auth.uid(),$1,true) r",
          [C],
        ),
      ).toContain("not in the creative roster");
      expect(
        await refused(
          CD_A,
          "SELECT public.cockpit_blueprint_gate_for_actor(auth.uid(),$1,true) r",
          ["bad id!"],
        ),
      ).toContain("valid ClickUp client ID");
    } finally {
      await asOwner();
      await db.exec(
        "REVOKE EXECUTE ON FUNCTION public.cockpit_blueprint_gate_for_actor(uuid,text,boolean) FROM authenticated",
      );
    }
  });
});

describe("answers", () => {
  test("refuses an unknown key, the server's own key, oversize text, a bad choice and a bad Drive link, and saves nothing", async () => {
    const before = await count(
      "SELECT count(*) n FROM public.cockpit_audit_log",
    );
    expect(await saveRefused(CD_A, A, { nope: "x" })).toContain(
      "no answer called nope",
    );
    expect(
      await saveRefused(CD_A, A, { shot_list_due: "2026-10-25" }),
    ).toContain("set by the server");
    expect(await saveRefused(CD_A, A, { method: "x".repeat(4001) })).toContain(
      "at most 4000",
    );
    expect(
      await saveRefused(CD_A, A, { capacity_note: "x".repeat(301) }),
    ).toContain("at most 300");
    expect(await saveRefused(CD_A, A, { service: "landscaping" })).toContain(
      "not one of the answers",
    );
    expect(
      await saveRefused(CD_A, A, {
        pack_url: "https://example.invalid/folder",
      }),
    ).toContain("Google Drive folder");
    expect(
      await saveRefused(CD_A, A, {
        minimum: { amount: 3000, currency: "EUR" },
      }),
    ).toContain("currency");
    expect(
      await saveRefused(CD_A, A, { daily_budget: { said: "KWD 15" } }),
    ).toContain("in dollars");
    expect(
      await saveRefused(CD_A, A, {
        red_lines: Array.from({ length: 13 }, (_, i) => `Line ${i}`),
      }),
    ).toContain("at most 12");
    expect(
      await saveRefused(CD_A, A, {
        competitors: Array.from({ length: 16 }, (_, i) => ({
          name: `Rival ${i}`,
        })),
      }),
    ).toContain("at most 15");
    expect(
      await saveRefused(CD_A, A, {
        competitors: [{ name: "Rival", note: "x".repeat(161) }],
      }),
    ).toContain("at most 160");
    expect(
      await saveRefused(CD_A, A, { offer: { name: "x".repeat(81) } }),
    ).toContain("at most 80");
    expect(
      await saveRefused(CD_A, A, { scripts_date: "2026-02-30" }),
    ).toContain("real date");
    expect(
      await saveRefused(CD_A, A, { service: "interior" }, { session: "short" }),
    ).toContain("session");
    expect(await saveRefused(CSM_A, A, { service: "interior" })).toContain(
      "Only the creative director",
    );
    expect(await saveRefused(CD_A, B, { service: "interior" })).toContain(
      "not on your access list",
    );
    expect(
      await count("SELECT count(*) n FROM public.cockpit_blueprints"),
    ).toBe(0);
    expect(await count("SELECT count(*) n FROM public.cockpit_audit_log")).toBe(
      before,
    );
  });

  test("normalises what it keeps: trimmed text, deduplicated lines and names, a blank removes the key", async () => {
    const r = await save(
      CD_A,
      A,
      {
        service: "interior",
        red_lines: [
          "  No prices on screen ",
          "No prices on screen",
          "",
          "No faces",
        ],
        competitors: [
          { name: " Example Studio " },
          { name: "example studio", lose: true },
          { name: "Other Example", lose: true, note: "  Quick   quotes " },
        ],
        capacity_note: "line one\nline two",
        daily_budget: { usd: 40, said: " $50 a day " },
        not_for: "   ",
      },
      { from: { service: "kickoff", daily_budget: "kickoff" } },
    );
    expect(r.conflicts).toEqual([]);
    expect(r.row.answers).toEqual({
      service: "interior",
      red_lines: ["No prices on screen", "No faces"],
      competitors: [
        { name: "Example Studio", lose: false },
        // What they are known for, trimmed (slide 8's clipping).
        { name: "Other Example", lose: true, note: "Quick quotes" },
      ],
      capacity_note: "line one line two",
      daily_budget: { usd: 40, said: "$50 a day" },
    });
    expect(r.row.revision).toBe(1);
    expect(r.row.meta.service).toMatchObject({ by: "Dana", from: "kickoff" });
    // Addresses and sessions never leave the server.
    expect(JSON.stringify(r)).not.toContain("@");
    expect(JSON.stringify(r)).not.toContain(S1);
    const again = await save(CD_A, A, { capacity_note: "" }, { base: 1 });
    expect(again.row.answers.capacity_note).toBeUndefined();
    expect(again.row.revision).toBe(2);
  });

  test("one audit row per save, naming only the keys it changed, never the meta", async () => {
    await asOwner();
    const rows = (
      await db.query<Row>(
        "SELECT * FROM public.cockpit_audit_log WHERE action='blueprint.save' ORDER BY created_at, id",
      )
    ).rows;
    expect(rows.length).toBe(2);
    expect(rows[1].metadata.changed).toEqual(["capacity_note"]);
    expect(rows[1].after.answers).toEqual({});
    expect(rows[1].before.answers).toEqual({
      capacity_note: "line one line two",
    });
    expect(rows[1].after.answer_meta).toBeUndefined();
    expect(rows[1]).toMatchObject({
      entity_type: "cockpit_blueprints",
      entity_id: A,
      actor_email: "cd-a@tests.invalid",
      source_app: "creative",
    });
  });
});

describe("conflicts", () => {
  test("another browser's stale save of the same key conflicts and is not applied; nothing typed is lost", async () => {
    // The CD's browser (S1) saved service at revision 1; S2 still had revision 1 and saw nothing.
    const r = await save(
      CD_ALL,
      A,
      { service: "fitout" },
      { session: S2, base: 1, seen: { service: null } },
    );
    expect(r.applied).toEqual([]);
    expect(r.conflicts).toEqual([
      {
        key: "service",
        theirs: "interior",
        by: "Dana",
        at: expect.any(String),
      },
    ]);
    // The stored row comes back, so the window shows theirs and keeps what was typed.
    expect(r.row.answers.service).toBe("interior");
    expect(
      await owner(
        "SELECT answers->>'service' r FROM public.cockpit_blueprints WHERE task_id=$1",
        [A],
      ),
    ).toBe("interior");
  });
  test("the same session never conflicts with itself, a matching seen applies, an equal base revision applies everything", async () => {
    const own = await save(
      CD_A,
      A,
      { service: "architecture" },
      { session: S1, base: 1, seen: { service: null } },
    );
    expect(own.conflicts).toEqual([]);
    expect(own.row.answers.service).toBe("architecture");
    const seen = await save(
      CD_ALL,
      A,
      { service: "fitout" },
      { session: S2, base: 1, seen: { service: "architecture" } },
    );
    expect(seen.conflicts).toEqual([]);
    expect(seen.row.answers.service).toBe("fitout");
    expect(seen.row.meta.service.by).toBe("Omar");
    const rev = seen.row.revision;
    const equal = await save(
      CD_A,
      A,
      { service: "interior" },
      { session: S1, base: rev, seen: { service: "nonsense" } },
    );
    expect(equal.conflicts).toEqual([]);
    expect(equal.row.answers.service).toBe("interior");
    // A key nobody else touched applies even from a stale revision.
    const other = await save(
      CD_ALL,
      A,
      { method: "Site visit first (example)" },
      { session: S2, base: 1 },
    );
    expect(other.applied).toEqual(["method"]);
    expect(other.conflicts).toEqual([]);
    await save(CD_A, A, { method: "" }, { base: other.row.revision });
  });
  test("ticking the shot list sets its due date from today's Blueprint call; unticking removes it", async () => {
    const r = await save(CD_A, A, { shot_list: true }, { base: null });
    const due = Date.parse(r.row.answers.shot_list_due);
    const call = await owner<string>(
      "SELECT starts_at r FROM public.cockpit_csm_calls WHERE task_id=$1 AND kind='blueprint'",
      [A],
    );
    expect(due).toBe(Date.parse(call) + 72 * 3600 * 1000);
    expect(r.row.meta.shot_list_due.from).toBe("server");
    const off = await save(
      CD_A,
      A,
      { shot_list: false },
      { base: r.row.revision },
    );
    expect(off.row.answers.shot_list).toBeUndefined();
    expect(off.row.answers.shot_list_due).toBeUndefined();
    // Beta has no call today: due 72 hours from now.
    const beta = await save(CEO, B, { shot_list: true });
    expect(
      Math.abs(
        Date.parse(beta.row.answers.shot_list_due) -
          (Date.now() + 72 * 3600 * 1000),
      ),
    ).toBeLessThan(120000);
  });
});

describe("required keys and the part order", () => {
  const missing = (part: number, answers: Row) =>
    owner<string[]>("SELECT public.cockpit_blueprint_missing($1,$2::jsonb) r", [
      part,
      JSON.stringify(answers),
    ]);
  test("part 1: six always, the pack and its approval only with starter ads, the notes only when they apply", async () => {
    expect(await missing(1, {})).toEqual([
      "service",
      "capacity",
      "starter",
      "daily_budget",
      "destination",
      "identity",
    ]);
    expect(await missing(1, { ...PART1 })).toEqual([]);
    const noNote = { ...PART1 } as Row;
    delete noNote.capacity_note;
    expect(await missing(1, noNote)).toEqual(["capacity_note"]);
    expect(await missing(1, { ...noNote, capacity: "yes" })).toEqual([]);
    expect(
      await missing(1, {
        ...PART1,
        starter: "yes",
        pack_url: undefined,
        pack_approval: "wants_changes",
      }),
    ).toEqual(["pack_url", "pack_changes"]);
    expect(
      await missing(1, {
        ...PART1,
        starter: "no",
        pack_url: undefined,
        pack_approval: undefined,
      }),
    ).toEqual([]);
  });
  test("part 2: eleven, Brand DNA's gaps only when there are some; part 3: the offer's three lines", async () => {
    expect(await missing(2, {})).toEqual([
      "best_client",
      "method",
      "pricing",
      "minimum",
      "anchor",
      "competitors",
      "approval",
      "dna_status",
      "rules",
      "camera",
      "readback_yes",
    ]);
    expect(await missing(2, PART2)).toEqual([]);
    expect(await missing(2, { ...PART2, dna_missing: undefined })).toEqual([
      "dna_missing",
    ]);
    expect(
      await missing(2, {
        ...PART2,
        dna_status: "complete",
        dna_missing: undefined,
      }),
    ).toEqual([]);
    expect(await missing(3, {})).toEqual(["offer"]);
    expect(
      await missing(3, {
        offer: { name: "The Site Visit (example)", what: "A measured plan" },
      }),
    ).toEqual(["offer"]);
    expect(
      await missing(3, {
        offer: {
          name: "The Site Visit (example)",
          what: "A measured plan",
          firstStep: "A free visit",
        },
      }),
    ).toEqual([]);
  });
  test("the press names what is missing, and the parts go in order", async () => {
    const e = await failure(CD_A, PRESS, [A, 1, uuid(1)]);
    expect(e.message).toBe("Still missing");
    expect(String(e.detail)).toContain("capacity");
    expect(await refused(CD_A, PRESS, [A, 2, uuid(2)])).toContain(
      "Send part 1 to media first.",
    );
    expect(await refused(CD_A, PRESS, [A, 3, uuid(3)])).toContain(
      "Close the call first.",
    );
    expect(await refused(CD_A, PRESS, [A, 4, uuid(4)])).toContain(
      "part 1, 2 or 3",
    );
    expect(await refused(CSM_A, PRESS, [A, 1, uuid(5)])).toContain(
      "Only the creative director",
    );
    expect(await outboxRows()).toBe(0);
    expect(await partAudits()).toBe(0);
  });
});

describe("a press", () => {
  let rev = 0;
  test("Send to media queues exactly one outbox row and one part_done audit row, with the payload built from the record", async () => {
    const cur = await owner<number>(
      "SELECT revision r FROM public.cockpit_blueprints WHERE task_id=$1",
      [A],
    );
    const saved = await save(CD_A, A, PART1, {
      base: cur,
      from: { daily_budget: "kickoff" },
    });
    expect(saved.conflicts).toEqual([]);
    rev = saved.row.revision;
    await asOwner();
    await db.exec("SELECT public.cockpit_blueprint_settings_json()");
    const r = await press(CD_A, A, 1, uuid(10));
    expect(r).toMatchObject({
      id: uuid(10),
      state: "pending",
      part: 1,
      presses: 1,
    });
    expect(await outboxRows()).toBe(1);
    expect(await partAudits()).toBe(1);
    const q = await owner<Row>(
      "SELECT to_jsonb(o) r FROM public.cockpit_creative_outbox o WHERE id=$1",
      [uuid(10)],
    );
    expect(q).toMatchObject({
      kind: "blueprintLaunch",
      task_id: A,
      client_name: "Acme Interiors",
      actor_id: CD_A,
      actor_email: "cd-a@tests.invalid",
      state: "pending",
    });
    const p = q.payload;
    expect(p).toMatchObject({
      v: 1,
      part: 1,
      press: 1,
      card: { id: A, name: "Acme Interiors" },
      previous: null,
      launchTaskId: null,
      sentBy: "Dana",
    });
    expect(p.answers).toEqual(PART1);
    expect(p.from).toEqual({ daily_budget: "kickoff" });
    expect(p.kickoff).toEqual({
      budgetSaid: "$50 a day",
      platforms: "Meta (Facebook/Instagram)",
      adAccount: "Acme Ads",
      pageName: "Acme Interiors Page",
      cardFunded: "Yes",
      consultTypes: "Free site visit",
      templatedStatus: "Wants To See Them First",
      facebookAccess: "Access Confirmed",
    });
    expect(p.cardBudget).toBe(45);
    expect(p.settings).toEqual({ assignee: null, pack: null });
    expect(p.step4).toEqual({
      taskId: "st4",
      parentId: "par1",
      name: "4 · Select Templated Creatives So They Can Launch",
    });
    expect(p.links).toEqual({
      drive: "https://drive.google.com/drive/folders/acmeDrive000001",
      driveFolder: "https://drive.google.com/drive/folders/acmeDriveFolder01",
      brandDna: "https://docs.google.com/document/d/acmeDna",
      offerSheet: "https://docs.google.com/document/d/acmeOffer",
      research: "https://docs.google.com/document/d/acmeResearch",
    });
    for (const secret of ["SECRET", "999"])
      expect(JSON.stringify(p)).not.toContain(secret);
    const audit = await owner<Row>(
      "SELECT to_jsonb(a) r FROM public.cockpit_audit_log a WHERE action='blueprint.part_done'",
    );
    expect(audit).toMatchObject({
      entity_type: "cockpit_blueprints",
      entity_id: A,
      actor_email: "cd-a@tests.invalid",
      source_app: "creative",
    });
    expect(audit.metadata).toEqual({
      part: 1,
      client_name: "Acme Interiors",
      request_id: uuid(10),
      second: false,
    });
    const row = await one<Row>(
      CD_A,
      "SELECT public.cockpit_blueprint_read($1::text[]) r",
      [[A]],
    );
    expect(row.rows[0].parts["1"]).toMatchObject({
      status: "done",
      presses: 1,
      firstBy: "Dana",
      lastBy: "Dana",
      lastRequestId: uuid(10),
      sent: PART1,
    });
    expect(row.rows[0].outbox["1"]).toMatchObject({
      id: uuid(10),
      state: "pending",
    });
    expect(row.rows[0].revision).toBe(rev);
  });

  test("the outbox runner can load the row as the creative director, exactly as it loads a video request", async () => {
    const got = await one<Row>(
      CD_A,
      "SELECT public.cockpit_creative_client_action('get',$1::jsonb) r",
      [JSON.stringify({ id: uuid(10) })],
    );
    expect(got).toMatchObject({
      id: uuid(10),
      kind: "blueprintLaunch",
      task_id: A,
      state: "pending",
      sourceTask: null,
    });
  });

  test("the same request ID again writes nothing; an unchanged second press returns the first row", async () => {
    const again = await press(CD_A, A, 1, uuid(10));
    expect(again).toMatchObject({
      id: uuid(10),
      state: "pending",
      again: true,
      presses: 1,
    });
    const dup = await press(CD_A, A, 1, uuid(11));
    expect(dup).toMatchObject({ id: uuid(10), duplicate: true, presses: 1 });
    expect(await outboxRows()).toBe(1);
    expect(await partAudits()).toBe(1);
    // A request ID that belongs to another part is refused.
    expect(await refused(CD_A, PRESS, [A, 2, uuid(10)])).toContain(
      "does not match its first send",
    );
  });

  test("a changed part makes a second row that carries what media last received, and its audit row says second", async () => {
    // The runner took the first press to the end.
    await asOwner();
    await db.query(
      "UPDATE public.cockpit_creative_outbox SET state='done', result=$2::jsonb, settled_at=now() WHERE id=$1",
      [
        uuid(10),
        JSON.stringify({ kind: "blueprintLaunch", launchTaskId: "abc123" }),
      ],
    );
    await save(CD_A, A, { daily_budget: { usd: 35 } }, { base: rev });
    const r = await press(CD_A, A, 1, uuid(12));
    expect(r).toMatchObject({ id: uuid(12), presses: 2 });
    const p = await owner<Row>(
      "SELECT payload r FROM public.cockpit_creative_outbox WHERE id=$1",
      [uuid(12)],
    );
    expect(p.press).toBe(2);
    expect(p.previous.daily_budget).toEqual({ usd: 40, said: "$50 a day" });
    expect(p.answers.daily_budget).toEqual({ usd: 35 });
    expect(await partAudits()).toBe(2);
    expect(
      await owner(
        "SELECT metadata->'second' r FROM public.cockpit_audit_log WHERE action='blueprint.part_done' AND metadata->>'request_id'=$1",
        [uuid(12)],
      ),
    ).toBe(true);
    const firstAt = await owner<string>(
      "SELECT parts->'1'->>'firstAt' r FROM public.cockpit_blueprints WHERE task_id=$1",
      [A],
    );
    expect(firstAt).toBeTruthy();
  });

  test("a press whose row never ran is superseded by the next, and media's last-received answers stay the base", async () => {
    const cur = await owner<number>(
      "SELECT revision r FROM public.cockpit_blueprints WHERE task_id=$1",
      [A],
    );
    await save(CD_A, A, { destination: "landing_page" }, { base: cur });
    const r = await press(CD_A, A, 1, uuid(14));
    expect(r).toMatchObject({ id: uuid(14), presses: 3 });
    expect(
      await owner<Row>(
        "SELECT jsonb_build_object('state',state,'error',error) r FROM public.cockpit_creative_outbox WHERE id=$1",
        [uuid(12)],
      ),
    ).toEqual({
      state: "failed",
      error: "Superseded by a later press of the same part",
    });
    const p = await owner<Row>(
      "SELECT payload r FROM public.cockpit_creative_outbox WHERE id=$1",
      [uuid(14)],
    );
    expect(p.press).toBe(3);
    expect(p.previous).toEqual(PART1);
    // The superseded row cannot be run any more: the runner needs a pending row.
    expect(
      await one<Row>(
        CD_A,
        "SELECT public.cockpit_creative_client_action('get',$1::jsonb) r",
        [JSON.stringify({ id: uuid(12) })],
      ),
    ).toMatchObject({ state: "failed" });
  });

  test("Close the call carries the close switch, the map link, the launch call and step 2", async () => {
    const cur = await owner<number>(
      "SELECT revision r FROM public.cockpit_blueprints WHERE task_id=$1",
      [A],
    );
    await save(
      CD_A,
      A,
      {
        ...PART2,
        shot_list: true,
        offer: { name: "The Site Visit (example)" },
      },
      { base: cur },
    );
    const r = await press(CD_A, A, 2, uuid(20));
    expect(r).toMatchObject({ state: "pending", part: 2, presses: 1 });
    const p = await owner<Row>(
      "SELECT payload r FROM public.cockpit_creative_outbox WHERE id=$1",
      [uuid(20)],
    );
    expect(p).toMatchObject({
      part: 2,
      service: "interior",
      closeRoute: "card_only",
      csmFirstName: "noura",
      mapUrl: `https://mahara-onboarding-map.vercel.app/?phase=5&cid=${A}`,
      step2: { taskId: "st2", parentId: "par1" },
      offer: { name: "The Site Visit (example)" },
    });
    expect(typeof p.launchCall.startsAt).toBe("string");
    expect(p.answers.shot_list_due).toBeTruthy();
    expect(p.answers.offer).toBeUndefined();
  });

  test("Lock the offer needs its three lines, and carries Brand DNA's gaps and step 3", async () => {
    expect(await refused(CD_A, PRESS, [A, 3, uuid(30)])).toBe("Still missing");
    const cur = await owner<number>(
      "SELECT revision r FROM public.cockpit_blueprints WHERE task_id=$1",
      [A],
    );
    await save(
      CD_A,
      A,
      {
        offer: {
          name: "The Site Visit (example)",
          what: "A measured plan",
          firstStep: "A free visit by the lead designer",
        },
        scripts_status: "in_progress",
      },
      { base: cur },
    );
    await press(CD_A, A, 3, uuid(31));
    const p = await owner<Row>(
      "SELECT payload r FROM public.cockpit_creative_outbox WHERE id=$1",
      [uuid(31)],
    );
    expect(p).toMatchObject({
      part: 3,
      dna_status: "small_gaps",
      dna_missing: "Tone of voice section",
      step3: { taskId: "st3" },
      offerSheet: "https://docs.google.com/document/d/acmeOffer",
    });
    expect(p.answers).toEqual({
      offer: {
        name: "The Site Visit (example)",
        what: "A measured plan",
        firstStep: "A free visit by the lead designer",
      },
      scripts_status: "in_progress",
    });
  });
});

describe("the server's settle", () => {
  const settle = async (id: string, task: string) => {
    await asOwner();
    await db.exec("SET ROLE service_role");
    try {
      await db.query(
        "SELECT public.cockpit_blueprint_outbox_settled($1::uuid,$2)",
        [id, task],
      );
      return null;
    } catch (e) {
      return (e as Error).message;
    } finally {
      await db.exec("RESET ROLE");
    }
  };
  test("names the launch task only from a finished Send to media run whose result says so", async () => {
    expect(await settle(uuid(12), "abc123")).toContain(
      "finished Send to media run",
    );
    expect(await settle(uuid(14), "abc123")).toContain(
      "finished Send to media run",
    );
    expect(await settle(uuid(10), "zzz999")).toContain(
      "not the launch task this run wrote to",
    );
    expect(await settle(uuid(10), "bad id")).toContain("not a ClickUp task ID");
    expect(await settle(uuid(20), "abc123")).toContain(
      "finished Send to media run",
    );
    expect(await settle(uuid(10), "abc123")).toBeNull();
    expect(
      await owner(
        "SELECT launch_task_id r FROM public.cockpit_blueprints WHERE task_id=$1",
        [A],
      ),
    ).toBe("abc123");
    expect(
      await count(
        "SELECT count(*) n FROM public.cockpit_audit_log WHERE action='blueprint.launch_task'",
      ),
    ).toBe(1);
    // Again: nothing changes, no new audit row.
    expect(await settle(uuid(10), "abc123")).toBeNull();
    expect(
      await count(
        "SELECT count(*) n FROM public.cockpit_audit_log WHERE action='blueprint.launch_task'",
      ),
    ).toBe(1);
    expect(
      await refused(
        CD_A,
        "SELECT public.cockpit_blueprint_outbox_settled($1::uuid,'abc123')",
        [uuid(10)],
      ),
    ).toContain("permission denied");
  });
});

describe("settings", () => {
  const set = (
    who: string,
    key: string,
    value: string | null,
    label: string | null = null,
  ) =>
    one<Row>(who, "SELECT public.cockpit_blueprint_settings_set($1,$2,$3) r", [
      key,
      value,
      label,
    ]);
  const setRefused = (
    who: string,
    key: string,
    value: string | null,
    label: string | null = null,
  ) =>
    refused(who, "SELECT public.cockpit_blueprint_settings_set($1,$2,$3) r", [
      key,
      value,
      label,
    ]);
  test("validates each setting, keeps the close switch for admins and the founders, and audits each write", async () => {
    const before = await count(
      "SELECT count(*) n FROM public.cockpit_audit_log WHERE action='blueprint.setting'",
    );
    expect(
      await setRefused(CD_A, "pack.interior", "https://example.invalid/x"),
    ).toContain("Google Drive folder");
    expect(
      await setRefused(
        CD_A,
        "pack.landscaping",
        "https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOp",
      ),
    ).toContain("no setting called");
    expect(
      await setRefused(CD_A, "launch_assignee", "not-a-number", "Someone"),
    ).toContain("from the list");
    expect(
      await setRefused(CD_A, "launch_assignee", "12345678", null),
    ).toContain("name the list showed");
    expect(await setRefused(CD_A, "close_route", "slack")).toContain(
      "Only an admin or the CEO",
    );
    expect(
      await setRefused(
        CSM_A,
        "pack.interior",
        "https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOp",
      ),
    ).toContain("Only the creative team");
    expect(
      await setRefused(
        BUYER,
        "pack.interior",
        "https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOp",
      ),
    ).toContain("access is required");
    expect(await setRefused(ADMIN, "close_route", "whatsapp")).toContain(
      "card_only, slack or make",
    );
    expect(await setRefused(ADMIN, "close_route", "")).toContain(
      "card_only, slack or make",
    );
    expect(
      await count(
        "SELECT count(*) n FROM public.cockpit_audit_log WHERE action='blueprint.setting'",
      ),
    ).toBe(before);

    const s = await set(
      CD_A,
      "pack.interior",
      "https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOp?usp=sharing",
    );
    expect(s.packs.interior).toBe(
      "https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOp?usp=sharing",
    );
    expect(s.changes["pack.interior"].by).toBe("Dana");
    const a = await set(CD_A, "launch_assignee", "12345678", "Example Buyer");
    expect(a.assignee).toEqual({ id: "12345678", label: "Example Buyer" });
    // The same value again writes nothing.
    await set(CD_A, "launch_assignee", "12345678", "Example Buyer");
    const route = await set(ADMIN, "close_route", "slack");
    expect(route.closeRoute).toBe("slack");
    await set(CEO, "close_route", "card_only");
    // A blank removes a pack.
    await set(
      CD_A,
      "pack.fitout",
      "https://drive.google.com/drive/folders/1FitoutFolder0001",
    );
    expect((await set(CD_A, "pack.fitout", " ")).packs.fitout).toBeNull();
    expect(
      await count(
        "SELECT count(*) n FROM public.cockpit_audit_log WHERE action='blueprint.setting'",
      ),
    ).toBe(before + 6);
    expect(
      JSON.stringify(
        await one(CSM_A, "SELECT public.cockpit_blueprint_settings_read() r"),
      ),
    ).not.toContain("@");
  });
  test("the next Send to media carries the pack of its service and the launch media buyer", async () => {
    const cur = await owner<number>(
      "SELECT revision r FROM public.cockpit_blueprints WHERE task_id=$1",
      [A],
    );
    await save(CD_A, A, { identity: "our_page" }, { base: cur });
    await press(CD_A, A, 1, uuid(13));
    const p = await owner<Row>(
      "SELECT payload r FROM public.cockpit_creative_outbox WHERE id=$1",
      [uuid(13)],
    );
    expect(p.settings).toEqual({
      assignee: { id: "12345678", label: "Example Buyer" },
      pack: "https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOp?usp=sharing",
    });
    expect(p.launchTaskId).toBe("abc123");
    expect(p.press).toBe(4);
  });
});

describe("rehearsal", () => {
  const REH =
    "SELECT public.cockpit_blueprint_rehearse_payload($1,$2,$3::jsonb) r";
  test("refuses a creative seat and a client success seat", async () => {
    expect(await refused(CD_A, REH, [A, 1, JSON.stringify(PART1)])).toContain(
      "Only an admin or the CEO",
    );
    expect(await refused(CSM_A, REH, [A, 1, JSON.stringify(PART1)])).toContain(
      "Only an admin or the CEO",
    );
  });
  test("returns what a press would queue, with the same checks, and writes nothing", async () => {
    const counts = async () => [
      await count("SELECT count(*) n FROM public.cockpit_blueprints"),
      await outboxRows(),
      await count("SELECT count(*) n FROM public.cockpit_audit_log"),
    ];
    const before = await counts();
    const r = await one<Row>(ADMIN, REH, [
      B,
      1,
      JSON.stringify({ ...PART1, starter: "no" }),
    ]);
    expect(r).toMatchObject({
      kind: "blueprintLaunch",
      taskId: B,
      clientName: "Beta Build",
      missing: [],
    });
    expect(r.payload.answers.pack_url).toBeUndefined();
    expect(r.payload.kickoff.budgetSaid).toBeNull();
    const two = await one<Row>(CEO, REH, [
      B,
      2,
      JSON.stringify({ ...PART2, shot_list: true }),
    ]);
    expect(two.missing).toEqual([]);
    expect(two.payload.answers.shot_list_due).toBeTruthy();
    const empty = await one<Row>(CEO, REH, [B, 3, "{}"]);
    expect(empty.missing).toEqual(["offer"]);
    expect(
      await refused(CEO, REH, [
        B,
        1,
        JSON.stringify({ service: "landscaping" }),
      ]),
    ).toContain("not one of the answers");
    expect(await counts()).toEqual(before);
  });
});

describe("reads", () => {
  test("the dashboard read leaves out cards the seat may not open, and is capped at 200", async () => {
    const r = await one<Row>(
      CD_A,
      "SELECT public.cockpit_blueprint_read($1::text[]) r",
      [[A, B, C, "nope"]],
    );
    expect(r.rows.map((x: Row) => x.taskId)).toEqual([A]);
    expect(r.rows[0].can).toEqual({ write: true });
    expect(typeof r.now).toBe("string");
    const csm = await one<Row>(
      CSM_A,
      "SELECT public.cockpit_blueprint_read($1::text[]) r",
      [[A, B]],
    );
    expect(csm.rows.map((x: Row) => x.taskId)).toEqual([A]);
    expect(csm.rows[0].can).toEqual({ write: false });
    const all = await one<Row>(
      CEO,
      "SELECT public.cockpit_blueprint_read($1::text[]) r",
      [[A, B, C]],
    );
    expect(all.rows.map((x: Row) => x.taskId)).toEqual([A, B]);
    expect(JSON.stringify(r)).not.toContain("@");
    expect(
      await refused(
        CD_A,
        "SELECT public.cockpit_blueprint_read($1::text[]) r",
        [Array.from({ length: 201 }, (_, i) => `t${i}`)],
      ),
    ).toContain("at most 200");
    expect(
      await refused(
        BUYER,
        "SELECT public.cockpit_blueprint_read($1::text[]) r",
        [[A]],
      ),
    ).toContain("access is required");
  });

  test("the deck's sources come in the deck engine's shape and leave out billing, payment, contract and the transcript", async () => {
    const s = await one<Row>(
      CD_A,
      "SELECT public.cockpit_blueprint_sources($1) r",
      [A],
    );
    expect(s).toMatchObject({
      taskId: A,
      clientName: "Acme Interiors",
      can: { write: true, rehearse: false },
      presenter: { firstName: "Dana" },
    });
    expect(s.deck).toMatchObject({
      taskId: A,
      clientName: "Acme Interiors",
      client: {
        stage: "Brand Blueprint Booked♠️",
        service: "DFY",
        bucket: "onboarding",
      },
      ghl: { country: "KW", language: "ar" },
      editor: { offer: "Free site visit" },
      dosDonts: { text: "DO: logo last\nDON'T: prices" },
      launchAds: [],
    });
    // Today's Blueprint call is next or last depending on the hour the test runs.
    expect(s.deck.calls.next.launch.status).toBe("booked");
    expect(
      { ...s.deck.calls.next, ...s.deck.calls.last }.blueprint,
    ).toBeTruthy();
    expect(s.deck.prep.onboarding.overrides).toEqual({
      red_lines: ["No prices on screen"],
      dialect: "kuwaiti",
    });
    expect(s.deck.prep.onboarding).toMatchObject({
      deck: "onboarding",
      revision: 1,
    });
    expect(s.kit.handover).toEqual({
      closer: "Sami",
      daily_budget: 45,
      service: "Interior design",
    });
    expect(s.kit.links.contract).toBeUndefined();
    // Only the links the Blueprint opens: no sales call, no report sheet.
    expect(s.kit.links.sales_call).toBeUndefined();
    expect(s.kit.links.report_sheet).toBeUndefined();
    expect(Object.keys(s.kit.links).sort()).toEqual([
      "brand_dna",
      "drive",
      "market_research",
    ]);
    expect(s.kit.forms.kickoff.payment).toBeUndefined();
    // The kickoff's "Payment Amount" answer is left out too.
    expect(
      s.kit.forms.kickoff.answers.some((x: Row) =>
        String(x.ref).startsWith("75e97e7d"),
      ),
    ).toBe(false);
    expect(s.kit.forms.kickoff.answers.length).toBe(8);
    expect(s.kit.csm).toBe("noura al-sabah");
    expect(s.card).toEqual({
      templatedAds: "Wants To See Them First",
      canSelfRecord: "Yes - phone only",
      adApproval: null,
      offerCreation: null,
    });
    expect(s.creativeOnboarding).toMatchObject({
      parentId: "par1",
      steps: {
        "2": { taskId: "st2" },
        "3": { taskId: "st3" },
        "4": { taskId: "st4" },
      },
    });
    expect(s.settings.closeRoute).toBe("card_only");
    expect(s.blueprint.taskId).toBe(A);
    expect(s.outbox["1"].id).toBe(uuid(13));
    const text = JSON.stringify(s);
    for (const secret of [
      "SECRET",
      "999",
      "budget_band",
      "onboarding_presented_at",
    ])
      expect(text).not.toContain(secret);
    expect(text).not.toContain("@");
    // A client success seat reads it too, without writing.
    const csm = await one<Row>(
      CSM_A,
      "SELECT public.cockpit_blueprint_sources($1) r",
      [A],
    );
    expect(csm.can).toEqual({ write: false, rehearse: false });
    // A card with no onboarding record and no kickoff says so.
    const beta = await one<Row>(
      CEO,
      "SELECT public.cockpit_blueprint_sources($1) r",
      [B],
    );
    expect(beta.deck.notes).toContain(
      "No kickoff on record: ask the service and the budget.",
    );
    expect(beta.creativeOnboarding).toBeNull();
    // A CSM entry that is an address never reaches the browser.
    expect(beta.kit.csm).toBe("Hana Example");
    expect(JSON.stringify(beta)).not.toContain("someone@x.invalid");
    const gamma = await one<Row>(
      CEO,
      "SELECT public.cockpit_blueprint_sources($1) r",
      [C],
    );
    expect(gamma.can.write).toBe(false);
    expect(gamma.blueprint).toBeNull();
    expect(gamma.outbox).toEqual({ "1": null, "2": null, "3": null });
    expect(
      await refused(CD_A, "SELECT public.cockpit_blueprint_sources($1) r", [B]),
    ).toContain("not on your access list");
  });
});

describe("a send still running, and what media last received", () => {
  test("a changed press waits while the last send of its part is running, and a claim over 10 minutes old does not block it", async () => {
    // uuid(13), the last Send to media, was claimed by the runner just now.
    await asOwner();
    await db.query(
      "UPDATE public.cockpit_creative_outbox SET state='sending' WHERE id=$1",
      [uuid(13)],
    );
    await db.query(
      "INSERT INTO public.cockpit_media_actions(id,actor_id,operation,request) VALUES($1,$2,'creativeClient.blueprintLaunch','{}'::jsonb)",
      [uuid(13), CD_A],
    );
    const cur = await owner<number>(
      "SELECT revision r FROM public.cockpit_blueprints WHERE task_id=$1",
      [A],
    );
    await save(
      CD_A,
      A,
      { red_lines: [...PART1.red_lines, "No competitor names"] },
      { base: cur },
    );
    const rows = await outboxRows();
    const audits = await partAudits();
    const all = await count("SELECT count(*) n FROM public.cockpit_audit_log");
    const presses = await owner<number>(
      "SELECT (parts->'1'->>'presses')::integer r FROM public.cockpit_blueprints WHERE task_id=$1",
      [A],
    );
    expect(await refused(CD_A, PRESS, [A, 1, uuid(50)])).toBe(
      "The last send of this part is still running. Wait for it to finish, then send the changes.",
    );
    expect(await outboxRows()).toBe(rows);
    expect(await partAudits()).toBe(audits);
    expect(await count("SELECT count(*) n FROM public.cockpit_audit_log")).toBe(
      all,
    );
    expect(
      await owner<number>(
        "SELECT (parts->'1'->>'presses')::integer r FROM public.cockpit_blueprints WHERE task_id=$1",
        [A],
      ),
    ).toBe(presses);
    // A run that crashed and stayed 'sending' does not hold the part for ever.
    await asOwner();
    await db.query(
      "UPDATE public.cockpit_media_actions SET created_at=now()-interval '11 minutes' WHERE id=$1",
      [uuid(13)],
    );
    expect(await press(CD_A, A, 1, uuid(50))).toMatchObject({
      id: uuid(50),
      state: "pending",
      presses: presses + 1,
    });
    expect(await outboxRows()).toBe(rows + 1);
  });

  test("a launch in reconcile is not what media received; a close in reconcile is, so its WhatsApp never repeats", async () => {
    const gate = JSON.stringify({ taskId: B, clientName: "Beta Build" });
    await asOwner();
    await db.query(
      `INSERT INTO public.cockpit_creative_outbox(id,client_name,kind,task_id,payload,actor_id,actor_email,state)
       VALUES($1,'Beta Build','blueprintLaunch',$3,'{"answers":{"service":"interior"}}'::jsonb,$4,'cd-all@tests.invalid','reconcile'),
             ($2,'Beta Build','blueprintClose',$3,'{"answers":{"camera":"no"}}'::jsonb,$4,'cd-all@tests.invalid','reconcile')`,
      [uuid(60), uuid(61), B, CD_ALL],
    );
    const payload = (part: number) =>
      owner<Row>(
        "SELECT public.cockpit_blueprint_payload($1::jsonb,$2,'{}'::jsonb,'{}'::jsonb) r",
        [gate, part],
      );
    expect((await payload(1)).previous).toBeNull();
    expect((await payload(2)).previous).toEqual({ camera: "no" });
    // The CSM entry that is an address is skipped for the first name.
    expect((await payload(2)).csmFirstName).toBe("Hana");
  });
});

describe("the browsers read what the server returns (SPEC 7.1)", () => {
  // A stand-in for supabase-js over this database: rpc(name, args) in named
  // notation, as PostgREST calls it, run as the seat; the real call
  // functions of the deck (client success) and the creative director's
  // cockpit then parse what comes back with their own schemas.
  const CAST: Record<string, string> = {
    p_task_ids: "text[]",
    p_changes: "jsonb",
    p_answers: "jsonb",
    p_base_revision: "integer",
    p_part: "integer",
    p_request_id: "uuid",
  };
  const client = (who: string) => ({
    rpc: async (name: string, args: Record<string, unknown> = {}) => {
      const keys = Object.keys(args);
      const sql = `SELECT public.${name}(${keys
        .map((k, i) => `${k} => $${i + 1}::${CAST[k] ?? "text"}`)
        .join(", ")}) r`;
      const params = keys.map(k =>
        CAST[k] === "jsonb" ? JSON.stringify(args[k]) : args[k],
      );
      await actor(db, who);
      try {
        return { data: (await db.query<{ r: unknown }>(sql, params)).rows[0].r, error: null };
      } catch (e) {
        const x = e as Error & { detail?: string; code?: string };
        return {
          data: null,
          error: { message: x.message, details: x.detail ?? null, code: x.code ?? null },
        };
      } finally {
        await asOwner();
      }
    },
    functions: {
      invoke: async () => ({ data: null, error: { message: "Not in this test" } }),
    },
    auth: {
      getUser: async () => ({ data: { user: { id: who } }, error: null }),
    },
  });

  test("the deck's calls: sources, save, a press (pending, again, duplicate), Still missing, and the CSM's line", async () => {
    const CS = await import(
      "../../client-success-cockpit/src/present/blueprintSources"
    );
    const { readBlueprintStatus } = await import(
      "../../client-success-cockpit/src/lib/blueprintStatus"
    );
    const cd = client(CD_A) as never;
    const src = await CS.readBlueprintSources(cd, A);
    const loaded = CS.loadedFromBlueprint(src);
    expect(loaded.sources?.clientName).toBe("Acme Interiors");
    expect(loaded.blueprint?.row?.taskId).toBe(A);
    expect(loaded.blueprint?.can).toMatchObject({ write: true });

    const saved = await CS.saveBlueprint(
      cd,
      A,
      { why_us: { value: "They measure twice (example)", seen: null } },
      S1,
      null,
    );
    expect(saved.applied).toEqual(["why_us"]);
    expect(saved.conflicts).toEqual([]);

    // A changed part 1 queues a row; the same ID again returns it; an
    // unchanged press with a new ID is the same send.
    await CS.saveBlueprint(
      cd,
      A,
      { destination: { value: "lead_form", seen: null } },
      S1,
      null,
    );
    const first = await CS.blueprintPartDone(cd, A, 1, uuid(80));
    expect(first).toMatchObject({ id: uuid(80), state: "pending", part: 1 });
    expect(await CS.blueprintPartDone(cd, A, 1, uuid(80))).toMatchObject({
      id: uuid(80),
      again: true,
    });
    expect(await CS.blueprintPartDone(cd, A, 1, uuid(81))).toMatchObject({
      id: uuid(80),
      duplicate: true,
    });

    // A card with nothing typed: the server's missing keys reach the deck.
    const all = client(CD_ALL) as never;
    const miss = await CS.blueprintPartDone(all, B, 1, uuid(82)).catch(e => e);
    expect(miss).toBeInstanceOf(CS.StillMissing);
    expect((miss as InstanceType<typeof CS.StillMissing>).keys).toContain(
      "service",
    );

    // The CSM's line reads the parts and the close switch.
    const status = await readBlueprintStatus(client(CSM_A) as never, A);
    expect(Object.keys(status.parts ?? {}).sort()).toEqual(["1", "2", "3"]);
    expect(status.closeRoute).toBe("card_only");
  });

  test("the creative director's calls: the read, a save, a press, the settings and a setting", async () => {
    const CD = await import("../../creative-director-cockpit/src/lib/blueprint");
    const cd = client(CD_A) as never;
    const read = await CD.readBlueprints(cd, [A, B]);
    expect(read.rows.map(r => r.taskId)).toEqual([A]);
    expect(read.rows[0].outbox?.["1"]?.id).toBe(uuid(80));

    const saved = await CD.saveBlueprint(cd, {
      taskId: A,
      changes: { scripts_status: { value: "with_editors", seen: null } },
      session: S1,
      baseRevision: null,
    });
    expect(saved.applied).toEqual(["scripts_status"]);

    // Nothing changed in part 1 since uuid(80): the press is the same send.
    const press = await CD.blueprintPartDone(cd, {
      taskId: A,
      part: 1,
      answers: read.rows[0].answers,
    });
    expect(press).toMatchObject({ id: uuid(80), duplicate: true });

    const missing = await CD.blueprintPartDone(client(CD_ALL) as never, {
      taskId: B,
      part: 1,
      answers: {},
    }).catch(e => e);
    expect(missing).toBeInstanceOf(CD.BlueprintError);
    expect((missing as InstanceType<typeof CD.BlueprintError>).missing).toContain(
      "service",
    );

    const settings = await CD.readBlueprintSettings(cd);
    expect(settings.closeRoute).toBe("card_only");
    expect(settings.can).toEqual({ packs: true, closeRoute: false });
    const after = await CD.setBlueprintSetting(
      cd,
      "pack.fitout",
      "https://drive.google.com/drive/folders/1ExamplePackFitout0001",
    );
    expect(after.packs?.fitout).toBe(
      "https://drive.google.com/drive/folders/1ExamplePackFitout0001",
    );
  });
});

describe("applying again", () => {
  test("keeps every row, the settings and every grant", async () => {
    const before = [
      await count("SELECT count(*) n FROM public.cockpit_blueprints"),
      await count("SELECT count(*) n FROM public.cockpit_blueprint_settings"),
    ];
    await asOwner();
    await db.exec(migration(FILE));
    expect([
      await count("SELECT count(*) n FROM public.cockpit_blueprints"),
      await count("SELECT count(*) n FROM public.cockpit_blueprint_settings"),
    ]).toEqual(before);
    expect(
      await owner(
        "SELECT has_table_privilege('authenticated','public.cockpit_blueprints','SELECT') r",
      ),
    ).toBe(false);
    expect(
      await owner(
        "SELECT value r FROM public.cockpit_blueprint_settings WHERE key='close_route'",
      ),
    ).toBe("card_only");
    expect(
      (
        await one<Row>(
          CD_A,
          "SELECT public.cockpit_blueprint_read($1::text[]) r",
          [[A]],
        )
      ).rows.length,
    ).toBe(1);
  });
});
