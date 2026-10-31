/**
 * The shadow replay (checkin-replay.ts, docs/forms/STAGE2-CONTRACT.md 7.4 and
 * 11) offline: the same code as --live on a synthetic copy of two fixture
 * entries, with the six live reads answered by a fake reader in the shape the
 * SQL returns (addresses with their local part hashed, action items and client
 * notes as hashes), the plans made by the real migrations in PGlite and the
 * to-dos by the real todoItems. Then --shadow on synthetic plans and synthetic
 * Make answers, the readers' plumbing and the VPS script. Every card, client,
 * person, recording and room is invented; nothing is read live.
 */
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  setDefaultTimeout,
  test,
} from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import {
  EFFECTS,
  judge,
  kuwaitMidnight,
  linkKey,
  loadEntries,
  londonDay,
  type MakeRead,
  maskEmail,
  maskRoom,
  maskRoomSql,
  maskSql,
  PICKS,
  parseArgs,
  pickAsOf,
  type Reader,
  type Report,
  readLive,
  replayDb,
  runLive,
  runShadow,
  sqReader,
  VPS_SCRIPT,
  vpsReader,
  writeReport,
} from "./checkin-replay";
import { member } from "./lib/cockpitTestDb";

// Keep direct, ship and readiness runs consistent on busy build hosts.
setDefaultTimeout(120_000);

type Row = Record<string, any>;

const R1 = "taskR1"; // Replay Interiors
const R2 = "taskR2"; // Sample Build
const T1 = "replayaaaa0000000000000000000001";
const T2 = "replaybbbb0000000000000000000002";
const CSM = "csm@tests.invalid";
const CONTACT_1 = "owner@replay-interiors.invalid";
const CONTACT_2 = "owner@sample-build.invalid";
const AT_RISK = "f0623c2a-161d-4aa2-8833-d1337c69e1c2";
const NEUTRAL = "46e595a3-17d7-4835-80f9-8a4c578b72a3";
const HAPPY = "c5d6b01f-5f2b-40c1-afac-5b9f1efab213";
const m = maskEmail;

/** The fixture's shape (notes/stage2/fixtures/replay-10.json), invented values. */
const FIXTURE = {
  fixtures: [
    {
      response: {
        id: T1,
        submitted_at: "2026-10-11T14:54:03Z",
        card: R1,
        client: "Replay Interiors",
      },
      make_9209179: {
        todo_comment: [
          { lines: 20, bullet_lines: 10, recording_link_on_first_line: false },
        ],
        happiness: { option_id_out: AT_RISK },
        last_poc: { stored_expected: "2026-10-11T03:00:00Z" },
        grade_post: { parts: [{ len: 3000 }, { len: 2000 }] },
      },
      make_9523861: { runs: [{}, {}], wa_messages: 2, duplicate_send: true },
      card_now: { last_checkin_call: { at: "2026-10-26T04:00:00Z" } },
    },
    {
      response: {
        id: T2,
        submitted_at: "2026-10-13T11:46:21Z",
        card: R2,
        client: "Sample Build",
      },
      make_9209179: {
        todo_comment: [
          { lines: 23, bullet_lines: 4, recording_link_on_first_line: true },
        ],
        happiness: { option_id_out: HAPPY },
        last_poc: { stored_expected: "2026-10-14T03:00:00Z" },
        grade_post: { parts: [] },
      },
      make_9523861: { runs: [{}], wa_messages: 1 },
      card_now: { last_checkin_call: { at: null } },
    },
  ],
};
const PINS = {
  picks: [
    { response: T1.slice(0, 10), card: R1, recording: "900000301" },
    { response: T2.slice(0, 10), card: R2, recording: "900000311" },
  ],
};

const item = (
  description: string,
  o: {
    email?: string | null;
    team?: string | null;
    done?: boolean;
    at?: string;
  } = {},
) => ({
  description,
  completed: o.done ?? false,
  recording_timestamp: o.at ?? "00:01:05",
  assignee: { email: o.email ?? null, team: o.team ?? null },
});
const meeting = (o: Row) => ({
  room: null,
  title: "Invented meeting",
  meeting_title: "Impromptu Google Meet Meeting",
  class: "candidate",
  recorder_email: m(CSM),
  recorder_team: "Customer Success",
  gone_at: null,
  invitee_emails: [m(CSM)],
  action_items: null,
  call_id: null,
  task_id: null,
  client_name: null,
  match_method: null,
  linked_call_id: null,
  call_status: null,
  settled_reason: null,
  call_kind: null,
  call_starts_at: null,
  ...o,
  share_url: `https://fathom.video/share/test-${String(o.recording_id).slice(-3)}`,
  url: `https://fathom.video/calls/7${o.recording_id}`,
});

/**
 * The tie rule's two sentences as v's save raises them (A7.14's sentences,
 * round 4, A7.18), copied from the contract's 3.2 table, never retyped:
 * OUTSIDE_CS for a recording whose call row is on no card or that has none,
 * OUTSIDE_CS_LIKELY for a call row on this card that a likely sign placed.
 */
const OUTSIDE_CS =
  "That recording is from outside Customer Success and is not on this client. If it is this client's call, ask an admin to match it.";
const OUTSIDE_CS_LIKELY =
  "That recording is from outside Customer Success and was put on this client only by a name or email domain in it. If it is this client's call, ask an admin to send the 1-1 notes with it.";

/**
 * A closer's call on Sample Build four days before its form, outside the
 * store's window and inside the card's own 14 days: a Sales recording placed
 * by the client's address on the invite, with the call row's confidence as
 * sq.py prints numeric (text). 0.9 is a known contact's address, 0.8 a
 * company domain (callMatch.ts placedExactly, A7.14 rule 2).
 */
const CLOSER = "closer@tests.invalid";
const closerCall = (confidence: unknown) =>
  meeting({
    recording_id: "900000305",
    starts_at: "2026-10-09T10:00:00.000Z",
    ends_at: "2026-10-09T10:30:00.000Z",
    title: "Invented follow-up",
    class: "client",
    recorder_email: m(CLOSER),
    recorder_team: "Sales",
    invitee_emails: [m(CLOSER), m(CONTACT_2)],
    created_at: "2026-10-09T10:31:00Z",
    call_id: 605,
    task_id: R2,
    client_name: "Sample Build",
    match_method: "invitee_email",
    match_confidence: confidence,
    call_status: "held",
    call_kind: "other",
    call_starts_at: "2026-10-09T10:00:00.000Z",
  });

