import { expect, test } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import { actor, cockpitTestDb, member, migration, owner } from "./lib/cockpitTestDb";

// The Social calendar on Supabase (20261009e): reads stay with any active
// seat, writes need the creative role or the CEO, a browser can only queue
// work Salma knows, every change is audited, and the client's sign-off link
// is made, marked and audited in one server call.
const CEO = "00000000-0000-4000-8000-000000000001";
const CREATIVE = "00000000-0000-4000-8000-000000000002";
const BUYER = "00000000-0000-4000-8000-000000000003";
const OTHER_CLIENTS = "00000000-0000-4000-8000-000000000004";
const TASK = "86c1abc";

function cut(sql: string, pattern: RegExp): string {
  const hit = sql.match(pattern);
  if (!hit) throw new Error(`Canonical definition missing: ${pattern}`);
  return hit[0];
}

async function fixture(): Promise<PGlite> {
  const db = await cockpitTestDb();
  try {
    await db.exec(`
      CREATE SCHEMA storage; CREATE SCHEMA extensions;
      CREATE TABLE storage.buckets (id text PRIMARY KEY, name text, public boolean,
        file_size_limit bigint, allowed_mime_types text[]);
      CREATE TABLE storage.objects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        bucket_id text, name text, owner uuid);
      ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
      GRANT USAGE ON SCHEMA storage, extensions TO authenticated, service_role;
      -- pgcrypto's gen_random_bytes, enough for a review token.
      CREATE FUNCTION extensions.gen_random_bytes(n integer) RETURNS bytea LANGUAGE sql AS
        $$ SELECT substring(decode(md5(random()::text) || md5(random()::text), 'hex') FROM 1 FOR n) $$;
      CREATE TABLE public.editor_clients (task_id text PRIMARY KEY, name text, status text);
      INSERT INTO public.editor_clients VALUES ('${TASK}', 'Qatar Technology', 'Active');
    `);
    await db.exec(cut(migration("20261007d_cockpit_team_rpc_restore.sql"),
      /create or replace function public\.cockpit_has_active_seat\(\)[\s\S]*?grant execute on function public\.cockpit_has_active_seat\(\) to authenticated,service_role;/));
    const review = migration("20260920c_review.sql");
    for (const t of ["review_links", "review_items", "review_notes"])
      await db.exec(cut(review, new RegExp(`create table if not exists public\\.${t} \\([\\s\\S]*?\\n\\);`)));
    await db.exec(cut(migration("20260921a_review_media.sql"), /alter table public\.review_items[\s\S]*?;/));
    for (const name of ["20260919f_social.sql", "20260919g_social_ghl.sql", "20260920a_social_images.sql",
      "20260923b_social_media_items.sql", "20260923c_social_aspect.sql"])
      await db.exec(migration(name));
    // Sections 1 to 3; section 4 revokes review functions this fixture does not need.
    await db.exec(migration("20260923d_social_accounts_signoff.sql").split("-- 4. Found on the way")[0]);
    for (const name of ["20260923g_social_publishing.sql", "20260924a_social_looks.sql",
      "20260924s_social_access.sql"])
      await db.exec(migration(name));
    await db.exec(cut(migration("20260926m_cockpit_csm_state.sql"),
      /CREATE OR REPLACE FUNCTION public\.cockpit_client_allowed\(p_name text\)[\s\S]*?END \$\$;/));
    const creative = migration("20261007c_cockpit_rpc_restore.sql");
    for (const fn of ["cockpit_creative_actor", "cockpit_review_client", "cockpit_review_create"])
      await db.exec(cut(creative, new RegExp(`CREATE OR REPLACE FUNCTION public\\.${fn}\\([\\s\\S]*?END \\$\\$;`)));
    await db.exec(`GRANT EXECUTE ON FUNCTION public.cockpit_client_allowed(text) TO authenticated;
      GRANT EXECUTE ON FUNCTION public.cockpit_review_create(text,text,text,text,text,jsonb,integer) TO authenticated;`);
    // A write door made by hand under another name must not survive, and a
    // read-only one must.
    await db.exec(`CREATE POLICY hand_made ON public.social_jobs FOR ALL TO authenticated USING (true) WITH CHECK (true);
      CREATE POLICY hand_read ON public.social_meta_pages FOR SELECT TO authenticated USING (true);`);
    await db.exec(migration("20261009e_social_native.sql"));
    await db.exec(`GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
      GRANT ALL ON ALL TABLES IN SCHEMA storage TO service_role;`);

    await member(db, CEO, "aziz@maharamedia.com", []);
    await member(db, CREATIVE, "creative@tests.invalid", ["creative"]);
    await member(db, BUYER, "buyer@tests.invalid", ["media_buyer"]);
    await member(db, OTHER_CLIENTS, "scoped@tests.invalid", ["creative"]);
    await db.query("UPDATE cockpit_members SET clients=ARRAY['Someone Else'] WHERE email='scoped@tests.invalid'");
    await db.exec(`
      INSERT INTO social_clients (client_task_id, active) VALUES ('${TASK}', true);
      INSERT INTO social_batches (id, client_task_id, month, status) VALUES ('${TASK}:2099-01', '${TASK}', '2099-01', 'planning');
      INSERT INTO social_posts (id, batch_id, client_task_id, n, pillar, topic, caption, media, status, scheduled_at) VALUES
        ('${TASK}:2099-01:1', '${TASK}:2099-01', '${TASK}', 1, 'craft', 'Glass', 'Ready caption',
         '[{"kind":"image","url":"https://x.invalid/1.jpg","source":"ai"}]', 'approved', '2099-01-10T07:00:00Z'),
        ('${TASK}:2099-01:2', '${TASK}:2099-01', '${TASK}', 2, 'craft', 'Reel', 'Reel caption',
         '[{"kind":"video","url":"https://x.invalid/2.mp4","source":"upload","cover":"https://x.invalid/2.jpg"}]', 'approved', '2099-01-05T07:00:00Z'),
        ('${TASK}:2099-01:3', '${TASK}:2099-01', '${TASK}', 3, 'craft', 'Unwritten', NULL,
         '[{"kind":"image","url":"https://x.invalid/3.jpg","source":"ai"}]', 'approved', '2099-01-12T07:00:00Z');
    `);
    return db;
  } catch (error) { await db.close(); throw error; }
}

