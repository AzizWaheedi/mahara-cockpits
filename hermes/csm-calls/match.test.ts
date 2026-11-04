import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  matchAppointment,
  matchMeeting,
  nextAndLast,
  changesForClient,
  emailIndex,
  appointmentStatus,
  nearestCheckin,
  isPersonChange,
  formAnswers,
  recordingIn,
  checkinClient,
  CHECKIN_TASK_REF,
  type Appt,
  type Client,
  type Change,
  type Row,
  STOPPED_STAGE,
} from "./match";

const clients: Client[] = [
  { taskId: "86ewvnqh5", name: "Inverse group", aliases: [] },
  { taskId: "86eyt1d33", name: "City Wood", aliases: ["citywood"] },
  { taskId: "z8xmdvgf5g", name: "Arcturus Construction", aliases: ["arcturus"] },
];
const now = Date.parse("2026-10-11T12:00:00Z");

describe("appointments", () => {
  test("the Client ID field beats a name in the title", () => {
    const m = matchAppointment({ title: "City Wood - Check In" }, { clientId: "86ewvnqh5" }, clients, new Map());
    expect(m).toMatchObject({ taskId: "86ewvnqh5", method: "client_id_field" });
  });
  test("email next, then the name rule", () => {
    const m = matchAppointment({ title: "x" }, { email: "a@b.com" }, clients, new Map([["a@b.com", "86eyt1d33"]]));
    expect(m.method).toBe("invitee_email");
    expect(matchAppointment({ title: "City Wood - Check In" }, {}, clients, new Map()).method).toBe("name");
  });
  test("an unknown Client ID is named in the reason", () => {
    expect(matchAppointment({ title: "Test" }, { clientId: "nope" }, clients, new Map()).reason).toContain("nope");
  });
  test("GoHighLevel statuses", () => {
    expect(appointmentStatus("confirmed")).toBe("confirmed");
    expect(appointmentStatus("noshow")).toBe("no_show");
    expect(appointmentStatus("invalid")).toBe("cancelled");
    expect(appointmentStatus("new")).toBe("booked");
  });
});

describe("fathom", () => {
  const appts = [{ id: 7, taskId: "86eyt1d33", startsAt: Date.parse("2026-10-11T10:00:00Z"), emails: ["owner@citywood.com"] }];
  const index = emailIndex([{ email: "owner@citywood.com", clientId: "86eyt1d33" }], new Set(clients.map(c => c.taskId)));
  test("an invitee email at the booked time joins the appointment", () => {
    const m = matchMeeting(
      { recording_start_time: "2026-10-11T10:12:00Z", title: "Zoom", calendar_invitees: [{ is_external: true, email: "owner@citywood.com" }] },
      appts, clients, index,
    );
    expect(m).toMatchObject({ taskId: "86eyt1d33", method: "appointment_time", apptId: 7 });
  });
  test("outside 30 minutes it falls back to the email", () => {
    const m = matchMeeting(
      { recording_start_time: "2026-10-11T13:00:00Z", calendar_invitees: [{ is_external: true, email: "owner@citywood.com" }] },
      appts, clients, index,
    );
    expect(m.method).toBe("invitee_email");
  });
  test("an unmatched meeting matches later once its appointment exists", () => {
    const meeting = { recording_start_time: "2026-10-11T10:05:00Z", title: "Zoom", calendar_invitees: [{ is_external: true, email: "new@x.io" }] };
    expect(matchMeeting(meeting, [], clients, index).taskId).toBeUndefined();
    const later = [{ id: 9, taskId: "86ewvnqh5", startsAt: Date.parse("2026-10-11T10:00:00Z"), emails: ["new@x.io"] }];
    expect(matchMeeting(meeting, later, clients, index).taskId).toBe("86ewvnqh5");
  });
  test("internal meetings are not client calls", () => {
    expect(matchMeeting({ title: "Team sync", calendar_invitees: [{ is_external: false }] }, [], clients, index).reason).toBe("Internal meeting");
  });
});

