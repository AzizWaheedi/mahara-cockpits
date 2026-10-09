import { expect, test } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import { actor, cockpitTestDb, member, migration, owner } from "./lib/cockpitTestDb";

// supabase/migrations/20261009i_ai_comment_watch_call_briefs.sql against the
// canonical SQL it builds on: the Ask AI queue (20260927a), the media and CSM
// source feeds (20260927w/v), the call briefs table (20261005f), the native
// feed run lease (20260927x) and the freshness rows (20260921e).

const MEMBER = "00000000-0000-4000-8000-000000000001";
const SNAPSHOT = "2026-10-07T10:00:00Z";

function extract(file: string, pattern: RegExp): string {
  const hit = migration(file).match(pattern);
  if (!hit) throw new Error(`Canonical definition missing in ${file}: ${pattern}`);
  return hit[0];
}

function watchMigration(): string {
  const text = migration("20261009i_ai_comment_watch_call_briefs.sql");
  const start = text.indexOf("-- cron:begin");
  const end = text.indexOf("-- cron:end");
  if (start < 0 || end < start) throw new Error("The schedule block is missing its markers");
  // pg_cron, pg_net and the vault are not in the test engine.
  return text.slice(0, start) + text.slice(end + "-- cron:end".length);
}

const call = (url: string, title: string, at: string) => ({ url, title, at, kind: "client", summary: `${title} summary`, external: [] });
const PROFILES = [
  { _id: "p-acme", clientName: "Acme", taskId: "t1", calls: [call("https://fathom.video/share/a2", "Acme weekly", "2026-10-08"), call("https://fathom.video/share/a1", "Acme kickoff", "2026-10-01")] },
  { _id: "p-beta", clientName: "Beta", taskId: "t2", calls: [call("https://fathom.video/share/b1", "Beta check-in", "2026-10-02")] },
  { _id: "p-gamma", clientName: "Gamma", taskId: "t3", calls: [call("https://fathom.video/share/g1", "Gamma review", "2026-10-03")] },
  { _id: "p-delta", clientName: "Delta", taskId: "t4", calls: [] },
];

async function fixture() {
  const db = await cockpitTestDb();
  await db.exec(extract("20260923o_cockpit_domain_tables.sql", /CREATE TABLE IF NOT EXISTS public\.cockpit_client_profiles \([\s\S]*?\n\);/));
  await db.exec(migration("20260926m_cockpit_csm_state.sql"));
  await db.exec(migration("20260927a_cockpit_ask_ai_jobs.sql"));
  const media = migration("20260927w_media_read_models.sql");
  await db.exec(media.slice(media.indexOf("CREATE TABLE IF NOT EXISTS public.cockpit_media_source_state"), media.indexOf("CREATE OR REPLACE FUNCTION public.cockpit_media_source_read()")));
  for (const pattern of [
    /CREATE TABLE IF NOT EXISTS public\.cockpit_csm_source_state\([^;]*\);/,
    /INSERT INTO public\.cockpit_csm_source_state[^;]*;/,
    /CREATE TABLE IF NOT EXISTS public\.cockpit_csm_sources\([^;]*\);/,
  ]) await db.exec(extract("20260927v_csm_read_models.sql", pattern));
  for (const pattern of [
    /CREATE TABLE IF NOT EXISTS public\.cockpit_media_call_briefs \([\s\S]*?\n\);/,
    /CREATE UNIQUE INDEX IF NOT EXISTS cockpit_media_call_briefs_source_identity[^;]*;/,
    /CREATE TRIGGER cockpit_call_briefs_audit[^;]*;/,
  ]) await db.exec(extract("20261005f_cockpit_csm_history.sql", pattern));
  await db.exec("GRANT SELECT,INSERT,UPDATE ON public.cockpit_media_call_briefs TO service_role;");
  await db.exec(extract("20260927x_cockpit_native_media_sync.sql", /CREATE TABLE IF NOT EXISTS public\.cockpit_native_media_runs \([\s\S]*?\n\);/));
  await db.exec(extract("20260921e_tap_charges.sql", /create table if not exists public\.cockpit_sync_state \([\s\S]*?\n\);/i));
  await db.exec(watchMigration());
  // Applying it twice changes nothing.
  await db.exec(watchMigration());

  await member(db, MEMBER, "nada@tests.invalid", ["media_buyer"]);
  await owner(db);
  // The feeds as the Convex import left them: one imported digest, imported briefs.
  await db.query("UPDATE cockpit_media_source_state SET ready=true,row_count=1,source_snapshot_at=$1 WHERE table_name='clientComments'", [SNAPSHOT]);
  await db.query("INSERT INTO cockpit_media_sources(table_name,source_id,client_names,data,source_snapshot_at) VALUES('clientComments','kconvex1','{Acme}',$1::jsonb,$2)", [
    JSON.stringify({ _id: "kconvex1", taskId: "t1", clientName: "Acme", commentId: "111", at: 1759800000000, kind: "call", status: "done", digest: { summary: "Imported" } }),
    SNAPSHOT,
  ]);
  await db.query("UPDATE cockpit_csm_source_state SET ready=true,row_count=$1,source_snapshot_at=$2 WHERE table_name='clientProfiles'", [PROFILES.length, SNAPSHOT]);
  for (const p of PROFILES)
    await db.query("INSERT INTO cockpit_csm_sources(table_name,source_id,client_names,data,source_snapshot_at) VALUES('clientProfiles',$1,$2,$3::jsonb,$4)", [p._id, [p.clientName], JSON.stringify(p), SNAPSHOT]);
  await db.exec(`
    INSERT INTO cockpit_media_call_briefs(client_name,key,status,overall,per_call,at,source_deployment,source_id)
    VALUES('Beta','https://fathom.video/share/b1','done','Human edited overall','[]','2026-10-05','adorable','kbrief-b'),
          ('Gamma','https://fathom.video/share/g1','queued',NULL,'[]','2026-10-05','adorable','kbrief-g');`);
  return db;
}