async function audits(db: PGlite, where = "true") {
  await owner(db);
  return (await db.query<{ action: string; entity_type: string; entity_id: string; actor_email: string }>(
    `SELECT action, entity_type, entity_id, actor_email FROM cockpit_audit_log WHERE ${where} ORDER BY created_at, id`)).rows;
}

const queue = (who: string, kind: string, status = "queued", attempts = 0) =>
  `INSERT INTO social_jobs (id, kind, post_id, params, status, attempts, requested_by)
   VALUES ('${kind.replaceAll("'", "")}:${TASK}:2099-01:1', '${kind}', '${TASK}:2099-01:1', '{}',
           '${status}', ${attempts}, '${who}')`;

test("a creative seat changes posts and queues Salma's work, and each change is audited", async () => {
  const db = await fixture();
  try {
    const before = (await audits(db)).length;
    await actor(db, CREATIVE);
    await db.exec(`UPDATE social_posts SET caption='Better caption' WHERE id='${TASK}:2099-01:1'`);
    await db.exec(queue("creative@tests.invalid", "caption"));
    // Pressing it again re-queues the same id rather than adding a second.
    await db.exec(`INSERT INTO social_jobs (id, kind, status, attempts, requested_by)
      VALUES ('caption:${TASK}:2099-01:1', 'caption', 'queued', 0, 'creative@tests.invalid')
      ON CONFLICT (id) DO UPDATE SET status='queued', attempts=0, error=NULL`);
    await db.exec(`INSERT INTO social_assets (id, client_task_id, kind, url) VALUES ('a1', '${TASK}', 'photo', 'https://x.invalid/p.jpg')`);
    await db.exec("UPDATE social_assets SET active=false WHERE id='a1'");
    const rows = (await audits(db)).slice(before);
    expect(rows.map(r => [r.action, r.entity_type, r.entity_id])).toEqual([
      ["UPDATE", "social_posts", `${TASK}:2099-01:1`],
      ["INSERT", "social_jobs", `caption:${TASK}:2099-01:1`],
      ["UPDATE", "social_jobs", `caption:${TASK}:2099-01:1`],
      ["INSERT", "social_assets", "a1"],
      ["UPDATE", "social_assets", "a1"],
    ]);
    expect(rows.every(r => r.actor_email === "creative@tests.invalid")).toBe(true);
  } finally { await db.close(); }
});

