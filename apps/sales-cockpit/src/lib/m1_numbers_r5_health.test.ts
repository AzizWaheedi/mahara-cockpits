// Milestone 1, video-link round 5, NUMBERS AND RECORDS: the Team page's
// video rooms card (lib/roomsHealth.ts) reads the SQL watchdog's own row.
//
// bun test src/lib/m1_numbers_r5_health.test.ts   (from apps/sales-cockpit)
//
// The watchdog (cockpit_sales_watchdog, 20261004a) posts the live-calls
// alerts to #sales-alerts. With no sales_alerts_slack_webhook in the vault it
// records them and posts nothing, and its own row stays ok true: "2 open
// alerts, 0 new, 0 posted. Recorded only: the vault has no
// sales_alerts_slack_webhook." That is production's row today (read
// 2026-10-06 19:35 Kuwait). The guardian fails its live-alerts check for it
// ("open alert(s) that did not reach Slack"), and the watchdog turns its row
// red when Slack refuses the webhook. The Team page shows the same
// non-delivery as a green "working" line, and the card's head stays green:
// the one screen a manager reads says the alerts work while they reach
// nobody. A test that fails here is a finding; tests named "control" pass.
import { describe, expect, mock, test } from "bun:test";
import type { JobRow } from "./roomsHealth";

mock.module("./supabase", () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: null } }) } },
  SUPABASE_URL: "https://example.invalid",
  PROPOSALS_BUCKET: "sales-proposals",
}));
const { roomJobLines, roomsSummary } = await import("./roomsHealth");

const NOW = Date.parse("2026-10-06T16:36:00Z"); // 19:36 Kuwait, a Tuesday, working hours
const ago = (s: number) => new Date(NOW - s * 1000).toISOString();

/** The watchdog's row as production wrote it on 2026-10-06 at 19:35 Kuwait. */
const RECORDED_ONLY =
  "2 open alerts, 0 new, 0 posted. Recorded only: the vault has no sales_alerts_slack_webhook.";
/** The watchdog's row when Slack refused the webhook (20261004a): ok false. */
const SLACK_REFUSED =
  "Slack refused the #sales-alerts webhook (it answered 404 to 2 alerts), so alerts are not reaching the channel. Put a working incoming webhook for #sales-alerts in the vault as sales_alerts_slack_webhook. 2 open alerts.";

const rows = (watchdog: Partial<JobRow>): JobRow[] => [
  {
    worker: "sales-desk",
    job: "rooms",
    ok: true,
    detail: "Working. No rooms were asked for in the last 60 seconds.",
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
    worker: "sales-api",
    job: "sweep",
    ok: true,
    detail:
      "0 rooms closed, 0 handovers moved, 0 events sent back to room.event, 0 rooms to settle, 0 rooms to re-check.",
    at: ago(30),
  },
  {
    worker: "sales-api",
    job: "watchdog",
    ok: true,
    detail: "0 open alerts, 0 new, 0 posted.",
    at: ago(60),
    ...watchdog,
  },
];
const health = {
  worker_ok: true,
  last_run_at: ago(10),
  rooms_today: 0,
  failed_today: 0,
  line: "Rooms: working. Last run 19:35:50. 0 rooms today, 0 failed.",
};
const watchdogLine = (r: JobRow[]) =>
  roomJobLines(r, NOW, true).find(l => l.key === "sales-api:watchdog");

describe("the Team page's alert watchdog line reads whether alerts reach anyone", () => {
  test("control: a watchdog whose posts Slack refuses is red, and the card's head says a job needs attention", () => {
    const r = rows({ ok: false, detail: SLACK_REFUSED });
    expect(watchdogLine(r)?.tone).toBe("bad");
    expect(roomsSummary(health as never, roomJobLines(r, NOW, true)).tone).toBe(
      "bad",
    );
  });

  test("a watchdog with no webhook at all (recorded only, nothing posted): never a green working line under a green head", () => {
    const r = rows({ ok: true, detail: RECORDED_ONLY });
    const line = watchdogLine(r);
    expect({
      tone: line?.tone,
      head: roomsSummary(health as never, roomJobLines(r, NOW, true)).tone,
    }).toEqual({
      tone: expect.not.stringMatching(/^good$/),
      head: expect.not.stringMatching(/^good$/),
    });
  });
});
