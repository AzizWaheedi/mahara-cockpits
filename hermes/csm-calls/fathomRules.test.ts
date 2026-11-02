/**
 * fathomRules.ts against docs/forms/STAGE2-CONTRACT.md 4.2 and section 11: the
 * class rule, meetingRow privacy, the call row before the matcher, the action
 * items, and transcriptText with the output it had in sources.ts. Meetings,
 * people, links, summaries and transcript lines are invented.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import * as rules from "./fathomRules.ts";
import {
  type ActionItem,
  actionItems,
  CANDIDATE_MIN_SECONDS,
  CS_TEAM,
  callRowBase,
  classifyMeeting,
  durationSeconds,
  type FathomMeeting,
  hhmmssToSeconds,
  type MeetingClass,
  meetingRow,
  speakers,
  transcriptText,
} from "./fathomRules.ts";
import { hashOf, type Row, titleKind } from "./match.ts";

const NOW = "2026-10-28T09:00:00.000Z";
const START = "2026-10-21T10:56:00Z";
const SUMMARY = "## Summary\nAn invented summary of the call.";
const CSM = { name: "Test CSM", email: "csm@maharamedia.com", email_domain: "maharamedia.com", team: CS_TEAM };
const CLOSER = { name: "Test Closer", email: "closer@maharamedia.com", email_domain: "maharamedia.com", team: "Sales" };
const CSM_INVITEE = { name: "Test CSM", email: "csm@maharamedia.com", email_domain: "maharamedia.com", is_external: false };
const CLIENT_INVITEE = { name: "Client Contact", email: "owner@client.example", email_domain: "client.example", is_external: true };
const LINES = [
  { speaker: { display_name: "Test CSM", matched_calendar_invitee_email: "csm@maharamedia.com" }, text: "An invented first line.", timestamp: "00:00:04" },
  { speaker: { display_name: "Client Contact", matched_calendar_invitee_email: null }, text: "An invented reply.", timestamp: "00:00:09" },
  { speaker: { display_name: "Test CSM" }, text: "An invented last line.", timestamp: "00:36:02" },
];
const ITEMS = [
  {
    description: "Send the invented launch plan",
    user_generated: false,
    completed: false,
    recording_timestamp: "00:12:30",
    recording_playback_url: "https://fathom.video/calls/900000001?timestamp=750",
    assignee: { name: "Test CSM", email: "csm@maharamedia.com", team: CS_TEAM },
  },
  {
    description: "Share the invented photos",
    user_generated: false,
    completed: false,
    recording_timestamp: "00:20:05",
    recording_playback_url: "https://fathom.video/calls/900000001?timestamp=1205",
    assignee: { name: "Client Contact", email: null, team: null },
  },
];
const HIGHLIGHTS = [{ text: "An invented highlight", recording_timestamp: "00:05:00" }];

/** An impromptu call recorded by Customer Success: 36 minutes, flagged external, shared, with its content. */
const meeting = (over: FathomMeeting = {}): FathomMeeting => ({
  title: "Impromptu Google Meet Meeting",
  meeting_title: "Impromptu Google Meet Meeting",
  recording_id: 100000001,
  url: "https://fathom.video/calls/900000001",
  share_url: "https://fathom.video/share/TEST100000001",
  created_at: "2026-10-21T11:32:15Z",
  scheduled_start_time: START,
  scheduled_end_time: "2026-10-21T11:26:00Z",
  recording_start_time: START,
  recording_end_time: "2026-10-21T11:32:00Z",
  meeting_url: "https://meet.google.com/abc-defg-hij",
  meeting_type: "external",
  calendar_invitees_domains_type: "one_or_more_external",
  transcript_language: "en",
  shared_with: "all_teams",
  recorded_by: CSM,
  calendar_invitees: [CSM_INVITEE],
  default_summary: { template_name: "Enhanced", markdown_formatted: SUMMARY },
  action_items: ITEMS,
  highlights: HIGHLIGHTS,
  crm_matches: null,
  transcript: LINES,
  ...over,
});
const external = { calendar_invitees: [CSM_INVITEE, CLIENT_INVITEE] };
const lasting = (seconds: number) => ({ recording_end_time: new Date(Date.parse(START) + seconds * 1000).toISOString() });
const NONE: ReadonlySet<string> = new Set<string>();

