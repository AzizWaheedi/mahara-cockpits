import { afterAll, beforeAll, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { WEBINAR_TARGETS } from "../convex/ceo/webinarTargetsModel";
const db = new PGlite();
const future = new Date(Date.now() + 86400000).toISOString(),
  hash = "b".repeat(64),
  statusHash = "c".repeat(64);
let eid: string, rid: string;
async function rpc(name: string, args: any[]) {
  return (
    await db.query<{ r: any }>(
      `select public.${name}(${args.map((_, i) => `$${i + 1}`).join(",")}) r`,
      args.map(x =>
        x !== null && typeof x === "object" ? JSON.stringify(x) : x,
      ),
    )
  ).rows[0].r;
}
const prepare = (revision = 1, at: string | null = future, config = hash) =>
  rpc("cockpit_prepare_webinar_event", [
    "link-test",
    revision,
    at,
    "Asia/Kuwait",
    "Synthetic",
    WEBINAR_TARGETS,
    "test",
    randomUUID(),
    "location",
    "calendar",
    "123456789",
    config,
    90,
  ]);
beforeAll(async () => {
  await db.exec(
    "create role anon; create role authenticated; create role service_role bypassrls; grant usage on schema public to anon,authenticated,service_role;",
  );
  for (const f of [
    "20260923g_webinar_collection.sql",
    "20260926074942_webinar_target_versions.sql",
    "20260926081758_webinar_occurrence_ledger_v1.sql",
    "20260927074120_webinar_durable_intake.sql",
    "20260927080543_webinar_intake_review_guards.sql",
    "20260927081808_webinar_intake_revision_index.sql",
    "20260927083946_webinar_personal_links.sql",
  ])
    await db.exec(
      readFileSync(
        new URL(`../../../supabase/migrations/${f}`, import.meta.url),
        "utf8",
      ),
    );
  await db.exec("set role service_role");
});
afterAll(() => db.close());
test("prepare is atomic, closed by default, replayable and immutable within a revision", async () => {
  const saved = await prepare();
  eid = saved.event_id;
  expect(saved.registration_open).toBe(false);
  expect((await prepare()).event_id).toBe(eid);
  await expect(prepare(1, null)).rejects.toThrow(/reused/);
  await expect(prepare(1, future, "d".repeat(64))).rejects.toThrow(/reused/);
  await expect(prepare(3)).rejects.toThrow(/conflict/);
  expect(
    (await db.query("select * from cockpit_webinar_event_versions")).rows
      .length,
  ).toBe(1);
});
test("status stays processing until Zoom and booking receipts both commit", async () => {
  await db.query(
    "update cockpit_webinar_event_configs set registration_open=true where event_id=$1",
    [eid],
  );
  await rpc("cockpit_accept_webinar_intake", [
    "web",
    "request",
    "link-test",
    1,
    "location",
    hash,
    {
      status_hash: statusHash,
      email: "a@example.invalid",
      phone: "+96500000000",
    },
  ]);
  expect(
    (await rpc("cockpit_webinar_intake_status", [statusHash])).status,
  ).toBe("processing");
  const job = await rpc("cockpit_claim_webinar_job", [
    "{resolve_registration}",
  ]);
  rid = await rpc("cockpit_bind_webinar_intake", [
    job.id,
    job.lease_token,
    "contact",
    {
      contact_id: "contact",
      location_id: "location",
      method: "exact_email_and_phone",
    },
  ]);
  await expect(
    rpc("cockpit_issue_webinar_link", [
      rid,
      1,
      "join",
      "1".repeat(64),
      randomUUID(),
      "test",
    ]),
  ).rejects.toThrow(/not confirmed/);
  const zoom = await rpc("cockpit_claim_webinar_job", ["{zoom_registrant}"]);
  await rpc("cockpit_finish_webinar_job", [
    zoom.id,
    zoom.lease_token,
    "succeeded",
    "verified",
    {
      provider: "zoom",
      scope: "123456789",
      resource_id: "reg1",
      join_url: "https://zoom.us/j/123456789?tk=synthetic",
    },
  ]);
  expect(
    (await rpc("cockpit_webinar_intake_status", [statusHash])).status,
  ).toBe("processing");
  const booking = await rpc("cockpit_claim_webinar_job", [
    "{training_appointment}",
  ]);
  await rpc("cockpit_finish_webinar_job", [
    booking.id,
    booking.lease_token,
    "succeeded",
    "verified",
    { provider: "ghl", scope: "calendar", resource_id: "appt1" },
  ]);
  expect(
    (await rpc("cockpit_webinar_intake_status", [statusHash])).status,
  ).toBe("confirmed");
  expect(
    await rpc("cockpit_webinar_intake_status", ["0".repeat(64)]),
  ).toBeNull();
});
test("links are purpose scoped, idempotent and cannot be issued for stale revisions", async () => {
  for (const [purpose, h] of [
    ["join", "1"],
    ["survey", "2"],
  ])
    await rpc("cockpit_issue_webinar_link", [
      rid,
      1,
      purpose,
      h.repeat(64),
      randomUUID(),
      "test",
    ]);
  await rpc("cockpit_issue_webinar_link", [
    rid,
    1,
    "join",
    "1".repeat(64),
    randomUUID(),
    "test",
  ]);
  expect(
    (await db.query("select * from cockpit_webinar_link_audit")).rows.length,
  ).toBe(2);
  expect(
    (await rpc("cockpit_resolve_webinar_link", ["1".repeat(64), "join"]))
      .meeting_id,
  ).toBe("123456789");
  expect(
    await rpc("cockpit_resolve_webinar_link", ["1".repeat(64), "survey"]),
  ).toBeNull();
  expect(
    (await rpc("cockpit_resolve_webinar_link", ["2".repeat(64), "survey"]))
      .form_id,
  ).toBe("P1xP4r24");
  await expect(
    rpc("cockpit_issue_webinar_link", [
      rid,
      2,
      "join",
      "3".repeat(64),
      randomUUID(),
      "test",
    ]),
  ).rejects.toThrow(/not confirmed/);
  await expect(
    rpc("cockpit_issue_webinar_link", [
      rid,
      1,
      "survey",
      "1".repeat(64),
      randomUUID(),
      "test",
    ]),
  ).rejects.toThrow(/scope/);
});
test("revocation is audited and cannot be reversed by a retry", async () => {
  const request = randomUUID();
  await rpc("cockpit_revoke_webinar_link", ["1".repeat(64), request, "test"]);
  await rpc("cockpit_revoke_webinar_link", ["1".repeat(64), request, "test"]);
  expect(
    await rpc("cockpit_resolve_webinar_link", ["1".repeat(64), "join"]),
  ).toBeNull();
  await expect(
    rpc("cockpit_issue_webinar_link", [
      rid,
      1,
      "join",
      "1".repeat(64),
      randomUUID(),
      "test",
    ]),
  ).rejects.toThrow(/unavailable/);
  await expect(
    rpc("cockpit_revoke_webinar_link", ["2".repeat(64), request, "test"]),
  ).rejects.toThrow(/reused/);
  expect(
    (
      await db.query(
        "select * from cockpit_webinar_link_audit where action='revoked'",
      )
    ).rows.length,
  ).toBe(1);
});
test("survey attribution uses the scoped link, never a supplied contact or email", async () => {
  const at = new Date(Date.now() + 1000).toISOString();
  await rpc("cockpit_accept_webinar_survey", [
    "P1xP4r24",
    "response",
    at,
    { answers: [], email: "wrong@example.invalid" },
    "2".repeat(64),
  ]);
  expect(
    (
      await db.query(
        "select registration_id,match_status from cockpit_webinar_survey_receipts",
      )
    ).rows[0],
  ).toEqual({ registration_id: rid, match_status: "scoped_reference" });
});

test("webhook and backfill envelopes deduplicate while changed answers and references conflict", async () => {
  const at = new Date(Date.now() + 1000).toISOString();
  const answers = [
    {
      field: { id: "question", ref: "only-in-one-envelope" },
      type: "text",
      text: "answer",
    },
  ];
  const body = {
    token: "same-response",
    answers,
    hidden: { webinar_ref: "private-token", utm_source: "test" },
    definition: { large: "ignored" },
  };
  await rpc("cockpit_accept_webinar_survey", [
    "P1xP4r24",
    "same-response",
    at,
    body,
    "2".repeat(64),
  ]);
  expect(
    (
      await rpc("cockpit_accept_webinar_survey", [
        "P1xP4r24",
        "same-response",
        at,
        {
          response_id: "same-response",
          answers: [
            { field: { id: "question" }, type: "text", text: "answer" },
          ],
          hidden: body.hidden,
        },
        "2".repeat(64),
      ])
    ).replayed,
  ).toBe(true);
  await expect(
    rpc("cockpit_accept_webinar_survey", [
      "P1xP4r24",
      "same-response",
      at,
      { ...body, answers: [{ ...answers[0], text: "changed" }] },
      "2".repeat(64),
    ]),
  ).rejects.toThrow(/reused/);
  await expect(
    rpc("cockpit_accept_webinar_survey", [
      "P1xP4r24",
      "same-response",
      at,
      body,
      "9".repeat(64),
    ]),
  ).rejects.toThrow(/reused/);
  const payload = (
    await db.query(
      "select payload from cockpit_webinar_survey_receipts where response_id='same-response'",
    )
  ).rows[0].payload;
  expect(JSON.stringify(payload).includes("private-token")).toBe(false);
});
test("attendance requires both the exact session binding and Zoom registrant, retaining every rejoin", async () => {
  await db.query(
    "insert into cockpit_webinar_sessions(uuid,meeting_id,started_at) values('session','123456789',$1)",
    [future],
  );
  for (const [key, reg, status, internal] of [
    ["one", "reg1", "in_meeting", false],
    ["two", "reg1", "in_meeting", false],
    ["waiting", "reg1", "in_waiting_room", false],
    ["staff", "reg1", "in_meeting", true],
    ["no-id", null, "in_meeting", false],
  ])
    await db.query(
      "insert into cockpit_webinar_attendance(session_uuid,row_key,person_key,registrant_id,join_at,status,internal,email,name) values('session',$1,$1,$2,$3,$4,$5,'same@example.invalid','Same name')",
      [key, reg, future, status, internal],
    );
  expect(
    (
      await db.query(
        "select registration_id from cockpit_webinar_attendance_matches",
      )
    ).rows.every((r: any) => r.registration_id === null),
  ).toBe(true);
  await db.query(
    "insert into cockpit_webinar_event_sessions values('session',$1,'synthetic exact instance evidence','test',now())",
    [eid],
  );
  const rows = (
    await db.query(
      "select row_key,registration_id,match_status from cockpit_webinar_attendance_matches order by row_key",
    )
  ).rows;
  expect(
    rows
      .filter((r: any) => r.registration_id === rid)
      .map((r: any) => r.row_key),
  ).toEqual(["one", "two"]);
  expect(rows.find((r: any) => r.row_key === "no-id")?.match_status).toBe(
    "missing_registrant",
  );
  expect(
    (
      await db.query(
        "select registration_id,details_collected from cockpit_webinar_survey_matches where response_id='same-response'",
      )
    ).rows[0],
  ).toEqual({ registration_id: rid, details_collected: false });
});
test("reschedule freezes original targets, closes old config and holds old links", async () => {
  await prepare(
    2,
    new Date(Date.parse(future) + 86400000).toISOString(),
    "d".repeat(64),
  );
  expect(
    (await rpc("cockpit_webinar_intake_status", [statusHash])).status,
  ).toBe("schedule_changed");
  expect(
    await rpc("cockpit_resolve_webinar_link", ["2".repeat(64), "survey"]),
  ).toBeNull();
  expect(
    (
      await db.query(
        "select registration_open from cockpit_webinar_event_configs where event_id=$1",
        [eid],
      )
    ).rows.every((r: any) => r.registration_open === false),
  ).toBe(true);
  expect(
    (
      await db.query(
        "select target_snapshot from cockpit_webinar_events where id=$1",
        [eid],
      )
    ).rows[0].target_snapshot,
  ).toEqual(WEBINAR_TARGETS);
});
test("browser roles cannot read links or execute status and preparation functions", async () => {
  for (const role of ["anon", "authenticated"]) {
    await db.exec(`reset role; set role ${role}`);
    for (const table of [
      "link_refs",
      "link_audit",
      "survey_matches",
      "attendance_matches",
    ])
      await expect(
        db.query(`select * from cockpit_webinar_${table}`),
      ).rejects.toThrow(/permission denied/);
    await expect(
      rpc("cockpit_webinar_intake_status", [statusHash]),
    ).rejects.toThrow(/permission denied/);
    await expect(
      rpc("cockpit_resolve_webinar_link", ["2".repeat(64), "survey"]),
    ).rejects.toThrow(/permission denied/);
    await expect(prepare()).rejects.toThrow(/permission denied/);
  }
  await db.exec("reset role; set role service_role");
});
