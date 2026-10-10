import type { PGlite } from "@electric-sql/pglite";
import { expect, test } from "bun:test";
import { actor, cockpitTestDb, member, migration, owner } from "./lib/cockpitTestDb";

const F = "00000000-0000-4000-8000-000000000001";
const O = "00000000-0000-4000-8000-000000000002";

function pick(file: string, pattern: RegExp): string {
  const hit = migration(file).match(pattern);
  if (!hit) throw new Error(`Fixture definition missing in ${file}: ${pattern}`);
  return hit[0];
}

async function fixture(): Promise<PGlite> {
  const db = await cockpitTestDb();
  await db.exec(`CREATE SCHEMA storage;
    CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint);
    CREATE TABLE storage.objects(bucket_id text,name text,metadata jsonb);`);
  await db.exec(pick("20260919_cockpit_core.sql", /create or replace function public\.cockpit_touch_updated_at\(\)[\s\S]*?end \$\$;/i));
  await db.exec(pick("20260919_cockpit_core.sql", /create table if not exists public\.cockpit_client_billing_days \([\s\S]*?\n\);/i));
  await db.exec(pick("20260921e_tap_charges.sql", /create table if not exists public\.cockpit_sync_state \([\s\S]*?\n\);/i));
  await db.exec(pick("20260923g_webinar_collection.sql", /create table if not exists public\.cockpit_webinar_sessions \([\s\S]*?\n\);/i));
  await db.exec(pick("20261007e_cockpit_provider_rpc_restore.sql", /CREATE OR REPLACE FUNCTION public\.cockpit_ceo_verified_actor_email[\s\S]*?\n\$\$;/));
  await db.exec(migration("20260919h_posting.sql"));
  await db.exec(migration("20260920b_posting_kinds.sql"));
  await db.exec(migration("20261009d_ceo_endpoints_native.sql").replace(/NOTIFY pgrst,'reload schema';/, ""));
  await member(db, F, "aziz@maharamedia.com", []);
  await member(db, O, "other@tests.invalid", ["admin", "ceo"]);
  return db;
}

async function asService(db: PGlite) {
  await db.exec("RESET ROLE");
  await db.query("SELECT set_config('request.jwt.claim.sub','',false), set_config('request.jwt.claims',$1,false)", [JSON.stringify({ role: "service_role" })]);
  await db.exec("SET ROLE service_role");
}

async function one<T = any>(db: PGlite, sql: string, params: unknown[] = []): Promise<T> {
  return (await db.query<any>(sql, params)).rows[0]?.result as T;
}

async function audit(db: PGlite, action: string) {
  await owner(db);
  return (await db.query<any>("SELECT * FROM cockpit_audit_log WHERE action=$1 ORDER BY created_at", [action])).rows;
}

test("pitch times: founder only, whole minutes, saved from the session start, audited", async () => {
  const db = await fixture();
  try {
    await db.exec("INSERT INTO cockpit_webinar_sessions(uuid,meeting_id,started_at) VALUES('s1','m','2026-10-01T16:00:00Z')");
    await actor(db, F);
    const saved = await one(db, "SELECT cockpit_ceo_webinar_pitch_set('s1',12,40) AS result");
    expect(saved.ok).toBe(true);
    await expect(db.query("SELECT cockpit_ceo_webinar_pitch_set('s1',12.5,null)")).rejects.toThrow("whole minute");
    await expect(db.query("SELECT cockpit_ceo_webinar_pitch_set('s1',40,12)")).rejects.toThrow("after pitch 1");
    await expect(db.query("SELECT cockpit_ceo_webinar_pitch_set('nope',1,null)")).rejects.toThrow("No Zoom session");
    await owner(db);
    const row = (await db.query<any>("SELECT pitch1_at,pitch2_at,pitch_set_by FROM cockpit_webinar_sessions WHERE uuid='s1'")).rows[0];
    expect(new Date(row.pitch1_at).toISOString()).toBe("2026-10-01T16:12:00.000Z");
    expect(new Date(row.pitch2_at).toISOString()).toBe("2026-10-01T16:40:00.000Z");
    expect(row.pitch_set_by).toBe("aziz@maharamedia.com");
    const rows = await audit(db, "webinar.pitches");
    expect(rows.length).toBe(1);
    expect(rows[0].metadata.what).toBe("Set the webinar pitches: pitch 1 minute 12, pitch 2 minute 40");
    await actor(db, F);
    await one(db, "SELECT cockpit_ceo_webinar_pitch_set('s1',null,null) AS result");
    await owner(db);
    expect((await db.query<any>("SELECT pitch1_at FROM cockpit_webinar_sessions")).rows[0].pitch1_at).toBeNull();
    await actor(db, O);
    await expect(db.query("SELECT cockpit_ceo_webinar_pitch_set('s1',1,null)")).rejects.toThrow("Founder");
    await actor(db, null);
    await expect(db.query("SELECT cockpit_ceo_webinar_pitch_set('s1',1,null)")).rejects.toThrow();
  } finally {
    await db.close();
  }
});

