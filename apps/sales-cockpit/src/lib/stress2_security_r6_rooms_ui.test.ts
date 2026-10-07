// bun test src/lib/stress2_security_r6_rooms_ui.test.ts  (from apps/sales-cockpit)
//
// Second series, round 6 (5 October 2026), angle: security and abuse, the
// panel's side of a standby room's code opened before it had a lead.
//
// The door records any open of a standby room's code as "The lead opened
// the link" (sales-live stress2_security_r6_door.test.ts), and the Take that
// adopts that row keeps the open columns (supabase/migrations/tests/
// stress2_security_r6.py). Here: what the closer is then told about the
// handed-over lead. A failing test is a finding.

import { describe, expect, mock, test } from "bun:test";

mock.module("./api", () => ({
  api: async () => ({}),
}));

const R = await import("./rooms");

/** 10:05 Kuwait: the closer took the lead live; their Meet standby room was adopted. */
const NOW = Date.parse("2026-10-11T07:05:30Z");
const at = (min: number) => new Date(NOW + min * 60_000).toISOString();

const adopted = (over: Record<string, unknown>) =>
  R.normalizeRoom({
    id: "00000000-0000-4000-8000-0000000006a6",
    code: "S6Q2MX",
    contact_id: "stress-r6-lead",
    contact_first_name: "Huda",
    purpose: "handover",
    call_kind: "demo",
    provider: "meet",
    host_email: "stress-r6-closer@stress.invalid",
    state: "host_in",
    version: 6,
    join_url: "https://meet.google.com/abc-defg-hij",
    link_channels: ["whatsapp_text"],
    // The lead's link went at 10:05:10, when the Take adopted the room.
    link_sent_at: at(-0.33),
    opened_at: at(-15),
    host_in_at: at(-14),
    host_by: at(60),
    lead_by: at(10),
    ends_at: at(55),
    created_at: at(-15),
    handover_id: "00000000-0000-4000-8000-0000000006b6",
    ...over,
  });

describe("stress2 security r6: a handed-over lead's room that was a standby room opened at 09:58", () => {
  test("control: with no open recorded, the closer is told to wait for the lead (the fixture works)", () => {
    const room = adopted({
      first_open_at: null,
      last_open_at: null,
      open_device: null,
    })!;
    const line = R.sentenceText(R.roomSentence(room, { now: NOW }));
    expect(line).not.toContain("opened the link");
  });

  test(
    "standby-open-carried-into-handover: the standby room's code was opened at 09:58 (the closer's own tap, or anyone who guessed it), " +
      "seven minutes before Huda was handed over and her link sent at 10:05; the panel tells the closer 'Huda opened the link at 09:58. " +
      "Let them in, then press The lead is in.' and the Opened step shows 09:58",
    () => {
      const room = adopted({
        first_open_at: at(-7.5),
        last_open_at: at(-7.5),
        open_device: "phone",
      })!;
      const line = R.sentenceText(R.roomSentence(room, { now: NOW }));
      const opened = R.roomSteps(room).find(s => s.key === "opened");
      // Nothing from Huda yet: her link went a moment ago.
      expect({
        says_opened: /opened the link/.test(line),
        opened_step_done: Boolean(opened?.done),
      }).toEqual({
        says_opened: false,
        opened_step_done: false,
      });
    },
  );
});
