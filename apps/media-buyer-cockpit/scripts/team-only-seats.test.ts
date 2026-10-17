/**
 * Team-only seats (20261017b_team_only_seats.sql, contract
 * docs/access/TEAM-ONLY-SEATS.md) on an isolated PostgreSQL.
 *
 * It stands on the real seat directory (cockpitIdentityTestDb: members,
 * audit, the editor desk's editor_people), the Admin save and the access
 * answer (20260923n, 20261007b), the whole native Team meetings chain
 * (20260922b to 20261011a), client billing (20260923a with the seat policies
 * of 20260924r) and the client rule (20260926m). The social tables carry the
 * live read policies of 20261009e on a cut-down table. The board's row
 * builder and Meta status are small stand-ins: the board's own suite
 * (board-api-supabase.test.ts) checks its numbers; this one checks who sees
 * which rows. Every person, client and meeting is invented.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import { cockpitIdentityTestDb } from "./lib/cockpitIdentityTestDb";
import { actor, member, migration } from "./lib/cockpitTestDb";

const FILE = "20261017b_team_only_seats.sql";

const CEO = "00000000-0000-4000-8000-0000000000c1";
const ADMIN = "00000000-0000-4000-8000-0000000000a1";
const AGENT = "00000000-0000-4000-8000-0000000000e1";
const AGENT_NONE = "00000000-0000-4000-8000-0000000000e2";
const EDITOR = "00000000-0000-4000-8000-0000000000e3";
const BUYER = "00000000-0000-4000-8000-0000000000b1";
const CSM_ALL = "00000000-0000-4000-8000-0000000000c2";
const MIXED = "00000000-0000-4000-8000-0000000000e4";
const CEO_AGENT = "00000000-0000-4000-8000-0000000000e5";
const AGENT_GONE = "00000000-0000-4000-8000-0000000000e6";
const HOST = "00000000-0000-4000-8000-0000000000f1";

const TEAM_CHAIN = [
  "20260922b_team_meetings.sql",
  "20260923d_team_meetings_screen.sql",
  "20260927d_team_meetings_v5.sql",
  "20260927e_team_meeting_series.sql",
  "20260927x_team_meetings_access.sql",
  "20260930a_team_docs_links.sql",
  "20261004b_team_native_security.sql",
  "20261004c_team_pictures.sql",
  "20261004d_team_native_commands.sql",
  "20261007d_cockpit_team_rpc_restore.sql",
  "20261007g_cockpit_team_role_guard.sql",
  "20261011a_team_access_restore.sql",
];

const today = new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
const daysAgo = (n: number) => new Date(Date.parse(`${today}T12:00:00Z`) - n * 86400_000).toISOString().slice(0, 10);

let db: PGlite;
type Row = Record<string, any>;

function cut(sql: string, pattern: RegExp): string {
  const hit = sql.match(pattern);
  if (!hit) throw new Error(`Canonical definition missing: ${pattern}`);
  return hit[0];
}

/** Back to the owner with no request claims, so fixture writes are the trusted worker's. */
async function asOwner() {
  await db.exec("RESET ROLE");
  await db.query("SELECT set_config('request.jwt.claim.sub','',false)");
  await db.query("SELECT set_config('request.jwt.claims','',false)");
}
async function rows<T = Row>(who: string | null, text: string, params: unknown[] = []): Promise<T[]> {
  await actor(db, who);
  try {
    return (await db.query<T>(text, params)).rows;
  } finally {
    await asOwner();
  }
}
async function one<T = any>(who: string | null, text: string, params: unknown[] = []): Promise<T> {
  return (await rows<{ r: T }>(who, text, params))[0].r;
}
/** The caller's claims without the authenticated role: runs a function that is not granted to it, as its definer would. */
async function asClaims<T = any>(who: string, text: string, params: unknown[] = []): Promise<T> {
  await actor(db, who);
  await db.exec("RESET ROLE");
  try {
    return (await db.query<{ r: T }>(text, params)).rows[0].r;
  } finally {
    await asOwner();
  }
}
async function refusedAsClaims(who: string, text: string, params: unknown[] = []): Promise<string> {
  try {
    await asClaims(who, text, params);
  } catch (e) {
    return (e as Error).message;
  }
  throw new Error(`Expected a refusal for ${text}`);
}
async function refused(who: string | null, text: string, params: unknown[] = []): Promise<string> {
  await actor(db, who);
  try {
    await db.query(text, params);
  } catch (e) {
    await asOwner();
    return (e as Error).message;
  }
  await asOwner();
  throw new Error(`Expected a refusal for ${text}`);
}
const ids = async (who: string, sql: string) => (await rows<{ id: string }>(who, sql)).map(r => String(r.id)).sort();