/** sources.ts at release 2cacdca5 (:392-397), before transcriptText moved to fathomRules.ts. */
function transcriptTextBefore(lines: unknown): string | undefined {
  if (!Array.isArray(lines) || !lines.length) return undefined;
  return lines
    .map((l: Row) => `[${l.timestamp ?? ""}] ${l.speaker?.display_name ?? "Speaker"}: ${l.text ?? ""}`)
    .join("\n");
}

/** The meeting row and the unmatched call row as release 2cacdca5 builds them (sources.ts:434-496). */
function rowsBefore(m: Row, nowIso: string) {
  const ext = (m.calendar_invitees ?? []).some((i: Row) => i.is_external);
  const rid = String(m.recording_id);
  const start = m.recording_start_time ?? m.scheduled_start_time ?? m.created_at;
  const { transcript, ...rest } = m;
  const email = String(m.recorded_by?.email ?? "").toLowerCase();
  const meetingBefore = {
    recording_id: rid,
    title: m.title ?? m.meeting_title ?? null,
    starts_at: start ?? null,
    ends_at: m.recording_end_time ?? m.scheduled_end_time ?? null,
    recorded_by_email: email || null,
    recorded_by_name: m.recorded_by?.name ?? null,
    external: ext,
    invitees: m.calendar_invitees ?? [],
    url: m.url ?? null,
    share_url: m.share_url ?? null,
    summary: ext ? (m.default_summary?.markdown_formatted ?? null) : null,
    raw: ext ? rest : { ...rest, default_summary: null, action_items: null, highlights: null },
    updated_at: nowIso,
  };
  const callBefore = {
    source: "fathom",
    source_id: rid,
    task_id: null,
    client_name: null,
    match_method: null,
    match_confidence: null,
    kind: titleKind(m.title ?? m.meeting_title),
    title: String(m.title ?? m.meeting_title ?? "Recorded call").slice(0, 300),
    starts_at: start,
    ends_at: m.recording_end_time ?? null,
    status: "held",
    provider_status: "recorded",
    host_email: email || null,
    host_name: m.recorded_by?.name ?? null,
    recording_url: m.url ?? m.share_url ?? null,
    summary: m.default_summary?.markdown_formatted ?? null,
    external_invitees: (m.calendar_invitees ?? []).filter((i: Row) => i.is_external).map((i: Row) => ({ email: i.email, name: i.name })),
    linked_call_id: null,
    updated_at: nowIso,
    raw_hash: hashOf([rid, m.default_summary?.markdown_formatted ?? ""]),
  };
  return { meeting: meetingBefore, call: callBefore };
}

test("exactly the exports of contract 4.2, with its constants", () => {
  expect(Object.keys(rules).sort()).toEqual(
    [
      "CANDIDATE_MIN_SECONDS",
      "CS_TEAM",
      "actionItems",
      "callRowBase",
      "classifyMeeting",
      "durationSeconds",
      "hhmmssToSeconds",
      "meetingRow",
      "speakers",
      "transcriptText",
    ].sort(),
  );
  expect(CS_TEAM).toBe("Customer Success");
  expect(CANDIDATE_MIN_SECONDS).toBe(300);
});