test("extension cards refuse a missing or stale snapshot and read each card's latest day", async () => {
  const db = await fixture();
  try {
    await asService(db);
    await expect(db.query("SELECT cockpit_ceo_extension_cards()")).rejects.toThrow("missing");
    await owner(db);
    await db.exec(`INSERT INTO cockpit_client_billing_days(day,clickup_task_id,client_name,stage,captured_at) VALUES
      ('2026-10-01','n1','Old Name','Onboarding',now()-interval '3 days')`);
    await asService(db);
    await expect(db.query("SELECT cockpit_ceo_extension_cards()")).rejects.toThrow("24 hours");
    await owner(db);
    await db.exec(`INSERT INTO cockpit_client_billing_days(day,clickup_task_id,client_name,stage,captured_at) VALUES
      ('2026-10-08','n1','Nahda Clinics','Active',now())`);
    await asService(db);
    expect(await one(db, "SELECT cockpit_ceo_extension_cards() AS result")).toEqual([{ taskId: "n1", name: "Nahda Clinics", stage: "Active" }]);
    await actor(db, F);
    await expect(db.query("SELECT cockpit_ceo_extension_cards()")).rejects.toThrow();
  } finally {
    await db.close();
  }
});

test("extension writes keep their memory and audit row; automatic writes name the cockpit", async () => {
  const db = await fixture();
  try {
    const write = (weeks: number) => JSON.stringify({ taskId: "n1", client: "Nahda Clinics", weeks, until: "2026-11-02", grantedDay: "2026-10-05", fieldId: "fld-9", what: "Set Nahda" });
    await asService(db);
    expect(await one(db, "SELECT cockpit_ceo_extension_write_record($1,$2::jsonb) AS result", [F, write(4)])).toEqual({ ok: true });
    expect(await one(db, "SELECT cockpit_ceo_extension_write_record(null,$1::jsonb) AS result", [write(0)])).toEqual({ ok: true });
    await expect(db.query("SELECT cockpit_ceo_extension_write_record($1,$2::jsonb)", [F, write(3)])).rejects.toThrow("not confirmed");
    await expect(db.query("SELECT cockpit_ceo_extension_write_record($1,$2::jsonb)", [O, write(1)])).rejects.toThrow("Verified founder");
    const memory = (await db.query<any>("SELECT weeks,written_by,field_id FROM cockpit_ceo_extension_field_writes")).rows;
    expect(memory).toEqual([{ weeks: 0, written_by: "the cockpit, after the extension form sync", field_id: "fld-9" }]);
    const rows = await audit(db, "extension.write");
    expect(rows.map(r => [r.actor_email, r.after.weeks, r.metadata.automatic])).toEqual([
      ["aziz@maharamedia.com", 4, false],
      ["the cockpit, after the extension form sync", 0, true],
    ]);
    expect(rows[1].before.weeks).toBe(4);
    await actor(db, F);
    await expect(db.query("SELECT cockpit_ceo_extension_write_record($1,$2::jsonb)", [F, write(1)])).rejects.toThrow();
    await expect(db.query("SELECT * FROM cockpit_ceo_extension_field_writes")).rejects.toThrow();
  } finally {
    await db.close();
  }
});

async function createReel(db: PGlite, extra: Record<string, unknown> = {}) {
  await asService(db);
  return one(db, "SELECT cockpit_ceo_posting_create($1,$2::jsonb) AS result", [F, JSON.stringify({ kind: "reel", sourceKind: "upload", sourceRef: "uploads/abc-clip.mp4", titleWorking: "Hook", ...extra })]);
}