beforeAll(async () => {
  db = await cockpitIdentityTestDb();
  await db.exec(`
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT auth.jwt()->>'role' $$;
    CREATE SCHEMA storage;
    CREATE TABLE storage.buckets(id text PRIMARY KEY, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text, name text, owner uuid, metadata jsonb);
    ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
    GRANT USAGE ON SCHEMA storage TO authenticated;
    GRANT SELECT, INSERT ON storage.objects TO authenticated;
    -- The live review-videos upload rule before this change: any signed-in user.
    CREATE POLICY "editors upload review media" ON storage.objects FOR INSERT TO authenticated
      WITH CHECK (bucket_id = 'review-videos');`);
  // The Admin save and remove (20260923n), then the access answer as live (20261007b).
  await db.exec(migration("20260923n_cockpit_identity_management.sql"));
  await db.exec(migration("20261007b_cockpit_auth_contract.sql"));
  await db.exec(cut(migration("20260926m_cockpit_csm_state.sql"),
    /CREATE OR REPLACE FUNCTION public\.cockpit_client_allowed\(p_name text\)[\s\S]*?END \$\$;/));
  await db.exec(`REVOKE ALL ON FUNCTION public.cockpit_client_allowed(text) FROM PUBLIC, anon;
    GRANT EXECUTE ON FUNCTION public.cockpit_client_allowed(text) TO authenticated, service_role;`);
  for (const file of TEAM_CHAIN) await db.exec(migration(file));
  // Client billing with the seat policies (sections 1 to 3 of 20260924r).
  await db.exec(migration("20260923a_client_billing.sql"));
  await db.exec(cut(migration("20260924r_billing_and_comms_access.sql"), /-- 1\. Cockpit Billing Accounts[\s\S]*?(?=-- 4\. WhatsApp)/));
  // The live billing policies (20261009h closed the browser writes).
  await db.exec("DROP POLICY IF EXISTS cockpit_billing_accounts_write ON public.cockpit_billing_accounts;");
  // The social calendar: cut-down tables under the live read policies of 20261009e.
  await db.exec(`
    CREATE TABLE public.social_posts(id bigint PRIMARY KEY, client text);
    CREATE TABLE public.social_clients(id bigint PRIMARY KEY, name text);
    CREATE TABLE public.social_worker_status(id bigint PRIMARY KEY, ok boolean);
    ALTER TABLE public.social_posts ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.social_clients ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.social_worker_status ENABLE ROW LEVEL SECURITY;
    GRANT SELECT ON public.social_posts, public.social_clients, public.social_worker_status TO authenticated;
    CREATE POLICY social_posts_read ON public.social_posts FOR SELECT TO authenticated USING (public.cockpit_has_active_seat() OR public.cockpit_is_ceo());
    CREATE POLICY social_clients_read ON public.social_clients FOR SELECT TO authenticated USING (public.cockpit_has_active_seat() OR public.cockpit_is_ceo());
    CREATE POLICY social_worker_status_seat ON public.social_worker_status FOR SELECT TO authenticated USING (public.cockpit_has_active_seat() OR public.cockpit_is_ceo());`);
  // The board's stand-ins: its client list, an ad account on no client, and
  // a row builder that lists the Active clients.
  await db.exec(`
    CREATE TABLE public.cockpit_board_clients(location_id text PRIMARY KEY, client_name text, status text, ad_account_ids text[], clickup_id text);
    CREATE TABLE public.cockpit_meta_ad_days(account_id text, account_name text, account_timezone text, day date, spend numeric, spend_usd numeric);
    CREATE TABLE public.cockpit_board_account_ties(account_id text, location_id text, kept_out boolean);
    CREATE TABLE public.cockpit_sync_state(key text PRIMARY KEY, last_run_at timestamptz, last_ok_at timestamptz, ok boolean, note text);
    CREATE FUNCTION public.cockpit_board_check_window(p_from date, p_to date) RETURNS void LANGUAGE sql AS $$ SELECT $$;
    CREATE FUNCTION public.cockpit_meta_ad_days_now() RETURNS timestamptz LANGUAGE sql AS $$ SELECT now() $$;
    CREATE FUNCTION public.cockpit_meta_ad_days_status() RETURNS jsonb LANGUAGE sql AS $$
      SELECT jsonb_build_object('store', jsonb_build_object('rows', 1, 'lastFetchedAt', now()),
        'notLinked', jsonb_build_array(jsonb_build_object('accountId', '999', 'name', 'Gamma spare account')),
        'jobs', jsonb_build_object('hourly', jsonb_build_object('state', 'failed', 'startedAt', now(), 'note', 'Gamma spare account failed')),
        'budgets', jsonb_build_object('newestFetchedAt', now())) $$;
    CREATE FUNCTION public.cockpit_board_rows(p_from date, p_to date, p_location text, p_meta jsonb) RETURNS jsonb LANGUAGE sql AS $$
      SELECT coalesce(jsonb_agg(jsonb_build_object('clientName', client_name, 'locationId', location_id) ORDER BY client_name), '[]'::jsonb)
      FROM public.cockpit_board_clients WHERE status = 'Active' AND (p_location IS NULL OR location_id = p_location) $$;
    CREATE FUNCTION public.cockpit_board_targets_map(p_clickup text) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;
    CREATE FUNCTION public.cockpit_board_default_targets() RETURNS TABLE(metric text, label text, value_key text, unit text)
      LANGUAGE sql AS $$ SELECT NULL::text, NULL::text, NULL::text, NULL::text WHERE false $$;
    CREATE FUNCTION public.cockpit_board_fmt(p_value numeric, p_unit text) RETURNS text LANGUAGE sql AS $$ SELECT p_value::text $$;
    -- Stand-ins for the live board_read and lever_context the migration replaces.
    CREATE FUNCTION public.cockpit_board_read(p_from date, p_to date) RETURNS jsonb LANGUAGE sql AS $$ SELECT NULL::jsonb $$;
    CREATE FUNCTION public.cockpit_board_lever_context(p_args jsonb) RETURNS jsonb LANGUAGE sql AS $$ SELECT NULL::jsonb $$;
    GRANT EXECUTE ON FUNCTION public.cockpit_board_read(date, date), public.cockpit_board_lever_context(jsonb) TO authenticated;`);
  // Client success projections in a meeting (20260927g's embed column, the
  // scope rule of 20260927v, the two tables and the three doors of 20261004a).
  // Their door, cockpit_csm_projection_actor, comes from the migration: the
  // live one let any participant in.
  await db.exec(cut(migration("20260927g_renewals_projections_meeting.sql"),
    /alter table public\.team_meetings add column if not exists embed text;[\s\S]*?check \(embed is null or embed in \('cs-projections', 'cs-daily'\)\);/));
  await db.exec(cut(migration("20260927v_csm_read_models.sql"), /CREATE OR REPLACE FUNCTION public\.cockpit_csm_scope_all\(\)[\s\S]*?\$\$;/));
  const projections = migration("20261004a_csm_churn_projections.sql");
  await db.exec(cut(projections, /CREATE TABLE IF NOT EXISTS public\.cockpit_csm_projections[\s\S]*?\n\);\nCREATE TABLE IF NOT EXISTS public\.cockpit_csm_renewal_plans[\s\S]*?\n\);/));
  for (const fn of ["read", "edit", "booking_context"])
    await db.exec(cut(projections, new RegExp(`CREATE OR REPLACE FUNCTION public\\.cockpit_csm_projection_${fn}\\([\\s\\S]*?END \\$\\$;`)));
  await db.exec(`REVOKE ALL ON FUNCTION public.cockpit_csm_projection_read(text,text), public.cockpit_csm_projection_edit(jsonb,text),
      public.cockpit_csm_projection_booking_context(text,text) FROM PUBLIC, anon;
    GRANT EXECUTE ON FUNCTION public.cockpit_csm_projection_read(text,text), public.cockpit_csm_projection_edit(jsonb,text),
      public.cockpit_csm_projection_booking_context(text,text) TO authenticated;`);

  // Seats.
  await member(db, CEO, "aziz@maharamedia.com", []);
  await member(db, ADMIN, "admin@tests.invalid", ["admin"]);
  await member(db, AGENT, "agent@tests.invalid", ["call_center"]);
  await member(db, AGENT_NONE, "agent2@tests.invalid", ["call_center"]);
  await member(db, EDITOR, "editor@tests.invalid", ["editor"]);
  await member(db, BUYER, "buyer@tests.invalid", ["media_buyer"]);
  await member(db, CSM_ALL, "csm@tests.invalid", ["csm"]);
  await member(db, MIXED, "mixed@tests.invalid", ["call_center", "admin"]);
  await member(db, CEO_AGENT, "awaheedi2008@gmail.com", ["call_center"]);
  await member(db, AGENT_GONE, "agent3@tests.invalid", ["call_center"]);
  await member(db, HOST, "host@tests.invalid", ["csm"]);
  await asOwner();
  // The team migrations seed the real meetings; this test brings its own.
  await db.exec(`TRUNCATE public.team_wheel_spins, public.team_wheel_options, public.team_wheels, public.team_changes,
    public.team_creative_rows, public.team_calendar_ops, public.team_meeting_series, public.team_recordings,
    public.team_meeting_blocks, public.team_agenda, public.team_sittings, public.team_meeting_people,
    public.team_meetings, public.team_people CASCADE;`);
  await db.exec(`
    UPDATE public.cockpit_members SET clients = ARRAY['Alpha'] WHERE email IN ('agent@tests.invalid', 'buyer@tests.invalid', 'agent3@tests.invalid');

    INSERT INTO public.team_people(id, name, email, active) VALUES
      ('agent', 'Agent One', 'agent@tests.invalid', true),
      ('agent2', 'Agent Two', 'agent2@tests.invalid', true),
      ('editor', 'Editor One', 'editor@tests.invalid', true),
      ('host', 'Host One', 'host@tests.invalid', true),
      ('agent3', 'Agent Three', 'agent3@tests.invalid', false),
      ('newbie', 'New Starter', NULL, true);
    INSERT INTO public.team_meetings(id, title, purpose, cadence, active, managed, pipeline) VALUES
      ('call-center', 'Call Center', 'The call center''s week', 'weekly', true, 'cockpit', NULL),
      ('whole-team', 'Whole Team', 'The whole team''s month', 'monthly', true, 'cockpit', 'strip'),
      ('creative-call', 'Creative Call', 'The creative pipeline', 'weekly', true, 'cockpit', 'board'),
      ('leadership', 'Leadership', 'The leads'' week', 'weekly', true, 'cockpit', NULL),
      ('old-call', 'Old call', 'A call the agent left', 'weekly', true, 'cockpit', NULL);
    INSERT INTO public.team_meetings(id, title, purpose, cadence, active, managed, pipeline, embed) VALUES
      ('csm-daily', 'CSM Daily', 'The client success day', 'daily', true, 'cockpit', NULL, 'cs-daily'),
      ('renewals-resell-projections', 'Renewals & Re-sell Projections', 'The week''s renewals', 'weekly', true, 'cockpit', NULL, 'cs-projections');
    INSERT INTO public.team_meeting_people(meeting_id, person_id, part, source, removed) VALUES
      ('call-center', 'host', 'host', 'cockpit', false),
      ('call-center', 'agent', 'required', 'cockpit', false),
      ('whole-team', 'host', 'host', 'cockpit', false),
      ('whole-team', 'agent', 'required', 'cockpit', false),
      ('whole-team', 'editor', 'required', 'cockpit', false),
      ('creative-call', 'editor', 'host', 'cockpit', false),
      ('leadership', 'host', 'host', 'cockpit', false),
      ('old-call', 'host', 'host', 'cockpit', false),
      ('old-call', 'agent', 'required', 'cockpit', true),
      ('call-center', 'agent3', 'required', 'cockpit', false),
      ('csm-daily', 'host', 'host', 'cockpit', false),
      ('csm-daily', 'agent', 'required', 'cockpit', false),
      ('renewals-resell-projections', 'host', 'host', 'cockpit', false),
      ('renewals-resell-projections', 'agent', 'required', 'cockpit', false);
    INSERT INTO public.team_sittings(id, meeting_id, on_date, held) VALUES
      ('call-center:${daysAgo(1)}', 'call-center', '${daysAgo(1)}', true),
      ('leadership:${daysAgo(1)}', 'leadership', '${daysAgo(1)}', true);
    INSERT INTO public.team_agenda(meeting_id, text, status, position) VALUES
      ('call-center', 'Speed to lead', 'open', 1),
      ('leadership', 'Hiring', 'open', 1);
    INSERT INTO public.team_meeting_blocks(meeting_id, position, title) VALUES
      ('call-center', 1, 'Numbers'), ('leadership', 1, 'Plans');
    INSERT INTO public.team_wheels(id, meeting_id, name, kind, locked_until_goal, active, position) VALUES
      ('wheel-cc', 'call-center', 'Who opens', 'scenario', false, true, 1),
      ('wheel-lead', 'leadership', 'Who opens', 'scenario', false, true, 1),
      ('wheel-prize', NULL, 'Prize', 'prize', false, true, 1);
    INSERT INTO public.team_wheel_options(wheel_id, label, active, position) VALUES
      ('wheel-cc', 'Agent One', true, 1), ('wheel-lead', 'Host One', true, 1), ('wheel-prize', 'Lunch', true, 1);
    INSERT INTO public.team_wheel_spins(wheel_id, result_label) VALUES
      ('wheel-cc', 'Agent One'), ('wheel-lead', 'Host One'), ('wheel-prize', 'Lunch');
    INSERT INTO public.team_meeting_series(meeting_id, cal_calendar, cal_event_id) VALUES
      ('call-center', 'host@tests.invalid', 'evt-cc'), ('leadership', 'host@tests.invalid', 'evt-lead');
    INSERT INTO public.team_calendar_ops(meeting_id, op, status) VALUES
      ('call-center', 'create', 'done'), ('leadership', 'create', 'done');
    INSERT INTO public.team_recordings(recording_id, title, invitee_emails) VALUES
      ('rec-cc', 'Call Center', '["agent@tests.invalid","host@tests.invalid"]'::jsonb),
      ('rec-lead', 'Leadership', '["host@tests.invalid"]'::jsonb);
    INSERT INTO public.team_creative_rows(client, status) VALUES ('Alpha', 'scripting'), ('Beta', 'editing');

    INSERT INTO storage.objects(bucket_id, name) VALUES
      ('team-docs', 'call-center/2026-10/0123456789abcdef.png'),
      ('team-docs', 'leadership/2026-10/fedcba9876543210.png');

    INSERT INTO public.cockpit_billing_accounts(clickup_task_id, client_name, mrr_usd) VALUES ('task-alpha', 'Alpha', 1000);
    INSERT INTO public.social_posts VALUES (1, 'Alpha');
    INSERT INTO public.social_clients VALUES (1, 'Alpha');
    INSERT INTO public.social_worker_status VALUES (1, true);

    INSERT INTO public.cockpit_board_clients VALUES
      ('locA', 'Alpha', 'Active', ARRAY['111'], 'cuA'),
      ('locB', 'Beta', 'Active', ARRAY['222'], 'cuB'),
      ('locG', 'Gamma', 'Active', ARRAY['333'], 'cuG');
    INSERT INTO public.cockpit_meta_ad_days VALUES ('999', 'Gamma spare account', 'Asia/Kuwait', '${daysAgo(2)}', 10, 10);
    INSERT INTO public.editor_people(email, name, via_clickup) VALUES ('clickup.editor@tests.invalid', 'ClickUp Editor', true);
  `);
  // The migration twice: it must be safe to apply again.
  await db.exec(migration(FILE));
  await db.exec(migration(FILE));
  await asOwner();
  // The changes written so far (the audit trigger's rows from the fixture).
  await db.exec(`INSERT INTO public.team_changes(meeting_id, by_whom, what) VALUES
    ('call-center', 'host@tests.invalid', 'renamed the agenda'),
    ('leadership', 'host@tests.invalid', 'renamed the agenda'),
    (NULL, 'native team worker', 'update team_creative_rows');`);
});

