/**
 * The shadow planner (20261027h_checkin_plans.sql, docs/forms/STAGE2-CONTRACT.md
 * 2.3, 7.1 to 7.3 and 11) on an isolated PostgreSQL with Supabase's default
 * privileges on, so a missing REVOKE opens a function here as it would in
 * production. It stands on the harness the shadow replay plans with
 * (checkin-replay.ts replayDb: the canonical stand-ins, then v, w and x).
 *
 * Covered: every row of 7.1 (each skip reason, the option map, the two days
 * at 23:30 Kuwait, value_options, the comment text and its sides, the grade's
 * dedupe, the call_form link and ownCall), the write-through answers of 7.2
 * read through the client brief's exported code only (buildBrief and
 * formAnswer; OWNER_OURS, OWNER_THEIRS and noteLines are private to
 * clientBrief.ts), with short and Arabic items, and the eleven cases Stage 2b
 * build 12 fixed (each labelled to-do stays whole on its side however short,
 * and a short last Client Notes line no longer takes a to-do into the recap;
 * docs/forms/STAGE2B-CONTRACT.md 4.12, G11), one shadow submit end
 * to end as the CSM (eight effect rows,
 * dry_run or skipped, nothing outside the forms tables), and, with the
 * registry flipped in a rolled-back transaction, v's executor writing the
 * planned row where the timeline shows it; and OUTSIDE_CS_LIKELY's remedy
 * (A7.14 rule 2, A7.18), also rolled back: a closer's call a name put on Cedar
 * is refused for the CSM until an admin or the CEO sends live notes with it;
 * x then skips call_match (the row stays the worker's, name 0.6), the stored
 * notes' share link ties it for her and for no seat by rule 3's form-link
 * clause, and her own send is refused as the call's second record. Every
 * person, client, recording and room is invented.
 */
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  setDefaultTimeout,
  test,
} from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import {
  buildBrief,
  formAnswer,
} from "../../client-success-cockpit/src/lib/clientBrief";
import type { Timeline } from "../../client-success-cockpit/src/lib/csmCalls";
import { EFFECTS, MIGRATIONS, replayDb } from "./checkin-replay";
import { actor, member, migration } from "./lib/cockpitTestDb";

// Keep direct, ship and readiness runs consistent on busy build hosts.
setDefaultTimeout(120_000);

const CEO = "00000000-0000-4000-8000-0000000000c3";
const ADMIN = "00000000-0000-4000-8000-0000000000d1";
const CSM = "00000000-0000-4000-8000-0000000000a1";
const CSM_EMAIL = "csm@tests.invalid";

const A = "taskA1"; // Acme Interiors
const B = "taskB1"; // Beta Build
const C = "taskC1"; // Cedar Homes

const REF = {
  clientId: "c484f390-9695-4ffa-9693-9cc219592713",
  additional: "82a6b434-15d9-4a14-8496-c20c94628536",
  clientNotes: "5d071906-da6a-4413-a729-0c76d0188d91",
  defcon: "ff7970f7-9fad-4fa5-b12b-4d719dfb7587",
  priority: "c9f99fb1-fec9-47e7-9baa-c5554733723d",
};
const OPTIONS: [string, string][] = [
  ["Paused", "67c08bcd-e629-47ab-85ba-3ac4b3796734"],
  ["At Risk", "f0623c2a-161d-4aa2-8833-d1337c69e1c2"],
  ["Neutral", "46e595a3-17d7-4835-80f9-8a4c578b72a3"],
  ["Happy", "c5d6b01f-5f2b-40c1-afac-5b9f1efab213"],
  ["Very Happy (testimonial)", "d403adf4-24aa-40f0-a960-05e6a4621ee9"],
  ["Churned", "1c055070-45d6-4a19-ade3-958851313d7c"],
];

let db: PGlite;
type Row = Record<string, any>;

async function asOwner() {
  await db.exec("RESET ROLE");
  await db.query("SELECT set_config('request.jwt.claim.sub','',false)");
  await db.query("SELECT set_config('request.jwt.claims','',false)");
}
async function q<T = Row>(text: string, params: unknown[] = []): Promise<T[]> {
  await asOwner();
  return (await db.query<T>(text, params)).rows;
}
/** One value as a seat. */
async function one<T = any>(
  who: string,
  text: string,
  params: unknown[] = [],
): Promise<T> {
  await actor(db, who);
  try {
    return (await db.query<{ r: T }>(text, params)).rows[0].r;
  } finally {
    await asOwner();
  }
}
/** Runs as the owner inside a transaction that is always rolled back. */
async function rolledBack(fn: () => Promise<void>) {
  await asOwner();
  await db.exec("BEGIN");
  try {
    await fn();
  } finally {
    await db.exec("ROLLBACK");
    await asOwner();
  }
}
/**
 * A refusal the case expects, inside rolledBack: the statement runs as the
 * seat under a savepoint, so the transaction stays usable after it.
 */
async function refusedAs(
  who: string,
  text: string,
  params: unknown[] = [],
): Promise<{ code: string; message: string }> {
  await asOwner();
  await db.exec("SAVEPOINT expected_refusal");
  try {
    await actor(db, who);
    await db.query(text, params);
  } catch (e) {
    await db.exec("ROLLBACK TO SAVEPOINT expected_refusal");
    await asOwner();
    const x = e as { code?: string; message: string };
    return { code: x.code ?? "", message: x.message };
  }
  await db.exec("RESET ROLE");
  await db.exec("RELEASE SAVEPOINT expected_refusal");
  await asOwner();
  throw new Error(`Expected a refusal for ${text}`);
}
/** One value as PostgREST with the service key (the forms door). */
async function asService<T = any>(
  text: string,
  params: unknown[] = [],
): Promise<T> {
  await asOwner();
  await db.query("SELECT set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({ role: "service_role" }),
  ]);
  await db.exec("SET ROLE service_role");
  try {
    return (await db.query<{ r: T }>(text, params)).rows[0].r;
  } finally {
    await asOwner();
  }
}
/** "14:10", Kuwait time (cockpit_form_kuwait_clock). */
const kuwaitClock = (at: Date | string) =>
  new Date(new Date(at).getTime() + 3 * 3_600_000).toISOString().slice(11, 16);

const todo = (text: string, o: Row = {}) => ({
  text,
  owner: null,
  at: null,
  href: null,
  from: "csm",
  unsure: false,
  ...o,
});
/** A recording as cockpit_form_checkin_value stores it (3.1). */
const fathom = (rec: string, o: Row = {}) => ({
  kind: "fathom",
  recordingId: rec,
  callId: null,
  shareUrl: `https://fathom.video/share/test-${rec}`,
  startsAt: "2026-10-20T06:58:00.000Z",
  endsAt: "2026-10-20T07:31:00.000Z",
  title: "Invented check-in",
  why: "same_room",
  recorder: "csm",
  confirmed: true,
  ...o,
});
const booking = (id: number, startsAt: string) => ({
  kind: "booking",
  callId: id,
  startsAt,
  endsAt: null,
  why: "booking",
  confirmed: true,
});
const NONE = { kind: "none", why: "none", confirmed: true };
const ANSWERS = {
  defcon: "At Risk",
  priority: "High",
  we_owe: [todo("Send the new ad drafts by Thursday", { owner: "the CSM" })],
  they_owe: [todo("Share the showroom photos with the team")],
};

let seq = 0;
/** A response stored submitted in shadow, and its eight plans. */
async function planOf(
  answers: Row,
  o: {
    task?: string;
    client?: string | null;
    by?: string | null;
    at?: string;
  } = {},
): Promise<{ id: string; plans: Row[]; of: (k: string) => Row }> {
  seq += 1;
  const id = `20000000-0000-4000-8000-${String(seq).padStart(12, "0")}`;
  await q(
    `INSERT INTO public.cockpit_form_responses(id, form_key, form_version, source, task_id, client_name, mode, state,
       answers, created_by, submitted_by, submitted_at)
     VALUES ($1, 'checkin', 1, 'import', $2, $3, 'shadow', 'submitted', $4::jsonb, 'import', $5, $6)`,
    [
      id,
      o.task ?? A,
      o.client === undefined ? "Acme Interiors" : o.client,
      JSON.stringify(answers),
      o.by === undefined ? CSM_EMAIL : o.by,
      o.at ?? "2026-10-20T08:15:00Z",
    ],
  );
  const plans = (
    await q<{ p: Row[] }>(
      "SELECT public.cockpit_form_checkin_plan(r) AS p FROM public.cockpit_form_responses r WHERE r.id = $1",
      [id],
    )
  )[0].p;
  const of = (k: string) => {
    const hit = plans.find(p => p.effect === k);
    if (!hit) throw new Error(`No ${k} plan`);
    return hit;
  };
  return { id, plans, of };
}

