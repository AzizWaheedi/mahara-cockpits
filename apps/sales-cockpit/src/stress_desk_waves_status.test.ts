// bun test src/stress_desk_waves_status.test.ts (in apps/sales-cockpit)
//
// Stress round 2, the waves as a manager sees them (2026-10-03). The waves
// job writes one plain sentence every five minutes on its status row
// (cockpit_sales_worker_status, sales-desk/waves): the WA Connector gate is
// shut, the month's template budget is spent, the opener templates are not
// set up, an earlier batch waits for a person, three sends in a row were
// refused, sales-api did not answer. The Follow-ups page, where the batch is
// approved, never shows it: the card says "Today's batch is being written
// now." and "Approved" while nothing is written or sent. Read as source,
// because the page is a component; a failing test names the defect.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const followups = read("./pages/FollowupsPage.tsx");
const card = read("./components/WavesCard.tsx");
const team = read("./pages/TeamPage.tsx");
const wavesPy = read("../../../hermes/sales-desk/desk/waves.py");

describe("the waves job's own sentence reaches the page where batches are approved", () => {
  test("the Follow-ups page or the waves card shows sales-desk/waves (late, failing, or what it last did)", () => {
    const onPage = /job:\s*"waves"/.test(followups);
    const onCard =
      /useWorkerStatus|DeskStatus/.test(card) && /"waves"/.test(card);
    expect(onPage || onCard).toBe(true);
  });

  test("the Team page counts the waves job late when it stops (it runs every 5 minutes; the watchdog says 15)", () => {
    const limits = /const DESK_LIMITS_MIN[^}]*}/s.exec(team)?.[0] ?? "";
    expect(limits).toMatch(/\bwaves\s*:/);
  });

  test("the desk's two run leases are not listed as desk jobs on the Team page ('waves-send-lease ... 20,000 days ago')", () => {
    const leasesAreRows =
      /"waves-(draft|send)-lease"/.test(wavesPy) && /STATUS/.test(wavesPy);
    const hidden = /lease/.test(team);
    expect(!leasesAreRows || hidden).toBe(true);
  });
});

describe("the waves card says what holds the batch, never 'being written now' over a red row", () => {
  test("waveLine with the waves row failing says its sentence; with it ok, the batch is being written", async () => {
    const W = await import("./lib/waves");
    const c = W.countsFor(
      W.countMembers([
        ...Array(30).fill({ wave_id: "w1", arm: "wave", state: "waiting" }),
        ...Array(4).fill({ wave_id: "w1", arm: "holdout", state: "held_out" }),
      ]),
      "w1",
    );
    const now = Date.parse("2026-10-04T08:00:00.000Z");
    const wave = {
      id: "w1",
      pool: "no_show_cancelled",
      segment: "reactivate",
      per_day: 40,
      holdout_share: 0.1,
      state: "running",
      made_by: "boss@stress.invalid",
      started_at: new Date(now - 86_400_000).toISOString(),
      enrolled_at: new Date(now - 86_400_000).toISOString(),
      ended_at: null,
      done_reason: null,
      note: null,
      version: 1,
      created_at: new Date(now - 86_400_000).toISOString(),
    } as unknown as Parameters<typeof W.waveLine>[0];
    const shut = W.waveLine(
      wave,
      c,
      { at: now, now },
      {
        ok: false,
        detail: "1 wave running; WhatsApp sends wait for the single-copy test.",
      },
    );
    expect(shut).toContain(
      "The wave run is held: 1 wave running; WhatsApp sends wait for the single-copy test.",
    );
    expect(shut).not.toContain("being written now");
    expect(
      W.waveLine(wave, c, { at: now, now }, { ok: true, detail: "ok" }),
    ).toContain("Today's batch is being written now.");
  });
});