afterAll(async () => {
  await db?.close();
});

describe("who is a team-only seat", () => {
  test("only a seat whose roles are all call_center, and never the CEO or an admin", async () => {
    const teamOnly = (who: string) => one<boolean>(who, "SELECT public.cockpit_is_team_only() AS r");
    expect(await teamOnly(AGENT)).toBe(true);
    expect(await teamOnly(AGENT_NONE)).toBe(true);
    for (const who of [CEO, ADMIN, EDITOR, BUYER, CSM_ALL, MIXED, CEO_AGENT]) expect(await teamOnly(who)).toBe(false);
    // Signed-out callers cannot ask.
    await refused(null, "SELECT public.cockpit_is_team_only()");
  });

  test("the helpers run for signed-in users only", async () => {
    const grants = await db.query<{ fn: string; anon: boolean; auth: boolean; pub: boolean }>(`
      SELECT p.proname AS fn, has_function_privilege('anon', p.oid, 'execute') AS anon,
        has_function_privilege('authenticated', p.oid, 'execute') AS auth,
        has_function_privilege('service_role', p.oid, 'execute') AS pub
      FROM pg_proc p WHERE p.proname IN ('cockpit_is_team_only', 'cockpit_team_member_of') ORDER BY 1`);
    expect(grants.rows).toEqual([
      { fn: "cockpit_is_team_only", anon: false, auth: true, pub: false },
      { fn: "cockpit_team_member_of", anon: false, auth: true, pub: false },
    ]);
  });
});