async function seats() {
  await member(db, CEO, "aziz@maharamedia.com", []);
  await member(db, ADMIN, "admin@tests.invalid", ["admin"]);
  await member(db, CSM, CSM_EMAIL, ["csm"]);
  for (const [name, email, role] of [
    ["Noura Test", CSM_EMAIL, "Client success manager"],
    ["Omar Test", "admin@tests.invalid", "Operations"],
  ])
    await db.query(
      "INSERT INTO public.cockpit_people(name,email,role,active,added_by) VALUES($1,$2,$3,true,'test')",
      [name, email, role],
    );
  const snap = "2026-10-27T08:00:00Z";
  const clients = [
    [A, "Acme Interiors", "Active", "Happy"],
    [B, "Beta Build", "Onboarding", null],
    [C, "Cedar Homes", "Active", "At Risk"],
  ] as const;
  for (const [taskId, name, stage, happiness] of clients)
    await db.query(
      "INSERT INTO public.cockpit_csm_sources(table_name,source_id,client_names,data,source_snapshot_at) VALUES('clients',$1,$2,$3::jsonb,$4)",
      [
        `c-${taskId}`,
        [name],
        JSON.stringify({ _id: `c-${taskId}`, taskId, name, stage, happiness }),
        snap,
      ],
    );
  await db.query(
    "UPDATE public.cockpit_csm_source_state SET ready=true,row_count=$1,source_snapshot_at=$2 WHERE table_name='clients'",
    [clients.length, snap],
  );
}

/**
 * The call store: Acme's live booking 40 with its same-room recording 108;
 * recording 109 linked to a booking that is gone (41); recording 110 linked to
 * Beta's booking 42; recording 111 on no client yet (a candidate); recording
 * 900000204 with no call row at all; and Acme's booking 43, held at 23:30
 * Kuwait. A ready grade for 900000201 drafted from Beta's window.
 */
async function store() {
  await db.exec(`
    INSERT INTO public.cockpit_csm_calls(id, source, source_id, task_id, client_name, match_method, match_confidence,
      kind, title, starts_at, ends_at, status, room) OVERRIDING SYSTEM VALUE VALUES
      (40, 'ghl_appointment', 'appt-acme-40', '${A}', 'Acme Interiors', 'client_id_field', 1, 'checkin', 'Check-in',
       '2026-10-20T07:00:00Z', '2026-10-20T07:30:00Z', 'confirmed', 'meet:abc-defg-hij'),
      (41, 'ghl_appointment', 'appt-acme-41', '${A}', 'Acme Interiors', 'client_id_field', 1, 'checkin', 'Check-in',
       '2026-10-19T07:00:00Z', '2026-10-19T07:30:00Z', 'gone', NULL),
      (42, 'ghl_appointment', 'appt-beta-42', '${B}', 'Beta Build', 'client_id_field', 1, 'onboarding', 'Onboarding',
       '2026-10-18T07:00:00Z', '2026-10-18T07:30:00Z', 'confirmed', NULL),
      (43, 'ghl_appointment', 'appt-acme-43', '${A}', 'Acme Interiors', 'client_id_field', 1, 'checkin', 'Check-in',
       '2026-10-20T20:30:00Z', '2026-10-20T21:00:00Z', 'confirmed', NULL);
    INSERT INTO public.cockpit_csm_calls(id, source, source_id, task_id, client_name, match_method, match_confidence,
      kind, title, starts_at, ends_at, status, linked_call_id, room) OVERRIDING SYSTEM VALUE VALUES
      (108, 'fathom', '900000201', '${A}', 'Acme Interiors', 'same_room', 1, 'checkin', 'Invented check-in',
       '2026-10-20T06:58:00Z', '2026-10-20T07:31:00Z', 'held', 40, 'meet:abc-defg-hij'),
      (109, 'fathom', '900000202', '${A}', 'Acme Interiors', 'appointment_time', 1, 'checkin', 'Invented check-in',
       '2026-10-19T07:01:00Z', '2026-10-19T07:29:00Z', 'held', 41, NULL),
      (110, 'fathom', '900000203', '${A}', 'Acme Interiors', 'invitee_email', 1, 'other', 'Invented call',
       '2026-10-18T07:02:00Z', '2026-10-18T07:28:00Z', 'held', 42, NULL),
      (111, 'fathom', '900000205', NULL, NULL, NULL, NULL, 'other', 'Impromptu Google Meet Meeting',
       '2026-10-20T11:00:00Z', '2026-10-20T11:40:00Z', 'held', NULL, 'meet:kln-opqr-stu');`);
  const csm = {
    name: "Noura Test",
    email: CSM_EMAIL,
    team: "Customer Success",
  };
  for (const [rec, cls, start, end] of [
    ["900000201", "client", "2026-10-20T06:58:00Z", "2026-10-20T07:31:00Z"],
    ["900000204", "candidate", "2026-10-26T12:00:00Z", "2026-10-26T12:35:00Z"],
  ])
    await db.query(
      `INSERT INTO public.cockpit_fathom_meetings(recording_id, title, starts_at, ends_at, recorded_by_email, recorded_by_name,
         external, invitees, url, share_url, summary, raw, class, recorder_team)
       VALUES ($1, 'Invented check-in', $2, $3, $4, 'Noura Test', $5, '[]'::jsonb, $6, $7, NULL, $8::jsonb, $9, 'Customer Success')`,
      [
        rec,
        start,
        end,
        CSM_EMAIL,
        cls === "client",
        `https://fathom.video/calls/${Number(rec) + 1000}`,
        `https://fathom.video/share/test-${rec}`,
        JSON.stringify({
          recorded_by: csm,
          calendar_invitees_domains_type: "one_or_more_external",
          shared_with: "all_teams",
          created_at: end,
        }),
        cls,
      ],
    );
  // One grade per call, whichever client's window drafted it.
  await db.exec(`
    INSERT INTO public.cockpit_form_drafts(id, form_key, task_id, recording_id, kind, provider, prompt_version,
      input_sha256, state, created_by)
    VALUES ('30000000-0000-4000-8000-000000000001', 'checkin', '${B}', '900000201', 'grade', 'anthropic',
      'checkin.grade.v1', '${"a".repeat(64)}', 'drafting', 'server');
    UPDATE public.cockpit_form_drafts SET state = 'ready', output = '{"score": 7.1, "color": "Orange"}'::jsonb,
      finished_at = now() WHERE id = '30000000-0000-4000-8000-000000000001';`);
}

beforeAll(async () => {
  db = await replayDb();
  await seats();
  await store();
}, 120_000);
afterAll(async () => {
  await db?.close();
});

// ---------------------------------------------------------------------------

const SIGNATURES = [
  ["cockpit_form_checkin_plan(public.cockpit_form_responses)", "s", "plpgsql"],
  ["cockpit_form_checkin_legacy(jsonb,text)", "i", null],
  ["cockpit_form_checkin_comment(jsonb,text,date)", "i", null],
  ["cockpit_form_happiness_option(text)", "i", null],
  ["cockpit_form_epoch_day(date)", "i", null],
  ["cockpit_form_clock(integer)", "i", null],
] as const;

