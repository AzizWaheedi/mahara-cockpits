// TIME stress, second series, round 4: the waves card's ended-wave line read
// on a later day.
//
// bun test src/lib/stress2_time_r4_waves_ui.test.ts   (from apps/sales-cockpit)
//
// The Follow-ups page lists ended waves under "Ended waves" for good
// (WavesCard, waveLine): "Leads never booked: ended 14:03. <reason>". The
// time is Kuwait's clock with no day, so a wave a manager stopped last week
// reads as stopped today. A test that fails here is a finding.

import { describe, expect, test } from "bun:test";
import { countMembers, countsFor, readWave, waveLine } from "./waves";

const iso = (s: string) => new Date(Date.parse(s)).toISOString();

describe("Sunday 11 October 10:00: the Ended waves list shows a wave a manager stopped on Monday 5 October at 14:03", () => {
  test("its line says the day it ended, never only '14:03' (which reads as today)", () => {
    const w = readWave({
      id: "w-stopped",
      pool: "never_booked",
      state: "done",
      per_day: 40,
      started_at: iso("2026-10-04T09:00:00+03:00"),
      ended_at: iso("2026-10-05T14:03:00+03:00"),
      done_reason: "Stopped by a manager.",
    });
    const line = waveLine(w!, countsFor(countMembers([]), "w-stopped"), {
      at: Date.parse("2026-10-11T10:00:00+03:00"),
      now: Date.parse("2026-10-11T10:00:00+03:00"),
    });
    // Found: "Leads never booked: ended 14:03. Stopped by a manager."
    expect(line).toMatch(/Mon|5 Oct|Monday/);
  });
});