describe("a team-only seat in Team meetings", () => {
  test("sees only the meetings it is in, and their rows", async () => {
    expect(await ids(AGENT, "SELECT id FROM public.team_meetings")).toEqual(["call-center", "csm-daily", "renewals-resell-projections", "whole-team"]);
    expect(await ids(AGENT, "SELECT meeting_id AS id FROM public.team_sittings")).toEqual(["call-center"]);
    expect(await ids(AGENT, "SELECT meeting_id AS id FROM public.team_agenda")).toEqual(["call-center"]);
    expect(await ids(AGENT, "SELECT meeting_id AS id FROM public.team_meeting_blocks")).toEqual(["call-center"]);
    expect(await ids(AGENT, "SELECT DISTINCT meeting_id AS id FROM public.team_meeting_people"))
      .toEqual(["call-center", "csm-daily", "renewals-resell-projections", "whole-team"]);
    expect(await ids(AGENT, "SELECT meeting_id AS id FROM public.team_meeting_series")).toEqual(["call-center"]);
    expect(await ids(AGENT, "SELECT meeting_id AS id FROM public.team_calendar_ops")).toEqual(["call-center"]);
    expect(await ids(AGENT, "SELECT id FROM public.team_wheels")).toEqual(["wheel-cc"]);
    expect(await ids(AGENT, "SELECT wheel_id AS id FROM public.team_wheel_options")).toEqual(["wheel-cc"]);
    expect(await ids(AGENT, "SELECT wheel_id AS id FROM public.team_wheel_spins")).toEqual(["wheel-cc"]);
    expect(await ids(AGENT, "SELECT recording_id AS id FROM public.team_recordings")).toEqual(["rec-cc"]);
    // Changes: its meetings' only (the fixture's own writes were audited too),
    // and none of the changes that belong to no meeting.
    expect(await ids(AGENT, "SELECT DISTINCT meeting_id AS id FROM public.team_changes"))
      .toEqual(["call-center", "csm-daily", "renewals-resell-projections", "whole-team"]);
    expect(await rows(AGENT, "SELECT id FROM public.team_changes WHERE meeting_id IS NULL")).toEqual([]);
    // The whole-team meeting shows the pipeline strip, so its rows are
    // readable, but only for the seat's own clients (Alpha, not Beta).
    expect(await ids(AGENT, "SELECT client AS id FROM public.team_creative_rows")).toEqual(["Alpha"]);
    expect(await ids(EDITOR, "SELECT client AS id FROM public.team_creative_rows")).toEqual(["Alpha", "Beta"]);
    // The roster stays readable: names and roles of colleagues.
    expect((await rows(AGENT, "SELECT id FROM public.team_people")).length).toBe(6);
  });

  test("a seat in no meeting sees no meeting, no pipeline and no changes", async () => {
    expect(await ids(AGENT_NONE, "SELECT id FROM public.team_meetings")).toEqual([]);
    expect(await ids(AGENT_NONE, "SELECT client AS id FROM public.team_creative_rows")).toEqual([]);
    expect(await ids(AGENT_NONE, "SELECT meeting_id AS id FROM public.team_changes")).toEqual([]);
    expect(await ids(AGENT_NONE, "SELECT recording_id AS id FROM public.team_recordings")).toEqual([]);
  });

  test("edits its meeting's doc with the normal compare-and-swap, the same doc everyone edits", async () => {
    const saved = await rows(AGENT,
      "UPDATE public.team_meetings SET doc = 'Agent notes', doc_version = doc_version + 1 WHERE id = 'call-center' AND doc_version = 0 RETURNING doc_by, doc_version");
    expect(saved).toEqual([{ doc_by: "agent@tests.invalid", doc_version: 1 }]);
    // A stale copy loses the swap and changes nothing.
    expect(await rows(AGENT,
      "UPDATE public.team_meetings SET doc = 'Stale', doc_version = doc_version + 1 WHERE id = 'call-center' AND doc_version = 0 RETURNING id")).toEqual([]);
    expect(await refused(AGENT,
      "UPDATE public.team_meetings SET doc = 'Skipped', doc_version = doc_version + 2 WHERE id = 'call-center'")).toContain("Invalid document version");
    // The host reads the agent's edit: one doc.
    expect(await one(HOST, "SELECT doc AS r FROM public.team_meetings WHERE id = 'call-center'")).toBe("Agent notes");
    // The audit trail names the agent.
    expect((await rows(AGENT, "SELECT by_whom FROM public.team_changes WHERE meeting_id = 'call-center' AND by_whom = 'agent@tests.invalid'")).length).toBeGreaterThan(0);
  });

  test("edits its sitting's notes and agenda, and opens a sitting on its meeting", async () => {
    const sid = `call-center:${daysAgo(1)}`;
    expect(await rows(AGENT, "UPDATE public.team_sittings SET notes = 'Called 40', notes_version = notes_version + 1 WHERE id = $1 RETURNING notes_by", [sid]))
      .toEqual([{ notes_by: "agent@tests.invalid" }]);
    expect(await rows(AGENT, "INSERT INTO public.team_agenda(meeting_id, text, status, position) VALUES ('call-center', 'No-shows', 'open', 2) RETURNING meeting_id"))
      .toEqual([{ meeting_id: "call-center" }]);
    expect(await one<boolean>(AGENT, "SELECT public.cockpit_team_can_edit_doc('call-center') AS r")).toBe(true);
    expect((await one(AGENT, "SELECT public.cockpit_team_picture_context('call-center') AS r")).actorId).toBe(AGENT);
  });

  test("is refused every other meeting", async () => {
    // Not visible, so an update changes nothing.
    expect(await rows(AGENT, "UPDATE public.team_meetings SET doc = 'x', doc_version = doc_version + 1 WHERE id = 'leadership' RETURNING id")).toEqual([]);
    expect(await rows(AGENT, `UPDATE public.team_sittings SET notes = 'x', notes_version = notes_version + 1 WHERE id = 'leadership:${daysAgo(1)}' RETURNING id`)).toEqual([]);
    await refused(AGENT, "INSERT INTO public.team_agenda(meeting_id, text, status, position) VALUES ('leadership', 'Sneak', 'open', 2)");
    await refused(AGENT, "INSERT INTO public.team_changes(meeting_id, by_whom, what) VALUES ('leadership', 'x', 'y')");
    expect(await one<boolean>(AGENT, "SELECT public.cockpit_team_can_edit_doc('leadership') AS r")).toBe(false);
    expect(await one<boolean>(AGENT, "SELECT public.cockpit_team_can_edit_doc('old-call') AS r")).toBe(false);
    expect(await one<boolean>(AGENT, "SELECT public.cockpit_team_member_of('leadership') AS r")).toBe(false);
    expect(await refused(AGENT, "SELECT public.cockpit_team_picture_context('leadership')")).toContain("not available");
    await refused(AGENT, "SELECT public.cockpit_team_ensure_sitting('leadership', $1)", [`leadership:${daysAgo(1)}`]);
    expect(await refused(AGENT, "SELECT public.cockpit_team_calendar_command('setGoalHit', $1::jsonb)",
      [JSON.stringify({ meetingId: "leadership", sittingId: `leadership:${daysAgo(1)}`, hit: true })])).toContain("hosts");
    // Its doc pictures: only the meetings it is in (the path starts with the meeting).
    expect((await rows<{ name: string }>(AGENT, "SELECT name FROM storage.objects WHERE bucket_id = 'team-docs'")).map(r => r.name))
      .toEqual(["call-center/2026-10/0123456789abcdef.png"]);
  });

  test("cannot create a meeting, change the roster or the creative board", async () => {
    expect(await refused(AGENT, "SELECT public.cockpit_team_calendar_command('saveMeeting', $1::jsonb)",
      [JSON.stringify({ title: "Agent sync", purpose: "Agents only call", cadence: "weekly", onCalendar: false })]))
      .toContain("cannot create meetings");
    await refused(AGENT, "INSERT INTO public.team_creative_rows(client, status) VALUES ('Alpha', 'scripting')");
    expect(await rows(AGENT, "UPDATE public.team_creative_rows SET notes = 'x' RETURNING id")).toEqual([]);
  });

  test("an editor seat still sees every meeting and writes as before", async () => {
    expect(await ids(EDITOR, "SELECT id FROM public.team_meetings"))
      .toEqual(["call-center", "creative-call", "csm-daily", "leadership", "old-call", "renewals-resell-projections", "whole-team"]);
    expect(await ids(EDITOR, "SELECT id FROM public.team_wheels")).toEqual(["wheel-cc", "wheel-lead", "wheel-prize"]);
    expect(await ids(EDITOR, "SELECT recording_id AS id FROM public.team_recordings")).toEqual(["rec-cc", "rec-lead"]);
    expect((await rows(EDITOR, "SELECT id FROM public.team_changes WHERE meeting_id IS NULL")).length).toBeGreaterThan(0);
    expect(await ids(EDITOR, "SELECT DISTINCT meeting_id AS id FROM public.team_changes WHERE meeting_id IS NOT NULL"))
      .toEqual(["call-center", "creative-call", "csm-daily", "leadership", "old-call", "renewals-resell-projections", "whole-team"]);
    expect(await one<boolean>(EDITOR, "SELECT public.cockpit_team_can_edit_doc('leadership') AS r")).toBe(true);
    expect((await rows(EDITOR, "UPDATE public.team_meetings SET doc = 'Lead notes', doc_version = doc_version + 1 WHERE id = 'leadership' RETURNING doc_by")))
      .toEqual([{ doc_by: "editor@tests.invalid" }]);
    expect((await rows(EDITOR, "SELECT name FROM storage.objects WHERE bucket_id = 'team-docs'")).length).toBe(2);
    expect((await rows(EDITOR, "INSERT INTO public.team_creative_rows(client, status) VALUES ('Beta', 'scripting') RETURNING client"))).toEqual([{ client: "Beta" }]);
  });
});

