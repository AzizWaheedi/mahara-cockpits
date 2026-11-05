import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { migration } from "./lib/cockpitTestDb";

const FILE = "20261105111504_kickoff_canary_notice_mute.sql";
const original = migration("20261025n_slack_notices.sql");
function definition(name: string): string {
  const found = original.match(
    new RegExp(
      `CREATE OR REPLACE FUNCTION public\\.${name}\\([\\s\\S]*?\\nEND \\$\\$;`,
    ),
  );
  if (!found) throw new Error(`Missing canonical function ${name}`);
  return found[0];
}
let db: PGlite;
const resp = "00000000-0000-4000-8000-000000000001";
const ordinary = "00000000-0000-4000-8000-000000000002";
async function queue(
  kind: string,
  key: string,
  card: string,
  state: string | null = null,
) {
  const r = await db.query<{ id: string | null }>(
    "select public.cockpit_slack_notice_queue($1,$2,$3,'Example', '{}'::jsonb,null,$4,null) as id",
    [kind, key, card, state],
  );
  return r.rows[0].id;
}
async function notice(id: string) {
  return (
    await db.query<{
      state: string;
      error: string | null;
      finished_at: Date | null;
    }>(
      "select state,error,finished_at from public.cockpit_slack_notices where id=$1",
      [id],
    )
  ).rows[0];
}
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create table public.cockpit_form_responses (id uuid primary key, task_id text, form_key text, source text, answer_meta jsonb);
    create table public.cockpit_client_onboarding (clickup_task_id text primary key, client_name text, forms jsonb);
    create table public.notice_test_errors (reason text);
    create function public.cockpit_slack_notice_ts(s text) returns timestamptz language sql as $$ select s::timestamptz $$;
    create function public.cockpit_slack_notice_kickoff_facts(text,text,jsonb,text) returns jsonb language sql as $$ select '{}'::jsonb $$;
    create function public.cockpit_slack_notice_typeform_facts(text,text,jsonb) returns jsonb language sql as $$ select '{}'::jsonb $$;
    create function public.cockpit_slack_notice_queue_failed(s text) returns void language sql as $$ insert into public.notice_test_errors values (s) $$;
    create table public.cockpit_slack_channels (id text primary key, state text);
    create table public.cockpit_slack_notices (
      id uuid primary key default gen_random_uuid(), kind text, dedupe_key text unique, task_id text, client_name text,
      parent_id uuid, facts jsonb, state text, error text, finished_at timestamptz, created_at timestamptz default now(),
      updated_at timestamptz default now(), target text, channel text, slack_ts text
    );
  `);
  await db.exec(definition("cockpit_slack_notice_guard"));
  await db.exec(
    "create trigger notice_guard before insert or update on public.cockpit_slack_notices for each row execute function public.cockpit_slack_notice_guard()",
  );
  await db.exec(definition("cockpit_slack_notice_queue"));
  await db.exec(
    "revoke all on function public.cockpit_slack_notice_queue(text,text,text,text,jsonb,uuid,text,text) from public,anon,authenticated,service_role",
  );
  await db.exec(migration(FILE));
  await db.exec(definition("cockpit_slack_notice_from_onboarding"));
  await db.exec(
    "create trigger onboarding_notice after insert or update on public.cockpit_client_onboarding for each row execute function public.cockpit_slack_notice_from_onboarding()",
  );
  await db.query(
    "insert into public.cockpit_form_responses values ($1,'86eywg1cq','kickoff','cockpit', '{\"canary\":true}'::jsonb),($2,'example-card','kickoff','cockpit', '{\"canary\":true}'::jsonb)",
    [resp, ordinary],
  );
});
afterAll(async () => db?.close());
describe("kickoff canary notice safeguard", () => {
  test("mutes only the matching explicitly marked internal kickoff before any claim", async () => {
    const id = await queue("kickoff", `kickoff:${resp}`, "86eywg1cq");
    expect(id).not.toBeNull();
    const n = await notice(id!);
    expect(n.state).toBe("muted");
    expect(n.error).toBe("Canary on the test card: not posted.");
    expect(n.finished_at).not.toBeNull();
    const claimed = await db.query(
      "select id from public.cockpit_slack_notices where state='queued' and id=$1",
      [id],
    );
    expect(claimed.rows).toHaveLength(0);
  });
  test("normal clients remain queued, even with a marked response", async () => {
    const id = await queue("kickoff", `kickoff:${ordinary}`, "example-card");
    expect((await notice(id!)).state).toBe("queued");
  });
  test("test card without an exact canary response remains queued", async () => {
    const id = await queue("kickoff", "kickoff:unmatched", "86eywg1cq");
    expect((await notice(id!)).state).toBe("queued");
  });
  test("unmarked and wrong-source responses on the test card remain queued", async () => {
    for (const [id, source, meta] of [
      ["00000000-0000-4000-8000-000000000010", "cockpit", { canary: false }],
      ["00000000-0000-4000-8000-000000000011", "cockpit", { canary: "true" }],
      ["00000000-0000-4000-8000-000000000012", "typeform", { canary: true }],
    ] as const) {
      await db.query(
        "insert into public.cockpit_form_responses values ($1,'86eywg1cq','kickoff',$2,$3::jsonb)",
        [id, source, JSON.stringify(meta)],
      );
      const n = await queue("kickoff", `kickoff:${id}`, "86eywg1cq");
      expect((await notice(n!)).state).toBe("queued");
    }
  });
  test("real onboarding trigger mutes the canary within the submission transaction", async () => {
    const id = "00000000-0000-4000-8000-000000000013";
    await db.exec("begin");
    await db.query(
      "insert into public.cockpit_form_responses values ($1,'86eywg1cq','kickoff','cockpit','{\"canary\":true}'::jsonb)",
      [id],
    );
    await db.query(
      "insert into public.cockpit_client_onboarding values ('86eywg1cq','Synthetic',jsonb_build_object('kickoff',jsonb_build_object('response_id',$1::text,'submitted_at',now()::text)))",
      [id],
    );
    const rows = await db.query<{ state: string }>(
      "select state from public.cockpit_slack_notices where dedupe_key=$1",
      [`kickoff:${id}`],
    );
    expect(rows.rows).toEqual([{ state: "muted" }]);
    expect(
      (await db.query("select * from public.notice_test_errors")).rows,
    ).toHaveLength(0);
    await db.exec("commit");
  });
  test("real onboarding trigger still queues a non-test-card kickoff", async () => {
    const id = "00000000-0000-4000-8000-000000000014";
    await db.query(
      "insert into public.cockpit_form_responses values ($1,'fictional-card','kickoff','cockpit','{}'::jsonb)",
      [id],
    );
    await db.query(
      "insert into public.cockpit_client_onboarding values ('fictional-card','Synthetic',jsonb_build_object('kickoff',jsonb_build_object('response_id',$1::text,'submitted_at',now()::text)))",
      [id],
    );
    const rows = await db.query<{ state: string }>(
      "select state from public.cockpit_slack_notices where dedupe_key=$1",
      [`kickoff:${id}`],
    );
    expect(rows.rows).toEqual([{ state: "queued" }]);
    expect(
      (await db.query("select * from public.notice_test_errors")).rows,
    ).toHaveLength(0);
  });
  test("different notice kinds remain queued", async () => {
    const id = await queue("blueprint.close", `blueprint:${resp}`, "86eywg1cq");
    expect((await notice(id!)).state).toBe("queued");
  });
  test("explicitly skipped notices remain skipped", async () => {
    const id = await queue(
      "kickoff",
      `kickoff:${resp}:other`,
      "86eywg1cq",
      "skipped",
    );
    expect((await notice(id!)).state).toBe("skipped");
  });
  test("deduped notices are not modified", async () => {
    const id = await queue("kickoff", "kickoff:dedupe", "86eywg1cq");
    expect(await queue("kickoff", "kickoff:dedupe", "86eywg1cq")).toBeNull();
    expect((await notice(id!)).state).toBe("queued");
  });
  test("existing owner-only function privileges are preserved", async () => {
    const r = await db.query<{
      anon: boolean;
      auth: boolean;
      svc: boolean;
    }>(`select
      has_function_privilege('anon','public.cockpit_slack_notice_queue(text,text,text,text,jsonb,uuid,text,text)','execute') as anon,
      has_function_privilege('authenticated','public.cockpit_slack_notice_queue(text,text,text,text,jsonb,uuid,text,text)','execute') as auth,
      has_function_privilege('service_role','public.cockpit_slack_notice_queue(text,text,text,text,jsonb,uuid,text,text)','execute') as svc`);
    expect(r.rows[0]).toEqual({ anon: false, auth: false, svc: false });
  });
  test("reapplying the reviewed migration is safe", async () => {
    await db.exec(migration(FILE));
    const id = await queue("kickoff", `kickoff:${resp}:again`, "86eywg1cq");
    expect((await notice(id!)).state).toBe("queued");
  });
  test("guarded rollback restores only the queue body and retains muted notices", async () => {
    const rollback = readFileSync(
      new URL(
        "../../../scripts/dev/forms-deploy/rollback-kickoff-canary-notice.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const muted = await db.query<{ id: string }>(
      "select id from public.cockpit_slack_notices where dedupe_key=$1",
      [`kickoff:${resp}`],
    );
    await db.exec("begin");
    try {
      await db.exec(rollback);
      const hash = await db.query<{ h: string }>(
        "select md5(pg_get_functiondef($1::regprocedure)) as h",
        [
          "public.cockpit_slack_notice_queue(text,text,text,text,jsonb,uuid,text,text)",
        ],
      );
      expect(hash.rows[0].h).toBe("d39d5484a54c91969d4786d1a1ef81a0");
      expect((await notice(muted.rows[0].id)).state).toBe("muted");
      expect(await queue("kickoff", `kickoff:${resp}`, "86eywg1cq")).toBeNull();
    } finally {
      await db.exec("rollback");
    }
  });
  test("rollback refuses an unresolved test notice", async () => {
    const rollback = readFileSync(
      new URL(
        "../../../scripts/dev/forms-deploy/rollback-kickoff-canary-notice.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const id = "00000000-0000-4000-8000-000000000015";
    await db.exec("begin");
    try {
      await queue("kickoff", `kickoff:${id}`, "86eywg1cq");
      await db.query(
        "insert into public.cockpit_form_responses values ($1,'86eywg1cq','kickoff','cockpit','{\"canary\":true}'::jsonb)",
        [id],
      );
      await expect(db.exec(rollback)).rejects.toThrow(
        "needs reconciliation before rollback",
      );
    } finally {
      await db.exec("rollback");
    }
  });
  test("rollback refuses a failed test notice that could be requeued", async () => {
    const rollback = readFileSync(
      new URL(
        "../../../scripts/dev/forms-deploy/rollback-kickoff-canary-notice.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const id = "00000000-0000-4000-8000-000000000016";
    await db.exec("begin");
    try {
      const noticeId = await queue("kickoff", `kickoff:${id}`, "86eywg1cq");
      await db.query(
        "insert into public.cockpit_form_responses values ($1,'86eywg1cq','kickoff','cockpit','{\"canary\":true}'::jsonb)",
        [id],
      );
      await db.query(
        "update public.cockpit_slack_notices set state='sending' where id=$1",
        [noticeId],
      );
      await db.query(
        "update public.cockpit_slack_notices set state='failed' where id=$1",
        [noticeId],
      );
      await expect(db.exec(rollback)).rejects.toThrow(
        "needs reconciliation before rollback",
      );
    } finally {
      await db.exec("rollback");
    }
  });
  test("a changed live source fails closed", async () => {
    await db.exec(
      `create or replace function public.cockpit_slack_notice_queue(p_kind text, p_dedupe text, p_task text, p_client text, p_facts jsonb, p_parent uuid, p_state text, p_error text) returns uuid language sql security definer set search_path = '' as $$ select null::uuid $$`,
    );
    await expect(db.exec(migration(FILE))).rejects.toThrow(
      "Kickoff notice source changed",
    );
  });
});
