// Real Postgres semantics, fictional rows only. Install @electric-sql/pglite@0.3.14
// outside the repo and set PGLITE_PATH to its dist/index.js before bun test.
import { beforeAll, afterAll, beforeEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
const { PGlite } = await import(
  process.env.PGLITE_PATH ??
    "../apps/media-buyer-cockpit/node_modules/@electric-sql/pglite/dist/index.js"
);
const db = new PGlite();
const migration = (name: string) =>
  readFileSync(
    new URL(`../supabase/migrations/${name}`, import.meta.url),
    "utf8",
  );
beforeAll(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
 create function public.cockpit_sales_seat() returns boolean language sql as 'select false';
 create function public.cockpit_sales_email() returns text language sql as 'select null::text';
 create function public.cockpit_sales_manager() returns boolean language sql as 'select false';
 create table public.cockpit_sales_people(email text primary key,name text,active boolean,ghl_user_id text,slack_user_id text);
 create table public.cockpit_sales_calendar(appointment_id text primary key,assigned_user_id text,start_at timestamptz,call_type text,status text,mark_id bigint,mark_note text);
 create table public.cockpit_audit_log(id bigserial primary key,action text,entity_type text,entity_id text,actor_email text,source_app text,source_system text,after jsonb,metadata jsonb);`);
  await db.exec(migration("20260922a_eod_outbox.sql"));
  await db.exec(migration("20260924o_sales_eod.sql"));
  await db.exec(migration("20261022125617_sales_day_review_handoffs.sql"));
  await db.exec(
    `grant usage on schema public to service_role; grant all on all tables in schema public to service_role; grant usage,select on all sequences in schema public to service_role;`,
  );
});
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  await db.exec(`reset role; truncate cockpit_sales_people,cockpit_sales_calendar,cockpit_sales_eods,eod_outbox,cockpit_audit_log,cockpit_sales_demo_handoffs;
 insert into cockpit_sales_people values('rep@test.invalid','Sample Rep',true,'u-rep',null);
 insert into cockpit_sales_calendar values('a','u-rep',now()-interval '1 day','demo','showed',1,'Reviewed');`);
});
async function review() {
  return (
    await db.query(
      `select coalesce(jsonb_agg(jsonb_build_object('id',appointment_id,'start_at',start_at,'status',status,'mark_id',mark_id,'note',mark_note)),'[]') as calls from cockpit_sales_calendar`,
    )
  ).rows[0].calls;
}
async function send(rows: unknown, answers = { demos_showed: 2 }) {
  return (
    await db.query(
      `select cockpit_sales_submit_reviewed_eod('rep@test.invalid','closer',(now() at time zone 'Asia/Kuwait')::date-1,$1,'{"demos_showed":1}','Sample EOD','{}','version',$2) as result`,
      [JSON.stringify(answers), rows === null ? null : JSON.stringify(rows)],
    )
  ).rows[0].result;
}
async function counts() {
  return (
    await db.query(
      `select (select count(*)::int from cockpit_sales_eods) reports,(select count(*)::int from eod_outbox) outgoing,(select count(*)::int from cockpit_audit_log) audits`,
    )
  ).rows[0];
}
test("a report, its corrections and outgoing row commit once under service role", async () => {
  const rows = await review();
  await db.exec("set role service_role");
  const first = await send(rows),
    again = await send(rows);
  expect(first.eod.answers).toEqual({ demos_showed: 2 });
  expect(first.eod.computed).toEqual({ demos_showed: 1 });
  expect(again.eod.id).toBe(first.eod.id);
  expect(again.repeated).toBe(true);
  expect(await counts()).toEqual({ reports: 1, outgoing: 1, audits: 1 });
  await expect(send(rows, { demos_showed: 9 })).rejects.toThrow(
    "different answers",
  );
});
test("an unmarked callback blocks filing and leaves no partial outbox", async () => {
  await db.exec(
    "update cockpit_sales_calendar set call_type='callback',status='confirmed'",
  );
  await expect(send(await review())).rejects.toThrow("Review every call");
  expect(await counts()).toEqual({ reports: 0, outgoing: 0, audits: 0 });
});
test("changed outcomes, feedback, assignment and new calls invalidate the reviewed rows", async () => {
  const old = await review();
  await db.exec("update cockpit_sales_calendar set mark_note='Changed'");
  await expect(send(old)).rejects.toThrow("calls changed");
  await db.exec("update cockpit_sales_calendar set assigned_user_id='other'");
  await expect(send(old)).rejects.toThrow("calls changed");
  expect(await counts()).toEqual({ reports: 0, outgoing: 0, audits: 0 });
});
test("missing review and unlinked seat cannot bypass the gate", async () => {
  await expect(send(null)).rejects.toThrow("Refresh your call review");
  await db.exec("update cockpit_sales_people set ghl_user_id=null");
  await expect(send(await review())).rejects.toThrow("Link an active");
});
test("failure after outbox insertion rolls back the entire transaction", async () => {
  await db.exec(
    "alter table cockpit_audit_log add constraint force_test_failure check(action <> 'eod.submit')",
  );
  try {
    await expect(send(await review())).rejects.toThrow();
    expect(await counts()).toEqual({ reports: 0, outgoing: 0, audits: 0 });
  } finally {
    await db.exec(
      "alter table cockpit_audit_log drop constraint force_test_failure",
    );
  }
});
test("a browser role cannot submit reports or write handoff receipts directly", async () => {
  await db.exec("set role authenticated");
  await expect(send([])).rejects.toThrow("permission denied");
  await expect(
    db.exec(
      "insert into cockpit_sales_demo_handoffs(id) values(gen_random_uuid())",
    ),
  ).rejects.toThrow("permission denied");
});
test("handoff identity constraints reject duplicates and invalid times", async () => {
  const row =
    "insert into cockpit_sales_demo_handoffs(id,contact_id,day,source_intro_id,setter_email,host_email,by_email,intro_start,demo_start,demo_end) values(gen_random_uuid(),'lead',current_date,'intro','s','h','s',now()-interval '1 hour',now()-interval '30 minutes',now())";
  await db.exec(row);
  await expect(db.exec(row)).rejects.toThrow("duplicate key");
  await expect(
    db.exec(
      row
        .replace("'lead'", "'other'")
        .replace("'intro'", "'other-intro'")
        .replace("now()-interval '30 minutes'", "now()+interval '30 minutes'"),
    ),
  ).rejects.toThrow("check constraint");
});