async function service(db: PGlite) {
  await owner(db);
  await db.exec("SET ROLE service_role");
}
async function one<T = any>(db: PGlite, sql: string, params: unknown[] = []): Promise<T> {
  return (await db.query<{ r: T }>(sql, params)).rows[0].r;
}
const record = (db: PGlite, items: unknown[]) => one(db, "select cockpit_comment_watch_record($1::jsonb) as r", [JSON.stringify(items)]);
const tick = (db: PGlite) => one(db, "select cockpit_ai_watch_tick() as r");
const claim = async (db: PGlite, worker: string, kinds: string[], limit = 5) =>
  (await db.query<any>("select * from cockpit_claim_ask_ai_jobs($1,$2::text[],$3,300)", [worker, kinds, limit])).rows;
const complete = (db: PGlite, job: any, worker: string, result: unknown) =>
  one<boolean>(db, "select cockpit_complete_ask_ai_job($1,$2,$3::jsonb,$4) as r", [job.id, job.lease_token, JSON.stringify(result), worker]);

const now = Date.now();
const comment = (id: string, extra: Record<string, unknown> = {}) => ({
  commentId: id, taskId: "t1", clientName: "Acme", at: String(now - 3_600_000), by: "Sara", kind: "call", prompt: `Digest comment ${id}`, ...extra,
});
const digest = (extra: Record<string, unknown> = {}) => ({
  summary: "They agreed to a new offer.", nextSteps: ["Mahara: send the new script"], clientRequests: ["A villa video"],
  risks: [], forAds: ["Target villa owners in Kuwait City", "Mention the contract value"], forCreative: ["Film the showroom"],
  dos: ["Show finished villas"], donts: ["Don't promise prices"], ...extra,
});