describe("classifyMeeting, in the order of 4.2", () => {
  test("a Customer Success impromptu call flagged external, 5 minutes or more, shared: candidate", () => {
    expect(classifyMeeting(meeting(), NONE)).toBe("candidate");
    expect(classifyMeeting(meeting({ shared_with: undefined }), NONE)).toBe("candidate");
    expect(classifyMeeting(meeting({ ...lasting(CANDIDATE_MIN_SECONDS), default_summary: null }), NONE)).toBe("candidate");
  });

  test("2 minutes with no summary: internal; a summary makes it a candidate", () => {
    expect(classifyMeeting(meeting({ ...lasting(120), default_summary: null }), NONE)).toBe("internal");
    expect(classifyMeeting(meeting({ ...lasting(299), default_summary: null }), NONE)).toBe("internal");
    expect(classifyMeeting(meeting({ ...lasting(120), default_summary: { markdown_formatted: "  " } }), NONE)).toBe("internal");
    expect(classifyMeeting(meeting(lasting(120)), NONE)).toBe("candidate");
  });

  test("not shared with a team (no_teams): internal", () => {
    expect(classifyMeeting(meeting({ shared_with: "no_teams" }), NONE)).toBe("internal");
  });

  test("the Sales team with no external invitee: internal; a team meeting: internal", () => {
    expect(classifyMeeting(meeting({ recorded_by: CLOSER }), NONE)).toBe("internal");
    expect(classifyMeeting(meeting({ recorded_by: undefined }), NONE)).toBe("internal");
    expect(classifyMeeting(meeting({ calendar_invitees_domains_type: "only_internal" }), NONE)).toBe("internal");
  });

  test("an external calendar invitee: client, whoever recorded it", () => {
    expect(classifyMeeting(meeting(external), NONE)).toBe("client");
    expect(classifyMeeting(meeting({ ...external, recorded_by: CLOSER }), NONE)).toBe("client");
    expect(classifyMeeting(meeting({ ...external, calendar_invitees_domains_type: "only_internal", ...lasting(60) }), NONE)).toBe("client");
    expect(classifyMeeting(meeting({ calendar_invitees: [{ ...CLIENT_INVITEE, is_external: false }] }), NONE)).toBe("candidate");
  });

  test("in the sales index and not recorded by Customer Success: sales, external or not", () => {
    const sales = new Set(["100000001"]);
    expect(classifyMeeting(meeting({ ...external, recorded_by: CLOSER }), sales)).toBe("sales");
    expect(classifyMeeting(meeting({ recorded_by: CLOSER }), sales)).toBe("sales");
    expect(classifyMeeting(meeting({ ...external, recorded_by: undefined }), sales)).toBe("sales");
    expect(classifyMeeting(meeting({ recorded_by: CLOSER, recording_id: "100000001" }), sales)).toBe("sales");
  });

  test("in the sales index and recorded by Customer Success: candidate, or client when external, with its content", () => {
    // salesIds holds the index rows not marked `client service`, so an index row with no hidden_reason is in it.
    const sales = new Set(["100000001"]);
    for (const [m, cls] of [
      [meeting(), "candidate"],
      [meeting(external), "client"],
    ] as const) {
      expect(classifyMeeting(m, sales)).toBe(cls);
      const row = meetingRow(m, classifyMeeting(m, sales), NOW);
      expect(row.summary).toBe(SUMMARY);
      expect((row.raw as FathomMeeting).action_items).toEqual(ITEMS);
      expect(actionItems(m).map(a => a.description)).toEqual(["Send the invented launch plan", "Share the invented photos"]);
    }
  });

  test("a Sales-team external recording indexed as client service stays client and keeps its content", () => {
    // The caller leaves `client service` index rows out of salesIds (4.2), so the set never holds this one.
    const m = meeting({ ...external, recorded_by: CLOSER });
    const cls = classifyMeeting(m, new Set(["100000002"]));
    expect(cls).toBe("client");
    expect(meetingRow(m, cls, NOW)).toMatchObject({ class: "client", summary: SUMMARY });
    expect(callRowBase(m, "client", NOW).summary).toBe(SUMMARY);
  });

  test("the length comes from the stored row's times, as the SQL rule reads them", () => {
    // No recording end: the scheduled end (11:26) counts, 30 minutes after the recording's start.
    expect(classifyMeeting(meeting({ recording_end_time: null, default_summary: null }), NONE)).toBe("candidate");
    expect(classifyMeeting(meeting({ recording_end_time: null, scheduled_end_time: null, default_summary: null }), NONE)).toBe("internal");
  });
});

describe("durationSeconds and hhmmssToSeconds", () => {
  test("the stored row's times: the recording's, else the scheduled ones", () => {
    expect(durationSeconds(meeting())).toBe(36 * 60);
    expect(durationSeconds(meeting({ recording_end_time: null }))).toBe(30 * 60);
    expect(durationSeconds(meeting({ recording_start_time: null, recording_end_time: null }))).toBe(30 * 60);
    expect(durationSeconds(meeting({ recording_end_time: "2026-10-21T10:57:30.900Z" }))).toBe(90);
  });

  test("a missing or unreadable time, or an end before the start, gives null", () => {
    expect(durationSeconds(meeting({ recording_end_time: null, scheduled_end_time: null }))).toBeNull();
    expect(durationSeconds(meeting({ recording_end_time: "2026-10-21T10:50:00Z" }))).toBeNull();
    expect(durationSeconds(meeting({ recording_end_time: "soon" }))).toBeNull();
    expect(durationSeconds({})).toBeNull();
  });

  test("HH:MM:SS as seconds; anything else is null", () => {
    expect(hhmmssToSeconds("00:00:00")).toBe(0);
    expect(hhmmssToSeconds("00:12:30")).toBe(750);
    expect(hhmmssToSeconds("1:02:03")).toBe(3723);
    expect(hhmmssToSeconds(" 01:02:03 ")).toBe(3723);
    expect(hhmmssToSeconds("12:30")).toBe(750);
    expect(hhmmssToSeconds("00:00:05.750")).toBe(5);
    for (const bad of ["", "12", "00:60:00", "00:00:60", "-00:00:01", "aa:bb:cc", "1:2:3", "00:12:30 extra", null, undefined, 750, {}])
      expect(hhmmssToSeconds(bad)).toBeNull();
  });
});