test("a browser can only ask for work Salma knows, and never says how it went", async () => {
  const db = await fixture();
  try {
    await actor(db, CREATIVE);
    for (const kind of ["animate", "publish", "Caption"])
      await expect(db.exec(queue("c", kind))).rejects.toThrow(/row-level security/);
    for (const status of ["done", "running", "failed"])
      await expect(db.exec(queue("c", "caption", status))).rejects.toThrow(/row-level security/);
    await expect(db.exec(queue("c", "caption", "queued", 3))).rejects.toThrow(/row-level security/);
    await db.exec(queue("c", "words"));
    await expect(db.exec(`UPDATE social_jobs SET status='done' WHERE id='words:${TASK}:2099-01:1'`))
      .rejects.toThrow(/row-level security/);
    await expect(db.exec(`DELETE FROM social_jobs WHERE id='words:${TASK}:2099-01:1'`))
      .rejects.toThrow(/permission denied/);
    await expect(db.exec("INSERT INTO social_meta_pages (page_id, name) VALUES ('p', 'Page')"))
      .rejects.toThrow(/permission denied/);
    await expect(db.exec(`DELETE FROM social_clients WHERE client_task_id='${TASK}'`))
      .rejects.toThrow(/permission denied/);

    // Salma, on the service key, still moves its own jobs, and is audited by role.
    await owner(db);
    await db.query("SELECT set_config('request.jwt.claim.sub','',false)");
    await db.query("SELECT set_config('request.jwt.claims',$1,false)", [JSON.stringify({ role: "service_role" })]);
    await db.exec("SET ROLE service_role");
    await db.exec(`UPDATE social_jobs SET status='running', attempts=1 WHERE id='words:${TASK}:2099-01:1'`);
    const last = (await audits(db, "entity_type='social_jobs'")).at(-1);
    expect(last).toMatchObject({ action: "UPDATE", actor_email: "service_role" });
  } finally { await db.close(); }
});

test("other seats read the calendar but cannot change it; a signed-out visitor sees nothing", async () => {
  const db = await fixture();
  try {
    await actor(db, BUYER);
    const seen = (await db.query<{ n: number }>("SELECT count(*)::int AS n FROM social_posts")).rows[0]!.n;
    expect(seen).toBe(3);
    await expect(db.exec(`INSERT INTO social_posts (id, batch_id, client_task_id, pillar) VALUES ('x', 'b', '${TASK}', 'craft')`))
      .rejects.toThrow(/row-level security/);
    const changed = await db.query(`UPDATE social_posts SET caption='no' WHERE id='${TASK}:2099-01:1' RETURNING id`);
    expect(changed.rows).toEqual([]);
    await expect(db.exec(queue("buyer", "caption"))).rejects.toThrow(/row-level security/);
    await expect(db.query("SELECT public.cockpit_social_send_signoff($1,'2099-01',ARRAY[$2],NULL)",
      [TASK, `${TASK}:2099-01:1`])).rejects.toThrow(/Only the creative team/);

    await actor(db, null);
    await expect(db.query("SELECT * FROM social_posts")).rejects.toThrow(/permission denied/);

    // The CEO may change it.
    await actor(db, CEO);
    const ceo = await db.query(`UPDATE social_posts SET topic='CEO' WHERE id='${TASK}:2099-01:1' RETURNING id`);
    expect(ceo.rows).toHaveLength(1);
  } finally { await db.close(); }
});