test("comments are recorded once, imported ones count as seen, and only fresh client updates are queued", async () => {
  const db = await fixture();
  try {
    await service(db);
    const first = await record(db, [
      comment("201"),
      comment("202", { kind: "skip", by: "ClickBot", prompt: undefined }),
      comment("203", { kind: "note", at: String(now - 30 * 86_400_000) }),
      comment("111"),
    ]);
    expect(first).toEqual({ recorded: 3, queued: 1, skipped: 2, known: 1, deferred: 0 });
    expect(await record(db, [comment("201"), comment("202"), comment("203")])).toEqual({ recorded: 0, queued: 0, skipped: 0, known: 3, deferred: 0 });
    expect(await one(db, "select cockpit_comment_watch_seen(array['111','201','999']) as r")).toEqual(["111", "201"]);
    const items = (await db.query<any>("select comment_id,status,skip_reason,job_id from cockpit_comment_watch_items order by comment_id")).rows;
    expect(items.map(i => [i.comment_id, i.status])).toEqual([["201", "queued"], ["202", "skipped"], ["203", "skipped"]]);
    expect(items[2].skip_reason).toContain("21 days");
    const job = (await db.query<any>("select * from cockpit_ask_ai_jobs where kind='comment_digest'")).rows;
    expect(job).toHaveLength(1);
    expect(job[0]).toMatchObject({ auth_user_id: null, app: "media-buyer", role: "media_buyer", client_name: "Acme", idempotency_key: "comment:201", prompt: "Digest comment 201" });
    expect(job[0].context).toMatchObject({ source: "comment-watch", commentId: "201", taskId: "t1", commentKind: "call" });
    expect(job[0].context.schema.required).toHaveLength(8);
    await expect(record(db, [comment("204", { prompt: "" })])).rejects.toThrow(/needs its prompt/);
    await expect(record(db, [comment("bad id!")])).rejects.toThrow(/Every comment needs/);
    await owner(db);
    expect((await db.query("select * from cockpit_audit_log where entity_type='cockpit_comment_watch_items'")).rows.length).toBe(3);
  } finally {
    await db.close();
  }
});

test("background jobs go only to a worker that names their kind, wait behind chat, and keep their contract", async () => {
  const db = await fixture();
  try {
    await service(db);
    await record(db, [comment("301")]);
    await actor(db, MEMBER);
    const chatId = await one<string>(db, "select cockpit_submit_ask_ai_job('media-buyer','media_buyer','How is Acme doing?',NULL,'chat','{}'::jsonb,NULL) as r");
    await service(db);
    const [chat] = await claim(db, "w", ["chat", "comment_digest"], 1);
    expect(chat.id).toBe(chatId);
    // A worker installed before this migration claims chat only.
    expect((await db.query("select * from cockpit_claim_ask_ai_jobs('old-worker',5,300)")).rows).toHaveLength(0);
    expect(await claim(db, "w", ["chat"])).toHaveLength(0);
    const [job] = await claim(db, "w", ["comment_digest"]);
    expect(job.kind).toBe("comment_digest");
    expect(job.prompt).toBe("Digest comment 301");
    expect(job.context.commentId).toBe("301");
    await expect(claim(db, "w", ["chat", "anything"])).rejects.toThrow(/Invalid job kinds/);
    await expect(complete(db, job, "w", { reply: "Not a digest" })).rejects.toThrow(/Invalid comment_digest answer/);
    await expect(complete(db, job, "w", { ...digest(), extra: [] })).rejects.toThrow(/exactly these keys/);
    await expect(complete(db, job, "w", digest({ risks: [42] }))).rejects.toThrow(/risks must hold only lines/);
    await expect(complete(db, job, "w", digest({ summary: "x".repeat(2001) }))).rejects.toThrow(/summary/);
    expect(await complete(db, job, "other-worker", digest())).toBe(false);
    expect(await complete(db, job, "w", digest())).toBe(true);
    // Chat answers are unchanged.
    await expect(complete(db, chat, "w", digest())).rejects.toThrow(/Nonempty chat answer/);
    expect(await complete(db, chat, "w", { reply: "Acme is on track." })).toBe(true);
  } finally {
    await db.close();
  }
});