describe("the migration", () => {
  test("is one transaction that reloads the schema, and the deploy's v w x v w x applies", async () => {
    const sql = migration(MIGRATIONS[2]);
    expect(sql.startsWith("-- ")).toBe(true);
    expect(sql).toContain("\nBEGIN;\n");
    expect(
      sql.trimEnd().endsWith("NOTIFY pgrst, 'reload schema';\nCOMMIT;"),
    ).toBe(true);
    const plan = async () =>
      JSON.stringify(
        (await planOf({ call: fathom("900000201"), ...ANSWERS })).plans,
      );
    const before = await plan();
    await asOwner();
    for (const file of MIGRATIONS) await db.exec(migration(file));
    await db.exec(migration(MIGRATIONS[2]));
    // A further apply changes no plan (each response id differs, so compare without it).
    const strip = (s: string) =>
      s.replace(/20000000-0000-4000-8000-\d{12}/g, "ID");
    expect(strip(await plan())).toBe(strip(before));
    for (const [sig] of SIGNATURES)
      expect(
        (
          await q<{ n: number }>(
            "SELECT count(*)::int AS n FROM pg_proc WHERE oid = $1::regprocedure",
            [`public.${sig}`],
          )
        )[0].n,
      ).toBe(1);
  });

  test("every function is internal: definer, empty search path, as volatile as written, no role may run it", async () => {
    for (const [sig, volatility, language] of SIGNATURES) {
      const [p] = await q(
        `SELECT p.prosecdef, p.provolatile, l.lanname, p.proconfig,
                coalesce((SELECT array_agg(coalesce(r.rolname, 'PUBLIC') ORDER BY 1) FROM aclexplode(p.proacl) a
                           LEFT JOIN pg_roles r ON r.oid = a.grantee
                          WHERE a.privilege_type = 'EXECUTE'), '{}') AS runners
           FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang WHERE p.oid = $1::regprocedure`,
        [`public.${sig}`],
      );
      expect(p.prosecdef).toBe(true);
      expect(p.provolatile).toBe(volatility);
      if (language) expect(p.lanname).toBe(language);
      expect(p.proconfig).toEqual(['search_path=""']);
      for (const role of ["PUBLIC", "anon", "authenticated", "service_role"])
        expect(p.runners).not.toContain(role);
      for (const role of ["anon", "authenticated", "service_role"])
        expect(
          (
            await q<{ ok: boolean }>(
              "SELECT has_function_privilege($1, $2::regprocedure, 'EXECUTE') AS ok",
              [role, `public.${sig}`],
            )
          )[0].ok,
        ).toBe(false);
    }
  });
});

