// OFFLINE TEST ONLY: synthetic database on a private Unix socket. Never connect to production.
import {SQL} from "bun";
import {readFileSync} from "node:fs";
const base=process.env.COCKPIT_REPO_ROOT!;
if (!process.env.SYNTHETIC_PG_SOCKET_DIR?.startsWith('/private/tmp/') || !process.env.COCKPIT_REPO_ROOT) throw Error('Synthetic socket and repository root required');
const options={path:process.env.SYNTHETIC_PG_SOCKET_DIR!,username:"sandbox_test",database:"requests_probe",max:1};
const admin=new SQL({...options,database:"postgres"}); await admin.unsafe("DROP DATABASE IF EXISTS requests_probe");await admin.unsafe("CREATE DATABASE requests_probe");await admin.close();
function makeDb(){const c=new SQL(options);return {exec:async (s:string)=>await c.unsafe(s).simple(),query:async(s:string,p:any[]=[])=>({rows:await c.unsafe(s,p.map(x=>Array.isArray(x) ? "{"+x.map(y=>"\""+String(y).replaceAll("\\","\\\\").replaceAll("\"","\\\"")+"\"").join(",")+"}" : x))}),close:async()=>await c.close()}}
function migration(name:string){if (!/^[a-zA-Z0-9_]+\.sql$/.test(name)) throw new Error("invalid"); return readFileSync(base+"/supabase/migrations/"+name,"utf8").replace(/\r\n/g,"\n")}
function cut(sql:string,pattern:RegExp,what:string){const m=sql.match(pattern);if(!m)throw new Error("Missing "+what);return m[0]}
let db:any;
const R = "20261026r_requests.sql";
const S = "20261026s_request_types_seed.sql";
const WB = "20261009f_clickup_writeback_native.sql";

// Seats.
const CEO = "00000000-0000-4000-8000-0000000000c3"; // the CEO's address, no roles
const SM = "00000000-0000-4000-8000-0000000000d1"; // admin seat, the systems manager
const CSM = "00000000-0000-4000-8000-0000000000a1"; // csm, every client
const CSM_B = "00000000-0000-4000-8000-0000000000a2"; // csm, Beta Build only, no people row
const CALL = "00000000-0000-4000-8000-0000000000b1"; // call centre, Acme Interiors only
const SALES = "00000000-0000-4000-8000-0000000000b2"; // sales
const CREATIVE = "00000000-0000-4000-8000-0000000000e1"; // creative, the creative strategist
const BUYER = "00000000-0000-4000-8000-0000000000f1"; // media buyer
const VIDEO = "00000000-0000-4000-8000-0000000000f2"; // video editor, given the editor right by a row
const PLAIN = "00000000-0000-4000-8000-0000000000f3"; // video editor, no right
const GONE = "00000000-0000-4000-8000-0000000000f4"; // csm, deactivated

// ClickUp users. The seed names the systems manager, the creative strategist
// and the CSM by id; the rest are invented.
const CU_SM = 113459516;
const CU_CS = 113520400;
const CU_CSM = 113688800;
const CU_BUYER = 900000004;
const CU_VIDEO = 900000005;
const CU_CEO = 900000006;
const CU_CALL = 900000007;
const CU_TWIN_A = 900000008; // two members share the sales seat's address
const CU_TWIN_B = 900000009;
const CU_OTHER = 900000010; // a member with no seat

// Client cards.
const ACME = "taskacme1";
const BETA = "taskbeta1";
const GAMMA = "taskgamma1"; // Stopped
const TEST_CARD = "synthetic_test_card";

// ClickUp options the seed carries.
const OPT_TIKTOK = "c115bdfe-661f-4855-a86b-69a54b2e616a";
const OPT_ADS_ISSUE = "a2343b36-5d92-428d-9f73-ce47711480c2";
const OPT_BOTH = "0014e47b-560a-4109-830c-77d6d60d985c";
const OPT_CALL_ISSUE = "cf9d1709-8d52-489b-9600-21e6a0d6ac12";

function definition(sql: string, pattern: RegExp): string {
  const hit = sql.match(pattern);
  if (!hit) throw new Error(`Canonical definition missing: ${pattern}`);
  return hit[0];
}

