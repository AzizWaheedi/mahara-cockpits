// Milestone 1, video-link round 1, NUMBERS AND RECORDS: the Team page's
// video rooms card (lib/roomsHealth.ts) reads the truth with the pilot's
// switches: rooms on, live.enabled and live.slack off (Slack fenced off, so
// SLACK_SIGNING_SECRET is not set on sales-live and the door answers 503).
//
// bun test src/lib/m1_numbers_r1_health.test.ts   (from apps/sales-cockpit)
//
// A part Milestone 1 switched off is never "a job that needs attention" and
// its fix line never asks a manager to set up Slack. A test that fails here
// is a finding; tests named "control" pass.
import { describe, expect, mock, test } from "bun:test";
import type { Health } from "./rooms";
import type { JobRow } from "./roomsHealth";

mock.module("./supabase", () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: null } }) } },
  SUPABASE_URL: "https://example.invalid",
  PROPOSALS_BUCKET: "sales-proposals",
}));
const { roomJobLines, roomsSummary } = await import("./roomsHealth");

const NOW = Date.parse("2026-10-05T08:00:00Z");
const ago = (s: number) => new Date(NOW - s * 1000).toISOString();

const WORKING: Health = {
  worker_ok: true,
  last_run_at: ago(10),
  rooms_today: 1,
  failed_today: 0,
  line: "Rooms: working. Last run 11:00:00. 1 room today, 0 failed.",
};

const PILOT_ROWS: JobRow[] = [
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
    at: ago(240),
  },
  {
    worker: "sales-live",
    job: "zoom",
    ok: true,
    detail: "Last Zoom event passed on.",
    at: ago(600),
  },
  {
    worker: "sales-live",
    job: "cron",
    ok: true,
    detail: "Last cron post passed on.",
    at: ago(60),
  },
  {
    worker: "sales-api",
    job: "sweep",
    ok: true,
    detail: "0 rooms closed.",
    at: ago(30),
  },
  {
    worker: "sales-api",
    job: "watchdog",
    ok: true,
    detail: "0 open alerts.",
    at: ago(120),
  },
];

// What the door writes when anyone POSTs /slack while SLACK_SIGNING_SECRET is not set.
const STRAY_SLACK: JobRow = {
  worker: "sales-live",
  job: "slack",
  ok: false,
  detail:
    "Slack requests cannot be checked yet: SLACK_SIGNING_SECRET is missing on sales-live. Add it to the function's secrets.",
  at: ago(30),
};

describe("the Team page's rooms card with the pilot's switches", () => {
  test("control: every Milestone 1 job working reads good", () => {
    const lines = roomJobLines(PILOT_ROWS, NOW, true);
    expect(roomsSummary(WORKING, lines).tone).toBe("good");
  });

  test("Slack switched off: a stray POST /slack never turns the card to 'a job needs attention'", () => {
    const lines = roomJobLines([...PILOT_ROWS, STRAY_SLACK], NOW, true);
    const s = roomsSummary(WORKING, lines);
    expect(`${s.tone}: ${s.sentence ?? ""}`).toBe("good: ");
  });

  test("Slack switched off: no line asks a manager to set SLACK_SIGNING_SECRET", () => {
    const lines = roomJobLines([...PILOT_ROWS, STRAY_SLACK], NOW, true);
    const slack = lines.find(l => l.key === "sales-live:slack");
    expect(slack?.tone).not.toBe("bad");
    expect(slack?.text ?? "").not.toMatch(/SLACK_SIGNING_SECRET/);
  });
});