describe("the eight plans (7.1)", () => {
  test("a recording's notes plan the eight effects in registry order, with their deliveries and lines", async () => {
    const { plans, of } = await planOf({
      call: fathom("900000201"),
      ...ANSWERS,
    });
    expect(plans.map(p => p.effect)).toEqual([...EFFECTS]);
    const registry = (
      await q<{ e: Row[] }>(
        "SELECT effects AS e FROM public.cockpit_forms WHERE key = 'checkin'",
      )
    )[0].e;
    expect(plans.map(p => p.delivery)).toEqual(registry.map(e => e.delivery));
    for (const p of plans) {
      expect(Object.keys(p).sort()).toEqual([
        "delivery",
        "effect",
        "plan",
        "reason",
        "state",
      ]);
      expect(Array.isArray(p.plan.lines)).toBe(true);
    }
    expect(of("call_match").state).toBe("skipped");
    expect(
      plans
        .filter(p => p.state === "planned")
        .map(p => [p.effect, p.plan.lines]),
    ).toEqual([
      [
        "call_form",
        ["Would save the notes where the client brief and Today read them."],
      ],
      [
        "todo_comment",
        [
          "Would post the to-do comment on the card: 2 lines, recording link first.",
        ],
      ],
      ["happiness", ["Would set Client Happiness to At risk."]],
      [
        "last_poc",
        ["Would set Last POC to 20 Oct, only if the card's date is older."],
      ],
      [
        "last_checkin_call",
        [
          "Would set Last Check-in Call to 20 Oct, only if the card's date is older.",
        ],
      ],
      ["grade_notice", ["Would post the call grade in #client-call-feedback."]],
      ["recap", ["Would hold the client's recap for approval in the cockpit."]],
    ]);
  });

  test("each skip reason, and a skipped plan would do nothing", async () => {
    const onBooking = await planOf({
      call: booking(43, "2026-10-20T20:30:00.000Z"),
      ...ANSWERS,
    });
    const withNone = await planOf({ call: NONE, ...ANSWERS });
    for (const r of [onBooking, withNone]) {
      expect(r.plans).toHaveLength(8);
      const skipped = r.plans.filter(p => p.state === "skipped");
      expect(skipped.map(p => [p.effect, p.reason])).toEqual([
        ["call_match", "No recording to put on this client."],
        ["grade_notice", "No grade: no recording for this call."],
        ["recap", "No recap: no recording for this call."],
      ]);
      for (const p of skipped) expect(p.plan.lines).toEqual([]);
    }
    const onClient = await planOf({ call: fathom("900000201"), ...ANSWERS });
    expect([
      onClient.of("call_match").state,
      onClient.of("call_match").reason,
    ]).toEqual(["skipped", "The recording is already on this client."]);
    expect(onClient.of("call_match").plan).toEqual({
      recordingId: "900000201",
      callId: 108,
      taskId: A,
      lines: [],
    });
    const empty = await planOf({
      call: fathom("900000201"),
      defcon: "Happy",
      priority: "Low",
      we_owe: [],
      they_owe: [],
    });
    expect(empty.of("todo_comment")).toEqual({
      effect: "todo_comment",
      delivery: "clickup_queue",
      state: "skipped",
      reason: "No comment: We owe and They owe are empty.",
      plan: { taskId: A, items: 0, sides: { ours: 0, theirs: 0 }, lines: [] },
    });
    // The four effects with no skip rule are planned for every call.
    for (const r of [onBooking, withNone, empty])
      for (const k of [
        "call_form",
        "happiness",
        "last_poc",
        "last_checkin_call",
      ])
        expect(r.of(k).state).toBe("planned");
  });

  test("call_match puts a recording on the client when its row is on no client or missing", async () => {
    const candidate = await planOf({ call: fathom("900000205"), ...ANSWERS });
    expect(candidate.of("call_match")).toEqual({
      effect: "call_match",
      delivery: "sql",
      state: "planned",
      reason: null,
      plan: {
        recordingId: "900000205",
        callId: 111,
        taskId: A,
        method: "manual",
        lines: ["Would put this recording on Acme Interiors."],
      },
    });
    const missing = await planOf(
      { call: fathom("900000204"), ...ANSWERS },
      { client: null },
    );
    expect(missing.of("call_match").plan).toMatchObject({
      recordingId: "900000204",
      callId: null,
      method: "manual",
      lines: ["Would put this recording on this client."],
    });
  });

  test("Client Happiness by option id for the six labels, and nothing for any other", async () => {
    for (const [label, id] of OPTIONS) {
      const { of } = await planOf({ call: NONE, ...ANSWERS, defcon: label });
      expect(of("happiness").plan).toEqual({
        taskId: A,
        field: "4e3924e3-4898-4e98-aca1-cc1ac3015b73",
        label,
        value: id,
        lines: [
          `Would set Client Happiness to ${label[0]}${label.slice(1).toLowerCase()}.`,
        ],
      });
    }
    expect(
      (
        await q<{ v: string | null }>(
          "SELECT public.cockpit_form_happiness_option(x) AS v FROM unnest(ARRAY['At risk','Happy ','Unhappy','']) x",
        )
      ).map(r => r.v),
    ).toEqual([null, null, null, null]);
  });

  test("Last POC is the Kuwait day the call ended, Last Check-in Call the day it started, date-only and forward only", async () => {
    const value = (day: string) => Date.parse(`${day}T09:00:00Z`);
    const days = (r: { of: (k: string) => Row }) => [
      r.of("last_poc").plan.day,
      r.of("last_checkin_call").plan.day,
    ];
    // A recording from 23:30 to 00:10 Kuwait.
    const late = await planOf({
      call: fathom("900000201", {
        startsAt: "2026-10-20T20:30:00.000Z",
        endsAt: "2026-10-20T21:10:00.000Z",
      }),
      ...ANSWERS,
    });
    expect(days(late)).toEqual(["2026-10-21", "2026-10-20"]);
    expect(late.of("last_poc").plan).toEqual({
      taskId: A,
      field: "e183f2ce-8b7a-491a-b160-2287a247758b",
      day: "2026-10-21",
      value: value("2026-10-21"),
      value_options: { time: false },
      rule: "forward_only",
      lines: [
        "Would set Last POC to 21 Oct, only if the card's date is older.",
      ],
    });
    expect(late.of("last_checkin_call").plan).toEqual({
      taskId: A,
      field: "032203ad-e327-4d76-a0ce-c07496da6486",
      day: "2026-10-20",
      value: value("2026-10-20"),
      value_options: { time: false },
      rule: "forward_only",
      lines: [
        "Would set Last Check-in Call to 20 Oct, only if the card's date is older.",
      ],
    });
    // A booking held at 23:30 Kuwait: both days are its start's.
    expect(
      days(
        await planOf({
          call: booking(43, "2026-10-20T20:30:00.000Z"),
          ...ANSWERS,
        }),
      ),
    ).toEqual(["2026-10-20", "2026-10-20"]);
    // No recording: the day of the notes, at 23:30 and just after midnight Kuwait.
    expect(
      days(
        await planOf(
          { call: NONE, ...ANSWERS },
          { at: "2026-10-20T20:30:00Z" },
        ),
      ),
    ).toEqual(["2026-10-20", "2026-10-20"]);
    expect(
      days(
        await planOf(
          { call: NONE, ...ANSWERS },
          { at: "2026-10-20T21:30:00Z" },
        ),
      ),
    ).toEqual(["2026-10-21", "2026-10-21"]);
    // A recording without an end falls back to its start.
    expect(
      days(
        await planOf({
          call: fathom("900000201", { endsAt: null }),
          ...ANSWERS,
        }),
      ),
    ).toEqual(["2026-10-20", "2026-10-20"]);
    expect(
      (
        await q<{ v: string }>(
          "SELECT public.cockpit_form_epoch_day('2026-10-21'::date)::text AS v",
        )
      )[0].v,
    ).toBe(String(value("2026-10-21")));
  });

  test("the to-do comment: the recording line, the two sections, owner and time, no ** or #, the role and the day", async () => {
    const { of } = await planOf({
      call: fathom("900000201"),
      ...ANSWERS,
      we_owe: [
        todo("Send the new ad drafts", { owner: "the CSM", at: 754 }),
        todo("Fix the landing page form", { at: 3723 }),
        todo("Book the photographer", { owner: "the CSM" }),
        todo("Draft the **#1** offer copy"),
      ],
      they_owe: [
        todo("Share the showroom photos", { at: 65 }),
        todo("Approve the budget", { owner: "Someone" }),
      ],
    });
    const p = of("todo_comment").plan;
    expect(p.comment_text).toBe(
      [
        "Call recording: https://fathom.video/share/test-900000201",
        "",
        "*Mahara owes*",
        "- Send the new ad drafts (the CSM, 12:34)",
        "- Fix the landing page form (1:02:03)",
        "- Book the photographer (the CSM)",
        "- Draft the 1 offer copy",
        "*The client owes*",
        "- Share the showroom photos (1:05)",
        "- Approve the budget",
        "",
        "1-1 notes by the CSM in the cockpit, Tue 20 Oct.",
      ].join("\n"),
    );
    expect(p.comment_text).not.toContain("**");
    expect(p.comment_text).not.toContain("#");
    expect(p).toMatchObject({
      taskId: A,
      notify_all: false,
      items: 6,
      sides: { ours: 4, theirs: 2 },
      lines: [
        "Would post the to-do comment on the card: 6 lines, recording link first.",
      ],
    });

    // No recording: the line says so; a section with no item is left out.
    const theirsOnly = await planOf({
      call: booking(43, "2026-10-20T20:30:00.000Z"),
      ...ANSWERS,
      we_owe: [],
      they_owe: [todo("Share the showroom photos", { at: 65 })],
    });
    expect(theirsOnly.of("todo_comment").plan.comment_text).toBe(
      [
        "No recording for this call.",
        "",
        "*The client owes*",
        "- Share the showroom photos (1:05)",
        "",
        "1-1 notes by the CSM in the cockpit, Tue 20 Oct.",
      ].join("\n"),
    );
    expect(theirsOnly.of("todo_comment").plan.lines).toEqual([
      "Would post the to-do comment on the card: 1 line.",
    ]);
    const oursOnly = await planOf(
      { call: NONE, ...ANSWERS, they_owe: [] },
      { by: "aziz@maharamedia.com", at: "2026-10-25T09:00:00Z" },
    );
    expect(oursOnly.of("todo_comment").plan.comment_text).toBe(
      [
        "No recording for this call.",
        "",
        "*Mahara owes*",
        "- Send the new ad drafts by Thursday (the CSM)",
        "",
        "1-1 notes by the CEO in the cockpit, Sun 25 Oct.",
      ].join("\n"),
    );
    expect(oursOnly.of("todo_comment").plan.sides).toEqual({
      ours: 1,
      theirs: 0,
    });
    const byAdmin = await planOf(
      { call: NONE, ...ANSWERS },
      { by: "admin@tests.invalid" },
    );
    expect(byAdmin.of("todo_comment").plan.comment_text).toEndWith(
      "1-1 notes by an admin in the cockpit, Tue 20 Oct.",
    );
    expect(
      (
        await q<{ v: string }>(
          "SELECT public.cockpit_form_checkin_comment($1::jsonb, NULL, NULL) AS v",
          [
            JSON.stringify({
              call: NONE,
              we_owe: [todo("Send the invoice today")],
            }),
          ],
        )
      )[0].v,
    ).toBe(
      "No recording for this call.\n\n*Mahara owes*\n- Send the invoice today\n\n1-1 notes by a team member in the cockpit.",
    );
    expect(
      (
        await q<{ v: string | null }>(
          "SELECT public.cockpit_form_clock(x) AS v FROM unnest(ARRAY[0, 65, 599, 3599, 3600, 3723, 86400, -1, NULL]::integer[]) x",
        )
      ).map(r => r.v),
    ).toEqual([
      "0:00",
      "1:05",
      "9:59",
      "59:59",
      "1:00:00",
      "1:02:03",
      "24:00:00",
      null,
      null,
    ]);
  });

  test("the grade notice dedupes per recording and carries the grade the recording has", async () => {
    const graded = await planOf({ call: fathom("900000201"), ...ANSWERS });
    expect(graded.of("grade_notice").plan).toEqual({
      kind: "checkin.grade",
      target: "C09SVG6FHGU",
      dedupe: "grade:900000201",
      recordingId: "900000201",
      facts: {
        responseId: graded.id,
        recordingId: "900000201",
        taskId: A,
        client: "Acme Interiors",
        submittedAt: expect.any(String),
      },
      // Drafted from Beta's window: one grade per call, found by the recording alone.
      grade: "30000000-0000-4000-8000-000000000001",
      lines: ["Would post the call grade in #client-call-feedback."],
    });
    expect(Date.parse(graded.of("grade_notice").plan.facts.submittedAt)).toBe(
      Date.parse("2026-10-20T08:15:00Z"),
    );
    const ungraded = await planOf({ call: fathom("900000205"), ...ANSWERS });
    expect(ungraded.of("grade_notice").plan).toMatchObject({
      dedupe: "grade:900000205",
      grade: "pending",
    });
  });

  test("the recap waits for approval and has no draft at submit", async () => {
    const { of } = await planOf({ call: fathom("900000201"), ...ANSWERS });
    expect(of("recap")).toEqual({
      effect: "recap",
      delivery: "client_message",
      state: "planned",
      reason: null,
      plan: {
        kind: "recap_checkin",
        taskId: A,
        draftId: null,
        bookingBlock: "checkin",
        state: "awaiting_approval",
        lines: ["Would hold the client's recap for approval in the cockpit."],
      },
    });
  });

  test("call_form links the call the Calls card shows, and only No recording plans its own call row", async () => {
    const link = async (call: Row) => {
      const { of } = await planOf({ call, ...ANSWERS });
      const p = of("call_form").plan;
      return [p.row.linked_call_id, p.linkAfterMatch, "ownCall" in p];
    };
    // Linked to Acme's live booking: the booking.
    expect(await link(fathom("900000201"))).toEqual([40, false, false]);
    // Its booking is gone, or on Beta's card: the recording's own row.
    expect(await link(fathom("900000202"))).toEqual([109, false, false]);
    expect(await link(fathom("900000203"))).toEqual([110, false, false]);
    // On no client yet: its own row (call_match puts it on the client first).
    expect(await link(fathom("900000205"))).toEqual([111, false, false]);
    // No call row yet: the executor links it after call_match.
    expect(await link(fathom("900000204"))).toEqual([null, true, false]);
    // A booking: the booking. No recording: a call row of its own.
    expect(await link(booking(43, "2026-10-20T20:30:00.000Z"))).toEqual([
      43,
      false,
      false,
    ]);
    expect(await link(NONE)).toEqual([null, false, true]);

    const fathomForm = (
      await planOf({ call: fathom("900000201"), ...ANSWERS })
    ).of("call_form");
    expect(fathomForm.plan.row).toMatchObject({
      token: `cockpit:${fathomForm.plan.row.token.slice(8)}`,
      form_id: "cockpit-checkin",
      form_kind: "checkin",
      task_id: A,
      typed_client: null,
      matched_by: "cockpit_form",
      hidden: {},
      recording_url: "https://fathom.video/share/test-900000201",
      linked_call_id: 40,
    });
    expect(Object.keys(fathomForm.plan.row).sort()).toEqual([
      "answers",
      "form_id",
      "form_kind",
      "hidden",
      "linked_call_id",
      "matched_by",
      "recording_url",
      "submitted_at",
      "task_id",
      "token",
      "typed_client",
    ]);
    const none = await planOf(
      { call: NONE, ...ANSWERS },
      { at: "2026-10-20T08:15:00Z" },
    );
    const p = none.of("call_form").plan;
    expect(p.row.token).toBe(`cockpit:${none.id}`);
    expect(p.row.recording_url).toBeNull();
    expect({
      ...p.ownCall,
      starts_at: Date.parse(p.ownCall.starts_at),
    }).toEqual({
      source: "checkin_form",
      source_id: `cockpit:${none.id}`,
      task_id: A,
      client_name: "Acme Interiors",
      match_method: "form_task_id",
      match_confidence: 1,
      kind: "checkin",
      title: "Check-in call (1-1 notes in the cockpit)",
      starts_at: Date.parse("2026-10-20T08:15:00Z"),
      status: "held",
      provider_status: "notes sent",
    });
  });
});

