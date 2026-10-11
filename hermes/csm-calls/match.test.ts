import { describe, expect, test } from "bun:test";
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
  type Client,
  type Change,
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
