import { expect, test } from "bun:test";
import { actor, cockpitTestDb, member, migration, owner } from "./lib/cockpitTestDb";

const CEO = "00000000-0000-4000-8000-000000000001";
const BUYER = "00000000-0000-4000-8000-000000000002";
const UNCONFIRMED = "00000000-0000-4000-8000-000000000003";
const coreRepair = "20261007c_cockpit_rpc_restore.sql";
const teamRepair = "20261007d_cockpit_team_rpc_restore.sql";

async function fixture() {
  const db = await cockpitTestDb();
  try {
    await db.exec(`CREATE TABLE public.clients(id uuid PRIMARY KEY);
      CREATE TABLE public.cockpit_sections(key text PRIMARY KEY,payload jsonb,generated_at timestamptz);
      CREATE TABLE public.editor_clients(task_id text PRIMARY KEY,name text,status text);
      CREATE SCHEMA extensions;
      CREATE FUNCTION public.gen_random_bytes(n integer) RETURNS bytea LANGUAGE sql AS
      $$ SELECT decode(replace(gen_random_uuid()::text,'-',''),'hex') $$;
      CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS
      $$ SELECT coalesce(auth.jwt()->>'role','') $$;`);
    const core = migration("20260919_cockpit_core.sql");
    for (const pattern of [
      /create table if not exists public\.cockpit_payroll_months \([\s\S]*?\n\);/i,
      /create or replace function public\.cockpit_touch_updated_at\(\)[\s\S]*?end \$\$;/i,
    ]) await db.exec(core.match(pattern)![0]);
    for (const file of [
      "20260919b_people.sql", "20260920a_people_commission.sql", "20260921b_people_schedule.sql",
      "20260922c_people_paused.sql", "20260922d_people_bot_engagement.sql",
      "20260920c_review.sql", "20260920d_review_create.sql", "20260921a_review_media.sql",
      "20260923k_cockpit_creative_requests.sql", "20260923m_unified_creative_request.sql",
      "20260923o_cockpit_domain_tables.sql", "20260926074942_webinar_target_versions.sql",
      "20260922b_team_meetings.sql", "20260923d_team_meetings_screen.sql",
      "20260927d_team_meetings_v5.sql", "20260927e_team_meeting_series.sql",
      "20260927x_team_meetings_access.sql",
    ]) {
      if (file === "20260922b_team_meetings.sql") await db.exec("CREATE FUNCTION public.is_editor() RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;");
      await db.exec(migration(file));
    }
    const allowed = migration("20260926m_cockpit_csm_state.sql").match(/CREATE OR REPLACE FUNCTION public\.cockpit_client_allowed[\s\S]*?END \$\$;/)![0];
    await db.exec(allowed);
    await db.exec("ALTER TABLE team_meetings ADD COLUMN links jsonb NOT NULL DEFAULT '[]'::jsonb");
    const teamSecurity = migration("20261004b_team_native_security.sql");
    for (const name of ["cockpit_team_can_edit_doc", "cockpit_team_can_manage"]) {
      await db.exec(teamSecurity.match(new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\$\\$;`, "i"))![0]);
    }
    await member(db, CEO, "aziz@maharamedia.com", []);
    await member(db, BUYER, "buyer@tests.invalid", ["media_buyer"]);
    await member(db, UNCONFIRMED, "unconfirmed@tests.invalid", ["media_buyer"], true, false);
    await db.exec(`UPDATE cockpit_members SET clients=ARRAY['Alpha'] WHERE auth_user_id='${BUYER}';
      INSERT INTO editor_clients VALUES('alpha','Alpha','active'),('beta','Beta','active');
      INSERT INTO cockpit_people(name,note,monthly_cost,currency,source,added_by)
      VALUES('Human record','Keep this note',123,'USD','workspace','original-import');`);
    return db;
  } catch (error) { await db.close(); throw error; }
}

test("the repair restores real missing RPCs and preserves rows on repeat application", async () => {
  const db = await fixture();
  try {
    await expect(db.query("select cockpit_ceo_people_list()")).rejects.toThrow();
    const before = (await db.query("SELECT to_jsonb(p) AS row FROM cockpit_people p ORDER BY id")).rows;
    await db.exec(migration(coreRepair));
    await db.exec(migration(teamRepair));
    await db.exec(migration(coreRepair));
    await db.exec(migration(teamRepair));
    expect((await db.query("SELECT to_jsonb(p) AS row FROM cockpit_people p ORDER BY id")).rows).toEqual(before);
    expect((await db.query("SELECT count(*)::int AS n FROM cockpit_finance_refreshes")).rows[0]?.n).toBe(0);
    expect((await db.query("SELECT count(*)::int AS n FROM cockpit_team_calendar_worker")).rows[0]?.n).toBe(0);
    await actor(db, CEO);
    expect((await db.query<{ v: unknown[] }>("SELECT cockpit_ceo_people_list() AS v")).rows[0]?.v).toHaveLength(before.length);
  } finally { await db.close(); }
});

test("restored sensitive RPCs deny buyers and unconfirmed identities", async () => {
  const db = await fixture();
  try {
    await db.exec(migration(coreRepair)); await db.exec(migration(teamRepair));
    for (const id of [BUYER, UNCONFIRMED]) {
      await actor(db, id);
      await expect(db.query("SELECT cockpit_ceo_people_list()")).rejects.toThrow();
      await expect(db.query("SELECT cockpit_finance_refresh_status('00000000-0000-4000-8000-000000000099')")).rejects.toThrow();
      await expect(db.query("SELECT cockpit_team_calendar_claim()")).rejects.toThrow();
    }
    await actor(db, null);
    await expect(db.query("SELECT cockpit_review_clients()")).rejects.toThrow();
  } finally { await db.close(); }
});

test("review wrappers derive identity, restrict clients and deny legacy bypass", async () => {
  const db = await fixture();
  try {
    await db.exec(migration(coreRepair));
    await actor(db, BUYER);
    const r = await db.query<{ v: { token: string } }>(`SELECT cockpit_review_create('Review',NULL,'Alpha','alpha','spoofed','[{"video_url":"https://example.test/movie.mp4"}]',30) AS v`);
    expect(r.rows[0]?.v.token).toBeTruthy();
    await expect(db.query(`SELECT cockpit_review_create('Review',NULL,'Beta','beta','spoofed','[]',30)`)).rejects.toThrow();
    await expect(db.query(`SELECT review_create('Bypass',NULL,'Alpha','alpha','spoofed','[]',30)`)).rejects.toThrow();
    await owner(db);
    expect((await db.query<{ created_by: string }>("SELECT created_by FROM review_links")).rows[0]?.created_by).toBe("buyer@tests.invalid");
  } finally { await db.close(); }
});

test("new stores have RLS and worker actions remain service-only", async () => {
  const db = await fixture();
  try {
    await db.exec(migration(coreRepair)); await db.exec(migration(teamRepair));
    const stores = await db.query<{ relrowsecurity: boolean }>(`SELECT relrowsecurity FROM pg_class WHERE oid IN('cockpit_finance_refreshes'::regclass,'cockpit_campaign_drafts'::regclass,'cockpit_team_calendar_worker'::regclass)`);
    expect(stores.rows).toHaveLength(3); expect(stores.rows.every(r => r.relrowsecurity)).toBe(true);
    await actor(db, BUYER);
    expect((await db.query<{ ready: boolean }>("SELECT cockpit_team_calendar_ready() AS ready")).rows[0]?.ready).toBe(false);
    await expect(db.query("SELECT * FROM cockpit_campaign_drafts")).rejects.toThrow();
    await expect(db.query("SELECT cockpit_team_calendar_report(true,NULL)")).rejects.toThrow();
  } finally { await db.close(); }
});

test("payroll edits preserve human fields and retain provider audit attribution", async () => {
  const db = await fixture();
  try {
    await db.exec(migration(coreRepair));
    await actor(db, CEO);
    await db.query(`SELECT cockpit_ceo_people_save('{"id":1,"role":"Updated role"}'::jsonb)`);
    await owner(db);
    const row = (await db.query<{ note: string; monthly_cost: string; source: string; added_by: string }>("SELECT note,monthly_cost,source,added_by FROM cockpit_people WHERE id=1")).rows[0]!;
    expect(row.note).toBe("Keep this note"); expect(Number(row.monthly_cost)).toBe(123);
    expect(row.source).toBe("workspace"); expect(row.added_by).toBe("original-import");
    expect((await db.query<{ actor_email: string }>("SELECT actor_email FROM cockpit_audit_log WHERE entity_type='cockpit_people' ORDER BY id DESC LIMIT 1")).rows[0]?.actor_email).toBe("aziz@maharamedia.com");
    await db.exec("BEGIN");
    await db.query("SELECT set_config('cockpit.ceo_actor_email','provider-import@tests.invalid',true)");
    await db.query("UPDATE cockpit_people SET role='Provider update' WHERE id=1");
    await db.exec("COMMIT");
    expect((await db.query<{ actor_email: string }>("SELECT actor_email FROM cockpit_audit_log WHERE entity_type='cockpit_people' AND after->>'role'='Provider update'")).rows[0]?.actor_email).toBe("provider-import@tests.invalid");
  } finally { await db.close(); }
});

test("team access rejects an identity whose email no longer matches its seat", async () => {
  const db = await fixture();
  try {
    await db.exec("INSERT INTO team_meetings(id,title,purpose,cadence,active,managed) VALUES('email-check','Email check','Check access','weekly',true,'cockpit')");
    await db.exec(migration(teamRepair));
    await db.exec(`UPDATE auth.users SET email='changed@tests.invalid' WHERE id='${BUYER}'`);
    await actor(db, BUYER);
    expect((await db.query<{ allowed: boolean }>("SELECT cockpit_has_active_seat() AS allowed")).rows[0]?.allowed).toBe(false);
    expect((await db.query("SELECT * FROM team_meetings")).rows).toHaveLength(0);
    expect((await db.query("UPDATE team_meetings SET doc='forged' WHERE id='email-check' RETURNING id")).rows).toHaveLength(0);
    await expect(db.query("SELECT cockpit_team_ensure_sitting('email-check','email-check:2026-10-08')")).rejects.toThrow("active verified cockpit seat");
  } finally { await db.close(); }
});

test("authorized team commands and calendar leases work without forged receipts", async () => {
  const db = await fixture();
  try {
    await db.exec(migration(teamRepair));
    await actor(db, CEO);
    await db.query(`SELECT cockpit_team_calendar_command('saveMeeting','{"title":"Review test","purpose":"Check commands and lease receipts","cadence":"weekly","onCalendar":false,"startTime":"10:00","minutes":30,"weekdays":[4]}'::jsonb)`);
    await db.query("SELECT cockpit_team_ensure_sitting('review-test','review-test:2026-10-08')");
    await owner(db);
    await db.exec("SELECT set_config('request.jwt.claims','{\"role\":\"service_role\"}',false); SELECT set_config('request.jwt.claim.sub','',false); SET ROLE service_role");
    await db.query("INSERT INTO team_calendar_ops(meeting_id,op,payload,requested_by) VALUES('review-test','create','{}','tests.invalid')");
    const job = (await db.query<{ id: number; claim_token: string }>("SELECT * FROM cockpit_team_calendar_claim()")).rows[0]!;
    expect(job.claim_token).toBeTruthy();
    expect((await db.query<{ ok: boolean }>("SELECT cockpit_team_calendar_finish($1,$2,NULL) AS ok", [job.id, BUYER])).rows[0]?.ok).toBe(false);
    expect((await db.query<{ ok: boolean }>("SELECT cockpit_team_calendar_finish($1,$2,NULL) AS ok", [job.id, job.claim_token])).rows[0]?.ok).toBe(true);
    expect((await db.query("SELECT status,claim_token,lease_until FROM team_calendar_ops WHERE id=$1", [job.id])).rows[0]).toEqual({ status: "done", claim_token: null, lease_until: null });
  } finally { await db.close(); }
});

test("decision details survive saves and decision and plan writes leave an audit", async () => {
  const db = await fixture();
  try {
    const actions = migration("20260923p_cockpit_actions_and_rpcs.sql");
    await db.exec(actions.match(/CREATE TABLE IF NOT EXISTS public\.cockpit_plan_items \([\s\S]*?\n\);/)![0]);
    for (const name of ["cockpit_log_decision", "cockpit_remove_decision", "cockpit_add_plan_item", "cockpit_remove_plan_item"]) {
      await db.exec(actions.match(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\([\\s\\S]*?\\$\\$;`))![0]);
    }
    for (const [file, name] of [["20260927g_cockpit_media_actions.sql", "cockpit_media_action_guard"], ["20260927u_cockpit_media_workflows.sql", "cockpit_media_action_effects"], ["20260927u_cockpit_media_workflows.sql", "cockpit_b2b_draft_audit"]]) {
      await db.exec(migration(file!).match(new RegExp(`CREATE FUNCTION public\\.${name}\\([\\s\\S]*?\\$\\$;`))![0]);
    }
    await db.exec(migration("20261007f_cockpit_write_contract.sql"));
    await actor(db, BUYER);
    await db.query("SELECT cockpit_log_decision('media_buyer','2026-10-07','Keep details','Test save','decision',NULL,'Human reasoning',0,'{\"amount\":0}')");
    await db.query("SELECT cockpit_add_plan_item('media_buyer','2026-10-07','Human plan','Human reason',NULL,NULL,NULL)");
    await owner(db);
    expect((await db.query("SELECT reason,metadata,metric_at_decision FROM cockpit_decisions")).rows[0]).toEqual({ reason: "Human reasoning", metadata: { amount: 0 }, metric_at_decision: "0" });
    expect((await db.query("SELECT entity_type,actor_email FROM cockpit_audit_log WHERE entity_type IN('cockpit_decisions','cockpit_plan_items') ORDER BY entity_type")).rows).toEqual([{ entity_type: "cockpit_decisions", actor_email: "buyer@tests.invalid" }, { entity_type: "cockpit_plan_items", actor_email: "buyer@tests.invalid" }]);
    await actor(db, BUYER);
    await db.query("SELECT cockpit_remove_plan_item(1)");
    await owner(db);
    expect((await db.query("SELECT action FROM cockpit_audit_log WHERE entity_type='cockpit_plan_items' ORDER BY action")).rows).toEqual([{ action: "DELETE" }, { action: "INSERT" }]);
    const rowsBefore = (await db.query("SELECT to_jsonb(d) AS row FROM cockpit_decisions d")).rows;
    const auditBefore = (await db.query("SELECT count(*)::int AS n FROM cockpit_audit_log")).rows;
    await db.exec(migration("20261007f_cockpit_write_contract.sql"));
    expect((await db.query("SELECT to_jsonb(d) AS row FROM cockpit_decisions d")).rows).toEqual(rowsBefore);
    expect((await db.query("SELECT count(*)::int AS n FROM cockpit_audit_log")).rows).toEqual(auditBefore);
    await actor(db, null);
    await expect(db.query("SELECT cockpit_remove_decision(1)")).rejects.toThrow("permission denied");
  } finally { await db.close(); }
});