describe("the write-through answers (7.2)", () => {
  const FULL = {
    call: fathom("900000201"),
    defcon: "At Risk",
    priority: "High",
    we_owe: [
      todo("Send the new ad drafts by Thursday"),
      todo("Prepare the April performance report"),
      todo("- Call the photographer about the shoot - then confirm the date:"),
    ],
    they_owe: [
      todo("Share the showroom photos with the team"),
      todo("Approve the budget for the new campaign"),
    ],
    client_notes:
      "  The owner sounded worried about lead quality this month.  ",
  };

  test("carry the Typeform's refs, types and titles, in order", async () => {
    const { of } = await planOf(FULL);
    expect(of("call_form").plan.row.answers).toEqual([
      { ref: REF.clientId, type: "short_text", title: "Client ID", value: A },
      {
        ref: "cockpit:call",
        type: "url",
        title: "Call recording",
        value: "https://fathom.video/share/test-900000201",
      },
      {
        ref: REF.additional,
        type: "long_text",
        title: "Additional Notes",
        value: [
          "Mahara: Send the new ad drafts by Thursday",
          "Mahara: Prepare the April performance report",
          "Mahara: Call the photographer about the shoot, then confirm the date",
          "Client: Share the showroom photos with the team",
          "Client: Approve the budget for the new campaign",
        ].join("\n"),
      },
      {
        ref: REF.clientNotes,
        type: "long_text",
        title: "Client Notes",
        value: "The owner sounded worried about lead quality this month.",
      },
      {
        ref: REF.defcon,
        type: "multiple_choice",
        title: "Defcon Status",
        value: "At Risk",
      },
      {
        ref: REF.priority,
        type: "multiple_choice",
        title: "Task Priority",
        value: "High",
      },
    ]);
    // No recording link, no lines and no client notes: those answers are left out.
    const bare = await planOf({
      call: booking(43, "2026-10-20T20:30:00.000Z"),
      defcon: "Happy",
      priority: "Low",
      we_owe: [],
      they_owe: [],
      client_notes: "   ",
    });
    expect(
      bare.of("call_form").plan.row.answers.map((a: Row) => a.title),
    ).toEqual(["Client ID", "Defcon Status", "Task Priority"]);
  });

  /**
   * The client brief of Acme's card, with one held call that day and these
   * notes planned as its call_form row (11: read through buildBrief and
   * formAnswer only).
   */
  async function briefOf(answers: Row) {
    const { of } = await planOf(answers, { at: "2026-10-20T08:15:00Z" });
    const row = of("call_form").plan.row;
    const timeline: Timeline = {
      taskId: A,
      clientName: "Acme Interiors",
      calls: [
        {
          id: 40,
          source: "ghl_appointment",
          kind: "checkin",
          title: "Check-in",
          startsAt: "2026-10-20T07:00:00Z",
          endsAt: "2026-10-20T07:30:00Z",
          status: "held",
          upcoming: false,
        },
      ],
      forms: [
        {
          token: row.token,
          formId: row.form_id,
          kind: row.form_kind,
          submittedAt: row.submitted_at,
          answers: row.answers,
          recordingUrl: row.recording_url,
          linkedCallId: row.linked_call_id,
        },
      ],
      changes: [],
      eods: [],
      health: [],
      unmatchedCount: 0,
    };
    const brief = buildBrief({
      now: Date.parse("2026-10-20T09:15:00Z"),
      client: { name: "Acme Interiors", stage: "Active" },
      timeline,
      digests: [],
    });
    /** The lines the brief took from the CSM's notes. */
    const side = (lines: { text: string; source: string }[]) =>
      lines.filter(l => l.source === "Your 1-1 notes").map(l => l.text);
    return {
      row,
      timeline,
      brief,
      ours: side(brief.promises.ours),
      theirs: side(brief.promises.theirs),
      recap: side(brief.call.lines),
    };
  }
  /** The Additional Notes answer x writes. */
  const additional = (row: Row) =>
    row.answers.find((a: Row) => a.ref === REF.additional)?.value;
  const bare = { defcon: "At Risk", priority: "High" };

  test("the client brief reads them as it reads a Typeform row", async () => {
    const { timeline, brief, ours, theirs, recap } = await briefOf(FULL);
    expect(brief.defcon?.value).toBe("At Risk");
    expect(brief.priority).toBe("High");
    expect(formAnswer(timeline.forms[0], /defcon/i)).toBe("At Risk");
    expect(formAnswer(timeline.forms[0], /priority/i)).toBe("High");
    expect(recap).toEqual([
      "The owner sounded worried about lead quality this month.",
    ]);
    expect(ours).toEqual([
      "Send the new ad drafts by Thursday",
      "Prepare the April performance report",
      // An inline " - " would split an item in two in the brief: it is written as a comma.
      "Call the photographer about the shoot, then confirm the date",
    ]);
    expect(theirs).toEqual([
      "Share the showroom photos with the team",
      "Approve the budget for the new campaign",
    ]);
    // The rail's "We owed n things" (checkinRail.ts weOwed) counts promises.ours.
    expect(brief.promises.ours).toHaveLength(3);
  });

  test("a short or Arabic item is still one line on its side, in the CSM's words", async () => {
    const { row } = await briefOf({
      ...bare,
      we_owe: [todo("Invoice"), todo("Send invoice"), todo("إرسال الفاتورة")],
      they_owe: [todo("Pay"), todo("دفع العربون")],
      client_notes: "Long call about the April leads.\nVery happy.",
    });
    expect(additional(row)).toBe(
      [
        "Mahara: Invoice",
        "Mahara: Send invoice",
        "Mahara: إرسال الفاتورة",
        "Client: Pay",
        "Client: دفع العربون",
      ].join("\n"),
    );
    expect(formAnswer(row, /^client notes/i)).toBe(
      "Long call about the April leads.\nVery happy.",
    );
  });

  test("the brief puts items of three words or more on their sides, in English and Arabic", async () => {
    const { brief, ours, theirs, recap } = await briefOf({
      ...bare,
      we_owe: [todo("Send the invoice"), todo("إرسال الفاتورة اليوم")],
      they_owe: [todo("Pay the deposit"), todo("دفع العربون غدا")],
      client_notes: "Long call about the April leads.",
    });
    expect(recap).toEqual(["Long call about the April leads."]);
    expect(ours).toEqual(["Send the invoice", "إرسال الفاتورة اليوم"]);
    expect(theirs).toEqual(["Pay the deposit", "دفع العربون غدا"]);
    expect(brief.promises.ours).toHaveLength(2);
  });

  // Fixed in 2b (build 12, dbp-1, G11; docs/forms/STAGE2B-CONTRACT.md 4.12).
  // Before it, the brief's noteLines joined a line of fewer than four words
  // to the next one (a last one to the one before), whatever its label, and
  // read Client Notes and Additional Notes as one text, so an item of one or
  // two words landed with its neighbour and a short last Client Notes line
  // took the first to-do into the recap. Now a line with an owner label
  // ("Mahara:", "Client:") is never joined, and the two answers are read
  // apart. These hold what G11 asks for: every We owe text in promises.ours
  // and every They owe text in promises.theirs, each its own line, so two
  // items on one side stay two (the rail's "We owed n things",
  // checkinRail.ts's weOwed = promises.ours.length, counts both). Their titles
  // keep "open before 2b" as the record of when each was open.
  test("open before 2b: a short last We owe item keeps its side (We owe ['Send invoice'], They owe ['Pay deposit'])", async () => {
    const { ours, theirs } = await briefOf({
      ...bare,
      we_owe: [todo("Send invoice")],
      they_owe: [todo("Pay deposit")],
    });
    expect({ ours, theirs }).toEqual({
      ours: ["Send invoice"],
      theirs: ["Pay deposit"],
    });
  });

  test("open before 2b: a short item between long ones keeps its side", async () => {
    const { ours, theirs } = await briefOf({
      ...bare,
      we_owe: [todo("Send the April report by Thursday"), todo("Book shoot")],
      they_owe: [todo("Share the showroom photos with the team")],
    });
    expect({ ours, theirs }).toEqual({
      ours: ["Send the April report by Thursday", "Book shoot"],
      theirs: ["Share the showroom photos with the team"],
    });
  });

  test("open before 2b: short Arabic items keep their sides", async () => {
    const { ours, theirs } = await briefOf({
      ...bare,
      we_owe: [todo("إرسال الفاتورة")],
      they_owe: [todo("دفع العربون")],
    });
    expect({ ours, theirs }).toEqual({
      ours: ["إرسال الفاتورة"],
      theirs: ["دفع العربون"],
    });
  });

  test("open before 2b: a one-word last They owe item keeps its side", async () => {
    const { ours, theirs } = await briefOf({
      ...bare,
      we_owe: [todo("Send the new ad drafts by Thursday")],
      they_owe: [todo("Pay")],
    });
    expect({ ours, theirs }).toEqual({
      ours: ["Send the new ad drafts by Thursday"],
      theirs: ["Pay"],
    });
  });

  test("open before 2b: a short last Client Notes line keeps the first to-do out of the recap", async () => {
    const { ours, recap } = await briefOf({
      ...bare,
      we_owe: [todo("Send the new ad drafts by Thursday")],
      client_notes: "Long call about the April leads.\nVery happy.",
    });
    expect({
      ours,
      toDoInRecap: recap.some(l => /Mahara|ad drafts/.test(l)),
    }).toEqual({
      ours: ["Send the new ad drafts by Thursday"],
      toDoInRecap: false,
    });
  });

  // The They owe side of the case above.
  test("open before 2b: a short last Client Notes line keeps a They owe item out of the recap", async () => {
    const { theirs, recap } = await briefOf({
      ...bare,
      they_owe: [todo("Share the showroom photos with the team")],
      client_notes: "Very happy.",
    });
    expect({ theirs, recap }).toEqual({
      theirs: ["Share the showroom photos with the team"],
      recap: ["Very happy."],
    });
  });

  // Two items on one side stay two (a fix that only stops a join across two
  // labels leaves these as one line). weOwed is what the rail counts.
  test("open before 2b: a short We owe item before a long one stays its own line", async () => {
    const { ours, brief } = await briefOf({
      ...bare,
      we_owe: [todo("Invoice"), todo("Send the April report by Thursday")],
    });
    expect({ ours, weOwed: brief.promises.ours.length }).toEqual({
      ours: ["Invoice", "Send the April report by Thursday"],
      weOwed: 2,
    });
  });

  test("open before 2b: a short last We owe item stays its own line", async () => {
    const { ours, brief } = await briefOf({
      ...bare,
      we_owe: [todo("Send the April report by Thursday"), todo("Invoice")],
    });
    expect({ ours, weOwed: brief.promises.ours.length }).toEqual({
      ours: ["Send the April report by Thursday", "Invoice"],
      weOwed: 2,
    });
  });

  test("open before 2b: two short We owe items stay two lines", async () => {
    const { ours, brief } = await briefOf({
      ...bare,
      we_owe: [todo("Invoice"), todo("Book shoot")],
    });
    expect({ ours, weOwed: brief.promises.ours.length }).toEqual({
      ours: ["Invoice", "Book shoot"],
      weOwed: 2,
    });
  });

  test("open before 2b: two short Arabic We owe items stay two lines", async () => {
    const { ours, brief } = await briefOf({
      ...bare,
      we_owe: [todo("إرسال الفاتورة"), todo("حجز التصوير")],
    });
    expect({ ours, weOwed: brief.promises.ours.length }).toEqual({
      ours: ["إرسال الفاتورة", "حجز التصوير"],
      weOwed: 2,
    });
  });

  test("open before 2b: a short They owe item before a long one stays its own line", async () => {
    const { theirs } = await briefOf({
      ...bare,
      they_owe: [todo("Pay"), todo("Share the showroom photos with the team")],
    });
    expect(theirs).toEqual(["Pay", "Share the showroom photos with the team"]);
  });
});