describe("a team-only seat outside Team meetings", () => {
  test("is refused client billing", async () => {
    expect(await rows(AGENT, "SELECT client_name FROM public.cockpit_billing_accounts")).toEqual([]);
    expect(await rows(AGENT, "SELECT id FROM public.cockpit_billing_events")).toEqual([]);
    expect(await rows(AGENT, "SELECT id FROM public.cockpit_billing_inbox")).toEqual([]);
    expect((await rows(BUYER, "SELECT client_name FROM public.cockpit_billing_accounts")).length).toBe(1);
    expect((await rows(CEO, "SELECT client_name FROM public.cockpit_billing_accounts")).length).toBe(1);
  });

  test("is refused the social calendar", async () => {
    for (const t of ["social_posts", "social_clients", "social_worker_status"]) {
      expect(await rows(AGENT, `SELECT id FROM public.${t}`)).toEqual([]);
      expect((await rows(EDITOR, `SELECT id FROM public.${t}`)).length).toBe(1);
    }
  });

  test("sees only its own clients on the board, and none with an empty list", async () => {
    const board = (who: string) => one<Row>(who, "SELECT public.cockpit_board_read($1::date, $2::date) AS r", [daysAgo(9), today]);
    const names = (b: Row) => (b.clients as Row[]).map(c => c.clientName);
    const agent = await board(AGENT);
    expect(names(agent)).toEqual(["Alpha"]);
    expect(agent.notLinked).toEqual([]);
    expect(agent.offBoard).toBeNull();
    expect(agent.freshness.meta.hourly.note).toBeUndefined();
    expect(agent.canEditTargets).toBe(false);
    const none = await board(AGENT_NONE);
    expect(names(none)).toEqual([]);
    expect(none.offBoard).toBeNull();
    expect(none.notLinked).toEqual([]);
    // Everyone else keeps today's rule: an empty list is the whole board.
    const all = await board(CSM_ALL);
    expect(names(all)).toEqual(["Alpha", "Beta", "Gamma"]);
    expect(all.notLinked).toHaveLength(1);
    expect(all.offBoard.spend).toBe(10);
    expect(names(await board(BUYER))).toEqual(["Alpha"]);
    expect(names(await board(CEO))).toEqual(["Alpha", "Beta", "Gamma"]);
    const allowed = (who: string, name: string) => one<boolean>(who, "SELECT public.cockpit_client_allowed($1) AS r", [name]);
    expect(await allowed(AGENT, "alpha ")).toBe(true);
    expect(await allowed(AGENT, "Beta")).toBe(false);
    expect(await allowed(AGENT_NONE, "Alpha")).toBe(false);
    expect(await allowed(CSM_ALL, "Beta")).toBe(true);
  });

  test("is refused levers; another seat on the same client may add one", async () => {
    const args = JSON.stringify({ locationId: "locA", metric: "other", lever: "Call new leads within 5 minutes", department: "call_center" });
    expect(await refused(AGENT, "SELECT public.cockpit_board_lever_context($1::jsonb)", [args])).toContain("not add levers");
    const ctx = await one<Row>(BUYER, "SELECT public.cockpit_board_lever_context($1::jsonb) AS r", [args]);
    expect(ctx.clientName).toBe("Alpha");
    expect(ctx.email).toBe("buyer@tests.invalid");
  });

  test("is refused the client success projections, even as a meeting participant", async () => {
    const message = "Call center seats do not open client success projections";
    for (const meeting of ["csm-daily", "renewals-resell-projections"]) {
      expect(await refused(AGENT, "SELECT public.cockpit_csm_projection_read(NULL, $1)", [meeting])).toContain(message);
      expect(await refused(AGENT, "SELECT public.cockpit_csm_projection_edit($1::jsonb, $2)",
        [JSON.stringify({ kind: "status", taskId: "task-alpha", status: "renewed" }), meeting])).toContain(message);
      expect(await refused(AGENT, "SELECT public.cockpit_csm_projection_booking_context($1, $2)", ["task-alpha", meeting])).toContain(message);
    }
    // The seat with an empty list, once a host adds it to the meeting, is refused the same way.
    await db.exec("INSERT INTO public.team_meeting_people(meeting_id, person_id, part, source, removed) VALUES ('csm-daily', 'agent2', 'required', 'cockpit', false)");
    try {
      expect(await refused(AGENT_NONE, "SELECT public.cockpit_csm_projection_read(NULL, 'csm-daily')")).toContain(message);
      expect(await refused(AGENT_NONE, "SELECT public.cockpit_csm_projection_booking_context('task-alpha', 'csm-daily')")).toContain(message);
    } finally {
      await asOwner();
      await db.exec("DELETE FROM public.team_meeting_people WHERE meeting_id = 'csm-daily' AND person_id = 'agent2'");
    }
    // Without a meeting too.
    expect(await refused(AGENT, "SELECT public.cockpit_csm_projection_read(NULL, NULL)")).toContain(message);
    // The door itself: a CSM participant still passes, a team-only participant does not.
    expect(await asClaims<string>(HOST, "SELECT public.cockpit_csm_projection_actor('csm-daily')::text AS r")).toBe(HOST);
    expect(await refusedAsClaims(AGENT, "SELECT public.cockpit_csm_projection_actor('csm-daily') AS r")).toContain(message);
    // The door stays closed to direct calls, as live.
    expect(await refused(HOST, "SELECT public.cockpit_csm_projection_actor('csm-daily')")).toContain("permission denied");
  });

  test("an empty client list is never every client in client success", async () => {
    const scopeAll = (who: string) => one<boolean>(who, "SELECT public.cockpit_csm_scope_all() AS r");
    expect(await scopeAll(AGENT_NONE)).toBe(false);
    expect(await scopeAll(AGENT)).toBe(false);
    // Everyone else keeps today's rule.
    expect(await scopeAll(CSM_ALL)).toBe(true);
    expect(await scopeAll(HOST)).toBe(true);
    expect(await scopeAll(CEO)).toBe(true);
    expect(await scopeAll(ADMIN)).toBe(true);
    expect(await scopeAll(BUYER)).toBe(false);
  });

  test("cannot upload to the public review-videos bucket; the editor desk still can", async () => {
    const upload = (who: string, name: string) =>
      rows(who, "INSERT INTO storage.objects(bucket_id, name) VALUES ('review-videos', $1)", [name]);
    for (const who of [AGENT, AGENT_NONE])
      expect(await refused(who, "INSERT INTO storage.objects(bucket_id, name) VALUES ('review-videos', 'agent.mp4')"))
        .toContain("row-level security");
    // A seat that cannot open the editor desk has no upload either.
    await refused(BUYER, "INSERT INTO storage.objects(bucket_id, name) VALUES ('review-videos', 'buyer.mp4')");
    await upload(EDITOR, "1760000000000-cut.mp4");
    await upload(CEO, "1760000000001-cut.mp4");
    await upload(ADMIN, "1760000000002-cut.mp4");
    expect((await db.query("SELECT 1 FROM storage.objects WHERE bucket_id = 'review-videos'")).rows).toHaveLength(3);
    // One rule, replaced in place.
    expect((await db.query("SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND policyname = 'editors upload review media'")).rows).toHaveLength(1);
  });

  test("lands on /team with no cockpit", async () => {
    const access = (who: string) => one<Row>(who, "SELECT public.cockpit_get_my_access() AS r");
    expect(await access(AGENT)).toMatchObject({ roles: ["call_center"], clients: ["Alpha"], cockpits: [], home: "/team", is_admin: false, is_ceo: false });
    expect(await access(EDITOR)).toMatchObject({ cockpits: ["editor"], home: "/go/editor" });
    expect(await access(ADMIN)).toMatchObject({ home: "/admin" });
    expect(await access(CEO_AGENT)).toMatchObject({ home: "/ceo", is_ceo: true });
    expect(await access(MIXED)).toMatchObject({ home: "/admin", is_admin: true });
  });
});

