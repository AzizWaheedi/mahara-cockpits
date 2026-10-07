// Milestone 1, video-link round 4 (again), NUMBERS AND RECORDS: the Team
// page's video rooms card (lib/roomsHealth.ts) reads the room host check's
// own row.
//
// bun test src/lib/m1_numbers_r4b_health.test.ts   (from apps/sales-cockpit)
//
// The host check (desk.py rooms --check-hosts, every 10 minutes) writes ok
// false whenever it ran and found something not ready: a Zoom participant
// report it could not read, or Google not answering (desk/rooms.py
// check_hosts: ok = zoom keys and google_ok is True and the report check).
// Its sentence says what it found. The Team page reads every ok false as the
// job having failed and, unless the sentence carries its own next step,
// sends the manager to the cron line ("Hermes checks the room-hosts cron
// line on the VPS"), the step for a check that is not running. A test that
// fails here is a finding; tests named "control" pass.
import { describe, expect, mock, test } from "bun:test";
import type { JobRow } from "./roomsHealth";

mock.module("./supabase", () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: null } }) } },
  SUPABASE_URL: "https://example.invalid",
  PROPOSALS_BUCKET: "sales-proposals",
}));
const { roomJobLines } = await import("./roomsHealth");

const NOW = Date.parse("2026-10-05T08:00:00Z");
const ago = (s: number) => new Date(NOW - s * 1000).toISOString();

/** desk/rooms.py check_hosts' sentence: Google and every seat ready, one Zoom report unread. */
const REPORT_UNREAD =
  "Google: signed in with GOOGLE_CAL_*; the calendar in SALES_ROOMS_CALENDAR_ID answers. closer (closer): Zoom licensed, so Zoom rooms have no time limit. Default room: Zoom. Zoom participant reports: 1 report could not be read (Zoom answered 400: Only available for paid account); it is tried again in ten minutes.";
/** The same check when Google's Calendar did not answer this time (the last known state stays). */
const GOOGLE_SLOW =
  "Google: Calendar did not answer (timed out); the last known state stays. closer (closer): Zoom licensed, so Zoom rooms have no time limit. Default room: Zoom. Zoom participant reports: no Zoom room ended in the last day.";

const rows = (hosts: Partial<JobRow>): JobRow[] => [
  {
    worker: "sales-desk",
    job: "rooms",
    ok: true,
    detail: "Working.",
    at: ago(10),
  },
  {
    worker: "sales-desk",
    job: "room-hosts",
    ok: true,
    detail: "2 seats checked.",
    at: ago(60),
    ...hosts,
  },
  { worker: "sales-api", job: "sweep", ok: true, detail: "", at: ago(30) },
  {
    worker: "sales-api",
    job: "watchdog",
    ok: true,
    detail: "0 open alerts.",
    at: ago(120),
  },
];
const hostLine = (r: JobRow[]) =>
  roomJobLines(r, NOW, true).find(l => l.key === "sales-desk:room-hosts")!;

describe("the host check's line on the Team page", () => {
  test("control: a host check that stopped an hour ago is red and points to its cron line", () => {
    const l = hostLine(rows({ at: ago(3600) }));
    expect(l.tone).toBe("bad");
    expect(l.text).toContain("cron line");
  });

  test("a host check that ran a minute ago and could not read one Zoom report is not sent to its cron line", () => {
    const l = hostLine(rows({ ok: false, detail: REPORT_UNREAD }));
    expect({ cron_line: l.text.includes("cron line") }).toEqual({
      cron_line: false,
    });
  });

  test("a host check that ran a minute ago while Google's Calendar was slow is not sent to its cron line", () => {
    const l = hostLine(rows({ ok: false, detail: GOOGLE_SLOW }));
    expect({ cron_line: l.text.includes("cron line") }).toEqual({
      cron_line: false,
    });
  });
});