describe("a shadow submit end to end", () => {
  const changes = {
    call: {
      value: { kind: "fathom", recordingId: "900000201", why: "same_room" },
      seen: null,
    },
    defcon: { value: "Neutral", seen: null },
    priority: { value: "Medium", seen: null },
    we_owe: { value: [todo("Send the new ad drafts by Thursday")], seen: null },
    they_owe: {
      value: [todo("Share the showroom photos with the team")],
      seen: null,
    },
  };

  test("as the CSM: eight effect rows, dry_run or skipped, with the plans' lines, and nothing outside the forms tables", async () => {
    const before = await q(
      "SELECT (SELECT count(*)::int FROM public.cockpit_csm_call_forms) AS forms, (SELECT md5(string_agg(c::text, '|' ORDER BY c.id)) FROM public.cockpit_csm_calls c) AS calls",
    );
    const id = "40000000-0000-4000-8000-000000000001";
    const opened = await one(
      CSM,
      "SELECT public.cockpit_form_open('checkin', $1, $2::uuid, false) AS r",
      [A, id],
    );
    expect(opened.form.mode).toBe("shadow");
    await one(
      CSM,
      "SELECT public.cockpit_form_save($1::uuid, $2::jsonb, 'session-parity-1', 1) AS r",
      [id, JSON.stringify(changes)],
    );
    const sent = await one(
      CSM,
      "SELECT public.cockpit_form_submit($1::uuid, NULL) AS r",
      [id],
    );
    expect(sent.duplicate).toBe(false);
    expect(sent.effects.map((e: Row) => [e.key, e.owner, e.state])).toEqual([
      ["call_form", "shadow", "dry_run"],
      ["call_match", "shadow", "skipped"],
      ["todo_comment", "shadow", "dry_run"],
      ["happiness", "shadow", "dry_run"],
      ["last_poc", "shadow", "dry_run"],
      ["last_checkin_call", "shadow", "dry_run"],
      ["grade_notice", "shadow", "dry_run"],
      ["recap", "shadow", "dry_run"],
    ]);
    expect(sent.effects.find((e: Row) => e.key === "call_match").reason).toBe(
      "The recording is already on this client.",
    );
    expect(sent.effects.find((e: Row) => e.key === "happiness").lines).toEqual([
      "Would set Client Happiness to Neutral.",
    ]);
    // The effect rows hold the plans; the window's views never carry the plan's other keys.
    const stored = await q<{ k: string; plan: Row }>(
      "SELECT effect_key AS k, plan FROM public.cockpit_form_effects WHERE response_id = $1",
      [id],
    );
    expect(stored).toHaveLength(8);
    expect(stored.find(s => s.k === "call_form")?.plan.row.linked_call_id).toBe(
      40,
    );
    expect(JSON.stringify(sent.effects)).not.toContain("comment_text");
    const after = await q(
      "SELECT (SELECT count(*)::int FROM public.cockpit_csm_call_forms) AS forms, (SELECT md5(string_agg(c::text, '|' ORDER BY c.id)) FROM public.cockpit_csm_calls c) AS calls",
    );
    expect(after).toEqual(before);
  });

  test("with the registry native and the owners the cockpit's (2b), the executor writes each planned row where the timeline shows it", async () => {
    await rolledBack(async () => {
      await db.exec(`UPDATE public.cockpit_forms SET provider = 'native',
        effects = (SELECT jsonb_agg(e || '{"owner":"cockpit"}'::jsonb ORDER BY o)
                     FROM jsonb_array_elements(effects) WITH ORDINALITY q(e, o))
        WHERE key = 'checkin'`);
      const send = async (id: string, call: Row) => {
        await one(
          CSM,
          "SELECT public.cockpit_form_open('checkin', $1, $2::uuid, false) AS r",
          [A, id],
        );
        await one(
          CSM,
          "SELECT public.cockpit_form_save($1::uuid, $2::jsonb, 'session-parity-2', 1) AS r",
          [
            id,
            JSON.stringify({ ...changes, call: { value: call, seen: null } }),
          ],
        );
        await one(
          CSM,
          "SELECT public.cockpit_form_submit($1::uuid, NULL) AS r",
          [id],
        );
        await asOwner();
        return Object.fromEntries(
          (
            await q<{ k: string; state: string; receipt: Row }>(
              "SELECT effect_key AS k, state, receipt FROM public.cockpit_form_effects WHERE response_id = $1",
              [id],
            )
          ).map(e => [e.k, e]),
        );
      };
      // A recording with no call row: call_match stores it on Acme, then the notes link it.
      const rec = "40000000-0000-4000-8000-000000000002";
      const e1 = await send(rec, {
        kind: "fathom",
        recordingId: "900000204",
        why: "picked",
      });
      expect([e1.call_match.state, e1.call_form.state]).toEqual([
        "delivered",
        "delivered",
      ]);
      const [row] = await q(
        "SELECT id, task_id FROM public.cockpit_csm_calls WHERE source = 'fathom' AND source_id = '900000204'",
      );
      expect(row.task_id).toBe(A);
      expect(e1.call_form.receipt.linkedCallId).toBe(Number(row.id));
      // No recording: a call row of its own, and the notes under it.
      const none = "40000000-0000-4000-8000-000000000003";
      const e2 = await send(none, { kind: "none", why: "none" });
      expect(e2.call_match.state).toBe("skipped");
      expect(e2.call_form.state).toBe("delivered");
      const [own] = await q(
        "SELECT id, source, kind, status FROM public.cockpit_csm_calls WHERE source_id = $1",
        [`cockpit:${none}`],
      );
      expect([own.source, own.kind, own.status]).toEqual([
        "checkin_form",
        "checkin",
        "held",
      ]);
      const forms = await q(
        "SELECT token, form_id, form_kind, matched_by, linked_call_id FROM public.cockpit_csm_call_forms WHERE token LIKE 'cockpit:%' ORDER BY token",
      );
      expect(forms).toEqual([
        {
          token: `cockpit:${rec}`,
          form_id: "cockpit-checkin",
          form_kind: "checkin",
          matched_by: "cockpit_form",
          linked_call_id: row.id,
        },
        {
          token: `cockpit:${none}`,
          form_id: "cockpit-checkin",
          form_kind: "checkin",
          matched_by: "cockpit_form",
          linked_call_id: own.id,
        },
      ]);
      // The Calls card shows each set of notes under its one call.
      const timeline = await one(
        CSM,
        "SELECT public.cockpit_csm_client_timeline($1) AS r",
        [A],
      );
      const formOf = (id: unknown) =>
        timeline.calls.find((c: Row) => Number(c.id) === Number(id))?.form
          ?.token;
      expect(formOf(row.id)).toBe(`cockpit:${rec}`);
      expect(formOf(own.id)).toBe(`cockpit:${none}`);
    });
    // Rolled back: the registry is the shadow one again.
    expect(
      (
        await q(
          "SELECT provider FROM public.cockpit_forms WHERE key = 'checkin'",
        )
      )[0].provider,
    ).toBe("typeform");
  });
});