describe("the Admin save", () => {
  const upsert = (email: string, roles: string[], clients: string[] = []) =>
    one<string>(ADMIN, "SELECT public.cockpit_admin_upsert_member($1, $2, $3, $4)::text AS r", [email, "Test Person", roles, clients]);
  const editorRow = async (email: string) =>
    (await db.query<Row>("SELECT via_portal, via_clickup, active FROM public.editor_people WHERE email = $1", [email])).rows[0];
  const editorAudits = async (email: string) =>
    Number((await db.query<{ n: number }>("SELECT count(*)::int AS n FROM public.cockpit_audit_log WHERE entity_type = 'editor_people' AND entity_id = $1", [email])).rows[0].n);

  test("accepts call_center alone, with its clients", async () => {
    await upsert("New.Agent@tests.invalid", ["call_center"], ["Alpha", "Beta"]);
    const row = (await db.query<Row>("SELECT roles, clients, active FROM public.cockpit_members WHERE email = 'new.agent@tests.invalid'")).rows[0];
    expect(row).toEqual({ roles: ["call_center"], clients: ["Alpha", "Beta"], active: true });
  });

  test("refuses call_center with no clients", async () => {
    for (const clients of [[], [" ", ""]])
      expect(await refused(ADMIN, "SELECT public.cockpit_admin_upsert_member($1, $2, $3, $4)",
        ["empty.agent@tests.invalid", "Empty", ["call_center"], clients])).toContain("Tick at least one client for a call center seat.");
    expect((await db.query("SELECT 1 FROM public.cockpit_members WHERE email = 'empty.agent@tests.invalid'")).rows).toHaveLength(0);
    // Other seats keep the empty list (every client).
    await upsert("empty.csm@tests.invalid", ["csm"], []);
    expect((await db.query<Row>("SELECT clients FROM public.cockpit_members WHERE email = 'empty.csm@tests.invalid'")).rows[0].clients).toEqual([]);
  });

  test("refuses call_center with any other role", async () => {
    for (const other of ["csm", "editor", "admin", "media_buyer"])
      expect(await refused(ADMIN, "SELECT public.cockpit_admin_upsert_member($1, $2, $3, $4)",
        ["mixed.agent@tests.invalid", "Mixed", ["call_center", other], []])).toContain("Call center is a seat on its own");
    expect((await db.query("SELECT 1 FROM public.cockpit_members WHERE email = 'mixed.agent@tests.invalid'")).rows).toHaveLength(0);
    // Still admins only.
    expect(await refused(AGENT, "SELECT public.cockpit_admin_upsert_member($1, $2, $3, $4)",
      ["x@tests.invalid", "X", ["call_center"], []])).toContain("Admins only");
  });

  test("keeps editor_people.via_portal in step with the editor role, audited", async () => {
    await upsert("new.editor@tests.invalid", ["editor"]);
    expect(await editorRow("new.editor@tests.invalid")).toEqual({ via_portal: true, via_clickup: false, active: true });
    expect(await editorAudits("new.editor@tests.invalid")).toBe(1);
    // Saving again with editor changes nothing and writes no second row.
    await upsert("new.editor@tests.invalid", ["creative", "editor"]);
    expect(await editorAudits("new.editor@tests.invalid")).toBe(1);
    await upsert("new.editor@tests.invalid", ["creative"]);
    expect(await editorRow("new.editor@tests.invalid")).toEqual({ via_portal: false, via_clickup: false, active: false });
    expect(await editorAudits("new.editor@tests.invalid")).toBe(2);
    // ClickUp's mark is never touched.
    await upsert("clickup.editor@tests.invalid", ["editor"]);
    expect(await editorRow("clickup.editor@tests.invalid")).toEqual({ via_portal: true, via_clickup: true, active: true });
    await upsert("clickup.editor@tests.invalid", ["csm"]);
    expect(await editorRow("clickup.editor@tests.invalid")).toEqual({ via_portal: false, via_clickup: true, active: true });
    // A seat that was never an editor gets no editor_people row.
    await upsert("plain.csm@tests.invalid", ["csm"]);
    expect(await editorRow("plain.csm@tests.invalid")).toBeUndefined();
  });

  test("removing a seat drops its portal editor mark", async () => {
    await upsert("leaving.editor@tests.invalid", ["editor"]);
    await one(ADMIN, "SELECT public.cockpit_admin_remove_member($1)::text AS r", ["leaving.editor@tests.invalid"]);
    expect(await editorRow("leaving.editor@tests.invalid")).toEqual({ via_portal: false, via_clickup: false, active: false });
    expect(await editorAudits("leaving.editor@tests.invalid")).toBe(2);
  });
});