describe("meetingRow", () => {
  test("the worker's columns as before 2a, plus class, room and recorder team", () => {
    const m = meeting(external);
    expect(meetingRow(m, "client", NOW)).toEqual({
      ...rowsBefore(m, NOW).meeting,
      class: "client",
      room: "meet:abc-defg-hij",
      recorder_team: CS_TEAM,
    });
  });

  test("an internal row as before 2a, except that raw leaves the content keys out instead of nulling them", () => {
    const m = meeting({ calendar_invitees_domains_type: "only_internal" });
    const before = rowsBefore(m, NOW).meeting;
    const { default_summary, action_items, highlights, ...rawBefore } = before.raw as Row;
    expect([default_summary, action_items, highlights]).toEqual([null, null, null]);
    expect(meetingRow(m, "internal", NOW)).toEqual({ ...before, raw: rawBefore, class: "internal", room: "meet:abc-defg-hij", recorder_team: CS_TEAM });
  });

  test("privacy: the summary key is always there, null for internal and sales, and raw never holds the summary keys or the transcript", () => {
    for (const cls of ["client", "candidate", "internal", "sales"] as MeetingClass[]) {
      const row = meetingRow(meeting(external), cls, NOW);
      const raw = row.raw as FathomMeeting;
      const all = JSON.stringify(row);
      expect(Object.keys(row)).toContain("summary");
      expect(Object.keys(row)).toContain("raw");
      expect(Object.keys(raw)).not.toContain("transcript");
      expect(all).not.toContain("An invented first line");
      expect(raw).toMatchObject({ recording_id: 100000001, meeting_url: "https://meet.google.com/abc-defg-hij", shared_with: "all_teams" });
      if (cls === "internal" || cls === "sales") {
        expect(row.summary).toBeNull();
        for (const key of ["default_summary", "action_items", "highlights"]) expect(Object.keys(raw)).not.toContain(key);
        for (const content of ["invented summary", "invented launch plan", "invented highlight"]) expect(all).not.toContain(content);
      } else {
        expect(row.summary).toBe(SUMMARY);
        expect(raw).toMatchObject({ default_summary: { markdown_formatted: SUMMARY }, action_items: ITEMS, highlights: HIGHLIGHTS });
      }
    }
  });

  test("a candidate keeps its content, which the worker dropped before 2a", () => {
    const row = meetingRow(meeting(), "candidate", NOW);
    expect(rowsBefore(meeting(), NOW).meeting.summary).toBeNull();
    expect(row).toMatchObject({ class: "candidate", external: false, summary: SUMMARY, recorder_team: CS_TEAM });
    expect((row.raw as FathomMeeting).action_items).toEqual(ITEMS);
  });

  test("no summary, or a blank one, is stored as null", () => {
    expect(meetingRow(meeting({ default_summary: null }), "candidate", NOW).summary).toBeNull();
    expect(meetingRow(meeting({ default_summary: { markdown_formatted: " \n " } }), "client", NOW).summary).toBeNull();
  });

  test("the room from the meeting link, the recorder's team, the recorder's email in lower case", () => {
    const zoom = meetingRow(meeting({ meeting_url: "https://us05web.zoom.us/j/12345678901?pwd=TEST" }), "candidate", NOW);
    expect(zoom.room).toBe("zoom:12345678901");
    expect(meetingRow(meeting({ meeting_url: "https://teams.microsoft.com/l/meetup-join/TEST" }), "client", NOW).room).toBeNull();
    expect(meetingRow(meeting({ meeting_url: null }), "client", NOW).room).toBeNull();
    const nobody = meetingRow(meeting({ recorded_by: undefined }), "internal", NOW);
    expect(nobody).toMatchObject({ recorder_team: null, recorded_by_email: null, recorded_by_name: null });
    expect(meetingRow(meeting({ recorded_by: { ...CSM, email: "CSM@MaharaMedia.com" } }), "candidate", NOW).recorded_by_email).toBe("csm@maharamedia.com");
  });

  test("every key of the ingest item's meeting (contract 3.6)", () => {
    const keys = Object.keys(meetingRow(meeting(), "candidate", NOW));
    for (const key of ["recording_id", "title", "starts_at", "ends_at", "recorded_by_email", "recorded_by_name", "external", "invitees", "url", "share_url", "summary", "raw", "class", "room", "recorder_team"])
      expect(keys).toContain(key);
  });
});