/** The six reads as the SQL of readLive answers them. */
const LIVE: Record<string, Row[]> = {
  forms: [
    {
      token: T1,
      task_id: R1,
      submitted_at: "2026-10-11T14:54:03.000Z",
      recording_url: "https://fathom.video/share/test-301?timestamp=12",
      linked_call_id: 701,
      linked_source: "checkin_form",
      defcon: "At Risk",
      priority: "High",
      client_notes: "Client notes 0123456789ab",
    },
    {
      token: T2,
      task_id: R2,
      submitted_at: "2026-10-13T11:46:21.000Z",
      recording_url: "https://fathom.video/share/test-311",
      linked_call_id: null,
      linked_source: null,
      defcon: "Neutral",
      priority: "Medium",
      client_notes: null,
    },
  ],
  form_index: [
    {
      token: T1,
      task_id: R1,
      submitted_at: "2026-10-11T14:54:03.000Z",
      share: "https://fathom.video/share/test-301",
    },
    {
      token: "replayearlier000000000000000001",
      task_id: R1,
      submitted_at: "2026-10-04T09:00:00.000Z",
      share: "https://fathom.video/share/test-290",
    },
    // This form's own link: as of the submit it must never decide the pick.
    {
      token: T2,
      task_id: R2,
      submitted_at: "2026-10-13T11:46:21.000Z",
      share: "https://fathom.video/share/test-311",
    },
    {
      token: "replayearlier000000000000000002",
      task_id: R2,
      submitted_at: "2026-10-06T09:00:00.000Z",
      share: "https://fathom.video/share/test-280",
    },
  ],
  meetings: [
    // Replay Interiors' check-in, in the room of its booking 501.
    meeting({
      recording_id: "900000301",
      starts_at: "2026-10-11T09:58:30.000Z",
      ends_at: "2026-10-11T10:32:19.000Z",
      room: maskRoom("meet:abc-defg-hij"),
      title: "Invented review with Layla",
      class: "client",
      invitee_emails: [m(CSM), m(CONTACT_1)],
      created_at: "2026-10-11T10:33:00Z",
      action_items: [
        item("Item a1a1a1a1a1a1", {
          email: m(CSM),
          team: "Customer Success",
          at: "00:12:34",
        }),
        item("Item a2a2a2a2a2a2", { email: m(CONTACT_1) }),
        item("Item a3a3a3a3a3a3"),
        item("Item a4a4a4a4a4a4", { email: m(CSM), done: true }),
        item("Item a5a5a5a5a5a5", { team: "Customer Success" }),
        item("Item a6a6a6a6a6a6", { email: m(CONTACT_1) }),
      ],
      call_id: 601,
      task_id: R1,
      client_name: "Replay Interiors",
      match_method: "same_room",
      linked_call_id: 501,
      call_status: "held",
      call_kind: "checkin",
      call_starts_at: "2026-10-11T09:58:30.000Z",
    }),
    // The CSM's later impromptu call on no client: the default, which the room beats.
    meeting({
      recording_id: "900000302",
      starts_at: "2026-10-11T12:00:00.000Z",
      ends_at: "2026-10-11T12:30:00.000Z",
      title: "Invented supplier chat",
      created_at: "2026-10-11T12:31:00Z",
    }),
    // Sample Build's impromptu check-in: no booking, no call row yet.
    meeting({
      recording_id: "900000311",
      starts_at: "2026-10-13T10:58:24.000Z",
      ends_at: "2026-10-13T11:25:42.000Z",
      room: maskRoom("meet:kln-opqr-stu"),
      title: "Invented call with Huda",
      created_at: "2026-10-13T11:26:30Z",
      action_items: [
        item("Item b1b1b1b1b1b1", { email: m(CONTACT_2) }),
        item("Item b2b2b2b2b2b2", { email: m(CONTACT_2) }),
      ],
    }),
    // Listed by Fathom only after the submit: never seen as of it.
    meeting({
      recording_id: "900000312",
      starts_at: "2026-10-13T11:30:00.000Z",
      ends_at: "2026-10-13T11:40:00.000Z",
      created_at: "2026-10-13T12:10:00Z",
    }),
    // On Sample Build only by a form's link (form_task_id): as of the submit it is on no client.
    meeting({
      recording_id: "900000313",
      starts_at: "2026-10-13T08:00:00.000Z",
      ends_at: "2026-10-13T08:30:00.000Z",
      created_at: "2026-10-13T08:31:00Z",
      call_id: 611,
      task_id: R2,
      client_name: "Sample Build",
      match_method: "form_task_id",
      call_status: "held",
      call_kind: "other",
      call_starts_at: "2026-10-13T08:00:00.000Z",
    }),
  ],
  calls: [
    {
      id: 501,
      source: "ghl_appointment",
      task_id: R1,
      client_name: "Replay Interiors",
      kind: "checkin",
      status: "confirmed",
      starts_at: "2026-10-11T10:00:00.000Z",
      ends_at: "2026-10-11T10:30:00.000Z",
      room: maskRoom("meet:abc-defg-hij"),
      linked_call_id: null,
      match_method: "client_id_field",
      emails: [m(CONTACT_1)],
    },
    // The Typeform row's own call row (Make's world: two calls on the card).
    {
      id: 701,
      source: "checkin_form",
      task_id: R1,
      client_name: "Replay Interiors",
      kind: "checkin",
      status: "held",
      starts_at: "2026-10-11T14:54:03.000Z",
      ends_at: null,
      room: null,
      linked_call_id: null,
      match_method: "form_task_id",
      emails: [],
    },
  ],
  clients: [
    { task_id: R1, name: "Replay Interiors", aliases: ["Replay"] },
    { task_id: R2, name: "Sample Build", aliases: [] },
  ],
  team: [
    {
      kind: "person",
      name: "Noura Test",
      email: CSM,
      role: "Client success manager",
      active: true,
      roles: null,
      updated_at: null,
      csm_only: null,
    },
    {
      kind: "person",
      name: "Aziz Test",
      email: "aziz@maharamedia.com",
      role: "CEO",
      active: true,
      roles: null,
      updated_at: null,
      csm_only: null,
    },
    {
      kind: "member",
      name: null,
      email: CSM,
      role: null,
      active: true,
      roles: ["csm"],
      updated_at: "2026-10-01T00:00:00.000Z",
      csm_only: true,
    },
    {
      kind: "member",
      name: null,
      email: "aziz@maharamedia.com",
      role: null,
      active: true,
      roles: [],
      updated_at: "2026-10-01T00:00:00.000Z",
      csm_only: false,
    },
  ],
};

/** Every value a report must never carry: titles, hashes of text, addresses. */
const SECRET_TEXT = [
  "Invented review with Layla",
  "Invented call with Huda",
  "Invented supplier chat",
  "Impromptu Google Meet Meeting",
  "Item a1a1",
  "Item b1b1",
  "Client notes",
  "0123456789ab",
  "@",
  "fathom.video",
  "Layla",
  "Huda",
  "abc-defg-hij",
  "kln-opqr-stu",
  "room:",
];

function fakeRead(rows: Record<string, Row[]>, seen: string[]): Reader {
  return async sql => {
    seen.push(sql);
    const tag = /^-- replay:([a-z_]+)/.exec(sql)?.[1];
    if (!tag || !(tag in rows))
      throw new Error(`Unexpected read: ${sql.slice(0, 40)}`);
    return structuredClone(rows[tag]);
  };
}
const byEffect = (r: Report, i: number) =>
  Object.fromEntries(r.responses[i].effects.map(e => [e.effect, e]));

let out: string;
let live: Report;
const reads: string[] = [];
beforeAll(async () => {
  out = mkdtempSync(join(tmpdir(), "checkin-replay-"));
  live = await runLive({
    entries: loadEntries(FIXTURE, PINS),
    read: fakeRead(LIVE, reads),
    now: new Date("2026-10-28T09:00:00Z"),
  });
}, 120_000);
afterAll(() => {
  if (out) rmSync(out, { recursive: true, force: true });
});

