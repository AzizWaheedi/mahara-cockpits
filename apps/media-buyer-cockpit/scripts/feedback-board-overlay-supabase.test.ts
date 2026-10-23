/** Real board functions on isolated PostgreSQL. All identities are invented. */
import { afterAll, beforeAll, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { PGlite } from "@electric-sql/pglite";
import { cockpitTestDb, migration } from "./lib/cockpitTestDb";

const FILE = "20261023110717_cockpit_feedback_board_overlay.sql";
const SQL = migration(FILE);
const FIRST = "20261023104525_client_appointment_feedback.sql";
const day = (n: number) =>
  new Date(Date.now() + 3 * 3600000 - n * 86400000).toISOString().slice(0, 10);
const at = (n: number) => `${day(n)}T10:00:00+03:00`;
let db: PGlite;
const q = async (sql: string, args: unknown[] = []) =>
  (await db.query<any>(sql, args)).rows;
const board = () =>
  q("select * from public.cockpit_board_appointments('locA',$1,$2,'[]')", [
    day(5),
    day(0),
  ]);

beforeAll(async () => {
  db = await cockpitTestDb({ supabaseDefaultPrivileges: true });
  const text = readFileSync(
    new URL("./board-facts-supabase.test.ts", import.meta.url),
    "utf8",
  );
  const fixture = text.match(/const DIALER = String\.raw`([\s\S]*?)`;\n/)?.[1];
  if (!fixture || fixture.includes("${"))
    throw new Error("Board source fixture moved");
  await db.exec(fixture);
  const seat = migration("20261007d_cockpit_team_rpc_restore.sql").match(
    /create or replace function public\.cockpit_has_active_seat\(\)[\s\S]*?\$\$;/,
  )?.[0];
  const allowed = migration("20260926m_cockpit_csm_state.sql").match(
    /CREATE OR REPLACE FUNCTION public\.cockpit_client_allowed\(p_name text\)[\s\S]*?END \$\$;/,
  )?.[0];
  if (!seat || !allowed) throw new Error("Seat definitions moved");
  await db.exec(seat + allowed);
  await db.exec(`ALTER TABLE public.appointments ADD COLUMN ad_id text,ADD COLUMN adset_id text,ADD COLUMN campaign_id text,ADD COLUMN contact_name text;
    CREATE TABLE mahara_reporting.inventory(namespace text,source text,kind text,external_id text,last_seen timestamptz,checked_at timestamptz,present boolean,PRIMARY KEY(namespace,source,kind,external_id));`);
  // Facts and the exact booking rule currently deployed. The appointments body
  // has not changed since the API migration and is independently checksum-guarded.
  for (const name of [
    "20261013180000_cockpit_client_calls.sql",
    "20261015200000_cockpit_client_calls_whatsapp_chats.sql",
    "20261013180200_cockpit_client_callers.sql",
    "20261016111157_board_facts.sql",
    "20261016210000_board_facts_checked.sql",
    "20261021l_board_booking_rule.sql",
  ])
    await db.exec(migration(name));
  const api = migration("20261016133300_board_api.sql").match(
    /CREATE OR REPLACE FUNCTION public\.cockpit_board_appointments\([\s\S]*?\n\$\$;/,
  )?.[0];
  if (!api) throw new Error("Board appointment definition moved");
  await db.exec(api);
  await db.exec(`REVOKE ALL ON FUNCTION public.cockpit_board_appointments(text,date,date,jsonb) FROM PUBLIC,anon,authenticated,service_role;
    ALTER TABLE portal_data.appointment_outcomes ADD COLUMN request_id text,ADD COLUMN feedback text,ADD COLUMN consultation_feedback text,ADD COLUMN not_closed_reason text,ADD COLUMN source_record_id text,ADD COLUMN source_updated_at timestamptz;
    CREATE TABLE portal_data.appointments(location_id text,appointment_id text,contact_id text,start_at timestamptz,calendar_id text,deleted_at timestamptz,ad_name text,campaign_name text,PRIMARY KEY(location_id,appointment_id));
    CREATE TABLE portal_data.contacts(location_id text,contact_id text,name text,PRIMARY KEY(location_id,contact_id));
    CREATE TABLE portal_data.outbox(location_id text,request_id text,operation text,object_id text,expected_revision text,state text,payload jsonb,next_attempt_at timestamptz,created_at timestamptz,last_error text);
    CREATE TABLE portal_data.journey_outcome_bindings(location_id text,appointment_id text,revision bigint,start_at timestamptz,contact_id text,PRIMARY KEY(location_id,appointment_id,revision));`);
  await db.exec(
    readFileSync(
      new URL("./fixtures/canonical-outcome-accept.sql", import.meta.url),
      "utf8",
    ),
  );
  await db.exec(migration(FIRST));
  await db.exec(`INSERT INTO public.ghl_clients(location_id,client_name,status,clickup_id,country,service_mode) VALUES('locA','Client A','Active','taskA','KW','DFY'),('locB','Client B','Active','taskB','KW','DFY');
    INSERT INTO public.ghl_calendars(location_id,calendar_id,name) VALUES('locA','calA','Main Appointment Calendar');
    INSERT INTO public.appointment_sync_state VALUES('locA',now(),'success'),('locB',now(),'success');
    INSERT INTO public.lead_sync_state VALUES('locA',now(),'success',null),('locB',now(),'success',null);`);
  for (const [id, status, attended] of [
    ["sparse", "noshow", false],
    ["no-show", "showed", true],
    ["other-contact", "confirmed", null],
    ["moved", "confirmed", null],
    ["cross-client", "confirmed", null],
    ["legacy", "confirmed", null],
  ] as const) {
    await q(
      "insert into public.appointments(ghl_appointment_id,ghl_contact_id,ghl_location_id,calendar_id,booked_at,start_at,status,attended) values($1,$2,'locA','calA',$3,$4,$5,$6)",
      [id, `lead-${id}`, at(4), at(2), status, attended],
    );
    await q(
      "insert into portal_data.appointments values('locA',$1,$2,$3,'calA',null,null,null)",
      [id, `lead-${id}`, at(2)],
    );
  }
  await q(
    "insert into portal_data.appointments values('locB','cross-client','other-lead',$1,null,null,null,null)",
    [at(2)],
  );
  const outcome = async (
    id: string,
    revision: number,
    attendance: string | null,
    quality: number | null,
    source = "portal",
    loc = "locA",
    bound = true,
  ) => {
    const request = source === "portal" ? `${loc}-${id}-${revision}` : null;
    await q(
      "insert into portal_data.appointment_outcomes(location_id,appointment_id,revision,attendance,lead_quality,feedback,source,request_id,quotation,deal,project_value,currency) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
      [
        loc,
        id,
        revision,
        attendance,
        quality,
        `Invented report ${revision}`,
        source,
        request,
        id === "sparse" && revision === 1 ? true : null,
        id === "sparse" && revision === 1 ? "won" : null,
        id === "sparse" && revision === 1 ? 100 : null,
        id === "sparse" && revision === 1 ? "KWD" : null,
      ],
    );
    if (request)
      await q(
        "insert into portal_data.outbox(location_id,request_id,operation,object_id,expected_revision,state) values($1,$2,'appointment-outcome',$3,$4,'pending')",
        [loc, request, id, String(revision)],
      );
    if (bound)
      await q(
        "insert into portal_data.journey_outcome_bindings values($1,$2,$3,$4,$5)",
        [
          loc,
          id,
          revision,
          id === "moved" ? at(3) : at(2),
          id === "other-contact" || loc === "locB"
            ? "other-lead"
            : `lead-${id}`,
        ],
      );
  };
  await outcome("sparse", 1, "showed", 8);
  await outcome("sparse", 2, null, null);
  await outcome("sparse", 3, "no_show", 2, "reporting-capture");
  await outcome("no-show", 1, "no_show", 9);
  await outcome("other-contact", 1, "showed", 9);
  await outcome("moved", 1, "showed", 9);
  await outcome("cross-client", 1, "showed", 9, "portal", "locB");
  await outcome("legacy", 1, "showed", 6, "portal-capture", "locA", false);
  await db.exec(SQL);
  await db.exec(SQL);
}, 60000);
afterAll(async () => {
  await db?.close();
});

test("exact-bound sparse feedback supersedes stale CRM and captured Sheet attendance", async () => {
  const sparse = (await board()).find(r => r.id === "sparse");
  expect(sparse).toMatchObject({ attendance: "showed", no_outcome: false });
  const saved = await q(
    "select * from portal_data.cockpit_feedback_outcomes('locA') where appointment_id='sparse'",
  );
  expect(saved[0]).toMatchObject({
    attendance: "showed",
    lead_quality: "8",
    quotation: true,
    deal: "won",
    project_value: "100",
    currency: "KWD",
    authoritative_attendance: true,
  });
});

test("no-show wins over a stale showed status and is never scored", async () => {
  expect((await board()).find(r => r.id === "no-show")).toMatchObject({
    attendance: "noshow",
    no_outcome: false,
  });
  expect(
    (
      await q(
        "select * from portal_data.cockpit_feedback_outcomes('locA') where appointment_id='no-show'",
      )
    )[0].lead_quality,
  ).toBeNull();
});

test("other contact, moved occurrence and other client's same ID do not leak into current attendance", async () => {
  const a = await board();
  for (const id of ["other-contact", "moved", "cross-client"])
    expect(a.find(r => r.id === id)).toMatchObject({
      attendance: "unknown",
      no_outcome: true,
    });
});

test("legacy unbound reports retain fallback without becoming authoritative", async () => {
  const legacy = (
    await q(
      "select * from portal_data.cockpit_feedback_outcomes('locA') where appointment_id='legacy'",
    )
  )[0];
  expect(legacy).toMatchObject({
    attendance: "showed",
    lead_quality: "6",
    authoritative_attendance: false,
  });
  expect((await board()).find(r => r.id === "legacy").attendance).toBe(
    "showed",
  );
});

test("full facts refresh uses the same attendance and suppresses no-show quality", async () => {
  await db.exec("BEGIN");
  try {
    const result = (
      await q("select public.cockpit_board_facts_refresh($1,$2) as v", [
        day(5),
        day(0),
      ])
    )[0].v;
    expect(result.ok).toBe(true);
    const metrics = Object.fromEntries(
      (
        await q(
          "select metric,sum(value)::float8 as value from pg_temp._bf_v where location_id='locA' and day=$1 group by metric",
          [day(2)],
        )
      ).map(r => [r.metric, r.value]),
    );
    expect(metrics).toMatchObject({
      meetings_due: 6,
      shows: 2,
      no_shows: 1,
      no_outcome: 3,
      lq_sum: 14,
      lq_count: 2,
    });
    expect(
      (
        await q(
          "select sum(value)::int n from pg_temp._bf_v where location_id='locA' and metric='confirmed_bookings'",
        )
      )[0].n,
    ).toBe(6);
  } finally {
    await db.exec("ROLLBACK");
  }
});

test("the existing call-back booking exclusion still runs under the overlay", async () => {
  await db.exec("BEGIN");
  try {
    const stamp = Date.parse(at(4));
    await q(
      "insert into mahara_console.attempts values('production','callback-example','locA:lead-legacy','agent@tests.invalid','closed',$1,$2)",
      [
        JSON.stringify({
          locationId: "locA",
          contactId: "lead-legacy",
          mode: "outcome",
          dispositionSavedAt: stamp,
          disposition: { outcome: "CALLBACK", note: "Invented call-back" },
          appointmentId: "legacy",
          bookingVerification: { id: "legacy" },
        }),
        stamp,
      ],
    );
    const result = (
      await q("select public.cockpit_board_facts_refresh($1,$2) as v", [
        day(5),
        day(0),
      ])
    )[0].v;
    expect(result.ok).toBe(true);
    expect(
      (
        await q(
          "select sum(value)::int n from pg_temp._bf_v where location_id='locA' and metric='confirmed_bookings'",
        )
      )[0].n,
    ).toBe(5);
    expect(
      (
        await q(
          "select sum(value)::int n from pg_temp._bf_v where location_id='locA' and metric='meetings_due'",
        )
      )[0].n,
    ).toBe(6);
  } finally {
    await db.exec("ROLLBACK");
  }
});

test("a broken feedback source is explicit while independent bookings still land", async () => {
  await db.exec("BEGIN");
  try {
    await db.exec(
      "alter table portal_data.appointment_outcomes rename to feedback_source_offline",
    );
    const result = (
      await q("select public.cockpit_board_facts_refresh($1,$2) as v", [
        day(5),
        day(0),
      ])
    )[0].v;
    expect(result.ok).toBe(false);
    expect(
      result.failures.some((f: { source: string }) => f.source === "outcomes"),
    ).toBe(true);
    expect(
      (
        await q(
          "select sum(value)::int n from pg_temp._bf_v where location_id='locA' and metric='confirmed_bookings'",
        )
      )[0].n,
    ).toBe(6);
    expect(
      (
        await q(
          "select state from pg_temp._bf_src where source='outcomes' and location_id='locA'",
        )
      )[0].state,
    ).toBe("failed");
  } finally {
    await db.exec("ROLLBACK");
  }
});

test("unrelated changed board body is rejected atomically and original grants remain private", async () => {
  for (const role of ["anon", "authenticated", "service_role"]) {
    const access = (
      await q(
        "select has_function_privilege($1,'portal_data.cockpit_feedback_outcomes(text)','EXECUTE') as helper,has_function_privilege($1,'public.cockpit_board_appointments(text,date,date,jsonb)','EXECUTE') as appts",
        [role],
      )
    )[0];
    expect(access).toEqual({ helper: false, appts: false });
  }
  const definition = (
    await q(
      "select pg_get_functiondef('public.cockpit_board_appointments(text,date,date,jsonb)'::regprocedure) as v",
    )
  )[0].v;
  await db.exec(
    definition.replace(
      "portal_data.cockpit_feedback_outcomes(p_location)",
      "portal_data.cockpit_feedback_outcomes((p_location))",
    ),
  );
  await expect(db.exec(SQL)).rejects.toThrow("Board appointments changed");
  await db.exec("ROLLBACK");
  await db.exec(definition);
});