test("chat keeps every 20260927a rule under the redefined claim, complete and fail", async () => {
  const db = await fixture();
  try {
    const submit = async (prompt: string) => {
      await actor(db, MEMBER);
      const id = await one<string>(db, "select cockpit_submit_ask_ai_job('media-buyer','media_buyer',$1,NULL,'chat','{}'::jsonb,NULL) as r", [prompt]);
      await service(db);
      return id;
    };
    const first = await submit("Question one");
    const [old] = (await db.query<any>("select * from cockpit_claim_ask_ai_jobs('old')")).rows;
    expect(old).toMatchObject({ id: first, attempts: 1, kind: "chat" });
    expect(old.context.read_only).toBe(true);
    await owner(db);
    expect((await db.query<any>("select scope_fingerprint from cockpit_ask_ai_jobs where id=$1", [first])).rows[0].scope_fingerprint).toBeTruthy();
    await db.exec("update cockpit_ask_ai_jobs set lease_expires_at=now()-interval '1 minute'");
    await service(db);
    expect(await complete(db, old, "old", { reply: "Late" })).toBe(false);
    const [fresh] = (await db.query<any>("select * from cockpit_claim_ask_ai_jobs('new')")).rows;
    expect(fresh.attempts).toBe(2);
    expect(await one(db, "select cockpit_fail_ask_ai_job($1,$2,'Temporary','new') as r", [fresh.id, fresh.lease_token])).toBe(true);
    const [last] = (await db.query<any>("select * from cockpit_claim_ask_ai_jobs('last')")).rows;
    expect(last.attempts).toBe(3);
    await db.query("select cockpit_fail_ask_ai_job($1,$2,'Still unavailable','last')", [last.id, last.lease_token]);
    expect((await db.query("select * from cockpit_claim_ask_ai_jobs('never')")).rows).toHaveLength(0);

    const second = await submit("Question two");
    const [held] = (await db.query<any>("select * from cockpit_claim_ask_ai_jobs('w')")).rows;
    expect(held.id).toBe(second);
    await owner(db);
    await db.query("update cockpit_members set active=false where auth_user_id=$1", [MEMBER]);
    await service(db);
    expect(await complete(db, held, "w", { reply: "Old access" })).toBe(false);
    expect(await claim(db, "w", ["chat", "comment_digest", "call_brief"])).toHaveLength(0);
    await owner(db);
    expect((await db.query<any>("select status,error from cockpit_ask_ai_jobs order by created_at")).rows).toEqual([
      { status: "failed", error: "Still unavailable" },
      { status: "failed", error: "Owner no longer has access" },
    ]);
  } finally {
    await db.close();
  }
});

test("a failed background job is tried three times, then the comment is marked failed and published as failed", async () => {
  const db = await fixture();
  try {
    await service(db);
    await record(db, [comment("401")]);
    for (let attempt = 1; attempt <= 3; attempt++) {
      const [job] = await claim(db, `w${attempt}`, ["comment_digest"]);
      expect(job.attempts).toBe(attempt);
      expect(await one(db, "select cockpit_fail_ask_ai_job($1,$2,'Model unavailable',$3) as r", [job.id, job.lease_token, `w${attempt}`])).toBe(true);
    }
    expect(await claim(db, "w4", ["comment_digest"])).toHaveLength(0);
    const out = await tick(db);
    expect(out).toMatchObject({ failed: 1, commentsPublished: 1 });
    await owner(db);
    const row = (await db.query<any>("select data from cockpit_media_sources where source_id='clickup:401'")).rows[0];
    expect(row.data).toMatchObject({ status: "failed", commentId: "401", by: "Sara", kind: "call" });
    expect(row.data.digest).toBeUndefined();
  } finally {
    await db.close();
  }
});