test("a post GoHighLevel holds cannot be deleted from the browser", async () => {
  const db = await fixture();
  try {
    await owner(db);
    await db.exec(`UPDATE social_posts SET ghl_post_id='g1' WHERE id='${TASK}:2099-01:2'`);
    await actor(db, CREATIVE);
    expect((await db.query(`DELETE FROM social_posts WHERE id='${TASK}:2099-01:2' RETURNING id`)).rows).toEqual([]);
    expect((await db.query(`DELETE FROM social_posts WHERE id='${TASK}:2099-01:3' RETURNING id`)).rows).toHaveLength(1);
    const del = (await audits(db, "action='DELETE'"));
    expect(del).toEqual([expect.objectContaining({ entity_id: `${TASK}:2099-01:3`, actor_email: "creative@tests.invalid" })]);
  } finally { await db.close(); }
});

test("the sign-off link is made, the finished posts marked, and it is audited in one call", async () => {
  const db = await fixture();
  try {
    await actor(db, CREATIVE);
    const out = (await db.query<{ r: Record<string, unknown> }>(
      "SELECT public.cockpit_social_send_signoff($1,'2099-01',$2::text[],'  Have a look  ') AS r",
      [TASK, [`${TASK}:2099-01:1`, `${TASK}:2099-01:2`, `${TASK}:2099-01:3`, "not-a-post"]])).rows[0]!.r;
    const token = String(out.token);
    expect(token.length).toBeGreaterThan(10);
    expect(out).toMatchObject({ sent: 2, skipped: 2, posts: [`${TASK}:2099-01:2`, `${TASK}:2099-01:1`] });

    await owner(db);
    const link = (await db.query<Record<string, unknown>>(
      "SELECT title, note, client_name, client_task_id, created_by FROM review_links WHERE token=$1", [token])).rows[0];
    expect(link).toEqual({ title: "January posts", note: "Have a look", client_name: "Qatar Technology",
      client_task_id: TASK, created_by: "creative@tests.invalid" });
    const items = (await db.query<Record<string, unknown>>(
      "SELECT n, kind, post_id, title, video_url, poster_url FROM review_items WHERE token=$1 ORDER BY n", [token])).rows;
    expect(items).toEqual([
      { n: 1, kind: "post", post_id: `${TASK}:2099-01:2`, title: "Reel", video_url: "https://x.invalid/2.jpg", poster_url: "https://x.invalid/2.jpg" },
      { n: 2, kind: "post", post_id: `${TASK}:2099-01:1`, title: "Glass", video_url: "https://x.invalid/1.jpg", poster_url: null },
    ]);
    const posts = (await db.query<{ id: string; client_status: string | null; review_token: string | null }>(
      "SELECT id, client_status, review_token FROM social_posts ORDER BY n")).rows;
    expect(posts).toEqual([
      { id: `${TASK}:2099-01:1`, client_status: "sent", review_token: token },
      { id: `${TASK}:2099-01:2`, client_status: "sent", review_token: token },
      { id: `${TASK}:2099-01:3`, client_status: null, review_token: null },
    ]);
    const sent = await audits(db, "action='social.signoff.send'");
    expect(sent).toEqual([{ action: "social.signoff.send", entity_type: "social_batch",
      entity_id: `${TASK}:2099-01`, actor_email: "creative@tests.invalid" }]);
    // The batch is not moved: the link is made, a person sends it.
    expect((await db.query<{ status: string }>("SELECT status FROM social_batches")).rows[0]!.status).toBe("planning");
  } finally { await db.close(); }
});