test("posting create checks the upload, queues the worker and is audited; the browser has no door", async () => {
  const db = await fixture();
  try {
    await expect(createReel(db)).rejects.toThrow("has not arrived");
    await expect(createReel(db, { sourceRef: "videos/other.mp4" })).rejects.toThrow("through the Posting tab");
    await owner(db);
    await db.exec("INSERT INTO storage.objects VALUES('posting','uploads/abc-clip.mp4','{}')");
    const row = await createReel(db);
    expect(row).toMatchObject({ kind: "reel", status: "new", targets: ["instagram", "youtube"], created_by: "aziz@maharamedia.com" });
    await expect(one(db, "SELECT cockpit_ceo_posting_create($1,$2::jsonb) AS result", [F, JSON.stringify({ kind: "reel", sourceKind: "url", sourceRef: "not a link" })])).rejects.toThrow("does not look like a link");
    await expect(one(db, "SELECT cockpit_ceo_posting_create($1,$2::jsonb) AS result", [F, JSON.stringify({ kind: "post", sourceKind: "image", sourceRef: "", images: ["uploads/abc-clip.mp4"], brief: "About", targets: ["youtube"] })])).rejects.toThrow("Instagram from here");
    await expect(one(db, "SELECT cockpit_ceo_posting_create($1,$2::jsonb) AS result", [O, JSON.stringify({ kind: "reel", sourceKind: "url", sourceRef: "https://x.test/v" })])).rejects.toThrow("Verified founder");
    await owner(db);
    expect((await db.query<any>("SELECT kind,post_id,status FROM cockpit_post_jobs")).rows).toEqual([{ kind: "prepare", post_id: row.id, status: "queued" }]);
    expect((await audit(db, "posting.create"))[0].metadata.what).toBe('Queued reel "Hook" for instagram and youtube');
    await actor(db, F);
    await expect(db.query("SELECT cockpit_ceo_posting_create($1,'{}'::jsonb)", [F])).rejects.toThrow();
    await expect(db.query("SELECT * FROM cockpit_posts")).rejects.toThrow();
  } finally {
    await db.close();
  }
});

test("save, queue, approve and discard follow the desk's status rules", async () => {
  const db = await fixture();
  try {
    await owner(db);
    await db.exec("INSERT INTO storage.objects VALUES('posting','uploads/abc-clip.mp4','{}')");
    const { id } = await createReel(db);
    const saved = await one(db, "SELECT cockpit_ceo_posting_save($1,$2,$3::jsonb) AS result", [F, id, JSON.stringify({ yt_title: "Title", yt_tags: ["a", "b"] })]);
    expect(saved).toMatchObject({ yt_title: "Title", yt_tags: ["a", "b"] });
    await expect(db.query("SELECT cockpit_ceo_posting_save($1,$2,$3::jsonb)", [F, id, JSON.stringify({ status: "published" })])).rejects.toThrow("cannot be edited here");
    expect((await audit(db, "posting.save"))[0].before).toEqual({ yt_title: null, yt_tags: [] });
    await asService(db);
    await expect(db.query("SELECT cockpit_ceo_posting_queue($1,$2,'render','{}'::jsonb)", [F, id])).rejects.toThrow("not being re-rendered");
    await owner(db);
    await db.query("UPDATE cockpit_posts SET status='ready' WHERE id=$1", [id]);
    await asService(db);
    const first = await one(db, "SELECT cockpit_ceo_posting_queue($1,$2,'render',$3::jsonb) AS result", [F, id, JSON.stringify({ thumb_text: "New line", frame_ms: 1200 })]);
    const again = await one(db, "SELECT cockpit_ceo_posting_queue($1,$2,'render',$3::jsonb) AS result", [F, id, JSON.stringify({ thumb_text: "New line", frame_ms: 1200 })]);
    expect(again).toEqual({ jobId: first.jobId, existing: true });
    const consent = await one(db, "SELECT cockpit_ceo_posting_queue($1,null,'youtube_auth',$2::jsonb) AS result", [F, JSON.stringify({ redirect_url: "http://localhost/?code=4/abc" })]);
    expect(consent.existing).toBe(false);
    await expect(db.query("SELECT cockpit_ceo_posting_approve($1,$2)", [F, id])).rejects.toThrow("Instagram needs a caption.");
    await one(db, "SELECT cockpit_ceo_posting_save($1,$2,$3::jsonb) AS result", [F, id, JSON.stringify({ ig_caption: "Caption" })]);
    const approved = await one(db, "SELECT cockpit_ceo_posting_approve($1,$2) AS result", [F, id]);
    expect(approved).toMatchObject({ status: "approved", approved_by: "aziz@maharamedia.com" });
    await expect(db.query("SELECT cockpit_ceo_posting_save($1,$2,$3::jsonb)", [F, id, JSON.stringify({ yt_title: "Late" })])).rejects.toThrow("cannot be edited any more");
    await owner(db);
    expect((await db.query<any>("SELECT kind,params FROM cockpit_post_jobs ORDER BY id")).rows.map(r => r.kind)).toEqual(["prepare", "render", "youtube_auth", "publish_youtube"]);
    expect((await db.query<any>("SELECT thumb_text FROM cockpit_posts WHERE id=$1", [id])).rows[0].thumb_text).toBe("New line");
    const consentAudit = (await audit(db, "posting.youtubeConnect"))[0];
    expect(JSON.stringify(consentAudit)).not.toContain("code=4/abc");
    await db.query("UPDATE cockpit_posts SET status='published' WHERE id=$1", [id]);
    await asService(db);
    await expect(db.query("SELECT cockpit_ceo_posting_discard($1,$2)", [F, id])).rejects.toThrow("stays on the list");
  } finally {
    await db.close();
  }
});

