// Stress series 2, round 3: a manager's wave journey end to end, through
// sales-api's followup.wave on the fakes (followupAgent.ts) and the
// Follow-ups page's own lines (apps/sales-cockpit/src/lib/waves.ts
// waveLine, as WavesCard draws it with the waves job's status row).
//
// bun test supabase/functions/sales-api/stress2_journeys_r3_waves.test.ts
//
// Each test's last expectations are what should hold; a failing one is a
// finding, and its comment says what the manager reads instead.

import { describe, expect, test } from "bun:test";
import { countMembers, countsFor, readWave, waveLine } from "../../../apps/sales-cockpit/src/lib/waves.ts";
import { makeFollowupAgent } from "./followupAgent.ts";
import type { Who } from "./lib.ts";
import { fakeWorld } from "./testfakes.ts";

type Row = Record<string, unknown>;

const boss: Who = { signed_in: true, seat: true, manager: true, email: "boss@stress.invalid" };
const GATE = { connector_off: true, single_copy_ok_at: "2026-10-01T00:00:00Z" };
// Sunday 2026-10-04, 08:00 UTC: 11:00 in Kuwait, inside the first hours.
const SUN_11 = Date.parse("2026-10-04T08:00:00Z");

function setup() {
  const w = fakeWorld(SUN_11);
  w.db.seed("cockpit_sales_settings", [
    { key: "whatsapp_guard", value: GATE },
    { key: "followups", value: { enabled: true, waves: { per_day: 40, batch_gap_s: 45 }, first_hours: [9, 18], stop_pause_days: 30 } },
    { key: "messaging", value: { whatsapp: true } },
  ]);
  const agent = makeFollowupAgent({
    io: w.io,
    audit: async () => undefined,
    sendFollowup: async () => ({ followup: { status: "sent" }, message: { state: "sent" } }),
    whatsappHealth: async () => ({ paused: false, why: "" }),
  });
  return { ...w, agent };
}

describe("journey: a manager starts a wave while the desk's waves job is not running", () => {
  // WavesCard reads the (sales-desk, waves) status row and passes it to
  // waveLine as `desk`: { missing: true } when there is no row, { ok, at }
  // when there is one. The job writes it every 5 minutes; a row older than
  // 15 minutes, or none, means the job is not running (waves.ts
  // WAVES_STALE_MS), and nothing enrols the pool.
  for (const [what, desk] of [
    ["no waves row at all (the cron line was never installed)", { missing: true }],
    ["a waves row last written two hours ago (the VPS cron stopped)", { ok: true, detail: "No wave is running", at: new Date(SUN_11 - 2 * 3_600_000).toISOString() }],
    ["a waves row that could not be read", { unread: true }],
  ] as const) {
    test(`${what}: the new wave's line must not promise the desk adds its leads within 5 minutes`, async () => {
      const w = setup();
      const started = await w.agent.actions["followup.wave"]!(boss, { op: "start", pool: "never_booked" });
      const wave = readWave(started.wave);
      expect(wave?.state).toBe("running");
      // WavesCard: the press's own line, then the wave's line under it.
      const said = `Started. The desk adds the ${"leads never booked"} within 5 minutes.`;
      const now = w.clock.now + 30 * 60_000;
      const line = waveLine(wave!, countsFor(countMembers([]), String(wave!.id)), { at: now, now }, desk as never);
      // Half an hour on, with no job to enrol the pool, the card still reads
      // "Leads never booked, 40 a day, newest first. The desk adds the pool's
      // leads within 5 minutes; nothing is counted before then." The same
      // card says "The wave run has not reported yet, so no batch is being
      // written" once a wave has members (waves.ts waveLine), but the
      // unenrolled branch returns before the desk is read.
      expect(said).toMatch(/within 5 minutes/);
      expect(line).not.toMatch(/within 5 minutes/);
    });
  }
});
