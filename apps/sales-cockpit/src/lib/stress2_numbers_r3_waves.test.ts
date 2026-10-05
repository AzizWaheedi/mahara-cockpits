/**
 * Second series, round 3, numbers and data integrity: the waves card's
 * effect line on a wave a manager stopped. Every lead and figure is invented.
 *
 *     bun test apps/sales-cockpit/src/lib/stress2_numbers_r3_waves.test.ts
 *
 * The desk's wind_down (waves.py) takes every member whose turn never came
 * out of a stopped wave, with no due_at: they are in neither arm's comparison
 * (measured() is false), and outcomes() never closes them, so they are never
 * "settled" (booked or closed). effectLine says "Leads still inside their 14
 * days can still book, so this moves" while any member of an arm is not
 * settled, counting the whole arm. A failure here is a finding.
 */
import { describe, expect, test } from "bun:test";
import { countMembers, effectLine, type MemberRow } from "./waves";

const DAY = 86_400_000;
const STOPPED = Date.parse("2026-09-10T06:00:00.000Z");
const iso = (t: number) => new Date(t).toISOString();

/** A wave of 200 a manager stopped on its third day, read 25 days later, as the desk leaves it. */
function stoppedWave(): MemberRow[] {
  const rows: MemberRow[] = [];
  const turn = iso(STOPPED - 2 * DAY);
  // 80 wave members had their turn: 72 sent and closed 14 days on, 8 booked.
  for (let i = 0; i < 80; i++)
    rows.push({
      wave_id: "w-stopped",
      arm: "wave",
      state: i < 8 ? "booked" : "closed",
      due_at: turn,
      sent_at: turn,
    });
  // 100 wave members whose turn never came: wind_down took them out, no due_at.
  for (let i = 0; i < 100; i++)
    rows.push({
      wave_id: "w-stopped",
      arm: "wave",
      state: "excluded",
      due_at: null,
      sent_at: null,
    });
  // 10 held back level with the turns: 14 days run, 1 booked.
  for (let i = 0; i < 10; i++)
    rows.push({
      wave_id: "w-stopped",
      arm: "holdout",
      state: i < 1 ? "booked" : "closed",
      due_at: turn,
      sent_at: null,
    });
  // 10 held back whose turn never came: out, no due_at.
  for (let i = 0; i < 10; i++)
    rows.push({
      wave_id: "w-stopped",
      arm: "holdout",
      state: "excluded",
      due_at: null,
      sent_at: null,
    });
  return rows;
}

describe("the effect line of a stopped wave whose 14 days have all run", () => {
  test("stopped-wave-effect-says-still-moving: every measured lead is booked or closed, so the line must not say the number can still move", () => {
    const c = countMembers(stoppedWave()).get("w-stopped");
    expect(c).toBeDefined();
    const counts = c!;
    // Sanity: the comparison is over the members whose turn came, all settled.
    expect(counts.measuredWave).toBe(80);
    expect(counts.measuredHoldout).toBe(10);
    expect(counts.settledWave).toBe(counts.measuredWave);
    expect(counts.settledHoldout).toBe(counts.measuredHoldout);
    const line = effectLine(counts);
    expect(line).toContain("Booked: 8 of 80");
    expect(line).not.toContain("can still book, so this moves");
  });

  test("wave-bar-parts-double-count-and-drop-members: the bar's parts (sent, in today's batch, waiting, held back, left the wave) add up to the wave's leads, each lead once", () => {
    const rows = stoppedWave();
    // Two wave leads taken out at their turn (booked by themselves before
    // it), watched like their twins: one closed at 14 days, one booked.
    const turn = iso(STOPPED - 2 * DAY);
    rows.push({
      wave_id: "w-stopped",
      arm: "wave",
      state: "closed",
      due_at: turn,
      sent_at: null,
    });
    rows.push({
      wave_id: "w-stopped",
      arm: "wave",
      state: "booked",
      due_at: turn,
      sent_at: null,
    });
    const c = countMembers(rows).get("w-stopped")!;
    // WavesCard.tsx WaveBar: these five parts, in this order.
    const parts = {
      sent: c.messaged,
      in_todays_batch: c.drafted,
      waiting: c.waiting,
      held_back: c.holdout,
      left_the_wave: c.excluded,
    };
    const sum = Object.values(parts).reduce((a, n) => a + n, 0);
    expect({ total: c.total, parts_add_up_to: sum, parts }).toEqual({
      total: 202,
      parts_add_up_to: 202,
      // 80 sent; 20 held back (10 measured, 10 out before their turn);
      // 102 wave leads out of the wave (100 before their turn, 2 at it).
      parts: {
        sent: 80,
        in_todays_batch: 0,
        waiting: 0,
        held_back: 20,
        left_the_wave: 102,
      },
    });
  });

  test("control: a running wave with leads inside their 14 days says it may move", () => {
    const rows: MemberRow[] = [];
    const turn = iso(STOPPED);
    for (let i = 0; i < 40; i++)
      rows.push({
        wave_id: "w-run",
        arm: "wave",
        state: i < 4 ? "booked" : "sent",
        due_at: turn,
        sent_at: turn,
      });
    for (let i = 0; i < 12; i++)
      rows.push({
        wave_id: "w-run",
        arm: "holdout",
        state: "held_out",
        due_at: turn,
        sent_at: null,
      });
    const line = effectLine(countMembers(rows).get("w-run")!);
    expect(line).toContain("can still book, so this moves");
  });
});
