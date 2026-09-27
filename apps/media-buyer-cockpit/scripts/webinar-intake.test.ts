import { afterAll, beforeAll, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { WEBINAR_TARGETS } from "../convex/ceo/webinarTargetsModel";

const db = new PGlite();
const future = new Date(Date.now() + 86400000).toISOString();
const hash = "a".repeat(64);
let eid: string;
async function rpc(name: string, values: unknown[]) {
  return (
    await db.query<{ r: any }>(
      `select public.${name}(${values.map((_, i) => `$${i + 1}`).join(",")}) r`,
      values.map(x =>
        x !== null && typeof x === "object" ? JSON.stringify(x) : x,
      ),
    )
  ).rows[0].r;
}
beforeAll(async () => {
  await db.exec(
    "create role anon; create role authenticated; create role service_role bypassrls; grant usage on schema public to anon,authenticated,service_role;",
  );
  for (const file of [
    "20260923g_webinar_collection.sql",
    "20260926074942_webinar_target_versions.sql",
    "20260926081758_webinar_occurrence_ledger_v1.sql",
    "20260927074120_webinar_durable_intake.sql",
    "20260927080543_webinar_intake_review_guards.sql",
  ])
    await db.exec(
      readFileSync(
        new URL(`../../../supabase/migrations/${file}`, import.meta.url),
        "utf8",
      ),
    );
  await db.exec("set role service_role");
  eid = (
    await rpc("cockpit_save_webinar_event", [
      "intake-test",
      0,
      future,
      "Asia/Kuwait",
      "Synthetic",
      WEBINAR_TARGETS,
      "test",
      randomUUID(),
    ])
  ).event_id;
  await db.query(
    "insert into cockpit_webinar_event_configs values($1,1,'location','calendar','meeting',$2,true)",
    [eid, hash],
  );
});
afterAll(() => db.close());
const input = {
  first_name: "Test",
  email: "synthetic@example.invalid",
  phone: "+96500000000",
  attribution: { utm_campaign: "test" },
};
const accept = (id: string, payload: unknown = input) =>
  rpc("cockpit_accept_webinar_intake", [
    "web",
    id,
    "intake-test",
    1,
    "location",
    hash,
    payload,
  ]);
const claim = (kinds = ["resolve_registration"]) =>
  rpc("cockpit_claim_webinar_job", [`{${kinds.join(",")}}`]);
const bind = (job: any, contact = "contact") =>
  rpc("cockpit_bind_webinar_intake", [
    job.id,
    job.lease_token,
    contact,
    {
      location_id: "location",
      contact_id: contact,
      method: "exact_email_and_phone",
    },
  ]);

test("durable receipt and job commit together; retry preserves original time", async () => {
  const a = await accept("request-1");
  const replay = await accept("request-1");
  expect(replay.intake_id).toBe(a.intake_id);
  expect(replay.replayed).toBe(true);
  await expect(
    accept("request-1", { ...input, email: "changed@example.invalid" }),
  ).rejects.toThrow(/reused/);
  expect(
    (
      await db.query<{ n: number }>(
        "select count(*)::int n from cockpit_webinar_jobs",
      )
    ).rows[0].n,
  ).toBe(1);
  const j = await claim();
  expect(await claim()).toBeNull();
  const rid = await bind(j);
  expect(await bind(j)).toBe(rid);
  await accept("request-2");
  const j2 = await claim();
  expect(await bind(j2)).toBe(rid);
  const totals = (
    await db.query<{ n: number; t: number }>(
      "select (select count(*)::int from cockpit_webinar_registrations) n,(select count(*)::int from cockpit_webinar_jobs where registration_id=$1 and kind<>'resolve_registration') t",
      [rid],
    )
  ).rows[0];
  expect(totals).toEqual({ n: 1, t: 2 });
});
test("scope and configuration mismatches create no partial intake", async () => {
  await expect(
    rpc("cockpit_accept_webinar_intake", [
      "web",
      "bad",
      "intake-test",
      1,
      "wrong",
      hash,
      input,
    ]),
  ).rejects.toThrow(/configuration/);
  await expect(
    accept("bad-contact", { ...input, contact_id: "untrusted" }),
  ).rejects.toThrow(/Untrusted/);
  expect(
    (
      await db.query<{ n: number }>(
        "select count(*)::int n from cockpit_webinar_intakes where source_id like 'bad%'",
      )
    ).rows[0].n,
  ).toBe(0);
});
test("booking waits for a verified Zoom receipt; receipt commits are idempotent", async () => {
  expect(await claim(["training_appointment"])).toBeNull();
  const j = await claim(["zoom_registrant"]);
  const receipt = {
    provider: "zoom",
    scope: "meeting",
    resource_id: "registrant",
    join_url: "https://zoom.us/w/meeting?tk=synthetic",
  };
  await expect(
    rpc("cockpit_finish_webinar_job", [
      j.id,
      j.lease_token,
      "succeeded",
      "provider_verified",
      { ...receipt, scope: "other" },
    ]),
  ).rejects.toThrow(/scope/);
  await rpc("cockpit_finish_webinar_job", [
    j.id,
    j.lease_token,
    "succeeded",
    "provider_verified",
    receipt,
  ]);
  await rpc("cockpit_finish_webinar_job", [
    j.id,
    j.lease_token,
    "succeeded",
    "provider_verified",
    receipt,
  ]);
  await expect(
    rpc("cockpit_finish_webinar_job", [
      j.id,
      j.lease_token,
      "succeeded",
      "provider_verified",
      { ...receipt, resource_id: "changed" },
    ]),
  ).rejects.toThrow(/reused/);
  expect(
    (
      await db.query<{ n: number }>(
        "select count(*)::int n from cockpit_webinar_zoom_registrants",
      )
    ).rows[0].n,
  ).toBe(1);
});
test("failed reads retry; once a mutation starts, retries become uncertain", async () => {
  const j = await claim(["training_appointment"]);
  await rpc("cockpit_finish_webinar_job", [
    j.id,
    j.lease_token,
    "retry",
    "lookup_failed",
    null,
  ]);
  await db.query(
    "update cockpit_webinar_jobs set available_at=now() where id=$1",
    [j.id],
  );
  const retried = await claim(["training_appointment"]);
  expect(retried.attempts).toBe(2);
  await rpc("cockpit_mark_webinar_mutation", [retried.id, retried.lease_token]);
  await rpc("cockpit_finish_webinar_job", [
    retried.id,
    retried.lease_token,
    "retry",
    "provider_timeout",
    null,
  ]);
  expect(
    (
      await db.query<{ state: string }>(
        "select state from cockpit_webinar_jobs where id=$1",
        [j.id],
      )
    ).rows[0].state,
  ).toBe("uncertain");
  expect(await claim(["training_appointment"])).toBeNull();
});
test("expired leases reject late writes and do not repeat external mutations", async () => {
  await accept("expiry", {
    ...input,
    email: "expiry@example.invalid",
    phone: "+96500000001",
  });
  await bind(await claim(), "expiry-contact");
  const j = await claim(["zoom_registrant"]);
  await rpc("cockpit_mark_webinar_mutation", [j.id, j.lease_token]);
  await db.query(
    "update cockpit_webinar_jobs set lease_until=now()-interval '1 minute' where id=$1",
    [j.id],
  );
  expect(await claim(["zoom_registrant"])).toBeNull();
  await expect(
    rpc("cockpit_finish_webinar_job", [
      j.id,
      j.lease_token,
      "succeeded",
      "done",
      {},
    ]),
  ).rejects.toThrow(/Lease lost/);
  expect(
    (
      await db.query<{ n: number }>(
        "select count(*)::int n from cockpit_webinar_job_attempts where outcome='uncertain'",
      )
    ).rows[0].n,
  ).toBe(2);
});
test("uncertain identity prevents another create for the same email or phone", async () => {
  await accept("uncertain-a", { ...input, email: "other@example.invalid" });
  const j = await claim();
  await rpc("cockpit_mark_webinar_mutation", [j.id, j.lease_token]);
  await rpc("cockpit_finish_webinar_job", [
    j.id,
    j.lease_token,
    "blocked",
    "timeout",
    null,
  ]);
  await accept("uncertain-b", { ...input, email: "other@example.invalid" });
  expect(await claim()).toBeNull();
  expect(
    (
      await db.query<{ state: string }>(
        "select state from cockpit_webinar_jobs where id=$1",
        [j.id],
      )
    ).rows[0].state,
  ).toBe("uncertain");
});
test("survey replay is immutable and unknown references stay unmatched", async () => {
  const body = { form_id: "P1xP4r24", token: "response-1", answers: [] };
  const at = new Date().toISOString();
  expect(
    (
      await rpc("cockpit_accept_webinar_survey", [
        "P1xP4r24",
        "response-1",
        at,
        body,
        null,
      ])
    ).replayed,
  ).toBe(false);
  expect(
    (
      await rpc("cockpit_accept_webinar_survey", [
        "P1xP4r24",
        "response-1",
        at,
        body,
        null,
      ])
    ).replayed,
  ).toBe(true);
  await expect(
    rpc("cockpit_accept_webinar_survey", [
      "P1xP4r24",
      "response-1",
      at,
      { ...body, answers: ["changed"] },
      null,
    ]),
  ).rejects.toThrow(/reused/);
  expect(
    (
      await db.query<{ match_status: string; registration_id: string | null }>(
        "select match_status,registration_id from cockpit_webinar_survey_receipts",
      )
    ).rows[0],
  ).toEqual({ match_status: "missing_reference", registration_id: null });
});
test("browser roles cannot read receipts, join links, jobs or call intake RPCs", async () => {
  for (const role of ["anon", "authenticated"]) {
    await db.exec(`reset role; set role ${role}`);
    for (const table of [
      "intakes",
      "jobs",
      "provider_receipts",
      "zoom_registrants",
      "survey_receipts",
      "link_refs",
    ])
      await expect(
        db.query(`select * from cockpit_webinar_${table}`),
      ).rejects.toThrow(/permission denied/);
    await expect(accept("forbidden")).rejects.toThrow(/permission denied/);
    await expect(claim()).rejects.toThrow(/permission denied/);
  }
  await db.exec("reset role; set role service_role");
});