describe("the OUTSIDE_CS_LIKELY remedy (A7.14 rule 2, A7.18)", () => {
  const REC = "900000301";
  const SHARE = `https://fathom.video/share/test-${REC}`;
  const CALL_ID = 120;
  const LIKELY =
    "That recording is from outside Customer Success and was put on this client only by a name or email domain in it. If it is this client's call, ask an admin to send the 1-1 notes with it.";
  const ALREADY = "The recording is already on this client.";
  const OPEN =
    "SELECT public.cockpit_form_open('checkin', $1, $2::uuid, false) AS r";
  const SAVE =
    "SELECT public.cockpit_form_save($1::uuid, $2::jsonb, 'session-likely-1', 1) AS r";
  const SUBMIT = "SELECT public.cockpit_form_submit($1::uuid, NULL) AS r";
  const CALLS =
    "SELECT md5(string_agg(c::text, '|' ORDER BY c.id)) AS m FROM public.cockpit_csm_calls c";
  const pick = { kind: "fathom", recordingId: REC, why: "picked" };
  const notes = (call: Row | null) => ({
    ...(call ? { call: { value: call, seen: null } } : {}),
    defcon: { value: "Neutral", seen: null },
    priority: { value: "Medium", seen: null },
    we_owe: { value: [todo("Send the new ad drafts by Thursday")], seen: null },
    they_owe: {
      value: [todo("Share the showroom photos with the team")],
      seen: null,
    },
  });
  const tiedFor = async (seat: string | null) =>
    (
      await q<{ r: boolean }>(
        "SELECT public.cockpit_form_recording_tied($1, $2, $3::uuid) AS r",
        [REC, C, seat],
      )
    )[0].r;
  /** The door's ask (cockpit-forms-api fathom.ts tieAsks), as the service role. */
  const doorAsks = (seat: string, response: string | null = null) =>
    asService<string[]>(
      "SELECT public.cockpit_form_recordings_tied($1, $2::text[], $3::uuid, $4::uuid) AS r",
      [C, [REC], seat, response],
    );
  /**
   * The worker's rows for a closer's prospect call: a Sales recorder, no
   * Customer Success seat, no booking of Cedar in its room or with its
   * invitees, and a call row matchMeeting put on Cedar from the client's name
   * in the title ('name' at 0.6).
   */
  async function closersCall() {
    await q(
      `INSERT INTO public.cockpit_fathom_meetings(recording_id, title, starts_at, ends_at, recorded_by_email, recorded_by_name,
         external, invitees, url, share_url, summary, raw, class, recorder_team, room)
       VALUES ($1, 'Cedar Homes intro', '2026-10-21T09:00:00Z', '2026-10-21T09:40:00Z', 'closer@tests.invalid',
         'Closer Test', true, '[]'::jsonb, $2, $3, NULL, $4::jsonb, 'client', 'Sales', 'meet:cdr-test-one')`,
      [
        REC,
        `https://fathom.video/calls/${Number(REC) + 1000}`,
        SHARE,
        JSON.stringify({
          recorded_by: {
            name: "Closer Test",
            email: "closer@tests.invalid",
            team: "Sales",
          },
          calendar_invitees_domains_type: "one_or_more_external",
          shared_with: "all_teams",
          created_at: "2026-10-21T09:40:00Z",
        }),
      ],
    );
    await q(
      `INSERT INTO public.cockpit_csm_calls(id, source, source_id, task_id, client_name, match_method, match_confidence,
         kind, title, starts_at, ends_at, status, host_email, room) OVERRIDING SYSTEM VALUE
       VALUES ($1, 'fathom', $2, $3, 'Cedar Homes', 'name', 0.6, 'other', 'Cedar Homes intro',
         '2026-10-21T09:00:00Z', '2026-10-21T09:40:00Z', 'held', 'closer@tests.invalid', 'meet:cdr-test-one')`,
      [CALL_ID, REC, C],
    );
  }

  test("holds: once an admin or the CEO sends live notes with a closer's call a name put on Cedar, x skips call_match and the row stays name 0.6, the sent notes' share link ties it for the CSM and for no seat (rule 3's form-link clause), and her own send is refused as the call's second record", async () => {
    const senders = [
      [ADMIN, "an admin"],
      [CEO, "the CEO"],
    ] as const;
    for (const [i, [sender, who]] of senders.entries()) {
      const theirs = `50000000-0000-4000-8000-00000000000${2 * i + 1}`;
      const hers = `50000000-0000-4000-8000-00000000000${2 * i + 2}`;
      await rolledBack(async () => {
        // The cut-over: the registry native and the SQL effects the cockpit's.
        await db.exec(`UPDATE public.cockpit_forms SET provider = 'native',
          effects = (SELECT jsonb_agg(e || '{"owner":"cockpit"}'::jsonb ORDER BY o)
                       FROM jsonb_array_elements(effects) WITH ORDINALITY q(e, o))
          WHERE key = 'checkin'`);
        await closersCall();

        // Before any send: rule 2 does not settle a row a name placed, and
        // no other rule ties it for the CSM or for no seat; rule 4 ties it
        // for the person who may place it.
        expect([
          await tiedFor(CSM),
          await tiedFor(null),
          await tiedFor(sender),
        ]).toEqual([false, false, true]);
        expect(await doorAsks(CSM)).toEqual([]);
        const opened = await one(CSM, OPEN, [C, hers]);
        expect(opened.form.mode).toBe("live");
        expect(
          await refusedAs(CSM, SAVE, [
            hers,
            JSON.stringify({ call: { value: pick, seen: null } }),
          ]),
        ).toEqual({ code: "22023", message: LIKELY });

        // The remedy: the person sends live notes with it.
        await one(sender, OPEN, [C, theirs]);
        await one(sender, SAVE, [theirs, JSON.stringify(notes(pick))]);
        // What x plans for this send, read before it: call_match skipped (any
        // call row on the card, a likely-placed one included, as built) and
        // call_form with the recording's share link, under the call row.
        const plans = (
          await q<{ p: Row[] }>(
            "SELECT public.cockpit_form_checkin_plan(r) AS p FROM public.cockpit_form_responses r WHERE r.id = $1",
            [theirs],
          )
        )[0].p;
        const plan = (k: string) => plans.find(p => p.effect === k) as Row;
        expect(plan("call_match")).toEqual({
          effect: "call_match",
          delivery: "sql",
          state: "skipped",
          reason: ALREADY,
          plan: { recordingId: REC, callId: CALL_ID, taskId: C, lines: [] },
        });
        expect([
          plan("call_form").state,
          plan("call_form").plan.row.recording_url,
          plan("call_form").plan.row.linked_call_id,
          plan("call_form").plan.linkAfterMatch,
        ]).toEqual(["planned", SHARE, CALL_ID, false]);
        const callsBefore = (await q(CALLS))[0].m;
        await one(sender, SUBMIT, [theirs]);
        const [sent] = await q(
          "SELECT mode, state, submitted_at FROM public.cockpit_form_responses WHERE id = $1",
          [theirs],
        );
        expect([sent.mode, sent.state]).toEqual(["live", "submitted"]);
        // The send stored those plans, and the executor (v
        // cockpit_form_apply_sql_effects) ran the SQL effects: call_match
        // stays skipped, call_form stores the notes under the call.
        const effects = Object.fromEntries(
          (
            await q<{
              k: string;
              state: string;
              reason: string;
              plan: Row;
              receipt: Row;
            }>(
              "SELECT effect_key AS k, state, reason, plan, receipt FROM public.cockpit_form_effects WHERE response_id = $1",
              [theirs],
            )
          ).map(e => [e.k, e]),
        );
        expect(effects.call_match.plan).toEqual(plan("call_match").plan);
        expect(effects.call_form.plan).toEqual(plan("call_form").plan);
        expect([effects.call_match.state, effects.call_match.reason]).toEqual([
          "skipped",
          ALREADY,
        ]);
        expect([effects.call_form.state, effects.call_form.receipt]).toEqual([
          "delivered",
          { token: `cockpit:${theirs}`, linkedCallId: CALL_ID },
        ]);

        // Afterwards the call row is the worker's as written, and no call row changed.
        const [row] = await q(
          "SELECT task_id, match_method, match_confidence, linked_call_id FROM public.cockpit_csm_calls WHERE source = 'fathom' AND source_id = $1",
          [REC],
        );
        expect([
          row.task_id,
          row.match_method,
          Number(row.match_confidence),
          row.linked_call_id,
        ]).toEqual([C, "name", 0.6, null]);
        expect((await q(CALLS))[0].m).toBe(callsBefore);
        const forms = await q(
          "SELECT form_kind, task_id, recording_url, linked_call_id, answers FROM public.cockpit_csm_call_forms WHERE token = $1",
          [`cockpit:${theirs}`],
        );
        expect(forms).toHaveLength(1);
        expect([
          forms[0].form_kind,
          forms[0].task_id,
          forms[0].recording_url,
          Number(forms[0].linked_call_id),
        ]).toEqual(["checkin", C, SHARE, CALL_ID]);
        expect(forms[0].answers).toContainEqual({
          ref: "cockpit:call",
          type: "url",
          title: "Call recording",
          value: SHARE,
        });

        // It now ties for the CSM and for no seat. The clause is rule 3's
        // form-link clause: without the share link in the stored answers,
        // nothing ties it again.
        expect([await tiedFor(CSM), await tiedFor(null)]).toEqual([true, true]);
        await db.exec("SAVEPOINT without_link");
        await q(
          "UPDATE public.cockpit_csm_call_forms SET answers = '[]'::jsonb WHERE token = $1",
          [`cockpit:${theirs}`],
        );
        expect([await tiedFor(CSM), await tiedFor(null)]).toEqual([
          false,
          false,
        ]);
        await db.exec("ROLLBACK TO SAVEPOINT without_link");
        expect(await tiedFor(CSM)).toBe(true);
        // The door's ask lists it for her, as the viewer and as her notes' seat.
        expect(await doorAsks(CSM)).toEqual([REC]);
        expect(await doorAsks(CSM, hers)).toEqual([REC]);
        // Her Calls card shows the worker's method and the notes under the call.
        const timeline = await one(
          CSM,
          "SELECT public.cockpit_csm_client_timeline($1) AS r",
          [C],
        );
        const shown = timeline.calls.find((c: Row) => Number(c.id) === CALL_ID);
        expect([shown?.matchMethod, shown?.form?.token]).toEqual([
          "name",
          `cockpit:${theirs}`,
        ]);

        // Her own notes on that recording: the save holds no tie sentence
        // any more; the send is refused because the call already has its one
        // record (submit step 8), with that sentence.
        const saved = await one(CSM, SAVE, [hers, JSON.stringify(notes(pick))]);
        expect(saved.conflicts).toEqual([]);
        expect(saved.row.answers.call).toMatchObject({
          kind: "fathom",
          recordingId: REC,
          callId: CALL_ID,
          shareUrl: SHARE,
        });
        const second = await refusedAs(CSM, SUBMIT, [hers]);
        expect(second).toEqual({
          code: "22023",
          message: `This call already has 1-1 notes, sent at ${kuwaitClock(sent.submitted_at)}.`,
        });
        expect(second.message).not.toContain("outside Customer Success");
      }).catch(e => {
        (e as Error).message = `${who}: ${(e as Error).message}`;
        throw e;
      });
    }
    // Rolled back: no closer's call, no notes, and the registry is the shadow one again.
    expect(
      (
        await q(
          "SELECT (SELECT count(*)::int FROM public.cockpit_fathom_meetings WHERE recording_id = $1) + (SELECT count(*)::int FROM public.cockpit_csm_calls WHERE source_id = $1) + (SELECT count(*)::int FROM public.cockpit_csm_call_forms WHERE recording_url = $2) AS n",
          [REC, SHARE],
        )
      )[0].n,
    ).toBe(0);
    expect(
      (
        await q(
          "SELECT provider FROM public.cockpit_forms WHERE key = 'checkin'",
        )
      )[0].provider,
    ).toBe("typeform");
  });
});