describe("the roster decides who is in a meeting", () => {
  test("an inactive roster row puts a team-only seat in no meeting", async () => {
    // agent3 is in call-center, but its roster row is not active.
    expect(await one<boolean>(AGENT_GONE, "SELECT public.cockpit_team_member_of('call-center') AS r")).toBe(false);
    expect(await ids(AGENT_GONE, "SELECT id FROM public.team_meetings")).toEqual([]);
    await db.query("UPDATE public.team_people SET active = true WHERE id = 'agent3'");
    try {
      expect(await one<boolean>(AGENT_GONE, "SELECT public.cockpit_team_member_of('call-center') AS r")).toBe(true);
      expect(await ids(AGENT_GONE, "SELECT id FROM public.team_meetings")).toEqual(["call-center"]);
    } finally {
      await asOwner();
      await db.query("UPDATE public.team_people SET active = false WHERE id = 'agent3'");
    }
  });

  test("only the CEO or an admin sets a roster email", async () => {
    const setEmail = (who: string, email: string) => rows(who, "SELECT public.cockpit_team_calendar_command('setEmail', $1::jsonb)",
      [JSON.stringify({ meetingId: "call-center", personId: "newbie", email })]);
    // The meeting's host could point a roster row at an agent's address and
    // put the agent in every meeting that person is in.
    expect(await refused(HOST, "SELECT public.cockpit_team_calendar_command('setEmail', $1::jsonb)",
      [JSON.stringify({ meetingId: "call-center", personId: "newbie", email: "agent2@tests.invalid" })]))
      .toContain("Only the CEO or an admin changes a roster email");
    expect((await db.query<Row>("SELECT email FROM public.team_people WHERE id = 'newbie'")).rows[0].email).toBeNull();
    expect(await one<boolean>(AGENT_NONE, "SELECT public.cockpit_team_member_of('call-center') AS r")).toBe(false);
    // An agent is refused too (it is not the meeting's host either).
    await refused(AGENT, "SELECT public.cockpit_team_calendar_command('setEmail', $1::jsonb)",
      [JSON.stringify({ meetingId: "call-center", personId: "newbie", email: "x@tests.invalid" })]);
    // An admin and the CEO set it, audited in the meeting's changes.
    await setEmail(ADMIN, "New.Starter@tests.invalid");
    expect((await db.query<Row>("SELECT email FROM public.team_people WHERE id = 'newbie'")).rows[0].email).toBe("new.starter@tests.invalid");
    await setEmail(CEO, "newbie@tests.invalid");
    expect((await db.query<Row>("SELECT email FROM public.team_people WHERE id = 'newbie'")).rows[0].email).toBe("newbie@tests.invalid");
    expect((await db.query("SELECT 1 FROM public.team_changes WHERE meeting_id = 'call-center' AND what = 'setEmail'")).rows).toHaveLength(2);
    // The rest of the command is unchanged: the host still manages the meeting.
    expect(await one<string>(HOST, "SELECT public.cockpit_team_calendar_command('setPart', $1::jsonb) AS r",
      [JSON.stringify({ meetingId: "call-center", personId: "newbie", part: "optional" })])).toBe("call-center");
  });
});