test("Instagram steps: one claim at a time, a worker write cannot drop a published ID, a failed container is dropped", async () => {
  const db = await fixture();
  try {
    await owner(db);
    await db.exec("INSERT INTO storage.objects VALUES('posting','uploads/abc-clip.mp4','{}')");
    const { id } = await createReel(db);
    await owner(db);
    await db.query("UPDATE cockpit_posts SET status='approved',ig_caption='Caption',yt_title='Title' WHERE id=$1", [id]);
    await asService(db);
    const stage = (name: string, value: Record<string, unknown> = {}) =>
      one(db, "SELECT cockpit_ceo_posting_instagram($1,$2,$3,$4::jsonb) AS result", [F, id, name, JSON.stringify(value)]);
    await stage("claim");
    await expect(stage("claim")).rejects.toThrow("already being published");
    expect((await stage("container", { container: "101" })).published).toMatchObject({ instagram: { container: "101" } });
    const published = await stage("published", { id: "9001", permalink: "https://www.instagram.com/reel/abc/", container: "101" });
    expect(published).toMatchObject({ status: "publishing", ig_lease_until: null, published: { instagram: { id: "9001" } } });
    expect((await stage("claim")).published.instagram.id).toBe("9001");
    // The YouTube worker writes `published` from its stale copy.
    await db.query(`UPDATE cockpit_posts SET published='{"instagram":{"container":"101"},"youtube":{"id":"yt1"}}'::jsonb,status='publishing' WHERE id=$1`, [id]);
    await owner(db);
    const after = (await db.query<any>("SELECT status,published FROM cockpit_posts WHERE id=$1", [id])).rows[0];
    expect(after.status).toBe("published");
    expect(after.published.instagram.id).toBe("9001");
    expect((await audit(db, "posting.publish"))[0].metadata.what).toBe("Published on Instagram: https://www.instagram.com/reel/abc/");

    const second = await createReel(db, { titleWorking: "Second" });
    await owner(db);
    await db.query("UPDATE cockpit_posts SET status='approved',ig_caption='Caption',yt_title='Title' WHERE id=$1", [second.id]);
    await asService(db);
    const step = (name: string, value: Record<string, unknown> = {}) =>
      one(db, "SELECT cockpit_ceo_posting_instagram($1,$2,$3,$4::jsonb) AS result", [F, second.id, name, JSON.stringify(value)]);
    await step("claim");
    await step("container", { container: "202" });
    const released = await step("release", { error: "Meta could not take the reel: ERROR", dropContainer: true });
    expect(released).toMatchObject({ error: "Meta could not take the reel: ERROR", ig_lease_until: null, published: {} });
    await expect(step("published", { id: "x", container: "202" })).rejects.toThrow("receipt is invalid");
  } finally {
    await db.close();
  }
});