test("sign-off refuses unfinished posts, other clients' seats and bad input, and leaves nothing behind", async () => {
  const db = await fixture();
  try {
    await actor(db, CREATIVE);
    await expect(db.query("SELECT public.cockpit_social_send_signoff($1,'2099-01',ARRAY[$2],NULL)",
      [TASK, `${TASK}:2099-01:3`])).rejects.toThrow(/None of those posts is finished yet/);
    await expect(db.query("SELECT public.cockpit_social_send_signoff($1,'2099-13',ARRAY['x'],NULL)", [TASK]))
      .rejects.toThrow(/not a month/);
    await expect(db.query("SELECT public.cockpit_social_send_signoff($1,'2099-01','{}',NULL)", [TASK]))
      .rejects.toThrow(/at least one post/);
    await actor(db, OTHER_CLIENTS);
    await expect(db.query("SELECT public.cockpit_social_send_signoff($1,'2099-01',ARRAY[$2],NULL)",
      [TASK, `${TASK}:2099-01:1`])).rejects.toThrow(/assigned client/);
    await owner(db);
    expect((await db.query<{ n: number }>("SELECT count(*)::int AS n FROM review_links")).rows[0]!.n).toBe(0);
    expect((await db.query<{ n: number }>("SELECT count(*)::int AS n FROM social_posts WHERE client_status IS NOT NULL")).rows[0]!.n).toBe(0);
  } finally { await db.close(); }
});

test("the only write doors left are the creative ones", async () => {
  const db = await fixture();
  try {
    await owner(db);
    const rows = (await db.query<{ t: string; p: string; cmd: string }>(
      `SELECT tablename AS t, policyname AS p, cmd FROM pg_policies
        WHERE schemaname='public' AND tablename LIKE 'social\\_%' ORDER BY 1, 2`)).rows;
    const writes = rows.filter(r => r.cmd !== "SELECT").map(r => `${r.t}.${r.p}.${r.cmd}`);
    expect(writes).toEqual([
      "social_assets.social_assets_change.UPDATE", "social_assets.social_assets_write.INSERT",
      "social_bank.social_bank_change.UPDATE", "social_bank.social_bank_write.INSERT",
      "social_batches.social_batches_change.UPDATE", "social_batches.social_batches_write.INSERT",
      "social_clients.social_clients_change.UPDATE", "social_clients.social_clients_write.INSERT",
      "social_jobs.social_jobs_change.UPDATE", "social_jobs.social_jobs_write.INSERT",
      "social_posts.social_posts_change.UPDATE", "social_posts.social_posts_remove.DELETE",
      "social_posts.social_posts_write.INSERT",
    ]);
    expect(rows.some(r => r.p === "hand_made")).toBe(false);
    expect(rows.some(r => r.p === "hand_read")).toBe(true);
    // Running it twice changes nothing.
    await db.exec(migration("20261009e_social_native.sql"));
    const again = (await db.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM pg_policies WHERE schemaname='public' AND tablename LIKE 'social\\_%'")).rows[0]!.n;
    expect(again).toBe(rows.length);
  } finally { await db.close(); }
});

test("uploads to the social bucket need the same role", async () => {
  const db = await fixture();
  try {
    await actor(db, CREATIVE);
    await db.exec(`INSERT INTO storage.objects (bucket_id, name) VALUES ('social-media', '${TASK}/2099-01/a.jpg')`);
    await expect(db.exec("INSERT INTO storage.objects (bucket_id, name) VALUES ('cockpit-people', 'x.jpg')"))
      .rejects.toThrow(/row-level security/);
    await actor(db, BUYER);
    await expect(db.exec(`INSERT INTO storage.objects (bucket_id, name) VALUES ('social-media', '${TASK}/b.jpg')`))
      .rejects.toThrow(/row-level security/);
  } finally { await db.close(); }
});