/**
 * An isolated PostgreSQL engine. No connection URL or live credentials accepted.
 * `supabaseDefaultPrivileges` (opt-in) emulates Supabase's default privileges:
 * every new table, sequence and function in public is granted to anon,
 * authenticated and service_role, so a migration that forgets a REVOKE fails
 * its tests the way it would open the object in production.
 */
async function cockpitTestDb(opts: { supabaseDefaultPrivileges?: boolean } = {}): Promise<any> {
  const db = makeDb();
  try {
    await db.exec(`
      DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF; IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF; IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF; END $$; ALTER ROLE service_role BYPASSRLS;
      CREATE SCHEMA auth;
      GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;`);
    if (opts.supabaseDefaultPrivileges) await db.exec(`
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;`);
    await db.exec(`
      CREATE TABLE auth.users (id uuid PRIMARY KEY, email text, email_confirmed_at timestamptz);
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
        $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS
        $$ SELECT coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb) $$;
    `);
    const base = migration("20260922a_cockpit_identity_audit_issue_reports.sql");
    for (const pattern of [
      /CREATE TABLE IF NOT EXISTS public\.cockpit_members \([\s\S]*?\n\);/,
      /CREATE TABLE IF NOT EXISTS public\.cockpit_audit_log \([\s\S]*?\n\);/,
      /CREATE OR REPLACE FUNCTION public\.cockpit_audit_log_immutable\(\)[\s\S]*?\$\$;/,
      /DROP TRIGGER IF EXISTS trg_cockpit_audit_log_immutable[\s\S]*?EXECUTE FUNCTION public\.cockpit_audit_log_immutable\(\);/,
    ]) await db.exec(definition(base, pattern));
    await db.exec(`ALTER TABLE public.cockpit_members ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.cockpit_audit_log ENABLE ROW LEVEL SECURITY;
      REVOKE ALL ON public.cockpit_members, public.cockpit_audit_log FROM anon, authenticated;`);
    await db.exec(migration("20260923m_cockpit_ceo_gate.sql"));
    return db;
  } catch (error) {
    await db.close();
    throw error;
  }
}

async function member(db: any, id: string, email: string, roles: string[], active = true, confirmed = true) {
  await db.exec("RESET ROLE");
  await db.query("INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,$2,$3)",
    [id, email, confirmed ? "2026-09-01T00:00:00Z" : null]);
  await db.query("INSERT INTO public.cockpit_members(auth_user_id,email,roles,active) VALUES($1,$2,$3,$4)",
    [id, email.toLowerCase().trim(), roles, active]);
}

