// Milestone 1, video-link round 4, NUMBERS AND RECORDS: the Team page's
// video rooms card (lib/roomsHealth.ts) reads the room worker's own row the
// way sales-api's health line and the SQL watchdog read it since round 3.
//
// bun test src/lib/m1_numbers_r4_health.test.ts   (from apps/sales-cockpit)
//
// desk/rooms.py sentence() writes ok false for a run that made rooms and
// rode out a passing fault (one database blip, a refused room message).
// sales-api's line says the problem with "If a room fails, use the other
// provider" (roomsHealth troubled, worker_trouble) and the watchdog says
// "Some rooms or links may fail; read the detail" (m1 round 3). The Team
// page's job line must not call that worker failed, nor point a manager to
// the runbook row "Video rooms are not being made". A test that fails here
// is a finding; tests named "control" pass.
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

/** desk/rooms.py sentence() for a run that made three rooms and rode out one database blip. */
const DB_BLIP =
  "Working. In the last 60 seconds: 3 rooms made (0 Zoom, 3 Meet), 0 failed, 0 closed. The database did not answer 1 time; the worker kept trying.";
/** desk/rooms.py sentence() for a worker that runs and makes no rooms. */
const NOT_MAKING =
  "Not making rooms: The rooms setting could not be read, so no new room is made until it can be. Working. No rooms were asked for in the last 60 seconds.";

const rows = (rooms: Partial<JobRow>): JobRow[] => [
  {
    worker: "sales-desk",
    job: "rooms",
    ok: true,
    detail: "Working.",
    at: ago(10),
    ...rooms,
  },
  {
    worker: "sales-desk",
    job: "room-hosts",
    ok: true,
    detail: "2 seats checked.",
    at: ago(240),
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

const workerLine = (r: JobRow[]) =>
  roomJobLines(r, NOW, true).find(l => l.key === "sales-desk:rooms")!;

describe("the room worker's line on the Team page", () => {
  test("control: a worker that makes no rooms is red and points to the runbook row", () => {
    const l = workerLine(rows({ ok: false, detail: NOT_MAKING }));
    expect(l.tone).toBe("bad");
    expect(l.text).toContain("Video rooms are not being made");
  });

  test("a worker that made 3 rooms and rode out one database blip is not said to have failed, nor sent to 'Video rooms are not being made'", () => {
    const l = workerLine(rows({ ok: false, detail: DB_BLIP }));
    expect({
      failed: /\bfailed at\b/.test(l.text),
      runbook_not_made: l.text.includes("Video rooms are not being made"),
    }).toEqual({
      failed: false,
      runbook_not_made: false,
    });
  });
});