test("the tick settles answers, waits while a native feed run holds its lease, then publishes into the media feed", async () => {
  const db = await fixture();
  try {
    await service(db);
    await record(db, [comment("501"), comment("502", { kind: "note" })]);
    const jobs = await claim(db, "w", ["comment_digest"]);
    const byComment = Object.fromEntries(jobs.map((j: any) => [j.context.commentId, j]));
    expect(await complete(db, byComment["501"], "w", digest())).toBe(true);
    expect(await complete(db, byComment["502"], "w", digest({ dos: [], donts: [] }))).toBe(true);

    await owner(db);
    await db.exec("INSERT INTO cockpit_native_media_runs(run_id,lease_token,status,lease_expires_at) VALUES(gen_random_uuid(),gen_random_uuid(),'claimed',now()+interval '20 minutes')");
    const manifestBefore = (await db.query<any>("select md5(jsonb_agg(to_jsonb(s) order by source_id)::text) as h from cockpit_media_sources s")).rows[0].h;
    await service(db);
    const blocked = await tick(db);
    expect(blocked).toMatchObject({ settled: 2, busy: true, commentsPublished: 0 });
    expect(blocked.note).toContain("native feed run is in progress");
    await owner(db);
    expect((await db.query<any>("select md5(jsonb_agg(to_jsonb(s) order by source_id)::text) as h from cockpit_media_sources s")).rows[0].h).toBe(manifestBefore);
    const settled = (await db.query<any>("select comment_id,status,rules_state,rules_added,published_status from cockpit_comment_watch_items order by comment_id")).rows;
    expect(settled).toEqual([
      { comment_id: "501", status: "done", rules_state: null, rules_added: null, published_status: null },
      { comment_id: "502", status: "done", rules_state: "unchanged", rules_added: 0, published_status: null },
    ]);

    // The run published: the lease is gone.
    await db.exec("UPDATE cockpit_native_media_runs SET status='published'");
    await service(db);
    expect(await tick(db)).toMatchObject({ busy: false, commentsPublished: 2 });
    expect(await tick(db)).toMatchObject({ commentsPublished: 0 });
    await owner(db);
    const state = (await db.query<any>("select row_count,source_snapshot_at from cockpit_media_source_state where table_name='clientComments'")).rows[0];
    const rows = (await db.query<any>("select source_id,client_names,data,source_snapshot_at from cockpit_media_sources where table_name='clientComments' order by source_id")).rows;
    // The feed's own checks: every row on the feed's stamp, and the count matches.
    expect(state.row_count).toBe(3);
    expect(rows.every((r: any) => new Date(r.source_snapshot_at).getTime() === new Date(state.source_snapshot_at).getTime())).toBe(true);
    const mirrored = rows.find((r: any) => r.source_id === "clickup:501");
    expect(mirrored.client_names).toEqual(["Acme"]);
    expect(mirrored.data).toMatchObject({ _id: "clickup:501", taskId: "t1", clientName: "Acme", commentId: "501", kind: "call", status: "done", by: "Sara" });
    expect(mirrored.data.digest.forAds).toEqual(digest().forAds);
    expect(mirrored.data.at).toBe(Number(comment("501").at));
    expect(rows.find((r: any) => r.source_id === "kconvex1").data.digest.summary).toBe("Imported");
    expect((await db.query("select * from cockpit_audit_log where entity_type='cockpit_media_sources' and entity_id='clickup:501'")).rows).toHaveLength(1);
    const fresh = (await db.query<any>("select ok,note from cockpit_sync_state where key='ai-watch-tick'")).rows[0];
    expect(fresh.ok).toBe(true);
  } finally {
    await db.close();
  }
});

test("rules wait for the card write: planned in a dry run, written once, never listed again", async () => {
  const db = await fixture();
  try {
    await service(db);
    await record(db, [comment("601")]);
    const [job] = await claim(db, "w", ["comment_digest"]);
    await complete(db, job, "w", digest());
    await tick(db);
    const pending = await one<any[]>(db, "select cockpit_comment_watch_rules_pending(false,15) as r");
    expect(pending).toEqual([{ commentId: "601", taskId: "t1", clientName: "Acme", kind: "call", at: Number(comment("601").at), dos: ["Show finished villas"], donts: ["Don't promise prices"], state: null }]);
    const planned = { old: "DO\n- Old rule", new: "DO\n- Old rule\n- Show finished villas (Call, 2026-10-09)" };
    expect(await one(db, "select cockpit_comment_watch_rules_result('601','dry_run',$1::jsonb) as r", [JSON.stringify(planned)])).toBe(true);
    expect(await one<any[]>(db, "select cockpit_comment_watch_rules_pending(false,15) as r")).toEqual([]);
    expect((await one<any[]>(db, "select cockpit_comment_watch_rules_pending(true,15) as r")).map(r => r.state)).toEqual(["dry_run"]);
    expect(await one(db, "select cockpit_comment_watch_rules_result('601','written',$1::jsonb,2) as r", [JSON.stringify(planned)])).toBe(true);
    expect(await one<any[]>(db, "select cockpit_comment_watch_rules_pending(true,15) as r")).toEqual([]);
    expect(await one(db, "select cockpit_comment_watch_rules_result('601','written',$1::jsonb,2) as r", [JSON.stringify(planned)])).toBe(false);
    await expect(one(db, "select cockpit_comment_watch_rules_result('601','sent','{}'::jsonb) as r")).rejects.toThrow(/Unknown rules state/);
    await owner(db);
    expect((await db.query<any>("select rules_state,rules_added from cockpit_comment_watch_items where comment_id='601'")).rows[0]).toEqual({ rules_state: "written", rules_added: 2 });
  } finally {
    await db.close();
  }
});