// docs/forms/STAGE2-CONTRACT.md 4.1: rooms are reused on other days, so a room
// proves the call only within 90 minutes of one client's booking. Rooms are invented.
describe("fathom: the same room first, bounded", () => {
  const MIN = 60_000;
  /** Kuwait wall time on a 2026 day. */
  const t = (hhmm: string, day = "10-11") => Date.parse(`2026-${day}T${hhmm}:00+03:00`);
  const ROOM = "zoom:12345678901";
  const LINK = "https://us05web.zoom.us/j/12345678901?pwd=TEST";
  const OWNER = "owner@citywood.example";
  const [inverse, cityWood] = clients.map(c => c.taskId);
  const noIndex = { emails: new Map<string, string>(), domain: new Map<string, string>() };
  const appt = (id: number, taskId: string | null, at: number, room: string | null, emails: string[] = []): Appt => ({
    id,
    taskId,
    startsAt: at,
    emails,
    room,
  });
  /** A recording in a room with only the CSM on the calendar invite, unless the extra says otherwise. */
  const meeting = (at: number, url: string | null, extra: Row = {}): Row => ({
    recording_start_time: new Date(at).toISOString(),
    title: "Impromptu Zoom Meeting",
    meeting_title: "Impromptu Zoom Meeting",
    meeting_url: url,
    calendar_invitees: [{ is_external: false, email: "csm@maharamedia.com" }],
    ...extra,
  });
  const invited = (at: number, url: string | null) => meeting(at, url, { calendar_invitees: [{ is_external: true, email: OWNER }] });

  test("a recording in a booking's room joins that booking: 16 minutes apart as the live pairs are, and up to 90", () => {
    const appts = [appt(41, cityWood, t("10:00"), ROOM)];
    for (const gap of [-90, -16, 0, 16, 45, 90])
      expect(matchMeeting(meeting(t("10:00") + gap * MIN, LINK), appts, clients, noIndex)).toEqual({
        taskId: cityWood,
        method: "same_room",
        confidence: 1,
        apptId: 41,
      });
    for (const gap of [-91, 91]) expect(matchMeeting(meeting(t("10:00") + gap * MIN, LINK), appts, clients, noIndex).taskId).toBeUndefined();
  });

  test("a booking room reused by another client's recording 3 days later is not same_room", () => {
    const appts = [appt(41, cityWood, t("10:00"), ROOM)];
    const later = meeting(t("10:05", "10-14"), LINK, { calendar_invitees: [{ is_external: true, email: "owner@inverse.example" }] });
    const byEmail = emailIndex([{ email: "owner@inverse.example", clientId: inverse }], new Set(clients.map(c => c.taskId)));
    expect(matchMeeting(later, appts, clients, byEmail)).toMatchObject({ taskId: inverse, method: "invitee_email" });
    const unmatched = matchMeeting(later, appts, clients, noIndex);
    expect(unmatched.taskId).toBeUndefined();
    expect(unmatched.reason).toBe("No booked call at this time, no known invitee email, no client name in the title");
  });

  test("one room on two clients' bookings within 90 minutes is not same_room for either, and the chain goes on", () => {
    const appts = [appt(41, cityWood, t("10:00"), ROOM, [OWNER]), appt(42, inverse, t("11:00"), ROOM)];
    for (const at of [t("10:20"), t("10:50"), t("11:10")]) {
      const m = matchMeeting(meeting(at, LINK), appts, clients, noIndex);
      expect(m.taskId).toBeUndefined();
      expect(m.method).toBeUndefined();
    }
    expect(matchMeeting(invited(t("10:20"), LINK), appts, clients, noIndex)).toMatchObject({
      taskId: cityWood,
      method: "appointment_time",
      apptId: 41,
    });
    // Another client's booking in that room more than 90 minutes away proves nothing either way.
    const apart = [appt(41, cityWood, t("10:00"), ROOM), appt(42, inverse, t("12:00"), ROOM)];
    expect(matchMeeting(meeting(t("10:20"), LINK), apart, clients, noIndex)).toMatchObject({ taskId: cityWood, method: "same_room", apptId: 41 });
  });

  test("a booking in the room with no client inside the window makes the room no proof", () => {
    const appts = [appt(40, null, t("10:00"), ROOM), appt(41, cityWood, t("10:30"), ROOM)];
    expect(matchMeeting(meeting(t("10:20"), LINK), appts, clients, noIndex).taskId).toBeUndefined();
    expect(matchMeeting(meeting(t("10:05"), LINK), [appts[0]], clients, noIndex).taskId).toBeUndefined();
  });

  test("two of one client's bookings in the room: the closest one", () => {
    const appts = [appt(41, cityWood, t("10:00"), ROOM), appt(43, cityWood, t("11:00"), ROOM)];
    expect(matchMeeting(meeting(t("10:40"), LINK), appts, clients, noIndex)).toMatchObject({ method: "same_room", apptId: 43 });
    expect(matchMeeting(meeting(t("10:20"), LINK), appts, clients, noIndex)).toMatchObject({ method: "same_room", apptId: 41 });
    expect(matchMeeting(meeting(t("10:30"), LINK), appts, clients, noIndex)).toMatchObject({ method: "same_room", apptId: 41 });
  });

  test("the same room beats the invitee's booked time", () => {
    // The 10:00 call ran late in its own room; the 11:00 booking has the closer time and the same invitee.
    const appts = [appt(41, cityWood, t("10:00"), ROOM, [OWNER]), appt(43, cityWood, t("11:00"), "meet:abc-defg-hij", [OWNER])];
    expect(matchMeeting(invited(t("10:50"), LINK), appts, clients, noIndex)).toMatchObject({ method: "same_room", apptId: 41 });
    expect(matchMeeting(invited(t("10:50"), null), appts, clients, noIndex)).toMatchObject({ method: "appointment_time", apptId: 43 });
  });

  test("rooms compare as normalised rooms; a link with no room leaves the chain as it was", () => {
    const appts = [appt(41, cityWood, t("10:00"), "meet:abc-defg-hij", [OWNER]), appt(44, inverse, t("13:00"), ROOM)];
    expect(matchMeeting(meeting(t("10:03"), "https://meet.google.com/abc-defg-hij?authuser=0"), appts, clients, noIndex)).toMatchObject({
      taskId: cityWood,
      method: "same_room",
      apptId: 41,
    });
    expect(matchMeeting(meeting(t("13:02"), "https://us06web.zoom.us/j/12345678901?pwd=TEST"), appts, clients, noIndex)).toMatchObject({
      taskId: inverse,
      method: "same_room",
      apptId: 44,
    });
    const teams = "https://teams.microsoft.com/l/meetup-join/19%3ameeting_TEST%40thread.v2/0";
    expect(matchMeeting(invited(t("10:03"), teams), appts, clients, noIndex)).toMatchObject({ method: "appointment_time", apptId: 41 });
    expect(matchMeeting(meeting(t("10:03"), teams), appts, clients, noIndex).taskId).toBeUndefined();
  });

  test("an unmatched recording in a room matches on a later run once its booking exists", () => {
    const m = meeting(t("10:05"), LINK);
    expect(matchMeeting(m, [], clients, noIndex).taskId).toBeUndefined();
    expect(matchMeeting(m, [appt(41, cityWood, t("10:00"), ROOM)], clients, noIndex)).toMatchObject({ taskId: cityWood, method: "same_room" });
  });
});