describe("callRowBase", () => {
  test("the worker's call row with no client yet, as before 2a, plus candidate, room and no hints", () => {
    const m = meeting(external);
    const { raw_hash, ...before } = rowsBefore(m, NOW).call;
    expect(raw_hash).toMatch(/^[0-9a-f]{16}$/);
    expect(callRowBase(m, "client", NOW)).toEqual({ ...before, candidate: false, room: "meet:abc-defg-hij", hints: [] });
  });

  test("a candidate's row: candidate, the recorder as host, its summary, no client and no link", () => {
    const row = callRowBase(meeting(), "candidate", NOW);
    expect(row).toEqual({
      source: "fathom",
      source_id: "100000001",
      task_id: null,
      client_name: null,
      match_method: null,
      match_confidence: null,
      kind: "other",
      title: "Impromptu Google Meet Meeting",
      starts_at: START,
      ends_at: "2026-10-21T11:32:00Z",
      status: "held",
      provider_status: "recorded",
      host_email: "csm@maharamedia.com",
      host_name: "Test CSM",
      recording_url: "https://fathom.video/calls/900000001",
      summary: SUMMARY,
      external_invitees: [],
      linked_call_id: null,
      candidate: true,
      room: "meet:abc-defg-hij",
      hints: [],
      updated_at: NOW,
    });
    expect(JSON.stringify(row)).not.toContain("An invented first line");
  });

  test("every key of the ingest item's call (contract 3.6)", () => {
    const keys = Object.keys(callRowBase(meeting(), "candidate", NOW));
    for (const key of ["source_id", "task_id", "client_name", "match_method", "match_confidence", "kind", "title", "starts_at", "ends_at", "host_email", "host_name", "recording_url", "summary", "external_invitees", "linked_call_id", "candidate", "room", "hints"])
      expect(keys).toContain(key);
  });

  test("kind from the title (else Fathom's meeting title), exactly as match.ts titleKind", () => {
    const titles = [
      "Impromptu Zoom Meeting",
      "City Wood - Check In",
      "check-in",
      "Checkin call",
      "1-1 with the client",
      "1:1",
      "Client success call",
      "Brand Blueprint session",
      "Blueprint launch",
      "Launch review",
      "Onboarding",
      "Kick-off",
      "KICK OFF",
      "kickoff",
      "",
      null,
      undefined,
    ];
    for (const title of titles) expect(callRowBase(meeting({ title, meeting_title: null }), "client", NOW).kind).toBe(titleKind(title));
    expect(callRowBase(meeting({ title: null, meeting_title: "Launch call" }), "client", NOW).kind).toBe("launch");
    // The copy in fathomRules.ts (it imports only callMatch.ts) is match.ts's rule character for character.
    const body = (file: string) => /function titleKind\([^)]*\)[^{]*\{([\s\S]*?)\n\}/.exec(readFileSync(new URL(file, import.meta.url), "utf8"))?.[1];
    expect(body("./match.ts")).toContain("blueprint");
    expect(body("./fathomRules.ts")).toBe(body("./match.ts"));
  });

  test("the title is cut at 300 characters, and reads Recorded call when there is none", () => {
    expect(callRowBase(meeting({ title: "x".repeat(400) }), "client", NOW).title).toBe("x".repeat(300));
    expect(callRowBase(meeting({ title: null, meeting_title: null }), "client", NOW).title).toBe("Recorded call");
    expect(callRowBase(meeting({ url: null }), "client", NOW).recording_url).toBe("https://fathom.video/share/TEST100000001");
  });
});

