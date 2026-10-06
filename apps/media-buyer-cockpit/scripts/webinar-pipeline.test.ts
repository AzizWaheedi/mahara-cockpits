import { afterAll, beforeAll, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { WEBINAR_TARGETS } from "../convex/ceo/webinarTargetsModel";
const db = new PGlite();
let eid: string, rid: string;
async function rpc(name: string, args: any[]) {
  return (
    await db.query<{ r: any }>(
      `select ${name}(${args.map((_, i) => `$${i + 1}`).join(",")}) r`,
      args.map((x) => (x && typeof x === "object" ? JSON.stringify(x) : x)),
    )
  ).rows[0].r;
}
beforeAll(async () => {
  await db.exec(
    "create role anon;create role authenticated;create role service_role bypassrls;grant usage on schema public to anon,authenticated,service_role;",
  );
  for (const f of [
    "20260923g_webinar_collection.sql",
    "20260926074942_webinar_target_versions.sql",
    "20260926081758_webinar_occurrence_ledger_v1.sql",
    "20260927074120_webinar_durable_intake.sql",
    "20260927080543_webinar_intake_review_guards.sql",
    "20260927081808_webinar_intake_revision_index.sql",
    "20260927083946_webinar_personal_links.sql",
    "20260927092127_webinar_pipeline_projection.sql",
  ])
    await db.exec(
      readFileSync(
        new URL(`../../../supabase/migrations/${f}`, import.meta.url),
        "utf8",
      ),
    );
  eid = (
    await rpc("cockpit_save_webinar_event", [
      "pipeline-test",
      0,
      new Date(Date.now() + 86400000).toISOString(),
      "Asia/Kuwait",
      "Synthetic",
      WEBINAR_TARGETS,
      "test",
      randomUUID(),
    ])
  ).event_id;
  rid = await rpc("cockpit_record_webinar_registration", [
    eid,
    1,
    "location",
    "contact",
    new Date().toISOString(),
    {},
    "test",
    "receipt",
  ]);
  await db.query(
    "insert into cockpit_webinar_pipeline_config(location_id,pipeline_id,stage_ids) values('location','pipeline',$1)",
    [JSON.stringify({ registered: "stage", attended: "stage2" })],
  );
  await db.exec("set role service_role");
});
afterAll(() => db.close());
test("service-only tables and functions, config starts held", async () => {
  expect(await rpc("cockpit_claim_webinar_pipeline", [rid])).toBeNull();
  for (const role of ["anon", "authenticated"]) {
    expect(
      (
        await db.query<{ ok: boolean }>(
          "select has_table_privilege($1,'cockpit_webinar_pipeline_cards','SELECT') ok",
          [role],
        )
      ).rows[0].ok,
    ).toBe(false);
    expect(
      (
        await db.query<{ ok: boolean }>(
          "select has_function_privilege($1,'cockpit_claim_webinar_pipeline(uuid)','EXECUTE') ok",
          [role],
        )
      ).rows[0].ok,
    ).toBe(false);
  }
});
test("claims are exclusive; stale leases fail; successful readback records one receipt", async () => {
  await db.exec("update cockpit_webinar_pipeline_config set enabled=true");
  const c = await rpc("cockpit_claim_webinar_pipeline", [rid]);
  expect(c.lease_token).toBeTruthy();
  expect(await rpc("cockpit_claim_webinar_pipeline", [rid])).toBeNull();
  await expect(
    rpc("cockpit_mark_webinar_pipeline_mutation", [rid, randomUUID()]),
  ).rejects.toThrow(/lease/);
  await rpc("cockpit_mark_webinar_pipeline_mutation", [rid, c.lease_token]);
  await expect(
    rpc("cockpit_finish_webinar_pipeline", [
      rid,
      c.lease_token,
      "synced",
      "verified",
      "opp",
      "invented",
    ]),
  ).rejects.toThrow(/mismatch/);
  await rpc("cockpit_finish_webinar_pipeline", [
    rid,
    c.lease_token,
    "synced",
    "verified",
    "opp",
    "registered",
  ]);
  await rpc("cockpit_finish_webinar_pipeline", [
    rid,
    c.lease_token,
    "synced",
    "verified",
    "opp",
    "registered",
  ]);
  expect(
    (await db.query("select * from cockpit_webinar_pipeline_attempts")).rows
      .length,
  ).toBe(1);
  expect(await rpc("cockpit_claim_webinar_pipeline", [rid])).toBeNull();
});
test("timeout after provider mutation becomes uncertain and cannot be blindly reclaimed", async () => {
  await db.exec(
    "update cockpit_webinar_pipeline_cards set last_success_at=now()-interval '10 minutes'",
  );
  const c = await rpc("cockpit_claim_webinar_pipeline", [rid]);
  await rpc("cockpit_mark_webinar_pipeline_mutation", [rid, c.lease_token]);
  await rpc("cockpit_finish_webinar_pipeline", [
    rid,
    c.lease_token,
    "blocked",
    "timeout",
  ]);
  expect(
    (
      await db.query<{ state: string }>(
        "select state from cockpit_webinar_pipeline_cards",
      )
    ).rows[0].state,
  ).toBe("uncertain");
  expect(await rpc("cockpit_claim_webinar_pipeline", [rid])).toBeNull();
});
test("workflow signals coalesce and cannot assert a stage", async () => {
  await rpc("cockpit_signal_webinar_pipeline", ["location", "contact"]);
  await rpc("cockpit_signal_webinar_pipeline", ["location", "contact"]);
  expect(
    (await db.query("select * from cockpit_webinar_pipeline_signals")).rows
      .length,
  ).toBe(1);
  await expect(
    rpc("cockpit_signal_webinar_pipeline", ["other", "contact"]),
  ).rejects.toThrow(/Unknown/);
});
test("no-show remains unknown with missing, incomplete or unmatched attendance", async () => {
  const evidence = async () =>
    (
      await db.query<{ attendance_final: boolean }>(
        "select attendance_final from cockpit_webinar_pipeline_evidence where registration_id=$1",
        [rid],
      )
    ).rows[0].attendance_final;
  expect(await evidence()).toBe(false);
  await db.exec("reset role");
  await db.query(
    "insert into cockpit_webinar_sessions(uuid,meeting_id,started_at,ended_at,complete) values('session','meeting',now()-interval '4 hours',now()-interval '3 hours',false)",
  );
  await db.query(
    "insert into cockpit_webinar_event_sessions values('session',$1,'verified instance','test',now())",
    [eid],
  );
  expect(await evidence()).toBe(false);
  await db.exec("update cockpit_webinar_sessions set complete=true");
  expect(await evidence()).toBe(true);
  await db.exec(
    "insert into cockpit_webinar_attendance(session_uuid,row_key,person_key,join_at) values('session','row','guest',now()-interval '4 hours')",
  );
  expect(await evidence()).toBe(false);
  await db.exec("update cockpit_webinar_sessions set participant_rows=1");
  expect(await evidence()).toBe(false);
  await db.exec("set role service_role");
});

test("bridge runs leave unfinished and failed evidence, successful completion is idempotent", async () => {
  const run = await rpc("cockpit_start_webinar_bridge_run", ["pipeline"]);
  expect(
    (
      await db.query<{ ok: boolean | null }>(
        "select ok from cockpit_webinar_pulls where id=$1",
        [run],
      )
    ).rows[0].ok,
  ).toBeNull();
  await rpc("cockpit_finish_webinar_bridge_run", [
    run,
    true,
    { complete: true, status: "idle" },
  ]);
  await rpc("cockpit_finish_webinar_bridge_run", [
    run,
    true,
    { complete: true, status: "idle" },
  ]);
  await expect(
    rpc("cockpit_finish_webinar_bridge_run", [run, false, {}]),
  ).rejects.toThrow(/changed/);
  await expect(
    rpc("cockpit_start_webinar_bridge_run", ["zoom"]),
  ).rejects.toThrow(/Unknown/);
  expect(
    (
      await db.query<{ ok: boolean }>(
        "select has_function_privilege('authenticated','cockpit_start_webinar_bridge_run(text)','EXECUTE') ok",
      )
    ).rows[0].ok,
  ).toBe(false);
});
