import { afterAll, beforeAll, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { WEBINAR_TARGETS } from "../convex/ceo/webinarTargetsModel";

const db = new PGlite();
beforeAll(async () => {
  await db.exec(
    "create role anon; create role authenticated; create role service_role bypassrls; grant usage on schema public to anon,authenticated,service_role;",
  );
  for (const name of [
    "20260923g_webinar_collection.sql",
    "20260926074942_webinar_target_versions.sql",
    "20260926081758_webinar_occurrence_ledger_v1.sql",
    "20260926083346_webinar_atomic_snapshots.sql",
  ])
    await db.exec(
      readFileSync(
        new URL("../../../supabase/migrations/" + name, import.meta.url),
        "utf8",
      ),
    );
  await db.exec("set role service_role");
});
afterAll(() => db.close());
const s = {
  uuid: "synthetic-session",
  meeting_id: "synthetic-meeting",
  started_at: "2026-09-25T17:00:00Z",
  ended_at: "2026-09-25T18:00:00Z",
  recording_files: ["CHAT"],
  pulled_at: "2026-09-26T08:00:00Z",
};
const row = {
  session_uuid: s.uuid,
  row_key: "join-1",
  person_key: "guest:1",
  status: "in_meeting",
  internal: false,
  join_at: s.started_at,
  leave_at: s.ended_at,
  failover: false,
  pulled_at: s.pulled_at,
};
const coverage = {
  attendance: "complete",
  chat: "complete",
  poll: "complete",
  qa: "complete",
};
async function snapshot(
  session = s,
  att: unknown[] = [row],
  eng: unknown[] = [],
  c = coverage,
) {
  return (
    await db.query<{ r: { status: string } }>(
      "select public.cockpit_ingest_webinar_snapshot($1,$2,$3,$4) r",
      [session, att, eng, c].map(v => JSON.stringify(v)),
    )
  ).rows[0].r;
}
test("atomic snapshot, retry, stale replay and child-write rollback", async () => {
  expect((await snapshot()).status).toBe("saved");
  expect((await snapshot()).status).toBe("replayed");
  await expect(
    snapshot(s, [{ ...row, person_key: "changed" }]),
  ).rejects.toThrow(/reused/);
  expect(
    (await snapshot({ ...s, pulled_at: "2026-09-26T07:00:00Z" })).status,
  ).toBe("stale");
  await expect(
    snapshot({ ...s, pulled_at: "2026-09-26T09:00:00Z" }, [
      { ...row, person_key: null },
    ]),
  ).rejects.toThrow();
  expect(
    (
      await db.query<{ n: number }>(
        "select count(*)::int n from cockpit_webinar_snapshots",
      )
    ).rows[0].n,
  ).toBe(1);
  expect(
    (
      await db.query<{ person_key: string }>(
        "select person_key from cockpit_webinar_attendance",
      )
    ).rows[0].person_key,
  ).toBe("guest:1");
});
test("partial channel failure preserves last readable rows", async () => {
  const chat = {
    session_uuid: s.uuid,
    kind: "chat",
    row_key: "chat-1",
    body: "synthetic",
    pulled_at: s.pulled_at,
  };
  await snapshot({ ...s, pulled_at: "2026-09-26T10:00:00Z" }, [row], [chat]);
  await snapshot({ ...s, pulled_at: "2026-09-26T11:00:00Z" }, [row], [], {
    ...coverage,
    chat: "error",
  });
  expect(
    (
      await db.query<{ n: number }>(
        "select count(*)::int n from cockpit_webinar_engagement",
      )
    ).rows[0].n,
  ).toBe(1);
  expect(
    (
      await db.query<{ complete: boolean }>(
        "select complete from cockpit_webinar_sessions",
      )
    ).rows[0].complete,
  ).toBe(false);
  await expect(
    snapshot({ ...s, pulled_at: "2026-09-26T12:00:00Z" }, [
      { ...row, session_uuid: "wrong" },
    ]),
  ).rejects.toThrow(/Cross-instance/);
});
let eid: string;
async function event(key: string, rev: number, at: string | null, req: string) {
  return (
    await db.query<{
      r: { event_id: string; revision: number; status: string };
    }>("select public.cockpit_save_webinar_event($1,$2,$3,$4,$5,$6,$7,$8) r", [
      key,
      rev,
      at,
      "Asia/Kuwait",
      "Synthetic webinar",
      JSON.stringify(WEBINAR_TARGETS),
      "synthetic-founder",
      req,
    ])
  ).rows[0].r;
}
async function reg(
  id: string,
  revision: number,
  source: string,
  contact = "synthetic-contact",
) {
  return (
    await db.query<{ id: string }>(
      "select public.cockpit_record_webinar_registration($1,$2,$3,$4,$5,$6,$7,$8) id",
      [
        id,
        revision,
        "synthetic-location",
        contact,
        "2026-09-25T17:00:00Z",
        "{}",
        "test",
        source,
      ],
    )
  ).rows[0].id;
}
test("rescheduling keeps registrations; repeat events have separate occurrences", async () => {
  const request = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  eid = (await event("test", 0, null, request)).event_id;
  expect((await event("test", 0, null, request)).event_id).toBe(eid);
  const id = await reg(eid, 1, "one");
  expect(await reg(eid, 1, "one")).toBe(id);
  await expect(reg(eid, 1, "one", "other-contact")).rejects.toThrow(/reused/);
  expect(
    (
      await event(
        "test",
        1,
        "2026-10-01T17:00:00Z",
        "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      )
    ).revision,
  ).toBe(2);
  expect(await reg(eid, 2, "two")).toBe(id);
  expect(
    (await event("test", 1, null, "cccccccc-cccc-4ccc-8ccc-cccccccccccc"))
      .status,
  ).toBe("conflict");
  const next = await event(
    "next",
    0,
    null,
    "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  );
  expect(await reg(next.event_id, 1, "three")).not.toBe(id);
  expect(
    (
      await db.query<{ event_revision: number }>(
        "select event_revision from cockpit_webinar_registrations where id=$1",
        [id],
      )
    ).rows[0].event_revision,
  ).toBe(1);
  await expect(
    db.exec("delete from cockpit_webinar_registration_receipts"),
  ).rejects.toThrow(/permission denied/);
});
test("browser roles cannot read the ledger or execute ingestion", async () => {
  for (const role of ["anon", "authenticated"]) {
    await db.exec("reset role; set role " + role);
    await expect(snapshot()).rejects.toThrow(/permission denied/);
    await expect(reg(eid, 1, "blocked")).rejects.toThrow(/permission denied/);
    await expect(
      db.exec("select * from cockpit_webinar_registrations"),
    ).rejects.toThrow(/permission denied/);
  }
  await db.exec("reset role; set role service_role");
});