async function bootstrap() {
  db = await cockpitTestDb({ supabaseDefaultPrivileges: true });

  // The sync state (with its detail column), the people list (with schedules),
  // the onboarding mirror and the Blueprint settings.
  await db.exec(
    cut(
      migration("20260921e_tap_charges.sql"),
      /create table if not exists public\.cockpit_sync_state \([\s\S]*?\n\);/,
      "cockpit_sync_state",
    ),
  );
  await db.exec(
    cut(
      migration("20261011c_csm_call_store.sql"),
      /ALTER TABLE public\.cockpit_sync_state ADD COLUMN IF NOT EXISTS detail jsonb;/,
      "detail",
    ),
  );
  await db.exec(
    cut(
      migration("20260919b_people.sql"),
      /create table if not exists public\.cockpit_people \([\s\S]*?\n\);/,
      "cockpit_people",
    ),
  );
  await db.exec(
    cut(
      migration("20260921b_people_schedule.sql"),
      /alter table public\.cockpit_people\s+add column if not exists schedule jsonb;/,
      "schedule",
    ),
  );
  await db.exec(
    cut(
      migration("20261005a_client_onboarding.sql"),
      /create table if not exists public\.cockpit_client_onboarding \([\s\S]*?\n\);/,
      "cockpit_client_onboarding",
    ),
  );
  await db.exec(
    cut(
      migration("20261024a_brand_blueprints.sql"),
      /CREATE TABLE IF NOT EXISTS public\.cockpit_blueprint_settings \([\s\S]*?\n\);/,
      "cockpit_blueprint_settings",
    ),
  );

  // The writeback queue as it is live.
  const wb = migration(WB);
  for (const [pattern, what] of [
    [
      /CREATE TABLE IF NOT EXISTS public\.cockpit_clickup_writeback_config\([\s\S]*?\n\);/,
      "config",
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
      /DROP TRIGGER IF EXISTS cockpit_clickup_writeback_runs_audit[\s\S]*?EXECUTE FUNCTION public\.cockpit_clickup_writeback_audit\(\);/,
      "runs trigger",
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
    await db.exec(cut(wb, pattern, what));
  await db.exec(
    cut(
      migration("20261009j_billing_clickup_writeback.sql"),
      /ALTER TABLE public\.cockpit_clickup_writeback_queue DROP CONSTRAINT IF EXISTS cockpit_clickup_writeback_queue_kind_check;\nALTER TABLE[\s\S]*?\)\);/,
      "billing kind",
    ),
  );
  // The two sources the live claim looks up (stand-ins: the id is all it reads).
  await db.exec(`
    CREATE TABLE public.cockpit_decisions (id bigint PRIMARY KEY);
    CREATE TABLE public.cockpit_media_native_records (id uuid PRIMARY KEY);
    REVOKE ALL ON public.cockpit_decisions, public.cockpit_media_native_records FROM anon, authenticated;`);
  await db.exec(`
    ALTER TABLE public.cockpit_clickup_writeback_queue ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.cockpit_clickup_writeback_runs ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.cockpit_clickup_writeback_config ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON public.cockpit_clickup_writeback_config, public.cockpit_clickup_writeback_queue, public.cockpit_clickup_writeback_runs
      FROM PUBLIC, anon, authenticated, service_role;
    GRANT SELECT, INSERT, UPDATE ON public.cockpit_clickup_writeback_config, public.cockpit_clickup_writeback_queue,
      public.cockpit_clickup_writeback_runs TO service_role;
    GRANT SELECT, INSERT, UPDATE ON public.cockpit_sync_state TO service_role;
    REVOKE ALL ON FUNCTION public.cockpit_clickup_writeback_audit(), public.cockpit_clickup_writeback_state(text,boolean,text,integer)
      FROM PUBLIC, anon, authenticated, service_role;
    REVOKE ALL ON FUNCTION public.cockpit_clickup_writeback_claim(uuid,integer), public.cockpit_clickup_writeback_save(uuid,uuid,jsonb),
      public.cockpit_clickup_writeback_begin(text,text,boolean), public.cockpit_clickup_writeback_finish(uuid,boolean,text,jsonb,jsonb),
      public.cockpit_clickup_writeback_idle(text,boolean,text) FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.cockpit_clickup_writeback_claim(uuid,integer), public.cockpit_clickup_writeback_save(uuid,uuid,jsonb),
      public.cockpit_clickup_writeback_begin(text,text,boolean), public.cockpit_clickup_writeback_finish(uuid,boolean,text,jsonb,jsonb),
      public.cockpit_clickup_writeback_idle(text,boolean,text) TO service_role;`);

  // The client gate, and the editor gate with its labels (Stage 1).
  const teamOnly = migration("20261017b_team_only_seats.sql");
  await db.exec(
    cut(
      teamOnly,
      /CREATE OR REPLACE FUNCTION public\.cockpit_is_team_only\(\)[\s\S]*?\$\$;/,
      "cockpit_is_team_only",
    ),
  );
  await db.exec(
    cut(
      teamOnly,
      /CREATE OR REPLACE FUNCTION public\.cockpit_client_allowed\(p_name text\)[\s\S]*?END \$function\$;/,
      "cockpit_client_allowed",
    ),
  );
  const stage1 = migration("20261025n_slack_notices.sql");
  for (const [pattern, what] of [
    [
      /CREATE TABLE IF NOT EXISTS public\.cockpit_forms_editors \([\s\S]*?\n\);/,
      "cockpit_forms_editors",
    ],
    [
      /CREATE OR REPLACE FUNCTION public\.cockpit_slack_notice_role_of\(p_email text\)[\s\S]*?END \$\$;/,
      "role_of",
    ],
    [
      /CREATE OR REPLACE FUNCTION public\.cockpit_slack_notice_seat_label\(p_email text, p_name text\)[\s\S]*?END \$\$;/,
      "seat_label",
    ],
    [
      /CREATE OR REPLACE FUNCTION public\.cockpit_forms_editor_gate\(\)[\s\S]*?END \$\$;/,
      "editor gate",
    ],
  ] as const)
    await db.exec(cut(stage1, pattern, what));
  await db.exec(`
    ALTER TABLE public.cockpit_forms_editors ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON public.cockpit_sync_state, public.cockpit_people, public.cockpit_client_onboarding, public.cockpit_blueprint_settings,
      public.cockpit_forms_editors FROM anon, authenticated;
    REVOKE ALL ON FUNCTION public.cockpit_is_team_only(), public.cockpit_client_allowed(text), public.cockpit_slack_notice_role_of(text),
      public.cockpit_slack_notice_seat_label(text,text), public.cockpit_forms_editor_gate() FROM PUBLIC, anon, authenticated, service_role;
    GRANT EXECUTE ON FUNCTION public.cockpit_client_allowed(text) TO authenticated, service_role;`);

  // Seats.
  await member(db, CEO, "ceo@tests.invalid", []);
  await member(db, SM, "sm@tests.invalid", ["admin"]);
  await member(db, CSM, "csm@tests.invalid", ["csm"]);
  await member(db, CSM_B, "csm-b@tests.invalid", ["csm"]);
  await member(db, CALL, "call@tests.invalid", ["call_center"]);
  await member(db, SALES, "sales@tests.invalid", ["sales"]);
  await member(db, CREATIVE, "creative@tests.invalid", ["creative"]);
  await member(db, BUYER, "buyer@tests.invalid", ["media_buyer"]);
  await member(db, VIDEO, "video@tests.invalid", ["editor"]);
  await member(db, PLAIN, "plain@tests.invalid", ["editor"]);
  await member(db, GONE, "gone@tests.invalid", ["csm"], false);
  await db.query(
    "UPDATE public.cockpit_members SET clients=$1 WHERE auth_user_id=$2",
    [["Acme Interiors"], CALL],
  );
  await db.query(
    "UPDATE public.cockpit_members SET clients=$1 WHERE auth_user_id=$2",
    [["Beta Build"], CSM_B],
  );
  await db.query(
    "UPDATE public.cockpit_members SET name='Mona Video' WHERE auth_user_id=$1",
    [VIDEO],
  );
  await db.query(
    "INSERT INTO public.cockpit_forms_editors(member_id, added_by) SELECT id, 'ceo@tests.invalid' FROM public.cockpit_members WHERE auth_user_id=$1",
    [VIDEO],
  );

  // People, by role.
  for (const [name, email, role] of [
    ["Huda Manager", "sm@tests.invalid", "Systems manager"],
    ["Omar Strategist", "creative@tests.invalid", "Creative strategist"],
    ["Noura Success", "csm@tests.invalid", "Client success manager"],
    ["Bilal Buyer", "buyer@tests.invalid", "Media buyer"],
    ["Mona Video", "video@tests.invalid", "Video editor"],
    ["Aziz W", "ceo@tests.invalid", "CEO"],
    ["Rana Caller", "call@tests.invalid", "Call centre agent"],
  ] as const)
    await db.query(
      "INSERT INTO public.cockpit_people(name,email,role,active,added_by) VALUES($1,$2,$3,true,'test')",
      [name, email, role],
    );

  // Client cards.
  for (const [task, name, status, csm] of [
    [ACME, "Acme Interiors", "Active", "Noura Success"],
    [BETA, "Beta Build", "Active", "Somebody Unknown"],
    [GAMMA, "Gamma Design", "Stopped", null],
    [TEST_CARD, "Mahara Test Card", "Active", null],
    ["taskdelta1", "Delta Homes", "GHOSTED", null],
  ] as const)
    await db.query(
      "INSERT INTO public.cockpit_client_onboarding(clickup_task_id, client_name, client_status, csm) VALUES($1,$2,$3,$4)",
      [task, name, status, csm],
    );

  // Applied twice: the second run changes nothing and raises nothing.
  await db.exec(migration(R));
  await db.exec(migration(S));
  await db.exec(migration(R));
  await db.exec(migration(S));
}

await bootstrap(); console.log("synthetic request fixture ready"); await db.close();