describe("--live, offline on two synthetic entries", () => {
  test("reads six times, read only, and never a contact's name, an address in the clear, a summary or a transcript", () => {
    expect(reads.map(sql => /^-- replay:([a-z_]+)/.exec(sql)?.[1])).toEqual([
      "forms",
      "form_index",
      "meetings",
      "calls",
      "clients",
      "team",
    ]);
    for (const sql of reads) {
      expect(sql.trimStart().split("\n")[1]).toMatch(/^SELECT /);
      expect(sql).not.toMatch(
        /\b(INSERT|UPDATE|DELETE|TRUNCATE|ALTER|CREATE|GRANT)\b/i,
      );
      // Contact names (invitees, assignees, the recorder's) are never read;
      // the roster's business name is.
      expect(sql).not.toMatch(
        /summary|transcript|\bi->>'name'|assignee'->>'name'|recorded_by_name/i,
      );
      // A JSON address is always read through the mask: md5 of the local part, the domain kept.
      for (const hit of sql.matchAll(/->>'email'/g))
        expect(
          sql.slice(Math.max(0, (hit.index ?? 0) - 60), hit.index),
        ).toMatch(/btrim\(\S*$/);
    }
    expect(reads[2]).toContain(
      "md5(lower(btrim(regexp_replace(x->>'description'",
    );
    expect(reads[0]).toContain("'Client notes ' || left(md5(");
  });

  test("the masked address equals the SQL mask, so todoItems and the matcher still compare addresses and domains", async () => {
    const pg = new PGlite();
    try {
      for (const e of [
        "  CSM@Tests.Invalid ",
        CONTACT_1,
        "a@b@c.invalid",
        "no-address",
        "@tests.invalid",
        "",
        null,
      ]) {
        const sql = (
          await pg.query<{ v: string | null }>(
            `SELECT ${maskSql("$1::text")} AS v`,
            [e],
          )
        ).rows[0].v;
        expect(m(e)).toBe(sql);
      }
    } finally {
      await pg.close();
    }
    const rooms = new PGlite();
    try {
      for (const r of ["meet:abc-defg-hij", "zoom:12345678901", "", null])
        expect(
          (
            await rooms.query<{ v: string | null }>(
              `SELECT ${maskRoomSql("$1::text")} AS v`,
              [r],
            )
          ).rows[0].v,
        ).toBe(maskRoom(r));
    } finally {
      await rooms.close();
    }
    expect(maskRoom("meet:abc-defg-hij")).not.toContain("abc");
    expect(m(CONTACT_1)).toEndWith("@replay-interiors.invalid");
    expect(m(CONTACT_1)).not.toContain("owner");
    expect(m("no-address")).toBeNull();
  });

  test("the deciding signal of each pick, as of its submit", () => {
    expect(
      live.responses.map(r => [r.response, r.pick.state, r.pick.verdict]),
    ).toEqual([
      [T1.slice(0, 10), "same_room", "same"],
      // Not its own form's link (left out as of the submit), not the later
      // listed 900000312, not 900000313, which only a form put on the client.
      [T2.slice(0, 10), "latest_unlinked", "same"],
    ]);
  });

  test("the to-do counts come from the imported todoItems, with the unsure count", () => {
    expect(live.responses[0].todos).toEqual({
      items: 5,
      ours: 3,
      theirs: 2,
      unsure: 1,
      cut: 0,
      makeBulletLines: 10,
      makeComments: 1,
    });
    expect(live.responses[1].todos).toMatchObject({
      items: 2,
      ours: 0,
      theirs: 2,
      unsure: 0,
    });
  });

  test("every verdict, each with its reason", () => {
    const one = byEffect(live, 0);
    expect(Object.keys(one)).toEqual([...EFFECTS]);
    expect(
      Object.fromEntries(
        Object.entries(one).map(([k, e]) => [k, [e.state, e.verdict]]),
      ),
    ).toEqual({
      call_form: ["planned", "better"],
      call_match: ["skipped", "same"],
      todo_comment: ["planned", "better"],
      happiness: ["planned", "same"],
      last_poc: ["planned", "same"],
      last_checkin_call: ["planned", "same"],
      grade_notice: ["planned", "same"],
      recap: ["planned", "better"],
    });
    expect(one.call_form.reason).toBe(
      "The Typeform row links its own checkin_form row; the plan links the booking (call 501): one call on the card instead of two.",
    );
    expect(one.todo_comment.reason).toBe(
      "The plan has 5 lines (3 ours, 2 theirs), the recording link on line 1; Make's comment had 10 bullet lines and no link on line 1.",
    );
    expect(one.happiness.reason).toBe(`Option ${AT_RISK}, as Make wrote.`);
    expect(one.last_poc.reason).toBe("2026-10-11, the day Make's write keeps.");
    expect(one.last_checkin_call.reason).toBe(
      "New: Make never wrote it. The plan sets 2026-10-11; the card shows 2026-10-26 now.",
    );
    expect(one.recap.reason).toBe(
      "Held for approval and never sent; Make sent the recap 2 times.",
    );

    const two = byEffect(live, 1);
    expect(
      Object.fromEntries(
        Object.entries(two).map(([k, e]) => [k, [e.state, e.verdict]]),
      ),
    ).toEqual({
      call_form: ["planned", "same"],
      call_match: ["planned", "same"],
      todo_comment: ["planned", "differs"],
      happiness: ["planned", "differs"],
      last_poc: ["planned", "differs"],
      last_checkin_call: ["planned", "same"],
      grade_notice: ["planned", "differs"],
      recap: ["planned", "same"],
    });
    expect(two.call_form.reason).toBe(
      "DEFCON, priority and the recording link equal the Typeform row's; the row links the recording once call_match has put it on the client.",
    );
    expect(two.todo_comment.reason).toBe(
      "The plan has 2 lines (0 ours, 2 theirs): We owe is empty.",
    );
    expect(two.happiness.reason).toBe(
      `The plan sets option ${NEUTRAL}; Make wrote ${HAPPY}.`,
    );
    expect(two.last_poc.reason).toBe(
      "The plan sets 2026-10-13; Make's write keeps 2026-10-14.",
    );
    expect(two.grade_notice.reason).toBe("Planned; Make posted no grade.");
  });

  test("the passes count every entry", () => {
    expect(live.passes.map(p => [p.count, p.of, p.pass])).toEqual([
      [2, 2, true],
      [1, 2, false],
      [1, 2, false],
      [2, 2, true],
      [2, 2, true],
      [2, 2, true],
    ]);
    expect(live.pass).toBe(false);
  });

  test("writes the report as JSON and markdown, with no free text", () => {
    const files = writeReport(out, live);
    expect(files.map(f => f.slice(out.length + 1))).toEqual([
      "replay-report.json",
      "replay-report.md",
    ]);
    const json = readFileSync(files[0], "utf8");
    const md = readFileSync(files[1], "utf8");
    expect(JSON.parse(json).responses).toHaveLength(2);
    for (const text of [json, md]) {
      for (const secret of SECRET_TEXT) expect(text).not.toContain(secret);
      expect(text).not.toContain("comment_text");
      // No answer text: DEFCON and priority are compared, never written.
      for (const label of ["At Risk", "Neutral", "High", "Medium"])
        expect(text).not.toContain(label);
    }
    expect(md).toContain("| todo_comment | planned | better |");
    expect(md).toContain("Replay Interiors");
  });

  test("a pinned recording the store does not hold is missing everywhere", async () => {
    const lone = {
      fixtures: [FIXTURE.fixtures[0]],
    };
    const report = await runLive({
      entries: loadEntries(lone, {
        picks: [{ ...PINS.picks[0], recording: "900000399" }],
      }),
      read: fakeRead(LIVE, []),
    });
    const r = report.responses[0];
    expect([r.planned, r.reason]).toEqual([
      false,
      "The pinned recording is not in the store.",
    ]);
    expect(r.pick.verdict).toBe("missing");
    expect(r.effects.map(e => e.verdict)).toEqual(EFFECTS.map(() => "missing"));
    expect(report.pass).toBe(false);
  });

  test("a call the window would refuse is not planned, and its reason quotes no value", async () => {
    const rows = structuredClone(LIVE);
    rows.meetings[0].class = "sales";
    const report = await runLive({
      entries: loadEntries(
        { fixtures: [FIXTURE.fixtures[0]] },
        { picks: [PINS.picks[0]] },
      ),
      read: fakeRead(rows, []),
    });
    const r = report.responses[0];
    expect([r.planned, r.reason]).toEqual([
      false,
      "The window would refuse it: That recording is a team meeting, not a client call.",
    ]);
    expect(r.effects.every(e => e.verdict === "missing")).toBe(true);
  });

  test("an invitee_email row is a matched sign only at 0.9 or more, read from numeric text as the window reads it", async () => {
    const t2 = loadEntries(FIXTURE, PINS)[1];
    const staff = [
      { name: "Noura Test", email: m(CSM), role: "Client success manager" },
    ];
    const pick = async (confidence: unknown) => {
      const rows = structuredClone(LIVE);
      rows.meetings.push(closerCall(confidence));
      return pickAsOf(await readLive(fakeRead(rows, []), [t2]), t2, staff);
    };
    // A known contact's address: the window's store item sends 0.9 as
    // onTaskConfidence and picks it, exact; so does the replay.
    for (const known of ["0.9", 0.9, "1"])
      expect(await pick(known)).toEqual({
        recording: "900000305",
        signal: "matched",
        label: "exact",
        method: "invitee_email",
        inStore: true,
      });
    // A company domain, or a row with no confidence: no sign, so the CSM's
    // newest call that no client has is picked, as in the window.
    for (const likely of ["0.8", 0.8, null, "", "not a number"])
      expect(await pick(likely)).toMatchObject({
        recording: "900000311",
        signal: "latest_unlinked",
        method: null,
      });
  });

  test("the planner's tie reads the call row's confidence: a closer's invitee_email row ties at 0.9, not at 0.8", async () => {
    const run = async (confidence: string, call: Row = {}) => {
      const rows = structuredClone(LIVE);
      rows.meetings.push({ ...closerCall(confidence), ...call });
      const report = await runLive({
        entries: loadEntries(
          { fixtures: [FIXTURE.fixtures[1]] },
          { picks: [{ ...PINS.picks[1], recording: "900000305" }] },
        ),
        read: fakeRead(rows, []),
      });
      return report.responses[0];
    };
    const known = await run("0.9");
    expect([
      known.planned,
      known.reason,
      known.pick.state,
      known.pick.verdict,
    ]).toEqual([true, null, "matched", "same"]);
    // Rule 2 no longer ties it, and rules 1, 3 and 4 do not either (a Sales
    // recorder, no room, the contact on no booking of the card, no seat).
    // Its call row is on this card, which the client's Calls card lists, so
    // the save reads A7.14's second sentence, whole (round 4, A7.18).
    const domain = await run("0.8");
    expect([domain.planned, domain.reason]).toEqual([
      false,
      `The window would refuse it: ${OUTSIDE_CS_LIKELY}`,
    ]);
    expect(String(domain.reason).length).toBeLessThanOrEqual(240);
    expect([domain.pick.state, domain.pick.verdict]).toEqual([
      "latest_unlinked",
      "differs",
    ]);
    // The same call with its row on no card, or with no call row, keeps
    // OUTSIDE_CS: it is not on this client.
    const unplaced = {
      task_id: null,
      client_name: null,
      match_method: null,
      match_confidence: null,
    };
    for (const call of [unplaced, { ...unplaced, call_id: null }]) {
      const off = await run("0.8", call);
      expect([off.planned, off.reason]).toEqual([
        false,
        `The window would refuse it: ${OUTSIDE_CS}`,
      ]);
    }
  });

  test("call_form differs when the labels, the recording link or the shown call differ", () => {
    const plans = (row: Row, match = "skipped") => [
      {
        effect: "call_form",
        state: "planned",
        plan: { row, linkAfterMatch: row.linked_call_id == null },
      },
      {
        effect: "call_match",
        state: match,
        reason: "The recording is already on this client.",
        plan: {},
      },
    ];
    const answers = [
      { title: "Defcon Status", value: "At Risk" },
      { title: "Task Priority", value: "High" },
    ];
    const calls = new Map<number, Row>([
      [
        40,
        {
          id: 40,
          source: "ghl_appointment",
          task_id: R1,
          status: "confirmed",
          linked_call_id: null,
        },
      ],
      [
        108,
        {
          id: 108,
          source: "fathom",
          task_id: R1,
          status: "held",
          linked_call_id: 40,
        },
      ],
      [
        109,
        {
          id: 109,
          source: "fathom",
          task_id: R1,
          status: "held",
          linked_call_id: 41,
        },
      ],
      [
        41,
        {
          id: 41,
          source: "ghl_appointment",
          task_id: R1,
          status: "gone",
          linked_call_id: null,
        },
      ],
      [
        110,
        {
          id: 110,
          source: "fathom",
          task_id: R2,
          status: "held",
          linked_call_id: null,
        },
      ],
    ]);
    const compare = (o: Row = {}) => ({
      card: R1,
      makeComments: [],
      makeHappiness: null,
      makeLastPocDay: null,
      makeGradeParts: null,
      makeRecapSends: null,
      cardLastCheckinDay: null,
      typeform: {
        defcon: "At Risk",
        priority: "High",
        recordingUrl: "https://fathom.video/share/test-1",
        linkedSource: null,
      },
      meetingUrl: "https://fathom.video/calls/71",
      storedActionItems: null,
      calls,
      nativeLinkFirst: true,
      ...o,
    });
    const verdict = (row: Row, c = compare(), match?: string) =>
      judge(plans(row, match), c).find(j => j.effect === "call_form");
    const row = (o: Row) => ({
      answers,
      recording_url: "https://fathom.video/share/test-1",
      linked_call_id: 40,
      ...o,
    });
    expect(verdict(row({}))?.verdict).toBe("same");
    // The Typeform row may hold the call page instead of the share link.
    expect(
      verdict(
        row({}),
        compare({
          typeform: {
            ...compare().typeform,
            recordingUrl: "https://fathom.video/calls/71/",
          },
        }),
      )?.verdict,
    ).toBe("same");
    expect(
      verdict(
        row({
          answers: [answers[0], { title: "Task Priority", value: "Low" }],
        }),
      )?.reason,
    ).toBe(
      "The planned row's DEFCON or priority differs from the Typeform row's.",
    );
    expect(
      verdict(
        row({}),
        compare({
          typeform: {
            ...compare().typeform,
            recordingUrl: "https://fathom.video/share/test-2",
          },
        }),
      )?.reason,
    ).toBe("The planned row's recording link differs from the Typeform row's.");
    // Hidden under Acme's live booking 40, or on another card.
    expect(verdict(row({ linked_call_id: 108 }))?.verdict).toBe("differs");
    expect(verdict(row({ linked_call_id: 110 }))?.verdict).toBe("differs");
    // Linked to a parent that is gone: shown.
    expect(verdict(row({ linked_call_id: 109 }))?.verdict).toBe("same");
    // No call row yet: shown only when call_match is planned.
    expect(verdict(row({ linked_call_id: null }))?.reason).toBe(
      "The planned row has no call to link and call_match is not planned.",
    );
    expect(
      verdict(row({ linked_call_id: null }), compare(), "planned")?.verdict,
    ).toBe("same");
  });

  test("the fixture and the pinned picks must name the same responses and cards", () => {
    expect(() => loadEntries(FIXTURE, { picks: [PINS.picks[0]] })).toThrow(
      `The response ${T2.slice(0, 10)} has no pinned pick.`,
    );
    expect(() =>
      loadEntries(FIXTURE, {
        picks: [PINS.picks[0], { ...PINS.picks[1], card: R1 }],
      }),
    ).toThrow(`The pinned pick for ${T2.slice(0, 10)} names another card.`);
  });

  test("the committed picks hold ids and picks only", () => {
    const picks = JSON.parse(readFileSync(PICKS, "utf8"));
    expect(picks.picks).toHaveLength(10);
    for (const p of picks.picks) {
      expect(Object.keys(p).sort()).toEqual(["card", "recording", "response"]);
      expect(p.response).toMatch(/^[a-z0-9]{10}$/);
      expect(p.card).toMatch(/^[a-z0-9]{9,10}$/);
      expect(p.recording).toMatch(/^[0-9]{9}$/);
    }
  });
});

describe("--live's SQL on a production-shaped database", () => {
  // The same two entries as raw rows (titles, contact names and addresses,
  // action item text, client notes), read by readLive's real SQL.
  const SPOKEN = [
    "Send Layla the revised ad drafts",
    "Layla shares the showroom photos",
    "Confirm the shoot date with the photographer",
    "Old item already done",
    "Prepare the April performance report",
    "Layla approves the budget",
    "Huda sends the logo files",
    "Huda books the next site visit",
  ];
  let prod: PGlite;
  let report: Report;
  const crossed: string[] = [];
  beforeAll(async () => {
    prod = await replayDb();
    await member(prod, "00000000-0000-4000-8000-0000000000a1", CSM, ["csm"]);
    await member(
      prod,
      "00000000-0000-4000-8000-0000000000c3",
      "aziz@maharamedia.com",
      [],
    );
    await prod.exec(`
      INSERT INTO public.cockpit_people(name, email, role, active, added_by) VALUES
        ('Noura Test', '${CSM}', 'Client success manager', true, 'test'),
        ('Aziz Test', 'aziz@maharamedia.com', 'CEO', true, 'test');
      INSERT INTO public.cockpit_csm_sources(table_name, source_id, client_names, data, source_snapshot_at) VALUES
        ('clients', 'c-${R1}', ARRAY['Replay Interiors'], '{"_id":"c-${R1}","taskId":"${R1}","name":"Replay Interiors"}', now()),
        ('clients', 'c-${R2}', ARRAY['Sample Build'], '{"_id":"c-${R2}","taskId":"${R2}","name":"Sample Build"}', now());
      INSERT INTO public.cockpit_media_sources(table_name, source_id, client_names, data, source_snapshot_at) VALUES
        ('clientLinks', 'l-${R1}', ARRAY['Replay Interiors'], '{"_id":"l-${R1}","taskId":"${R1}","name":"Replay Interiors","aliases":["Replay"]}', now());
      INSERT INTO public.cockpit_csm_calls(id, source, source_id, task_id, client_name, match_method, match_confidence,
        kind, title, starts_at, ends_at, status, room, external_invitees) OVERRIDING SYSTEM VALUE VALUES
        (501, 'ghl_appointment', 'appt-501', '${R1}', 'Replay Interiors', 'client_id_field', 1, 'checkin', 'Check-in with Layla',
         '2026-10-11T10:00:00Z', '2026-10-11T10:30:00Z', 'confirmed', 'meet:abc-defg-hij',
         '[{"email":"${CONTACT_1}","name":"Layla Invented"}]'),
        (701, 'checkin_form', 'form-701', '${R1}', 'Replay Interiors', 'form_task_id', 1, 'checkin', '1-1 form',
         '2026-10-11T14:54:03Z', NULL, 'held', NULL, '[]');`);
    const csm = { email: CSM, name: "Noura Test", team: "Customer Success" };
    const item = (
      description: string,
      email: string | null,
      name: string | null,
      team: string | null,
      at: string,
      completed = false,
    ) => ({
      description,
      recording_timestamp: at,
      completed,
      assignee: { email, name, team },
    });
    const meetings: Row[] = [
      [
        "900000301",
        "Invented review with Layla",
        "2026-10-11T09:58:30Z",
        "2026-10-11T10:32:19Z",
        "client",
        "https://meet.google.com/abc-defg-hij",
        "2026-10-11T10:33:00Z",
        [
          { email: CSM, name: "Noura Test", is_external: false },
          { email: CONTACT_1, name: "Layla Invented", is_external: true },
        ],
        [
          item(SPOKEN[0], CSM, "Noura Test", "Customer Success", "00:12:34"),
          item(SPOKEN[1], CONTACT_1, "Layla Invented", null, "00:01:05"),
          item(SPOKEN[2], null, "Someone", null, "00:01:05"),
          item(SPOKEN[3], CSM, "Noura Test", null, "00:01:05", true),
          item(SPOKEN[4], null, null, "Customer Success", "00:01:05"),
          item(SPOKEN[5], CONTACT_1, "Layla Invented", null, "00:01:05"),
        ],
      ],
      [
        "900000302",
        "Invented supplier chat",
        "2026-10-11T12:00:00Z",
        "2026-10-11T12:30:00Z",
        "candidate",
        null,
        "2026-10-11T12:31:00Z",
        [{ email: CSM, name: "Noura Test", is_external: false }],
        null,
      ],
      [
        "900000311",
        "Invented call with Huda",
        "2026-10-13T10:58:24Z",
        "2026-10-13T11:25:42Z",
        "candidate",
        "https://meet.google.com/kln-opqr-stu",
        "2026-10-13T11:26:30Z",
        [{ email: CSM, name: "Noura Test", is_external: false }],
        [
          item(SPOKEN[6], CONTACT_2, "Huda Invented", null, "00:01:05"),
          item(SPOKEN[7], CONTACT_2, "Huda Invented", null, "00:01:05"),
        ],
      ],
      [
        "900000312",
        "Invented meeting",
        "2026-10-13T11:30:00Z",
        "2026-10-13T11:40:00Z",
        "candidate",
        null,
        "2026-10-13T12:10:00Z",
        [{ email: CSM, name: "Noura Test", is_external: false }],
        null,
      ],
      [
        "900000313",
        "Invented meeting",
        "2026-10-13T08:00:00Z",
        "2026-10-13T08:30:00Z",
        "candidate",
        null,
        "2026-10-13T08:31:00Z",
        [{ email: CSM, name: "Noura Test", is_external: false }],
        null,
      ],
    ];
    for (const [
      id,
      title,
      start,
      end,
      cls,
      room,
      created,
      invitees,
      items,
    ] of meetings)
      await prod.query(
        `INSERT INTO public.cockpit_fathom_meetings(recording_id, title, starts_at, ends_at, recorded_by_email, recorded_by_name,
           external, invitees, url, share_url, summary, raw, class, room, recorder_team)
         VALUES ($1, $2, $3, $4, $5, 'Noura Test', $6, $7::jsonb, $8, $9, 'Invented summary.', $10::jsonb, $11, $12, 'Customer Success')`,
        [
          id,
          title,
          start,
          end,
          CSM,
          cls === "client",
          JSON.stringify(invitees),
          `https://fathom.video/calls/7${id}`,
          `https://fathom.video/share/test-${String(id).slice(-3)}`,
          JSON.stringify({
            recorded_by: csm,
            meeting_title: "Impromptu Google Meet Meeting",
            created_at: created,
            calendar_invitees: invitees,
            meeting_url: room,
            action_items: items ?? undefined,
            default_summary: { markdown_formatted: "Invented summary." },
          }),
          cls,
          room
            ? room.includes("abc")
              ? "meet:abc-defg-hij"
              : "meet:kln-opqr-stu"
            : null,
        ],
      );
    await prod.exec(`
      INSERT INTO public.cockpit_csm_calls(id, source, source_id, task_id, client_name, match_method, match_confidence,
        kind, title, starts_at, ends_at, status, linked_call_id, room, summary, transcript_text) OVERRIDING SYSTEM VALUE VALUES
        (601, 'fathom', '900000301', '${R1}', 'Replay Interiors', 'same_room', 1, 'checkin', 'Invented review with Layla',
         '2026-10-11T09:58:30Z', '2026-10-11T10:32:19Z', 'held', 501, 'meet:abc-defg-hij', 'Invented summary.', 'Layla: invented line'),
        (611, 'fathom', '900000313', '${R2}', 'Sample Build', 'form_task_id', 1, 'other', 'Invented meeting',
         '2026-10-13T08:00:00Z', '2026-10-13T08:30:00Z', 'held', NULL, NULL, NULL, NULL);`);
    const answers = (
      defcon: string,
      priority: string,
      share: string,
      notes: string | null,
    ) =>
      JSON.stringify([
        {
          ref: "c484f390-9695-4ffa-9693-9cc219592713",
          type: "short_text",
          title: "Client ID",
          value: "typed",
        },
        {
          ref: "0773087f-beda-4e2c-bf50-acdac0dcbe05",
          type: "long_text",
          title: "Clients Call Transcript",
          value: `${share} Layla said everything.`,
        },
        {
          ref: "82a6b434-15d9-4a14-8496-c20c94628536",
          type: "long_text",
          title: "Additional Notes",
          value: "Mahara: send Layla the drafts",
        },
        ...(notes
          ? [
              {
                ref: "5d071906-da6a-4413-a729-0c76d0188d91",
                type: "long_text",
                title: "Client Notes",
                value: notes,
              },
            ]
          : []),
        {
          ref: "ff7970f7-9fad-4fa5-b12b-4d719dfb7587",
          type: "multiple_choice",
          title: "Defcon Status",
          value: defcon,
        },
        {
          ref: "c9f99fb1-fec9-47e7-9baa-c5554733723d",
          type: "multiple_choice",
          title: "Task Priority",
          value: priority,
        },
      ]);
    for (const [token, task, at, url, link, defcon, priority, notes] of [
      [
        T1,
        R1,
        "2026-10-11T14:54:03Z",
        "https://fathom.video/share/test-301?timestamp=12",
        701,
        "At Risk",
        "High",
        "Layla sounded worried.",
      ],
      [
        "replayearlier000000000000000001",
        R1,
        "2026-10-04T09:00:00Z",
        "https://fathom.video/share/test-290",
        null,
        "Happy",
        "Low",
        null,
      ],
      [
        T2,
        R2,
        "2026-10-13T11:46:21Z",
        "https://fathom.video/share/test-311",
        null,
        "Neutral",
        "Medium",
        null,
      ],
      [
        "replayearlier000000000000000002",
        R2,
        "2026-10-06T09:00:00Z",
        "https://fathom.video/share/test-280",
        null,
        "Happy",
        "Low",
        null,
      ],
    ] as const)
      await prod.query(
        `INSERT INTO public.cockpit_csm_call_forms(token, form_id, form_kind, task_id, matched_by, submitted_at, answers,
           recording_url, linked_call_id)
         VALUES ($1, 'fRokTITH', 'checkin', $2, 'typed_task_id', $3, $4::jsonb, $5, $6)`,
        [
          token,
          task,
          at,
          answers(defcon, priority, String(url).split("?")[0], notes),
          url,
          link,
        ],
      );
    // sq.py prints each row as JSON: read through the same round trip.
    const read: Reader = async sql => {
      const rows = (await prod.query(sql)).rows;
      const text = JSON.stringify(rows, (_k, v) =>
        typeof v === "bigint" ? Number(v) : v,
      );
      crossed.push(text);
      return JSON.parse(text);
    };
    report = await runLive({
      entries: loadEntries(FIXTURE, PINS),
      read,
      now: new Date("2026-10-28T09:00:00Z"),
    });
  }, 120_000);
  afterAll(async () => {
    await prod?.close();
  });

  test("the real SQL gives the report the synthetic rows give", () => {
    expect(report.responses).toEqual(live.responses);
    expect(report.passes).toEqual(live.passes);
  });

  test("no contact name or address, action item, client note, summary or transcript crosses the SQL", () => {
    const all = crossed.join("\n");
    for (const text of [
      ...SPOKEN,
      "abc-defg-hij",
      "kln-opqr-stu",
      "Layla Invented",
      "Huda Invented",
      CONTACT_1,
      CONTACT_2,
      "Layla sounded worried",
      "everything",
      "Invented summary",
      "invented line",
      "send Layla the drafts",
    ])
      expect(all).not.toContain(text);
    // The staff's own addresses come back for the role lookup; contacts only masked.
    expect(all).toContain(m(CONTACT_1) as string);
  });
});

describe("--shadow, on synthetic plans and synthetic Make answers", () => {
  const S1 = "50000000-0000-4000-8000-000000000001";
  const S2 = "50000000-0000-4000-8000-000000000002";
  const S3 = "50000000-0000-4000-8000-000000000003";
  /** The plans as readShadow's SQL returns them: no comment text, the row's answers cut to DEFCON and priority. */
  const plans = (o: { option: string; day: string; linkFirst: boolean }) => [
    {
      effect: "call_form",
      state: "dry_run",
      owner: "shadow",
      reason: null,
      plan: {
        row: {
          token: "cockpit:x",
          linked_call_id: 801,
          answers: [
            {
              ref: "ff7970f7-9fad-4fa5-b12b-4d719dfb7587",
              title: "Defcon Status",
              value: "At Risk",
            },
            {
              ref: "c9f99fb1-fec9-47e7-9baa-c5554733723d",
              title: "Task Priority",
              value: "High",
            },
          ],
          recording_url: "https://fathom.video/share/test-901",
        },
        linkAfterMatch: false,
        linkRow: {
          id: 801,
          source: "ghl_appointment",
          task_id: R1,
          status: "confirmed",
          linked_call_id: null,
        },
        lines: [
          "Would save the notes where the client brief and Today read them.",
        ],
      },
    },
    {
      effect: "call_match",
      state: "skipped",
      owner: "shadow",
      reason: "The recording is already on this client.",
      plan: { lines: [] },
    },
    {
      effect: "todo_comment",
      state: "dry_run",
      owner: "shadow",
      reason: null,
      plan: {
        notify_all: false,
        items: 6,
        sides: { ours: 4, theirs: 2 },
        linkFirst: o.linkFirst,
        lines: ["x"],
      },
    },
    {
      effect: "happiness",
      state: "dry_run",
      owner: "shadow",
      reason: null,
      plan: { value: o.option, lines: ["x"] },
    },
    {
      effect: "last_poc",
      state: "dry_run",
      owner: "shadow",
      reason: null,
      plan: { day: o.day, lines: ["x"] },
    },
    {
      effect: "last_checkin_call",
      state: "dry_run",
      owner: "shadow",
      reason: null,
      plan: { day: o.day, lines: ["x"] },
    },
    {
      effect: "grade_notice",
      state: "dry_run",
      owner: "shadow",
      reason: null,
      plan: { target: "C09SVG6FHGU", dedupe: "grade:900000901", lines: ["x"] },
    },
    {
      effect: "recap",
      state: "dry_run",
      owner: "shadow",
      reason: null,
      plan: { state: "awaiting_approval", lines: ["x"] },
    },
  ];
  // shadow responses are uuid-like (pass the id check in parseArgs); but the run maps by id.
  const SHADOW: Record<string, Row[]> = {
    shadow: [
      {
        id: S1,
        task_id: R1,
        client_name: "Replay Interiors",
        mode: "shadow",
        state: "submitted",
        submitted_at: "2026-10-29T10:40:00.000Z",
        call_kind: "fathom",
        recording_id: "900000901",
        share_url: "https://fathom.video/share/test-901",
        why: "same_room",
        call_starts_at: "2026-10-29T07:00:00.000Z",
        defcon: "At Risk",
        priority: "High",
        effects: plans({ option: AT_RISK, day: "2026-10-29", linkFirst: true }),
      },
      {
        id: S2,
        task_id: R2,
        client_name: "Sample Build",
        mode: "shadow",
        state: "submitted",
        submitted_at: "2026-10-29T12:00:00.000Z",
        call_kind: "fathom",
        recording_id: "900000911",
        share_url: "https://fathom.video/share/test-911",
        why: "latest_unlinked",
        call_starts_at: "2026-10-29T09:00:00.000Z",
        defcon: "At Risk",
        priority: "High",
        effects: plans({ option: AT_RISK, day: "2026-10-29", linkFirst: true }),
      },
    ],
    shadow_forms: [
      {
        token: "replayshadowform0000000000001",
        task_id: R1,
        submitted_at: "2026-10-29T08:30:00.000Z",
        recording_url: "https://fathom.video/share/test-901?timestamp=40",
        linked_call_id: 702,
        defcon: "At Risk",
        priority: "High",
      },
    ],
  };
  const asks: { card: string; after: number }[][] = [];
  const make = async (
    cards: { card: string; after: number }[],
  ): Promise<MakeRead[]> => {
    asks.push(cards);
    return cards.map(c => ({
      card: c.card,
      after: c.after,
      task: {
        status: 200,
        happinessOption: AT_RISK,
        lastPocDay: "2026-10-29",
        lastCheckinDay: "2026-10-29",
      },
      comment: {
        status: 200,
        found: 1,
        shapes: [
          {
            lines: 14,
            bulletLines: 8,
            linkFirst: false,
            ours: true,
            theirs: true,
          },
        ],
      },
      grade: { status: 200, parts: 2 },
    }));
  };
  let shadow: Report;
  const reads: string[] = [];
  beforeAll(async () => {
    shadow = await runShadow({
      ids: [S1, S2, S3],
      read: fakeRead(SHADOW, reads),
      make,
    });
  });

  test("reads the plans and the Typeform rows once each, and asks the VPS only for the call that has a Typeform row", () => {
    expect(reads.map(sql => /^-- replay:([a-z_]+)/.exec(sql)?.[1])).toEqual([
      "shadow",
      "shadow_forms",
    ]);
    expect(reads[0]).toContain("e.plan - 'comment_text'");
    expect(asks).toEqual([
      [
        {
          card: R1,
          after: Math.floor(Date.parse("2026-10-29T08:30:00Z") / 1000),
        },
      ],
    ]);
  });

  test("compares each effect with what Make wrote for the same call", () => {
    expect(shadow.mode).toBe("shadow");
    expect(shadow.responses.map(r => [r.response, r.pick.verdict])).toEqual([
      [S1.slice(0, 8), "same"],
      [S2.slice(0, 8), "missing"],
      [S3.slice(0, 8), "missing"],
    ]);
    const one = byEffect(shadow, 0);
    expect(
      Object.fromEntries(Object.entries(one).map(([k, e]) => [k, e.verdict])),
    ).toEqual({
      call_form: "same",
      call_match: "same",
      todo_comment: "better",
      happiness: "same",
      last_poc: "same",
      last_checkin_call: "same",
      grade_notice: "same",
      recap: "same",
    });
    expect(one.todo_comment.reason).toBe(
      "The plan has 6 lines (4 ours, 2 theirs), the recording link on line 1; Make's comment had 8 bullet lines and no link on line 1.",
    );
    const two = byEffect(shadow, 1);
    expect(two.happiness.verdict).toBe("missing");
    expect(two.happiness.reason).toBe(
      "No Typeform row for this call yet, so Make's writes cannot be read.",
    );
    expect(shadow.responses[2].reason).toBe("No such response in the cockpit.");
  });

  test("a grade Make's channel will not show is a difference with its reason", async () => {
    const report = await runShadow({
      ids: [S1],
      read: fakeRead(SHADOW, []),
      make: async cards =>
        cards.map(c => ({
          card: c.card,
          after: c.after,
          task: { happinessOption: NEUTRAL, lastPocDay: "2026-10-30" },
          comment: { found: 0, shapes: [] },
          grade: { status: 200, error: "not_in_channel" },
        })),
    });
    const one = byEffect(report, 0);
    expect([one.grade_notice.verdict, one.grade_notice.reason]).toEqual([
      "differs",
      "Planned; Make's grade could not be read (not_in_channel).",
    ]);
    expect(one.happiness.verdict).toBe("differs");
    expect(one.last_poc.verdict).toBe("differs");
    expect([one.todo_comment.verdict, one.todo_comment.reason]).toEqual([
      "better",
      "The plan has 6 lines (4 ours, 2 theirs); Make posted no comment for this response.",
    ]);
  });

  test("writes shadow-report.json and .md, shapes and values only", () => {
    const files = writeReport(out, shadow);
    expect(files.map(f => f.slice(out.length + 1))).toEqual([
      "shadow-report.json",
      "shadow-report.md",
    ]);
    for (const f of files) {
      const text = readFileSync(f, "utf8");
      for (const secret of [
        "@",
        "fathom.video",
        "At Risk",
        "High",
        "comment_text",
      ])
        expect(text).not.toContain(secret);
    }
  });
});

describe("the readers, the VPS script and the command line", () => {
  test("sq.py is spawned from the home folder, the query as its argument, nothing on its input", async () => {
    const calls: Row[] = [];
    const run = ((cmd: string, args: string[], opts: Row) => {
      calls.push({ cmd, args, opts });
      return { status: 0, stdout: '{"a": 1}\n\n{"a": 2}\n', stderr: "" };
    }) as any;
    const read = sqReader({ home: "/home/test", run });
    expect(await read("-- replay:x\nSELECT 1")).toEqual([{ a: 1 }, { a: 2 }]);
    expect(calls[0]).toMatchObject({
      // Windows checkout: join() builds paths with backslashes there.
      cmd: join("/home/test", ".cache", "mahara-ship", "pybin", "python"),
      // Windows checkout: join() builds paths with backslashes there.
      args: [
        join("/home/test", ".cache", "mahara-ship", "sq.py"),
        "-- replay:x\nSELECT 1",
      ],
      opts: { cwd: "/home/test", stdio: ["ignore", "pipe", "pipe"] },
    });
    const failing = sqReader({
      home: "/home/test",
      run: (() => ({
        status: 1,
        stdout: '{"error":"relation does not exist"}',
        stderr: "",
      })) as any,
    });
    await expect(failing("SELECT 1")).rejects.toThrow(
      "The read through sq.py failed (exit 1)",
    );
  });

  test("the VPS GET route: one ssh call, the script on its input, the keys by name, the request in base64", async () => {
    const calls: Row[] = [];
    const run = ((cmd: string, args: string[], opts: Row) => {
      calls.push({ cmd, args, opts });
      return { status: 0, stdout: '{"card":"taskR1","after":1}\n', stderr: "" };
    }) as any;
    const read = vpsReader({
      run,
      clickupKey: "CLICKUP_API_KEY",
      slackKey: "SLACK_BOT_TOKEN",
    });
    expect(await read([{ card: R1, after: 1 }])).toEqual([
      { card: R1, after: 1 },
    ]);
    const [{ cmd, args, opts }] = calls;
    expect(cmd).toBe("ssh");
    expect(args).toContain("187.77.156.166");
    expect(args).toContain("ControlMaster=auto");
    const remote = args[args.length - 1];
    expect(remote).toStartWith(
      "set -a; . /opt/data/bibi/api-keys.env; set +a; python3 - ",
    );
    expect(
      JSON.parse(Buffer.from(remote.split(" ").pop(), "base64").toString()),
    ).toEqual({
      cards: [{ card: R1, after: 1 }],
      clickupKey: "CLICKUP_API_KEY",
      slackKey: "SLACK_BOT_TOKEN",
    });
    expect(opts.input).toBe(VPS_SCRIPT);
  });

  test("the VPS script makes GET calls only, reads keys by name, prints shapes only, and parses as Python", () => {
    expect(VPS_SCRIPT).toContain('method="GET"');
    expect(VPS_SCRIPT).not.toMatch(
      /method="(POST|PUT|PATCH|DELETE)"|\.(post|put|patch|delete)\(/i,
    );
    expect(VPS_SCRIPT).toContain(
      'os.environ.get(REQ.get("clickupKey") or "CLICKUP_API_KEY", "")',
    );
    expect(VPS_SCRIPT).not.toMatch(/print\([^)]*(CLICKUP|SLACK)\b/);
    expect(VPS_SCRIPT).not.toMatch(/comment_text"\)\s*[,}]|"text":/);
    const parsed = spawnSync(
      // Windows checkout: there is no python3 command, only python.
      process.platform === "win32" ? "python" : "python3",
      ["-c", "import ast, sys; ast.parse(sys.stdin.read())"],
      {
        input: VPS_SCRIPT,
        encoding: "utf8",
      },
    );
    expect(parsed.status).toBe(0);
  });

  test("the command line says what is missing in a plain sentence", () => {
    expect(
      parseArgs(["--live", "--fixture", "f.json", "--out", "o"]),
    ).toMatchObject({
      mode: "live",
      fixture: "f.json",
      out: "o",
      picks: PICKS,
    });
    expect(
      parseArgs([
        "--shadow",
        "50000000-0000-4000-8000-000000000001, 50000000-0000-4000-8000-000000000002",
        "--out",
        "o",
      ]).ids,
    ).toEqual([
      "50000000-0000-4000-8000-000000000001",
      "50000000-0000-4000-8000-000000000002",
    ]);
    expect(() => parseArgs(["--out", "o"])).toThrow(
      "Say --live or --shadow <response ids>.",
    );
    expect(() => parseArgs(["--live", "--fixture", "f.json"])).toThrow(
      "--out names the folder for the report.",
    );
    expect(() => parseArgs(["--live", "--out", "o"])).toThrow(
      "--live needs --fixture <replay-10.json>.",
    );
    expect(() => parseArgs(["--shadow", "not-an-id", "--out", "o"])).toThrow(
      "Each shadow response id is a uuid.",
    );
    expect(() => parseArgs(["--live", "--fixture"])).toThrow(
      "--fixture needs a value.",
    );
    expect(() => parseArgs(["--apply"])).toThrow("Unknown option --apply.");
  });

  test("the days and links the verdicts compare", () => {
    // ClickUp keeps a date-only value at 04:00 London: 03:00Z in summer time, 04:00Z after.
    expect(londonDay("2026-10-21T03:00:00Z")).toBe("2026-10-21");
    expect(londonDay("2026-10-26T04:00:00Z")).toBe("2026-10-26");
    expect(londonDay("2026-10-20T23:30:00Z")).toBe("2026-10-21");
    expect(londonDay(null)).toBeNull();
    expect(
      new Date(
        kuwaitMidnight(Date.parse("2026-10-20T21:30:00Z")),
      ).toISOString(),
    ).toBe("2026-10-20T21:00:00.000Z");
    expect(
      new Date(
        kuwaitMidnight(Date.parse("2026-10-20T20:30:00Z")),
      ).toISOString(),
    ).toBe("2026-10-19T21:00:00.000Z");
    expect(linkKey("HTTPS://Fathom.Video/share/AbC/?timestamp=12#x")).toBe(
      "https://fathom.video/share/AbC",
    );
    expect(linkKey("not a link")).toBeNull();
  });
});