test("match.ts imports only ./callMatch.ts, with its .ts extension (an Edge Function bundles it)", () => {
  const src = readFileSync(new URL("./match.ts", import.meta.url), "utf8");
  const specs = [
    ...src.matchAll(/^\s*(?:import|export)\b[^'"]*?\bfrom\s*['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]|\brequire\s*\(\s*['"]([^'"]+)['"]/gm),
  ].map(m => m[1] ?? m[2] ?? m[3]);
  expect(specs).toEqual(["./callMatch.ts"]);
});

describe("next and last call", () => {
  const h = 3_600_000;
  test("confirmed counts as shown once its time has passed", () => {
    const r = nextAndLast([{ kind: "checkin", status: "confirmed", startsAt: now - 48 * h, endsAt: now - 47 * h, source: "ghl_appointment" }], [], undefined, now);
    expect(r.lastCall).toBe(now - 48 * h);
  });
  test("a gone or cancelled appointment is never the next call", () => {
    const r = nextAndLast(
      [
        { kind: "launch", status: "gone", startsAt: now + h, source: "ghl_appointment" },
        { kind: "checkin", status: "cancelled", startsAt: now + 2 * h, source: "ghl_appointment" },
        { kind: "checkin", status: "booked", startsAt: now + 3 * h, source: "ghl_appointment" },
      ],
      [], undefined, now,
    );
    expect(r.nextCallAt).toBe(now + 3 * h);
  });
  test("a newer form or ClickUp date wins the last call", () => {
    const r = nextAndLast([], [now - 5 * h], "2026-10-01", now);
    expect(r.lastCallSource).toBe("checkin_form");
  });
});

describe("changes", () => {
  const all: Change[] = [
    { key: "a", subject: "Acturus Construction", action: "Paused ad set", kind: "x", source: "decision", at: now - 86_400_000 },
    { key: "b", subject: "CW-MAHARA-1", action: "Budget to $40", kind: "x", source: "legacy_manual", at: now - 2 * 86_400_000 },
    { key: "c", subject: "CW-MAHARA-1", action: "Asked Aziz?", kind: "x", source: "decision", at: now },
    { key: "d", subject: "x", action: "Old", kind: "x", source: "decision", at: now - 100 * 86_400_000 },
  ];
  test("aliases with one-letter tolerance, newest first, a day on every item", () => {
    const r = changesForClient(all, clients[2], [], now);
    expect(r.map(c => c.key)).toEqual(["a"]);
    expect(r[0].day).toBe("2026-10-10");
  });
  test("campaign names place changes; questions and old items are dropped", () => {
    const r = changesForClient(all, clients[1], ["CW-MAHARA-1"], now);
    expect(r.map(c => c.key)).toEqual(["b"]);
    expect(r.every(c => /^\d{4}-\d{2}-\d{2}$/.test(c.day))).toBe(true);
  });
  test("Meta's own delivery and billing events are not changes", () => {
    expect(isPersonChange({ actor_name: "Meta", event_type: "update_ad_run_status" })).toBe(false);
    expect(isPersonChange({ actor_name: "Saleh", event_type: "ad_account_billing_charge" })).toBe(false);
    expect(isPersonChange({ actor_name: "Saleh", event_type: "update_campaign_budget" })).toBe(true);
  });
});

describe("forms", () => {
  test("answers keep refs that left the definition, and recordings are found anywhere", () => {
    const a = formAnswers({ answers: [{ type: "url", url: "https://fathom.video/share/abc", field: { ref: "gone-ref", type: "website" } }] }, new Map());
    expect(a[0]).toMatchObject({ ref: "gone-ref", title: null, value: "https://fathom.video/share/abc" });
    expect(recordingIn(a)).toBe("https://fathom.video/share/abc");
  });
  test("a form links to the client's check-in within 48 hours only", () => {
    const calls = [{ id: 1, taskId: "t", kind: "checkin", startsAt: now - 20 * 3_600_000, status: "confirmed" }];
    expect(nearestCheckin("t", now, calls)).toBe(1);
    expect(nearestCheckin("t", now + 40 * 3_600_000, calls)).toBeUndefined();
    expect(nearestCheckin("other", now, calls)).toBeUndefined();
  });
});

describe("1-1 check-in form", () => {
  const valid = new Set(clients.map(c => c.taskId));
  const form = (hidden: Record<string, string> | undefined, typed?: string) => ({
    ...(hidden ? { hidden } : {}),
    answers: typed === undefined ? [] : [{ type: "text", text: typed, field: { ref: CHECKIN_TASK_REF, type: "short_text" } }],
  });
  test("the link's hidden task_id beats a different typed id, and the difference is flagged", () => {
    expect(checkinClient(form({ task_id: "86eyt1d33" }, "86ewvnqh5"), valid)).toMatchObject({
      taskId: "86eyt1d33",
      by: "hidden_field",
      typed: "86ewvnqh5",
      disagree: true,
    });
    expect(checkinClient(form({ task_id: "86eyt1d33" }, "86eyt1d33"), valid)).toMatchObject({ by: "hidden_field", disagree: false });
  });
  test("a blank hidden task_id falls back to the typed id", () => {
    for (const hidden of [undefined, {}, { task_id: "" }, { task_id: "  " }])
      expect(checkinClient(form(hidden, " 86ewvnqh5 "), valid)).toMatchObject({
        taskId: "86ewvnqh5",
        by: "typed_task_id",
        typed: "86ewvnqh5",
        hidden: null,
        disagree: false,
      });
  });
  test("a hidden id that is not a client falls back to the typed id", () => {
    expect(checkinClient(form({ task_id: "not-a-card" }, "z8xmdvgf5g"), valid)).toMatchObject({
      taskId: "z8xmdvgf5g",
      by: "typed_task_id",
      hidden: "not-a-card",
      disagree: true,
    });
  });
  test("neither gives no client and says why", () => {
    expect(checkinClient(form(undefined), valid)).toMatchObject({
      taskId: null,
      by: null,
      reason: "Opened without the client's link and no Client ID typed",
    });
    expect(checkinClient(form({ task_id: "gone" }, "typo"), valid)).toMatchObject({ taskId: null, by: null });
    expect(checkinClient(form(undefined, "typo"), valid).reason).toBe('Typed client ID "typo" is not a client on the board');
  });
});

test("a stopped client card is known by its stage", () => {
  for (const stage of ["Stopped", "Churned", "Cancelled", "Paused"]) expect(STOPPED_STAGE.test(stage)).toBe(true);
  for (const stage of ["Active", "Brand Blueprint Booked♠️", "Ready For Launch🚀", "Onboarding"]) expect(STOPPED_STAGE.test(stage)).toBe(false);
});