test("call briefs come from the published profiles, publish new rows and never change a done imported row", async () => {
  const db = await fixture();
  try {
    await service(db);
    const plan = await one<any>(db, "select cockpit_call_brief_enqueue(10,true) as r");
    expect(plan.planned.map((p: any) => p.clientName)).toEqual(["Acme", "Gamma"]);
    expect(plan.planned[0].key).toBe("https://fathom.video/share/a1|https://fathom.video/share/a2");
    expect(await one(db, "select count(*)::int as r from cockpit_ask_ai_jobs")).toBe(0);

    expect(await tick(db)).toMatchObject({ briefsQueued: 2, briefsPublished: 0 });
    expect(await tick(db)).toMatchObject({ briefsQueued: 0 });
    const jobs = await claim(db, "w", ["call_brief"]);
    expect(jobs).toHaveLength(2);
    const acme = jobs.find((j: any) => j.client_name === "Acme");
    const gamma = jobs.find((j: any) => j.client_name === "Gamma");
    expect(acme.context).toMatchObject({ clientName: "Acme", taskId: "t1", key: "https://fathom.video/share/a1|https://fathom.video/share/a2", urls: ["https://fathom.video/share/a2", "https://fathom.video/share/a1"] });
    expect(acme.prompt).toContain("Client: Acme");
    expect(acme.prompt).toContain("Acme weekly summary");
    expect(acme.prompt).toContain('Return JSON: {"overall": "...", "perCall"');
    await expect(complete(db, acme, "w", { overall: "Fine", perCall: [{ url: "https://fathom.video/share/zz", brief: "Other" }] })).rejects.toThrow(/not in this job/);
    await expect(complete(db, acme, "w", { overall: " ", perCall: [] })).rejects.toThrow(/overall must be text/);
    await expect(complete(db, acme, "w", { overall: "Fine", perCall: [{ url: "https://fathom.video/share/a1", brief: "One" }, { url: "https://fathom.video/share/a1", brief: "Two" }] })).rejects.toThrow(/twice/);
    const acmeBrief = { overall: "Acme is happy with the leads.", perCall: [{ url: "https://fathom.video/share/a2", brief: "They asked for a villa video." }] };
    expect(await complete(db, acme, "w", acmeBrief)).toBe(true);
    expect(await complete(db, gamma, "w", { overall: "Gamma wants more leads.", perCall: [] })).toBe(true);

    expect(await tick(db)).toMatchObject({ briefsPublished: 2, briefsKept: 0 });
    expect(await tick(db)).toMatchObject({ briefsPublished: 0 });
    await owner(db);
    const briefs = (await db.query<any>("select client_name,key,job_id,status,overall,per_call,at,source_id from cockpit_media_call_briefs order by client_name")).rows;
    expect(briefs.map((b: any) => [b.client_name, b.status, b.overall, b.source_id])).toEqual([
      ["Acme", "done", "Acme is happy with the leads.", null],
      ["Beta", "done", "Human edited overall", "kbrief-b"],
      ["Gamma", "done", "Gamma wants more leads.", "kbrief-g"],
    ]);
    expect(briefs[0].per_call).toEqual(acmeBrief.perCall);
    expect(briefs[0].job_id).toBe(acme.id);
    // One audit row per brief this migration wrote (the Acme insert, the Gamma update).
    expect((await db.query<any>("select action from cockpit_audit_log where entity_type='cockpit_media_call_briefs' and after->>'job_id' is not null order by action")).rows.map(r => r.action)).toEqual(["INSERT", "UPDATE"]);

    // A newer set of calls replaces an older set nobody has started.
    await db.exec(`UPDATE cockpit_csm_sources SET data=jsonb_set(data,'{calls}',data->'calls'||'[{"url":"https://fathom.video/share/a3","title":"Acme again"}]') WHERE source_id='p-acme'`);
    await service(db);
    expect(await tick(db)).toMatchObject({ briefsQueued: 1 });
    await owner(db);
    await db.exec(`UPDATE cockpit_csm_sources SET data=jsonb_set(data,'{calls}',data->'calls'||'[{"url":"https://fathom.video/share/a4","title":"Acme once more"}]') WHERE source_id='p-acme'`);
    await service(db);
    expect(await tick(db)).toMatchObject({ briefsQueued: 1 });
    await owner(db);
    const open = (await db.query<any>("select status,error,hidden from cockpit_ask_ai_jobs where kind='call_brief' and client_name='Acme' order by created_at")).rows;
    expect(open.map((j: any) => j.status)).toEqual(["completed", "failed", "queued"]);
    expect(open[1].error).toContain("newer set");
    // Withdrawn, not a failure the monitor counts.
    expect(open[1].hidden).toBe(true);
  } finally {
    await db.close();
  }
});