describe("actionItems", () => {
  test("Fathom's items in one shape, in Fathom's order", () => {
    const items: ActionItem[] = actionItems(meeting());
    expect(items).toEqual([
      {
        description: "Send the invented launch plan",
        assigneeEmail: "csm@maharamedia.com",
        assigneeName: "Test CSM",
        assigneeTeam: CS_TEAM,
        seconds: 750,
        playbackUrl: "https://fathom.video/calls/900000001?timestamp=750",
        completed: false,
      },
      {
        description: "Share the invented photos",
        assigneeEmail: null,
        assigneeName: "Client Contact",
        assigneeTeam: null,
        seconds: 1205,
        playbackUrl: "https://fathom.video/calls/900000001?timestamp=1205",
        completed: false,
      },
    ]);
  });

  test("blank values are null, emails lower case, completed only when true, and an entry that is not an item is skipped", () => {
    const m = meeting({
      action_items: [
        {
          description: "  Call the invented supplier  ",
          completed: true,
          recording_timestamp: "later",
          recording_playback_url: " ",
          assignee: { name: " ", email: " Owner@Client.Example ", team: "" },
        },
        null,
        "a line",
        5,
        [],
        { description: null, completed: "yes", assignee: null },
      ],
    });
    const blank = { assigneeEmail: null, assigneeName: null, assigneeTeam: null, seconds: null, playbackUrl: null };
    expect(actionItems(m)).toEqual([
      { ...blank, description: "Call the invented supplier", assigneeEmail: "owner@client.example", completed: true },
      { ...blank, description: "", completed: false },
    ]);
  });

  test("no list, no items", () => {
    for (const list of [null, undefined, {}, "items"]) expect(actionItems(meeting({ action_items: list }))).toEqual([]);
    expect(actionItems({})).toEqual([]);
  });
});

describe("transcriptText, moved from sources.ts with the same output", () => {
  test("the same text as release 2cacdca5 wrote", () => {
    const cases: unknown[] = [
      LINES,
      [{ text: "No speaker and no time." }],
      [{ speaker: {}, timestamp: 12, text: 5 }],
      [{ speaker: { display_name: "" }, timestamp: "", text: "" }],
      [{ speaker: { display_name: null }, timestamp: null, text: null }],
      [{ speaker: { display_name: "Zoë Tester" }, timestamp: "01:00:00", text: "Accents and a line\nbreak stay." }],
      ["a string line", 42],
    ];
    for (const lines of cases) expect(transcriptText(lines)).toBe(transcriptTextBefore(lines));
    expect(transcriptText(LINES)).toBe(
      "[00:00:04] Test CSM: An invented first line.\n[00:00:09] Client Contact: An invented reply.\n[00:36:02] Test CSM: An invented last line.",
    );
  });

  test("nothing to write gives undefined, as before", () => {
    for (const lines of [[], null, undefined, "text", {}, { transcript: LINES }]) {
      expect(transcriptText(lines)).toBeUndefined();
      expect(transcriptTextBefore(lines)).toBeUndefined();
    }
  });

  test("an empty entry reads as an empty line, where the old code threw", () => {
    expect(() => transcriptTextBefore([null])).toThrow();
    expect(transcriptText([null, LINES[0]])).toBe("[] Speaker: \n[00:00:04] Test CSM: An invented first line.");
  });
});

describe("speakers", () => {
  test("each display name once, in order of first speech", () => {
    expect(speakers(LINES)).toEqual(["Test CSM", "Client Contact"]);
  });

  test("spaces collapse, another spelling of a name is the same name, and blanks are skipped", () => {
    expect(
      speakers([
        { speaker: { display_name: "  Client   Contact " } },
        { speaker: { display_name: "client contact" } },
        { speaker: { display_name: "" } },
        { speaker: { display_name: 7 } },
        { speaker: null },
        null,
        "a line",
        { speaker: { display_name: "Second Tester" } },
      ]),
    ).toEqual(["Client Contact", "Second Tester"]);
  });

  test("no lines, no speakers", () => {
    for (const lines of [[], null, undefined, "text", {}]) expect(speakers(lines)).toEqual([]);
  });
});

test("fathomRules.ts imports only ./callMatch.ts, with its .ts extension (an Edge Function bundles it)", () => {
  const src = readFileSync(new URL("./fathomRules.ts", import.meta.url), "utf8");
  const specs = [
    ...src.matchAll(/^\s*(?:import|export)\b[^'"]*?\bfrom\s*['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]|\brequire\s*\(\s*['"]([^'"]+)['"]/gm),
  ].map(m => m[1] ?? m[2] ?? m[3]);
  expect(specs).toEqual(["./callMatch.ts"]);
});