test("team guards prevent forged provider receipts and stamp the actual editor", async () => {
  const db = await fixture();
  try {
    await db.exec(`INSERT INTO team_meetings(id,title,purpose,cadence,active,managed)
      VALUES('weekly-sync','Weekly Sync','Align the team on goals and week priorities','weekly',true,'cockpit');`);
    await db.exec(migration(teamRepair));
    await actor(db, BUYER);
    await expect(db.query("UPDATE team_meetings SET cal_event_id='forged' WHERE id='weekly-sync'")).rejects.toThrow();
    await db.query("UPDATE team_meetings SET doc='Human edit',doc_by='spoofed',doc_version=doc_version+1 WHERE id='weekly-sync'");
    const meeting = (await db.query<{ doc_by: string }>("SELECT doc_by FROM team_meetings WHERE id='weekly-sync'")).rows[0]!;
    expect(meeting.doc_by).toBe("buyer@tests.invalid");
    await db.query("INSERT INTO team_changes(meeting_id,by_whom,what) VALUES('weekly-sync','spoofed','test edit')");
    expect((await db.query<{ by_whom: string }>("SELECT by_whom FROM team_changes WHERE what='test edit'")).rows[0]?.by_whom).toBe("buyer@tests.invalid");
  } finally { await db.close(); }
});