test("at most five background jobs are open; the rest wait at their source", async () => {
  const db = await fixture();
  try {
    await service(db);
    const seven = Array.from({ length: 7 }, (_, i) => comment(`80${i}`));
    expect(await record(db, [...seven, comment("899", { kind: "skip", prompt: undefined })])).toEqual({ recorded: 6, queued: 5, skipped: 1, known: 0, deferred: 2 });
    expect(await one(db, "select cockpit_comment_watch_seen(array['805','806']) as r")).toEqual([]);
    // No room for call briefs either.
    expect(await tick(db)).toMatchObject({ briefsQueued: 0, briefsWaiting: 2 });
    const jobs = await claim(db, "w", ["comment_digest"], 2);
    for (const job of jobs) await complete(db, job, "w", digest());
    expect(await record(db, seven)).toEqual({ recorded: 2, queued: 2, skipped: 0, known: 5, deferred: 0 });
    expect(await tick(db)).toMatchObject({ briefsQueued: 0, briefsWaiting: 2 });
    const more = await claim(db, "w", ["comment_digest"], 5);
    for (const job of more) await complete(db, job, "w", digest());
    expect(await tick(db)).toMatchObject({ briefsQueued: 2 });
    expect((await one<any>(db, "select cockpit_ai_watch_doctor() as r")).room).toBe(3);
  } finally {
    await db.close();
  }
});

test("missing feeds are reported, not treated as empty", async () => {
  const db = await fixture();
  try {
    await owner(db);
    await db.exec("UPDATE cockpit_csm_source_state SET ready=false WHERE table_name='clientProfiles'");
    await db.exec("UPDATE cockpit_media_source_state SET ready=false WHERE table_name='clientComments'");
    await service(db);
    await record(db, [comment("701")]);
    const [job] = await claim(db, "w", ["comment_digest"]);
    await complete(db, job, "w", digest());
    const out = await tick(db);
    expect(out).toMatchObject({ ok: false, settled: 1, commentsPublished: 0, briefsQueued: 0 });
    expect(out.note).toContain("client profiles are not published");
    expect(out.note).toContain("clientComments feed is not imported");
    const doctor = await one<any>(db, "select cockpit_ai_watch_doctor() as r");
    expect(doctor.comments).toMatchObject({ done: 1, unpublished: 1, rulesPending: 1 });
    expect(doctor.sources.clientComments.ready).toBe(false);
    expect(doctor.state["ai-watch-tick"].ok).toBe(false);
  } finally {
    await db.close();
  }
});

test("one comment-watch run at a time, and every door is service-role only", async () => {
  const db = await fixture();
  try {
    await service(db);
    const run = await one<any>(db, "select cockpit_comment_watch_begin('dry_run') as r");
    expect(run.busy).toBe(false);
    expect(await one(db, "select cockpit_comment_watch_begin('apply') as r")).toEqual({ busy: true });
    await db.query("select cockpit_comment_watch_finish($1,true,'Read 3 clients.',$2::jsonb,'[]'::jsonb)", [run.run, JSON.stringify({ comments: 4 })]);
    expect((await one<any>(db, "select cockpit_comment_watch_begin('apply') as r")).busy).toBe(false);
    await owner(db);
    expect((await db.query<any>("select ok,note,rows_seen from cockpit_sync_state where key='comment-watch'")).rows[0]).toEqual({ ok: true, note: "Read 3 clients.", rows_seen: 4 });

    await actor(db, MEMBER);
    for (const sql of [
      "select cockpit_comment_watch_record('[]'::jsonb)",
      "select cockpit_ai_watch_tick()",
      "select cockpit_comment_watch_seen(array['1'])",
      "select cockpit_call_brief_enqueue(1,true)",
      "select cockpit_ai_watch_doctor()",
      "select * from cockpit_claim_ask_ai_jobs('w',array['chat'],1,300)",
      "select * from cockpit_comment_watch_items",
      "select * from cockpit_comment_watch_runs",
    ]) await expect(db.exec(sql)).rejects.toThrow(/permission denied/);
    await actor(db, null);
    await expect(db.exec("select cockpit_ai_watch_tick()")).rejects.toThrow(/permission denied/);
  } finally {
    await db.close();
  }
});
